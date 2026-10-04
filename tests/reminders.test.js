const test = require('node:test')
const assert = require('node:assert')
const { loadQmlJs } = require('./load-qml-js.js')
const { localIso, localMs } = require('./local-time.js')

const Model = loadQmlJs('Model.js')

const MIN = 60 * 1000
const START = localMs(2026, 9, 6, 13, 0)
const START_ISO = localIso(2026, 9, 6, 13, 0)
const event = (extra = {}) => ({
  id: 'easy', title: 'Design review', allDay: false, dateKey: '2026-10-06',
  start: START_ISO, end: localIso(2026, 9, 6, 13, 45), ...extra
})

test('reminderMinutesFor uses the event reminders, deduplicated and ascending', () => {
  assert.deepEqual(Model.reminderMinutesFor(event({ reminders: [30, 10, 30, 1440] })), [10, 30, 1440])
  assert.deepEqual(Model.reminderMinutesFor(event({ reminders: [0] })), [0])
})

test('reminderMinutesFor falls back to 10 minutes for a meeting with no reminders', () => {
  const withLink = event({ meetingUrl: 'https://meet.google.com/x' })
  assert.deepEqual(Model.reminderMinutesFor(withLink), [10])
  assert.deepEqual(Model.reminderMinutesFor({ ...withLink, reminders: [] }), [10])
  assert.deepEqual(Model.reminderMinutesFor(withLink, 5), [5])
})

test('reminderMinutesFor gives nothing without reminders or a usable link', () => {
  assert.deepEqual(Model.reminderMinutesFor(event()), [])
  assert.deepEqual(Model.reminderMinutesFor(event({ meetingUrl: 'http://insecure' })), [])
  assert.deepEqual(Model.reminderMinutesFor(null), [])
})

test('reminderMinutesFor: all-day events only remind when the calendar says so', () => {
  const allDay = { id: 'h', allDay: true, start: '2026-10-07', meetingUrl: 'https://meet.google.com/x' }
  assert.deepEqual(Model.reminderMinutesFor(allDay), [])
  assert.deepEqual(Model.reminderMinutesFor({ ...allDay, reminders: [900] }), [900])
})

test('reminderMinutesFor ignores junk and the form-shaped reminders object', () => {
  assert.deepEqual(Model.reminderMinutesFor(event({ reminders: [-5, 'x', null, '', true, '15', 2.6] })), [3, 15])
  assert.deepEqual(Model.reminderMinutesFor(event({ reminders: { useDefault: true, overrides: [] } })), [])
})

test('reminderKey includes the start, so a moved event reminds again', () => {
  assert.equal(Model.reminderKey(event(), 10), `easy|${START_ISO}|10`)
  assert.notEqual(Model.reminderKey(event(), 10), Model.reminderKey(event({ start: localIso(2026, 9, 6, 14, 0) }), 10))
})

test('dueReminders fires at the reminder time and not before', () => {
  const events = [event({ reminders: [10] })]
  assert.deepEqual(Model.dueReminders(events, START - 10 * MIN - 1, {}), [])
  const due = Model.dueReminders(events, START - 10 * MIN, {})
  assert.equal(due.length, 1)
  assert.deepEqual(
    { key: due[0].key, keys: due[0].keys, id: due[0].event.id, minutes: due[0].minutes, fireAtMs: due[0].fireAtMs, startMs: due[0].startMs },
    { key: `easy|${START_ISO}|10`, keys: [`easy|${START_ISO}|10`], id: 'easy', minutes: 10, fireAtMs: START - 10 * MIN, startMs: START })
})

test('dueReminders skips fired keys, as a map or a list', () => {
  const events = [event({ reminders: [10] })]
  const key = Model.reminderKey(events[0], 10)
  assert.deepEqual(Model.dueReminders(events, START - 5 * MIN, { [key]: START }), [])
  assert.deepEqual(Model.dueReminders(events, START - 5 * MIN, [key]), [])
})

test('dueReminders fires late after a sleep, but never once the event has started', () => {
  const events = [event({ reminders: [10] })]
  assert.equal(Model.dueReminders(events, START - MIN, {}).length, 1)
  assert.deepEqual(Model.dueReminders(events, START, {}), [])
  assert.deepEqual(Model.dueReminders(events, START + 5 * MIN, {}), [])
})

test('dueReminders: several passed reminders of one event make one notification', () => {
  const events = [event({ reminders: [1440, 30, 10] })]
  const due = Model.dueReminders(events, START - 5 * MIN, {})
  assert.equal(due.length, 1)
  assert.equal(due[0].minutes, 10)
  assert.deepEqual(due[0].keys.sort(), [1440, 30, 10].map(m => Model.reminderKey(events[0], m)).sort())
})

