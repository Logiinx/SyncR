import Dexie, { type EntityTable } from 'dexie'
import type { JSONContent } from '@tiptap/react'

export interface Note {
  id: string
  title: string | null // custom title; null = use the first line
  content: JSONContent | null // editor document
  text: string // plain-text copy, used for the title fallback and (later) search
  createdAt: number
  updatedAt: number
  conflictOf?: string // a conflict copy (sync.ts): the id of the note it is a copy of
}

// Marker left behind when a note is deleted, so sync can delete it on the other device too.
export interface Deletion {
  id: string // the deleted note's id
  deletedAt: number
}

// The sync encryption key, remembered on this device (see crypto.ts). Never synced.
export interface StoredKey {
  name: string // always 'sync' for now
  key: CryptoKey
}

// What a note looked like at the last sync (see sync.ts). A note whose updatedAt differs
// from this has local changes. "rev" is Dropbox's version of the file.
export interface SyncedNote {
  id: string
  rev: string
  updatedAt: number
}

// An image in a note. The note only stores the id; the image data lives here.
// Never changes once added (a new image gets a new id).
export interface Attachment {
  id: string
  blob: Blob // the image file (PNG, JPEG, …)
  createdAt: number
  unusedSince?: number // set when sync first finds no note using it (see sync.ts, step 6)
}

// App-wide data that syncs like a note (e.g. the color rules, see colorRules.ts).
// One row per kind, found by name (lower case only: it's also the file name in Dropbox,
// which lists names in lower case). syncedRev / syncedUpdatedAt: what it looked like at the
// last sync (like SyncedNote for notes).
export interface Setting {
  name: string
  value: unknown
  updatedAt: number
  syncedRev?: string
  syncedUpdatedAt?: number
}

// A reminder (see reminders.ts). Separate from notes, synced like a setting: changed on both
// sides means the newest wins. A deleted reminder stays as a row with deleted = true for a
// while, so the deletion syncs like any other change (see sync.ts, step 4c).
// syncedRev / syncedUpdatedAt: what it looked like at the last sync.
export interface Reminder {
  id: string
  text: string
  note: string // optional longer text ('' = none)
  dueAt: number // when to remind (ms since 1970); snoozing moves it
  phone: boolean // also added to Google Calendar
  gameId?: string // a game's release reminder (games.ts); its id is "release-<game id>"
  gameRelease?: number // the release day it was made for (a new day = the game was delayed)
  doneAt: number | null // null = still waiting
  deleted: boolean
  restoredAt?: number // brought back after being deleted (sync.ts localWins)
  createdAt: number
  updatedAt: number
  syncedRev?: string
  syncedUpdatedAt?: number
}

// A card on the Board (Board.tsx): a small note shown beside whatever note is open.
// Like a reminder: synced like a setting (newest wins), and a deleted card stays as a row
// with deleted = true for a while, so the deletion can sync too (and "Undo" can bring it back).
// order: position in the list; a new card gets the highest, so it lands at the bottom of its
// part (priority cards are always shown above the others).
export interface Card {
  id: string
  content: JSONContent | null // editor document, like a note's
  text: string // plain-text copy
  priority: boolean
  // A pinned game (Games tab → "Pin to Board"): its id and a copy of its name and cover, so the
  // card still shows if the game leaves the list. content stays null, text = the name.
  game?: { id: string; name: string; coverId?: string }
  // A title above the text (Card.tsx): bold, centered. folded hides the text under it.
  // All synced with the card. titleAlign: left-aligned titles from before v0.16.6, now ignored.
  title?: string
  titleAlign?: 'left'
  folded?: boolean
  // A group of cards (CardGroup.tsx) is a row too: group = true, its name in title, folded
  // like a titled card, no text. Its order and priority place it among the cards; the cards in
  // it have its id in groupId and their own order and priority inside it. (An older app version
  // shows a group as an empty card with a title.)
  group?: true
  groupId?: string
  color?: string // background tint, a palette name ('red', 'blue'…; cardColors.ts). None = default
  colorCards?: true // a group colored "with its cards": cards that enter it later take its color
  order: number
  deleted: boolean
  restoredAt?: number // brought back after being deleted (sync.ts localWins)
  createdAt: number
  updatedAt: number
  syncedRev?: string
  syncedUpdatedAt?: number
}

