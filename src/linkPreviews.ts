import { Extension, type Editor } from '@tiptap/react'
import { locale, textKey } from './i18n'
import { Copy, Link2Off, Pencil, RectangleHorizontal } from 'lucide-react'
import type { MenuItem } from './ContextMenu'
import { Plugin, PluginKey, Selection, TextSelection, type EditorState } from '@tiptap/pm/state'
import { liveQuery } from 'dexie'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { db } from './db'
import { previewKey } from './sealing'
import { igdbProxyFetch, isComplete, loadConnection } from './igdb'
import { openLink, simplify } from './links'
import { read, write } from './localState'
import { shortDate } from './dates'
import { svgIcon, type SvgIconName } from './svgIcons'
import { animationsOn, growOpen, shrinkThen } from './animations'

// Link cards: a website link in a note is shown as a small card (title, description, picture),
// so you know what it is without opening it. The page is read by our proxy (/preview in
// proxy/igdb-worker.js: a web page can't read other sites itself) and kept in a cache on this
// device (db.linkPreviews, not synced). Nothing is stored in the note: the card is drawn over
// the link, which stays a normal link (an older app just shows the link).

export interface LinkPreview {
  url: string
  kind: 'github' | 'tweet' | 'reddit' | 'page'
  site: string | null
  title: string | null
  description: string | null
  image: string | null
  icon: string | null
  stars?: number | null // github
  language?: string | null // github
  author?: string | null // tweet, reddit ("u/name")
  handle?: string | null // tweet
  likes?: number | null // tweet
  date?: number | null // tweet
  score?: number | null // reddit: votes
  comments?: number | null // reddit (none for a comment)
}

// ---------- Settings (per device) ----------

// off · B one line · C card (two lines) · D large card (Discord-like)
export const CARD_STYLES = { off: textKey('Off'), line: textKey('One line'), card: textKey('Card'), large: textKey('Large card') }
export type CardStyle = keyof typeof CARD_STYLES
// The card shown while the mouse is on a link (PC): off · small (the text the inline card cut) · large
export const HOVER_SIZES = { off: textKey('Off'), small: textKey('Small'), large: textKey('Large') }
export type HoverSize = keyof typeof HOVER_SIZES
// 2+ lines in a row holding only a link card: as today (list), side by side, as chips, or folded
export const GROUP_STYLES = { list: textKey('List'), grid: textKey('Grid'), chips: textKey('Chips'), folded: textKey('Folded') }
export type GroupStyle = keyof typeof GROUP_STYLES

export interface LinkPreviewSettings {
  style: CardStyle
  hover: HoverSize
  groups: GroupStyle
  allSites: boolean // every link, or only links to `sites` (and their subdomains)
  sites: string[]
  plain: string[] // addresses shown as plain links ("Show as plain link" in the right-click menu)
}

const SETTINGS_KEY = 'syncr.linkPreviews'
export const DEFAULT_SITES = ['github.com', 'fxtwitter.com', 'x.com', 'twitter.com']
const DEFAULTS: LinkPreviewSettings = { style: 'card', hover: 'large', groups: 'list', allSites: false, sites: DEFAULT_SITES, plain: [] }

// Read on every redraw, so kept in memory
let settings: LinkPreviewSettings | undefined

export function loadLinkPreviewSettings(): LinkPreviewSettings {
  settings ??= { ...DEFAULTS, ...read<Partial<LinkPreviewSettings>>(SETTINGS_KEY, {}) }
  if (!(settings.style in CARD_STYLES)) settings.style = DEFAULTS.style
  if (!(settings.hover in HOVER_SIZES)) settings.hover = DEFAULTS.hover
  if (!(settings.groups in GROUP_STYLES)) settings.groups = DEFAULTS.groups
  return settings
}

export function saveLinkPreviewSettings(change: Partial<LinkPreviewSettings>) {
  settings = { ...loadLinkPreviewSettings(), ...change }
  write(SETTINGS_KEY, settings)
  redrawAll()
}

