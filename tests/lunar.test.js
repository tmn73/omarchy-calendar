const test = require('node:test')
const assert = require('node:assert/strict')
const { loadQmlJs } = require('./load-qml-js.js')

const Lunar = loadQmlJs('Lunar.js')
const Model = loadQmlJs('Model.js')

test('Vietnamese New Year follows UTC+7, including the 2030 difference from China', () => {
  for (const [year, month, day] of [[2026, 2, 17], [2027, 2, 6], [2030, 2, 2]]) {
    assert.deepEqual(Lunar.fromGregorian(year, month, day), { year, month: 1, day: 1, leap: false })
  }
  assert.deepEqual(Lunar.fromGregorian(2030, 2, 1), { year: 2029, month: 12, day: 29, leap: false })
})

test('leap months retain their identity in 2025 and the difficult year 2033', () => {
  assert.deepEqual(Lunar.fromGregorian(2025, 7, 25), { year: 2025, month: 6, day: 1, leap: true })
  assert.deepEqual(Lunar.fromGregorian(2033, 8, 25), { year: 2033, month: 8, day: 1, leap: false })
  assert.deepEqual(Lunar.fromGregorian(2033, 12, 22), { year: 2033, month: 11, day: 1, leap: true })
  assert.deepEqual(Lunar.fromGregorian(2034, 1, 20), { year: 2033, month: 12, day: 1, leap: false })
  assert.equal(Lunar.dayLabel(Lunar.fromGregorian(2025, 7, 25)), '1/6*')
})

test('invalid dates and dates outside the checked range have no lunar annotation', () => {
  for (const date of [[2026, 2, 29], [2026, 13, 1], [2026, 1, 0], [2026, 1, 1.5], [1975, 12, 31], [2051, 1, 1]]) {
    assert.equal(Lunar.fromGregorian(...date), null)
  }
  assert.ok(Lunar.fromGregorian(2024, 2, 29))
  assert.equal(Lunar.dayLabel(null), '')
})

