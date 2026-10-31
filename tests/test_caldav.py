"""Tests for the CalDAV backend, driven through a fake CalDAV server."""

import base64
import contextlib
import io
import json
import re
import tempfile
import unittest
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from omarchy_calendar_sync import caldav, cli, config, contract, event_cli
from omarchy_calendar_sync.caldav import Caldav, CaldavAuthError, CaldavError

SAO_PAULO = ZoneInfo("America/Sao_Paulo")
NOW = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)
ACCOUNT = {"url": "https://caldav.example.com/", "username": "me@example.com", "password": "app-pass"}

HOST = "https://p01-caldav.example.com"
PRINCIPAL = "/123/principal/"
HOME = "/123/calendars/"
INBOX = "/123/inbox/"
PERSONAL = HOST + HOME + "home/"
WORK = HOST + HOME + "work/"

LONE = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//iOS 18//EN
BEGIN:VEVENT
UID:lone-1
DTSTART;TZID=America/Sao_Paulo:20261103T150000
DTEND;TZID=America/Sao_Paulo:20261103T160000
SUMMARY:Dentist
LOCATION:Rua A
TRANSP:TRANSPARENT
CLASS:PRIVATE
BEGIN:VALARM
ACTION:DISPLAY
DESCRIPTION:Reminder
TRIGGER:-PT15M
END:VALARM
BEGIN:VALARM
ACTION:EMAIL
DESCRIPTION:Mail me
TRIGGER:-PT1H
END:VALARM
END:VEVENT
END:VCALENDAR
"""

SERIES = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//iOS 18//EN
BEGIN:VEVENT
UID:standup-1
DTSTART;TZID=America/Sao_Paulo:20261102T090000
DTEND;TZID=America/Sao_Paulo:20261102T091500
RRULE:FREQ=DAILY;COUNT=5
EXDATE;TZID=America/Sao_Paulo:20261105T090000
SUMMARY:Standup
END:VEVENT
BEGIN:VEVENT
UID:standup-1
RECURRENCE-ID;TZID=America/Sao_Paulo:20261103T090000
DTSTART;TZID=America/Sao_Paulo:20261103T100000
DTEND;TZID=America/Sao_Paulo:20261103T103000
SUMMARY:Standup, later
END:VEVENT
END:VCALENDAR
"""


def _multistatus(responses):
    parts = []
    for href, props in responses:
        parts.append(
            "<d:response><d:href>%s</d:href><d:propstat><d:prop>%s</d:prop>"
            "<d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>" % (href, props)
        )
    return (
        '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" '
        'xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">'
        + "".join(parts) + "</d:multistatus>"
    ).encode()


