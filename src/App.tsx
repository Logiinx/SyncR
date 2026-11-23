import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t, useLanguage } from './i18n'
import { ChevronLeft, Menu, Pencil, Pin, PinOff, Plus, Trash2, X } from 'lucide-react'
import { SpecialIcon } from './tabIcons'
import { useLiveQuery } from 'dexie-react-hooks'
import ContextMenu from './ContextMenu'
import { createNote, db, deleteNote, noteTitle, renameNote } from './db'
import Dialog, { type DialogRequest } from './Dialog'
import { forgetScroll, useLocalState } from './localState'
import { onFollowLink } from './noteLinks'
import { onAppMessage } from './appMessage'
import NoteView from './NoteView'
import ImageViewer from './ImageViewer'
import ReminderAlerts from './ReminderAlerts'
import Sidebar from './Sidebar'
import Board from './Board'
import { usePanelSwipe } from './edgeSwipe'
import { useBack } from './backStack'
import { useNarrow } from './useNarrow'
import { setPendingSearch } from './noteSearch'
import SettingsDialog from './SettingsDialog'
import { listenOpenSettings, type SettingsStart } from './openSettings'
import TabBar, { type Tab } from './TabBar'
import GamesView from './GamesView'
import RemindersView from './RemindersView'
import { REMINDERS_TAB } from './reminders'
import { GAMES_TAB, startGameChecks } from './games'
import { MAIL_TAB } from './mailbox'
import { startVideoChecks, useVideoEnabled, useVideoFeed, VIDEO_TAB } from './video'
import VideoView from './VideoView'
import { startLinkShortcut } from './videoPaste'
import { useModuleOn } from './modules'
import { isTauri } from '@tauri-apps/api/core'
import { listenMouseBatteryOpen } from './mouseBattery'
import { listenHardwareOpen } from './hardware'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useMissed } from './mailAlerts'
import MailView from './MailView'
import { startCalendarChecks } from './calendarEvents'
import { startNoteHistory } from './noteHistory'
import UpdateBanner from './UpdateBanner'
import WhatsNew from './WhatsNew'
import SyncButton from './SyncButton'
import WindowControls from './WindowControls'
import { usePage } from './animations'

const isNarrowScreen = () => window.matchMedia('(max-width: 699px)').matches

// Tabs that show a page instead of a note (their ids never look like a note id)
const isPageTab = (id: string) => id === GAMES_TAB || id === REMINDERS_TAB || id === MAIL_TAB || id === VIDEO_TAB

