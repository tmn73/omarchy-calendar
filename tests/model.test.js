const test = require('node:test')
const assert = require('node:assert')
const { loadQmlJs } = require('./load-qml-js.js')

const Model = loadQmlJs('Model.js')

const EVENTS = [
  { id: 'a', dateKey: '2026-08-10', title: 'Standup', color: '#f83a22', start: '2026-08-10T09:00:00-05:00' },
  { id: 'b', dateKey: '2026-08-10', title: 'Lunch', color: '#7bd148', start: '2026-08-10T12:00:00-05:00' },
  { id: 'c', dateKey: '2026-08-10', title: 'Retro', color: '#f83a22', start: '2026-08-10T16:00:00-05:00' },
  { id: 'd', dateKey: '2026-08-12', title: 'Dentist', color: '#ffad46', start: '2026-08-12T10:00:00-05:00' }
]

test('indexEventsByDate groups by dateKey', () => {
  const index = Model.indexEventsByDate(EVENTS)
  assert.equal(index['2026-08-10'].length, 3)
  assert.equal(index['2026-08-12'].length, 1)
  assert.equal(index['2026-08-11'], undefined)
})

test('indexEventsByDate tolerates an empty list', () => {
  assert.deepEqual(Model.indexEventsByDate([]), {})
})

test('indexEventsByDate tolerates null', () => {
  assert.deepEqual(Model.indexEventsByDate(null), {})
})

test('eventsForDateKey returns an empty array for an unknown day', () => {
  const index = Model.indexEventsByDate(EVENTS)
  assert.deepEqual(Model.eventsForDateKey(index, '2026-01-01'), [])
})

test('eventColors dedupes and preserves first-seen order', () => {
  const index = Model.indexEventsByDate(EVENTS)
  assert.deepEqual(Model.eventColors(index, '2026-08-10', 5), ['#f83a22', '#7bd148'])
})

test('eventColors respects the limit', () => {
  const index = Model.indexEventsByDate(EVENTS)
  assert.deepEqual(Model.eventColors(index, '2026-08-10', 1), ['#f83a22'])
})

// monthGrid returns an array of 6 week objects, each { week, days }.
// It is not wrapped in an outer object.
test('monthGrid without an index behaves as before', () => {
  const weeks = Model.monthGrid(2026, 7, 1, '2026-08-10')
  assert.equal(weeks.length, 6)
  const cells = weeks.flatMap(week => week.days)
  assert.equal(cells.length, 42)
  assert.ok(cells.every(cell => cell.hasEvent === false))
  assert.ok(cells.every(cell => Array.isArray(cell.dots) && cell.dots.length === 0))
})

test('monthGrid marks days that have events', () => {
  const index = Model.indexEventsByDate(EVENTS)
  const cells = Model.monthGrid(2026, 7, 1, '2026-08-10', index).flatMap(week => week.days)
  const tenth = cells.find(cell => cell.key === '2026-08-10')
  const eleventh = cells.find(cell => cell.key === '2026-08-11')
  assert.equal(tenth.hasEvent, true)
  assert.deepEqual(tenth.dots, ['#f83a22', '#7bd148'])
  assert.equal(eleventh.hasEvent, false)
})

test('monthGrid preserves the existing cell fields', () => {
  const cells = Model.monthGrid(2026, 7, 1, '2026-08-10').flatMap(week => week.days)
  const tenth = cells.find(cell => cell.key === '2026-08-10')
  assert.equal(tenth.day, 10)
  assert.equal(tenth.inMonth, true)
  assert.equal(tenth.today, true)
})

test('syncState reports missing when there is no document', () => {
  assert.equal(Model.syncState(null, Date.parse('2026-08-10T12:00:00Z'), 300), 'missing')
})

test('syncState reports missing when syncedAt is absent', () => {
  assert.equal(Model.syncState({}, Date.parse('2026-08-10T12:00:00Z'), 300), 'missing')
})

test('syncState reports ok for a recent sync', () => {
  const doc = { syncedAt: '2026-08-10T11:58:00Z' }
  assert.equal(Model.syncState(doc, Date.parse('2026-08-10T12:00:00Z'), 300), 'ok')
})

test('syncState tolerates one missed run', () => {
  // 300s interval, staleness threshold is 4x that, so 15 minutes is still ok.
  const doc = { syncedAt: '2026-08-10T11:48:00Z' }
  assert.equal(Model.syncState(doc, Date.parse('2026-08-10T12:00:00Z'), 300), 'ok')
})

