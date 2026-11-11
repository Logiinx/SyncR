import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDownUp, CalendarClock, Check, CheckCheck, ChevronDown, Ellipsis, ExternalLink, Folder, FolderOutput, FolderPlus, ListChecks, ListOrdered, ListTree, ListVideo, Pencil, Play, Plus, RefreshCw, Trash2, Undo2, X } from 'lucide-react'
import { useListItems, usePage } from './animations'
import ContextMenu from './ContextMenu'
import { type VideoFolder, type VideoPlaylist } from './db'
import { nearDay, shortDate } from './dates'
import Dialog from './Dialog'
import { plural, t } from './i18n'
import { openLink } from './links'
import { useLocalState } from './localState'
import Spinner from './Spinner'
import { byChannel, channelKey, checkVideosNow, clearFresh, clearWatched, markAllWatched, markOpened, setWatched, useChecking, useVideoFeed, type FeedVideo } from './video'
import { AddPlaylistDialog, AddVideoDialog, FollowDialog, FollowsWindow } from './VideoFollows'
import { dragVideo } from './videoDrag'
import { createFolder, deleteFolder, moveToFolder, renameFolder } from './videoFolders'
import VideoLogo from './VideoLogo'
import { playVideo } from './videoPlayer'
import { changePlaylist, playlistAddress, removePlaylist } from './videoPlaylists'
import { useResumePosition, videoClock } from './videoPositions'

type List = 'towatch' | 'watched'

// Videos found since the tab last showed get a "New" tag for as long as it stays open, also those
// that arrive meanwhile. Marked as shown right away: the next time the tab opens, they aren't new.
function useNewVideos(feed: ReturnType<typeof useVideoFeed>) {
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    const fresh = [...(feed?.toWatch ?? []), ...(feed?.watched ?? []), ...(feed?.playlists ?? []).flatMap((list) => list.videos)].filter((video) => video.fresh).map((video) => video.id)
    if (!fresh.length) return
    void clearFresh(fresh)
    setNewIds((now) => new Set([...now, ...fresh]))
  }, [feed])
  return newIds
}

