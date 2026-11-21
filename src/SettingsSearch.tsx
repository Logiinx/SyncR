import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Search, X } from 'lucide-react'
import { t } from './i18n'

// Settings' search (SettingsDialog.tsx): the box, and the results: every section's real rows
// (usable right there) under its name, the ones that don't match hidden. Searched: section names,
// subheadings and setting names (not the ⓘ texts or the choices in lists), case and accents
// ignored, every word typed must appear. A subheading or section name matching shows its whole
// group; a matching row shows its subheading above it, and a module's switch row with it.

// The box: in the title row (PC) or above the list (phone). Escape clears it first, then (empty)
// closes Settings as usual.
export function SettingsSearchBox({ query, onQuery, inputRef }: {
  query: string
  onQuery: (query: string) => void
  inputRef: RefObject<HTMLInputElement | null>
}) {
  return (
    <div className="game-search-bar settings-search">
      <Search size={15} />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !query) return
          e.stopPropagation()
          onQuery('')
        }}
        placeholder={t('Search settings')}
        aria-label={t('Search settings')}
        spellCheck={false}
      />
      {query && (
        <button
          className="game-search-clear"
          title={t('Clear')}
          onClick={() => {
            onQuery('')
            inputRef.current?.focus()
          }}
        >
          <X size={15} />
        </button>
      )}
    </div>
  )
}

type Section = { id: string; icon: React.ComponentType<{ size?: number }>; name: string; content: ReactNode }

export function SettingsResults({ query, sections }: { query: string; sections: Section[] }) {
  const groupsRef = useRef<HTMLDivElement>(null)
  const [found, setFound] = useState(true)
  useLayoutEffect(() => {
    const groups = groupsRef.current
    if (!groups) return
    const run = () => setFound(filterSections(groups, words(query)))
    run()
    // Again when rows come in or change later (a check's answer, a list loading)
    const changes = new MutationObserver(run)
    changes.observe(groups, { childList: true, subtree: true })
    return () => changes.disconnect()
  }, [query])
  return (
    <div className="settings-results">
      <div ref={groupsRef}>
        {sections.map(({ id, icon: Icon, name, content }) => (
          <section key={id} className="settings-result-group" data-name={name}>
            <h3 className="settings-result-section">
              <Icon size={15} /> {name}
            </h3>
            <div className="settings-result-rows">{content}</div>
          </section>
        ))}
      </div>
      {!found && <p className="settings-results-none">{t('No settings match')}</p>}
    </div>
  )
}

// Lower case, without accents ("Réglé" → "regle")
function fold(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function words(query: string) {
  return fold(query).split(/\s+/).filter(Boolean)
}

// Hides what doesn't match (data-unmatched, display: none); true when something is left
function filterSections(groups: HTMLElement, wanted: string[]) {
  let anyFound = false
  for (const group of groups.querySelectorAll<HTMLElement>('.settings-result-group')) {
    const found = filterGroup(group, wanted)
    group.toggleAttribute('data-unmatched', !found)
    anyFound ||= found
  }
  return anyFound
}

function filterGroup(group: HTMLElement, wanted: string[]) {
  const section = group.dataset.name ?? ''
  const has = (text: string) => {
    const folded = fold(text)
    return wanted.every((word) => folded.includes(word))
  }
  const rows = group.querySelector('.settings-result-rows')
  if (!rows) return false
  const shown: HTMLElement[] = []
  let heading: HTMLElement | null = null
  let headingText = ''
  let wholeBlock = has(section) // the section's name matches: all of it
  let previousShown = wholeBlock
  let moduleSwitch: HTMLElement | null = null
  const all = pieces(rows)
  for (const piece of all) {
    let show: boolean
    if (piece.matches('.settings-card-sub')) {
      heading = piece
      headingText = piece.textContent ?? ''
      wholeBlock = has(`${section} ${headingText}`)
      show = wholeBlock
    } else if (piece.matches('.settings-row')) {
      const label = piece.querySelector('.settings-row-label')?.textContent ?? ''
      show = wholeBlock || has(`${section} ${headingText} ${label}`)
      if (piece.matches('.module-switch')) moduleSwitch = piece
      // Its subheading above it
      if (show && heading && !shown.includes(heading)) {
        heading.removeAttribute('data-unmatched')
        shown.push(heading)
      }
    } else {
      // Anything else (a check's line, a note, a list) goes with the row or subheading before it
      show = previousShown
    }
    piece.toggleAttribute('data-unmatched', !show)
    if (show) shown.push(piece)
    previousShown = show
  }
  // A module's switch with its results: they're grayed while it's off
  if (moduleSwitch && shown.length > 0 && !shown.includes(moduleSwitch)) {
    moduleSwitch.removeAttribute('data-unmatched')
    shown.push(moduleSwitch)
  }
  // No line under the last row shown before a subheading or the end (rows hidden after it)
  let before: HTMLElement | null = null
  for (const piece of all) {
    piece.removeAttribute('data-last')
    if (!shown.includes(piece)) continue
    if (before && piece.matches('.settings-card-sub')) before.setAttribute('data-last', '')
    before = piece
  }
  before?.setAttribute('data-last', '')
  return shown.length > 0
}

// A section's rows, subheadings and the rest, in order, looking inside what only holds them (a
// module's fieldset, a part's wrapper)
function pieces(parent: Element): HTMLElement[] {
  return [...parent.children].flatMap((child) =>
    !child.matches('.settings-row, .settings-card-sub') && child.querySelector('.settings-row, .settings-card-sub')
      ? pieces(child)
      : [child as HTMLElement],
  )
}
