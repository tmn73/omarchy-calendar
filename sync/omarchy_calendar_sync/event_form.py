"""The event form the panel edits, and Google's event resource, both ways.

The form shape is the spec's: one flat JSON object with local dates and
times. Pure functions only, so every mapping is testable without gws.
"""

import calendar
import uuid
from datetime import date, datetime, timedelta

from .writes import WriteRequestError

WEEKDAYS = ("MO", "TU", "WE", "TH", "FR", "SA", "SU")
PRESETS = ("none", "daily", "weekly", "monthly", "yearly", "weekdays")

# Google's defaults for an event that does not set them.
GUEST_PERMISSION_DEFAULTS = {
    "guestsCanModify": False,
    "guestsCanInviteOthers": True,
    "guestsCanSeeOtherGuests": True,
}


def repeat_rule(preset, start):
    """The RRULE lines for a repeat preset that starts on `start`."""
    if preset == "none":
        return []
    if preset == "daily":
        return ["RRULE:FREQ=DAILY"]
    if preset == "weekly":
        return [f"RRULE:FREQ=WEEKLY;BYDAY={WEEKDAYS[start.weekday()]}"]
    if preset == "monthly":
        return [f"RRULE:FREQ=MONTHLY;BYDAY={nth_weekday(start)}{WEEKDAYS[start.weekday()]}"]
    if preset == "yearly":
        return ["RRULE:FREQ=YEARLY"]
    if preset == "weekdays":
        return ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"]
    raise WriteRequestError(f"Unknown repeat {preset!r}.")


def nth_weekday(day):
    """Which weekday of its month `day` is: 1 to 4, or -1 for the last one.

    A date in the last 7 days of its month is the last of its weekday, and
    "the last Saturday" is what a person means there, like Google offers.
    """
    days_in_month = calendar.monthrange(day.year, day.month)[1]
    if day.day + 7 > days_in_month:
        return -1
    return (day.day - 1) // 7 + 1


def repeat_preset(rrule, start):
    """The preset a rule matches for its start date, or "custom"."""
    lines = list(rrule or [])
    if not lines:
        return "none"
    for preset in PRESETS[1:]:
        if lines == repeat_rule(preset, start):
            return preset
    return "custom"


