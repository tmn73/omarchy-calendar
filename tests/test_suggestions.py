import unittest

from omarchy_calendar_sync import suggestions


def event(*attendees):
    return {"id": "e", "attendees": list(attendees)}


class TestGuestSuggestions(unittest.TestCase):
    def test_the_most_frequent_guests_come_first(self):
        events = [
            event({"email": "ana@example.com"}, {"email": "bo@example.com"}),
            event({"email": "bo@example.com", "displayName": "Bo Lee"}),
        ]
        self.assertEqual(
            suggestions.guest_suggestions(events, exclude=[]),
            [{"email": "bo@example.com", "name": "Bo Lee"}, {"email": "ana@example.com", "name": ""}],
        )

    def test_you_rooms_and_excluded_addresses_are_left_out(self):
        events = [event(
            {"email": "me@example.com", "self": True},
            {"email": "room-2@resource.calendar.google.com", "resource": True},
            {"email": "team@example.com"},
            {"email": "ana@example.com"},
        )]
        self.assertEqual(
            [s["email"] for s in suggestions.guest_suggestions(events, exclude=["team@example.com"])],
            ["ana@example.com"],
        )

    def test_addresses_are_matched_without_case(self):
        events = [event({"email": "Ana@Example.com"}), event({"email": "ana@example.com"})]
        self.assertEqual(
            suggestions.guest_suggestions(events, exclude=[]),
            [{"email": "ana@example.com", "name": ""}],
        )

    def test_the_list_is_capped(self):
        events = [event({"email": f"p{i}@example.com"}) for i in range(10)]
        self.assertEqual(len(suggestions.guest_suggestions(events, exclude=[], limit=3)), 3)

    def test_events_without_attendees_are_fine(self):
        self.assertEqual(suggestions.guest_suggestions([{"id": "e"}], exclude=[]), [])


if __name__ == "__main__":
    unittest.main()
