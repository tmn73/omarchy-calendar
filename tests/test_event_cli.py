import json
import tempfile
import unittest
from pathlib import Path
from zoneinfo import ZoneInfo

from omarchy_calendar_sync import event_cli
from omarchy_calendar_sync.gws import GwsAuthError, GwsNotFound

BOGOTA = ZoneInfo("America/Bogota")
ME = {"id": "me@example.com", "name": "Me", "color": "#7bd148"}
ON = {"write": True}


class FakeClient:
    can_write = True

    def __init__(self, stored=None, reply=None, raises=None):
        self.stored = stored or {}
        self.reply, self.raises, self.calls = reply, raises, []

    def get(self, calendar_id, event_id):
        self.calls.append(("get", event_id))
        if self.raises:
            raise self.raises
        return self.stored[event_id]

    def create(self, calendar_id, body, send_updates="none"):
        self.calls.append(("create", body, send_updates))
        return self._answer()

    def update(self, calendar_id, event_id, body, send_updates="none"):
        self.calls.append(("update", event_id, body, send_updates))
        return self._answer()

    def replace(self, calendar_id, event_id, resource, send_updates="none"):
        self.calls.append(("replace", event_id, resource, send_updates))
        return self._answer()

    def delete(self, calendar_id, event_id, send_updates="none"):
        self.calls.append(("delete", event_id, send_updates))
        if self.raises:
            raise self.raises

    def _answer(self):
        if self.raises:
            raise self.raises
        return self.reply


def old_row(event_id="ev1"):
    return {
        "id": event_id, "calendarId": ME["id"], "calendarName": "Me", "color": "#7bd148",
        "dateKey": "2026-09-26", "start": "2026-09-26T09:00:00-05:00",
        "end": "2026-09-26T10:00:00-05:00", "allDay": False, "title": "Old", "location": "",
    }


def form(**fields):
    base = {
        "calendarId": ME["id"], "eventId": "", "recurringEventId": "", "title": "Lunch",
        "allDay": False, "startDate": "2026-09-26", "startTime": "12:00",
        "endDate": "2026-09-26", "endTime": "12:30", "location": "", "description": "",
        "guests": [], "meet": False, "meetUrl": "", "repeat": "none", "rrule": [],
        "reminders": {"useDefault": True, "overrides": []}, "busy": True,
        "visibility": "default", "colorId": "", "guestsCanModify": False,
        "guestsCanInviteOthers": True, "guestsCanSeeOtherGuests": True,
    }
    base.update(fields)
    return base


def resource(event_id, day="2026-09-26", title="Lunch", **extra):
    return {
        "id": event_id, "status": "confirmed", "summary": title,
        "start": {"dateTime": day + "T12:00:00-05:00"},
        "end": {"dateTime": day + "T12:30:00-05:00"}, **extra,
    }


MASTER = resource("s", recurrence=["RRULE:FREQ=WEEKLY;BYDAY=SA"])
OCCURRENCE = resource("s_20261010", day="2026-10-10", recurringEventId="s")


