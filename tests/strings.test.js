const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { loadQmlJs } = require('./load-qml-js.js')

const Strings = loadQmlJs('Strings.js')
const EN = Strings.STRINGS.en
const PT = Strings.STRINGS.pt

test('tr looks a key up in the language', () => {
  assert.equal(Strings.tr('en', 'quick.create'), 'Create')
  assert.equal(Strings.tr('pt', 'quick.create'), 'Criar')
})

test('tr falls back to English, then to the key itself', () => {
  assert.equal(Strings.tr('pt', 'unit.min', [5]), '5 min')
  assert.equal(Strings.tr('fr', 'quick.create'), 'Create')
  assert.equal(Strings.tr(undefined, 'quick.create'), 'Create')
  assert.equal(Strings.tr('pt', 'no.such.key'), 'no.such.key')
})

test('tr fills %1 %2 from an array or a single value, and leaves missing ones', () => {
  assert.equal(Strings.tr('en', 'unit.hmin', [1, 30]), '1 h 30 min')
  assert.equal(Strings.tr('en', 'toast.created', 'Standup'), 'Created: Standup')
  assert.equal(Strings.tr('en', 'toast.created', 0), 'Created: 0')
  assert.equal(Strings.tr('en', 'unit.hmin', [1]), '1 h %2 min')
  assert.equal(Strings.tr('en', 'toast.created'), 'Created: %1')
})

test('tr does not expand placeholders found inside arguments', () => {
  assert.equal(Strings.tr('en', 'bar.soon', ['%2 sale', 'in 5 min']), '%2 sale in in 5 min')
})

test('trn picks one or other, with the count as %1 by default', () => {
  assert.equal(Strings.trn('pt', 'summary.tasks', 1), '1 tarefa')
  assert.equal(Strings.trn('pt', 'summary.tasks', 3), '3 tarefas')
  assert.equal(Strings.trn('en', 'summary.tasks', 0), '0 tasks')
  assert.equal(Strings.trn('pt', 'rel.left', 1, ['1 min']), 'agora · falta 1 min')
  assert.equal(Strings.trn('en', 'settings.syncEvents', 2, [2, 'gws']), '2 events from gws')
})

test('trFor uses the gendered form a language has, else the plain key', () => {
  assert.equal(Strings.trFor('pt', 'repeat.weekly', 'm', ['sábado']), 'Toda semana no sábado')
  assert.equal(Strings.trFor('pt', 'repeat.weekly', 'f', ['sexta-feira']), 'Toda semana na sexta-feira')
  assert.equal(Strings.trFor('en', 'repeat.weekly', '', ['Friday']), 'Weekly on Friday')
  assert.equal(Strings.trFor('en', 'repeat.weekly', 'f', ['Friday']), 'Weekly on Friday')
})

test('weekdayGender is Portuguese grammar only', () => {
  assert.deepEqual([0, 1, 5, 6].map(d => Strings.weekdayGender('pt', d)), ['m', 'f', 'f', 'm'])
  assert.equal(Strings.weekdayGender('en', 1), '')
})

test('resolveLanguage: explicit settings win, auto follows the system locale', () => {
  assert.equal(Strings.resolveLanguage('en', 'pt_BR'), 'en')
  assert.equal(Strings.resolveLanguage('pt', 'en_US'), 'pt')
  assert.equal(Strings.resolveLanguage('auto', 'pt_BR'), 'pt')
  assert.equal(Strings.resolveLanguage('auto', 'pt-PT'), 'pt')
  assert.equal(Strings.resolveLanguage('auto', 'en_GB'), 'en')
  assert.equal(Strings.resolveLanguage('auto', 'de_DE'), 'en')
  assert.equal(Strings.resolveLanguage(undefined, 'pt_BR'), 'pt')
  assert.equal(Strings.resolveLanguage('klingon', 'C'), 'en')
  assert.equal(Strings.resolveLanguage('PT-BR', ''), 'pt')
})

test('localeName gives the Qt.locale name for each language', () => {
  assert.equal(Strings.localeName('pt'), 'pt_BR')
  assert.equal(Strings.localeName('en'), 'en_US')
  assert.equal(Strings.localeName('xx'), 'en_US')
})

test('languageOptions names each language in itself', () => {
  assert.deepEqual(Strings.languageOptions('pt'), [
    { value: 'auto', label: 'Automático' },
    { value: 'en', label: 'English' },
    { value: 'pt', label: 'Português (Brasil)' }
  ])
  assert.equal(Strings.languageOptions('en')[0].label, 'Automatic')
})

const placeholders = (text) => [...new Set(text.match(/%\d/g) || [])].sort()
const baseOf = (key) => key.replace(/\.(one|other|m|f)$/, '')

test('every Portuguese key exists in English, or is a form of one', () => {
  const enBases = new Set(Object.keys(EN).map(baseOf))
  const orphans = Object.keys(PT).filter(key => !(key in EN) && !enBases.has(baseOf(key)) && !key.startsWith('weekday.gender.'))
  assert.deepEqual(orphans, [])
})

test('Portuguese translates everything but the language-neutral keys', () => {
  const ptBases = new Set(Object.keys(PT).map(baseOf))
  const untranslated = Object.keys(EN).filter(key => !(key in PT) && !ptBases.has(key))
  assert.deepEqual(untranslated.sort(), [
    'bar.more', 'form.meet', 'grid.week', 'life.mementoMori',
    'settings.minutes', 'unit.h', 'unit.hmin', 'unit.min'
  ])
})

test('translations use the same placeholders as the English', () => {
  for (const [key, text] of Object.entries(PT)) {
    const english = EN[key] || EN[baseOf(key)] || EN[baseOf(key) + '.other']
    if (english === undefined) continue
    assert.deepEqual(placeholders(text), placeholders(english), key)
  }
})

test('plural keys come in complete pairs', () => {
  for (const table of [EN, PT]) {
    for (const key of Object.keys(table)) {
      if (key.endsWith('.one')) assert.ok(key.replace(/one$/, 'other') in table, key)
      if (key.endsWith('.other')) assert.ok(key.replace(/other$/, 'one') in table, key)
    }
  }
})

test('gendered keys come in complete pairs', () => {
  for (const key of Object.keys(PT)) {
    if (key.endsWith('.m')) assert.ok(key.replace(/m$/, 'f') in PT, key)
    if (key.endsWith('.f')) assert.ok(key.replace(/f$/, 'm') in PT, key)
  }
})

test('every literal key Model.js asks for exists', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'Model.js'), 'utf8')
  const calls = [...source.matchAll(/Strings\.(tr|trn|trFor)\(lang, "([^"]+)"[,)]/g)]
  assert.ok(calls.length > 20)
  for (const [, fn, key] of calls) {
    if (fn === 'trn') assert.ok(`${key}.one` in EN && `${key}.other` in EN && `${key}.one` in PT, key)
    else assert.ok(key in EN || `${key}.other` in EN, key)
  }
})

test('weekday and month names exist in both languages', () => {
  for (let i = 0; i < 7; i++) assert.ok(`weekday.${i}` in EN && `weekday.${i}` in PT)
  for (let i = 0; i < 12; i++) assert.ok(`month.${i}` in EN && `month.${i}` in PT)
  for (const n of [1, 2, 3, 4, -1]) assert.ok(`ordinal.${n}` in EN && `ordinal.${n}.m` in PT && `ordinal.${n}.f` in PT)
})
