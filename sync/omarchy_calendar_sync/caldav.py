"""CalDAV as a calendar source, read and write.

Why this exists alongside the others: iCloud, Nextcloud, Fastmail and most
calendar servers outside Google speak CalDAV, and CalDAV takes a plain
username and an app password. No OAuth client, no Evolution, no second
program to keep in sync, and unlike an iCal feed it can write: an event
made in the panel shows up on the phone a moment later.

Reads ask the server for every event resource that touches the window and
expand repeats locally, like the ics backend, so the rows come out the
same. Writes fetch the event's resource, change it and put it back with
If-Match, so an edit made elsewhere in between is refused rather than
overwritten.

Like eds and ics, this speaks Google event resources (see resources.py) to
the rest of the sync, so normalize, the contract and the event command stay
shared. The panel's form is Google's; what CalDAV has no field for (Meet,
Google's colours, guest permissions) is listed per calendar under "lacks"
and the form leaves it out. Guests are left out too: a CalDAV server sends
invitations by itself, so the panel's "send emails?" question could not be
honoured.

The icalendar imports are deliberately lazy, so the module stays importable
on a machine without python-icalendar and python-recurring-ical-events.
"""

import base64
import copy
import re
import shlex
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .errors import EventNotFound, SyncError
from .ics import FEED_COLORS, _load_libs, _popup_reminders, occurrence_to_event
from .localzone import resolve_local_timezone

HTTP_TIMEOUT_SECONDS = 30
PASSWORD_COMMAND_TIMEOUT_SECONDS = 30
MAX_REDIRECTS = 5
USER_AGENT = "omarchy-calendar-sync"
PRODID = "-//omarchy-calendar//CalDAV//EN"

# What the panel's form offers that CalDAV cannot store. The form hides
# these for a calendar that lists them.
LACKS = ["guests", "meet", "color"]

NS = {
    "d": "DAV:",
    "c": "urn:ietf:params:xml:ns:caldav",
    "a": "http://apple.com/ns/ical/",
}

_COLOR = re.compile(r"^#[0-9a-fA-F]{6}")
# An occurrence of a series is "<uid>#<recurrence id>", the recurrence id as
# a date or a UTC time. The uid alone is the event, or the whole series.
_OCCURRENCE = re.compile(r"^(.+)#(\d{8}(?:T\d{6}Z)?)$")
_RECURRENCE_PROPS = ("RRULE", "RDATE", "EXDATE")

SETUP_HINT = "run sync/setup --caldav again"


class CaldavError(SyncError):
    """A CalDAV server could not be read or written."""


class CaldavAuthError(CaldavError):
    """The server refused the username and password."""


class CaldavNotFound(CaldavError, EventNotFound):
    """The event, or its calendar, is not on the server."""


class CaldavConflict(CaldavError):
    """The event changed on the server since it was read."""


# ---- Configuration -------------------------------------------------------


def parse_accounts(raw):
    """Normalize the `caldav` config value into a list of accounts.

    Accepts one object or a list of them, each with `url`, `username`, and
    either `passwordCommand` (a list of arguments, or a string split like a
    shell would) or `password`.
    """
    if isinstance(raw, dict):
        raw = [raw]
    accounts = []
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        url = str(entry.get("url") or "").strip()
        if not url:
            continue
        if not url.endswith("/"):
            url += "/"
        command = entry.get("passwordCommand") or []
        if isinstance(command, str):
            command = shlex.split(command)
        accounts.append(
            {
                "url": url,
                "username": str(entry.get("username") or "").strip(),
                "password": str(entry.get("password") or ""),
                "passwordCommand": [str(part) for part in command],
            }
        )
    return accounts


def redact(url):
    """A URL fit for a log line: scheme and host only."""
    parts = urllib.parse.urlsplit(url)
    return "%s://%s/..." % (parts.scheme, parts.hostname) if parts.hostname else "(no url)"


def _origin(url):
    """(scheme, host, port) of a URL, the unit the password is given to.
    None when the URL names no host or a bad port."""
    parts = urllib.parse.urlsplit(url)
    try:
        port = parts.port or {"https": 443, "http": 80}.get(parts.scheme)
    except ValueError:
        return None
    return (parts.scheme, parts.hostname, port) if parts.hostname else None


