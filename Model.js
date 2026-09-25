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

// Where an agenda row sits relative to now: "past", "now" or "later".
// All-day events are always "later" -- dimming a birthday at 00:01 would
// say it is over when it is the whole day.
function eventPhase(event, nowMs) {
  if (!event || event.allDay) return "later"
  var startMs = Date.parse(event.start)
  var endMs = Date.parse(event.end)
  if (isNaN(startMs)) return "later"
  if (isNaN(endMs) || endMs < startMs) endMs = startMs
  if (endMs <= nowMs) return "past"
  if (startMs <= nowMs) return "now"
  return "later"
}

// The agenda row the "now" line is drawn above: the first timed event that
// has not started. `events.length` means the line goes after the last row,
// which is how a finished day still says where you are in it.
function nowLineIndex(events, nowMs) {
  var list = events || []
  for (var i = 0; i < list.length; i++) {
    var event = list[i]
    if (!event || event.allDay) continue
    var startMs = Date.parse(event.start)
    if (!isNaN(startMs) && startMs > nowMs) return i
  }
  return list.length
}

// The timer on an agenda row: time left in a meeting under way, or the
// countdown on the next one. Every other row gets nothing -- one countdown
// is a prompt, a column of them is a timetable.
function rowTimer(event, nextEvent, nowMs) {
  var phase = eventPhase(event, nowMs)
  if (phase === "now") return formatRemaining(Date.parse(event.end) - nowMs) || ""
  // By id, not identity: QML hands the agenda and the next-event lookup
  // separate copies of the same row.
  if (phase === "later" && event && nextEvent && event.id === nextEvent.id)
    return formatCountdown(millisUntil(event, nowMs)) || ""
  return ""
}