// A game in the Games tab (GamesView.tsx), with its data from IGDB (igdb.ts).
// Synced like a card: one file per game, newest wins, a removed game stays as a row with
// deleted = true for a while. The id comes from IGDB's, so a game can't be in the list twice.
// Before v0.20 there were "done" and "dropped", before v0.22 "watched", before v0.36 "toplay"
// (to buy and owned mixed, now "tobuy") (games.ts upgradeOldStatuses). Shown as tabs: waiting =
// Coming soon, tobuy = To buy, upnext + playing = To play (two parts), library (games.ts TABS).
export type GameStatus = 'waiting' | 'tobuy' | 'upnext' | 'playing' | 'library'

// Games whose price can be watched (priceWatch.ts): not owned yet
export const canWatch = (game: { status: GameStatus }) => game.status === 'tobuy' || game.status === 'waiting'
// A price alert on the game or on one of its editions
export const isWatched = (game: { watch?: PriceWatch; editionWatches?: EditionWatch[] }) =>
  !!game.watch || !!game.editionWatches?.length

// From your Steam account, refreshed daily and when the game window opens (steam.ts)
export interface SteamStats {
  minutes: number // played
  done?: number // achievements unlocked, of total (none: the game has no achievements)
  total?: number
}

// A To buy or Coming soon game's price alert (priceWatch.ts): when it alerts (the cheaper of Steam
// and the cheapest key). It alerts once, then stays off until it's changed or set again ("Watch again").
export interface PriceWatch {
  // Before v0.22 a watch also had store: 'steam' | 'key'; now it looks at the cheaper of both
  // Before v0.23.2 also 'record' (below the lowest ever when set, with record: cents): now read as 'low'
  when: 'price' | 'low' // at or below target / at its lowest ever (or below)
  target?: number // cents ('price')
  setAt: number // when it was set: also names its Calendar event, so two devices make only one
  firedAt?: number // when it alerted
  firedPrice?: number // cents, the price that made it alert
}

// A watched edition of a To buy or Coming soon game (editions.ts): its own watch, on its Steam
// package or bundle.
export interface EditionWatch extends PriceWatch {
  kind: 'sub' | 'bundle'
  id: number // Steam's package or bundle id
  name: string // Steam's name, for the alert
}

export interface Game {
  id: string // "igdb-<IGDB id>"
  igdbId: number
  name: string
  coverId?: string // IGDB image id (covers load from IGDB's image server, never stored)
  releaseDate?: number // release day, ms (PC, else Android, else consoles: igdb.ts trackedRelease)
  releaseLabel?: string // only a vague date is known, e.g. "Q1 2027"; neither = not announced (TBA)
  delayedFrom?: number // the earlier release day, when the refresh found a delay (banner until dismissed)
  delayedFromLabel?: string // the same when the earlier date was vague, e.g. "Q1 2027"
  datedFrom?: string // the vaguer date before the refresh found a more precise one, e.g. "TBA" (banner until dismissed)
  movedBy?: 'released' | 'bought' | 'started' // SyncR moved it by itself (banner until dismissed or moved by hand)
  platforms: string[] // short names, e.g. "PC", "Android"
  status: GameStatus
  statusAt: number // when it got this status (sorts the groups: newest first, e.g. last finished)
  priority: boolean // "Priority" (sparkle): top of its group
  note: string // any time, optional
  review: string // with the rating, optional
  rating?: number // 0.5 to 5, in half stars
  liked: boolean // the heart
  completed?: boolean // "Completed" (finished it), next to the rating
  ending?: 'paused' | 'dropped' // Library: how it ended when not completed (games.ts endingOf); never with completed
  watch?: PriceWatch // To buy and Coming soon games only (canWatch)
  editionWatches?: EditionWatch[] // same; apart from watch, so an app before v0.24 keeps them when it changes watch
  steamStats?: SteamStats // Playing and Library games on Steam (steam.ts)
  deleted: boolean
  restoredAt?: number // brought back after being deleted (sync.ts localWins)
  createdAt: number
  updatedAt: number
  syncedRev?: string
  syncedUpdatedAt?: number
}

