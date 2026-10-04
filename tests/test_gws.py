import json
import unittest
import urllib.parse
from pathlib import Path
from zoneinfo import ZoneInfo

from omarchy_calendar_sync import gws, normalize

BOGOTA = ZoneInfo("America/Bogota")

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
                {"id": "a@example.com", "name": "Personal", "color": "#f83a22", "primary": True, "writable": False,
                 "defaultReminders": [{"method": "popup", "minutes": 10}, {"method": "email", "minutes": 1440}]},
                {"id": "b@example.com", "name": "Phases of the Moon", "color": "#fad165", "primary": False, "writable": False,
                 "defaultReminders": []},
            ],
        )

    def test_events_following_the_defaults_get_the_calendars_popup_minutes(self):
        client = gws.Gws("/tmp/profile", runner=FakeRunner({"calendarList": (0, fixture("google-calendars.json"), "")}))
        personal, moon = client.calendars()
        event = json.loads(fixture("google-events.json"))["items"][0]
        event["reminders"] = {"useDefault": True}
        self.assertEqual(normalize.normalize_event(event, personal, BOGOTA)[0]["reminders"], [10])
        self.assertEqual(normalize.normalize_event(event, moon, BOGOTA)[0]["reminders"], [])

        event["reminders"] = {"useDefault": False, "overrides": [
            {"method": "popup", "minutes": 30}, {"method": "email", "minutes": 60}, {"method": "popup", "minutes": 5},
        ]}
        self.assertEqual(normalize.normalize_event(event, personal, BOGOTA)[0]["reminders"], [5, 30])

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


CREDENTIALS = {
    "client_id": "123-abc.apps.googleusercontent.com",
    "client_secret": "client-secret-value",
    "refresh_token": "1//refresh-token-value",
    "type": "authorized_user",
}
TOKEN_REPLY = {"access_token": "access-token-value", "expires_in": 3599, "token_type": "Bearer"}


class FakeHttp:
    """Records each HTTPS request and replays canned (status, body) replies.

    The token endpoint always answers with TOKEN_REPLY unless a reply for
    it is given; Calendar requests take the canned replies in order.
    """

    def __init__(self, replies, token_reply=(200, json.dumps(TOKEN_REPLY))):
        self.replies = list(replies)
        self.token_reply = token_reply
        self.calls = []

    def __call__(self, method, url, headers, data):
        self.calls.append({"method": method, "url": url, "headers": headers, "data": data})
        if url == gws.TOKEN_URL:
            return self.token_reply
        return self.replies.pop(0)

    def api_calls(self):
        return [call for call in self.calls if call["url"] != gws.TOKEN_URL]


def writer(replies, credentials=CREDENTIALS, export=None, token_reply=None):
    export = export or (0, json.dumps(credentials), "Using keyring backend: keyring\n")
    runner = FakeRunner({"export": export})
    http = FakeHttp(replies) if token_reply is None else FakeHttp(replies, token_reply)
    return gws.Gws("/tmp/profile", runner=runner, http=http), runner, http


def query(url):
    return dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))


def path(url):
    return urllib.parse.urlsplit(url).path


