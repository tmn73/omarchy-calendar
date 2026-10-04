const test = require('node:test')
const assert = require('node:assert')
const { loadQmlJs } = require('./load-qml-js.js')

const Model = loadQmlJs('Model.js')
const QuickAdd = loadQmlJs('QuickAddParser.js')

// Tuesday 2026-10-06, 12:52 local.
const NOW = new Date(2026, 9, 6, 12, 52)
const parse = (text, lang = 'pt') => QuickAdd.parseQuickAdd(text, NOW, lang)
const when = (text, lang) => {
  const p = parse(text, lang)
  return p && [p.dateKey, p.allDay ? 'all day' : `${p.startTime}-${p.endTime}`]
}

test('parseQuickAdd: the placeholder examples in both languages', () => {
  assert.deepEqual(parse('call with Ana tomorrow 2pm for 45m', 'en'), {
    title: 'call with Ana', dateKey: '2026-10-07', endDateKey: '2026-10-07', allDay: false,
    startTime: '14:00', endTime: '14:45', durationMinutes: 45, meet: true, repeat: 'none', guests: []
  })
  assert.deepEqual(parse('call com Ana amanhã 14h por 45min'), {
    title: 'call com Ana', dateKey: '2026-10-07', endDateKey: '2026-10-07', allDay: false,
    startTime: '14:00', endTime: '14:45', durationMinutes: 45, meet: true, repeat: 'none', guests: []
  })
})

test('parseQuickAdd understands both languages whatever the UI language', () => {
  assert.deepEqual(when('Dentist tomorrow 3pm', 'pt'), ['2026-10-07', '15:00-16:00'])
  assert.deepEqual(when('Dentista amanhã às 15h', 'en'), ['2026-10-07', '15:00-16:00'])
})

test('parseQuickAdd: no day and no time means the next half hour, for half an hour', () => {
  assert.deepEqual(parse('Pagar a conta de luz'), {
    title: 'Pagar a conta de luz', dateKey: '2026-10-06', endDateKey: '2026-10-06', allDay: false,
    startTime: '13:00', endTime: '13:30', durationMinutes: 30, meet: false, repeat: 'none', guests: []
  })
})

test('parseQuickAdd: a day with no time is all day', () => {
  assert.deepEqual(parse('Pagar a conta de luz amanhã'), {
    title: 'Pagar a conta de luz', dateKey: '2026-10-07', endDateKey: '2026-10-07', allDay: true,
    startTime: '', endTime: '', durationMinutes: 0, meet: false, repeat: 'none', guests: []
  })
  assert.deepEqual(when('x hoje'), ['2026-10-06', 'all day'])
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
  assert.deepEqual(when('Preciso ter 2h de estudo'), ['2026-10-06', '13:00-15:00'])
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
  assert.equal(QuickAdd.parseQuickAdd('x dia 30', lateJan, 'pt').dateKey, '2027-03-30')
  assert.equal(QuickAdd.parseQuickAdd('x dia 31', NOW, 'pt').dateKey, '2026-10-31')
  assert.equal(QuickAdd.parseQuickAdd('x dia 40', NOW, 'pt').title, 'x dia 40')
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
  assert.deepEqual(when('x 25h'), ['2026-10-06', '13:00-13:30'])
  assert.equal(parse('x 25h').title, 'x 25h')
  assert.deepEqual(when('x 13pm', 'en'), ['2026-10-06', '13:00-13:30'])
  assert.deepEqual(when('x 10:75'), ['2026-10-06', '13:00-13:30'])
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
  assert.equal(QuickAdd.parseQuickAdd('x amanhã', NOW.getTime(), 'pt').dateKey, '2026-10-07')
})

test('parseQuickAdd: dates cross month and year ends by calendar day', () => {
  const nye = new Date(2026, 11, 31, 20, 0)
  assert.equal(QuickAdd.parseQuickAdd('x tomorrow', nye, 'en').dateKey, '2027-01-01')
  assert.equal(QuickAdd.parseQuickAdd('x friday', nye, 'en').dateKey, '2027-01-01')
  assert.equal(QuickAdd.parseQuickAdd('x dia 5', nye, 'pt').dateKey, '2027-01-05')
})

