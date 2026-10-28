import { useEffect, useRef } from 'react'
import { Bell, Repeat } from 'lucide-react'
import type { CalendarEvent } from './db'
import Window from './Window'
import CloseButton from './CloseButton'

// A calendar event, shown big (left click on an event in the Reminders tab): the whole title
// with its line breaks, the day and time written out, the alert, whether it repeats, the notes.
// Edit opens the event window (EventDialog.tsx); Delete asks first (RemindersView.tsx).
// ✕, Escape or clicking outside closes it, Enter edits.

// "At start", "10 minutes before", "1 hour before", "2 days before"
function alertText(minutes: number) {
  if (minutes === 0) return 'At start'
  const [count, unit] =
    minutes % 1440 === 0 ? [minutes / 1440, 'day'] : minutes % 60 === 0 ? [minutes / 60, 'hour'] : [minutes, 'minute']
  return `${count} ${unit}${count === 1 ? '' : 's'} before`
}

// "Tuesday 27 October 2026, 04:00" (an all-day event: without the time)
function whenText(event: CalendarEvent) {
  const date = new Date(event.start)
  const day = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  if (event.allDay) return day
  return `${day}, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

function EventPreview(props: {
  event: CalendarEvent
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const { event, onClose } = props
  const editRef = useRef<HTMLButtonElement>(null)

  useEffect(() => editRef.current?.focus(), []) // so Enter edits

  return (
    <Window className="dialog event-preview" label={event.title} onClose={onClose}>
      <div className="dialog-head">
        <h2 className="event-preview-title">{event.title}</h2>
        <CloseButton onClick={onClose} />
      </div>
      <p className="event-preview-when">{whenText(event)}</p>
      <p className="event-preview-info">
        <Bell size={14} />
        {event.alerts.length === 0 ? 'No alert' : event.alerts.map(alertText).join(', ')}
      </p>
      {event.seriesId && (
        <p className="event-preview-info">
          <Repeat size={14} />
          Repeating event
        </p>
      )}
      {event.description && <p className="event-preview-notes">{event.description}</p>}
      <div className="dialog-buttons">
        <button className="danger event-delete" onClick={props.onDelete}>
          Delete
        </button>
        <button ref={editRef} className="primary" onClick={props.onEdit}>
          Edit
        </button>
      </div>
    </Window>
  )
}

export default EventPreview