class FakeServer:
    """Enough of iCloud: discovery on the address everyone uses, which names
    the account's own host for its calendars, a calendar-query REPORT, and
    PUT and DELETE with ETag preconditions."""

    def __init__(self, resources=None, password="app-pass", default=PERSONAL, bare_default=False,
                 uid_filter=True):
        self.password = password
        # iCloud answers a UID filter with HTTP 412.
        self.uid_filter = uid_filter
        self.default = default
        self.bare_default = bare_default
        self.calls = []
        self.etag = 0
        # Calendar URL -> {href path: (etag, ical text)}
        self.store = {PERSONAL: {}, WORK: {}}
        for calendar_url, name, text in resources or []:
            self.put(calendar_url, name, text)

    def put(self, calendar_url, name, text):
        self.etag += 1
        self.store[calendar_url][name] = ('"%d"' % self.etag, text)

    def text_of(self, calendar_url, name):
        return self.store[calendar_url][name][1]

    def __call__(self, method, url, headers, data):
        self.calls.append((method, url, dict(headers)))
        parts = urllib.parse.urlsplit(url)
        expected = "Basic " + base64.b64encode(("me@example.com:" + self.password).encode()).decode()
        if headers.get("Authorization") != expected:
            return 401, {}, b""
        body = (data or b"").decode()
        path = parts.path
        if parts.hostname == "caldav.example.com":
            # Like iCloud: discovery only, naming the account's own host for
            # its calendar home.
            if method == "PROPFIND" and path in ("/", "/.well-known/caldav", PRINCIPAL, INBOX):
                return 207, {}, self._propfind(path, headers.get("Depth"))
            return 404, {}, b""
        if method == "PROPFIND":
            return 207, {}, self._propfind(path, headers.get("Depth"))
        calendar_url = next((c for c in self.store if url.startswith(c)), None)
        if calendar_url is None:
            return 404, {}, b""
        resources = self.store[calendar_url]
        name = url[len(calendar_url):]
        if method == "REPORT":
            if "prop-filter" in body and not self.uid_filter:
                return 412, {}, b""
            return 207, {}, self._report(calendar_url, resources, body)
        if method == "GET":
            if name not in resources:
                return 404, {}, b""
            return 200, {"ETag": resources[name][0]}, resources[name][1].encode()
        if method == "PUT":
            current = resources.get(name)
            if headers.get("If-None-Match") == "*" and current:
                return 412, {}, b""
            if "If-Match" in headers and (not current or current[0] != headers["If-Match"]):
                return 412, {}, b""
            self.put(calendar_url, name, body)
            return (204 if current else 201), {"ETag": resources[name][0]}, b""
        if method == "DELETE":
            if name not in resources:
                return 404, {}, b""
            if "If-Match" in headers and resources[name][0] != headers["If-Match"]:
                return 412, {}, b""
            del resources[name]
            return 204, {}, b""
        return 405, {}, b""

    def _propfind(self, path, depth):
        if path in ("/", "/.well-known/caldav"):
            return _multistatus([(path, "<d:current-user-principal><d:href>%s</d:href>"
                                        "</d:current-user-principal>" % PRINCIPAL)])
        if path == PRINCIPAL:
            return _multistatus([(path, "<c:calendar-home-set><d:href>%s</d:href></c:calendar-home-set>"
                                        "<c:schedule-inbox-URL><d:href>%s</d:href></c:schedule-inbox-URL>"
                                        % (HOST + HOME, INBOX))])
        if path == INBOX:
            default = urllib.parse.urlsplit(self.default).path
            if not self.bare_default:
                default = "<d:href>%s</d:href>" % default
            return _multistatus([(path, "<c:schedule-default-calendar-URL>%s"
                                        "</c:schedule-default-calendar-URL>" % default)])
        if path == HOME and depth == "1":
            write = "<d:current-user-privilege-set><d:privilege><d:read/></d:privilege>%s</d:current-user-privilege-set>"
            events = "<c:supported-calendar-component-set><c:comp name='VEVENT'/></c:supported-calendar-component-set>"
            calendar = "<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>"
            return _multistatus([
                (HOME, "<d:resourcetype><d:collection/></d:resourcetype>"),
                (HOME + "home/", calendar + events + "<d:displayname>Home</d:displayname>"
                 "<a:calendar-color>#FF2968FF</a:calendar-color>"
                 + write % "<d:privilege><d:write/></d:privilege>"),
                (HOME + "work/", calendar + events + "<d:displayname>Work</d:displayname>"
                 + write % ""),
                (HOME + "tasks/", calendar + "<c:supported-calendar-component-set><c:comp name='VTODO'/>"
                 "</c:supported-calendar-component-set><d:displayname>Reminders</d:displayname>"),
                (INBOX, "<d:resourcetype><d:collection/><c:schedule-inbox/></d:resourcetype>"),
            ])
        return _multistatus([])

    def _report(self, calendar_url, resources, body):
        uid = re.search(r"<c:text-match[^>]*>(.*?)</c:text-match>", body)
        responses = []
        for name, (etag, text) in resources.items():
            if uid and ("UID:%s\n" % uid.group(1)) not in text.replace("\r\n", "\n"):
                continue
            href = urllib.parse.urlsplit(calendar_url).path + name
            responses.append((href, "<d:getetag>%s</d:getetag><c:calendar-data>%s</c:calendar-data>"
                                    % (escape(etag), escape(text))))
        return _multistatus(responses)


def make_client(server, accounts=None, **kwargs):
    return Caldav(accounts or ACCOUNT, http=server, local_tz=SAO_PAULO, **kwargs)


def window():
    return config.window_bounds({"window": {"pastDays": 7, "futureDays": 60}}, NOW)


