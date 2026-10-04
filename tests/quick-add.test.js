const test = require('node:test')
const assert = require('node:assert')
const { loadQmlJs } = require('./load-qml-js.js')

const Model = loadQmlJs('Model.js')

// Tuesday 2026-10-06, 12:52 local.
const NOW = new Date(2026, 9, 6, 12, 52)
const parse = (text, lang = 'pt') => Model.parseQuickAdd(text, NOW, lang)
const when = (text, lang) => {
  const p = parse(text, lang)
  return p && [p.dateKey, p.allDay ? 'all day' : `${p.startTime}-${p.endTime}`]
}

test('parseQuickAdd: the placeholder examples in both languages', () => {
  assert.deepEqual(parse('call with Ana tomorrow 2pm for 45m', 'en'), {
    title: 'call with Ana', dateKey: '2026-10-07', endDateKey: '2026-10-07', allDay: false,
    startTime: '14:00', endTime: '14:45', durationMinutes: 45, meet: true
  })
  assert.deepEqual(parse('call com Ana amanhã 14h por 45min'), {
    title: 'call com Ana', dateKey: '2026-10-07', endDateKey: '2026-10-07', allDay: false,
    startTime: '14:00', endTime: '14:45', durationMinutes: 45, meet: true
  })
})

test('parseQuickAdd understands both languages whatever the UI language', () => {
  assert.deepEqual(when('Dentist tomorrow 3pm', 'pt'), ['2026-10-07', '15:00-16:00'])
  assert.deepEqual(when('Dentista amanhã às 15h', 'en'), ['2026-10-07', '15:00-16:00'])
})

test('parseQuickAdd: no time means all day, today by default', () => {
  assert.deepEqual(parse('Pagar a conta de luz'), {
    title: 'Pagar a conta de luz', dateKey: '2026-10-06', endDateKey: '2026-10-06', allDay: true,
    startTime: '', endTime: '', durationMinutes: 0, meet: false
  })
})

test('parseQuickAdd: today, tomorrow, the day after, with and without accents', () => {
  assert.deepEqual(when('x hoje'), ['2026-10-06', 'all day'])
  assert.deepEqual(when('x today', 'en'), ['2026-10-06', 'all day'])
  assert.deepEqual(when('x amanhã'), ['2026-10-07', 'all day'])
  assert.deepEqual(when('x amanha'), ['2026-10-07', 'all day'])
  assert.deepEqual(when('x AMANHÃ'), ['2026-10-07', 'all day'])
  assert.deepEqual(when('x depois de amanhã'), ['2026-10-08', 'all day'])
  assert.deepEqual(when('x day after tomorrow', 'en'), ['2026-10-08', 'all day'])
  assert.equal(parse('x depois de amanhã').title, 'x')
})

test('parseQuickAdd: weekdays, full and abbreviated, in both languages', () => {
  assert.deepEqual(when('x sexta'), ['2026-10-09', 'all day'])
  assert.deepEqual(when('x sexta-feira'), ['2026-10-09', 'all day'])
  assert.deepEqual(when('x na sex'), ['2026-10-09', 'all day'])
  assert.deepEqual(when('x sábado'), ['2026-10-10', 'all day'])
  assert.deepEqual(when('x sab'), ['2026-10-10', 'all day'])
  assert.deepEqual(when('x Friday', 'en'), ['2026-10-09', 'all day'])
  assert.deepEqual(when('x fri', 'en'), ['2026-10-09', 'all day'])
  assert.deepEqual(when('x on Thursday', 'en'), ['2026-10-08', 'all day'])
  assert.deepEqual(when('x na quarta'), ['2026-10-07', 'all day'])
})

test('parseQuickAdd: short weekdays that are also words need a preposition or a time', () => {
  for (const [text, lang] of [['Ter aula com Ana', 'pt'], ['Sex ed class', 'en'], ['Buy sun lamp', 'en'],
    ['Wed planning notes', 'en'], ['Sat exam results', 'en'], ['Dom Casmurro clube do livro', 'pt']]) {
    assert.deepEqual([parse(text, lang).title, parse(text, lang).dateKey], [text, '2026-10-06'], text)
  }
  assert.deepEqual(parse('Preciso ter 2h de estudo').allDay, true)
  assert.match(parse('Preciso ter 2h de estudo').title, /^Preciso ter /)
})

