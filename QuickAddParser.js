.pragma library
.import "Model.js" as Model

// Quick add. One line in either language ("call with Ana tomorrow 2pm
// for 45m", "dentista sexta às 15h") becomes a draft event. English and
// Portuguese are always both understood; `lang` only decides whether
// 12/10 is a day-month or month-day date. Matching runs on a folded
// copy of the text (lower case, no accents, same length), and every
// phrase it understands is blanked out of the original, so the title
// is whatever words are left, in the user's own spelling.

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
  // Groups: 1 the word that opens a range, 2 its start, 3 its end.
  timeRange: new RegExp("\\s(?:(from|de|das|entre) )?(" + QUICK_CLOCK + "|\\d{1,2})"
    + "\\s?(?:-|\u2013|to|until|till|ate|as|a|e)\\s?(" + QUICK_CLOCK + "|\\d{1,2})(?=\\s)"),
  prefixedTime: new RegExp("\\s(?:at|as|a partir das|starting at|@)\\s?(" + QUICK_CLOCK + "|\\d{1,2})(?=\\s)"),
  // An end with no start: "until 11am", "até às 11h".
  untilTime: new RegExp("\\s(?:until|till|til|ate(?: as| a)?)\\s?(" + QUICK_CLOCK + "|\\d{1,2})(?=\\s)"),
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
    var first = readClock(m[2])
    var second = readClock(m[3])
    if (!first || !second) return null
    if (first.bare && second.bare) {
      // "Kids 2-3" is no time; "from 2 to 4", "das 9 às 13" and "9-13" are.
      if (!m[1] && first.minutes < 13 * 60 && second.minutes < 13 * 60) return null
      // Read as the hours people book: "from 2 to 4" is the afternoon, and
      // "from 9 to 1" ends at 13:00.
      var from = resolvedClock(first)
      var to = second.minutes
      if (to <= from && to + 12 * 60 > from) to += 12 * 60
      return { start: from, end: to % (24 * 60) }
    }
    var start = first.minutes
    // "2-3pm": the first half borrows the second's am/pm when that keeps
    // the order.
    if (!first.meridiem && second.meridiem === "p" && start < 12 * 60 && start + 12 * 60 <= second.minutes)
      start += 12 * 60
    return { start: start, end: second.minutes }
  })
  if (range) return range

  var until = take(scanner, p.untilTime, function(m) {
    var clock = readClock(m[1])
    return clock ? resolvedClock(clock) : null
  })
  if (until !== null) return { start: null, end: until }

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

// The stretches of `before` that are blank in `after`, as [{ at, text }]. A
// space between two blanked words keeps them together: "for 45m".
function blankedSince(before, after) {
  var runs = []
  var start = -1
  for (var i = 0; i <= before.length; i++) {
    var gone = i < before.length && before[i] !== " " && after[i] === " "
    var joins = i < before.length && before[i] === " " && start >= 0
      && i + 1 < before.length && before[i + 1] !== " " && after[i + 1] === " "
    if (gone || joins) {
      if (start < 0) start = i
    } else if (start >= 0) {
      runs.push({ at: start, text: before.substring(start, i) })
      start = -1
    }
  }
  return runs
}

// { title, dateKey, endDateKey, allDay, startTime, endTime,
//   durationMinutes, meet }, or null when there is no title to create.
// `now` is a Date or ms. No time means an all-day event (startTime and
// endTime "", durationMinutes 0); a time with no length lasts an hour.
function parseQuickAdd(input, now, lang) {
  return scanQuickAdd(input, now, lang).parsed
}

// The words quick add read as something else than the title, in the order
// they were typed: [{ text, kind }], kind one of "date", "time",
// "duration", "allDay" and "meet". The panel shows them, so the user can
// see what was understood. A meeting word stays in the title too.
function quickAddUnderstood(input, now, lang) {
  return scanQuickAdd(input, now, lang).found
}

