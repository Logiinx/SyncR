import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { ArrowDownUp, CalendarClock, Check, CheckCheck, ChevronDown, ChevronsRight, Ellipsis, Eraser, ExternalLink, Folder, FolderInput, FolderOutput, FolderPlus, LayoutGrid, List as ListIcon, ListOrdered, ListStart, ListPlus, ListTree, ListVideo, ListX, Link as LinkIcon, Music, Pencil, Play, Plus, RefreshCw, Repeat, RotateCcw, Search, Settings, Trash2, Undo2, UserPlus, Users, X } from 'lucide-react'
import { useListItems, usePage } from './animations'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { FillSwitch } from './tabLines'
import { CountBadge } from './CountBadge'
import { type VideoFolder, type VideoFollow, type VideoPlaylist } from './db'
import { dayTime, lastWatchedText, nearDay, shortDate, twitchDeletionText } from './dates'
import Dialog from './Dialog'
import { decimal, plural, t } from './i18n'
import { openLink } from './links'
import { useLocalState } from './localState'
import { useListScroll } from './videoScroll'
import { TipBox, useHoverTip } from './InfoTip'
import { LIST_PIECES, useCardPieces, VIDEO_PIECES, type CardPiece } from './videoCards'
import Spinner from './Spinner'
import { byChannel, channelKey, checkVideosNow, clearFresh, clearWatched, followOf, isRecent, markAllWatched, markOpened, searchMatches, setFollowStartSkip, setWatched, startOver, useChecking, useVideoFeed, type FeedVideo } from './video'
import { AddPlaylistDialog, AddVideoDialog, FollowDialog, FollowsWindow } from './VideoFollows'
import { openSettings } from './openSettings'
import { dragInQueue, dragPlaylist, dragVideo, useQueueDrops, useVideoLifted } from './videoDrag'
import { createFolder, deleteFolder, inRewatch, moveFolder, moveToFolder, MUSIC, renameFolder, REWATCH, useBigPictures, useMusicName, useRewatchSection } from './videoFolders'
import { sectionColor, type SectionName } from './videoSections'
import VideoLogo, { ChannelPicture } from './VideoLogo'
import { playVideo, type UpNext } from './videoPlayer'
import { linkIn, pasteAction, pasteActionDone, pasteLine, pasteLink, subscribePaste } from './videoPaste'
import { changePlaylist, playlistAddress, removePlaylist } from './videoPlaylists'
import { resumePosition, useResumePosition } from './videoPositions'
import { addToQueue, leaveQueue, useQueue } from './videoQueue'
import { playtimeText } from './playtimes'
import { VideoCardContent, VideoThumb } from './VideoHoverCard'

type List = 'towatch' | 'rewatch' | 'watched' | 'music'

// Videos found since the tab last showed: marked as shown right away, which gives older ones (found
// before foundAt existed) their week of "New" from now. Kept here too so the tag doesn't blink.
function useNewVideos(feed: ReturnType<typeof useVideoFeed>) {
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const fresh = [...(feed?.toWatch ?? []), ...(feed?.rewatch ?? []), ...(feed?.watched ?? []), ...(feed?.music ?? []), ...(feed?.playlists ?? []).flatMap((list) => list.videos)].filter((video) => video.fresh).map((video) => video.id)
    if (!fresh.length) return
    void clearFresh(fresh)
    setNewIds((now) => new Set([...now, ...fresh]))
  }, [feed])
  return newIds
}

// A list button's new videos, on its corner (the Video tab's count is the sum of both)
function ListCount({ count }: { count: number }) {
  return <CountBadge count={count} title={t('New videos')} />
}

// With its time when near (user: which of several "Today" came out first). A group's row: the day
// only (with its counts it would no longer fit on a phone)
const videoDay = (video: FeedVideo) => dayTime(video.published)
const groupDay = (video: FeedVideo) => nearDay(video.published) ?? shortDate(video.published)

const CARD_DELAY = 600 // ms resting the mouse on a row before its card shows
const DELETION_SOON = 7 * 86_400_000 // "Twitch deletes it in …" only in its last week

// What the playlist row's order button does when clicked
function orderButtonTitle(playlist: VideoPlaylist) {
  if (playlist.youtubeOrder) return playlist.newestFirst ? t('Back to YouTube’s order') : t('Reverse YouTube’s order')
  return playlist.newestFirst ? t('Show the oldest first') : t('Show the newest first')
}

// Grid or list, this PC only; a switch in the bar like Games' Covers / List (user, 2026-11-19)
type ListLayout = 'list' | 'grid'
const depthStyle = (depth: number) => (depth ? { marginLeft: depth * 24 } : undefined)

// Sections (Queue, From your follows, Rewatch; user 2026-11-25): a header with a colored mark, and
// what's inside indented with a thin line on the left. Rows learn their section from here, so the
// list stays one flat list (dragging moves its children). Their colors: videoSections.ts
const InSection = createContext<string | null>(null)
function useRowPlace(depth: number) {
  const section = useContext(InSection)
  if (!section) return { inSection: '', style: depthStyle(depth) }
  return { inSection: ' in-section', style: { '--depth': depth, '--section': section } as CSSProperties }
}
// What's inside a section, always wrapped (null: not in one), so rows aren't made again when it
// starts or stops being one
function Section({ color, children }: { color: string | null; children: ReactNode }) {
  return <InSection.Provider value={color}>{children}</InSection.Provider>
}

// A row that folds what's under it: a channel's videos, a folder or a playlist. Videos can be dragged
// onto it (videoDrag.ts), unless it has no drop: folder = where they go (none: out of their folder),
// channel = whose videos it takes (none: anyone's), open = what to open when they stay over it.
function FoldRow(props: {
  id: string
  drop?: { folder?: string; channel?: string; open: string }
  icon: ReactNode
  title: string
  logo?: ReactNode
  count: number
  countText?: string // instead of the number of videos
  actions?: ReactNode // buttons at the end of the row
  newest?: FeedVideo
  newCount: number
  open: boolean
  depth?: number
  onToggle: () => void
  onMenu?: (x: number, y: number) => void
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void // dragging the row itself (a playlist)
  card?: ListCardContent // its card on hover; none: no card (Started)
  queueHead?: boolean // the Queue's row: videos dragged onto it join the Queue (videoDrag.ts)
  section?: string // a section's header, in that color
  empty?: boolean // a section with nothing in it: dimmed, can't open
}) {
  const { drop, icon, title, logo, count, countText, actions, newest, newCount, open, depth = 0, onToggle, onMenu, onPointerDown, card } = props
  const rowRef = useRef<HTMLLIElement>(null)
  const hover = useHoverTip(CARD_DELAY)
  const shows = useCardPieces()
  const withCard = !!card && LIST_PIECES.some(shows)
  const place = useRowPlace(depth)
  const { section, empty } = props
  const color = section && empty ? `color-mix(in srgb, ${section} 45%, var(--bg))` : section // i18n-ok
  return (
    <li
      ref={rowRef}
      className={`video-row video-group${section ? ' video-section' : place.inSection}${open ? '' : ' folded'}${empty ? ' empty' : ''}`}
      style={section ? ({ '--section': color } as CSSProperties) : place.style}
      data-item={props.id}
      data-drop-folder={drop ? drop.folder ?? '' : undefined}
      data-drop-channel={drop ? drop.channel ?? '' : undefined}
      data-open={drop?.open ?? (props.queueHead ? props.id : undefined)}
      data-queue-head={props.queueHead ? '' : undefined}
      onPointerDown={onPointerDown}
      onContextMenu={
        onMenu &&
        ((e) => {
          e.preventDefault()
          onMenu(e.clientX, e.clientY)
        })
      }
    >
      <button className="video-row-open" aria-expanded={open} onClick={empty ? undefined : onToggle} {...(withCard && hover.props)}>
        <ChevronDown size={14} className="video-group-chevron" />
        {icon}
        <span className="video-text">
          <span className="video-title" title={withCard && shows('listPicture') ? undefined : title}>{title}</span>
          <span className="video-meta">
            {logo}
            <span>{countText ?? plural(count, '{n} video', '{n} videos')}</span>
            {newest && <span>· {groupDay(newest)}</span>}
            {newCount > 0 && <span className="video-new">{plural(newCount, '{n} new video', '{n} new videos')}</span>}
          </span>
        </span>
      </button>
      {actions}
      {withCard && hover.open && (
        <TipBox at={rowRef} className="video-card">
          <ListCard title={title} icon={icon} shows={shows} {...card} />
        </TipBox>
      )}
    </li>
  )
}

// What a channel row's, folder's or playlist's card shows: everything inside (sub-folders and
// playlists too), how many playlists, and a picture as wide as the card (a playlist's first video)
interface ListCardContent {
  videos: FeedVideo[]
  playlists?: number
  thumbnail?: string | null
}

// A channel row's, folder's or playlist's card, shown after resting the mouse on it: its picture
// (the row's, bigger), its whole name, how many videos and how many are left to watch, the time
// they take (minus where the started ones stopped), and its latest video
function ListCard({ title, icon, shows, videos, playlists = 0, thumbnail }: ListCardContent & { title: string; icon: ReactNode; shows: (piece: CardPiece) => boolean }) {
  const left = videos.filter((video) => !video.watched && !video.gone)
  const seconds = left.reduce((sum, video) => sum + Math.max(0, video.duration - (resumePosition(video.id)?.t ?? 0)), 0)
  const latest = videos.reduce<FeedVideo | undefined>((newest, video) => (!newest || video.published > newest.published ? video : newest), undefined)
  const allLeft = videos.length > 0 && left.length === videos.length
  const counts = [
    allLeft ? plural(videos.length, '{n} video to watch', '{n} videos to watch') : plural(videos.length, '{n} video', '{n} videos'),
    allLeft || !videos.length ? '' : left.length ? plural(left.length, '{n} to watch', '{n} to watch') : t('all watched'),
    playlists ? plural(playlists, '{n} playlist', '{n} playlists') : '',
  ].filter(Boolean)
  return (
    <>
      {shows('listPicture') && (
        <>
          {thumbnail && (
            <span className="video-thumb">
              <img src={thumbnail} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
            </span>
          )}
          <span className="video-card-head">
            {!thumbnail && icon}
            <span className="video-card-title">{title}</span>
          </span>
        </>
      )}
      {shows('listCounts') && <span className="video-card-line">{counts.join(' · ')}</span>}
      {shows('listTime') && seconds > 0 && <span className="video-card-line">{t('{time} left', { time: playtimeText(seconds) })}</span>}
      {shows('listLatest') && latest && (
        <>
          <span className="video-card-line">{t('Latest video: {day}', { day: videoDay(latest) })}</span>
          <span className="video-card-latest">{latest.title}</span>
        </>
      )}
    </>
  )
}

