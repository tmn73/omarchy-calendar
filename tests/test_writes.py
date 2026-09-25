import unittest
from zoneinfo import ZoneInfo

from omarchy_calendar_sync import writes

BOGOTA = ZoneInfo("America/Bogota")
PARIS = ZoneInfo("Europe/Paris")
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


class TestBody(unittest.TestCase):
    def test_timed_body_carries_the_local_offset(self):
        body = writes.build_body(request(), BOGOTA)
        self.assertEqual(body["start"], {"dateTime": "2026-09-26T12:00:00-05:00"})
        self.assertEqual(body["end"], {"dateTime": "2026-09-26T12:30:00-05:00"})

    def test_offset_follows_daylight_saving_on_the_events_own_date(self):
        summer = writes.build_body(request(dateKey="2026-10-24"), PARIS)
        winter = writes.build_body(request(dateKey="2026-10-26"), PARIS)
        self.assertTrue(summer["start"]["dateTime"].endswith("+02:00"))
        self.assertTrue(winter["start"]["dateTime"].endswith("+01:00"))

    def test_all_day_body_ends_the_next_day(self):
        body = writes.build_body(request(allDay=True), BOGOTA)
        self.assertEqual(body["start"], {"date": "2026-09-26"})
        self.assertEqual(body["end"], {"date": "2026-09-27"})

    def test_an_end_at_midnight_means_the_next_day(self):
        body = writes.build_body(request(start="23:00", end="00:00"), BOGOTA)
        self.assertEqual(body["end"], {"dateTime": "2026-09-27T00:00:00-05:00"})

    def test_an_end_before_the_start_is_refused(self):
        with self.assertRaises(writes.WriteRequestError):
            writes.build_body(request(start="12:00", end="11:00"), BOGOTA)

    def test_a_bad_date_or_time_is_refused(self):
        with self.assertRaises(writes.WriteRequestError):
            writes.build_body(request(dateKey="26/09/2026"), BOGOTA)
        with self.assertRaises(writes.WriteRequestError):
            writes.build_body(request(start="noon"), BOGOTA)

    def test_the_title_is_sent_verbatim(self):
        title = 'Say "hi" <b>now</b>\nplease'
        self.assertEqual(writes.build_body(request(title=title), BOGOTA)["summary"], title)

    def test_the_body_carries_only_the_form_fields(self):
        body = writes.build_body(request(), BOGOTA)
        self.assertEqual(set(body), {"summary", "location", "start", "end"})


class TestParseRequest(unittest.TestCase):
    def test_a_read_only_calendar_is_refused(self):
        with self.assertRaises(writes.WriteRequestError):
            writes.parse_request(request(calendarId="other@example.com"), [ME["id"]])

    def test_update_and_delete_need_an_event_id(self):
        for action in ("update", "delete"):
            with self.assertRaises(writes.WriteRequestError):
                writes.parse_request(request(action=action), [ME["id"]])

    def test_an_unknown_action_is_refused(self):
        with self.assertRaises(writes.WriteRequestError):
            writes.parse_request(request(action="move"), [ME["id"]])

    def test_a_valid_request_passes(self):
        self.assertEqual(writes.parse_request(request(), [ME["id"]])["action"], "create")


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
