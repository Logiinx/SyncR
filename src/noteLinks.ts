import { Extension, type Editor, type JSONContent } from '@tiptap/react'
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model'
import { liveQuery } from 'dexie'
import { db, noteTitle } from './db'

// Links between notes, to a note or to one block in it (paragraph, heading, list item,
// section, …). A link is a normal link with the address syncr:note/<noteId>#<blockId>.
// A block only gets an id (attribute blockId) when a link to it is copied, so opening or
// syncing notes never changes them. Ids are random, so they survive edits, renames and moves.

const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'listItem',
  'taskItem',
  'details',
  'codeBlock',
  'blockquote',
  'table',
  'image',
  'horizontalRule',
]

export const PROTOCOL = 'syncr'

export interface LinkTarget {
  noteId: string
  blockId: string | null
}

export function noteLinkHref({ noteId, blockId }: LinkTarget) {
  return `${PROTOCOL}:note/${noteId}${blockId ? `#${blockId}` : ''}`
}

export function parseNoteLink(href: string): LinkTarget | null {
  const match = /^syncr:note\/([\w-]+)(?:#([\w-]+))?$/.exec(href)
  return match ? { noteId: match[1], blockId: match[2] ?? null } : null
}

// ---------- Which notes and block ids exist (for broken links and tooltips) ----------

interface NoteInfo {
  title: string
  blockIds: Set<string>
}

let targets = new Map<string, NoteInfo>()
const listeners = new Set<() => void>()
let watching = false

function collectBlockIds(content: JSONContent | null, ids = new Set<string>()) {
  if (content?.attrs?.blockId) ids.add(content.attrs.blockId)
  content?.content?.forEach((child) => collectBlockIds(child, ids))
  return ids
}

// Starts once; re-reads whenever a note is saved, synced or deleted
function watchTargets() {
  if (watching) return
  watching = true
  liveQuery(() => db.notes.toArray()).subscribe((notes) => {
    targets = new Map(notes.map((n) => [n.id, { title: noteTitle(n), blockIds: collectBlockIds(n.content) }]))
    listeners.forEach((listener) => listener())
  })
}

export function linkTargetTitle(href: string): string | null {
  const target = parseNoteLink(href)
  return target ? (targets.get(target.noteId)?.title ?? null) : null
}

function isBroken(target: LinkTarget, doc: PMNode) {
  const note = targets.get(target.noteId)
  if (!note) return true
  if (!target.blockId || note.blockIds.has(target.blockId)) return false
  // Just linked inside this note and not saved yet
  return findBlock(doc, target.blockId) === null
}

// ---------- The extension: block ids + dimming broken links ----------

const brokenKey = new PluginKey<DecorationSet>('brokenNoteLinks')
// The block just jumped to, highlighted for a moment (set/cleared with a meta: position or null)
const flashKey = new PluginKey<DecorationSet>('linkFlash')

export const NoteLinks = Extension.create({
  name: 'noteLinks',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false, // Enter in a linked paragraph: the new one is a different block
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attributes) => (attributes.blockId ? { 'data-block-id': attributes.blockId } : {}),
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    watchTargets()
    return [
      // Copy + paste in the same note would give two blocks the same id: the copy loses it.
      // (Cut + paste keeps it: the original is gone by then, so links still work.)
      new Plugin({
        props: {
          transformPasted: (slice, view) => {
            const existing = new Set<string>()
            view.state.doc.descendants((node) => {
              if (node.attrs.blockId) existing.add(node.attrs.blockId)
            })
            return existing.size ? stripIds(slice, existing) : slice
          },
        },
      }),
      // A decoration, not a class set on the element: ProseMirror would remove that again
      new Plugin({
        key: flashKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => {
            const flash: number | null | undefined = tr.getMeta(flashKey)
            if (flash === undefined) return old.map(tr.mapping, tr.doc)
            const node = flash === null ? null : tr.doc.nodeAt(flash)
            if (flash === null || !node) return DecorationSet.empty
            return DecorationSet.create(tr.doc, [
              Decoration.node(flash, flash + node.nodeSize, { class: 'link-flash' }),
            ])
          },
        },
        props: { decorations: (state) => flashKey.getState(state) },
      }),
      new Plugin({
        key: brokenKey,
        state: {
          init: (_, state) => brokenDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(brokenKey) ? brokenDecorations(tr.doc) : old),
        },
        props: { decorations: (state) => brokenKey.getState(state) },
        // Another note was deleted or changed: check again
        view: (view) => {
          const refresh = () => view.dispatch(view.state.tr.setMeta(brokenKey, true))
          listeners.add(refresh)
          return { destroy: () => listeners.delete(refresh) }
        },
      }),
    ]
  },
})

