import { useRef } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useBack } from './backStack'
import { t } from './i18n'

// "‹ Back" (icon + word) wherever a view replaces another and can go back to it: the trailer
// view (back to the game), an open email (back to the list or the cards), a conflict copy's
// comparison (back to the note), the lock screen's passphrase step (back to the PIN).
// Back (phone gesture, mouse button) does the same (backStack.ts), before closing the window it's in.
function BackButton({ onClick, title }: { onClick: () => void; title: string }) {
  const button = useRef<HTMLButtonElement>(null)
  useBack(onClick, true, button)
  return (
    <button ref={button} type="button" className="back-button" onClick={onClick} title={title}>
      <ChevronLeft size={16} /> {t('Back')}
    </button>
  )
}

export default BackButton
