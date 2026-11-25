import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from datetime import datetime, timezone
from importlib.util import find_spec
from pathlib import Path
from unittest.mock import Mock

from omarchy_calendar_sync import budget, cli, config, google_setup, gws

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

        account["write"] = False
        with self.assertRaisesRegex(gws.GwsError, "Writing is turned off for this Google account"):
            client.delete(work_calendar["id"], "another-event")
        work.delete.assert_called_once()
        client.get(work_calendar["id"], "another-event")
        work.get.assert_called_with(shared["id"], "another-event")

        work.calendars.side_effect = gws.GwsAuthError("expired")
        self.assertEqual(client.calendars(), [shared])

        work.calendars.side_effect = None
        client.primary.calendars.return_value = []
        exclude = {"calendars": {"exclude": [work_calendar["name"]]}}
        self.assertEqual(config.select_calendars(client.calendars(), exclude), [])

    def test_overall_deadline_stops_before_listing_another_account(self):
        account = {"email": "work@example.com", "profile": "/work"}
        client = gws.GwsAccounts("/personal", "gws", [account])
        client.primary = Mock()
        work = Mock()
        client.additional["work%40example.com"] = (account, work)
        client.primary.calendars.side_effect = budget.TookTooLong("deadline")
        with self.assertRaises(budget.TookTooLong):
            client.calendars()
        work.calendars.assert_not_called()

    def test_sync_keeps_healthy_calendars_when_one_calendar_cannot_list_events(self):
        account = {"email": "work@example.com", "profile": "/work", "write": True}
        client = gws.GwsAccounts("/personal", "gws", [account])
        client.primary = Mock()
        work = Mock()
        client.additional["work%40example.com"] = (account, work)
        client.primary.version.return_value = (0, 22, 5)
        client.primary.auth_hint.return_value = ""
        client.primary.calendars.return_value = [
            {"id": "personal", "name": "Personal", "color": "#123456", "writable": True},
        ]
        work.calendars.return_value = [
            {"id": "work", "name": "Work", "color": "#123456", "writable": True},
        ]
        client.primary.events.return_value = [{
            "id": "event", "summary": "Personal event",
            "start": {"date": "2026-08-10"}, "end": {"date": "2026-08-11"},
        }]
        work.events.side_effect = gws.GwsAuthError("403: forbidden")
        now = datetime(2026, 8, 10, tzinfo=timezone.utc)
        cfg = {**config.DEFAULTS, "write": True}

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "events.json"
            self.assertEqual(cli.run(client, cfg, now, out, timezone.utc), cli.EXIT_OK)
            snapshot = out.read_bytes()
            doc = json.loads(snapshot)
            self.assertEqual([event["title"] for event in doc["events"]], ["Personal event"])
            self.assertEqual([cal["id"] for cal in doc["writableCalendars"]], ["personal"])

            client.primary.events.side_effect = gws.GwsAuthError("403: forbidden")
            self.assertEqual(cli.run(client, cfg, now, out, timezone.utc), cli.EXIT_SYNC_FAILED)
            self.assertEqual(out.read_bytes(), snapshot)

            work.calendars.side_effect = gws.GwsAuthError("401: expired")
            cfg["calendars"] = {"include": ["Work"]}
            self.assertEqual(cli.run(client, cfg, now, out, timezone.utc), cli.EXIT_SYNC_FAILED)
            self.assertEqual(out.read_bytes(), snapshot)

    def test_added_account_write_errors_suggest_reconnecting_that_account(self):
        client = gws.Gws("/work", http=Mock(), isolated=True)
        client._access_token = "test"
        for code, message in ((401, "Invalid credentials"), (403, "insufficient authentication scopes")):
            with self.subTest(code=code):
                client._http.return_value = (code, json.dumps({"error": {"code": code, "message": message}}))
                with self.assertRaisesRegex(gws.GwsSignInError, "Reconnect this Google account"):
                    client.delete("work@example.com", "event")
        client._http.return_value = (403, json.dumps({"error": {"code": 403, "message": "Forbidden"}}))
        with self.assertRaisesRegex(gws.GwsAuthError, "403: Forbidden"):
            client.delete("work@example.com", "event")

    def test_sync_keeps_the_editable_copy_of_a_shared_google_calendar(self):
        account = {"email": "work@example.com", "profile": "/work", "write": True}
        client = gws.GwsAccounts("/personal", "gws", [account])
        client.primary = Mock()
        work = Mock()
        client.additional["work%40example.com"] = (account, work)
        client.primary.version.return_value = (0, 22, 5)
        shared = {"id": "shared", "name": "Projects", "color": "#123456"}
        client.primary.calendars.return_value = [{**shared, "writable": False}]
        work.calendars.return_value = [{**shared, "writable": True}]
        event = {
            "id": "event", "iCalUID": "event@example.com", "summary": "Shared project",
            "start": {"date": "2026-08-10"}, "end": {"date": "2026-08-11"},
        }
        client.primary.events.return_value = work.events.return_value = [event]
        now = datetime(2026, 8, 10, tzinfo=timezone.utc)
        cfg = {**config.DEFAULTS, "write": True}

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "events.json"
            self.assertEqual(cli.run(client, cfg, now, out, timezone.utc), cli.EXIT_OK)
            doc = json.loads(out.read_text())
            saved, = doc["events"]
            self.assertEqual(saved["calendarId"], doc["writableCalendars"][0]["id"])
            client.primary.events.assert_not_called()


