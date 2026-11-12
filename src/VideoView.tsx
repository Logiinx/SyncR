import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { ArrowDownUp, CalendarClock, Check, CheckCheck, ChevronDown, Ellipsis, ExternalLink, Folder, FolderInput, FolderOutput, FolderPlus, ListOrdered, ListPlus, ListTree, ListVideo, Pencil, Play, Plus, RefreshCw, Repeat, RotateCcw, Settings, Trash2, Undo2, UserPlus, Users, X } from 'lucide-react'
import { useListItems, usePage } from './animations'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { FillSwitch } from './tabLines'
import { type VideoFolder, type VideoPlaylist } from './db'
import { lastWatchedText, nearDay, shortDate } from './dates'
import Dialog from './Dialog'
import { plural, t } from './i18n'
import { openLink } from './links'
import { useLocalState } from './localState'
import Spinner from './Spinner'
import { byChannel, channelKey, checkVideosNow, clearFresh, clearWatched, isRecent, markAllWatched, markOpened, setWatched, startOver, useChecking, useVideoFeed, type FeedVideo } from './video'
import { AddPlaylistDialog, AddVideoDialog, FollowDialog, FollowsWindow } from './VideoFollows'
import VideoSettings from './VideoSettings'
import { dragPlaylist, dragVideo } from './videoDrag'
import { createFolder, deleteFolder, inRewatch, moveFolder, moveToFolder, renameFolder, REWATCH, useRewatchSection } from './videoFolders'
import VideoLogo from './VideoLogo'
import { playVideo } from './videoPlayer'
import { linkIn, pasteAction, pasteActionDone, pasteLine, pasteLink, subscribePaste } from './videoPaste'
import { changePlaylist, playlistAddress, removePlaylist } from './videoPlaylists'
import { useResumePosition, videoClock, type VideoPosition } from './videoPositions'

type List = 'towatch' | 'rewatch' | 'watched'

// Videos found since the tab last showed: marked as shown right away, which gives older ones (found
// before foundAt existed) their week of "New" from now. Kept here too so the tag doesn't blink.
function useNewVideos(feed: ReturnType<typeof useVideoFeed>) {
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const fresh = [...(feed?.toWatch ?? []), ...(feed?.rewatch ?? []), ...(feed?.watched ?? []), ...(feed?.playlists ?? []).flatMap((list) => list.videos)].filter((video) => video.fresh).map((video) => video.id)
    if (!fresh.length) return
    void clearFresh(fresh)
    setNewIds((now) => new Set([...now, ...fresh]))
  }, [feed])
  return newIds
}

const videoDay = (video: FeedVideo) => nearDay(video.published) ?? shortDate(video.published)

// "12 min left", "1 h 05 left": what's left of a video stopped partway
function timeLeft({ t: at, length }: VideoPosition) {
  const minutes = Math.ceil((length - at) / 60)
  if (minutes < 60) return plural(minutes, '{n} min left', '{n} min left|plural')
  return t('{h} h {mm} left', { h: Math.floor(minutes / 60), mm: String(minutes % 60).padStart(2, '0') })
}

// What the playlist row's order button does when clicked
function orderButtonTitle(playlist: VideoPlaylist) {
  if (playlist.youtubeOrder) return playlist.newestFirst ? t('Back to YouTube’s order') : t('Reverse YouTube’s order')
  return playlist.newestFirst ? t('Show the oldest first') : t('Show the newest first')
}