test('parseQuickAdd: an ambiguous short weekday counts after on/next/na/até or before a time', () => {
  assert.deepEqual(when('Aula na ter'), ['2026-10-06', 'all day'])
  assert.deepEqual(when('Prova até sex'), ['2026-10-09', 'all day'])
  assert.deepEqual(when('Missa no dom'), ['2026-10-11', 'all day'])
  assert.deepEqual(when('x próximo sab'), ['2026-10-10', 'all day'])
  assert.deepEqual(when('x sex que vem'), ['2026-10-09', 'all day'])
  assert.deepEqual(when('picnic on sun', 'en'), ['2026-10-11', 'all day'])
  assert.deepEqual(when('review next wed', 'en'), ['2026-10-07', 'all day'])
  assert.deepEqual(when('Aula ter 14h'), ['2026-10-06', '14:00-15:00'])
  assert.deepEqual(when('Dentista sex às 15'), ['2026-10-09', '15:00-16:00'])
  assert.deepEqual(when('brunch sat 10am', 'en'), ['2026-10-10', '10:00-11:00'])
  assert.deepEqual(when('sync wed 9:30-10:15', 'en'), ['2026-10-07', '09:30-10:15'])
  assert.equal(parse('Ter aula com Ana na ter').title, 'Ter aula com Ana')
  assert.equal(parse('Sex ed class sat 10am', 'en').title, 'Sex ed class')
})

test('parseQuickAdd: a weekday already past this week is next week; today is today', () => {
  assert.deepEqual(when('x segunda'), ['2026-10-12', 'all day'])
  assert.deepEqual(when('x monday', 'en'), ['2026-10-12', 'all day'])
  assert.deepEqual(when('x terça'), ['2026-10-06', 'all day'])
})

test('parseQuickAdd: next / próxima / que vem skip today', () => {
  assert.deepEqual(when('x next tuesday', 'en'), ['2026-10-13', 'all day'])
  assert.deepEqual(when('x próxima terça'), ['2026-10-13', 'all day'])
  assert.deepEqual(when('x terça que vem'), ['2026-10-13', 'all day'])
  assert.deepEqual(when('x next friday', 'en'), ['2026-10-09', 'all day'])
  assert.deepEqual(when('x na próxima sexta'), ['2026-10-09', 'all day'])
  assert.equal(parse('Reunião na próxima sexta').title, 'Reunião')
})

test('parseQuickAdd: "dia 12" and "the 12th", rolling to next month once past', () => {
  assert.deepEqual(when('x dia 12'), ['2026-10-12', 'all day'])
  assert.deepEqual(when('x no dia 12'), ['2026-10-12', 'all day'])
  assert.deepEqual(when('x dia 2'), ['2026-11-02', 'all day'])
  assert.deepEqual(when('x dia 6'), ['2026-10-06', 'all day'])
  assert.deepEqual(when('x on the 12th', 'en'), ['2026-10-12', 'all day'])
  assert.deepEqual(when('x the 3rd', 'en'), ['2026-11-03', 'all day'])
  assert.deepEqual(when('x 21st', 'en'), ['2026-10-21', 'all day'])
})

test('parseQuickAdd: a day the next month lacks rolls to the first month that has it', () => {
  const lateJan = new Date(2027, 0, 31, 10, 0)
  assert.equal(Model.parseQuickAdd('x dia 30', lateJan, 'pt').dateKey, '2027-03-30')
  assert.equal(Model.parseQuickAdd('x dia 31', NOW, 'pt').dateKey, '2026-10-31')
  assert.equal(Model.parseQuickAdd('x dia 40', NOW, 'pt').title, 'x dia 40')
})

test('parseQuickAdd: d/m in Portuguese, m/d in English, next year once past', () => {
  assert.deepEqual(when('x 12/10', 'pt'), ['2026-10-12', 'all day'])
  assert.deepEqual(when('x 12/10', 'en'), ['2026-12-10', 'all day'])
  assert.deepEqual(when('x 1/3', 'pt'), ['2027-03-01', 'all day'])
  assert.deepEqual(when('x 5/10/2027', 'pt'), ['2027-10-05', 'all day'])
  assert.deepEqual(when('x 5/10/27', 'pt'), ['2027-10-05', 'all day'])
})

