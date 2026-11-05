import { useSyncExternalStore } from 'react'
import { read, write } from './localState'
import { fr } from './fr'

// The app's language. English text is the key: t('Settings') gives the English as written, or
// its French from src/fr/. A text missing from src/fr/ doesn't compile, so French can't fall behind.
// `t` reads the language when called, so never keep its result in a constant outside a function.

export type TextKey = keyof typeof fr
export type Language = 'en' | 'fr'
export type LanguageChoice = 'device' | Language

// Off in released apps until every screen is translated: they stay in English, without the setting.
export const FRENCH_READY = import.meta.env.DEV

const CHOICE_KEY = 'syncr.language' // a copy on this device: the lock screen shows before the database opens

export function validChoice(value: unknown): LanguageChoice {
  return value === 'fr' || value === 'en' ? value : 'device'
}

function resolve(picked: LanguageChoice): Language {
  if (!FRENCH_READY) return 'en'
  if (picked !== 'device') return picked
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

let choice = validChoice(read<unknown>(CHOICE_KEY, 'device'))
let language = resolve(choice)
document.documentElement.lang = language
const listeners = new Set<() => void>()

export function setLanguageChoice(next: LanguageChoice) {
  choice = next
  write(CHOICE_KEY, next)
  const resolved = resolve(next)
  if (resolved === language) return
  language = resolved
  document.documentElement.lang = resolved
  listeners.forEach((listener) => listener())
}

export const currentLanguage = () => language

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// For the top of each window's main component: redraws it, and so everything inside it, keeping
// what's open and typed. Nothing else needs it (the app uses no memo()).
export function useLanguage() {
  return useSyncExternalStore(subscribe, currentLanguage)
}

// French spacing: a space that never breaks before : ; ! ? » and after «, so src/fr/ can use plain spaces.
const frenchSpaces = (text: string) => text.replace(/ ([:;!?»])/g, ' $1').replace(/« /g, '« ')

// t('Delete note') · t('{n} on', { n: 3 }). A word that needs two French versions gets a note after
// a | that English drops: t('New|card') → "New" / "Nouvelle".
export function t(key: TextKey, values?: Record<string, string | number>) {
  let text: string = language === 'fr' ? frenchSpaces(fr[key]) : key.split('|')[0]
  if (values) text = text.replace(/\{(\w+)\}/g, (all, name) => (name in values ? String(values[name]) : all))
  return text
}

// plural(n, '{n} note', '{n} notes'). French uses the singular for 0 and 1, English only for 1.
export function plural(n: number, one: TextKey, other: TextKey) {
  const single = language === 'fr' ? n < 2 : n === 1
  return t(single ? one : other, { n })
}
