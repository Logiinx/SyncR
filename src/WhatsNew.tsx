import { useEffect, useRef, useState, type ReactNode } from 'react'
import changelog from '../CHANGELOG.md?raw'
import { read, write } from './localState'

// After an update, shows once what changed since the version last used on this device.
// The text comes from CHANGELOG.md, built into the app. A new device shows nothing.

const SEEN_KEY = 'syncr.lastVersion'

interface Release {
  version: string
  body: string[] // the lines under the version heading
}

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
  for (const line of changelog.split(/\r?\n/)) {
    const heading = line.match(/^## \[(\d+\.\d+\.\d+)\]/)
    if (heading) releases.push((current = { version: heading[1], body: [] }))
    else if (line.startsWith('## ')) current = null
    else if (current && line.trim()) current.body.push(line)
  }
  return releases.filter((r) => newer(r.version, since) && !newer(r.version, __APP_VERSION__))
}

// **bold** → <strong>, the only formatting the changelog uses
function inline(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))
}

function ReleaseNotes({ release, showVersion }: { release: Release; showVersion: boolean }) {
  const blocks: ReactNode[] = []
  let items: string[] = []
  const flushList = () => {
    if (items.length)
      blocks.push(
        <ul key={blocks.length}>
          {items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>
      )
    items = []
  }
  for (const line of release.body) {
    if (line.startsWith('- ')) items.push(line.slice(2))
    else {
      flushList()
      const heading = line.match(/^###\s+(.*)/)
      if (heading) blocks.push(<h3 key={blocks.length}>{heading[1]}</h3>)
      else blocks.push(<p key={blocks.length}>{inline(line)}</p>)
    }
  }
  flushList()
  return (
    <section>
      {showVersion && <h3 className="whats-new-version">v{release.version}</h3>}
      {blocks}
    </section>
  )
}

// For Settings → "What's new": the last few releases, newest first
export function recentReleases(count = 5) {
  return releasesSince('0.0.0').slice(0, count)
}

// The notes window. The title names this version; with several releases each gets its own heading.
export function WhatsNewDialog({ releases, onClose }: { releases: Release[]; onClose: () => void }) {
  const okRef = useRef<HTMLButtonElement>(null)
  useEffect(() => okRef.current?.focus(), [])

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog whats-new"
        role="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>What's new in v{__APP_VERSION__}</h2>
        <div className="whats-new-body">
          {releases.map((r) => (
            <ReleaseNotes key={r.version} release={r} showVersion={releases.length > 1} />
          ))}
        </div>
        <div className="dialog-buttons">
          <button ref={okRef} className="primary" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

function WhatsNew() {
  const [releases, setReleases] = useState<Release[]>(() => {
    const seen = read<string | null>(SEEN_KEY, null)
    return seen && newer(__APP_VERSION__, seen) ? releasesSince(seen) : []
  })

  // Remember this version right away, so the popup shows only once (even if the app is closed with it open)
  useEffect(() => write(SEEN_KEY, __APP_VERSION__), [])

  if (!releases.length) return null
  return <WhatsNewDialog releases={releases} onClose={() => setReleases([])} />
}

export default WhatsNew
