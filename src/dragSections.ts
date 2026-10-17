import { Extension } from '@tiptap/react'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { currentZoom } from './appearance'

// Section titles: press and drag a title to move its section, with everything inside.
// A quick click opens/closes the section (and puts the cursor in the title, so a second click
// edits it). While the cursor is already in that title, it behaves like normal text
// (click, select). Phone: hold the title a moment before dragging, so a swipe still scrolls;
// holding drags even while editing the title (a tap still places the cursor). While the
// finger is down, the title is briefly not editable (CSS: not selectable), otherwise Android's
// own long press selects its words and opens the keyboard, which cancels the drag.
// The browser's own drag of selected text is blocked when the selection touches a title:
// dropping part of a title elsewhere made new, broken sections.
// Mouse over a title that isn't being edited: the section is framed (faint tint, two corner
// brackets like the app icon) and the pointer is a grab hand, so moving it and editing the
// title look different.
// While dragging, a copy of the title follows the pointer and a blue line shows where the
// section will land: between any two blocks, also inside another section.

const DRAG_DISTANCE = 5 // px (mouse) before a press becomes a drag
const HOLD_MS = 300 // touch: hold this long before the section can be dragged
const TOUCH_SLOP = 8 // px a finger may move during the hold; more = it's a swipe (scroll)
const SCROLL_EDGE = 40 // px from the top/bottom of the page where dragging scrolls it
const SCROLL_STEP = 12 // px scrolled per pointer move near an edge

// Where sections can be: in the note itself or inside another section
const CONTAINERS = new Set(['doc', 'detailsContent'])

interface Drop {
  pos: number // where the section will be inserted
  line: { top: number; left: number; width: number } // the blue line, in client pixels
}

interface Press {
  pointerId: number
  touch: boolean
  editing: boolean // the cursor was already in this title (touch only: a tap places the cursor)
  x: number
  y: number
  summary: HTMLElement // the title that was pressed
  section: HTMLElement // its section
  from: number | null // the section's position in the document, once dragging
  drop: Drop | null
  holdTimer?: number
}

export const DragSections = Extension.create({
  name: 'dragSections',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: (view) => new SectionDragger(view),
        props: { handleDOMEvents: { dragstart: blockTitleDrag } },
      }),
    ]
  },
})

// Native drag of selected text that touches a section title: blocked
function blockTitleDrag(view: EditorView, e: DragEvent) {
  const { from, to } = view.state.selection
  let touchesTitle = false
  view.state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'detailsSummary') touchesTitle = true
    return !touchesTitle
  })
  if (!touchesTitle) return false
  e.preventDefault()
  return true
}

class SectionDragger {
  view: EditorView
  wrapper: HTMLElement // the element around the editor; the line and the title copy go in it
  line: HTMLElement
  ghost: HTMLElement | null = null // copy of the title that follows the pointer
  press: Press | null = null
  hovered: HTMLElement | null = null // the framed section (mouse over its title)

  constructor(view: EditorView) {
    this.view = view
    this.wrapper = view.dom.parentElement!
    this.wrapper.classList.add('has-section-drag')

    this.line = document.createElement('div')
    this.line.className = 'section-drop-line'
    this.line.hidden = true
    this.wrapper.append(this.line)

    view.dom.addEventListener('pointerdown', this.onPointerDown)
    view.dom.addEventListener('pointermove', this.onHover)
    view.dom.addEventListener('pointerleave', this.onLeave)
    // Added once, not at each press: Chrome decides when a touch starts whether a touchmove
    // listener may block scrolling. One added later only gets moves it can't cancel.
    view.dom.addEventListener('touchmove', this.blockScroll, { passive: false })
  }

  // ---------- Framing the section under the mouse ----------

  // Is the cursor already in this title? Then it's being edited: plain text behaviour.
  editingTitle(summary: HTMLElement) {
    const { $from } = this.view.state.selection
    return $from.parent.type.name === 'detailsSummary' && $from.start() === this.view.posAtDOM(summary, 0)
  }

