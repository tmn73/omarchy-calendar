const test = require('node:test')
const assert = require('node:assert')
const { loadQmlJs } = require('./load-qml-js.js')
const { localIso, localMs } = require('./local-time.js')

const Model = loadQmlJs('Model.js')

// Tuesday 2026-10-06, 12:52 local.
const NOW = localMs(2026, 9, 6, 12, 52)
const TODAY = '2026-10-06'

const allDay = (title, extra = {}) => ({
  id: title, title, allDay: true, dateKey: TODAY, start: TODAY, end: '2026-10-07',
  calendarId: 'me', calendarName: 'Pessoal', ...extra
})
const timed = (title, startHour, startMin, endHour, endMin, extra = {}) => ({
  id: title, title, allDay: false, dateKey: TODAY,
  start: localIso(2026, 9, 6, startHour, startMin), end: localIso(2026, 9, 6, endHour, endMin),
  calendarId: 'me', calendarName: 'Pessoal', ...extra
})

test('classifyEvent: a plain event', () => {
  assert.deepEqual(Model.classifyEvent({ title: 'Standup', calendarName: 'Work' }),
    { kind: 'event', done: false, title: 'Standup' })
})

test('classifyEvent: anything on a Todoist or tasks calendar is a task', () => {
  assert.equal(Model.classifyEvent({ title: 'Buy milk', calendarName: 'Todoist' }).kind, 'task')
  assert.equal(Model.classifyEvent({ title: 'Buy milk', calendarName: 'My Tasks' }).kind, 'task')
  assert.equal(Model.classifyEvent({ title: 'Comprar pão', calendarName: 'Tarefas' }).kind, 'task')
})

test('classifyEvent: a check mark means a finished task, and is stripped', () => {
  for (const mark of ['✓', '✔', '☑']) {
    assert.deepEqual(Model.classifyEvent({ title: `${mark} Renovar passaporte`, calendarName: 'Pessoal' }),
      { kind: 'task', done: true, title: 'Renovar passaporte' })
  }
})

test('classifyEvent: deadline prefixes in either language, any separator, stripped', () => {
  assert.deepEqual(Model.classifyEvent({ title: 'PRAZO: Enviar relatório', calendarName: 'Pessoal' }),
    { kind: 'deadline', done: false, title: 'Enviar relatório' })
  assert.equal(Model.classifyEvent({ title: 'Deadline - taxes' }).title, 'taxes')
  assert.equal(Model.classifyEvent({ title: '  due – report' }).title, 'report')
  assert.equal(Model.classifyEvent({ title: 'prazo:x' }).kind, 'deadline')
})

test('classifyEvent: words that merely start like a prefix are not one', () => {
  assert.equal(Model.classifyEvent({ title: 'Due diligence: call' }).kind, 'event')
  assert.equal(Model.classifyEvent({ title: 'Prazos da semana' }).kind, 'event')
})

test('classifyEvent: a deadline on a task calendar stays a deadline', () => {
  assert.deepEqual(Model.classifyEvent({ title: '✓ PRAZO: Imposto', calendarName: 'Todoist' }),
    { kind: 'deadline', done: true, title: 'Imposto' })
})

test('classifyEvent keeps the original when stripping would leave nothing', () => {
  assert.equal(Model.classifyEvent({ title: '✓ ' }).title, '✓')
  assert.equal(Model.classifyEvent(null).title, '')
})

test('daySections orders all-day rows: deadlines, events, open tasks, done tasks', () => {
  const events = [
    allDay('✓ Done task', { calendarName: 'Todoist' }),
    allDay('Open task', { calendarName: 'Todoist' }),
    allDay('Holiday'),
    allDay('PRAZO: Taxes'),
    allDay('Second open task', { calendarName: 'Todoist' })
  ]
  const sections = Model.daySections(events, NOW, true)
  assert.deepEqual(sections.allDay.map(i => i.displayTitle),
    ['Taxes', 'Holiday', 'Open task', 'Second open task', 'Done task'])
  assert.deepEqual(sections.timed, [])
})

test('daySections items are copies of the event plus classification', () => {
  const event = allDay('PRAZO: Taxes', { location: 'Receita' })
  const item = Model.daySections([event], NOW, true).allDay[0]
  assert.equal(item.title, 'PRAZO: Taxes')
  assert.equal(item.displayTitle, 'Taxes')
  assert.equal(item.kind, 'deadline')
  assert.equal(item.done, false)
  assert.equal(item.location, 'Receita')
  assert.equal(item.phase, 'later')
  assert.equal(item.startMs, localMs(2026, 9, 6))
  assert.equal(event.kind, undefined)
})

