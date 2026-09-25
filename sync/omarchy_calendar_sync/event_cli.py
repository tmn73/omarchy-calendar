"""The one command the panel runs to read or change an event.

In: one JSON argument (see writes.parse_request and the event form in
event_form). Out: one JSON line on stdout, and exit 0 or 1:
{"ok": true, "event": {...}} for get, {"ok": true, "eventId": ...} for a
write, {"ok": false, "error": ...} on failure. The panel shows the error
as it is, so every message is written for a person.
"""

import contextlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import config as config_module
from . import cli, contract, event_form, writes
from .errors import SyncError
from .gws import GwsAuthError, GwsNotFound

SYNC_UNIT = "omarchy-calendar-sync.service"

WRITE_OFF = "Writing is turned off. Run sync/setup --write."
NOT_WRITABLE = "This backend cannot write events."
NO_SCOPE = "Write access not granted. Run sync/setup --write."
EXPIRED = "Your Google sign-in expired. Run sync/setup again."
GONE = "This event no longer exists."
NO_FILE = "No calendar synced yet. Wait for the first sync, then try again."


def start_background_sync():
    # --no-block: the panel waits for this command, not for a 10 s sync.
    subprocess.run(
        ["systemctl", "--user", "start", "--no-block", SYNC_UNIT],
        check=False,
        capture_output=True,
    )


def perform(raw, cfg, client, doc_path, tz, start_sync=start_background_sync, sync_now=None):
    """Run one request. Returns (exit code, reply).

    start_sync starts a sync in the background. sync_now runs one inline,
    for the writes a splice cannot express: anything that touches a series.
    """
    if not cfg.get("write"):
        return 1, _fail(WRITE_OFF)
    if not getattr(client, "can_write", False):
        return 1, _fail(NOT_WRITABLE)

    doc = _read_doc(doc_path)
    if doc is None:
        return 1, _fail(NO_FILE)
    writable = doc.get("writableCalendars") or []

    try:
        request = writes.parse_request(raw, [c.get("id") for c in writable])
        calendar = next(c for c in writable if c.get("id") == request["calendarId"])
        if request["action"] == "get":
            return 0, {"ok": True, "event": _get(client, request, tz)}
        event_id, resource, series = _write(client, request, tz)
    except writes.WriteRequestError as error:
        return 1, _fail(str(error))
    except GwsNotFound:
        # The file still shows the event. The sync takes the row away.
        start_sync()
        return 1, _fail(GONE)
    except GwsAuthError as error:
        return 1, _fail(NO_SCOPE if str(error).startswith("403") else EXPIRED)
    except SyncError as error:
        return 1, _fail(str(error))

    if series and sync_now is not None:
        sync_now()
        return 0, {"ok": True, "eventId": event_id}

    try:
        spliced = writes.splice(doc, calendar, event_id, resource, tz)
        if not contract.validate(spliced):
            cli.write_atomic(Path(doc_path), spliced)
    except (KeyError, TypeError, ValueError, OSError):
        # Google has the change. The background sync below writes the file.
        pass

    start_sync()
    return 0, {"ok": True, "eventId": event_id}


def _get(client, request, tz):
    resource = client.get(request["calendarId"], request["eventId"])
    master = None
    if resource.get("recurringEventId"):
        # The repeat rule lives only on the series' master.
        master = client.get(request["calendarId"], resource["recurringEventId"])
    return event_form.resource_to_form(resource, request["calendarId"], tz, master)


def _write(client, request, tz):
    """Send one create, update or delete. Returns (eventId, reply, series).

    `series` is True when the write touched a series, so the caller runs a
    full sync instead of a splice.
    """
    calendar_id = request["calendarId"]
    send_updates = request["sendUpdates"]
    all_events = request["scope"] == "all"

    if request["action"] == "delete":
        target = request["recurringEventId"] if all_events else request["eventId"]
        client.delete(calendar_id, target, send_updates=send_updates)
        return target, None, all_events

    form = request["event"]
    if request["action"] == "create":
        body = event_form.form_to_body(form, tz)
        resource = client.create(calendar_id, body, send_updates=send_updates)
        return resource.get("id", ""), resource, bool(resource.get("recurrence"))

    # An update reads the event first: what it had decides whether a removed
    # Meet, repeat or colour has to be sent as a removal.
    target = request["recurringEventId"] if all_events else request["eventId"]
    current = client.get(calendar_id, target)
    had_meet = event_form.resource_to_form(current, calendar_id, tz)["meet"]
    had_rule = bool(current.get("recurrence"))
    had_color = bool(current.get("colorId"))
    body = event_form.form_to_body(form, tz, had_meet, had_rule, had_color)
    if all_events:
        body = event_form.onto_series(body, current, tz)
    elif request["recurringEventId"]:
        # One occurrence cannot carry a rule. A new repeat is a series edit,
        # and the panel sends it with scope "all".
        body.pop("recurrence", None)

    resource = client.update(calendar_id, target, body, send_updates=send_updates)
    series = all_events or had_rule or bool(resource.get("recurrence"))
    return request["eventId"] if not all_events else target, resource, series


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    try:
        raw = json.loads(args[0]) if args else None
    except json.JSONDecodeError:
        raw = None
    if not isinstance(raw, dict):
        return _emit(1, _fail("Expected one JSON object as the argument."))

    try:
        cfg = config_module.load()
        client = cli.build_client(cfg)
    except config_module.ConfigError as error:
        return _emit(1, _fail(f"Config error: {error}"))

    tz = cli.resolve_local_timezone()
    code, reply = perform(
        raw, cfg, client, contract.CONTRACT_PATH, tz,
        sync_now=lambda: _sync_inline(client, cfg, tz),
    )
    return _emit(code, reply)


def _sync_inline(client, cfg, tz):
    # The sync prints its summary on stdout, and stdout is the reply the
    # panel parses, so the summary goes to stderr.
    with contextlib.redirect_stdout(sys.stderr):
        cli.run(client, cfg, datetime.now(timezone.utc), contract.CONTRACT_PATH, tz)


def _emit(code, reply):
    print(json.dumps(reply))
    return code


def _fail(message):
    return {"ok": False, "error": message}


def _read_doc(path):
    try:
        doc = json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) else None


if __name__ == "__main__":
    sys.exit(main())
