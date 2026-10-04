"""Adapter around the gws CLI, and the Google Calendar API for writes.

Reads go through gws. Writes go to the API over HTTPS, with a token made
from the sign-in gws holds: gws takes a request body only as a --json
argument, and arguments show an event's description and guests to every
user on the machine through ps. Everything this module returns is plain
data, so the rest of the sync is testable without Google.
"""

import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

from .errors import SyncError

MINIMUM_VERSION = (0, 13, 2)
FALLBACK_COLOR = "#9e9e9e"
MAX_PAGES = 50

TOKEN_URL = "https://oauth2.googleapis.com/token"
SIGN_IN_EXPIRED = "Your Google sign-in expired. Run sync/setup --write."
NO_SIGN_IN = "No Google sign-in to write with. Run sync/setup --write."
MASKED_SIGN_IN = "gws did not hand over the sign-in. Update gws, then try again."
CALENDAR_API = "https://www.googleapis.com/calendar/v3"
HTTP_TIMEOUT_SECONDS = 30

_VERSION = re.compile(r"(\d+)\.(\d+)\.(\d+)")


class GwsError(SyncError):
    """Base class for every failure this adapter reports."""


class GwsMissing(GwsError):
    """The gws binary is not on PATH."""


class GwsTooOld(GwsError):
    """The installed gws predates the output shape this sync relies on."""


class GwsAuthError(GwsError):
    """Credentials are absent, expired, or lack the calendar scope."""


class GwsSignInError(GwsAuthError):
    """No usable sign-in to write with. The message is for a person."""


class GwsApiError(GwsError):
    """Google returned an error, or gws returned something unparseable."""


class GwsNotFound(GwsApiError):
    """The event or the calendar does not exist (Google error 404)."""


def _send_updates(value):
    # Only the two answers the panel asks for. "externalOnly" is valid for
    # Google, but nothing in the panel offers it.
    if value not in ("all", "none"):
        raise ValueError(f"sendUpdates must be 'all' or 'none', got {value!r}")
    return value


def _write_params(send_updates):
    # conferenceDataVersion=1 on every write: without it Google ignores a
    # Meet request, and a removed Meet stays on the event.
    return {"sendUpdates": _send_updates(send_updates), "conferenceDataVersion": 1}


def _subprocess_runner(argv, env):
    completed = subprocess.run(argv, env=env, capture_output=True, text=True)
    return completed.returncode, completed.stdout, completed.stderr


def _https(method, url, headers, data):
    """One request: (status, body text). An HTTP error status is a reply,
    not an exception; only a request that never got one raises."""
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError) as error:
        raise GwsApiError(f"cannot reach Google: {getattr(error, 'reason', error)}") from error


def _quote(value):
    # Calendar ids hold @ and #, and an event id is opaque: nothing in them
    # may read as a path separator or a query.
    return urllib.parse.quote(str(value), safe="")


