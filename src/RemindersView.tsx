import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, ChevronDown, ChevronRight, List, Plus, RefreshCw, Smartphone } from 'lucide-react'
import ContextMenu from './ContextMenu'
import Dialog, { type DialogRequest } from './Dialog'
import ReminderDialog from './ReminderDialog'
import GameDialog from './GameDialog'
import Cover from './GameCover'
import MonthGrid, { byDay, dayKey, sameMonth } from './MonthGrid'
import type { CalendarLayout } from './GameCalendar'
import { useNarrow } from './useNarrow'
import { formatRelease, releaseCountdown, releaseEventId } from './games'
import { db, updateGame, type CalendarEvent, type Game, type Reminder } from './db'
import { deleteEvent, deleteSeries, useCalendarEvents } from './calendarEvents'
import EventDialog from './EventDialog'
import EventPreview from './EventPreview'
import { openLink } from './links'
import { useLocalState } from './localState'
import { addToGoogleCalendar, clearDone, deleteReminder, formatDue, listReminders, markDone, markNotDone } from './reminders'

// The Reminders tab (opened from "Reminders" in the sidebar). PC: a month grid with your
// reminders, your Google Calendar's events (calendarEvents.ts) and your Waiting games (exact
// release dates), or the list, with a switch.
// Phone: always the list. List: upcoming reminders (soonest first), then a folded "Done" group.
// Click = edit (a game: its details), right-click / long press a reminder = menu.
// Uses the Games tab's page layout (.games) and group titles.

const MIN_MONTHS = 3 // the grid shows at least this month and the next two...
const MAX_MONTHS = 12 // ...and at most a year, up to the last upcoming reminder or release

