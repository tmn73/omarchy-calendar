import json
import unittest
from pathlib import Path

from omarchy_calendar_sync import contract

FIXTURES = Path(__file__).parent / "fixtures"


class TestValidate(unittest.TestCase):
    def load(self):
        return json.loads((FIXTURES / "calendar-events.json").read_text())

    def test_fixture_is_valid(self):
        self.assertEqual(contract.validate(self.load()), [])

    def test_wrong_version_is_reported(self):
        doc = self.load()
        doc["version"] = 2
        self.assertIn("version", " ".join(contract.validate(doc)))

    def test_missing_events_key_is_reported(self):
        doc = self.load()
        del doc["events"]
        self.assertTrue(contract.validate(doc))

    def test_event_missing_field_is_reported(self):
        doc = self.load()
        del doc["events"][0]["dateKey"]
        problems = contract.validate(doc)
        self.assertTrue(any("dateKey" in p for p in problems))

    def test_bad_datekey_shape_is_reported(self):
        doc = self.load()
        doc["events"][0]["dateKey"] = "10/08/2026"
        problems = contract.validate(doc)
        self.assertTrue(any("dateKey" in p for p in problems))

    def test_allday_must_be_boolean(self):
        doc = self.load()
        doc["events"][0]["allDay"] = "yes"
        problems = contract.validate(doc)
        self.assertTrue(any("allDay" in p for p in problems))

    def test_unknown_fields_are_tolerated(self):
        doc = self.load()
        doc["events"][0]["futureField"] = "whatever"
        self.assertEqual(contract.validate(doc), [])


class TestBuildDocument(unittest.TestCase):
    def test_builds_a_valid_document(self):
        doc = contract.build_document([], "2026-08-10T16:42:00+00:00", "gws/0.13.2")
        self.assertEqual(contract.validate(doc), [])
        self.assertEqual(doc["version"], contract.CONTRACT_VERSION)


if __name__ == "__main__":
    unittest.main()


class TestOptionalFields(unittest.TestCase):
    def load(self):
        return json.loads((FIXTURES / "calendar-events.json").read_text())

    def test_a_document_without_the_optional_fields_is_still_valid(self):
        # Third-party writers predate these fields. Upgrading must not break them.
        doc = self.load()
        for event in doc["events"]:
            for field in contract.OPTIONAL_EVENT_FIELDS:
                event.pop(field, None)
        self.assertEqual(contract.validate(doc), [])

    def test_optional_fields_are_type_checked_when_present(self):
        doc = self.load()
        doc["events"][0]["eventType"] = 42
        problems = contract.validate(doc)
        self.assertTrue(any("eventType" in p for p in problems))

    def test_a_non_https_meeting_url_is_rejected(self):
        doc = self.load()
        doc["events"][0]["meetingUrl"] = "javascript:alert(1)"
        problems = contract.validate(doc)
        self.assertTrue(any("meetingUrl" in p for p in problems))

    def test_an_empty_meeting_url_is_accepted(self):
        doc = self.load()
        doc["events"][0]["meetingUrl"] = ""
        self.assertEqual(contract.validate(doc), [])

    def test_writable_calendars_is_optional(self):
        doc = self.load()
        self.assertNotIn("writableCalendars", doc)
        self.assertEqual(contract.validate(doc), [])

    def test_writable_calendars_must_be_a_list_of_calendars(self):
        doc = self.load()
        doc["writableCalendars"] = [{"id": "me@example.com", "name": "Me", "color": "#7bd148"}]
        self.assertEqual(contract.validate(doc), [])
        doc["writableCalendars"] = [{"id": "me@example.com"}]
        self.assertTrue(any("writableCalendars[0].name" in p for p in contract.validate(doc)))
        doc["writableCalendars"] = "me@example.com"
        self.assertIn("writableCalendars must be a list", contract.validate(doc))

    def test_build_document_omits_an_empty_writable_list(self):
        doc = contract.build_document([], "2026-09-25T00:00:00+00:00", "gws/0.13.2", [])
        self.assertNotIn("writableCalendars", doc)
        writable = [{"id": "a@example.com", "name": "A", "color": "#000000"}]
        doc = contract.build_document([], "2026-09-25T00:00:00+00:00", "gws/0.13.2", writable)
        self.assertEqual(doc["writableCalendars"], writable)

    def test_recurring_is_optional_and_must_be_a_boolean(self):
        doc = self.load()
        doc["events"][0]["recurring"] = True
        self.assertEqual(contract.validate(doc), [])
        doc["events"][0]["recurring"] = "yes"
        self.assertTrue(any("recurring" in p for p in contract.validate(doc)))
