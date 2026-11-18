import type { ReactNode } from 'react'

// **bold** → <strong>. For a sentence with bold words in it (their place differs per language)
// and for the changelog's lines.
export function richText(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))
}

// A sentence with an icon in it (its place differs per language): "{close} quits SyncR" with
// the X icon in place of {close}. No typed symbols for icons (✕), also in sentences.
export function withIcon(text: string, name: string, icon: ReactNode): ReactNode[] {
  return text.split('{' + name + '}').flatMap((part, i) => (i ? [<span key={i} className="inline-icon">{icon}</span>, part] : [part]))
}
