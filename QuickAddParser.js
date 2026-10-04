.pragma library
.import "Model.js" as Model
.import "QuickAddWords.js" as Words

// Quick add. One line in either language ("call with Ana tomorrow 2pm
// for 45m", "dentista sexta às 15h") becomes a draft event. English and
// Portuguese are always both understood; `lang` only decides whether
// 12/10 is a day-month or month-day date. Matching runs on a folded
// copy of the text (lower case, no accents, same length), and every
// phrase it understands is blanked out of the original, so the title
// is whatever words are left, in the user's own spelling.
//
// When it lands: a time with no day is today, a day with no time is all
// day, and neither is the next half hour, for half an hour.

// A time with no length lasts an hour.
var DEFAULT_QUICK_DURATION = 60
// No day and no time: the next half hour, this long.
var OPEN_SLOT_MINUTES = 30
var MINUTES_PER_DAY = 24 * 60

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

// The same for a flat list, as a group that captures nothing.
function oneOf(list) {
  return "(?:" + list.slice().sort(function(a, b) { return b.length - a.length }).join("|") + ")"
}

// Every word of a { key: [words] } table, in one list.
function wordsOf(table) {
  var words = []
  for (var key in table) words = words.concat(table[key])
  return words
}

// The key of `table` whose list holds `word`.
function keyOf(word, table) {
  for (var key in table)
    if (table[key].indexOf(word) !== -1) return key
  return null
}

var QUICK_FULL_MONTH = alternation([Words.MONTHS, Words.MONTHS_EN_SHORT])
var QUICK_PT_SHORT_MONTH = alternation([Words.MONTHS_PT_SHORT])
var QUICK_EN_MONTH = alternation([Words.MONTHS.map(function(row) { return [row[0]] }), Words.MONTHS_EN_SHORT])
var QUICK_WEEKDAY = alternation([Words.WEEKDAYS])
var QUICK_MERIDIEM = "(?:am|pm|a\\.m\\.?|p\\.m\\.?)"
var QUICK_CLOCK = "\\d{1,2}(?::\\d{2})?\\s?" + QUICK_MERIDIEM + "|\\d{1,2}:\\d{2}|\\d{1,2}h(?:\\d{2}(?:min|m)?)?(?: e meia)?"
  + "|\\d{1,2} e meia|noon|midday|midnight|meio-dia|meio dia|meia-noite|meia noite"
var QUICK_DATE_PREFIX = "(?:(?:on|em|no dia|dia|by|until|ate|para|pra) )?"
var QUICK_ORDINAL = "(?:st|nd|rd|th)?"
var QUICK_EN_HOUR = oneOf(Words.EN_HOURS)

// A count: digits, or words with a space before the unit ("two hours").
var QUICK_NUMBER_WORDS = "(?:a couple of|" + oneOf(Words.EN_TENS) + "(?:[- ]" + oneOf(Words.EN_DIGITS) + ")?|"
  + oneOf(Words.PT_TENS) + "(?: e " + oneOf(Words.PT_DIGITS) + ")?|" + oneOf(Words.TEENS) + "|"
  + oneOf(Words.EN_DIGITS.concat(Words.PT_DIGITS)) + "|an|a)"
var QUICK_COUNT = "(?:\\d+(?:[.,]\\d+)?(?: and a half)?\\s?|" + QUICK_NUMBER_WORDS + "(?: and a half)? )"
var QUICK_HALF = "(?: and a half| e meia)?"
// A length: "45m", "1h30", "two hours", "uma hora e meia", "3 days".
var QUICK_AMOUNT = "(?:half an hour|meia hora|(?:a |um )?quarter of an hour|um quarto de hora|"
  + QUICK_COUNT + oneOf(Words.HOUR_UNITS) + "(?:\\s?\\d{1,2}\\s?" + oneOf(Words.MINUTE_UNITS) + "?)?" + QUICK_HALF + "|"
  + QUICK_COUNT + oneOf(Words.MINUTE_UNITS.concat(Words.DAY_UNITS, Words.WEEK_UNITS, Words.MONTH_UNITS))
  + QUICK_HALF + ")"
var QUICK_AMOUNT_PARTS = new RegExp("^(\\d+(?:[.,]\\d+)?|" + QUICK_NUMBER_WORDS + ")( and a half)?\\s?([a-z]+)"
  + "(?:\\s?(\\d{1,2})\\s?[a-z]*)?( and a half| e meia)?$")
// What joins the two days of a range: "friday to sunday", "sexta a domingo".
var QUICK_DAY_JOIN = /^\s*(?:-|\u2013|to|until|till|through|thru|ate|a)\s+/