// "https://www.GitHub.com/x, x.com" → ["github.com", "x.com"]
export function parseSites(text: string) {
  const sites = text
    .split(/[\s,;]+/)
    .map((site) => site.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0])
    .filter(Boolean)
  return [...new Set(sites)]
}

// A link gets a card when its text is its address (links with their own text stay as they are)
// and it goes to one of the chosen sites
function wantsCard(href: string, text: string, settings: LinkPreviewSettings) {
  return settings.style !== 'off' && simplify(href) === simplify(text) && forChosenSite(href, settings) && !settings.plain.includes(href)
}

// A web link to one of the chosen sites (or any, with "All links")
function forChosenSite(href: string, settings: LinkPreviewSettings) {
  let host: string
  try {
    const url = new URL(href)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    host = url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return false
  }
  return settings.allSites || settings.sites.some((site) => host === site || host.endsWith(`.${site}`))
}

// ---------- Cache ----------

const FRESH_FOR = 14 * 24 * 3600_000 // then read again (a repo's description or stars change)
const RETRY_AFTER = 24 * 3600_000 // a page that couldn't be read
// Raised when the proxy's answers change: older cards are read again (shown meanwhile)
const CACHE_VERSION = 3

// In memory: undefined = not asked yet, null = no card (the link stays a link)
const previews = new Map<string, LinkPreview | null>()
const asking = new Set<string>()
const views = new Set<EditorView>()

// At most 6 pages read at once, in the order asked (top of the note first): a note full of new
// links doesn't flood GitHub or fxtwitter (they may refuse a burst) or the phone's connection
const AT_ONCE = 6
let reading = 0
const waiting: (() => void)[] = []

async function readPage(url: string) {
  // A finished read hands its place straight to the next one waiting
  if (reading >= AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve))
  else reading++
  try {
    return await igdbProxyFetch('preview', JSON.stringify({ url }), 15_000)
  } finally {
    const next = waiting.shift()
    if (next) next()
    else reading--
  }
}

function redrawAll() {
  for (const view of views) view.dispatch(view.state.tr.setMeta(key, {}).setMeta('addToHistory', false))
}

// Cards arriving one after another: one redraw for all those that arrived within 50 ms
let redrawTimer: number | undefined
function redrawSoon() {
  redrawTimer ??= window.setTimeout(() => {
    redrawTimer = undefined
    redrawAll()
  }, 50)
}

// Links seen before the proxy was set up (or synced to this device): asked again once it is
const noProxy = new Set<string>()
let watchingProxy = false
function waitForProxy(url: string) {
  noProxy.add(url)
  if (watchingProxy) return
  watchingProxy = true
  liveQuery(loadConnection).subscribe((connection) => {
    if (!isComplete(connection) || noProxy.size === 0) return
    const urls = [...noProxy]
    noProxy.clear()
    for (const url of urls) void ask(url)
  })
}

async function ask(url: string) {
  if (asking.has(url)) return
  asking.add(url)
  try {
    const row = await db.linkPreviews.get(await previewKey(url))
    if (row) {
      previews.set(url, row.preview)
      redrawSoon()
      const fresh = Date.now() - row.fetchedAt < (row.preview ? FRESH_FOR : RETRY_AFTER)
      if (fresh && row.version === CACHE_VERSION) return
    }
    // No proxy set up: plain links, asked again once it is
    if (!isComplete(await loadConnection())) {
      waitForProxy(url)
      return void (row || previews.set(url, null))
    }
    const response = await readPage(url)
    // An older proxy without /preview (404) or a hiccup: plain link until the app starts again
    if (!response.ok) return void (row || previews.set(url, null))
    const answer = await response.json()
    const preview: LinkPreview | null = answer.error ? null : answer
    // Keep an older card rather than replacing it with nothing (unless the proxy changed since)
    if (!preview && row?.preview && row.version === CACHE_VERSION) return
    await db.linkPreviews.put({ url: await previewKey(url), preview, fetchedAt: Date.now(), version: CACHE_VERSION })
    previews.set(url, preview)
    redrawSoon()
  } catch {
    if (!previews.has(url)) previews.set(url, null) // offline: plain link
  } finally {
    asking.delete(url)
  }
}

