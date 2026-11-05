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
import { prepareLocalDb, receiveLocalKey } from './localDb'
import KeyMissing from './KeyMissing'
import LockScreen from './LockScreen'
import { followLanguageChoice, startTrayTexts } from './language'

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
if (!isPopup) startTrayTexts()
// The sign-ins are decrypted first, both windows read them. On the PC that can take a moment
// at start (Windows), so the side panels' second without animation counts from the first draw.
// Then the PC's local database gets its key, or is moved into the encrypted one (localDb.ts).
// PIN lock on: the lock screen first, the app in its place once unlocked (LockScreen.tsx).
// The pop-up gets the key from the main window instead (PIN lock on, receiveLocalKey).
void loadSecrets().then(() => prepareLocalDb(isPopup)).then(async (state) => {
  if (state === 'moved') return location.reload() // opens the new database
  if (state === 'key-missing' && isPopup) return
  if (state === 'locked' && isPopup) {
    await receiveLocalKey()
    state = 'ready'
  }
  const root = createRoot(document.getElementById('root')!)
  // Side panels slide in only when opened, not when the app starts with them open (useSlideIn)
  const ready = () => setTimeout(() => document.documentElement.classList.add('ready'), 1000)
  const showApp = () => {
    followLanguageChoice()
    root.render(<StrictMode><App /></StrictMode>)
    ready()
  }
  if (state === 'locked') root.render(<StrictMode><LockScreen onUnlocked={showApp} /></StrictMode>)
  else if (state === 'key-missing') root.render(<StrictMode><KeyMissing /></StrictMode>)
  else if (isPopup) {
    followLanguageChoice()
    root.render(<StrictMode><ReminderPopup /></StrictMode>)
  }
  if (state === 'ready' && !isPopup) showApp()
  else if (state !== 'locked') ready()
})