test('parseQuickAdd: an impossible numeric date is left in the title', () => {
  assert.deepEqual(parse('x 31/02', 'pt').title, 'x 31/02')
  assert.equal(parse('x 13/13', 'en').dateKey, '2026-10-06')
})

test('parseQuickAdd: ISO dates are taken as written, even in the past', () => {
  assert.deepEqual(when('review 2026-10-20 9am', 'en'), ['2026-10-20', '09:00-10:00'])
  assert.deepEqual(when('review 2025-01-02'), ['2025-01-02', 'all day'])
})

test('parseQuickAdd: month names in both languages', () => {
  assert.deepEqual(when('Viagem 25 de dezembro'), ['2026-12-25', 'all day'])
  assert.deepEqual(when('Viagem 3 de março'), ['2027-03-03', 'all day'])
  assert.deepEqual(when('Viagem 12 de out'), ['2026-10-12', 'all day'])
  assert.deepEqual(when('Trip Oct 12th', 'en'), ['2026-10-12', 'all day'])
  assert.deepEqual(when('Trip 12 October', 'en'), ['2026-10-12', 'all day'])
  assert.deepEqual(when('Trip December 1, 2027', 'en'), ['2027-12-01', 'all day'])
})

test('parseQuickAdd: Portuguese month abbreviations that are English words need "de"', () => {
  assert.equal(parse('Take 3 out of 4', 'en').title, 'Take 3 out of 4')
  assert.equal(parse('Take 3 out of 4', 'en').dateKey, '2026-10-06')
})

test('parseQuickAdd: 24-hour times', () => {
  assert.deepEqual(when('x 14h'), ['2026-10-06', '14:00-15:00'])
  assert.deepEqual(when('x 14:30'), ['2026-10-06', '14:30-15:30'])
  assert.deepEqual(when('x 14h30'), ['2026-10-06', '14:30-15:30'])
  assert.deepEqual(when('x às 9h'), ['2026-10-06', '09:00-10:00'])
  assert.deepEqual(when('x as 15'), ['2026-10-06', '15:00-16:00'])
  assert.deepEqual(when('x a partir das 19h'), ['2026-10-06', '19:00-20:00'])
})

test('parseQuickAdd: 12-hour times', () => {
  assert.deepEqual(when('x 2pm', 'en'), ['2026-10-06', '14:00-15:00'])
  assert.deepEqual(when('x 2:30pm', 'en'), ['2026-10-06', '14:30-15:30'])
  assert.deepEqual(when('x 2:30 PM', 'en'), ['2026-10-06', '14:30-15:30'])
  assert.deepEqual(when('x 9am', 'en'), ['2026-10-06', '09:00-10:00'])
  assert.deepEqual(when('x 12am', 'en'), ['2026-10-06', '00:00-01:00'])
  assert.deepEqual(when('x 12pm', 'en'), ['2026-10-06', '12:00-13:00'])
  assert.deepEqual(when('x 7 p.m.', 'en'), ['2026-10-06', '19:00-20:00'])
})

test('parseQuickAdd: a bare hour after at/às reads 1-7 as the afternoon', () => {
  assert.deepEqual(when('call at 3', 'en'), ['2026-10-06', '15:00-16:00'])
  assert.deepEqual(when('call às 3'), ['2026-10-06', '15:00-16:00'])
  assert.deepEqual(when('call at 8', 'en'), ['2026-10-06', '08:00-09:00'])
  assert.deepEqual(when('call at 11', 'en'), ['2026-10-06', '11:00-12:00'])
})

test('parseQuickAdd: noon and midnight in both languages', () => {
  assert.deepEqual(when('Almoço amanhã meio-dia'), ['2026-10-07', '12:00-13:00'])
  assert.deepEqual(when('Almoço ao meio dia'), ['2026-10-06', '12:00-13:00'])
  assert.deepEqual(when('Lunch at noon', 'en'), ['2026-10-06', '12:00-13:00'])
  assert.deepEqual(when('Deploy midnight', 'en'), ['2026-10-06', '00:00-01:00'])
  assert.deepEqual(when('Deploy à meia-noite'), ['2026-10-06', '00:00-01:00'])
})

