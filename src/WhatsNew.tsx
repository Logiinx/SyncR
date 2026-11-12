import { useEffect, useRef, useState, type ReactNode } from 'react'
import { currentLanguage, frenchSpaces, t } from './i18n'
import changelog from '../CHANGELOG.md?raw'
import changelogFr from '../CHANGELOG.fr.md?raw'
import { read, write } from './localState'
import Window from './Window'
import CloseButton from './CloseButton'
import { richText } from './richText'
import { shortDate } from './dates'

// After an update, shows once what changed since the version last used on this device.
// The text comes from CHANGELOG.md or CHANGELOG.fr.md, built into the app. A new device shows nothing.

const SEEN_KEY = 'syncr.lastVersion'

// In an update's notes (build-desktop.yml): English, a --- line and a title for GitHub's page,
// this hidden marker, French
const FRENCH_NOTES = '<!-- fr -->'
const ENGLISH_END = /^---\s*$/m

interface Release {
  version: string
  date?: number // from the heading's "- 2026-11-12"; an update's notes have none
  body: string[] // the lines under the version heading
}

// "**Video**": an area's name, on a line of its own
const AREA = /^\*\*([^*]+)\*\*$/
// An area's last line, shown dimmer so the real changes stand out
const SMALL_FIXES = /^\*\*(Small fixes|Petites corrections)\b/

// "0.13.3" → [0, 13, 3], compared number by number
function newer(a: string, b: string) {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

// The releases after `since`, up to this version, newest first (the changelog's order).
// "Unreleased" has no version number, so it's skipped.
function releasesSince(since: string): Release[] {
  const releases: Release[] = []
  let current: Release | null = null
  const french = currentLanguage() === 'fr'
  for (const line of (french ? frenchSpaces(changelogFr) : changelog).split(/\r?\n/)) {
    const heading = line.match(/^## \[(\d+\.\d+\.\d+)\](?: - (\d+)-(\d+)-(\d+))?/)
    if (heading) {
      const [, version, y, m, d] = heading
      const date = y ? new Date(+y, +m - 1, +d).getTime() : undefined // that day, local time
      releases.push((current = { version, date, body: [] }))
    }
    else if (line.startsWith('## ')) current = null
    else if (current && line.trim()) current.body.push(line)
  }
  return releases.filter((r) => newer(r.version, since) && !newer(r.version, __APP_VERSION__))
}

function ReleaseNotes({ release, showVersion }: { release: Release; showVersion: boolean }) {
  const blocks: ReactNode[] = []
  let items: string[] = []
  const flushList = () => {
    if (items.length)
      blocks.push(
        <ul key={blocks.length}>
          {items.map((item, i) => (
            <li key={i} className={SMALL_FIXES.test(item) ? 'whats-new-small' : undefined}>
              {richText(item)}
            </li>
          ))}
        </ul>
      )
    items = []
  }
  for (const line of release.body) {
    if (line.startsWith('- ')) items.push(line.slice(2))
    else {
      flushList()
      const heading = line.match(/^###\s+(.*)/) ?? line.match(AREA)
      if (heading)
        blocks.push(
          <h4 key={blocks.length} className="whats-new-area">
            {heading[1]}
          </h4>
        )
      else blocks.push(<p key={blocks.length}>{richText(line)}</p>)
    }
  }
  flushList()
  return (
    <section>
      {showVersion && (
        <h3 className="whats-new-version">
          {`v${release.version}`}
          {release.date && <span className="whats-new-date">{shortDate(release.date)}</span>}
        </h3>
      )}
      {blocks}
    </section>
  )
}

// For Settings → "What's new": the last few releases, newest first
export function recentReleases(count = 5) {
  return releasesSince('0.0.0').slice(0, count)
}

// An update's notes (update.body: its lines of both changelogs, added by build-desktop.yml), as a
// release, in the app's language. Older releases only have the English.
export function updateRelease(version: string, notes: string): Release {
  const [english, french] = notes.split(FRENCH_NOTES)
  const text = currentLanguage() === 'fr' && french ? frenchSpaces(french) : english.split(ENGLISH_END)[0]
  return { version, body: text.split(/\r?\n/).filter((line) => line.trim()) }
}

// The notes window. The title names this version (or the update's); with several releases each
// gets its own heading. With onUpdate (the update bar's "What's new"): an "Update now" button.
export function WhatsNewDialog(props: {
  releases: Release[]
  version?: string
  onUpdate?: () => void
  onClose: () => void
}) {
  const { releases, onUpdate, onClose } = props
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => dialogRef.current?.focus({ preventScroll: true }), []) // so Escape works

  return (
    <Window className="dialog whats-new" label={t("What's new")} onClose={onClose} ref={dialogRef}>
      <div className="dialog-head">
        <h2>{t("What's new in v{version}", { version: props.version ?? __APP_VERSION__ })}</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="whats-new-body">
        {releases.map((r) => (
          <ReleaseNotes key={r.version} release={r} showVersion={releases.length > 1} />
        ))}
      </div>
      {onUpdate && (
        <div className="dialog-buttons">
          <button className="primary" onClick={onUpdate}>
            {t('Update now')}
          </button>
        </div>
      )}
    </Window>
  )
}

function WhatsNew() {
  // The version it shows changes since. Not the texts: those follow the language while it's open.
  const [since, setSince] = useState<string | null>(() => {
    const seen = read<string | null>(SEEN_KEY, null)
    return seen && newer(__APP_VERSION__, seen) ? seen : null
  })

  // Remember this version right away, so the popup shows only once (even if the app is closed with it open)
  useEffect(() => write(SEEN_KEY, __APP_VERSION__), [])

  const releases = since ? releasesSince(since) : []
  if (!releases.length) return null
  return <WhatsNewDialog releases={releases} onClose={() => setSince(null)} />
}

export default WhatsNew
