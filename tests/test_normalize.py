import unittest
from zoneinfo import ZoneInfo

from omarchy_calendar_sync import normalize

BOGOTA = ZoneInfo("America/Bogota")
NEW_YORK = ZoneInfo("America/New_York")
CAL = {"id": "cal@example.com", "name": "Personal", "color": "#f83a22"}


def timed(start, end, **extra):
    event = {
        "id": "evt1",
        "status": "confirmed",
        "summary": "Standup",
        "start": {"dateTime": start},
        "end": {"dateTime": end},
    }
    event.update(extra)
    return event


def all_day(start, end, **extra):
    event = {
        "id": "evt2",
        "status": "confirmed",
        "summary": "Holiday",
        "start": {"date": start},
        "end": {"date": end},
    }
    event.update(extra)
    return event


class TestTimedEvents(unittest.TestCase):
    def test_single_day_produces_one_row(self):
        rows = normalize.normalize_event(
            timed("2026-08-10T19:15:00-05:00", "2026-08-10T20:15:00-05:00"), CAL, BOGOTA
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["dateKey"], "2026-08-10")
        self.assertFalse(rows[0]["allDay"])
        self.assertEqual(rows[0]["title"], "Standup")
        self.assertEqual(rows[0]["color"], "#f83a22")
        self.assertEqual(rows[0]["calendarName"], "Personal")

    def test_utc_input_is_converted_to_local_day(self):
        # 02:30 UTC on the 11th is 21:30 on the 10th in Bogota.
        rows = normalize.normalize_event(
            timed("2026-08-11T02:30:00Z", "2026-08-11T03:30:00Z"), CAL, BOGOTA
        )
        self.assertEqual([r["dateKey"] for r in rows], ["2026-08-10"])

    def test_event_crossing_midnight_produces_two_rows(self):
        rows = normalize.normalize_event(
            timed("2026-08-10T23:00:00-05:00", "2026-08-11T01:00:00-05:00"), CAL, BOGOTA
        )
        self.assertEqual([r["dateKey"] for r in rows], ["2026-08-10", "2026-08-11"])

    def test_event_ending_exactly_at_midnight_stays_on_one_day(self):
        rows = normalize.normalize_event(
            timed("2026-08-10T22:00:00-05:00", "2026-08-11T00:00:00-05:00"), CAL, BOGOTA
        )
        self.assertEqual([r["dateKey"] for r in rows], ["2026-08-10"])

    def test_rows_of_one_event_share_the_google_id(self):
        rows = normalize.normalize_event(
            timed("2026-08-10T23:00:00-05:00", "2026-08-11T01:00:00-05:00"), CAL, BOGOTA
        )
        self.assertEqual({r["id"] for r in rows}, {"evt1"})

    def test_end_before_start_produces_no_rows(self):
        rows = normalize.normalize_event(
            timed("2026-08-10T20:15:00-05:00", "2026-08-10T19:15:00-05:00"), CAL, BOGOTA
        )
        self.assertEqual(rows, [])

    def test_end_equal_to_start_still_produces_one_row(self):
        # A zero-length event is a legal marker, deliberately not rejected.
        rows = normalize.normalize_event(
            timed("2026-08-10T19:15:00-05:00", "2026-08-10T19:15:00-05:00"), CAL, BOGOTA
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["dateKey"], "2026-08-10")

    def test_naive_datetime_without_offset_produces_no_rows(self):
        # No UTC offset means the result would depend on the machine's local
        # timezone, so the event must be dropped instead of guessed at.
        rows = normalize.normalize_event(
            timed("2026-08-10T19:15:00", "2026-08-10T20:15:00"), CAL, BOGOTA
        )
        self.assertEqual(rows, [])

    def test_spring_forward_transition_converts_correctly_on_both_sides(self):
        # US DST starts 2026-03-08 at 07:00 UTC (02:00 EST jumps to 03:00 EDT).
        # Start is before that instant (EST, UTC-5); end is after it (EDT, UTC-4).
        rows = normalize.normalize_event(
            timed("2026-03-08T04:30:00Z", "2026-03-08T09:30:00Z"), CAL, NEW_YORK
        )
        self.assertEqual([r["dateKey"] for r in rows], ["2026-03-07", "2026-03-08"])


