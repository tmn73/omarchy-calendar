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

test('barState until the end: live for the whole event, idle once it is over', () => {
  const options = { liveUntilEnd: true }
  assert.equal(Model.barState(EVENTS, START + 30 * MIN, 30, options).phase, 'live')
  assert.equal(Model.barState(EVENTS, START + 45 * MIN - 1, 30, options).phase, 'live')
  assert.equal(Model.barState(EVENTS, START + 45 * MIN, 30, options).phase, 'idle')
})

test('barState until the end: the next event takes over once it is announced', () => {
  const events = [meeting('now', 13, 0), meeting('next', 13, 30)]
  const options = { liveUntilEnd: true }
  assert.equal(Model.barState(events, START + 10 * MIN, 15, options).event.id, 'now')
  const state = Model.barState(events, START + 20 * MIN, 15, options)
  assert.equal(state.phase, 'imminent')
  assert.equal(state.event.id, 'next')
})

test('barState until the end: the first 2 minutes stay with the event that just started', () => {
  const events = [meeting('now', 13, 0), meeting('next', 13, 5)]
  const state = Model.barState(events, START + MIN, 30, { liveUntilEnd: true })
  assert.equal(state.phase, 'live')
  assert.equal(state.event.id, 'now')
})

test('barState keeping the current event: live until its end, next one or not', () => {
  const events = [meeting('now', 13, 0), meeting('next', 13, 30)]
  const state = Model.barState(events, START + 20 * MIN, 15, { liveUntilEnd: true, keepCurrent: true })
  assert.equal(state.phase, 'live')
  assert.equal(state.event.id, 'now')
})

const PRESETS = Model.clockFormats(false)

test('clockFormatRing keeps the custom format after the presets, whatever is current', () => {
  const ring = Model.clockFormatRing('HH:mm', '', PRESETS, 'dddd d MMM HH:mm')
  assert.equal(ring.length, PRESETS.length + 1)
  assert.equal(ring[PRESETS.length], 'dddd d MMM HH:mm')
  assert.deepEqual(Model.clockFormatRing('dddd d MMM HH:mm', '', PRESETS, 'dddd d MMM HH:mm'), ring)
})

test('right click walks off the custom format and comes back to it', () => {
  const custom = 'dddd d MMM HH:mm'
  let current = custom
  const seen = []
  for (let i = 0; i <= PRESETS.length; i++) {
    current = Model.nextClockFormat(Model.clockFormatRing(current, '', PRESETS, custom), current)
    seen.push(current)
  }
  assert.equal(seen[0], PRESETS[0])
  assert.equal(seen[seen.length - 1], custom)
})

test('presetClockFormat finds a preset typed with extra spaces, and nothing else', () => {
  assert.equal(Model.presetClockFormat('  dddd   HH:mm ', PRESETS), 'dddd HH:mm')
  assert.equal(Model.presetClockFormat('dddd d MMM HH:mm', PRESETS), '')
  assert.equal(Model.presetClockFormat('', PRESETS), '')
})

test('customClockFormatValues stores a new format and shows it', () => {
  assert.deepEqual(Model.customClockFormatValues(' dddd d MMM HH:mm ', '', 'HH:mm', PRESETS, 'dddd HH:mm'),
    { custom: 'dddd d MMM HH:mm', format: 'dddd d MMM HH:mm' })
})

test('customClockFormatValues never keeps a preset as the custom format', () => {
  assert.deepEqual(Model.customClockFormatValues('HH:mm', 'dddd d MMM HH:mm', 'dddd d MMM HH:mm', PRESETS, 'dddd HH:mm'),
    { custom: '', format: 'HH:mm' })
})

test('clearing the custom format puts the bar back on the default only if it still showed it', () => {
  assert.deepEqual(Model.customClockFormatValues('', 'dddd d MMM HH:mm', 'dddd d MMM HH:mm', PRESETS, 'dddd HH:mm'),
    { custom: '', format: 'dddd HH:mm' })
  assert.deepEqual(Model.customClockFormatValues('', 'dddd d MMM HH:mm', 'h:mm AP', PRESETS, 'dddd HH:mm'),
    { custom: '', format: 'h:mm AP' })
})

const VERTICAL = Model.clockFormats(true)

test('cleanClockFormat trims each line and keeps the line breaks', () => {
  assert.equal(Model.cleanClockFormat('  dddd   d MMM  '), 'dddd d MMM')
  assert.equal(Model.cleanClockFormat('\n ddd \nHH\n  mm \n\n'), 'ddd\nHH\nmm')
})

test('presetClockFormat tells a vertical preset from the same tokens on one line', () => {
  assert.equal(Model.presetClockFormat('HH\n—\nmm\n', VERTICAL), 'HH\n—\nmm')
  assert.equal(Model.presetClockFormat('HH — mm', VERTICAL), '')
})

test('customClockFormatValues stores a vertical format with its line breaks', () => {
  assert.deepEqual(Model.customClockFormatValues('ddd\nHH\nmm\n', '', 'HH\n—\nmm', VERTICAL, 'HH\n—\nmm'),
    { custom: 'ddd\nHH\nmm', format: 'ddd\nHH\nmm' })
})

