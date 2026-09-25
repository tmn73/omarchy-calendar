"""Tests for the EDS backend's pure mapping.

Deliberately free of any EDS dependency: the gi imports in eds.py are lazy, so
the conversion from CalDAV-derived parts to Google event resources can be
checked on a machine that has never heard of Evolution.
"""

import unittest
from datetime import timezone
from zoneinfo import ZoneInfo

from omarchy_calendar_sync import cli, config, eds, normalize

BOGOTA = ZoneInfo("America/Bogota")
CALENDAR = {"id": "cal-1", "name": "Work", "color": "#4285f4"}


class FakeTime:
    """Enough of an ICalGLib.Time for time_to_node."""

    def __init__(self, *, date=None, epoch=None):
        self._date = date
        self._epoch = epoch

    def is_date(self):
        return self._date is not None

    def get_year(self):
        return self._date[0]

    def get_month(self):
        return self._date[1]

    def get_day(self):
        return self._date[2]

    def get_timezone(self):
        return "utc-zone"

    def as_timet_with_zone(self, _zone):
        return self._epoch


class TestTimeToNode(unittest.TestCase):
    def test_all_day_becomes_a_date_node(self):
        node = eds.time_to_node(FakeTime(date=(2026, 9, 17)))
        self.assertEqual(node, {"date": "2026-09-17"})

    def test_single_digit_parts_are_zero_padded(self):
        node = eds.time_to_node(FakeTime(date=(2026, 1, 3)))
        self.assertEqual(node, {"date": "2026-01-03"})

    def test_timed_node_carries_an_explicit_offset(self):
        # normalize refuses a naive dateTime rather than guessing a zone, so
        # the offset is not optional.
        node = eds.time_to_node(FakeTime(epoch=1789592400))
        self.assertIn("dateTime", node)
        self.assertTrue(
            node["dateTime"].endswith("+00:00"), node["dateTime"]
        )

    def test_none_maps_to_none(self):
        self.assertIsNone(eds.time_to_node(None))


class TestBuildEvent(unittest.TestCase):
    def test_occurrences_of_a_series_get_distinct_ids(self):
        first = eds.build_event(
            "uid-1", {"dateTime": "2026-09-17T09:00:00+00:00"}, None,
            recurrence_key="2026-09-17T09:00:00+00:00")
        second = eds.build_event(
            "uid-1", {"dateTime": "2026-09-18T09:00:00+00:00"}, None,
            recurrence_key="2026-09-18T09:00:00+00:00")
        self.assertNotEqual(first["id"], second["id"])

    def test_ical_uid_stays_bare_so_cross_calendar_dedup_still_works(self):
        event = eds.build_event(
            "uid-1", {"date": "2026-09-17"}, None, recurrence_key="2026-09-17")
        self.assertEqual(event["iCalUID"], "uid-1")

    def test_missing_end_falls_back_to_start(self):
        start = {"dateTime": "2026-09-17T09:00:00+00:00"}
        event = eds.build_event("uid-1", start, None)
        self.assertEqual(event["end"], start)

    def test_cancelled_status_is_lowercased_for_normalize(self):
        event = eds.build_event(
            "uid-1", {"date": "2026-09-17"}, None, status="CANCELLED")
        self.assertEqual(event["status"], "cancelled")
        self.assertEqual(
            normalize.normalize_event(event, CALENDAR, BOGOTA), [])

    def test_conference_url_lands_where_normalize_looks_for_it(self):
        event = eds.build_event(
            "uid-1", {"dateTime": "2026-09-17T09:00:00+00:00"}, None,
            conference_url="https://meet.google.com/abc-defg-hij")
        rows = normalize.normalize_event(event, CALENDAR, BOGOTA)
        self.assertEqual(
            rows[0]["meetingUrl"], "https://meet.google.com/abc-defg-hij")

    def test_partstat_is_translated_to_googles_spelling(self):
        event = eds.build_event(
            "uid-1", {"dateTime": "2026-09-17T09:00:00+00:00"}, None,
            partstat="NEEDS-ACTION")
        rows = normalize.normalize_event(event, CALENDAR, BOGOTA)
        self.assertEqual(rows[0]["responseStatus"], "needsAction")

    def test_declined_survives_the_round_trip(self):
        # The widget hides declined events by this field, so a wrong spelling
        # here shows meetings the user already said no to.
        event = eds.build_event(
            "uid-1", {"dateTime": "2026-09-17T09:00:00+00:00"}, None,
            partstat="DECLINED")
        rows = normalize.normalize_event(event, CALENDAR, BOGOTA)
        self.assertEqual(rows[0]["responseStatus"], "declined")

    def test_unknown_partstat_is_left_blank_rather_than_invented(self):
        event = eds.build_event(
            "uid-1", {"dateTime": "2026-09-17T09:00:00+00:00"}, None,
            partstat="DELEGATED")
        self.assertNotIn("attendees", event)


class TestEndToEndShape(unittest.TestCase):
    def test_an_eds_event_normalizes_into_a_valid_contract_row(self):
        event = eds.build_event(
            "uid-1",
            {"dateTime": "2026-09-17T09:00:00+00:00"},
            {"dateTime": "2026-09-17T09:30:00+00:00"},
            summary="Standup",
            location="Main Meeting Room",
            recurrence_key="2026-09-17T09:00:00+00:00")
        rows = normalize.normalize_event(event, CALENDAR, BOGOTA)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["title"], "Standup")
        self.assertEqual(row["calendarName"], "Work")
        self.assertFalse(row["allDay"])
        self.assertEqual(row["dateKey"], "2026-09-17")

    def test_an_all_day_event_spanning_days_yields_a_row_per_day(self):
        event = eds.build_event(
            "uid-1", {"date": "2026-09-24"}, {"date": "2026-09-27"},
            summary="Conference")
        rows = normalize.normalize_event(event, CALENDAR, BOGOTA)
        self.assertEqual(
            [row["dateKey"] for row in rows],
            ["2026-09-24", "2026-09-25", "2026-09-26"])


class TestBackendSelection(unittest.TestCase):
    def test_default_config_still_selects_gws(self):
        client = cli.build_client(config.DEFAULTS)
        self.assertEqual(client.SOURCE_NAME, "gws")

    def test_an_unknown_backend_is_a_config_error_not_a_crash(self):
        cfg = dict(config.DEFAULTS, backend="thunderbird")
        with self.assertRaises(config.ConfigError):
            cli.build_client(cfg)

    def test_backend_name_is_case_and_space_insensitive(self):
        cfg = dict(config.DEFAULTS, backend="  GWS ")
        self.assertEqual(cli.build_client(cfg).SOURCE_NAME, "gws")


if __name__ == "__main__":
    unittest.main()


class TestWriteSupport(unittest.TestCase):
    def test_eds_cannot_write(self):
        from omarchy_calendar_sync.eds import Eds

        self.assertFalse(Eds.can_write)