test('syncState reports stale past the threshold', () => {
  const doc = { syncedAt: '2026-08-10T10:00:00Z' }
  assert.equal(Model.syncState(doc, Date.parse('2026-08-10T12:00:00Z'), 300), 'stale')
})

test('syncState reports missing for an unparseable syncedAt', () => {
  const doc = { syncedAt: 'not a date' }
  assert.equal(Model.syncState(doc, Date.parse('2026-08-10T12:00:00Z'), 300), 'missing')
})

test('dateFromKey builds a local date, not a UTC one', () => {
  const d = Model.dateFromKey('2026-08-10', null)
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 7)
  assert.equal(d.getDate(), 10)
})

test('dateFromKey returns the fallback for a malformed key', () => {
  const fallback = new Date(2000, 0, 1)
  assert.equal(Model.dateFromKey('nope', fallback), fallback)
  assert.equal(Model.dateFromKey('', fallback), fallback)
  assert.equal(Model.dateFromKey(null, fallback), fallback)
  assert.equal(Model.dateFromKey('2026-08', fallback), fallback)
})

test('dateFromKey returns the fallback for non-numeric parts', () => {
  const fallback = new Date(2000, 0, 1)
  assert.equal(Model.dateFromKey('yyyy-mm-dd', fallback), fallback)
})

const DOC = {
  version: 1,
  events: [
    { id: 'a', calendarId: 'work@x', calendarName: 'Destify', color: '#ffad46', dateKey: '2026-08-10' },
    { id: 'b', calendarId: 'moon@x', calendarName: 'Phases of the Moon', color: '#fad165', dateKey: '2026-08-10' },
    { id: 'c', calendarId: 'work@x', calendarName: 'Destify', color: '#ffad46', dateKey: '2026-08-11' }
  ]
}

test('calendarsInDocument lists each calendar once, sorted by name', () => {
  assert.deepEqual(Model.calendarsInDocument(DOC), [
    { id: 'work@x', name: 'Destify', color: '#ffad46' },
    { id: 'moon@x', name: 'Phases of the Moon', color: '#fad165' }
  ])
})

test('calendarsInDocument tolerates a null document', () => {
  assert.deepEqual(Model.calendarsInDocument(null), [])
  assert.deepEqual(Model.calendarsInDocument({}), [])
})

test('toggleHiddenCalendar adds then removes', () => {
  const once = Model.toggleHiddenCalendar([], 'moon@x')
  assert.deepEqual(once, ['moon@x'])
  assert.deepEqual(Model.toggleHiddenCalendar(once, 'moon@x'), [])
})

test('toggleHiddenCalendar does not mutate its input', () => {
  const before = ['moon@x']
  Model.toggleHiddenCalendar(before, 'work@x')
  assert.deepEqual(before, ['moon@x'])
})

test('toggleHiddenCalendar tolerates a null list', () => {
  assert.deepEqual(Model.toggleHiddenCalendar(null, 'moon@x'), ['moon@x'])
})

test('visibleEvents drops hidden calendars only', () => {
  const visible = Model.visibleEvents(DOC.events, ['moon@x'])
  assert.equal(visible.length, 2)
  assert.ok(visible.every(e => e.calendarId === 'work@x'))
})

test('visibleEvents returns everything when nothing is hidden', () => {
  assert.equal(Model.visibleEvents(DOC.events, []).length, 3)
  assert.equal(Model.visibleEvents(DOC.events, null).length, 3)
})

test('isCalendarHidden matches by id', () => {
  assert.equal(Model.isCalendarHidden(['moon@x'], 'moon@x'), true)
  assert.equal(Model.isCalendarHidden(['moon@x'], 'work@x'), false)
  assert.equal(Model.isCalendarHidden([], 'work@x'), false)
})

const NOW = Date.parse('2026-08-10T09:00:00-05:00')
const at = (iso, extra = {}) => ({ id: iso, title: 'X', start: iso, allDay: false, ...extra })

test('truncateTitle only cuts what is too long', () => {
  assert.equal(Model.truncateTitle('Standup', 28), 'Standup')
  assert.equal(Model.truncateTitle('a'.repeat(40), 10), 'a'.repeat(9) + '…')
})