// A channel as a folder: its 2 or more videos, or any with sub-folders of its own, in one row
function VideoGroup({ id, channelKey: key, name, icon, platform, videos, open, newCount, onToggle, onMenu }: {
  id: string
  channelKey: string
  name: string
  icon: string | null
  platform: FeedVideo['platform']
  videos: FeedVideo[]
  open: boolean
  newCount: number
  onToggle: () => void
  onMenu?: (x: number, y: number) => void
}) {
  return (
    <FoldRow
      id={`group-${id}`}
      drop={{ channel: key, open: id }}
      icon={
        icon ? (
          <img className="video-follow-icon" src={icon} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="video-follow-icon" />
        )
      }
      title={name}
      logo={<VideoLogo platform={platform} />}
      count={videos.length}
      newest={videos[0]}
      newCount={newCount}
      open={open}
      onMenu={onMenu}
      onToggle={onToggle}
      card={{ videos }}
    />
  )
}

// One video: a click opens it in the player window and marks it as opened; it stays in To watch
// until it's ticked. A video that's gone can't be opened, only removed from the list. In a playlist
// (playlistId): the next one follows at its end and it can't be moved to a folder. In a playlist or
// in Rewatch (kept), it stays there grayed once watched. In Rewatch: when it was last watched.
// Three lines beside the picture: title (2 lines), channel, then date and extras; the row is as
// high as its picture. Tag: "New" (green), not once started (its bar shows it). In the
// Queue group (queued: that group's id): a second copy of the row, dragged only to change its place
// in the Queue; a playlist's video shows its playlist (from) instead of its channel; one of
// Rewatch's in To watch's group (ofRewatch) gets a ↻ icon, Music's a music note. after: the videos after it in its list, for ⏭.
// toQueue: it can be dragged into the Queue (videoDrag.ts); a playlist's video only there.
// Picking several videos (Ctrl+click, Shift+click a range; user, 2026-11-18): a row's part of it.
// Its key is the row's data-item, so a video shown twice (Queue and below) is two rows.
type RowPick = { on: boolean; many: boolean; click: (e: React.MouseEvent, key: string) => void; drop: () => void }
const rowKey = (videoId: string, playlistId?: string, queued?: string) => `${queued ? 'queued ' : ''}${playlistId ? `${playlistId} ${videoId}` : videoId}` // i18n-ok

function VideoRow({ video, isNew, depth = 0, playlistId, kept = !!playlistId, lastWatched, queued, ofRewatch, from, after, toQueue, pick, onMenu, onOpenRow }: {
  video: FeedVideo
  isNew: boolean
  depth?: number
  playlistId?: string
  kept?: boolean
  lastWatched?: boolean
  queued?: string
  ofRewatch?: boolean
  from?: string
  after?: UpNext[]
  toQueue?: { leaves: boolean }
  pick?: RowPick // none: this list can't pick (Watched), or the video is gone
  onMenu?: (x: number, y: number) => void
  onOpenRow: (id: string) => void
}) {
  const position = useResumePosition(video.id)
  // Stopped partway: its progress on the thumbnail
  const opened = position && !video.watched && !video.gone ? position : null
  const showLastWatched = !!lastWatched && !!video.watchedAt
  // An unwatched Twitch past stream: when Twitch deletes it (user: catching up on a long one),
  // only in its last week (user: always shown, it crowded the rows)
  const deletionSoon = video.platform === 'twitch' && video.kind === 'archive' && !!video.keep && !video.watched && !video.gone && video.published + video.keep * 86_400_000 - Date.now() < DELETION_SOON
  // i18n-ok
  const deletion = deletionSoon ? twitchDeletionText(video.published, video.keep!) : null
  const rowRef = useRef<HTMLLIElement>(null)
  const hover = useHoverTip(CARD_DELAY)
  const shows = useCardPieces()
  const withCard = VIDEO_PIECES.some(shows)
  // The card shows the whole title and channel: no browser tooltip then
  const tooltips = !withCard || !shows('videoDetails')
  const key = rowKey(video.id, playlistId, queued)
  const place = useRowPlace(depth)
  function open(e: React.MouseEvent) {
    if (pick && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      pick.click(e, key)
      return
    }
    pick?.drop()
    playVideo(video, playlistId, undefined, after)
    void markOpened(video.id)
  }
  function openInBrowser() {
    openLink(video.url)
    void markOpened(video.id)
  }
  return (
    <li
      ref={rowRef}
      className={`video-row${place.inSection}${video.gone ? ' gone' : ''}${kept && video.watched ? ' seen' : ''}${pick?.on ? ' picked' : ''}`}
      style={place.style}
      data-item={key}
      data-pick={pick ? key : undefined}
      data-queue-group={queued}
      data-queue-id={queued && video.id}
      // No dragging while several are picked (user): which ones would move isn't clear
      onPointerDown={pick?.many ? undefined : queued ? dragInQueue : playlistId && !toQueue ? undefined : (e) => dragVideo(e, video, { open: onOpenRow, toQueue, episode: !!playlistId })}
      onDragStart={(e) => e.preventDefault()} // the thumbnail's own dragging
      // The usual one-video menu; the picks drop, so it's clear it's for this one (user)
      onContextMenu={(e) => {
        e.preventDefault()
        pick?.drop()
        onMenu?.(e.clientX, e.clientY)
      }}
    >
      <button className="video-row-open" disabled={video.gone} onClick={open} {...(withCard && hover.props)}>
        <VideoThumb video={video} opened={opened} />
        <span className="video-text">
          <span className="video-title" title={tooltips ? video.title : undefined}>{video.title}</span>
          <span className="video-meta video-by">
            {kept && video.watched && <Check size={14} className="video-seen" aria-label={t('Watched')} />}
            {ofRewatch && <Repeat size={14} className="video-logo" aria-label={t('In Rewatch')} />}
            {queued && video.music && <Music size={14} className="video-logo" aria-label={t('In Music')} />}
            {from ? <ListVideo size={15} className="video-logo" aria-label={t('Playlist')} /> : <VideoLogo platform={video.platform} />}
            <span className="video-channel" title={tooltips ? from ?? video.channel : undefined}>{from ?? video.channel}</span>
          </span>
          <span className="video-meta">
            <span>{videoDay(video)}</span>
            {video.gone && <span className="video-extra">{t('No longer available')}</span>}
            {showLastWatched && <span className="video-extra">{lastWatchedText(video.watchedAt!)}</span>}
            {deletion && <span className="video-extra">{deletion}</span>}
            {/* Started: its bar on the picture says so; a stream still live says so on its picture */}
            {isNew && !opened && <span className="video-new">{t('New')}</span>}
          </span>
        </span>
      </button>
      {!video.gone && (
        <button className="video-row-action" title={t('Open in browser')} onClick={openInBrowser}>
          <ExternalLink size={16} />
        </button>
      )}
      {video.watched ? (
        <>
          <button className="video-row-action" title={t('Back to To watch')} onClick={() => void setWatched(video.id, false)}>
            <Undo2 size={16} />
          </button>
          {!kept && (
            <button className="video-row-action" title={t('Remove from Watched')} onClick={() => void clearWatched([video.id])}>
              <X size={16} />
            </button>
          )}
        </>
      ) : video.gone ? (
        <button className="video-row-action" title={t('Remove')} onClick={() => void clearWatched([video.id])}>
          <X size={16} />
        </button>
      ) : (
        <button
          className="video-row-action"
          title={video.music ? t('Done: remove from Music') : t('Mark as watched')}
          onClick={() => void (video.music ? clearWatched([video.id]) : setWatched(video.id, true))}
        >
          <Check size={16} />
        </button>
      )}
      {withCard && hover.open && (
        <TipBox at={rowRef} className="video-card">
          <VideoCardContent video={video} opened={opened} from={from} shows={shows} />
        </TipBox>
      )}
    </li>
  )
}

// List view, wide window: the Queue on the left, pinned, the rest on the right, once two columns of
// ~540 px fit (user, 2026-11-25). Also gives CSS the bar's and the page's heights for the pinned
// column. Measured before the list loads, so its scroll is put back in the right layout.
const SPLIT_WIDTH = 2 * 540 + 28 // 28 = the gap between the columns
function useSplitWidth(pageRef: RefObject<HTMLElement | null>, columnRef: RefObject<HTMLDivElement | null>) {
  const [wide, setWide] = useState(false)
  useLayoutEffect(() => {
    const page = pageRef.current
    const column = columnRef.current
    if (!page || !column) return
    const bar = column.querySelector<HTMLElement>('.video-toolbar')
    const fit = () => {
      const style = getComputedStyle(column)
      setWide(column.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) >= SPLIT_WIDTH)
      column.style.setProperty('--video-bar-height', `${bar?.offsetHeight ?? 0}px`)
      column.style.setProperty('--video-page-height', `${page.clientHeight}px`)
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(page)
    watch.observe(column)
    if (bar) watch.observe(bar)
    return () => watch.disconnect()
  }, [pageRef, columnRef])
  return wide
}

