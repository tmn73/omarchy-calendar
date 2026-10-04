.pragma library
.import "Strings.js" as Strings

// Pure date, event and text logic for the calendar widget, its panel and its
// bar label. Nothing here reads the clock or touches Qt: every caller passes
// "now" in, so the whole file runs under node (tests/load-qml-js.js) as well
// as in QML. Day and month names for display come from Qt.locale() in the
// QML; the few phrases built here come from Strings.js.
//
// Sections: text and clock helpers · day keys · week start · ISO week and
// progress bars · bar clock formats · month grid · events and calendars ·
// links · event times · agenda · relative time · bar label · reminders ·
// reminder notifications · sync state · writing · quick add.

var MINUTE_MS = 60 * 1000
var HOUR_MS = 60 * MINUTE_MS
var DAY_MS = 24 * HOUR_MS

// ---- Text and clock helpers

function text(value) {
  return String(value === undefined || value === null ? "" : value)
}

function pad2(value) {
  var n = Number(value)
  return (n < 10 ? "0" : "") + n
}

// Minutes since midnight as "HH:mm". 24:00 wraps to "00:00", which the
// event form reads as that midnight.
function clockText(minutes) {
  return pad2(Math.floor(minutes / 60) % 24) + ":" + pad2(minutes % 60)
}

function minutesOf(clock) {
  var parts = text(clock || "00:00").split(":")
  return Number(parts[0]) * 60 + Number(parts[1])
}

// ---- Day keys. A day is a "yyyy-MM-dd" string, so a grid cell can be
//      compared against today without dragging Date objects through
//      bindings. All the arithmetic is on local calendar dates, never on
//      milliseconds, so a 23- or 25-hour DST day cannot shift a key.

function dateKey(year, month, day) {
  return year + "-" + pad2(Number(month) + 1) + "-" + pad2(day)
}

function keyForDate(date) {
  return dateKey(date.getFullYear(), date.getMonth(), date.getDate())
}

function keyForMs(ms) {
  return keyForDate(new Date(ms))
}

function partsOfKey(key) {
  var parts = text(key).split("-")
  return { year: Number(parts[0]), month: Number(parts[1]) - 1, day: Number(parts[2]) }
}

// Built field by field rather than parsed from the string, because
// new Date("2026-08-10") is UTC midnight and lands on the previous day for
// anyone west of Greenwich.
function dateFromKey(key, fallback) {
  var parts = text(key).split("-")
  if (parts.length !== 3) return fallback

  var year = parseInt(parts[0], 10)
  var month = parseInt(parts[1], 10)
  var day = parseInt(parts[2], 10)
  if (isNaN(year) || isNaN(month) || isNaN(day)) return fallback

  return new Date(year, month - 1, day)
}

function addDays(key, days) {
  var p = partsOfKey(key)
  return keyForDate(new Date(p.year, p.month, p.day + Number(days)))
}

function daysBetween(fromKey, toKey) {
  var a = partsOfKey(fromKey)
  var b = partsOfKey(toKey)
  return Math.round((Date.UTC(b.year, b.month, b.day) - Date.UTC(a.year, a.month, a.day)) / DAY_MS)
}

function stepMonth(year, month, delta) {
  var target = new Date(year, Number(month) + Number(delta), 1)
  return { year: target.getFullYear(), month: target.getMonth() }
}

// ---- Week start. Indices match both JS Date.getDay() and QML's
//      Locale.Sunday…Locale.Saturday, so a locale's firstDayOfWeek can be
//      passed straight in. The names are what shell.json stores, never
//      display text.

var WEEKDAY_SETTING_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

function coerceWeekStart(value) {
  if (value === undefined || value === null) return null
  if (typeof value === "number")
    return isFinite(value) ? ((Math.round(value) % 7) + 7) % 7 : null

  var name = text(value).trim().toLowerCase()
  if (name === "") return null

  for (var i = 0; i < WEEKDAY_SETTING_NAMES.length; i++)
    if (WEEKDAY_SETTING_NAMES[i] === name || WEEKDAY_SETTING_NAMES[i].substr(0, 3) === name) return i

  var parsed = parseInt(name, 10)
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
  return WEEKDAY_SETTING_NAMES[normalizedWeekStart(index, 1)]
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

// ---- ISO week and the progress bars

// ISO-8601 week number: the week owning the Thursday of that date's
// Monday-based week.
function isoWeek(year, month, day) {
  var date = new Date(Date.UTC(year, month, day))
  var weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday)
  var yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7)
}

// Two-digit ISO week, substituted into a format's 'ww' token before Qt
// formats it -- Qt has no ISO week specifier of its own.
function isoWeekLiteral(year, month, day) {
  return pad2(isoWeek(year, month, day))
}

function dayOfYear(year, month, day) {
  return Math.round((Date.UTC(year, month, day) - Date.UTC(year, 0, 1)) / DAY_MS) + 1
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

// Whole positive numbers up to `max`, else 0.
function boundedWholeNumber(value, max) {
  var digits = text(value).trim()
  if (!/^\d+$/.test(digits)) return 0
  var n = parseInt(digits, 10)
  return n > 0 && n <= max ? n : 0
}

// A birth year rather than an age, so the bar keeps counting on its own
// instead of going stale the moment it is entered. 0 means "not set", which
// is also what a blank, malformed, future, or implausibly distant year means.
function parseBirthYear(value, currentYear) {
  var now = Math.round(Number(currentYear))
  if (!isFinite(now)) return 0
  var digits = text(value).trim()
  if (!/^\d{4}$/.test(digits)) return 0
  var year = parseInt(digits, 10)
  return year > now || year < now - 120 ? 0 : year
}

// Whole years, the way people say their age: born in 1979 makes you 47 for
// all of 2026, whichever side of your birthday today falls.
function ageFromBirthYear(birthYear, currentYear) {
  var born = parseBirthYear(birthYear, currentYear)
  return born > 0 ? Math.round(Number(currentYear)) - born : 0
}

// 0 means "not set", which is also what a blank, negative, fractional, or
// absurd entry means -- the life bar simply stays hidden.
function parseAge(value) {
  return boundedWholeNumber(value, 120)
}

// Unset or nonsense falls back to the default rather than to zero, so the
// bar always has something to measure against.
function parseLifeExpectancy(value) {
  return boundedWholeNumber(value, 150) || DEFAULT_LIFE_EXPECTANCY
}

function lifeProgress(age, expectancy) {
  var years = parseAge(age)
  if (years <= 0) return 0
  return Math.max(0, Math.min(1, years / parseLifeExpectancy(expectancy)))
}

function lifeProgressPercent(age, expectancy) {
  return Math.round(lifeProgress(age, expectancy) * 100)
}

// ---- Bar clock formats. Right-clicking the clock walks these in order and
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
    var format = text(candidates[i])
    if (format === "" || ring.indexOf(format) !== -1) continue
    ring.push(format)
  }
  return ring.length > 0 ? ring : ["HH:mm"]
}

// Next entry after `current`. An unknown current format (a hand-written one
// that is not in the ring) starts the walk at the top.
function nextClockFormat(ring, current) {
  if (!ring || ring.length === 0) return ""
  return ring[(ring.indexOf(text(current)) + 1) % ring.length]
}

// ---- Month grid

// Always six rows of seven days. A fixed grid keeps the popup exactly the
// same height in every month, so stepping through the year never makes the
// panel jump under the pointer.
function monthGrid(year, month, weekStart, todayKey, eventIndex) {
  var start = normalizedWeekStart(weekStart, 1)
  var leading = (new Date(year, month, 1).getDay() - start + 7) % 7
  var cursor = new Date(year, month, 1 - leading)
  var today = text(todayKey)
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
    weeks.push({ week: isoWeek(anchor.year, anchor.month, anchor.day), days: days })
  }
  return weeks
}

