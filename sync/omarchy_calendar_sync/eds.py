"""Evolution Data Server as a calendar source.

Why this exists alongside gws: the gws backend needs the user to create a
Google Cloud project, configure a consent screen, declare the calendar scope,
publish the app and create a Desktop OAuth client, because a publicly
distributed client using a sensitive scope would need Google verification.
EDS sidesteps all of it by reusing GNOME's already-verified OAuth client, so
signing in is a browser click and there is no project, consent screen or
client secret to look after.

Like ics, this emits Google event resources (see resources.py) rather than
contract rows.

The gi imports are deliberately lazy. The module must be importable, and its
pure conversion functions testable, on a machine with no EDS installed.
"""

import time
from datetime import datetime, timezone

from .errors import SyncError
from .resources import build_event

# EDS returns from refresh as soon as the CalDAV fetch is *initiated*, not when
# it finishes, so reading straight afterwards serves the pre-refresh cache and
# an event created moments ago surfaces a cycle late. Every calendar is
# refreshed first, then this pause lets the fetches land before any reading.
SETTLE_SECONDS = 8

CONNECT_TIMEOUT = 10
FALLBACK_COLOR = "#4285f4"


class EdsError(SyncError):
    """EDS could not be read."""


class EdsMissing(EdsError):
    """The GObject introspection bindings for EDS are not installed."""


def _load_gi():
    """Import the EDS bindings, or explain what to install."""
    try:
        import gi

        gi.require_version("EDataServer", "1.2")
        gi.require_version("ECal", "2.0")
        gi.require_version("ICalGLib", "4.0")
        from gi.repository import ECal, EDataServer, ICalGLib

        return EDataServer, ECal, ICalGLib
    except (ImportError, ValueError) as error:
        raise EdsMissing(
            "the EDS bindings are unavailable (%s); install "
            "evolution-data-server and python-gobject" % error
        ) from error


def time_to_node(ical_time, utc_zone=None):
    """An ICalGLib.Time as a Google start/end node.

    All-day times become {"date": ...} and timed ones {"dateTime": ...} with an
    explicit offset, because normalize refuses a naive dateTime rather than
    guessing which machine's timezone it meant.
    """
    if ical_time is None:
        return None

    if ical_time.is_date():
        return {
            "date": "%04d-%02d-%02d"
            % (ical_time.get_year(), ical_time.get_month(), ical_time.get_day())
        }

    zone = ical_time.get_timezone() or utc_zone
    epoch = ical_time.as_timet_with_zone(zone)
    return {
        "dateTime": datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()
    }