// ---------- Drawing ----------

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string | null) {
  const node = document.createElement(tag)
  node.className = className
  if (text) node.textContent = text
  return node
}

// A picture that falls back to the next address, then to an empty gray square
function picture(className: string, sources: (string | null)[]) {
  const box = element('span', className)
  const next = () => {
    const source = sources.shift()
    if (source === undefined) {
      box.replaceChildren()
      return
    }
    if (!source) return next()
    const image = document.createElement('img')
    image.alt = ''
    image.referrerPolicy = 'no-referrer'
    image.draggable = false
    image.onerror = next
    image.src = source
    box.replaceChildren(image)
  }
  next()
  return box
}

const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, '')

// "1234" → "1.2K"
const count = (n: number) => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n)

// What every style shows, from the preview: title and site
function parts(href: string, preview: LinkPreview) {
  const tweet = preview.kind === 'tweet'
  return {
    title: (tweet && preview.handle ? `${preview.author ?? ''} @${preview.handle}`.trim() : preview.title) ?? href,
    site: preview.site ?? hostOf(href),
  }
}

// The dim line of extras, "first · stars · language · likes · date", for Reddit
// "first · u/name · votes · comments"; null when there are none.
// Stars, likes, votes and comments: a filled icon and the number, like a game's rating.
function extrasLine(preview: LinkPreview, first?: string) {
  const items: (string | HTMLElement)[] = first ? [first] : []
  if (preview.stars != null) items.push(counted('star', preview.stars, 'stars'))
  if (preview.language) items.push(preview.language)
  if (preview.likes != null) items.push(counted('heart', preview.likes, 'likes'))
  if (preview.kind === 'reddit' && preview.author) items.push(preview.author)
  if (preview.score != null) items.push(counted('arrowBigUp', preview.score, 'votes'))
  if (preview.comments != null) items.push(counted('messageSquare', preview.comments, 'comments'))
  if (preview.date) items.push(shortDate(preview.date))
  if (items.length === 0) return null
  const line = element('span', 'link-card-line')
  items.forEach((item, i) => (i ? line.append(' · ', item) : line.append(item)))
  return line
}

function counted(icon: SvgIconName, n: number, what: string) {
  const node = element('span', 'link-card-count', count(n))
  node.insertAdjacentHTML('afterbegin', svgIcon(icon, 12))
  node.setAttribute('aria-label', `${count(n)} ${what}`)
  return node
}

// A small icon's pictures: GitHub: the repo owner's picture, like style C; else the site's icon
const iconSources = (preview: LinkPreview) =>
  preview.kind === 'github' ? [preview.image, preview.icon] : [preview.icon, preview.image]

// B: one line as high as the text: icon, title, dim description
function lineCard(href: string, preview: LinkPreview) {
  const { title } = parts(href, preview)
  const root = element('span', 'link-card link-card-line-style')
  const label = preview.kind === 'tweet' && preview.handle ? `@${preview.handle}` : title
  root.append(picture('link-card-icon', iconSources(preview)), element('span', 'link-card-title', label))
  if (preview.description) root.append(element('span', 'link-card-line', `· ${preview.description}`))
  return root
}

// C: picture on the left, title, then "site · description"
function twoLineCard(href: string, preview: LinkPreview) {
  const { title, site } = parts(href, preview)
  const root = element('span', 'link-card')
  const text = element('span', 'link-card-text')
  text.append(element('span', 'link-card-title', title))
  text.append(element('span', 'link-card-line', preview.description ? `${site} · ${preview.description}` : site))
  root.append(picture('link-card-picture', [preview.image, preview.icon]), text)
  return root
}