function App() {
  useLanguage()
  // Mail, Video and Games: turned off in Settings = no tab, no background work (modules.ts).
  // Video also needs the Worker's yes.
  const videoAllowed = useVideoEnabled()
  const videoModule = useModuleOn('video')
  const videoOn = videoAllowed && videoModule
  const mailOn = useModuleOn('mail')
  const gamesOn = useModuleOn('games')
  useEffect(() => (videoOn ? startVideoChecks() : undefined), [videoOn])
  // Ctrl+Alt+Shift+V opens a copied video link (videoPaste.ts)
  useEffect(() => (videoOn ? startLinkShortcut() : undefined), [videoOn])
  // Remembered after a restart (per device)
  const [openTabs, setOpenTabs] = useLocalState<string[]>('syncr.tabs', [])
  const [activeId, setActiveId] = useLocalState<string | null>('syncr.activeTab', null)
  // Pinned tabs (any tab, notes too): first in the row, in the order they were pinned (TabBar.tsx)
  const [pinned, setPinned] = useLocalState<string[]>('syncr.pinnedTabs', [])
  // The notes sidebar and the Board start open on a new PC, so new users see that they exist
  // (on a phone they would cover the note: closed there)
  const [sidebarOpen, setSidebarOpen] = useLocalState('syncr.sidebarOpen', !isNarrowScreen())
  const [boardOpen, setBoardOpen] = useLocalState('syncr.boardOpen', !isNarrowScreen())
  const bodyRef = useRef<HTMLDivElement>(null)
  // Search across all notes (Sidebar.tsx): kept while the sidebar closes, not after a restart
  const [searchQuery, setSearchQuery] = useState('')
  const [focusSearch, setFocusSearch] = useState(false)
  usePanelSwipe(bodyRef, boardOpen, sidebarOpen, setBoardOpen, setSidebarOpen)
  // Phone: Back hides the notes menu or the Board (backStack.ts). Not on the PC, where they're
  // docked beside the note (user, 2026-11-23)
  const narrow = useNarrow()
  useBack(() => setSidebarOpen(false), sidebarOpen && narrow)
  useBack(() => setBoardOpen(false), boardOpen && narrow)

  // Games: release day check and daily refresh from IGDB (games.ts)
  useEffect(() => (gamesOn ? startGameChecks() : undefined), [gamesOn])

  // Google Calendar: events kept fresh in the background, for their alerts (calendarEvents.ts)
  useEffect(startCalendarChecks, [])

  // Note history: snapshots of notes at the moments that matter (noteHistory.ts)
  useEffect(startNoteHistory, [])

  // A conflict was resolved (ConflictCompare.tsx): show the note that was kept, close the copy
  useEffect(() => {
    const onOpenNote = (e: Event) => {
      const { id, close } = (e as CustomEvent<{ id: string; close?: string }>).detail
      setOpenTabs((tabs) => [...tabs.filter((t) => t !== close && t !== id), id])
      setActiveId(id)
      if (close) forgetScroll(close)
    }
    window.addEventListener('open-note', onOpenNote)
    return () => window.removeEventListener('open-note', onOpenNote)
  }, [setOpenTabs, setActiveId])

  // Ctrl+Shift+F: open the sidebar with the cursor in its search box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== 'f') return
      e.preventDefault()
      if (isNarrowScreen()) setBoardOpen(false)
      setSidebarOpen(true)
      setFocusSearch(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setBoardOpen, setSidebarOpen])

  // "Pin" in the toolbar: show the Board so the new card is visible
  useEffect(() => {
    const open = () => {
      if (isNarrowScreen()) setSidebarOpen(false)
      setBoardOpen(true)
    }
    window.addEventListener('open-board', open)
    return () => window.removeEventListener('open-board', open)
  }, [setBoardOpen, setSidebarOpen])
  // Only a brand-new note gets the cursor automatically
  const [newNoteId, setNewNoteId] = useState<string | null>(null)
  // tab: right-clicked in the tab row (Pin, Close…), not in the notes list
  const [menu, setMenu] = useState<{ noteId: string; x: number; y: number; tab?: boolean } | null>(null)
  const [dialog, setDialog] = useState<DialogRequest | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // A module's ⚙️, a click on the mouse battery's taskbar strip, or "Hardware settings…" in the
  // Hardware widget's menu opens Settings on that section (a new key starts it there again when
  // Settings was already open)
  const [settingsStart, setSettingsStart] = useState<{ start?: SettingsStart; key: number }>({ key: 0 })

  // PC, mouse: hovering the ☰ button opens the sidebar over the note after 0.3 s ("peek"); it
  // closes 0.5 s after the mouse left the button and the panel (not while one of its menus or
  // windows is up). A click on ☰ pins it as usual (it then pushes the note).
  const [sidebarPeek, setSidebarPeek] = useState(false)
  const [overSidebar, setOverSidebar] = useState(false)
  const busy = !!menu || !!dialog || settingsOpen
  useEffect(() => {
    if (sidebarOpen || overSidebar === sidebarPeek || (!overSidebar && busy)) return
    const timer = setTimeout(() => setSidebarPeek(overSidebar), overSidebar ? 300 : 500)
    return () => clearTimeout(timer)
  }, [sidebarOpen, overSidebar, sidebarPeek, busy])
  // Pinned (or a note picked): the peek is over. The mouse counts as gone, else the panel would
  // open again under it (a removed panel never tells that the mouse left).
  function endPeek() {
    setSidebarPeek(false)
    setOverSidebar(false)
  }
  useEffect(() => {
    if (sidebarOpen) endPeek()
  }, [sidebarOpen])
  function hoverSidebar(over: boolean) {
    if (over && (sidebarOpen || isNarrowScreen())) return
    setOverSidebar(over)
  }

  useEffect(() => {
    const openOn = (start: SettingsStart) => {
      setSettingsStart((before) => ({ start, key: before.key + 1 }))
      setSettingsOpen(true)
    }
    const stops = [
      listenOpenSettings(openOn),
      listenMouseBatteryOpen(() => openOn('mouse-battery')),
      listenHardwareOpen(() => openOn('hardware')),
    ]
    return () => stops.forEach((stop) => stop())
  }, [])

  // `ids` lets us check the result matches the current tabs (it can lag one render behind)
  const tabsResult = useLiveQuery(
    async () => ({ ids: openTabs, notes: await db.notes.bulkGet(openTabs) }),
    [openTabs],
  )
  // The tabs that exist: notes found in the database, and the Games, Reminders, Mail and Video tabs
  const openTabsList: Tab[] = (tabsResult?.ids ?? []).flatMap((id, i): Tab[] => {
    if (id === GAMES_TAB) return gamesOn ? [{ id, title: t('Games'), icon: <SpecialIcon kind="games" size={14} className="tab-icon" /> }] : []
    if (id === REMINDERS_TAB) return [{ id, title: t('Reminders'), icon: <SpecialIcon kind="reminders" size={14} className="tab-icon" /> }]
    if (id === MAIL_TAB) return mailOn ? [{ id, title: t('Mail'), icon: <MailTabIcon /> }] : []
    if (id === VIDEO_TAB) return videoOn ? [{ id, title: t('Video'), icon: <VideoTabIcon /> }] : []
    const note = tabsResult?.notes[i]
    return note ? [{ id, title: noteTitle(note) }] : []
  })
  // As shown: the pinned ones first (in pinned order), then the others
  const tabs: Tab[] = [
    ...pinned.flatMap((id) => openTabsList.filter((tab) => tab.id === id).map((tab) => ({ ...tab, pinned: true }))),
    ...openTabsList.filter((tab) => !pinned.includes(tab.id)),
  ]
  const activeNote = useLiveQuery(
    () => (activeId ? db.notes.get(activeId) : undefined),
    [activeId],
  )

  // Close tabs whose note no longer exists (e.g. deleted on the other device), and the tab of a
  // module turned off (Video: also when the Worker turned it off)
  useEffect(() => {
    if (!tabsResult || tabsResult.ids !== openTabs) return
    const missing = openTabs.filter((id, i) => !tabAllowed(id) || (!isPageTab(id) && !tabsResult.notes[i]))
    if (missing.length === 0) return
    missing.forEach(forgetScroll)
    const remaining = openTabs.filter((id) => !missing.includes(id))
    setOpenTabs(remaining)
    if (activeId && missing.includes(activeId)) setActiveId(remaining.at(-1) ?? null)
  }, [tabsResult, openTabs, activeId, videoOn, mailOn, gamesOn, setOpenTabs, setActiveId])

  // A pinned tab that was closed some other way (its note deleted…) is no longer pinned
  useEffect(() => {
    if (pinned.some((id) => !openTabs.includes(id))) setPinned(pinned.filter((id) => openTabs.includes(id)))
  }, [pinned, openTabs, setPinned])

  // Clicking a link to a note (noteLinks.ts) opens it here
  useEffect(() => {
    onFollowLink(openNote)
  })

  // Short messages from code outside React (appMessage.ts: a deleted link target, image errors)
  useEffect(
    () => onAppMessage((title, message) => setDialog({ title, message, confirmLabel: 'OK', noCancel: true, onConfirm: () => {} })),
    [],
  )

  // The link shortcut has something to show (videoPaste.ts): the window comes up on the Video tab
  useEffect(() => {
    const onShow = () => {
      openNote(VIDEO_TAB)
      if (isTauri()) {
        const main = getCurrentWindow()
        void main.unminimize().then(() => main.show()).then(() => main.setFocus())
      }
    }
    window.addEventListener('show-video-tab', onShow)
    return () => window.removeEventListener('show-video-tab', onShow)
  })

  // A module's tab can't open while it's off (a pop-up card, the link shortcut…)
  function tabAllowed(id: string) {
    return id === VIDEO_TAB ? videoOn : id === MAIL_TAB ? mailOn : id === GAMES_TAB ? gamesOn : true
  }

  function openNote(id: string) {
    if (!tabAllowed(id)) return
    if (!openTabs.includes(id)) setOpenTabs([...openTabs, id])
    setActiveId(id)
    if (isNarrowScreen()) setSidebarOpen(false)
    endPeek()
  }

  // A pinned tab is unpinned first. The next open tab: the neighbor in the row as shown.
  function closeTab(id: string) {
    const shown = tabs.map((tab) => tab.id)
    const order = shown.includes(id) ? shown : openTabs
    const index = order.indexOf(id)
    const remaining = order.filter((tabId) => tabId !== id)
    setPinned(pinned.filter((tabId) => tabId !== id))
    setOpenTabs(openTabs.filter((tabId) => tabId !== id))
    if (id === activeId) setActiveId(remaining[index] ?? remaining[index - 1] ?? null)
  }

  // Unpinned: the first of the other tabs, right after the line (where it was)
  function togglePin(id: string) {
    if (!pinned.includes(id)) return setPinned([...pinned, id])
    setPinned(pinned.filter((tabId) => tabId !== id))
    setOpenTabs([id, ...openTabs.filter((tabId) => tabId !== id)])
  }

  // A tab dragged among its group: the pinned ones, or the others
  function reorderTabs(ids: string[], isPinned: boolean) {
    if (isPinned) setPinned(ids)
    else setOpenTabs([...openTabs.filter((id) => pinned.includes(id)), ...ids])
  }

  async function newNote() {
    const id = await createNote()
    setNewNoteId(id)
    openNote(id)
  }

  async function askRename(id: string) {
    const note = await db.notes.get(id)
    if (!note) return
    setDialog({
      title: t('Rename note'),
      input: { initial: note.title ?? '', placeholder: t('Leave empty to use the first line ("{title}")', { title: noteTitle({ ...note, title: null }) }) },
      confirmLabel: t('Rename'),
      onConfirm: (title) => renameNote(id, title),
    })
  }

  async function askDelete(id: string) {
    const note = await db.notes.get(id)
    if (!note) return
    setDialog({
      title: t('Delete note?'),
      message: t('"{title}" will be deleted. This can\'t be undone.', { title: noteTitle(note) }),
      confirmLabel: t('Delete'),
      danger: true,
      onConfirm: () => {
        closeTab(id)
        forgetScroll(id)
        deleteNote(id)
      },
    })
  }

  const showNote = activeNote && openTabs.includes(activeNote.id)

  return (
    <div className="app">
      {/* Also the window title bar: empty areas marked data-tauri-drag-region move the window */}
      <header className="topbar" data-tauri-drag-region>
        <button
          className="menu-button"
          onClick={() => {
            // Phone: only one panel at a time, they both slide over the note
            if (isNarrowScreen()) setBoardOpen(false)
            setSidebarOpen(!sidebarOpen)
            endPeek()
          }}
          onPointerEnter={(e) => e.pointerType === 'mouse' && hoverSidebar(true)}
          onPointerLeave={() => hoverSidebar(false)}
          title={t('Notes')}
        >
          <Menu size={18} />
        </button>
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={openNote}
          onClose={closeTab}
          onNew={newNote}
          onMenu={(noteId, x, y) => setMenu({ noteId, x, y, tab: true })}
          onRename={askRename}
          onReorder={reorderTabs}
        />
        <div className="drag-space" data-tauri-drag-region />
        <SyncButton />
        <WindowControls />
      </header>
      <UpdateBanner />

      <div className="body" ref={bodyRef}>
        {(sidebarOpen || sidebarPeek) && (
          <Sidebar
            peek={!sidebarOpen}
            onHover={hoverSidebar}
            activeId={activeId}
            onOpen={(id) => {
              openNote(id)
              // A search result: the note jumps to the first match (noteSearch.ts)
              if (searchQuery.trim()) setPendingSearch(id, searchQuery)
            }}
            onClose={() => {
              setSidebarOpen(false)
              endPeek()
            }}
            onMenu={(noteId, x, y) => setMenu({ noteId, x, y })}
            onSettings={() => setSettingsOpen(true)}
            onGames={gamesOn ? () => openNote(GAMES_TAB) : null}
            onReminders={() => openNote(REMINDERS_TAB)}
            onMail={mailOn ? () => openNote(MAIL_TAB) : null}
            onVideo={videoOn ? () => openNote(VIDEO_TAB) : null}
            query={searchQuery}
            onQuery={setSearchQuery}
            focusSearch={focusSearch}
            onSearchFocused={() => setFocusSearch(false)}
          />
        )}
        {activeId === REMINDERS_TAB && openTabs.includes(REMINDERS_TAB) ? (
          <RemindersView />
        ) : activeId === GAMES_TAB && gamesOn && openTabs.includes(GAMES_TAB) ? (
          <GamesView />
        ) : activeId === MAIL_TAB && mailOn && openTabs.includes(MAIL_TAB) ? (
          <MailView />
        ) : activeId === VIDEO_TAB && videoOn && openTabs.includes(VIDEO_TAB) ? (
          <VideoView />
        ) : showNote ? (
          // key: a fresh view and editor for each note
          <NoteView key={activeNote.id} note={activeNote} autoFocus={activeNote.id === newNoteId} />
        ) : (
          <EmptyPage>
            <div className="empty">
              <button className="empty-new" onClick={newNote}>
                <Plus size={16} /> {t('New note')}
              </button>
              <p>
                {t('or open one with')} <Menu size={15} className="empty-icon" aria-label={t('the notes button')} />
              </p>
            </div>
          </EmptyPage>
        )}
        {boardOpen ? (
          <Board onClose={() => setBoardOpen(false)} />
        ) : (
          // Small tab in the middle of the right edge: opens the Board
          <button
            className="board-toggle"
            onClick={() => {
              // Phone: only one panel at a time, they both slide over the note
              if (isNarrowScreen()) setSidebarOpen(false)
              setBoardOpen(true)
            }}
            title={t('Board')}
          >
            <ChevronLeft size={14} />
          </button>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            ...(menu.tab
              ? [
                  pinned.includes(menu.noteId)
                    ? { label: t('Unpin tab'), icon: PinOff, onClick: () => togglePin(menu.noteId) }
                    : { label: t('Pin tab'), icon: Pin, onClick: () => togglePin(menu.noteId) },
                  { label: t('Close tab'), icon: X, onClick: () => closeTab(menu.noteId) },
                ]
              : []),
            ...(isPageTab(menu.noteId)
              ? []
              : [
                  { label: t('Rename'), icon: Pencil, divider: menu.tab, onClick: () => askRename(menu.noteId) },
                  { label: t('Delete'), icon: Trash2, danger: true, onClick: () => askDelete(menu.noteId) },
                ]),
          ]}
        />
      )}
      <ReminderAlerts />
      <ImageViewer />
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
      {settingsOpen && (
        <SettingsDialog
          key={settingsStart.key}
          start={settingsStart.start}
          onClose={() => {
            setSettingsOpen(false)
            setSettingsStart((start) => ({ key: start.key }))
          }}
        />
      )}
      <WhatsNew />
    </div>
  )
}

// A tab's icon with a count on its corner: the Mail and Video tabs
function CountIcon({ icon, count, title }: { icon: ReactNode; count: number; title: string }) {
  return (
    <span className="tab-icon mail-tab-icon">
      {icon}
      {count > 0 && (
        <span className="mail-tab-count" title={title}>
          {count > 9 ? '9+' : count}
        </span>
      )}
    </span>
  )
}

function MailTabIcon() {
  return <CountIcon icon={<SpecialIcon kind="mail" size={14} className="tab-icon" />} count={useMissed().length} title={t('Missed emails')} />
}

function VideoTabIcon() {
  return <CountIcon icon={<SpecialIcon kind="video" size={14} className="tab-icon" />} count={useVideoFeed()?.newCount ?? 0} title={t('New videos')} />
}

// The page when no tab is open; crossfades like the others (animations.ts)
function EmptyPage({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  usePage(ref)
  return (
    <main className="page" ref={ref}>
      {children}
    </main>
  )
}

export default App
