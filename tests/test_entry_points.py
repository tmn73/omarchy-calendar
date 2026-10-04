import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SYNC_DIR = Path(__file__).resolve().parents[1] / "sync"


class TestEntryPoints(unittest.TestCase):
    def test_compiled_modules_stay_out_of_the_plugin_folder(self):
        # The shell reloads the plugin on any change in its folder. A .pyc
        # written there by the first run after an update closed the panel and
        # killed a save halfway, after Google had the event.
        with tempfile.TemporaryDirectory() as tmp:
            plugin_sync = Path(tmp) / "plugin" / "sync"
            shutil.copytree(SYNC_DIR, plugin_sync, ignore=shutil.ignore_patterns("__pycache__"))
            cache = Path(tmp) / "cache"
            env = {**os.environ, "XDG_CACHE_HOME": str(cache), "HOME": tmp}
            env.pop("PYTHONDONTWRITEBYTECODE", None)
            env.pop("PYTHONPYCACHEPREFIX", None)

            subprocess.run([sys.executable, str(plugin_sync / "omarchy-calendar-event")],
                           input='{"action": "nope"}', env=env, capture_output=True, text=True, timeout=60)
            subprocess.run([sys.executable, str(plugin_sync / "omarchy-calendar-sync"), "--help"],
                           env=env, capture_output=True, text=True, timeout=60)

            self.assertEqual(list(plugin_sync.rglob("__pycache__")), [])
            self.assertTrue(any((cache / "omarchy-calendar").rglob("event_cli*.pyc")))
            self.assertTrue(any((cache / "omarchy-calendar").rglob("cli*.pyc")))


if __name__ == "__main__":
    unittest.main()
