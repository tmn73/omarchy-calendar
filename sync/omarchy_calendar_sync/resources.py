"""Google-shaped event resources built from iCalendar parts.

The eds and ics backends read iCalendar, not Google's API, but they emit the
same event resources gws returns. That way normalization, deduplication and
contract validation are shared rather than reimplemented per backend. Only
the fields iCalendar carries are filled in; the rest are simply absent, which
normalize already treats as blank.
"""

# iCalendar spells the invitation answer differently to Google, and the widget
# reads Google's spelling (Model.js hides declined events by it).
PARTSTAT_TO_GOOGLE = {
    "ACCEPTED": "accepted",
    "DECLINED": "declined",
    "TENTATIVE": "tentative",
    "NEEDS-ACTION": "needsAction",
}

# The wire spelling is NEEDS-ACTION but the introspected EDS enum calls it
# NEEDSACTION, and both reach here, so the hyphen is ignored on lookup.
_PARTSTAT_LOOKUP = {
    key.replace("-", ""): value for key, value in PARTSTAT_TO_GOOGLE.items()
}


def google_partstat(value):
    """A Google responseStatus for an iCalendar PARTSTAT, blank if unknown."""
    return _PARTSTAT_LOOKUP.get(str(value or "").upper().replace("-", ""), "")


def build_event(uid, start_node, end_node, summary="", location="",
                description="", status="", conference_url="", partstat="",
                reminders=(), html_link=""):
    """Assemble a Google event resource for one occurrence.

    Occurrences of a series share a UID, so the id adds the start to tell
    them apart; `iCalUID` stays the bare UID so the CLI still deduplicates
    the same meeting seen from two calendars. `reminders` are popup minutes
    before the start.
    """
    start = start_node or {}
    occurrence = start.get("dateTime") or start.get("date") or ""
    event = {
        "id": "%s:%s" % (uid, occurrence) if occurrence else uid,
        "iCalUID": uid,
        "summary": summary or "",
        "location": location or "",
        "description": description or "",
        "start": start_node,
        "end": end_node or start_node,
    }

    if status:
        event["status"] = status.lower()
    if conference_url:
        event["hangoutLink"] = conference_url
    if html_link:
        event["htmlLink"] = html_link
    if reminders:
        event["reminders"] = {
            "useDefault": False,
            "overrides": [{"method": "popup", "minutes": m} for m in reminders],
        }

    answer = google_partstat(partstat)
    if answer:
        # normalize reads the user's own answer off the attendee marked self.
        event["attendees"] = [{"self": True, "responseStatus": answer}]

    return event