// An event of the main Google Calendar (calendarEvents.ts), kept on this device so the Reminders
// tab works offline. Not synced through Dropbox: Google is their sync. A repeating event comes
// as one row per date (Google's "single events"), each with its own id.
export interface CalendarEvent {
  id: string // Google's event id (for one date of a repeating event: "<series id>_<date>")
  title: string
  description: string // plain text ('' = none)
  start: number // ms; an all-day event: local midnight of its first day
  end: number // ms; an all-day event: local midnight after its last day
  allDay: boolean
  seriesId?: string // set for one date of a repeating event
  alerts: number[] // minutes before the start for its notifications (its own, or the calendar's default)
  colorId?: string // Google's event color ("1" to "11"); none = the calendar's color
  link: string // opens the event in Google Calendar
}

// What was done with one alert of a calendar event on this device (eventAlerts.ts): Done, or
// snoozed. Not synced (as decided: per device; a snooze also moves the event in Google, see
// eventAlerts.ts). Removed a week after the alert.
export interface AlertState {
  key: string // "<event id>@<alert time>": a moved event or a new alert time is a new alert
  at: number // the alert time (ms)
  doneAt?: number
  snoozedUntil?: number
  notMoved?: boolean // snoozed, but the event couldn't be moved in Google (offline…)
}

// The local database, stored in the browser/app (IndexedDB).
export const db = new Dexie('syncr') as Dexie & {
  notes: EntityTable<Note, 'id'>
  deletions: EntityTable<Deletion, 'id'>
  keys: EntityTable<StoredKey, 'name'>
  synced: EntityTable<SyncedNote, 'id'>
  attachments: EntityTable<Attachment, 'id'>
  settings: EntityTable<Setting, 'name'>
  reminders: EntityTable<Reminder, 'id'>
  cards: EntityTable<Card, 'id'>
  games: EntityTable<Game, 'id'>
  events: EntityTable<CalendarEvent, 'id'>
  alertStates: EntityTable<AlertState, 'key'>
}

db.version(1).stores({
  notes: 'id, updatedAt', // fields we can look up / sort by
})

db.version(2).stores({
  deletions: 'id',
})

db.version(3).stores({
  keys: 'name',
})

db.version(4).stores({
  synced: 'id',
})

db.version(5).stores({
  attachments: 'id',
})

db.version(6).stores({
  settings: 'name',
})

db.version(7).stores({
  reminders: 'id',
})

db.version(8).stores({
  cards: 'id',
})

db.version(9).stores({
  games: 'id',
})

db.version(10).stores({
  events: 'id',
})

db.version(11).stores({
  alertStates: 'key',
})

// Tells auto-sync (autoSync.ts) that the user changed something on this device.
// Sync's own writes don't call this, so they don't start another sync.
export function changed() {
  window.dispatchEvent(new Event('notes-changed'))
}

// Editors register a "save now" function here (NoteEditor.tsx), for an edit that's still
// waiting for its autosave. Sync saves those first, so it compares against what's on screen
// (sync.ts), and so does the last sync before closing (autoSync.ts finalSync).
const pendingSaves = new Set<() => Promise<void>>()

export function registerFlush(flush: () => Promise<void>) {
  pendingSaves.add(flush)
  return () => {
    pendingSaves.delete(flush)
  }
}

export async function savePendingEdits() {
  await Promise.all([...pendingSaves].map((flush) => flush()))
}

export async function createNote(): Promise<string> {
  const now = Date.now()
  const id = crypto.randomUUID()
  await db.notes.add({ id, title: null, content: null, text: '', createdAt: now, updatedAt: now })
  changed()
  return id
}