test('quickAddForm turns a parse into the event form', () => {
  const form = QuickAdd.quickAddForm(parse('call com Ana amanhã 14h por 45min'), 'me@example.com')
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
  const allDay = QuickAdd.quickAddForm(parse('Feriado sexta'), 'me')
  assert.deepEqual([allDay.allDay, allDay.startDate, allDay.endDate, allDay.startTime], [true, '2026-10-09', '2026-10-09', ''])
  const late = QuickAdd.quickAddForm(parse('show 23:30'), 'me')
  assert.deepEqual([late.endDate, late.endTime], ['2026-10-07', '00:30'])
})

test('googleTemplateUrl: a timed event in local, unzoned time', () => {
  assert.equal(QuickAdd.googleTemplateUrl(parse('call com Ana amanhã 14h por 45min')),
    'https://calendar.google.com/calendar/render?action=TEMPLATE&text=call%20com%20Ana&dates=20261007T140000/20261007T144500')
})

test('googleTemplateUrl: an all-day event ends the day after, exclusively', () => {
  assert.equal(QuickAdd.googleTemplateUrl(parse('Feriado 31 de dezembro')),
    'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Feriado&dates=20261231/20270101')
})

test('googleTemplateUrl: past midnight ends on the next date', () => {
  assert.match(QuickAdd.googleTemplateUrl(parse('show 23:30')), /dates=20261006T233000\/20261007T003000$/)
})

test('googleTemplateUrl encodes the title so safeUrl accepts it', () => {
  const url = QuickAdd.googleTemplateUrl(parse("Ana's \"party\" & <drinks> #1 (maybe) amanhã", 'pt'))
  assert.match(url, /text=Ana%27s%20%22party%22%20%26%20%3Cdrinks%3E%20%231%20%28maybe%29&/)
  assert.equal(Model.safeUrl(url), url)
})

test('googleTemplateUrl is empty without a parse', () => {
  assert.equal(QuickAdd.googleTemplateUrl(null), '')
})

const understood = (text, lang = 'en') =>
  QuickAdd.quickAddUnderstood(text, NOW, lang).map((f) => `${f.kind}:${f.text}`)

test('quickAddUnderstood lists the words read as something else than the title, in typed order', () => {
  assert.deepEqual(understood('call with Ana tomorrow 2pm for 45m'),
    ['meet:call', 'date:tomorrow', 'time:2pm', 'duration:for 45m'])
  assert.deepEqual(understood('call com Ana amanhã 14h por 45min', 'pt'),
    ['meet:call', 'date:amanhã', 'time:14h', 'duration:por 45min'])
})

test('quickAddUnderstood keeps a leading word with what it introduces', () => {
  assert.deepEqual(understood('Dentist next monday at 3pm'), ['date:next monday', 'time:at 3pm'])
})

test('quickAddUnderstood reads all day', () => {
  assert.deepEqual(understood('Offsite friday all day'), ['date:friday', 'allDay:all day'])
})

test('quickAddUnderstood is empty when only a title was typed, or nothing', () => {
  assert.deepEqual(understood('Lunch with Bea'), [])
  assert.deepEqual(understood('   '), [])
})

test('parseQuickAdd: "until" alone is an end time, from now to then', () => {
  // NOW is 12:52: the event starts at the quarter hour before.
  assert.deepEqual(when('Ikea until 3pm', 'en'), ['2026-10-06', '12:45-15:00'])
  assert.deepEqual(when('Ikea até às 15h', 'pt'), ['2026-10-06', '12:45-15:00'])
  assert.deepEqual(when('Ikea ate 15h', 'pt'), ['2026-10-06', '12:45-15:00'])
  assert.equal(parse('Ikea until 3pm', 'en').title, 'Ikea')
})

test('parseQuickAdd: "until" on another day, or already past, ends an hour-long event', () => {
  assert.deepEqual(when('Ikea tomorrow until 11am', 'en'), ['2026-10-07', '10:00-11:00'])
  assert.deepEqual(when('Ikea until 11 a.m.', 'en'), ['2026-10-06', '10:00-11:00'])
})

test('parseQuickAdd: a start and "until" stay a range', () => {
  assert.deepEqual(when('Ikea 10am until 11am', 'en'), ['2026-10-06', '10:00-11:00'])
})

