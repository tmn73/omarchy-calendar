"""Tests for the limits on what one sync may hold and how long it may run."""

import json
import os
import subprocess
import sys
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

    def test_many_fast_series_in_one_resource_are_refused_before_any_expansion(self):
        icalendar, rie = ics._load_libs()
        series = "".join(
            "BEGIN:VEVENT\r\nUID:s%d\r\nDTSTART:20260801T090000Z\r\n"
            "RRULE:FREQ=SECONDLY\r\nEND:VEVENT\r\n" % n for n in range(50)
        )
        calendar = icalendar.Calendar.from_ical(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:t\r\n%sEND:VCALENDAR\r\n" % series
        )
        expanded = mock.Mock(side_effect=AssertionError("expanded before the check"))
        with mock.patch.object(rie, "of", expanded), self.assertRaises(budget.TooManyEvents):
            budget.occurrences(rie, calendar, START, END)

    def test_by_parts_that_multiply_a_daily_rule_count_toward_the_ceiling(self):
        _icalendar, rie = ics._load_libs()
        rule = "FREQ=DAILY;BYHOUR=%s;BYMINUTE=%s" % (
            ",".join(map(str, range(24))), ",".join(map(str, range(60))))
        self.assertEqual(budget.ceiling(_calendar(rule), START, END), 1 + 24 * 60)

    def test_a_feeds_past_costs_nothing(self):
        icalendar, _rie = ics._load_libs()
        past = "".join(
            "BEGIN:VEVENT\r\nUID:p%d\r\nDTSTART:20200101T090000Z\r\n"
            "DTEND:20200101T100000Z\r\nEND:VEVENT\r\n" % n for n in range(30)
        )
        ended = ("BEGIN:VEVENT\r\nUID:e\r\nDTSTART:20200101T090000Z\r\n"
                 "RRULE:FREQ=HOURLY;UNTIL=20210101T000000Z\r\nEND:VEVENT\r\n")
        calendar = icalendar.Calendar.from_ical(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:t\r\n%s%sEND:VCALENDAR\r\n" % (past, ended)
        )
        self.assertEqual(budget.ceiling(calendar, START, END), 0)

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


class MemoryCapTest(unittest.TestCase):
    def run_python(self, code):
        return subprocess.run(
            [sys.executable, "-c", code], capture_output=True, text=True, timeout=60,
            env=dict(os.environ, PYTHONPATH=str(Path(budget.__file__).parent.parent)),
        )

    def test_a_run_past_the_memory_cap_gets_a_memory_error(self):
        result = self.run_python(
            "from omarchy_calendar_sync import budget\n"
            "budget.cap_memory()\n"
            "try:\n    block = bytearray(budget.MAX_MEMORY_BYTES + 1)\n"
            "except MemoryError:\n    print('capped')\n"
        )
        self.assertEqual(result.stdout.strip(), "capped")

    def test_a_helper_gets_its_own_limits_back(self):
        result = self.run_python(
            "import resource, subprocess, sys\n"
            "from omarchy_calendar_sync import budget\n"
            "budget.cap_memory()\n"
            "child = 'import resource; s, h = resource.getrlimit(resource.RLIMIT_DATA); print(s == h)'\n"
            "print(subprocess.run([sys.executable, '-c', child], capture_output=True, text=True,"
            " preexec_fn=budget.uncap_memory).stdout.strip())\n"
        )
        self.assertEqual(result.stdout.strip(), "True")


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
                    mock.patch.object(budget, "cap_memory"), \
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