export async function saveNoteContent(id: string, content: JSONContent, text: string) {
  await db.notes.update(id, { content, text, updatedAt: Date.now() })
  changed()
}

// Empty title = go back to the automatic title (first line).
export async function renameNote(id: string, title: string) {
  await db.notes.update(id, { title: title.trim() || null, updatedAt: Date.now() })
  changed()
}

export async function deleteNote(id: string) {
  await db.transaction('rw', db.notes, db.deletions, async () => {
    await db.notes.delete(id)
    await db.deletions.put({ id, deletedAt: Date.now() })
  })
  changed()
}

// The ids of the images (attachments) used in a note
export function imageIds(content: JSONContent | null): string[] {
  const ids: string[] = []
  const walk = (node: JSONContent) => {
    if (node.type === 'image' && node.attrs?.id) ids.push(node.attrs.id)
    node.content?.forEach(walk)
  }
  if (content) walk(content)
  return ids
}

// Custom title if set, otherwise the first non-empty line of the text.
export function noteTitle(note: Note): string {
  if (note.title) return note.title
  const firstLine = note.text.split('\n').find((line) => line.trim() !== '')
  return firstLine?.trim() || 'Untitled'
}

// ---------- Board cards ----------
// Synced like reminders (sync.ts, step 4c). Every change calls changed() so auto-sync runs.

const OLD_DELETED_CARD_MS = 90 * 24 * 60 * 60 * 1000 // like reminders (reminders.ts)

// Higher than any card's order: a card given it lands at the bottom of its part.
// Deleted cards count too, so Undo puts a card back in its place.
async function nextOrder() {
  const all = await db.cards.toArray()
  return Math.max(0, ...all.map((card) => card.order)) + 1
}

// A new card at the bottom of its part: empty by default ("+"), with content ("Pin"), or a game.
// In a group (its menu → New card): at the bottom of the group, with its color if it colors its cards.
export async function createCard(start?: {
  content: JSONContent | null
  text: string
  priority: boolean
  game?: Card['game']
}, groupId?: string): Promise<string> {
  const now = Date.now()
  const id = crypto.randomUUID()
  const order = await nextOrder()
  const group = groupId ? await db.cards.get(groupId) : undefined
  await db.cards.add({
    id,
    content: start?.content ?? null,
    text: start?.text ?? '',
    priority: start?.priority ?? false,
    ...(start?.game && { game: start.game }),
    ...(groupId && { groupId }),
    ...(group?.colorCards && group.color && { color: group.color }),
    order,
    deleted: false,
    createdAt: now,
    updatedAt: now,
  })
  changed()
  return id
}

export async function saveCardContent(id: string, content: JSONContent, text: string) {
  await db.cards.update(id, { content, text, updatedAt: Date.now() })
  changed()
}

// Title, its alignment, folded (Card.tsx). undefined removes the field.
export async function updateCardTitle(id: string, changes: Partial<Pick<Card, 'title' | 'titleAlign' | 'folded'>>) {
  await db.cards.update(id, { ...changes, updatedAt: Date.now() })
  changed()
}

// Background color (cardColors.ts); undefined = default
export async function setCardColor(id: string, color: string | undefined) {
  await db.cards.update(id, { color, updatedAt: Date.now() })
  changed()
}

// A group's color. withCards: every card in it gets that color too, and so do cards that enter
// it later (until the group is colored alone again)
export async function setGroupColor(id: string, color: string | undefined, withCards: boolean) {
  const now = Date.now()
  await db.transaction('rw', db.cards, async () => {
    await db.cards.update(id, { color, colorCards: withCards && color ? true : undefined, updatedAt: now })
    if (!withCards) return
    const inside = await db.cards.filter((card) => !card.deleted && !card.group && card.groupId === id).toArray()
    for (const card of inside) await db.cards.update(card.id, { color, updatedAt: now })
  })
  changed()
}