test('truncateTitle cuts mid-word rather than hunting for a boundary', () => {
  assert.equal(Model.truncateTitle('Design process solution here', 12), 'Design proc…')
})

test('truncateTitle does not leave a dangling space before the ellipsis', () => {
  // The cut lands exactly on the space after "Design".
  assert.equal(Model.truncateTitle('Design process', 8), 'Design…')
})

test('truncateTitle tolerates null', () => {
  assert.equal(Model.truncateTitle(null, 10), '')
})

const TYPED = [
  { id: 'a', calendarId: 'w', dateKey: '2026-08-10', eventType: 'default', responseStatus: 'accepted' },
  { id: 'b', calendarId: 'w', dateKey: '2026-08-10', eventType: 'workingLocation', responseStatus: '' },
  { id: 'c', calendarId: 'w', dateKey: '2026-08-10', eventType: 'default', responseStatus: 'declined' },
  { id: 'd', calendarId: 'w', dateKey: '2026-08-10', eventType: 'outOfOffice', responseStatus: '' }
]

test('visibleEvents hides workingLocation by default', () => {
  const ids = Model.visibleEvents(TYPED, []).map(e => e.id)
  assert.deepEqual(ids, ['a', 'c', 'd'])
})

test('visibleEvents can show workingLocation when asked', () => {
  const ids = Model.visibleEvents(TYPED, [], { hideWorkingLocation: false }).map(e => e.id)
  assert.deepEqual(ids, ['a', 'b', 'c', 'd'])
})

test('visibleEvents hides declined only when asked', () => {
  assert.deepEqual(Model.visibleEvents(TYPED, [], { hideDeclined: true }).map(e => e.id), ['a', 'd'])
  assert.deepEqual(Model.visibleEvents(TYPED, [], { hideDeclined: false }).map(e => e.id), ['a', 'c', 'd'])
})

test('visibleEvents still applies the calendar filter alongside type filters', () => {
  assert.deepEqual(Model.visibleEvents(TYPED, ['w']).map(e => e.id), [])
})

test('visibleEvents with no options behaves as the old two-argument call', () => {
  const plain = [{ id: 'x', calendarId: 'w', dateKey: '2026-08-10' }]
  assert.deepEqual(Model.visibleEvents(plain, []).map(e => e.id), ['x'])
})

test('isDeclined and isOutOfOffice read the right fields', () => {
  assert.equal(Model.isDeclined(TYPED[2]), true)
  assert.equal(Model.isDeclined(TYPED[0]), false)
  assert.equal(Model.isDeclined(null), false)
  assert.equal(Model.isOutOfOffice(TYPED[3]), true)
  assert.equal(Model.isOutOfOffice(TYPED[0]), false)
})

test('safeUrl only lets https through', () => {
  assert.equal(Model.safeUrl('https://meet.google.com/abc'), 'https://meet.google.com/abc')
  assert.equal(Model.safeUrl('http://meet.google.com/abc'), '')
  assert.equal(Model.safeUrl('javascript:alert(1)'), '')
  assert.equal(Model.safeUrl('file:///etc/passwd'), '')
  assert.equal(Model.safeUrl(''), '')
  assert.equal(Model.safeUrl(null), '')
})

test('safeUrl rejects anything that could break out of an argument', () => {
  assert.equal(Model.safeUrl('https://ok.com; rm -rf ~'), '')
  assert.equal(Model.safeUrl('https://ok.com "quoted"'), '')
  assert.equal(Model.safeUrl("https://ok.com'x"), '')
  assert.equal(Model.safeUrl('https://ok.com<script>'), '')
})

test('meetingUrlFor is empty rather than undefined when absent', () => {
  assert.equal(Model.meetingUrlFor({ id: 'x' }), '')
  assert.equal(Model.meetingUrlFor(null), '')
  assert.equal(Model.meetingUrlFor({ meetingUrl: 'https://z.com/1' }), 'https://z.com/1')
})

const meeting = (start, end, extra = {}) => ({
  id: 's', title: 'Standup', allDay: false, dateKey: '2026-08-10',
  start, end, meetingUrl: 'https://meet.google.com/x', ...extra
})
const TKEY = '2026-08-10'