// ---- Events and calendars. The widget renders whatever the sync wrote;
//      none of this knows where the events came from. A multi-day event is
//      one row per day it covers, all sharing its id, so rows are told
//      apart by id plus dateKey (or id plus start, for the event itself).

function indexEventsByDate(events) {
  var index = {}
  if (!events || !events.length) return index
  for (var i = 0; i < events.length; i++) {
    var key = events[i] && events[i].dateKey
    if (!key) continue
    if (!index[key]) index[key] = []
    index[key].push(events[i])
  }
  return index
}

function eventsForDateKey(index, key) {
  if (!index || !key) return []
  return index[key] || []
}

function eventColors(index, key, limit) {
  var events = eventsForDateKey(index, key)
  var colors = []
  for (var i = 0; i < events.length; i++) {
    var color = events[i].color
    if (!color || colors.indexOf(color) !== -1) continue
    colors.push(color)
    if (limit > 0 && colors.length >= limit) break
  }
  return colors
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
    ordered.push({ id: id, name: event.calendarName || id, color: event.color || "" })
  }

  ordered.sort(function(a, b) { return a.name.localeCompare(b.name) })
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
  return !!event && text(event.responseStatus) === "declined"
}

function isOutOfOffice(event) {
  return !!event && text(event.eventType) === "outOfOffice"
}

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

// ---- Links

