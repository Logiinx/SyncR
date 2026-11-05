import { X } from 'lucide-react'
import { t } from './i18n'

// The ✕ at the top right of every window that only shows things (game window, preview, Settings,
// What's new…). Windows that ask something keep their buttons instead (Cancel, Delete…).
function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="close-button" onClick={onClick} title={t('Close')}>
      <X size={18} />
    </button>
  )
}

export default CloseButton
