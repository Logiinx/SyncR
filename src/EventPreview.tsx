import { useEffect, useRef } from 'react'
import { plural, t } from './i18n'
import { Bell, Repeat } from 'lucide-react'
import type { CalendarEvent } from './db'
import { clockTime, fullDate } from './dates'
import Window from './Window'
import CloseButton from './CloseButton'
import { alertsOf, allDayAlertText, useAllDayAlert } from './eventAlerts'

// A calendar event, shown big (left click on an event in the Reminders tab): the whole title
// with its line breaks, the day and time written out, the alert, whether it repeats, the notes.
// Edit opens the event window (EventDialog.tsx); Delete asks first (RemindersView.tsx).
// ✕, Escape or clicking outside closes it, Enter edits.

// "At start", "10 minutes before", "1 hour before", "2 days before"; an all-day event: "On the day at
// 09:00" (allDayAlertText)
function alertText(minutes: number, allDay: boolean) {
  if (allDay) return allDayAlertText(minutes)
  if (minutes === 0) return t('At start')
  if (minutes % 1440 === 0) return plural(minutes / 1440, '{n} day before', '{n} days before')
  if (minutes % 60 === 0) return plural(minutes / 60, '{n} hour before', '{n} hours before')
  return plural(minutes, '{n} minute before', '{n} minutes before')
}

// "Tuesday 27 October 2026, 04:00" (an all-day event: without the time)
function whenText(event: CalendarEvent) {
  const day = fullDate(event.start)
  if (event.allDay) return day
  return `${day}, ${clockTime(event.start)}`
}

function EventPreview(props: {
  event: CalendarEvent
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const { event, onClose } = props
  const alerts = alertsOf(event, useAllDayAlert())
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
        {alerts.length === 0 ? t('No alert') : alerts.map((minutes) => alertText(minutes, event.allDay)).join(', ')}
      </p>
      {event.seriesId && (
        <p className="event-preview-info">
          <Repeat size={14} />
          {t('Repeating event')}
        </p>
      )}
      {event.description && <p className="event-preview-notes">{event.description}</p>}
      <div className="dialog-buttons">
        <button className="danger event-delete" onClick={props.onDelete}>
          {t('Delete')}
        </button>
        <button ref={editRef} className="primary" onClick={props.onEdit}>
          {t('Edit')}
        </button>
      </div>
    </Window>
  )
}

export default EventPreview
