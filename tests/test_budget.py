"""Tests for the limits on what one sync may hold and how long it may run."""

import json
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from omarchy_calendar_sync import budget, cli, config, gws, ics
from tests.test_cli import BOGOTA, NOW, FakeGws, run_quietly

START = datetime(2026, 8, 1, tzinfo=timezone.utc)
END = datetime(2026, 10, 1, tzinfo=timezone.utc)


def _calendar(rule):
    icalendar, _rie = ics._load_libs()
    return icalendar.Calendar.from_ical(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\nBEGIN:VEVENT\r\nUID:x\r\n"
        "DTSTART:20260801T090000Z\r\nDTEND:20260801T091500Z\r\n"
        "RRULE:%s\r\nSUMMARY:x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n" % rule
    )


def _event(n):
    return {
        "id": "evt%d" % n,
        "status": "confirmed",
        "summary": "Event %d" % n,
        "start": {"dateTime": "2026-08-10T09:00:00-05:00"},
        "end": {"dateTime": "2026-08-10T09:15:00-05:00"},
    }


class OccurrencesTest(unittest.TestCase):
    def test_a_rule_that_repeats_every_second_stops_at_the_limit(self):
        _icalendar, rie = ics._load_libs()
        began = time.monotonic()
        with self.assertRaises(budget.TooManyEvents):
            budget.occurrences(rie, _calendar("FREQ=SECONDLY"), START, END, limit=1000)
        self.assertLess(time.monotonic() - began, 5)

    def test_an_ordinary_rule_gives_what_between_gives(self):
        _icalendar, rie = ics._load_libs()
        calendar = _calendar("FREQ=DAILY")
        found = budget.occurrences(rie, calendar, START, END)
        expected = rie.of(calendar).between(START, END)
        self.assertEqual([c["DTSTART"].dt for c in found], [c["DTSTART"].dt for c in expected])
        self.assertEqual(len(found), 61)


class SyncBudgetTest(unittest.TestCase):
    def sync(self, client):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "calendar-events.json"
            code = run_quietly(client, config.DEFAULTS, NOW, out, BOGOTA)
            return code, json.loads(out.read_text())

    def test_a_calendar_past_the_event_budget_is_skipped_and_the_rest_kept(self):
        calendars = [
            {"id": "mine", "name": "Mine", "color": "#f83a22", "primary": True},
            {"id": "flood", "name": "Flood", "color": "#16a765"},
        ]
        events = {"mine": [_event(0)], "flood": [_event(n) for n in range(1, 30)]}
        with mock.patch.object(budget, "MAX_EVENTS", 10):
            code, doc = self.sync(FakeGws(calendars=calendars, events=events))
        self.assertEqual(code, 0)
        self.assertEqual([row["title"] for row in doc["events"]], ["Event 0"])

    def test_a_calendar_past_the_row_budget_is_skipped_and_the_rest_kept(self):
        calendars = [
            {"id": "mine", "name": "Mine", "color": "#f83a22", "primary": True},
            {"id": "flood", "name": "Flood", "color": "#16a765"},
        ]
        events = {"mine": [_event(0)], "flood": [_event(n) for n in range(1, 30)]}
        with mock.patch.object(budget, "MAX_ROWS", 10):
            code, doc = self.sync(FakeGws(calendars=calendars, events=events))
        self.assertEqual(code, 0)
        self.assertEqual([row["title"] for row in doc["events"]], ["Event 0"])


class DeadlineTest(unittest.TestCase):
    def test_the_deadline_ends_a_wait_that_would_never_end(self):
        began = time.monotonic()
        with self.assertRaises(budget.TookTooLong):
            with budget.deadline(1):
                time.sleep(30)
        self.assertLess(time.monotonic() - began, 5)

    def test_a_sync_past_its_deadline_fails_and_keeps_the_old_file(self):
        class Hangs(FakeGws):
            def events(self, calendar_id, time_min, time_max):
                time.sleep(30)

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "calendar-events.json"
            out.write_text("old")
            with mock.patch.object(budget, "SYNC_SECONDS", 1), \
                    mock.patch.object(config, "load", return_value=dict(config.DEFAULTS)), \
                    mock.patch.object(cli, "build_client", return_value=Hangs()), \
                    mock.patch("sys.stderr"):
                code = cli.main(["--out", str(out)])
            self.assertEqual(code, cli.EXIT_SYNC_FAILED)
            self.assertEqual(out.read_text(), "old")

    def test_a_helper_that_hangs_is_stopped(self):
        with mock.patch.object(budget, "HELPER_SECONDS", 1):
            with self.assertRaisesRegex(gws.GwsError, "did not answer"):
                gws.Gws("/nonexistent", binary="sleep")._run(["30"])


if __name__ == "__main__":
    unittest.main()