class TestDiscovery(unittest.TestCase):
    def test_lists_event_calendars_with_their_writability(self):
        calendars = make_client(FakeServer()).calendars()
        self.assertEqual([c["name"] for c in calendars], ["Home", "Work"])
        home, work = calendars
        self.assertEqual(home["id"], PERSONAL)
        self.assertEqual(home["color"], "#FF2968")
        self.assertTrue(home["primary"])
        self.assertTrue(home["writable"])
        self.assertFalse(work["writable"])
        self.assertFalse(work["primary"])
        self.assertEqual(home["lacks"], ["guests", "meet", "color"])

    def test_reads_icloud_default_calendar_without_an_href(self):
        calendars = make_client(FakeServer(default=WORK, bare_default=True)).calendars()
        self.assertEqual([c["name"] for c in calendars if c["primary"]], ["Work"])

    def test_the_host_the_server_names_gets_the_password(self):
        server = FakeServer()
        make_client(server).calendars()
        named = [call for call in server.calls if call[1].startswith(HOST)]
        self.assertTrue(named)
        self.assertTrue(all("Authorization" in call[2] for call in named))

    def test_follows_a_redirect_on_the_same_server_with_the_password(self):
        server = FakeServer()

        def moved(method, url, headers, data):
            if url == ACCOUNT["url"]:
                server.calls.append((method, url, dict(headers)))
                return 301, {"Location": "/.well-known/caldav"}, b""
            return server(method, url, headers, data)

        self.assertEqual(len(make_client(moved).calendars()), 2)
        method, url, headers = server.calls[1]
        self.assertEqual((method, url), ("PROPFIND", "https://caldav.example.com/.well-known/caldav"))
        self.assertIn("Authorization", headers)

    def test_a_redirect_to_any_other_server_is_refused_before_it_leaves(self):
        # The same parent domain is not enough: under a suffix such as
        # com.br, that would be anyone's server.
        for account_url, elsewhere in (
            (ACCOUNT["url"], "https://evil.example.org/"),
            (ACCOUNT["url"], "https://p02-caldav.example.com/"),
            ("https://cloud.empresa.com.br/", "https://outra.com.br/"),
        ):
            with self.subTest(elsewhere=elsewhere):
                reached = []

                def leaky(method, url, headers, data):
                    if url == account_url:
                        return 301, {"Location": elsewhere}, b""
                    reached.append(url)
                    return 404, {}, b""

                client = make_client(leaky, accounts=dict(ACCOUNT, url=account_url))
                with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(CaldavError) as caught:
                    client.calendars()
                self.assertEqual(reached, [])
                self.assertIn(urllib.parse.urlsplit(elsewhere).hostname, str(caught.exception))

    def test_a_calendar_gets_only_its_own_accounts_password(self):
        server = FakeServer([(PERSONAL, "lone-1.ics", LONE)])
        other = {"url": "https://dav.other.test/", "username": "you", "password": "other-pass"}
        # The event command: no sync first, and the other account comes first.
        make_client(server, accounts=[other, ACCOUNT]).get(PERSONAL, "lone-1")
        mine = "Basic " + base64.b64encode(b"me@example.com:app-pass").decode()
        for _method, url, headers in server.calls:
            ours = urllib.parse.urlsplit(url).hostname != "dav.other.test"
            self.assertEqual(headers["Authorization"] == mine, ours, url)

    def test_wrong_password_names_the_app_specific_password(self):
        with self.assertRaises(CaldavAuthError) as caught:
            make_client(FakeServer(password="other")).calendars()
        self.assertIn("app-specific password", str(caught.exception))

    def test_password_command_runs_once_and_never_needs_the_file(self):
        asked = []

        def keyring(argv):
            asked.append(argv)
            return "app-pass"

        account = {"url": ACCOUNT["url"], "username": ACCOUNT["username"],
                   "passwordCommand": "secret-tool lookup service omarchy-calendar-caldav"}
        client = make_client(FakeServer(), accounts=account, password_command=keyring)
        client.calendars()
        self.assertEqual(asked, [["secret-tool", "lookup", "service", "omarchy-calendar-caldav"]])

    def test_check_wants_a_password_source(self):
        client = make_client(FakeServer(), accounts={"url": ACCOUNT["url"], "username": "me"})
        with self.assertRaises(CaldavError):
            client.check()