test('every supported civil day has a valid lunar day, never day zero', () => {
  for (let ms = Date.UTC(1976, 0, 1); ms < Date.UTC(2051, 0, 1); ms += 86400000) {
    const date = new Date(ms)
    const lunar = Lunar.fromGregorian(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
    assert.ok(lunar.day >= 1 && lunar.day <= 30, date.toISOString())
    assert.ok(lunar.month >= 1 && lunar.month <= 12, date.toISOString())
  }
})

test('lunar annotations are opt-in and do not create calendar events', () => {
  const plain = Model.monthGrid(2030, 1, 1, '2030-02-02', {})
  assert.ok(plain.every(week => week.days.every(day => !('lunar' in day))))
  const annotated = Model.monthGrid(2030, 1, 1, '2030-02-02', {}, true).flatMap(week => week.days)
  const tet = annotated.find(day => day.key === '2030-02-02')
  assert.equal(tet.lunarLabel, '1/1')
  assert.equal(tet.hasEvent, false)
  assert.deepEqual(tet.dots, [])
  assert.equal(annotated.find(day => day.key === '2030-02-01').lunar.year, 2029)
})

test('selected-day details use the display language and the lunar year', () => {
  assert.equal(Model.lunarDateText('2026-11-08', 'en'), 'Lunar date: 30/9/2026')
  assert.equal(Model.lunarDateText('2026-11-09', 'pt'), 'Data lunar: 1/10/2026')
  assert.equal(Model.lunarDateText('2030-02-01', 'en'), 'Lunar date: 29/12/2029')
  assert.equal(Model.lunarDateText('2051-01-01', 'en'), '')
})

test('selected-day details spell out leap months in each supported language', () => {
  assert.equal(Model.lunarDateText('2025-07-25', 'en'), 'Lunar date: 1/6/2025 (leap month)')
  assert.equal(Model.lunarDateText('2025-07-25', 'pt'), 'Data lunar: 1/6/2025 (mês intercalar)')
})

test('Chinese and Korean dates retain their own New Year boundaries', () => {
  assert.deepEqual(Lunar.fromGregorian(2030, 2, 2, 'chinese'), { year: 2029, month: 12, day: 30, leap: false })
  assert.deepEqual(Lunar.fromGregorian(2030, 2, 2, 'korean'), { year: 2029, month: 12, day: 30, leap: false })
  assert.deepEqual(Lunar.fromGregorian(2027, 2, 6, 'chinese'), { year: 2027, month: 1, day: 1, leap: false })
  assert.deepEqual(Lunar.fromGregorian(2027, 2, 6, 'korean'), { year: 2026, month: 12, day: 30, leap: false })
  assert.deepEqual(Lunar.fromGregorian(2027, 2, 7, 'korean'), { year: 2027, month: 1, day: 1, leap: false })
})

test('calendariale leap months are normalized to the civil lunar year', () => {
  for (const calendar of ['chinese', 'korean']) {
    assert.deepEqual(Lunar.fromGregorian(2033, 8, 25, calendar), { year: 2033, month: 8, day: 1, leap: false })
    assert.deepEqual(Lunar.fromGregorian(2033, 12, 22, calendar), { year: 2033, month: 11, day: 1, leap: true })
    assert.equal(Lunar.fromGregorian(2051, 1, 1, calendar), null)
    assert.equal(Lunar.fromGregorian(2026, 2, 30, calendar), null)
  }
})

test('the selected calendar drives both the grid and translated details', () => {
  const cells = Model.monthGrid(2030, 1, 1, '2030-02-02', {}, true, 'chinese').flatMap(week => week.days)
  assert.equal(cells.find(day => day.key === '2030-02-02').lunarLabel, '30')
  assert.equal(cells.find(day => day.key === '2030-02-03').lunarLabel, '1/1')
  assert.equal(Model.lunarDateText('2030-02-02', 'en', 'chinese'), 'Lunar date: 30/12/2029')
  assert.equal(Model.lunarDateText('2027-02-06', 'pt', 'korean'), 'Data lunar: 30/12/2026')
  assert.equal(Model.lunarDateText('2033-12-22', 'en', 'korean'), 'Lunar date: 1/11/2033 (leap month)')
  assert.deepEqual(Lunar.fromGregorian(2030, 2, 2, 'vietnamese'), Lunar.fromGregorian(2030, 2, 2))
})

// Counts the calendariale calls that one action makes. The QML engine pays
// several milliseconds for each call, so the count is the cost of a grid.
function countEngineCalls(calendar, action) {
  const api = loadQmlJs('vendor/Calendariale.js').api
  const engine = calendar === 'korean' ? api.KoreanCalendar : api.ChineseCalendar
  const original = Object.getOwnPropertyDescriptor(engine, 'fromJdn')
  let calls = 0
  engine.fromJdn = function (jdn) { calls++; return original.value.call(this, jdn) }
  try { action() } finally { Object.defineProperty(engine, 'fromJdn', original) }
  return calls
}

test('a Chinese or Korean month grid calls the engine a few times, not once per cell', () => {
  for (const calendar of ['chinese', 'korean']) {
    // 42 cells span at most 3 lunar months, and each month costs at most 2 calls.
    const first = countEngineCalls(calendar, () => Model.monthGrid(2041, 4, 1, '2041-05-01', {}, true, calendar))
    assert.ok(first > 0 && first <= 6, `${calendar}: ${first} calls for a new month`)
    // A sync or midnight builds the same grid again.
    const again = countEngineCalls(calendar, () => Model.monthGrid(2041, 4, 1, '2041-05-01', {}, true, calendar))
    assert.equal(again, 0, `${calendar}: ${again} calls for the same month again`)
  }
})

test('cached Chinese and Korean dates match the engine day by day', () => {
  const api = loadQmlJs('vendor/Calendariale.js').api
  // Includes the 2027 New Year, where the two calendars differ, and the 2033 leap month.
  for (const [from, to] of [[Date.UTC(2026, 10, 1), Date.UTC(2027, 2, 1)], [Date.UTC(2033, 0, 1), Date.UTC(2034, 2, 1)]]) {
    for (const calendar of ['chinese', 'korean']) {
      const engine = calendar === 'korean' ? api.KoreanCalendar : api.ChineseCalendar
      for (let ms = from; ms < to; ms += 86400000) {
        const date = new Date(ms)
        const [year, month, day] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
        const direct = engine.fromJdn(api.GregorianCalendar.toJdn(year, month, day))
        const cached = Lunar.fromGregorian(year, month, day, calendar)
        assert.deepEqual([cached.month, cached.day, cached.leap], [direct.month, direct.day, direct.monthLeap], `${calendar} ${date.toISOString()}`)
      }
    }
  }
})