test('parseQuickAdd: a range of bare hours is a time with from/das, or past 12', () => {
  assert.deepEqual(when('Ikea today from 9 to 13', 'en'), ['2026-10-06', '09:00-13:00'])
  assert.equal(parse('Ikea today from 9 to 13', 'en').title, 'Ikea')
  assert.deepEqual(when('Ikea 9-13', 'en'), ['2026-10-06', '09:00-13:00'])
  assert.deepEqual(when('Ikea das 9 às 13', 'pt'), ['2026-10-06', '09:00-13:00'])
  assert.deepEqual(when('Ikea from 2 to 4', 'en'), ['2026-10-06', '14:00-16:00'])
})

test('parseQuickAdd: a bare start with a clock end is a range', () => {
  assert.deepEqual(when('Ikea 9 to 13:00', 'en'), ['2026-10-06', '09:00-13:00'])
  assert.equal(parse('Ikea 9 to 13:00', 'en').title, 'Ikea')
})

test('parseQuickAdd: two small bare numbers stay in the title', () => {
  assert.deepEqual(when('Kids 2-3', 'en'), ['2026-10-06', '13:00-13:30'])
  assert.equal(parse('Kids 2-3', 'en').title, 'Kids 2-3')
})

test('quickAddUnderstood shows a bare range as one time', () => {
  assert.deepEqual(understood('Ikea today from 9 to 13'), ['date:today', 'time:from 9 to 13'])
})

const range = (text, lang) => {
  const p = parse(text, lang)
  return p && [p.dateKey, p.endDateKey, p.allDay ? 'all day' : `${p.startTime}-${p.endTime}`]
}

test('parseQuickAdd: "in" a number of minutes or hours starts that far from now', () => {
  assert.deepEqual(when('test in two minutes', 'en'), ['2026-10-06', '12:54-13:54'])
  assert.deepEqual(when('x in 2 minutes', 'en'), ['2026-10-06', '12:54-13:54'])
  assert.deepEqual(when('x in 20 min', 'en'), ['2026-10-06', '13:12-14:12'])
  assert.deepEqual(when('x in an hour', 'en'), ['2026-10-06', '13:52-14:52'])
  assert.deepEqual(when('x in half an hour', 'en'), ['2026-10-06', '13:22-14:22'])
  assert.deepEqual(when('x in 1h30', 'en'), ['2026-10-06', '14:22-15:22'])
  assert.deepEqual(when('x in an hour and a half', 'en'), ['2026-10-06', '14:22-15:22'])
  assert.deepEqual(when('x in twenty five minutes', 'en'), ['2026-10-06', '13:17-14:17'])
  assert.deepEqual(when('x daqui a 20 minutos'), ['2026-10-06', '13:12-14:12'])
  assert.deepEqual(when('x em meia hora'), ['2026-10-06', '13:22-14:22'])
  assert.deepEqual(when('x daqui a duas horas'), ['2026-10-06', '14:52-15:52'])
  assert.deepEqual(when('x daqui a vinte e cinco minutos'), ['2026-10-06', '13:17-14:17'])
  assert.equal(parse('test in two minutes', 'en').title, 'test')
})

test('parseQuickAdd: a relative start can cross midnight, take a length or an end', () => {
  assert.deepEqual(range('x in 12 hours', 'en'), ['2026-10-07', '2026-10-07', '00:52-01:52'])
  assert.deepEqual(when('x in 2 min for 15m', 'en'), ['2026-10-06', '12:54-13:09'])
  assert.deepEqual(when('x in 10 min until 5pm', 'en'), ['2026-10-06', '13:02-17:00'])
})

test('parseQuickAdd: now / agora start this minute', () => {
  assert.deepEqual(when('x now', 'en'), ['2026-10-06', '12:52-13:52'])
  assert.deepEqual(when('x agora por 30min'), ['2026-10-06', '12:52-13:22'])
})

test('parseQuickAdd: "in" days, weeks or months is a day', () => {
  assert.deepEqual(when('x in 3 days', 'en'), ['2026-10-09', 'all day'])
  assert.deepEqual(when('x in 3 days at 3pm', 'en'), ['2026-10-09', '15:00-16:00'])
  assert.deepEqual(when('x in a week', 'en'), ['2026-10-13', 'all day'])
  assert.deepEqual(when('x daqui a 2 semanas'), ['2026-10-20', 'all day'])
  assert.deepEqual(when('x em 2 meses'), ['2026-12-06', 'all day'])
})

test('parseQuickAdd: "in" with no length after it stays in the title', () => {
  assert.equal(parse('Meeting in room 5', 'en').title, 'Meeting in room 5')
})

