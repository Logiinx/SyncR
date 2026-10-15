import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronDown, ChevronRight, Plus, Smartphone } from 'lucide-react'
import ContextMenu from './ContextMenu'
import Dialog, { type DialogRequest } from './Dialog'
import ReminderDialog from './ReminderDialog'
import type { Reminder } from './db'
import { useLocalState } from './localState'
import { addToGoogleCalendar, clearDone, deleteReminder, formatDue, listReminders, markDone, markNotDone } from './reminders'

// The reminders list at the bottom of the sidebar: waiting reminders (soonest first), then a
// collapsed "Done" group. Click = edit, right-click = menu. Open/closed is remembered per device.
function RemindersSection() {
  // Re-runs whenever a reminder changes (also from sync)
  const reminders = useLiveQuery(listReminders, [])
  const [open, setOpen] = useLocalState('syncr.remindersOpen', true)
  const [doneOpen, setDoneOpen] = useLocalState('syncr.remindersDoneOpen', false)
  const [editing, setEditing] = useState<Reminder | 'new' | null>(null)
  const [menu, setMenu] = useState<{ reminder: Reminder; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<DialogRequest | null>(null)

  // Redraw every 30 s, so "overdue" and "Today" stay correct
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const waiting = reminders?.filter((r) => r.doneAt === null) ?? []
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

  function askClearDone() {
    setDialog({
      title: 'Clear done reminders?',
      message: `${done.length} done reminder${done.length === 1 ? '' : 's'} will be deleted. This can't be undone.`,
      confirmLabel: 'Clear',
      danger: true,
      onConfirm: () => clearDone(),
    })
  }

  const item = (reminder: Reminder) => (
    <li key={reminder.id}>
      <button
        className={reminder.doneAt === null && reminder.dueAt <= now ? 'overdue' : ''}
        title={reminder.note || undefined}
        onClick={() => setEditing(reminder)}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ reminder, x: e.clientX, y: e.clientY })
        }}
      >
        <span className="reminder-text">{reminder.text}</span>
        <span className="reminder-due">
          {formatDue(reminder.dueAt)}
          {reminder.phone && <Smartphone size={11} aria-label="Also in Google Calendar" />}
        </span>
      </button>
    </li>
  )

  return (
    <section className="reminders">
      <div className="reminders-header">
        <button className="reminders-toggle" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Reminders{waiting.length > 0 && <span className="reminders-count">{waiting.length}</span>}
        </button>
        <button className="reminders-add" title="New reminder" onClick={() => setEditing('new')}>
          <Plus size={15} />
        </button>
      </div>

      {open && (
        <div className="reminders-body">
          <ul className="reminder-list">{waiting.map(item)}</ul>
          {done.length > 0 && (
            <>
              <div className="reminders-header">
                <button className="reminders-toggle done-toggle" onClick={() => setDoneOpen(!doneOpen)}>
                  {doneOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  Done ({done.length})
                </button>
                <button className="reminders-clear" onClick={askClearDone}>
                  Clear
                </button>
              </div>
              {doneOpen && <ul className="reminder-list done">{done.map(item)}</ul>}
            </>
          )}
        </div>
      )}

      {editing && <ReminderDialog reminder={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
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
    </section>
  )
}

export default RemindersSection
