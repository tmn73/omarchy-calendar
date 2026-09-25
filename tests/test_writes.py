import unittest
from zoneinfo import ZoneInfo

from omarchy_calendar_sync import writes

BOGOTA = ZoneInfo("America/Bogota")
ME = {"id": "me@example.com", "name": "Me", "color": "#7bd148"}


def request(**fields):
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


def row(event_id, date_key, calendar_id=ME["id"], title="Old"):
    return {
        "id": event_id,
        "calendarId": calendar_id,
        "calendarName": "Me",
        "color": "#7bd148",
        "dateKey": date_key,
        "start": date_key + "T09:00:00-05:00",
        "end": date_key + "T10:00:00-05:00",
        "allDay": False,
        "title": title,
        "location": "",
    }


def resource(event_id, start, end, title="Lunch"):
    return {
        "id": event_id,
        "status": "confirmed",
        "summary": title,
        "start": {"dateTime": start},
        "end": {"dateTime": end},
    }


class TestParseRequest(unittest.TestCase):
    def parse(self, raw):
        return writes.parse_request(raw, [ME["id"]])

    def test_a_create_takes_its_calendar_from_the_event(self):
        request = self.parse({"action": "create", "event": {"calendarId": ME["id"]}})
        self.assertEqual((request["calendarId"], request["scope"], request["sendUpdates"]), (ME["id"], "this", "none"))

    def test_a_read_only_calendar_is_refused(self):
        with self.assertRaises(writes.WriteRequestError):
            self.parse({"action": "create", "event": {"calendarId": "other@example.com"}})

    def test_update_get_and_delete_need_an_event_id(self):
        with self.assertRaises(writes.WriteRequestError):
            self.parse({"action": "update", "event": {"calendarId": ME["id"]}})
        for action in ("get", "delete"):
            with self.assertRaises(writes.WriteRequestError):
                self.parse({"action": action, "calendarId": ME["id"]})

    def test_an_unknown_action_scope_or_send_updates_is_refused(self):
        for raw in (
            {"action": "move", "calendarId": ME["id"], "eventId": "x"},
            {"action": "delete", "calendarId": ME["id"], "eventId": "x", "scope": "following"},
            {"action": "delete", "calendarId": ME["id"], "eventId": "x", "sendUpdates": "externalOnly"},
        ):
            with self.assertRaises(writes.WriteRequestError):
                self.parse(raw)

    def test_all_events_needs_a_series(self):
        with self.assertRaises(writes.WriteRequestError):
            self.parse({"action": "delete", "calendarId": ME["id"], "eventId": "x", "scope": "all"})
        request = self.parse({"action": "update", "scope": "all",
                              "event": {"calendarId": ME["id"], "eventId": "x_1", "recurringEventId": "x"}})
        self.assertEqual(request["recurringEventId"], "x")


class TestSplice(unittest.TestCase):
    def doc(self, *rows):
        return {"version": 1, "syncedAt": "x", "source": "gws/0.13.2", "events": list(rows)}

    def test_create_adds_the_new_rows(self):
        reply = resource("new1", "2026-09-26T12:00:00-05:00", "2026-09-26T12:30:00-05:00")
        doc = writes.splice(self.doc(row("a", "2026-09-26")), ME, "new1", reply, BOGOTA)
        self.assertEqual(sorted(r["id"] for r in doc["events"]), ["a", "new1"])

    def test_update_replaces_every_row_of_the_event(self):
        old = self.doc(row("m", "2026-09-26"), row("m", "2026-09-27"))
        reply = resource("m", "2026-09-28T09:00:00-05:00", "2026-09-28T10:00:00-05:00", "New")
        doc = writes.splice(old, ME, "m", reply, BOGOTA)
        self.assertEqual([(r["dateKey"], r["title"]) for r in doc["events"]], [("2026-09-28", "New")])

    def test_delete_keeps_the_other_occurrences_of_a_series(self):
        old = self.doc(row("s_20260926", "2026-09-26"), row("s_20260927", "2026-09-27"))
        doc = writes.splice(old, ME, "s_20260926", None, BOGOTA)
        self.assertEqual([r["id"] for r in doc["events"]], ["s_20260927"])

    def test_the_same_id_on_another_calendar_is_left_alone(self):
        old = self.doc(row("x", "2026-09-26"), row("x", "2026-09-26", calendar_id="other@example.com"))
        doc = writes.splice(old, ME, "x", None, BOGOTA)
        self.assertEqual([r["calendarId"] for r in doc["events"]], ["other@example.com"])

    def test_other_top_level_fields_survive(self):
        old = self.doc()
        old["writableCalendars"] = [ME]
        self.assertEqual(writes.splice(old, ME, "x", None, BOGOTA)["writableCalendars"], [ME])


if __name__ == "__main__":
    unittest.main()
