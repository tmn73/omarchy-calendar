// Loads a QML JavaScript resource under node the way the QML engine does:
// `.pragma library` is honoured (one shared instance per file) and
// `.import "Other.js" as Name` binds Name to that file's declarations.
// Directive lines are blanked rather than removed so stack traces keep the
// file's own line numbers.
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..')
const cache = new Map()

// `file` is relative to the repository root, or absolute.
function loadQmlJs(file) {
  const full = path.resolve(REPO, file)
  if (cache.has(full)) return cache.get(full)

  const imports = {}
  const body = fs.readFileSync(full, 'utf8').split('\n').map((line) => {
    if (!line.startsWith('.')) return line
    const imported = line.match(/^\.import\s+"([^"]+\.js)"\s+as\s+(\w+)\s*$/)
    if (imported) imports[imported[2]] = loadQmlJs(path.resolve(path.dirname(full), imported[1]))
    else if (!/^\.pragma\s+library\s*$/.test(line)) throw new Error(`${file}: unsupported directive ${line}`)
    return ''
  }).join('\n')

  // Top-level declarations start in column 0 in these files; that is what a
  // QML caller sees as Model.name.
  const names = [...body.matchAll(/^(?:function\s+([\w$]+)|var\s+([\w$]+))/gm)].map((m) => m[1] || m[2])
  const factory = new Function(...Object.keys(imports),
    `${body}\nreturn { ${names.join(', ')} }\n//# sourceURL=${full}`)
  const api = factory(...Object.values(imports))
  cache.set(full, api)
  return api
}

module.exports = { loadQmlJs }
