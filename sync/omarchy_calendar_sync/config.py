"""User configuration for the sync.

Absent config is a valid state: every key has a default, so a first run works
with no file at all.
"""

import copy
import json
from datetime import timedelta
from pathlib import Path

CONFIG_PATH = Path.home() / ".config" / "omarchy" / "calendar-sync.json"

DEFAULTS = {
    # "gws" reads Google directly and needs a Google Cloud project;
    # "eds" reads Evolution Data Server and needs none. See the README.
    "backend": "gws",
    # Opt-in. sync/setup --write sets it, together with the calendar.events
    # scope. Off, the sync publishes no writable calendars and the panel
    # shows no way to change an event.
    "write": False,
    # eds only: the address whose invitation answers count as "yours".
    # Blank means responseStatus is left unset rather than guessed.
    "identity": "",
    "profile": str(Path.home() / ".config" / "gws-omarchy-calendar"),
    # Resolved to an absolute path by sync/setup. A systemd user service
    # does not inherit an interactive shell PATH, so relying on the bare
    # name works from a terminal and fails from the timer.
    "gwsPath": "gws",
    "calendars": {"include": [], "exclude": []},
    "window": {"pastDays": 7, "futureDays": 60},
}


class ConfigError(Exception):
    """Raised when the config file exists but cannot be used."""


def load(path=None):
    """Load config, filling in defaults for anything absent."""
    path = Path(path) if path is not None else CONFIG_PATH

    if not path.exists():
        return _merge(copy.deepcopy(DEFAULTS), {})

    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ConfigError(f"cannot read {path}: {error}") from error

    if not isinstance(raw, dict):
        raise ConfigError(f"{path} must contain a JSON object")

    merged = _merge(copy.deepcopy(DEFAULTS), raw)

    _validate_calendars(merged.get("calendars"))

    window = merged.get("window")
    if isinstance(window, dict):
        window["pastDays"] = _coerce_days(window.get("pastDays"), "window.pastDays")
        window["futureDays"] = _coerce_days(
            window.get("futureDays"), "window.futureDays"
        )

    return merged


def _merge(defaults, override):
    """One level of nesting is all this config has, so this stays simple."""
    merged = {}
    for key, fallback in defaults.items():
        value = override.get(key, fallback)
        if value is None:
            # An explicit null for a nested key means "not set", not "empty".
            value = fallback
        if isinstance(fallback, dict) and isinstance(value, dict):
            merged[key] = {**fallback, **value}
        else:
            merged[key] = value
    return merged


def _validate_calendars(calendars):
    """Reject a non-list include or exclude instead of silently misreading it."""
    if not isinstance(calendars, dict):
        return
    for key in ("include", "exclude"):
        value = calendars.get(key)
        if value is not None and not isinstance(value, list):
            raise ConfigError(f"calendars.{key} must be a list")


def _coerce_days(value, key):
    """Turn a window day count into an int, or fail loudly naming the key."""
    if isinstance(value, bool):
        raise ConfigError(f"{key} must be a number")
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            raise ConfigError(f"{key} must be a number") from None
    raise ConfigError(f"{key} must be a number")


def select_calendars(calendars, config):
    """Apply the include and exclude lists. Exclude always wins."""
    rules = config.get("calendars") or {}
    include = set(rules.get("include") or [])
    exclude = set(rules.get("exclude") or [])

    selected = []
    for calendar in calendars:
        keys = {calendar["id"], calendar["name"]}
        if keys & exclude:
            continue
        if include and not (keys & include):
            continue
        selected.append(calendar)
    return selected


def window_bounds(config, now):
    """Return RFC3339 timeMin and timeMax for the events query."""
    window = config.get("window") or {}
    past = int(window.get("pastDays", DEFAULTS["window"]["pastDays"]))
    future = int(window.get("futureDays", DEFAULTS["window"]["futureDays"]))
    return (
        (now - timedelta(days=past)).isoformat(),
        (now + timedelta(days=future)).isoformat(),
    )