var QUICK_PATTERNS = {
  allDay: /\s(?:all day|all-day|the whole day|whole day|o dia todo|dia todo|o dia inteiro|dia inteiro)(?=\s)/,
  // Groups: 1 a word that introduces the address, 2 the address.
  guest: /\s((?:with|com|and|e|invite|convidar|convide|&|\+)\s+)?([a-z0-9._%+\-]+@[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.[a-z]{2,})(?=\s)/,
  // Groups: 1 every/toda/on/nas, 2 the weekday, 3 a plural s, 4 "-feiras".
  repeatWeekday: new RegExp("\\s(" + oneOf(Words.EVERY_WORDS.concat(Words.PLURAL_DAY_WORDS)) + ") "
    + QUICK_WEEKDAY + "(s)?((?:-| )feiras?)?(?=\\s)"),
  repeatPhrase: new RegExp("\\s(" + oneOf(wordsOf(Words.REPEAT_PHRASES)) + ")(?=\\s)"),
  relative: new RegExp("\\s(?:in|em|daqui a|daqui|dentro de) (?:about |around |cerca de )?(" + QUICK_AMOUNT + ")(?=\\s)"),
  now: /\s(?:right now|now|agora mesmo|agora)(?=\s)/,
  // Groups: 1 and 2 the days, 3 or 4 the month, 5 the year.
  dayRange: new RegExp("\\s(?:(?:from|de|do dia|dos dias|between|entre) )?(?:the |dia )?(\\d{1,2})" + QUICK_ORDINAL
    + "\\s?(?:-|\u2013|to|until|till|through|thru|a|ate|and|e)\\s?(?:the |o dia |dia )?(\\d{1,2})" + QUICK_ORDINAL
    + " (?:(?:de |of )?" + QUICK_FULL_MONTH + "|de " + QUICK_PT_SHORT_MONTH + ")(?:,?\\s+(?:de )?(\\d{4}))?(?=\\s)"),
  // Groups: 1 the month, 2 the first day, 3 a second month, 4 the last day, 5 the year.
  monthDayRange: new RegExp("\\s(?:from )?" + QUICK_EN_MONTH + " (\\d{1,2})" + QUICK_ORDINAL
    + "\\s?(?:-|\u2013|to|until|till|through|thru)\\s?(?:" + QUICK_EN_MONTH + " )?(\\d{1,2})" + QUICK_ORDINAL
    + "(?:,?\\s+(\\d{4}))?(?=\\s)"),
  // Groups: 1 this/next/no, 2 "que vem".
  weekend: /\s(?:(this|next|on the|the|o|no|neste|este|nesse|esse|no proximo|proximo) )?(?:weekend|fim de semana|fds)( que vem)?(?=\s)/,
  isoDate: new RegExp("\\s" + QUICK_DATE_PREFIX + "(\\d{4})-(\\d{2})-(\\d{2})(?=\\s)"),
  numericDate: new RegExp("\\s" + QUICK_DATE_PREFIX + "(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?(?=\\s)"),
  dayMonth: new RegExp("\\s" + QUICK_DATE_PREFIX + "(?:the )?(\\d{1,2})" + QUICK_ORDINAL
    + " (?:(?:de |of )?" + QUICK_FULL_MONTH + "|de " + QUICK_PT_SHORT_MONTH + ")(?:,?\\s+(?:de )?(\\d{4}))?(?=\\s)"),
  monthDay: new RegExp("\\s(?:on )?" + QUICK_EN_MONTH + " (\\d{1,2})" + QUICK_ORDINAL + "(?:,?\\s+(\\d{4}))?(?=\\s)"),
  dayAfterTomorrow: /\s(?:depois de amanha|day after tomorrow)(?=\s)/,
  tomorrow: /\s(?:amanha|tomorrow|tmrw|tmr|tomorow|tommorow|tommorrow)(?=\s)/,
  today: /\s(?:hoje|today)(?=\s)/,
  yesterday: /\s(?:ontem|yesterday)(?=\s)/,
  nextWeek: /\s(?:next week|(?:na )?semana que vem|(?:na )?proxima semana)(?=\s)/,
  // Groups: 1 a word introducing the day, 2 next/próxima/coming, 3 the
  // weekday, 4 "que vem", 5 a time straight after (looked at, not consumed).
  weekday: new RegExp("\\s((?:on|na|no|nesta|neste|esta|este|this|by|until|ate) )?((?:next|proxima|proximo|coming) )?"
    + QUICK_WEEKDAY + "(?:-feira| feira)?( que vem)?"
    + "(?=\\s(?:((?:(?:at|as|a partir das|starting at|from|das|entre|@)\\s?)?(?:" + QUICK_CLOCK + ")"
    + "|(?:at|as|@)\\s?\\d{1,2})(?=[\\s\\-\u2013]))?)"),
  monthDayOnly: /\s(?:(?:on )?the (\d{1,2})(?:st|nd|rd|th)?|(?:on )?(\d{1,2})(?:st|nd|rd|th)|(?:no )?dia (\d{1,2}))(?=\s)/,
  dayPart: new RegExp("\\s(" + oneOf(wordsOf(Words.DAY_PART_PHRASES)) + ")(?=\\s)"),
  dayPartWord: new RegExp("\\s(" + oneOf(wordsOf(Words.DAY_PART_WORDS)) + ")(?=\\s)"),
  // Groups: 1 the word that opens a range, 2 its start, 3 its end.
  timeRange: new RegExp("\\s(?:(from|de|das|entre|between) )?(" + QUICK_CLOCK + "|\\d{1,2})"
    + "\\s?(?:-|\u2013|to|until|till|ate|as|a|e|and)\\s?(" + QUICK_CLOCK + "|\\d{1,2})(?=\\s)"),
  // An end with no start: "until 11am", "até às 11h".
  untilTime: new RegExp("\\s(?:until|till|til|ate(?: as| a)?)\\s?(" + QUICK_CLOCK + "|\\d{1,2})(?=\\s)"),
  // Groups: 1 half past/quarter past/quarter to, 2 the hour, 3 am/pm.
  pastTime: new RegExp("\\s(?:(?:at|@)\\s?)?(half past|quarter past|quarter to) (\\d{1,2}|" + QUICK_EN_HOUR + ")"
    + "(?:\\s?(" + QUICK_MERIDIEM + "))?(?=\\s)"),
  // Groups: 1 the hour, 2 am/pm.
  oclock: new RegExp("\\s(?:(?:at|@)\\s?)?(\\d{1,2}|" + QUICK_EN_HOUR + ") o(?:['\u2019]| )?clock"
    + "(?:\\s?(" + QUICK_MERIDIEM + "))?(?=\\s)"),
  // Groups: 1 an English hour, 2 a Portuguese hour, 3 "e meia".
  wordTime: new RegExp("\\s(?:at (" + QUICK_EN_HOUR + ")|as (" + oneOf(Words.PT_HOURS) + ")( e meia)?)(?=\\s)"),
  prefixedTime: new RegExp("\\s(?:at|as|a partir das|starting at|@)\\s?(" + QUICK_CLOCK + "|\\d{1,2})(?=\\s)"),
  plainTime: new RegExp("\\s(\\d{1,2}(?::\\d{2})?\\s?" + QUICK_MERIDIEM + "|\\d{1,2}:\\d{2}"
    + "|noon|midday|midnight|meio-dia|meio dia|meia-noite|meia noite)(?=\\s)"),
  hourPhrase: /\s(\d{1,2}h(?:\d{2}(?:min|m)?)?(?: e meia)?)(?=\s)/,
  prefixedDuration: new RegExp("\\s(?:for|por|durante) (?:about |around |cerca de |the next )?(" + QUICK_AMOUNT + ")(?=\\s)"),
  plainDuration: /\s(\d+\s?(?:m|min|mins|minute|minutes|minuto|minutos)|\d+[.,]\d+\s?(?:h|hr|hrs|hours?|horas?)|\d+ (?:hours?|horas?|hrs?|days|dias|weeks|semanas)|half an hour|meia hora)(?=\s)/,
  meet: /\s(?:google meet|meet|call|video call|videocall|video|zoom|videochamada|chamada|videoconferencia|reuniao online)(?=\s)/
}

// Words that only introduce the phrase after them ("até dia 5", "for 45m")
// and would otherwise be left dangling in the title.
var QUICK_LEADING_WORDS = ["on", "at", "for", "from", "by", "until", "ate", "as", "em", "no", "na", "de", "do",
  "da", "das", "para", "pra", "por", "durante", "this", "next", "proxima", "proximo"]

function foldForMatching(original) {
  var lower = original.toLowerCase()
  if (lower.length !== original.length) lower = original
  var folded = lower.replace(/[^\x00-\x7f]/g, function(c) { return Words.FOLDED_LETTERS[c] || c })
  // Sentence punctuation separates words; inside "1,5h", "14:30" or "a.m."
  // it does not.
  return folded.replace(/[;!?()\[\]"]/g, " ").replace(/[.,:](?=\s|$)/g, " ")
}

// `lastFrom` and `lastTo` mark the phrase `take` accepted last.
function quickScanner(input) {
  var original = " " + input + " "
  return { original: original, folded: " " + foldForMatching(input) + " ", lastFrom: -1, lastTo: -1 }
}

function snapshot(scanner) {
  return { original: scanner.original, folded: scanner.folded, lastFrom: scanner.lastFrom, lastTo: scanner.lastTo }
}

function restore(scanner, saved) {
  scanner.original = saved.original
  scanner.folded = saved.folded
  scanner.lastFrom = saved.lastFrom
  scanner.lastTo = saved.lastTo
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
// folded text and hands each match, and where it starts, to `read` until
// one is accepted (anything but null); only that one is blanked out.
function take(scanner, pattern, read) {
  for (var offset = 0; ; ) {
    var match = scanner.folded.substring(offset).match(pattern)
    if (!match) return null
    var at = offset + match.index
    var value = read(match, at)
    if (value !== null && value !== undefined) {
      scanner.lastFrom = at + 1
      scanner.lastTo = at + match[0].length
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

function offsetDate(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

// The same day `months` later, or the last day of that month.
function addMonths(date, months) {
  var first = new Date(date.getFullYear(), date.getMonth() + months, 1)
  var last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return new Date(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), last))
}

function daysBetween(start, end) {
  return Math.round((end - start) / Model.DAY_MS)
}

// ---- Numbers and lengths.

function numberValue(phrase) {
  if (/^\d/.test(phrase)) return Number(phrase.replace(",", "."))
  if (phrase === "a couple of") return 2
  var parts = phrase.split(/ e |[- ]/)
  var total = 0
  for (var i = 0; i < parts.length; i++) {
    if (!Words.NUMBER_WORDS.hasOwnProperty(parts[i])) return NaN
    total += Words.NUMBER_WORDS[parts[i]]
  }
  return total
}

// A length as { minutes } (a day at most), { days } or { months }, or null.
function amountOf(phrase) {
  if (/^(?:half an hour|meia hora)$/.test(phrase)) return { minutes: 30 }
  if (/quarter of an hour|quarto de hora/.test(phrase)) return { minutes: 15 }
  var m = phrase.match(QUICK_AMOUNT_PARTS)
  if (!m) return null
  var amount = numberValue(m[1]) + (m[2] || m[5] ? 0.5 : 0)
  if (!(amount > 0)) return null
  var unit = m[3]
  if (Words.HOUR_UNITS.indexOf(unit) !== -1) {
    var minutes = Math.round(amount * 60) + Number(m[4] || 0)
    return minutes <= MINUTES_PER_DAY ? { minutes: minutes } : null
  }
  if (m[4]) return null
  if (Words.MINUTE_UNITS.indexOf(unit) !== -1)
    return amount <= MINUTES_PER_DAY ? { minutes: Math.round(amount) } : null
  if (amount !== Math.floor(amount)) return null
  if (Words.DAY_UNITS.indexOf(unit) !== -1) return amount <= 366 ? { days: amount } : null
  if (Words.WEEK_UNITS.indexOf(unit) !== -1) return amount <= 52 ? { days: amount * 7 } : null
  if (Words.MONTH_UNITS.indexOf(unit) !== -1) return amount <= 24 ? { months: amount } : null
  return null
}

// ---- Guests and repeats.

// The email addresses in the text, lower case, each once.
function readGuests(scanner) {
  var guests = []
  for (;;) {
    var email = take(scanner, QUICK_PATTERNS.guest, function(m) {
      var address = Model.normalizeEmail(m[2])
      return Model.isValidEmail(address) ? address : null
    })
    if (email === null) return guests
    if (guests.indexOf(email) === -1) guests.push(email)
  }
}

// { preset, weekday } with a preset of the event form, and the WEEKDAYS
// row of "every monday" (-1 for any other repeat), or null.
function readRepeat(scanner) {
  var p = QUICK_PATTERNS
  var weekly = take(scanner, p.repeatWeekday, function(m) {
    var every = Words.EVERY_WORDS.indexOf(m[1]) !== -1
    var plural = !!m[3] || /feiras/.test(m[4] || "")
    if (!every && !plural) return null
    if (!every && Words.AMBIGUOUS_WEEKDAYS.indexOf(m[2]) !== -1) return null
    return { preset: "weekly", weekday: rowOf(m[2], [Words.WEEKDAYS]) }
  })
  if (weekly) return weekly
  return take(scanner, p.repeatPhrase, function(m, at) {
    if (Words.REPEAT_TITLE_WORDS.indexOf(m[1]) !== -1 && scanner.folded.substring(0, at).trim() === "") return null
    // "todo dia 5" is the 5th of each month, which no preset says.
    if (m[1] === "todo dia" && /^\s+\d{1,2}(?=\s)/.test(scanner.folded.substring(at + m[0].length))) return null
    return { preset: keyOf(m[1], Words.REPEAT_PHRASES), weekday: -1 }
  })
}

// ---- Days.

// "in 20 min", "daqui a duas horas", "in 3 days", "now": { at } for a
// start, { date } for a day, or null.
function readRelative(scanner, now, today) {
  var found = take(scanner, QUICK_PATTERNS.relative, function(m) {
    var amount = amountOf(m[1])
    if (!amount) return null
    if (amount.minutes !== undefined) return { at: new Date(now.getTime() + amount.minutes * Model.MINUTE_MS) }
    if (amount.days !== undefined) return { date: offsetDate(today, amount.days) }
    return { date: addMonths(today, amount.months) }
  })
  if (found) return found
  return take(scanner, QUICK_PATTERNS.now, function() { return { at: now } })
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
    return upcomingDate(today, rowOf(m[2] || m[3], [Words.MONTHS, Words.MONTHS_EN_SHORT, Words.MONTHS_PT_SHORT]),
      Number(m[1]), m[4])
  })
  if (!date) date = take(scanner, p.monthDay, function(m) {
    return upcomingDate(today, rowOf(m[1], [Words.MONTHS, Words.MONTHS_EN_SHORT]), Number(m[2]), m[3])
  })
  if (!date) date = take(scanner, p.dayAfterTomorrow, function() { return offsetDate(today, 2) })
  if (!date) date = take(scanner, p.tomorrow, function() { return offsetDate(today, 1) })
  if (!date) date = take(scanner, p.today, function() { return today })
  if (!date) date = take(scanner, p.yesterday, function() { return offsetDate(today, -1) })
  // Next week starts on the coming Monday, never today.
  if (!date) date = take(scanner, p.nextWeek, function() {
    return offsetDate(today, (1 - today.getDay() + 7) % 7 || 7)
  })
  // A weekday is the next one coming, today included; "next friday" /
  // "próxima sexta" / "sexta que vem" skip today, so on a Friday they mean
  // a week from now.
  if (!date) date = take(scanner, p.weekday, function(m) {
    if (Words.AMBIGUOUS_WEEKDAYS.indexOf(m[3]) !== -1 && !(m[1] || m[2] || m[4] || isStartTime(m[5]))) return null
    var ahead = (rowOf(m[3], [Words.WEEKDAYS]) - today.getDay() + 7) % 7
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

function span(start, end) {
  return start && end && end >= start ? { start: start, end: end } : null
}

// The day or days the text names, as { start, end }, end null for one
// day; or null.
function readDates(scanner, today, lang) {
  var p = QUICK_PATTERNS
  var range = take(scanner, p.dayRange, function(m) {
    var month = rowOf(m[3] || m[4], [Words.MONTHS, Words.MONTHS_EN_SHORT, Words.MONTHS_PT_SHORT])
    var start = upcomingDate(today, month, Number(m[1]), m[5])
    return start && span(start, validDay(start.getFullYear(), month, Number(m[2])))
  })
  if (!range) range = take(scanner, p.monthDayRange, function(m) {
    var first = rowOf(m[1], [Words.MONTHS, Words.MONTHS_EN_SHORT])
    var last = m[3] ? rowOf(m[3], [Words.MONTHS, Words.MONTHS_EN_SHORT]) : first
    var start = upcomingDate(today, first, Number(m[2]), m[5])
    if (!start) return null
    var end = validDay(start.getFullYear(), last, Number(m[4]))
    if (end && end < start) end = validDay(start.getFullYear() + 1, last, Number(m[4]))
    return span(start, end)
  })
  // This weekend is the coming Saturday and Sunday, or what is left of it.
  if (!range) range = take(scanner, p.weekend, function(m) {
    if (!m[1] && !m[2]) return null
    var day = today.getDay()
    var next = /next|proximo/.test(m[1] || "") || !!m[2]
    if (day === 0 && !next) return { start: today, end: today }
    var start = offsetDate(today, (6 - day + 7) % 7 + (next && day === 6 ? 7 : 0))
    return { start: start, end: offsetDate(start, 1) }
  })
  if (range) return range

  // Two days with a word between them: "friday to sunday", "12/10 - 14/10".
  var start = readDate(scanner, today, lang)
  if (!start) return null
  var startEnd = scanner.lastTo
  var join = scanner.folded.substring(startEnd).match(QUICK_DAY_JOIN)
  if (!join) return { start: start, end: null }
  var saved = snapshot(scanner)
  var end = readDate(scanner, today, lang)
  var adjacent = !!end && scanner.lastFrom >= startEnd && scanner.lastFrom <= startEnd + join[0].length
  // "sunday to tuesday" on a Tuesday ends on next Tuesday.
  if (adjacent && end < start && offsetDate(end, 7) >= start) end = offsetDate(end, 7)
  if (!adjacent || end < start) {
    restore(scanner, saved)
    return { start: start, end: null }
  }
  // The joining word goes with the days, not into the title.
  if (scanner.lastFrom > startEnd) blank(scanner, startEnd, scanner.lastFrom)
  return { start: start, end: end }
}

// "morning", "à tarde", "tonight": a DAY_PART_START key, or null. A bare
// word only counts right after the day, which ended at `dateEnd`.
function readDayPart(scanner, dateEnd) {
  var p = QUICK_PATTERNS
  var part = take(scanner, p.dayPart, function(m) { return keyOf(m[1], Words.DAY_PART_PHRASES) })
  if (part === null && dateEnd >= 0) part = take(scanner, p.dayPartWord, function(m, at) {
    var next = at >= dateEnd && scanner.folded.substring(dateEnd, at).trim() === ""
    return next ? keyOf(m[1], Words.DAY_PART_WORDS) : null
  })
  return part
}

// ---- Times.

// One time phrase as { minutes, meridiem, bare }, or null. `bare` is a
// lone number ("at 3", "às 3 e meia"), which reads 1-7 as afternoon:
// nobody books "at 3" meaning three in the morning.
function readClock(word) {
  var named = { "noon": 720, "midday": 720, "meio-dia": 720, "meio dia": 720,
                "midnight": 0, "meia-noite": 0, "meia noite": 0 }
  if (named.hasOwnProperty(word)) return { minutes: named[word], meridiem: "", bare: false }
  var half = / e meia$/.test(word)
  var core = word.replace(/ e meia$/, "")
  var m = core.match(/^(\d{1,2})(?:[:h](\d{2})?(?:min|m)?)?\s?(am|pm|a\.m\.?|p\.m\.?)?$/)
  if (!m || (half && m[2])) return null
  var hours = Number(m[1])
  var minutes = half ? 30 : Number(m[2] || 0)
  var meridiem = m[3] ? m[3].charAt(0) : ""
  if (minutes > 59) return null
  if (meridiem) {
    if (hours < 1 || hours > 12) return null
    hours = hours % 12 + (meridiem === "p" ? 12 : 0)
  } else if (hours > 23) {
    return null
  }
  return { minutes: hours * 60 + minutes, meridiem: meridiem, bare: /^\d{1,2}$/.test(core) }
}

function resolvedClock(clock) {
  var hour = Math.floor(clock.minutes / 60)
  return clock.bare && hour >= 1 && hour <= 7 ? clock.minutes + 12 * 60 : clock.minutes
}

// A start as readTimes returns it. `raw` is the time as written, before
// the afternoon reading of a bare hour, and `loose` says no am/pm fixed
// it, so "tonight at 9" can still move it to 21:00.
function startAt(clock, resolve) {
  return { start: resolve ? resolvedClock(clock) : clock.minutes, end: null, loose: !clock.meridiem, raw: clock.minutes }
}

// An hour written as digits or a word: "3", "three", "três".
function hourValue(word) {
  if (/^\d+$/.test(word)) return Number(word)
  var en = Words.EN_HOURS.indexOf(word)
  return en !== -1 ? en + 1 : Words.PT_HOURS.indexOf(word) + 1
}

// "half past 3", "three o'clock": read like "at 3", unless am/pm says.
function wordClock(minutes, meridiemWord) {
  var meridiem = meridiemWord ? meridiemWord.charAt(0) : ""
  if (meridiem) {
    var hour = Math.floor(minutes / 60)
    if (hour < 1 || hour > 12) return null
    minutes = (hour % 12 + (meridiem === "p" ? 12 : 0)) * 60 + minutes % 60
  } else if (minutes < 0 || minutes >= MINUTES_PER_DAY) {
    return null
  }
  return startAt({ minutes: minutes, meridiem: meridiem, bare: !meridiem }, true)
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
    // "2pm and 4pm" can be two calls; "between 2 and 4" is one.
    if (/\sand\s/.test(m[0]) && m[1] !== "between") return null
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
      return { start: from, end: to % MINUTES_PER_DAY }
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

  var start = take(scanner, p.pastTime, function(m) {
    var hour = hourValue(m[2])
    if (hour < 1 || hour > 12) return null
    var offset = { "half past": 30, "quarter past": 15, "quarter to": -15 }[m[1]]
    return wordClock(hour * 60 + offset, m[3])
  })
  if (start === null) start = take(scanner, p.oclock, function(m) {
    var hour = hourValue(m[1])
    return hour >= 1 && hour <= 12 ? wordClock(hour * 60, m[2]) : null
  })
  if (start === null) start = take(scanner, p.wordTime, function(m) {
    return wordClock(hourValue(m[1] || m[2]) * 60 + (m[3] ? 30 : 0), "")
  })
  if (start === null) start = take(scanner, p.prefixedTime, function(m) {
    var clock = readClock(m[1])
    return clock ? startAt(clock, true) : null
  })
  if (start === null) start = take(scanner, p.plainTime, function(m) {
    var clock = readClock(m[1])
    return clock ? startAt(clock, false) : null
  })
  if (start === null) start = take(scanner, p.hourPhrase, function(m) {
    var clock = readClock(m[1])
    return clock && clock.minutes >= EARLIEST_HOUR_PHRASE * 60 ? startAt(clock, false) : null
  })
  return start
}

// A start moved into the day part it was said with: "tomorrow morning at
// 7" is 07:00, "tonight at 9" is 21:00.
function inDayPart(times, part) {
  if (times.end !== null || !times.loose || times.raw >= 12 * 60) return times
  return { start: part === "morning" ? times.raw : times.raw + 12 * 60, end: null }
}

// A length as amountOf returns it, months excepted, or null.
function readDuration(scanner, hasTime) {
  var p = QUICK_PATTERNS
  var read = function(m) {
    var amount = amountOf(m[1])
    return amount && amount.months === undefined ? amount : null
  }
  var length = take(scanner, p.prefixedDuration, read)
  if (length === null) length = take(scanner, p.plainDuration, read)
  if (length === null) length = take(scanner, p.hourPhrase, function(m) {
    var clock = readClock(m[1])
    return hasTime || (clock && clock.minutes < EARLIEST_HOUR_PHRASE * 60) ? amountOf(m[1]) : null
  })
  return length
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

// ---- The parse.

// { title, dateKey, endDateKey, allDay, startTime, endTime,
//   durationMinutes, meet, repeat, guests }, or null when there is no
// title to create. `now` is a Date or ms. An all-day event has startTime
// and endTime "" and durationMinutes 0. `repeat` is a preset of the event
// form ("none", "daily", "weekly", "monthly", "yearly", "weekdays"), and
// `guests` a list of email addresses.
function parseQuickAdd(input, now, lang) {
  return scanQuickAdd(input, now, lang).parsed
}

// The words quick add read as something else than the title, in the order
// they were typed: [{ text, kind }], kind one of "date", "time",
// "duration", "allDay", "meet", "repeat" and "guest". The panel shows
// them, so the user can see what was understood. A meeting word stays in
// the title too.
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
  var guests = readGuests(scanner)
  note("guest")
  var repeat = readRepeat(scanner)
  note("repeat")
  var relative = readRelative(scanner, nowDate, today)
  note(relative && relative.at ? "time" : "date")
  var dates = readDates(scanner, today, lang)
  var dateEnd = dates ? scanner.lastTo : -1
  note("date")
  var dayPart = readDayPart(scanner, dateEnd)
  var times = readTimes(scanner)
  note("time")
  var length = readDuration(scanner, times !== null || dayPart !== null || !!(relative && relative.at))
  note("duration")
  found.sort(function(a, b) { return a.at - b.at })
  found = found.map(function(f) { return { text: f.text, kind: f.kind } })

  // Punctuation stranded by a blanked phrase ("Trip [7 p.m]." ) goes too.
  var title = scanner.original.replace(/(^|\s)[.,;:!?]+(?=\s|$)/g, "$1").replace(/\s+/g, " ")
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/^[\s,;:·\-\u2013\u2014]+|[\s,;:·\-\u2013\u2014]+$/g, "")
  if (title === "") return { parsed: null, found: found }

  var day = today
  if (dates) day = dates.start
  else if (relative && relative.date) day = relative.date
  else if (repeat && repeat.weekday >= 0) day = offsetDate(today, (repeat.weekday - today.getDay() + 7) % 7)
  var dayGiven = !!dates || !!(relative && relative.date) || !!(repeat && repeat.weekday >= 0)
  var lastDay = dates && dates.end ? dates.end : null

  // "in 20 min": that start, on whatever day it falls; "until 3pm" can
  // still end it.
  if (relative && relative.at) {
    var at = relative.at
    day = new Date(at.getFullYear(), at.getMonth(), at.getDate())
    times = { start: at.getHours() * 60 + at.getMinutes(), end: times && times.start === null ? times.end : null }
  }
  if (dayPart !== null)
    times = times === null ? { start: Words.DAY_PART_START[dayPart], end: null } : inDayPart(times, dayPart)

  var key = Model.keyForDate(day)
  var nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()
  // "until 11am" alone: from now, at the quarter hour before, when that is
  // still ahead today; otherwise the usual length, ending then.
  if (times !== null && times.start === null) {
    var fromNow = key === Model.keyForDate(today) && nowMinutes < times.end
    times = { start: fromNow ? Math.floor(nowMinutes / 15) * 15 : Math.max(0, times.end - DEFAULT_QUICK_DURATION),
              end: times.end }
  }

  var result = { title: title, dateKey: key, endDateKey: key, allDay: false, startTime: "", endTime: "",
                 durationMinutes: 0, meet: meet, repeat: repeat ? repeat.preset : "none", guests: guests }
  var lengthDays = length && length.days ? length.days : 0
  var deadline = Model.DEADLINE_PREFIX.test(title)
  if (forcedAllDay || (times === null && (lengthDays > 0 || ((dayGiven || deadline) && !length)))) {
    result.allDay = true
    result.endDateKey = lastDay ? Model.keyForDate(lastDay) : lengthDays > 1 ? Model.addDays(key, lengthDays - 1) : key
    return { found: found, parsed: result }
  }

  // No time: the next half hour today, 09:00 on another day.
  if (times === null) {
    var slot = 9 * 60
    if (key === Model.keyForDate(today)) {
      slot = Math.ceil((nowMinutes + 1) / 30) * 30
      if (slot >= MINUTES_PER_DAY) {
        key = Model.addDays(key, 1)
        slot = 0
      }
    }
    times = { start: slot, end: null }
    if (!length) length = { minutes: OPEN_SLOT_MINUTES }
  }

  var spanDays = lastDay ? daysBetween(day, lastDay) : 0
  var duration
  if (times.end !== null)
    duration = spanDays > 0
      ? spanDays * MINUTES_PER_DAY + times.end - times.start
      : ((times.end - times.start + MINUTES_PER_DAY - 1) % MINUTES_PER_DAY) + 1
  else
    duration = spanDays * MINUTES_PER_DAY
      + (lengthDays ? lengthDays * MINUTES_PER_DAY : (length && length.minutes) || DEFAULT_QUICK_DURATION)
  var endMinutes = times.start + duration
  // Ending exactly at midnight stays on the day before, as the event form
  // reads "00:00" as that midnight.
  var endDays = Math.floor((endMinutes - 1) / MINUTES_PER_DAY)
  result.dateKey = key
  result.endDateKey = endDays > 0 ? Model.addDays(key, endDays) : key
  result.startTime = Model.clockText(times.start)
  result.endTime = Model.clockText(endMinutes % MINUTES_PER_DAY)
  result.durationMinutes = duration
  return { found: found, parsed: result }
}

// The event form a quick add opens as, for "More options" or a direct save.
function quickAddForm(parsed, calendarId) {
  var form = Model.newEventForm(parsed.dateKey, { start: parsed.startTime, end: parsed.endTime }, calendarId)
  form.title = parsed.title
  form.allDay = parsed.allDay
  form.endDate = parsed.endDateKey || parsed.dateKey
  form.meet = !!parsed.meet
  form.repeat = parsed.repeat || "none"
  var guests = parsed.guests || []
  for (var i = 0; i < guests.length; i++) form.guests = Model.addGuest(form.guests, guests[i])
  return form
}

function compactDate(key) {
  return Model.text(key).replace(/-/g, "")
}

// The repeat presets as Google's prefilled page takes them. Google picks
// the day of the week or month from the start date.
var TEMPLATE_RULES = {
  daily: "RRULE:FREQ=DAILY", weekly: "RRULE:FREQ=WEEKLY", monthly: "RRULE:FREQ=MONTHLY",
  yearly: "RRULE:FREQ=YEARLY", weekdays: "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
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
  var url = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + Model.encodeQuery(parsed.title)
    + "&dates=" + dates
  if (TEMPLATE_RULES.hasOwnProperty(parsed.repeat)) url += "&recur=" + Model.encodeQuery(TEMPLATE_RULES[parsed.repeat])
  if (parsed.guests && parsed.guests.length > 0) url += "&add=" + Model.encodeQuery(parsed.guests.join(","))
  return url
}
