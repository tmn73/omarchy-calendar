import json
import unittest
from pathlib import Path

from omarchy_calendar_sync import gws

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name):
    return (FIXTURES / name).read_text()


class FakeRunner:
    """Records argv and replays canned responses keyed by a marker in argv."""

    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def __call__(self, argv, env):
        self.calls.append((argv, env))
        for marker, response in self.responses.items():
            if marker in argv:
                return response
        raise AssertionError(f"unexpected argv: {argv}")


class SequentialFakeRunner:
    """Records argv and replays one response per call, in order.

    Once the list of canned responses is exhausted, the last one keeps
    being replayed, which is what a server stuck returning the same
    nextPageToken forever would look like.
    """

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, argv, env):
        index = min(len(self.calls), len(self.responses) - 1)
        self.calls.append((argv, env))
        return self.responses[index]


class TestVersion(unittest.TestCase):
    def test_parses_version_line(self):
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"--version": (0, "gws 0.13.2\nnote\n", "")}))
        self.assertEqual(client.version(), (0, 13, 2))

    def test_missing_binary_raises(self):
        def runner(argv, env):
            raise FileNotFoundError("gws")

        with self.assertRaises(gws.GwsMissing):
            gws.Gws("/tmp/profile", runner=runner).check()

    def test_old_version_raises(self):
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"--version": (0, "gws 0.12.0\n", "")}))
        with self.assertRaises(gws.GwsTooOld):
            client.check()

    def test_current_version_passes(self):
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"--version": (0, "gws 0.13.2\n", "")}))
        client.check()

    def test_unparseable_version_names_exit_code_and_stderr(self):
        # A wrapper that cannot find node under systemd's PATH exits 127 with
        # nothing on stdout. The reason is only on stderr.
        stderr = ".bin/gws: line 18: exec: node: not found\n"
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"--version": (127, "", stderr)}))
        with self.assertRaises(gws.GwsApiError) as caught:
            client.version()
        self.assertIn("exit 127", str(caught.exception))
        self.assertIn("exec: node: not found", str(caught.exception))


class TestCalendars(unittest.TestCase):
    def test_maps_to_id_name_color_primary(self):
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"calendarList": (0, fixture("google-calendars.json"), "keyring noise")}))
        calendars = client.calendars()
        # Only the primary calendar carries "primary" in calendarList, so a
        # missing field means False.
        self.assertEqual(
            calendars,
            [
                {"id": "a@example.com", "name": "Personal", "color": "#f83a22", "primary": True, "writable": False},
                {"id": "b@example.com", "name": "Phases of the Moon", "color": "#fad165", "primary": False, "writable": False},
            ],
        )

    def test_missing_color_falls_back(self):
        body = json.dumps({"items": [{"id": "x", "summary": "No Color"}]})
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"calendarList": (0, body, "")}))
        self.assertEqual(client.calendars()[0]["color"], gws.FALLBACK_COLOR)

    def test_summary_override_wins_over_summary(self):
        body = json.dumps({"items": [{"id": "x@import.calendar.google.com", "summary": "Calendar", "summaryOverride": "Fastell Calendar"}]})
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"calendarList": (0, body, "")}))
        self.assertEqual(client.calendars()[0]["name"], "Fastell Calendar")

    def test_missing_summary_falls_back_to_id(self):
        body = json.dumps({"items": [{"id": "x@example.com", "backgroundColor": "#ffffff"}]})
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"calendarList": (0, body, "")}))
        self.assertEqual(client.calendars()[0]["name"], "x@example.com")


class TestEvents(unittest.TestCase):
    def test_returns_raw_items(self):
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"events": (0, fixture("google-events.json"), "")}))
        items = client.events("a@example.com", "2026-08-01T00:00:00+00:00", "2026-09-01T00:00:00+00:00")
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], "evt1")

    def test_passes_single_events_and_window(self):
        runner = FakeRunner({"events": (0, fixture("google-events.json"), "")})
        gws.Gws("/tmp/profile", runner=runner).events("a@example.com", "MIN", "MAX")
        argv = runner.calls[0][0]
        params = json.loads(argv[argv.index("--params") + 1])
        self.assertTrue(params["singleEvents"])
        self.assertEqual(params["orderBy"], "startTime")
        self.assertEqual(params["timeMin"], "MIN")
        self.assertEqual(params["timeMax"], "MAX")
        self.assertEqual(params["calendarId"], "a@example.com")

    def test_sets_profile_env_var(self):
        runner = FakeRunner({"events": (0, fixture("google-events.json"), "")})
        gws.Gws("/my/profile", runner=runner).events("a", "MIN", "MAX")
        env = runner.calls[0][1]
        self.assertEqual(env["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"], "/my/profile")