test('dueReminders never floods a backlog older than notBeforeMs', () => {
  const firstRun = START - 5 * MIN
  const events = [
    event({ reminders: [10] }),
    event({ id: 'tomorrow', start: localIso(2026, 9, 7, 9, 0), reminders: [1440] }),
    event({ id: 'soon', start: localIso(2026, 9, 6, 13, 20), reminders: [10] })
  ]
  assert.deepEqual(Model.dueReminders(events, firstRun, {}, { notBeforeMs: firstRun }), [])
  const later = Model.dueReminders(events, START + 10 * MIN, {}, { notBeforeMs: firstRun })
  assert.deepEqual(later.map(d => d.event.id), ['soon'])
})

test('dueReminders uses the meeting fallback, configurable', () => {
  const events = [event({ meetingUrl: 'https://meet.google.com/x' })]
  assert.equal(Model.dueReminders(events, START - 10 * MIN, {}).length, 1)
  assert.equal(Model.dueReminders(events, START - 10 * MIN, {}, { fallbackMinutes: 5 }).length, 0)
})

test('dueReminders counts a multi-day row once and sorts by fire time', () => {
  const later = event({ id: 'later', start: localIso(2026, 9, 6, 13, 30), reminders: [45] })
  const row = event({ reminders: [10] })
  const due = Model.dueReminders([later, row, { ...row, dateKey: '2026-10-07' }], START - 5 * MIN, {})
  assert.deepEqual(due.map(d => d.event.id), ['later', 'easy'])
})

test('dueReminders skips declined invitations and finished tasks', () => {
  const events = [
    event({ reminders: [10], responseStatus: 'declined' }),
    event({ id: 't', title: '✓ Done', reminders: [10] })
  ]
  assert.deepEqual(Model.dueReminders(events, START - 5 * MIN, {}), [])
})

test('dueReminders: an all-day reminder counts from local midnight', () => {
  const allDay = { id: 'h', title: 'Holiday', allDay: true, dateKey: '2026-10-07', start: '2026-10-07', reminders: [900] }
  const fireAt = localMs(2026, 9, 7) - 900 * MIN
  assert.deepEqual(Model.dueReminders([allDay], fireAt - 1, {}), [])
  assert.equal(Model.dueReminders([allDay], fireAt, {})[0].startMs, localMs(2026, 9, 7))
})

test('markFired records every key of each notification with its start', () => {
  const events = [event({ reminders: [30, 10] })]
  const due = Model.dueReminders(events, START - 5 * MIN, {})
  const before = { old: 1 }
  const fired = Model.markFired(before, due)
  assert.deepEqual(fired, { old: 1, [Model.reminderKey(events[0], 10)]: START, [Model.reminderKey(events[0], 30)]: START })
  assert.deepEqual(before, { old: 1 })
  assert.deepEqual(Model.dueReminders(events, START - 4 * MIN, fired), [])
})

test('pruneFired drops keys a day past their start and junk, without mutating', () => {
  const now = START + 2 * 24 * 60 * MIN
  const fired = { old: START, recent: now - 60 * MIN, future: now + MIN, junk: 'x' }
  assert.deepEqual(Model.pruneFired(fired, now), { recent: now - 60 * MIN, future: now + MIN })
  assert.equal(fired.old, START)
  assert.deepEqual(Model.pruneFired(null, now), {})
})

test('reminderLabel picks the largest whole unit, in both languages', () => {
  assert.equal(Model.reminderLabel(0, 'en'), 'At start time')
  assert.equal(Model.reminderLabel(1, 'en'), '1 minute before')
  assert.equal(Model.reminderLabel(10, 'pt'), '10 minutos antes')
  assert.equal(Model.reminderLabel(60, 'pt'), '1 hora antes')
  assert.equal(Model.reminderLabel(90, 'en'), '90 minutes before')
  assert.equal(Model.reminderLabel(120, 'en'), '2 hours before')
  assert.equal(Model.reminderLabel(1440, 'pt'), '1 dia antes')
  assert.equal(Model.reminderLabel(2880, 'en'), '2 days before')
  assert.equal(Model.reminderLabel(10080, 'pt'), '1 semana antes')
})

test('reminderSummary is the inspector line', () => {
  assert.equal(Model.reminderSummary(event({ reminders: [10, 1440] }), 'en'), 'Reminder: 10 minutes before, 1 day before')
  assert.equal(Model.reminderSummary(event({ meetingUrl: 'https://meet.google.com/x' }), 'pt'), 'Notificação: 10 minutos antes')
  assert.equal(Model.reminderSummary(event(), 'pt'), 'Sem notificação')
})

