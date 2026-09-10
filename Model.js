// Pure date and format math for the clock widget and its calendar panel.
// Everything here is locale- and Qt-free so it can be unit tested under node
// (test/shell.d/clock-test.sh); the QML owns month/weekday naming through
// Qt.locale().

var MS_PER_DAY = 86400000

// Weekday indices match both JS Date.getDay() and QML's Locale.Sunday…
// Locale.Saturday, so a locale's firstDayOfWeek can be passed straight in.
var WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

// ---- Bar label formats. Right-clicking the clock walks these in order and
//      writes the result back to shell.json, so the label the bar shows and
//      the format the config stores are always the same thing.
//
// The locale-shaped time presets are each followed by their 12-hour twin, so
// the walk from a 24-hour label to the same label in AM/PM is a single right
// click rather than a lap of the ring. The ISO preset is deliberately left
// without one: ISO 8601 writes time on a 24-hour clock, so an AM/PM variant
// would contradict the only thing that format is for.
var CLOCK_FORMATS = [
  "dddd HH:mm",
  "dddd h:mm AP",
  "HH:mm",
  "h:mm AP",
  "ddd d MMM HH:mm",
  "ddd d MMM h:mm AP",
  "d MMMM 'W'ww yyyy",
  "yyyy-MM-dd HH:mm"
]

// Vertical bars have room for a few stacked lines and nothing else, so the
// ring stays short. AM/PM costs a fourth line, which is why only the plain
// time carries it here.
var VERTICAL_CLOCK_FORMATS = [
  "HH\n—\nmm",
  "h\n—\nmm\nAP",
  "dd\nMMM\n'W'ww\n''yy",
  "HH\nmm"
]

function clockFormats(vertical) {
  return vertical ? VERTICAL_CLOCK_FORMATS.slice() : CLOCK_FORMATS.slice()
}

// The presets in a fixed order, plus the configured alternate and current
// format when they are something else. The order must not depend on which
// entry is current: cycling writes the result back to shell.json, and a ring
// that reshuffled itself around the current value would bounce between two
// entries instead of walking.
function clockFormatRing(configured, configuredAlt, presets) {
  var ring = []
  var candidates = (presets || []).concat([configuredAlt, configured])
  for (var i = 0; i < candidates.length; i++) {
    var format = String(candidates[i] === undefined || candidates[i] === null ? "" : candidates[i])
    if (format === "" || ring.indexOf(format) !== -1) continue
    ring.push(format)
  }
  return ring.length > 0 ? ring : ["HH:mm"]
}

// Next entry after `current`. An unknown current format (a hand-written one
// that is not in the ring) starts the walk at the top.
function nextClockFormat(ring, current) {
  if (!ring || ring.length === 0) return ""
  var index = ring.indexOf(String(current === undefined || current === null ? "" : current))
  return ring[(index + 1) % ring.length]
}

// Two-digit ISO week, substituted into a format's 'ww' token before Qt
// formats it -- Qt has no ISO week specifier of its own.
function isoWeekLiteral(year, month, day) {
  return pad2(isoWeek(year, month, day))
}

function pad2(value) {
  var n = Number(value)
  return (n < 10 ? "0" : "") + n
}

// Stable "yyyy-MM-dd" identity for a day, so a grid cell can be compared
// against today without dragging Date objects through bindings.
function dateKey(year, month, day) {
  return year + "-" + pad2(Number(month) + 1) + "-" + pad2(day)
}

function keyForDate(date) {
  return dateKey(date.getFullYear(), date.getMonth(), date.getDate())
}

function coerceWeekStart(value) {
  if (value === undefined || value === null) return null
  if (typeof value === "number")
    return isFinite(value) ? ((Math.round(value) % 7) + 7) % 7 : null

  var text = String(value).replace(/^\s+|\s+$/g, "").toLowerCase()
  if (text === "") return null

  for (var i = 0; i < WEEKDAY_NAMES.length; i++)
    if (WEEKDAY_NAMES[i] === text || WEEKDAY_NAMES[i].substr(0, 3) === text) return i

  var parsed = parseInt(text, 10)
  return isFinite(parsed) ? ((parsed % 7) + 7) % 7 : null
}

