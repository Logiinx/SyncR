import type { ReactNode } from 'react'

// A pop-up card's buttons as one flat bar across its bottom (mockup H of mail-popup-cards.html):
// icon + word, dim until hovered, the main one in blue, each as wide as its words; the last one
// can be a narrow icon at the right end (`end`): the email's trash (red under the mouse) or a
// video's ✕. Email cards and reader (MailCards.tsx, MailReader.tsx), video cards (VideoAlertCards.tsx).
export interface BarButton {
  label: string
  icon: ReactNode
  onClick: () => void
  primary?: boolean
  end?: 'delete' | 'close'
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
          <button key={button.label} className={button.primary ? 'primary' : undefined} onClick={button.onClick}>
            {button.icon}
            {button.label}
          </button>
        ),
      )}
    </div>
  )
}
