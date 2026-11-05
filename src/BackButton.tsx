import { ChevronLeft } from 'lucide-react'
import { t } from './i18n'

// "‹ Back" (icon + word) wherever a view replaces another and can go back to it: the trailer
// view (back to the game), an open email (back to the list or the cards), a conflict copy's
// comparison (back to the note), the lock screen's passphrase step (back to the PIN).
function BackButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button type="button" className="back-button" onClick={onClick} title={title}>
      <ChevronLeft size={16} /> {t('Back')}
    </button>
  )
}

export default BackButton
