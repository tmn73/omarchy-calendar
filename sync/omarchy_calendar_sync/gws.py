"""Adapter around the gws CLI.

The only module in this package that touches a subprocess. Everything it
returns is plain data, so the rest of the sync is testable without Google.
"""

import json
import os
import re
import subprocess

from .errors import SyncError

MINIMUM_VERSION = (0, 13, 2)
FALLBACK_COLOR = "#9e9e9e"
MAX_PAGES = 50

_VERSION = re.compile(r"(\d+)\.(\d+)\.(\d+)")


class GwsError(SyncError):
    """Base class for every failure this adapter reports."""


class GwsMissing(GwsError):
    """The gws binary is not on PATH."""


class GwsTooOld(GwsError):
    """The installed gws predates the output shape this sync relies on."""


class GwsAuthError(GwsError):
    """Credentials are absent, expired, or lack the calendar scope."""


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


class Gws:
    SOURCE_NAME = "gws"

    # The event command asks the client, never the backend name, whether it
    # can write. A backend without create/update/delete sets this to False.
    can_write = True

    def __init__(self, profile, runner=None, binary="gws"):
        self.profile = str(profile)
        self.binary = str(binary or "gws")
        self._runner = runner or _subprocess_runner

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
        params = {"calendarId": calendar_id, **_write_params(send_updates)}
        return self._json([
            "calendar", "events", "insert",
            "--params", json.dumps(params),
            "--json", json.dumps(body),
        ])

    def update(self, calendar_id, event_id, body, send_updates="none"):
        # patch, not update: only the fields in `body` change, so anything
        # the form does not show survives an edit from the panel.
        params = {"calendarId": calendar_id, "eventId": event_id, **_write_params(send_updates)}
        return self._json([
            "calendar", "events", "patch",
            "--params", json.dumps(params),
            "--json", json.dumps(body),
        ])

    def replace(self, calendar_id, event_id, resource, send_updates="none"):
        # PUT: the whole event, so a field left out is removed. The only way
        # to remove a Meet, since a patch cannot.
        params = {"calendarId": calendar_id, "eventId": event_id, **_write_params(send_updates)}
        return self._json([
            "calendar", "events", "update",
            "--params", json.dumps(params),
            "--json", json.dumps(resource),
        ])

    def delete(self, calendar_id, event_id, send_updates="none"):
        params = {"calendarId": calendar_id, "eventId": event_id,
                  "sendUpdates": _send_updates(send_updates)}
        exit_code, stdout, stderr = self._run([
            "calendar", "events", "delete",
            "--params", json.dumps(params),
        ])
        # Google answers a delete with HTTP 204 and no body.
        if exit_code == 0 and not stdout.strip():
            return None
        self._parse(exit_code, stdout, stderr)
        return None

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
            error = payload["error"]
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
