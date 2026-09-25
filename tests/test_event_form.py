import unittest
from datetime import date
from zoneinfo import ZoneInfo

from omarchy_calendar_sync import event_form
from omarchy_calendar_sync.writes import WriteRequestError

BOGOTA = ZoneInfo("America/Bogota")


def form(**fields):
    base = {
        "calendarId": "me@example.com",
        "eventId": "",
        "recurringEventId": "",
        "title": "Planning",
        "allDay": False,
        "startDate": "2026-09-26",
        "startTime": "10:00",
        "endDate": "2026-09-26",
        "endTime": "10:30",
        "location": "",
        "description": "",
        "guests": [],
        "meet": False,
        "meetUrl": "",
        "repeat": "none",
        "rrule": [],
        "reminders": {"useDefault": True, "overrides": []},
        "busy": True,
        "visibility": "default",
        "colorId": "",
        "guestsCanModify": False,
        "guestsCanInviteOthers": True,
        "guestsCanSeeOtherGuests": True,
    }
    base.update(fields)
    return base


# Shaped like the owner's real events (see the spec's verified facts).
RESOURCE = {
    "id": "ev1",
    "status": "confirmed",
    "summary": "Standup",
    "location": "Room 2",
    "description": "Daily sync",
    "start": {"dateTime": "2026-09-26T09:00:00-05:00"},
    "end": {"dateTime": "2026-09-26T09:15:00-05:00"},
    "attendees": [
        {"email": "me@example.com", "responseStatus": "accepted", "self": True, "organizer": True},
        {"email": "ana@example.com", "responseStatus": "needsAction", "optional": True},
    ],
    "hangoutLink": "https://meet.google.com/abc-defg-hij",
    "conferenceData": {
        "conferenceId": "abc-defg-hij",
        "conferenceSolution": {"key": {"type": "hangoutsMeet"}},
        "entryPoints": [{"entryPointType": "video", "uri": "https://meet.google.com/abc-defg-hij"}],
    },
    "transparency": "transparent",
    "visibility": "private",
    "colorId": "5",
    "reminders": {"useDefault": False, "overrides": [{"method": "popup", "minutes": 20160}]},
    "guestsCanModify": True,
}


class TestRepeatRule(unittest.TestCase):
    SAT_26 = date(2026, 9, 26)

    def test_the_presets(self):
        self.assertEqual(event_form.repeat_rule("none", self.SAT_26), [])
        self.assertEqual(event_form.repeat_rule("daily", self.SAT_26), ["RRULE:FREQ=DAILY"])
        self.assertEqual(event_form.repeat_rule("weekly", self.SAT_26), ["RRULE:FREQ=WEEKLY;BYDAY=SA"])
        self.assertEqual(event_form.repeat_rule("yearly", self.SAT_26), ["RRULE:FREQ=YEARLY"])
        self.assertEqual(
            event_form.repeat_rule("weekdays", self.SAT_26),
            ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
        )

    def test_monthly_uses_last_in_the_last_seven_days(self):
        self.assertEqual(event_form.repeat_rule("monthly", self.SAT_26), ["RRULE:FREQ=MONTHLY;BYDAY=-1SA"])

    def test_monthly_uses_the_nth_weekday_otherwise(self):
        self.assertEqual(event_form.repeat_rule("monthly", date(2026, 9, 12)), ["RRULE:FREQ=MONTHLY;BYDAY=2SA"])

    def test_an_unknown_preset_is_refused(self):
        with self.assertRaises(WriteRequestError):
            event_form.repeat_rule("hourly", self.SAT_26)


class TestRepeatPreset(unittest.TestCase):
    def test_a_rule_that_equals_a_preset_maps_to_it(self):
        self.assertEqual(event_form.repeat_preset(["RRULE:FREQ=WEEKLY;BYDAY=SA"], date(2026, 9, 26)), "weekly")

    def test_any_other_rule_is_custom(self):
        self.assertEqual(event_form.repeat_preset(["RRULE:FREQ=YEARLY;WKST=TU"], date(2020, 3, 19)), "custom")

    def test_no_rule_is_none(self):
        self.assertEqual(event_form.repeat_preset([], date(2026, 9, 26)), "none")


