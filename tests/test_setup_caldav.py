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

# Stands in for the test sync: passes or fails on demand.
FAKE_SYNC = '#!/bin/sh\nexit "${FAKE_FAIL:-0}"\n'


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

    def setup(self, server, password, test_passes):
        answers = "https://%s/\nme\n%s\n" % (server, password)
        command = "%s --caldav --write" % (self.root / "sync" / "setup")
        env = dict(self.env, FAKE_FAIL="0" if test_passes else "1")
        subprocess.run(
            ["script", "-qec", command, "/dev/null"],
            input=answers, text=True, env=env, capture_output=True, timeout=30,
        )

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


if __name__ == "__main__":
    unittest.main()
