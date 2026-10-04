"""iCalendar feeds as a calendar source.

Why this exists alongside gws and eds: Google publishes every calendar at a
private iCal address (Settings > your calendar > Integrate calendar > Secret
address in iCal format). Reading that needs no Google Cloud project, no OAuth
client, no consent screen and no refresh token, just the URL. The trade is
that it is read only, and Google refreshes the feed on its own schedule, so a
change can take a while to show up.

Any other https iCal feed (Nextcloud, Outlook, Fastmail, a webcal:// link)
works the same way.

Like eds, this emits Google event resources (see resources.py) rather than
contract rows.

The icalendar imports are deliberately lazy, so the module stays importable
on a machine without python-icalendar and python-recurring-ical-events.
"""

import base64
import hashlib
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

from .errors import SyncError
from .localzone import resolve_local_timezone
from .resources import build_event

FETCH_TIMEOUT = 30
# A feed carries no colour of its own, so each one takes the next of
# Google's calendar colours, keeping two feeds apart on the grid.
FEED_COLORS = ("#4285f4", "#f6bf26", "#33b679", "#e67c73", "#8e24aa", "#f4511e", "#039be5", "#7986cb")
USER_AGENT = "omarchy-calendar-sync"


class IcsError(SyncError):
    """A feed could not be fetched or parsed."""


class IcsMissing(IcsError):
    """python-icalendar or python-recurring-ical-events is not installed."""


def _load_libs():
    try:
        import icalendar
        import recurring_ical_events

        return icalendar, recurring_ical_events
    except ImportError as error:
        raise IcsMissing(
            "%s; install python-icalendar and python-recurring-ical-events"
            % error
        ) from error


def feed_url(value):
    """The fetchable URL for a configured feed. webcal:// is https://."""
    text = str(value or "").strip()
    if text.startswith("webcal://"):
        text = "https://" + text[len("webcal://"):]
    return text


def redact(url):
    """A URL safe to log. The path of a private feed is the credential."""
    text = feed_url(url)
    scheme, _, rest = text.partition("://")
    host = rest.split("/", 1)[0]
    return "%s://%s/..." % (scheme, host) if host else "(no url)"


def feed_id(url):
    """A stable calendar id that does not leak the secret URL into the file."""
    return "ics-" + hashlib.sha256(feed_url(url).encode()).hexdigest()[:12]


SECRET_HINT = (
    "use \"Secret address in iCal format\" under Settings > the calendar > "
    "Integrate calendar; it looks like .../ical/<id>/private-<code>/basic.ics"
)


def url_problem(value):
    """Why a URL is not a usable feed, or blank when it looks fine.

    Google shows the public address and the embed link right beside the
    secret one, and both are easy to copy by mistake.
    """
    url = feed_url(value)
    if not url.startswith(("https://", "http://")):
        return "expected an https:// or webcal:// address"
    if "calendar.google.com" in url:
        if "/embed" in url:
            return "that is the embed link, a web page rather than a feed; " + SECRET_HINT
        if "/public/" in url:
            return ("that is the public address, which only works for a "
                    "calendar shared publicly; " + SECRET_HINT)
    return ""


_GOOGLE_HOSTS = ("calendar.google.com", "www.google.com")
_GOOGLE_FEED_PATH = re.compile(r"^/calendar/ical/([^/]+)/(?:private-[^/]+|public)/basic\.ics$")
_GOOGLE_UID_SUFFIX = "@google.com"


def google_calendar_id(url):
    """The Google calendar id a feed URL belongs to, or blank for other feeds."""
    parts = urllib.parse.urlsplit(feed_url(url))
    match = _GOOGLE_FEED_PATH.match(parts.path)
    if parts.hostname not in _GOOGLE_HOSTS or not match:
        return ""
    return urllib.parse.unquote(match.group(1))