// Delete (deleted = true) or bring back (Undo)
export async function setCardDeleted(id: string, deleted: boolean) {
  const now = Date.now()
  // Undo: a deliberate restore, so it beats the deletion if that already reached another device
  await db.cards.update(id, { deleted, updatedAt: now, ...(!deleted && { restoredAt: now }) })
  changed()
}

// A new group with a card in it ("Move to group" → "New group…"): the group takes the card's
// place on the Board, the card goes in it
export async function createGroup(name: string, cardId: string) {
  const card = await db.cards.get(cardId)
  if (!card) return
  const now = Date.now()
  const id = crypto.randomUUID()
  await db.cards.add({
    id,
    content: null,
    text: '',
    title: name,
    group: true,
    priority: card.priority,
    order: card.order,
    deleted: false,
    createdAt: now,
    updatedAt: now,
  })
  await moveToGroup(cardId, id)
}

// Deleting a group: its cards are deleted too, or go back on the Board where the group was
// (in the same order; they keep groupId, so Undo puts them back in it). Returns what Undo
// brings back.
export async function deleteGroup(id: string, withCards: boolean): Promise<string[]> {
  const all = await db.cards.toArray()
  const group = all.find((row) => row.id === id)
  if (!group) return []
  const inside = all.filter((card) => !card.deleted && !card.group && card.groupId === id).sort((a, b) => a.order - b.order)
  // Orders between the group's and the next one up, so nothing else lands between them
  const above = all.map((row) => row.order).filter((order) => order > group.order)
  const step = ((above.length ? Math.min(...above) : group.order + 1) - group.order) / (inside.length + 1)
  const now = Date.now()
  await db.transaction('rw', db.cards, async () => {
    await db.cards.update(id, { deleted: true, updatedAt: now })
    for (const [i, card] of inside.entries()) {
      await db.cards.update(
        card.id,
        withCards ? { deleted: true, updatedAt: now } : { order: group.order + step * (i + 1), updatedAt: now },
      )
    }
  })
  changed()
  return withCards ? [id, ...inside.map((card) => card.id)] : [id]
}

// Into a group (at the bottom of its part there), or out of it (undefined: bottom of its part
// on the Board). The card keeps its priority.
export async function moveToGroup(id: string, groupId: string | undefined) {
  await db.cards.update(id, {
    groupId,
    order: await nextOrder(),
    ...(await enteringColor(id, groupId)),
    updatedAt: Date.now(),
  })
  changed()
}

// A card entering a group colored "with its cards" takes the group's color (nothing to change
// otherwise, or when it's only moving inside the same group)
async function enteringColor(id: string, groupId: string | null | undefined): Promise<Partial<Card>> {
  if (!groupId || (await db.cards.get(id))?.groupId === groupId) return {}
  const group = await db.cards.get(groupId)
  return group?.colorCards ? { color: group.color } : {}
}

// Nothing typed in it (a fresh card, or everything erased)
export function isEmptyCard(card: Card): boolean {
  if (card.game || card.title) return false // a game card has no text of its own; a title is enough
  const blocks = card.content?.content
  return !blocks || (blocks.length === 1 && blocks[0].type === 'paragraph' && !blocks[0].content)
}

// Priority on / off: the card moves to the bottom of its new part (a game card: its game too)
export async function setCardPriority(id: string, priority: boolean) {
  await db.cards.update(id, { priority, order: await nextOrder(), updatedAt: Date.now() })
  await gameFollowsCard(id, priority)
  changed()
}

// Deleted cards are kept for a while so the deletion syncs; after 90 days they go for good.
// Returns their ids, so sync can remove them from Dropbox too.
export async function removeOldDeletedCards(): Promise<string[]> {
  const old = (await db.cards.toArray()).filter(
    (card) => card.deleted && Date.now() - card.updatedAt > OLD_DELETED_CARD_MS,
  )
  await db.cards.bulkDelete(old.map((card) => card.id))
  return old.map((card) => card.id)
}

