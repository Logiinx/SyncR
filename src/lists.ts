import { Extension, type Editor } from '@tiptap/react'
import { Plugin, Selection, TextSelection } from '@tiptap/pm/state'

// Adds an empty item after the (empty) first item the cursor is in, and moves there
function addSecondItem(editor: Editor) {
  const { state, view } = editor
  const { $from } = state.selection
  const after = $from.after(-1)
  const tr = state.tr.insert(after, $from.node(-1).type.createAndFill()!)
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 2)).scrollIntoView())
}

// Enter in lists:
// - "1." or "-" (also "*", "+") alone on a line, then Enter: makes the list (like a space
//   would) AND goes to the next line, so you're on item 2.
// - Enter on an empty list item normally ends the list. On the very first item that feels like
//   the list was deleted, so there Enter adds a second item instead. Further down, Enter on an
//   empty item still ends the list.
// Shift+Enter does the same in these two cases (elsewhere it stays a line break inside the item).
export const ListEnter = Extension.create({
  name: 'listEnter',
  priority: 200, // before the lists' own Enter and their "1. " / "- " shortcuts

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => listEnter(editor),
      'Shift-Enter': ({ editor }) => listEnter(editor),
    }
  },
})

function listEnter(editor: Editor) {
  const { $from, empty } = editor.state.selection
  if (!empty || $from.parent.type.name !== 'paragraph') return false
  const text = $from.parent.textContent
  const inListItem = $from.depth >= 2 && ['listItem', 'taskItem'].includes($from.node(-1).type.name)

  // "1." / "-" then Enter (not inside a list already, where it would mean something else)
  const number = text.match(/^(\d+)\.$/)
  const bullet = /^[-+*]$/.test(text)
  if ((number || bullet) && !inListItem && $from.parentOffset === text.length) {
    const chain = editor.chain().deleteRange({ from: $from.start(), to: $from.pos })
    const made = number
      ? chain.toggleOrderedList().updateAttributes('orderedList', { start: Number(number[1]) }).run()
      : chain.toggleBulletList().run()
    if (made) addSecondItem(editor)
    return made
  }

  // Empty first item of a bullet or numbered list
  if (text !== '' || !inListItem) return false
  const item = $from.node(-1)
  const isFirstItem =
    item.type.name === 'listItem' &&
    item.childCount === 1 &&
    $from.index(-2) === 0 &&
    ['bulletList', 'orderedList'].includes($from.node(-2).type.name)
  if (!isFirstItem) return false
  addSecondItem(editor)
  return true
}

// "- " (also "*", "+", "1. ", "[ ] ", "[x] ") right after a line break (Ctrl+Enter, or older
// text; Shift+Enter and pasting make new lines now, lineBreaks.ts): the lists' own shortcuts only
// work at the start of a paragraph, and a line break stays inside one. Here
// the paragraph is split at the break and the part after it becomes the list, as with Enter.
export const ListAfterBreak = Extension.create({
  name: 'listAfterBreak',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        props: {
          handleTextInput: (_view, from, to, text) => text === ' ' && from === to && listAfterBreak(editor),
        },
      }),
    ]
  },
})

function listAfterBreak(editor: Editor) {
  const { $from } = editor.state.selection
  const paragraph = $from.parent
  if (paragraph.type.name !== 'paragraph') return false
  if ($from.depth >= 2 && ['listItem', 'taskItem'].includes($from.node(-1).type.name)) return false

  // The last line break before the cursor, and the text between it and the cursor
  let breakOffset = -1
  paragraph.forEach((node, offset) => {
    if (node.type.name === 'hardBreak' && offset < $from.parentOffset) breakOffset = offset
  })
  if (breakOffset < 0) return false
  const marker = paragraph.textBetween(breakOffset + 1, $from.parentOffset)
  const number = marker.match(/^(\d+)\.$/)
  const task = /^\[[ x]?\]$/.test(marker)
  if (!number && !task && !/^[-+*]$/.test(marker)) return false

  // Remove the break and the marker, split there, then make the list from the new paragraph
  const breakPos = $from.start() + breakOffset
  const chain = editor.chain().command(({ tr }) => {
    // The new paragraph doesn't take the block id: two blocks would share it (note links)
    tr.delete(breakPos, $from.pos).split(breakPos, 1, [{ type: paragraph.type, attrs: { blockId: null } }])
    tr.setSelection(TextSelection.create(tr.doc, breakPos + 2))
    return true
  })
  if (number) return chain.toggleOrderedList().updateAttributes('orderedList', { start: Number(number[1]) }).run()
  if (task) return chain.toggleTaskList().updateAttributes('taskItem', { checked: marker === '[x]' }).run()
  return chain.toggleBulletList().run()
}

// An empty line above a list (e.g. left after Backspace took the list's first item out):
// Backspace there at the very start, or Delete, removes the line. Normally Backspace does
// nothing at the start (nothing before it) and Delete pulls the next item out of its list.
export const EmptyLineAbove = Extension.create({
  name: 'emptyLineAbove',
  priority: 200, // before the editor's own Backspace and Delete

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => removeEmptyLine(editor, true),
      Delete: ({ editor }) => removeEmptyLine(editor, false),
    }
  },
})

function removeEmptyLine(editor: Editor, onlyFirstLine: boolean) {
  const { state, view } = editor
  const { $from, empty } = state.selection
  if (!empty || $from.depth !== 1 || $from.parent.type.name !== 'paragraph' || $from.parent.content.size) return false
  const index = $from.index(0)
  if (index + 1 >= state.doc.childCount || (onlyFirstLine && index > 0)) return false
  const start = $from.before()
  const tr = state.tr.delete(start, $from.after())
  view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(start))).scrollIntoView())
  return true
}
