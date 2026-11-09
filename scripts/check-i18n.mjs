// Fails the build when text the user can see isn't translated: `t()` in i18n.ts checks that a text
// has its French, this finds text that never went through `t()`. It reads the code and recognizes
// what looks like words, so a string that isn't text gets a comment on its line (or the line
// above): i18n-ok. Files still to translate are in i18n-pending.txt and aren't checked yet.
//   node scripts/check-i18n.mjs            the check
//   node scripts/check-i18n.mjs --all      also lists what's in the pending files
//   node scripts/check-i18n.mjs --file x   lists what's in that one file (pending or not)

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PENDING_FILE = join(ROOT, 'scripts/i18n-pending.txt')
const SKIPPED = /^src\/(fr\/|i18n\.ts$)|\.d\.ts$/

// Names that are the same in both languages
const NAMES = /^(SyncR|Dropbox|Google|Gmail|Steam|IGDB|GG\.deals|Cloudflare|Pub\/Sub|Windows|Android|Twitter|Reddit|YouTube|Notesnook|Inter|Literata|JetBrains Mono|Google Sans Flex|Sans-serif|Français|English|PIN|URL|OK|by Logiinx|HTML|PDF)$/

// JSX attributes that never hold text
const NOT_TEXT_ATTRIBUTES = new Set(['className', 'style', 'key', 'href', 'src', 'type', 'id', 'name', 'value', 'defaultValue',
  'role', 'target', 'rel', 'd', 'viewBox', 'fill', 'stroke', 'autoComplete', 'inputMode', 'mode', 'kind', 'side', 'align',
  'tabIndex', 'step', 'min', 'max', 'pattern', 'accept', 'lang', 'dir', 'xmlns', 'htmlFor', 'draggable', 'size', 'color'])

// Calls whose strings go to code, not to the screen
const NOT_TEXT_CALLS = new Set(['t', 'plural', 'textKey', 'querySelector', 'querySelectorAll', 'closest', 'matches', 'getElementById',
  'createElement', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'Event', 'CustomEvent', 'getAttribute', 'setAttribute',
  'hasAttribute', 'removeAttribute', 'getPropertyValue', 'setProperty', 'add', 'remove', 'toggle', 'contains', 'startsWith', 'endsWith',
  'includes', 'split', 'replace', 'replaceAll', 'match', 'matchAll', 'test', 'join', 'padStart', 'indexOf', 'invoke', 'fetch', 'URL', 'URLSearchParams',
  'RegExp', 'import', 'get', 'set', 'has', 'delete', 'append', 'read', 'write', 'useLocalState', 'parseFromString', 'toLocaleDateString', 'toLocaleTimeString',
  'toLocaleString', 'NumberFormat', 'DateTimeFormat', 'where', 'equals', 'orderBy', 'table', 'version', 'stores', 'getItem', 'setItem', 'removeItem',
  'execCommand', 'command', 'isActive', 'getAttributes', 'updateAttributes', 'setNode', 'setMark', 'unsetMark', 'toggleMark', 'extendMarkRange', 'Blob', 'File'])

