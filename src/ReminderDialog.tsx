import { useEffect, useRef, useState } from 'react'
import type { Reminder } from './db'
import { addReminder, editReminder } from './reminders'

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
  const textRef = useRef<HTMLInputElement>(null)

  useEffect(() => textRef.current?.focus(), [])

  const dueAt = new Date(due).getTime() // parsed as local time; NaN when the field is empty
  const canSave = text.trim() !== '' && !Number.isNaN(dueAt)

  function save() {
    if (!canSave) return
    const fields = { text: text.trim(), note: note.trim(), dueAt, phone: reminder?.phone ?? false }
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