// Dropped somewhere else on the Board (drag and drop): new part and position, and for a card
// the group it's now in (null: none; undefined: unchanged, e.g. a group being moved)
export async function moveCard(id: string, priority: boolean, order: number, groupId?: string | null) {
  await db.cards.update(id, {
    priority,
    order,
    ...(groupId !== undefined && { groupId: groupId ?? undefined }),
    ...(await enteringColor(id, groupId)),
    updatedAt: Date.now(),
  })
  await gameFollowsCard(id, priority)
  changed()
}

// ---------- Games ----------

// Removed games are kept for a while so the removal syncs; after 90 days they go for good.
export async function removeOldDeletedGames(): Promise<string[]> {
  const old = (await db.games.toArray()).filter(
    (game) => game.deleted && Date.now() - game.updatedAt > OLD_DELETED_CARD_MS,
  )
  await db.games.bulkDelete(old.map((game) => game.id))
  return old.map((game) => game.id)
}

export async function updateGame(id: string, change: Partial<Game>) {
  await db.games.update(id, { ...change, updatedAt: Date.now() })
  if (change.priority !== undefined) await cardFollowsGame(id, change.priority)
  changed()
}

// Up next, Playing or Library: owned now, so its price watch goes. Into or out of the Library: Priority
// and Favorite mean different things, so the mark goes (games.ts isFavoriteTab). Out of the Library:
// Paused / Dropped no longer apply (Completed stays, like the rating). A move clears the "moved by
// itself" line (movedBy): automatic moves set it again right after (games.ts moveReleased).
export async function setGameStatus(id: string, status: GameStatus) {
  const game = await db.games.get(id)
  const leavesMark = game?.priority && (game.status === 'library') !== (status === 'library')
  await updateGame(id, {
    status,
    statusAt: Date.now(),
    ...(!canWatch({ status }) && { watch: undefined, editionWatches: undefined }),
    ...(leavesMark && { priority: false }),
    ...(status !== 'library' && game?.ending && { ending: undefined }),
    ...(game?.movedBy && { movedBy: undefined }),
  })
}

// ---------- Games on the Board ----------

// "Pin to Board" (Games tab): a card for the game, at the bottom of its part, with the game's
// priority (the two share it, see below). Already pinned: nothing.
export async function pinGameToBoard(game: Game) {
  if (await pinnedCard(game.id)) return
  await createCard({
    content: null,
    text: game.name,
    priority: game.priority,
    game: { id: game.id, name: game.name, coverId: game.coverId },
  })
}

export async function unpinGameFromBoard(gameId: string) {
  const card = await pinnedCard(gameId)
  if (card) await setCardDeleted(card.id, true)
}

export const pinnedCard = async (gameId: string) =>
  (await db.cards.toArray()).find((card) => !card.deleted && card.game?.id === gameId)

// A game and its Board card share one priority: marking one marks the other. Both rows keep
// their own field (the Board sorts cards by it), so each change is copied to the other.
async function cardFollowsGame(gameId: string, priority: boolean) {
  const card = await pinnedCard(gameId)
  if (card && card.priority !== priority) {
    await db.cards.update(card.id, { priority, order: await nextOrder(), updatedAt: Date.now() })
  }
}

async function gameFollowsCard(cardId: string, priority: boolean) {
  const gameId = (await db.cards.get(cardId))?.game?.id
  const game = gameId ? await db.games.get(gameId) : undefined
  if (game && !game.deleted && game.priority !== priority) {
    await db.games.update(game.id, { priority, updatedAt: Date.now() })
  }
}

// Pairs that differ (set before they were linked, or by an older app version on the other
// device): either one marked → both marked. Run after each sync (games.ts).
export async function matchGamePriorities() {
  const cards = await db.cards.filter((card) => !card.deleted && !!card.game).toArray()
  let fixed = false
  for (const card of cards) {
    const game = await db.games.get(card.game!.id)
    if (!game || game.deleted || game.priority === card.priority) continue
    if (game.priority) await db.cards.update(card.id, { priority: true, order: await nextOrder(), updatedAt: Date.now() })
    else await db.games.update(game.id, { priority: true, updatedAt: Date.now() })
    fixed = true
  }
  if (fixed) changed()
}