test('daySections sorts timed rows by start, marks phases and places the now line', () => {
  const events = [
    timed('Late', 16, 0, 17, 0),
    timed('Morning', 9, 0, 9, 30),
    timed('Lunch', 12, 30, 13, 30)
  ]
  const sections = Model.daySections(events, NOW, true)
  assert.deepEqual(sections.timed.map(i => i.title), ['Morning', 'Lunch', 'Late'])
  assert.deepEqual(sections.timed.map(i => i.phase), ['past', 'now', 'later'])
  assert.equal(sections.nowIndex, 2)
})

test('daySections has no now line on any day but today', () => {
  assert.equal(Model.daySections([timed('A', 9, 0, 10, 0)], NOW, false).nowIndex, -1)
})

test('daySections keeps timed tasks in the timed section', () => {
  const sections = Model.daySections([timed('Regar as plantas', 8, 0, 8, 30, { calendarName: 'Todoist' })], NOW, true)
  assert.equal(sections.timed[0].kind, 'task')
  assert.equal(sections.allDay.length, 0)
})

test('daySections tolerates null and empty input', () => {
  assert.deepEqual(Model.daySections(null, NOW, true), { allDay: [], timed: [], nowIndex: 0 })
})

const onDay = (key, title, extra = {}) => ({ id: key + title, title, allDay: true, dateKey: key, start: key, ...extra })

test('upcomingDays lists the next days that have something, skipping empty ones', () => {
  const index = Model.indexEventsByDate([
    onDay('2026-10-06', 'Selected day itself'),
    onDay('2026-10-08', 'A'),
    onDay('2026-10-11', 'B'),
    onDay('2026-10-12', 'C')
  ])
  const days = Model.upcomingDays(index, TODAY, 2, 3)
  assert.deepEqual(days.map(d => d.key), ['2026-10-08', '2026-10-11'])
  assert.equal(days[0].rows[0].displayTitle, 'A')
  assert.equal(days[0].more, 0)
})

test('upcomingDays caps the rows, counts the rest, and puts all-day before timed', () => {
  const key = '2026-10-07'
  const index = Model.indexEventsByDate([
    { id: 't', title: 'Timed', allDay: false, dateKey: key, start: localIso(2026, 9, 7, 9, 0), end: localIso(2026, 9, 7, 10, 0) },
    onDay(key, 'Event'),
    onDay(key, 'PRAZO: Deadline'),
    onDay(key, 'Task', { calendarName: 'Todoist' }),
    onDay(key, 'Task 2', { calendarName: 'Todoist' })
  ])
  const [day] = Model.upcomingDays(index, TODAY, 5, 3)
  assert.deepEqual(day.rows.map(r => r.displayTitle), ['Deadline', 'Event', 'Task'])
  assert.equal(day.more, 2)
})

test('upcomingDays skips finished tasks, and a day with only those', () => {
  const index = Model.indexEventsByDate([
    onDay('2026-10-07', '✓ Done', { calendarName: 'Todoist' }),
    onDay('2026-10-08', '✓ Done too', { calendarName: 'Todoist' }),
    onDay('2026-10-08', 'Open')
  ])
  const days = Model.upcomingDays(index, TODAY, 5, 3)
  assert.deepEqual(days.map(d => d.key), ['2026-10-08'])
  assert.deepEqual(days[0].rows.map(r => r.displayTitle), ['Open'])
})

test('upcomingDays walks across month and year ends by calendar day', () => {
  const index = Model.indexEventsByDate([onDay('2027-01-01', 'New year')])
  assert.deepEqual(Model.upcomingDays(index, '2026-12-31', 5, 3).map(d => d.key), ['2027-01-01'])
})

test('upcomingDays defaults to 5 days of 3 rows and copes with no events', () => {
  assert.deepEqual(Model.upcomingDays({}, TODAY), [])
  const many = []
  for (let d = 7; d <= 14; d++) many.push(onDay(`2026-10-${String(d).padStart(2, '0')}`, 'X'))
  assert.equal(Model.upcomingDays(Model.indexEventsByDate(many), TODAY).length, 5)
})