test('parseQuickAdd: lengths written out in words', () => {
  assert.deepEqual(when('x tomorrow 3pm for two hours', 'en'), ['2026-10-07', '15:00-17:00'])
  assert.deepEqual(when('x amanhã 15h por duas horas'), ['2026-10-07', '15:00-17:00'])
  assert.deepEqual(when('x 3pm for forty-five minutes', 'en'), ['2026-10-06', '15:00-15:45'])
  assert.deepEqual(when('x 3pm for an hour and a half', 'en'), ['2026-10-06', '15:00-16:30'])
  assert.deepEqual(when('x 15h por uma hora e meia'), ['2026-10-06', '15:00-16:30'])
  assert.deepEqual(when('x 3pm for a quarter of an hour', 'en'), ['2026-10-06', '15:00-15:15'])
})

test('parseQuickAdd: a part of the day sets the time', () => {
  assert.deepEqual(when('Run tomorrow morning', 'en'), ['2026-10-07', '09:00-10:00'])
  assert.deepEqual(when('x friday afternoon', 'en'), ['2026-10-09', '14:00-15:00'])
  assert.deepEqual(when('Dinner tonight', 'en'), ['2026-10-06', '19:00-20:00'])
  assert.deepEqual(when('x in the afternoon', 'en'), ['2026-10-06', '14:00-15:00'])
  assert.deepEqual(when('x amanhã de manhã'), ['2026-10-07', '09:00-10:00'])
  assert.deepEqual(when('x sexta à tarde'), ['2026-10-09', '14:00-15:00'])
  assert.deepEqual(when('x amanhã a tarde'), ['2026-10-07', '14:00-15:00'])
  assert.deepEqual(when('x hoje à noite'), ['2026-10-06', '19:00-20:00'])
  assert.equal(parse('Run tomorrow morning', 'en').title, 'Run')
})

test('parseQuickAdd: a time said with a part of the day moves into it', () => {
  assert.deepEqual(when('x tonight at 9', 'en'), ['2026-10-06', '21:00-22:00'])
  assert.deepEqual(when('x tomorrow morning at 7', 'en'), ['2026-10-07', '07:00-08:00'])
  assert.deepEqual(when('x tomorrow morning at 10', 'en'), ['2026-10-07', '10:00-11:00'])
})

test('parseQuickAdd: a bare part-of-day word only counts right after a day', () => {
  assert.equal(parse('Morning run', 'en').title, 'Morning run')
  assert.deepEqual(when('Morning run tomorrow', 'en'), ['2026-10-07', 'all day'])
  assert.equal(parse('Morning run tomorrow', 'en').title, 'Morning run')
})

test('parseQuickAdd: times in words', () => {
  assert.deepEqual(when('x half past 3', 'en'), ['2026-10-06', '15:30-16:30'])
  assert.deepEqual(when('x quarter past 10', 'en'), ['2026-10-06', '10:15-11:15'])
  assert.deepEqual(when('x quarter to 4', 'en'), ['2026-10-06', '15:45-16:45'])
  assert.deepEqual(when('x at 3 o clock', 'en'), ['2026-10-06', '15:00-16:00'])
  assert.deepEqual(when("x three o'clock", 'en'), ['2026-10-06', '15:00-16:00'])
  assert.deepEqual(when('x at three', 'en'), ['2026-10-06', '15:00-16:00'])
  assert.deepEqual(when('x às duas'), ['2026-10-06', '14:00-15:00'])
  assert.deepEqual(when('x às 3 e meia'), ['2026-10-06', '15:30-16:30'])
  assert.deepEqual(when('x 15h e meia'), ['2026-10-06', '15:30-16:30'])
  assert.deepEqual(when('x 15h30min'), ['2026-10-06', '15:30-16:30'])
  assert.equal(parse('x at 3 o clock', 'en').title, 'x')
})

test('parseQuickAdd: between 2 and 4 is a range, two times with "and" are not', () => {
  assert.deepEqual(when('x between 2 and 4', 'en'), ['2026-10-06', '14:00-16:00'])
  assert.deepEqual(when('x entre 2 e 4'), ['2026-10-06', '14:00-16:00'])
  assert.deepEqual(when('x das 3 e meia às 5'), ['2026-10-06', '15:30-17:00'])
  assert.deepEqual(when('Call 2pm and 4pm', 'en'), ['2026-10-06', '14:00-15:00'])
})