// Deliberately not symmetric with formatCountdown: "in 5min" and "5min left"
// appear in the same slot, so they have to be told apart at a glance.
function formatRemaining(deltaMs) {
  if (deltaMs === null || isNaN(deltaMs) || deltaMs < 0 || deltaMs >= DAY_MS) return null
  if (deltaMs < MINUTE_MS) return "ending"

  var minutes = Math.floor(deltaMs / MINUTE_MS)
  if (minutes < 60) return minutes + "min left"

  var hours = Math.floor(minutes / 60)
  var rest = minutes % 60
  return rest === 0 ? hours + "h left" : hours + "h " + rest + "min left"
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

// ---- Writing. The sync decides what the panel may change: a calendar is
//      writable only when it is in the file's writableCalendars list.

function isWritable(event, writableCalendars) {
  if (!event || !writableCalendars || !writableCalendars.length) return false
  for (var i = 0; i < writableCalendars.length; i++)
    if (writableCalendars[i] && writableCalendars[i].id === event.calendarId) return true
  return false
}

// A multi-day event is one row per day it covers, all with the same id.
function isMultiDay(event, events) {
  if (!event || !events) return false
  var count = 0
  for (var i = 0; i < events.length; i++)
    if (events[i].id === event.id && events[i].calendarId === event.calendarId) count++
  return count > 1
}

function clockText(minutes) {
  var h = Math.floor(minutes / 60) % 24
  var m = minutes % 60
  return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m
}

// Today: the next half hour. Another day: 09:00. Always 30 minutes, and
// never past midnight, so the default always saves.
function defaultFormTimes(dateKeyText, now) {
  var start = 9 * 60
  if (String(dateKeyText) === keyForDate(now)) {
    var minutes = now.getHours() * 60 + now.getMinutes()
    start = Math.min(Math.ceil((minutes + 1) / 30) * 30, 23 * 60 + 30)
  }
  return { start: clockText(start), end: clockText(start + 30) }
}

// The JSON the write command reads. See sync/omarchy_calendar_sync/writes.py.
function writeRequest(action, fields, event) {
  if (action === "delete")
    return { action: "delete", calendarId: event.calendarId, eventId: event.id }
  var request = {
    action: action,
    calendarId: fields.calendarId,
    title: fields.title,
    dateKey: fields.dateKey,
    allDay: !!fields.allDay,
    start: fields.start,
    end: fields.end,
    location: fields.location
  }
  if (action === "update") request.eventId = event.id
  return request
}

// For running a file next to this one. commandPathFromUrl shortens to ~
// for display; a process needs the real absolute path.
function localPathFromUrl(fileUrl) {
  var text = String(fileUrl || "")
  if (text.indexOf("file://") === 0) text = text.substring(7)
  return decodeURIComponent(text)
}

// The event command's reply. `event` is the form a get returns, null for
// a write.
function parseWriteReply(text) {
  try {
    var reply = JSON.parse(String(text || "").trim())
    if (reply && reply.ok === true) return { ok: true, error: "", event: reply.event || null }
    if (reply && typeof reply.error === "string") return { ok: false, error: reply.error, event: null }
  } catch (error) {}
  return {
    ok: false,
    error: "The event command failed: " + (String(text || "").slice(0, 200) || "no output"),
    event: null
  }
}

// The form for a new event. Same shape as the one the event command's get
// returns (see sync/omarchy_calendar_sync/event_form.py), with Google's
// defaults. An end at "00:00" keeps the same end date: the command reads it
// as that midnight.
function newEventForm(dateKeyText, times, calendarId) {
  return {
    calendarId: calendarId, eventId: "", recurringEventId: "",
    title: "", allDay: false,
    startDate: dateKeyText, startTime: times.start,
    endDate: dateKeyText, endTime: times.end,
    location: "", description: "",
    guests: [], meet: false, meetUrl: "",
    repeat: "none", rrule: [],
    reminders: { useDefault: true, overrides: [] },
    busy: true, visibility: "default", colorId: "",
    guestsCanModify: false, guestsCanInviteOthers: true, guestsCanSeeOtherGuests: true
  }
}

// The guests who would get an email: everyone but the calendar's owner.
function otherGuests(form) {
  var me = normalizeEmail(form.calendarId)
  var out = []
  var guests = form.guests || []
  for (var i = 0; i < guests.length; i++)
    if (normalizeEmail(guests[i].email) !== me) out.push(guests[i])
  return out
}

// ---- The event form's option lists. Labels are English, like the rest
//      of the panel; the time labels come from the caller's format.

var WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"]
var ORDINALS = { 1: "first", 2: "second", 3: "third", 4: "fourth", "-1": "last" }

function durationLabel(minutes) {
  if (minutes < 60) return minutes + " min"
  var hours = Math.floor(minutes / 60)
  var rest = minutes % 60
  return hours + " h" + (rest ? " " + (rest < 10 ? "0" : "") + rest : "")
}

// The start menu: every 15 minutes of the day. The end menu (fromMinutes is
// the start): from 15 minutes after the start up to midnight, with the
// duration, as Google shows it. "00:00" at the end means that midnight.
function timeOptions(fromMinutes, formatTime, withDuration) {
  var options = []
  var first = fromMinutes < 0 ? 0 : fromMinutes + 15
  var last = fromMinutes < 0 ? 23 * 60 + 45 : 24 * 60
  for (var m = first; m <= last; m += 15) {
    var value = clockText(m)
    var label = formatTime(value)
    if (withDuration && fromMinutes >= 0) label += " (" + durationLabel(m - fromMinutes) + ")"
    options.push({ value: value, label: label })
  }
  return options
}

function partsOfKey(key) {
  var parts = String(key).split("-")
  return { year: Number(parts[0]), month: Number(parts[1]) - 1, day: Number(parts[2]) }
}

// Which weekday of its month a date is: 1 to 4, or -1 in the last 7 days.
// Kept in step with event_form.nth_weekday on the Python side.
function nthWeekday(key) {
  var p = partsOfKey(key)
  var daysInMonth = new Date(p.year, p.month + 1, 0).getDate()
  var weekday = new Date(p.year, p.month, p.day).getDay()
  return { n: p.day + 7 > daysInMonth ? -1 : Math.floor((p.day - 1) / 7) + 1, weekday: weekday }
}

function repeatOptions(key) {
  var p = partsOfKey(key)
  var nth = nthWeekday(key)
  var weekdayName = WEEKDAY_NAMES[nth.weekday]
  return [
    { value: "none", label: "Does not repeat" },
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly on " + weekdayName },
    { value: "monthly", label: "Monthly on the " + ORDINALS[String(nth.n)] + " " + weekdayName },
    { value: "yearly", label: "Annually on " + MONTH_NAMES[p.month] + " " + p.day },
    { value: "weekdays", label: "Every weekday (Monday to Friday)" }
  ]
}

function normalizeEmail(text) {
  return String(text || "").trim().toLowerCase()
}

function isValidEmail(text) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(text || ""))
}