const depthStyle = (depth: number) => (depth ? { marginLeft: depth * 24 } : undefined)

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
}) {
  const { drop, icon, title, logo, count, countText, actions, newest, newCount, open, depth = 0, onToggle, onMenu, onPointerDown } = props
  return (
    <li
      className={open ? 'video-row video-group' : 'video-row video-group folded'}
      style={depthStyle(depth)}
      data-item={props.id}
      data-drop-folder={drop ? drop.folder ?? '' : undefined}
      data-drop-channel={drop ? drop.channel ?? '' : undefined}
      data-open={drop?.open}
      onPointerDown={onPointerDown}
      onContextMenu={
        onMenu &&
        ((e) => {
          e.preventDefault()
          onMenu(e.clientX, e.clientY)
        })
      }
    >
      <button className="video-row-open" aria-expanded={open} onClick={onToggle}>
        <ChevronDown size={14} className="video-group-chevron" />
        {icon}
        <span className="video-text">
          <span className="video-title" title={title}>{title}</span>
          <span className="video-meta">
            {logo}
            <span>{countText ?? plural(count, '{n} video', '{n} videos')}</span>
            {newest && <span>· {videoDay(newest)}</span>}
            {newCount > 0 && <span className="video-new">{plural(newCount, '{n} new video', '{n} new videos')}</span>}
          </span>
        </span>
      </button>
      {actions}
    </li>
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
  onMenu: (x: number, y: number) => void
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
    />
  )
}

// One video: a click opens it in the player window and marks it as opened; it stays in To watch
// until it's ticked. A video that's gone can't be opened, only removed from the list. In a playlist
// (playlistId): the next one follows at its end and it can't be moved to a folder. In a playlist or
// in Rewatch (kept), it stays there grayed once watched. In Rewatch: when it was last watched.
// Tags: "New" (green), or what's left when it was stopped partway (blue), never both.
function VideoRow({ video, isNew, depth = 0, playlistId, kept = !!playlistId, lastWatched, onMenu, onOpenRow }: {
  video: FeedVideo
  isNew: boolean
  depth?: number
  playlistId?: string
  kept?: boolean
  lastWatched?: boolean
  onMenu?: (x: number, y: number) => void
  onOpenRow: (id: string) => void
}) {
  const position = useResumePosition(video.id)
  function open() {
    playVideo(video, playlistId)
    void markOpened(video.id)
  }
  function openInBrowser() {
    openLink(video.url)
    void markOpened(video.id)
  }
  return (
    <li
      className={`video-row${video.gone ? ' gone' : ''}${kept && video.watched ? ' seen' : ''}`}
      style={depthStyle(depth)}
      data-item={playlistId ? `${playlistId} ${video.id}` : video.id}
      onPointerDown={playlistId ? undefined : (e) => dragVideo(e, video, onOpenRow)}
      onDragStart={(e) => e.preventDefault()} // the thumbnail's own dragging
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu?.(e.clientX, e.clientY)
      }}
    >
      <button className="video-row-open" disabled={video.gone} onClick={open}>
        <span className="video-thumb">
          {video.thumbnail && !video.gone && (
            <img
              src={video.thumbnail}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
            />
          )}
          {!video.gone && video.duration > 0 && <span className="video-duration">{videoClock(video.duration)}</span>}
          {position && !video.watched && !video.gone && (
            <span className="video-progress"><span style={{ width: `${(position.t / position.length) * 100}%` }} /></span>
          )}
        </span>
        <span className="video-text">
          <span className="video-title" title={video.title}>{video.title}</span>
          <span className="video-meta">
            {kept && video.watched && <Check size={14} className="video-seen" aria-label={t('Watched')} />}
            <VideoLogo platform={video.platform} />
            <span className="video-channel" title={video.channel}>{video.channel}</span>
            <span>· {videoDay(video)}</span>
            {video.gone && <span>· {t('No longer available')}</span>}
            {lastWatched && video.watchedAt && <span>· {lastWatchedText(video.watchedAt)}</span>}
            {position && !video.gone && !video.watched ? (
              <span className="video-opened">{timeLeft(position)}</span>
            ) : (
              isNew && <span className="video-new">{t('New')}</span>
            )}
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
        <button className="video-row-action" title={t('Mark as watched')} onClick={() => void setWatched(video.id, true)}>
          <Check size={16} />
        </button>
      )}
    </li>
  )
}

