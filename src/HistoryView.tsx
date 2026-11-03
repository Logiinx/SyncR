import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import BackButton from './BackButton'
import { clockTime, nearDay, shortDate } from './dates'
import { noteTitle, type Note } from './db'
import { isConnected } from './dropbox'
import { listVersions, type VersionInfo } from './historySync'
import { hashOf } from './noteHistory'
import { useNarrow } from './useNarrow'

// Note history (noteHistory.ts): the older versions of a note, over the note like a conflict
// compare. The list is read from Dropbox each time it opens, so it needs sync and internet
// (useHistoryAvailable). On the PC the list is on the left, the chosen version on the right.

// True while the history can be read: Dropbox connected and online
export function useHistoryAvailable() {
  const check = () => isConnected() && navigator.onLine
  const [available, setAvailable] = useState(check)
  useEffect(() => {
    const update = () => setAvailable(check())
    for (const event of ['online', 'offline']) window.addEventListener(event, update)
    window.addEventListener('dropbox-change', update)
    return () => {
      for (const event of ['online', 'offline']) window.removeEventListener(event, update)
      window.removeEventListener('dropbox-change', update)
    }
  }, [])
  return available
}

const DEVICES: Record<string, string> = { pc: 'PC', phone: 'Phone', browser: 'Browser' }

function HistoryView({ note, onClose }: { note: Note; onClose: () => void }) {
  const narrow = useNarrow()
  const [versions, setVersions] = useState<VersionInfo[] | 'loading' | 'error'>('loading')
  const [currentHash, setCurrentHash] = useState<string>()

  function load() {
    setVersions('loading')
    listVersions(note.id).then(setVersions, (e) => {
      console.warn('Could not load the note history', e)
      setVersions('error')
    })
  }
  useEffect(load, [note.id])

  // Which version is the same as the note now
  useEffect(() => {
    void hashOf(note).then(setCurrentHash)
  }, [note])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Grouped by day, newest first
  const days: { label: string; versions: VersionInfo[] }[] = []
  for (const version of Array.isArray(versions) ? versions : []) {
    const label = nearDay(version.savedAt) ?? shortDate(version.savedAt)
    if (days[days.length - 1]?.label !== label) days.push({ label, versions: [] })
    days[days.length - 1].versions.push(version)
  }

  return (
    <div className="compare">
      <div className="compare-header">
        <BackButton onClick={onClose} title="Back to the note" />
        <span className="compare-title">History</span>
        <span className="history-note-title">{noteTitle(note)}</span>
      </div>
      <div className="history-body">
        <div className="history-list">
          {versions === 'loading' &&
            Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="history-row">
                <span className="skeleton" style={{ width: 42 }} />
                <span className="skeleton" style={{ width: 70 }} />
              </div>
            ))}
          {versions === 'error' && (
            <div className="history-message">
              Couldn't load the history.
              <button className="setting-button" onClick={load}>
                Try again
              </button>
            </div>
          )}
          {Array.isArray(versions) && !versions.length && (
            <div className="history-message">
              No older versions yet. One is saved when you stop editing for a few minutes, leave the
              note or close the app.
            </div>
          )}
          {days.map((day) => (
            <div key={day.label}>
              <div className="history-day">{day.label}</div>
              {day.versions.map((version) => (
                <VersionRow key={version.path} version={version} current={version.hash === currentHash} />
              ))}
            </div>
          ))}
        </div>
        {!narrow && <div className="history-detail">Pick a version to compare it with the note.</div>}
      </div>
    </div>
  )
}

function VersionRow({ version, current }: { version: VersionInfo; current: boolean }) {
  const { added, removed } = version
  return (
    <div className="history-row">
      <span className="history-time">{clockTime(version.savedAt)}</span>
      <span className="history-device">{DEVICES[version.device] ?? version.device}</span>
      <span
        className="history-change"
        title={`${added} ${added === 1 ? 'word' : 'words'} added, ${removed} removed since the version before`}
      >
        {added || removed ? (
          <>
            {added > 0 && <span className="history-added">+{added}</span>}
            {removed > 0 && <span className="history-removed">−{removed}</span>}
          </>
        ) : (
          'formatting'
        )}
      </span>
      {version.protected && (
        <span className="history-warn" title="Saved just before a lot of text was removed">
          <TriangleAlert size={13} />
        </span>
      )}
      {current && <span className="history-current">same as now</span>}
    </div>
  )
}

export default HistoryView