class TestWrites(unittest.TestCase):
    BODY = {
        "summary": "Lunch",
        "description": "Private notes",
        "attendees": [{"email": "guest@example.com"}],
        "start": {"dateTime": "2026-09-26T12:00:00-05:00"},
        "end": {"dateTime": "2026-09-26T12:30:00-05:00"},
    }

    def test_create_posts_the_body_to_the_calendar(self):
        reply = {"id": "new1", "summary": "Lunch"}
        client, _, http = writer([(200, json.dumps(reply))])
        self.assertEqual(client.create("me@example.com", self.BODY), reply)
        call = http.api_calls()[0]
        self.assertEqual(call["method"], "POST")
        self.assertEqual(path(call["url"]), "/calendar/v3/calendars/me%40example.com/events")
        self.assertEqual(query(call["url"]), {"sendUpdates": "none", "conferenceDataVersion": "1"})
        self.assertEqual(json.loads(call["data"]), self.BODY)
        self.assertEqual(call["headers"]["Authorization"], "Bearer access-token-value")
        self.assertEqual(call["headers"]["Content-Type"], "application/json")

    def test_the_event_never_reaches_a_process_argument(self):
        # The point of writing over HTTPS: arguments show to every user on
        # the machine through ps, and the event carries notes and guests.
        client, runner, _ = writer([(200, json.dumps({"id": "n"}))] * 3)
        client.create("me@example.com", self.BODY)
        client.update("me@example.com", "ev1", self.BODY)
        client.replace("me@example.com", "ev1", self.BODY)
        for argv, _ in runner.calls:
            joined = " ".join(argv)
            for private in ("Lunch", "Private notes", "guest@example.com"):
                self.assertNotIn(private, joined)

    def test_update_patches_by_event_id(self):
        client, _, http = writer([(200, json.dumps({"id": "ev1"}))])
        client.update("me@example.com", "ev1", self.BODY)
        call = http.api_calls()[0]
        self.assertEqual(call["method"], "PATCH")
        self.assertEqual(path(call["url"]), "/calendar/v3/calendars/me%40example.com/events/ev1")
        self.assertEqual(query(call["url"]), {"sendUpdates": "none", "conferenceDataVersion": "1"})

    def test_replace_puts_the_whole_event(self):
        client, _, http = writer([(200, json.dumps({"id": "ev1"}))])
        client.replace("me@example.com", "ev1", {"summary": "S"}, send_updates="none")
        call = http.api_calls()[0]
        self.assertEqual(call["method"], "PUT")
        self.assertEqual(json.loads(call["data"]), {"summary": "S"})

    def test_ids_are_escaped_in_the_path(self):
        client, _, http = writer([(200, json.dumps({"id": "x"}))])
        client.update("team#holiday@group.v.calendar.google.com", "abc/def", {})
        self.assertEqual(
            path(http.api_calls()[0]["url"]),
            "/calendar/v3/calendars/team%23holiday%40group.v.calendar.google.com/events/abc%2Fdef",
        )

    def test_delete_accepts_an_empty_reply(self):
        client, _, http = writer([(204, "")])
        self.assertIsNone(client.delete("me@example.com", "ev1"))
        call = http.api_calls()[0]
        self.assertEqual(call["method"], "DELETE")
        self.assertIsNone(call["data"])
        self.assertEqual(query(call["url"]), {"sendUpdates": "none"})

    def test_delete_of_a_missing_or_deleted_event_raises_not_found(self):
        for code in (404, 410):
            body = json.dumps({"error": {"code": code, "message": "Not Found"}})
            client, _, _ = writer([(code, body)])
            with self.assertRaises(gws.GwsNotFound):
                client.delete("me@example.com", "gone")

    def test_a_write_without_the_scope_raises_auth_error(self):
        body = json.dumps({"error": {"code": 403, "message": "insufficient scopes"}})
        client, _, _ = writer([(403, body)])
        with self.assertRaises(gws.GwsAuthError) as caught:
            client.create("me@example.com", self.BODY)
        self.assertIn("insufficient scopes", str(caught.exception))

    def test_a_rate_limit_is_not_an_auth_error(self):
        body = json.dumps({"error": {"code": 403, "message": "Rate Limit Exceeded",
                                     "errors": [{"reason": "rateLimitExceeded"}]}})
        client, _, _ = writer([(403, body)])
        with self.assertRaises(gws.GwsApiError) as caught:
            client.create("me@example.com", {})
        self.assertNotIsInstance(caught.exception, gws.GwsAuthError)

    def test_a_server_error_without_a_json_body_is_an_api_error(self):
        client, _, _ = writer([(502, "<html>Bad Gateway</html>")])
        with self.assertRaises(gws.GwsApiError) as caught:
            client.create("me@example.com", {})
        self.assertIn("502", str(caught.exception))

    def test_invitations_are_sent_only_when_asked(self):
        client, _, http = writer([(200, json.dumps({"id": "n"})), (204, "")])
        client.create("me@example.com", {}, send_updates="all")
        client.delete("me@example.com", "ev1", send_updates="all")
        self.assertEqual([query(c["url"])["sendUpdates"] for c in http.api_calls()], ["all", "all"])

    def test_an_unknown_send_updates_value_is_refused_before_any_request(self):
        client, runner, http = writer([])
        with self.assertRaises(ValueError):
            client.create("me@example.com", {}, send_updates="externalOnly")
        self.assertEqual((runner.calls, http.calls), ([], []))

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