// Configured week start, falling back to the locale's own first day when
// the setting is missing or nonsense.
function normalizedWeekStart(value, fallback) {
  var configured = coerceWeekStart(value)
  if (configured !== null) return configured
  var fallbackStart = coerceWeekStart(fallback)
  return fallbackStart === null ? 1 : fallbackStart
}

function weekStartSettingName(index) {
  return WEEKDAY_NAMES[normalizedWeekStart(index, 1)]
}

// The toggle flips between the two conventions people actually switch
// between. A calendar configured to any other start (Saturday, say) is
// shown as-is and lands on Monday the first time it is toggled.
function toggledWeekStart(index) {
  return normalizedWeekStart(index, 1) === 1 ? 0 : 1
}

function weekdayOrder(weekStart) {
  var start = normalizedWeekStart(weekStart, 1)
  var out = []
  for (var i = 0; i < 7; i++) out.push((start + i) % 7)
  return out
}

// ISO-8601 week number: the week owning the Thursday of that date's
// Monday-based week. Mirrors the clock widget's 'ww' format token.
function isoWeek(year, month, day) {
  var date = new Date(Date.UTC(year, month, day))
  var weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday)
  var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7)
}

function dayOfYear(year, month, day) {
  return Math.round((Date.UTC(year, month, day) - Date.UTC(year, 0, 1)) / MS_PER_DAY) + 1
}

function daysInYear(year) {
  return dayOfYear(year, 11, 31)
}

// Share of the year already behind you: whole days completed over days in
// the year, so January 1 reads 0% and December 31 reads 100%.
function yearProgress(year, month, day) {
  var total = daysInYear(year)
  if (total <= 0) return 0
  return Math.max(0, Math.min(1, (dayOfYear(year, month, day) - 1) / total))
}

function yearProgressPercent(year, month, day) {
  return Math.round(yearProgress(year, month, day) * 100)
}

// Memento mori. The default span is a round number rather than anything from
// an actuarial table: the point of the bar is the reminder, not the
// arithmetic, and whoever wants a different number can say so.
var DEFAULT_LIFE_EXPECTANCY = 90

// A birth year rather than an age, so the bar keeps counting on its own
// instead of going stale the moment it is entered. 0 means "not set", which
// is also what a blank, malformed, future, or implausibly distant year means.
function parseBirthYear(value, currentYear) {
  var now = Math.round(Number(currentYear))
  if (!isFinite(now)) return 0
  var text = String(value === undefined || value === null ? "" : value).replace(/^\s+|\s+$/g, "")
  if (!/^\d{4}$/.test(text)) return 0
  var year = parseInt(text, 10)
  if (!isFinite(year) || year > now || year < now - 120) return 0
  return year
}

// Whole years, the way people say their age: born in 1979 makes you 47 for
// all of 2026, whichever side of your birthday today falls.
function ageFromBirthYear(birthYear, currentYear) {
  var born = parseBirthYear(birthYear, currentYear)
  if (born <= 0) return 0
  return Math.round(Number(currentYear)) - born
}

// 0 means "not set", which is also what a blank, negative, fractional, or
// absurd entry means — the life bar simply stays hidden.
function parseAge(value) {
  var text = String(value === undefined || value === null ? "" : value).replace(/^\s+|\s+$/g, "")
  if (!/^\d+$/.test(text)) return 0
  var years = parseInt(text, 10)
  if (!isFinite(years) || years <= 0 || years > 120) return 0
  return years
}

// Unset or nonsense falls back to the default rather than to zero, so the
// bar always has something to measure against.
function parseLifeExpectancy(value) {
  var text = String(value === undefined || value === null ? "" : value).replace(/^\s+|\s+$/g, "")
  if (!/^\d+$/.test(text)) return DEFAULT_LIFE_EXPECTANCY
  var years = parseInt(text, 10)
  if (!isFinite(years) || years <= 0 || years > 150) return DEFAULT_LIFE_EXPECTANCY
  return years
}

function lifeProgress(age, expectancy) {
  var years = parseAge(age)
  var span = parseLifeExpectancy(expectancy)
  if (years <= 0 || span <= 0) return 0
  return Math.max(0, Math.min(1, years / span))
}

function lifeProgressPercent(age, expectancy) {
  return Math.round(lifeProgress(age, expectancy) * 100)
}