class TestFormToBody(unittest.TestCase):
    def body(self, had_meet=False, had_rule=False, had_color=False, **fields):
        return event_form.form_to_body(form(**fields), BOGOTA, had_meet, had_rule, had_color)

    def test_a_timed_event_carries_the_offset(self):
        body = self.body()
        self.assertEqual(body["start"], {"dateTime": "2026-09-26T10:00:00-05:00"})
        self.assertEqual(body["end"], {"dateTime": "2026-09-26T10:30:00-05:00"})

    def test_an_all_day_event_over_three_days_ends_the_day_after(self):
        body = self.body(allDay=True, endDate="2026-09-28")
        self.assertEqual(body["start"], {"date": "2026-09-26"})
        self.assertEqual(body["end"], {"date": "2026-09-29"})

    def test_a_timed_event_can_span_two_days(self):
        body = self.body(startTime="22:00", endDate="2026-09-27", endTime="09:00")
        self.assertEqual(body["end"], {"dateTime": "2026-09-27T09:00:00-05:00"})

    def test_an_end_before_the_start_is_refused(self):
        with self.assertRaises(WriteRequestError):
            self.body(startTime="12:00", endTime="11:00")
        with self.assertRaises(WriteRequestError):
            self.body(allDay=True, endDate="2026-09-25")

    def test_an_end_at_midnight_on_the_same_day_means_the_next_day(self):
        body = self.body(startTime="23:00", endTime="00:00")
        self.assertEqual(body["end"], {"dateTime": "2026-09-27T00:00:00-05:00"})

    def test_guests_become_attendees_and_keep_their_answer(self):
        guests = [
            {"email": "ana@example.com", "optional": True, "responseStatus": "accepted"},
            {"email": "bo@example.com", "optional": False},
        ]
        self.assertEqual(
            self.body(guests=guests)["attendees"],
            [
                {"email": "ana@example.com", "optional": True, "responseStatus": "accepted"},
                {"email": "bo@example.com", "optional": False},
            ],
        )

    def test_meet_on_a_new_conference_sends_a_create_request(self):
        request = self.body(meet=True)["conferenceData"]["createRequest"]
        self.assertEqual(request["conferenceSolutionKey"], {"type": "hangoutsMeet"})
        self.assertTrue(request["requestId"])

    def test_meet_off_on_an_event_that_had_one_sends_an_empty_conference(self):
        # gws refuses null in its schema check (verified with --dry-run).
        self.assertEqual(self.body(had_meet=True, meet=False)["conferenceData"], {})

    def test_meet_untouched_sends_nothing(self):
        self.assertNotIn("conferenceData", self.body())
        self.assertNotIn("conferenceData", self.body(had_meet=True, meet=True))

    def test_a_preset_becomes_its_rule(self):
        self.assertEqual(self.body(repeat="weekly")["recurrence"], ["RRULE:FREQ=WEEKLY;BYDAY=SA"])

    def test_a_custom_rule_goes_back_unchanged(self):
        rule = ["RRULE:FREQ=YEARLY;WKST=TU"]
        self.assertEqual(self.body(repeat="custom", rrule=rule, had_rule=True)["recurrence"], rule)

    def test_repeat_off_clears_a_rule_only_when_there_was_one(self):
        self.assertEqual(self.body(repeat="none", had_rule=True)["recurrence"], [])
        self.assertNotIn("recurrence", self.body(repeat="none"))

    def test_the_other_options(self):
        body = self.body(busy=False, visibility="private", colorId="5", guestsCanModify=True)
        self.assertEqual(body["transparency"], "transparent")
        self.assertEqual(body["visibility"], "private")
        self.assertEqual(body["colorId"], "5")
        self.assertIs(body["guestsCanModify"], True)
        self.assertEqual(self.body()["transparency"], "opaque")

    def test_no_colour_sends_no_colour_key(self):
        # gws refuses a null colorId (verified with --dry-run).
        self.assertNotIn("colorId", self.body())

    def test_removing_a_colour_sends_an_empty_colour(self):
        self.assertEqual(self.body(had_color=True)["colorId"], "")

    def test_reminder_overrides_go_out_as_they_are(self):
        reminders = {"useDefault": False, "overrides": [{"method": "popup", "minutes": 30}]}
        self.assertEqual(self.body(reminders=reminders)["reminders"], reminders)
        self.assertEqual(self.body()["reminders"], {"useDefault": True})


