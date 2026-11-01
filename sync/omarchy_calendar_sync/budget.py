"""How much one sync may hold, whatever its sources send.

The window bounds the days of one event, and the body cap bounds the bytes
of one answer. Neither bounds how many events a feed lists, or how many
times a rule like FREQ=SECONDLY repeats inside the window.
"""

import contextlib
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


def occurrences(rie, calendar, start, end, limit=None):
    """The occurrences of calendar between start and end, like
    rie.of(calendar).between, but computed one at a time, so a rule that
    repeats every second stops at limit instead of filling the memory."""
    limit = MAX_EVENTS if limit is None else limit
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
