// Fails the build when CHANGELOG.fr.md doesn't follow CHANGELOG.md line by line: same versions,
// same areas, same number of lines, each starting with its tag (New: = Nouveau :). New-style lines
// must follow the tag order inside an area and stay short. Older versions keep the old verbs (Added = Ajout).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const lines = (name) => readFileSync(ROOT + name, 'utf8').split(/\r?\n/)
const AREAS = { Notes: 'Notes', Board: 'Board', Reminders: 'Rappels', Games: 'Jeux', Mail: 'Mail', Video: 'Vidéo', Sync: 'Synchronisation', App: 'Application' }
const VERBS = { Added: 'Ajout', Improved: 'Amélioration', Changed: 'Changement', Removed: 'Suppression', Fixed: 'Correction' }
const TAGS = { New: 'Nouveau', Better: 'Amélioré', Changed: 'Changé', Removed: 'Supprimé', Fixed: 'Corrigé', 'Small fixes': 'Petites corrections' }
const ORDER = Object.keys(TAGS)
const MAX_LENGTH = 90 // visible characters of an English line (aim for ~70)

const english = lines('CHANGELOG.md')
const french = lines('CHANGELOG.fr.md')
const errors = []
const start = (all) => all.findIndex((line) => line.startsWith('## ')) // the titles above it differ

const en = english.slice(start(english))
const fr = french.slice(start(french))
if (en.length !== fr.length) errors.push(`CHANGELOG.md has ${en.length} lines from the first version on, CHANGELOG.fr.md ${fr.length}`)
let version = ''
let lastTag = -1 // the previous line's tag in this area, for the order
for (let i = 0; i < Math.min(en.length, fr.length) && errors.length < 10; i++) {
  const [a, b] = [en[i], fr[i]]
  if (a.startsWith('## ')) version = a
  if (!a.startsWith('- ')) lastTag = -1
  const where = `CHANGELOG.fr.md, ${version}: "${b.slice(0, 60)}" for "${a.slice(0, 60)}"`
  if (a.startsWith('## ') || !a.trim()) {
    if (a !== b) errors.push(where)
    continue
  }
  const tag = a.match(/^- \*\*([\w ]+):\*\* /)
  if (tag) {
    const at = ORDER.indexOf(tag[1])
    if (at < 0) errors.push(`CHANGELOG.md, ${version}: unknown tag "${tag[1]}"`)
    else if (!b.startsWith(`- **${TAGS[tag[1]]} :** `)) errors.push(where)
    if (at >= 0 && at < lastTag) errors.push(`CHANGELOG.md, ${version}: "${tag[1]}" after "${ORDER[lastTag]}" (order: ${ORDER.join(', ')})`)
    lastTag = Math.max(lastTag, at)
    const length = [...a.slice(2).replace(/\*\*/g, '')].length
    if (length > MAX_LENGTH) errors.push(`CHANGELOG.md, ${version}: ${length} characters, max ${MAX_LENGTH}: "${a.slice(0, 60)}"`)
    continue
  }
  const verb = a.match(/^- \*\*(\w+)\*\* /)
  if (verb) {
    if (!b.startsWith(`- **${VERBS[verb[1]]}** `)) errors.push(where)
    const number = version.match(/\[(\d+)\.(\d+)\./)
    const old = number && +number[1] === 0 && +number[2] < 60 // Unreleased and 0.60.0 on use the tags
    if (!old)
      errors.push(`CHANGELOG.md, ${version}: old verb "${verb[1]}", use a tag (${ORDER.join(', ')})`)
    continue
  }
  const area = a.match(/^\*\*(\w+)\*\*$/)
  if (!area || b !== `**${AREAS[area[1]]}**`) errors.push(where)
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log('Changelog check passed')
