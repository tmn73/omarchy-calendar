"""Tests for the Google-shaped resources the eds and ics backends emit."""

import unittest
from zoneinfo import ZoneInfo

from omarchy_calendar_sync import normalize, resources

BOGOTA = ZoneInfo("America/Bogota")
CALENDAR = {"id": "cal-1", "name": "Work", "color": "#4285f4"}


class TestBuildEvent(unittest.TestCase):
    def test_occurrences_of_a_series_get_distinct_ids(self):
        first = resources.build_event(
            "uid-1", {"dateTime": "2026-09-17T09:00:00+00:00"}, None)
        second = resources.build_event(
            "uid-1", {"dateTime": "2026-09-18T09:00:00+00:00"}, None)
        self.assertNotEqual(first["id"], second["id"])

    def test_ical_uid_stays_bare_so_cross_calendar_dedup_still_works(self):
        event = resources.build_event(
            "uid-1", {"date": "2026-09-17"}, None)
        self.assertEqual(event["iCalUID"], "uid-1")

    def test_missing_end_falls_back_to_start(self):
        start = {"dateTime": "2026-09-17T09:00:00+00:00"}
        event = resources.build_event("uid-1", start, None)
        self.assertEqual(event["end"], start)

    def test_cancelled_status_is_lowercased_for_normalize(self):
        event = resources.build_event(
            "uid-1", {"date": "2026-09-17"}, None, status="CANCELLED")
        self.assertEqual(event["status"], "cancelled")
        self.assertEqual(
            normalize.normalize_event(event, CALENDAR, BOGOTA), [])

    def test_conference_url_lands_where_normalize_looks_for_it(self):
        event = resources.build_event(
            "uid-1", {"dateTime": "2026-09-17T09:00:00+00:00"}, None,
            conference_url="https://meet.google.com/abc-defg-hij")
        rows = normalize.normalize_event(event, CALENDAR, BOGOTA)
        self.assertEqual(
            rows[0]["meetingUrl"], "https://meet.google.com/abc-defg-hij")

    def test_partstat_is_translated_to_googles_spelling(self):
        event = resources.build_event(
            "uid-1", {"dateTime": "2026-09-17T09:00:00+00:00"}, None,
            partstat="NEEDS-ACTION")
        rows = normalize.normalize_event(event, CALENDAR, BOGOTA)
        self.assertEqual(rows[0]["responseStatus"], "needsAction")

    def test_declined_survives_the_round_trip(self):
        # The widget hides declined events by this field, so a wrong spelling
        # here shows meetings the user already said no to.
        event = resources.build_event(
            "uid-1", {"dateTime": "2026-09-17T09:00:00+00:00"}, None,
            partstat="DECLINED")
        rows = normalize.normalize_event(event, CALENDAR, BOGOTA)
        self.assertEqual(rows[0]["responseStatus"], "declined")

    def test_unknown_partstat_is_left_blank_rather_than_invented(self):
        event = resources.build_event(
            "uid-1", {"dateTime": "2026-09-17T09:00:00+00:00"}, None,
            partstat="DELEGATED")
        self.assertNotIn("attendees", event)


class TestEndToEndShape(unittest.TestCase):
    def test_an_eds_event_normalizes_into_a_valid_contract_row(self):
        event = resources.build_event(
            "uid-1",
            {"dateTime": "2026-09-17T09:00:00+00:00"},
            {"dateTime": "2026-09-17T09:30:00+00:00"},
            summary="Standup",
            location="Main Meeting Room")
        rows = normalize.normalize_event(event, CALENDAR, BOGOTA)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["title"], "Standup")
        self.assertEqual(row["calendarName"], "Work")
        self.assertFalse(row["allDay"])
        self.assertEqual(row["dateKey"], "2026-09-17")

    def test_an_all_day_event_spanning_days_yields_a_row_per_day(self):
        event = resources.build_event(
            "uid-1", {"date": "2026-09-24"}, {"date": "2026-09-27"},
            summary="Conference")
        rows = normalize.normalize_event(event, CALENDAR, BOGOTA)
        self.assertEqual(
            [row["dateKey"] for row in rows],
            ["2026-09-24", "2026-09-25", "2026-09-26"])


class TestNewFields(unittest.TestCase):
    START = {"dateTime": "2026-09-17T09:00:00+00:00"}

    def test_reminders_become_popup_overrides(self):
        event = resources.build_event("uid-1", self.START, None, reminders=[10, 0])
        self.assertEqual(event["reminders"], {
            "useDefault": False,
            "overrides": [{"method": "popup", "minutes": 10}, {"method": "popup", "minutes": 0}],
        })
        rows = normalize.normalize_event(event, CALENDAR, BOGOTA)
        self.assertEqual(rows[0]["reminders"], [0, 10])

    def test_no_reminders_means_no_reminders_key(self):
        self.assertNotIn("reminders", resources.build_event("uid-1", self.START, None))

    def test_description_and_link_reach_the_row(self):
        event = resources.build_event(
            "uid-1", self.START, None, description="Agenda<br>1. Plan",
            html_link="https://calendar.google.com/calendar/event?eid=abc")
        row = normalize.normalize_event(event, CALENDAR, BOGOTA)[0]
        self.assertEqual(row["description"], "Agenda\n1. Plan")
        self.assertEqual(row["eventUrl"], "https://calendar.google.com/calendar/event?eid=abc")


if __name__ == "__main__":
    unittest.main()
