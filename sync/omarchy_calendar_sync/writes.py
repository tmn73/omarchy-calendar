"""The rules for one request from the panel, and the rows that replace an
event's old rows in the events file.

Pure functions only, so every rule is testable without gws or a file. The
event body itself is built in event_form.
"""

from . import normalize

ACTIONS = ("get", "create", "update", "delete")
SCOPES = ("this", "all")
SEND_UPDATES = ("all", "none")


class WriteRequestError(ValueError):
    """The request cannot be sent as it is. The message is for a person."""


def parse_request(raw, writable_ids):
    """Check the request the panel sent, and return it in one flat shape.

    create and update carry the form in "event"; get and delete carry the
    ids at the top. The result always has action, calendarId, eventId,
    recurringEventId, scope, sendUpdates and event.
    """
    if not isinstance(raw, dict):
        raise WriteRequestError("The request must be a JSON object.")
    action = raw.get("action")
    if action not in ACTIONS:
        raise WriteRequestError(f"Unknown action {action!r}.")

    event = raw.get("event") if action in ("create", "update") else None
    if action in ("create", "update") and not isinstance(event, dict):
        raise WriteRequestError("The event is missing.")
    ids = event if event is not None else raw

    scope = raw.get("scope") or "this"
    if scope not in SCOPES:
        raise WriteRequestError(f"Unknown scope {scope!r}.")
    send_updates = raw.get("sendUpdates") or "none"
    if send_updates not in SEND_UPDATES:
        raise WriteRequestError(f"Unknown sendUpdates {send_updates!r}.")

    request = {
        "action": action,
        "calendarId": ids.get("calendarId"),
        "eventId": ids.get("eventId") or "",
        "recurringEventId": ids.get("recurringEventId") or "",
        "scope": scope,
        "sendUpdates": send_updates,
        "event": event,
    }
    if request["calendarId"] not in writable_ids:
        raise WriteRequestError("The panel cannot edit this calendar.")
    if action != "create" and not request["eventId"]:
        raise WriteRequestError("The event id is missing.")
    if scope == "all" and not request["recurringEventId"]:
        raise WriteRequestError("This event is not part of a series.")
    return request


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
