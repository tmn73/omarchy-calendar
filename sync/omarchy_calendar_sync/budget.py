"""How much one sync may hold, whatever its sources send.

The window bounds the days of one event, and the body cap bounds the bytes
of one answer. Neither bounds how many events a feed lists, or how many
times a rule like FREQ=SECONDLY repeats inside the window.
"""

import contextlib
import resource
import signal
from datetime import datetime, time

from .errors import SyncError

# A busy calendar has a few hundred events in the default window.
MAX_EVENTS = 10000
MAX_ROWS = 20000
# A sync takes about 10 s. The socket timeout bounds each wait, not the sum,
# so a server that sends a byte every 29 s would hold it open for good.
SYNC_SECONDS = 120
# The panel gives up on the event command after 60 s.
EVENT_SECONDS = 55
# What one helper process (gws, caldir, a passwordCommand) may take.
HELPER_SECONDS = 60
# The heap of one run. A sync peaks under 60 MB.
MAX_MEMORY_BYTES = 512 * 1024 * 1024


class TooManyEvents(SyncError):
    """One calendar has more events in the window than one sync may hold."""


class TookTooLong(SyncError):
    """The run passed its deadline."""


@contextlib.contextmanager
def deadline(seconds):
    """Raises TookTooLong in the main thread once seconds have passed,
    whatever it waits on: a socket, a helper process or a loop."""

    def expire(_signum, _frame):
        raise TookTooLong("gave up after %d s" % seconds)

    previous = signal.signal(signal.SIGALRM, expire)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)


def _start(component, tz):
    start = component.get("DTSTART")
    if start is None:
        return None
    value = start.dt
    if not isinstance(value, datetime):
        return datetime.combine(value, time(), tz)
    if value.tzinfo is None:
        return value.replace(tzinfo=tz)
    return value


# Seconds in one period of each FREQ, and the BY parts that multiply the
# occurrences of a coarser FREQ (BYHOUR under DAILY gives one per hour).
_PERIOD_SECONDS = {"SECONDLY": 1, "MINUTELY": 60, "HOURLY": 3600}
_EXPANDING_PARTS = (("BYHOUR", 3600), ("BYMINUTE", 60), ("BYSECOND", 1))


def _per_day(rule):
    """The most occurrences one RRULE can give in one day."""
    freq = str((rule.get("FREQ") or ["DAILY"])[0]).upper()
    try:
        interval = max(1, int((rule.get("INTERVAL") or [1])[0]))
    except (TypeError, ValueError):
        interval = 1
    period = _PERIOD_SECONDS.get(freq, 86400)
    count = max(1, 86400 // (period * interval))
    for part, part_period in _EXPANDING_PARTS:
        # A BY part finer than the FREQ adds occurrences; one at or above
        # the FREQ only filters them.
        if part_period < period:
            count *= max(1, len(rule.get(part) or []))
    return count


def _listed(value):
    return value if isinstance(value, list) else [value]


def _instant(value, tz):
    if not isinstance(value, datetime):
        return datetime.combine(value, time(), tz)
    return value if value.tzinfo is not None else value.replace(tzinfo=tz)


def _ended_before(rule, start):
    until = (rule.get("UNTIL") or [None])[0]
    if until is None:
        return False
    try:
        return _instant(until, start.tzinfo) < start
    except TypeError:
        return False


def ceiling(calendar, start, end):
    """An upper bound on the occurrences the recurrence library holds at
    once for calendar between start and end. It builds a whole day of every
    series before it yields the first one, so this must stay under the
    budget beforehand. A feed's past, outside the window, costs nothing."""
    total = 0
    for component in calendar.walk("VEVENT"):
        rules = [rule for rule in _listed(component.get("RRULE") or [])
                 if not _ended_before(rule, start)]
        dates = sum(len(getattr(group, "dts", [group]))
                    for group in _listed(component.get("RDATE") or []))
        if rules or dates:
            total += 1 + dates + sum(_per_day(rule) for rule in rules)
            continue
        begins = _start(component, start.tzinfo)
        finish = component.get("DTEND")
        finishes = _instant(finish.dt, start.tzinfo) if finish is not None else begins
        try:
            if begins is None or (begins <= end and finishes >= start):
                total += 1
        except TypeError:
            total += 1
    return total


def occurrences(rie, calendar, start, end, limit=None):
    """The occurrences of calendar between start and end, like
    rie.of(calendar).between, but computed one at a time, so a rule that
    repeats every second stops at limit instead of filling the memory.
    A calendar whose rules could pass limit in a single day is refused
    before any expansion."""
    limit = MAX_EVENTS if limit is None else limit
    if ceiling(calendar, start, end) > limit:
        raise TooManyEvents("rules that could give more than %d events in a day" % limit)
    found = []
    for component in rie.of(calendar).after(start):
        # after() yields in the order of start time.
        begins = _start(component, end.tzinfo)
        if begins is not None and begins > end:
            break
        if len(found) == limit:
            raise TooManyEvents("more than %d events in the window" % limit)
        found.append(component)
    return found


def cap_memory():
    """Caps the heap of this process, whatever started it: the timer, the
    setup's test sync, the panel or a terminal. Past it Python raises
    MemoryError. Only the soft limit, so helpers can lift it (uncap_memory)."""
    _soft, hard = resource.getrlimit(resource.RLIMIT_DATA)
    if hard == resource.RLIM_INFINITY or hard > MAX_MEMORY_BYTES:
        resource.setrlimit(resource.RLIMIT_DATA, (MAX_MEMORY_BYTES, hard))


def uncap_memory():
    """For subprocess preexec_fn: a helper such as gws gets its own limits,
    not the sync's."""
    _soft, hard = resource.getrlimit(resource.RLIMIT_DATA)
    resource.setrlimit(resource.RLIMIT_DATA, (hard, hard))
