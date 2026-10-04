"""Turn Google Calendar event resources into contract rows.

Pure functions only. No I/O, no subprocess, no clock reads. Everything this
module needs is passed in, which is what makes the timezone behaviour
testable without freezing time.
"""

import re
from datetime import date, datetime, time, timedelta

from .contract import is_https_url
from .plaintext import description_text

NO_TITLE = "(no title)"


def _https_only(value):
    """The URL if the widget may launch it, else blank.

    Links come from whoever sent the invitation, not from the user, so
    anything else is dropped rather than handed to the widget.
    """
    text = str(value or "").strip()
    return text if is_https_url(text) else ""


# Video links written into an event's text rather than attached as a
# conference: an invitation forwarded by email, or pasted by hand. Free text
# can link anywhere, so only known meeting hosts become a Join button.
_URL_TAIL = r"[^\s\"'<>)\]\\]+"
_TEXT_MEETING_URL = re.compile(
    r"https://(?:"
    r"meet\.google\.com/[a-z]{3,4}-[a-z]{4}-[a-z]{3,4}"
    r"|(?:[\w-]+\.)*zoom\.us/(?:j|my|w)/" + _URL_TAIL +
    r"|teams\.microsoft\.com/l/meetup-join/" + _URL_TAIL +
    r"|teams\.live\.com/meet/" + _URL_TAIL +
    r"|(?:[\w-]+\.)*webex\.com/" + _URL_TAIL +
    r"|meet\.jit\.si/" + _URL_TAIL +
    r"|whereby\.com/" + _URL_TAIL +
    r")",
    re.IGNORECASE,
)


def _meeting_url_in_text(*texts):
    for text in texts:
        match = _TEXT_MEETING_URL.search(str(text or ""))
        if match:
            found = _https_only(match.group(0).rstrip(".,;:!?"))
            if found:
                return found
    return ""


def _meeting_url(gevent):
    """The video link for an event, preferring the one Google resolves itself."""
    direct = _https_only(gevent.get("hangoutLink"))
    if direct:
        return direct

    conference = gevent.get("conferenceData") or {}
    for entry in conference.get("entryPoints") or []:
        if entry.get("entryPointType") == "video":
            found = _https_only(entry.get("uri"))
            if found:
                return found

    # Location first: it is where people paste the link on purpose, while a
    # description may also mention some other meeting.
    return _meeting_url_in_text(gevent.get("location"), gevent.get("description"))


def _response_status(gevent):
    """The user's own answer to the invitation, blank when not invited.

    Google marks the user's own row in `attendees` with self: true. An event
    the user created alone has no attendees at all.
    """
    for attendee in gevent.get("attendees") or []:
        if attendee.get("self"):
            return str(attendee.get("responseStatus") or "")
    return ""


def _popup_minutes(entries):
    """Sorted unique minutes-before-start of the popup entries in `entries`.

    Email reminders are left out: the widget can only raise a notification.
    """
    minutes = set()
    for entry in entries or []:
        if entry.get("method") != "popup":
            continue
        value = entry.get("minutes")
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            minutes.add(value)
    return sorted(minutes)


def _reminders(gevent, calendar):
    """Minutes before the start at which the user wants a popup.

    An event that follows its calendar's defaults says only useDefault; the
    defaults themselves live on the calendar, so the backend hands them over
    as the calendar's defaultReminders.
    """
    settings = gevent.get("reminders") or {}
    if settings.get("useDefault"):
        return _popup_minutes(calendar.get("defaultReminders"))
    return _popup_minutes(settings.get("overrides"))


def row_order(row):
    """Sort key for contract rows: by day, then start, then title."""
    return (row["dateKey"], row["start"], row["title"])


def normalize_all(gevents, calendar, tz):
    """Normalize a list of Google events, flattening the per-day rows."""
    rows = []
    for gevent in gevents:
        rows.extend(normalize_event(gevent, calendar, tz))
    return rows


def normalize_event(gevent, calendar, tz):
    """Return one contract row per local day this event covers.

    Rows produced from a single Google event share its id, so consumers must
    key on id plus dateKey, never on id alone.
    """
    if gevent.get("status") == "cancelled":
        return []

    start_node = gevent.get("start") or {}
    if not start_node:
        return []

    end_node = gevent.get("end") or start_node

    try:
        start_dt, all_day = _parse_endpoint(start_node, tz)
        end_dt, _ = _parse_endpoint(end_node, tz)
    except (KeyError, ValueError, TypeError):
        return []

    # A zero-length timed event (end == start) is a legal marker; one that
    # ends before it begins is not. An all-day end that is not after its
    # start is kept, though: the API does return one-day markers that way,
    # and Google Calendar shows them, so _covered_days gives them their day.
    if not all_day and end_dt < start_dt:
        return []

    title = (gevent.get("summary") or "").strip() or NO_TITLE
    location = gevent.get("location") or ""
    start_iso = start_dt.isoformat()
    end_iso = end_dt.isoformat()

    meeting_url = _meeting_url(gevent)
    event_url = _https_only(gevent.get("htmlLink"))
    event_type = str(gevent.get("eventType") or "")
    response_status = _response_status(gevent)
    description = description_text(gevent.get("description"))
    reminders = _reminders(gevent, calendar)

    return [
        {
            "id": gevent.get("id", ""),
            "calendarId": calendar["id"],
            "calendarName": calendar["name"],
            "color": calendar["color"],
            "dateKey": day.isoformat(),
            "start": start_iso,
            "end": end_iso,
            "allDay": all_day,
            "title": title,
            "location": location,
            "meetingUrl": meeting_url,
            "eventUrl": event_url,
            "eventType": event_type,
            "responseStatus": response_status,
            "description": description,
            "reminders": reminders,
        }
        for day in _covered_days(start_dt, end_dt, all_day)
    ]


def _parse_endpoint(node, tz):
    """Return (aware datetime in tz, is_all_day) for a Google start/end node."""
    if "date" in node:
        parsed = date.fromisoformat(node["date"])
        return datetime(parsed.year, parsed.month, parsed.day, tzinfo=tz), True
    parsed_dt = datetime.fromisoformat(node["dateTime"])
    if parsed_dt.tzinfo is None:
        # A naive dateTime has no offset. Guessing the system timezone
        # would make output depend on the machine running this code, so
        # treat it as unusable instead.
        raise ValueError("dateTime has no timezone offset")
    return parsed_dt.astimezone(tz), False


def _covered_days(start_dt, end_dt, all_day):
    """Inclusive list of local dates the event occupies."""
    first = start_dt.date()

    if all_day:
        # Google's all-day end.date is exclusive.
        last = end_dt.date() - timedelta(days=1)
    else:
        last = end_dt.date()
        # Ending exactly at midnight means the event never occupied that day.
        if end_dt.timetz().replace(tzinfo=None) == time(0, 0) and last > first:
            last -= timedelta(days=1)

    if last < first:
        last = first

    days = []
    cursor = first
    while cursor <= last:
        days.append(cursor)
        cursor += timedelta(days=1)
    return days
