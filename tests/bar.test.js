const test = require('node:test')
const assert = require('node:assert')
const { loadQmlJs } = require('./load-qml-js.js')
const { localIso, localMs } = require('./local-time.js')

const Model = loadQmlJs('Model.js')

const MIN = 60 * 1000
const START = localMs(2026, 9, 6, 13, 0)
const meeting = (id, hour, minute, extra = {}) => ({
  id, title: extra.title || id, allDay: false, dateKey: '2026-10-06',
  start: localIso(2026, 9, 6, hour, minute), end: localIso(2026, 9, 6, hour, minute + 45),
  meetingUrl: 'https://meet.google.com/abc', ...extra
})
const EVENTS = [meeting('easy', 13, 0, { title: 'Revisão do projeto' })]

test('barState is idle far from any event', () => {
  assert.deepEqual(Model.barState(EVENTS, START - 60 * MIN, 30), { phase: 'idle', event: null, extra: 0, countdownMs: 0 })
})

test('barState is soon inside the lead time', () => {
  const state = Model.barState(EVENTS, START - 30 * MIN, 30)
  assert.equal(state.phase, 'soon')
  assert.equal(state.event.id, 'easy')
  assert.equal(state.countdownMs, 30 * MIN)
  assert.equal(state.extra, 0)
})

test('barState is imminent in the last 10 minutes', () => {
  assert.equal(Model.barState(EVENTS, START - 10 * MIN, 30).phase, 'imminent')
  assert.equal(Model.barState(EVENTS, START - 10 * MIN - 1, 30).phase, 'soon')
  assert.equal(Model.barState(EVENTS, START - 1000, 30).phase, 'imminent')
})

test('barState with a lead under 10 minutes goes straight to imminent', () => {
  assert.equal(Model.barState(EVENTS, START - 5 * MIN, 5).phase, 'imminent')
  assert.equal(Model.barState(EVENTS, START - 6 * MIN, 5).phase, 'idle')
})

test('barState is live for the first 2 minutes after the start, then idle', () => {
  const live = Model.barState(EVENTS, START, 30)
  assert.equal(live.phase, 'live')
  assert.equal(live.countdownMs, 0)
  assert.equal(Model.barState(EVENTS, START + 2 * MIN, 30).phase, 'live')
  assert.equal(Model.barState(EVENTS, START + 2 * MIN, 30).countdownMs, -2 * MIN)
  assert.equal(Model.barState(EVENTS, START + 2 * MIN + 1, 30).phase, 'idle')
})

test('barState: a meeting that just started outranks the next one', () => {
  const events = [meeting('next', 13, 5), meeting('now', 13, 0)]
  const state = Model.barState(events, START + MIN, 30)
  assert.equal(state.phase, 'live')
  assert.equal(state.event.id, 'now')
})

test('barState picks the soonest upcoming event', () => {
  const events = [meeting('later', 13, 20), meeting('sooner', 13, 0)]
  assert.equal(Model.barState(events, START - 15 * MIN, 30).event.id, 'sooner')
})

test('barState counts the other events starting at the same moment', () => {
  const events = [meeting('a', 13, 0), meeting('b', 13, 0), meeting('c', 13, 0), meeting('d', 13, 30)]
  const state = Model.barState(events, START - 5 * MIN, 30)
  assert.equal(state.event.id, 'a')
  assert.equal(state.extra, 2)
  assert.equal(Model.barState(events, START + MIN, 30).extra, 2)
})

test('barState counts a multi-day event once, not once per day row', () => {
  const row = meeting('trip', 13, 0)
  const nextDayRow = { ...row, dateKey: '2026-10-07' }
  assert.equal(Model.barState([row, nextDayRow], START - 5 * MIN, 30).extra, 0)
})

