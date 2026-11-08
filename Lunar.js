.pragma library
.import "vendor/Calendariale.js" as Calendariale

// Lunisolar dates for the widget. Chinese/Korean use calendariale 0.7.0.
// Vietnamese dates use modern UTC+7 and the rules described by Ho Ngoc Duc:
// https://www.xemamlich.uhm.vn/calrules.html
// Shared civil range: 1976–2050; Vietnamese dates checked against his tables.
var FIRST_YEAR = 1976
var LAST_YEAR = 2050
var TIME_ZONE = 7
var SYNODIC_MONTH = 29.530588853

function julianDay(year, month, day) {
  var a = Math.floor((14 - month) / 12)
  var y = year + 4800 - a
  var m = month + 12 * a - 3
  return day + Math.floor((153 * m + 2) / 5) + 365 * y
    + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045
}

function newMoonDay(cycle) {
  var t = cycle / 1236.85
  var t2 = t * t
  var t3 = t2 * t
  var radians = Math.PI / 180
  var mean = 2415020.75933 + 29.53058868 * cycle + 0.0001178 * t2 - 0.000000155 * t3
  mean += 0.00033 * Math.sin((166.56 + 132.87 * t - 0.009173 * t2) * radians)
  var sun = (359.2242 + 29.10535608 * cycle - 0.0000333 * t2 - 0.00000347 * t3) * radians
  var moon = (306.0253 + 385.81691806 * cycle + 0.0107306 * t2 + 0.00001236 * t3) * radians
  var latitude = (21.2964 + 390.67050646 * cycle - 0.0016528 * t2 - 0.00000239 * t3) * radians
  var correction = (0.1734 - 0.000393 * t) * Math.sin(sun)
    + 0.0021 * Math.sin(2 * sun) - 0.4068 * Math.sin(moon)
    + 0.0161 * Math.sin(2 * moon) - 0.0004 * Math.sin(3 * moon)
    + 0.0104 * Math.sin(2 * latitude) - 0.0051 * Math.sin(sun + moon)
    - 0.0074 * Math.sin(sun - moon) + 0.0004 * Math.sin(2 * latitude + sun)
    - 0.0004 * Math.sin(2 * latitude - sun) - 0.0006 * Math.sin(2 * latitude + moon)
    + 0.0010 * Math.sin(2 * latitude - moon) + 0.0005 * Math.sin(sun + 2 * moon)
  var deltaT = -0.000278 + 0.000265 * t + 0.000262 * t2
  return Math.floor(mean + correction - deltaT + 0.5 + TIME_ZONE / 24)
}

function solarSector(day) {
  var t = (day - 0.5 - TIME_ZONE / 24 - 2451545) / 36525
  var radians = Math.PI / 180
  var anomaly = (357.52910 + 35999.05030 * t - 0.0001559 * t * t - 0.00000048 * t * t * t) * radians
  var longitude = 280.46645 + 36000.76983 * t + 0.0003032 * t * t
  longitude += (1.914600 - 0.004817 * t - 0.000014 * t * t) * Math.sin(anomaly)
    + (0.019993 - 0.000101 * t) * Math.sin(2 * anomaly) + 0.000290 * Math.sin(3 * anomaly)
  longitude = ((longitude % 360) + 360) % 360
  return Math.floor(longitude / 30)
}

function monthEleven(year) {
  var cycle = Math.floor((julianDay(year, 12, 31) - 2415021) / SYNODIC_MONTH)
  var start = newMoonDay(cycle)
  return solarSector(start) >= 9 ? newMoonDay(cycle - 1) : start
}

function leapMonthOffset(start) {
  var cycle = Math.floor(0.5 + (start - 2415021.076998695) / SYNODIC_MONTH)
  var previous = solarSector(newMoonDay(cycle + 1))
  for (var offset = 2; offset < 15; offset++) {
    var sector = solarSector(newMoonDay(cycle + offset))
    if (sector === previous) return offset - 1
    previous = sector
  }
  return 13
}

// One calendariale call searches the sky from scratch and costs several
// milliseconds in the QML engine, so one call per grid cell stalls the panel.
// All days of a lunar month share its year, month and leap flag. The cache
// keeps the months already seen, and a day is its distance from the month start.
// A month grid then needs at most 2 calls per lunar month it shows, and none
// when it is built again for the same month.
var MONTH_CACHE_SIZE = 48
var monthCache = []

function cachedMonth(calendar, jdn) {
  for (var i = 0; i < monthCache.length; i++) {
    var entry = monthCache[i]
    if (entry.calendar === calendar && jdn >= entry.start && jdn < entry.end) return entry
  }
  return null
}

function engineDate(calendar, jdn) {
  var entry = cachedMonth(calendar, jdn)
  if (!entry) {
    var korean = calendar === "korean"
    var engine = korean ? Calendariale.api.KoreanCalendar : Calendariale.api.ChineseCalendar
    var date = engine.fromJdn(jdn)
    var start = jdn - date.day + 1
    // A lunar month has 29 or 30 days. It is long only if its day 30 exists.
    var longMonth = date.day === 30 || engine.fromJdn(start + 29).day === 30
    entry = {
      calendar: calendar,
      start: start,
      end: start + (longMonth ? 30 : 29),
      // The library exposes a cycle and a year within that cycle, not a civil year.
      year: (date.cycle - 1) * 60 + date.year - (korean ? 2333 : 2637),
      month: date.month,
      leap: date.monthLeap
    }
    monthCache.push(entry)
    if (monthCache.length > MONTH_CACHE_SIZE) monthCache.shift()
  }
  return { year: entry.year, month: entry.month, day: jdn - entry.start + 1, leap: entry.leap }
}

function fromGregorian(year, month, day, calendar) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)
      || year < FIRST_YEAR || year > LAST_YEAR || month < 1 || month > 12 || day < 1) return null
  var leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  var lengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (day > lengths[month - 1]) return null

  if (calendar === "chinese" || calendar === "korean") {
    return engineDate(calendar, Calendariale.api.GregorianCalendar.toJdn(year, month, day))
  }

  var jd = julianDay(year, month, day)
  var cycle = Math.floor((jd - 2415021.076998695) / SYNODIC_MONTH)
  var start = newMoonDay(cycle)
  // Bracket the civil day even when the mean-month estimate lands one cycle out.
  while (start > jd) start = newMoonDay(--cycle)
  while (newMoonDay(cycle + 1) <= jd) start = newMoonDay(++cycle)

  var before = monthEleven(year)
  var after = before
  var lunarYear = year
  if (before >= start) before = monthEleven(year - 1)
  else {
    lunarYear++
    after = monthEleven(year + 1)
  }
  var offset = Math.floor((start - before) / 29)
  var lunarMonth = offset + 11
  var leap = false
  if (after - before > 365) {
    var leapOffset = leapMonthOffset(before)
    if (offset >= leapOffset) {
      lunarMonth--
      leap = offset === leapOffset
    }
  }
  if (lunarMonth > 12) lunarMonth -= 12
  if (lunarMonth >= 11 && offset < 4) lunarYear--
  return { year: lunarYear, month: lunarMonth, day: jd - start + 1, leap: leap }
}

function dayLabel(date) {
  if (!date) return ""
  return date.day === 1 ? "1/" + date.month + (date.leap ? "*" : "") : String(date.day)
}