class TestAllDayEvents(unittest.TestCase):
    def test_single_all_day_uses_exclusive_end(self):
        rows = normalize.normalize_event(all_day("2026-08-17", "2026-08-18"), CAL, BOGOTA)
        self.assertEqual([r["dateKey"] for r in rows], ["2026-08-17"])
        self.assertTrue(rows[0]["allDay"])

    def test_three_day_all_day_produces_three_rows(self):
        rows = normalize.normalize_event(all_day("2026-08-17", "2026-08-20"), CAL, BOGOTA)
        self.assertEqual(
            [r["dateKey"] for r in rows], ["2026-08-17", "2026-08-18", "2026-08-19"]
        )

    def test_end_date_equal_to_start_date_produces_no_rows(self):
        rows = normalize.normalize_event(all_day("2026-08-17", "2026-08-17"), CAL, BOGOTA)
        self.assertEqual(rows, [])

    def test_end_date_before_start_date_produces_no_rows(self):
        rows = normalize.normalize_event(all_day("2026-08-17", "2026-08-16"), CAL, BOGOTA)
        self.assertEqual(rows, [])


class TestFiltering(unittest.TestCase):
    def test_cancelled_events_are_dropped(self):
        rows = normalize.normalize_event(
            timed("2026-08-10T19:15:00-05:00", "2026-08-10T20:15:00-05:00", status="cancelled"),
            CAL,
            BOGOTA,
        )
        self.assertEqual(rows, [])

    def test_event_without_start_is_dropped(self):
        rows = normalize.normalize_event({"id": "x", "status": "confirmed"}, CAL, BOGOTA)
        self.assertEqual(rows, [])

    def test_missing_summary_falls_back(self):
        event = timed("2026-08-10T19:15:00-05:00", "2026-08-10T20:15:00-05:00")
        del event["summary"]
        rows = normalize.normalize_event(event, CAL, BOGOTA)
        self.assertEqual(rows[0]["title"], normalize.NO_TITLE)

    def test_blank_summary_falls_back(self):
        rows = normalize.normalize_event(
            timed("2026-08-10T19:15:00-05:00", "2026-08-10T20:15:00-05:00", summary="   "),
            CAL,
            BOGOTA,
        )
        self.assertEqual(rows[0]["title"], normalize.NO_TITLE)

    def test_location_defaults_to_empty_string(self):
        rows = normalize.normalize_event(
            timed("2026-08-10T19:15:00-05:00", "2026-08-10T20:15:00-05:00"), CAL, BOGOTA
        )
        self.assertEqual(rows[0]["location"], "")

    def test_start_date_of_none_produces_no_rows(self):
        # A malformed start node must be dropped, not raise.
        event = {"id": "evt3", "status": "confirmed", "start": {"date": None}}
        try:
            rows = normalize.normalize_event(event, CAL, BOGOTA)
        except Exception as exc:  # noqa: BLE001
            self.fail(f"normalize_event raised {exc!r} instead of dropping the event")
        self.assertEqual(rows, [])


class TestNormalizeAll(unittest.TestCase):
    def test_flattens_every_event(self):
        events = [
            timed("2026-08-10T19:15:00-05:00", "2026-08-10T20:15:00-05:00"),
            all_day("2026-08-17", "2026-08-19"),
        ]
        rows = normalize.normalize_all(events, CAL, BOGOTA)
        self.assertEqual(len(rows), 3)


if __name__ == "__main__":
    unittest.main()