def _run_password_command(argv):
    try:
        completed = subprocess.run(
            argv, capture_output=True, text=True, timeout=PASSWORD_COMMAND_TIMEOUT_SECONDS
        )
    except FileNotFoundError as error:
        raise CaldavAuthError("passwordCommand %s is not installed" % argv[0]) from error
    except subprocess.TimeoutExpired as error:
        raise CaldavAuthError(
            "passwordCommand did not answer in %d s; is the keyring locked?"
            % PASSWORD_COMMAND_TIMEOUT_SECONDS
        ) from error
    if completed.returncode != 0:
        excerpt = completed.stderr.strip()[:200] or "no stderr output"
        raise CaldavAuthError("passwordCommand failed (exit %d): %s" % (completed.returncode, excerpt))
    return completed.stdout.rstrip("\r\n")


# ---- HTTP ----------------------------------------------------------------


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # urllib follows a redirect only for GET and HEAD, and drops the body.
    # WebDAV redirects PROPFIND too (/.well-known/caldav, for one), so
    # redirects are followed by hand, method and body intact.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def _http(method, url, headers, data):
    """One request. Returns (status, headers, body bytes)."""
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with _OPENER.open(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers or {}), error.read() or b""
    except (urllib.error.URLError, OSError) as error:
        raise CaldavError("cannot reach %s: %s" % (redact(url), getattr(error, "reason", error))) from error


def _header(headers, name):
    for key, value in (headers or {}).items():
        if key.lower() == name.lower():
            return value
    return ""


# ---- WebDAV XML ----------------------------------------------------------


def _propfind_body(props):
    names = "".join("<%s/>" % prop for prop in props)
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" '
        'xmlns:a="http://apple.com/ns/ical/"><d:prop>%s</d:prop></d:propfind>' % names
    ).encode()


def _query_body(vevent_filter):
    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
        "<d:prop><d:getetag/><c:calendar-data/></d:prop>"
        '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">'
        "%s</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>" % vevent_filter
    ).encode()


def _utc_stamp(rfc3339):
    moment = datetime.fromisoformat(rfc3339).astimezone(timezone.utc)
    return moment.strftime("%Y%m%dT%H%M%SZ")


def parse_multistatus(body, base_url):
    """[(absolute href, {"{ns}name": element})] for the props found (200)."""
    try:
        root = ET.fromstring(body)
    except ET.ParseError as error:
        raise CaldavError("the server returned invalid XML: %s" % error) from error
    results = []
    for response in root.findall("d:response", NS):
        href = (response.findtext("d:href", default="", namespaces=NS) or "").strip()
        if not href:
            continue
        props = {}
        for propstat in response.findall("d:propstat", NS):
            status = propstat.findtext("d:status", default="", namespaces=NS) or ""
            if " 200 " not in status + " ":
                continue
            prop = propstat.find("d:prop", NS)
            for element in list(prop) if prop is not None else []:
                props[element.tag] = element
        results.append((urllib.parse.urljoin(base_url, href), props))
    return results


def _tag(prefix, name):
    return "{%s}%s" % (NS[prefix], name)


def _href_in(props, prefix, name, base_url):
    element = props.get(_tag(prefix, name))
    if element is None:
        return ""
    href = element.findtext("d:href", default="", namespaces=NS).strip()
    if not href:
        # iCloud sends schedule-default-calendar-URL as bare text, not in
        # the <href> RFC 6638 puts it in.
        href = (element.text or "").strip()
    return urllib.parse.urljoin(base_url, href) if href else ""


def calendar_color(value, position):
    """Apple's #RRGGBBAA as the contract's #RRGGBB, or a palette colour."""
    text = str(value or "").strip()
    if _COLOR.match(text):
        return text[:7]
    return FEED_COLORS[position % len(FEED_COLORS)]


def collection_to_calendar(href, props, position):
    """A calendar dict for a collection, or None when it holds no events.

    iCloud's Reminders lists are calendars too, for VTODO only.
    """
    kind = props.get(_tag("d", "resourcetype"))
    if kind is None or kind.find("c:calendar", NS) is None:
        return None
    components = props.get(_tag("c", "supported-calendar-component-set"))
    if components is not None:
        names = {comp.get("name", "").upper() for comp in components.findall("c:comp", NS)}
        if names and "VEVENT" not in names:
            return None

    privileges = props.get(_tag("d", "current-user-privilege-set"))
    writable = True
    if privileges is not None:
        granted = {child.tag for privilege in privileges.findall("d:privilege", NS) for child in privilege}
        writable = bool(granted & {_tag("d", "write"), _tag("d", "write-content"), _tag("d", "all")})

    name_element = props.get(_tag("d", "displayname"))
    name = (name_element.text or "").strip() if name_element is not None else ""
    if not name:
        name = urllib.parse.unquote(href.rstrip("/").rsplit("/", 1)[-1])
    color_element = props.get(_tag("a", "calendar-color"))
    return {
        "id": href,
        "name": name,
        "color": calendar_color(color_element.text if color_element is not None else "", position),
        "writable": writable,
        "lacks": list(LACKS),
    }