def google_event_url(uid, calendar_id):
    """Google Calendar's page for an event, or blank when it cannot be built.

    The feed carries no link, but Google's own link is the event id and the
    calendar id, space separated, in unpadded base64url. The id is the UID
    minus "@google.com"; an event imported from elsewhere keeps a foreign UID
    and an id the feed never reveals. A recurring event's UID names the
    series, so every occurrence opens the series.
    """
    if not calendar_id or not uid.endswith(_GOOGLE_UID_SUFFIX):
        return ""
    event_id = uid[: -len(_GOOGLE_UID_SUFFIX)]
    eid = base64.urlsafe_b64encode(("%s %s" % (event_id, calendar_id)).encode())
    return "https://calendar.google.com/calendar/event?eid=" + eid.decode().rstrip("=")


def parse_feeds(raw):
    """Normalize the `ics` config value into a list of {url, name, color}.

    Accepts a single URL string, a list of URL strings, or a list of objects
    with `url` and optional `name` and `color`.
    """
    if isinstance(raw, (str, dict)):
        raw = [raw]
    feeds = []
    for entry in raw or []:
        if isinstance(entry, str):
            entry = {"url": entry}
        if not isinstance(entry, dict):
            continue
        url = feed_url(entry.get("url"))
        if not url:
            continue
        feeds.append(
            {
                "url": url,
                "name": str(entry.get("name") or "").strip(),
                "color": str(entry.get("color") or "").strip(),
            }
        )
    return feeds


def _http_get(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT) as response:
        return response.read()


def to_node(value, local_tz):
    """A date or datetime from icalendar as a Google start/end node.

    A floating time (no TZID, no Z) means "local time wherever you are" in
    iCalendar, so it is pinned to the local zone rather than refused.
    """
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=local_tz)
        return {"dateTime": value.isoformat()}
    if isinstance(value, date):
        return {"date": value.isoformat()}
    return None


def _text(component, name):
    value = component.get(name)
    return str(value) if value is not None else ""


def _own_partstat(component, identity):
    """The PARTSTAT of the attendee matching `identity`, or blank."""
    if not identity:
        return ""
    wanted = "mailto:%s" % identity.strip().lower()
    attendees = component.get("ATTENDEE")
    if attendees is None:
        return ""
    if not isinstance(attendees, list):
        attendees = [attendees]
    for attendee in attendees:
        if str(attendee).strip().lower() == wanted:
            return str(getattr(attendee, "params", {}).get("PARTSTAT", ""))
    return ""


