const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

// Every local user can read process arguments through ps. A meeting link can
// carry its passcode, so text to copy goes to wl-copy on stdin, never after it
// on the command line.
const ROOT = path.join(__dirname, '..')

test('no QML file passes text to wl-copy as an argument', () => {
  const offenders = fs.readdirSync(ROOT)
    .filter(name => name.endsWith('.qml'))
    .filter(name => /"wl-copy"\s*,/.test(fs.readFileSync(path.join(ROOT, name), 'utf8')))
  assert.deepEqual(offenders, [])
})
