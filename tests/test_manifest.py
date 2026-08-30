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


if __name__ == "__main__":
    unittest.main()