// D: like Discord: site with its icon, title, description (3 lines), extras, big picture.
// GitHub's picture is the owner's avatar: not shown big.
function largeCard(href: string, preview: LinkPreview) {
  const { title, site } = parts(href, preview)
  const root = element('span', 'link-card link-card-large')
  const head = element('span', 'link-card-site')
  head.append(picture('link-card-icon', [preview.icon]), element('span', 'link-card-site-name', site))
  root.append(head, element('span', 'link-card-title', title))
  if (preview.description) root.append(element('span', 'link-card-description', preview.description))
  const extras = extrasLine(preview)
  if (extras) root.append(extras)
  if (preview.image && preview.kind !== 'github') {
    const image = picture('link-card-image', [preview.image])
    root.append(image)
  }
  return root
}

// Chips (link groups): icon and a short title, side by side
function chipCard(href: string, preview: LinkPreview) {
  const { title } = parts(href, preview)
  const root = element('span', 'link-card link-card-line-style link-card-chip')
  const tweet = preview.kind === 'tweet' && preview.handle
  const label = tweet ? `@${preview.handle}${preview.description ? ` · ${preview.description}` : ''}` : title
  root.append(picture('link-card-icon', iconSources(preview)), element('span', 'link-card-title', label))
  return root
}

const BUILDERS = { line: lineCard, card: twoLineCard, large: largeCard, chip: chipCard }
type Builder = keyof typeof BUILDERS

function card(href: string, preview: LinkPreview, style: Builder) {
  const root = BUILDERS[style](href, preview)
  root.contentEditable = 'false'
  root.dataset.href = href
  // The hover card shows the address; without it, the browser's own tooltip
  if (loadLinkPreviewSettings().hover === 'off') root.title = href
  // The card isn't a part of the text: a click opens the link, and doesn't move the cursor
  root.addEventListener('mousedown', (event) => event.preventDefault())
  root.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.detail <= 1) openLink(href) // a double-click opens it once
  })
  return root
}

// An empty image (the editor's own "separator" look: no size, no border) behind a card
function caretSpot() {
  const spot = document.createElement('img')
  spot.className = 'ProseMirror-separator'
  spot.alt = ''
  return spot
}

// A short key per preview for the widgets (a new preview object = a new key): cheaper than
// writing the whole preview out on every redraw
const previewIds = new WeakMap<LinkPreview, number>()
let lastPreviewId = 0
function previewId(preview: LinkPreview) {
  let id = previewIds.get(preview)
  if (id === undefined) previewIds.set(preview, (id = ++lastPreviewId))
  return id
}

// ---------- Hover card (PC) ----------

// The hover card for a link (links.ts shows it in place of the address tooltip), or null: hover
// cards off, not a chosen site, or not read yet (then it's read now, ready for the next hover).
// Links with their own text get one too: their card isn't shown in the note.
export function hoverCard(href: string, onInlineCard: boolean) {
  const settings = loadLinkPreviewSettings()
  if (settings.hover === 'off' || !forChosenSite(href, settings)) return null
  // A large card in the note already shows everything
  if (onInlineCard && settings.style === 'large') return null
  if (!previews.has(href)) void ask(href)
  const preview = previews.get(href)
  if (!preview) return null
  if (settings.hover === 'large') {
    const root = largeCard(href, preview)
    root.classList.add('link-hover-card')
    root.append(element('span', 'link-card-address', href))
    return root
  }
  // Small: title, the whole description, the address
  const { title, site } = parts(href, preview)
  const root = element('span', 'link-card link-card-small link-hover-card')
  root.append(element('span', 'link-card-title', title))
  if (preview.description) root.append(element('span', 'link-card-description', preview.description))
  else root.append(extrasLine(preview, site)!)
  root.append(element('span', 'link-card-address', href))
  return root
}