test('clockNeedsSeconds is true only for a format that prints seconds', () => {
  assert.equal(Model.clockNeedsSeconds('dddd, MMMM dd, yyyy hh:mm:ss a'), true)
  assert.equal(Model.clockNeedsSeconds('HH:mm:s'), true)
  for (const preset of PRESETS.concat(VERTICAL)) assert.equal(Model.clockNeedsSeconds(preset), false)
  assert.equal(Model.clockNeedsSeconds("HH:mm 'hrs'"), false)
  assert.equal(Model.clockNeedsSeconds("'it''s' HH:mm"), false)
  assert.equal(Model.clockNeedsSeconds("HH:mm 'secs"), false)
  assert.equal(Model.clockNeedsSeconds(''), false)
})

test('adoptedCustomFormat keeps a hand-written format that right click is about to leave', () => {
  const alt = "d MMMM 'W'ww yyyy"
  assert.equal(Model.adoptedCustomFormat('HH:mm:ss', '', alt, PRESETS), 'HH:mm:ss')
  assert.equal(Model.adoptedCustomFormat('HH:mm:ss', 'ddd HH:mm', alt, PRESETS), 'ddd HH:mm')
  assert.equal(Model.adoptedCustomFormat('dddd HH:mm', '', alt, PRESETS), '')
  assert.equal(Model.adoptedCustomFormat(alt, '', alt, PRESETS), '')
  assert.equal(Model.adoptedCustomFormat('', '', alt, PRESETS), '')
})

test('the default and alternate formats are presets of their orientation', () => {
  for (const vertical of [false, true]) {
    const presets = Model.clockFormats(vertical)
    assert.ok(presets.includes(Model.defaultClockFormat(vertical)))
    assert.ok(presets.includes(Model.defaultAltClockFormat(vertical)))
  }
  assert.equal(Model.defaultClockFormat(false), 'dddd HH:mm')
  assert.equal(Model.defaultAltClockFormat(true), "dd\nMMM\n'W'ww\n''yy")
})

test('clickAction keeps a known action and falls back to the button default', () => {
  assert.equal(Model.clickAction('right', 'join'), 'join')
  assert.equal(Model.clickAction('left', ' format '), 'format')
  assert.equal(Model.clickAction('right', 'nonsense'), 'format')
  assert.equal(Model.clickAction('middle', undefined), 'join')
  assert.equal(Model.clickAction('left', null), 'panel')
})

test('clickTooltip words every button in order, in both languages', () => {
  assert.equal(Model.clickTooltip({}, 'en'),
    'Click: open the panel · Middle click: join the next meeting · Right click: change the format')
  assert.equal(Model.clickTooltip({ right: 'join' }, 'en'),
    'Click: open the panel · Middle click: join the next meeting · Right click: join the next meeting')
  assert.equal(Model.clickTooltip({ left: 'join', middle: 'panel', right: 'bogus' }, 'pt'),
    'Clique: entra na próxima reunião · Clique do meio: abre o painel · Clique direito: alterna o formato')
})

test('clickActions keeps one button on the panel', () => {
  assert.deepEqual(Model.clickActions('join', 'format', 'panel'), { left: 'join', middle: 'format', right: 'panel' })
  assert.deepEqual(Model.clickActions('join', 'join', 'format'), { left: 'panel', middle: 'join', right: 'format' })
  assert.deepEqual(Model.clickActions(undefined, undefined, undefined), { left: 'panel', middle: 'join', right: 'format' })
})

test('clickLocked holds only the last button on the panel', () => {
  const one = { left: 'join', middle: 'panel', right: 'format' }
  assert.equal(Model.clickLocked(one, 'middle'), true)
  assert.equal(Model.clickLocked(one, 'left'), false)
  assert.equal(Model.clickLocked({ left: 'panel', middle: 'panel', right: 'join' }, 'left'), false)
})

test('formatButton names the first button that cycles the format', () => {
  assert.equal(Model.formatButton({ left: 'panel', middle: 'join', right: 'format' }), 'right')
  assert.equal(Model.formatButton({ left: 'panel', middle: 'format', right: 'format' }), 'middle')
  assert.equal(Model.formatButton({ left: 'panel', middle: 'join', right: 'join' }), '')
})

test('announceTitleLimit keeps 8 to 60 characters and defaults the rest', () => {
  assert.equal(Model.announceTitleLimit(16), 16)
  assert.equal(Model.announceTitleLimit('33'), 33)
  assert.equal(Model.announceTitleLimit(7), 28)
  assert.equal(Model.announceTitleLimit(61), 28)
  assert.equal(Model.announceTitleLimit(null), 28)
  assert.equal(Model.announceTitleLimit('nonsense'), 28)
})

test('titleLimitChoices adds a hand-written length in its place', () => {
  assert.deepEqual(Model.titleLimitChoices(16), [12, 16, 20, 28, 40])
  assert.deepEqual(Model.titleLimitChoices(33), [12, 16, 20, 28, 33, 40])
  assert.deepEqual(Model.titleLimitChoices(8), [8, 12, 16, 20, 28, 40])
})
