import { liveQuery } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { changed, db } from './db'
import { setLanguageChoice, validChoice, type LanguageChoice } from './i18n'

// The language picked in Settings: synced, so every device follows it. "device" lets each one
// follow its own system language. Nothing saved yet: same as "device".
const SETTING = 'language' // lower case: Dropbox lists file names in lower case

const loadChoice = async () => validChoice((await db.settings.get(SETTING))?.value)

export const useLanguageChoice = () => useLiveQuery(loadChoice, [])

export async function saveLanguageChoice(next: LanguageChoice) {
  setLanguageChoice(next) // right away, not when the database has answered
  const change = { value: next, updatedAt: Date.now() }
  if (!(await db.settings.update(SETTING, change))) await db.settings.put({ name: SETTING, ...change })
  changed()
}

// Once the database is open: follows the saved choice, also when sync brings one from another
// device or the other window changes it.
export function followLanguageChoice() {
  liveQuery(() => db.settings.get(SETTING)).subscribe((row) => {
    if (row) setLanguageChoice(validChoice(row.value))
  })
}