test('parseQuickAdd: impossible times are left alone', () => {
  assert.equal(parse('x 25h').allDay, true)
  assert.equal(parse('x 25h').title, 'x 25h')
  assert.equal(parse('x 13pm', 'en').allDay, true)
  assert.equal(parse('x 10:75').allDay, true)
})

test('parseQuickAdd: durations', () => {
  const minutes = (text, lang) => parse(text, lang).durationMinutes
  assert.equal(minutes('x 14h por 45min'), 45)
  assert.equal(minutes('x 14h 45 min'), 45)
  assert.equal(minutes('x 14h 45m'), 45)
  assert.equal(minutes('x 2pm for 1h', 'en'), 60)
  assert.equal(minutes('x 14h por 1h30'), 90)
  assert.equal(minutes('x 14h 1h30'), 90)
  assert.equal(minutes('x 2pm 1.5h', 'en'), 90)
  assert.equal(minutes('x 14h 1,5h'), 90)
  assert.equal(minutes('x 14h por 1 hora'), 60)
  assert.equal(minutes('x 14h por uma hora'), 60)
  assert.equal(minutes('x 14h meia hora'), 30)
  assert.equal(minutes('x 2pm for 2 hours', 'en'), 120)
  assert.equal(minutes('x 14h'), 60)
})

test('parseQuickAdd: a bare short hour phrase is a length, a long one a time', () => {
  assert.deepEqual(when('call 1h30 14h'), ['2026-10-06', '14:00-15:30'])
  assert.deepEqual(when('call 9h'), ['2026-10-06', '09:00-10:00'])
})

test('parseQuickAdd: time ranges set the end', () => {
  assert.deepEqual(when('standup 9:30-9:45'), ['2026-10-06', '09:30-09:45'])
  assert.deepEqual(when('revisão das 14h às 15h30'), ['2026-10-06', '14:00-15:30'])
  assert.deepEqual(when('sync 2-3pm', 'en'), ['2026-10-06', '14:00-15:00'])
  assert.deepEqual(when('sync 11-1pm', 'en'), ['2026-10-06', '11:00-13:00'])
  assert.deepEqual(when('sync 10am to 11:30am', 'en'), ['2026-10-06', '10:00-11:30'])
  assert.equal(parse('revisão das 14h às 15h30').durationMinutes, 90)
})

test('parseQuickAdd: an event running past midnight ends the next day', () => {
  const late = parse('show 23:30')
  assert.deepEqual([late.endDateKey, late.endTime, late.durationMinutes], ['2026-10-07', '00:30', 60])
  const toMidnight = parse('show 23h por 1h')
  assert.deepEqual([toMidnight.endDateKey, toMidnight.endTime], ['2026-10-06', '00:00'])
  const overnight = parse('plantão 22h-6h')
  assert.deepEqual([overnight.endDateKey, overnight.endTime, overnight.durationMinutes], ['2026-10-07', '06:00', 480])
})

test('parseQuickAdd: meeting keywords ask for a video link and stay in the title', () => {
  for (const text of ['meet Ana 14h', 'call Bob', 'video review', 'zoom com time', 'videochamada com cliente', 'chamada rápida', 'Google Meet sync']) {
    assert.equal(parse(text).meet, true, text)
  }
  assert.equal(parse('call Bob').title, 'call Bob')
  assert.equal(parse('Meeting notes').meet, false)
  assert.equal(parse('Recall vendor').meet, false)
})

test('parseQuickAdd: "all day" forces an all-day event', () => {
  assert.deepEqual(when('Offsite all day friday', 'en'), ['2026-10-09', 'all day'])
  assert.deepEqual(when('Feriado o dia todo amanhã'), ['2026-10-07', 'all day'])
  assert.equal(parse('Feriado o dia todo amanhã').title, 'Feriado')
})