test('reminderEventKey is one key per occurrence', () => {
  assert.equal(Model.reminderEventKey(event()), 'easy|' + START_ISO)
  assert.equal(Model.reminderEventKey(null), '|')
})

test('canSnoozeReminder holds for 15 minutes after the reminder', () => {
  const recent = { [Model.reminderEventKey(event())]: START - 10 * MIN }
  assert.equal(Model.canSnoozeReminder(recent, event(), START - 10 * MIN), true)
  assert.equal(Model.canSnoozeReminder(recent, event(), START + 4 * MIN), true)
  assert.equal(Model.canSnoozeReminder(recent, event(), START + 5 * MIN), false)
  assert.equal(Model.canSnoozeReminder(recent, event({ id: 'other' }), START), false)
  assert.equal(Model.canSnoozeReminder(null, event(), START), false)
})

test('pruneRecentReminders keeps only what can still be snoozed, without mutating', () => {
  const recent = { fresh: String(START - MIN), stale: START - 15 * MIN }
  assert.deepEqual(Model.pruneRecentReminders(recent, START), { fresh: START - MIN })
  assert.equal(recent.stale, START - 15 * MIN)
  assert.deepEqual(Model.pruneRecentReminders(undefined, START), {})
})

test('slimReminderEvent keeps what a snoozed reminder needs', () => {
  const slim = Model.slimReminderEvent(event({ description: 'long', reminders: [10], meetingUrl: 'https://meet.google.com/x' }))
  assert.deepEqual(Object.keys(slim).sort(),
    ['allDay', 'dateKey', 'end', 'eventUrl', 'id', 'location', 'meetingUrl', 'start', 'title'])
  assert.equal(slim.allDay, false)
  assert.equal(slim.meetingUrl, 'https://meet.google.com/x')
})

test('reminderHeadline counts down, then says it is starting', () => {
  assert.equal(Model.reminderHeadline(event(), START - 10 * MIN, 'en'), 'Design review in 10 min')
  assert.equal(Model.reminderHeadline(event(), START - 9.5 * MIN, 'pt'), 'Design review em 10 min')
  assert.equal(Model.reminderHeadline(event(), START, 'en'), 'Design review is starting')
  assert.equal(Model.reminderHeadline(event({ title: '  ' }), START - 90 * MIN, 'pt'), '(Sem título) em 1 h 30 min')
  assert.equal(Model.reminderHeadline({ id: 'h', allDay: true, start: '2026-10-07', title: 'Holiday' }, START, 'en'), 'Holiday')
  assert.equal(Model.reminderHeadline(event({ title: 'x'.repeat(100) }), START, 'en').length, 'x'.repeat(80).length + ' is starting'.length)
})

const clock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const weekday = (ms) => ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(ms).getDay()]

test('reminderBody: times and where, with the day when it is not today', () => {
  const meet = event({ meetingUrl: 'https://meet.google.com/x', location: 'Room 4' })
  assert.equal(Model.reminderBody(meet, START - 10 * MIN, 'en', clock, weekday), '13:00–13:45 · Google Meet')
  assert.equal(Model.reminderBody(event({ location: ' Room 4 ' }), START - 10 * MIN, 'en', clock, weekday), '13:00–13:45 · Room 4')
  assert.equal(Model.reminderBody(event({ end: START_ISO }), START - 10 * MIN, 'en', clock, weekday), '13:00')
  assert.equal(Model.reminderBody(event(), localMs(2026, 9, 5, 20, 0), 'pt', clock, weekday), 'Amanhã · 13:00–13:45')
  assert.equal(Model.reminderBody(event(), localMs(2026, 9, 4, 20, 0), 'en', clock, weekday), 'Tuesday · 13:00–13:45')
})

test('reminderBody: an all-day event is its day', () => {
  const holiday = { id: 'h', allDay: true, dateKey: '2026-10-07', start: '2026-10-07', end: '2026-10-08' }
  assert.equal(Model.reminderBody(holiday, localMs(2026, 9, 6, 15, 0), 'en', clock, weekday), 'Tomorrow · all day')
  assert.equal(Model.reminderBody(holiday, localMs(2026, 9, 6, 15, 0), 'pt', clock, weekday), 'Amanhã · dia todo')
})

test('notificationArg keeps option-looking text as text', () => {
  assert.equal(Model.notificationArg('-g evil'), '⁠-g evil')
  assert.equal(Model.notificationArg('--exec'), '⁠--exec')
  assert.equal(Model.notificationArg('Standup in 5 min'), 'Standup in 5 min')
  assert.equal(Model.notificationArg(''), '')
})