class TestEventsPagination(unittest.TestCase):
    def test_two_page_response_accumulates_items_from_both_pages(self):
        page_one = (0, json.dumps({"items": [{"id": "evt1"}], "nextPageToken": "page2"}), "")
        page_two = (0, json.dumps({"items": [{"id": "evt2"}]}), "")
        runner = SequentialFakeRunner([page_one, page_two])
        client = gws.Gws("/tmp/profile", runner=runner)
        items = client.events("a@example.com", "MIN", "MAX")
        self.assertEqual([item["id"] for item in items], ["evt1", "evt2"])
        self.assertEqual(len(runner.calls), 2)

    def test_page_token_is_sent_on_the_second_request(self):
        page_one = (0, json.dumps({"items": [], "nextPageToken": "page2"}), "")
        page_two = (0, json.dumps({"items": []}), "")
        runner = SequentialFakeRunner([page_one, page_two])
        gws.Gws("/tmp/profile", runner=runner).events("a@example.com", "MIN", "MAX")

        first_argv = runner.calls[0][0]
        first_params = json.loads(first_argv[first_argv.index("--params") + 1])
        self.assertNotIn("pageToken", first_params)

        second_argv = runner.calls[1][0]
        second_params = json.loads(second_argv[second_argv.index("--params") + 1])
        self.assertEqual(second_params["pageToken"], "page2")

    def test_single_events_and_order_by_are_present_on_the_second_page(self):
        page_one = (0, json.dumps({"items": [], "nextPageToken": "page2"}), "")
        page_two = (0, json.dumps({"items": []}), "")
        runner = SequentialFakeRunner([page_one, page_two])
        gws.Gws("/tmp/profile", runner=runner).events("a@example.com", "MIN", "MAX")

        second_argv = runner.calls[1][0]
        second_params = json.loads(second_argv[second_argv.index("--params") + 1])
        self.assertTrue(second_params["singleEvents"])
        self.assertEqual(second_params["orderBy"], "startTime")

    def test_max_pages_exceeded_raises_api_error(self):
        looping_page = (0, json.dumps({"items": [], "nextPageToken": "same-token-forever"}), "")
        runner = SequentialFakeRunner([looping_page])
        client = gws.Gws("/tmp/profile", runner=runner)
        with self.assertRaises(gws.GwsApiError):
            client.events("a@example.com", "MIN", "MAX")
        self.assertEqual(len(runner.calls), gws.MAX_PAGES)


class TestErrors(unittest.TestCase):
    def test_401_raises_auth_error(self):
        body = json.dumps({"error": {"code": 401, "message": "invalid_grant"}})
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"events": (0, body, "")}))
        with self.assertRaises(gws.GwsAuthError):
            client.events("a", "MIN", "MAX")

    def test_403_raises_auth_error(self):
        body = json.dumps({"error": {"code": 403, "message": "insufficient scopes"}})
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"events": (0, body, "")}))
        with self.assertRaises(gws.GwsAuthError):
            client.events("a", "MIN", "MAX")

    def test_other_error_code_raises_api_error(self):
        body = json.dumps({"error": {"code": 500, "message": "boom"}})
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"events": (0, body, "")}))
        with self.assertRaises(gws.GwsApiError):
            client.events("a", "MIN", "MAX")

    def test_unparseable_stdout_raises_api_error(self):
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"events": (0, "not json", "")}))
        with self.assertRaises(gws.GwsApiError):
            client.events("a", "MIN", "MAX")

    def test_nonzero_exit_code_raises_api_error_naming_code_and_stderr(self):
        runner = FakeRunner({"events": (1, "", "permission denied")})
        client = gws.Gws("/tmp/profile", runner=runner)
        with self.assertRaises(gws.GwsApiError) as context:
            client.events("a", "MIN", "MAX")
        message = str(context.exception)
        self.assertIn("1", message)
        self.assertIn("permission denied", message)

    def test_empty_error_object_does_not_pass_as_success(self):
        body = json.dumps({"error": {}})
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"events": (0, body, "")}))
        with self.assertRaises(gws.GwsApiError):
            client.events("a", "MIN", "MAX")