// Always six rows of seven days. A fixed grid keeps the popup exactly the
// same height in every month, so stepping through the year never makes the
// panel jump under the pointer.
function monthGrid(year, month, weekStart, todayKey, eventIndex) {
  var start = normalizedWeekStart(weekStart, 1)
  var leading = (new Date(year, month, 1).getDay() - start + 7) % 7
  var cursor = new Date(year, month, 1 - leading)
  var today = String(todayKey || "")
  var weeks = []

  for (var w = 0; w < 6; w++) {
    var days = []
    var thursday = null
    for (var d = 0; d < 7; d++) {
      var cellYear = cursor.getFullYear()
      var cellMonth = cursor.getMonth()
      var cellDay = cursor.getDate()
      var weekday = cursor.getDay()
      var key = dateKey(cellYear, cellMonth, cellDay)
      if (weekday === 4) thursday = { year: cellYear, month: cellMonth, day: cellDay }
      days.push({
        key: key,
        year: cellYear,
        month: cellMonth,
        day: cellDay,
        weekday: weekday,
        inMonth: cellMonth === month && cellYear === year,
        weekend: weekday === 0 || weekday === 6,
        today: key === today,
        hasEvent: eventIndex ? !!eventIndex[key] : false,
        dots: eventIndex ? eventColors(eventIndex, key, 3) : []
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    // Number every row by the ISO week owning its Thursday. That is the
    // definition itself for Monday-start weeks, and the only answer that
    // stays stable for the other starts, where a row straddles two ISO
    // weeks but shares all of Monday through Thursday with one of them.
    var anchor = thursday || days[0]
    weeks.push({
      week: isoWeek(anchor.year, anchor.month, anchor.day),
      days: days
    })
  }
  return weeks
}

function stepMonth(year, month, delta) {
  var target = new Date(year, Number(month) + Number(delta), 1)
  return { year: target.getFullYear(), month: target.getMonth() }
}

// Event helpers. The widget renders whatever the sync wrote; none of this
// knows where the events came from.

var STALE_INTERVAL_MULTIPLIER = 4

function indexEventsByDate(events) {
  var index = {}
  if (!events || !events.length) return index
  for (var i = 0; i < events.length; i++) {
    var event = events[i]
    var key = event && event.dateKey
    if (!key) continue
    if (!index[key]) index[key] = []
    index[key].push(event)
  }
  return index
}

function eventsForDateKey(index, dateKey) {
  if (!index || !dateKey) return []
  return index[dateKey] || []
}

// The calendars present in a synced document, in display order, each with
// the colour the sync resolved for it. Derived from the events themselves so
// the widget needs no separate calendar list and no configuration file: it
// can only ever offer you calendars you actually have events in.
function calendarsInDocument(doc) {
  var events = (doc && doc.events) || []
  var byId = {}
  var ordered = []

  for (var i = 0; i < events.length; i++) {
    var event = events[i]
    var id = event && event.calendarId
    if (!id || byId[id]) continue
    byId[id] = true
    ordered.push({
      id: id,
      name: event.calendarName || id,
      color: event.color || ""
    })
  }

  ordered.sort(function(a, b) {
    return a.name.localeCompare(b.name)
  })
  return ordered
}

function isCalendarHidden(hidden, calendarId) {
  if (!hidden || !hidden.length) return false
  return hidden.indexOf(String(calendarId)) !== -1
}

// Returns a new list rather than mutating, so the caller can hand the result
// straight to persistSettings without touching the settings object in place.
function toggleHiddenCalendar(hidden, calendarId) {
  var id = String(calendarId)
  var next = []
  var found = false

  for (var i = 0; i < (hidden || []).length; i++) {
    if (String(hidden[i]) === id) { found = true; continue }
    next.push(hidden[i])
  }

  if (!found) next.push(id)
  return next
}

// Google's "I am working from home" markers arrive as all-day events, so
// without this they eat a line of every single day while describing no
// commitment at all.
var NOISY_EVENT_TYPES = ["workingLocation"]

function isNoisyEventType(event) {
  var type = event && event.eventType
  if (!type) return false
  return NOISY_EVENT_TYPES.indexOf(String(type)) !== -1
}

function isDeclined(event) {
  return !!event && String(event.responseStatus || "") === "declined"
}

function isOutOfOffice(event) {
  return !!event && String(event.eventType || "") === "outOfOffice"
}

// Only https is ever launched. A meeting link is supplied by whoever sent the
// invitation, so treating it as trusted input would be a mistake.
function safeUrl(url) {
  var text = String(url || "").trim()
  if (text.indexOf("https://") !== 0) return ""
  if (/[\s"'<>]/.test(text)) return ""
  return text
}

// Turn the QML file URL of a bundled script into something a person can paste.
// Derived rather than hardcoded: `omarchy plugin add` uses the manifest id, but
// a hand-cloned checkout can live anywhere, and a wrong path in the one message
// a new user sees is worse than no message.
function commandPathFromUrl(fileUrl, home) {
  var text = String(fileUrl || "")
  if (text.indexOf("file://") === 0) text = text.substring(7)
  if (home && text.indexOf(home + "/") === 0) text = "~" + text.substring(home.length)
  return text
}

function meetingUrlFor(event) {
  return event ? safeUrl(event.meetingUrl) : ""
}

// The event's own page, used when there is nothing to join. Older files and
// third-party writers have no such field, which is why this is never assumed.
function eventUrlFor(event) {
  return event ? safeUrl(event.eventUrl) : ""
}

// How long before the start, and after the end, a meeting still counts as
// joinable. A Join button on next Tuesday's meeting is noise that dilutes the
// one that matters, so the affordance only appears around the actual time.
var JOIN_LEAD_MINUTES = 15
var JOIN_GRACE_MINUTES = 15

function isJoinableNow(event, nowMs, todayKey) {
  if (!meetingUrlFor(event)) return false

  // An all-day event has no useful clock window, so it stays joinable for the
  // whole day it belongs to.
  if (event.allDay) return event.dateKey === todayKey

  var startMs = Date.parse(event.start)
  var endMs = Date.parse(event.end)
  if (isNaN(startMs)) return false
  if (isNaN(endMs) || endMs < startMs) endMs = startMs

  var opensAt = startMs - JOIN_LEAD_MINUTES * 60 * 1000
  var closesAt = endMs + JOIN_GRACE_MINUTES * 60 * 1000
  return nowMs >= opensAt && nowMs <= closesAt
}

// `options` is optional so older callers keep working: no options means only
// the calendar filter applies, exactly as before.
function visibleEvents(events, hidden, options) {
  if (!events || !events.length) return []

  var opts = options || {}
  var dropNoisy = opts.hideWorkingLocation !== false
  var dropDeclined = opts.hideDeclined === true

  var visible = []
  for (var i = 0; i < events.length; i++) {
    var event = events[i]
    if (isCalendarHidden(hidden, event.calendarId)) continue
    if (dropNoisy && isNoisyEventType(event)) continue
    if (dropDeclined && isDeclined(event)) continue
    visible.push(event)
  }
  return visible
}

// ---- The next thing coming up.

var MINUTE_MS = 60 * 1000
var HOUR_MS = 60 * MINUTE_MS
var DAY_MS = 24 * HOUR_MS

// All-day events are deliberately excluded. They start at midnight, so a
// countdown to one either reads as hours in the past or as tomorrow, and
// neither tells you anything you wanted to know.
function nextEvent(events, nowMs) {
  var best = null
  var bestMs = null

  for (var i = 0; i < (events || []).length; i++) {
    var event = events[i]
    if (!event || event.allDay) continue

    var startMs = Date.parse(event.start)
    if (isNaN(startMs) || startMs < nowMs) continue

    if (bestMs === null || startMs < bestMs) {
      bestMs = startMs
      best = event
    }
  }

  return best
}

// The popup's "what is next" line is scoped to today on purpose. Something
// eighteen hours out is tomorrow, and answering "what is next" with tomorrow
// is noise when the day's agenda is listed right below it.
function nextEventToday(events, nowMs, todayKey) {
  var todays = []
  for (var i = 0; i < (events || []).length; i++) {
    if (events[i] && events[i].dateKey === todayKey) todays.push(events[i])
  }
  return nextEvent(todays, nowMs)
}

// Returns null past a day out, which is the caller's signal to show nothing
// rather than a countdown nobody is acting on.
function formatCountdown(deltaMs) {
  if (deltaMs === null || isNaN(deltaMs) || deltaMs < 0 || deltaMs >= DAY_MS) return null
  if (deltaMs < MINUTE_MS) return "now"

  var minutes = Math.floor(deltaMs / MINUTE_MS)
  if (minutes < 60) return "in " + minutes + "min"

  var hours = Math.floor(minutes / 60)
  var rest = minutes % 60
  return rest === 0 ? "in " + hours + "h" : "in " + hours + "h " + rest + "min"
}

var MAX_ANNOUNCE_TITLE = 28

// A bar label is a fixed budget of horizontal space shared with every other
// widget, so a long event title has to give.
function truncateTitle(title, limit) {
  var text = String(title === undefined || title === null ? "" : title)
  var max = limit || MAX_ANNOUNCE_TITLE
  if (text.length <= max) return text
  return text.substring(0, max - 1).replace(/\s+$/, "") + "…"
}

// The clock is kept rather than replaced. Giving it up was a real cost for a
// widget whose whole job used to be telling the time, and there is room for
// both.
function announceLabel(clockText, title, countdown, limit) {
  if (!countdown) return clockText
  var shown = truncateTitle(title, limit)
  if (!shown) return clockText
  return clockText + "  ·  " + shown + " " + countdown
}

// How long until an event starts, or null when it cannot be read.
function millisUntil(event, nowMs) {
  if (!event) return null
  var startMs = Date.parse(event.start)
  if (isNaN(startMs)) return null
  return startMs - nowMs
}

// The bar label only gives up the clock when something is close enough to
// act on. Further out it stays a clock, which is what it is most of the day.
function shouldAnnounce(event, nowMs, leadMinutes) {
  var delta = millisUntil(event, nowMs)
  if (delta === null || delta < 0) return false
  return delta <= leadMinutes * MINUTE_MS
}

// Turn a YYYY-MM-DD key back into a local Date, for formatting a heading.
// Built field by field rather than parsed from the string, because
// new Date("2026-08-10") is UTC midnight and lands on the previous day for
// anyone west of Greenwich.
function dateFromKey(dateKey, fallback) {
  var parts = String(dateKey || "").split("-")
  if (parts.length !== 3) return fallback

  var year = parseInt(parts[0], 10)
  var month = parseInt(parts[1], 10)
  var day = parseInt(parts[2], 10)
  if (isNaN(year) || isNaN(month) || isNaN(day)) return fallback

  return new Date(year, month - 1, day)
}

function eventColors(index, dateKey, limit) {
  var events = eventsForDateKey(index, dateKey)
  var colors = []
  for (var i = 0; i < events.length; i++) {
    var color = events[i].color
    if (!color || colors.indexOf(color) !== -1) continue
    colors.push(color)
    if (limit > 0 && colors.length >= limit) break
  }
  return colors
}

// "missing" means we have nothing to show and should say so rather than
// render an empty calendar that looks like a quiet week.
function syncState(doc, nowMs, intervalSeconds) {
  if (!doc || !doc.syncedAt) return "missing"

  var syncedMs = Date.parse(doc.syncedAt)
  if (isNaN(syncedMs)) return "missing"

  var thresholdMs = intervalSeconds * STALE_INTERVAL_MULTIPLIER * 1000
  return (nowMs - syncedMs) > thresholdMs ? "stale" : "ok"
}

// ---- Create / edit / delete, via `gws`. Everything below stays pure and
// argv-only: Panel.qml owns the actual Process, this just decides what to
// run and how to read back what it prints. No shell strings anywhere, same
// reasoning as openExternally's comment above -- calendar content (a title,
// a location) is attacker-controlled the moment it round-trips through a
// shared calendar, so it never touches a shell.

// Builds a UTC-offset ISO8601 datetime ("2026-08-10T19:15:00-05:00") from
// local date/time parts, using this machine's own offset for that instant
// (so DST transitions resolve correctly). Google's API accepts an explicit
// offset in place of a separate IANA `timeZone` field, which sidesteps
// needing a zone *name* -- QML has no clean way to ask Qt for one.
function offsetDateTime(year, month, day, hour, minute) {
  var date = new Date(year, month, day, hour, minute, 0)
  var offsetMin = -date.getTimezoneOffset()
  var sign = offsetMin >= 0 ? "+" : "-"
  var abs = Math.abs(offsetMin)
  return dateKey(year, month, day) + "T" + pad2(hour) + ":" + pad2(minute) + ":00"
    + sign + pad2(Math.floor(abs / 60)) + ":" + pad2(abs % 60)
}

// Validates and shapes a create/edit form into a Google Calendar API event
// body. Returns { ok: false, error } for anything a human needs to fix
// before this is worth sending, so the caller never has to guess why a
// request would fail before it is even built.
//
// `fields`: { title, location, allDay, dateKey, endDateKey, startTime
// ("HH:MM"), endTime ("HH:MM") }. `endDateKey` defaults to `dateKey` --
// multi-day events are deliberately not supported by this form (the sync's
// per-day row expansion has no inverse here), so a longer span is rejected
// rather than silently truncated to one day.
function buildEventBody(fields) {
  var f = fields || {}
  var title = String(f.title || "").trim()
  if (title === "") return { ok: false, error: "Title is required" }

  var startKey = String(f.dateKey || "")
  var endKey = String(f.endDateKey || f.dateKey || "")
  var start = dateFromKey(startKey, null)
  var end = dateFromKey(endKey, null)
  if (!start || !end) return { ok: false, error: "Pick a date" }
  if (endKey !== startKey) return { ok: false, error: "Multi-day events aren't supported here -- edit it in Google Calendar" }

  var body = { summary: title }
  if (String(f.location || "").trim() !== "") body.location = String(f.location).trim()

  if (f.allDay) {
    // The API's all-day `end.date` is exclusive, so a one-day event's own
    // end date is the *next* day, not the day it's on.
    var next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
    body.start = { date: startKey }
    body.end = { date: dateKey(next.getFullYear(), next.getMonth(), next.getDate()) }
    return { ok: true, body: body }
  }

  var startParts = parseHHMM(f.startTime)
  var endParts = parseHHMM(f.endTime)
  if (!startParts) return { ok: false, error: "Pick a start time" }
  if (!endParts) return { ok: false, error: "Pick an end time" }

  var startDt = offsetDateTime(start.getFullYear(), start.getMonth(), start.getDate(), startParts.hour, startParts.minute)
  var endDt = offsetDateTime(start.getFullYear(), start.getMonth(), start.getDate(), endParts.hour, endParts.minute)
  if (Date.parse(endDt) <= Date.parse(startDt)) return { ok: false, error: "End time must be after start time" }

  body.start = { dateTime: startDt }
  body.end = { dateTime: endDt }
  return { ok: true, body: body }
}

// "9:30", "09:30", "930" -> {hour, minute}; anything else -> null. Typing a
// time by hand is fiddly enough without also demanding a leading zero.
function parseHHMM(raw) {
  var s = String(raw || "").trim()
  var m = s.match(/^(\d{1,2}):?(\d{2})$/)
  if (!m) return null
  var hour = parseInt(m[1], 10)
  var minute = parseInt(m[2], 10)
  if (isNaN(hour) || isNaN(minute) || hour > 23 || minute > 59) return null
  return { hour: hour, minute: minute }
}

// Maps a raw Calendar API event (as `gws ... insert/patch --format json`
// prints it) to this widget's own row shape -- the same fields the sync
// writes to calendar-events.json, documented in the README -- so a freshly
// created/edited event can be merged straight into eventDoc without waiting
// for the next sync. calendarId/calendarName/color come from the caller
// (the form's own calendar picker), since the API response only echoes
// calendarId indirectly (via the request URL, which gws doesn't repeat back).
function normalizeApiEvent(apiEvent, calendarId, calendarName, color) {
  var e = apiEvent || {}
  var start = e.start || {}
  var end = e.end || {}
  var allDay = start.date !== undefined
  var startIso = allDay ? (start.date + "T00:00:00") : (start.dateTime || "")
  var endIso = allDay ? (end.date + "T00:00:00") : (end.dateTime || "")
  var startDate = allDay ? dateFromKey(start.date, new Date()) : new Date(startIso)

  return {
    id: String(e.id || ""),
    calendarId: calendarId,
    calendarName: calendarName,
    color: color || "",
    dateKey: keyForDate(startDate),
    start: startIso,
    end: endIso,
    allDay: allDay,
    title: String(e.summary || ""),
    location: String(e.location || ""),
    eventUrl: safeUrl(e.htmlLink || ""),
    meetingUrl: safeUrl(e.hangoutLink || "")
  }
}

// `~/.config/omarchy/calendar-sync.json` has the same two keys the Python
// sync reads (sync/omarchy_calendar_sync/config.py) with the same defaults,
// so a write profile set up for reading events is also the one writes go
// through -- one login, one place it is remembered.
function resolveSyncConfig(rawText, homeDir) {
  var home = String(homeDir || "")
  var profile = home + "/.config/gws-omarchy-calendar"
  var gwsPath = "gws"

  if (rawText) {
    try {
      var parsed = JSON.parse(rawText)
      if (parsed && typeof parsed.profile === "string" && parsed.profile !== "") profile = parsed.profile
      if (parsed && typeof parsed.gwsPath === "string" && parsed.gwsPath !== "") gwsPath = parsed.gwsPath
    } catch (error) { /* fall back to defaults below */ }
  }

  return { profile: profile, gwsPath: gwsPath }
}

// argv for the three write operations. Always an array, never a shell
// string -- gws itself takes `--json`/`--params` as plain arguments, so
// there is nothing to quote in the first place.
function gwsInsertArgv(gwsPath, calendarId, body) {
  return [gwsPath, "calendar", "events", "insert",
    "--params", JSON.stringify({ calendarId: calendarId }),
    "--json", JSON.stringify(body),
    "--format", "json"]
}

function gwsPatchArgv(gwsPath, calendarId, eventId, body) {
  return [gwsPath, "calendar", "events", "patch",
    "--params", JSON.stringify({ calendarId: calendarId, eventId: eventId }),
    "--json", JSON.stringify(body),
    "--format", "json"]
}

function gwsDeleteArgv(gwsPath, calendarId, eventId) {
  return [gwsPath, "calendar", "events", "delete",
    "--params", JSON.stringify({ calendarId: calendarId, eventId: eventId })]
}

if (typeof module !== "undefined") {
  module.exports = {
    dateKey: dateKey,
    keyForDate: keyForDate,
    normalizedWeekStart: normalizedWeekStart,
    weekStartSettingName: weekStartSettingName,
    toggledWeekStart: toggledWeekStart,
    weekdayOrder: weekdayOrder,
    isoWeek: isoWeek,
    dayOfYear: dayOfYear,
    daysInYear: daysInYear,
    yearProgress: yearProgress,
    yearProgressPercent: yearProgressPercent,
    parseAge: parseAge,
    parseBirthYear: parseBirthYear,
    ageFromBirthYear: ageFromBirthYear,
    parseLifeExpectancy: parseLifeExpectancy,
    lifeProgress: lifeProgress,
    lifeProgressPercent: lifeProgressPercent,
    monthGrid: monthGrid,
    stepMonth: stepMonth,
    clockFormats: clockFormats,
    clockFormatRing: clockFormatRing,
    nextClockFormat: nextClockFormat,
    isoWeekLiteral: isoWeekLiteral,
    indexEventsByDate: indexEventsByDate,
    dateFromKey: dateFromKey,
    calendarsInDocument: calendarsInDocument,
    nextEvent: nextEvent,
    nextEventToday: nextEventToday,
    formatCountdown: formatCountdown,
    truncateTitle: truncateTitle,
    announceLabel: announceLabel,
    millisUntil: millisUntil,
    shouldAnnounce: shouldAnnounce,
    isCalendarHidden: isCalendarHidden,
    toggleHiddenCalendar: toggleHiddenCalendar,
    visibleEvents: visibleEvents,
    isNoisyEventType: isNoisyEventType,
    isDeclined: isDeclined,
    isOutOfOffice: isOutOfOffice,
    safeUrl: safeUrl,
    commandPathFromUrl: commandPathFromUrl,
    meetingUrlFor: meetingUrlFor,
    eventUrlFor: eventUrlFor,
    isJoinableNow: isJoinableNow,
    eventsForDateKey: eventsForDateKey,
    eventColors: eventColors,
    syncState: syncState,
    offsetDateTime: offsetDateTime,
    buildEventBody: buildEventBody,
    parseHHMM: parseHHMM,
    normalizeApiEvent: normalizeApiEvent,
    resolveSyncConfig: resolveSyncConfig,
    gwsInsertArgv: gwsInsertArgv,
    gwsPatchArgv: gwsPatchArgv,
    gwsDeleteArgv: gwsDeleteArgv
  }
}