// ---------- Right-click menu ----------

// The link's own items for a right-click (long press) on a link card or on a link shown plain by
// "Show as plain link"; null elsewhere (the normal menu stays). canEdit: the text can be edited
// now (a Board card only while editing it). header: the card's title and address.
export function linkMenu(editor: Editor, target: HTMLElement, canEdit: boolean) {
  const card = target.closest<HTMLElement>('.link-card')
  const link = target.closest<HTMLElement>('a[href]')
  const href = card?.dataset.href ?? link?.getAttribute('href')
  if (!href || !editor.view.dom.contains(card ?? link)) return null
  const settings = loadLinkPreviewSettings()
  if (!card && !settings.plain.includes(href)) return null
  const items: MenuItem[] = [{ label: 'Copy link', icon: Copy, onClick: () => void navigator.clipboard.writeText(href) }]
  if (card) {
    const end = editor.view.posAtDOM(card, 0) // the card sits at its link's end
    items.push({
      label: 'Edit link',
      icon: Pencil,
      disabled: !canEdit,
      hint: canEdit ? undefined : 'While editing',
      onClick: () => editLink(editor, end, href),
    })
  }
  items.push(
    card
      ? { label: 'Show as plain link', icon: Link2Off, divider: true, onClick: () => saveLinkPreviewSettings({ plain: [...settings.plain, href] }) }
      : { label: 'Show as card', icon: RectangleHorizontal, divider: true, onClick: () => saveLinkPreviewSettings({ plain: settings.plain.filter((h) => h !== href) }) },
  )
  const preview = previews.get(href)
  return { items, header: { title: (preview && parts(href, preview).title) || href, subtitle: preview ? href : undefined } }
}

// The cursor at the end of the link: its address shows instead of the card, ready to edit
function editLink(editor: Editor, end: number, href: string) {
  const link = findLinks(editor.state).find((l) => l.to === end && l.href === href)
  if (link) editor.chain().focus().setTextSelection(link.to).setMeta(key, { reveal: link.from }).run()
}

interface PluginState {
  set: DecorationSet
  lines: { from: number; to: number; link: { from: number; to: number } }[] // lines holding only a link card
  shown: { from: number; to: number; link: number }[] // cards drawn: where the cursor sits beside each, its link's start
  revealed: number | null // the link showing its address while the cursor is beside it (its start)
  focused: boolean
  opened: Set<string> // folded link groups opened in this editor (first link's address)
}

const key = new PluginKey<PluginState>('linkPreviews')

// Links in the note: from, to, address, text (one link can be several pieces of text, e.g. part bold).
// Kept per version of the note: moving the cursor doesn't look through the whole note again.
type FoundLink = { from: number; to: number; href: string; text: string }
const linksOf = new WeakMap<EditorState['doc'], FoundLink[]>()

function findLinks(state: EditorState) {
  let links = linksOf.get(state.doc)
  if (!links) linksOf.set(state.doc, (links = readLinks(state)))
  return links
}

function readLinks(state: EditorState) {
  const links: FoundLink[] = []
  state.doc.descendants((node, pos) => {
    if (!node.isText) return
    const href = node.marks.find((mark) => mark.type.name === 'link')?.attrs.href as string | undefined
    const last = links[links.length - 1]
    if (href && last && last.to === pos && last.href === href) {
      last.to = pos + node.nodeSize
      last.text += node.text
    } else if (href) links.push({ from: pos, to: pos + node.nodeSize, href, text: node.text ?? '' })
  })
  return links
}

// A line holding only a link card (spaces around it allowed): the parts of a link group
interface CardLine {
  link: ReturnType<typeof findLinks>[number]
  preview: LinkPreview
  from: number // the line (paragraph) itself
  to: number
}

// Lines next to each other (the next starts where the previous ends), 2 or more
function findGroups(lines: CardLine[]) {
  const groups: CardLine[][] = []
  for (const line of lines) {
    const last = groups[groups.length - 1]
    if (last && last[last.length - 1].to === line.from) last.push(line)
    else groups.push([line])
  }
  return groups.filter((group) => group.length > 1)
}

