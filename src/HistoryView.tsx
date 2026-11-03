import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { TriangleAlert } from 'lucide-react'
import BackButton from './BackButton'
import { CompareBody } from './ConflictCompare'
import { clockTime, nearDay, shortDate } from './dates'
import { noteTitle, type Note } from './db'
import Dialog, { type DialogRequest } from './Dialog'
import { listVersions, loadVersion, NeedsPassphraseError, type VersionInfo, type VersionText } from './historySync'
import { hashOf, restoreVersion } from './noteHistory'
import { extensions } from './NoteEditor'
import { diffNotes } from './noteDiff'
import { FillSwitch } from './tabLines'
import { useNarrow } from './useNarrow'

// Note history (noteHistory.ts): the older versions of a note, over the note like a conflict
// compare. The list is read from Dropbox each time it opens, so it needs sync and internet
// (useHistoryAvailable). Picking a version compares it with the note as it is now: on the PC
// the list stays on the left, on the phone the comparison replaces the list ("‹ Back" returns).
// "Full text" shows the version alone (read only), to select and copy parts of it; "Restore this
// version" puts it back into the note (noteHistory.ts restoreVersion), after asking.

const DEVICES: Record<string, string> = { pc: 'PC', phone: 'Phone', browser: 'Browser' }

const dayLabel = (time: number) => nearDay(time) ?? shortDate(time)

type Mode = 'diff' | 'text'
const MODES: { value: Mode; label: string }[] = [
  { value: 'diff', label: 'Differences' },
  { value: 'text', label: 'Full text' },
]

type Loaded = { path: string; text: VersionText } | { path: string; state: 'loading' | 'error' | 'passphrase' }

