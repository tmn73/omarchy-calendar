"""The machine's local timezone, as a named zone whenever possible."""

import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


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
