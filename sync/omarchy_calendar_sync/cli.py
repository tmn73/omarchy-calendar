"""Entry point. Orchestrates config, gws, normalization, and the write."""

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import config as config_module
from . import contract, normalize
from .gws import Gws, GwsError

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
        os.chmod(path, 0o600)
    except BaseException:
        Path(temp_name).unlink(missing_ok=True)
        raise


def resolve_local_timezone(env=None, localtime_path="/etc/localtime"):
    """Resolve the local IANA timezone as a real ZoneInfo, not a fixed offset.

    A fixed offset captured at process start would be applied to every event
    across the whole sync window (7 days past, 60 days future), which drifts
    by a day for any event on the far side of a daylight saving transition.

    Resolution order:
    1. The TZ environment variable, if set and ZoneInfo accepts it. A
       leading colon (TZ=:America/Bogota is a legal form) is stripped first.
    2. /etc/localtime (or localtime_path), if it is a symlink into a
       zoneinfo tree; the path segments after "zoneinfo" become the name.
    3. A fixed-offset fallback (the current process offset), with a warning
       printed to stderr. Degraded but usable beats failing the sync.
    """
    env = os.environ if env is None else env

    tz_value = env.get("TZ")
    if tz_value:
        name = tz_value.lstrip(":")
        try:
            return ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError):
            pass

    if os.path.islink(localtime_path):
        try:
            target = os.readlink(localtime_path)
        except OSError:
            target = None
        if target:
            parts = Path(target).parts
            if "zoneinfo" in parts:
                name = "/".join(parts[parts.index("zoneinfo") + 1 :])
                if name:
                    try:
                        return ZoneInfo(name)
                    except (ZoneInfoNotFoundError, ValueError):
                        pass

    print(
        "warning: could not determine the named timezone; using a fixed "
        "offset instead. Events spanning a daylight saving transition may "
        "be off by a day.",
        file=sys.stderr,
    )
    return datetime.now().astimezone().tzinfo


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

    First occurrence wins. Calendars arrive sorted by name, so which copy
    survives is stable across runs rather than depending on Google's order.
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
        time_min, time_max = config_module.window_bounds(cfg, now)

        rows = []
        seen = set()
        for calendar in calendars:
            raw = client.events(calendar["id"], time_min, time_max)
            fresh = _drop_duplicates(raw, seen)
            rows.extend(normalize.normalize_all(fresh, calendar, local_tz))

        source = "gws/" + ".".join(str(part) for part in client.version())
    except GwsError as error:
        print(f"sync failed: {error}", file=sys.stderr)
        print(
            "if this is an auth error, run: "
            "GOOGLE_WORKSPACE_CLI_CONFIG_DIR=" + str(cfg["profile"]) + " "
            "gws auth login --scopes https://www.googleapis.com/auth/calendar.readonly",
            file=sys.stderr,
        )
        return EXIT_SYNC_FAILED

    rows.sort(key=lambda row: (row["dateKey"], row["start"], row["title"]))
    doc = contract.build_document(rows, now.isoformat(), source)

    problems = contract.validate(doc)
    if problems:
        for problem in problems:
            print(f"refusing to write invalid document: {problem}", file=sys.stderr)
        return EXIT_SYNC_FAILED

    write_atomic(out_path, doc)
    print(f"wrote {len(rows)} rows from {len(calendars)} calendars to {out_path}")
    return EXIT_OK


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="omarchy-calendar-sync",
        description="Sync Google Calendar into the Omarchy calendar widget file.",
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

    return run(Gws(cfg["profile"], binary=cfg["gwsPath"]), cfg, now, out_path, local_tz)


if __name__ == "__main__":
    sys.exit(main())