// A click on a folded group's line: its lines grow open or shrink shut and its arrow turns, like
// a section's. Folding it with the cursor inside: the cursor goes below the group (above it at
// the note's end), or it would keep it open.
function toggleGroup(view: EditorView, summary: HTMLElement, groupKey: string, open: boolean) {
  if (summary.classList.contains('busy')) return // still shrinking
  const lines = key.getState(view.state)?.lines ?? []
  const start = view.posAtDOM(summary, 0)
  const groupLines: number[] = [] // where each of its lines starts
  let end = start
  for (let line = lines.find((l) => l.from === end); line; line = lines.find((l) => l.from === end)) {
    groupLines.push(line.from)
    end = line.to
  }
  const lineElements = () => groupLines.map((pos) => view.nodeDOM(pos)).filter((el) => el instanceof HTMLElement)

  const toggle = () => {
    if (view.isDestroyed) return
    const tr = view.state.tr.setMeta(key, { toggle: groupKey, open }).setMeta('addToHistory', false)
    const { from, to } = view.state.selection
    if (open && to >= start && from <= end) {
      const outside = Selection.findFrom(tr.doc.resolve(end), 1, true) ?? Selection.findFrom(tr.doc.resolve(start), -1, true)
      if (outside) tr.setSelection(outside)
    }
    view.dispatch(tr)
    // The new line (a widget is made again) turns its arrow from where the old one was
    const arrow = [...view.dom.querySelectorAll('.link-group-summary')].find((el) => view.posAtDOM(el, 0) === start)?.querySelector('svg')
    if (arrow && animationsOn()) {
      const angles = [{ transform: 'rotate(0deg)' }, { transform: 'rotate(90deg)' }]
      arrow.animate(open ? angles.reverse() : angles, { duration: 150 }) // as a section's (index.css)
    }
  }
  if (!open) {
    toggle()
    lineElements().forEach(growOpen)
    return
  }
  summary.classList.add('busy')
  shrinkThen(lineElements(), toggle)
}

// "▸ icons · 6 links": a folded group's line; a click opens or closes it
function groupSummary(group: CardLine[], open: boolean, toggle: () => void) {
  const root = element('div', `link-group-summary${open ? ' open' : ''}`)
  root.contentEditable = 'false'
  root.innerHTML = CHEVRON
  for (const { preview } of group.slice(0, 8)) root.append(picture('link-card-icon', iconSources(preview)))
  root.append(element('span', 'link-group-count', `${group.length} links`))
  root.addEventListener('mousedown', (event) => event.preventDefault())
  root.addEventListener('click', toggle)
  return root
}

const CHEVRON = svgIcon('chevronRight', 14) // the same as a section's