// Returns the same array when nothing was added, so the caller can tell.
function addGuest(guests, text) {
  var email = normalizeEmail(text)
  if (!isValidEmail(email)) return guests
  for (var i = 0; i < guests.length; i++)
    if (normalizeEmail(guests[i].email) === email) return guests
  return guests.concat([{ email: email, optional: false, responseStatus: "needsAction", organizer: false }])
}

// Google's event colours, from `colors get` (the "event" section).
var EVENT_COLORS = [
  { id: "1", color: "#a4bdfc" }, { id: "2", color: "#7ae7bf" }, { id: "3", color: "#dbadff" },
  { id: "4", color: "#ff887c" }, { id: "5", color: "#fbd75b" }, { id: "6", color: "#ffb878" },
  { id: "7", color: "#46d6db" }, { id: "8", color: "#e1e1e1" }, { id: "9", color: "#5484ed" },
  { id: "10", color: "#51b749" }, { id: "11", color: "#dc2127" }
]

// The notification menu offers one popup at a fixed lead. Anything else an
// event already has (two reminders, an email, 2 weeks before) shows as
// "custom" and is sent back untouched unless the user picks another value.
var REMINDER_MINUTES = [5, 10, 30, 60, 1440]

function reminderChoice(reminders) {
  var r = reminders || { useDefault: true }
  if (r.useDefault !== false) return "default"
  var overrides = r.overrides || []
  if (overrides.length === 0) return "none"
  if (overrides.length === 1 && overrides[0].method === "popup"
      && REMINDER_MINUTES.indexOf(Number(overrides[0].minutes)) >= 0)
    return String(overrides[0].minutes)
  return "custom"
}

function remindersFor(choice) {
  if (choice === "default") return { useDefault: true, overrides: [] }
  if (choice === "none") return { useDefault: false, overrides: [] }
  return { useDefault: false, overrides: [{ method: "popup", minutes: Number(choice) }] }
}

if (typeof module !== "undefined") {
  module.exports = {
    EVENT_COLORS: EVENT_COLORS,
    newEventForm: newEventForm,
    otherGuests: otherGuests,
    reminderChoice: reminderChoice,
    remindersFor: remindersFor,
    durationLabel: durationLabel,
    timeOptions: timeOptions,
    nthWeekday: nthWeekday,
    repeatOptions: repeatOptions,
    normalizeEmail: normalizeEmail,
    isValidEmail: isValidEmail,
    addGuest: addGuest,
    isWritable: isWritable,
    isMultiDay: isMultiDay,
    defaultFormTimes: defaultFormTimes,
    writeRequest: writeRequest,
    localPathFromUrl: localPathFromUrl,
    parseWriteReply: parseWriteReply,
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
    eventPhase: eventPhase,
    nowLineIndex: nowLineIndex,
    rowTimer: rowTimer,
    formatCountdown: formatCountdown,
    formatRemaining: formatRemaining,
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
    syncState: syncState
  }
}
