"""caldir as a calendar source.

caldir (https://caldir.org) keeps calendars as plain .ics files on disk and
syncs them with Google, iCloud and CalDAV through its own providers. Someone
who already uses it has signed in once there, so this backend needs no Google
Cloud project, no OAuth client and no second sign-in: it asks the caldir CLI
for its calendars and events as JSON.

Like eds and ics, this emits Google event resources (see resources.py) rather
than contract rows.
"""

import json
import os
import re
import subprocess
from datetime import date, datetime, timedelta

from . import budget
from .errors import SyncError
from .resources import build_event

FALLBACK_COLOR = "#9e9e9e"

_VERSION = re.compile(r"(\d+)\.(\d+)\.(\d+)")


class CaldirError(SyncError):
    """caldir could not be read."""


class CaldirMissing(CaldirError):
    """The caldir binary is not installed or not on PATH."""


def _subprocess_runner(argv):
    completed = subprocess.run(
        argv, capture_output=True, text=True, timeout=budget.HELPER_SECONDS,
        preexec_fn=budget.uncap_memory,
    )
    return completed.returncode, completed.stdout, completed.stderr


def time_to_node(value, all_day):
    """A caldir start or end as a Google start/end node.

    caldir writes all-day times as a bare date and timed ones with an offset.
    A timed value without one is refused rather than guessed, as normalize
    would refuse it anyway.
    """
    if not value:
        return None
    if all_day:
        return {"date": str(value)[:10]}
    parsed = datetime.fromisoformat(str(value))
    if parsed.tzinfo is None:
        raise CaldirError("caldir returned a time without an offset: %r" % value)
    return {"dateTime": parsed.isoformat()}


def event_type(raw):
    """Google's event type (workingLocation, outOfOffice, focusTime), if any."""
    for prop in raw.get("x_properties") or []:
        if str(prop.get("name") or "").upper() == "X-GOOGLE-EVENT-TYPE":
            return str(prop.get("value") or "")
    return ""


def conference_url(raw):
    """The meeting link. caldir puts Google's conference link in `url`."""
    for prop in raw.get("x_properties") or []:
        if str(prop.get("name") or "").upper() == "X-GOOGLE-CONFERENCE":
            return str(prop.get("value") or "")
    return str(raw.get("url") or "")


def reminder_minutes(raw):
    minutes = []
    for reminder in raw.get("reminders") or []:
        value = reminder.get("minutes_before_start")
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            minutes.append(value)
    return sorted(set(minutes))


def to_event(raw):
    """One caldir event as a Google event resource."""
    all_day = raw.get("all_day") is True
    event = build_event(
        uid=str(raw.get("uid") or raw.get("instance_id") or ""),
        start_node=time_to_node(raw.get("start"), all_day),
        end_node=time_to_node(raw.get("end"), all_day),
        summary=raw.get("title") or raw.get("summary") or "",
        location=raw.get("location") or "",
        description=raw.get("description") or "",
        status=raw.get("status") or "",
        conference_url=conference_url(raw),
        # caldir already answers for the account that owns the calendar.
        partstat=raw.get("rsvp") or "",
        reminders=reminder_minutes(raw),
    )
    kind = event_type(raw)
    if kind:
        event["eventType"] = kind
    return event


def _local_date(rfc3339):
    return datetime.fromisoformat(rfc3339).astimezone().date()


