import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { TriangleAlert, X } from 'lucide-react'
import { db, deleteNote, noteTitle, saveNoteContent, type Note } from './db'
import Dialog, { type DialogRequest } from './Dialog'
import { diffNotes, type Line, type Row, type Segment, type Token } from './noteDiff'
import { useNarrow } from './useNarrow'

// A conflict copy (made by sync when a note changed on two devices, sync.ts) shows a banner
// above it. "Compare" opens the comparison with its original: side by side on the PC,
// one merged view on the phone. Long unchanged parts are folded so the differences stand out.
// "Keep original" deletes the copy; "Keep this copy" puts the copy's text into the original
// note (same note, so links and tabs to it keep working) and deletes the copy. Both ask first.

const CONTEXT = 1 // unchanged lines kept visible around a change
const FOLD_MIN = 3 // fold only runs of at least this many unchanged lines

export function ConflictBanner({ note }: { note: Note }) {
  // 'loading' until the database answers; undefined = the original was deleted
  const original = useLiveQuery(() => db.notes.get(note.conflictOf!), [note.conflictOf], 'loading' as const)
  const [comparing, setComparing] = useState(false)
  if (original === 'loading') return null

  return (
    <>
      <div className="conflict-banner">
        <TriangleAlert size={15} />
        {original ? (
          <>
            <span>
              Conflict copy of <strong>{noteTitle(original)}</strong>
            </span>
            <button onClick={() => setComparing(true)}>Compare</button>
          </>
        ) : (
          <span>Conflict copy (its original note was deleted)</span>
        )}
      </div>
      {comparing && original && <ConflictCompare original={original} copy={note} onClose={() => setComparing(false)} />}
    </>
  )
}

function ConflictCompare({ original, copy, onClose }: { original: Note; copy: Note; onClose: () => void }) {
  const rows = useMemo(() => diffNotes(original.content, copy.content), [original.content, copy.content])
  const narrow = useNarrow() // phone: one merged view instead of two columns
  // Folded runs of unchanged lines the user opened (by the index of their first row)
  const [opened, setOpened] = useState<Set<number>>(new Set())
  const changes = rows.filter((row) => row.op !== 'same').length
  const [dialog, setDialog] = useState<DialogRequest | null>(null)

  // Done: the copy is deleted, the original opens in its place (App.tsx)
  function finish() {
    deleteNote(copy.id)
    window.dispatchEvent(new CustomEvent('open-note', { detail: { id: original.id, close: copy.id } }))
  }

  function keepOriginal() {
    setDialog({
      title: 'Keep the original?',
      message: `This conflict copy will be deleted; "${noteTitle(original)}" stays as it is. This can't be undone.`,
      confirmLabel: 'Keep original',
      danger: true,
      onConfirm: finish,
    })
  }

  function keepCopy() {
    setDialog({
      title: 'Keep this copy?',
      message: `Its text replaces the text of "${noteTitle(original)}", and this copy is deleted. This can't be undone.`,
      confirmLabel: 'Keep this copy',
      danger: true,
      onConfirm: async () => {
        await saveNoteContent(original.id, copy.content!, copy.text)
        finish()
      },
    })
  }

  // Escape closes (but while the confirmation is open, Escape is for that)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !dialog && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, dialog])

  // Which rows are shown: changes, plus a little context; the rest folds into one line
  const parts = useMemo(() => fold(rows, opened), [rows, opened])

  return (
    <div className="compare">
      <div className="compare-header">
        <span className="compare-title">
          {changes ? `${changes} ${changes === 1 ? 'difference' : 'differences'}` : 'No differences'}
        </span>
        {narrow && (
          <span className="compare-legend">
            <span className="cmp-removed">only in the original</span>
            <span className="cmp-added">only in this copy</span>
            <span className="cmp-formatted">formatting</span>
          </span>
        )}
        <span className="compare-actions">
          <button onClick={keepOriginal}>Keep original</button>
          <button onClick={keepCopy} disabled={!copy.content}>
            Keep this copy
          </button>
        </span>
        <button className="compare-close" onClick={onClose} title="Close (Esc)">
          <X size={16} />
        </button>
      </div>

      <div className={`compare-body${narrow ? ' merged' : ' columns'}`}>
        {!narrow && (
          <>
            <div className="compare-side-title">Original · {noteTitle(original)}</div>
            <div className="compare-side-title">This copy</div>
          </>
        )}
        {parts.map((part) =>
          part.folded ? (
            <button
              key={`fold-${part.start}`}
              className="compare-fold"
              onClick={() => setOpened(new Set(opened).add(part.start))}
            >
              ⋯ {part.rows.length} unchanged lines
            </button>
          ) : (
            part.rows.map((row, k) => (
              <Fragment key={part.start + k}>{narrow ? <MergedRow row={row} /> : <SideRows row={row} />}</Fragment>
            ))
          ),
        )}
      </div>
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
    </div>
  )
}

// ---------- Folding unchanged lines ----------

interface Part {
  start: number // index of the first row
  rows: Row[]
  folded: boolean
}

function fold(rows: Row[], opened: Set<number>): Part[] {
  const parts: Part[] = []
  let i = 0
  while (i < rows.length) {
    if (rows[i].op !== 'same') {
      parts.push({ start: i, rows: [rows[i]], folded: false })
      i++
      continue
    }
    let end = i
    while (end < rows.length && rows[end].op === 'same') end++
    // Keep CONTEXT lines next to a change (none at the very start or end of the note)
    const keepBefore = i > 0 ? CONTEXT : 0
    const keepAfter = end < rows.length ? CONTEXT : 0
    const hidden = end - i - keepBefore - keepAfter
    if (hidden >= FOLD_MIN && !opened.has(i + keepBefore)) {
      if (keepBefore) parts.push({ start: i, rows: rows.slice(i, i + keepBefore), folded: false })
      parts.push({ start: i + keepBefore, rows: rows.slice(i + keepBefore, end - keepAfter), folded: true })
      if (keepAfter) parts.push({ start: end - keepAfter, rows: rows.slice(end - keepAfter, end), folded: false })
    } else {
      parts.push({ start: i, rows: rows.slice(i, end), folded: false })
    }
    i = end
  }
  return parts
}