class Eds:
    """A calendar client backed by Evolution Data Server.

    Presents the same surface as Gws -- check, version, calendars, events --
    so cli.run drives either without knowing which it has.
    """

    SOURCE_NAME = "eds"

    # No create, update or delete on this backend yet, so the sync publishes
    # no writable calendars and the panel offers no edits.
    can_write = False

    def __init__(self, settle_seconds=SETTLE_SECONDS, identity=""):
        self._settle = settle_seconds
        self._identity = identity
        self._eds = None
        self._ecal = None
        self._ical = None
        self._registry = None
        self._clients = {}

    def _bindings(self):
        if self._eds is None:
            self._eds, self._ecal, self._ical = _load_gi()
        return self._eds, self._ecal, self._ical

    def version(self):
        eds, _ecal, _ical = self._bindings()
        return (
            eds.EDS_MAJOR_VERSION,
            eds.EDS_MINOR_VERSION,
            eds.EDS_MICRO_VERSION,
        )

    def check(self):
        eds, _ecal, _ical = self._bindings()
        try:
            self._registry = eds.SourceRegistry.new_sync(None)
        except Exception as error:
            raise EdsError("cannot reach the EDS source registry: %s" % error)

    def calendars(self):
        """Enumerate calendars, refreshing them all before anything is read.

        The refresh belongs here rather than in events() so every calendar is
        fetching at once and the settle pause is paid a single time, instead of
        once per calendar.
        """
        eds, ecal, _ical = self._bindings()
        if self._registry is None:
            self.check()

        found = []
        refreshed = False

        for source in self._registry.list_sources(
            eds.SOURCE_EXTENSION_CALENDAR
        ):
            if not source.get_enabled():
                continue

            extension = source.get_extension(eds.SOURCE_EXTENSION_CALENDAR)
            try:
                client = ecal.Client.connect_sync(
                    source, ecal.ClientSourceType.EVENTS, CONNECT_TIMEOUT, None
                )
            except Exception as error:
                # One unreachable calendar must not sink the whole sync.
                print("skipping %s: %s" % (source.get_display_name(), error))
                continue

            try:
                client.refresh_sync(None)
                refreshed = True
            except Exception:
                # Local and contact-derived calendars have nothing to refresh.
                pass

            uid = source.get_uid()
            self._clients[uid] = client
            found.append(
                {
                    "id": uid,
                    "name": source.get_display_name(),
                    "color": (extension.get_color() if extension else "")
                    or FALLBACK_COLOR,
                }
            )

        if refreshed and self._settle:
            time.sleep(self._settle)

        found.sort(key=lambda calendar: calendar["name"])
        return found

    def events(self, calendar_id, time_min, time_max):
        _eds, _ecal, ical = self._bindings()
        client = self._clients.get(calendar_id)
        if client is None:
            raise EdsError("calendar %s was never opened" % calendar_id)

        start = int(datetime.fromisoformat(time_min).timestamp())
        end = int(datetime.fromisoformat(time_max).timestamp())

        collected = []

        def on_instance(component, instance_start, instance_end,
                        _user_data=None):
            collected.append((component, instance_start, instance_end))
            return True

        try:
            client.generate_instances_sync(start, end, None, on_instance)
        except Exception as error:
            raise EdsError("cannot read %s: %s" % (calendar_id, error))

        utc_zone = ical.Timezone.get_utc_timezone()
        return [
            self._to_event(component, instance_start, instance_end, ical,
                           utc_zone)
            for component, instance_start, instance_end in collected
        ]

    def _to_event(self, component, instance_start, instance_end, ical,
                  utc_zone):
        cancelled = component.get_status() == ical.PropertyStatus.CANCELLED
        return build_event(
            uid=component.get_uid() or "",
            start_node=time_to_node(instance_start, utc_zone),
            end_node=time_to_node(instance_end, utc_zone),
            summary=component.get_summary() or "",
            location=component.get_location() or "",
            description=component.get_description() or "",
            status="cancelled" if cancelled else "",
            conference_url=_x_property(component, ical,
                                       "X-GOOGLE-CONFERENCE"),
            partstat=_own_partstat(component, ical, self._identity),
        )

    def auth_hint(self, _cfg):
        return (
            "if this is an auth error, run `evolution -c calendar` once and "
            "sign in when it asks; EDS needs a window to show Google's "
            "consent screen in"
        )


def _x_property(component, ical, name):
    """The value of an X- property, or blank."""
    prop = component.get_first_property(ical.PropertyKind.X_PROPERTY)
    while prop is not None:
        if prop.get_x_name() == name:
            return prop.get_value_as_string() or ""
        prop = component.get_next_property(ical.PropertyKind.X_PROPERTY)
    return ""


def _own_partstat(component, ical, identity):
    """The PARTSTAT of the attendee matching `identity`, or blank.

    Without an identity there is no way to tell which attendee is the user, so
    the answer is left blank rather than guessed from the first row.
    """
    if not identity:
        return ""

    wanted = "mailto:%s" % identity.strip().lower()
    prop = component.get_first_property(ical.PropertyKind.ATTENDEE_PROPERTY)
    while prop is not None:
        value = (prop.get_value_as_string() or "").strip().lower()
        if value == wanted:
            param = prop.get_first_parameter(
                ical.ParameterKind.PARTSTAT_PARAMETER
            )
            if param is not None:
                # The introspected enum exposes .name (ACCEPTED, NEEDSACTION).
                return getattr(param.get_partstat(), "name", "") or ""
            return ""
        prop = component.get_next_property(ical.PropertyKind.ATTENDEE_PROPERTY)
    return ""
