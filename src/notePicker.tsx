import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Extension, ReactRenderer, type Editor, type JSONContent } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { ChevronRight, FileText, FoldVertical, Heading } from 'lucide-react'
import { db, noteTitle, saveNoteContent } from './db'
import { noteLinkHref } from './noteLinks'
import { mountPopup } from './slashMenu'
import { closeCopy } from './animations'

// Type [[ to link to another note: a list of notes, filtered by what you type next.
// Enter links to the whole note. Tab, → or the › button shows the note's headings and
// sections ("[[Title#…"); Enter then links to that part. Esc closes.

declare module '@tiptap/core' {
  interface Storage {
    notePicker: { noteId: string | null } // the note being edited (set by NoteEditor)
  }
}

interface PickItem {
  key: string
  noteId: string
  title: string // the note's title
  part: string | null // heading or section title; null = the whole note
  path: number[] // where the part is in the note's content (child indexes)
  blockId: string | null
  depth: number // sections inside sections, for indenting
  kind: 'note' | 'heading' | 'section'
  current: boolean // the note being edited
}

const MAX_NOTES = 30

const textOf = (node?: JSONContent): string => node?.text ?? node?.content?.map(textOf).join('') ?? ''

type Part = Omit<PickItem, 'noteId' | 'title' | 'current' | 'key'>

// Headings and section titles of a note, in order
function outline(content: JSONContent | null | undefined, path: number[] = [], depth = 0, out: Part[] = []) {
  content?.content?.forEach((child, index) => {
    const childPath = [...path, index]
    if (child.type === 'heading') {
      out.push({ part: textOf(child) || 'Heading', path: childPath, blockId: child.attrs?.blockId ?? null, depth, kind: 'heading' })
    } else if (child.type === 'details') {
      out.push({ part: textOf(child.content?.[0]) || 'Section', path: childPath, blockId: child.attrs?.blockId ?? null, depth, kind: 'section' })
      outline(child, childPath, depth + 1, out)
      return
    }
    outline(child, childPath, depth, out)
  })
  return out
}

async function findItems(query: string, editor: Editor): Promise<PickItem[]> {
  const currentId = editor.storage.notePicker.noteId
  const notes = await db.notes.orderBy('updatedAt').reverse().toArray()
  const hash = query.lastIndexOf('#')

  if (hash === -1) {
    const q = query.trim().toLowerCase()
    return notes
      .filter((note) => noteTitle(note).toLowerCase().includes(q))
      .slice(0, MAX_NOTES)
      .map((note) => ({
        key: note.id,
        noteId: note.id,
        title: noteTitle(note),
        part: null,
        path: [],
        blockId: null,
        depth: 0,
        kind: 'note',
        current: note.id === currentId,
      }))
  }

  // "[[Title#part": the parts of that note
  const noteQuery = query.slice(0, hash).trim().toLowerCase()
  const partQuery = query.slice(hash + 1).trim().toLowerCase()
  const note =
    notes.find((n) => noteTitle(n).toLowerCase() === noteQuery) ??
    notes.find((n) => noteTitle(n).toLowerCase().includes(noteQuery))
  if (!note) return []
  const current = note.id === currentId
  // The note being edited: its newest content is in the editor, not saved yet
  const content = current ? editor.getJSON() : note.content
  const base = { noteId: note.id, title: noteTitle(note), current }
  const parts = outline(content)
    .filter((p) => p.part!.toLowerCase().includes(partQuery))
    .map((p) => ({ ...base, ...p, key: `${note.id}/${p.path.join('.')}` }))
  const whole: PickItem = { ...base, key: note.id, part: null, path: [], blockId: null, depth: 0, kind: 'note' }
  return partQuery ? parts : [whole, ...parts]
}