class Caldir:
    """A calendar client backed by the caldir CLI.

    Presents the same surface as Gws -- check, version, calendars, events --
    so cli.run drives either without knowing which it has.
    """

    SOURCE_NAME = "caldir"

    # caldir can create and edit events, but the panel's form talks to
    # Google's API. Until that is wired up, publish no writable calendars.
    can_write = False

    def __init__(self, binary="caldir", pull=True, runner=None):
        self.binary = binary
        self._pull = pull
        self._runner = runner or _subprocess_runner
        self._pulled = False

    def _run(self, args):
        try:
            return self._runner([os.path.expanduser(self.binary), *args])
        except subprocess.TimeoutExpired as error:
            raise CaldirError("%s did not answer in %d s" % (self.binary, budget.HELPER_SECONDS)) from error
        except FileNotFoundError as error:
            raise CaldirMissing(
                "%s is not installed or not on PATH. A systemd user service "
                "does not inherit your shell PATH, so set caldirPath to an "
                "absolute path in calendar-sync.json." % self.binary
            ) from error

    def _json(self, args):
        code, stdout, stderr = self._run(["--json", *args])
        if code != 0:
            excerpt = stderr.strip()[:200] or "no stderr output"
            raise CaldirError("caldir %s failed (exit %d): %s" % (args[0], code, excerpt))
        try:
            return json.loads(stdout)
        except json.JSONDecodeError as error:
            raise CaldirError("caldir %s returned invalid JSON: %s" % (args[0], error))

    def version(self):
        code, stdout, stderr = self._run(["--version"])
        match = _VERSION.search(stdout)
        if not match:
            excerpt = stderr.strip()[:200] or "no stderr output"
            raise CaldirError(
                "cannot parse caldir version from %r (exit %d: %s)" % (stdout, code, excerpt)
            )
        return tuple(int(part) for part in match.groups())

    def check(self):
        self.version()

    def _default_calendar(self):
        try:
            payload = self._json(["config"])
        except CaldirError:
            return ""
        return str((payload.get("config") or {}).get("default_calendar") or "")

    def calendars(self):
        """caldir's calendars, pulled from their providers first if asked.

        The pull belongs here rather than in events() so it runs once per sync
        instead of once per calendar. A failed pull is not fatal: the files
        caldir already has are still the best answer available.
        """
        if self._pull and not self._pulled:
            code, _stdout, stderr = self._run(["pull"])
            self._pulled = True
            if code != 0:
                print("caldir pull failed, using local copy: %s" % stderr.strip()[:200])

        primary = self._default_calendar()
        payload = self._json(["calendars"])
        if not isinstance(payload, list):
            raise CaldirError("caldir calendars must return a JSON array")

        calendars = []
        for item in payload:
            slug = str(item.get("slug") or "").strip()
            if not slug:
                continue
            calendars.append(
                {
                    "id": slug,
                    "name": str(item.get("name") or "").strip() or slug,
                    "color": item.get("color") or FALLBACK_COLOR,
                    "primary": slug == primary,
                    "writable": item.get("read_only") is False,
                }
            )
        return sorted(calendars, key=lambda calendar: calendar["name"])

    def events(self, calendar_id, time_min, time_max):
        # caldir takes whole local dates. Ask for a day either side, then keep
        # only what overlaps the window, so no event is lost to a zone edge.
        first = _local_date(time_min) - timedelta(days=1)
        last = _local_date(time_max) + timedelta(days=1)
        payload = self._json(
            ["events", "--calendar", calendar_id,
             "--from", first.isoformat(), "--to", last.isoformat()]
        )
        if not isinstance(payload, list):
            raise CaldirError("caldir events must return a JSON array")

        window_start = datetime.fromisoformat(time_min)
        window_end = datetime.fromisoformat(time_max)
        events = []
        for raw in payload:
            event = to_event(raw)
            if _overlaps(event, window_start, window_end):
                events.append(event)
        return events

    def auth_hint(self, _cfg):
        return (
            "if this is an auth error, run `caldir status` in a terminal; "
            "`caldir connect` signs in to a provider again"
        )


def _instant(node):
    if not node:
        return None
    if "dateTime" in node:
        return datetime.fromisoformat(node["dateTime"])
    day = date.fromisoformat(node["date"])
    return datetime.combine(day, datetime.min.time()).astimezone()


def _overlaps(event, window_start, window_end):
    start = _instant(event.get("start"))
    end = _instant(event.get("end")) or start
    if start is None:
        return False
    return start < window_end and end > window_start
