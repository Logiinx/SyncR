// Fails the build when CHANGELOG.fr.md doesn't follow CHANGELOG.md line by line: same versions,
// same areas, same number of lines, each starting with its word (Added = Ajout...).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const lines = (name) => readFileSync(ROOT + name, 'utf8').split(/\r?\n/)
const AREAS = { Notes: 'Notes', Board: 'Board', Reminders: 'Rappels', Games: 'Jeux', Mail: 'Mail', Video: 'Vidéo', Sync: 'Synchronisation', App: 'Application' }
const VERBS = { Added: 'Ajout', Improved: 'Amélioration', Changed: 'Changement', Removed: 'Suppression', Fixed: 'Correction' }

const english = lines('CHANGELOG.md')
const french = lines('CHANGELOG.fr.md')
const errors = []
const start = (all) => all.findIndex((line) => line.startsWith('## ')) // the titles above it differ

const en = english.slice(start(english))
const fr = french.slice(start(french))
if (en.length !== fr.length) errors.push(`CHANGELOG.md has ${en.length} lines from the first version on, CHANGELOG.fr.md ${fr.length}`)
let version = ''
for (let i = 0; i < Math.min(en.length, fr.length) && errors.length < 10; i++) {
  const [a, b] = [en[i], fr[i]]
  if (a.startsWith('## ')) version = a
  const where = `CHANGELOG.fr.md, ${version}: "${b.slice(0, 60)}" for "${a.slice(0, 60)}"`
  if (a.startsWith('## ') || !a.trim()) {
    if (a !== b) errors.push(where)
    continue
  }
  const verb = a.match(/^- \*\*(\w+)\*\* /)
  if (verb) {
    if (!b.startsWith(`- **${VERBS[verb[1]]}** `)) errors.push(where)
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
