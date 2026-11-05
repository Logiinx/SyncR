import type { ReactNode } from 'react'

// **bold** → <strong>. For a sentence with bold words in it (their place differs per language)
// and for the changelog's lines.
export function richText(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))
}
