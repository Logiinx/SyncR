import type { ReactNode } from 'react'

// A pop-up card's buttons as one flat bar across its bottom (mockup H of mail-popup-cards.html):
// icon + word, dim until hovered, the main one in blue, each as wide as its words; the last one
// can be a narrow icon at the right end (`end`): the email's trash (red under the mouse) or a
// video's ✕. Email cards and reader (MailCards.tsx, MailReader.tsx), video cards (VideoAlertCards.tsx).
// The bar of reminder and battery cards keeps a solid blue Done (`filled`, user 2026-11-22); a
// narrow icon can also start the bar (`end: 'back'`: the Postpone choices' way back).
export interface BarButton {
  label: string
  icon?: ReactNode
  after?: ReactNode
  title?: string
  onClick: () => void
  primary?: boolean
  filled?: boolean
  end?: 'delete' | 'close' | 'back'
}

export default function CardBar({ buttons }: { buttons: BarButton[] }) {
  return (
    <div className="card-bar">
      {buttons.map((button) =>
        button.end ? (
          <button
            key={button.label}
            className={`card-bar-end${button.end === 'delete' ? ' card-bar-delete' : ''}`}
            onClick={button.onClick}
            title={button.label}
            aria-label={button.label}
          >
            {button.icon}
          </button>
        ) : (
          <button
            key={button.label}
            className={button.filled ? 'filled' : button.primary ? 'primary' : undefined}
            onClick={button.onClick}
            title={button.title}
          >
            {button.icon}
            {button.label}
            {button.after}
          </button>
        ),
      )}
    </div>
  )
}

// The same buttons as icons at the end of a one-line row (older emails and videos in the pop-up,
// below the newest one's card), colored like the bar's, the words as tooltips
export function LineButtons({ buttons }: { buttons: BarButton[] }) {
  return buttons.map((button) => (
    <button
      key={button.label}
      className={`card-line-button${button.primary ? ' primary' : ''}${button.end === 'delete' ? ' delete' : ''}`}
      onClick={button.onClick}
      title={button.label}
      aria-label={button.label}
    >
      {button.icon}
    </button>
  ))
}
