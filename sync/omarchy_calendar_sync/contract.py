"""The file contract between the sync and the widget.

This module is the single source of truth for the shape of
~/.local/state/omarchy/calendar-events.json. Both the writer and the tests
import it, so the schema can never drift between them.
"""

import re
from pathlib import Path

CONTRACT_VERSION = 1
CONTRACT_PATH = Path.home() / ".local" / "state" / "omarchy" / "calendar-events.json"

EVENT_FIELDS = (
    "id",
    "calendarId",
    "calendarName",
    "color",
    "dateKey",
    "start",
    "end",
    "allDay",
    "title",
    "location",
)

# Deliberately optional. The README promises that anything able to write this
# file works, so khal, vdirsyncer and hand-rolled scripts are consumers of this
# schema. Making a new field required would break every one of them on upgrade.
# Validated for type when present, never demanded.
OPTIONAL_EVENT_FIELDS = (
    "meetingUrl",
    "eventUrl",
    "eventType",
    "responseStatus",
)

_DATE_KEY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

# https only. Meeting links arrive from whoever sent the invitation, so the
# widget must never be handed a scheme it would be unwise to launch.
# Kept in step with normalize._https_only and Model.safeUrl.
_HTTPS_URL = re.compile(r"^https://[^\s\"'<>]+$")


def build_document(events, synced_at, source):
    """Assemble a contract document from already normalized event rows."""
    return {
        "version": CONTRACT_VERSION,
        "syncedAt": synced_at,
        "source": source,
        "events": events,
    }


def validate(doc):
    """Return a list of human readable problems. An empty list means valid."""
    problems = []

    if not isinstance(doc, dict):
        return ["document is not an object"]

    if doc.get("version") != CONTRACT_VERSION:
        problems.append(
            f"version must be {CONTRACT_VERSION}, got {doc.get('version')!r}"
        )

    for key in ("syncedAt", "source"):
        if not isinstance(doc.get(key), str) or not doc.get(key):
            problems.append(f"{key} must be a non-empty string")

    events = doc.get("events")
    if not isinstance(events, list):
        problems.append("events must be a list")
        return problems

    for index, event in enumerate(events):
        problems.extend(_validate_event(index, event))

    return problems


def _validate_event(index, event):
    where = f"events[{index}]"
    if not isinstance(event, dict):
        return [f"{where} is not an object"]

    problems = []
    for field in EVENT_FIELDS:
        if field not in event:
            problems.append(f"{where}.{field} is missing")

    if not isinstance(event.get("allDay"), bool):
        problems.append(f"{where}.allDay must be a boolean")

    date_key = event.get("dateKey")
    if not isinstance(date_key, str) or not _DATE_KEY.match(date_key):
        problems.append(f"{where}.dateKey must look like YYYY-MM-DD")

    color = event.get("color")
    if not isinstance(color, str) or not _COLOR.match(color):
        problems.append(f"{where}.color must look like #rrggbb")

    for field in ("id", "calendarId", "calendarName", "start", "end", "title"):
        if field in event and not isinstance(event[field], str):
            problems.append(f"{where}.{field} must be a string")

    for field in OPTIONAL_EVENT_FIELDS:
        if field in event and not isinstance(event[field], str):
            problems.append(f"{where}.{field} must be a string when present")

    for field in ("meetingUrl", "eventUrl"):
        value = event.get(field)
        if isinstance(value, str) and value and not _HTTPS_URL.match(value):
            problems.append(f"{where}.{field} must be an https URL")

    return problems
