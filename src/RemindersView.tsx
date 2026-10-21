import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CalendarDays, List, Plus, RefreshCw, Repeat } from 'lucide-react'
import ContextMenu from './ContextMenu'
import Dialog, { type DialogRequest } from './Dialog'
import GameDialog from './GameDialog'
import Cover from './GameCover'
import MonthGrid, { byDay, dayKey, sameMonth } from './MonthGrid'
import type { CalendarLayout } from './GameCalendar'
import { useNarrow } from './useNarrow'
import { releaseCountdown, releaseEventId } from './games'
import { db, updateGame, type CalendarEvent, type Game } from './db'
import { deleteEvent, deleteSeries, useCalendarEvents } from './calendarEvents'
import EventDialog from './EventDialog'
import EventPreview from './EventPreview'
import Spinner from './Spinner'
import { openLink } from './links'
import { useLocalState } from './localState'
import { formatDue } from './reminders'
import { takeAlertEvent } from './dueReminders'

// The Reminders tab (opened from "Reminders" in the sidebar). PC: a month grid with your Google
// Calendar's events (calendarEvents.ts) and your Waiting games (exact release dates), or the
// list, with a switch. Phone: always the list (soonest first).
// Click an event = preview (a game: its details), right-click / long press an event = menu.
// Uses the Games tab's page layout (.games) and group titles.

const MIN_MONTHS = 3 // the grid shows at least this month and the next two...
const MAX_MONTHS = 12 // ...and at most a year, up to the last upcoming event or release

function RemindersView() {
  const waitingGames = useLiveQuery(
    () => db.games.filter((g) => !g.deleted && g.status === 'waiting' && !!g.releaseDate).toArray(),
    [],
  )
  // The main Google Calendar's events (calendarEvents.ts). The release events of Waiting games
  // (games.ts) are left out: the game shows instead (with its cover). Once out, the game moves
  // to "To play" and its event shows like any other.
  const gameEventIds = new Set((waitingGames ?? []).map(releaseEventId))
  const calendar = useCalendarEvents()
  // "Hide repeating" (per device): repeating events leave the list and grid, so the next real
  // events are easy to see. Their alerts still come (eventAlerts.ts reads all events)
  const [hideRepeating, setHideRepeating] = useLocalState('syncr.hideRepeating', false)
  const events = (calendar.events ?? []).filter(
    (event) => !gameEventIds.has(event.id) && !(hideRepeating && event.seriesId),
  )
  const [layout, setLayout] = useLocalState<CalendarLayout>('syncr.remindersLayout', 'grid') // PC only
  const narrow = useNarrow()
  const grid = layout === 'grid' && !narrow
  const [openGame, setOpenGame] = useState<string | null>(null) // a game's details
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | 'new' | null>(null)
  const [previewEvent, setPreviewEvent] = useState<CalendarEvent | null>(null) // left click: shown big
  const [eventMenu, setEventMenu] = useState<{ event: CalendarEvent; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<DialogRequest | null>(null)

  // A click on an alert card (dueReminders.ts): show its event (a Waiting game's release event:
  // the game)
  useEffect(() => {
    const show = async () => {
      const id = takeAlertEvent()
      if (!id) return
      const games = await db.games.filter((g) => !g.deleted && g.status === 'waiting' && !!g.releaseDate).toArray()
      const game = games.find((g) => releaseEventId(g) === id)
      if (game) return setOpenGame(game.id)
      const event = await db.events.get(id)
      if (event) setPreviewEvent(event)
    }
    show()
    window.addEventListener('open-alert-event', show)
    return () => window.removeEventListener('open-alert-event', show)
  }, [])

  // Redraw every 30 s, so events that have started leave the list and fade in the grid
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  // List: calendar events (not started yet; all-day ones until their day is over) and Waiting
  // games (by release day) together, soonest first
  const upcoming = [
    ...events.filter((event) => (event.allDay ? event.end : event.start) > now).map((event) => ({ time: event.start, event })),
    ...(waitingGames ?? []).map((game) => ({ time: game.releaseDate!, game })),
  ].sort((a, b) => a.time - b.time)

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

  // A calendar event in the list: its title, its description as the note
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
        <span className="reminder-text" title={event.title}>{event.title}</span>
        {event.description && <span className="reminder-row-note" title={event.description}>{event.description}</span>}
      </span>
      <span className="reminder-due">
        {formatDue(event.start, event.allDay)}
        {event.seriesId && <Repeat size={12} aria-label="Repeating event" />}
      </span>
    </button>
  )

  // A Waiting game in the list: small cover, name, release day and countdown ("in 12 days"; not
  // for Today / Tomorrow, which already say it). Its release event's alert is in its details.
  const gameRow = (game: Game) => {
    const countdown = releaseCountdown(game.releaseDate)
    return (
      <button key={game.id} className="reminder-row" onClick={() => setOpenGame(game.id)}>
        <Cover coverId={game.coverId} />
        <span className="reminder-row-text">
          <span className="reminder-text" title={game.name}>{game.name}</span>
          <span className="reminder-row-note">Comes out</span>
        </span>
        <span className="reminder-due">
          {formatDue(game.releaseDate!, true)}
          {countdown !== 'today' && countdown !== 'tomorrow' && ` · ${countdown}`}
        </span>
      </button>
    )
  }

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
              <label
                className="reminders-hide-repeating"
                title="Hide repeating events here (they stay in Google Calendar, and still alert)"
              >
                <input type="checkbox" checked={hideRepeating} onChange={(e) => setHideRepeating(e.target.checked)} />
                Hide repeating
              </label>
            )}
            {calendar.connected && (
              <button
                className="reminders-refresh"
                onClick={calendar.refresh}
                disabled={calendar.refreshing}
                title="Refresh events from Google Calendar"
              >
                {calendar.refreshing ? (
                  <Spinner label="Refreshing" />
                ) : (
                  <RefreshCw size={15} />
                )}
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
        {grid && waitingGames && (
          <ReminderGrid
            events={events}
            games={waitingGames}
            now={now}
            onOpenEvent={setPreviewEvent}
            onEventMenu={(event, x, y) => setEventMenu({ event, x, y })}
            onGame={setOpenGame}
          />
        )}
        {!grid && waitingGames && events.length + waitingGames.length === 0 && (
          <p className="games-empty">No reminders yet</p>
        )}
        {/* One group per month ("November 2026 3"), for an easier read of what's coming */}
        {!grid &&
          byMonth(upcoming).map(({ month, items }) => (
            <section key={month} className="games-group">
              <h3 className="games-group-title">
                {month} <span className="games-count">{items.length}</span>
              </h3>
              {items.map((item) =>
                'event' in item ? eventRow(item.event) : gameRow(item.game),
              )}
            </section>
          ))}
      </div>

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
            { label: 'Open in Google Calendar', onClick: () => openLink(eventMenu.event.link) },
            { label: 'Delete', danger: true, onClick: () => askDeleteEvent(eventMenu.event) },
          ]}
        />
      )}
      {openGame && <GameDialog id={openGame} onClose={() => setOpenGame(null)} onRemove={() => askRemoveGame(openGame)} />}
      {dialog && <Dialog request={dialog} onClose={() => setDialog(null)} />}
    </main>
  )
}