test('daySummary counts meetings, events, deadlines, open and done tasks', () => {
  const sections = Model.daySections([
    timed('Meeting', 13, 0, 13, 45),
    allDay('Holiday'),
    allDay('PRAZO: A'),
    allDay('PRAZO: B'),
    allDay('Task 1', { calendarName: 'Todoist' }),
    allDay('Task 2', { calendarName: 'Todoist' }),
    allDay('Task 3', { calendarName: 'Todoist' }),
    allDay('✓ Done', { calendarName: 'Todoist' })
  ], NOW, true)
  assert.equal(Model.daySummary(sections, 'en'), '1 meeting · 1 event · 2 deadlines · 3 tasks · 1 done')
  assert.equal(Model.daySummary(sections, 'pt'), '1 compromisso · 1 evento · 2 prazos · 3 tarefas · 1 concluída')
})

test('daySummary leaves out what is not there and says so for an empty day', () => {
  const two = Model.daySections([timed('A', 9, 0, 10, 0), timed('B', 11, 0, 12, 0)], NOW, true)
  assert.equal(Model.daySummary(two, 'pt'), '2 compromissos')
  assert.equal(Model.daySummary(Model.daySections([], NOW, true), 'en'), 'Nothing scheduled')
  assert.equal(Model.daySummary(null, 'pt'), 'Nada agendado')
})

test('relativeDayLabel names today, tomorrow and yesterday only', () => {
  assert.equal(Model.relativeDayLabel(TODAY, TODAY, 'en'), 'Today')
  assert.equal(Model.relativeDayLabel('2026-10-07', TODAY, 'pt'), 'Amanhã')
  assert.equal(Model.relativeDayLabel('2026-10-05', TODAY, 'pt'), 'Ontem')
  assert.equal(Model.relativeDayLabel('2026-10-09', TODAY, 'en'), '')
})

test('relativeTime counts down to a meeting later today, rounding up', () => {
  const event = timed('Design review', 13, 0, 13, 45)
  assert.equal(Model.relativeTime(event, NOW, 'en'), 'in 8 min')
  assert.equal(Model.relativeTime(event, NOW, 'pt'), 'em 8 min')
  assert.equal(Model.relativeTime(event, NOW + 30 * 1000, 'en'), 'in 8 min')
  assert.equal(Model.relativeTime(event, NOW, 'pt', true), 'começa em 8 min')
  assert.equal(Model.relativeTime(timed('Later', 15, 22, 16, 0), NOW, 'en'), 'in 2 h 30 min')
  assert.equal(Model.relativeTime(timed('Later', 14, 52, 16, 0), NOW, 'pt'), 'em 2 h')
})

test('relativeTime under a minute out says now', () => {
  const event = timed('Design review', 13, 0, 13, 45)
  const almost = localMs(2026, 9, 6, 12, 59) + 30 * 1000
  assert.equal(Model.relativeTime(event, almost, 'en'), 'now')
  assert.equal(Model.relativeTime(event, almost, 'pt', true), 'começando agora')
})

test('relativeTime during a meeting gives the time left, with Portuguese agreement', () => {
  const event = timed('Design review', 12, 30, 13, 4)
  assert.equal(Model.relativeTime(event, NOW, 'en'), 'now · 12 min left')
  assert.equal(Model.relativeTime(event, NOW, 'pt'), 'agora · faltam 12 min')
  assert.equal(Model.relativeTime(event, NOW, 'pt', true), 'acontecendo agora · faltam 12 min')
  const oneLeft = timed('Short', 12, 0, 12, 53)
  assert.equal(Model.relativeTime(oneLeft, NOW, 'pt'), 'agora · falta 1 min')
  assert.equal(Model.relativeTime(oneLeft, NOW, 'en', true), 'happening now · 1 min left')
})

test('relativeTime after a meeting today says how long ago it ended', () => {
  assert.equal(Model.relativeTime(timed('A', 12, 0, 12, 47), NOW, 'en'), 'ended 5 min ago')
  assert.equal(Model.relativeTime(timed('A', 9, 0, 10, 30), NOW, 'pt'), 'terminou há 2 h')
  assert.equal(Model.relativeTime(timed('A', 12, 0, 12, 52), NOW, 'en'), 'ended 1 min ago')
})