// A part without an id gets one, saved in its note (in the editor if it's the open note)
function ensureBlockId(item: PickItem, editor: Editor): string | null {
  if (item.part === null) return null
  if (item.blockId) return item.blockId
  const blockId = crypto.randomUUID().slice(0, 8)
  if (item.current) {
    // Child indexes → document position
    let node = editor.state.doc
    let pos = -1
    for (const index of item.path) {
      let offset = pos + 1
      for (let i = 0; i < index; i++) offset += node.child(i).nodeSize
      pos = offset
      node = node.child(index)
    }
    editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'blockId', blockId).setMeta('addToHistory', false))
  } else {
    db.notes.get(item.noteId).then((note) => {
      if (!note?.content) return
      const content = structuredClone(note.content)
      let node: JSONContent | undefined = content
      for (const index of item.path) node = node?.content?.[index]
      // The note may have changed since the list was shown (e.g. sync): check it's still that part
      if (node?.type !== (item.kind === 'heading' ? 'heading' : 'details')) return
      node.attrs = { ...node.attrs, blockId }
      return saveNoteContent(note.id, content, note.text)
    })
  }
  return blockId
}

function insertLink(editor: Editor, range: { from: number; to: number }, item: PickItem) {
  const blockId = ensureBlockId(item, editor)
  const href = noteLinkHref({ noteId: item.noteId, blockId })
  const label = item.part ? `${item.title} › ${item.part}` : item.title
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] },
      { type: 'text', text: ' ' },
    ])
    .run()
}

export const NotePicker = Extension.create({
  name: 'notePicker',

  addStorage() {
    return { noteId: null as string | null }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      Suggestion<PickItem, PickItem>({
        editor,
        pluginKey: new PluginKey('notePicker'),
        char: '[[',
        allowSpaces: true, // note titles have spaces
        allowedPrefixes: null, // anywhere, also right after a word
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        placement: 'bottom-start',
        items: ({ query }) => findItems(query, editor),
        command: ({ editor, range, props }) => insertLink(editor, range, props),
        render: () => {
          let component: ReactRenderer<PickerHandle, PickerProps> | null = null
          let unmount: (() => void) | undefined
          return {
            onStart: (props) => {
              component = new ReactRenderer(NotePickerList, { props, editor: props.editor, className: 'slash-menu-popup' })
              unmount = mountPopup(props, component.element as HTMLElement)
            },
            onUpdate: (props) => component?.updateProps(props),
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') return false // the plugin closes the menu
              return component?.ref?.onKeyDown(props) ?? false
            },
            onExit: () => {
              if (component) closeCopy(component.element as HTMLElement)
              unmount?.()
              component?.destroy()
              component = null
            },
          }
        },
      }),
    ]
  },
})

type PickerProps = SuggestionProps<PickItem, PickItem>

interface PickerHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

const ICONS = { note: FileText, heading: Heading, section: FoldVertical }

// Same look as the "/" menu
const NotePickerList = forwardRef<PickerHandle, PickerProps>(function NotePickerList(
  { items, command, editor, range, query },
  ref,
) {
  const [selected, setSelected] = useState(0)
  // "[[Title#…": the list shows one note's parts, otherwise it lists notes
  const showsNotes = !query.includes('#')
  useEffect(() => setSelected(0), [items])

  // Show the note's headings and sections: the typed text becomes "[[Title#"
  function openNote(item: PickItem) {
    editor.chain().focus().insertContentAt(range, `[[${item.title}#`).run()
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false // nothing matches: keys work as usual
      const item = items[selected]
      if (event.key === 'ArrowDown') {
        setSelected((selected + 1) % items.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        setSelected((selected + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        command(item)
        return true
      }
      // Into a note (only in the list of notes)
      if ((event.key === 'Tab' || event.key === 'ArrowRight') && showsNotes) {
        openNote(item)
        return true
      }
      return false
    },
  }))

  if (items.length === 0) return null

  return (
    <div className="slash-menu note-picker" role="listbox">
      {items.map((item, index) => {
        const Icon = ICONS[item.kind]
        const label = item.part ?? (showsNotes ? item.title : 'Whole note')
        return (
          <div
            key={item.key}
            className={index === selected ? 'picker-row selected' : 'picker-row'}
            onMouseEnter={() => setSelected(index)}
          >
            <button
              role="option"
              aria-selected={index === selected}
              style={{ paddingLeft: 10 + item.depth * 14 }}
              // Keep the cursor (and the phone keyboard) in the note
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(item)}
            >
              <Icon size={16} />
              <span className="picker-label" title={label}>{label}</span>
              {item.current && showsNotes && <span className="picker-hint">this note</span>}
            </button>
            {showsNotes && (
              <button
                className="picker-into"
                title="Link to a heading or section in this note (Tab)"
                aria-label="Show headings and sections"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => openNote(item)}
              >
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
})