// The Video tab (video.ts). Uses the Games tab's page layout (.games).
function VideoView() {
  const pageRef = useRef<HTMLElement>(null)
  usePage(pageRef)
  const columnRef = useRef<HTMLDivElement>(null)
  const wide = useSplitWidth(pageRef, columnRef)
  const feed = useVideoFeed()
  const newIds = useNewVideos(feed)
  const { checking, errors } = useChecking()
  // The list and follow last shown, on this PC (user, 2026-11-16): the tab reopens on them
  const [storedList, setList] = useLocalState<List>('syncr.video.list', 'towatch')
  const pickedList: List = ['towatch', 'rewatch', 'watched', 'music'].includes(storedList) ? storedList : 'towatch' // i18n-ok
  // Rewatch is its own list, or a section at the bottom of To watch (Settings → Video)
  const asSection = useRewatchSection()
  const musicName = useMusicName()
  const [layout, setLayout] = useLocalState<ListLayout>('syncr.video.layout', 'list')
  const listClass = `video-list${useBigPictures() ? ' big-pictures' : ''}${layout === 'grid' ? ' grid' : ''}` // i18n-ok
  const list: List = asSection && pickedList === 'rewatch' ? 'towatch' : pickedList
  const [channel, setChannel] = useLocalState('syncr.video.follow', 'all') // a follow's id, or all of them
  const [adding, setAdding] = useState<string | null>(null) // Add a follow open, with the link it starts with
  const [addingVideo, setAddingVideo] = useState(false)
  const [addingPlaylist, setAddingPlaylist] = useState(false)
  const [playlistMenu, setPlaylistMenu] = useState<{ playlist: VideoPlaylist; x: number; y: number } | null>(null)
  const [removingPlaylist, setRemovingPlaylist] = useState<VideoPlaylist | null>(null)
  // A new folder (with where it goes, the row to open to show it, the video to move into it), or a
  // folder to rename
  const [naming, setNaming] = useState<{ parentId: string | null; sub?: boolean; channel?: string; openId?: string; videoIds?: string[]; playlistId?: string } | { folder: VideoFolder } | null>(null)
  const [barMenu, setBarMenu] = useState<{ kind: 'add' | 'more'; x: number; y: number } | null>(null)
  const [channelMenu, setChannelMenu] = useState<{ key: string; openId: string; x: number; y: number; follow?: VideoFollow } | null>(null)
  // A video's right-click menu (a playlist's video: only the Queue's item, it can't be moved)
  const [moving, setMoving] = useState<{ video: FeedVideo; x: number; y: number; episode?: boolean } | null>(null)
  const [folderMenu, setFolderMenu] = useState<{ folder: VideoFolder; x: number; y: number } | null>(null)
  // The picked rows (RowPick), the row a Shift+click range starts from, and the bar's folder list
  const [picks, setPicks] = useState<ReadonlySet<string>>(() => new Set())
  const pickStart = useRef<string | null>(null)
  const [pickFolders, setPickFolders] = useState<{ x: number; y: number } | null>(null)
  const [deleting, setDeleting] = useState<VideoFolder | null>(null)
  // Picked videos to delete, once the bar's bin is clicked (asks first: gone on every device)
  const [deletingPicks, setDeletingPicks] = useState<{ videos: FeedVideo[]; skipped: boolean } | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [grouped, setGrouped] = useLocalState('syncr.video.byChannel', false)
  const [openGroups, setOpenGroups] = useLocalState<string[]>('syncr.video.openGroups', [])
  // The Queue group (videoQueue.ts), at the top of To watch and of Rewatch: shown or not, with
  // Rewatch's items in To watch or not (More menu), folded or not (open at first)
  const [showQueue, setShowQueue] = useLocalState('syncr.video.showQueue', true)
  const [queueRewatch, setQueueRewatch] = useLocalState('syncr.video.queueRewatch', true)
  const [queueFolded, setQueueFolded] = useLocalState('syncr.video.queueFolded', false)
  const [partFolded, setPartFolded] = useLocalState('syncr.video.partFolded', false) // From your follows, or Rewatch's list
  const [addedFolded, setAddedFolded] = useLocalState('syncr.video.addedFolded', false) // Added by you
  // The search row (null: closed; 🔍 or Ctrl+F opens it). While searching, every group with a match
  // shows open; a click folds one for this search only (searchFolded), what's remembered stays.
  const [search, setSearch] = useState<string | null>(null)
  const query = search?.trim() ?? ''
  const searching = !!query
  const searchRef = useRef<HTMLInputElement>(null)
  const [searchFolded, setSearchFolded] = useState<{ query: string; ids: ReadonlySet<string> }>({ query: '', ids: new Set() })
  const foldedNow = (id: string) => searchFolded.query === query && searchFolded.ids.has(id)
  function foldForSearch(id: string) {
    const ids = new Set(searchFolded.query === query ? searchFolded.ids : [])
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    setSearchFolded({ query, ids })
  }
  const isOpen = (id: string) => (searching ? !foldedNow(id) : openGroups.includes(id))
  const queueOpen = searching ? !foldedNow('queue') : !queueFolded
  const partOpen = searching ? !foldedNow('part') : !partFolded
  const addedOpen = searching ? !foldedNow('added') : !addedFolded

  const queue = useQueue()
  const follows = feed?.follows
  // The filter's follows: music ones in Music, the others elsewhere
  const listFollows = follows?.filter((follow) => !!follow.music === (list === 'music'))
  const anyMusic = !!follows?.some((follow) => follow.music) || !!feed?.music.length
  // Reopened on Music with no music left: To watch. Only on opening: removing the last music
  // follow while in Music keeps you there, as before.
  const openingChecked = useRef(false)
  useEffect(() => {
    if (openingChecked.current || !feed) return
    openingChecked.current = true
    if (pickedList === 'music' && !anyMusic) setList('towatch')
  }, [feed, pickedList, anyMusic, setList])
  // A follow that was just removed: back to all of them. Rewatch is your own list, like folders.
  const shownChannel = list !== 'rewatch' && listFollows?.some((follow) => follow.id === channel) ? channel : 'all'
  useListScroll(pageRef, list, !!feed, shownChannel)
  // Rewatch's videos are only in its folders (videosIn)
  const videos = (list === 'towatch' ? feed?.toWatch : list === 'watched' ? feed?.watched : list === 'music' ? feed?.music : [])?.filter((video) => shownChannel === 'all' || video.followId === shownChannel)
  const listRef = useRef<HTMLElement>(null) // the list, or both columns side by side
  // One channel chosen: there's nothing to group. Watched is one plain list, watched last on top.
  const grouping = grouped && shownChannel === 'all' && (list === 'towatch' || list === 'music')
  // The list loading counts as a change all at once too: its rows don't grow in when the tab opens
  // (which also put the remembered scroll back to the top, the page being short meanwhile)
  // A drop into or out of the Queue too: its rows are already in place (videoDrag.ts)
  const queueDrops = useQueueDrops()
  const videoLifted = useVideoLifted()
  useListItems(listRef, `${list} ${shownChannel} ${grouping} ${!!feed} ${queueDrops} ${layout} ${wide} ${query}`) // a search shows its rows at once
  const tagNew = (video: FeedVideo) => (newIds.has(video.id) || isRecent(video)) && !video.opened && !video.gone && !video.watched
  const toggleGroup = (id: string) => (searching ? foldForSearch(id) : setOpenGroups((now) => (now.includes(id) ? now.filter((other) => other !== id) : [...now, id])))
  const anyVideos = !!feed?.toWatch.length || !!feed?.watched.length
  const anyFollowsOrVideos = !!follows?.length || anyVideos
  // Under its button, ending at its right edge
  function openBarMenu(kind: 'add' | 'more', button: HTMLElement) {
    const box = button.getBoundingClientRect()
    setBarMenu({ kind, x: box.right, y: box.bottom + 4 })
  }
  // Shows where it went: To watch, all follows, its group open (a video: Added by you too)
  const openRow = (id: string) => (id === 'queue' ? setQueueFolded(false) : setOpenGroups((now) => (now.includes(id) ? now : [...now, id])))
  function showAdded(id: string) {
    setList('towatch')
    setChannel('all')
    openRow(id)
    if (!feed?.playlists.some(({ playlist }) => playlist.id === id)) setAddedFolded(false)
  }
  // A link pasted with Ctrl+V anywhere in the tab but a text field or a window, or copied before
  // the shortcut (videoPaste.ts): its line under the bar, then what to show once it's read
  const pasted = useSyncExternalStore(subscribePaste, pasteLine)
  const nextAction = useSyncExternalStore(subscribePaste, pasteAction)
  useEffect(() => {
    if (!nextAction) return
    pasteActionDone()
    if (nextAction.kind === 'follow') setAdding(nextAction.link)
    else if (nextAction.kind === 'queue') {
      setList('towatch')
      setChannel('all')
      setQueueFolded(false)
    }
    else showAdded(nextAction.id)
  })
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.dialog')) return
      const url = linkIn(event.clipboardData?.getData('text/plain') ?? '')
      if (!url) return
      event.preventDefault()
      void pasteLink(url, false)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])
  // Ctrl+F: the search row with the cursor in it (its text selected when already open), unless a
  // window is open
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'f' || document.querySelector('.dialog')) return
      e.preventDefault()
      setSearch((now) => now ?? '')
      searchRef.current?.select() // a new row gets the cursor by itself (autoFocus)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // The picks drop on another list or follow, on Escape (a menu or window open closes first), and
  // on a click on empty space in the tab (a scroll bar's isn't a click)
  useEffect(() => {
    pickStart.current = null
    setPicks(new Set())
  }, [list, shownChannel])
  const anyPicked = picks.size > 0
  useEffect(() => {
    if (!anyPicked) return
    const drop = () => {
      pickStart.current = null
      setPicks(new Set())
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.context-menu, .dialog') && drop()
    // Pressed and let go on empty space: a press on a row let go elsewhere (trying to drag) keeps them
    const outside = (e: Event) => !(e.target as Element).closest('[data-pick], .video-pick-bar')
    let pressedOutside = false
    const onDown = (e: PointerEvent) => (pressedOutside = outside(e))
    const onClick = (e: MouseEvent) => pressedOutside && outside(e) && drop()
    const page = pageRef.current
    window.addEventListener('keydown', onKey)
    page?.addEventListener('pointerdown', onDown)
    page?.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      page?.removeEventListener('pointerdown', onDown)
      page?.removeEventListener('click', onClick)
    }
  }, [anyPicked])
  const allFolders = feed?.folders ?? []
  const folders = shownChannel === 'all' && list !== 'watched' ? allFolders : []
  // Rewatch is at the bottom, not among the folders by name; Music is a list of its own
  const foldersIn = (parentId: string | null) => folders.filter((folder) => folder.parentId === parentId && !folder.channel && folder.id !== REWATCH && folder.id !== MUSIC)
  const rewatchIds = inRewatch(allFolders)
  // Rewatch's videos (feed.rewatch) only show in To watch with all follows, like folders
  const videosIn = (folderId: string) => (rewatchIds.has(folderId) ? feed?.rewatch ?? [] : videos ?? []).filter((video) => video.folderId === folderId)
  // The videos after this one among those shown with it (siblings), for ⏭: never one that's gone,
  // nor a watched one (as in playlists), except in Watched where they all are
  const upNextOf = (video: FeedVideo, siblings: FeedVideo[]): UpNext[] =>
    siblings.slice(siblings.indexOf(video) + 1).filter((other) => !other.gone && (list === 'watched' || !other.watched)).map((other) => ({ video: other }))
  // The rows shown in this render that can be picked: a pick whose row went (folded, watched...)
  // no longer counts. Watched too (user, 2026-11-23).
  const pickRows = new Map<string, { video: FeedVideo; episode: boolean }>()
  const dropPicks = () => {
    pickStart.current = null
    setPicks((now) => (now.size ? new Set() : now))
  }
  // Ctrl+click: one more or one less · Shift+click: from the last clicked row to this one, in the
  // order shown (Ctrl+Shift adds that range to the others), like Windows' file lists
  function clickPick(e: React.MouseEvent, key: string) {
    const order = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-pick]') ?? [])].map((row) => row.dataset.pick!)
    const from = pickStart.current && order.includes(pickStart.current) ? order.indexOf(pickStart.current) : -1
    if (e.shiftKey && from >= 0) {
      const to = order.indexOf(key)
      const range = order.slice(Math.min(from, to), Math.max(from, to) + 1)
      setPicks((now) => new Set([...(e.ctrlKey || e.metaKey ? now : []), ...range]))
      return
    }
    pickStart.current = key
    setPicks((now) => {
      const next = new Set(now)
      if (!e.shiftKey && next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  function pickOf(video: FeedVideo, playlistId?: string, queued?: string): RowPick | undefined {
    if (video.gone) return undefined
    const key = rowKey(video.id, playlistId, queued)
    pickRows.set(key, { video, episode: !!playlistId })
    return { on: picks.has(key), many: picks.size > 1, click: clickPick, drop: dropPicks }
  }
  // Outside Watched, a watched video is one of Rewatch's: it stays, grayed
  const videoRow = (video: FeedVideo, siblings: FeedVideo[], depth = 0) => (
    <VideoRow key={video.id} video={video} isNew={tagNew(video)} depth={depth} kept={list !== 'watched'} lastWatched={!!video.folderId && rewatchIds.has(video.folderId)} after={upNextOf(video, siblings)} toQueue={toQueue(video)} pick={pickOf(video)} onMenu={(x, y) => setMoving({ video, x, y })} onOpenRow={openRow} />
  )
  const folderName = (folder: VideoFolder) => (folder.id === REWATCH ? t('Rewatch') : folder.name)
  // The rows of the videos the search keeps; ⏭ still goes on through all of them
  const foundRows = (all: FeedVideo[], depth: number) => all.filter((video) => found(video)).map((video) => videoRow(video, all, depth))
  // The search: a video shows when its title (DeArrow's or YouTube's) or channel matches, or the name
  // of its playlist or of a folder it's in (a name that matches shows all of it)
  const nameHit = (name: string) => searchMatches(query, [name])
  function folderHit(folderId: string | null | undefined) {
    for (let folder = allFolders.find((other) => other.id === folderId); folder; folder = allFolders.find((other) => other.id === folder!.parentId)) {
      if (nameHit(folderName(folder))) return true
    }
    return false
  }
  const found = (video: FeedVideo, playlist?: VideoPlaylist) =>
    !searching || searchMatches(query, [video.title, video.originalTitle, video.channel]) || (playlist ? nameHit(playlist.name) || folderHit(placeOf(playlist)) : folderHit(video.folderId))
  // Every folder to choose from, each under its parent, with its whole path
  function folderChoices(level: VideoFolder[], path: string): { folder: VideoFolder; path: string }[] {
    return level.flatMap((folder) => {
      const own = path + folderName(folder)
      return [{ folder, path: own }, ...folderChoices(allFolders.filter((other) => other.parentId === folder.id), `${own} / `)]
    })
  }
  // The folder at the top of this one: its channel says whose it is (none: your own)
  function topFolder(folder: VideoFolder | undefined) {
    while (folder?.parentId) {
      const { parentId } = folder
      folder = allFolders.find((other) => other.id === parentId)
    }
    return folder
  }
  function inOwnFolder(video: FeedVideo) {
    const top = topFolder(allFolders.find((other) => other.id === video.folderId))
    return !!top && !top.channel
  }
  // Your own folders by name, then Rewatch with its own
  const ownFolderChoices = () => folderChoices([
    ...allFolders.filter((folder) => !folder.parentId && !folder.channel && folder.id !== REWATCH && folder.id !== MUSIC),
    ...allFolders.filter((folder) => folder.id === REWATCH),
  ], '')
  const folderIcon = (folder: VideoFolder) => (folder.id === REWATCH ? Repeat : Folder)
  // Your own folders, then those of this video's channel: it can't go in another channel's. With
  // both, each list gets a small title instead of the channel's name on every line.
  // A playlist's Move to folder list: your own folders only (a playlist isn't a channel's)
  function playlistFolderItems(playlist: VideoPlaylist): MenuItem[] {
    return [
      ...ownFolderChoices().map(({ folder, path }): MenuItem => ({
        label: path,
        icon: folderIcon(folder),
        checked: folder.id === placeOf(playlist),
        onClick: () => void changePlaylist(playlist.id, { folderId: folder.id }),
      })),
      { label: t('New folder…'), icon: FolderPlus, divider: true, onClick: () => setNaming({ parentId: null, playlistId: playlist.id }) },
      ...(placeOf(playlist) ? [{ label: t('Remove from folder'), icon: FolderOutput, divider: true, onClick: () => void changePlaylist(playlist.id, { folderId: null }) }] : []),
    ]
  }

  // One video's folders (its menu), or the picked ones' (the bar: their channel's only when they
  // all share it). All music or none (pickedFolders).
  function videoFolderItems(moved: FeedVideo[], onDone?: () => void): MenuItem[] {
    const [video] = moved
    // A music video: Music's folders only
    const own = video.music ? folderChoices(allFolders.filter((folder) => folder.parentId === MUSIC), '') : ownFolderChoices()
    const oneChannel = moved.every((other) => channelKey(other) === channelKey(video))
    const theirs = video.music || !oneChannel ? [] : allFolders.filter((folder) => !folder.parentId && folder.channel === channelKey(video))
    const titled = own.length > 0 && theirs.length > 0
    const items = (choices: { folder: VideoFolder; path: string }[], section?: string) => choices.map(({ folder, path }, index): MenuItem => ({
      label: path,
      icon: folderIcon(folder),
      section: index === 0 ? section : undefined,
      checked: moved.every((other) => other.folderId === folder.id),
      onClick: () => {
        for (const other of moved) void moveToFolder(other.id, folder.id)
        onDone?.()
      },
    }))
    return [
      ...items(own, titled ? t('Your folders') : undefined),
      ...items(folderChoices(theirs, titled ? '' : `${video.channel} / `), titled ? video.channel : undefined),
    ]
  }
  const allIn = (folder: VideoFolder): FeedVideo[] => [...videosIn(folder.id), ...foldersIn(folder.id).flatMap(allIn)]
  // Playlists, each at the top or in one of your own folders (one deleted or a channel's: the top).
  // Only in To watch with all follows: it's your own list, not a channel's.
  const playlists = (list === 'towatch' || list === 'rewatch') && shownChannel === 'all' ? feed?.playlists ?? [] : []
  const placeOf = (playlist: VideoPlaylist) => {
    const folder = folders.find((other) => other.id === playlist.folderId)
    return folder && !topFolder(folder)?.channel ? folder.id : null
  }
  const playlistsIn = (folderId: string | null) => playlists.filter(({ playlist }) => placeOf(playlist) === folderId)
  const allPlaylistsIn = (folder: VideoFolder): typeof playlists => [...playlistsIn(folder.id), ...foldersIn(folder.id).flatMap(allPlaylistsIn)]
  // What the search keeps: each playlist with its matching videos, none left = it doesn't show
  const foundLists = (some: typeof playlists) => some
    .map(({ playlist, videos: episodes }) => ({ playlist, videos: episodes.filter((video) => found(video, playlist)) }))
    .filter(({ playlist, videos: episodes }) => !searching || episodes.length || nameHit(playlist.name))
  // A folder, then what's in it when it's open: its sub-folders, its playlists, then its videos,
  // oldest on top like a playlist. Only in To watch, empty ones too, or a new folder couldn't be
  // reached. Its count is its own videos and playlists ("3 videos · 1 playlist", "1 playlist"); its
  // "new" also counts its playlists' new videos.
  // A folder of yours whose videos, playlists and sub-folders all come from one channel: that
  // channel's picture (none when empty, mixed, or no picture is known; never Rewatch or a channel's)
  function folderPicture(folder: VideoFolder, inside: FeedVideo[], lists: typeof playlists) {
    if (folder.id === REWATCH || topFolder(folder)?.channel) return null
    const all = [...inside, ...lists.flatMap(({ videos: episodes }) => episodes)]
    const channels = new Set(all.map(channelKey))
    if (channels.size !== 1) return null
    const [only] = channels
    return follows?.find((follow) => channelKey(follow) === only)?.icon ?? all.find((video) => video.channelIcon)?.channelIcon ?? null
  }

  // section: Rewatch as a section of To watch (its header, what's inside not one level deeper)
  function folderRows(folder: VideoFolder, depth: number, section?: string): ReactNode[] {
    const inside = allIn(folder).filter((video) => found(video))
    const lists = foundLists(allPlaylistsIn(folder))
    // Searching: only a folder with a match, or whose name matches
    if (searching && !inside.length && !lists.length && !folderHit(folder.id)) return []
    const picture = folderPicture(folder, inside, lists)
    const newInPlaylists = lists.flatMap(({ videos: episodes }) => episodes).filter(tagNew).length
    const countText = lists.length
      ? [inside.length ? plural(inside.length, '{n} video', '{n} videos') : '', plural(lists.length, '{n} playlist', '{n} playlists')].filter(Boolean).join(' · ')
      : undefined
    // Rewatch as a section with nothing in it: still shown, folded and dimmed
    const empty = !!section && !inside.length && !lists.length && !foldersIn(folder.id).length
    const open = isOpen(folder.id) && !empty
    return [
      <FoldRow
        key={folder.id}
        id={folder.id}
        drop={{ folder: folder.id, channel: topFolder(folder)?.channel ?? undefined, open: folder.id }}
        icon={
          picture ? (
            <span className="video-folder-picture">
              <ChannelPicture src={picture} />
              <span className="video-folder-badge"><Folder size={10} /></span>
            </span>
          ) : section ? (
            <span className="video-section-icon"><Repeat size={20} /></span>
          ) : (
            <span className="video-follow-icon video-folder-icon">{folder.id === REWATCH ? <Repeat size={15} /> : <Folder size={15} />}</span>
          )
        }
        title={folderName(folder)}
        count={inside.length}
        countText={countText}
        newest={[...inside].sort((a, b) => b.published - a.published)[0]}
        newCount={inside.filter(tagNew).length + newInPlaylists}
        open={open}
        depth={depth}
        onToggle={() => toggleGroup(folder.id)}
        onMenu={(x, y) => setFolderMenu({ folder, x, y })}
        card={{ videos: [...inside, ...lists.flatMap(({ videos: episodes }) => episodes)], playlists: lists.length }}
        section={section}
        empty={empty}
      />,
      ...(section ? [<Section key={`${folder.id}-in`} color={section}>{open && contents(depth)}</Section>] : open ? contents(depth + 1) : []),
    ]
    function contents(level: number) {
      return [
        ...foldersIn(folder.id).flatMap((sub) => folderRows(sub, level)),
        ...playlistsIn(folder.id).flatMap((entry) => playlistRows(entry, level)),
        ...foundRows(videosIn(folder.id).reverse(), level),
      ]
    }
  }
  // A playlist's row, then its videos in the chosen order when it's open (its watched videos stay in
  // it). Dragged by its row into your own folders.
  function playlistRows({ playlist, videos: episodes }: (typeof playlists)[number], depth: number): ReactNode[] {
    // Searching: its matching videos (all when its name or folder matches); its counts stay whole
    const shownEpisodes = episodes.filter((video) => found(video, playlist))
    if (searching && !shownEpisodes.length && !nameHit(playlist.name) && !folderHit(placeOf(playlist))) return []
    const open = isOpen(playlist.id)
    const nextUp = episodes.find((video) => !video.watched)
    // In Rewatch: when one of its videos was last watched
    const inRewatch = !!playlist.folderId && rewatchIds.has(playlist.folderId)
    const lastAt = inRewatch ? Math.max(0, ...episodes.map((video) => video.watchedAt ?? 0)) : 0
    const watchedCount = t('{watched} of {total} watched', { watched: episodes.filter((video) => video.watched).length, total: episodes.length })
    return [
      <FoldRow
        key={playlist.id}
        id={playlist.id}
        // Dimmed when it doesn't check for new videos (an old, finished one)
        icon={
          <span
            className={playlist.keepChecking ? 'video-follow-icon video-folder-icon' : 'video-follow-icon video-folder-icon not-checking'}
            title={playlist.keepChecking ? t('Checks for new videos once a day') : t('Doesn’t check for new videos')}
          >
            <ListVideo size={15} />
          </span>
        }
        title={playlist.name}
        logo={<VideoLogo platform="youtube" />}
        count={episodes.length}
        countText={lastAt ? `${watchedCount} · ${lastWatchedText(lastAt)}` : watchedCount}
        newCount={episodes.filter(tagNew).length}
        open={open}
        depth={depth}
        onToggle={() => toggleGroup(playlist.id)}
        onMenu={(x, y) => setPlaylistMenu({ playlist, x, y })}
        onPointerDown={(e) => dragPlaylist(e, playlist.id, placeOf(playlist), openRow)}
        card={{ videos: episodes, thumbnail: episodes[0]?.thumbnail }}
        actions={
          <>
            <button
              className={`video-row-action${playlist.newestFirst ? ' on' : ''}`}
              aria-pressed={!!playlist.newestFirst}
              title={orderButtonTitle(playlist)}
              onClick={() => void changePlaylist(playlist.id, { newestFirst: !playlist.newestFirst })}
            >
              <ArrowDownUp size={16} />
            </button>
            <button
              className="video-row-action"
              disabled={!nextUp}
              title={nextUp ? t('Play the next video') : t('Nothing to watch')}
              onClick={() => {
                if (!nextUp) return
                playVideo(nextUp, playlist.id)
                void markOpened(nextUp.id)
              }}
            >
              <Play size={16} />
            </button>
          </>
        }
      />,
      ...(open ? shownEpisodes.map((video) => <VideoRow key={`${playlist.id} ${video.id}`} video={video} isNew={tagNew(video)} depth={depth + 1} playlistId={playlist.id} lastWatched={inRewatch} toQueue={toQueue(video, true)} pick={pickOf(video, playlist.id)} onMenu={(x, y) => setMoving({ video, x, y, episode: true })} onOpenRow={openRow} />) : []),
    ]
  }
  // A channel's row, then what's in it when it's open: its sub-folders, then the rest of its videos
  function channelRows(id: string, key: string, shown: { name: string; icon: string | null; platform: FeedVideo['platform'] }, group: FeedVideo[], subs: VideoFolder[], menu = true) {
    // Searching: only with a match, counting the matches (a sub-folder's are in group too)
    const matches = group.filter((video) => found(video))
    if (searching && !matches.length && !subs.some((sub) => folderRows(sub, 1).length)) return []
    const open = isOpen(id)
    return [
      <VideoGroup
        key={`group-${id}`}
        id={id}
        channelKey={key}
        {...shown}
        videos={matches}
        open={open}
        newCount={matches.filter(tagNew).length}
        onToggle={() => toggleGroup(id)}
        onMenu={menu ? (x, y) => void followOf(key).then((follow) => setChannelMenu({ key, openId: id, x, y, follow })) : undefined}
      />,
      ...(open
        ? [
            ...subs.flatMap((sub) => folderRows(sub, 1)),
            ...foundRows(group.filter((video) => !video.folderId).reverse(), 1),
          ]
        : []),
    ]
  }
  // A chosen channel shows all its videos, wherever they are. So does the plain list for those in a
  // channel's sub-folders: these only exist in the channel's row.
  const mainVideos = (videos ?? []).filter((video) => shownChannel !== 'all' || list === 'watched' || !inOwnFolder(video))
  const channelFolders = (key: string) => folders.filter((folder) => folder.channel === key)
  // One shared Queue at the top of To watch and of Rewatch (user, 2026-11-18: not one per list), in
  // its order; folders and playlists also keep theirs (loose ones in To watch only show here). Holds
  // To watch's videos (the chosen follow's, its playlists only with All follows), Music's (user,
  // 2026-11-18: they only show here while queued; tagged with the music note) and Rewatch's (tagged
  // rewatch). In To watch, Rewatch's only with All follows and unless switched off (More menu).
  function queueCandidates() {
    const where = new Map<string, { video: FeedVideo; playlist?: VideoPlaylist; rewatch?: boolean }>()
    if (!feed || !showQueue || (list !== 'towatch' && list !== 'rewatch')) return where
    const allFollows = shownChannel === 'all'
    const withRewatch = list === 'rewatch' || (allFollows && queueRewatch)
    for (const video of feed.toWatch) if (allFollows || video.followId === shownChannel) where.set(video.id, { video })
    if (withRewatch) for (const video of feed.rewatch) if (!where.has(video.id)) where.set(video.id, { video, rewatch: true })
    if (allFollows) for (const video of feed.music) if (!where.has(video.id)) where.set(video.id, { video })
    for (const { playlist, videos: episodes } of feed.playlists) {
      const ofRewatch = !!playlist.folderId && rewatchIds.has(playlist.folderId)
      if (!allFollows || (ofRewatch && !withRewatch)) continue
      for (const video of episodes) if (!where.has(video.id)) where.set(video.id, { video, playlist, rewatch: ofRewatch })
    }
    return where
  }
  const candidates = queueCandidates()
  const queued = queue.flatMap(({ id }) => {
    const entry = candidates.get(id)
    return entry && !entry.video.watched && !entry.video.gone ? [entry] : []
  })
  // The Queue's videos the search keeps (⏭ still goes through the whole Queue)
  const queuedShown = queued.filter(({ video, playlist }) => found(video, playlist))
  // A video the Queue would show, not in it yet, can be dragged into it (user, 2026-11-18). leaves:
  // it then leaves its place, like a loose To watch video added another way (inQueueOnly).
  function toQueue(video: FeedVideo, episode = false) {
    if (!candidates.has(video.id) || video.watched || video.gone || queue.some((entry) => entry.id === video.id)) return undefined
    return { leaves: list === 'towatch' && !episode && !video.folderId }
  }
  // ⏭ from a Queue row goes on in the order shown once it plays: opened, it goes first (the others
  // after it as they are), except music, which keeps its place (videoPlayer.ts)
  const queueAfter = (video: FeedVideo) => (video.music ? queued.slice(queued.findIndex((entry) => entry.video === video) + 1) : queued.filter((entry) => entry.video !== video))
  // A section's header, then what's in it when it's open (user, 2026-11-18; each its own, 2026-11-28).
  // Empty: still shown, folded and dimmed, somewhere to drop (the Queue's header takes videos);
  // searching: only with a match. counted: the videos its header counts. inside: only called when
  // open, so folded rows can't be picked.
  function sectionRows(id: string, name: SectionName, icon: ReactNode, title: string, empty: boolean, inside: () => ReactNode[], counted: FeedVideo[], fold: { open: boolean; toggle: () => void }): ReactNode[] {
    if (searching && empty) return []
    const color = sectionColor(name)
    const open = fold.open && !empty
    return [
      <FoldRow
        key={id}
        id={id}
        icon={<span className="video-section-icon">{icon}</span>}
        title={title}
        count={counted.length}
        newCount={id === 'queue' ? 0 : counted.filter(tagNew).length}
        open={open}
        onToggle={() => (searching ? foldForSearch(id) : fold.toggle())}
        queueHead={id === 'queue'}
        section={color}
        empty={empty}
      />,
      <Section key={`${id}-in`} color={color}>
        {open ? inside() : null}
      </Section>,
    ]
  }
  // Its videos at the list's left edge, like the sections below. Switched off (⋯): no section.
  function queueRows(): ReactNode[] {
    const id = 'queue'
    if (!showQueue || (list !== 'towatch' && list !== 'rewatch')) return []
    const inside = () => queuedShown.map(({ video, playlist, rewatch: ofRewatch }) => (
      <VideoRow
        key={`${id} ${video.id}`}
        video={video}
        isNew={false}
        playlistId={playlist?.id}
        queued={id}
        ofRewatch={ofRewatch}
        from={playlist?.name}
        after={queueAfter(video).map((entry) => ({ video: entry.video, playlistId: entry.playlist?.id }))}
        pick={pickOf(video, playlist?.id, id)}
        onMenu={(x, y) => setMoving({ video, x, y, episode: !!playlist })}
        onOpenRow={openRow}
      />
    ))
    return sectionRows(id, 'queue', <ListStart size={20} />, t('Queue'), !queuedShown.length, inside, queuedShown.map(({ video }) => video), { open: queueOpen, toggle: () => setQueueFolded(!queueFolded) })
  }
  // As a section: what's in Rewatch, folded at the bottom of To watch; empty: dimmed (user,
  // 2026-11-28). As a list: what's in it, like an open folder's.
  const rewatch = folders.find((folder) => folder.id === REWATCH)
  const rewatchRows = asSection && list === 'towatch' && rewatch
    ? folderRows(rewatch, 0, sectionColor('rewatch')) // its videos only when open (none: searching found nothing in it)
    : []
  const rewatchList = list === 'rewatch' && rewatch
    ? [
        ...foldersIn(REWATCH).flatMap((folder) => folderRows(folder, 0)),
        ...playlistsIn(REWATCH).flatMap((entry) => playlistRows(entry, 0)),
        ...foundRows(videosIn(REWATCH).reverse(), 0),
      ]
    : []
  // A folder or playlist's videos to start over: those watched or opened
  const startOverIds = (episodes: FeedVideo[]) => episodes.filter((video) => video.watched || video.opened).map((video) => video.id)
  const folderStartOver = (folder: VideoFolder) => startOverIds([...allIn(folder), ...allPlaylistsIn(folder).flatMap(({ videos: episodes }) => episodes)])
  // A video's own item: added at the bottom, or taken out (grayed for what can't go on: watched,
  // no longer available)
  function queueVideoItem(video: FeedVideo): MenuItem {
    if (queue.some((entry) => entry.id === video.id)) return { label: t('Remove from queue'), icon: ListX, onClick: () => leaveQueue([video.id]) }
    const why = video.watched ? t('Already watched') : video.gone ? t('No longer available') : undefined
    return { label: t('Add to queue'), icon: ListPlus, disabled: !!why, hint: why, onClick: () => addToQueue(video.id) }
  }
  // A video's "Open in browser", like its row's end button (none once it's gone from the site)
  function openVideoItem(video: FeedVideo): MenuItem[] {
    if (video.gone) return []
    return [{ label: t('Open in browser'), icon: ExternalLink, onClick: () => { openLink(video.url); void markOpened(video.id) } }]
  }
  // One switch for both lists (grayed in Watched and Music)
  const queueItem = (inList: boolean): MenuItem => ({
    label: t('Queue'),
    icon: ListStart,
    checked: showQueue,
    disabled: !inList,
    hint: inList ? t('Videos to go on with, at the top of the list') : t('Only in To watch and Rewatch'),
    onClick: () => setShowQueue(!showQueue),
  })
  const queueRewatchItem: MenuItem = {
    label: t('Rewatch items in the queue'),
    icon: Repeat,
    checked: queueRewatch,
    disabled: list !== 'towatch' || !showQueue || shownChannel !== 'all',
    hint: list !== 'towatch' ? t('Only in To watch') : !showQueue ? t('Queue hidden') : shownChannel !== 'all' ? t('Only with All follows') : t('Rewatch’s videos in To watch’s queue too'),
    onClick: () => setQueueRewatch(!queueRewatch),
  }
  // A channel's waiting screen at its videos' start (the player's ⏩, DECISIONS.md "VOD start skip"):
  // the same switch as in its follow window, and forgetting what it learned. Followed channels only.
  const startSkipItems = (follow: VideoFollow | undefined): MenuItem[] => [
    {
      label: t('Skip the waiting screen by itself'),
      icon: ChevronsRight,
      divider: true,
      checked: !!follow?.autoSkip,
      disabled: !follow || !!follow.music,
      hint: !follow ? t('Only for followed channels') : follow.music ? t('Not for music videos') : !follow.startLooks?.length ? t('Once it has learned the waiting screen: until then the skip button shows') : undefined,
      onClick: () => follow && void setFollowStartSkip(follow.id, { autoSkip: !follow.autoSkip }),
    },
    {
      label: t('Forget waiting screen'),
      icon: Eraser,
      disabled: !follow?.startLooks?.length,
      hint: !follow ? t('Only for followed channels') : !follow.startLooks?.length ? t('Nothing learned yet') : undefined,
      onClick: () => follow && void setFollowStartSkip(follow.id, { startLooks: [] }),
    },
  ]
  const startOverItem = (ids: string[]): MenuItem => ({
    label: t('Start over'),
    icon: RotateCcw,
    disabled: !ids.length,
    hint: ids.length ? undefined : t('Nothing watched yet'),
    onClick: () => void startOver(ids),
  })
  // A flat list, so a video stays the same item whether it's in a group or not. Music has no
  // channel sub-folders (its videos only go in Music's own folders).
  // A loose video in To watch's Queue shows only there (user: not twice); in a folder or playlist it
  // stays in place too (their order matters)
  const inQueueOnly = new Set(list === 'towatch' ? queued.flatMap(({ video, playlist, rewatch: ofRewatch }) => (playlist || ofRewatch || video.folderId ? [] : [video.id])) : [])
  function videoRows(source: FeedVideo[]) {
    const shown = source.filter((video) => !inQueueOnly.has(video.id))
    const groups = (grouping ? byChannel(shown) : shown.map((video) => [video]))
      .map((group) => ({ group, subs: grouping && list !== 'music' ? channelFolders(channelKey(group[0])) : [] }))
    // The videos shown on their own row (not in a channel's): one list for ⏭
    const loose = groups.flatMap(({ group, subs }) => (group.length === 1 && !subs.length ? group : []))
    return groups.flatMap(({ group, subs }) => videoGroupRows(group, subs, loose))
  }
  function videoGroupRows(group: FeedVideo[], subs: VideoFolder[], loose: FeedVideo[]) {
    const key = channelKey(group[0])
    if (group.length === 1 && !subs.length) return found(group[0]) ? [videoRow(group[0], loose)] : []
    const { followId, channel: name, channelIcon: icon, platform } = group[0]
    return channelRows(followId, key, { name, icon, platform }, group, subs, list !== 'music')
  }
  const musicList = list === 'music' ? [...foldersIn(MUSIC).flatMap((folder) => folderRows(folder, 0)), ...videoRows(mainVideos)] : []
  const watchedList = list === 'watched' ? videoRows(mainVideos) : []
  // To watch's sections (user, 2026-11-28): From your follows, Added by you (videos added by their
  // link, not in a folder: in one, a channel's too, they stay there), then your folders and the
  // playlists in none, between the sections, then Rewatch as a section (not inside the others,
  // user 2026-11-25)
  const addedLoose = (video: FeedVideo) => !!video.added && !video.folderId
  const followVideos = list === 'towatch' ? mainVideos.filter((video) => !addedLoose(video)) : []
  const followRows = list === 'towatch' ? [
    ...videoRows(followVideos),
    // Followed channels with sub-folders, and no videos to watch right now
    ...(grouping ? follows ?? [] : []).flatMap((follow) => {
      const key = channelKey(follow)
      const subs = channelFolders(key)
      if (!subs.length || followVideos.some((video) => channelKey(video) === key)) return []
      return channelRows(follow.id, key, follow, [], subs)
    }),
  ] : []
  const addedVideos = list === 'towatch' ? mainVideos.filter((video) => addedLoose(video) && !inQueueOnly.has(video.id)) : []
  const addedFound = addedVideos.filter((video) => found(video))
  const ownRows = list === 'towatch' ? [
    ...playlistsIn(null).flatMap((entry) => playlistRows(entry, 0)),
    ...foldersIn(null).flatMap((folder) => folderRows(folder, 0)),
  ] : []
  // The videos counted on a header: those not only in the Queue (searching: the matches); Rewatch's all
  const followsCounted = followVideos.filter((video) => !inQueueOnly.has(video.id) && found(video))
  const rewatchCounted = list === 'rewatch' && rewatch
    ? [...allIn(rewatch).filter((video) => found(video)), ...foundLists(allPlaylistsIn(rewatch)).flatMap(({ videos: episodes }) => episodes)]
    : []
  // Rewatch as a section doesn't count: To watch can say it's empty above it (searching, it does)
  const nothingShown = !queuedShown.length && !(searching && rewatchRows.length) && (list === 'towatch'
    ? !followRows.length && !addedFound.length && !ownRows.length
    : !(list === 'rewatch' ? rewatchList : list === 'music' ? musicList : watchedList).length)
  const partFold = { open: partOpen, toggle: () => setPartFolded(!partFolded) }
  const restRows = list === 'towatch'
    ? [
        ...sectionRows('part', 'follows', <Users size={20} />, t('From your follows'), !followRows.length, () => followRows, followsCounted, partFold),
        ...sectionRows('added', 'added', <LinkIcon size={20} />, t('Added by you'), !addedFound.length, () => addedFound.map((video) => videoRow(video, addedVideos)), addedFound, { open: addedOpen, toggle: () => setAddedFolded(!addedFolded) }),
        ...ownRows,
        ...rewatchRows,
      ]
    : list === 'rewatch'
      ? sectionRows('part', 'rewatch', <Repeat size={20} />, t('Rewatch'), !rewatchList.length, () => rewatchList, rewatchCounted, partFold)
      : list === 'music' ? musicList : watchedList
  // Nothing at all: only the message, and Rewatch as a section when it has something
  const queuePart = nothingShown ? [] : queueRows()
  const restPart = !nothingShown ? restRows : rewatch && (allIn(rewatch).length || allPlaylistsIn(rewatch).length || foldersIn(REWATCH).length) ? rewatchRows : []
  // Side by side (useSplitWidth): only in list view with something in the Queue; else one list
  const split = wide && layout === 'list' && queuedShown.length > 0
  // The picked videos still shown, each once (in the Queue and below: once), in the order shown
  const picked = [...new Map([...pickRows].filter(([key]) => picks.has(key)).map(([, row]) => [row.video.id, row])).values()]
  const pickedVideos = picked.map(({ video }) => video)
  const pickedIds = (some: FeedVideo[]) => some.map((video) => video.id)
  const queuedIds = new Set(queue.map((entry) => entry.id))
  const pickedToQueue = pickedVideos.filter((video) => !queuedIds.has(video.id) && !video.watched)
  const pickedInQueue = pickedVideos.filter((video) => queuedIds.has(video.id))
  const pickedUnwatched = pickedVideos.filter((video) => !video.watched)
  // Delete skips a playlist's videos: they belong to it
  const pickedDeletable = picked.filter(({ episode }) => !episode).map(({ video }) => video)
  const pickedFolders = picked.some(({ episode }) => episode)
    ? t('A playlist’s videos stay in it')
    : pickedVideos.some((video) => video.music) && pickedVideos.some((video) => !video.music)
      ? t('Songs and other videos have different folders')
      : undefined
  // A bar button: the action on the picked videos, then they drop
  // The pick bar too narrow for its buttons' names (a small window, French, many buttons): icons
  // only, names in tooltips. Measured with the names, whenever the window or the buttons change.
  const pickBar = useRef<HTMLDivElement>(null)
  const [pickCompact, setPickCompact] = useState(false)
  const pickButtons = [picked.length > 0, pickedUnwatched.length > 0, pickedToQueue.length > 0, pickedInQueue.length > 0, !pickedFolders, list, t('Delete')].join() // i18n-ok
  useLayoutEffect(() => {
    const bar = pickBar.current
    const place = bar?.parentElement
    if (!bar || !place) return
    const fit = () => {
      const was = bar.classList.contains('compact')
      bar.classList.remove('compact')
      const tooWide = bar.scrollWidth > place.clientWidth - 32 // 16 px free on each side
      if (was) bar.classList.add('compact')
      setPickCompact(tooWide)
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(place)
    return () => watch.disconnect()
  }, [pickButtons])
  const pickName = (name: string) => (pickCompact ? name : undefined)
  const pickAction = (action: () => unknown) => () => {
    void action()
    dropPicks()
  }
  const empty = searching
    ? t('No videos match')
    : list === 'rewatch'
    ? t('Nothing in Rewatch yet. Right-click a playlist, folder or video to move it here.')
    : list === 'music'
      ? t('No new songs. New videos of music channels show here.')
      : !follows?.length && !anyVideos ? t('No follows yet') : list === 'towatch' ? t('Nothing to watch') : t('No watched videos yet')

  return (
    <main className="page games-page" ref={pageRef}>
      {/* As wide as Reminders' month grid in both layouts (the list too, unlike the calendars' lists) */}
      <div className="games wide video-column" ref={columnRef}>
        <div className={`games-views reminders-toolbar video-toolbar calendar-head pinned-bar${videoLifted ? ' over-list' : ''}`}>
          <FillSwitch
            className="video-list-switch"
            options={[
              { value: 'towatch', label: <>{t('To watch')}<ListCount count={feed?.newToWatch ?? 0} /></> },
              ...(asSection ? [] : [{ value: 'rewatch' as const, label: t('Rewatch') }]),
              { value: 'watched', label: t('Watched|list') },
            ]}
            value={list}
            onChange={setList}
            label={t('Show')}
          />
          {(anyMusic || list === 'music') && (
            <FillSwitch
              className="video-music-switch"
              options={[{ value: 'music' as const, label: <><Music size={14} />{musicName && t('Music')}<ListCount count={feed?.newMusic ?? 0} /></>, title: musicName ? undefined : t('Music') }]}
              value={list}
              onChange={setList}
            />
          )}
          {!!listFollows?.length && (
            <select
              className="video-channel-filter"
              value={shownChannel}
              disabled={list === 'rewatch'}
              title={list === 'rewatch' ? t('Rewatch shows everything in it') : undefined}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="all">{t('All follows')}</option>
              {listFollows.map((follow) => (
                <option key={follow.id} value={follow.id}>{follow.name}</option>
              ))}
            </select>
          )}
          <div className="reminders-tools">
            <button className={`reminders-refresh${search !== null ? ' on' : ''}`} aria-pressed={search !== null} title={t('Search (Ctrl+F)')} onClick={() => setSearch(search === null ? '' : null)}>
              <Search size={15} />
            </button>
            <button className="reminders-refresh" disabled={checking || (!follows?.length && !feed?.playlists.length)} title={t('Check for new videos')} onClick={() => void checkVideosNow()}>
              {checking ? <Spinner label={t('Checking…')} /> : <RefreshCw size={15} />}
            </button>
            <button className="reminders-new" onClick={(e) => openBarMenu('add', e.currentTarget)}>
              <Plus size={15} /> {t('Add')} <ChevronDown size={14} />
            </button>
            <button className="reminders-refresh" disabled={!follows?.length} title={follows?.length ? t('Follows') : t('No follows yet')} onClick={() => setListOpen(true)}>
              <Users size={15} />
            </button>
            <button className="reminders-refresh" title={t('More')} onClick={(e) => openBarMenu('more', e.currentTarget)}>
              <Ellipsis size={15} />
            </button>
            <button className="reminders-refresh" title={t('Video settings')} onClick={() => openSettings('video')}>
              <Settings size={15} />
            </button>
          </div>
          {/* The search row, a line of its own in the pinned bar (user, 2026-11-19, from mockups): only
              the list shown; Escape or ✕ clears and closes it */}
          {search !== null && (
            <div className="game-search-bar video-search">
              <Search size={15} />
              <input
                ref={searchRef}
                value={search}
                autoFocus
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  e.stopPropagation() // the picks stay
                  setSearch(null)
                }}
                placeholder={list === 'rewatch' ? t('Search Rewatch…') : list === 'watched' ? t('Search Watched…') : list === 'music' ? t('Search Music…') : t('Search To watch…')}
                spellCheck={false}
              />
              <button className="game-search-clear" onClick={() => setSearch(null)} title={t('Close search')}>
                <X size={15} />
              </button>
            </div>
          )}
          {/* While a video that can join the Queue is dragged, the bar is a place to drop it: at the
              Queue's end, from anywhere in the list (user, 2026-11-18; videoDrag.ts) */}
          {videoLifted && (
            <div className="video-queue-strip" data-queue-head="">
              <ListPlus size={15} /> {t('Drop here to add to the Queue')}
            </div>
          )}
        </div>
        {pasted && (
          <p className={`games-empty${pasted.busy || pasted.done ? '' : ' error'}`}>
            {pasted.busy ? (
              <span className="loading-line">
                <Spinner size={13} /> {pasted.message}
              </span>
            ) : (
              pasted.message
            )}
          </p>
        )}
        {errors.map((error) => (
          <p key={error} className="games-empty error">{error}</p>
        ))}
        {feed && nothingShown && checking && list === 'towatch' && follows?.length ? (
          <ul className={listClass}>
            {[0, 1, 2].map((row) => (
              <li key={row} className="video-row">
                <span className="video-thumb skeleton" />
                <span className="video-text">
                  <span className="skeleton" style={{ width: '70%' }} />
                  <span className="skeleton" style={{ width: '35%', height: '0.75em' }} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          feed && nothingShown && <p className="games-empty">{empty}</p>
        )}
        {/* Switching grid / list: it fades in, like Games' (a new list, so nothing else animates) */}
        {split ? (
          <div key="split" className="video-split games-tab-in" ref={listRef as RefObject<HTMLDivElement>}>
            <ul className={`${listClass} video-queue-column`}>{queuePart}</ul>
            <ul className={listClass}>{restPart}</ul>
          </div>
        ) : (
          <ul key={layout} className={`${listClass} games-tab-in`} ref={listRef as RefObject<HTMLUListElement>}>{[...queuePart, ...restPart]}</ul>
        )}
      </div>
      {/* Videos picked: their actions in a bar floating at the bottom of the list, named buttons,
          only those that fit one of them at least; Delete in red, apart (user, 2026-11-25, from mockups) */}
      {picked.length > 0 && !videoLifted && (
        <div className="video-pick-place">
          <div ref={pickBar} className={pickCompact ? 'video-pick-bar compact' : 'video-pick-bar'}>
            <span className="video-pick-count">
              <span className="video-pick-number">{decimal(picked.length, 0)}</span>
              <span className="video-pick-label">{plural(picked.length, 'selected|one video', 'selected|several videos')}</span>
            </span>
            <span className="video-pick-divider" />
            {pickedUnwatched.length > 0 && (
              <button
                title={list === 'music' ? t('Done: remove from Music') : pickName(t('Mark as watched'))}
                onClick={pickAction(() => {
                  const songs = pickedUnwatched.filter((video) => video.music)
                  if (songs.length) void clearWatched(pickedIds(songs))
                  const others = pickedUnwatched.filter((video) => !video.music)
                  if (others.length) void markAllWatched(pickedIds(others))
                })}
              >
                <Check size={15} /> <span className="video-pick-label">{list === 'music' ? t('Done') : t('Mark as watched')}</span>
              </button>
            )}
            {pickedToQueue.length > 0 && (
              <button title={pickName(t('Add to queue'))} onClick={pickAction(() => pickedToQueue.forEach((video) => addToQueue(video.id)))}>
                <ListPlus size={15} /> <span className="video-pick-label">{t('Add to queue')}</span>
              </button>
            )}
            {pickedInQueue.length > 0 && (
              <button title={pickName(t('Remove from queue'))} onClick={pickAction(() => leaveQueue(pickedIds(pickedInQueue)))}>
                <ListX size={15} /> <span className="video-pick-label">{t('Remove from queue')}</span>
              </button>
            )}
            {!pickedFolders && (
              <button
                title={pickName(t('Move to folder'))}
                onClick={(e) => {
                  // Over the bar, starting at the button
                  const bar = pickBar.current!.getBoundingClientRect()
                  setPickFolders({ x: e.currentTarget.getBoundingClientRect().left, y: bar.top - 6 })
                }}
              >
                <FolderInput size={15} /> <span className="video-pick-label">{t('Move to folder')}</span>
              </button>
            )}
            <button
              className="video-pick-delete"
              disabled={!pickedDeletable.length}
              title={pickedDeletable.length ? pickName(t('Delete')) : t('A playlist’s videos stay in it')}
              onClick={() => setDeletingPicks({ videos: pickedDeletable, skipped: pickedDeletable.length < picked.length })}
            >
              <Trash2 size={15} /> <span className="video-pick-label">{t('Delete')}</span>
            </button>
            <span className="video-pick-divider" />
            <button className="video-pick-close" title={t('Deselect all')} onClick={dropPicks}>
              <X size={15} />
            </button>
          </div>
        </div>
      )}
      {adding !== null && <FollowDialog startLink={adding} onClose={() => setAdding(null)} />}
      {addingVideo && <AddVideoDialog onAdded={showAdded} onClose={() => setAddingVideo(false)} />}
      {addingPlaylist && <AddPlaylistDialog onAdded={showAdded} onClose={() => setAddingPlaylist(false)} />}
      {listOpen && <FollowsWindow onClose={() => setListOpen(false)} />}
      {barMenu && (
        <ContextMenu
          x={barMenu.x}
          y={barMenu.y}
          alignRight
          onClose={() => setBarMenu(null)}
          items={
            barMenu.kind === 'add'
              ? [
                  { label: t('Add a video'), icon: Plus, onClick: () => setAddingVideo(true) },
                  { label: t('Add a playlist'), icon: ListPlus, onClick: () => setAddingPlaylist(true) },
                  { label: t('Add a follow'), icon: UserPlus, onClick: () => setAdding('') },
                  // In the Rewatch list, it goes there
                  { label: t('New folder'), icon: FolderPlus, divider: true, onClick: () => setNaming({ parentId: list === 'rewatch' ? REWATCH : list === 'music' ? MUSIC : null }) },
                ]
              : [
                  // How the list is laid out first, then what it shows
                  { label: t('Grid'), icon: LayoutGrid, checked: layout === 'grid', onClick: () => setLayout('grid') },
                  { label: t('List'), icon: ListIcon, checked: layout === 'list', onClick: () => setLayout('list') },
                  {
                    label: t('By channel'),
                    icon: ListTree,
                    divider: true,
                    checked: grouped,
                    disabled: !anyFollowsOrVideos || shownChannel !== 'all' || list !== 'towatch',
                    hint: !anyFollowsOrVideos ? t('No follows yet') : list !== 'towatch' ? t('Only in To watch') : shownChannel !== 'all' ? t('Only with All follows') : t('Fold each channel’s videos into one row'),
                    onClick: () => setGrouped(!grouped),
                  },
                  queueItem(list === 'rewatch' || list === 'towatch'),
                  queueRewatchItem,
                  // What the list shows now: all follows, or the chosen one
                  {
                    label: t('Mark all as watched'),
                    icon: CheckCheck,
                    divider: true,
                    disabled: list !== 'towatch' || !videos?.length,
                    hint: list !== 'towatch' ? t('Only in To watch') : videos?.length ? undefined : t('Nothing to watch'),
                    onClick: () => setMarkingAll(true),
                  },
                  {
                    label: t('Clear watched videos'),
                    icon: Trash2,
                    disabled: list !== 'watched' || !videos?.length,
                    hint: list !== 'watched' ? t('Only in Watched videos') : videos?.length ? undefined : t('No watched videos yet'),
                    onClick: () => setClearingAll(true),
                  },
                  // As a section, its row's menu has it
                  ...(asSection
                    ? []
                    : [{ ...(list === 'rewatch' && rewatch ? startOverItem(folderStartOver(rewatch)) : { ...startOverItem([]), hint: t('Only in Rewatch') }), divider: true }]),
                ]
          }
        />
      )}
      {playlistMenu && (
        <ContextMenu
          x={playlistMenu.x}
          y={playlistMenu.y}
          onClose={() => setPlaylistMenu(null)}
          items={[
            // Moving first, then the order (the second line's name depends on the first), checking, starting over, then elsewhere
            { label: t('Move to folder'), icon: FolderInput, submenu: { title: t('Move to folder'), items: playlistFolderItems(playlistMenu.playlist) } },
            { label: t('YouTube’s order'), icon: ListOrdered, divider: true, checked: !!playlistMenu.playlist.youtubeOrder, onClick: () => void changePlaylist(playlistMenu.playlist.id, { youtubeOrder: !playlistMenu.playlist.youtubeOrder }) },
            { label: playlistMenu.playlist.youtubeOrder ? t('Reverse the order') : t('Newest first'), icon: ArrowDownUp, checked: !!playlistMenu.playlist.newestFirst, onClick: () => void changePlaylist(playlistMenu.playlist.id, { newestFirst: !playlistMenu.playlist.newestFirst }) },
            { label: t('Check for new videos once a day'), icon: CalendarClock, divider: true, checked: playlistMenu.playlist.keepChecking, onClick: () => void changePlaylist(playlistMenu.playlist.id, { keepChecking: !playlistMenu.playlist.keepChecking }) },
            ...(playlistMenu.playlist.folderId && rewatchIds.has(playlistMenu.playlist.folderId)
              ? [{ ...startOverItem(startOverIds(playlists.find(({ playlist }) => playlist.id === playlistMenu.playlist.id)?.videos ?? [])), divider: true }]
              : []),
            { label: t('Open in browser'), icon: ExternalLink, onClick: () => openLink(playlistAddress(playlistMenu.playlist)) },
            { label: t('Remove'), icon: Trash2, danger: true, onClick: () => setRemovingPlaylist(playlistMenu.playlist) },
          ]}
        />
      )}
      {removingPlaylist && (
        <Dialog
          request={{
            title: t('Remove {name}?', { name: removingPlaylist.name }),
            message: t('Its videos leave the list. What you watched stays marked.'),
            confirmLabel: t('Remove'),
            danger: true,
            onConfirm: () => void removePlaylist(removingPlaylist.id),
          }}
          onClose={() => setRemovingPlaylist(null)}
        />
      )}
      {folderMenu && (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          onClose={() => setFolderMenu(null)}
          items={
            folderMenu.folder.id === REWATCH
              ? [
                  { label: t('New sub-folder'), icon: FolderPlus, onClick: () => setNaming({ parentId: REWATCH, sub: true }) },
                  { ...queueItem(true), divider: true },
                  startOverItem(folderStartOver(folderMenu.folder)),
                ]
              : [
                  // Moving first. Only a folder at the top or right in Rewatch: a sub-folder stays with its parent
                  ...(!folderMenu.folder.parentId && !folderMenu.folder.channel
                    ? [{ label: t('Move to Rewatch'), icon: Repeat, onClick: () => void moveFolder(folderMenu.folder.id, REWATCH) }]
                    : folderMenu.folder.parentId === REWATCH
                      ? [{ label: t('Out of Rewatch'), icon: FolderOutput, onClick: () => void moveFolder(folderMenu.folder.id, null) }]
                      : []),
                  { label: t('New sub-folder'), icon: FolderPlus, divider: true, onClick: () => setNaming({ parentId: folderMenu.folder.id, sub: true }) },
                  { label: t('Rename'), icon: Pencil, onClick: () => setNaming({ folder: folderMenu.folder }) },
                  ...(rewatchIds.has(folderMenu.folder.id) ? [startOverItem(folderStartOver(folderMenu.folder))] : []),
                  { label: t('Delete'), icon: Trash2, danger: true, onClick: () => setDeleting(folderMenu.folder) },
                ]
          }
        />
      )}
      {channelMenu && (
        <ContextMenu
          x={channelMenu.x}
          y={channelMenu.y}
          onClose={() => setChannelMenu(null)}
          items={[
            { label: t('New sub-folder'), icon: FolderPlus, onClick: () => setNaming({ parentId: null, sub: true, channel: channelMenu.key, openId: channelMenu.openId }) },
            ...startSkipItems(channelMenu.follow),
          ]}
        />
      )}
      {moving && (
        <ContextMenu
          x={moving.x}
          y={moving.y}
          onClose={() => setMoving(null)}
          header={{ title: moving.video.title, subtitle: moving.video.channel }} // what was right-clicked, like Mail's
          // Queue, the move to a folder as a side list (like a playlist's and the Board's), then
          // "Open in …" just above the red one, like every menu
          items={moving.episode ? [queueVideoItem(moving.video), ...openVideoItem(moving.video)] : [
            queueVideoItem(moving.video),
            {
              label: t('Move to folder'),
              icon: FolderInput,
              divider: true,
              submenu: {
                title: t('Move to folder'),
                items: [
                  ...videoFolderItems([moving.video]),
                  { label: t('New folder…'), icon: FolderPlus, divider: true, onClick: () => setNaming({ parentId: moving.video.music ? MUSIC : null, videoIds: [moving.video.id] }) },
                  ...(grouping && !moving.video.music
                    ? [{
                        label: t('New folder in {name}…', { name: moving.video.channel }),
                        icon: FolderPlus,
                        onClick: () => setNaming({ parentId: null, channel: channelKey(moving.video), openId: moving.video.followId, videoIds: [moving.video.id] }),
                      }]
                    : []),
                  ...(moving.video.folderId
                    ? [{ label: t('Remove from folder'), icon: FolderOutput, divider: true, onClick: () => void moveToFolder(moving.video.id, null) }]
                    : []),
                ],
              },
            },
            ...openVideoItem(moving.video),
            // Gone for good, on every device, like Clear (adding it again by link brings it back)
            { label: t('Delete'), icon: Trash2, danger: true, onClick: () => void clearWatched([moving.video.id]) },
          ]}
        />
      )}
      {pickFolders && picked.length > 0 && (
        <ContextMenu
          x={pickFolders.x}
          y={pickFolders.y}
          above
          onClose={() => setPickFolders(null)}
          header={{ title: plural(picked.length, '{n} video', '{n} videos') }}
          items={[
            ...videoFolderItems(pickedVideos, dropPicks),
            {
              label: t('New folder…'),
              icon: FolderPlus,
              divider: true,
              onClick: () => {
                setNaming({ parentId: pickedVideos[0].music ? MUSIC : null, videoIds: pickedIds(pickedVideos) })
                dropPicks()
              },
            },
            ...(pickedVideos.some((video) => video.folderId)
              ? [{ label: t('Remove from folder'), icon: FolderOutput, divider: true, onClick: pickAction(() => pickedVideos.filter((video) => video.folderId).forEach((video) => void moveToFolder(video.id, null))) }]
              : []),
          ]}
        />
      )}
      {naming && (
        <Dialog
          request={{
            // The same word as the menu line that opened it (New folder in Rewatch or Music isn't a sub-folder)
            title: 'folder' in naming ? t('Rename') : naming.sub ? t('New sub-folder') : t('New folder'),
            input: { initial: 'folder' in naming ? naming.folder.name : '', placeholder: t('Folder name') },
            confirmLabel: 'folder' in naming ? t('Rename') : t('Create'),
            onConfirm: (typed) => {
              const name = typed.trim()
              if (!name) return
              if ('folder' in naming) void renameFolder(naming.folder.id, name)
              else {
                const { parentId, channel: inChannel, videoIds, playlistId } = naming
                void createFolder(name, parentId, inChannel).then((id) => {
                  if (videoIds) for (const videoId of videoIds) void moveToFolder(videoId, id)
                  else if (playlistId) void changePlaylist(playlistId, { folderId: id })
                })
                // Unfolded to show it
                const openId = naming.openId ?? parentId
                if (openId) openRow(openId)
              }
            },
          }}
          onClose={() => setNaming(null)}
        />
      )}
      {deleting && (
        <Dialog
          request={{
            title: t('Delete {name}?', { name: deleting.name }),
            message: foldersIn(deleting.id).length
              ? allPlaylistsIn(deleting).length
                ? t('Its sub-folders go too. All their videos and playlists go back to the main list.')
                : t('Its sub-folders go too. All their videos go back to the main list.')
              : playlistsIn(deleting.id).length
                ? t('Its videos and playlists go back to the main list.')
                : t('Its videos go back to the main list.'),
            confirmLabel: t('Delete'),
            danger: true,
            onConfirm: () => void deleteFolder(deleting.id),
          }}
          onClose={() => setDeleting(null)}
        />
      )}
      {deletingPicks && (
        <Dialog
          request={{
            title: plural(deletingPicks.videos.length, 'Delete {n} video?', 'Delete {n} videos?'),
            message:
              plural(deletingPicks.videos.length, 'It’s gone on every device.', 'They’re gone on every device.') +
              (deletingPicks.skipped ? ' ' + t('Playlist videos stay in their playlist.') : ''),
            confirmLabel: t('Delete'),
            danger: true,
            onConfirm: () => {
              void clearWatched(pickedIds(deletingPicks.videos))
              dropPicks()
            },
          }}
          onClose={() => setDeletingPicks(null)}
        />
      )}
      {markingAll && videos && (
        <Dialog
          request={{
            title: t('Mark all as watched?'),
            message: plural(videos.length, '{n} video moves to Watched.', '{n} videos move to Watched.'),
            confirmLabel: t('Mark as watched'),
            onConfirm: () => void markAllWatched(videos.map((video) => video.id)),
          }}
          onClose={() => setMarkingAll(false)}
        />
      )}
      {clearingAll && videos && (
        <Dialog
          request={{
            title: t('Clear watched videos?'),
            message: plural(videos.length, '{n} video leaves Watched for good.', '{n} videos leave Watched for good.'),
            confirmLabel: t('Clear'),
            danger: true,
            onConfirm: () => void clearWatched(videos.map((video) => video.id)),
          }}
          onClose={() => setClearingAll(false)}
        />
      )}
    </main>
  )
}

export default VideoView
