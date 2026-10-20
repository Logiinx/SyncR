import { useEffect, useRef, useState } from 'react'
import type { CalendarEvent } from './db'
import {
  createEvent,
  loadSeriesRepeat,
  updateEvent,
  updateSeries,
  type Repeat,
  type SeriesRepeat,
} from './calendarEvents'
import Spinner from './Spinner'

// Add (event = null) or edit an event of the main Google Calendar (calendarEvents.ts). For a
// repeating event, only this date changes, unless "All events in the series" is ticked.
// The title is the main thing (it's what the phone's notification shows), then the date and
// time, the alert and (new events) how it repeats. Notes are optional, hidden behind
// "Add notes". No end time: new events last 15 minutes, edits keep the length.
// Saving and deleting need internet: the window stays open with the error if they fail.
// The title can have several lines (Google keeps them); its box grows with it. PC: Enter in the
// title saves, Shift+Enter starts a new line. Phone (touch screen, no Shift): Enter starts a new
// line, the Add/Save button saves. Escape cancels.

const ALERTS: [number | null, string][] = [
  [0, 'At start'],
  [5, '5 minutes before'],
  [10, '10 minutes before'],
  [30, '30 minutes before'],
  [60, '1 hour before'],
  [1440, '1 day before'],
  [null, 'No alert'],
]

const REPEATS: [Repeat, string][] = [
  ['none', "Doesn't repeat"],
  ['DAILY', 'Every day'],
  ['WEEKLY', 'Every week'],
  ['MONTHLY', 'Every month'],
  ['YEARLY', 'Every year'],
]

// <input type="datetime-local"> works with local time as "2026-10-15T18:00"
function toInputValue(time: number) {
  const date = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// The day only ("2026-10-15"), for an all-day event
const toDayValue = (time: number) => toInputValue(time).slice(0, 10)

// A phone or tablet: Enter in the title starts a new line instead of saving
const touchScreen = matchMedia('(pointer: coarse)').matches

// New events start at the next full hour
function nextFullHour() {
  const date = new Date()
  date.setHours(date.getHours() + 1, 0, 0, 0)
  return date.getTime()
}

// The event's alert as one of the choices: its single alert, none, or 'keep' when it has
// several (or one that isn't in the list): then the choice "Keep current alerts" shows
function alertChoice(event: CalendarEvent | null): number | null | 'keep' {
  if (!event) return 0 // new events: at start (the user's habit)
  if (event.alerts.length === 0) return null
  if (event.alerts.length === 1 && ALERTS.some(([minutes]) => minutes === event.alerts[0])) return event.alerts[0]
  return 'keep'
}

function EventDialog(props: { event: CalendarEvent | null; onDelete: (event: CalendarEvent) => void; onClose: () => void }) {
  const { event, onClose } = props
  const allDay = event?.allDay ?? false // older all-day events stay all-day: date only, alerts kept
  const [title, setTitle] = useState(event?.title ?? '')
  const [when, setWhen] = useState(allDay ? toDayValue(event!.start) : toInputValue(event?.start ?? nextFullHour()))
  const [alert, setAlert] = useState(() => alertChoice(event))
  const [repeat, setRepeat] = useState<Repeat | SeriesRepeat>('none')
  // A repeating event: "All events in the series" ticked, and how the series repeats (loaded from
  // Google when ticked; null until then)
  const [wholeSeries, setWholeSeries] = useState(false)
  const [seriesRule, setSeriesRule] = useState<SeriesRepeat | null>(null)
  const [description, setDescription] = useState(event?.description ?? '')
  const [showNotes, setShowNotes] = useState(!!event?.description)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => titleRef.current?.focus(), [])

  // The title box grows with its text (one line when empty)
  useEffect(() => {
    const box = titleRef.current
    if (!box) return
    box.style.height = 'auto'
    box.style.height = `${box.scrollHeight + 2}px` // + the border
  }, [title])

  // Parsed as local time; NaN when the field is empty. "2026-10-15" alone would be read as UTC
  const start = new Date(allDay ? `${when}T00:00` : when).getTime()
  const loadingSeries = wholeSeries && seriesRule === null
  const canSave = title.trim() !== '' && !Number.isNaN(start) && !saving && !loadingSeries

  function toggleSeries(on: boolean) {
    setWholeSeries(on)
    if (!on || seriesRule !== null || !event) return
    loadSeriesRepeat(event)
      .then((rule) => {
        setSeriesRule(rule)
        setRepeat(rule)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        setWholeSeries(false)
      })
  }

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    const fields = { title: title.trim(), description: description.trim(), start, alert: allDay ? ('keep' as const) : alert }
    try {
      if (event && wholeSeries) await updateSeries(event, fields, repeat as SeriesRepeat)
      else if (event) await updateEvent(event, fields)
      else await createEvent(fields, repeat as Repeat)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog reminder-dialog event-dialog"
        role="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && e.target === titleRef.current && !e.shiftKey && !touchScreen) {
            e.preventDefault() // no new line
            save()
          }
        }}
      >
        <h2>{event ? 'Edit event' : 'New event'}</h2>
        <textarea
          ref={titleRef}
          className="event-title"
          rows={1}
          value={title}
          placeholder="Title"
          onChange={(e) => setTitle(e.target.value)}
        />
        <input type={allDay ? 'date' : 'datetime-local'} value={when} onChange={(e) => setWhen(e.target.value)} />
        <div className="event-options">
          {!allDay && (
            <label>
              <span>Alert</span>
              <select
                value={alert === null ? 'none' : String(alert)}
                onChange={(e) => setAlert(e.target.value === 'none' ? null : e.target.value === 'keep' ? 'keep' : Number(e.target.value))}
              >
                {alertChoice(event) === 'keep' && <option value="keep">Keep current alerts</option>}
                {ALERTS.map(([minutes, label]) => (
                  <option key={label} value={minutes === null ? 'none' : String(minutes)}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/* New events, or all events of a series (no "Doesn't repeat" there: to end a series,
              delete it). A rule SyncR can't show is kept as it is ("Custom") */}
          {(!event || wholeSeries) && (
            <label>
              <span>Repeat</span>
              <select
                value={loadingSeries ? 'loading' : repeat}
                disabled={loadingSeries}
                onChange={(e) => setRepeat(e.target.value as Repeat | SeriesRepeat)}
              >
                {loadingSeries && <option value="loading">Loading…</option>}
                {seriesRule === 'custom' && <option value="custom">Custom (kept as is)</option>}
                {REPEATS.filter(([value]) => !event || value !== 'none').map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {event?.seriesId && (
          <label className="dialog-check">
            <input type="checkbox" checked={wholeSeries} onChange={(e) => toggleSeries(e.target.checked)} />
            All events in the series
          </label>
        )}
        {showNotes ? (
          <textarea value={description} placeholder="Notes" rows={3} onChange={(e) => setDescription(e.target.value)} />
        ) : (
          <button className="event-add-notes" onClick={() => setShowNotes(true)}>
            + Add notes
          </button>
        )}
        {error && <p className="event-error">{error}</p>}
        <div className="dialog-buttons">
          {event && (
            <button className="danger event-delete" disabled={saving} onClick={() => props.onDelete(event)}>
              Delete
            </button>
          )}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!canSave} onClick={save}>
            {saving ? (
              <span className="loading-line">
                <Spinner size={13} /> Saving…
              </span>
            ) : event ? (
              'Save'
            ) : (
              'Add'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default EventDialog
