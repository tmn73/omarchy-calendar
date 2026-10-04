import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class TestManifest(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((ROOT / "manifest.json").read_text())

    def test_event_time_format_has_a_24_hour_default(self):
        defaults = self.manifest["barWidget"]["defaults"]
        self.assertEqual(defaults["eventTimeFormat"], "HH:mm")

    def test_event_time_format_is_exposed_in_the_schema(self):
        schema = {
            item["key"]: item for item in self.manifest["barWidget"]["schema"]
        }
        self.assertEqual(schema["eventTimeFormat"]["type"], "string")
        self.assertEqual(schema["eventTimeFormat"]["defaultValue"], "HH:mm")

    def test_widget_settings_are_exposed_with_their_widget_defaults(self):
        widget = self.manifest["barWidget"]
        schema = {item["key"]: item for item in widget["schema"]}
        self.assertEqual(schema["language"]["type"], "enum")
        self.assertEqual(schema["language"]["options"], ["auto", "en", "pt"])
        self.assertEqual(schema["reminders"]["type"], "boolean")
        self.assertEqual(schema["announceLeadMinutes"]["type"], "number")
        for key, value in (("language", "auto"), ("reminders", True), ("announceLeadMinutes", 15)):
            self.assertEqual(schema[key]["defaultValue"], value)
            self.assertEqual(widget["defaults"][key], value)

    def test_internal_state_stays_out_of_the_schema(self):
        keys = {item["key"] for item in self.manifest["barWidget"]["schema"]}
        self.assertNotIn("hiddenCalendars", keys)


if __name__ == "__main__":
    unittest.main()
