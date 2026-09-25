"""The rules for one write from the panel: the request, Google's body, and
the rows that replace the old ones in the events file.

Pure functions only, so every rule is testable without gws or a file.
"""

from datetime import datetime, timedelta

from . import normalize

ACTIONS = ("create", "update", "delete")


class WriteRequestError(ValueError):
    """The request cannot be sent as it is. The message is for a person."""


def parse_request(raw, writable_ids):
    """Check the request the panel sent, and return it."""
    if not isinstance(raw, dict):
        raise WriteRequestError("The request must be a JSON object.")
    action = raw.get("action")
    if action not in ACTIONS:
        raise WriteRequestError(f"Unknown action {action!r}.")
    if raw.get("calendarId") not in writable_ids:
        raise WriteRequestError("You cannot write to this calendar.")
    if action in ("update", "delete") and not raw.get("eventId"):
        raise WriteRequestError("The event id is missing.")
    return raw


def build_body(request, tz):
    """Google's event body for a create or an update.

    Only the form's fields, so a patch leaves everything else untouched.
    """
    day = _day(request.get("dateKey"))
    body = {
        "summary": str(request.get("title") or ""),
        "location": str(request.get("location") or ""),
    }

    if request.get("allDay"):
        body["start"] = {"date": day.isoformat()}
        # Google's all-day end date is exclusive: a one-day event ends the
        # day after it starts.
        body["end"] = {"date": (day + timedelta(days=1)).isoformat()}
        return body

    start = _at(day, request.get("start"), tz, "start")
    end = _at(day, request.get("end"), tz, "end")
    if end <= start and str(request.get("end")) == "00:00":
        # "23:00 to 00:00" means until midnight, which is the next day.
        end = end + timedelta(days=1)
    if end <= start:
        raise WriteRequestError("The end must be after the start.")

    # combine() with a ZoneInfo gives the offset of the event's own date,
    # so an event across a daylight saving change keeps the right hour.
    body["start"] = {"dateTime": start.isoformat()}
    body["end"] = {"dateTime": end.isoformat()}
    return body


def splice(doc, calendar, event_id, resource, tz):
    """Replace one event's rows in the document.

    `resource` is Google's reply to a create or an update, or None for a
    delete. Rows match on calendarId and id: every row of a multi-day event
    shares its id, and each occurrence of a series has an id of its own.
    """
    kept = [
        row for row in doc.get("events", [])
        if not (row.get("calendarId") == calendar["id"] and row.get("id") == event_id)
    ]
    if resource is not None:
        kept.extend(normalize.normalize_event(resource, calendar, tz))
    kept.sort(key=lambda row: (row["dateKey"], row["start"], row["title"]))
    return {**doc, "events": kept}


def _day(text):
    try:
        return datetime.strptime(str(text or ""), "%Y-%m-%d").date()
    except ValueError:
        raise WriteRequestError("The date must look like YYYY-MM-DD.") from None


def _at(day, text, tz, name):
    try:
        clock = datetime.strptime(str(text or ""), "%H:%M").time()
    except ValueError:
        raise WriteRequestError(f"The {name} time must look like HH:MM.") from None
    return datetime.combine(day, clock, tzinfo=tz)
