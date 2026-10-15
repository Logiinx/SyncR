import { Extension } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node } from '@tiptap/pm/model'
import { liveQuery } from 'dexie'
import { db } from './db'

// Color rules: words like "Fire" get a color automatically, everywhere in every note.
// Only on screen: the notes themselves don't change, so switching a rule off removes its
// color at once. Rules live in groups that can be switched on/off as a whole.

export interface ColorRule {
  id: string
  words: string // one or more words or phrases, separated by commas: "Fire, Flame"
  color: string // palette id: "red", "blue", … (ColorPicker.tsx)
  enabled: boolean
}

export interface RuleGroup {
  id: string
  name: string
  enabled: boolean
  rules: ColorRule[]
}

const SETTING = 'colorRules'

export function loadRuleGroups() {
  return db.settings.get(SETTING).then((row) => (row?.value as RuleGroup[] | undefined) ?? [])
}

export async function saveRuleGroups(groups: RuleGroup[]) {
  await db.settings.put({ name: SETTING, value: groups, updatedAt: Date.now() })
}

// ---------- Matching ----------

interface Matcher {
  regex: RegExp
  colors: Map<string, string> // lowercase word → palette id
}

const normalize = (words: string) => words.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// One search for all switched-on words. Whole words only (letters, digits or _ may not touch
// them), any case. Longer words first, so "River of blood" wins over "blood".
function compile(groups: RuleGroup[]): Matcher | null {
  const colors = new Map<string, string>()
  for (const group of groups) {
    if (!group.enabled) continue
    for (const rule of group.rules) {
      if (!rule.enabled) continue
      for (const word of rule.words.split(',')) {
        const key = normalize(word)
        if (key && !colors.has(key)) colors.set(key, rule.color)
      }
    }
  }
  if (colors.size === 0) return null
  const words = [...colors.keys()].sort((a, b) => b.length - a.length)
  // A space in a phrase matches any spacing
  const alternatives = words.map((word) => escape(word).replace(/ /g, '\\s+')).join('|')
  return { regex: new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`, 'giu'), colors }
}

// The current rules for every open editor, kept up to date from the database
let matcher: Matcher | null = null
const listeners = new Set<() => void>()
let subscription: { unsubscribe: () => void } | null = null

function onRulesChange(listener: () => void) {
  listeners.add(listener)
  subscription ??= liveQuery(loadRuleGroups).subscribe((groups) => {
    matcher = compile(groups)
    listeners.forEach((l) => l())
  })
  return () => listeners.delete(listener)
}

// ---------- Editor ----------

const key = new PluginKey<DecorationSet>('colorRules')

// Text with its own color (colored by hand), links and code keep their look
function keepsOwnLook(doc: Node, from: number, to: number) {
  let found = false
  doc.nodesBetween(from, to, (node) => {
    if (node.isText && node.marks.some((m) => (m.type.name === 'textStyle' && m.attrs.color) || ['link', 'code'].includes(m.type.name)))
      found = true
  })
  return found
}

function decorate(doc: Node): DecorationSet {
  if (!matcher) return DecorationSet.empty
  const { regex, colors } = matcher
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    if (node.type.spec.code) return false
    // One character per position: images and line breaks count as one placeholder character
    const text = node.textBetween(0, node.content.size, undefined, '￼')
    for (const match of text.matchAll(regex)) {
      const from = pos + 1 + match.index
      const to = from + match[0].length
      const color = colors.get(normalize(match[0]))
      if (color && !keepsOwnLook(doc, from, to)) {
        decorations.push(Decoration.inline(from, to, { style: `color: var(--text-${color})` }))
      }
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

export const ColorRules = Extension.create({
  name: 'colorRules',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_, { doc }) => decorate(doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(key) ? decorate(tr.doc) : old),
        },
        props: { decorations: (state) => key.getState(state) },
        // Rules changed (Settings, or later: sync): recolor this note
        view: (view) => {
          const stop = onRulesChange(() => {
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true).setMeta('addToHistory', false))
          })
          return { destroy: () => void stop() }
        },
      }),
    ]
  },
})
