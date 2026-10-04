"""Entry point. Orchestrates config, a backend, normalization, and the write."""

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from . import config as config_module
from . import contract, normalize, suggestions
from .eds import Eds
from .errors import SyncError
from .gws import Gws
from .ics import Ics
from .localzone import resolve_local_timezone

EXIT_OK = 0
EXIT_SYNC_FAILED = 1
EXIT_BAD_CONFIG = 2


def write_atomic(path, doc):
    """Write JSON so a reader never observes a partial file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    handle, temp_name = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(handle, "w") as stream:
            json.dump(doc, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_name, path)
    except BaseException:
        Path(temp_name).unlink(missing_ok=True)
        raise


def occurrence_key(gevent):
    """Identity of one occurrence, shared by its copies in several calendars.

    An event you can see from two calendars is returned once per calendar,
    and listing it twice is noise.

    iCalUID alone is NOT a safe key. Every instance of a recurring series
    carries the same one, verified against live data: a daily standup came
    back as five events with five distinct ids and a single shared iCalUID.
    Keying on it alone would collapse the whole series into one entry.

    The start instant is what separates instances of a series while still
    matching the same occurrence seen from two different calendars.

    Returns None when the event carries no iCalUID, which means never
    deduplicate it. Dropping a real event is worse than showing it twice.
    """
    uid = gevent.get("iCalUID")
    if not uid:
        return None

    start = gevent.get("start") or {}
    return (uid, start.get("dateTime") or start.get("date"))


def _drop_duplicates(gevents, seen):
    """Filter events already seen in an earlier calendar. Mutates `seen`.

    First occurrence wins. The primary calendar goes first and the rest
    follow by name, so which copy survives is stable across runs rather than
    depending on Google's order.
    """
    fresh = []
    for gevent in gevents:
        key = occurrence_key(gevent)
        if key is not None:
            if key in seen:
                continue
            seen.add(key)
        fresh.append(gevent)
    return fresh


def run(client, cfg, now, out_path, local_tz):
    """Fetch, normalize, write. Returns a process exit code."""
    try:
        client.check()
        calendars = config_module.select_calendars(client.calendars(), cfg)
        # Your own copy of a shared event carries your title, colour and
        # answer. A colleague's copy can carry none of them (a calendar shared
        # as free/busy has no titles), so the primary calendar wins the
        # dedup. The sort is stable, so the rest keep their name order.
        calendars.sort(key=lambda calendar: not calendar.get("primary"))
        time_min, time_max = config_module.window_bounds(cfg, now)

        rows = []
        seen = set()
        fetched = []
        for calendar in calendars:
            raw = client.events(calendar["id"], time_min, time_max)
            fresh = _drop_duplicates(raw, seen)
            fetched.extend(fresh)
            rows.extend(normalize.normalize_all(fresh, calendar, local_tz))

        source = client.SOURCE_NAME + "/" + ".".join(
            str(part) for part in client.version()
        )
    except SyncError as error:
        print(f"sync failed: {error}", file=sys.stderr)
        hint = client.auth_hint(cfg)
        if hint:
            print(hint, file=sys.stderr)
        return EXIT_SYNC_FAILED

    rows.sort(key=normalize.row_order)
    # The panel offers edits only for these. Only when the user turned
    # writing on and the backend can write; otherwise the key is absent.
    writable = []
    if cfg.get("write") and getattr(client, "can_write", False):
        writable = [
            {"id": c["id"], "name": c["name"], "color": c["color"]}
            for c in calendars
            if c.get("writable")
        ]
    # Only for the event form, so only when writing is on.
    guests = []
    if writable:
        guests = suggestions.guest_suggestions(fetched, [c["id"] for c in calendars])
    doc = contract.build_document(rows, now.isoformat(), source, writable, guests)

    problems = contract.validate(doc)
    if problems:
        for problem in problems:
            print(f"refusing to write invalid document: {problem}", file=sys.stderr)
        return EXIT_SYNC_FAILED

    write_atomic(out_path, doc)
    print(f"wrote {len(rows)} rows from {len(calendars)} calendars to {out_path}")
    return EXIT_OK


def build_client(cfg, local_tz=None):
    """The calendar source named by the config."""
    backend = str(cfg.get("backend") or "gws").strip().lower()
    if backend == "gws":
        return Gws(cfg["profile"], binary=cfg["gwsPath"])
    if backend == "eds":
        return Eds(identity=cfg.get("identity", ""))
    if backend == "ics":
        return Ics(cfg.get("ics"), identity=cfg.get("identity", ""), local_tz=local_tz)
    raise config_module.ConfigError(
        "unknown backend %r; expected \"gws\", \"eds\" or \"ics\"" % backend
    )


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="omarchy-calendar-sync",
        description="Sync your calendars into the Omarchy calendar widget file.",
    )
    parser.add_argument("--config", default=None, help="path to calendar-sync.json")
    parser.add_argument("--out", default=None, help="path to the contract file")
    args = parser.parse_args(argv)

    try:
        cfg = config_module.load(args.config)
    except config_module.ConfigError as error:
        print(f"config error: {error}", file=sys.stderr)
        return EXIT_BAD_CONFIG

    out_path = Path(args.out) if args.out else contract.CONTRACT_PATH
    now = datetime.now(timezone.utc)
    local_tz = resolve_local_timezone()

    try:
        client = build_client(cfg, local_tz)
    except config_module.ConfigError as error:
        print(f"config error: {error}", file=sys.stderr)
        return EXIT_BAD_CONFIG

    return run(client, cfg, now, out_path, local_tz)


if __name__ == "__main__":
    sys.exit(main())