const videoDay = (video: FeedVideo) => nearDay(video.published) ?? shortDate(video.published)

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
}) {
  const { drop, icon, title, logo, count, countText, actions, newest, newCount, open, depth = 0, onToggle, onMenu } = props
  return (
    <li
      className={open ? 'video-row video-group' : 'video-row video-group folded'}
      style={depthStyle(depth)}
      data-item={props.id}
      data-drop-folder={drop ? drop.folder ?? '' : undefined}
      data-drop-channel={drop ? drop.channel ?? '' : undefined}
      data-open={drop?.open}
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
// (playlistId): the next one follows at its end, it stays there grayed once watched, and it can't
// be moved to a folder.
function VideoRow({ video, isNew, depth = 0, playlistId, onMenu, onOpenRow }: {
  video: FeedVideo
  isNew: boolean
  depth?: number
  playlistId?: string
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
      className={`video-row${video.gone ? ' gone' : ''}${playlistId && video.watched ? ' seen' : ''}`}
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
            {playlistId && video.watched && <Check size={14} className="video-seen" aria-label={t('Watched')} />}
            <VideoLogo platform={video.platform} />
            <span className="video-channel" title={video.channel}>{video.channel}</span>
            <span>· {videoDay(video)}</span>
            {video.gone && <span>· {t('No longer available')}</span>}
            {video.opened && !video.gone && !video.watched && <span className="video-opened">{t('Opened')}</span>}
            {isNew && <span className="video-new">{t('New')}</span>}
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
          {!playlistId && (
            <button className="video-row-action" title={t('Remove from Watched')} onClick={() => void clearWatched([video.id])}>
              <X size={16} />
            </button>
          )}
        </>
      ) : video.gone ? (
        <button className="video-row-action" title={t('Remove')} onClick={() => void setWatched(video.id, true)}>
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
  const [list, setList] = useState<List>('towatch')
  const [channel, setChannel] = useState('all') // a follow's id, or all of them
  const [adding, setAdding] = useState(false)
  const [addingVideo, setAddingVideo] = useState(false)
  const [addingPlaylist, setAddingPlaylist] = useState(false)
  const [playlistMenu, setPlaylistMenu] = useState<{ playlist: VideoPlaylist; x: number; y: number } | null>(null)
  const [removingPlaylist, setRemovingPlaylist] = useState<VideoPlaylist | null>(null)
  // A new folder (with where it goes, the row to open to show it, the video to move into it), or a
  // folder to rename
  const [naming, setNaming] = useState<{ parentId: string | null; channel?: string; openId?: string; videoId?: string } | { folder: VideoFolder } | null>(null)
  const [barMenu, setBarMenu] = useState<{ kind: 'add' | 'more'; x: number; y: number } | null>(null)
  const [channelMenu, setChannelMenu] = useState<{ key: string; openId: string; x: number; y: number } | null>(null)
  const [moving, setMoving] = useState<{ video: FeedVideo; x: number; y: number } | null>(null)
  const [folderMenu, setFolderMenu] = useState<{ folder: VideoFolder; x: number; y: number } | null>(null)
  const [deleting, setDeleting] = useState<VideoFolder | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [grouped, setGrouped] = useLocalState('syncr.video.byChannel', false)
  const [openGroups, setOpenGroups] = useLocalState<string[]>('syncr.video.openGroups', [])
  const follows = feed?.follows
  // A follow that was just removed: back to all of them
  const shownChannel = follows?.some((follow) => follow.id === channel) ? channel : 'all'
  const videos = (list === 'towatch' ? feed?.toWatch : feed?.watched)?.filter((video) => shownChannel === 'all' || video.followId === shownChannel)
  const listRef = useRef<HTMLUListElement>(null)
  // One channel chosen: there's nothing to group
  const grouping = grouped && shownChannel === 'all'
  useListItems(listRef, `${list} ${shownChannel} ${grouping}`)
  const tagNew = (video: FeedVideo) => newIds.has(video.id) && !video.opened && !video.gone && !video.watched
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
  const allFolders = feed?.folders ?? []
  const folders = shownChannel === 'all' ? allFolders : []
  const foldersIn = (parentId: string | null) => folders.filter((folder) => folder.parentId === parentId && !folder.channel)
  const videosIn = (folderId: string) => (videos ?? []).filter((video) => video.folderId === folderId)
  const videoRow = (video: FeedVideo, depth = 0) => (
    <VideoRow key={video.id} video={video} isNew={tagNew(video)} depth={depth} onMenu={(x, y) => setMoving({ video, x, y })} onOpenRow={openRow} />
  )
  // Every folder to choose from, each under its parent, with its whole path
  function folderChoices(level: VideoFolder[], path: string): { folder: VideoFolder; path: string }[] {
    return level.flatMap((folder) => {
      const own = path + folder.name
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
  const allIn = (folder: VideoFolder): FeedVideo[] => [...videosIn(folder.id), ...foldersIn(folder.id).flatMap(allIn)]
  // A folder, then what's in it when it's open: its sub-folders, then its videos. To watch shows
  // the empty ones too, or a new folder couldn't be reached.
  function folderRows(folder: VideoFolder, depth: number): ReactNode[] {
    const inside = allIn(folder)
    if (list === 'watched' && !inside.length) return []
    const open = openGroups.includes(folder.id)
    return [
      <FoldRow
        key={folder.id}
        id={folder.id}
        drop={{ folder: folder.id, channel: topFolder(folder)?.channel ?? undefined, open: folder.id }}
        icon={<span className="video-follow-icon video-folder-icon"><Folder size={15} /></span>}
        title={folder.name}
        count={inside.length}
        newest={[...inside].sort((a, b) => b.published - a.published)[0]}
        newCount={inside.filter(tagNew).length}
        open={open}
        depth={depth}
        onToggle={() => toggleGroup(folder.id)}
        onMenu={(x, y) => setFolderMenu({ folder, x, y })}
      />,
      ...(open
        ? [
            ...foldersIn(folder.id).flatMap((sub) => folderRows(sub, depth + 1)),
            ...videosIn(folder.id).map((video) => videoRow(video, depth + 1)),
          ]
        : []),
    ]
  }
  // A playlist's row, then its videos in the chosen order when it's open. Only in To watch with all
  // follows: it's your own list, not a channel's, and its watched videos stay in it.
  const playlistRows = (list === 'towatch' && shownChannel === 'all' ? feed?.playlists ?? [] : []).flatMap(({ playlist, videos: episodes }) => {
    const open = openGroups.includes(playlist.id)
    const nextUp = episodes.find((video) => !video.watched)
    return [
      <FoldRow
        key={playlist.id}
        id={playlist.id}
        icon={<span className="video-follow-icon video-folder-icon"><ListVideo size={15} /></span>}
        title={playlist.name}
        logo={<VideoLogo platform="youtube" />}
        count={episodes.length}
        countText={t('{watched} of {total} watched', { watched: episodes.filter((video) => video.watched).length, total: episodes.length })}
        newCount={episodes.filter(tagNew).length}
        open={open}
        onToggle={() => toggleGroup(playlist.id)}
        onMenu={(x, y) => setPlaylistMenu({ playlist, x, y })}
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
      ...(open ? episodes.map((video) => <VideoRow key={`${playlist.id} ${video.id}`} video={video} isNew={tagNew(video)} depth={1} playlistId={playlist.id} onOpenRow={openRow} />) : []),
    ]
  })
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
            ...group.filter((video) => !video.folderId).map((video) => videoRow(video, 1)),
          ]
        : []),
    ]
  }
  // A chosen channel shows all its videos, wherever they are. So does the plain list for those in a
  // channel's sub-folders: these only exist in the channel's row.
  const mainVideos = (videos ?? []).filter((video) => shownChannel !== 'all' || !inOwnFolder(video))
  const channelFolders = (key: string) => folders.filter((folder) => folder.channel === key)
  const rows = [
    ...playlistRows,
    ...foldersIn(null).flatMap((folder) => folderRows(folder, 0)),
    // A flat list, so a video stays the same item whether it's in a group or not
    ...(grouping ? byChannel(mainVideos) : mainVideos.map((video) => [video])).flatMap((group) => {
      const key = channelKey(group[0])
      const subs = grouping ? channelFolders(key).filter((sub) => list === 'towatch' || allIn(sub).length) : []
      if (group.length === 1 && !subs.length) return [videoRow(group[0])]
      const { followId, channel: name, channelIcon: icon, platform } = group[0]
      return channelRows(followId, key, { name, icon, platform }, group, subs)
    }),
    // Followed channels with sub-folders, and no videos to watch right now
    ...(grouping && list === 'towatch' ? follows ?? [] : []).flatMap((follow) => {
      const key = channelKey(follow)
      const subs = channelFolders(key)
      if (!subs.length || mainVideos.some((video) => channelKey(video) === key)) return []
      return channelRows(follow.id, key, follow, [], subs)
    }),
  ]
  const empty = !follows?.length && !anyVideos ? t('No follows yet') : list === 'towatch' ? t('Nothing to watch') : t('No watched videos yet')

  return (
    <main className="page games-page" ref={pageRef}>
      <div className="games">
        <div className="games-views reminders-toolbar video-toolbar">
          {list === 'watched' && (
            <button className="video-watched-chip" title={t('Back to the videos to watch')} onClick={() => setList('towatch')}>
              {t('Watched videos')} <X size={14} />
            </button>
          )}
          {!!follows?.length && (
            <select className="video-channel-filter" value={shownChannel} onChange={(e) => setChannel(e.target.value)}>
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
          </div>
        </div>
        {errors.map((error) => (
          <p key={error} className="games-empty error">{error}</p>
        ))}
        {feed && !rows.length && checking && list === 'towatch' && follows?.length ? (
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
          feed && !rows.length && <p className="games-empty">{empty}</p>
        )}
        <ul className="video-list" ref={listRef}>{rows}</ul>
      </div>
      {adding && <FollowDialog onClose={() => setAdding(false)} />}
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
                  { label: t('Add a playlist'), icon: ListVideo, onClick: () => setAddingPlaylist(true) },
                  { label: t('Add a follow'), icon: Plus, onClick: () => setAdding(true) },
                  { label: t('New folder'), icon: FolderPlus, divider: true, onClick: () => setNaming({ parentId: null }) },
                ]
              : [
                  { label: t('Watched videos'), icon: ListChecks, checked: list === 'watched', onClick: () => setList(list === 'watched' ? 'towatch' : 'watched') },
                  {
                    label: t('By channel'),
                    icon: ListTree,
                    checked: grouped,
                    disabled: !anyFollowsOrVideos || shownChannel !== 'all',
                    hint: !anyFollowsOrVideos ? t('No follows yet') : shownChannel !== 'all' ? t('Only with All follows') : t('Fold each channel’s videos into one row'),
                    onClick: () => setGrouped(!grouped),
                  },
                  { label: t('Follows'), icon: ListVideo, divider: true, disabled: !follows?.length, hint: follows?.length ? undefined : t('No follows yet'), onClick: () => setListOpen(true) },
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
            { label: playlistMenu.playlist.youtubeOrder ? t('Reverse the order') : t('Newest first'), icon: ArrowDownUp, checked: !!playlistMenu.playlist.newestFirst, onClick: () => void changePlaylist(playlistMenu.playlist.id, { newestFirst: !playlistMenu.playlist.newestFirst }) },
            { label: t('YouTube’s order'), icon: ListOrdered, checked: !!playlistMenu.playlist.youtubeOrder, onClick: () => void changePlaylist(playlistMenu.playlist.id, { youtubeOrder: !playlistMenu.playlist.youtubeOrder }) },
            { label: t('Check for new videos once a day'), icon: CalendarClock, checked: playlistMenu.playlist.keepChecking, onClick: () => void changePlaylist(playlistMenu.playlist.id, { keepChecking: !playlistMenu.playlist.keepChecking }) },
            { label: t('Open in browser'), icon: ExternalLink, onClick: () => openLink(playlistAddress(playlistMenu.playlist)) },
            { label: t('Remove'), icon: Trash2, danger: true, divider: true, onClick: () => setRemovingPlaylist(playlistMenu.playlist) },
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
          items={[
            { label: t('New sub-folder'), icon: FolderPlus, onClick: () => setNaming({ parentId: folderMenu.folder.id }) },
            { label: t('Rename'), icon: Pencil, onClick: () => setNaming({ folder: folderMenu.folder }) },
            { label: t('Delete'), icon: Trash2, danger: true, onClick: () => setDeleting(folderMenu.folder) },
          ]}
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
          header={{ title: t('Move to folder') }}
          items={[
            // Your own folders, then those of this video's channel: it can't go in another channel's
            ...[
              ...folderChoices(allFolders.filter((folder) => !folder.parentId && !folder.channel), ''),
              ...folderChoices(allFolders.filter((folder) => folder.channel === channelKey(moving.video)), `${moving.video.channel} / `),
            ].map(({ folder, path }) => ({
              label: path,
              icon: Folder,
              checked: folder.id === moving.video.folderId,
              onClick: () => void moveToFolder(moving.video.id, folder.id),
            })),
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
                const { parentId, channel: inChannel, videoId } = naming
                void createFolder(name, parentId, inChannel).then((id) => (videoId ? moveToFolder(videoId, id) : undefined))
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
            message: foldersIn(deleting.id).length ? t('Its sub-folders go too. All their videos go back to the main list.') : t('Its videos go back to the main list.'),
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