class TestWriteSignIn(unittest.TestCase):
    def test_credentials_come_from_gws_unmasked_in_the_profile(self):
        client, runner, http = writer([(200, json.dumps({"id": "n"}))])
        client.create("me@example.com", {})
        argv, env = runner.calls[0]
        self.assertEqual(argv[1:3], ["auth", "export"])
        self.assertIn("--unmask", argv)
        self.assertIn("--unmasked", argv)
        self.assertEqual(env["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"], "/tmp/profile")
        token_call = http.calls[0]
        self.assertEqual(token_call["url"], gws.TOKEN_URL)
        self.assertEqual(dict(urllib.parse.parse_qsl(token_call["data"].decode())), {
            "client_id": CREDENTIALS["client_id"],
            "client_secret": CREDENTIALS["client_secret"],
            "refresh_token": CREDENTIALS["refresh_token"],
            "grant_type": "refresh_token",
        })

    def test_one_token_serves_every_write_of_a_run(self):
        client, runner, http = writer([(200, json.dumps({"id": "n"})), (204, "")])
        client.create("me@example.com", {})
        client.delete("me@example.com", "n")
        self.assertEqual(len(runner.calls), 1)
        self.assertEqual(sum(1 for c in http.calls if c["url"] == gws.TOKEN_URL), 1)

    def test_masked_credentials_are_refused(self):
        masked = dict(CREDENTIALS, client_secret="GOCS...jmye", refresh_token="1//0...r5IQ")
        client, _, http = writer([], credentials=masked)
        with self.assertRaises(gws.GwsSignInError):
            client.create("me@example.com", {})
        self.assertEqual(http.calls, [])

    def test_no_sign_in_raises_auth_error(self):
        client, _, http = writer([], export=(1, "", "No credentials found"))
        with self.assertRaises(gws.GwsSignInError):
            client.create("me@example.com", {})
        self.assertEqual(http.calls, [])

    def test_an_expired_refresh_token_raises_auth_error(self):
        refused = (400, json.dumps({"error": "invalid_grant", "error_description": "Token has been expired or revoked."}))
        client, _, http = writer([], token_reply=refused)
        with self.assertRaises(gws.GwsSignInError) as caught:
            client.create("me@example.com", {})
        self.assertIn("sign-in expired", str(caught.exception))
        self.assertEqual(len(http.api_calls()), 0)

    def test_no_secret_reaches_an_error_message(self):
        refused = (400, json.dumps({"error": "invalid_grant"}))
        client, _, _ = writer([], token_reply=refused)
        with self.assertRaises(gws.GwsAuthError) as caught:
            client.create("me@example.com", {})
        for secret in (CREDENTIALS["client_secret"], CREDENTIALS["refresh_token"]):
            self.assertNotIn(secret, str(caught.exception))


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


class TestGet(unittest.TestCase):
    def test_get_reads_one_event_through_gws(self):
        runner = FakeRunner({"get": (0, json.dumps({"id": "ev1"}), "")})
        self.assertEqual(gws.Gws("/tmp/profile", runner=runner).get("me@example.com", "ev1"), {"id": "ev1"})
        argv = runner.calls[0][0]
        self.assertEqual(argv[1:4], ["calendar", "events", "get"])
        self.assertEqual(json.loads(argv[argv.index("--params") + 1]), {"calendarId": "me@example.com", "eventId": "ev1"})


if __name__ == "__main__":
    unittest.main()
