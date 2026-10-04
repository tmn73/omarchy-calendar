const test = require('node:test')
const assert = require('node:assert')
const { loadQmlJs } = require('./load-qml-js.js')

const Model = loadQmlJs('Model.js')

test('layoutFromSettings: no settings gives the standard layout', () => {
  assert.deepEqual(Model.layoutFromSettings(undefined), Model.layoutPreset('standard'))
  assert.deepEqual(Model.layoutFromSettings({}), Model.layoutPreset('standard'))
})

test('layoutFromSettings: stored values win over the standard layout', () => {
  const layout = Model.layoutFromSettings({ showQuickAdd: false, agendaPlacement: 'below' })
  assert.equal(layout.showQuickAdd, false)
  assert.equal(layout.agendaPlacement, 'below')
  assert.equal(layout.showShortcutLegend, true)
})

test('layoutFromSettings: values of the wrong type fall back to the standard layout', () => {
  const layout = Model.layoutFromSettings({ showQuickAdd: 'no', showNextUp: null, agendaPlacement: 'above' })
  assert.equal(layout.showQuickAdd, true)
  assert.equal(layout.showNextUp, true)
  assert.equal(layout.agendaPlacement, 'beside')
})

test('layoutFromSettings: keys it does not know are left out', () => {
  assert.equal('detailsColumn' in Model.layoutFromSettings({ detailsColumn: 'pinned' }), false)
})

test('layoutFromSettings: keeps the year progress setting that existed before layouts', () => {
  assert.equal(Model.layoutFromSettings({ showYearProgress: true }).showYearProgress, true)
  assert.equal(Model.layoutFromSettings({}).showYearProgress, false)
})

test('layoutPreset: the standard preset is the panel as it was before layouts', () => {
  assert.deepEqual(Model.layoutPreset('standard'), {
    agendaPlacement: 'beside',
    showYearProgress: false,
    showShortcutLegend: true,
    showQuickAdd: true,
    showNextUp: true,
    showUpcomingDays: true
  })
})

test('layoutPreset: minimal is one column, the agenda under the month', () => {
  const minimal = Model.layoutPreset('minimal')
  assert.equal(minimal.agendaPlacement, 'below')
  assert.equal(minimal.showShortcutLegend, false)
  assert.equal(minimal.showQuickAdd, false)
})

test('layoutPreset: an unknown name gives the standard preset', () => {
  assert.deepEqual(Model.layoutPreset('huge'), Model.layoutPreset('standard'))
})

test('layoutPreset: returns a copy, so a caller cannot change the preset', () => {
  Model.layoutPreset('minimal').showQuickAdd = true
  assert.equal(Model.layoutPreset('minimal').showQuickAdd, false)
})

test('layoutPresetName: names the preset a layout matches, or gives an empty string', () => {
  for (const name of Model.LAYOUT_PRESET_NAMES)
    assert.equal(Model.layoutPresetName(Model.layoutPreset(name)), name)
  const custom = Model.layoutPreset('standard')
  custom.showShortcutLegend = false
  assert.equal(Model.layoutPresetName(custom), '')
})

