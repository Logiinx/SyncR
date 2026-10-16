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

// The desktop reminder pop-up window loads this same page (popupWindow.ts)
const isPopup = isPopupPage()

// Before the first paint, so the app never shows at the wrong size.
// Not in the pop-up: it measures itself in plain pixels to size its window.
if (!isPopup) applyAppearance(loadAppearance())
else document.documentElement.classList.add('popup-page')
setUpScrollbars()
setUpBoardTab()

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isPopup ? <ReminderPopup /> : <App />}</StrictMode>,
)