# ---- Event ids -----------------------------------------------------------


def recurrence_token(value, local_tz):
    """A recurrence id as text: YYYYMMDD for a date, UTC for a time."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=local_tz)
        return value.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return value.strftime("%Y%m%d")


def occurrence_id(uid, recurrence_value, local_tz):
    return "%s#%s" % (uid, recurrence_token(recurrence_value, local_tz))


def split_id(event_id):
    """(uid, recurrence token or "") for an id this backend made."""
    match = _OCCURRENCE.match(str(event_id or ""))
    if match:
        return match.group(1), match.group(2)
    return str(event_id or ""), ""


def _token_value(token, like):
    """The recurrence id `token` stands for, shaped like the series' DTSTART."""
    if "T" not in token:
        return datetime.strptime(token, "%Y%m%d").date()
    moment = datetime.strptime(token, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    if isinstance(like, datetime) and like.tzinfo is not None:
        return moment.astimezone(like.tzinfo)
    if isinstance(like, datetime):
        # A floating series: its recurrence ids are floating too.
        return moment.astimezone().replace(tzinfo=None)
    return moment


# ---- iCalendar and Google event resources --------------------------------


def to_resource(component, local_tz, identity="", series=True):
    """One VEVENT (an occurrence, an override or a whole event) as a Google
    event resource, with this backend's ids.

    `series` False says the event does not repeat. recurring_ical_events
    stamps a RECURRENCE-ID on a lone timed event too, and that event's id
    must stay its bare UID.
    """
    event = occurrence_to_event(component, local_tz, identity)
    if event is None:
        return None
    uid = event["iCalUID"]
    recurrence = component.get("RECURRENCE-ID")
    if recurrence is not None and series:
        event["id"] = occurrence_id(uid, recurrence.dt, local_tz)
        event["recurringEventId"] = uid
    else:
        event["id"] = uid
    if str(component.get("TRANSP") or "").upper() == "TRANSPARENT":
        event["transparency"] = "transparent"
    visibility = str(component.get("CLASS") or "").lower()
    if visibility in ("public", "private", "confidential"):
        event["visibility"] = visibility
    return event


def recurrence_lines(component):
    """The series' RRULE, RDATE and EXDATE lines, as Google lists them."""
    text = component.to_ical().decode("utf-8")
    unfolded = re.sub(r"\r?\n[ \t]", "", text)
    lines = []
    for line in unfolded.splitlines():
        name = re.split(r"[;:]", line, maxsplit=1)[0].upper()
        if name in _RECURRENCE_PROPS:
            lines.append(line)
    return lines


def master_resource(component, local_tz, identity=""):
    event = to_resource(component, local_tz, identity)
    if event is not None:
        lines = recurrence_lines(component)
        if lines:
            event["recurrence"] = lines
    return event


def node_value(node):
    """A Google start or end node as an iCalendar date or datetime."""
    if "date" in node:
        return date.fromisoformat(node["date"])
    moment = datetime.fromisoformat(node["dateTime"])
    if moment.tzinfo is None:
        raise CaldavError("a time without an offset cannot be written: %r" % node["dateTime"])
    zone = node.get("timeZone")
    if zone:
        try:
            return moment.astimezone(ZoneInfo(zone))
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return moment.astimezone(timezone.utc)


def _set(component, name, value):
    component.pop(name, None)
    if value not in (None, ""):
        component.add(name, value)


def _is_popup_alarm(alarm):
    return bool(_popup_reminders(_wrap(alarm)))


def _wrap(alarm):
    icalendar, _rie = _load_libs()
    holder = icalendar.Event()
    holder.add_component(alarm)
    return holder


def _set_reminders(component, reminders):
    """Replace the alarms the form shows. E-mail and absolute alarms stay.

    CalDAV has no calendar default, so "default" means no alarm.
    """
    icalendar, _rie = _load_libs()
    component.subcomponents = [
        sub for sub in component.subcomponents
        if not (sub.name == "VALARM" and _is_popup_alarm(sub))
    ]
    if reminders.get("useDefault", True):
        return
    minutes = sorted({
        int(override.get("minutes") or 0)
        for override in reminders.get("overrides") or []
        if str(override.get("method") or "popup") == "popup"
    })
    for value in minutes:
        alarm = icalendar.Alarm()
        alarm.add("ACTION", "DISPLAY")
        # Not the title: it would go stale on the next rename.
        alarm.add("DESCRIPTION", "Reminder")
        alarm.add("TRIGGER", timedelta(minutes=-value))
        component.add_component(alarm)


def _set_recurrence(component, lines):
    icalendar, _rie = _load_libs()
    for name in _RECURRENCE_PROPS:
        component.pop(name, None)
    for line in lines or []:
        holder = icalendar.Event.from_ical("BEGIN:VEVENT\r\n%s\r\nEND:VEVENT\r\n" % line)
        for name, value in holder.property_items(recursive=False):
            if name in _RECURRENCE_PROPS:
                component.add(name, value)


def apply_body(component, body):
    """Write the fields of a Google event body onto a VEVENT, in place.

    Only the keys present change, as a Google patch would. What iCalendar
    has no field for (conference, colour, guest permissions) is ignored,
    and so are guests: see the module docstring.
    """
    for key, name in (("summary", "SUMMARY"), ("location", "LOCATION"), ("description", "DESCRIPTION")):
        if key in body:
            _set(component, name, str(body[key] or ""))
    if "start" in body:
        _set(component, "DTSTART", node_value(body["start"]))
    if "end" in body:
        component.pop("DURATION", None)
        _set(component, "DTEND", node_value(body["end"]))
    if "recurrence" in body:
        _set_recurrence(component, body["recurrence"])
    if "reminders" in body:
        _set_reminders(component, body["reminders"] or {"useDefault": True})
    if "transparency" in body:
        _set(component, "TRANSP", "TRANSPARENT" if body["transparency"] == "transparent" else "OPAQUE")
    if "visibility" in body:
        visibility = str(body["visibility"] or "default").upper()
        _set(component, "CLASS", visibility if visibility in ("PUBLIC", "PRIVATE", "CONFIDENTIAL") else "")

    now = datetime.now(timezone.utc).replace(microsecond=0)
    _set(component, "DTSTAMP", now)
    _set(component, "LAST-MODIFIED", now)
    _set(component, "SEQUENCE", int(component.get("SEQUENCE") or 0) + 1)


def is_series(calendar):
    """True when the resource holds a repeating event or its overrides."""
    for component in _events_of(calendar):
        if component.get("RECURRENCE-ID") is not None:
            return True
        if any(component.get(name) is not None for name in ("RRULE", "RDATE")):
            return True
    return False


def _guests_of(body):
    return [a for a in body.get("attendees") or [] if str(a.get("email") or "").strip()]


def _events_of(calendar):
    return [sub for sub in calendar.subcomponents if sub.name == "VEVENT"]


def master_of(calendar):
    for component in _events_of(calendar):
        if component.get("RECURRENCE-ID") is None:
            return component
    return None


def override_of(calendar, token, local_tz):
    for component in _events_of(calendar):
        recurrence = component.get("RECURRENCE-ID")
        if recurrence is not None and recurrence_token(recurrence.dt, local_tz) == token:
            return component
    return None


def shift_exceptions(calendar, master, delta):
    """Move the series' exceptions with its start.

    EXDATE and each override's RECURRENCE-ID name an occurrence by its
    original start, so when "All events" moves the start, they would stop
    matching any occurrence: a deleted one would come back, an edited one
    would show twice.
    """
    dropped = []
    for prop in _as_list(master.get("EXDATE")):
        dropped.extend(entry.dt for entry in prop.dts)
    master.pop("EXDATE", None)
    for value in dropped:
        master.add("EXDATE", value + delta)
    for component in _events_of(calendar):
        recurrence = component.get("RECURRENCE-ID")
        if recurrence is not None:
            _set(component, "RECURRENCE-ID", recurrence.dt + delta)


def _as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def occurrence_component(master, token):
    """A VEVENT for one occurrence of the series, from its master.

    The start is the recurrence id, the length is the master's.
    """
    start = master["DTSTART"].dt
    value = _token_value(token, start)
    if master.get("DTEND") is not None:
        length = master["DTEND"].dt - start
    elif master.get("DURATION") is not None:
        length = master["DURATION"].dt
    else:
        length = timedelta(days=1) if not isinstance(start, datetime) else timedelta(0)

    occurrence = copy.deepcopy(master)
    for name in _RECURRENCE_PROPS + ("DURATION",):
        occurrence.pop(name, None)
    _set(occurrence, "RECURRENCE-ID", value)
    _set(occurrence, "DTSTART", value)
    _set(occurrence, "DTEND", value + length)
    return occurrence


# ---- The client ----------------------------------------------------------


class Caldav:
    """A calendar client backed by one or more CalDAV accounts.

    Presents the same surface as Gws -- check, version, calendars, events,
    and get, create, update, replace, delete for the event command -- so
    cli.run and event_cli drive it without knowing which they have.
    Calendar ids are the calendars' URLs on the server.
    """

    SOURCE_NAME = "caldav"

    can_write = True

    def __init__(self, accounts, identity="", http=None, password_command=None, local_tz=None):
        self._accounts = parse_accounts(accounts)
        self._identity = identity
        self._http = http or _http
        self._password_command = password_command or _run_password_command
        self._local_tz = local_tz if local_tz is not None else resolve_local_timezone()
        self._passwords = {}
        # Calendar id -> account, filled by calendars().
        self._owners = {}
        # (url, username) -> the origins that get the password. See _servers.
        self._named = {}

    # ---- surface shared with the other backends

    def version(self):
        icalendar, _rie = _load_libs()
        parts = []
        for piece in str(getattr(icalendar, "__version__", "0")).split("."):
            digits = "".join(ch for ch in piece if ch.isdigit())
            parts.append(int(digits or 0))
        return tuple(parts[:3]) or (0,)

    def check(self):
        _load_libs()
        if not self._accounts:
            raise CaldavError(
                "no account configured; run sync/setup --caldav, or add one under "
                "\"caldav\" in ~/.config/omarchy/calendar-sync.json"
            )
        for account in self._accounts:
            if not account["username"]:
                raise CaldavError("the account for %s has no username" % redact(account["url"]))
            if not account["password"] and not account["passwordCommand"]:
                raise CaldavError(
                    "the account for %s has no passwordCommand or password" % redact(account["url"])
                )

    def calendars(self):
        found = []
        failures = []
        for account in self._accounts:
            try:
                calendars = self._discover(account)
            except CaldavAuthError:
                raise
            except CaldavError as error:
                # One unreachable account must not sink the others.
                failures.append("%s: %s" % (redact(account["url"]), error))
                print("skipping %s: %s" % (redact(account["url"]), error))
                continue
            for calendar in calendars:
                self._owners[calendar["id"]] = account
            found.extend(calendars)
        if failures and not found:
            # Every account failed. Writing an empty file would wipe the panel.
            raise CaldavError("; ".join(failures))
        return sorted(found, key=lambda calendar: calendar["name"])

    def events(self, calendar_id, time_min, time_max):
        _icalendar, rie = _load_libs()
        span = '<c:time-range start="%s" end="%s"/>' % (_utc_stamp(time_min), _utc_stamp(time_max))
        start = datetime.fromisoformat(time_min)
        end = datetime.fromisoformat(time_max)
        events = []
        for href, _etag, calendar in self._query(calendar_id, span):
            series = is_series(calendar)
            try:
                occurrences = rie.of(calendar).between(start, end)
            except Exception as error:
                # One malformed resource costs its own events, not the sync.
                print("skipping %s: cannot expand it: %s" % (redact(href), error))
                continue
            for component in occurrences:
                event = to_resource(component, self._local_tz, self._identity_for(calendar_id), series)
                if event is not None:
                    events.append(event)
        return events

    def auth_hint(self, _cfg):
        return (
            "if this is a sign-in error, check the username and the password; "
            "iCloud wants an app-specific password from account.apple.com. "
            "To change them, " + SETUP_HINT
        )

    # ---- the event command

    def get(self, calendar_id, event_id):
        uid, token = split_id(event_id)
        _href, _etag, calendar = self._find(calendar_id, uid)
        if not token:
            master = master_of(calendar) or _events_of(calendar)[0]
            return master_resource(master, self._local_tz, self._identity_for(calendar_id))
        component = self._occurrence(calendar, token, uid)
        return to_resource(component, self._local_tz, self._identity_for(calendar_id))

    def create(self, calendar_id, body, send_updates="none"):
        icalendar, _rie = _load_libs()
        if _guests_of(body):
            raise CaldavError(
                "Guests cannot be invited to this calendar from the panel. "
                "Save without them, then invite them on your phone or computer."
            )
        uid = str(uuid.uuid4()).upper()
        calendar = icalendar.Calendar()
        calendar.add("PRODID", PRODID)
        calendar.add("VERSION", "2.0")
        event = icalendar.Event()
        event.add("UID", uid)
        event.add("CREATED", datetime.now(timezone.utc).replace(microsecond=0))
        apply_body(event, body)
        # A new event starts at sequence 0; apply_body counts an edit.
        _set(event, "SEQUENCE", 0)
        calendar.add_component(event)
        href = urllib.parse.urljoin(calendar_id, urllib.parse.quote(uid, safe="") + ".ics")
        self._put(calendar_id, href, calendar, create=True)
        return master_resource(event, self._local_tz, self._identity_for(calendar_id))

    def update(self, calendar_id, event_id, body, send_updates="none"):
        return self._change(calendar_id, event_id, body)

    def replace(self, calendar_id, event_id, resource, send_updates="none"):
        # The whole event, as Google's PUT. Every field this backend reads
        # is in it, so applying it over the stored event is a replace.
        return self._change(calendar_id, event_id, resource)

    def delete(self, calendar_id, event_id, send_updates="none"):
        uid, token = split_id(event_id)
        href, etag, calendar = self._find(calendar_id, uid)
        if not token:
            self._request(calendar_id, "DELETE", href, headers=_if_match(etag), expect=(200, 204))
            return None

        override = override_of(calendar, token, self._local_tz)
        if override is not None:
            calendar.subcomponents.remove(override)
        master = master_of(calendar)
        if master is not None:
            master.add("EXDATE", _token_value(token, master["DTSTART"].dt))
            _set(master, "SEQUENCE", int(master.get("SEQUENCE") or 0) + 1)
        if not _events_of(calendar):
            self._request(calendar_id, "DELETE", href, headers=_if_match(etag), expect=(200, 204))
        else:
            self._put(calendar_id, href, calendar, etag=etag)
        return None

    # ---- internals

    def _change(self, calendar_id, event_id, body):
        uid, token = split_id(event_id)
        href, etag, calendar = self._find(calendar_id, uid)
        if not token:
            target = master_of(calendar) or _events_of(calendar)[0]
            before = target["DTSTART"].dt
        else:
            target = override_of(calendar, token, self._local_tz)
            if target is None:
                # The first edit of one occurrence: it becomes an override,
                # stored beside the series in the same resource.
                target = self._occurrence(calendar, token, uid)
                calendar.add_component(target)
            # One occurrence cannot carry a rule.
            body = {key: value for key, value in body.items() if key != "recurrence"}
        apply_body(target, body)
        if not token and is_series(calendar):
            after = target["DTSTART"].dt
            # Only when the start keeps its kind: a date and a time cannot
            # be subtracted, and a switch to all day is a new series anyway.
            if isinstance(before, datetime) == isinstance(after, datetime) and after != before:
                shift_exceptions(calendar, target, after - before)
        self._put(calendar_id, href, calendar, etag=etag)
        if token:
            return to_resource(target, self._local_tz, self._identity_for(calendar_id))
        return master_resource(target, self._local_tz, self._identity_for(calendar_id))

    def _occurrence(self, calendar, token, uid):
        override = override_of(calendar, token, self._local_tz)
        if override is not None:
            return override
        master = master_of(calendar)
        if master is None:
            raise CaldavNotFound("occurrence %s of %s is not on the server" % (token, uid))
        return occurrence_component(master, token)

    def _identity_for(self, calendar_id):
        if self._identity:
            return self._identity
        username = self._account_for(calendar_id)["username"]
        return username if "@" in username else ""

    def _account_for(self, calendar_id):
        if calendar_id not in self._owners and len(self._accounts) > 1:
            # The event command runs without a sync first, so it has no map
            # of calendars to accounts. Only an account's own listing says a
            # calendar is its: a guess from the host could send one account's
            # password to another account's server.
            for account in self._accounts:
                try:
                    for calendar in self._discover(account):
                        self._owners[calendar["id"]] = account
                except CaldavError:
                    continue
                if calendar_id in self._owners:
                    break
        if calendar_id in self._owners:
            return self._owners[calendar_id]
        if len(self._accounts) == 1:
            return self._accounts[0]
        raise CaldavNotFound("no account lists %s" % redact(calendar_id))

    def _servers(self, account):
        """The servers that get the account's password: the one in its url,
        and those that server named in discovery. iCloud keeps each
        account's calendars on a host of its own, named in the calendar
        home, not reached by a redirect."""
        key = (account["url"], account["username"])
        return self._named.setdefault(key, {_origin(account["url"])})

    def _password(self, account):
        key = (account["url"], account["username"])
        if key not in self._passwords:
            if account["passwordCommand"]:
                self._passwords[key] = self._password_command(account["passwordCommand"])
            else:
                self._passwords[key] = account["password"]
        return self._passwords[key]

    def _request(self, account_or_calendar, method, url, body=None, headers=None, expect=(200, 207)):
        """Send one request, following redirects. Returns (status, headers,
        body, final url). Every request carries the password, so one to a
        server outside the account's is refused before it leaves."""
        if isinstance(account_or_calendar, dict):
            account = account_or_calendar
            servers = self._servers(account)
        else:
            account = self._account_for(account_or_calendar)
            # A calendar id comes from the account's own listing, or from the
            # events file that listing wrote (writes.parse_request refuses
            # any other), so its server is one the account's server named.
            servers = self._servers(account) | {_origin(account_or_calendar)}
        start = url
        for _ in range(MAX_REDIRECTS + 1):
            if not _may_send_password(url, servers):
                if url == start:
                    raise CaldavError(
                        "%s is not an https address of the account's server, so it gets "
                        "no password" % redact(url)
                    )
                raise CaldavError(
                    "redirected to %s, which gets no password; put that address in "
                    "the account's url" % redact(url)
                )
            token = "%s:%s" % (account["username"], self._password(account))
            sent = {
                "User-Agent": USER_AGENT,
                **(headers or {}),
                "Authorization": "Basic " + base64.b64encode(token.encode()).decode(),
            }
            status, reply_headers, reply = self._http(method, url, sent, body)
            location = _header(reply_headers, "Location")
            if status in (301, 302, 303, 307, 308) and location:
                url = urllib.parse.urljoin(url, location)
                continue
            break
        else:
            raise CaldavError("too many redirects from %s" % redact(account["url"]))

        if status in expect:
            return status, reply_headers, reply, url
        if status == 401:
            raise CaldavAuthError(
                "%s refused the sign-in for %s. iCloud needs an app-specific "
                "password, not the Apple ID one; %s"
                % (redact(url), account["username"], SETUP_HINT)
            )
        if status == 403:
            raise CaldavError("The server refused the change: this calendar may be read only.")
        if status == 404:
            raise CaldavNotFound("%s is not on the server" % redact(url))
        if status == 412:
            raise CaldavConflict(
                "This event changed on another device since it was read. "
                "Wait for the next sync, then try again."
            )
        raise CaldavError("%s %s answered HTTP %d" % (method, redact(url), status))

    def _propfind(self, account, url, props, depth):
        _status, _headers, body, final = self._request(
            account, "PROPFIND", url, body=_propfind_body(props),
            headers={"Depth": str(depth), "Content-Type": "application/xml; charset=utf-8"},
            expect=(207,),
        )
        return parse_multistatus(body, final)

    def _discover(self, account):
        """The account's event calendars: principal, home, then the list.

        Every answer comes from a server that gets the password already
        (_request refuses any other), so the servers it names get it too.
        """
        servers = self._servers(account)
        principal = ""
        for start in (account["url"], urllib.parse.urljoin(account["url"], "/.well-known/caldav")):
            try:
                found = self._propfind(account, start, ["d:current-user-principal"], 0)
            except CaldavNotFound:
                continue
            for _href, props in found:
                principal = _href_in(props, "d", "current-user-principal", start)
                if principal:
                    break
            if principal:
                break
        if not principal:
            raise CaldavError("%s did not name a CalDAV principal" % redact(account["url"]))
        servers.add(_origin(principal))

        home = inbox = ""
        for _href, props in self._propfind(
            account, principal, ["c:calendar-home-set", "c:schedule-inbox-URL"], 0
        ):
            home = home or _href_in(props, "c", "calendar-home-set", principal)
            inbox = inbox or _href_in(props, "c", "schedule-inbox-URL", principal)
        if not home:
            raise CaldavError("%s has no calendar home" % redact(principal))
        servers.update(_origin(url) for url in (home, inbox) if url)

        default = ""
        if inbox:
            try:
                for _href, props in self._propfind(account, inbox, ["c:schedule-default-calendar-URL"], 0):
                    default = default or _href_in(props, "c", "schedule-default-calendar-URL", inbox)
            except CaldavError:
                # Optional: without it no calendar is primary.
                default = ""

        listing = self._propfind(
            account, home,
            ["d:resourcetype", "d:displayname", "a:calendar-color",
             "c:supported-calendar-component-set", "d:current-user-privilege-set"],
            1,
        )
        calendars = []
        for href, props in listing:
            calendar = collection_to_calendar(href, props, len(calendars))
            if calendar is None:
                continue
            calendar["primary"] = bool(default) and _same_collection(href, default)
            servers.add(_origin(href))
            calendars.append(calendar)
        return calendars

    def _query(self, calendar_id, vevent_filter):
        """[(href, etag, parsed calendar)] for the resources that match."""
        icalendar, _rie = _load_libs()
        _status, _headers, body, final = self._request(
            calendar_id, "REPORT", calendar_id, body=_query_body(vevent_filter),
            headers={"Depth": "1", "Content-Type": "application/xml; charset=utf-8"},
            expect=(207,),
        )
        resources = []
        for href, props in parse_multistatus(body, final):
            data = props.get(_tag("c", "calendar-data"))
            if data is None or not (data.text or "").strip():
                continue
            etag = props.get(_tag("d", "getetag"))
            try:
                parsed = icalendar.Calendar.from_ical(data.text)
            except ValueError as error:
                print("skipping %s: %s" % (redact(href), error))
                continue
            resources.append((href, (etag.text or "").strip() if etag is not None else "", parsed))
        return resources

    def _find(self, calendar_id, uid):
        """(href, etag, parsed calendar) of the resource holding `uid`.

        Apple devices and this backend name a resource after its UID, so
        that is tried first. iCloud refuses a UID filter (HTTP 412), so
        when the name misses and the filter is refused, the whole calendar
        is read: slower, never wrong.
        """
        icalendar, _rie = _load_libs()
        href = urllib.parse.urljoin(calendar_id, urllib.parse.quote(uid, safe="") + ".ics")
        try:
            _status, headers, body, _final = self._request(calendar_id, "GET", href, expect=(200,))
            calendar = icalendar.Calendar.from_ical(body)
            if any(str(component.get("UID")) == uid for component in _events_of(calendar)):
                return href, _header(headers, "ETag"), calendar
        except CaldavAuthError:
            raise
        except (CaldavError, ValueError):
            # Not there, or not iCalendar at that name: look it up instead.
            pass

        match = (
            '<c:prop-filter name="UID"><c:text-match collation="i;octet">%s'
            "</c:text-match></c:prop-filter>" % escape(uid)
        )
        try:
            resources = self._query(calendar_id, match)
        except (CaldavAuthError, CaldavNotFound):
            raise
        except CaldavError:
            resources = self._query(calendar_id, "")
        for href, etag, calendar in resources:
            if any(str(component.get("UID")) == uid for component in _events_of(calendar)):
                return href, etag, calendar
        raise CaldavNotFound("event %s is not on the server" % uid)

    def _put(self, calendar_id, href, calendar, etag="", create=False):
        calendar.add_missing_timezones()
        headers = {"Content-Type": "text/calendar; charset=utf-8"}
        # A new event must not land on an existing one, and an edit must not
        # land on a version it never read.
        headers.update({"If-None-Match": "*"} if create else _if_match(etag))
        self._request(calendar_id, "PUT", href, body=calendar.to_ical(), headers=headers,
                      expect=(200, 201, 204))


def _may_send_password(url, servers):
    """Only to one of the account's servers, exactly, so a redirect cannot
    carry the password elsewhere, and only over https. Plain http only to
    this machine."""
    origin = _origin(url)
    if origin is None or origin not in servers:
        return False
    scheme, host, _port = origin
    return scheme == "https" or host in ("localhost", "127.0.0.1", "::1")


def _if_match(etag):
    return {"If-Match": etag} if etag else {}


def _same_collection(a, b):
    def path(url):
        return urllib.parse.unquote(urllib.parse.urlsplit(url).path).rstrip("/")
    return path(a) == path(b)
