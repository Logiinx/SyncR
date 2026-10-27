import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { Extension, ReactRenderer, type ChainedCommands, type Editor } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import {
  FoldVertical,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  SquareCode,
  Table,
  TextQuote,
  type LucideIcon,
} from 'lucide-react'
import { currentZoom } from './appearance'
import { closeCopy } from './animations'

// Type "/" at the start of a line or after a space: a menu to insert a block. Typing more
// filters it ("/tab" → Table), ↑ ↓ choose, Enter inserts, Esc closes. Not inside code.

interface SlashItem {
  title: string
  keywords: string // other words that find it
  icon: LucideIcon
  run: (chain: ChainedCommands) => ChainedCommands
}

const ITEMS: SlashItem[] = [
  { title: 'Section', keywords: 'details fold collapse toggle', icon: FoldVertical, run: (c) => c.setDetails() },
  { title: 'Code block', keywords: 'code pre snippet', icon: SquareCode, run: (c) => c.setCodeBlock() },
  { title: 'Checklist', keywords: 'todo task checkbox', icon: ListTodo, run: (c) => c.toggleTaskList() },
  { title: 'Bullet list', keywords: 'unordered list ul', icon: List, run: (c) => c.toggleBulletList() },
  { title: 'Numbered list', keywords: 'ordered list ol', icon: ListOrdered, run: (c) => c.toggleOrderedList() },
  {
    title: 'Table',
    keywords: 'grid columns rows',
    icon: Table,
    run: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }),
  },
  { title: 'Heading 1', keywords: 'title h1 big', icon: Heading1, run: (c) => c.setHeading({ level: 1 }) },
  { title: 'Heading 2', keywords: 'subtitle h2', icon: Heading2, run: (c) => c.setHeading({ level: 2 }) },
  { title: 'Heading 3', keywords: 'h3', icon: Heading3, run: (c) => c.setHeading({ level: 3 }) },
  { title: 'Quote', keywords: 'blockquote citation', icon: TextQuote, run: (c) => c.setBlockquote() },
  { title: 'Divider', keywords: 'horizontal rule line separator hr', icon: Minus, run: (c) => c.setHorizontalRule() },
]

// Only what fits at the cursor (e.g. no Quote inside a list item): editor.can() tries the
// command without changing anything
function filterItems(query: string, editor: Editor) {
  const q = query.toLowerCase()
  return ITEMS.filter(
    (item) => `${item.title} ${item.keywords}`.toLowerCase().includes(q) && item.run(editor.can().chain()).run(),
  )
}

// Shows a "/" or "[[" popup under the cursor, or over it when it doesn't fit below. Placed
// here, not by the plugin: with the app scale (CSS zoom) its numbers came out scaled twice
// and the popup landed off the window. Screen pixels are divided by the scale. Fixed, so it
// never makes the page longer. The plugin calls this again on scroll, resize, new items.
export function mountPopup(props: SuggestionProps<any, any>, element: HTMLElement) {
  element.style.visibility = 'hidden' // until placed
  return props.mount(element, {
    onPosition: () => {
      const cursor = props.clientRect?.()
      if (!cursor) return
      const box = element.getBoundingClientRect()
      const gap = 4
      const below = innerHeight - cursor.bottom - gap
      const above = cursor.top - gap
      const top = box.height <= below || below >= above ? cursor.bottom + gap : cursor.top - gap - box.height
      const left = Math.max(0, Math.min(cursor.left, innerWidth - box.width - gap))
      const zoom = currentZoom()
      Object.assign(element.style, { left: `${left / zoom}px`, top: `${top / zoom}px`, visibility: '' })
    },
  })
}

export const SlashMenu = Extension.create({
  name: 'slashMenu',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slashMenu'),
        char: '/',
        // Only after a space or at the start of a line, so "1/2" or "http://" don't open it
        allowedPrefixes: [' '],
        // allowedPrefixes only sees the text with the same formatting as the "/": after a
        // colored or bold word it thinks the "/" starts the line. Check the whole line too.
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from)
          if ($from.parent.type.spec.code) return false
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, ' ')
          return before === '' || /\s$/.test(before)
        },
        placement: 'bottom-start',
        items: ({ query, editor }) => filterItems(query, editor),
        // Remove the typed "/query", then insert the block
        command: ({ editor, range, props }) => {
          props.run(editor.chain().focus().deleteRange(range)).run()
        },
        render: () => {
          let component: ReactRenderer<SlashMenuHandle, SlashMenuListProps> | null = null
          let unmount: (() => void) | undefined
          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenuList, { props, editor: props.editor, className: 'slash-menu-popup' })
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

type SlashMenuListProps = SuggestionProps<SlashItem, SlashItem>

interface SlashMenuHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

const SlashMenuList = forwardRef<SlashMenuHandle, SlashMenuListProps>(function SlashMenuList(
  { items, command },
  ref,
) {
  const [selected, setSelected] = useState(0)
  useEffect(() => setSelected(0), [items])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false // nothing matches: keys work as usual
      if (event.key === 'ArrowDown') {
        setSelected((selected + 1) % items.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        setSelected((selected + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        command(items[selected])
        return true
      }
      return false
    },
  }))

  if (items.length === 0) return null

  return (
    <div className="slash-menu" role="listbox">
      {items.map((item, index) => (
        <button
          key={item.title}
          className={index === selected ? 'selected' : ''}
          role="option"
          aria-selected={index === selected}
          // Keep the cursor (and the phone keyboard) in the note
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setSelected(index)}
          onClick={() => command(item)}
        >
          <item.icon size={16} />
          {item.title}
        </button>
      ))}
    </div>
  )
})
