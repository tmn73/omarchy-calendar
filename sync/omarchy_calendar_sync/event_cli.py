"""The one command the panel runs to read or change an event.

In: one JSON argument (see writes.parse_request). Out: one JSON line on
stdout, {"ok": true, "eventId": ...} or {"ok": false, "error": ...}, and
exit 0 or 1. The panel shows the error as it is, so every message is
written for a person.
"""

import json
import subprocess
import sys
from pathlib import Path

from . import config as config_module
from . import contract, writes
from .cli import build_client, resolve_local_timezone, write_atomic
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


def perform(raw, cfg, client, doc_path, tz, start_sync=start_background_sync):
    """Run one write. Returns (exit code, reply)."""
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
        action = request["action"]
        if action == "delete":
            client.delete(calendar["id"], request["eventId"])
            event_id, resource = request["eventId"], None
        else:
            body = writes.build_body(request, tz)
            if action == "create":
                resource = client.create(calendar["id"], body)
            else:
                resource = client.update(calendar["id"], request["eventId"], body)
            event_id = resource.get("id") or request.get("eventId", "")
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

    try:
        spliced = writes.splice(doc, calendar, event_id, resource, tz)
        if not contract.validate(spliced):
            write_atomic(Path(doc_path), spliced)
    except (KeyError, TypeError, ValueError, OSError):
        # Google has the change. The background sync below writes the file.
        pass

    start_sync()
    return 0, {"ok": True, "eventId": event_id}


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
        client = build_client(cfg)
    except config_module.ConfigError as error:
        return _emit(1, _fail(f"Config error: {error}"))

    code, reply = perform(raw, cfg, client, contract.CONTRACT_PATH, resolve_local_timezone())
    return _emit(code, reply)


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