function RemindersView() {
  // Re-runs whenever a reminder changes (also from sync). Release reminders (games.ts) are left
  // out: their game shows instead (click it for its details, which show the reminder).
  const reminders = useLiveQuery(async () => (await listReminders()).filter((r) => !r.gameId), [])
  const waitingGames = useLiveQuery(
    () => db.games.filter((g) => !g.deleted && g.status === 'waiting' && !!g.releaseDate).toArray(),
    [],
  )
  // The main Google Calendar's events (calendarEvents.ts). The release events of Waiting games
  // (games.ts) are left out: the game shows instead (with its cover). Once out, the game moves
  // to "To play" and its event shows like any other.
  const gameEventIds = new Set((waitingGames ?? []).map(releaseEventId))
  const calendar = useCalendarEvents()
  const events = (calendar.events ?? []).filter((event) => !gameEventIds.has(event.id))
  const [layout, setLayout] = useLocalState<CalendarLayout>('syncr.remindersLayout', 'grid') // PC only
  const narrow = useNarrow()
  const grid = layout === 'grid' && !narrow
  const [openGame, setOpenGame] = useState<string | null>(null) // a game's details
  const [doneOpen, setDoneOpen] = useLocalState('syncr.remindersDoneOpen', false)
  const [editing, setEditing] = useState<Reminder | 'new' | null>(null)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | 'new' | null>(null)
  const [previewEvent, setPreviewEvent] = useState<CalendarEvent | null>(null) // left click: shown big
  const [eventMenu, setEventMenu] = useState<{ event: CalendarEvent; x: number; y: number } | null>(null)
  const [menu, setMenu] = useState<{ reminder: Reminder; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<DialogRequest | null>(null)

  // Redraw every 30 s, so "overdue" and "Today" stay correct
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const waiting = reminders?.filter((r) => r.doneAt === null) ?? []
  // List: upcoming reminders, calendar events (not over yet) and Waiting games (by release day)
  // together, soonest first
  const upcoming = [
    ...waiting.map((reminder) => ({ time: reminder.dueAt, reminder })),
    ...events.filter((event) => event.end > now).map((event) => ({ time: event.start, event })),
    ...(waitingGames ?? []).map((game) => ({ time: game.releaseDate!, game })),
  ].sort((a, b) => a.time - b.time)
  const done = (reminders?.filter((r) => r.doneAt !== null) ?? []).sort((a, b) => b.doneAt! - a.doneAt!)

  function askDelete(reminder: Reminder) {
    setDialog({
      title: 'Delete reminder?',
      message: `"${reminder.text}" will be deleted. This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: () => deleteReminder(reminder.id),
    })
  }

  // New things go to Google Calendar, so it must be connected on this device
  function newEvent() {
    if (calendar.connected) setEditingEvent('new')
    else
      setDialog({
        title: 'Connect Google Calendar',
        message: 'New events go to your Google Calendar. Connect it first in Settings → Google Calendar.',
        confirmLabel: 'OK',
        noCancel: true,
        onConfirm: () => {},
      })
  }

  // Deleting needs internet: if it fails, the event stays and a message says why.
  // A repeating event: only this date, unless "All events in the series" is ticked.
  function askDeleteEvent(event: CalendarEvent) {
    setDialog({
      title: 'Delete event?',
      message: `"${event.title}" will be deleted from your Google Calendar.${event.seriesId ? ' Only this date, unless you tick the box.' : ''}`,
      checkbox: event.seriesId ? 'All events in the series' : undefined,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: (_, wholeSeries) => {
        setEditingEvent(null)
        setPreviewEvent(null)
        const remove = wholeSeries ? deleteSeries : deleteEvent
        remove(event).catch((e) =>
          setDialog({
            title: "Couldn't delete the event",
            message: e instanceof Error ? e.message : String(e),
            confirmLabel: 'OK',
            noCancel: true,
            onConfirm: () => {},
          }),
        )
      },
    })
  }

  function askClearDone() {
    setDialog({
      title: 'Clear done reminders?',
      message: `${done.length} done reminder${done.length === 1 ? '' : 's'} will be deleted. This can't be undone.`,
      confirmLabel: 'Clear',
      danger: true,
      onConfirm: () => clearDone(),
    })
  }

  async function askRemoveGame(id: string) {
    const game = await db.games.get(id)
    if (!game) return
    setDialog({
      title: 'Remove game?',
      message: `"${game.name}" will be removed from your list, with its note and review.`,
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () => {
        setOpenGame(null)
        updateGame(game.id, { deleted: true })
      },
    })
  }

  const row = (reminder: Reminder) => {
    const overdue = reminder.doneAt === null && reminder.dueAt <= now
    return (
      <button
        key={reminder.id}
        className={`reminder-row${overdue ? ' overdue' : ''}${reminder.doneAt !== null ? ' done' : ''}`}
        onClick={() => setEditing(reminder)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ reminder, x: e.clientX, y: e.clientY })
        }}
      >
        <span className="reminder-row-text">
          <span className="reminder-text">{reminder.text}</span>
          {reminder.note && <span className="reminder-row-note">{reminder.note}</span>}
        </span>
        <span className="reminder-due">
          {formatDue(reminder.dueAt)}
          {reminder.phone && <Smartphone size={12} aria-label="Also in Google Calendar" />}
        </span>
      </button>
    )
  }

  // A calendar event in the list: like a reminder (its description as the note)
  const eventRow = (event: CalendarEvent) => (
    <button
      key={event.id}
      className="reminder-row"
      onClick={() => setPreviewEvent(event)}
      onContextMenu={(e) => {
        e.preventDefault()
        setEventMenu({ event, x: e.clientX, y: e.clientY })
      }}
    >
      <span className="reminder-row-text">
        <span className="reminder-text">{event.title}</span>
        {event.description && <span className="reminder-row-note">{event.description}</span>}
      </span>
      <span className="reminder-due">{formatDue(event.start, event.allDay)}</span>
    </button>
  )

  // A Waiting game in the list: small cover, name, release day and countdown. Its release
  // reminder (2 days before) is in its details.
  const gameRow = (game: Game) => (
    <button key={game.id} className="reminder-row" onClick={() => setOpenGame(game.id)}>
      <Cover coverId={game.coverId} />
      <span className="reminder-row-text">
        <span className="reminder-text">{game.name}</span>
        <span className="reminder-row-note">Comes out</span>
      </span>
      <span className="reminder-due">
        {formatRelease(game.releaseDate)} · {releaseCountdown(game.releaseDate)}
      </span>
    </button>
  )

  return (
    <main className="page games-page">
      <div className={grid ? 'games wide' : 'games'}>
        {/* One row: New event on the left; refresh and grid / list on the right (the phone has
            no grid: only refresh there) */}
        <div className="games-views reminders-toolbar">
          <button className="reminders-new" onClick={newEvent}>
            <Plus size={15} /> New event
          </button>
          <div className="reminders-tools">
            {calendar.connected && (
              <button
                className={`reminders-refresh${calendar.refreshing ? ' spinning' : ''}`}
                onClick={calendar.refresh}
                disabled={calendar.refreshing}
                title="Refresh events from Google Calendar"
              >
                <RefreshCw size={15} />
              </button>
            )}
            <div className="calendar-layouts">
              <button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} title="Month grid">
                <CalendarDays size={15} />
              </button>
              <button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} title="List">
                <List size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* The last refresh failed: the stored events still show */}
        {calendar.error && (
          <p className="games-empty">Google Calendar: {calendar.error} (showing the last loaded events)</p>
        )}
        {grid && reminders && waitingGames && (
          <ReminderGrid
            reminders={reminders}
            events={events}
            games={waitingGames}
            now={now}
            onEdit={setEditing}
            onOpenEvent={setPreviewEvent}
            onEventMenu={(event, x, y) => setEventMenu({ event, x, y })}
            onMenu={(reminder, x, y) => setMenu({ reminder, x, y })}
            onGame={setOpenGame}
          />
        )}
        {!grid && reminders && waitingGames && reminders.length + events.length + waitingGames.length === 0 && (
          <p className="games-empty">No reminders yet.</p>
        )}
        {!grid && upcoming.length > 0 && (
          <section className="games-group">
            <h3 className="games-group-title">
              Upcoming <span className="games-count">{upcoming.length}</span>
            </h3>
            {upcoming.map((item) =>
              'reminder' in item ? row(item.reminder) : 'event' in item ? eventRow(item.event) : gameRow(item.game),
            )}
          </section>
        )}
        {!grid && done.length > 0 && (
          <section className="games-group">
            <div className="reminders-done-header">
              <button className="games-group-title" onClick={() => setDoneOpen(!doneOpen)}>
                {doneOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Done <span className="games-count">{done.length}</span>
              </button>
              <button className="reminders-clear" onClick={askClearDone}>
                Clear
              </button>
            </div>
            {doneOpen && done.map(row)}
          </section>
        )}
      </div>

      {editing && <ReminderDialog reminder={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {editingEvent && (
        <EventDialog
          event={editingEvent === 'new' ? null : editingEvent}
          onDelete={askDeleteEvent}
          onClose={() => setEditingEvent(null)}
        />
      )}
      {previewEvent && (
        <EventPreview
          event={previewEvent}
          onEdit={() => {
            setPreviewEvent(null)
            setEditingEvent(previewEvent)
          }}
          onDelete={() => askDeleteEvent(previewEvent)}
          onClose={() => setPreviewEvent(null)}
        />
      )}
      {eventMenu && (
        <ContextMenu
          x={eventMenu.x}
          y={eventMenu.y}
          onClose={() => setEventMenu(null)}
          items={[
            { label: 'Edit', onClick: () => setEditingEvent(eventMenu.event) },
            { label: 'Delete', danger: true, onClick: () => askDeleteEvent(eventMenu.event) },
            { label: 'Open in Google Calendar', onClick: () => openLink(eventMenu.event.link) },
          ]}
        />
      )}
      {openGame && <GameDialog id={openGame} onClose={() => setOpenGame(null)} onRemove={() => askRemoveGame(openGame)} />}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Edit', onClick: () => setEditing(menu.reminder) },
            menu.reminder.doneAt === null
              ? { label: 'Done', onClick: () => markDone(menu.reminder.id) }
              : { label: 'Not done', onClick: () => markNotDone(menu.reminder.id) },
            // Opens Calendar again (e.g. the event wasn't saved there, or was deleted)
            ...(menu.reminder.doneAt === null
              ? [{ label: 'Add to Google Calendar', onClick: () => addToGoogleCalendar(menu.reminder) }]
              : []),
            { label: 'Delete', danger: true, onClick: () => askDelete(menu.reminder) },
          ]}
        />
      )}
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
    </main>
  )
}


