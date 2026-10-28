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
// Side panels slide in only when opened, not when the app starts with them open (index.css)
setTimeout(() => document.documentElement.classList.add('ready'), 1000)

// The sign-ins are decrypted first (on the PC: a few milliseconds), both windows read them
void loadSecrets().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>{isPopup ? <ReminderPopup /> : <App />}</StrictMode>,
  ),
)
