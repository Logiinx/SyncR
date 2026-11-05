import { useEffect, useMemo, useRef, useState } from 'react'
import { plural, t } from './i18n'
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

const deviceName = (device: string) => (device === 'pc' ? 'PC' : device === 'phone' ? t('Phone') : device === 'browser' ? t('Browser') : device)

const dayLabel = (time: number) => nearDay(time) ?? shortDate(time)

type Mode = 'diff' | 'text'
const modes = (): { value: Mode; label: string }[] => [
  { value: 'diff', label: t('Differences') },
  { value: 'text', label: t('Full text') },
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

  // The picked version once it's loaded, compared with the note as it is now
  const openText = selected && loaded && 'text' in loaded ? loaded.text : null
  const rows = useMemo(() => (openText ? diffNotes(openText.content, note.content) : []), [openText, note.content])

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
      title: t('Restore this version?'),
      message: t("The note's text is replaced by the version from {when}. The text it has now stays in History, so you can go back to it.", { when: when(version) }),
      confirmLabel: t('Restore'),
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

  // In the top bar on the PC, in a row of their own under it on the phone (no room)
  const controls = selected && openText && (
    <VersionControls
      version={selected}
      changes={rows.filter((row) => row.op !== 'same').length}
      narrow={narrow}
      mode={mode}
      onMode={setMode}
      onRestore={() => askRestore(selected, openText)}
    />
  )

  return (
    <div className="compare">
      <div className="compare-header">
        <BackButton onClick={back} title={back === onClose ? t('Back to the note') : t('Back to the list')} />
        <span className="compare-divider" />
        <span className="history-title" title={noteTitle(note)}>
          {t('History of')} <strong>{noteTitle(note)}</strong>
        </span>
        {!narrow && controls}
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
                {t("Couldn't load the history.")}
                <button className="setting-button" onClick={load}>
                  {t('Try again')}
                </button>
              </div>
            )}
            {Array.isArray(versions) && !versions.length && (
              <div className="history-message">
                {t('No older versions yet. One is saved when you stop editing for a few minutes, leave the note or close the app.')}
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
              <div className="history-hint">{t('Pick a version to compare it with the note.')}</div>
            ) : 'text' in loaded ? (
              <>
                {narrow && <div className="history-detail-head">{controls}</div>}
                {/* A new view for each version (folded lines start folded again) */}
                {mode === 'diff' ? (
                  <CompareBody key={selected.path} rows={rows} narrow={narrow} leftTitle={t('This version · {when}', { when: when(selected) })} rightTitle={t('Now')} />
                ) : (
                  <FullText key={selected.path} text={loaded.text} />
                )}
              </>
            ) : loaded.state === 'loading' ? (
              <div className="history-hint">
                <span className="skeleton" style={{ width: 220 }} />
              </div>
            ) : loaded.state === 'passphrase' ? (
              <div className="history-hint">{t('Enter your sync passphrase on this device to see older versions.')}</div>
            ) : (
              <div className="history-hint">
                {t("Couldn't load this version.")}
                <button className="setting-button" onClick={() => pick(selected)}>
                  {t('Try again')}
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

// What goes with the chosen version: how it's shown (compared with the note now, or alone),
// how many differences, Restore. The count sits before the switch on the PC, so the switch stays
// under the mouse when the count goes away (Full text).
interface VersionControlsProps {
  version: VersionInfo
  changes: number
  narrow: boolean
  mode: Mode
  onMode: (mode: Mode) => void
  onRestore: () => void
}

function VersionControls({ version, changes, narrow, mode, onMode, onRestore }: VersionControlsProps) {
  const fill = <FillSwitch className="history-switch" options={modes()} value={mode} onChange={onMode} label={t('Show')} />
  const count = mode === 'diff' && (
    <span className="compare-title">
      {changes ? plural(changes, '{n} difference', '{n} differences') : t('No differences')}
    </span>
  )
  return (
    <>
      {!narrow && count}
      {fill}
      {narrow && count}
      {narrow && mode === 'diff' && (
        <span className="compare-legend">
          <span className="cmp-removed">{t('only in this version')}</span>
          <span className="cmp-added">{t('only now')}</span>
          <span className="cmp-formatted">{t('formatting')}</span>
        </span>
      )}
      {narrow && <span className="history-device">{when(version)}</span>}
      <span className="compare-actions">
        <button onClick={onRestore} disabled={!changes} title={t('Put this version back into the note')}>
          {t('Restore this version')}
        </button>
      </span>
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
      <span className="history-device">{deviceName(version.device)}</span>
      <span
        className="history-change"
        title={plural(added, '{n} word added, {removed} removed since the version before', '{n} words added, {removed} removed since the version before', { removed })}
      >
        {added || removed ? (
          <>
            {added > 0 && <span className="history-added">+{added}</span>}
            {removed > 0 && <span className="history-removed">−{removed}</span>}
          </>
        ) : (
          t('formatting')
        )}
      </span>
      {version.protected && (
        <span className="history-warn" title={t('Saved just before a lot of text was removed')}>
          <TriangleAlert size={13} />
        </span>
      )}
      {current && <span className="history-current">{t('same as now')}</span>}
    </button>
  )
}

export default HistoryView