test('isJoinableNow opens 15 minutes before the start', () => {
  const e = meeting('2026-08-10T09:00:00-05:00', '2026-08-10T09:30:00-05:00')
  const at = t => Model.isJoinableNow(e, Date.parse(t), TKEY)
  assert.equal(at('2026-08-10T08:44:00-05:00'), false)
  assert.equal(at('2026-08-10T08:45:00-05:00'), true)
})

test('isJoinableNow stays open during the meeting', () => {
  const e = meeting('2026-08-10T09:00:00-05:00', '2026-08-10T09:30:00-05:00')
  assert.equal(Model.isJoinableNow(e, Date.parse('2026-08-10T09:15:00-05:00'), TKEY), true)
})

test('isJoinableNow keeps a 15 minute grace after the end', () => {
  const e = meeting('2026-08-10T09:00:00-05:00', '2026-08-10T09:30:00-05:00')
  const at = t => Model.isJoinableNow(e, Date.parse(t), TKEY)
  assert.equal(at('2026-08-10T09:45:00-05:00'), true)
  assert.equal(at('2026-08-10T09:46:00-05:00'), false)
})

test('isJoinableNow is false for a meeting on another day', () => {
  const e = meeting('2026-08-14T09:00:00-05:00', '2026-08-14T09:30:00-05:00')
  assert.equal(Model.isJoinableNow(e, Date.parse('2026-08-10T09:00:00-05:00'), TKEY), false)
})

test('isJoinableNow needs a usable link', () => {
  const noLink = meeting('2026-08-10T09:00:00-05:00', '2026-08-10T09:30:00-05:00', { meetingUrl: '' })
  const bad = meeting('2026-08-10T09:00:00-05:00', '2026-08-10T09:30:00-05:00', { meetingUrl: 'javascript:x' })
  const now = Date.parse('2026-08-10T09:05:00-05:00')
  assert.equal(Model.isJoinableNow(noLink, now, TKEY), false)
  assert.equal(Model.isJoinableNow(bad, now, TKEY), false)
})

test('isJoinableNow treats an all-day event as joinable for its whole day', () => {
  const e = meeting('2026-08-10T00:00:00-05:00', '2026-08-11T00:00:00-05:00', { allDay: true })
  assert.equal(Model.isJoinableNow(e, Date.parse('2026-08-10T20:00:00-05:00'), TKEY), true)
  assert.equal(Model.isJoinableNow(e, Date.parse('2026-08-10T20:00:00-05:00'), '2026-08-11'), false)
})

test('isJoinableNow survives an unreadable or inverted time range', () => {
  const bad = meeting('nope', 'nope')
  assert.equal(Model.isJoinableNow(bad, Date.parse('2026-08-10T09:00:00-05:00'), TKEY), false)
  const inverted = meeting('2026-08-10T09:00:00-05:00', '2026-08-10T08:00:00-05:00')
  assert.equal(Model.isJoinableNow(inverted, Date.parse('2026-08-10T09:05:00-05:00'), TKEY), true)
})

test('eventUrlFor mirrors meetingUrlFor and is https only', () => {
  assert.equal(Model.eventUrlFor({ eventUrl: 'https://calendar.google.com/e' }), 'https://calendar.google.com/e')
  assert.equal(Model.eventUrlFor({ eventUrl: 'http://calendar.google.com/e' }), '')
  assert.equal(Model.eventUrlFor({}), '')
  assert.equal(Model.eventUrlFor(null), '')
})

test('commandPathFromUrl strips the file scheme and shortens home', () => {
  assert.equal(
    Model.commandPathFromUrl('file:///home/tmn/.config/omarchy/plugins/tmn73.calendar/sync/setup', '/home/tmn'),
    '~/.config/omarchy/plugins/tmn73.calendar/sync/setup'
  )
})

test('commandPathFromUrl leaves a path outside home alone', () => {
  assert.equal(
    Model.commandPathFromUrl('file:///opt/omarchy-calendar/sync/setup', '/home/tmn'),
    '/opt/omarchy-calendar/sync/setup'
  )
})

test('commandPathFromUrl tolerates a missing home or url', () => {
  assert.equal(Model.commandPathFromUrl('file:///srv/x/sync/setup', ''), '/srv/x/sync/setup')
  assert.equal(Model.commandPathFromUrl('', '/home/tmn'), '')
  assert.equal(Model.commandPathFromUrl(null, null), '')
})