test('parseQuickAdd: yesterday, typos of tomorrow, next week, this coming friday', () => {
  assert.deepEqual(when('x yesterday', 'en'), ['2026-10-05', 'all day'])
  assert.deepEqual(when('x ontem'), ['2026-10-05', 'all day'])
  assert.deepEqual(when('x tmrw', 'en'), ['2026-10-07', 'all day'])
  assert.deepEqual(when('x next week', 'en'), ['2026-10-12', 'all day'])
  assert.deepEqual(when('x semana que vem'), ['2026-10-12', 'all day'])
  assert.deepEqual(when('x this coming friday', 'en'), ['2026-10-09', 'all day'])
})

test('parseQuickAdd: two days joined by to / a / até / - span them', () => {
  assert.deepEqual(range('Trip friday to sunday', 'en'), ['2026-10-09', '2026-10-11', 'all day'])
  assert.deepEqual(range('Trip from friday until sunday', 'en'), ['2026-10-09', '2026-10-11', 'all day'])
  assert.deepEqual(range('Viagem de sexta a domingo'), ['2026-10-09', '2026-10-11', 'all day'])
  assert.deepEqual(range('Viagem sexta até domingo'), ['2026-10-09', '2026-10-11', 'all day'])
  assert.deepEqual(range('Viagem 12/10 - 14/10'), ['2026-10-12', '2026-10-14', 'all day'])
  assert.deepEqual(range('Trip dec 30 to jan 2', 'en'), ['2026-12-30', '2027-01-02', 'all day'])
  assert.equal(parse('Trip friday to sunday', 'en').title, 'Trip')
  assert.equal(parse('Viagem de sexta a domingo').title, 'Viagem')
})

test('parseQuickAdd: a weekday range that wraps ends the week after', () => {
  assert.deepEqual(range('Trip sunday to tuesday', 'en'), ['2026-10-11', '2026-10-13', 'all day'])
})

test('parseQuickAdd: a span of days in one month', () => {
  assert.deepEqual(range('Trip oct 12-14', 'en'), ['2026-10-12', '2026-10-14', 'all day'])
  assert.deepEqual(range('Trip 12-14 oct', 'en'), ['2026-10-12', '2026-10-14', 'all day'])
  assert.deepEqual(range('Trip Oct 12 to Oct 14', 'en'), ['2026-10-12', '2026-10-14', 'all day'])
  assert.deepEqual(range('Viagem 12 a 14 de outubro'), ['2026-10-12', '2026-10-14', 'all day'])
})

test('parseQuickAdd: "until" a day alone is that one day, "until" a time ends it', () => {
  assert.deepEqual(range('Renew passport until friday', 'en'), ['2026-10-09', '2026-10-09', 'all day'])
  assert.deepEqual(range('x friday until 5pm', 'en'), ['2026-10-09', '2026-10-09', '16:00-17:00'])
  assert.deepEqual(range('x sexta a partir das 15h'), ['2026-10-09', '2026-10-09', '15:00-16:00'])
})

test('parseQuickAdd: a length in days spans them, timed when a time is given', () => {
  assert.deepEqual(range('Trip friday for 3 days', 'en'), ['2026-10-09', '2026-10-11', 'all day'])
  assert.deepEqual(range('Trip for 3 days', 'en'), ['2026-10-06', '2026-10-08', 'all day'])
  assert.deepEqual(range('Conference friday 9am for 2 days', 'en'), ['2026-10-09', '2026-10-11', '09:00-09:00'])
  assert.deepEqual(range('Conf friday to sunday 9am-5pm', 'en'), ['2026-10-09', '2026-10-11', '09:00-17:00'])
})

test('parseQuickAdd: the weekend is the coming Saturday and Sunday', () => {
  assert.deepEqual(range('Hiking this weekend', 'en'), ['2026-10-10', '2026-10-11', 'all day'])
  assert.deepEqual(range('x next weekend', 'en'), ['2026-10-10', '2026-10-11', 'all day'])
  assert.deepEqual(range('x no fim de semana'), ['2026-10-10', '2026-10-11', 'all day'])
  const saturday = new Date(2026, 9, 10, 9, 0)
  assert.equal(QuickAdd.parseQuickAdd('x next weekend', saturday, 'en').dateKey, '2026-10-17')
  assert.equal(parse('Weekend in Paris', 'en').title, 'Weekend in Paris')
})