class Gws:
    SOURCE_NAME = "gws"

    # The event command asks the client, never the backend name, whether it
    # can write. A backend without create/update/delete sets this to False.
    can_write = True

    def __init__(self, profile, runner=None, binary="gws", http=None):
        self.profile = str(profile)
        self.binary = str(binary or "gws")
        self._runner = runner or _subprocess_runner
        self._http = http or _https
        self._access_token = None

    def _run(self, args):
        env = dict(os.environ)
        env["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"] = self.profile
        try:
            code, stdout, stderr = self._runner([self.binary, *args], env)
        except FileNotFoundError as error:
            raise GwsMissing(
                f"{self.binary} is not installed or not on PATH. "
                "A systemd user service does not inherit your shell PATH, so set "
                "gwsPath to an absolute path in calendar-sync.json."
            ) from error
        return code, stdout, stderr

    def version(self):
        exit_code, stdout, stderr = self._run(["--version"])
        match = _VERSION.search(stdout)
        if not match:
            # A gws that exists but cannot start (a wrapper that execs node,
            # under a PATH without node) prints nothing to stdout. The reason
            # is only on stderr, so quote it.
            excerpt = stderr.strip()[:200] or "no stderr output"
            raise GwsApiError(
                f"cannot parse gws version from {stdout!r} (exit {exit_code}: {excerpt})"
            )
        return tuple(int(part) for part in match.groups())

    def check(self):
        found = self.version()
        if found < MINIMUM_VERSION:
            wanted = ".".join(str(p) for p in MINIMUM_VERSION)
            have = ".".join(str(p) for p in found)
            raise GwsTooOld(f"gws {wanted} or newer is required, found {have}")

    def calendars(self):
        payload = self._json(["calendar", "calendarList", "list"])
        calendars = [
            {
                "id": item["id"],
                # A renamed subscription (ICS feeds especially, whose
                # summary is whatever the feed called itself) keeps the
                # user's name in summaryOverride, so prefer that.
                "name": item.get("summaryOverride")
                or item.get("summary")
                or item["id"],
                "color": item.get("backgroundColor") or FALLBACK_COLOR,
                "primary": item.get("primary") is True,
                "writable": item.get("accessRole") in ("owner", "writer"),
                # An event with reminders.useDefault names no minutes of its
                # own; these are what it means.
                "defaultReminders": item.get("defaultReminders") or [],
            }
            for item in payload.get("items", [])
        ]
        return sorted(calendars, key=lambda calendar: calendar["name"])

    def events(self, calendar_id, time_min, time_max):
        items = []
        page_token = None
        for _ in range(MAX_PAGES):
            params = {
                "calendarId": calendar_id,
                "singleEvents": True,
                "orderBy": "startTime",
                "timeMin": time_min,
                "timeMax": time_max,
                "maxResults": 250,
            }
            if page_token:
                params["pageToken"] = page_token
            payload = self._json(
                ["calendar", "events", "list", "--params", json.dumps(params)]
            )
            items.extend(payload.get("items", []))
            page_token = payload.get("nextPageToken")
            if not page_token:
                return items
        raise GwsApiError(
            f"gws events list did not finish paginating within {MAX_PAGES} pages"
        )

    def get(self, calendar_id, event_id):
        return self._json([
            "calendar", "events", "get",
            "--params", json.dumps({"calendarId": calendar_id, "eventId": event_id}),
        ])

    def create(self, calendar_id, body, send_updates="none"):
        return self._write("POST", _events_path(calendar_id), _write_params(send_updates), body)

    def update(self, calendar_id, event_id, body, send_updates="none"):
        # patch, not update: only the fields in `body` change, so anything
        # the form does not show survives an edit from the panel.
        return self._write("PATCH", _events_path(calendar_id, event_id), _write_params(send_updates), body)

    def replace(self, calendar_id, event_id, resource, send_updates="none"):
        # PUT: the whole event, so a field left out is removed. The only way
        # to remove a Meet, since a patch cannot.
        return self._write("PUT", _events_path(calendar_id, event_id), _write_params(send_updates), resource)

    def delete(self, calendar_id, event_id, send_updates="none"):
        # Google answers a delete with HTTP 204 and no body.
        self._write("DELETE", _events_path(calendar_id, event_id),
                    {"sendUpdates": _send_updates(send_updates)})
        return None

    def _write(self, method, path, params, body=None):
        headers = {"Authorization": "Bearer " + self._token()}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        status, text = self._http(method, f"{CALENDAR_API}{path}?{urllib.parse.urlencode(params)}", headers, data)
        try:
            payload = json.loads(text) if text.strip() else None
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
            _raise_api_error(payload["error"])
        if not 200 <= status < 300:
            raise GwsApiError(f"Google answered HTTP {status}")
        if payload is None and text.strip():
            raise GwsApiError("Google returned unparseable output")
        return payload

    def _token(self):
        """An access token made from the sign-in gws holds, once per run.

        gws prints the credentials on stdout, which no other user can read,
        and they stay in this process. No message here may quote them.
        """
        if self._access_token:
            return self._access_token
        # export reads only its first argument, and only as --unmasked
        # (gws 0.13.2 src/auth_commands.rs): anything else leaves it masked.
        exit_code, stdout, _ = self._run(["auth", "export", "--unmasked"])
        try:
            credentials = json.loads(stdout)
        except json.JSONDecodeError:
            credentials = None
        if exit_code != 0 or not isinstance(credentials, dict):
            raise GwsSignInError(NO_SIGN_IN)
        fields = {key: credentials.get(key) for key in ("client_id", "client_secret", "refresh_token")}
        if not all(isinstance(value, str) and value for value in fields.values()):
            raise GwsSignInError(NO_SIGN_IN)
        # A masked export reads "GOCS...jmye".
        if "..." in fields["client_secret"] or "..." in fields["refresh_token"]:
            raise GwsSignInError(MASKED_SIGN_IN)

        data = urllib.parse.urlencode({**fields, "grant_type": "refresh_token"}).encode("utf-8")
        status, text = self._http("POST", TOKEN_URL, {"Content-Type": "application/x-www-form-urlencoded"}, data)
        try:
            reply = json.loads(text)
        except json.JSONDecodeError:
            reply = None
        token = reply.get("access_token") if isinstance(reply, dict) else None
        if status != 200 or not isinstance(token, str) or not token:
            reason = reply.get("error") if isinstance(reply, dict) else None
            # invalid_grant: the refresh token expired or was revoked.
            if status in (400, 401) or reason == "invalid_grant":
                raise GwsSignInError(SIGN_IN_EXPIRED)
            raise GwsApiError(f"Google answered the token request with HTTP {status}")
        self._access_token = token
        return token

    def _json(self, args):
        """Run gws and parse stdout."""
        return self._parse(*self._run(args))

    def _parse(self, exit_code, stdout, stderr):
        """Parse one gws reply, or raise the error it carries.

        stderr carries keyring noise on success and on failure, so it is
        never parsed as data. An API error exits 1 with Google's JSON error
        on stdout (verified on gws 0.13.2), so stdout is read first. Only
        when stdout holds no error does a nonzero exit quote stderr, which
        is then the only place detail can come from.
        """
        decode_error = None
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError as error:
            payload = None
            decode_error = error

        if isinstance(payload, dict) and isinstance(payload.get("error"), dict):
            _raise_api_error(payload["error"])

        if exit_code != 0:
            excerpt = stderr.strip()[:200] or "no stderr output"
            raise GwsApiError(f"gws exited with code {exit_code}: {excerpt}")

        if decode_error is not None:
            raise GwsApiError(f"gws returned unparseable output: {decode_error}") from decode_error

        return payload

    def auth_hint(self, cfg):
        return (
            "if this is an auth error, run: "
            "GOOGLE_WORKSPACE_CLI_CONFIG_DIR=" + str(cfg["profile"]) + " "
            "gws auth login --scopes "
            "https://www.googleapis.com/auth/calendar.readonly"
        )


def _events_path(calendar_id, event_id=None):
    path = f"/calendars/{_quote(calendar_id)}/events"
    return path if event_id is None else f"{path}/{_quote(event_id)}"


def _raise_api_error(error):
    """Raise what one Google error object means, the same for gws and HTTPS."""
    error_code = error.get("code")
    if error_code is None:
        error_code = "unknown"
    message = error.get("message", "unknown error")
    reasons = {str(e.get("reason") or "") for e in error.get("errors") or [] if isinstance(e, dict)}
    # A quota 403 is not a sign-in problem.
    if error_code == 403 and reasons & {"rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded"}:
        raise GwsApiError(f"{error_code}: {message}")
    if error_code in (401, 403):
        raise GwsAuthError(f"{error_code}: {message}")
    # 410 is what Google answers for an event that was deleted.
    if error_code in (404, 410):
        raise GwsNotFound(f"{error_code}: {message}")
    raise GwsApiError(f"{error_code}: {message}")