test('commandPathFromUrl does not shorten a home-lookalike prefix', () => {
  // /home/tmn2 must not become ~2
  assert.equal(
    Model.commandPathFromUrl('file:///home/tmn2/plugin/sync/setup', '/home/tmn'),
    '/home/tmn2/plugin/sync/setup'
  )
})

const AT = (iso) => Date.parse(iso)

const DAY = [
  { id: 'hol', allDay: true, start: '2026-09-17', end: '2026-09-18' },
  { id: 'a', allDay: false, start: '2026-09-17T10:30:00+01:00', end: '2026-09-17T11:30:00+01:00' },
  { id: 'b', allDay: false, start: '2026-09-17T12:30:00+01:00', end: '2026-09-17T13:00:00+01:00' }
]

test('eventPhase splits past, now and later', () => {
  const now = AT('2026-09-17T11:00:00+01:00')
  assert.deepEqual(DAY.map(e => Model.eventPhase(e, now)), ['later', 'now', 'later'])
  assert.equal(Model.eventPhase(DAY[1], AT('2026-09-17T11:30:00+01:00')), 'past')
})

test('nowLineIndex sits above the first event not yet started', () => {
  assert.equal(Model.nowLineIndex(DAY, AT('2026-09-17T09:00:00+01:00')), 1)
  assert.equal(Model.nowLineIndex(DAY, AT('2026-09-17T11:00:00+01:00')), 2)
})

test('nowLineIndex goes after the last row once the day is done', () => {
  assert.equal(Model.nowLineIndex(DAY, AT('2026-09-17T18:00:00+01:00')), 3)
  assert.equal(Model.nowLineIndex([], 0), 0)
})

const ME_CAL = { id: 'me@example.com', name: 'Me', color: '#7bd148' }

test('isWritable is true only for rows on a writable calendar', () => {
  assert.equal(Model.isWritable({ calendarId: 'me@example.com' }, [ME_CAL]), true)
  assert.equal(Model.isWritable({ calendarId: 'team@example.com' }, [ME_CAL]), false)
  assert.equal(Model.isWritable({ calendarId: 'me@example.com' }, undefined), false)
})

test('defaultFormTimes starts today at the next half hour, 30 minutes long', () => {
  const now = new Date(2026, 8, 26, 10, 12)
  assert.deepEqual(Model.defaultFormTimes('2026-09-26', now), { start: '10:30', end: '11:00' })
})

test('defaultFormTimes on the half hour moves to the next one', () => {
  const now = new Date(2026, 8, 26, 10, 30)
  assert.deepEqual(Model.defaultFormTimes('2026-09-26', now), { start: '11:00', end: '11:30' })
})

test('defaultFormTimes starts another day at 09:00', () => {
  const now = new Date(2026, 8, 26, 10, 12)
  assert.deepEqual(Model.defaultFormTimes('2026-09-28', now), { start: '09:00', end: '09:30' })
})

test('defaultFormTimes late in the day ends at midnight', () => {
  const now = new Date(2026, 8, 26, 23, 40)
  assert.deepEqual(Model.defaultFormTimes('2026-09-26', now), { start: '23:30', end: '00:00' })
})

test('localPathFromUrl keeps the path absolute and decodes it', () => {
  assert.equal(Model.localPathFromUrl('file:///home/u/my%20plugins/sync/omarchy-calendar-event'),
    '/home/u/my plugins/sync/omarchy-calendar-event')
})

test('parseWriteReply reads the command output, and survives garbage', () => {
  assert.deepEqual(Model.parseWriteReply('{"ok":true,"eventId":"x"}\n'), { ok: true, error: '', event: null })
  assert.deepEqual(Model.parseWriteReply('{"ok":false,"error":"Nope."}'), { ok: false, error: 'Nope.', event: null })
  assert.deepEqual(Model.parseWriteReply('{"ok":true,"event":{"title":"T"}}').event, { title: 'T' })
  assert.equal(Model.parseWriteReply('Traceback ...').ok, false)
  assert.equal(Model.parseWriteReply('').ok, false)
})

const HHMM = (value) => value

test('timeOptions for the start menu lists 96 slots of 15 minutes', () => {
  const options = Model.timeOptions(-1, HHMM, false)
  assert.equal(options.length, 96)
  assert.deepEqual(options[0], { value: '00:00', label: '00:00' })
  assert.deepEqual(options[95], { value: '23:45', label: '23:45' })
})