def form_to_body(form, tz, had_meet=False, had_rule=False, had_color=False, rule_start=None):
    """Google's event body for the form.

    `had_meet`, `had_rule` and `had_color` say what the event had before
    the edit, so a removed repeat or colour is sent as a removal, and an
    untouched one is not sent at all. `rule_start` is the date a repeat
    preset is built from: the series' first date for "All events", the
    form's start date otherwise.
    """
    start_day = _day(form.get("startDate"), "start")
    end_day = _day(form.get("endDate") or form.get("startDate"), "end")

    body = {
        "summary": str(form.get("title") or ""),
        "location": str(form.get("location") or ""),
        "description": str(form.get("description") or ""),
    }

    if form.get("allDay"):
        if end_day < start_day:
            raise WriteRequestError("The end date must be on or after the start date.")
        body["start"] = {"date": start_day.isoformat()}
        # Google's all-day end is exclusive; the form shows the last day.
        body["end"] = {"date": (end_day + timedelta(days=1)).isoformat()}
    else:
        start = _at(start_day, form.get("startTime"), tz, "start")
        end = _at(end_day, form.get("endTime"), tz, "end")
        if end <= start and end_day == start_day and str(form.get("endTime")) == "00:00":
            # "23:00 to 00:00" means until midnight, which is the next day.
            end = end + timedelta(days=1)
        if end <= start:
            raise WriteRequestError("The end must be after the start.")
        body["start"] = _timed_node(start, tz)
        body["end"] = _timed_node(end, tz)

    body["attendees"] = [_attendee(guest) for guest in form.get("guests") or []]

    if form.get("meet") and not had_meet:
        body["conferenceData"] = {
            "createRequest": {
                "requestId": uuid.uuid4().hex,
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        }
    # A removed Meet is not in the body: a patch cannot remove one (gws
    # refuses null, and Google ignores {}), so the event command replaces
    # the whole event instead. See event_cli._write.

    preset = form.get("repeat") or "none"
    if preset == "custom":
        body["recurrence"] = list(form.get("rrule") or [])
    elif preset != "none":
        body["recurrence"] = repeat_rule(preset, rule_start or start_day)
    elif had_rule:
        body["recurrence"] = []

    reminders = form.get("reminders") or {"useDefault": True}
    if reminders.get("useDefault", True):
        body["reminders"] = {"useDefault": True}
    else:
        body["reminders"] = {
            "useDefault": False,
            "overrides": [
                {"method": str(o.get("method") or "popup"), "minutes": int(o.get("minutes") or 0)}
                for o in reminders.get("overrides") or []
            ],
        }

    body["transparency"] = "opaque" if form.get("busy", True) else "transparent"
    body["visibility"] = str(form.get("visibility") or "default")
    # gws refuses a null colorId, so no colour sends no key, and removing a
    # colour the event had sends "" (verified with --dry-run on gws 0.13.2).
    if form.get("colorId"):
        body["colorId"] = str(form["colorId"])
    elif had_color:
        body["colorId"] = ""
    for key, fallback in GUEST_PERMISSION_DEFAULTS.items():
        body[key] = bool(form.get(key, fallback))
    return body


def resource_to_form(resource, calendar_id, tz, master=None):
    """The form for Google's event resource.

    For an occurrence of a series, pass the series' master: the repeat rule
    lives only there.
    """
    start_node = resource.get("start") or {}
    end_node = resource.get("end") or {}
    all_day = "date" in start_node

    if all_day:
        start_day = date.fromisoformat(start_node["date"])
        end_exclusive = date.fromisoformat(end_node.get("date") or start_node["date"])
        end_day = max(start_day, end_exclusive - timedelta(days=1))
        start_time = end_time = ""
    else:
        start = _local(start_node["dateTime"], tz)
        end = _local(end_node.get("dateTime") or start_node["dateTime"], tz)
        start_day, end_day = start.date(), end.date()
        start_time, end_time = start.strftime("%H:%M"), end.strftime("%H:%M")

    rule_source = master if master else resource
    rrule = list(rule_source.get("recurrence") or [])

    conference = resource.get("conferenceData") or {}
    solution = (conference.get("conferenceSolution") or {}).get("key") or {}
    meet_url = resource.get("hangoutLink") or ""
    for entry in conference.get("entryPoints") or []:
        if not meet_url and entry.get("entryPointType") == "video":
            meet_url = entry.get("uri") or ""

    reminders = resource.get("reminders") or {"useDefault": True}

    form = {
        "calendarId": calendar_id,
        "eventId": resource.get("id", ""),
        "recurringEventId": resource.get("recurringEventId", ""),
        "title": resource.get("summary") or "",
        "allDay": all_day,
        "startDate": start_day.isoformat(),
        "startTime": start_time,
        "endDate": end_day.isoformat(),
        "endTime": end_time,
        "location": resource.get("location") or "",
        "description": resource.get("description") or "",
        "guests": [
            {
                "email": attendee.get("email", ""),
                "optional": bool(attendee.get("optional")),
                "responseStatus": attendee.get("responseStatus", "needsAction"),
                "organizer": bool(attendee.get("organizer")),
            }
            for attendee in resource.get("attendees") or []
            # Rooms are attendees too, and the form has no rooms.
            if not attendee.get("resource")
        ],
        "meet": solution.get("type") == "hangoutsMeet" or bool(resource.get("hangoutLink")),
        "meetUrl": meet_url,
        "repeat": repeat_preset(rrule, _start_day(rule_source, tz)),
        "rrule": rrule,
        "reminders": {
            "useDefault": bool(reminders.get("useDefault", True)),
            "overrides": list(reminders.get("overrides") or []),
        },
        "busy": resource.get("transparency") != "transparent",
        "visibility": resource.get("visibility") or "default",
        "colorId": resource.get("colorId") or "",
    }
    for key, fallback in GUEST_PERMISSION_DEFAULTS.items():
        form[key] = bool(resource.get(key, fallback))
    return form


def onto_series(body, master, tz):
    """The body moved onto the series' first date, keeping times and length.

    "All events" edits the series, and the series starts on the master's
    date, not on the occurrence the user clicked.
    """
    first_day = _start_day(master, tz)
    if "date" in body["start"]:
        start = date.fromisoformat(body["start"]["date"])
        end = date.fromisoformat(body["end"]["date"])
        shift = first_day - start
        return {**body, "start": {"date": (start + shift).isoformat()},
                "end": {"date": (end + shift).isoformat()}}

    start = _local(body["start"]["dateTime"], tz)
    end = _local(body["end"]["dateTime"], tz)
    moved_start = datetime.combine(first_day, start.time(), tzinfo=tz)
    moved_end = moved_start + (end - start)
    return {**body, "start": {**body["start"], "dateTime": moved_start.isoformat()},
            "end": {**body["end"], "dateTime": moved_end.isoformat()}}


def merge_attendees(people, current):
    """The form's guests, with what the form cannot show put back.

    A patch replaces the whole attendees list. The form shows people only,
    so without this an edit would release the event's rooms, and drop a
    guest's display name, comment or extra guests. A guest removed in the
    form stays removed.
    """
    by_email = {str(a.get("email") or "").lower(): a for a in current or []}
    merged = []
    for person in people:
        email = str(person.get("email") or "").lower()
        merged.append({**by_email.get(email, {}), **person})
    for attendee in current or []:
        if attendee.get("resource"):
            merged.append(attendee)
    return merged


def changed_only(body, current, tz):
    """The body without the fields whose value the event already has.

    Google refuses a patch that carries shared properties (title, times,
    guests, guest permissions) from anyone but the organizer, even with
    unchanged values. So an edit of an invitation's colour or reminder has
    to carry that colour or reminder, and nothing else.
    """
    return {key: value for key, value in body.items() if not _same(key, value, current, tz)}


def _attendee(guest):
    attendee = {
        "email": str(guest.get("email") or "").strip().lower(),
        "optional": bool(guest.get("optional")),
    }
    if guest.get("responseStatus"):
        # Sent back so an edit does not reset the guest's answer.
        attendee["responseStatus"] = guest["responseStatus"]
    return attendee


def start_day(resource, tz):
    """The local date an event (or a series' master) starts on."""
    return _start_day(resource, tz)


def _timed_node(moment, tz):
    # Google needs the zone name on a repeating event, and the offset alone
    # cannot say when daylight saving moves the later occurrences. A fixed
    # offset (resolve_local_timezone's fallback) has no name to send.
    node = {"dateTime": moment.isoformat()}
    if getattr(tz, "key", None):
        node["timeZone"] = tz.key
    return node


def _same(key, value, current, tz):
    if key in ("start", "end"):
        return _same_time(value, current.get(key) or {}, tz)
    if key == "attendees":
        return _guest_key(value) == _guest_key(current.get("attendees") or [])
    if key == "reminders":
        return _reminders_key(value) == _reminders_key(current.get("reminders") or {"useDefault": True})
    if key == "recurrence":
        return list(value or []) == list(current.get("recurrence") or [])
    if key == "transparency":
        return value == (current.get("transparency") or "opaque")
    if key == "visibility":
        return value == (current.get("visibility") or "default")
    if key == "colorId":
        return (value or "") == (current.get("colorId") or "")
    if key in GUEST_PERMISSION_DEFAULTS:
        return bool(value) == bool(current.get(key, GUEST_PERMISSION_DEFAULTS[key]))
    if key == "conferenceData":
        # Only ever sent to add a Meet, which is always a change.
        return False
    return (value or "") == (current.get(key) or "")


def _same_time(node, current_node, tz):
    if ("date" in node) != ("date" in current_node):
        return False
    if "date" in node:
        return node["date"] == current_node["date"]
    try:
        return _local(node["dateTime"], tz) == _local(current_node["dateTime"], tz)
    except (KeyError, ValueError):
        return False


def _guest_key(attendees):
    return sorted((str(a.get("email") or "").lower(), bool(a.get("optional"))) for a in attendees or [])


def _reminders_key(reminders):
    if reminders.get("useDefault", True):
        return (True, ())
    return (False, tuple(sorted((o.get("method"), int(o.get("minutes") or 0))
                                for o in reminders.get("overrides") or [])))


def _start_day(resource, tz):
    node = resource.get("start") or {}
    if "date" in node:
        return date.fromisoformat(node["date"])
    if "dateTime" in node:
        return _local(node["dateTime"], tz).date()
    return date.today()


def _local(text, tz):
    return datetime.fromisoformat(text).astimezone(tz)


def _day(text, name):
    try:
        return datetime.strptime(str(text or ""), "%Y-%m-%d").date()
    except ValueError:
        raise WriteRequestError(f"The {name} date must look like YYYY-MM-DD.") from None


def _at(day, text, tz, name):
    try:
        clock = datetime.strptime(str(text or ""), "%H:%M").time()
    except ValueError:
        raise WriteRequestError(f"The {name} time must look like HH:MM.") from None
    return datetime.combine(day, clock, tzinfo=tz)
