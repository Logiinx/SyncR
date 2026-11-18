import { t } from './i18n'
import Spinner from './Spinner'

// A window's main (blue) button. While it works: grayed, a small spinner + what it's doing
// ("Saving…", "Unlocking…"), the same in every window. Without onClick it submits its form.
export default function SubmitButton({ busy, disabled, label, busyLabel, onClick }: {
  busy: boolean
  disabled?: boolean
  label: string
  busyLabel?: string // default "Saving…"
  onClick?: () => void
}) {
  return (
    <button type={onClick ? 'button' : 'submit'} className="primary" disabled={busy || disabled} onClick={onClick}>
      {busy ? (
        <span className="loading-line">
          <Spinner size={13} /> {busyLabel ?? t('Saving…')}
        </span>
      ) : (
        label
      )}
    </button>
  )
}