def _popup_reminders(component):
    """Minutes before the start of the VALARMs that show or sound something.

    Alarms tied to the end or to an absolute time are left out: the contract
    counts back from the start. EMAIL alarms are not the widget's to raise.
    """
    minutes = set()
    for alarm in component.walk("VALARM"):
        if str(alarm.get("ACTION") or "").upper() not in ("DISPLAY", "AUDIO"):
            continue
        # getattr: a malformed TRIGGER must cost one alarm, not the whole sync.
        trigger = alarm.get("TRIGGER")
        related = getattr(trigger, "params", {}).get("RELATED", "START")
        if str(related).upper() != "START":
            continue
        offset = getattr(trigger, "dt", None)
        if isinstance(offset, timedelta) and offset <= timedelta(0):
            minutes.add(int(-offset.total_seconds()) // 60)
    return sorted(minutes)


def occurrence_to_event(component, local_tz, identity="", calendar_id=""):
    """One expanded VEVENT occurrence as a Google event resource.

    `calendar_id` is the Google calendar the feed belongs to, blank for a
    feed from anywhere else.
    """
    start = component.get("DTSTART")
    if start is None:
        return None
    start_value = start.dt

    end_value = None
    if component.get("DTEND") is not None:
        end_value = component["DTEND"].dt
    elif component.get("DURATION") is not None:
        end_value = start_value + component["DURATION"].dt
    elif isinstance(start_value, datetime):
        end_value = start_value
    else:
        # RFC 5545: an all-day event without DTEND lasts one day.
        end_value = start_value + timedelta(days=1)

    start_node = to_node(start_value, local_tz)
    end_node = to_node(end_value, local_tz)
    if start_node is None:
        return None

    uid = _text(component, "UID")
    cancelled = _text(component, "STATUS").upper() == "CANCELLED"
    return build_event(
        uid=uid,
        start_node=start_node,
        end_node=end_node,
        summary=_text(component, "SUMMARY"),
        location=_text(component, "LOCATION"),
        description=_text(component, "DESCRIPTION"),
        status="cancelled" if cancelled else "",
        conference_url=_text(component, "X-GOOGLE-CONFERENCE"),
        partstat=_own_partstat(component, identity),
        reminders=_popup_reminders(component),
        html_link=google_event_url(uid, calendar_id),
    )


class Ics:
    """A calendar client backed by one or more iCalendar URLs.

    Presents the same surface as Gws and Eds -- check, version, calendars,
    events -- so cli.run drives it without knowing which it has.
    """

    SOURCE_NAME = "ics"

    # Feeds are read only.
    can_write = False

    def __init__(self, feeds, identity="", fetch=None, local_tz=None):
        self._feeds = parse_feeds(feeds)
        self._identity = identity
        self._fetch = fetch or _http_get
        self._local_tz = local_tz if local_tz is not None else resolve_local_timezone()
        # Feed id -> (parsed calendar, Google calendar id or blank).
        self._parsed = {}

    def version(self):
        icalendar, _rie = _load_libs()
        parts = []
        for piece in str(getattr(icalendar, "__version__", "0")).split("."):
            digits = "".join(ch for ch in piece if ch.isdigit())
            parts.append(int(digits or 0))
        return tuple(parts[:3]) or (0,)

    def check(self):
        _load_libs()
        if not self._feeds:
            raise IcsError(
                "no feeds configured; add your calendar's secret iCal address "
                "under \"ics\" in ~/.config/omarchy/calendar-sync.json"
            )

    def calendars(self):
        icalendar, _rie = _load_libs()
        found = []
        failures = []
        for position, feed in enumerate(self._feeds):
            url = feed["url"]
            try:
                body = self._fetch(url)
                calendar = icalendar.Calendar.from_ical(body)
            except (urllib.error.URLError, OSError, ValueError) as error:
                # One broken feed must not sink the others.
                problem = url_problem(url)
                reason = "%s (%s)" % (error, problem) if problem else str(error)
                failures.append("%s: %s" % (redact(url), reason))
                print("skipping %s: %s" % (redact(url), reason))
                continue

            ident = feed_id(url)
            self._parsed[ident] = (calendar, google_calendar_id(url))
            found.append(
                {
                    "id": ident,
                    "name": feed["name"]
                    or _text(calendar, "X-WR-CALNAME")
                    or redact(url),
                    "color": feed["color"]
                    or _text(calendar, "X-APPLE-CALENDAR-COLOR")
                    or FEED_COLORS[position % len(FEED_COLORS)],
                }
            )

        if failures and not found:
            # Every feed failed. Writing an empty file would wipe the panel.
            raise IcsError("; ".join(failures))
        return found

    def events(self, calendar_id, time_min, time_max):
        _icalendar, rie = _load_libs()
        if calendar_id not in self._parsed:
            raise IcsError("calendar %s was never fetched" % calendar_id)
        calendar, google_id = self._parsed[calendar_id]

        start = datetime.fromisoformat(time_min)
        end = datetime.fromisoformat(time_max)
        try:
            occurrences = rie.of(calendar).between(start, end)
        except Exception as error:
            raise IcsError("cannot expand %s: %s" % (calendar_id, error))

        events = []
        for component in occurrences:
            event = occurrence_to_event(component, self._local_tz, self._identity, google_id)
            if event is not None:
                events.append(event)
        return events

    def auth_hint(self, _cfg):
        return (
            "check the feed URL in ~/.config/omarchy/calendar-sync.json; a "
            "Google secret address stops working if it is reset in Google "
            "Calendar settings"
        )