test('timeOptions for the end menu starts 15 minutes later and shows durations', () => {
  const options = Model.timeOptions(10 * 60, HHMM, true)
  assert.deepEqual(options[0], { value: '10:15', label: '10:15 (15 min)' })
  assert.deepEqual(options[3], { value: '11:00', label: '11:00 (1 h)' })
  assert.deepEqual(options[options.length - 1], { value: '00:00', label: '00:00 (14 h)' })
})

test('timeOptions passes each value through the format function', () => {
  const twelve = (value) => value === '13:00' ? '1:00 PM' : value
  assert.equal(Model.timeOptions(-1, twelve, false)[52].label, '1:00 PM')
})

test('timeOptions words end-menu durations in the given language, English by default', () => {
  assert.equal(Model.timeOptions(10 * 60, HHMM, true)[5].label, '11:30 (1 h 30 min)')
  assert.equal(Model.timeOptions(10 * 60, HHMM, true, 'pt')[5].label, '11:30 (1 h 30 min)')
  assert.equal(Model.timeOptions(10 * 60, HHMM, true, 'pt')[0].label, '10:15 (15 min)')
  assert.equal(Model.timeOptions(0, HHMM, true, 'en').pop().label, '00:00 (24 h)')
})

test('nthWeekday counts from the start, or -1 in the last seven days', () => {
  assert.deepEqual(Model.nthWeekday('2026-09-12'), { n: 2, weekday: 6 })
  assert.deepEqual(Model.nthWeekday('2026-09-26'), { n: -1, weekday: 6 })
  assert.deepEqual(Model.nthWeekday('2026-09-01'), { n: 1, weekday: 2 })
})

test('repeatOptions labels the presets from the start date', () => {
  assert.deepEqual(Model.repeatOptions('2026-09-26').map(o => o.label), [
    'Does not repeat',
    'Daily',
    'Weekly on Saturday',
    'Monthly on the last Saturday',
    'Annually on September 26',
    'Every weekday (Monday to Friday)'
  ])
  assert.deepEqual(Model.repeatOptions('2026-09-26').map(o => o.value),
    ['none', 'daily', 'weekly', 'monthly', 'yearly', 'weekdays'])
  assert.equal(Model.repeatOptions('2026-09-12')[3].label, 'Monthly on the second Saturday')
})

test('addGuest trims, lowercases, and refuses a duplicate or a non-email', () => {
  const one = Model.addGuest([], '  Ana@Example.com ')
  assert.deepEqual(one, [{ email: 'ana@example.com', optional: false, responseStatus: 'needsAction', organizer: false }])
  assert.equal(Model.addGuest(one, 'ANA@example.com'), one)
  assert.equal(Model.addGuest(one, 'not an email'), one)
  assert.equal(Model.addGuest(one, 'bo@example.com').length, 2)
})

test('isValidEmail accepts an address and refuses the rest', () => {
  assert.equal(Model.isValidEmail('a@b.co'), true)
  assert.equal(Model.isValidEmail('a@b'), false)
  assert.equal(Model.isValidEmail('a b@c.co'), false)
})

test('reminderChoice reads the menu value from reminders', () => {
  assert.equal(Model.reminderChoice({ useDefault: true }), 'default')
  assert.equal(Model.reminderChoice({ useDefault: false, overrides: [] }), 'none')
  assert.equal(Model.reminderChoice({ useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }), '30')
  assert.equal(Model.reminderChoice({ useDefault: false, overrides: [{ method: 'popup', minutes: 20160 }] }), 'custom')
  assert.equal(Model.reminderChoice({ useDefault: false, overrides: [{ method: 'email', minutes: 30 }] }), 'custom')
})

test('remindersFor turns a menu value back into reminders', () => {
  assert.deepEqual(Model.remindersFor('default'), { useDefault: true, overrides: [] })
  assert.deepEqual(Model.remindersFor('none'), { useDefault: false, overrides: [] })
  assert.deepEqual(Model.remindersFor('1440'), { useDefault: false, overrides: [{ method: 'popup', minutes: 1440 }] })
})

test('EVENT_COLORS holds the 11 colours from colors get', () => {
  assert.equal(Model.EVENT_COLORS.length, 11)
  assert.deepEqual(Model.EVENT_COLORS[4], { id: '5', color: '#fbd75b' })
})