// focused: the cursor only shows a link's address while the text is being edited (a Board card
// that isn't, or a note after clicking elsewhere, keeps its cursor at the end).
// opened: the folded groups opened in this editor.
// revealed: the link whose address shows though the cursor is only beside it (stepped in with an
// arrow key, "Edit link"). Otherwise the cursor beside a card keeps the card: a click there puts
// the cursor next to it to type or delete it, without the address taking its place mid-click.
function decorations(state: EditorState, focused: boolean, opened: Set<string>, revealed: number | null) {
  const settings = loadLinkPreviewSettings()
  const { from: selFrom, to: selTo } = state.selection
  const near = (from: number, to: number) => selTo >= from && selFrom <= to
  const touches = (from: number, to: number) => focused && near(from, to)
  const inside = (from: number, to: number) => selTo > from && selFrom < to
  const editing = (from: number, to: number) => focused && (inside(from, to) || (from === revealed && near(from, to)))
  // Still revealed while the cursor stays at or in that link; the cursor inside a link reveals it
  const links = findLinks(state)
  const keep =
    links.find((l) => l.from === revealed && near(l.from, l.to)) ??
    (focused && state.selection.empty ? links.find((l) => inside(l.from, l.to)) : undefined)
  const found: Decoration[] = []
  const shown: PluginState['shown'] = []
  const edges = new Map<number, { from: number; to: number }>() // link start → its line, spaces hidden

  // Links that get a card, and the lines that hold nothing else
  const cards: { link: ReturnType<typeof findLinks>[number]; preview: LinkPreview }[] = []
  const lines: CardLine[] = []
  for (const link of links) {
    if (!wantsCard(link.href, link.text, settings)) continue
    if (!previews.has(link.href)) void ask(link.href)
    const preview = previews.get(link.href)
    if (!preview) continue
    cards.push({ link, preview })
    const $from = state.doc.resolve(link.from)
    const [start, end] = [$from.start(), $from.end()]
    const alone =
      $from.parent.type.name === 'paragraph' &&
      !state.doc.textBetween(start, link.from).trim() &&
      !state.doc.textBetween(link.to, end).trim()
    if (alone) lines.push({ link, preview, from: $from.before(), to: $from.after() })
  }

  // Link groups: how each of their links is drawn
  const inGroup = new Map<string, Builder | null>() // "from" of the link → its look (null: hidden)
  if (settings.groups !== 'list') {
    for (const group of findGroups(lines)) {
      const groupKey = group[0].link.href
      if (settings.groups === 'folded') {
        // The cursor inside opens it (an undo, a search result)
        const open = opened.has(groupKey) || touches(group[0].from, group[group.length - 1].to)
        found.push(
          Decoration.widget(group[0].from, (view) => {
            const summary: HTMLElement = groupSummary(group, open, () => toggleGroup(view, summary, groupKey, open))
            return summary
          }, { key: `group|${open}|${group.map((line) => line.link.href).join(' ')}`, side: -1, ignoreSelection: true }),
        )
        if (!open) for (const line of group) {
          found.push(Decoration.node(line.from, line.to, { class: 'link-group-hidden' }))
          inGroup.set(String(line.link.from), null)
        }
        continue
      }
      const look: Builder = settings.groups === 'grid' ? 'card' : 'chip'
      for (const line of group) {
        found.push(Decoration.node(line.from, line.to, { class: `link-group-item link-group-${settings.groups}` }))
        inGroup.set(String(line.link.from), look)
        // Spaces around the link would take room next to the card
        if (!editing(line.link.from, line.link.to)) {
          if (line.from + 1 < line.link.from) found.push(Decoration.inline(line.from + 1, line.link.from, { class: 'link-carded' }))
          if (line.link.to < line.to - 1) found.push(Decoration.inline(line.link.to, line.to - 1, { class: 'link-carded' }))
          edges.set(line.link.from, { from: line.from + 1, to: line.to - 1 })
        }
      }
    }
  }

  for (const { link, preview } of cards) {
    const look = inGroup.has(String(link.from)) ? inGroup.get(String(link.from)) : (settings.style as Builder)
    // Hidden in a folded group, or the link being edited: the address, so it can be edited
    if (!look || editing(link.from, link.to)) continue
    // After the hidden address, so the cursor at the link's end shows after the card. The browser
    // draws no cursor right behind a card: an invisible image after it gives the cursor a place.
    found.push(
      Decoration.widget(link.to, () => card(link.href, preview, look), { key: `${look}|${settings.hover}|${link.href}|${previewId(preview)}`, side: -1, ignoreSelection: true }),
      Decoration.widget(link.to, caretSpot, { key: 'caret-spot', side: -1, raw: true }),
      Decoration.inline(link.from, link.to, { class: 'link-carded' }),
    )
    shown.push({ ...(edges.get(link.from) ?? link), link: link.from })
  }
  return {
    set: DecorationSet.create(state.doc, found),
    lines: lines.map(({ from, to, link }) => ({ from, to, link: { from: link.from, to: link.to } })),
    shown,
    revealed: keep?.from ?? null,
  }
}