// Month grid: reminders ("14:30 Call the bank"; done ones crossed out, overdue ones red), calendar
// events (on their first day; all-day ones without a time) and Waiting games (cover + name) on
// their day. From this month to the last upcoming reminder, event or release, at least 3 months,
// at most 12.
function ReminderGrid(props: {
  reminders: Reminder[]
  events: CalendarEvent[]
  games: Game[]
  now: number
  onEdit: (reminder: Reminder) => void
  onOpenEvent: (event: CalendarEvent) => void
  onEventMenu: (event: CalendarEvent, x: number, y: number) => void
  onMenu: (reminder: Reminder, x: number, y: number) => void
  onGame: (id: string) => void
}) {
  const { reminders, events, games, now } = props
  const today = new Date()
  const remindersByDay = byDay(reminders, (r) => r.dueAt)
  const eventsByDay = byDay(events, (e) => e.start)
  const gamesByDay = byDay(games, (g) => g.releaseDate!)
  const last = Math.max(
    ...reminders.filter((r) => r.doneAt === null).map((r) => r.dueAt),
    ...events.map((e) => e.start),
    ...games.map((g) => g.releaseDate!),
    0,
  )
  const lastMonth = last ? (new Date(last).getFullYear() - today.getFullYear()) * 12 + new Date(last).getMonth() - today.getMonth() : 0
  const monthCount = Math.min(MAX_MONTHS, Math.max(MIN_MONTHS, lastMonth + 1))
  const months = Array.from({ length: monthCount }, (_, i) => new Date(today.getFullYear(), today.getMonth() + i, 1))
  const time = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  return (
    <MonthGrid
      months={months}
      count={(first) =>
        reminders.filter((r) => sameMonth(new Date(r.dueAt), first)).length +
        events.filter((e) => sameMonth(new Date(e.start), first)).length +
        games.filter((g) => sameMonth(new Date(g.releaseDate!), first)).length
      }
      renderDay={(date) => (
        <>
          {(remindersByDay.get(dayKey(date)) ?? []).map((reminder) => {
            const overdue = reminder.doneAt === null && reminder.dueAt <= now
            return (
              <button
                key={reminder.id}
                className={`calendar-reminder${overdue ? ' overdue' : ''}${reminder.doneAt !== null ? ' done' : ''}`}
                onClick={() => props.onEdit(reminder)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  props.onMenu(reminder, e.clientX, e.clientY)
                }}
                title={reminder.note ? `${reminder.text}\n${reminder.note}` : reminder.text}
              >
                <span className="calendar-reminder-time">{time(reminder.dueAt)}</span>{' '}
                {reminder.text}
              </button>
            )
          })}
          {(eventsByDay.get(dayKey(date)) ?? []).map((event) => (
            <button
              key={event.id}
              className="calendar-reminder"
              onClick={() => props.onOpenEvent(event)}
              onContextMenu={(e) => {
                e.preventDefault()
                props.onEventMenu(event, e.clientX, e.clientY)
              }}
              title={event.description ? `${event.title}\n${event.description}` : event.title}
            >
              {!event.allDay && <span className="calendar-reminder-time">{time(event.start)}</span>} {event.title}
            </button>
          ))}
          {(gamesByDay.get(dayKey(date)) ?? []).map((game) => (
            <button key={game.id} className="calendar-game" onClick={() => props.onGame(game.id)} title={game.name}>
              <Cover coverId={game.coverId} />
              <span>{game.name}</span>
            </button>
          ))}
        </>
      )}
    />
  )
}
export default RemindersView