class TestEvents(unittest.TestCase):
    def setUp(self):
        self.server = FakeServer([(PERSONAL, "lone-1.ics", LONE), (PERSONAL, "standup-1.ics", SERIES)])
        self.client = make_client(self.server)
        self.client.calendars()
        self.events = {e["id"]: e for e in self.client.events(PERSONAL, *window())}

    def test_a_lone_event_keeps_its_bare_uid(self):
        lone = self.events["lone-1"]
        self.assertNotIn("recurringEventId", lone)
        self.assertEqual(lone["transparency"], "transparent")
        self.assertEqual(lone["visibility"], "private")
        self.assertEqual(lone["reminders"]["overrides"], [{"method": "popup", "minutes": 15}])

    def test_occurrences_name_their_series_and_skip_exdates(self):
        ids = sorted(e for e in self.events if e.startswith("standup-1#"))
        self.assertEqual(ids, [
            "standup-1#20261102T120000Z",
            "standup-1#20261103T120000Z",
            "standup-1#20261104T120000Z",
            "standup-1#20261106T120000Z",
        ])
        moved = self.events["standup-1#20261103T120000Z"]
        self.assertEqual(moved["summary"], "Standup, later")
        self.assertEqual(moved["recurringEventId"], "standup-1")
        self.assertEqual(moved["start"]["dateTime"], "2026-11-03T10:00:00-03:00")

    def test_get_returns_the_series_rule(self):
        master = self.client.get(PERSONAL, "standup-1")
        self.assertEqual(master["recurrence"], [
            "RRULE:FREQ=DAILY;COUNT=5",
            "EXDATE;TZID=America/Sao_Paulo:20261105T090000",
        ])

    def test_get_of_an_unedited_occurrence(self):
        occurrence = self.client.get(PERSONAL, "standup-1#20261104T120000Z")
        self.assertEqual(occurrence["start"]["dateTime"], "2026-11-04T09:00:00-03:00")
        self.assertEqual(occurrence["end"]["dateTime"], "2026-11-04T09:15:00-03:00")
        self.assertNotIn("recurrence", occurrence)


class TestSync(unittest.TestCase):
    def test_writes_writable_calendars_with_what_they_lack(self):
        server = FakeServer([(PERSONAL, "lone-1.ics", LONE)])
        cfg = config._merge(config.DEFAULTS, {"backend": "caldav", "write": True, "caldav": ACCOUNT})
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "events.json"
            with contextlib.redirect_stdout(io.StringIO()):
                code = cli.run(make_client(server), cfg, NOW, out, SAO_PAULO)
            doc = json.loads(out.read_text())
        self.assertEqual(code, 0)
        self.assertEqual(doc["source"].split("/")[0], "caldav")
        self.assertEqual(doc["writableCalendars"], [
            {"id": PERSONAL, "name": "Home", "color": "#FF2968", "lacks": ["guests", "meet", "color"]},
        ])
        self.assertEqual([row["title"] for row in doc["events"]], ["Dentist"])

    def test_build_client_reads_the_caldav_key(self):
        cfg = config._merge(config.DEFAULTS, {"backend": "caldav", "caldav": [ACCOUNT]})
        client = cli.build_client(cfg, SAO_PAULO)
        self.assertIsInstance(client, Caldav)
        self.assertTrue(client.can_write)


class TestContract(unittest.TestCase):
    def test_lacks_must_be_a_list_of_strings(self):
        doc = contract.build_document([], NOW.isoformat(), "caldav/7",
                                      [{"id": "a", "name": "A", "color": "#000000", "lacks": "meet"}])
        self.assertTrue(any("lacks" in p for p in contract.validate(doc)))
        doc["writableCalendars"][0]["lacks"] = ["meet"]
        self.assertEqual(contract.validate(doc), [])


def form(**extra):
    base = {
        "calendarId": PERSONAL, "eventId": "", "recurringEventId": "", "title": "Lunch",
        "allDay": False, "startDate": "2026-11-04", "startTime": "12:00",
        "endDate": "2026-11-04", "endTime": "13:00", "location": "", "description": "",
        "guests": [], "meet": False, "meetUrl": "", "repeat": "none", "rrule": [],
        "reminders": {"useDefault": False, "overrides": [{"method": "popup", "minutes": 10}]},
        "busy": True, "visibility": "default", "colorId": "",
        "guestsCanModify": False, "guestsCanInviteOthers": True, "guestsCanSeeOtherGuests": True,
    }
    base.update(extra)
    return base