class TestPerform(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "calendar-events.json"
        self.background, self.inline = [], []
        doc = {"version": 1, "syncedAt": "2026-09-25T00:00:00+00:00", "source": "gws/0.13.2",
               "events": [old_row()], "writableCalendars": [ME]}
        self.path.write_text(json.dumps(doc))

    def tearDown(self):
        self.tmp.cleanup()

    def run_event(self, raw, client, cfg=ON):
        return event_cli.perform(
            raw, cfg, client, self.path, BOGOTA,
            lambda: self.background.append(1), lambda: self.inline.append(1),
        )

    def events(self):
        return json.loads(self.path.read_text())["events"]

    # ---- get

    def test_get_returns_the_form(self):
        client = FakeClient(stored={"ev1": resource("ev1", title="Standup")})
        code, reply = self.run_event({"action": "get", "calendarId": ME["id"], "eventId": "ev1"}, client)
        self.assertEqual(code, 0)
        self.assertEqual(reply["event"]["title"], "Standup")

    def test_get_of_an_occurrence_reads_its_master(self):
        client = FakeClient(stored={"s_20261010": OCCURRENCE, "s": MASTER})
        _, reply = self.run_event({"action": "get", "calendarId": ME["id"], "eventId": "s_20261010"}, client)
        self.assertEqual([c[1] for c in client.calls], ["s_20261010", "s"])
        self.assertEqual(reply["event"]["repeat"], "weekly")

    # ---- create

    def test_create_splices_and_starts_a_background_sync(self):
        client = FakeClient(reply=resource("new1"))
        code, reply = self.run_event({"action": "create", "sendUpdates": "all", "event": form()}, client)
        self.assertEqual((code, reply), (0, {"ok": True, "eventId": "new1"}))
        self.assertEqual(client.calls[0][2], "all")
        self.assertIn("new1", [r["id"] for r in self.events()])
        self.assertEqual((self.background, self.inline), ([1], []))

    def test_create_of_a_series_syncs_inline_instead_of_splicing(self):
        client = FakeClient(reply=dict(MASTER, id="new1"))
        code, _ = self.run_event({"action": "create", "event": form(repeat="weekly")}, client)
        self.assertEqual(code, 0)
        self.assertEqual(client.calls[0][1]["recurrence"], ["RRULE:FREQ=WEEKLY;BYDAY=SA"])
        self.assertEqual((self.background, self.inline), ([], [1]))
        self.assertNotIn("new1", [r["id"] for r in self.events()])

    # ---- update

    def test_update_of_a_single_event_reads_it_then_splices(self):
        client = FakeClient(stored={"ev1": resource("ev1")}, reply=resource("ev1", title="Renamed"))
        code, _ = self.run_event({"action": "update", "event": form(eventId="ev1", title="Renamed")}, client)
        self.assertEqual(code, 0)
        self.assertEqual([c[0] for c in client.calls], ["get", "update"])
        self.assertEqual([r["title"] for r in self.events()], ["Renamed"])

    def test_update_of_this_occurrence_sends_no_rule(self):
        client = FakeClient(stored={"s_20261010": OCCURRENCE}, reply=OCCURRENCE)
        raw = {"action": "update", "scope": "this",
               "event": form(eventId="s_20261010", recurringEventId="s", repeat="weekly",
                             title="Moved", startDate="2026-10-10", endDate="2026-10-10")}
        self.run_event(raw, client)
        _, target, body, _ = client.calls[-1]
        self.assertEqual(target, "s_20261010")
        self.assertNotIn("recurrence", body)

    def test_update_of_all_events_moves_onto_the_series_and_syncs_inline(self):
        client = FakeClient(stored={"s": MASTER}, reply=MASTER)
        raw = {"action": "update", "scope": "all",
               "event": form(eventId="s_20261010", recurringEventId="s", repeat="weekly",
                             startDate="2026-10-10", startTime="13:00",
                             endDate="2026-10-10", endTime="14:00")}
        code, _ = self.run_event(raw, client)
        self.assertEqual(code, 0)
        _, target, body, _ = client.calls[-1]
        self.assertEqual(target, "s")
        self.assertEqual(body["start"], {"dateTime": "2026-09-26T13:00:00-05:00", "timeZone": "America/Bogota"})
        self.assertEqual(self.inline, [1])

    def test_all_events_keeps_the_series_rule_when_repeat_is_unchanged(self):
        # A monthly series on the 4th Saturday, edited from its 2026-11-28
        # occurrence: rebuilding the rule from that date would give -1SA.
        master = dict(resource("m", day="2026-10-24"), recurrence=["RRULE:FREQ=MONTHLY;BYDAY=4SA"])
        client = FakeClient(stored={"m": master}, reply=master)
        raw = {"action": "update", "scope": "all",
               "event": form(eventId="m_20261128", recurringEventId="m", repeat="monthly",
                             title="Renamed", startDate="2026-11-28", endDate="2026-11-28")}
        self.run_event(raw, client)
        body = client.calls[-1][2]
        self.assertEqual(body.get("recurrence", master["recurrence"]), ["RRULE:FREQ=MONTHLY;BYDAY=4SA"])

    def test_all_events_builds_a_new_preset_from_the_series_first_date(self):
        master = dict(resource("m", day="2026-09-21"), recurrence=["RRULE:FREQ=DAILY"])
        client = FakeClient(stored={"m": master}, reply=master)
        raw = {"action": "update", "scope": "all",
               "event": form(eventId="m_20261001", recurringEventId="m", repeat="weekly",
                             startDate="2026-10-01", endDate="2026-10-01")}
        self.run_event(raw, client)
        self.assertEqual(client.calls[-1][2]["recurrence"], ["RRULE:FREQ=WEEKLY;BYDAY=MO"])

    def test_an_edit_keeps_the_rooms(self):
        room = {"email": "room-2@resource.calendar.google.com", "resource": True, "responseStatus": "accepted"}
        current = resource("ev1", attendees=[{"email": "ana@example.com", "responseStatus": "accepted"}, room])
        client = FakeClient(stored={"ev1": current}, reply=current)
        guests = [{"email": "ana@example.com", "optional": False, "responseStatus": "accepted"},
                  {"email": "bo@example.com", "optional": False}]
        self.run_event({"action": "update", "event": form(eventId="ev1", guests=guests)}, client)
        sent = client.calls[-1][2]["attendees"]
        self.assertIn("room-2@resource.calendar.google.com", [a["email"] for a in sent])

    def test_switching_to_all_day_replaces_the_event(self):
        client = FakeClient(stored={"ev1": resource("ev1")}, reply=resource("ev1"))
        self.run_event({"action": "update", "event": form(eventId="ev1", allDay=True)}, client)
        self.assertEqual(client.calls[-1][0], "replace")

    def test_removing_meet_replaces_the_whole_event_without_it(self):
        with_meet = resource("ev1", hangoutLink="https://meet.google.com/abc",
                             conferenceData={"conferenceSolution": {"key": {"type": "hangoutsMeet"}}},
                             extendedProperties={"private": {"kept": "yes"}})
        client = FakeClient(stored={"ev1": with_meet}, reply=resource("ev1"))
        code, _ = self.run_event({"action": "update", "event": form(eventId="ev1", meet=False)}, client)
        self.assertEqual(code, 0)
        action, target, sent, _ = client.calls[-1]
        self.assertEqual((action, target), ("replace", "ev1"))
        self.assertNotIn("conferenceData", sent)
        self.assertNotIn("hangoutLink", sent)
        # A field the form does not know survives the replace.
        self.assertEqual(sent["extendedProperties"], {"private": {"kept": "yes"}})
        self.assertEqual(sent["summary"], "Lunch")

    # ---- delete

    def test_delete_of_a_single_event_removes_its_rows(self):
        raw = {"action": "delete", "calendarId": ME["id"], "eventId": "ev1", "sendUpdates": "none"}
        code, _ = self.run_event(raw, FakeClient())
        self.assertEqual(code, 0)
        self.assertEqual(self.events(), [])

    def test_delete_of_all_events_targets_the_series_and_syncs_inline(self):
        client = FakeClient()
        raw = {"action": "delete", "calendarId": ME["id"], "eventId": "s_20261010",
               "recurringEventId": "s", "scope": "all", "sendUpdates": "all"}
        code, _ = self.run_event(raw, client)
        self.assertEqual(code, 0)
        self.assertEqual(client.calls, [("delete", "s", "all")])
        self.assertEqual(self.inline, [1])

    # ---- refusals

    def test_an_unknown_send_updates_is_refused_before_google(self):
        client = FakeClient(reply=resource("n"))
        code, _ = self.run_event({"action": "create", "sendUpdates": "externalOnly", "event": form()}, client)
        self.assertEqual(code, 1)
        self.assertEqual(client.calls, [])

    def test_all_events_without_a_series_is_refused(self):
        code, reply = self.run_event(
            {"action": "delete", "calendarId": ME["id"], "eventId": "ev1", "scope": "all"}, FakeClient())
        self.assertEqual(code, 1)
        self.assertIn("series", reply["error"])

    def test_writing_turned_off_is_refused_before_google(self):
        client = FakeClient(reply=resource("n"))
        code, reply = self.run_event({"action": "create", "event": form()}, client, cfg={"write": False})
        self.assertEqual((code, reply["error"]), (1, event_cli.WRITE_OFF))
        self.assertEqual(client.calls, [])

    def test_a_backend_that_cannot_write_is_refused(self):
        client = FakeClient()
        client.can_write = False
        code, reply = self.run_event({"action": "create", "event": form()}, client)
        self.assertEqual((code, reply["error"]), (1, event_cli.NOT_WRITABLE))

    def test_another_refusal_shows_what_google_said(self):
        client = FakeClient(raises=GwsAuthError(
            "403: Shared properties can only be changed by the organizer of the event."))
        _, reply = self.run_event({"action": "create", "event": form()}, client)
        self.assertEqual(reply["error"], "Google refused the change: Shared properties can only be "
                                         "changed by the organizer of the event.")

    def test_a_missing_scope_names_the_setup_command(self):
        client = FakeClient(raises=GwsAuthError("403: Request had insufficient authentication scopes."))
        _, reply = self.run_event({"action": "create", "event": form()}, client)
        self.assertEqual(reply["error"], event_cli.NO_SCOPE)

    def test_an_expired_sign_in_is_not_reported_as_a_missing_scope(self):
        client = FakeClient(raises=GwsAuthError("401: invalid_grant"))
        _, reply = self.run_event({"action": "create", "event": form()}, client)
        self.assertEqual(reply["error"], event_cli.EXPIRED)

    def test_an_event_that_is_gone_still_starts_the_sync(self):
        client = FakeClient(raises=GwsNotFound("410: Resource has been deleted"))
        code, reply = self.run_event({"action": "delete", "calendarId": ME["id"], "eventId": "ev1"}, client)
        self.assertEqual((code, reply["error"]), (1, event_cli.GONE))
        self.assertEqual(self.background, [1])

    def test_a_bad_form_leaves_the_file_untouched(self):
        before = self.path.read_text()
        code, reply = self.run_event(
            {"action": "create", "event": form(startTime="12:00", endTime="11:00")}, FakeClient(reply=resource("n")))
        self.assertEqual((code, reply["error"]), (1, "The end must be after the start."))
        self.assertEqual(self.path.read_text(), before)

    def test_no_events_file_yet_is_refused(self):
        self.path.unlink()
        code, reply = self.run_event({"action": "create", "event": form()}, FakeClient())
        self.assertEqual((code, reply["error"]), (1, event_cli.NO_FILE))


class TestMain(unittest.TestCase):
    def test_a_missing_or_broken_argument_is_refused(self):
        self.assertEqual(event_cli.main([]), 1)
        self.assertEqual(event_cli.main(["{not json"]), 1)


if __name__ == "__main__":
    unittest.main()