test('newEventForm builds a complete empty form on the day', () => {
  const form = Model.newEventForm('2026-09-26', { start: '10:30', end: '11:00' }, 'me@example.com')
  assert.equal(form.calendarId, 'me@example.com')
  assert.deepEqual([form.startDate, form.startTime, form.endDate, form.endTime],
    ['2026-09-26', '10:30', '2026-09-26', '11:00'])
  assert.equal(form.eventId, '')
  assert.equal(form.repeat, 'none')
  assert.deepEqual(form.guests, [])
  assert.deepEqual(form.reminders, { useDefault: true, overrides: [] })
  assert.equal(form.busy, true)
  assert.equal(form.guestsCanInviteOthers, true)
})

test('newEventForm ending at midnight keeps the end date on the start day', () => {
  const form = Model.newEventForm('2026-09-26', { start: '23:30', end: '00:00' }, 'me@example.com')
  assert.equal(form.endDate, '2026-09-26')
  assert.equal(form.endTime, '00:00')
})

test('otherGuests leaves out the calendar owner', () => {
  const form = { calendarId: 'me@example.com', guests: [
    { email: 'me@example.com' }, { email: 'Ana@example.com' }] }
  assert.deepEqual(Model.otherGuests(form).map(g => g.email), ['Ana@example.com'])
  assert.deepEqual(Model.otherGuests({ calendarId: 'me@example.com', guests: [] }), [])
})

const SUGGESTIONS = [
  { email: 'bo.lee@example.com', name: 'Bo Lee' },
  { email: 'ana@example.com', name: '' },
  { email: 'carla@work.co', name: 'Carla Ruiz' }
]

test('matchGuests matches the email or a word of the name, without case', () => {
  assert.deepEqual(Model.matchGuests(SUGGESTIONS, 'an', []).map(s => s.email), ['ana@example.com'])
  assert.deepEqual(Model.matchGuests(SUGGESTIONS, 'RUI', []).map(s => s.email), ['carla@work.co'])
  assert.deepEqual(Model.matchGuests(SUGGESTIONS, 'example', []).map(s => s.email),
    ['bo.lee@example.com', 'ana@example.com'])
})

test('matchGuests leaves out guests already added, and needs some text', () => {
  const added = [{ email: 'ana@example.com' }]
  assert.deepEqual(Model.matchGuests(SUGGESTIONS, 'example', added).map(s => s.email), ['bo.lee@example.com'])
  assert.deepEqual(Model.matchGuests(SUGGESTIONS, '  ', []), [])
})

test('matchGuests keeps the frequency order and caps the list', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ email: 'p' + i + '@x.co', name: '' }))
  assert.equal(Model.matchGuests(many, 'x.co', [], 5).length, 5)
  assert.equal(Model.matchGuests(many, 'x.co', [], 5)[0].email, 'p0@x.co')
})

// Regression: a second, capitalised WEEKDAY_NAMES used to overwrite the
// lowercase one at load, so the saved week start ("Monday") never read back.
test('the week start setting round-trips through its stored name', () => {
  assert.equal(Model.weekStartSettingName(0), 'sunday')
  assert.equal(Model.weekStartSettingName(1), 'monday')
  for (let day = 0; day < 7; day++)
    assert.equal(Model.normalizedWeekStart(Model.weekStartSettingName(day), 3), day)
})

test('normalizedWeekStart reads names, abbreviations and numbers, else the locale', () => {
  assert.equal(Model.normalizedWeekStart('monday', 0), 1)
  assert.equal(Model.normalizedWeekStart(' Sunday ', 1), 0)
  assert.equal(Model.normalizedWeekStart('sat', 1), 6)
  assert.equal(Model.normalizedWeekStart(8, 0), 1)
  assert.equal(Model.normalizedWeekStart('nonsense', 0), 0)
  assert.equal(Model.normalizedWeekStart(null, null), 1)
})

test('toggledWeekStart flips Monday and Sunday, and lands anything else on Monday', () => {
  assert.equal(Model.toggledWeekStart(1), 0)
  assert.equal(Model.toggledWeekStart(0), 1)
  assert.equal(Model.toggledWeekStart(6), 1)
})

