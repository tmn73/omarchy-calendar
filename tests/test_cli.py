import contextlib
import io
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from omarchy_calendar_sync import cli, config, contract, gws

BOGOTA = ZoneInfo("America/Bogota")
NOW = datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc)


class FakeGws:
    SOURCE_NAME = "gws"

    def __init__(self, calendars=None, events=None, raises=None):
        self._calendars = calendars if calendars is not None else [
            {"id": "a@example.com", "name": "Personal", "color": "#f83a22"}
        ]
        self._events = events if events is not None else [
            {
                "id": "evt1",
                "status": "confirmed",
                "summary": "Standup",
                "start": {"dateTime": "2026-08-10T09:00:00-05:00"},
                "end": {"dateTime": "2026-08-10T09:15:00-05:00"},
            }
        ]
        self._raises = raises

    def check(self):
        return None

    def version(self):
        return (0, 13, 2)

    def calendars(self):
        if self._raises:
            raise self._raises
        return self._calendars

    def events(self, calendar_id, time_min, time_max):
        if self._raises:
            raise self._raises
        # A dict gives each calendar its own copy of an event; a list is
        # returned for every calendar.
        if isinstance(self._events, dict):
            return self._events.get(calendar_id, [])
        return self._events

    def auth_hint(self, cfg):
        return "run gws auth login"