test('barState ignores all-day, declined, finished and unreadable rows', () => {
  const events = [
    { id: 'allday', title: 'Holiday', allDay: true, dateKey: '2026-10-06', start: '2026-10-06', end: '2026-10-07' },
    meeting('declined', 13, 0, { responseStatus: 'declined' }),
    meeting('done', 13, 0, { title: '✓ Regar as plantas', calendarName: 'Todoist' }),
    { id: 'bad', title: 'Bad', allDay: false, start: 'nope' }
  ]
  assert.equal(Model.barState(events, START - 5 * MIN, 30).phase, 'idle')
})

test('barState with a lead of 0 or nonsense stays idle', () => {
  assert.equal(Model.barState(EVENTS, START - 5 * MIN, 0).phase, 'idle')
  assert.equal(Model.barState(EVENTS, START, 'never').phase, 'idle')
  assert.equal(Model.barState(null, START, 30).phase, 'idle')
})

test('barLabel words each phase in both languages', () => {
  const soon = Model.barState(EVENTS, START - 30 * MIN, 30)
  assert.equal(Model.barLabel(soon, 'pt'), 'Revisão do projeto em 30 min')
  assert.equal(Model.barLabel(soon, 'en'), 'Revisão do projeto in 30 min')
  const imminent = Model.barState(EVENTS, START - 8 * MIN + 20 * 1000, 30)
  assert.equal(Model.barLabel(imminent, 'pt'), 'Revisão do projeto em 8 min')
  const live = Model.barState(EVENTS, START + MIN, 30)
  assert.equal(Model.barLabel(live, 'pt'), 'Agora: Revisão do projeto')
  assert.equal(Model.barLabel(live, 'en'), 'Now: Revisão do projeto')
})

test('barLabel truncates, strips task markers and is empty when idle', () => {
  const long = [meeting('x', 13, 0, { title: 'PRAZO: ' + 'a'.repeat(40) })]
  assert.equal(Model.barLabel(Model.barState(long, START - 5 * MIN, 30), 'en', 10), 'aaaaaaaaa… in 5 min')
  assert.equal(Model.barLabel(Model.barState(EVENTS, START - 90 * MIN, 30), 'en'), '')
  assert.equal(Model.barLabel(null, 'en'), '')
})

test('barLabel says at least 1 min while the start is still ahead', () => {
  const state = Model.barState(EVENTS, START - 10 * 1000, 30)
  assert.equal(Model.barLabel(state, 'en'), 'Revisão do projeto in 1 min')
})

test('meetingToJoin prefers the announced meeting when it has a link', () => {
  const announced = meeting('later', 15, 0)
  assert.equal(Model.meetingToJoin([meeting('now', 12, 30, { end: localIso(2026, 9, 6, 13, 15) })], START, announced), announced)
})

test('meetingToJoin falls back to the latest meeting under way, then the next one today', () => {
  const early = meeting('early', 12, 0, { end: localIso(2026, 9, 6, 13, 30) })
  const late = meeting('late', 12, 45, { end: localIso(2026, 9, 6, 13, 30) })
  const next = meeting('next', 15, 0)
  const sooner = meeting('sooner', 14, 0)
  const noLink = meeting('noLink', 13, 0, { meetingUrl: '' })
  assert.equal(Model.meetingToJoin([early, late, next], START, null).id, 'late')
  assert.equal(Model.meetingToJoin([next, sooner, noLink], START, noLink).id, 'sooner')
})

test('meetingToJoin skips all-day rows, tomorrow and linkless events', () => {
  const tomorrow = { ...meeting('tomorrow', 9, 0), start: localIso(2026, 9, 7, 9, 0), end: localIso(2026, 9, 7, 10, 0) }
  const allDay = { id: 'a', allDay: true, start: '2026-10-06', end: '2026-10-07', meetingUrl: 'https://meet.google.com/x' }
  assert.equal(Model.meetingToJoin([tomorrow, allDay, meeting('x', 15, 0, { meetingUrl: '' })], START, null), null)
  assert.equal(Model.meetingToJoin(null, START, null), null)
})
