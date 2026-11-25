import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from omarchy_calendar_sync import config, gws

GOOGLE_COMMAND = Path(__file__).resolve().parents[1] / "sync" / "omarchy-calendar-google"


class TestGoogleAccounts(unittest.TestCase):
    def test_shared_calendar_ids_route_reads_and_writes_to_the_selected_account(self):
        account = {"email": "work@example.com", "profile": "/work", "write": True}
        client = gws.GwsAccounts("/personal", "gws", [account])
        client.primary = Mock()
        work = Mock()
        client.additional["work%40example.com"] = (account, work)
        shared = {"id": "shared@example.com", "name": "Projects", "writable": True}
        client.primary.calendars.return_value = [shared]
        work.calendars.return_value = [shared]

        personal_calendar, work_calendar = config.select_calendars(
            client.calendars(), {"calendars": {"include": ["Projects"]}},
        )
        self.assertEqual(personal_calendar["id"], shared["id"])
        self.assertNotEqual(work_calendar["id"], shared["id"])
        self.assertIn(account["email"], work_calendar["name"])

        client.events(work_calendar["id"], "start", "end")
        client.get(work_calendar["id"], "event")
        client.create(work_calendar["id"], {"summary": "New"})
        client.update(work_calendar["id"], "event", {"summary": "Edited"})
        client.replace(work_calendar["id"], "event", {"summary": "Replaced"})
        client.delete(work_calendar["id"], "event")
        work.events.assert_called_once_with(shared["id"], "start", "end")
        work.get.assert_called_once_with(shared["id"], "event")
        work.create.assert_called_once_with(shared["id"], {"summary": "New"}, send_updates="none")
        work.update.assert_called_once_with(shared["id"], "event", {"summary": "Edited"}, send_updates="none")
        work.replace.assert_called_once_with(shared["id"], "event", {"summary": "Replaced"}, send_updates="none")
        work.delete.assert_called_once_with(shared["id"], "event", send_updates="none")
        self.assertEqual(len(client.primary.method_calls), 1)
        with self.assertRaises(gws.GwsNotFound):
            client.delete("gws:unknown:shared@example.com", "event")

        work.calendars.side_effect = gws.GwsAuthError("expired")
        self.assertEqual(client.calendars(), [shared])


class TestGoogleSignIn(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.profile = self.root / "original"
        self.profile.mkdir()
        (self.profile / "client_secret.json").write_text("original client")
        (self.profile / "credentials.enc").write_text("original credentials")
        self.config_path = self.root / ".config/omarchy/calendar-sync.json"
        self.config_path.parent.mkdir(parents=True)
        fake_gws = self.root / "gws"
        fake_gws.write_text("""#!/usr/bin/env python3
import json, os, sys
from pathlib import Path

env = os.environ
profile = Path(env["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"])
args = sys.argv[1:]
if profile.name == "original":
    assert args == ["auth", "status"]
    print(json.dumps({"user": "original@example.com"}))
else:
    assert env["GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND"] == "file"
    assert "GOOGLE_WORKSPACE_CLI_TOKEN" not in env
    assert (profile / "client_secret.json").read_text() == "original client"
    if args[:2] == ["auth", "login"]:
        assert args[2] == "--scopes"
        (profile / "credentials.enc").write_text(args[3])
        print("https://accounts.google.com/o/oauth2/auth?redirect_uri=http://localhost:1234",
              file=sys.stderr)
    elif args == ["auth", "status"]:
        scopes = (profile / "credentials.enc").read_text().split(",")
        if env.get("TEST_MISSING_SCOPES"):
            scopes = []
        print(json.dumps({"user": env["TEST_GOOGLE_USER"], "scopes": scopes}))
    elif args == ["calendar", "calendarList", "list"]:
        print(json.dumps({"items": [{"id": env["TEST_GOOGLE_USER"], "primary": True}]}))
    else:
        raise AssertionError(args)
""")
        fake_gws.chmod(0o700)
        systemctl = self.root / "systemctl"
        systemctl.write_text('#!/bin/sh\nprintf "%s\n" "$*" >> "$HOME/sync-requests"\n')
        systemctl.chmod(0o700)
        self.config_path.write_text(json.dumps({
            "profile": str(self.profile), "gwsPath": str(fake_gws), "write": True,
            "window": {"futureDays": 20}, "customKey": "keep",
        }))
        self.env = {
            **os.environ, "HOME": str(self.root), "PATH": f"{self.root}:{os.environ['PATH']}",
            "TEST_GOOGLE_USER": "work@example.com", "GOOGLE_WORKSPACE_CLI_TOKEN": "wrong-account",
        }

    def command(self, action, expected=0, **env):
        result = subprocess.run(
            [GOOGLE_COMMAND, action], env={**self.env, **env},
            capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def test_add_and_reconnect_keep_the_original_sign_in_and_config(self):
        self.assertTrue(self.command("status")[0]["available"])
        url, connected = self.command("add")
        self.assertTrue(url["url"].startswith("https://accounts.google.com/"))
        self.assertEqual(connected, {"result": "added", "email": "work@example.com", "syncing": True})
        initial = json.loads(self.config_path.read_text())
        account, = initial["googleAccounts"]
        self.assertTrue(account["write"])
        self.assertTrue(Path(account["profile"]).is_dir())
        self.assertEqual(self.command("status")[0], {
            "available": True, "primary": "original@example.com", "accounts": ["work@example.com"],
        })

        self.assertEqual(self.command("add")[-1]["result"], "reconnected")
        self.assertFalse(Path(account["profile"]).exists())
        self.assertEqual(self.command("add", TEST_GOOGLE_USER="original@example.com")[-1]["result"], "existing")
        current = json.loads(self.config_path.read_text())
        self.assertEqual(len(current["googleAccounts"]), 1)
        self.assertEqual(current["window"], {"futureDays": 20})
        self.assertEqual(current["customKey"], "keep")
        self.assertEqual((self.profile / "credentials.enc").read_text(), "original credentials")
        self.assertEqual(len((self.root / "sync-requests").read_text().splitlines()), 2)

    def test_missing_calendar_permissions_leave_config_and_credentials_alone(self):
        before = self.config_path.read_bytes()
        replies = self.command("add", expected=1, TEST_MISSING_SCOPES="1")
        self.assertIn("Calendar access was not granted", replies[-1]["error"])
        self.assertEqual(self.config_path.read_bytes(), before)
        self.assertEqual(list((self.profile / "accounts").glob("account-*")), [])
        self.assertFalse((self.root / "sync-requests").exists())


if __name__ == "__main__":
    unittest.main()