  onHover = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || this.press) return
    const summary = (e.target as HTMLElement).closest<HTMLElement>('summary')
    const section = summary?.closest<HTMLElement>('[data-type="details"]') ?? null
    this.frame(summary && this.view.editable && !this.editingTitle(summary) ? section : null)
  }

  onLeave = () => this.frame(null)

  frame(section: HTMLElement | null) {
    if (section === this.hovered) return
    this.hovered?.classList.remove('section-hover')
    section?.classList.add('section-hover')
    this.hovered = section
  }

  // Called by ProseMirror after every change: the cursor may have moved into the framed title
  update() {
    const summary = this.hovered?.querySelector<HTMLElement>('summary')
    if (this.hovered && (!this.hovered.isConnected || !summary || this.editingTitle(summary))) this.frame(null)
  }

  // ---------- Pressing a title ----------

  onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.press || !this.view.editable) return
    const summary = (e.target as HTMLElement).closest<HTMLElement>('summary')
    const section = summary?.closest<HTMLElement>('[data-type="details"]')
    if (!summary || !section || !this.view.dom.contains(section)) return
    const touch = e.pointerType === 'touch'
    const editing = this.editingTitle(summary)
    // Mouse, already editing this title: normal text behaviour (place the cursor, select)
    if (editing && !touch) return

    // No cursor or text selection yet: it's a click (open/close) or a drag, decided on release.
    // Touch while editing: a tap places the cursor as usual, a hold drags.
    if (!editing) e.preventDefault()
    this.press = { pointerId: e.pointerId, touch, editing, x: e.clientX, y: e.clientY, summary, section, from: null, drop: null }
    if (touch) this.press.holdTimer = window.setTimeout(() => this.startDrag(), HOLD_MS)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.cancel)
    if (touch) {
      // ProseMirror ignores changes to this attribute
      summary.contentEditable = 'false'
      window.addEventListener('contextmenu', this.blockMenu, true)
    }
  }

  onPointerMove = (e: PointerEvent) => {
    const press = this.press
    if (!press || e.pointerId !== press.pointerId) return
    if (press.from === null) {
      const distance = Math.hypot(e.clientX - press.x, e.clientY - press.y)
      if (press.touch) {
        if (distance > TOUCH_SLOP) this.cancel() // a swipe: let the page scroll
        return
      }
      if (distance < DRAG_DISTANCE) return
      this.startDrag()
      if (!this.press || this.press.from === null) return // the section was gone
    }
    this.autoScroll(e.clientY)
    this.moveGhost(e.clientY)
    press.drop = this.findDrop(e.clientX, e.clientY, press.from!)
    this.showLine(press.drop)
  }

  onPointerUp = (e: PointerEvent) => {
    const press = this.press
    if (!press || e.pointerId !== press.pointerId) return
    if (press.from !== null) {
      if (press.drop) this.move(press.from, press.drop.pos, press.section.classList.contains('is-open'))
    } else if (!press.editing) {
      this.clickTitle(press)
    }
    this.cancel()
  }

  // A click (or tap) on a title: open/close the section, and put the cursor where it was
  // clicked, so a second click edits the title
  clickTitle(press: Press) {
    // Layout: <div data-type="details"><button>(arrow)</button><div><summary>…
    const toggle = press.section.querySelector(':scope > button')
    if (toggle instanceof HTMLButtonElement) toggle.click()
    const hit = this.view.posAtCoords({ left: press.x, top: press.y })
    this.view.focus()
    if (hit) {
      const { state } = this.view
      this.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(hit.pos))))
    }
  }

  // Once dragging: the section fades, a copy of its title follows the pointer
  startDrag() {
    const press = this.press
    if (!press) return
    press.from = this.sectionPos(press.section)
    if (press.from === null) return this.cancel()
    window.clearTimeout(press.holdTimer)
    this.wrapper.classList.add('dragging-section')
    this.frame(null)
    press.section.classList.add('section-lifted')

    const zoom = currentZoom()
    this.ghost = document.createElement('div')
    this.ghost.className = 'section-ghost'
    this.ghost.textContent = press.summary.textContent?.trim() || 'Section'
    this.ghost.style.left = `${(press.summary.getBoundingClientRect().left - this.wrapper.getBoundingClientRect().left) / zoom}px`
    this.ghost.style.maxWidth = `${press.section.getBoundingClientRect().width / zoom}px`
    this.wrapper.append(this.ghost)
    this.moveGhost(press.y)
  }

  moveGhost(y: number) {
    if (!this.ghost) return
    const zoom = currentZoom()
    // Centered on the pointer's height, in CSS pixels inside the zoomed page
    this.ghost.style.top = `${(y - this.wrapper.getBoundingClientRect().top) / zoom - this.ghost.offsetHeight / 2}px`
  }

  // Touch: once the section moves, the finger mustn't scroll the page or open the long-press menu
  blockScroll = (e: TouchEvent) => {
    if (this.press && this.press.from !== null) e.preventDefault()
  }

  blockMenu = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }

  cancel = () => {
    const press = this.press
    if (!press) return
    window.clearTimeout(press.holdTimer)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.cancel)
    window.removeEventListener('contextmenu', this.blockMenu, true)
    if (press.touch) press.summary.removeAttribute('contenteditable')
    press.section.classList.remove('section-lifted')
    this.ghost?.remove()
    this.ghost = null
    this.line.hidden = true
    this.wrapper.classList.remove('dragging-section')
    this.press = null
  }

  // Position of the section node in the document (null if it's gone)
  sectionPos(section: HTMLElement): number | null {
    if (!section.isConnected) return null
    const $inside = this.view.state.doc.resolve(this.view.posAtDOM(section, 0))
    for (let d = $inside.depth; d > 0; d--) {
      const pos = $inside.before(d)
      if (this.view.nodeDOM(pos) === section) return pos
    }
    return null
  }

  // ---------- Where it lands ----------

  // The block under the pointer whose parent can hold a section; drop above or below it,
  // depending on which half the pointer is in. Not inside the dragged section itself.
  findDrop(x: number, y: number, from: number): Drop | null {
    const { view } = this
    const editorRect = view.dom.getBoundingClientRect()
    // Pointer left/right of the text: look at the text column at the same height
    const left = Math.min(Math.max(x, editorRect.left + 40), editorRect.right - 40)
    const hit = view.posAtCoords({ left, top: y })
    if (!hit) return null
    const doc = view.state.doc
    const node = doc.nodeAt(from)!
    const $pos = doc.resolve(hit.pos)
    for (let d = $pos.depth; d > 0; d--) {
      if (!CONTAINERS.has($pos.node(d - 1).type.name)) continue
      const blockPos = $pos.before(d)
      const block = $pos.node(d)
      const dom = view.nodeDOM(blockPos) as HTMLElement | null
      if (!dom) return null
      const rect = dom.getBoundingClientRect()
      const before = y < rect.top + rect.height / 2
      const pos = before ? blockPos : blockPos + block.nodeSize
      // Inside (or right at the edges of) the dragged section: no move
      if (pos >= from && pos <= from + node.nodeSize) return null
      return { pos, line: { top: before ? rect.top : rect.bottom, left: rect.left, width: rect.width } }
    }
    return null
  }

  showLine(drop: Drop | null) {
    this.line.hidden = !drop
    if (!drop) return
    const zoom = currentZoom()
    const wrapperRect = this.wrapper.getBoundingClientRect()
    this.line.style.top = `${(drop.line.top - wrapperRect.top) / zoom}px`
    this.line.style.left = `${(drop.line.left - wrapperRect.left) / zoom}px`
    this.line.style.width = `${drop.line.width / zoom}px`
  }

  // Near the top/bottom of the page, scroll it so long notes can be crossed
  autoScroll(y: number) {
    const page = this.wrapper.closest('.page')
    if (!page) return
    const rect = page.getBoundingClientRect()
    if (y < rect.top + SCROLL_EDGE) page.scrollTop -= SCROLL_STEP
    else if (y > rect.bottom - SCROLL_EDGE) page.scrollTop += SCROLL_STEP
  }

  // One step, so one Ctrl+Z puts it back. The cursor stays where it was before the drag
  // (if it was inside the moved section, it moves with it). An open section stays open.
  move(from: number, to: number, wasOpen: boolean) {
    const { view } = this
    const node = view.state.doc.nodeAt(from)
    if (!node) return
    const { anchor, head } = view.state.selection
    const end = from + node.nodeSize
    const cursorInside = anchor > from && anchor < end && head > from && head < end
    // Outside the section, the transaction maps the cursor along
    const tr = view.state.tr.delete(from, end)
    const insertAt = tr.mapping.map(to)
    view.dispatch(tr.insert(insertAt, node))

    // Open/closed isn't part of the document, so the moved copy is drawn closed: reopen it
    const dom = view.nodeDOM(insertAt)
    const toggle = dom instanceof HTMLElement ? dom.querySelector(':scope > button') : null
    if (wasOpen && toggle instanceof HTMLButtonElement) toggle.click()
    // Then the cursor can go back inside (Details keeps it out of closed sections)
    if (cursorInside) {
      const shift = insertAt - from
      const { doc } = view.state
      view.dispatch(view.state.tr.setSelection(TextSelection.between(doc.resolve(anchor + shift), doc.resolve(head + shift))))
    }
  }

  destroy() {
    this.cancel()
    this.line.remove()
    this.frame(null)
    this.view.dom.removeEventListener('pointerdown', this.onPointerDown)
    this.view.dom.removeEventListener('pointermove', this.onHover)
    this.view.dom.removeEventListener('pointerleave', this.onLeave)
    this.view.dom.removeEventListener('touchmove', this.blockScroll)
    this.wrapper.classList.remove('has-section-drag', 'dragging-section')
  }
}