// The list's items (sorted by time) in groups per month: "November 2026" and its items
function byMonth<T extends { time: number }>(items: T[]) {
  const groups: { month: string; items: T[] }[] = []
  for (const item of items) {
    const month = new Date(item.time).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    if (groups.at(-1)?.month === month) groups.at(-1)!.items.push(item)
    else groups.push({ month, items: [item] })
  }
  return groups
}

// Month grid: calendar events ("14:30 Call the bank", on their first day; all-day ones without a
// time) and Waiting games (cover + name) on their day. Today's timed events fade once
// their start time has passed (all-day ones with their day). From this month to the last upcoming
// event or release, at least 3 months, at most 12.
function ReminderGrid(props: {
  events: CalendarEvent[]
  games: Game[]
  now: number
  onOpenEvent: (event: CalendarEvent) => void
  onEventMenu: (event: CalendarEvent, x: number, y: number) => void
  onGame: (id: string) => void
}) {
  const { events, games } = props
  const today = new Date()
  const eventsByDay = byDay(events, (e) => e.start)
  const gamesByDay = byDay(games, (g) => g.releaseDate!)
  const last = Math.max(
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
        events.filter((e) => sameMonth(new Date(e.start), first)).length +
        games.filter((g) => sameMonth(new Date(g.releaseDate!), first)).length
      }
      renderDay={(date) => (
        <>
          {(eventsByDay.get(dayKey(date)) ?? []).map((event) => (
            <button
              key={event.id}
              className={`calendar-reminder${!event.allDay && event.start <= props.now ? ' past' : ''}`}
              onClick={() => props.onOpenEvent(event)}
              onContextMenu={(e) => {
                e.preventDefault()
                props.onEventMenu(event, e.clientX, e.clientY)
              }}
              title={event.description ? `${event.title}\n${event.description}` : event.title}
            >
              {!event.allDay && <span className="calendar-reminder-time">{time(event.start)}</span>}
              {event.seriesId && <Repeat size={11} className="calendar-repeat" aria-label="Repeating event" />} {event.title}
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