// Only https is ever launched. A meeting link is supplied by whoever sent the
// invitation, so treating it as trusted input would be a mistake.
function safeUrl(url) {
  var candidate = text(url).trim()
  if (candidate.indexOf("https://") !== 0) return ""
  if (/[\s"'<>]/.test(candidate)) return ""
  return candidate
}

function meetingUrlFor(event) {
  return event ? safeUrl(event.meetingUrl) : ""
}

// The event's own page, used when there is nothing to join. Older files and
// third-party writers have no such field, which is why this is never assumed.
function eventUrlFor(event) {
  return event ? safeUrl(event.eventUrl) : ""
}

var MEETING_HOSTS = [
  { pattern: /^meet\.google\.com$/, name: "Google Meet" },
  { pattern: /(^|\.)zoom\.(us|com)$/, name: "Zoom" },
  { pattern: /^teams\.(microsoft|live)\.com$/, name: "Teams" },
  { pattern: /(^|\.)webex\.com$/, name: "Webex" },
  { pattern: /^meet\.jit\.si$|(^|\.)jitsi\./, name: "Jitsi" },
  { pattern: /(^|\.)whereby\.com$/, name: "Whereby" }
]

// The service behind a meeting link, for "Join Zoom" rather than a bare
// "Join". "" for anything unknown or unsafe.
function meetingHost(url) {
  var match = safeUrl(url).match(/^https:\/\/(?:[^\/?#@]*@)?([^\/?#:]+)/)
  if (!match) return ""
  var host = match[1].toLowerCase()
  for (var i = 0; i < MEETING_HOSTS.length; i++)
    if (MEETING_HOSTS[i].pattern.test(host)) return MEETING_HOSTS[i].name
  return ""
}

// encodeURIComponent leaves ' ( ) ! * alone, and safeUrl refuses a quote,
// so a title like "Ana's party" would otherwise build a link nobody opens.
function encodeQuery(value) {
  return encodeURIComponent(text(value)).replace(/[!'()*]/g, function(c) {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase()
  })
}

// A location that is a link or names a video service is not somewhere you
// can be driven to.
var VIRTUAL_LOCATION = /^(google meet|meet|zoom|microsoft teams( meeting)?|teams|webex|jitsi|whereby|online|virtual)$/i

function mapsUrl(location) {
  var place = text(location).trim()
  if (place === "" || /[a-z][a-z0-9+.\-]*:\/\//i.test(place) || /^www\./i.test(place) || VIRTUAL_LOCATION.test(place))
    return ""
  return "https://www.google.com/maps/search/?api=1&query=" + encodeQuery(place)
}

// Turn the QML file URL of a bundled script into the absolute path a process
// needs.
function localPathFromUrl(fileUrl) {
  var path = text(fileUrl)
  if (path.indexOf("file://") === 0) path = path.substring(7)
  try {
    return decodeURIComponent(path)
  } catch (error) {
    return path
  }
}

// The same path shortened to ~ for a person to paste. Derived rather than
// hardcoded: `omarchy plugin add` uses the manifest id, but a hand-cloned
// checkout can live anywhere, and a wrong path in the one message a new user
// sees is worse than no message.
function commandPathFromUrl(fileUrl, home) {
  var path = localPathFromUrl(fileUrl)
  if (home && path.indexOf(home + "/") === 0) path = "~" + path.substring(home.length)
  return path
}

// ---- Event times

// An all-day row's start and end are dates. They are read as local
// midnight: Date.parse would read a bare date as UTC midnight, a day early
// west of Greenwich.
function instantOf(value, allDay) {
  var raw = text(value)
  if (allDay) {
    var day = dateFromKey(raw.substr(0, 10), null)
    return day ? day.getTime() : NaN
  }
  return Date.parse(raw)
}

// { start, end } in ms. An end that is missing or before the start
// collapses onto the start.
function timeRange(event) {
  if (!event) return { start: NaN, end: NaN }
  var start = instantOf(event.start, event.allDay)
  var end = instantOf(event.end, event.allDay)
  if (isNaN(end) || end < start) end = start
  return { start: start, end: end }
}

// Where an agenda row sits relative to now: "past", "now" or "later".
// All-day events are always "later" -- dimming a birthday at 00:01 would
// say it is over when it is the whole day.
function eventPhase(event, nowMs) {
  if (!event || event.allDay) return "later"
  var range = timeRange(event)
  if (isNaN(range.start)) return "later"
  if (range.end <= nowMs) return "past"
  if (range.start <= nowMs) return "now"
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

  var range = timeRange(event)
  if (isNaN(range.start)) return false
  return nowMs >= range.start - JOIN_LEAD_MINUTES * MINUTE_MS
    && nowMs <= range.end + JOIN_GRACE_MINUTES * MINUTE_MS
}

// ---- Agenda. What a row is (event, task or deadline) is read from the
//      title and calendar name, because that is all the synced file says:
//      Todoist marks a finished task with a check mark, and deadlines are a
//      naming habit.

var DONE_PREFIX = /^\s*[\u2713\u2714\u2611]\s*/
var DEADLINE_PREFIX = /^\s*(prazo|deadline|due)\s*[:\-\u2013]\s*/i
var TASK_CALENDAR = /todoist|tasks|tarefas/i

// { kind: "event" | "task" | "deadline", done, title } with the markers
// stripped from the title. A deadline stays a deadline on a task calendar:
// the prefix is the more deliberate signal.
function classifyEvent(event) {
  var original = text(event && event.title)
  var title = original
  var done = DONE_PREFIX.test(title)
  if (done) title = title.replace(DONE_PREFIX, "")
  var deadline = DEADLINE_PREFIX.test(title)
  if (deadline) title = title.replace(DEADLINE_PREFIX, "")
  var task = done || TASK_CALENDAR.test(text(event && event.calendarName))
  return {
    kind: deadline ? "deadline" : (task ? "task" : "event"),
    done: done,
    title: title.trim() || original.trim()
  }
}

// A copy of the row with what the agenda needs to draw it. The original
// `title` is kept for anything sent back to the event command.
function agendaItem(event) {
  var item = {}
  for (var field in event) item[field] = event[field]
  var kind = classifyEvent(event)
  var range = timeRange(event)
  item.kind = kind.kind
  item.done = kind.done
  item.displayTitle = kind.title
  item.startMs = range.start
  item.endMs = range.end
  return item
}

// Deadlines first, they are what a day is judged by; finished tasks last.
function agendaRank(item) {
  if (item.done) return 3
  if (item.kind === "deadline") return 0
  return item.kind === "event" ? 1 : 2
}

function sortedItems(events) {
  var allDay = []
  var timed = []
  for (var i = 0; i < (events || []).length; i++) {
    if (!events[i]) continue
    var item = agendaItem(events[i])
    if (item.allDay) allDay.push(item)
    else timed.push(item)
  }
  // Ties keep the sync's order; Array.sort is not stable in every engine.
  var position = function(list, item) { return list.indexOf(item) }
  var byRank = allDay.slice()
  allDay.sort(function(a, b) { return agendaRank(a) - agendaRank(b) || position(byRank, a) - position(byRank, b) })
  var byStart = timed.slice()
  timed.sort(function(a, b) {
    return (a.startMs - b.startMs) || (a.endMs - b.endMs) || position(byStart, a) - position(byStart, b)
  })
  return { allDay: allDay, timed: timed }
}

// One day of the agenda. Every item is the event plus kind, done,
// displayTitle, startMs, endMs and phase. nowIndex is where the now line
// goes in `timed` (see nowLineIndex), or -1 on any day but today.
function daySections(events, nowMs, isToday) {
  var sections = sortedItems(events)
  var all = sections.allDay.concat(sections.timed)
  for (var i = 0; i < all.length; i++) all[i].phase = eventPhase(all[i], nowMs)
  return {
    allDay: sections.allDay,
    timed: sections.timed,
    nowIndex: isToday ? nowLineIndex(sections.timed, nowMs) : -1
  }
}

// Far enough to reach past a holiday week; the sync rarely writes further.
var UPCOMING_HORIZON_DAYS = 60

// The next days after `fromKey` that have something open, each with its
// first rows (all-day first, then by time) and how many more there are.
// Finished tasks are left out: nobody plans around them.
function upcomingDays(eventIndex, fromKey, maxDays, maxRows) {
  var daysWanted = maxDays === undefined ? 5 : maxDays
  var rowsWanted = maxRows === undefined ? 3 : maxRows
  var out = []
  for (var offset = 1; offset <= UPCOMING_HORIZON_DAYS && out.length < daysWanted; offset++) {
    var key = addDays(fromKey, offset)
    var sections = sortedItems(eventsForDateKey(eventIndex, key))
    var rows = sections.allDay.concat(sections.timed).filter(function(item) { return !item.done })
    if (rows.length === 0) continue
    out.push({ key: key, rows: rows.slice(0, rowsWanted), more: Math.max(0, rows.length - rowsWanted) })
  }
  return out
}

// "1 meeting · 2 deadlines · 3 tasks": timed events are meetings, all-day
// events just events; finished work is counted apart from open work.
function daySummary(sections, lang) {
  var counts = { meetings: 0, events: 0, deadlines: 0, tasks: 0, done: 0 }
  var items = ((sections && sections.allDay) || []).concat((sections && sections.timed) || [])
  for (var i = 0; i < items.length; i++) {
    var item = items[i]
    if (item.done) counts.done++
    else if (item.kind === "deadline") counts.deadlines++
    else if (item.kind === "task") counts.tasks++
    else if (item.allDay) counts.events++
    else counts.meetings++
  }
  var parts = []
  var order = ["meetings", "events", "deadlines", "tasks", "done"]
  for (var o = 0; o < order.length; o++)
    if (counts[order[o]] > 0) parts.push(Strings.trn(lang, "summary." + order[o], counts[order[o]]))
  return parts.length > 0 ? parts.join(" · ") : Strings.tr(lang, "summary.empty")
}

// "Today", "Tomorrow", "Yesterday" for a day heading, "" for any other day.
function relativeDayLabel(key, todayKey, lang) {
  var offset = daysBetween(todayKey, key)
  if (offset === 0) return Strings.tr(lang, "day.today")
  if (offset === 1) return Strings.tr(lang, "day.tomorrow")
  if (offset === -1) return Strings.tr(lang, "day.yesterday")
  return ""
}

// ---- Relative time

// "8 min", "2 h", "1 h 30 min".
function spanText(minutes, lang) {
  if (minutes < 60) return Strings.tr(lang, "unit.min", [minutes])
  var hours = Math.floor(minutes / 60)
  var rest = minutes % 60
  return rest === 0 ? Strings.tr(lang, "unit.h", [hours]) : Strings.tr(lang, "unit.hmin", [hours, rest])
}

// The number a span starts with, which is what decides "falta" or "faltam".
function spanCount(minutes) {
  return minutes < 60 ? minutes : Math.floor(minutes / 60)
}

function dayDistanceText(offset, lang, long) {
  if (offset === 0) return Strings.tr(lang, "rel.today")
  if (offset === 1) return Strings.tr(lang, "rel.tomorrow")
  if (offset === -1) return Strings.tr(lang, "rel.yesterday")
  if (offset > 1) return Strings.trn(lang, long ? "rel.long.inDays" : "rel.inDays", offset)
  return Strings.trn(lang, "rel.daysAgo", -offset)
}

// When an event is, said relative to now: "in 8 min", "now · 12 min left",
// "ended 2 h ago", "tomorrow", "in 3 days". `long` gives the inspector's
// fuller phrasing ("starts in 8 min", "happening now · 12 min left").
// Countdowns round up, so "in 1 min" lasts until the start rather than
// reading "in 0 min"; time since rounds down.
function relativeTime(event, nowMs, lang, long) {
  if (!event) return ""
  var todayKey = keyForMs(nowMs)
  var range = timeRange(event)

  if (event.allDay || isNaN(range.start))
    return dayDistanceText(daysBetween(todayKey, event.dateKey || text(event.start).substr(0, 10)), lang, long)

  if (nowMs < range.start) {
    var until = range.start - nowMs
    if (keyForMs(range.start) !== todayKey && until >= HOUR_MS)
      return dayDistanceText(daysBetween(todayKey, keyForMs(range.start)), lang, long)
    if (until < MINUTE_MS) return Strings.tr(lang, long ? "rel.long.startingNow" : "rel.now")
    var span = spanText(Math.ceil(until / MINUTE_MS), lang)
    return Strings.tr(lang, long ? "rel.long.startsIn" : "rel.in", [span])
  }

  if (nowMs < range.end) {
    var left = Math.ceil((range.end - nowMs) / MINUTE_MS)
    return Strings.trn(lang, long ? "rel.long.left" : "rel.left", spanCount(left), [spanText(left, lang)])
  }

  if (keyForMs(range.end) !== todayKey)
    return dayDistanceText(daysBetween(todayKey, keyForMs(range.start)), lang, long)
  var ago = Math.max(1, Math.floor((nowMs - range.end) / MINUTE_MS))
  if (ago >= 60) ago = Math.floor(ago / 60) * 60
  return Strings.tr(lang, "rel.endedAgo", [spanText(ago, lang)])
}

// ---- Bar label

var MAX_ANNOUNCE_TITLE = 28

// A bar label is a fixed budget of horizontal space shared with every other
// widget, so a long event title has to give.
function truncateTitle(title, limit) {
  var full = text(title)
  var max = limit || MAX_ANNOUNCE_TITLE
  if (full.length <= max) return full
  return full.substring(0, max - 1).replace(/\s+$/, "") + "…"
}

// The timed rows worth interrupting someone for, once each: a multi-day
// event appears on several days with the same id and start.
function announceableEvents(events) {
  var out = []
  var seen = {}
  for (var i = 0; i < (events || []).length; i++) {
    var event = events[i]
    if (!event || event.allDay || isDeclined(event) || isNoisyEventType(event)) continue
    if (classifyEvent(event).done) continue
    var range = timeRange(event)
    var key = text(event.id) + "|" + range.start
    if (isNaN(range.start) || seen[key]) continue
    seen[key] = true
    out.push({ event: event, start: range.start, end: range.end })
  }
  return out
}

var IMMINENT_MINUTES = 10
var LIVE_MINUTES = 2

// The bar's escalation: "soon" inside the lead time, "imminent" in the last
// 10 minutes (or the whole lead, when that is shorter), "live" for the first
// 2 minutes after the start. A meeting that has just started outranks the
// next one. `extra` counts the other events starting at the same moment.
// A lead of 0 means the user asked for the clock alone.
function barState(events, nowMs, leadMinutes) {
  var lead = Number(leadMinutes) || 0
  var idle = { phase: "idle", event: null, extra: 0, countdownMs: 0 }
  if (lead <= 0) return idle

  var candidates = announceableEvents(events)
  var chosen = null
  var phase = "idle"
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i]
    var live = c.start <= nowMs && nowMs - c.start <= LIVE_MINUTES * MINUTE_MS && nowMs < c.end
    if (live && (phase !== "live" || c.start > chosen.start)) {
      chosen = c
      phase = "live"
    } else if (phase !== "live" && c.start > nowMs && c.start - nowMs <= lead * MINUTE_MS
               && (!chosen || c.start < chosen.start)) {
      chosen = c
      phase = "soon"
    }
  }
  if (!chosen) return idle

  var countdownMs = chosen.start - nowMs
  if (phase === "soon" && countdownMs <= Math.min(IMMINENT_MINUTES, lead) * MINUTE_MS) phase = "imminent"

  var extra = 0
  for (var j = 0; j < candidates.length; j++)
    if (candidates[j] !== chosen && candidates[j].start === chosen.start) extra++

  return { phase: phase, event: chosen.event, extra: extra, countdownMs: countdownMs }
}

// The words after the clock for a barState: "Standup in 8 min", "Now:
// Standup", or "" when idle. The "+N" chip is drawn apart from it.
function barLabel(state, lang, limit) {
  if (!state || !state.event || state.phase === "idle") return ""
  var title = truncateTitle(classifyEvent(state.event).title, limit)
  if (state.phase === "live") return Strings.tr(lang, "bar.live", [title])
  return Strings.tr(lang, "bar.soon", [title, spanText(Math.max(1, Math.ceil(state.countdownMs / MINUTE_MS)), lang)])
}

// The meeting a middle click on the bar means: the one being announced,
// else one under way (the latest to start), else the next one today.
function meetingToJoin(events, nowMs, announced) {
  if (announced && meetingUrlFor(announced)) return announced
  var todayKey = keyForMs(nowMs)
  var current = null
  var next = null
  for (var i = 0; i < (events || []).length; i++) {
    var event = events[i]
    if (!event || event.allDay || !meetingUrlFor(event)) continue
    var range = timeRange(event)
    if (range.start <= nowMs && nowMs < range.end) {
      if (!current || range.start > timeRange(current).start) current = event
    } else if (range.start > nowMs && keyForMs(range.start) === todayKey) {
      if (!next || range.start < timeRange(next).start) next = event
    }
  }
  return current || next
}

// ---- Reminders. Desktop notifications fire at each event's own reminder
//      times (the `reminders` minutes the sync writes); a meeting with none
//      still gets one, because a link is the thing people miss. Fired keys
//      are kept by the caller so a shell reload never repeats one.

var DEFAULT_REMINDER_MINUTES = 10
// Long enough to outlive any clock or timezone wobble after the event.
var FIRED_RETENTION_MS = DAY_MS

// Minutes before the start, ascending. All-day events get none unless the
// calendar set some.
function reminderMinutesFor(event, fallbackMinutes) {
  var minutes = []
  var raw = event && event.reminders
  if (Array.isArray(raw)) {
    for (var i = 0; i < raw.length; i++) {
      var n = typeof raw[i] === "number" ? Math.round(raw[i]) : (/^\s*\d+\s*$/.test(text(raw[i])) ? Number(raw[i]) : NaN)
      if (isFinite(n) && n >= 0 && minutes.indexOf(n) === -1) minutes.push(n)
    }
  }
  if (minutes.length === 0 && event && !event.allDay && meetingUrlFor(event))
    minutes.push(fallbackMinutes === undefined ? DEFAULT_REMINDER_MINUTES : Number(fallbackMinutes))
  return minutes.sort(function(a, b) { return a - b })
}

// The start is part of the key, so a rescheduled event reminds again.
function reminderKey(event, minutes) {
  return text(event && event.id) + "|" + text(event && event.start) + "|" + minutes
}

function isFired(fired, key) {
  if (!fired) return false
  if (Array.isArray(fired)) return fired.indexOf(key) !== -1
  return Object.prototype.hasOwnProperty.call(fired, key)
}

// The reminders to show now, one per event: the latest one whose time has
// come, while the event has not started -- so a laptop that slept through
// a reminder still gives it on waking, but never for something already
// under way. `keys` lists every reminder of that event the notification
// stands for; mark them all fired (markFired). Anything due before
// options.notBeforeMs is left alone: pass the time the fired-key store was
// created, so a first run does not flood a backlog.
// options: { notBeforeMs, fallbackMinutes }.
// Returns [{ key, keys, event, minutes, fireAtMs, startMs }] by fire time.
function dueReminders(events, nowMs, firedKeys, options) {
  var opts = options || {}
  var notBefore = opts.notBeforeMs === undefined || opts.notBeforeMs === null ? -Infinity : Number(opts.notBeforeMs)
  var due = []
  var seen = {}

  for (var i = 0; i < (events || []).length; i++) {
    var event = events[i]
    if (!event || isDeclined(event) || isNoisyEventType(event) || classifyEvent(event).done) continue
    var startMs = timeRange(event).start
    if (isNaN(startMs) || startMs <= nowMs) continue

    var minutes = reminderMinutesFor(event, opts.fallbackMinutes)
    var keys = []
    var latest = null
    for (var m = 0; m < minutes.length; m++) {
      var key = reminderKey(event, minutes[m])
      var fireAtMs = startMs - minutes[m] * MINUTE_MS
      if (seen[key] || isFired(firedKeys, key) || fireAtMs > nowMs || fireAtMs < notBefore) continue
      seen[key] = true
      keys.push(key)
      if (!latest || fireAtMs > latest.fireAtMs) latest = { minutes: minutes[m], fireAtMs: fireAtMs, key: key }
    }
    if (latest)
      due.push({ key: latest.key, keys: keys, event: event, minutes: latest.minutes,
                 fireAtMs: latest.fireAtMs, startMs: startMs })
  }

  due.sort(function(a, b) { return (a.fireAtMs - b.fireAtMs) || (a.startMs - b.startMs) })
  return due
}

// A new fired map ({ key: startMs }) with the given dueReminders entries.
function markFired(fired, due) {
  var next = {}
  for (var key in (fired || {})) next[key] = fired[key]
  for (var i = 0; i < (due || []).length; i++) {
    var keys = due[i].keys || [due[i].key]
    for (var k = 0; k < keys.length; k++) next[keys[k]] = due[i].startMs
  }
  return next
}

// Drops keys whose event started more than a day ago; they can never be due
// again. Unreadable entries go too.
function pruneFired(fired, nowMs) {
  var next = {}
  for (var key in (fired || {})) {
    var startMs = Number(fired[key])
    if (isFinite(startMs) && startMs + FIRED_RETENTION_MS > nowMs) next[key] = startMs
  }
  return next
}

// "At start time", "10 minutes before", "1 day before": the largest whole
// unit the minutes divide into.
function reminderLabel(minutes, lang) {
  var n = Number(minutes)
  if (n === 0) return Strings.tr(lang, "reminder.atStart")
  if (n % 10080 === 0) return Strings.trn(lang, "reminder.weeks", n / 10080)
  if (n % 1440 === 0) return Strings.trn(lang, "reminder.days", n / 1440)
  if (n % 60 === 0) return Strings.trn(lang, "reminder.hours", n / 60)
  return Strings.trn(lang, "reminder.minutes", n)
}

// The inspector's reminder line, using the same rule as dueReminders.
function reminderSummary(event, lang, fallbackMinutes) {
  var minutes = reminderMinutesFor(event, fallbackMinutes)
  if (minutes.length === 0) return Strings.tr(lang, "insp.noReminder")
  var labels = []
  for (var i = 0; i < minutes.length; i++) labels.push(reminderLabel(minutes[i], lang))
  return Strings.tr(lang, "insp.reminders", [labels.join(", ")])
}

// ---- Reminder notifications: what the bar widget sends and remembers.

// How long after a reminder the panel offers to snooze it.
var SNOOZE_WINDOW_MS = 15 * MINUTE_MS

// One key per occurrence ("id|start"), whichever of its reminders fired.
function reminderEventKey(event) {
  return text(event && event.id) + "|" + text(event && event.start)
}

// `recent` maps reminderEventKey → when its reminder was sent.
function canSnoozeReminder(recent, event, nowMs) {
  var firedAt = recent ? recent[reminderEventKey(event)] : undefined
  return firedAt !== undefined && nowMs - firedAt < SNOOZE_WINDOW_MS
}

// `recent` without the entries too old to snooze.
function pruneRecentReminders(recent, nowMs) {
  var next = {}
  for (var key in (recent || {}))
    if (nowMs - Number(recent[key]) < SNOOZE_WINDOW_MS) next[key] = Number(recent[key])
  return next
}

// Only what a snoozed reminder needs to be rebuilt after a shell reload.
function slimReminderEvent(event) {
  return {
    id: event.id, start: event.start, end: event.end, allDay: event.allDay === true,
    dateKey: event.dateKey, title: event.title, location: event.location,
    meetingUrl: event.meetingUrl, eventUrl: event.eventUrl
  }
}

function capitalized(value) {
  var s = text(value)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function reminderTitle(event, lang) {
  var title = text(event.title).trim()
  return truncateTitle(title || Strings.tr(lang, "common.noTitle"), 80)
}

// "Standup in 10 min", "Standup is starting"; an all-day event is just its
// title, the day goes in the body.
function reminderHeadline(event, nowMs, lang) {
  if (event.allDay) return reminderTitle(event, lang)
  var minutes = Math.ceil((timeRange(event).start - nowMs) / MINUTE_MS)
  return minutes >= 1
    ? Strings.tr(lang, "notify.title", [reminderTitle(event, lang), spanText(minutes, lang)])
    : Strings.tr(lang, "notify.titleNow", [reminderTitle(event, lang)])
}

// "13:00–13:45 · Google Meet", "Tomorrow · 09:00–09:30 · Room 4",
// "Tomorrow · all day". Clock times and weekday names are Qt's, so the
// caller passes formatTime(ms) and formatWeekday(ms).
function reminderBody(event, nowMs, lang, formatTime, formatWeekday) {
  if (event.allDay)
    return capitalized(relativeTime(event, nowMs, lang)) + " · " + Strings.tr(lang, "insp.allDay")

  var range = timeRange(event)
  var parts = []
  var startKey = keyForMs(range.start)
  var todayKey = keyForMs(nowMs)
  if (startKey !== todayKey)
    parts.push(relativeDayLabel(startKey, todayKey, lang) || capitalized(formatWeekday(range.start)))
  var times = formatTime(range.start)
  if (range.end > range.start) times += "–" + formatTime(range.end)
  parts.push(times)

  var where = meetingHost(meetingUrlFor(event)) || truncateTitle(text(event.location).trim(), 48)
  if (where) parts.push(where)
  return parts.join(" · ")
}

// omarchy-notification-send reads a leading "-g" or "--app-name=…" as an
// option, so a title that happens to look like one gets a word joiner in
// front and stays text.
function notificationArg(value) {
  var s = text(value)
  return /^-/.test(s) ? "\u2060" + s : s
}

// ---- Sync state

var STALE_INTERVAL_MULTIPLIER = 4

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

// The event command's reply. `event` is the form a get returns, null for
// a write.
function parseWriteReply(output, lang) {
  try {
    var reply = JSON.parse(text(output).trim())
    if (reply && reply.ok === true) return { ok: true, error: "", event: reply.event || null }
    if (reply && typeof reply.error === "string") return { ok: false, error: reply.error, event: null }
  } catch (error) {}
  return {
    ok: false,
    error: Strings.tr(lang, "error.commandFailed", [text(output).slice(0, 200) || Strings.tr(lang, "error.noOutput")]),
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

function normalizeEmail(address) {
  return text(address).trim().toLowerCase()
}

function isValidEmail(address) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(address))
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

// Suggestions for the guest field, in the sync's order (most frequent
// first): the email contains the text, or a word of the name starts with it.
function matchGuests(suggestions, query, guests, limit) {
  var wanted = normalizeEmail(query)
  if (!wanted) return []
  var taken = {}
  for (var g = 0; g < (guests || []).length; g++) taken[normalizeEmail(guests[g].email)] = true
  var out = []
  var list = suggestions || []
  for (var i = 0; i < list.length && out.length < (limit || 5); i++) {
    var email = normalizeEmail(list[i].email)
    if (taken[email]) continue
    var words = text(list[i].name).toLowerCase().split(/\s+/)
    var byName = false
    for (var w = 0; w < words.length; w++) if (words[w] && words[w].indexOf(wanted) === 0) byName = true
    if (email.indexOf(wanted) >= 0 || byName) out.push(list[i])
  }
  return out
}

// Returns the same array when nothing was added, so the caller can tell.
function addGuest(guests, address) {
  var email = normalizeEmail(address)
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

// The notification menu for a form's reminders, with "custom" only when the
// event already has a setting the menu cannot express.
function reminderOptions(reminders, lang) {
  var options = [
    { value: "default", label: Strings.tr(lang, "reminder.default") },
    { value: "none", label: Strings.tr(lang, "reminder.none") }
  ]
  for (var i = 0; i < REMINDER_MINUTES.length; i++)
    options.push({ value: String(REMINDER_MINUTES[i]), label: reminderLabel(REMINDER_MINUTES[i], lang) })
  if (reminderChoice(reminders) === "custom")
    options.push({ value: "custom", label: Strings.tr(lang, "reminder.custom") })
  return options
}

// The start menu: every 15 minutes of the day. The end menu (fromMinutes is
// the start): from 15 minutes after the start up to midnight, with the
// duration, as Google shows it. "00:00" at the end means that midnight.
// Labels come from the caller's format; `lang` (default English) words the
// durations.
function timeOptions(fromMinutes, formatTime, withDuration, lang) {
  var options = []
  var first = fromMinutes < 0 ? 0 : fromMinutes + 15
  var last = fromMinutes < 0 ? 23 * 60 + 45 : 24 * 60
  for (var m = first; m <= last; m += 15) {
    var value = clockText(m)
    var label = formatTime(value)
    if (withDuration && fromMinutes >= 0) label += " (" + spanText(m - fromMinutes, lang || "en") + ")"
    options.push({ value: value, label: label })
  }
  return options
}

// Which weekday of its month a date is: 1 to 4, or -1 in the last 7 days.
// Kept in step with event_form.nth_weekday on the Python side.
function nthWeekday(key) {
  var p = partsOfKey(key)
  var daysInMonth = new Date(p.year, p.month + 1, 0).getDate()
  var weekday = new Date(p.year, p.month, p.day).getDay()
  return { n: p.day + 7 > daysInMonth ? -1 : Math.floor((p.day - 1) / 7) + 1, weekday: weekday }
}

// The repeat menu, labelled from the start date. `withCustom` adds the
// entry for a rule the presets cannot express, which is kept as it is.
function repeatOptions(key, lang, withCustom) {
  var p = partsOfKey(key)
  var nth = nthWeekday(key)
  var gender = Strings.weekdayGender(lang, nth.weekday)
  var weekday = Strings.tr(lang, "weekday." + nth.weekday)
  var options = [
    { value: "none", label: Strings.tr(lang, "repeat.none") },
    { value: "daily", label: Strings.tr(lang, "repeat.daily") },
    { value: "weekly", label: Strings.trFor(lang, "repeat.weekly", gender, [weekday]) },
    { value: "monthly", label: Strings.trFor(lang, "repeat.monthly", gender,
        [Strings.trFor(lang, "ordinal." + nth.n, gender), weekday]) },
    { value: "yearly", label: Strings.tr(lang, "repeat.yearly", [p.day, Strings.tr(lang, "month." + p.month)]) },
    { value: "weekdays", label: Strings.tr(lang, "repeat.weekdays") }
  ]
  if (withCustom) options.push({ value: "custom", label: Strings.tr(lang, "repeat.custom") })
  return options
}

// ---- Quick add. One line in either language ("call with Ana tomorrow 2pm
//      for 45m", "dentista sexta às 15h") becomes a draft event. English and
//      Portuguese are always both understood; `lang` only decides whether
//      12/10 is a day-month or month-day date. Matching runs on a folded
//      copy of the text (lower case, no accents, same length), and every
//      phrase it understands is blanked out of the original, so the title
//      is whatever words are left, in the user's own spelling.

var DEFAULT_QUICK_DURATION = 60

var QUICK_WEEKDAYS = [
  ["sunday", "sun", "domingo", "dom"],
  ["monday", "mon", "segunda", "seg"],
  ["tuesday", "tues", "tue", "terca", "ter"],
  ["wednesday", "wed", "quarta", "qua"],
  ["thursday", "thurs", "thur", "thu", "quinta", "qui"],
  ["friday", "fri", "sexta", "sex"],
  ["saturday", "sat", "sabado", "sab"]
]

// Short forms that are also ordinary words ("Ter aula com Ana", "sun lamp",
// "Dom Casmurro") are only a weekday with something that says so: a word
// that introduces a day before them ("na ter", "next sat", "até sex"), or
// a time right after ("sex 15h", "sun at 5pm"). Full names always count.
var QUICK_AMBIGUOUS_WEEKDAYS = ["sun", "sat", "wed", "dom", "ter", "sex"]

// Portuguese abbreviations that are also English words ("set", "out") only
// count after "de" ("12 de out"), and only English is ever written month
// first ("Oct 12").
var QUICK_MONTHS = [
  ["january", "janeiro"], ["february", "fevereiro"], ["march", "marco"], ["april", "abril"],
  ["may", "maio"], ["june", "junho"], ["july", "julho"], ["august", "agosto"],
  ["september", "setembro"], ["october", "outubro"], ["november", "novembro"], ["december", "dezembro"]
]
var QUICK_MONTHS_EN_SHORT = [["jan"], ["feb"], ["mar"], ["apr"], [], ["jun"], ["jul"], ["aug"],
  ["sept", "sep"], ["oct"], ["nov"], ["dec"]]
var QUICK_MONTHS_PT_SHORT = [["jan"], ["fev"], ["mar"], ["abr"], ["mai"], ["jun"], ["jul"], ["ago"],
  ["set"], ["out"], ["nov"], ["dez"]]

var FOLDED_LETTERS = {
  "á": "a", "à": "a", "â": "a", "ã": "a", "ä": "a", "é": "e", "è": "e", "ê": "e", "ë": "e",
  "í": "i", "ì": "i", "î": "i", "ï": "i", "ó": "o", "ò": "o", "ô": "o", "õ": "o", "ö": "o",
  "ú": "u", "ù": "u", "û": "u", "ü": "u", "ç": "c"
}

// Index of the first table row containing `word`.
function rowOf(word, tables) {
  for (var t = 0; t < tables.length; t++)
    for (var i = 0; i < tables[t].length; i++)
      if (tables[t][i].indexOf(word) !== -1) return i
  return -1
}

// A regex alternation of every word in the tables, longest first so "sept"
// is tried before "sep".
function alternation(tables) {
  var words = []
  for (var t = 0; t < tables.length; t++)
    for (var i = 0; i < tables[t].length; i++) words = words.concat(tables[t][i])
  words.sort(function(a, b) { return b.length - a.length })
  return "(" + words.join("|") + ")"
}

var QUICK_FULL_MONTH = alternation([QUICK_MONTHS, QUICK_MONTHS_EN_SHORT])
var QUICK_PT_SHORT_MONTH = alternation([QUICK_MONTHS_PT_SHORT])
var QUICK_EN_MONTH = alternation([QUICK_MONTHS.map(function(row) { return [row[0]] }), QUICK_MONTHS_EN_SHORT])
var QUICK_WEEKDAY = alternation([QUICK_WEEKDAYS])
var QUICK_CLOCK = "\\d{1,2}(?::\\d{2})?\\s?(?:am|pm|a\\.m\\.?|p\\.m\\.?)|\\d{1,2}:\\d{2}|\\d{1,2}h(?:\\d{2})?"
  + "|noon|midday|midnight|meio-dia|meio dia|meia-noite|meia noite"
var QUICK_DATE_PREFIX = "(?:(?:on|em|no dia|dia|by|until|ate|para|pra) )?"
var QUICK_ORDINAL = "(?:st|nd|rd|th)?"

var QUICK_PATTERNS = {
  allDay: /\s(?:all day|all-day|o dia todo|dia todo|dia inteiro)(?=\s)/,
  isoDate: new RegExp("\\s" + QUICK_DATE_PREFIX + "(\\d{4})-(\\d{2})-(\\d{2})(?=\\s)"),
  numericDate: new RegExp("\\s" + QUICK_DATE_PREFIX + "(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?(?=\\s)"),
  dayMonth: new RegExp("\\s" + QUICK_DATE_PREFIX + "(?:the )?(\\d{1,2})" + QUICK_ORDINAL
    + " (?:(?:de |of )?" + QUICK_FULL_MONTH + "|de " + QUICK_PT_SHORT_MONTH + ")(?:,?\\s+(?:de )?(\\d{4}))?(?=\\s)"),
  monthDay: new RegExp("\\s(?:on )?" + QUICK_EN_MONTH + " (\\d{1,2})" + QUICK_ORDINAL + "(?:,?\\s+(\\d{4}))?(?=\\s)"),
  dayAfterTomorrow: /\s(?:depois de amanha|day after tomorrow)(?=\s)/,
  tomorrow: /\s(?:amanha|tomorrow)(?=\s)/,
  today: /\s(?:hoje|today|tonight)(?=\s)/,
  // Groups: 1 a word introducing the day, 2 next/próxima, 3 the weekday,
  // 4 "que vem", 5 a time straight after (looked at, not consumed).
  weekday: new RegExp("\\s((?:on|na|no|nesta|neste|esta|este|this|by|until|ate) )?((?:next|proxima|proximo) )?"
    + QUICK_WEEKDAY + "(?:-feira| feira)?( que vem)?"
    + "(?=\\s(?:((?:(?:at|as|a partir das|starting at|from|das|entre|@)\\s?)?(?:" + QUICK_CLOCK + ")"
    + "|(?:at|as|@)\\s?\\d{1,2})(?=[\\s\\-\u2013]))?)"),
  monthDayOnly: /\s(?:(?:on )?the (\d{1,2})(?:st|nd|rd|th)?|(?:on )?(\d{1,2})(?:st|nd|rd|th)|(?:no )?dia (\d{1,2}))(?=\s)/,
  timeRange: new RegExp("\\s(?:(?:from|de|das|entre) )?(" + QUICK_CLOCK + "|\\d{1,2})"
    + "\\s?(?:-|\u2013|to|until|till|ate|as|a|e)\\s?(" + QUICK_CLOCK + ")(?=\\s)"),
  prefixedTime: new RegExp("\\s(?:at|as|a partir das|starting at|@)\\s?(" + QUICK_CLOCK + "|\\d{1,2})(?=\\s)"),
  plainTime: /\s(\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.?|p\.m\.?)|\d{1,2}:\d{2}|noon|midday|midnight|meio-dia|meio dia|meia-noite|meia noite)(?=\s)/,
  hourPhrase: /\s(\d{1,2}h(?:\d{2})?)(?=\s)/,
  prefixedDuration: /\s(?:for|por|durante) (?:about |cerca de )?(\d+(?:[.,]\d+)?\s?(?:h|hr|hrs|hour|hours|hora|horas)(?:\s?\d{1,2}\s?(?:m|min|mins|minutes|minutos)?)?|\d+\s?(?:m|min|mins|minute|minutes|minuto|minutos)|(?:an|one|uma) (?:hour|hora)|half an hour|meia hora)(?=\s)/,
  plainDuration: /\s(\d+\s?(?:m|min|mins|minute|minutes|minuto|minutos)|\d+[.,]\d+\s?(?:h|hr|hrs|hours?|horas?)|\d+ (?:hours?|horas?|hrs?)|half an hour|meia hora)(?=\s)/,
  meet: /\s(?:google meet|meet|call|video call|videocall|video|zoom|videochamada|chamada|videoconferencia|reuniao online)(?=\s)/
}

// Words that only introduce the phrase after them ("até dia 5", "for 45m")
// and would otherwise be left dangling in the title.
var QUICK_LEADING_WORDS = ["on", "at", "for", "from", "by", "until", "ate", "as", "em", "no", "na", "de", "do",
  "da", "das", "para", "pra", "por", "durante", "this", "next", "proxima", "proximo"]

function foldForMatching(original) {
  var lower = original.toLowerCase()
  if (lower.length !== original.length) lower = original
  var folded = lower.replace(/[^\x00-\x7f]/g, function(c) { return FOLDED_LETTERS[c] || c })
  // Sentence punctuation separates words; inside "1,5h", "14:30" or "a.m."
  // it does not.
  return folded.replace(/[;!?()\[\]"]/g, " ").replace(/[.,:](?=\s|$)/g, " ")
}

function quickScanner(input) {
  var original = " " + input + " "
  return { original: original, folded: " " + foldForMatching(input) + " " }
}

function blank(scanner, from, to) {
  var spaces = new Array(to - from + 1).join(" ")
  scanner.original = scanner.original.substring(0, from) + spaces + scanner.original.substring(to)
  scanner.folded = scanner.folded.substring(0, from) + spaces + scanner.folded.substring(to)
  var before = scanner.folded.substring(0, from).match(/(\S+)\s*$/)
  if (before && QUICK_LEADING_WORDS.indexOf(before[1]) !== -1)
    blank(scanner, from - before[0].length, from - before[0].length + before[1].length)
}

// Finds `pattern` (which starts with one whitespace character) in the
// folded text and hands each match to `read` until one is accepted
// (anything but null); only that one is blanked out.
function take(scanner, pattern, read) {
  for (var offset = 0; ; ) {
    var match = scanner.folded.substring(offset).match(pattern)
    if (!match) return null
    var at = offset + match.index
    var value = read(match)
    if (value !== null && value !== undefined) {
      blank(scanner, at + 1, at + match[0].length)
      return value
    }
    offset = at + 1
  }
}

function validDay(year, month, day) {
  var date = new Date(year, month, day)
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null
}

// A date given without a year means the next time it comes round.
function upcomingDate(today, month, day, year) {
  if (year !== undefined && year !== null && year !== "") {
    var y = Number(year)
    return validDay(y < 100 ? 2000 + y : y, month, day)
  }
  var date = validDay(today.getFullYear(), month, day)
  if (date && date < today) date = validDay(today.getFullYear() + 1, month, day)
  return date
}

function readDate(scanner, today, lang) {
  var dayFirst = lang === "pt"
  var p = QUICK_PATTERNS
  var date = take(scanner, p.isoDate, function(m) {
    return validDay(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  })
  if (!date) date = take(scanner, p.numericDate, function(m) {
    var a = Number(m[1])
    var b = Number(m[2])
    return upcomingDate(today, (dayFirst ? b : a) - 1, dayFirst ? a : b, m[3])
  })
  if (!date) date = take(scanner, p.dayMonth, function(m) {
    return upcomingDate(today, rowOf(m[2] || m[3], [QUICK_MONTHS, QUICK_MONTHS_EN_SHORT, QUICK_MONTHS_PT_SHORT]), Number(m[1]), m[4])
  })
  if (!date) date = take(scanner, p.monthDay, function(m) {
    return upcomingDate(today, rowOf(m[1], [QUICK_MONTHS, QUICK_MONTHS_EN_SHORT]), Number(m[2]), m[3])
  })
  if (!date) date = take(scanner, p.dayAfterTomorrow, function() { return offsetDate(today, 2) })
  if (!date) date = take(scanner, p.tomorrow, function() { return offsetDate(today, 1) })
  if (!date) date = take(scanner, p.today, function() { return today })
  // A weekday is the next one coming, today included; "next friday" /
  // "próxima sexta" / "sexta que vem" skip today, so on a Friday they mean
  // a week from now.
  if (!date) date = take(scanner, p.weekday, function(m) {
    if (QUICK_AMBIGUOUS_WEEKDAYS.indexOf(m[3]) !== -1 && !(m[1] || m[2] || m[4] || isStartTime(m[5]))) return null
    var ahead = (rowOf(m[3], [QUICK_WEEKDAYS]) - today.getDay() + 7) % 7
    if (ahead === 0 && (m[2] || m[4])) ahead = 7
    return offsetDate(today, ahead)
  })
  // "dia 12" / "on the 12th": this month, or the next month that has that
  // day once it has gone by.
  if (!date) date = take(scanner, p.monthDayOnly, function(m) {
    var day = Number(m[1] || m[2] || m[3])
    for (var ahead = 0; ahead <= 12 && day >= 1 && day <= 31; ahead++) {
      var month = new Date(today.getFullYear(), today.getMonth() + ahead, 1)
      var candidate = validDay(month.getFullYear(), month.getMonth(), day)
      if (candidate && candidate >= today) return candidate
    }
    return null
  })
  return date
}

function offsetDate(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

// One time phrase as { minutes, meridiem, bare }, or null. `bare` is a
// lone number ("at 3"), which reads 1-7 as afternoon: nobody books "at 3"
// meaning three in the morning.
function readClock(word) {
  var named = { "noon": 720, "midday": 720, "meio-dia": 720, "meio dia": 720,
                "midnight": 0, "meia-noite": 0, "meia noite": 0 }
  if (named.hasOwnProperty(word)) return { minutes: named[word], meridiem: "", bare: false }
  var m = word.match(/^(\d{1,2})(?:[:h](\d{2})?)?\s?(am|pm|a\.m\.?|p\.m\.?)?$/)
  if (!m) return null
  var hours = Number(m[1])
  var minutes = Number(m[2] || 0)
  var meridiem = m[3] ? m[3].charAt(0) : ""
  if (minutes > 59) return null
  if (meridiem) {
    if (hours < 1 || hours > 12) return null
    hours = hours % 12 + (meridiem === "p" ? 12 : 0)
  } else if (hours > 23) {
    return null
  }
  return { minutes: hours * 60 + minutes, meridiem: meridiem, bare: /^\d{1,2}$/.test(word) }
}

function resolvedClock(clock) {
  if (clock.bare && clock.minutes >= 60 && clock.minutes <= 7 * 60) return clock.minutes + 12 * 60
  return clock.minutes
}

// A bare "14h" is a time and a bare "1h30" a length: nobody quick-adds a
// meeting for half past one in the morning. Once the start is known, any
// hour phrase left ("14h 2h") is a length.
var EARLIEST_HOUR_PHRASE = 6

// Whether a phrase readTimes would take as a start time, by the same rules:
// "14h", "at 3", "2pm" are; "2h" on its own is a length.
function isStartTime(phrase) {
  if (!phrase) return false
  var prefixed = phrase.match(/^(?:at|as|a partir das|starting at|from|das|entre|@)\s?(.+)$/)
  var clock = readClock(prefixed ? prefixed[1] : phrase)
  if (!clock) return false
  return !!prefixed || !/^\d{1,2}h/.test(phrase) || clock.minutes >= EARLIEST_HOUR_PHRASE * 60
}

function readTimes(scanner) {
  var p = QUICK_PATTERNS
  var range = take(scanner, p.timeRange, function(m) {
    var first = readClock(m[1])
    var second = readClock(m[2])
    if (!first || !second) return null
    var start = first.minutes
    // "2-3pm": the first half borrows the second's am/pm when that keeps
    // the order.
    if (!first.meridiem && second.meridiem === "p" && start < 12 * 60 && start + 12 * 60 <= second.minutes)
      start += 12 * 60
    else if (first.bare && !second.meridiem) return null
    return { start: start, end: second.minutes }
  })
  if (range) return range

  var start = take(scanner, p.prefixedTime, function(m) {
    var clock = readClock(m[1])
    return clock ? resolvedClock(clock) : null
  })
  if (start === null) start = take(scanner, p.plainTime, function(m) {
    var clock = readClock(m[1])
    return clock ? clock.minutes : null
  })
  if (start === null) start = take(scanner, p.hourPhrase, function(m) {
    var clock = readClock(m[1])
    return clock && clock.minutes >= EARLIEST_HOUR_PHRASE * 60 ? clock.minutes : null
  })
  return start === null ? null : { start: start, end: null }
}

function durationMinutes(phrase) {
  if (/half an hour|meia hora/.test(phrase)) return 30
  if (/^(?:an|one|uma) /.test(phrase)) return 60
  var m = phrase.match(/^(\d+(?:[.,]\d+)?)\s?(h|hr|hrs|hours?|horas?)?(?:\s?(\d{1,2}))?/)
  if (!m) return null
  var amount = Number(m[1].replace(",", "."))
  var minutes = m[2] ? Math.round(amount * 60) + Number(m[3] || 0) : amount
  return minutes > 0 && minutes <= 24 * 60 ? minutes : null
}

function readDuration(scanner, hasTime) {
  var p = QUICK_PATTERNS
  var read = function(m) { return durationMinutes(m[1]) }
  var minutes = take(scanner, p.prefixedDuration, read)
  if (minutes === null) minutes = take(scanner, p.plainDuration, read)
  if (minutes === null) minutes = take(scanner, p.hourPhrase, function(m) {
    var clock = readClock(m[1])
    return hasTime || (clock && clock.minutes < EARLIEST_HOUR_PHRASE * 60) ? durationMinutes(m[1]) : null
  })
  return minutes
}

// { title, dateKey, endDateKey, allDay, startTime, endTime,
//   durationMinutes, meet }, or null when there is no title to create.
// `now` is a Date or ms. No time means an all-day event (startTime and
// endTime "", durationMinutes 0); a time with no length lasts an hour.
function parseQuickAdd(input, now, lang) {
  var raw = text(input).trim()
  if (!/[0-9A-Za-z\u00c0-\u024f]/.test(raw)) return null

  var nowDate = typeof now === "number" ? new Date(now) : now
  var today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate())
  var scanner = quickScanner(raw)
  var meet = QUICK_PATTERNS.meet.test(scanner.folded)

  var forcedAllDay = take(scanner, QUICK_PATTERNS.allDay, function() { return true }) === true
  var date = readDate(scanner, today, lang) || today
  var times = readTimes(scanner)
  var length = readDuration(scanner, times !== null)

  // Punctuation stranded by a blanked phrase ("Trip [7 p.m]." ) goes too.
  var title = scanner.original.replace(/(^|\s)[.,;:!?]+(?=\s|$)/g, "$1").replace(/\s+/g, " ")
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/^[\s,;:·\-\u2013\u2014]+|[\s,;:·\-\u2013\u2014]+$/g, "")
  if (title === "") return null

  var key = keyForDate(date)
  if (forcedAllDay || times === null)
    return { title: title, dateKey: key, endDateKey: key, allDay: true,
             startTime: "", endTime: "", durationMinutes: 0, meet: meet }

  var duration = times.end !== null
    ? ((times.end - times.start + 24 * 60 - 1) % (24 * 60)) + 1
    : (length || DEFAULT_QUICK_DURATION)
  var endMinutes = times.start + duration
  // Ending exactly at midnight stays on the start date, as the event form
  // reads "00:00" as that midnight.
  var endKey = endMinutes > 24 * 60 ? addDays(key, Math.floor(endMinutes / (24 * 60))) : key
  return { title: title, dateKey: key, endDateKey: endKey, allDay: false,
           startTime: clockText(times.start), endTime: clockText(endMinutes % (24 * 60)),
           durationMinutes: duration, meet: meet }
}

// The event form a quick add opens as, for "More options" or a direct save.
function quickAddForm(parsed, calendarId) {
  var form = newEventForm(parsed.dateKey, { start: parsed.startTime, end: parsed.endTime }, calendarId)
  form.title = parsed.title
  form.allDay = parsed.allDay
  form.endDate = parsed.endDateKey || parsed.dateKey
  form.meet = !!parsed.meet
  return form
}

function compactDate(key) {
  return text(key).replace(/-/g, "")
}

// Google Calendar's prefilled "new event" page, for a read-only setup. Times
// are local and unzoned, which Google reads in the account's own timezone;
// an all-day end is exclusive, as Google wants it.
function googleTemplateUrl(parsed) {
  if (!parsed || !parsed.dateKey) return ""
  var endKey = parsed.endDateKey || parsed.dateKey
  var dates = parsed.allDay
    ? compactDate(parsed.dateKey) + "/" + compactDate(addDays(endKey, 1))
    : compactDate(parsed.dateKey) + "T" + parsed.startTime.replace(":", "") + "00/"
      + compactDate(endKey) + "T" + parsed.endTime.replace(":", "") + "00"
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeQuery(parsed.title)
    + "&dates=" + dates
}
