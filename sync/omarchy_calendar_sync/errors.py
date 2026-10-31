"""The error a backend raises when a sync cannot be completed.

Each backend subclasses this so the CLI can report a failure without knowing
which backend produced it.
"""


class SyncError(Exception):
    """A calendar source could not be read."""


class EventNotFound(SyncError):
    """The event a write names is no longer at its source."""
