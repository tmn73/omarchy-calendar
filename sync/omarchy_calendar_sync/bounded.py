"""Reads an HTTP body with a cap on its size.

A socket timeout bounds the wait between bytes, not the bytes, so a server
that keeps sending would otherwise fill the memory of the sync.
"""

# A year of a busy calendar as one iCal feed is a few megabytes.
MAX_BODY_BYTES = 20 * 1024 * 1024
# An error body is only read for its message.
MAX_ERROR_BYTES = 64 * 1024

_CHUNK_BYTES = 64 * 1024


class ResponseTooLarge(ValueError):
    """The server sent more than the cap."""


def read_at_most(stream, limit):
    """Up to limit bytes of the stream. The rest is not read."""
    chunks = []
    remaining = limit
    while remaining > 0:
        chunk = stream.read(min(_CHUNK_BYTES, remaining))
        if not chunk:
            break
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_body(stream, limit=None):
    """The whole body, or ResponseTooLarge once it passes limit bytes."""
    limit = MAX_BODY_BYTES if limit is None else limit
    body = read_at_most(stream, limit + 1)
    if len(body) > limit:
        raise ResponseTooLarge("the response is larger than %d MB" % (limit // (1024 * 1024)))
    return body