// The Video tab (video.ts). Uses the Games tab's page layout (.games).
function VideoView() {
  const pageRef = useRef<HTMLElement>(null)
  usePage(pageRef)
  const feed = useVideoFeed()
  const newIds = useNewVideos(feed)
  const { checking, errors } = useChecking()
  const [pickedList, setList] = useState<List>('towatch')
  // Rewatch is its own list, or a section at the bottom of To watch (Video settings window)
  const asSection = useRewatchSection()
  const list: List = asSection && pickedList === 'rewatch' ? 'towatch' : pickedList
  const [channel, setChannel] = useState('all') // a follow's id, or all of them
  const [adding, setAdding] = useState<string | null>(null) // Add a follow open, with the link it starts with
  const [addingVideo, setAddingVideo] = useState(false)
  const [addingPlaylist, setAddingPlaylist] = useState(false)
  const [playlistMenu, setPlaylistMenu] = useState<{ playlist: VideoPlaylist; x: number; y: number } | null>(null)
  const [removingPlaylist, setRemovingPlaylist] = useState<VideoPlaylist | null>(null)
  // A new folder (with where it goes, the row to open to show it, the video to move into it), or a
  // folder to rename
  const [naming, setNaming] = useState<{ parentId: string | null; channel?: string; openId?: string; videoId?: string; playlistId?: string } | { folder: VideoFolder } | null>(null)
  const [movingPlaylist, setMovingPlaylist] = useState<{ playlist: VideoPlaylist; x: number; y: number } | null>(null)
  const [barMenu, setBarMenu] = useState<{ kind: 'add' | 'more'; x: number; y: number } | null>(null)
  const [channelMenu, setChannelMenu] = useState<{ key: string; openId: string; x: number; y: number } | null>(null)
  const [moving, setMoving] = useState<{ video: FeedVideo; x: number; y: number } | null>(null)
  const [folderMenu, setFolderMenu] = useState<{ folder: VideoFolder; x: number; y: number } | null>(null)
  const [deleting, setDeleting] = useState<VideoFolder | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false) // the Video settings window
  const [markingAll, setMarkingAll] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [grouped, setGrouped] = useLocalState('syncr.video.byChannel', false)
  const [openGroups, setOpenGroups] = useLocalState<string[]>('syncr.video.openGroups', [])
  const follows = feed?.follows
  // A follow that was just removed: back to all of them. Rewatch is your own list, like folders.
  const shownChannel = list !== 'rewatch' && follows?.some((follow) => follow.id === channel) ? channel : 'all'
  // Rewatch's videos are only in its folders (videosIn)
  const videos = (list === 'towatch' ? feed?.toWatch : list === 'watched' ? feed?.watched : [])?.filter((video) => shownChannel === 'all' || video.followId === shownChannel)
  const listRef = useRef<HTMLUListElement>(null)
  // One channel chosen: there's nothing to group. Watched is one plain list, watched last on top.
  const grouping = grouped && shownChannel === 'all' && list === 'towatch'
  useListItems(listRef, `${list} ${shownChannel} ${grouping}`)
  const tagNew = (video: FeedVideo) => (newIds.has(video.id) || isRecent(video)) && !video.opened && !video.gone && !video.watched
  const toggleGroup = (id: string) => setOpenGroups((now) => (now.includes(id) ? now.filter((other) => other !== id) : [...now, id]))
  const anyVideos = !!feed?.toWatch.length || !!feed?.watched.length
  const anyFollowsOrVideos = !!follows?.length || anyVideos
  // Under its button, ending at its right edge
  function openBarMenu(kind: 'add' | 'more', button: HTMLElement) {
    const box = button.getBoundingClientRect()
    setBarMenu({ kind, x: box.right, y: box.bottom + 4 })
  }
  // Shows where it went: To watch, all follows, its group open
  const openRow = (id: string) => setOpenGroups((now) => (now.includes(id) ? now : [...now, id]))
  function showAdded(followId: string) {
    setList('towatch')
    setChannel('all')
    openRow(followId)
  }
  // A link pasted with Ctrl+V anywhere in the tab but a text field or a window, or copied before
  // the shortcut (videoPaste.ts): its line under the bar, then what to show once it's read
  const pasted = useSyncExternalStore(subscribePaste, pasteLine)
  const nextAction = useSyncExternalStore(subscribePaste, pasteAction)
  useEffect(() => {
    if (!nextAction) return
    pasteActionDone()
    if (nextAction.kind === 'follow') setAdding(nextAction.link)
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
  const allFolders = feed?.folders ?? []
  const folders = shownChannel === 'all' && list !== 'watched' ? allFolders : []
  // Rewatch is at the bottom, not among the folders by name
  const foldersIn = (parentId: string | null) => folders.filter((folder) => folder.parentId === parentId && !folder.channel && folder.id !== REWATCH)
  const rewatchIds = inRewatch(allFolders)
  // Rewatch's videos (feed.rewatch) only show in To watch with all follows, like folders
  const videosIn = (folderId: string) => (rewatchIds.has(folderId) ? feed?.rewatch ?? [] : videos ?? []).filter((video) => video.folderId === folderId)
  // Outside Watched, a watched video is one of Rewatch's: it stays, grayed
  const videoRow = (video: FeedVideo, depth = 0) => (
    <VideoRow key={video.id} video={video} isNew={tagNew(video)} depth={depth} kept={list !== 'watched'} lastWatched={!!video.folderId && rewatchIds.has(video.folderId)} onMenu={(x, y) => setMoving({ video, x, y })} onOpenRow={openRow} />
  )
  const folderName = (folder: VideoFolder) => (folder.id === REWATCH ? t('Rewatch') : folder.name)
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
    ...allFolders.filter((folder) => !folder.parentId && !folder.channel && folder.id !== REWATCH),
    ...allFolders.filter((folder) => folder.id === REWATCH),
  ], '')
  const folderIcon = (folder: VideoFolder) => (folder.id === REWATCH ? Repeat : Folder)
  // Your own folders, then those of this video's channel: it can't go in another channel's. With
  // both, each list gets a small title instead of the channel's name on every line.
  function videoFolderItems(video: FeedVideo): MenuItem[] {
    const own = ownFolderChoices()
    const theirs = allFolders.filter((folder) => !folder.parentId && folder.channel === channelKey(video))
    const titled = own.length > 0 && theirs.length > 0
    const items = (choices: { folder: VideoFolder; path: string }[], section?: string) => choices.map(({ folder, path }, index): MenuItem => ({
      label: path,
      icon: folderIcon(folder),
      section: index === 0 ? section : undefined,
      checked: folder.id === video.folderId,
      onClick: () => void moveToFolder(video.id, folder.id),
    }))
    return [
      ...items(own, titled ? t('Your folders') : undefined),
      ...items(folderChoices(theirs, titled ? '' : `${video.channel} / `), titled ? video.channel : undefined),
    ]
  }
  const allIn = (folder: VideoFolder): FeedVideo[] => [...videosIn(folder.id), ...foldersIn(folder.id).flatMap(allIn)]
  // Playlists, each at the top or in one of your own folders (one deleted or a channel's: the top).
  // Only in To watch with all follows: it's your own list, not a channel's.
  const playlists = list !== 'watched' && shownChannel === 'all' ? feed?.playlists ?? [] : []
  const placeOf = (playlist: VideoPlaylist) => {
    const folder = folders.find((other) => other.id === playlist.folderId)
    return folder && !topFolder(folder)?.channel ? folder.id : null
  }
  const playlistsIn = (folderId: string | null) => playlists.filter(({ playlist }) => placeOf(playlist) === folderId)
  const allPlaylistsIn = (folder: VideoFolder): typeof playlists => [...playlistsIn(folder.id), ...foldersIn(folder.id).flatMap(allPlaylistsIn)]
  // A folder, then what's in it when it's open: its sub-folders, its playlists, then its videos,
  // oldest on top like a playlist. Only in To watch, empty ones too, or a new folder couldn't be
  // reached. Its count is its own videos and playlists ("3 videos · 1 playlist", "1 playlist"); its
  // "new" also counts its playlists' new videos.
  function folderRows(folder: VideoFolder, depth: number): ReactNode[] {
    const inside = allIn(folder)
    const lists = allPlaylistsIn(folder)
    const newInPlaylists = lists.flatMap(({ videos: episodes }) => episodes).filter(tagNew).length
    const countText = lists.length
      ? [inside.length ? plural(inside.length, '{n} video', '{n} videos') : '', plural(lists.length, '{n} playlist', '{n} playlists')].filter(Boolean).join(' · ')
      : undefined
    const open = openGroups.includes(folder.id)
    return [
      <FoldRow
        key={folder.id}
        id={folder.id}
        drop={{ folder: folder.id, channel: topFolder(folder)?.channel ?? undefined, open: folder.id }}
        icon={<span className="video-follow-icon video-folder-icon">{folder.id === REWATCH ? <Repeat size={15} /> : <Folder size={15} />}</span>}
        title={folderName(folder)}
        count={inside.length}
        countText={countText}
        newest={[...inside].sort((a, b) => b.published - a.published)[0]}
        newCount={inside.filter(tagNew).length + newInPlaylists}
        open={open}
        depth={depth}
        onToggle={() => toggleGroup(folder.id)}
        onMenu={(x, y) => setFolderMenu({ folder, x, y })}
      />,
      ...(open
        ? [
            ...foldersIn(folder.id).flatMap((sub) => folderRows(sub, depth + 1)),
            ...playlistsIn(folder.id).flatMap((entry) => playlistRows(entry, depth + 1)),
            ...videosIn(folder.id).reverse().map((video) => videoRow(video, depth + 1)),
          ]
        : []),
    ]
  }
  // A playlist's row, then its videos in the chosen order when it's open (its watched videos stay in
  // it). Dragged by its row into your own folders.
  function playlistRows({ playlist, videos: episodes }: (typeof playlists)[number], depth: number): ReactNode[] {
    const open = openGroups.includes(playlist.id)
    const nextUp = episodes.find((video) => !video.watched)
    // In Rewatch: when one of its videos was last watched
    const inRewatch = !!playlist.folderId && rewatchIds.has(playlist.folderId)
    const lastAt = inRewatch ? Math.max(0, ...episodes.map((video) => video.watchedAt ?? 0)) : 0
    const watchedCount = t('{watched} of {total} watched', { watched: episodes.filter((video) => video.watched).length, total: episodes.length })
    return [
      <FoldRow
        key={playlist.id}
        id={playlist.id}
        icon={<span className="video-follow-icon video-folder-icon"><ListVideo size={15} /></span>}
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
      ...(open ? episodes.map((video) => <VideoRow key={`${playlist.id} ${video.id}`} video={video} isNew={tagNew(video)} depth={depth + 1} playlistId={playlist.id} lastWatched={inRewatch} onOpenRow={openRow} />) : []),
    ]
  }
  // A channel's row, then what's in it when it's open: its sub-folders, then the rest of its videos
  function channelRows(id: string, key: string, shown: { name: string; icon: string | null; platform: FeedVideo['platform'] }, group: FeedVideo[], subs: VideoFolder[]) {
    const open = openGroups.includes(id)
    return [
      <VideoGroup
        key={`group-${id}`}
        id={id}
        channelKey={key}
        {...shown}
        videos={group}
        open={open}
        newCount={group.filter(tagNew).length}
        onToggle={() => toggleGroup(id)}
        onMenu={(x, y) => setChannelMenu({ key, openId: id, x, y })}
      />,
      ...(open
        ? [
            ...subs.flatMap((sub) => folderRows(sub, 1)),
            ...group.filter((video) => !video.folderId).reverse().map((video) => videoRow(video, 1)),
          ]
        : []),
    ]
  }
  // A chosen channel shows all its videos, wherever they are. So does the plain list for those in a
  // channel's sub-folders: these only exist in the channel's row.
  const mainVideos = (videos ?? []).filter((video) => shownChannel !== 'all' || list === 'watched' || !inOwnFolder(video))
  const channelFolders = (key: string) => folders.filter((folder) => folder.channel === key)
  // As a section: what's in Rewatch, folded at the bottom of To watch; no row when it's empty
  // (menus reach it). As a list: what's in it, like an open folder's.
  const rewatch = folders.find((folder) => folder.id === REWATCH)
  const rewatchRows = asSection && rewatch && (allIn(rewatch).length || allPlaylistsIn(rewatch).length || foldersIn(REWATCH).length) ? folderRows(rewatch, 0) : []
  const rewatchList = list === 'rewatch' && rewatch
    ? [
        ...foldersIn(REWATCH).flatMap((folder) => folderRows(folder, 0)),
        ...playlistsIn(REWATCH).flatMap((entry) => playlistRows(entry, 0)),
        ...videosIn(REWATCH).reverse().map((video) => videoRow(video)),
      ]
    : []
  // A folder or playlist's videos to start over: those watched or opened
  const startOverIds = (episodes: FeedVideo[]) => episodes.filter((video) => video.watched || video.opened).map((video) => video.id)
  const folderStartOver = (folder: VideoFolder) => startOverIds([...allIn(folder), ...allPlaylistsIn(folder).flatMap(({ videos: episodes }) => episodes)])
  const startOverItem = (ids: string[]): MenuItem => ({
    label: t('Start over'),
    icon: RotateCcw,
    disabled: !ids.length,
    hint: ids.length ? undefined : t('Nothing watched yet'),
    onClick: () => void startOver(ids),
  })
  const mainRows = list === 'rewatch' ? rewatchList : [
    ...playlistsIn(null).flatMap((entry) => playlistRows(entry, 0)),
    ...foldersIn(null).flatMap((folder) => folderRows(folder, 0)),
    // A flat list, so a video stays the same item whether it's in a group or not
    ...(grouping ? byChannel(mainVideos) : mainVideos.map((video) => [video])).flatMap((group) => {
      const key = channelKey(group[0])
      const subs = grouping ? channelFolders(key) : []
      if (group.length === 1 && !subs.length) return [videoRow(group[0])]
      const { followId, channel: name, channelIcon: icon, platform } = group[0]
      return channelRows(followId, key, { name, icon, platform }, group, subs)
    }),
    // Followed channels with sub-folders, and no videos to watch right now
    ...(grouping ? follows ?? [] : []).flatMap((follow) => {
      const key = channelKey(follow)
      const subs = channelFolders(key)
      if (!subs.length || mainVideos.some((video) => channelKey(video) === key)) return []
      return channelRows(follow.id, key, follow, [], subs)
    }),
  ]
  const rows = [...mainRows, ...rewatchRows]
  const empty = list === 'rewatch'
    ? t('Nothing in Rewatch yet. Right-click a playlist, folder or video to move it here.')
    : !follows?.length && !anyVideos ? t('No follows yet') : list === 'towatch' ? t('Nothing to watch') : t('No watched videos yet')

  return (
    <main className="page games-page" ref={pageRef}>
      <div className="games">
        <div className="games-views reminders-toolbar video-toolbar">
          <FillSwitch
            className="video-list-switch"
            options={[
              { value: 'towatch', label: t('To watch') },
              ...(asSection ? [] : [{ value: 'rewatch' as const, label: t('Rewatch') }]),
              { value: 'watched', label: t('Watched|list') },
            ]}
            value={list}
            onChange={setList}
            label={t('Show')}
          />
          {!!follows?.length && (
            <select
              className="video-channel-filter"
              value={shownChannel}
              disabled={list === 'rewatch'}
              title={list === 'rewatch' ? t('Rewatch shows everything in it') : undefined}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="all">{t('All follows')}</option>
              {follows.map((follow) => (
                <option key={follow.id} value={follow.id}>{follow.name}</option>
              ))}
            </select>
          )}
          <div className="reminders-tools">
            <button className="reminders-refresh" disabled={checking || (!follows?.length && !feed?.playlists.length)} title={t('Check for new videos')} onClick={() => void checkVideosNow()}>
              {checking ? <Spinner label={t('Checking…')} /> : <RefreshCw size={15} />}
            </button>
            <button className="reminders-new" onClick={(e) => openBarMenu('add', e.currentTarget)}>
              <Plus size={15} /> {t('Add')} <ChevronDown size={14} />
            </button>
            <button className="reminders-refresh" title={t('More')} onClick={(e) => openBarMenu('more', e.currentTarget)}>
              <Ellipsis size={15} />
            </button>
            <button className="reminders-refresh" title={t('Video settings')} onClick={() => setSettingsOpen(true)}>
              <Settings size={15} />
            </button>
          </div>
        </div>
        {pasted && (
          <p className={`games-empty${pasted.busy ? '' : ' error'}`}>
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
        {feed && !mainRows.length && checking && list === 'towatch' && follows?.length ? (
          <ul className="video-list">
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
          feed && !mainRows.length && <p className="games-empty">{empty}</p>
        )}
        <ul className="video-list" ref={listRef}>{rows}</ul>
      </div>
      {adding !== null && <FollowDialog startLink={adding} onClose={() => setAdding(null)} />}
      {addingVideo && <AddVideoDialog onAdded={showAdded} onClose={() => setAddingVideo(false)} />}
      {addingPlaylist && <AddPlaylistDialog onAdded={showAdded} onClose={() => setAddingPlaylist(false)} />}
      {listOpen && <FollowsWindow onClose={() => setListOpen(false)} />}
      {settingsOpen && <VideoSettings onClose={() => setSettingsOpen(false)} />}
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
                  { label: t('New folder'), icon: FolderPlus, divider: true, onClick: () => setNaming({ parentId: list === 'rewatch' ? REWATCH : null }) },
                ]
              : [
                  {
                    label: t('By channel'),
                    icon: ListTree,
                    checked: grouped,
                    disabled: !anyFollowsOrVideos || shownChannel !== 'all' || list !== 'towatch',
                    hint: !anyFollowsOrVideos ? t('No follows yet') : list !== 'towatch' ? t('Only in To watch') : shownChannel !== 'all' ? t('Only with All follows') : t('Fold each channel’s videos into one row'),
                    onClick: () => setGrouped(!grouped),
                  },
                  { label: t('Follows'), icon: Users, divider: true, disabled: !follows?.length, hint: follows?.length ? undefined : t('No follows yet'), onClick: () => setListOpen(true) },
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
            // Moving first, then the order (the second line's name depends on the first), checking, then elsewhere
            { label: t('Move to folder…'), icon: FolderInput, onClick: () => setMovingPlaylist(playlistMenu) },
            { label: t('YouTube’s order'), icon: ListOrdered, divider: true, checked: !!playlistMenu.playlist.youtubeOrder, onClick: () => void changePlaylist(playlistMenu.playlist.id, { youtubeOrder: !playlistMenu.playlist.youtubeOrder }) },
            { label: playlistMenu.playlist.youtubeOrder ? t('Reverse the order') : t('Newest first'), icon: ArrowDownUp, checked: !!playlistMenu.playlist.newestFirst, onClick: () => void changePlaylist(playlistMenu.playlist.id, { newestFirst: !playlistMenu.playlist.newestFirst }) },
            { label: t('Check for new videos once a day'), icon: CalendarClock, divider: true, checked: playlistMenu.playlist.keepChecking, onClick: () => void changePlaylist(playlistMenu.playlist.id, { keepChecking: !playlistMenu.playlist.keepChecking }) },
            { label: t('Open in browser'), icon: ExternalLink, divider: true, onClick: () => openLink(playlistAddress(playlistMenu.playlist)) },
            ...(playlistMenu.playlist.folderId && rewatchIds.has(playlistMenu.playlist.folderId)
              ? [{ ...startOverItem(startOverIds(playlists.find(({ playlist }) => playlist.id === playlistMenu.playlist.id)?.videos ?? [])), divider: true }]
              : []),
            { label: t('Remove'), icon: Trash2, danger: true, divider: true, onClick: () => setRemovingPlaylist(playlistMenu.playlist) },
          ]}
        />
      )}
      {movingPlaylist && (
        <ContextMenu
          x={movingPlaylist.x}
          y={movingPlaylist.y}
          onClose={() => setMovingPlaylist(null)}
          header={{ title: t('Move to folder') }}
          items={[
            // Your own folders only: a playlist isn't a channel's
            ...ownFolderChoices().map(({ folder, path }): MenuItem => ({
              label: path,
              icon: folderIcon(folder),
              checked: folder.id === placeOf(movingPlaylist.playlist),
              onClick: () => void changePlaylist(movingPlaylist.playlist.id, { folderId: folder.id }),
            })),
            { label: t('New folder…'), icon: FolderPlus, divider: true, onClick: () => setNaming({ parentId: null, playlistId: movingPlaylist.playlist.id }) },
            ...(placeOf(movingPlaylist.playlist)
              ? [{ label: t('Remove from folder'), icon: FolderOutput, divider: true, onClick: () => void changePlaylist(movingPlaylist.playlist.id, { folderId: null }) }]
              : []),
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
                  { label: t('New sub-folder'), icon: FolderPlus, onClick: () => setNaming({ parentId: REWATCH }) },
                  { ...startOverItem(folderStartOver(folderMenu.folder)), divider: true },
                ]
              : [
                  { label: t('New sub-folder'), icon: FolderPlus, onClick: () => setNaming({ parentId: folderMenu.folder.id }) },
                  { label: t('Rename'), icon: Pencil, onClick: () => setNaming({ folder: folderMenu.folder }) },
                  // Only a folder at the top or right in Rewatch: a sub-folder stays with its parent
                  ...(!folderMenu.folder.parentId && !folderMenu.folder.channel
                    ? [{ label: t('Move to Rewatch'), icon: Repeat, divider: true, onClick: () => void moveFolder(folderMenu.folder.id, REWATCH) }]
                    : folderMenu.folder.parentId === REWATCH
                      ? [{ label: t('Out of Rewatch'), icon: FolderOutput, divider: true, onClick: () => void moveFolder(folderMenu.folder.id, null) }]
                      : []),
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
            { label: t('New sub-folder'), icon: FolderPlus, onClick: () => setNaming({ parentId: null, channel: channelMenu.key, openId: channelMenu.openId }) },
          ]}
        />
      )}
      {moving && (
        <ContextMenu
          x={moving.x}
          y={moving.y}
          onClose={() => setMoving(null)}
          header={{ title: moving.video.title, subtitle: moving.video.channel }} // what was right-clicked, like Mail's
          items={[
            ...videoFolderItems(moving.video),
            { label: t('New folder…'), icon: FolderPlus, divider: true, onClick: () => setNaming({ parentId: null, videoId: moving.video.id }) },
            ...(grouping
              ? [{
                  label: t('New folder in {name}…', { name: moving.video.channel }),
                  icon: FolderPlus,
                  onClick: () => setNaming({ parentId: null, channel: channelKey(moving.video), openId: moving.video.followId, videoId: moving.video.id }),
                }]
              : []),
            ...(moving.video.folderId
              ? [{ label: t('Remove from folder'), icon: FolderOutput, divider: true, onClick: () => void moveToFolder(moving.video.id, null) }]
              : []),
            // Gone for good, on every device, like Clear (adding it again by link brings it back)
            { label: t('Delete'), icon: Trash2, danger: true, onClick: () => void clearWatched([moving.video.id]) },
          ]}
        />
      )}
      {naming && (
        <Dialog
          request={{
            title: 'folder' in naming ? t('Rename') : naming.parentId || naming.channel ? t('New sub-folder') : t('New folder'),
            input: { initial: 'folder' in naming ? naming.folder.name : '', placeholder: t('Folder name') },
            confirmLabel: 'folder' in naming ? t('Rename') : t('Create'),
            onConfirm: (typed) => {
              const name = typed.trim()
              if (!name) return
              if ('folder' in naming) void renameFolder(naming.folder.id, name)
              else {
                const { parentId, channel: inChannel, videoId, playlistId } = naming
                void createFolder(name, parentId, inChannel).then((id) =>
                  videoId ? moveToFolder(videoId, id) : playlistId ? changePlaylist(playlistId, { folderId: id }) : undefined,
                )
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
