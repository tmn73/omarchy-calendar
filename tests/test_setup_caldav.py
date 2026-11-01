"""Tests for `sync/setup --caldav`, run end to end against a fake keyring."""

import json
import os
import pathlib
import shutil
import stat
import subprocess
import tempfile
import unittest

REPO = pathlib.Path(__file__).resolve().parent.parent

# secret-tool's lookup and clear treat an attribute left out as a wildcard.
FAKE_SECRET_TOOL = r'''#!/usr/bin/env python3
import glob, json, os, sys, uuid
keyring = os.environ["FAKE_KEYRING"]
command, words = sys.argv[1], [w for w in sys.argv[2:] if not w.startswith("--label")]
attrs = dict(zip(words[::2], words[1::2]))
items = []
for name in sorted(glob.glob(keyring + "/*.json")):
    with open(name) as stream:
        items.append(dict(json.load(stream), path=name))
matches = [i for i in items if all(i["attrs"].get(k) == v for k, v in attrs.items())]
if command == "store":
    for item in items:
        if item["attrs"] == attrs:
            os.remove(item["path"])
    with open("%s/%s.json" % (keyring, uuid.uuid4().hex), "w") as stream:
        json.dump({"attrs": attrs, "secret": sys.stdin.read()}, stream)
elif command == "lookup":
    if not matches:
        sys.exit(1)
    print(matches[0]["secret"])
elif command == "clear":
    for item in matches:
        os.remove(item["path"])
'''

# Stands in for the test sync: passes or fails on demand. FAKE_LOCK makes
# the config folder read-only, so the step after a passing test fails.
FAKE_SYNC = """#!/bin/sh
[ -z "$FAKE_LOCK" ] || chmod 555 "$(dirname "$2")"
exit "${FAKE_FAIL:-0}"
"""

# What setups before 0.9.4 wrote: a lookup that names no server.
LEGACY_LOOKUP = ["secret-tool", "lookup", "service", "omarchy-calendar-caldav", "username", "me"]


def _executable(path, text):
    path.write_text(text)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


@unittest.skipUnless(shutil.which("script"), "needs script(1) for a terminal")
class SetupCaldavTest(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        sync = self.root / "sync"
        (sync / "systemd").mkdir(parents=True)
        shutil.copy(REPO / "sync" / "setup", sync / "setup")
        # The setup checks the address with the sync's own code.
        (sync / "omarchy_calendar_sync").symlink_to(REPO / "sync" / "omarchy_calendar_sync")
        for unit in ("service", "timer"):
            (sync / "systemd" / ("omarchy-calendar-sync." + unit)).touch()
        _executable(sync / "omarchy-calendar-sync", FAKE_SYNC)
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        _executable(bin_dir / "secret-tool", FAKE_SECRET_TOOL)
        _executable(bin_dir / "systemctl", "#!/bin/sh\nexit 0\n")
        (self.root / "keyring").mkdir()
        self.env = dict(
            os.environ,
            HOME=str(self.root / "home"),
            PATH="%s:%s" % (bin_dir, os.environ["PATH"]),
            FAKE_KEYRING=str(self.root / "keyring"),
        )

    def setup(self, server, password, test_passes, commit_fails=False):
        url = server if "://" in server else "https://%s/" % server
        answers = "%s\nme\n%s\n" % (url, password)
        command = "%s --caldav --write" % (self.root / "sync" / "setup")
        env = dict(self.env, FAKE_FAIL="0" if test_passes else "1")
        if commit_fails:
            env["FAKE_LOCK"] = "1"
            self.addCleanup((self.root / "home/.config/omarchy").chmod, 0o755)
        subprocess.run(
            ["script", "-qec", command, "/dev/null"],
            input=answers, text=True, env=env, capture_output=True, timeout=30,
        )

    def setup_before_0_9_4(self, password):
        """The config and keyring entry an older setup left for a.example."""
        config_dir = self.root / "home/.config/omarchy"
        config_dir.mkdir(parents=True)
        account = {"url": "https://a.example/", "username": "me", "passwordCommand": LEGACY_LOOKUP}
        (config_dir / "calendar-sync.json").write_text(json.dumps({"backend": "caldav", "caldav": account}))
        subprocess.run(
            ["secret-tool", "store", "--label=old", "service", "omarchy-calendar-caldav", "username", "me"],
            input=password, text=True, env=self.env, check=True,
        )

    def legacy_lookup(self):
        return subprocess.run(LEGACY_LOOKUP, env=self.env, capture_output=True, text=True).stdout.strip()

    def password_the_config_finds(self):
        config = json.loads((self.root / "home/.config/omarchy/calendar-sync.json").read_text())
        account = config["caldav"]
        found = subprocess.run(account["passwordCommand"], env=self.env, capture_output=True, text=True)
        return account["url"], found.stdout.strip()

    def test_a_failed_setup_for_another_server_keeps_the_current_password(self):
        self.setup("a.example", "password-a", test_passes=True)
        self.setup("b.example", "password-b", test_passes=False)
        self.assertEqual(self.password_the_config_finds(), ("https://a.example/", "password-a"))

    def test_a_failed_setup_leaves_no_test_entry_in_the_keyring(self):
        self.setup("a.example", "password-a", test_passes=True)
        self.setup("b.example", "password-b", test_passes=False)
        self.assertEqual(len(list((self.root / "keyring").iterdir())), 1)

    def test_a_passing_setup_moves_the_config_to_the_new_server(self):
        self.setup("a.example", "password-a", test_passes=True)
        self.setup("b.example", "password-b", test_passes=True)
        self.assertEqual(self.password_the_config_finds(), ("https://b.example/", "password-b"))

    def test_an_address_that_only_looks_local_is_refused_before_the_password(self):
        self.setup("http://localhost:x@evil.example/", "password-b", test_passes=True)
        self.assertFalse((self.root / "home/.config/omarchy/calendar-sync.json").exists())
        self.assertEqual(list((self.root / "keyring").iterdir()), [])

    # A sync that still runs on the old config, during or after the setup,
    # must never find the new server's password.

    def test_an_older_config_never_finds_the_password_of_a_failed_setup(self):
        self.setup_before_0_9_4("password-a")
        self.setup("b.example", "password-b", test_passes=False)
        self.assertEqual(self.legacy_lookup(), "password-a")
        self.assertEqual(self.password_the_config_finds(), ("https://a.example/", "password-a"))

    def test_an_older_config_never_finds_the_password_of_a_passing_setup(self):
        self.setup_before_0_9_4("password-a")
        self.setup("b.example", "password-b", test_passes=True)
        self.assertEqual(self.legacy_lookup(), "password-a")
        self.assertEqual(self.password_the_config_finds(), ("https://b.example/", "password-b"))

    def test_a_failure_after_a_passing_test_keeps_the_older_config_on_its_password(self):
        self.setup_before_0_9_4("password-a")
        self.setup("b.example", "password-b", test_passes=True, commit_fails=True)
        self.assertEqual(self.password_the_config_finds(), ("https://a.example/", "password-a"))


if __name__ == "__main__":
    unittest.main()