function HistoryView({ note, onClose }: { note: Note; onClose: () => void }) {
  const narrow = useNarrow()
  const [versions, setVersions] = useState<VersionInfo[] | 'loading' | 'error'>('loading')
  const [currentHash, setCurrentHash] = useState<string>()
  const [selected, setSelected] = useState<VersionInfo | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  // Versions already read (they never change), by path
  const cache = useRef(new Map<string, VersionText>())
  const [mode, setMode] = useState<Mode>('diff')
  const [dialog, setDialog] = useState<DialogRequest | null>(null)

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

  function pick(version: VersionInfo) {
    setSelected(version)
    const known = cache.current.get(version.path)
    if (known) return setLoaded({ path: version.path, text: known })
    setLoaded({ path: version.path, state: 'loading' })
    loadVersion(version).then(
      (text) => {
        cache.current.set(version.path, text)
        // Unless another version was picked meanwhile
        setLoaded((now) => (now?.path === version.path ? { path: version.path, text } : now))
      },
      (e) => {
        if (!(e instanceof NeedsPassphraseError)) console.warn('Could not load the version', e)
        const state = e instanceof NeedsPassphraseError ? 'passphrase' : 'error'
        setLoaded((now) => (now?.path === version.path ? { path: version.path, state } : now))
      },
    )
  }

  // Phone with a version open: back to the list. Otherwise: back to the note.
  const back = narrow && selected ? () => setSelected(null) : onClose
  // (While the question is open, Escape is for that)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !dialog && back()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [back, dialog])

  function askRestore(version: VersionInfo, text: VersionText) {
    setDialog({
      title: 'Restore this version?',
      message: `The note's text is replaced by the version from ${when(version)}. The text it has now stays in History, so you can go back to it.`,
      confirmLabel: 'Restore',
      onConfirm: async () => {
        await restoreVersion(note.id, text)
        onClose()
      },
    })
  }

  // Grouped by day, newest first
  const days: { label: string; versions: VersionInfo[] }[] = []
  for (const version of Array.isArray(versions) ? versions : []) {
    const label = dayLabel(version.savedAt)
    if (days[days.length - 1]?.label !== label) days.push({ label, versions: [] })
    days[days.length - 1].versions.push(version)
  }

  const showList = !narrow || !selected
  const showDetail = !narrow || selected

  return (
    <div className="compare">
      <div className="compare-header">
        <BackButton onClick={back} title={back === onClose ? 'Back to the note' : 'Back to the list'} />
        <span className="compare-title">History</span>
        <span className="history-note-title">{noteTitle(note)}</span>
      </div>
      <div className="history-body">
        {showList && (
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
                No older versions yet. One is saved when you stop editing for a few minutes, leave
                the note or close the app.
              </div>
            )}
            {days.map((day) => (
              <div key={day.label}>
                <div className="history-day">{day.label}</div>
                {day.versions.map((version) => (
                  <VersionRow
                    key={version.path}
                    version={version}
                    current={version.hash === currentHash}
                    selected={version.path === selected?.path}
                    onClick={() => pick(version)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
        {showDetail && (
          <div className="history-detail">
            {!selected || !loaded ? (
              <div className="history-hint">Pick a version to compare it with the note.</div>
            ) : 'text' in loaded ? (
              <VersionCompare
                version={selected}
                text={loaded.text}
                note={note}
                narrow={narrow}
                mode={mode}
                onMode={setMode}
                onRestore={() => askRestore(selected, loaded.text)}
              />
            ) : loaded.state === 'loading' ? (
              <div className="history-hint">
                <span className="skeleton" style={{ width: 220 }} />
              </div>
            ) : loaded.state === 'passphrase' ? (
              <div className="history-hint">Enter your sync passphrase on this device to see older versions.</div>
            ) : (
              <div className="history-hint">
                Couldn't load this version.
                <button className="setting-button" onClick={() => pick(selected)}>
                  Try again
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
    </div>
  )
}

const when = (version: VersionInfo) => `${dayLabel(version.savedAt)}, ${clockTime(version.savedAt)}`

// The chosen version: compared with the note now (left / right; on the phone merged), or alone
interface VersionCompareProps {
  version: VersionInfo
  text: VersionText
  note: Note
  narrow: boolean
  mode: Mode
  onMode: (mode: Mode) => void
  onRestore: () => void
}

function VersionCompare({ version, text, note, narrow, mode, onMode, onRestore }: VersionCompareProps) {
  const rows = useMemo(() => diffNotes(text.content, note.content), [text.content, note.content])
  const changes = rows.filter((row) => row.op !== 'same').length
  return (
    <>
      <div className="history-detail-head">
        <FillSwitch className="history-switch" options={MODES} value={mode} onChange={onMode} label="Show" />
        {mode === 'diff' && (
          <span className="compare-title">
            {changes ? `${changes} ${changes === 1 ? 'difference' : 'differences'}` : 'No differences'}
          </span>
        )}
        {narrow && mode === 'diff' && (
          <span className="compare-legend">
            <span className="cmp-removed">only in this version</span>
            <span className="cmp-added">only now</span>
            <span className="cmp-formatted">formatting</span>
          </span>
        )}
        {narrow && <span className="history-device">{when(version)}</span>}
        <span className="compare-actions">
          <button onClick={onRestore} disabled={!changes} title="Put this version back into the note">
            Restore this version
          </button>
        </span>
      </div>
      {/* A new view for each version (folded lines start folded again) */}
      {mode === 'diff' ? (
        <CompareBody key={version.path} rows={rows} narrow={narrow} leftTitle={`This version · ${when(version)}`} rightTitle="Now" />
      ) : (
        <FullText key={version.path} text={text} />
      )}
    </>
  )
}

// The version as it looks in the note, read only: select and copy (with its formatting)
function FullText({ text }: { text: VersionText }) {
  const editor = useEditor({ extensions, content: text.content, editable: false })
  return (
    <div className="history-text">
      <EditorContent editor={editor} className="editor" />
    </div>
  )
}

function VersionRow(props: { version: VersionInfo; current: boolean; selected: boolean; onClick: () => void }) {
  const { version, current, selected, onClick } = props
  const { added, removed } = version
  return (
    <button className={`history-row${selected ? ' selected' : ''}`} onClick={onClick}>
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
    </button>
  )
}

export default HistoryView