class TestWrites(unittest.TestCase):
    """The event command against the fake server, as the panel drives it."""

    def setUp(self):
        self.server = FakeServer([(PERSONAL, "lone-1.ics", LONE), (PERSONAL, "standup-1.ics", SERIES)])
        self.cfg = config._merge(config.DEFAULTS, {"backend": "caldav", "write": True, "caldav": ACCOUNT})
        self.folder = tempfile.TemporaryDirectory()
        self.out = Path(self.folder.name) / "events.json"
        self.sync()

    def tearDown(self):
        self.folder.cleanup()

    def sync(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.run(make_client(self.server), self.cfg, NOW, self.out, SAO_PAULO), 0)

    def call(self, request):
        return event_cli.perform(request, self.cfg, make_client(self.server), self.out, SAO_PAULO,
                                 start_sync=lambda: None, sync_now=self.sync)

    def rows(self):
        return json.loads(self.out.read_text())["events"]

    def stored(self, name):
        return self.server.text_of(PERSONAL, name).replace("\r\n", "\n")

    def test_create_puts_a_new_resource_and_splices_it_in(self):
        code, reply = self.call({"action": "create", "event": form()})
        self.assertEqual(code, 0, reply)
        uid = reply["eventId"]
        text = self.stored(uid + ".ics")
        self.assertIn("SUMMARY:Lunch", text)
        self.assertIn("DTSTART;TZID=America/Sao_Paulo:20261104T120000", text)
        self.assertIn("BEGIN:VTIMEZONE", text)
        self.assertIn("TRIGGER:-PT10M", text)
        put = next(call for call in self.server.calls if call[0] == "PUT")
        self.assertEqual(put[2].get("If-None-Match"), "*")
        self.assertEqual([r["title"] for r in self.rows() if r["id"] == uid], ["Lunch"])

    def test_create_with_guests_is_refused_before_anything_is_sent(self):
        code, reply = self.call({"action": "create", "event": form(guests=[{"email": "ana@example.com"}])})
        self.assertEqual(code, 1)
        self.assertIn("Guests", reply["error"])
        self.assertFalse([call for call in self.server.calls if call[0] == "PUT"])

    def test_update_keeps_what_the_form_does_not_show(self):
        code, reply = self.call({"action": "get", "calendarId": PERSONAL, "eventId": "lone-1"})
        self.assertEqual(code, 0, reply)
        edited = dict(reply["event"], title="Dentist, moved", startTime="17:00", endTime="18:00")
        code, reply = self.call({"action": "update", "event": edited})
        self.assertEqual(code, 0, reply)
        text = self.stored("lone-1.ics")
        self.assertIn("SUMMARY:Dentist\\, moved", text)
        self.assertIn("DTSTART;TZID=America/Sao_Paulo:20261103T170000", text)
        # The e-mail alarm is not the form's to remove.
        self.assertIn("ACTION:EMAIL", text)
        self.assertIn("CLASS:PRIVATE", text)
        put = next(call for call in self.server.calls if call[0] == "PUT")
        self.assertEqual(put[2].get("If-Match"), '"1"')
        self.assertEqual([r["start"] for r in self.rows() if r["id"] == "lone-1"],
                         ["2026-11-03T17:00:00-03:00"])

    def test_an_edit_made_elsewhere_in_between_is_refused(self):
        client = make_client(self.server)
        current = client.get(PERSONAL, "lone-1")
        real_http = self.server.__call__

        def racing(method, url, headers, data):
            if method == "PUT":
                # Someone saves on the phone between the read and the write.
                self.server.put(PERSONAL, "lone-1.ics", LONE)
            return real_http(method, url, headers, data)

        client = make_client(racing)
        with self.assertRaises(caldav.CaldavConflict):
            client.update(PERSONAL, "lone-1", {"summary": "Mine"})
        self.assertIn("SUMMARY:Dentist", self.stored("lone-1.ics"))
        self.assertEqual(current["summary"], "Dentist")

    def test_editing_one_occurrence_adds_an_override(self):
        request = {"action": "get", "calendarId": PERSONAL, "eventId": "standup-1#20261104T120000Z"}
        code, reply = self.call(request)
        self.assertEqual(code, 0, reply)
        self.assertEqual(reply["event"]["recurringEventId"], "standup-1")
        self.assertEqual(reply["event"]["repeat"], "custom")
        edited = dict(reply["event"], title="Standup, long", endTime="10:00")
        code, reply = self.call({"action": "update", "scope": "this", "event": edited})
        self.assertEqual(code, 0, reply)
        text = self.stored("standup-1.ics")
        self.assertIn("RECURRENCE-ID;TZID=America/Sao_Paulo:20261104T090000", text)
        self.assertEqual(text.count("RRULE:"), 1)
        titles = {r["id"]: r["title"] for r in self.rows()}
        self.assertEqual(titles["standup-1#20261104T120000Z"], "Standup, long")
        self.assertEqual(titles["standup-1#20261102T120000Z"], "Standup")

    def test_deleting_one_occurrence_adds_an_exdate(self):
        code, reply = self.call({"action": "delete", "calendarId": PERSONAL,
                                 "eventId": "standup-1#20261104T120000Z"})
        self.assertEqual(code, 0, reply)
        self.assertIn("20261104T090000", self.stored("standup-1.ics"))
        self.assertNotIn("standup-1#20261104T120000Z", {r["id"] for r in self.rows()})

    def test_deleting_an_edited_occurrence_drops_its_override(self):
        code, reply = self.call({"action": "delete", "calendarId": PERSONAL,
                                 "eventId": "standup-1#20261103T120000Z"})
        self.assertEqual(code, 0, reply)
        text = self.stored("standup-1.ics")
        self.assertNotIn("Standup, later", text)
        self.assertNotIn("standup-1#20261103T120000Z", {r["id"] for r in self.rows()})

    def test_moving_the_series_moves_its_exceptions(self):
        code, reply = self.call({"action": "get", "calendarId": PERSONAL,
                                 "eventId": "standup-1#20261102T120000Z"})
        self.assertEqual(code, 0, reply)
        edited = dict(reply["event"], startTime="08:00", endTime="08:15")
        code, reply = self.call({"action": "update", "scope": "all",
                                 "event": dict(edited, recurringEventId="standup-1")})
        self.assertEqual(code, 0, reply)
        text = self.stored("standup-1.ics")
        self.assertIn("EXDATE;TZID=America/Sao_Paulo:20261105T080000", text)
        self.assertIn("RECURRENCE-ID;TZID=America/Sao_Paulo:20261103T080000", text)
        ids = {r["id"] for r in self.rows()}
        self.assertNotIn("standup-1#20261105T110000Z", ids)
        self.assertIn("standup-1#20261103T110000Z", ids)

    def test_deleting_the_series_deletes_the_resource(self):
        code, reply = self.call({"action": "delete", "calendarId": PERSONAL, "scope": "all",
                                 "eventId": "standup-1#20261102T120000Z",
                                 "recurringEventId": "standup-1"})
        self.assertEqual(code, 0, reply)
        self.assertNotIn("standup-1.ics", self.server.store[PERSONAL])

    def test_finds_an_event_whose_name_is_not_its_uid_without_a_uid_filter(self):
        self.server.uid_filter = False
        self.server.store[PERSONAL]["other-name.ics"] = self.server.store[PERSONAL].pop("lone-1.ics")
        code, reply = self.call({"action": "get", "calendarId": PERSONAL, "eventId": "lone-1"})
        self.assertEqual(code, 0, reply)
        self.assertEqual(reply["event"]["title"], "Dentist")
        code, reply = self.call({"action": "delete", "calendarId": PERSONAL, "eventId": "lone-1"})
        self.assertEqual(code, 0, reply)
        self.assertNotIn("other-name.ics", self.server.store[PERSONAL])

    def test_a_missing_event_reads_as_gone(self):
        del self.server.store[PERSONAL]["lone-1.ics"]
        code, reply = self.call({"action": "delete", "calendarId": PERSONAL, "eventId": "lone-1"})
        self.assertEqual((code, reply["error"]), (1, event_cli.GONE))

    def test_switching_to_all_day_writes_dates(self):
        code, reply = self.call({"action": "get", "calendarId": PERSONAL, "eventId": "lone-1"})
        edited = dict(reply["event"], allDay=True, startTime="", endTime="")
        code, reply = self.call({"action": "update", "event": edited})
        self.assertEqual(code, 0, reply)
        text = self.stored("lone-1.ics")
        self.assertIn("DTSTART;VALUE=DATE:20261103", text)
        self.assertIn("DTEND;VALUE=DATE:20261104", text)


class TestIds(unittest.TestCase):
    def test_round_trip(self):
        when = datetime(2026, 11, 2, 9, 0, tzinfo=SAO_PAULO)
        event_id = caldav.occurrence_id("a#b@example.com", when, SAO_PAULO)
        self.assertEqual(event_id, "a#b@example.com#20261102T120000Z")
        self.assertEqual(caldav.split_id(event_id), ("a#b@example.com", "20261102T120000Z"))
        self.assertEqual(caldav.split_id("plain-uid"), ("plain-uid", ""))

    def test_dates_stay_dates(self):
        self.assertEqual(caldav.occurrence_id("u", (NOW + timedelta(days=1)).date(), SAO_PAULO),
                         "u#20261031")


if __name__ == "__main__":
    unittest.main()