if __name__ == "__main__":
    unittest.main()


class TestConfigurableBinary(unittest.TestCase):
    def test_defaults_to_the_bare_name(self):
        runner = FakeRunner({"--version": (0, "gws 0.13.2\n", "")})
        gws.Gws("/tmp/profile", runner=runner).version()
        self.assertEqual(runner.calls[0][0][0], "gws")

    def test_uses_an_absolute_path_when_configured(self):
        runner = FakeRunner({"--version": (0, "gws 0.13.2\n", "")})
        gws.Gws("/tmp/profile", runner=runner, binary="/opt/bin/gws").version()
        self.assertEqual(runner.calls[0][0][0], "/opt/bin/gws")

    def test_empty_binary_falls_back_to_the_bare_name(self):
        runner = FakeRunner({"--version": (0, "gws 0.13.2\n", "")})
        gws.Gws("/tmp/profile", runner=runner, binary="").version()
        self.assertEqual(runner.calls[0][0][0], "gws")

    def test_missing_binary_message_names_it_and_explains_path(self):
        def runner(argv, env):
            raise FileNotFoundError(argv[0])

        with self.assertRaises(gws.GwsMissing) as caught:
            gws.Gws("/tmp/profile", runner=runner, binary="/opt/bin/gws").check()
        message = str(caught.exception)
        self.assertIn("/opt/bin/gws", message)
        self.assertIn("gwsPath", message)


class TestWrites(unittest.TestCase):
    BODY = {
        "summary": "Lunch",
        "start": {"dateTime": "2026-09-26T12:00:00-05:00"},
        "end": {"dateTime": "2026-09-26T12:30:00-05:00"},
    }

    def test_create_sends_the_calendar_and_the_body_as_json(self):
        reply = {"id": "new1", "summary": "Lunch"}
        runner = FakeRunner({"insert": (0, json.dumps(reply), "")})
        client = gws.Gws("/tmp/profile", runner=runner)
        self.assertEqual(client.create("me@example.com", self.BODY), reply)
        argv = runner.calls[0][0]
        self.assertEqual(argv[1:4], ["calendar", "events", "insert"])
        self.assertEqual(
            json.loads(argv[argv.index("--params") + 1]),
            {"calendarId": "me@example.com", "sendUpdates": "none", "conferenceDataVersion": 1},
        )
        self.assertEqual(json.loads(argv[argv.index("--json") + 1]), self.BODY)

    def test_update_patches_by_event_id(self):
        runner = FakeRunner({"patch": (0, json.dumps({"id": "ev1"}), "")})
        client = gws.Gws("/tmp/profile", runner=runner)
        client.update("me@example.com", "ev1", self.BODY)
        argv = runner.calls[0][0]
        self.assertEqual(argv[1:4], ["calendar", "events", "patch"])
        self.assertEqual(
            json.loads(argv[argv.index("--params") + 1]),
            {"calendarId": "me@example.com", "eventId": "ev1", "sendUpdates": "none", "conferenceDataVersion": 1},
        )

    def test_delete_accepts_an_empty_reply(self):
        runner = FakeRunner({"delete": (0, "", "keyring noise")})
        client = gws.Gws("/tmp/profile", runner=runner)
        self.assertIsNone(client.delete("me@example.com", "ev1"))
        self.assertNotIn("--json", runner.calls[0][0])
        self.assertEqual(len(runner.calls), 1)

    def test_delete_of_a_missing_event_raises_not_found(self):
        body = json.dumps({"error": {"code": 404, "message": "Not Found"}})
        runner = FakeRunner({"delete": (0, body, "")})
        client = gws.Gws("/tmp/profile", runner=runner)
        with self.assertRaises(gws.GwsNotFound):
            client.delete("me@example.com", "gone")
        self.assertEqual(len(runner.calls), 1)

    def test_a_write_without_the_scope_raises_auth_error(self):
        body = json.dumps({"error": {"code": 403, "message": "insufficient scopes"}})
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"insert": (0, body, "")}))
        with self.assertRaises(gws.GwsAuthError):
            client.create("me@example.com", self.BODY)

    def test_owner_and_writer_calendars_are_writable(self):
        body = json.dumps({"items": [
            {"id": "a", "summary": "A", "accessRole": "owner"},
            {"id": "b", "summary": "B", "accessRole": "writer"},
            {"id": "c", "summary": "C", "accessRole": "reader"},
            {"id": "d", "summary": "D"},
        ]})
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"calendarList": (0, body, "")}))
        writable = {c["id"]: c["writable"] for c in client.calendars()}
        self.assertEqual(writable, {"a": True, "b": True, "c": False, "d": False})