test('relativeTime for other days speaks in days', () => {
  const on = (day, h) => ({ id: 'x', title: 'X', allDay: false, dateKey: `2026-10-${day}`,
    start: localIso(2026, 9, Number(day), h, 0), end: localIso(2026, 9, Number(day), h + 1, 0) })
  assert.equal(Model.relativeTime(on('07', 9), NOW, 'en'), 'tomorrow')
  assert.equal(Model.relativeTime(on('09', 9), NOW, 'en'), 'in 3 days')
  assert.equal(Model.relativeTime(on('09', 9), NOW, 'pt'), 'em 3 dias')
  assert.equal(Model.relativeTime(on('09', 9), NOW, 'pt', true), 'daqui a 3 dias')
  assert.equal(Model.relativeTime(on('05', 9), NOW, 'pt'), 'ontem')
  assert.equal(Model.relativeTime(on('03', 9), NOW, 'en'), '3 days ago')
})

test('relativeTime counts down past midnight when the start is under an hour away', () => {
  const late = localMs(2026, 9, 6, 23, 40)
  const soon = { id: 'x', allDay: false, start: localIso(2026, 9, 7, 0, 10), end: localIso(2026, 9, 7, 1, 0) }
  assert.equal(Model.relativeTime(soon, late, 'en'), 'in 30 min')
})

test('relativeTime for all-day rows uses the row day', () => {
  assert.equal(Model.relativeTime(allDay('Holiday'), NOW, 'en'), 'today')
  assert.equal(Model.relativeTime(allDay('Holiday', { dateKey: '2026-10-07' }), NOW, 'pt'), 'amanhã')
  assert.equal(Model.relativeTime(allDay('Holiday', { dateKey: '2026-10-08' }), NOW, 'en'), 'in 2 days')
  assert.equal(Model.relativeTime(allDay('Holiday', { dateKey: '2026-10-05' }), NOW, 'en'), 'yesterday')
  assert.equal(Model.relativeTime(allDay('Holiday', { dateKey: '2026-10-04' }), NOW, 'pt'), 'há 2 dias')
  assert.equal(Model.relativeTime(null, NOW, 'en'), '')
})

test('meetingHost names the common services and nothing else', () => {
  assert.equal(Model.meetingHost('https://meet.google.com/abc-defg-hij'), 'Google Meet')
  assert.equal(Model.meetingHost('https://us02web.zoom.us/j/123?pwd=x'), 'Zoom')
  assert.equal(Model.meetingHost('https://zoom.us/j/1'), 'Zoom')
  assert.equal(Model.meetingHost('https://teams.microsoft.com/l/meetup-join/x'), 'Teams')
  assert.equal(Model.meetingHost('https://acme.webex.com/meet/x'), 'Webex')
  assert.equal(Model.meetingHost('https://meet.jit.si/room'), 'Jitsi')
  assert.equal(Model.meetingHost('https://whereby.com/room'), 'Whereby')
  assert.equal(Model.meetingHost('https://example.com/zoom.us'), '')
  assert.equal(Model.meetingHost('https://zoom.us.evil.com/j/1'), '')
  assert.equal(Model.meetingHost('https://meet.google.com@evil.com/x'), '')
  assert.equal(Model.meetingHost('http://meet.google.com/abc'), '')
  assert.equal(Model.meetingHost(''), '')
  assert.equal(Model.meetingHost(null), '')
})

test('mapsUrl builds a Google Maps search for a real place', () => {
  assert.equal(Model.mapsUrl('Av. Paulista, 1000 - São Paulo'),
    'https://www.google.com/maps/search/?api=1&query=Av.%20Paulista%2C%201000%20-%20S%C3%A3o%20Paulo')
  assert.equal(Model.mapsUrl("Joe's (back room)"),
    'https://www.google.com/maps/search/?api=1&query=Joe%27s%20%28back%20room%29')
})

test('mapsUrl is empty for links, video services and blanks', () => {
  assert.equal(Model.mapsUrl('https://meet.google.com/abc'), '')
  assert.equal(Model.mapsUrl('Join: https://zoom.us/j/1'), '')
  assert.equal(Model.mapsUrl('www.example.com'), '')
  assert.equal(Model.mapsUrl('Google Meet'), '')
  assert.equal(Model.mapsUrl('Microsoft Teams Meeting'), '')
  assert.equal(Model.mapsUrl('   '), '')
  assert.equal(Model.mapsUrl(null), '')
})

test('mapsUrl output passes safeUrl', () => {
  const url = Model.mapsUrl('Rua "A" <1>, it\'s here')
  assert.equal(Model.safeUrl(url), url)
})