class TestResourceToForm(unittest.TestCase):
    def test_every_field_of_a_real_shaped_event(self):
        f = event_form.resource_to_form(RESOURCE, "me@example.com", BOGOTA, None)
        self.assertEqual(f["eventId"], "ev1")
        self.assertEqual(f["calendarId"], "me@example.com")
        self.assertEqual((f["title"], f["location"], f["description"]), ("Standup", "Room 2", "Daily sync"))
        self.assertEqual(
            (f["startDate"], f["startTime"], f["endDate"], f["endTime"]),
            ("2026-09-26", "09:00", "2026-09-26", "09:15"),
        )
        self.assertFalse(f["allDay"])
        self.assertEqual([g["email"] for g in f["guests"]], ["me@example.com", "ana@example.com"])
        self.assertTrue(f["guests"][0]["organizer"])
        self.assertTrue(f["guests"][1]["optional"])
        self.assertTrue(f["meet"])
        self.assertEqual(f["meetUrl"], "https://meet.google.com/abc-defg-hij")
        self.assertFalse(f["busy"])
        self.assertEqual((f["visibility"], f["colorId"]), ("private", "5"))
        self.assertEqual(f["reminders"], {"useDefault": False, "overrides": [{"method": "popup", "minutes": 20160}]})
        self.assertTrue(f["guestsCanModify"])
        self.assertTrue(f["guestsCanInviteOthers"])
        self.assertEqual((f["repeat"], f["rrule"]), ("none", []))

    def test_an_all_day_event_shows_its_last_day(self):
        resource = {"id": "a", "summary": "Trip", "start": {"date": "2026-09-26"}, "end": {"date": "2026-09-29"}}
        f = event_form.resource_to_form(resource, "me@example.com", BOGOTA, None)
        self.assertTrue(f["allDay"])
        self.assertEqual((f["startDate"], f["endDate"]), ("2026-09-26", "2026-09-28"))

    def test_an_occurrence_takes_its_rule_from_the_master(self):
        occurrence = dict(RESOURCE, id="ev1_20261003", recurringEventId="ev1")
        master = {"id": "ev1", "recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=SA"],
                  "start": {"dateTime": "2026-09-26T09:00:00-05:00"}}
        f = event_form.resource_to_form(occurrence, "me@example.com", BOGOTA, master)
        self.assertEqual(f["recurringEventId"], "ev1")
        self.assertEqual((f["repeat"], f["rrule"]), ("weekly", ["RRULE:FREQ=WEEKLY;BYDAY=SA"]))


class TestOntoSeries(unittest.TestCase):
    MASTER = {"id": "s", "start": {"dateTime": "2026-09-26T09:00:00-05:00"}}

    def test_the_series_keeps_its_first_date_and_takes_the_new_times(self):
        body = {"start": {"dateTime": "2026-10-10T10:00:00-05:00"}, "end": {"dateTime": "2026-10-10T11:30:00-05:00"}}
        moved = event_form.onto_series(body, self.MASTER, BOGOTA)
        self.assertEqual(moved["start"], {"dateTime": "2026-09-26T10:00:00-05:00"})
        self.assertEqual(moved["end"], {"dateTime": "2026-09-26T11:30:00-05:00"})

    def test_an_all_day_series_keeps_its_first_date_and_length(self):
        master = {"id": "s", "start": {"date": "2026-09-26"}}
        body = {"start": {"date": "2026-10-10"}, "end": {"date": "2026-10-12"}}
        moved = event_form.onto_series(body, master, BOGOTA)
        self.assertEqual((moved["start"], moved["end"]), ({"date": "2026-09-26"}, {"date": "2026-09-28"}))


if __name__ == "__main__":
    unittest.main()
