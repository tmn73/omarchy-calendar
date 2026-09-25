import json
import tempfile
import unittest
from pathlib import Path
from zoneinfo import ZoneInfo

from omarchy_calendar_sync import event_cli
from omarchy_calendar_sync.gws import GwsAuthError, GwsNotFound

BOGOTA = ZoneInfo("America/Bogota")
ME = {"id": "me@example.com", "name": "Me", "color": "#7bd148"}
ON = {"write": True}


class FakeClient:
    can_write = True

    def __init__(self, reply=None, raises=None):
        self.reply, self.raises, self.calls = reply, raises, []

    def create(self, calendar_id, body):
        self.calls.append(("create", calendar_id, body))
        return self._answer()

    def update(self, calendar_id, event_id, body):
        self.calls.append(("update", calendar_id, event_id, body))
        return self._answer()

    def delete(self, calendar_id, event_id):
        self.calls.append(("delete", calendar_id, event_id))
        if self.raises:
            raise self.raises

    def _answer(self):
        if self.raises:
            raise self.raises
        return self.reply


def old_row(event_id="ev1"):
    return {
        "id": event_id,
        "calendarId": ME["id"],
        "calendarName": "Me",
        "color": "#7bd148",
        "dateKey": "2026-09-26",
        "start": "2026-09-26T09:00:00-05:00",
        "end": "2026-09-26T10:00:00-05:00",
        "allDay": False,
        "title": "Old",
        "location": "",
    }


def create_request(**fields):
    base = {
        "action": "create",
        "calendarId": ME["id"],
        "title": "Lunch",
        "dateKey": "2026-09-26",
        "allDay": False,
        "start": "12:00",
        "end": "12:30",
        "location": "",
    }
    base.update(fields)
    return base


REPLY = {
    "id": "new1",
    "status": "confirmed",
    "summary": "Lunch",
    "start": {"dateTime": "2026-09-26T12:00:00-05:00"},
    "end": {"dateTime": "2026-09-26T12:30:00-05:00"},
}


class TestPerform(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "calendar-events.json"
        self.syncs = []
        doc = {
            "version": 1,
            "syncedAt": "2026-09-25T00:00:00+00:00",
            "source": "gws/0.13.2",
            "events": [old_row()],
            "writableCalendars": [ME],
        }
        self.path.write_text(json.dumps(doc))

    def tearDown(self):
        self.tmp.cleanup()

    def run_write(self, raw, client, cfg=ON):
        return event_cli.perform(raw, cfg, client, self.path, BOGOTA, lambda: self.syncs.append(1))

    def events(self):
        return json.loads(self.path.read_text())["events"]

    def test_create_writes_the_new_rows_and_starts_a_sync(self):
        code, reply = self.run_write(create_request(), FakeClient(REPLY))
        self.assertEqual((code, reply), (0, {"ok": True, "eventId": "new1"}))
        self.assertIn("new1", [r["id"] for r in self.events()])
        self.assertEqual(self.syncs, [1])

    def test_update_replaces_the_rows(self):
        reply = dict(REPLY, id="ev1", summary="Renamed")
        code, _ = self.run_write(create_request(action="update", eventId="ev1"), FakeClient(reply))
        self.assertEqual(code, 0)
        self.assertEqual([r["title"] for r in self.events()], ["Renamed"])

    def test_delete_removes_the_rows(self):
        raw = {"action": "delete", "calendarId": ME["id"], "eventId": "ev1"}
        code, _ = self.run_write(raw, FakeClient())
        self.assertEqual(code, 0)
        self.assertEqual(self.events(), [])

    def test_writing_turned_off_is_refused_before_google(self):
        client = FakeClient(REPLY)
        code, reply = self.run_write(create_request(), client, cfg={"write": False})
        self.assertEqual((code, reply["error"]), (1, event_cli.WRITE_OFF))
        self.assertEqual(client.calls, [])

    def test_a_backend_that_cannot_write_is_refused(self):
        client = FakeClient(REPLY)
        client.can_write = False
        code, reply = self.run_write(create_request(), client)
        self.assertEqual((code, reply["error"]), (1, event_cli.NOT_WRITABLE))

    def test_a_missing_scope_names_the_setup_command(self):
        client = FakeClient(raises=GwsAuthError("403: insufficient scopes"))
        self.assertEqual(self.run_write(create_request(), client)[1]["error"], event_cli.NO_SCOPE)

    def test_an_expired_sign_in_is_not_reported_as_a_missing_scope(self):
        client = FakeClient(raises=GwsAuthError("401: invalid_grant"))
        self.assertEqual(self.run_write(create_request(), client)[1]["error"], event_cli.EXPIRED)

    def test_an_event_that_is_gone_still_starts_the_sync(self):
        client = FakeClient(raises=GwsNotFound("404: Not Found"))
        raw = {"action": "delete", "calendarId": ME["id"], "eventId": "ev1"}
        code, reply = self.run_write(raw, client)
        self.assertEqual((code, reply["error"]), (1, event_cli.GONE))
        self.assertEqual(self.syncs, [1])

    def test_a_bad_request_leaves_the_file_untouched(self):
        before = self.path.read_text()
        code, reply = self.run_write(create_request(start="12:00", end="11:00"), FakeClient(REPLY))
        self.assertEqual(code, 1)
        self.assertEqual(reply["error"], "The end must be after the start.")
        self.assertEqual(self.path.read_text(), before)
        self.assertEqual(self.syncs, [])

    def test_no_events_file_yet_is_refused(self):
        self.path.unlink()
        code, reply = self.run_write(create_request(), FakeClient(REPLY))
        self.assertEqual((code, reply["error"]), (1, event_cli.NO_FILE))


class TestMain(unittest.TestCase):
    def test_a_missing_or_broken_argument_is_refused(self):
        self.assertEqual(event_cli.main([]), 1)
        self.assertEqual(event_cli.main(["{not json"]), 1)


if __name__ == "__main__":
    unittest.main()
