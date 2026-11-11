import Dexie, { type EntityTable } from 'dexie'
import { t } from './i18n'
import { isTauri } from '@tauri-apps/api/core'
import { keyReady, sealingLayer } from './sealing'
import type { JSONContent } from '@tiptap/react'
import type { LinkPreview } from './linkPreviews'

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

// This device's copy of the file list in Dropbox's synced folders (only names, versions and
// dates: no text), as it was at `cursor` (SyncListing). Each sync asks Dropbox only what changed
// since then (sync.ts, remoteListing). Never synced; forgotten when Dropbox is disconnected.
export interface RemoteFile {
  path: string // lower case, e.g. "/notes/1234-…"
  rev: string
  modified: number
}

// An image no note on this device uses, since when (sync.ts, step 6). Apart from the image, so
// sync never has to open (on the PC: decrypt) the images themselves. Ids and dates only.
export interface UnusedImage {
  id: string // the image's id
  since: number
}

export interface SyncListing {
  name: 'listing'
  cursor: string // Dropbox's bookmark the file list belongs to
  listedAt: number // when the whole list was last fetched (done again once a day)
  folders: string // the folders it covers, comma-separated: another set = a full listing
}

// An image in a note. The note only stores the id; the image data lives here.
// Never changes once added (a new image gets a new id).
export interface Attachment {
  id: string
  blob: Blob // the image file (PNG, JPEG, …)
  createdAt: number
  unusedSince?: number // up to v0.65: moved to db.unusedImages by the first sync after it (sync.ts, step 6)
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
// Upcoming, tobuy = To buy, upnext + playing = To play (two parts), library (games.ts TABS).
export type GameStatus = 'waiting' | 'tobuy' | 'upnext' | 'playing' | 'library'

// Games whose price can be watched (priceWatch.ts): not owned yet (a pre-order is owned)
export const canWatch = (game: { status: GameStatus; preordered?: boolean }) =>
  game.status === 'tobuy' || (game.status === 'waiting' && !game.preordered)
// A price alert on the game or on one of its editions
export const isWatched = (game: { watch?: PriceWatch; editionWatches?: EditionWatch[] }) =>
  !!game.watch || !!game.editionWatches?.length

// From your Steam account, refreshed daily and when the game window opens (steam.ts)
export interface SteamStats {
  minutes: number // played
  done?: number // achievements unlocked, of total (none: the game has no achievements)
  total?: number
}

// A To buy or Upcoming game's price alert (priceWatch.ts): when it alerts (the cheaper of Steam
// and the cheapest key). It alerts once, then stays off until it's changed or set again ("Watch again").
export interface PriceWatch {
  // Before v0.22 a watch also had store: 'steam' | 'key'; now it looks at the cheaper of both
  // Before v0.23.2 also 'record' (below the lowest ever when set, with record: cents): now read as 'low'
  when: 'price' | 'low' // at or below target / at its lowest ever (or below)
  target?: number // cents ('price')
  setAt: number // when it was set: also names its Calendar event, so two devices make only one
  firedAt?: number // when it alerted
  firedPrice?: number // cents, the price that made it alert
  // cents: key prices marked "Wrong key" on an alert (e.g. an Xbox key: GG.deals doesn't say the
  // platform), skipped by this watch; the last 5. Kept when the alert is changed, gone when it's turned off.
  ignoredKeys?: number[]
}

// A watched edition of a To buy or Upcoming game (editions.ts): its own watch, on its Steam
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
  preordered?: boolean // Upcoming only: owned already, so no price alert; goes to Not started on release
  upNextMinutes?: number // Not started: Steam minutes played when first seen there (steam.ts followSteam); +1 h = Playing
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
  watch?: PriceWatch // To buy and Upcoming games only (canWatch)
  editionWatches?: EditionWatch[] // same; apart from watch, so an app before v0.24 keeps them when it changes watch
  steamStats?: SteamStats // Playing and Library games on Steam (steam.ts)
  hltbId?: number // its HowLongToBeat page, when the user pasted a link (playtimes.ts); else found by search
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

// What was done with one alert of a calendar event (eventAlerts.ts): Done, or snoozed. Synced,
// so it counts on every device; changed on both, the newest wins. Removed a week after the alert.
export interface AlertMark {
  id: string // alertMarkId(key): also its file name in Dropbox
  key: string // "event:<event id>@<alert time>": a moved event or a new alert time is a new alert
  at: number // the alert time (ms)
  doneAt?: number
  snoozedUntil?: number
  notMoved?: boolean // snoozed, but the event couldn't be moved in Google (offline…)
  by?: string // the device that marked it (deviceName): the other one's card says so
  updatedAt: number
  syncedRev?: string // Dropbox revision last synced
  syncedUpdatedAt?: number
}

// An alert's key can't be a file name: Google's event ids can have capitals, and Dropbox lists
// names in lower case. So a short hash (it needn't be secure, only different per alert). Not
// crypto.subtle: that isn't possible inside a database upgrade (it loses the transaction).
// YouTube's video ids have capitals too: the same goes for video marks (videoMarkId, video.ts).
export function alertMarkId(key: string) {
  let a = 0xdeadbeef
  let b = 0x41c6ce57
  for (let i = 0; i < key.length; i++) {
    a = Math.imul(a ^ key.charCodeAt(i), 2654435761)
    b = Math.imul(b ^ key.charCodeAt(i), 1597334677)
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return [b, a].map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('')
}

// A link card's data (linkPreviews.ts), fetched by our proxy. Not synced: a cache, per device.
export interface LinkPreviewRow {
  url: string
  preview: LinkPreview | null // null: the page couldn't be read
  fetchedAt: number
  version?: number // CACHE_VERSION in linkPreviews.ts when it was read
}

// An older version of a note (noteHistory.ts). Saved here first, then uploaded to Dropbox's
// history/ folder by sync. Encrypted here only on the PC, like the notes (sealing.ts).
// A channel followed in the Video tab (video.ts), and which of its videos count. A removed one
// stays as a row with deleted = true, so the removal can sync too.
export interface VideoFollow {
  id: string
  platform: 'twitch' | 'youtube'
  channelId: string
  name: string
  icon: string | null // its picture, loaded from the site, never stored
  onlyWords: string[] // a title needs one of these; empty = all titles
  exceptWords: string[] // a title with one of these is left out
  onlyGames?: string[] // Twitch: a stream with one of these games played; with onlyWords, either one keeps it
  minMinutes: number // shorter videos are hidden; 0 = off
  hideShorts: boolean // YouTube only
  startAt: number // ms: older videos aren't shown; 0 = all that are still available
  deleted: boolean
  updatedAt: number
  syncedRev?: string // Dropbox revision last synced
  syncedUpdatedAt?: number
}

// A video of a followed channel. Only on this device: it can always be downloaded again.
export interface VideoRow {
  id: string // "<platform>-<the site's video id>"
  platform: VideoFollow['platform']
  channelId: string
  kind: string // Twitch: archive; YouTube: video or short
  title: string
  url: string
  thumbnail: string | null
  published: number
  duration: number // seconds
  gone: boolean // the site no longer has it
  games?: VideoGame[] // Twitch: every game played in it (video.ts); not asked yet = undefined
  fresh?: boolean // found by a check and not shown yet: tagged "New" when the Video tab shows it
}

// A game played in a Twitch stream: Twitch's own name and the one it shows (translated, e.g.
// "Just Chatting" shows as "Discussions" in French)
export interface VideoGame {
  name: string
  shown: string
}

// A video added by its link (video.ts). Synced, unlike VideoRow: no follow can download it again.
export interface AddedVideo extends Omit<VideoRow, 'id' | 'fresh'> {
  id: string // videoMarkId(videoId), same as its mark: also its file name in Dropbox
  videoId: string // VideoRow's id
  channel: string
  channelIcon: string | null
  updatedAt: number // when it was added: its place in the list. Not changed by "gone"
  syncedRev?: string // Dropbox revision last synced
  syncedUpdatedAt?: number
}

// A folder in the Video tab (video.ts). A deleted one stays as a row with deleted = true, so the
// deletion can sync too.
export interface VideoFolder {
  id: string
  name: string
  parentId: string | null // the folder it's in; null = at the top
  channel: string | null // at the top of this channel ("<platform> <its id>"); null = your own
  deleted: boolean
  updatedAt: number
  syncedRev?: string // Dropbox revision last synced
  syncedUpdatedAt?: number
}

// A YouTube playlist in the Video tab (video.ts). A removed one stays as a row with deleted = true,
// so the removal can sync too.
export interface VideoPlaylist {
  id: string // a hash of its YouTube id, which has capitals: also its file name in Dropbox
  listId: string // its YouTube id
  name: string
  keepChecking: boolean // looks for new videos once a day; off for an old, finished one
  // Played oldest first by upload date, or in YouTube's order; newestFirst turns either around.
  // Both missing on playlists from before (the old "reversed" meant YouTube's order turned around).
  newestFirst?: boolean
  youtubeOrder?: boolean
  folderId?: string | null // in one of your own folders; missing, null or a deleted folder: at the top
  deleted: boolean
  restoredAt?: number // added again after being removed (see localWins, sync.ts)
  updatedAt: number
  syncedRev?: string // Dropbox revision last synced
  syncedUpdatedAt?: number
}

// One video of a playlist
export interface PlaylistEpisode extends Omit<VideoRow, 'gone'> {
  channel: string
  later?: boolean // came after the playlist was added: counts as a new video until it's opened
}

// A playlist's videos, in YouTube's order. Only on this device: they can be downloaded again.
export interface PlaylistVideos {
  id: string // the playlist's id
  videos: PlaylistEpisode[]
}

// A game's HowLongToBeat times (playtimes.ts). Only on this device, like a playlist's videos: they
// can be asked again, and saving them on the game would make background writes win over an edit
// made on the other device.
export interface Playtime {
  id: string // the game's id
  hltbId: number | null // its page; null = not found when checked
  main: number // seconds, 0 = not known yet: main story
  plus: number // main + extras
  full: number // completionist
  checkedAt: number
}

// Which folder a video is in. Apart from its mark, so a move here and "opened" on another device
// can't overwrite each other.
export interface VideoPlace {
  id: string // videoMarkId(the video's id): also its file name in Dropbox
  folderId: string | null // null, or a folder that's been deleted: the main list
  updatedAt: number
  syncedRev?: string // Dropbox revision last synced
  syncedUpdatedAt?: number
}

// What's been done with a video. Apart from the video, as these marks are what's
// worth keeping: they stay when a follow is removed, so adding it again remembers them.
export interface VideoMark {
  id: string // videoMarkId(the video's id): also its file name in Dropbox
  opened: boolean
  watched: boolean
  cleared?: boolean // removed from Watched: never shows again, even if a check lists it again
  updatedAt: number
  syncedRev?: string // Dropbox revision last synced
  syncedUpdatedAt?: number
}

export interface Snapshot {
  id: string // "<note id>-<savedAt>"
  noteId: string
  savedAt: number
  title: string | null
  content: JSONContent | null
  text: string
  hash: string // of the title and content: equal hash = same version
  device: string // which device saved it (sync.ts deviceName)
  added: number // words added since this device's previous snapshot of the note
  removed: number // words removed since then
  protected: boolean // before a big deletion: kept the full 30 days
  uploaded: 0 | 1 // in Dropbox already (0 again when it becomes protected)
}

// On the PC, once moved (localDb.ts), the database is sealed (sealing.ts). It has another name,
// so a move cut short never mixes sealed and plain rows.
export const LOCAL_DB_FLAG = 'syncr.local-db'
export const sealedDb = isTauri() && localStorage.getItem(LOCAL_DB_FLAG) === 'sealed'

// The local database, stored in the browser/app (IndexedDB).
export const db = new Dexie(sealedDb ? 'syncr-local' : 'syncr') as Dexie & {
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
  alertMarks: EntityTable<AlertMark, 'id'>
  linkPreviews: EntityTable<LinkPreviewRow, 'url'>
  snapshots: EntityTable<Snapshot, 'id'>
  videoFollows: EntityTable<VideoFollow, 'id'>
  videos: EntityTable<VideoRow, 'id'>
  videoMarks: EntityTable<VideoMark, 'id'>
  addedVideos: EntityTable<AddedVideo, 'id'>
  videoFolders: EntityTable<VideoFolder, 'id'>
  videoPlaylists: EntityTable<VideoPlaylist, 'id'>
  playlistVideos: EntityTable<PlaylistVideos, 'id'>
  videoPlaces: EntityTable<VideoPlace, 'id'>
  remoteFiles: EntityTable<RemoteFile, 'path'>
  syncListing: EntityTable<SyncListing, 'name'>
  unusedImages: EntityTable<UnusedImage, 'id'>
  playtimes: EntityTable<Playtime, 'id'>
}

// The tables and their lookup fields, version by version. Also used by the move to the sealed
// database (localDb.ts).
export function defineSchema(d: Dexie) {
  d.version(1).stores({
    notes: 'id, updatedAt', // fields we can look up / sort by (i18n-ok)
  })

  d.version(2).stores({
    deletions: 'id',
  })

  d.version(3).stores({
    keys: 'name',
  })

  d.version(4).stores({
    synced: 'id',
  })

  d.version(5).stores({
    attachments: 'id',
  })

  d.version(6).stores({
    settings: 'name',
  })

  d.version(7).stores({
    reminders: 'id',
  })

  d.version(8).stores({
    cards: 'id',
  })

  d.version(9).stores({
    games: 'id',
  })

  d.version(10).stores({
    events: 'id',
  })

  d.version(11).stores({
    alertStates: 'key',
  })

  d.version(12).stores({
    linkPreviews: 'url',
  })

  d.version(13).stores({
    snapshots: 'id, noteId, uploaded', // i18n-ok
  })

  // Done and snoozed alerts start to sync: they need a file name (alertMarkId) as their id, so
  // a new table. What's marked so far comes along, and is sent at the next sync.
  d.version(14)
    .stores({
      alertMarks: 'id',
    })
    .upgrade(async (tx) => {
      const old: Pick<AlertMark, 'key' | 'at' | 'doneAt' | 'snoozedUntil' | 'notMoved'>[] = await tx.table('alertStates').toArray()
      const updatedAt = Date.now()
      await tx.table('alertMarks').bulkPut(old.map((mark) => ({ ...mark, id: alertMarkId(mark.key), updatedAt })))
    })

  d.version(15).stores({
    alertStates: null,
  })

  d.version(16).stores({
    videoFollows: 'id',
  })

  d.version(17).stores({
    videos: 'id',
    videoMarks: 'id',
  })

  d.version(18).stores({
    addedVideos: 'id',
  })

  d.version(19).stores({
    videoFolders: 'id',
    videoPlaces: 'id',
  })

  d.version(20).stores({
    videoPlaylists: 'id',
    playlistVideos: 'id',
  })

  d.version(21).stores({
    remoteFiles: 'path',
    syncListing: 'name',
  })

  d.version(22).stores({
    unusedImages: 'id',
  })

  d.version(23).stores({
    playtimes: 'id',
  })
}

// Forgets the saved Dropbox file list (another account, or none): the next sync lists everything
export function forgetRemoteListing() {
  return db.transaction('rw', db.remoteFiles, db.syncListing, async () => {
    await db.remoteFiles.clear()
    await db.syncListing.clear()
  })
}

defineSchema(db)
if (sealedDb) {
  db.use(sealingLayer)
  db.on('ready', () => keyReady) // nothing reads or writes before the key is there (localDb.ts)
}

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

// Note history (noteHistory.ts) hears about every saved edit and deleted note
type EditWatcher = (before: Note, after: Note | null) => Promise<void>
let editWatcher: EditWatcher | undefined

export function watchNoteEdits(watcher: EditWatcher) {
  editWatcher = watcher
}

export async function saveNoteContent(id: string, content: JSONContent, text: string) {
  const before = await db.notes.get(id)
  await db.notes.update(id, { content, text, updatedAt: Date.now() })
  changed()
  // Not waited for: saving never waits for note history (its work runs in order on its own)
  if (before) void editWatcher?.(before, { ...before, content, text }).catch(() => {})
}

// Empty title = go back to the automatic title (first line).
export async function renameNote(id: string, title: string) {
  await db.notes.update(id, { title: title.trim() || null, updatedAt: Date.now() })
  changed()
}

export async function deleteNote(id: string) {
  const before = await db.notes.get(id)
  if (before) await editWatcher?.(before, null).catch(() => {})
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
  return firstLine?.trim() || t('Untitled')
}

// ---------- Board cards ----------
// Synced like reminders (sync.ts, step 4c). Every change calls changed() so auto-sync runs.

const OLD_DELETED_CARD_MS = 90 * 24 * 60 * 60 * 1000 // like reminders (reminders.ts)
const OLD_ALERT_MARK_MS = 7 * 24 * 60 * 60 * 1000

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

// Marks of alerts more than a week old aren't needed anymore (those alerts no longer show).
// Returns their ids, so sync can remove them from Dropbox too.
export async function removeOldAlertMarks(): Promise<string[]> {
  const old = Date.now() - OLD_ALERT_MARK_MS
  const marks = await db.alertMarks.filter((mark) => mark.at < old && (mark.snoozedUntil ?? 0) < old).toArray()
  await db.alertMarks.bulkDelete(marks.map((mark) => mark.id))
  return marks.map((mark) => mark.id)
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

export async function removeOldDeletedFollows(): Promise<string[]> {
  const old = (await db.videoFollows.toArray()).filter(
    (follow) => follow.deleted && Date.now() - follow.updatedAt > OLD_DELETED_CARD_MS,
  )
  await db.videoFollows.bulkDelete(old.map((follow) => follow.id))
  return old.map((follow) => follow.id)
}

export async function removeOldDeletedFolders(): Promise<string[]> {
  const old = (await db.videoFolders.toArray()).filter(
    (folder) => folder.deleted && Date.now() - folder.updatedAt > OLD_DELETED_CARD_MS,
  )
  await db.videoFolders.bulkDelete(old.map((folder) => folder.id))
  return old.map((folder) => folder.id)
}

export async function removeOldDeletedPlaylists(): Promise<string[]> {
  const old = (await db.videoPlaylists.toArray()).filter(
    (playlist) => playlist.deleted && Date.now() - playlist.updatedAt > OLD_DELETED_CARD_MS,
  )
  await db.videoPlaylists.bulkDelete(old.map((playlist) => playlist.id))
  return old.map((playlist) => playlist.id)
}

export async function updateGame(id: string, change: Partial<Game>) {
  await db.games.update(id, { ...change, updatedAt: Date.now() })
  if (change.priority !== undefined) await cardFollowsGame(id, change.priority)
  changed()
}

// Not started, Playing or Library: owned now, so its price watch goes. Into or out of the Library: Priority
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
    ...(game?.preordered && { preordered: undefined }), // only means something while Upcoming
    ...(game?.upNextMinutes !== undefined && { upNextMinutes: undefined }),
  })
}

// "Pre-ordered" (Upcoming games: menu and game window): owned, so its price alerts go
export async function setPreordered(id: string, on: boolean) {
  await updateGame(id, on ? { preordered: true, watch: undefined, editionWatches: undefined } : { preordered: undefined })
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