test('parseQuickAdd: a deadline with no time is all day', () => {
  assert.deepEqual(when('DEADLINE: report', 'en'), ['2026-10-06', 'all day'])
})

test('parseQuickAdd: every weekday repeats weekly from the next one', () => {
  for (const [text, lang] of [['Gym every monday 6pm', 'en'], ['Gym on mondays 6pm', 'en'],
    ['Academia toda segunda 18h', 'pt'], ['Academia todas as segundas-feiras 18h', 'pt']]) {
    const p = parse(text, lang)
    assert.deepEqual([p.title, p.dateKey, p.startTime, p.repeat], [text.split(' ')[0], '2026-10-12', '18:00', 'weekly'], text)
  }
  assert.equal(parse('I hate mondays', 'en').repeat, 'none')
})

test('parseQuickAdd: repeat words map to the form presets', () => {
  assert.equal(parse('Standup every weekday 9am', 'en').repeat, 'weekdays')
  assert.equal(parse('Standup weekdays 9:30', 'en').repeat, 'weekdays')
  assert.equal(parse('Pills daily 8am', 'en').repeat, 'daily')
  assert.equal(parse('x todo dia 8h').repeat, 'daily')
  assert.equal(parse('x todos os dias').repeat, 'daily')
  assert.equal(parse('x semanalmente').repeat, 'weekly')
  assert.equal(parse('Rent every month', 'en').repeat, 'monthly')
  assert.equal(parse('Birthday every year oct 12', 'en').repeat, 'yearly')
  assert.equal(parse('Pills daily 8am', 'en').title, 'Pills')
})

test('parseQuickAdd: a repeat word that names the event, or one no preset says, is not a repeat', () => {
  assert.deepEqual([parse('Weekly review friday 4pm', 'en').title, parse('Weekly review friday 4pm', 'en').repeat],
    ['Weekly review', 'none'])
  assert.equal(parse('x every other week', 'en').title, 'x every other week')
  assert.equal(parse('Pagar todo dia 5').repeat, 'none')
})

test('parseQuickAdd: email addresses become guests and leave the title', () => {
  const p = parse('Sync with ana@x.com tomorrow 3pm', 'en')
  assert.deepEqual([p.title, p.guests, p.dateKey, p.startTime], ['Sync', ['ana@x.com'], '2026-10-07', '15:00'])
  assert.deepEqual(parse('Lunch with Ana and bob@y.com', 'en').title, 'Lunch with Ana')
  assert.deepEqual(parse('x ana@x.com, bob@y.com').guests, ['ana@x.com', 'bob@y.com'])
  assert.deepEqual(parse('x Ana@X.com ana@x.com').guests, ['ana@x.com'])
  assert.deepEqual(parse('Planning com ana@x.com e bob@y.com amanhã 10h').title, 'Planning')
  assert.deepEqual(parse('x foo@bar', 'en').guests, [])
})

test('quickAddForm carries the repeat and the guests', () => {
  const form = QuickAdd.quickAddForm(parse('Sync with ana@x.com every monday 6pm', 'en'), 'me@example.com')
  assert.equal(form.repeat, 'weekly')
  assert.deepEqual(form.guests.map((g) => g.email), ['ana@x.com'])
  const trip = QuickAdd.quickAddForm(parse('Trip friday to sunday', 'en'), 'me')
  assert.deepEqual([trip.allDay, trip.startDate, trip.endDate], [true, '2026-10-09', '2026-10-11'])
})

test('googleTemplateUrl carries the repeat and the guests', () => {
  const url = QuickAdd.googleTemplateUrl(parse('Sync with ana@x.com every monday 6pm', 'en'))
  assert.match(url, /&recur=RRULE%3AFREQ%3DWEEKLY&add=ana%40x\.com$/)
  assert.equal(Model.safeUrl(url), url)
  assert.match(QuickAdd.googleTemplateUrl(parse('Trip friday to sunday', 'en')), /dates=20261009\/20261012$/)
})

test('quickAddUnderstood names guests and repeats, and keeps a range together', () => {
  assert.deepEqual(understood('Gym every monday 6pm', 'en'), ['repeat:every monday', 'time:6pm'])
  assert.deepEqual(understood('Sync with ana@x.com', 'en'), ['guest:with ana@x.com'])
  assert.deepEqual(understood('Trip friday to sunday', 'en'), ['date:friday to sunday'])
  assert.deepEqual(understood('test in two minutes', 'en'), ['time:in two minutes'])
})