class TestGoogleSignIn(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.profile = self.root / ".config/gws-omarchy-calendar"
        self.profile.mkdir(parents=True)
        (self.profile / "client_secret.json").write_text("original client")
        (self.profile / "credentials.enc").write_text("original credentials")
        self.config_path = self.root / ".config/omarchy/calendar-sync.json"
        self.config_path.parent.mkdir(parents=True)
        fake_gws = self.root / "gws"
        fake_gws.write_text("""#!/usr/bin/env python3
import json, os, sys, time
from pathlib import Path

env = os.environ
profile = Path(env["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"])
args = sys.argv[1:]
if profile.name == "gws-omarchy-calendar":
    assert args == ["auth", "status"]
    if env.get("TEST_WAIT_FOR_SETUP"):
        root = Path.home()
        (root / "checking-primary").touch()
        deadline = time.monotonic() + 5
        while not (root / "setup-finished").exists():
            if time.monotonic() >= deadline:
                raise SystemExit(1)
            time.sleep(0.02)
    print(json.dumps({"user": env.get("TEST_PRIMARY_USER", "original@example.com")}))
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

    def test_add_can_create_the_config_when_the_original_profile_uses_defaults(self):
        self.config_path.unlink()
        self.assertTrue(self.command("status")[0]["available"])
        self.assertEqual(self.command("add")[-1]["result"], "added")
        account, = json.loads(self.config_path.read_text())["googleAccounts"]
        self.assertFalse(account["write"])
        self.assertEqual(self.command("status")[0]["accounts"], ["work@example.com"])

    def test_add_updates_the_target_of_a_managed_config_symlink(self):
        target = self.root / "managed-calendar.json"
        self.config_path.rename(target)
        self.config_path.symlink_to(target)
        self.assertEqual(self.command("add")[-1]["result"], "added")
        self.assertTrue(self.config_path.is_symlink())
        self.assertEqual(json.loads(target.read_text())["googleAccounts"][0]["email"], "work@example.com")

    def test_primary_identity_is_verified_even_with_a_cached_address(self):
        original = json.loads(self.config_path.read_text())
        original["googlePrimaryEmail"] = "original@example.com"
        self.config_path.write_text(json.dumps(original))
        self.assertEqual(
            self.command("status", TEST_PRIMARY_USER="work@example.com")[-1]["primary"], "work@example.com",
        )
        self.assertEqual(self.command("add", TEST_PRIMARY_USER="work@example.com")[-1]["result"], "existing")
        self.assertEqual(
            self.command("add", TEST_PRIMARY_USER="work@example.com", TEST_GOOGLE_USER="original@example.com")[-1],
            {"result": "added", "email": "original@example.com", "syncing": True},
        )
        self.assertEqual(json.loads(self.config_path.read_text())["googlePrimaryEmail"], "work@example.com")

    def test_inconclusive_primary_verification_does_not_add_a_duplicate(self):
        current = json.loads(self.config_path.read_text())
        current["googlePrimaryEmail"] = "work@example.com"
        self.config_path.write_text(json.dumps(current))
        before = self.config_path.read_bytes()
        reply = self.command("add", expected=1, TEST_PRIMARY_USER="")[-1]
        self.assertIn("Could not verify the original", reply["error"])
        self.assertEqual(self.config_path.read_bytes(), before)

    def test_selecting_the_original_account_reconciles_an_existing_duplicate(self):
        self.assertEqual(self.command("add")[-1]["result"], "added")
        previous, = json.loads(self.config_path.read_text())["googleAccounts"]
        reply = self.command("add", TEST_PRIMARY_USER="work@example.com")[-1]
        self.assertEqual(reply["result"], "existing")
        current = json.loads(self.config_path.read_text())
        self.assertEqual(current["googlePrimaryEmail"], "work@example.com")
        self.assertEqual(current["googleAccounts"], [])
        self.assertFalse(Path(previous["profile"]).exists())

    def test_retiring_accounts_preserves_any_active_or_custom_profile(self):
        accounts = self.profile / "accounts"
        promoted = accounts / "account-aaaaaaaa"
        retained = accounts / "account-bbbbbbbb"
        custom = self.root / "account-cccccccc"
        retired = accounts / "account-dddddddd"
        for path in (promoted, retained, custom, retired):
            path.mkdir(parents=True)
            (path / "credentials.enc").touch()

        previous = [{"profile": str(path)} for path in (promoted, retained, custom, retired)]
        google_setup.retire_profiles(previous, [{"profile": str(retained)}], promoted, self.profile)
        self.assertFalse(retired.exists())
        for path in (promoted, retained, custom):
            self.assertTrue((path / "credentials.enc").exists())

    def test_add_does_not_overwrite_an_original_account_changed_by_setup(self):
        before = json.loads(self.config_path.read_text())
        before["googlePrimaryEmail"] = "original@example.com"
        self.config_path.write_text(json.dumps(before))
        with subprocess.Popen(
            [GOOGLE_COMMAND, "add"], env={**self.env, "TEST_WAIT_FOR_SETUP": "1"},
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        ) as process:
            deadline = time.monotonic() + 5
            while not (self.root / "checking-primary").exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue((self.root / "checking-primary").exists())
            with config.locked_path(self.config_path) as path:
                updated = {**before, "googlePrimaryEmail": "work@example.com"}
                cli.write_atomic(path, updated)
                (self.root / "setup-finished").touch()
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 1, stdout + stderr)
            self.assertIn("Calendar setup changed during sign-in", json.loads(stdout.splitlines()[-1])["error"])
        self.assertEqual(json.loads(self.config_path.read_text()), updated)
        self.assertEqual(list((self.profile / "accounts").glob("account-*")), [])

    @unittest.skipUnless(shutil.which("script") and find_spec("icalendar"), "needs script and iCalendar")
    def test_ics_setup_keeps_a_google_account_added_while_testing_the_feed(self):
        source = GOOGLE_COMMAND.parent
        sync = self.root / "sync"
        sync.mkdir()
        shutil.copy(source / "setup", sync)
        shutil.copytree(source / "systemd", sync / "systemd")
        (sync / "omarchy_calendar_sync").symlink_to(source / "omarchy_calendar_sync")
        validator = sync / "omarchy-calendar-sync"
        validator.write_text("""#!/usr/bin/env python3
import time
from pathlib import Path

home = Path.home()
(home / "validating").touch()
deadline = time.monotonic() + 10
while not (home / "validated").exists():
    if time.monotonic() >= deadline:
        raise SystemExit(1)
    time.sleep(0.02)
""")
        validator.chmod(0o700)
        with subprocess.Popen(
            ["script", "-qec", f"{sync / 'setup'} --ics", "/dev/null"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            env=self.env, text=True,
        ) as wizard:
            wizard.stdin.write("https://example.com/calendar.ics\n\n\n")
            wizard.stdin.flush()
            try:
                deadline = time.monotonic() + 5
                while not (self.root / "validating").exists() and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue((self.root / "validating").exists())
                self.assertEqual(self.command("add")[-1]["result"], "added")
            finally:
                (self.root / "validated").touch()
                output, _ = wizard.communicate(timeout=15)
            self.assertEqual(wizard.returncode, 0, output)

        current = json.loads(self.config_path.read_text())
        self.assertEqual(current["backend"], "ics")
        self.assertEqual(current["googleAccounts"][0]["email"], "work@example.com")


if __name__ == "__main__":
    unittest.main()
