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

    def test_end_date_equal_to_start_date_still_occupies_its_day(self):
        # Not what the API documents, but what it returns for some one-day
        # markers. The event is visible in Google Calendar, so hiding it here
        # would be a silent disagreement with what the user can see.
        rows = normalize.normalize_event(all_day("2026-08-17", "2026-08-17"), CAL, BOGOTA)
        self.assertEqual([r["dateKey"] for r in rows], ["2026-08-17"])
        self.assertTrue(rows[0]["allDay"])

    def test_end_date_before_start_date_still_occupies_its_start(self):
        rows = normalize.normalize_event(all_day("2026-08-17", "2026-08-16"), CAL, BOGOTA)
        self.assertEqual([r["dateKey"] for r in rows], ["2026-08-17"])


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

    def test_link_pasted_into_location_or_description_is_found(self):
        # An invitation forwarded by email carries the link only as text.
        cases = (
            ({"location": "Google Meet: https://meet.google.com/abc-defg-hij"},
             "https://meet.google.com/abc-defg-hij"),
            ({"description": "Entrar: https://us02web.zoom.us/j/8812345?pwd=Xy1.\nOutro texto"},
             "https://us02web.zoom.us/j/8812345?pwd=Xy1"),
            ({"description": "<a href=\"https://teams.microsoft.com/l/meetup-join/19%3a1\">Join</a>"},
             "https://teams.microsoft.com/l/meetup-join/19%3a1"),
        )
        for fields, expected in cases:
            event = timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00")
            event.update(fields)
            rows = normalize.normalize_event(event, CAL, BOGOTA)
            self.assertEqual(rows[0]["meetingUrl"], expected, fields)

    def test_location_wins_over_description_and_unknown_hosts_are_ignored(self):
        event = timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00")
        event["location"] = "https://meet.google.com/aaa-bbbb-ccc"
        event["description"] = "Previous call: https://meet.google.com/xxx-yyyy-zzz"
        rows = normalize.normalize_event(event, CAL, BOGOTA)
        self.assertEqual(rows[0]["meetingUrl"], "https://meet.google.com/aaa-bbbb-ccc")

        event = timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00")
        event["description"] = "Slides: https://evil.example.com/meet.google.com/abc-defg-hij"
        rows = normalize.normalize_event(event, CAL, BOGOTA)
        self.assertEqual(rows[0]["meetingUrl"], "")

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


class TestDescription(unittest.TestCase):
    def row(self, description):
        event = timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00", description=description)
        return normalize.normalize_event(event, CAL, BOGOTA)[0]

    def test_google_html_becomes_plain_text(self):
        row = self.row('Agenda:<br><b>1.</b> Budget &amp; plan<br><a href="https://ex.com/doc">doc</a>')
        self.assertEqual(row["description"], "Agenda:\n1. Budget & plan\ndoc (https://ex.com/doc)")

    def test_missing_description_is_an_empty_string(self):
        rows = normalize.normalize_event(
            timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00"), CAL, BOGOTA
        )
        self.assertEqual(rows[0]["description"], "")

    def test_the_meeting_link_is_still_found_in_the_raw_html(self):
        row = self.row('<a href="https://meet.google.com/abc-defg-hij">Join</a>')
        self.assertEqual(row["meetingUrl"], "https://meet.google.com/abc-defg-hij")
        self.assertEqual(row["description"], "Join (https://meet.google.com/abc-defg-hij)")

    def test_long_descriptions_are_capped(self):
        self.assertEqual(len(self.row("x" * 5000)["description"]), 1500)


class TestReminders(unittest.TestCase):
    CAL_WITH_DEFAULTS = {**CAL, "defaultReminders": [
        {"method": "popup", "minutes": 30}, {"method": "email", "minutes": 10},
    ]}

    def reminders(self, settings, calendar=CAL_WITH_DEFAULTS):
        event = timed("2026-08-10T09:00:00-05:00", "2026-08-10T09:15:00-05:00")
        if settings is not None:
            event["reminders"] = settings
        return normalize.normalize_event(event, calendar, BOGOTA)[0]["reminders"]

    def test_absent_settings_mean_no_reminders(self):
        self.assertEqual(self.reminders(None), [])

    def test_use_default_takes_the_calendars_popup_defaults(self):
        self.assertEqual(self.reminders({"useDefault": True}), [30])

    def test_use_default_on_a_calendar_without_defaults_is_empty(self):
        self.assertEqual(self.reminders({"useDefault": True}, CAL), [])

    def test_overrides_are_popup_only_sorted_and_unique(self):
        settings = {"useDefault": False, "overrides": [
            {"method": "popup", "minutes": 60},
            {"method": "email", "minutes": 5},
            {"method": "popup", "minutes": 0},
            {"method": "popup", "minutes": 60},
        ]}
        self.assertEqual(self.reminders(settings), [0, 60])

    def test_nonsense_minutes_are_dropped(self):
        settings = {"useDefault": False, "overrides": [
            {"method": "popup", "minutes": -5},
            {"method": "popup", "minutes": True},
            {"method": "popup", "minutes": "10"},
            {"method": "popup"},
            {"method": "popup", "minutes": 15},
        ]}
        self.assertEqual(self.reminders(settings), [15])

    def test_no_overrides_means_none(self):
        self.assertEqual(self.reminders({"useDefault": False}), [])


class TestRowOrder(unittest.TestCase):
    def test_orders_by_day_then_start_then_title(self):
        rows = [
            {"dateKey": "2026-08-11", "start": "a", "title": "x"},
            {"dateKey": "2026-08-10", "start": "b", "title": "x"},
            {"dateKey": "2026-08-10", "start": "a", "title": "y"},
            {"dateKey": "2026-08-10", "start": "a", "title": "x"},
        ]
        ordered = sorted(rows, key=normalize.row_order)
        self.assertEqual([(r["dateKey"], r["start"], r["title"]) for r in ordered], [
            ("2026-08-10", "a", "x"), ("2026-08-10", "a", "y"),
            ("2026-08-10", "b", "x"), ("2026-08-11", "a", "x"),
        ])


if __name__ == "__main__":
    unittest.main()