test('addDays and daysBetween work in calendar days across months, years and DST', () => {
  assert.equal(Model.addDays('2026-10-31', 1), '2026-11-01')
  assert.equal(Model.addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(Model.addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(Model.daysBetween('2026-10-06', '2026-10-09'), 3)
  assert.equal(Model.daysBetween('2026-10-09', '2026-10-06'), -3)
  // Both DST changes of the northern and southern hemispheres fall in here.
  assert.equal(Model.daysBetween('2026-01-01', '2027-01-01'), 365)
  let key = '2026-01-01'
  for (let i = 0; i < 365; i++) key = Model.addDays(key, 1)
  assert.equal(key, '2027-01-01')
})

test('keyForMs is the local day of an instant', () => {
  assert.equal(Model.keyForMs(new Date(2026, 9, 6, 23, 59).getTime()), '2026-10-06')
  assert.equal(Model.keyForMs(new Date(2026, 9, 7, 0, 0).getTime()), '2026-10-07')
})

test('clockText and minutesOf convert between minutes and HH:mm', () => {
  assert.equal(Model.clockText(0), '00:00')
  assert.equal(Model.clockText(13 * 60 + 5), '13:05')
  assert.equal(Model.clockText(24 * 60), '00:00')
  assert.equal(Model.minutesOf('13:05'), 785)
  assert.equal(Model.minutesOf(''), 0)
})

test('commandPathFromUrl decodes the path it shortens', () => {
  assert.equal(Model.commandPathFromUrl('file:///home/u/my%20plugins/sync/setup', '/home/u'), '~/my plugins/sync/setup')
})

test('localPathFromUrl keeps a malformed escape as it is', () => {
  assert.equal(Model.localPathFromUrl('file:///srv/100%/x'), '/srv/100%/x')
})

test('parseWriteReply explains a failure in the panel language', () => {
  assert.equal(Model.parseWriteReply('', 'pt').error, 'O comando de eventos falhou: sem saída')
  assert.equal(Model.parseWriteReply('Traceback', 'en').error, 'The event command failed: Traceback')
})

test('repeatOptions in Portuguese agree with the weekday', () => {
  assert.deepEqual(Model.repeatOptions('2026-09-26', 'pt').map(o => o.label), [
    'Não se repete',
    'Todos os dias',
    'Toda semana no sábado',
    'Todo mês no último sábado',
    'Todo ano em 26 de setembro',
    'Dias úteis (segunda a sexta)'
  ])
  assert.deepEqual(Model.repeatOptions('2026-10-09', 'pt').slice(2, 4).map(o => o.label),
    ['Toda semana na sexta-feira', 'Todo mês na segunda sexta-feira'])
})

test('repeatOptions can add the entry for a rule kept as it is', () => {
  const options = Model.repeatOptions('2026-09-26', 'en', true)
  assert.deepEqual(options[options.length - 1], { value: 'custom', label: 'Custom rule (kept as it is)' })
  assert.equal(Model.repeatOptions('2026-09-26', 'pt', true).pop().label, 'Regra personalizada (mantida como está)')
  assert.equal(Model.repeatOptions('2026-09-26', 'en').length, 6)
})

test('reminderOptions lists the menu, with custom only for an unexpressible setting', () => {
  assert.deepEqual(Model.reminderOptions({ useDefault: true }, 'en'), [
    { value: 'default', label: 'Default' },
    { value: 'none', label: 'None' },
    { value: '5', label: '5 minutes before' },
    { value: '10', label: '10 minutes before' },
    { value: '30', label: '30 minutes before' },
    { value: '60', label: '1 hour before' },
    { value: '1440', label: '1 day before' }
  ])
  const custom = Model.reminderOptions({ useDefault: false, overrides: [{ method: 'email', minutes: 30 }] }, 'pt')
  assert.deepEqual(custom[custom.length - 1], { value: 'custom', label: 'Personalizada (mantida como está)' })
  assert.equal(custom[2].label, '5 minutos antes')
})

test('parseLifeExpectancy and parseAge keep their bounds', () => {
  assert.equal(Model.parseLifeExpectancy(''), 90)
  assert.equal(Model.parseLifeExpectancy('151'), 90)
  assert.equal(Model.parseLifeExpectancy('80'), 80)
  assert.equal(Model.parseAge('0'), 0)
  assert.equal(Model.parseAge('121'), 0)
  assert.equal(Model.parseAge('47'), 47)
  assert.equal(Model.lifeProgressPercent(45, 90), 50)
  assert.equal(Model.ageFromBirthYear(1979, 2026), 47)
  assert.equal(Model.ageFromBirthYear(2030, 2026), 0)
})
