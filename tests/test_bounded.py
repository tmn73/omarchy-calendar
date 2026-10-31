"""Tests for the size cap on HTTP bodies, against a real local server."""

import http.server
import threading
import unittest
from unittest import mock

from omarchy_calendar_sync import bounded, caldav, gws, ics

CAP = 1024


class _Endless(http.server.BaseHTTPRequestHandler):
    # Sends far more than the cap, with no Content-Length, like a hostile server.
    def do_GET(self):
        status = 500 if self.path == "/error" else 200
        self.send_response(status)
        self.end_headers()
        try:
            for _ in range(64):
                self.wfile.write(b"x" * 64 * 1024)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, *args):
        pass


class BoundedBodyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Endless)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = "http://127.0.0.1:%d" % cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        patcher = mock.patch.object(bounded, "MAX_BODY_BYTES", CAP)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_an_ical_feed_past_the_cap_is_refused(self):
        with self.assertRaises(bounded.ResponseTooLarge):
            ics._http_get(self.url + "/feed.ics")

    def test_a_caldav_answer_past_the_cap_is_refused(self):
        with self.assertRaisesRegex(caldav.CaldavError, "larger than"):
            caldav._http("GET", self.url + "/dav/", {}, None)

    def test_a_google_answer_past_the_cap_is_refused(self):
        with self.assertRaisesRegex(gws.GwsApiError, "larger than"):
            gws._https("GET", self.url + "/calendar", {}, None)

    def test_an_error_body_is_cut_to_the_error_cap(self):
        status, _headers, body = caldav._http("GET", self.url + "/error", {}, None)
        self.assertEqual(status, 500)
        self.assertEqual(len(body), bounded.MAX_ERROR_BYTES)

    def test_a_body_under_the_cap_comes_back_whole(self):
        with mock.patch.object(bounded, "MAX_BODY_BYTES", 8 * 1024 * 1024):
            self.assertEqual(len(ics._http_get(self.url + "/feed.ics")), 64 * 64 * 1024)


if __name__ == "__main__":
    unittest.main()