function stripIds(slice: Slice, existing: Set<string>): Slice {
  const mapFragment = (fragment: Fragment): Fragment => {
    const children: PMNode[] = []
    fragment.forEach((child) => children.push(fix(child)))
    return Fragment.fromArray(children)
  }
  const fix = (node: PMNode): PMNode => {
    if (node.isText) return node
    const attrs = existing.has(node.attrs.blockId) ? { ...node.attrs, blockId: null } : node.attrs
    return node.type.create(attrs, mapFragment(node.content), node.marks)
  }
  return new Slice(mapFragment(slice.content), slice.openStart, slice.openEnd)
}

function brokenDecorations(doc: PMNode) {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const link = node.marks.find((mark) => mark.type.name === 'link')
    const target = link && parseNoteLink(link.attrs.href ?? '')
    if (target && isBroken(target, doc)) {
      decorations.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'broken-link' }))
    }
  })
  return DecorationSet.create(doc, decorations)
}

function findBlock(doc: PMNode, blockId: string): number | null {
  let found: number | null = null
  doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.attrs.blockId === blockId) found = pos
  })
  return found
}

// ---------- Copying a link (selection menu) ----------

// The innermost linkable block around the cursor. In a section's title: the section.
function blockAtCursor(editor: Editor): { pos: number; node: PMNode } | null {
  const { $from } = editor.state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (BLOCK_TYPES.includes(node.type.name)) return { pos: $from.before(d), node }
  }
  return null
}

const EXCERPT_LENGTH = 40

// Puts a link to the block at the cursor on the clipboard: as a ready link (pasting it into a
// note shows "Note title › start of the block") and as the plain address. Nothing is awaited
// before writing: browsers only allow it right after the click.
export async function copyLinkToBlock(editor: Editor, noteId: string, title: string) {
  const block = blockAtCursor(editor)
  let blockId: string | null = null
  if (block) {
    blockId = block.node.attrs.blockId
    if (!blockId) {
      blockId = crypto.randomUUID().slice(0, 8)
      // Not an undo step: undoing it would quietly break the copied link
      editor.view.dispatch(
        editor.state.tr.setNodeAttribute(block.pos, 'blockId', blockId).setMeta('addToHistory', false),
      )
    }
  }

  const blockText =
    block?.node.type.name === 'details' ? block.node.firstChild?.textContent : block?.node.textContent
  const excerpt = blockText?.trim().slice(0, EXCERPT_LENGTH) ?? ''
  const label = excerpt && excerpt !== title ? `${title} › ${excerpt}` : title
  const href = noteLinkHref({ noteId, blockId })

  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([`<a href="${escape(href)}">${escape(label)}</a>`], { type: 'text/html' }),
        'text/plain': new Blob([href], { type: 'text/plain' }),
      }),
    ])
  } catch {
    await navigator.clipboard.writeText(href)
  }
}

// ---------- Following a link ----------

// App.tsx opens the note; the note's editor then jumps to the block (see jumpToBlock)
let pendingJump: LinkTarget | null = null
let notFoundHandler: (message: string) => void = () => {}
let openNoteHandler: (noteId: string) => void = () => {}

export function onFollowLink(openNote: (noteId: string) => void, notFound: (message: string) => void) {
  openNoteHandler = openNote
  notFoundHandler = notFound
}

export async function followNoteLink(href: string) {
  const target = parseNoteLink(href)
  if (!target) return
  if (!(await db.notes.get(target.noteId))) {
    notFoundHandler('Link target not found: the note was deleted.')
    return
  }
  pendingJump = target
  openNoteHandler(target.noteId)
  window.dispatchEvent(new Event('syncr-jump')) // the note may already be open
}

// Called by the note's editor when it opens and on 'syncr-jump'
export function takePendingJump(noteId: string): LinkTarget | null {
  if (pendingJump?.noteId !== noteId) return null
  const target = pendingJump
  pendingJump = null
  return target
}

const FLASH_MS = 1600

// Opens the sections around the block, scrolls it to the middle and briefly highlights it
export function jumpToBlock(editor: Editor, blockId: string) {
  const { view } = editor
  const pos = findBlock(view.state.doc, blockId)
  if (pos === null) {
    notFoundHandler('Link target not found: that part of the note was deleted. The note is open.')
    return
  }
  // Closed sections around it (and the block itself, if it's a section): open them
  const $pos = view.state.doc.resolve(pos + 1)
  for (let d = 1; d <= $pos.depth; d++) {
    if ($pos.node(d).type.name !== 'details') continue
    const section = view.nodeDOM($pos.before(d)) as HTMLElement | null
    if (section && !section.classList.contains('is-open')) {
      section.querySelector<HTMLButtonElement>(':scope > button')?.click()
    }
  }
  view.dispatch(
    view.state.tr
      .setSelection(Selection.near(view.state.doc.resolve(pos + 1)))
      .setMeta(flashKey, pos)
      .setMeta('addToHistory', false),
  )
  const element = view.nodeDOM(pos) as HTMLElement | null
  element?.scrollIntoView({ block: 'center' })
  setTimeout(() => {
    if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(flashKey, null))
  }, FLASH_MS)
}