// ---------- Side by side (PC) ----------

// One row = a left cell (original) and a right cell (this copy); an empty cell where a line
// exists on one side only
function SideRows({ row }: { row: Row }) {
  switch (row.op) {
    case 'same':
      return (
        <>
          <LineView line={row.line} className="cmp-cell" />
          <LineView line={row.line} className="cmp-cell" />
        </>
      )
    case 'removed':
      return (
        <>
          <LineView line={row.line} className="cmp-cell cmp-line-removed" />
          <div className="cmp-cell cmp-empty" />
        </>
      )
    case 'added':
      return (
        <>
          <div className="cmp-cell cmp-empty" />
          <LineView line={row.line} className="cmp-cell cmp-line-added" />
        </>
      )
    case 'changed':
      return (
        <>
          <LineView line={row.before} className="cmp-cell cmp-line-changed" prefixClass={kindChanged(row) ? 'cmp-removed' : ''}>
            {row.segments.map((s, i) => (s.type === 'added' ? null : <SegmentView key={i} segment={s} side="before" />))}
          </LineView>
          <LineView line={row.after} className="cmp-cell cmp-line-changed" prefixClass={kindChanged(row) ? 'cmp-added' : ''}>
            {row.segments.map((s, i) => (s.type === 'removed' ? null : <SegmentView key={i} segment={s} side="after" />))}
          </LineView>
        </>
      )
  }
}

// ---------- Merged (phone) ----------

function MergedRow({ row }: { row: Row }) {
  switch (row.op) {
    case 'same':
      return <LineView line={row.line} className="cmp-cell" />
    case 'removed':
      return <LineView line={row.line} className="cmp-cell cmp-line-removed cmp-strike" />
    case 'added':
      return <LineView line={row.line} className="cmp-cell cmp-line-added" />
    case 'changed':
      // A changed checkbox / list type: the old marker struck, then the new one
      return (
        <LineView
          line={row.after}
          className="cmp-cell cmp-line-changed"
          prefixClass={kindChanged(row) ? 'cmp-added' : ''}
          before={kindChanged(row) ? <span className="cmp-removed cmp-strike">{marker(row.before)}</span> : null}
        >
          {row.segments.map((s, i) => (
            <SegmentView key={i} segment={s} side="merged" />
          ))}
        </LineView>
      )
  }
}

const kindChanged = (row: Extract<Row, { op: 'changed' }>) => row.before.kind !== row.after.kind

// ---------- One line ----------

function marker(line: Line): string {
  switch (line.kind) {
    case 'bullet':
      return '•'
    case 'numbered':
      return line.number ?? '1.'
    case 'task':
      return '☐'
    case 'task-done':
      return '☑'
    case 'section':
      return '›'
    default:
      return ''
  }
}

interface LineProps {
  line: Line
  className: string
  prefixClass?: string
  before?: ReactNode // shown before the marker (merged view: the old marker)
  children?: ReactNode // the line's words; by default all of them, unmarked
}

function LineView({ line, className, prefixClass = '', before, children }: LineProps) {
  const mark = marker(line)
  return (
    <div className={`${className} cmp-kind-${line.kind}`} style={{ paddingLeft: `${8 + line.depth * 16}px` }}>
      {before}
      {mark && <span className={`cmp-marker ${prefixClass}`}>{mark}</span>}
      <span className="cmp-text">{children ?? <Tokens tokens={line.tokens} />}</span>
    </div>
  )
}

function SegmentView({ segment, side }: { segment: Segment; side: 'before' | 'after' | 'merged' }) {
  switch (segment.type) {
    case 'same':
      return <Tokens tokens={segment.tokens} />
    case 'removed':
      return <Tokens tokens={segment.tokens} className={side === 'merged' ? 'cmp-removed cmp-strike' : 'cmp-removed'} />
    case 'added':
      return <Tokens tokens={segment.tokens} className="cmp-added" />
    case 'formatted':
      return <Tokens tokens={side === 'before' ? segment.before! : segment.tokens} className="cmp-formatted" />
  }
}

// Words with their formatting, as in the note (bold, italic, color, highlight, link…)
function Tokens({ tokens, className }: { tokens: Token[]; className?: string }) {
  const content = tokens.map((token, i) => <TokenView key={i} token={token} />)
  return className ? <span className={className}>{content}</span> : <>{content}</>
}

function TokenView({ token }: { token: Token }) {
  if (token.text === '\n') return <br />
  let node: ReactNode = token.text
  const style: CSSProperties = {}
  for (const mark of token.marks ?? []) {
    if (mark.type === 'bold') node = <strong>{node}</strong>
    else if (mark.type === 'italic') node = <em>{node}</em>
    else if (mark.type === 'underline') node = <u>{node}</u>
    else if (mark.type === 'strike') node = <s>{node}</s>
    else if (mark.type === 'code') node = <code>{node}</code>
    else if (mark.type === 'link') node = <span className="cmp-link">{node}</span>
    else if (mark.type === 'textStyle' && mark.attrs?.color) style.color = mark.attrs.color
    else if (mark.type === 'highlight' && mark.attrs?.color) style.background = mark.attrs.color
  }
  return Object.keys(style).length ? <span style={style}>{node}</span> : <>{node}</>
}