function scanQuickAdd(input, now, lang) {
  var raw = Model.text(input).trim()
  if (!/[0-9A-Za-z\u00c0-\u024f]/.test(raw)) return { parsed: null, found: [] }

  var nowDate = typeof now === "number" ? new Date(now) : now
  var today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate())
  var scanner = quickScanner(raw)
  var found = []
  var meetMatch = scanner.folded.match(QUICK_PATTERNS.meet)
  var meet = meetMatch !== null
  if (meet) found.push({ at: meetMatch.index + 1,
    text: scanner.original.substring(meetMatch.index + 1, meetMatch.index + meetMatch[0].length), kind: "meet" })

  // Each reading blanks what it took; the difference is what it understood.
  var before = scanner.original
  function note(kind) {
    var runs = blankedSince(before, scanner.original)
    for (var r = 0; r < runs.length; r++) found.push({ at: runs[r].at, text: runs[r].text, kind: kind })
    before = scanner.original
  }

  var forcedAllDay = take(scanner, QUICK_PATTERNS.allDay, function() { return true }) === true
  note("allDay")
  var date = readDate(scanner, today, lang) || today
  note("date")
  var times = readTimes(scanner)
  note("time")
  var length = readDuration(scanner, times !== null)
  note("duration")
  found.sort(function(a, b) { return a.at - b.at })
  found = found.map(function(f) { return { text: f.text, kind: f.kind } })

  // Punctuation stranded by a blanked phrase ("Trip [7 p.m]." ) goes too.
  var title = scanner.original.replace(/(^|\s)[.,;:!?]+(?=\s|$)/g, "$1").replace(/\s+/g, " ")
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/^[\s,;:·\-\u2013\u2014]+|[\s,;:·\-\u2013\u2014]+$/g, "")
  if (title === "") return { parsed: null, found: found }

  var key = Model.keyForDate(date)
  // "until 11am" alone: from now, at the quarter hour before, when that is
  // still ahead today; otherwise the usual length, ending then.
  if (times !== null && times.start === null) {
    var nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()
    var fromNow = key === Model.keyForDate(today) && nowMinutes < times.end
    times = { start: fromNow ? Math.floor(nowMinutes / 15) * 15 : Math.max(0, times.end - DEFAULT_QUICK_DURATION),
              end: times.end }
  }
  if (forcedAllDay || times === null)
    return { found: found, parsed: { title: title, dateKey: key, endDateKey: key, allDay: true,
             startTime: "", endTime: "", durationMinutes: 0, meet: meet } }

  var duration = times.end !== null
    ? ((times.end - times.start + 24 * 60 - 1) % (24 * 60)) + 1
    : (length || DEFAULT_QUICK_DURATION)
  var endMinutes = times.start + duration
  // Ending exactly at midnight stays on the start date, as the event form
  // reads "00:00" as that midnight.
  var endKey = endMinutes > 24 * 60 ? Model.addDays(key, Math.floor(endMinutes / (24 * 60))) : key
  return { found: found, parsed: { title: title, dateKey: key, endDateKey: endKey, allDay: false,
           startTime: Model.clockText(times.start), endTime: Model.clockText(endMinutes % (24 * 60)),
           durationMinutes: duration, meet: meet } }
}

// The event form a quick add opens as, for "More options" or a direct save.
function quickAddForm(parsed, calendarId) {
  var form = Model.newEventForm(parsed.dateKey, { start: parsed.startTime, end: parsed.endTime }, calendarId)
  form.title = parsed.title
  form.allDay = parsed.allDay
  form.endDate = parsed.endDateKey || parsed.dateKey
  form.meet = !!parsed.meet
  return form
}

function compactDate(key) {
  return Model.text(key).replace(/-/g, "")
}

// Google Calendar's prefilled "new event" page, for a read-only setup. Times
// are local and unzoned, which Google reads in the account's own timezone;
// an all-day end is exclusive, as Google wants it.
function googleTemplateUrl(parsed) {
  if (!parsed || !parsed.dateKey) return ""
  var endKey = parsed.endDateKey || parsed.dateKey
  var dates = parsed.allDay
    ? compactDate(parsed.dateKey) + "/" + compactDate(Model.addDays(endKey, 1))
    : compactDate(parsed.dateKey) + "T" + parsed.startTime.replace(":", "") + "00/"
      + compactDate(endKey) + "T" + parsed.endTime.replace(":", "") + "00"
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + Model.encodeQuery(parsed.title)
    + "&dates=" + dates
}
