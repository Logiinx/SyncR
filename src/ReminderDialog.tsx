import { useEffect, useRef, useState } from 'react'
import type { Reminder } from './db'
import { addReminder, addToGoogleCalendar, editReminder } from './reminders'

// <input type="datetime-local"> works with local time as "2026-10-15T18:00"
function toInputValue(time: number) {
  const date = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// New reminders start at the next full hour
function nextFullHour() {
  const date = new Date()
  date.setHours(date.getHours() + 1, 0, 0, 0)
  return date.getTime()
}

// Add (reminder = null) or edit a reminder. Enter in the text field saves, Escape cancels.
function ReminderDialog({ reminder, onClose }: { reminder: Reminder | null; onClose: () => void }) {
  const [text, setText] = useState(reminder?.text ?? '')
  const [due, setDue] = useState(toInputValue(reminder?.dueAt ?? nextFullHour()))
  const [note, setNote] = useState(reminder?.note ?? '')
  const [phone, setPhone] = useState(reminder?.phone ?? false)
  const textRef = useRef<HTMLInputElement>(null)

  useEffect(() => textRef.current?.focus(), [])

  const dueAt = new Date(due).getTime() // parsed as local time; NaN when the field is empty
  const canSave = text.trim() !== '' && !Number.isNaN(dueAt)

  // The Google Calendar event never follows changes made here (one-way link), so:
  // newly ticked, or already on the phone with a new text/time → open Calendar for this version
  const wasOnPhone = reminder?.phone ?? false
  const eventChanged = reminder !== null && (text.trim() !== reminder.text || dueAt !== reminder.dueAt)
  const opensCalendar = phone && (!wasOnPhone || eventChanged)
  let phoneHint = ''
  if (phone && !wasOnPhone) phoneHint = 'Saving opens Google Calendar: tap Save there.'
  else if (opensCalendar) phoneHint = 'Saving opens Google Calendar for the new version. Delete the old event there.'
  else if (wasOnPhone && !phone) phoneHint = 'The event stays in Google Calendar. Delete it there.'

  function save() {
    if (!canSave) return
    const fields = { text: text.trim(), note: note.trim(), dueAt, phone }
    // First, while still inside the click: browsers block new tabs opened later
    if (opensCalendar) addToGoogleCalendar(fields)
    if (reminder) {
      // Moving a done reminder to a new time makes it wait again
      const changes = reminder.doneAt !== null && dueAt !== reminder.dueAt ? { ...fields, doneAt: null } : fields
      editReminder(reminder.id, changes)
    } else addReminder(fields)
    onClose()
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog reminder-dialog"
        role="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && e.target === textRef.current) save()
        }}
      >
        <h2>{reminder ? 'Edit reminder' : 'New reminder'}</h2>
        <input ref={textRef} value={text} placeholder="Remind me to…" onChange={(e) => setText(e.target.value)} />
        <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        <textarea value={note} placeholder="Note (optional)" rows={3} onChange={(e) => setNote(e.target.value)} />
        <label className="reminder-phone">
          <input type="checkbox" checked={phone} onChange={(e) => setPhone(e.target.checked)} />
          Also on my phone (Google Calendar)
        </label>
        {phoneHint && <p className="reminder-phone-hint">{phoneHint}</p>}
        <div className="dialog-buttons">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!canSave} onClick={save}>
            {reminder ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ReminderDialog
