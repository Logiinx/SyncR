import { ChevronLeft } from 'lucide-react'

// "‹ Back" (icon + word) wherever a view replaces another and can go back to it: the trailer
// view (back to the game), an open email (back to the list or the cards).
function BackButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button className="back-button" onClick={onClick} title={title}>
      <ChevronLeft size={16} /> Back
    </button>
  )
}

export default BackButton