class TestErrorsWithANonzeroExit(unittest.TestCase):
    # Verified live on gws 0.13.2: an API error exits 1, prints the JSON
    # error on stdout, and leaves only keyring noise on stderr.
    NOISE = "Using keyring backend: keyring\n"

    def test_an_api_error_is_read_from_stdout(self):
        body = json.dumps({"error": {"code": 403, "message": "insufficient scopes"}})
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"events": (1, body, self.NOISE)}))
        with self.assertRaises(gws.GwsAuthError) as caught:
            client.events("a", "MIN", "MAX")
        self.assertIn("insufficient scopes", str(caught.exception))

    def test_a_deleted_event_raises_not_found(self):
        body = json.dumps({"error": {"code": 410, "message": "Resource has been deleted", "reason": "deleted"}})
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"delete": (1, body, self.NOISE)}))
        with self.assertRaises(gws.GwsNotFound):
            client.delete("me@example.com", "gone")


class TestGetAndParameters(unittest.TestCase):
    def params(self, runner):
        argv = runner.calls[0][0]
        return json.loads(argv[argv.index("--params") + 1])

    def test_get_reads_one_event(self):
        runner = FakeRunner({"get": (0, json.dumps({"id": "ev1"}), "")})
        self.assertEqual(gws.Gws("/tmp/profile", runner=runner).get("me@example.com", "ev1"), {"id": "ev1"})
        argv = runner.calls[0][0]
        self.assertEqual(argv[1:4], ["calendar", "events", "get"])
        self.assertEqual(self.params(runner), {"calendarId": "me@example.com", "eventId": "ev1"})

    def test_invitations_are_sent_only_when_asked(self):
        runner = FakeRunner({"insert": (0, json.dumps({"id": "n"}), "")})
        gws.Gws("/tmp/profile", runner=runner).create("me@example.com", {}, send_updates="all")
        self.assertEqual(self.params(runner)["sendUpdates"], "all")

    def test_delete_passes_send_updates(self):
        runner = FakeRunner({"delete": (0, "", "")})
        gws.Gws("/tmp/profile", runner=runner).delete("me@example.com", "ev1", send_updates="all")
        self.assertEqual(self.params(runner), {"calendarId": "me@example.com", "eventId": "ev1", "sendUpdates": "all"})

    def test_an_unknown_send_updates_value_is_refused(self):
        client = gws.Gws("/tmp/profile", runner=FakeRunner({}))
        with self.assertRaises(ValueError):
            client.create("me@example.com", {}, send_updates="externalOnly")


class TestReplace(unittest.TestCase):
    def test_replace_puts_the_whole_event(self):
        runner = FakeRunner({"update": (0, json.dumps({"id": "ev1"}), "")})
        gws.Gws("/tmp/profile", runner=runner).replace("me@example.com", "ev1", {"summary": "S"}, send_updates="none")
        argv = runner.calls[0][0]
        self.assertEqual(argv[1:4], ["calendar", "events", "update"])
        self.assertEqual(
            json.loads(argv[argv.index("--params") + 1]),
            {"calendarId": "me@example.com", "eventId": "ev1", "sendUpdates": "none", "conferenceDataVersion": 1},
        )
        self.assertEqual(json.loads(argv[argv.index("--json") + 1]), {"summary": "S"})
