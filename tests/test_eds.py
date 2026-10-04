"""Tests for the EDS backend's pure mapping.

Deliberately free of any EDS dependency: the gi imports in eds.py are lazy, so
the conversion from ICalGLib values can be checked on a machine that has never
heard of Evolution.
"""

import unittest

from omarchy_calendar_sync import cli, config, eds


class FakeTime:
    """Enough of an ICalGLib.Time for time_to_node."""

    def __init__(self, *, date=None, epoch=None):
        self._date = date
        self._epoch = epoch

    def is_date(self):
        return self._date is not None

    def get_year(self):
        return self._date[0]

    def get_month(self):
        return self._date[1]

    def get_day(self):
        return self._date[2]

    def get_timezone(self):
        return "utc-zone"

    def as_timet_with_zone(self, _zone):
        return self._epoch


class TestTimeToNode(unittest.TestCase):
    def test_all_day_becomes_a_date_node(self):
        node = eds.time_to_node(FakeTime(date=(2026, 9, 17)))
        self.assertEqual(node, {"date": "2026-09-17"})

    def test_single_digit_parts_are_zero_padded(self):
        node = eds.time_to_node(FakeTime(date=(2026, 1, 3)))
        self.assertEqual(node, {"date": "2026-01-03"})

    def test_timed_node_carries_an_explicit_offset(self):
        # normalize refuses a naive dateTime rather than guessing a zone, so
        # the offset is not optional.
        node = eds.time_to_node(FakeTime(epoch=1789592400))
        self.assertIn("dateTime", node)
        self.assertTrue(
            node["dateTime"].endswith("+00:00"), node["dateTime"]
        )

    def test_none_maps_to_none(self):
        self.assertIsNone(eds.time_to_node(None))


class TestBackendSelection(unittest.TestCase):
    def test_default_config_still_selects_gws(self):
        client = cli.build_client(config.DEFAULTS)
        self.assertEqual(client.SOURCE_NAME, "gws")

    def test_an_unknown_backend_is_a_config_error_not_a_crash(self):
        cfg = dict(config.DEFAULTS, backend="thunderbird")
        with self.assertRaises(config.ConfigError):
            cli.build_client(cfg)

    def test_backend_name_is_case_and_space_insensitive(self):
        cfg = dict(config.DEFAULTS, backend="  GWS ")
        self.assertEqual(cli.build_client(cfg).SOURCE_NAME, "gws")


class TestWriteSupport(unittest.TestCase):
    def test_eds_cannot_write(self):
        self.assertFalse(eds.Eds.can_write)


if __name__ == "__main__":
    unittest.main()