test('parseQuickAdd: titles keep the remaining words, punctuation and case', () => {
  assert.equal(parse('Dentista na sexta às 15h').title, 'Dentista')
  assert.equal(parse('Reunião com João dia 12 às 10h').title, 'Reunião com João')
  assert.equal(parse("Ana's party, saturday 8pm", 'en').title, "Ana's party")
  assert.equal(parse('Relatório até dia 5').title, 'Relatório')
  assert.equal(parse('Lunch next monday at noon', 'en').title, 'Lunch')
  assert.equal(parse('amanhã 15h: Revisão do contrato').title, 'Revisão do contrato')
  assert.equal(parse('Check in tomorrow', 'en').title, 'Check in')
  assert.equal(parse('Café da manhã amanhã 8h').title, 'Café da manhã')
  assert.equal(parse('Trip December 1, 2027 7 p.m.', 'en').title, 'Trip')
  assert.equal(parse('Call Ana, Bob tomorrow!', 'en').title, 'Call Ana, Bob')
})

test('parseQuickAdd: empty, garbage or title-less input gives null', () => {
  assert.equal(parse(''), null)
  assert.equal(parse('   '), null)
  assert.equal(parse(null), null)
  assert.equal(parse('!!! ...'), null)
  assert.equal(parse('amanhã 14h'), null)
  assert.equal(parse('tomorrow at 3 for 1h', 'en'), null)
})

test('parseQuickAdd accepts now as milliseconds', () => {
  assert.equal(Model.parseQuickAdd('x amanhã', NOW.getTime(), 'pt').dateKey, '2026-10-07')
})

test('parseQuickAdd: dates cross month and year ends by calendar day', () => {
  const nye = new Date(2026, 11, 31, 20, 0)
  assert.equal(Model.parseQuickAdd('x tomorrow', nye, 'en').dateKey, '2027-01-01')
  assert.equal(Model.parseQuickAdd('x friday', nye, 'en').dateKey, '2027-01-01')
  assert.equal(Model.parseQuickAdd('x dia 5', nye, 'pt').dateKey, '2027-01-05')
})

test('quickAddForm turns a parse into the event form', () => {
  const form = Model.quickAddForm(parse('call com Ana amanhã 14h por 45min'), 'me@example.com')
  assert.equal(form.calendarId, 'me@example.com')
  assert.equal(form.title, 'call com Ana')
  assert.deepEqual([form.startDate, form.startTime, form.endDate, form.endTime],
    ['2026-10-07', '14:00', '2026-10-07', '14:45'])
  assert.equal(form.allDay, false)
  assert.equal(form.meet, true)
  assert.equal(form.eventId, '')
  assert.deepEqual(form.reminders, { useDefault: true, overrides: [] })
})

test('quickAddForm: all day and past midnight', () => {
  const allDay = Model.quickAddForm(parse('Feriado sexta'), 'me')
  assert.deepEqual([allDay.allDay, allDay.startDate, allDay.endDate, allDay.startTime], [true, '2026-10-09', '2026-10-09', ''])
  const late = Model.quickAddForm(parse('show 23:30'), 'me')
  assert.deepEqual([late.endDate, late.endTime], ['2026-10-07', '00:30'])
})

test('googleTemplateUrl: a timed event in local, unzoned time', () => {
  assert.equal(Model.googleTemplateUrl(parse('call com Ana amanhã 14h por 45min')),
    'https://calendar.google.com/calendar/render?action=TEMPLATE&text=call%20com%20Ana&dates=20261007T140000/20261007T144500')
})

test('googleTemplateUrl: an all-day event ends the day after, exclusively', () => {
  assert.equal(Model.googleTemplateUrl(parse('Feriado 31 de dezembro')),
    'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Feriado&dates=20261231/20270101')
})

test('googleTemplateUrl: past midnight ends on the next date', () => {
  assert.match(Model.googleTemplateUrl(parse('show 23:30')), /dates=20261006T233000\/20261007T003000$/)
})

test('googleTemplateUrl encodes the title so safeUrl accepts it', () => {
  const url = Model.googleTemplateUrl(parse("Ana's \"party\" & <drinks> #1 (maybe) amanhã", 'pt'))
  assert.match(url, /text=Ana%27s%20%22party%22%20%26%20%3Cdrinks%3E%20%231%20%28maybe%29&/)
  assert.equal(Model.safeUrl(url), url)
})

test('googleTemplateUrl is empty without a parse', () => {
  assert.equal(Model.googleTemplateUrl(null), '')
})
