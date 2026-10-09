const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// Qt 6.12 adds a QtQuick Color type that shadows a bare Color, which leaves
// every theme color undefined. The palette must go through Commons.Color.
const ROOT = path.join(__dirname, '..')
const BARE_COLOR = /(?<![.\w])Color\./

test('every QML file qualifies the palette as Commons.Color', () => {
  const offenders = fs.readdirSync(ROOT)
    .filter(name => name.endsWith('.qml'))
    .filter(name => BARE_COLOR.test(fs.readFileSync(path.join(ROOT, name), 'utf8')))
  assert.deepEqual(offenders, [])
})