// The cursor beside a card: Backspace (after it) or Delete (before it) removes the whole link,
// and an arrow key towards it shows its address, ready to edit (the next one moves into it)
function keyBesideCard(view: EditorView, event: KeyboardEvent) {
  const { selection } = view.state
  if (!selection.empty || event.shiftKey || event.altKey || event.metaKey) return false
  const pos = selection.from
  const shown = key.getState(view.state)?.shown ?? []
  const after = shown.find((c) => c.to === pos)
  const before = shown.find((c) => c.from === pos)
  const remove = event.key === 'Backspace' ? after : event.key === 'Delete' ? before : undefined
  if (remove) {
    view.dispatch(view.state.tr.delete(remove.from, remove.to).scrollIntoView())
    return true
  }
  const reveal = event.ctrlKey ? undefined : event.key === 'ArrowLeft' ? after : event.key === 'ArrowRight' ? before : undefined
  if (!reveal) return false
  view.dispatch(view.state.tr.setMeta(key, { reveal: reveal.link }).setMeta('addToHistory', false))
  return true
}

// The arrow keys into a line holding only a card: the browser finds no place for the cursor
// there (side by side in a grid or chips, it skips the whole group), so the editor moves it.
// To the link's end going back, its start going forward: the address shows, ready to edit.
const ARROWS: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

function arrowIntoCardLine(view: EditorView, event: KeyboardEvent) {
  const direction = ARROWS[event.key]
  if (!direction || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false
  const { selection, doc } = view.state
  // Not in a line of text (e.g. a gap cursor before a table): nothing to do here
  if (!selection.empty || !selection.$from.parent.isTextblock || !view.endOfTextblock(direction)) return false
  const back = direction === 'left' || direction === 'up'
  const $from = selection.$from
  const edge = back ? $from.before() : $from.after()
  const line = key.getState(view.state)?.lines.find((l) => (back ? l.to === edge : l.from === edge))
  if (!line) return false
  const target = back ? line.link.to : line.link.from
  view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, target)).setMeta(key, { reveal: line.link.from }).scrollIntoView())
  return true
}

export const LinkPreviews = Extension.create({
  name: 'linkPreviews',

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key,
        state: {
          init: (_, state) => ({ ...decorations(state, false, new Set(), null), focused: false, opened: new Set() }),
          apply: (tr, old, _oldState, state) => {
            const meta = tr.getMeta(key) as { focused?: boolean; toggle?: string; open?: boolean; reveal?: number } | undefined
            // The cursor only changes what's drawn while the text is being edited (focused)
            if (!tr.docChanged && !meta && (!tr.selectionSet || !old.focused)) return old
            const focused = meta?.focused ?? old.focused
            let opened = old.opened
            if (meta?.toggle) {
              // open: as the group was shown when clicked (also when the cursor opened it)
              opened = new Set(opened)
              if (meta.open) opened.delete(meta.toggle)
              else opened.add(meta.toggle)
            }
            const revealed = meta?.reveal ?? (old.revealed === null ? null : tr.mapping.map(old.revealed))
            return { ...decorations(state, focused, opened, revealed), focused, opened }
          },
        },
        props: {
          decorations: (state) => key.getState(state)?.set,
          handleKeyDown: (view, event) => keyBesideCard(view, event) || arrowIntoCardLine(view, event),
          handleDOMEvents: {
            focus: (view) => (view.dispatch(view.state.tr.setMeta(key, { focused: true }).setMeta('addToHistory', false)), false),
            blur: (view) => (view.dispatch(view.state.tr.setMeta(key, { focused: false }).setMeta('addToHistory', false)), false),
          },
        },
        view: (view) => {
          views.add(view)
          return { destroy: () => views.delete(view) }
        },
      }),
    ]
  },
})
