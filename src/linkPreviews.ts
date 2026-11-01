import { Extension } from '@tiptap/react'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { db } from './db'
import { igdbProxyFetch, isComplete, loadConnection } from './igdb'
import { openLink, simplify } from './links'
import { read } from './localState'

// Link cards: a website link in a note is shown as a small card (title, description, picture),
// so you know what it is without opening it. The page is read by our proxy (/preview in
// proxy/igdb-worker.js: a web page can't read other sites itself) and kept in a cache on this
// device (db.linkPreviews, not synced). Nothing is stored in the note: the card is drawn over
// the link, which stays a normal link (an older app just shows the link).

export interface LinkPreview {
  url: string
  kind: 'github' | 'tweet' | 'page'
  site: string | null
  title: string | null
  description: string | null
  image: string | null
  icon: string | null
  stars?: number | null // github
  language?: string | null // github
  author?: string | null // tweet
  handle?: string | null // tweet
  likes?: number | null // tweet
  date?: number | null // tweet
}

// ---------- Settings (per device) ----------

export interface LinkPreviewSettings {
  sites: string[] // only links to these sites (and their subdomains) get a card
}

const SETTINGS_KEY = 'syncr.linkPreviews'
const DEFAULTS: LinkPreviewSettings = { sites: ['github.com', 'fxtwitter.com', 'x.com', 'twitter.com'] }

export function loadLinkPreviewSettings(): LinkPreviewSettings {
  return { ...DEFAULTS, ...read<Partial<LinkPreviewSettings>>(SETTINGS_KEY, {}) }
}

// A link gets a card when its text is its address (links with their own text stay as they are)
// and it goes to one of the chosen sites
function wantsCard(href: string, text: string, settings: LinkPreviewSettings) {
  if (simplify(href) !== simplify(text)) return false
  let host: string
  try {
    const url = new URL(href)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    host = url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return false
  }
  return settings.sites.some((site) => host === site || host.endsWith(`.${site}`))
}

// ---------- Cache ----------

const FRESH_FOR = 14 * 24 * 3600_000 // then read again (a repo's description or stars change)
const RETRY_AFTER = 24 * 3600_000 // a page that couldn't be read

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
  for (const view of views) view.dispatch(view.state.tr.setMeta(key, 'redraw').setMeta('addToHistory', false))
}

async function ask(url: string) {
  if (asking.has(url)) return
  asking.add(url)
  try {
    const row = await db.linkPreviews.get(url)
    if (row) {
      previews.set(url, row.preview)
      redrawAll()
      if (Date.now() - row.fetchedAt < (row.preview ? FRESH_FOR : RETRY_AFTER)) return
    }
    // No proxy set up: plain links, asked again next time the app starts
    if (!isComplete(await loadConnection())) return void (row || previews.set(url, null))
    const response = await readPage(url)
    // An older proxy without /preview (404) or a hiccup: plain link until the app starts again
    if (!response.ok) return void (row || previews.set(url, null))
    const answer = await response.json()
    const preview: LinkPreview | null = answer.error ? null : answer
    // Keep an older card rather than replacing it with nothing
    if (!preview && row?.preview) return
    await db.linkPreviews.put({ url, preview, fetchedAt: Date.now() })
    previews.set(url, preview)
    redrawAll()
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

// Style C: picture on the left, title, then "site · description"
function card(href: string, preview: LinkPreview) {
  const root = element('span', 'link-card')
  root.contentEditable = 'false'
  root.title = href
  const tweet = preview.kind === 'tweet'
  const title = tweet && preview.handle ? `${preview.author ?? ''} @${preview.handle}`.trim() : preview.title
  const site = preview.site ?? hostOf(href)
  const text = element('span', 'link-card-text')
  text.append(element('span', 'link-card-title', title ?? href))
  text.append(element('span', 'link-card-line', preview.description ? `${site} · ${preview.description}` : site))
  root.append(picture('link-card-picture', [preview.image, preview.icon]), text)
  // The card isn't a part of the text: a click opens the link, and doesn't move the cursor
  root.addEventListener('mousedown', (event) => event.preventDefault())
  root.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    openLink(href)
  })
  return root
}

const key = new PluginKey<DecorationSet>('linkPreviews')

// Links in the note: from, to, address, text (one link can be several pieces of text, e.g. part bold)
function findLinks(state: EditorState) {
  const links: { from: number; to: number; href: string; text: string }[] = []
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

function decorations(state: EditorState) {
  const settings = loadLinkPreviewSettings()
  const { from: selFrom, to: selTo } = state.selection
  const found: Decoration[] = []
  for (const link of findLinks(state)) {
    if (!wantsCard(link.href, link.text, settings)) continue
    if (!previews.has(link.href)) void ask(link.href)
    const preview = previews.get(link.href)
    if (!preview) continue
    // The cursor at or in the link: show the address, so it can be edited
    if (selTo >= link.from && selFrom <= link.to) continue
    found.push(
      Decoration.widget(link.from, () => card(link.href, preview), { key: `${link.href}|${JSON.stringify(preview)}`, side: -1, ignoreSelection: true }),
      Decoration.inline(link.from, link.to, { class: 'link-carded' }),
    )
  }
  return DecorationSet.create(state.doc, found)
}

export const LinkPreviews = Extension.create({
  name: 'linkPreviews',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => decorations(state),
          apply: (tr, old, _oldState, state) =>
            tr.docChanged || tr.selectionSet || tr.getMeta(key) ? decorations(state) : old,
        },
        props: { decorations: (state) => key.getState(state) },
        view: (view) => {
          views.add(view)
          return { destroy: () => views.delete(view) }
        },
      }),
    ]
  },
})