class TestMeetingUrl(unittest.TestCase):
    def test_hangout_link_is_used(self):
        event = timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00")
        event["hangoutLink"] = "https://meet.google.com/abc-defg-hij"
        rows = normalize.normalize_event(event, CAL, BOGOTA)
        self.assertEqual(rows[0]["meetingUrl"], "https://meet.google.com/abc-defg-hij")

    def test_conference_data_video_entry_is_used_when_no_hangout_link(self):
        event = timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00")
        event["conferenceData"] = {
            "entryPoints": [
                {"entryPointType": "phone", "uri": "tel:+15551234"},
                {"entryPointType": "video", "uri": "https://zoom.us/j/123"},
            ]
        }
        rows = normalize.normalize_event(event, CAL, BOGOTA)
        self.assertEqual(rows[0]["meetingUrl"], "https://zoom.us/j/123")

    def test_non_https_schemes_are_dropped(self):
        # A meeting link comes from whoever sent the invitation, so anything
        # the widget should not launch must never reach it.
        for hostile in (
            "http://meet.example.com/x",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "https://ok.example.com; rm -rf ~",
        ):
            event = timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00")
            event["hangoutLink"] = hostile
            rows = normalize.normalize_event(event, CAL, BOGOTA)
            self.assertEqual(rows[0]["meetingUrl"], "", hostile)

    def test_missing_link_is_an_empty_string_not_none(self):
        rows = normalize.normalize_event(
            timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00"), CAL, BOGOTA
        )
        self.assertEqual(rows[0]["meetingUrl"], "")
        self.assertEqual(rows[0]["eventUrl"], "")


class TestEventTypeAndResponse(unittest.TestCase):
    def test_event_type_is_carried(self):
        event = timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00")
        event["eventType"] = "workingLocation"
        rows = normalize.normalize_event(event, CAL, BOGOTA)
        self.assertEqual(rows[0]["eventType"], "workingLocation")

    def test_own_response_status_is_picked_from_attendees(self):
        event = timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00")
        event["attendees"] = [
            {"email": "someone@example.com", "responseStatus": "accepted"},
            {"email": "me@example.com", "self": True, "responseStatus": "declined"},
        ]
        rows = normalize.normalize_event(event, CAL, BOGOTA)
        self.assertEqual(rows[0]["responseStatus"], "declined")

    def test_no_attendees_means_no_response_status(self):
        rows = normalize.normalize_event(
            timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00"), CAL, BOGOTA
        )
        self.assertEqual(rows[0]["responseStatus"], "")

    def test_every_row_of_a_multi_day_event_carries_the_extras(self):
        event = timed("2026-08-10T23:00:00-05:00", "2026-08-11T01:00:00-05:00")
        event["hangoutLink"] = "https://meet.google.com/x"
        rows = normalize.normalize_event(event, CAL, BOGOTA)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(r["meetingUrl"] == "https://meet.google.com/x" for r in rows))


class TestUrlGuardMatchesTheWidget(unittest.TestCase):
    """The widget's Model.safeUrl rejects quotes and angle brackets.

    A sync that is more permissive writes a URL the widget then silently
    refuses, which shows up as a missing button and nothing else.
    """

    def test_quotes_and_angle_brackets_are_refused(self):
        for hostile in (
            'https://ok.example.com/"x',
            "https://ok.example.com/'x",
            "https://ok.example.com/<x",
            "https://ok.example.com/>x",
            "https://ok.example.com/\tx",
        ):
            event = timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00")
            event["hangoutLink"] = hostile
            rows = normalize.normalize_event(event, CAL, BOGOTA)
            self.assertEqual(rows[0]["meetingUrl"], "", hostile)

    def test_an_ordinary_link_still_passes(self):
        event = timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00")
        event["hangoutLink"] = "https://meet.google.com/abc-defg-hij?authuser=1"
        rows = normalize.normalize_event(event, CAL, BOGOTA)
        self.assertEqual(rows[0]["meetingUrl"], "https://meet.google.com/abc-defg-hij?authuser=1")
