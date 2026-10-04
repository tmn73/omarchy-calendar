import contextlib
import io
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from omarchy_calendar_sync import localzone


class TestResolveLocalTimezone(unittest.TestCase):
    def test_tz_env_var_wins(self):
        tz = localzone.resolve_local_timezone(
            env={"TZ": "America/New_York"}, localtime_path="/nonexistent/localtime"
        )
        self.assertEqual(getattr(tz, "key", None), "America/New_York")

    def test_tz_env_var_with_leading_colon_is_accepted(self):
        tz = localzone.resolve_local_timezone(
            env={"TZ": ":America/Bogota"}, localtime_path="/nonexistent/localtime"
        )
        self.assertEqual(getattr(tz, "key", None), "America/Bogota")

    def test_garbage_tz_env_var_falls_through_rather_than_raising(self):
        with contextlib.redirect_stderr(io.StringIO()):
            tz = localzone.resolve_local_timezone(
                env={"TZ": "Not/AZone"}, localtime_path="/nonexistent/localtime"
            )
        self.assertIsNone(getattr(tz, "key", None))
        self.assertIsNotNone(tz.utcoffset(datetime.now()))

    def test_symlinked_localtime_resolves_to_the_right_zone_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            zoneinfo_dir = Path(tmp) / "usr" / "share" / "zoneinfo" / "America"
            zoneinfo_dir.mkdir(parents=True)
            zone_file = zoneinfo_dir / "Bogota"
            zone_file.write_text("not a real tzfile, just needs to exist")

            localtime_path = Path(tmp) / "etc" / "localtime"
            localtime_path.parent.mkdir(parents=True)
            os.symlink(zone_file, localtime_path)

            tz = localzone.resolve_local_timezone(env={}, localtime_path=str(localtime_path))
            self.assertEqual(getattr(tz, "key", None), "America/Bogota")

    def test_real_file_instead_of_symlink_falls_through(self):
        with tempfile.TemporaryDirectory() as tmp:
            localtime_path = Path(tmp) / "localtime"
            localtime_path.write_text("not a symlink")

            with contextlib.redirect_stderr(io.StringIO()):
                tz = localzone.resolve_local_timezone(env={}, localtime_path=str(localtime_path))
            self.assertIsNone(getattr(tz, "key", None))
            self.assertIsNotNone(tz.utcoffset(datetime.now()))

    def test_final_fallback_returns_a_usable_tzinfo_and_warns(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            tz = localzone.resolve_local_timezone(env={}, localtime_path="/nonexistent/localtime")
        self.assertIsNone(getattr(tz, "key", None))
        self.assertIsNotNone(tz.utcoffset(datetime.now()))
        self.assertIn("timezone", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
