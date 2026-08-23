"""Adapter around the gws CLI.

The only module in this package that touches a subprocess. Everything it
returns is plain data, so the rest of the sync is testable without Google.
"""

import json
import os
import re
import subprocess

MINIMUM_VERSION = (0, 13, 2)
FALLBACK_COLOR = "#9e9e9e"
MAX_PAGES = 50

_VERSION = re.compile(r"(\d+)\.(\d+)\.(\d+)")


class GwsError(Exception):
    """Base class for every failure this adapter reports."""


class GwsMissing(GwsError):
    """The gws binary is not on PATH."""


class GwsTooOld(GwsError):
    """The installed gws predates the output shape this sync relies on."""


class GwsAuthError(GwsError):
    """Credentials are absent, expired, or lack the calendar scope."""


class GwsApiError(GwsError):
    """Google returned an error, or gws returned something unparseable."""


def _subprocess_runner(argv, env):
    completed = subprocess.run(argv, env=env, capture_output=True, text=True)
    return completed.returncode, completed.stdout, completed.stderr


class Gws:
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
        _, stdout, _ = self._run(["--version"])
        match = _VERSION.search(stdout)
        if not match:
            raise GwsApiError(f"cannot parse gws version from {stdout!r}")
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

    def _json(self, args):
        """Run gws and parse stdout.

        stderr carries keyring noise on success, so it is never parsed as
        data. On a nonzero exit code, stdout may not even be JSON, so stderr
        is quoted in the raised error instead since that is the only place
        useful diagnostic detail can come from.
        """
        exit_code, stdout, stderr = self._run(args)

        if exit_code != 0:
            excerpt = stderr.strip()[:200] or "no stderr output"
            raise GwsApiError(f"gws exited with code {exit_code}: {excerpt}")

        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError as error:
            raise GwsApiError(f"gws returned unparseable output: {error}") from error

        if isinstance(payload, dict) and "error" in payload:
            error = payload["error"]
            error_code = error.get("code")
            if error_code is None:
                error_code = "unknown"
            message = error.get("message", "unknown error")
            if error_code in (401, 403):
                raise GwsAuthError(f"{error_code}: {message}")
            raise GwsApiError(f"{error_code}: {message}")

        return payload