function looksLikeText(raw) {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!/[A-Za-zÀ-ÿ]{2}/.test(text) || NAMES.test(text)) return false
  if (/^[a-z]+:|:\/\/|^[./#@[*-]|^\w+\/|\/\w+$|\bvar\(|\d(px|em|rem|ms|vh|vw|%)\b|[{};<>=]|^[\w-]+\(|^\(.*:.*\)$|:not\(/.test(text)) return false // addresses, paths, CSS, code
  if (/^[a-z][\w-]*(\.[\w-]+)+$/.test(text)) return false // ids with dots
  if (/^\d+ [a-z]{1,3}$/.test(text)) return false // 1 min, 10 s
  const words = text.split(' ')
  if (words.every((word) => /^[a-z][a-zA-Z0-9_-]*$/.test(word) && (words.length === 1 || /[-_A-Z]/.test(word)))) return false // ids, class lists
  if (words.length === 1 && /^[A-Z0-9_-]+$|^[A-Z]\w*[A-Z_-]\w*$/.test(text)) return false // CONSTANTS, TypeNames, Content-Type
  return true
}

function hitsIn(path) {
  const code = readFileSync(path, 'utf8')
  const file = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lines = code.split(/\r?\n/)
  const hits = []
  const report = (node, text) => {
    const line = file.getLineAndCharacterOfPosition(node.getStart()).line
    if (/i18n-ok/.test(lines[line]) || /i18n-ok/.test(lines[line - 1] ?? '')) return
    hits.push(`${line + 1}: ${text.replace(/\s+/g, ' ').trim().slice(0, 90)}`)
  }

  function isCodeUse(node) {
    for (let at = node, parent = node.parent; parent; at = parent, parent = parent.parent) {
      if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isLiteralTypeNode(parent) || ts.isTypeNode(parent)) return true
      if (ts.isPropertyAssignment(parent) && parent.name === at) return true
      if (ts.isElementAccessExpression(parent) && parent.argumentExpression === at) return true
      if (ts.isCaseClause(parent) && parent.expression === at) return true
      if (ts.isBinaryExpression(parent) && /^[=!]==?$/.test(parent.operatorToken.getText())) return true
      if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
        const called = parent.expression
        const name = ts.isPropertyAccessExpression(called) ? called.name.text : called.getText()
        const args = parent.arguments ?? []
        // setAttribute('aria-label', '…'): the value of a label attribute is text
        const label = name === 'setAttribute' && args[1] === at && /^['"](aria-label|title|placeholder|alt)['"]$/.test(args[0]?.getText() ?? '')
        // Only the text itself as an argument is code: a text inside an object passed to the call
        // (new CustomEvent(…, { detail: '…' })) or picked by a condition is still checked
        if (called.getText().startsWith('console.') || (NOT_TEXT_CALLS.has(name) && args.includes(node) && !label)) return true
      }
      if (ts.isJsxAttribute(parent) && NOT_TEXT_ATTRIBUTES.has(parent.name.getText())) {
        const tag = parent.parent.parent.tagName.getText()
        if (parent.name.getText() !== 'value' || /^[a-z]/.test(tag)) return true
      }
      if (ts.isPropertyAssignment(parent) && /^(className|style|type|kind|id|key|css)$/.test(parent.name.getText())) return true
    }
    return false
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      if (/[A-Za-zÀ-ÿ]/.test(node.text) && !NAMES.test(node.text.trim())) report(node, node.text)
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (looksLikeText(node.text) && !isCodeUse(node)) report(node, node.text)
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
      if (looksLikeText(parts.join(' ')) && !isCodeUse(node)) report(node, node.getText())
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return hits
}

function sourceFiles(folder) {
  return readdirSync(join(ROOT, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !SKIPPED.test(path) ? [path] : []
  })
}

// The French itself: each text once across the files, and with the same {values} as its English
function frenchProblems() {
  const problems = []
  const seen = new Map()
  for (const name of readdirSync(join(ROOT, 'src/fr'))) {
    if (name === 'index.ts') continue
    const path = join(ROOT, 'src/fr', name)
    const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = (node) => {
      if (ts.isPropertyAssignment(node)) {
        const key = node.name.text
        if (seen.has(key)) problems.push(`"${key}" is in both ${seen.get(key)} and ${name}`)
        seen.set(key, name)
        const values = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join()
        if (values(key) !== values(node.initializer.text ?? '')) problems.push(`${name}: "${key}" and its French have different {values}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  return problems
}

const args = process.argv.slice(2)
if (args[0] === '--file') {
  console.log(hitsIn(join(ROOT, args[1])).join('\n'))
  process.exit(0)
}

const pending = new Set(readFileSync(PENDING_FILE, 'utf8').split(/\r?\n/).filter(Boolean))
const errors = frenchProblems()
let left = 0
for (const path of sourceFiles('src')) {
  const hits = hitsIn(join(ROOT, path))
  if (pending.has(path)) {
    pending.delete(path)
    left += hits.length
    if (!hits.length) errors.push(`${path} has nothing left to translate: remove it from scripts/i18n-pending.txt`)
    else if (args[0] === '--all') console.log(`${relative(ROOT, join(ROOT, path))}: ${hits.length}\n  ${hits.join('\n  ')}`)
  } else if (hits.length) {
    errors.push(`${path}: not translated (use t(), or an i18n-ok comment if it isn't text)\n  ${hits.join('\n  ')}`)
  }
}
for (const path of pending) errors.push(`${path} doesn't exist anymore: remove it from scripts/i18n-pending.txt`)

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`Translation check passed (${left} texts still in pending files)`)
