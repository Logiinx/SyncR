import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import App from './App.tsx'
import { applyAppearance, loadAppearance } from './appearance'
import { isPopupPage } from './popupWindow'
import ReminderPopup from './ReminderPopup'
import { setUpScrollbars } from './scrollbars'
import { setUpBoardTab } from './boardTab'
import { startClosingAnimations } from './animations'
import { loadSecrets } from './secrets'
import { prepareLocalDb } from './localDb'
import KeyMissing from './KeyMissing'

// The desktop reminder pop-up window loads this same page (popupWindow.ts)
const isPopup = isPopupPage()

// Before the first paint, so the app never shows at the wrong size.
// Not in the pop-up: it measures itself in plain pixels to size its window.
if (!isPopup) applyAppearance(loadAppearance())
else document.documentElement.classList.add('popup-page')
setUpScrollbars()
setUpBoardTab()
// Not in the pop-up: it sizes its window from its cards, a closing one would still count
if (!isPopup) startClosingAnimations()
// The sign-ins are decrypted first, both windows read them. On the PC that can take a moment
// at start (Windows), so the side panels' second without animation counts from the first draw.
// Then the PC's local database gets its key, or is moved into the encrypted one (localDb.ts).
void loadSecrets().then(() => prepareLocalDb(isPopup)).then((state) => {
  if (state === 'moved') return location.reload() // opens the new database
  if ((state === 'key-missing' || state === 'locked') && isPopup) return
  if (state === 'locked') return // the lock screen comes next (PIN lock, step 2)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>{state === 'key-missing' ? <KeyMissing /> : isPopup ? <ReminderPopup /> : <App />}</StrictMode>,
  )
  // Side panels slide in only when opened, not when the app starts with them open (useSlideIn)
  setTimeout(() => document.documentElement.classList.add('ready'), 1000)
})