class TestWriteAtomic(unittest.TestCase):
    def test_creates_parent_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nested" / "deeper" / "out.json"
            cli.write_atomic(path, {"hello": "world"})
            self.assertEqual(json.loads(path.read_text()), {"hello": "world"})

    def test_leaves_no_temp_file_behind(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "out.json"
            cli.write_atomic(path, {"hello": "world"})
            self.assertEqual([p.name for p in Path(tmp).iterdir()], ["out.json"])


class TestRun(unittest.TestCase):
    def test_writes_a_valid_document(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "calendar-events.json"
            code = cli.run(FakeGws(), config.DEFAULTS, NOW, out, BOGOTA)
            self.assertEqual(code, 0)
            doc = json.loads(out.read_text())
            self.assertEqual(contract.validate(doc), [])
            self.assertEqual(len(doc["events"]), 1)
            self.assertEqual(doc["events"][0]["title"], "Standup")
            self.assertEqual(doc["events"][0]["dateKey"], "2026-08-10")

    def test_records_source_and_synced_at(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            cli.run(FakeGws(), config.DEFAULTS, NOW, out, BOGOTA)
            doc = json.loads(out.read_text())
            self.assertEqual(doc["source"], "gws/0.13.2")
            self.assertEqual(doc["syncedAt"], NOW.isoformat())

    def test_excluded_calendar_contributes_nothing(self):
        cfg = dict(config.DEFAULTS)
        cfg["calendars"] = {"include": [], "exclude": ["Personal"]}
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            cli.run(FakeGws(), cfg, NOW, out, BOGOTA)
            self.assertEqual(json.loads(out.read_text())["events"], [])

    def test_events_are_sorted_by_date_then_start(self):
        events = [
            {
                "id": "later",
                "status": "confirmed",
                "summary": "Later",
                "start": {"dateTime": "2026-08-10T18:00:00-05:00"},
                "end": {"dateTime": "2026-08-10T19:00:00-05:00"},
            },
            {
                "id": "earlier",
                "status": "confirmed",
                "summary": "Earlier",
                "start": {"dateTime": "2026-08-10T08:00:00-05:00"},
                "end": {"dateTime": "2026-08-10T09:00:00-05:00"},
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            cli.run(FakeGws(events=events), config.DEFAULTS, NOW, out, BOGOTA)
            titles = [e["title"] for e in json.loads(out.read_text())["events"]]
            self.assertEqual(titles, ["Earlier", "Later"])

    def test_auth_failure_leaves_previous_file_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            out.write_text('{"version": 1, "events": ["previous"]}')
            code = cli.run(
                FakeGws(raises=gws.GwsAuthError("401: invalid_grant")),
                config.DEFAULTS,
                NOW,
                out,
                BOGOTA,
            )
            self.assertEqual(code, 1)
            self.assertIn("previous", out.read_text())

    def test_api_failure_does_not_create_a_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            code = cli.run(
                FakeGws(raises=gws.GwsApiError("500: boom")),
                config.DEFAULTS,
                NOW,
                out,
                BOGOTA,
            )
            self.assertEqual(code, 1)
            self.assertFalse(out.exists())


class TestResolveLocalTimezone(unittest.TestCase):
    def test_tz_env_var_wins(self):
        tz = cli.resolve_local_timezone(
            env={"TZ": "America/New_York"}, localtime_path="/nonexistent/localtime"
        )
        self.assertEqual(getattr(tz, "key", None), "America/New_York")

    def test_tz_env_var_with_leading_colon_is_accepted(self):
        tz = cli.resolve_local_timezone(
            env={"TZ": ":America/Bogota"}, localtime_path="/nonexistent/localtime"
        )
        self.assertEqual(getattr(tz, "key", None), "America/Bogota")

    def test_garbage_tz_env_var_falls_through_rather_than_raising(self):
        with contextlib.redirect_stderr(io.StringIO()):
            tz = cli.resolve_local_timezone(
                env={"TZ": "Not/AZone"}, localtime_path="/nonexistent/localtime"
            )
        self.assertIsNone(getattr(tz, "key", None))
        self.assertIsNotNone(tz.utcoffset(datetime.now()))

    def test_symlinked_localtime_resolves_to_the_right_zone_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            zoneinfo_dir = Path(tmp) / "usr" / "share" / "zoneinfo" / "America"
            zoneinfo_dir.mkdir(parents=True)
            zone_file = zoneinfo_dir / "Bogota"
            zone_file.write_text("not a real tzfile, just needs to exist")

            localtime_path = Path(tmp) / "etc" / "localtime"
            localtime_path.parent.mkdir(parents=True)
            os.symlink(zone_file, localtime_path)

            tz = cli.resolve_local_timezone(env={}, localtime_path=str(localtime_path))
            self.assertEqual(getattr(tz, "key", None), "America/Bogota")

    def test_real_file_instead_of_symlink_falls_through(self):
        with tempfile.TemporaryDirectory() as tmp:
            localtime_path = Path(tmp) / "localtime"
            localtime_path.write_text("not a symlink")

            with contextlib.redirect_stderr(io.StringIO()):
                tz = cli.resolve_local_timezone(env={}, localtime_path=str(localtime_path))
            self.assertIsNone(getattr(tz, "key", None))
            self.assertIsNotNone(tz.utcoffset(datetime.now()))

    def test_final_fallback_returns_a_usable_tzinfo_and_warns(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            tz = cli.resolve_local_timezone(env={}, localtime_path="/nonexistent/localtime")
        self.assertIsNone(getattr(tz, "key", None))
        self.assertIsNotNone(tz.utcoffset(datetime.now()))
        self.assertIn("timezone", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()


def gevent(uid, start, summary="Event", event_id=None):
    return {
        "id": event_id or f"{uid}-{start}",
        "status": "confirmed",
        "summary": summary,
        "iCalUID": uid,
        "start": {"dateTime": start},
        "end": {"dateTime": start},
    }


class TestOccurrenceKey(unittest.TestCase):
    def test_same_event_in_two_calendars_shares_a_key(self):
        a = gevent("shared@google.com", "2026-08-10T19:15:00-05:00")
        b = gevent("shared@google.com", "2026-08-10T19:15:00-05:00", event_id="other")
        self.assertEqual(cli.occurrence_key(a), cli.occurrence_key(b))

    def test_two_instances_of_a_series_have_different_keys(self):
        # A recurring series shares one iCalUID across every instance. Live
        # data confirmed this: a daily standup returned five events with five
        # ids and a single iCalUID. The start is what separates them.
        monday = gevent("standup@google.com", "2026-08-10T09:00:00-05:00")
        wednesday = gevent("standup@google.com", "2026-08-12T09:00:00-05:00")
        self.assertNotEqual(cli.occurrence_key(monday), cli.occurrence_key(wednesday))

    def test_event_without_ical_uid_is_never_deduplicated(self):
        bare = {"id": "x", "start": {"dateTime": "2026-08-10T09:00:00-05:00"}}
        self.assertIsNone(cli.occurrence_key(bare))

    def test_all_day_events_key_on_their_date(self):
        a = {"id": "x", "iCalUID": "u@g", "start": {"date": "2026-08-17"}}
        self.assertEqual(cli.occurrence_key(a), ("u@g", "2026-08-17"))


class TestDeduplicationAcrossCalendars(unittest.TestCase):
    def test_a_recurring_series_survives_intact(self):
        series = [
            gevent("standup@google.com", f"2026-08-{day:02d}T09:00:00-05:00")
            for day in (10, 12, 14, 17, 19)
        ]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            cli.run(FakeGws(events=series), config.DEFAULTS, NOW, out, BOGOTA)
            titles = json.loads(out.read_text())["events"]
            self.assertEqual(len(titles), 5)

    def test_the_same_event_seen_from_two_calendars_is_listed_once(self):
        shared = gevent("shared@google.com", "2026-08-10T19:15:00-05:00", "Impuestos")
        calendars = [
            {"id": "a@example.com", "name": "Alpha", "color": "#f83a22"},
            {"id": "b@example.com", "name": "Beta", "color": "#7bd148"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            cli.run(
                FakeGws(calendars=calendars, events=[shared]),
                config.DEFAULTS,
                NOW,
                out,
                BOGOTA,
            )
            events = json.loads(out.read_text())["events"]
            self.assertEqual(len(events), 1)
            # First calendar by name wins, so the surviving copy is stable.
            self.assertEqual(events[0]["calendarName"], "Alpha")

    def test_the_primary_calendars_copy_wins_over_one_that_sorts_first(self):
        # A colleague's calendar shared as free/busy returns the same
        # occurrence with no title, and it sorts before yours by name.
        start = "2026-08-10T19:15:00-05:00"
        calendars = [
            {"id": "alice@example.com", "name": "Alice", "color": "#f83a22"},
            {"id": "me@example.com", "name": "me@example.com", "color": "#7bd148", "primary": True},
        ]
        copies = {
            "alice@example.com": [gevent("shared@google.com", start, "")],
            "me@example.com": [gevent("shared@google.com", start, "Impuestos")],
        }
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            cli.run(
                FakeGws(calendars=calendars, events=copies),
                config.DEFAULTS,
                NOW,
                out,
                BOGOTA,
            )
            events = json.loads(out.read_text())["events"]
            self.assertEqual(len(events), 1)
            self.assertEqual(events[0]["calendarName"], "me@example.com")
            self.assertEqual(events[0]["title"], "Impuestos")


class TestWritableCalendars(unittest.TestCase):
    CALS = [
        {"id": "me@example.com", "name": "Me", "color": "#7bd148", "primary": True, "writable": True},
        {"id": "team@example.com", "name": "Team", "color": "#f83a22", "writable": False},
    ]

    def sync_with(self, cfg_changes, can_write=True):
        client = FakeGws(calendars=self.CALS, events=[])
        client.can_write = can_write
        cfg = {**config.DEFAULTS, **cfg_changes}
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            cli.run(client, cfg, NOW, out, BOGOTA)
            return json.loads(out.read_text())

    def test_writable_calendars_are_listed_when_writing_is_on(self):
        doc = self.sync_with({"write": True})
        self.assertEqual(
            doc["writableCalendars"],
            [{"id": "me@example.com", "name": "Me", "color": "#7bd148"}],
        )

    def test_no_writable_calendars_when_writing_is_off(self):
        self.assertNotIn("writableCalendars", self.sync_with({"write": False}))

    def test_no_writable_calendars_when_the_backend_cannot_write(self):
        self.assertNotIn("writableCalendars", self.sync_with({"write": True}, can_write=False))

    def test_guest_suggestions_are_published_with_writing(self):
        client = FakeGws(calendars=self.CALS, events=[{
            "id": "e1", "status": "confirmed", "summary": "Sync", "iCalUID": "u1",
            "start": {"dateTime": "2026-08-10T09:00:00-05:00"},
            "end": {"dateTime": "2026-08-10T09:30:00-05:00"},
            "attendees": [{"email": "me@example.com", "self": True}, {"email": "ana@example.com"}],
        }])
        client.can_write = True
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            cli.run(client, {**config.DEFAULTS, "write": True}, NOW, out, BOGOTA)
            doc = json.loads(out.read_text())
        self.assertEqual(doc["guestSuggestions"], [{"email": "ana@example.com", "name": ""}])

    def test_no_guest_suggestions_without_writing(self):
        self.assertNotIn("guestSuggestions", self.sync_with({"write": False}))

    def test_writing_is_off_by_default(self):
        self.assertIs(config.DEFAULTS["write"], False)
