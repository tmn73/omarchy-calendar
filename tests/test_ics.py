"""Tests for the iCal feed backend."""

import base64
import contextlib
import io
import unittest
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from omarchy_calendar_sync import cli, config, ics, normalize

SAO_PAULO = ZoneInfo("America/Sao_Paulo")
URL = "https://calendar.google.com/calendar/ical/me%40example.com/private-abc123/basic.ics"

FEED = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
X-WR-CALNAME:me@example.com
X-WR-TIMEZONE:America/Sao_Paulo
BEGIN:VEVENT
UID:standup@google.com
DTSTART;TZID=America/Sao_Paulo:20261001T090000
DTEND;TZID=America/Sao_Paulo:20261001T091500
RRULE:FREQ=DAILY;COUNT=5
SUMMARY:Standup
X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij
ATTENDEE;PARTSTAT=ACCEPTED:mailto:me@example.com
BEGIN:VALARM
ACTION:DISPLAY
DESCRIPTION:This is an event reminder
TRIGGER:-PT10M
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:standup@google.com
RECURRENCE-ID;TZID=America/Sao_Paulo:20261003T090000
DTSTART;TZID=America/Sao_Paulo:20261003T090000
DTEND;TZID=America/Sao_Paulo:20261003T091500
SUMMARY:Standup
STATUS:CANCELLED
END:VEVENT
BEGIN:VEVENT
UID:trip@google.com
DTSTART;VALUE=DATE:20261010
DTEND;VALUE=DATE:20261013
SUMMARY:Trip
BEGIN:VALARM
ACTION:DISPLAY
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:dentist@google.com
DTSTART:20261005T170000Z
DTEND:20261005T180000Z
SUMMARY:Dentist
LOCATION:Rua A
DESCRIPTION:Bring the <b>x-ray</b><br>Parking &amp; entrance on Rua B
ATTENDEE;PARTSTAT=DECLINED:mailto:me@example.com
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT30M
END:VALARM
BEGIN:VALARM
ACTION:AUDIO
TRIGGER;RELATED=START:-P1D
END:VALARM
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT30M
END:VALARM
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:PT0S
END:VALARM
BEGIN:VALARM
ACTION:EMAIL
SUMMARY:Reminder
DESCRIPTION:Reminder
ATTENDEE:mailto:me@example.com
TRIGGER:-PT2H
END:VALARM
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER;RELATED=END:-PT5M
END:VALARM
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER;VALUE=DATE-TIME:20261005T160000Z
END:VALARM
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:PT15M
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:imported-42@example.org
DTSTART:20261007T170000Z
DTEND:20261007T180000Z
SUMMARY:Imported
END:VEVENT
BEGIN:VEVENT
UID:floating@google.com
DTSTART:20261006T100000
DURATION:PT30M
SUMMARY:Floating
END:VEVENT
BEGIN:VEVENT
UID:old@google.com
DTSTART:20250101T100000Z
DTEND:20250101T110000Z
SUMMARY:Too old
END:VEVENT
END:VCALENDAR
"""

NOW = datetime(2026, 10, 3, 12, 0, tzinfo=timezone.utc)


def client(fetch=None, feeds=None, identity="me@example.com"):
    return ics.Ics(
        feeds if feeds is not None else [URL],
        identity=identity,
        fetch=fetch or (lambda url: FEED),
        local_tz=SAO_PAULO,
    )


def sync_rows(c):
    c.check()
    calendars = c.calendars()
    cfg = dict(config.DEFAULTS)
    lo, hi = config.window_bounds(cfg, NOW)
    rows = []
    for cal in calendars:
        rows.extend(normalize.normalize_all(c.events(cal["id"], lo, hi), cal, SAO_PAULO))
    return calendars, rows


class TestFeeds(unittest.TestCase):
    def test_config_shapes(self):
        self.assertEqual(ics.parse_feeds(URL)[0]["url"], URL)
        self.assertEqual(
            ics.parse_feeds([{"url": "webcal://x.example/a.ics", "name": "N"}]),
            [{"url": "https://x.example/a.ics", "name": "N", "color": ""}],
        )
        self.assertEqual(ics.parse_feeds([None, "", {"name": "no url"}]), [])

    def test_the_secret_url_never_reaches_ids_or_names(self):
        self.assertNotIn("private", ics.feed_id(URL))
        self.assertEqual(ics.redact(URL), "https://calendar.google.com/...")

    def test_public_and_embed_links_are_named_as_the_wrong_address(self):
        self.assertEqual(ics.url_problem(URL), "")
        self.assertEqual(ics.url_problem("webcal://x.example/a.ics"), "")
        public = "https://calendar.google.com/calendar/ical/me%40example.com/public/basic.ics"
        embed = "https://calendar.google.com/calendar/embed?src=abc%40group.calendar.google.com"
        self.assertIn("public address", ics.url_problem(public))
        self.assertIn("embed link", ics.url_problem(embed))
        self.assertIn("https://", ics.url_problem("not a url"))

    def test_no_feeds_is_an_error(self):
        with self.assertRaises(ics.IcsError):
            client(feeds=[]).check()


class TestExpansion(unittest.TestCase):
    def setUp(self):
        self.calendars, self.rows = sync_rows(client())
        self.by_title = {}
        for row in self.rows:
            self.by_title.setdefault(row["title"], []).append(row)

    def test_calendar_name_comes_from_the_feed(self):
        self.assertEqual(self.calendars[0]["name"], "me@example.com")
        self.assertEqual(self.calendars[0]["color"], ics.FEED_COLORS[0])

    def test_feeds_without_a_colour_get_distinct_ones(self):
        other = "https://calendar.google.com/calendar/ical/b%40example.com/private-x/basic.ics"
        calendars = client(feeds=[URL, other]).calendars()
        self.assertEqual([c["color"] for c in calendars], list(ics.FEED_COLORS[:2]))

    def test_recurrence_is_expanded_and_cancelled_instance_dropped(self):
        days = [row["dateKey"] for row in self.by_title["Standup"]]
        self.assertEqual(days, ["2026-10-01", "2026-10-02", "2026-10-04", "2026-10-05"])
        self.assertEqual(len({row["id"] for row in self.by_title["Standup"]}), 4)

    def test_meet_link_and_answer(self):
        standup = self.by_title["Standup"][0]
        self.assertEqual(standup["meetingUrl"], "https://meet.google.com/abc-defg-hij")
        self.assertEqual(standup["responseStatus"], "accepted")
        self.assertEqual(self.by_title["Dentist"][0]["responseStatus"], "declined")

    def test_all_day_spans_days_with_exclusive_end(self):
        trip = self.by_title["Trip"]
        self.assertTrue(trip[0]["allDay"])
        self.assertEqual([r["dateKey"] for r in trip], ["2026-10-10", "2026-10-11", "2026-10-12"])

    def test_utc_and_floating_times_land_in_local_time(self):
        self.assertEqual(self.by_title["Dentist"][0]["start"], "2026-10-05T14:00:00-03:00")
        floating = self.by_title["Floating"][0]
        self.assertEqual(floating["start"], "2026-10-06T10:00:00-03:00")
        self.assertEqual(floating["end"], "2026-10-06T10:30:00-03:00")

    def test_events_outside_the_window_are_skipped(self):
        self.assertNotIn("Too old", self.by_title)


class TestNewFields(unittest.TestCase):
    def setUp(self):
        _calendars, rows = sync_rows(client())
        self.by_title = {}
        for row in rows:
            self.by_title.setdefault(row["title"], []).append(row)

    def test_display_and_audio_alarms_before_the_start_become_reminders(self):
        # Email, end-relative, absolute and after-start alarms are left out.
        self.assertEqual(self.by_title["Dentist"][0]["reminders"], [0, 30, 1440])

    def test_every_occurrence_of_a_series_keeps_its_alarm(self):
        self.assertEqual({tuple(r["reminders"]) for r in self.by_title["Standup"]}, {(10,)})

    def test_an_alarm_without_a_trigger_is_no_reminder(self):
        self.assertEqual(self.by_title["Trip"][0]["reminders"], [])

    def test_description_is_plain_text(self):
        self.assertEqual(self.by_title["Dentist"][0]["description"],
                         "Bring the x-ray\nParking & entrance on Rua B")

    def test_google_events_link_to_google_calendar(self):
        eid = base64.urlsafe_b64encode(b"dentist me@example.com").decode().rstrip("=")
        self.assertEqual(self.by_title["Dentist"][0]["eventUrl"],
                         "https://calendar.google.com/calendar/event?eid=" + eid)

    def test_occurrences_link_to_their_series(self):
        eid = base64.urlsafe_b64encode(b"standup me@example.com").decode().rstrip("=")
        self.assertEqual({r["eventUrl"] for r in self.by_title["Standup"]},
                         {"https://calendar.google.com/calendar/event?eid=" + eid})

    def test_an_imported_uid_gets_no_link(self):
        self.assertEqual(self.by_title["Imported"][0]["eventUrl"], "")

    def test_a_feed_from_elsewhere_gets_no_links(self):
        _calendars, rows = sync_rows(client(feeds=["https://cloud.example.com/remote.php/dav/me.ics"]))
        self.assertEqual({row["eventUrl"] for row in rows}, {""})


class TestGoogleLinks(unittest.TestCase):
    def test_calendar_id_comes_from_secret_and_public_paths(self):
        self.assertEqual(ics.google_calendar_id(URL), "me@example.com")
        group = "webcal://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/public/basic.ics"
        self.assertEqual(ics.google_calendar_id(group), "abc@group.calendar.google.com")

    def test_other_hosts_and_paths_have_no_calendar_id(self):
        for url in (
            "https://evil.example/calendar/ical/me%40example.com/private-abc/basic.ics",
            "https://calendar.google.com/calendar/embed?src=me%40example.com",
            "https://calendar.google.com/calendar/ical/me%40example.com/private-abc/other.ics",
            "",
        ):
            self.assertEqual(ics.google_calendar_id(url), "", url)

    def test_event_url_is_unpadded_base64url_of_id_and_calendar(self):
        url = ics.google_event_url("abc123@google.com", "me@example.com")
        prefix, eid = url.split("eid=", 1)
        self.assertEqual(prefix, "https://calendar.google.com/calendar/event?")
        self.assertNotIn("=", eid)
        padded = eid + "=" * (-len(eid) % 4)
        self.assertEqual(base64.urlsafe_b64decode(padded), b"abc123 me@example.com")

    def test_no_link_without_a_google_uid_or_calendar(self):
        self.assertEqual(ics.google_event_url("abc@example.org", "me@example.com"), "")
        self.assertEqual(ics.google_event_url("abc@google.com", ""), "")


class TestFailures(unittest.TestCase):
    def test_one_broken_feed_does_not_sink_the_others(self):
        def fetch(url):
            if "broken" in url:
                raise OSError("boom")
            return FEED

        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            calendars = client(fetch=fetch, feeds=["https://broken.example/a.ics", URL]).calendars()
        self.assertEqual(len(calendars), 1)
        self.assertIn("skipping https://broken.example/...: boom", stdout.getvalue())

    def test_every_feed_failing_is_a_sync_error_that_hides_the_secret_path(self):
        def fetch(url):
            raise OSError("boom")

        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(ics.IcsError) as caught:
            client(fetch=fetch).calendars()
        self.assertNotIn("private", str(caught.exception))


class TestBackendSelection(unittest.TestCase):
    def test_ics_backend_is_selectable(self):
        cfg = dict(config.DEFAULTS, backend="ics", ics=[URL])
        built = cli.build_client(cfg)
        self.assertEqual(built.SOURCE_NAME, "ics")
        self.assertFalse(built.can_write)


if __name__ == "__main__":
    unittest.main()
