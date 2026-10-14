import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import type { Update } from '@tauri-apps/plugin-updater'
import { finalSync } from './autoSync'
import { checkWebUpdate, registerServiceWorker } from './pwa'
import { checkDesktopUpdate, findUpdate, installUpdate } from './updater'

// Asks the bar to check for a new version now (the "Check for updates" button in the sidebar)
export function checkForUpdates() {
  window.dispatchEvent(new Event('check-for-updates'))
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

// Shows a bar at the top when a new version of SyncR is available.
// Desktop app: downloads and installs it. Phone / browser: reloads into the new version.
// Also shows the result of "Check for updates" for a few seconds.
function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null)
  const [applyWebUpdate, setApplyWebUpdate] = useState<(() => void) | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    findUpdate().then(setUpdate)
    // A function in state must be wrapped, or React would call it
    registerServiceWorker((apply) => setApplyWebUpdate(() => apply))
  }, [])

  // "Check for updates"
  useEffect(() => {
    const onCheck = async () => {
      setNotice('Checking for updates…')
      try {
        if (isTauri()) {
          const found = await checkDesktopUpdate()
          if (found) {
            setUpdate(found)
            setNotice(null)
            return
          }
        } else if (await checkWebUpdate()) {
          // The bar with "Reload" appears once it's downloaded
          setNotice('Downloading the new version…')
          return
        }
        setNotice(`SyncR is up to date (v${__APP_VERSION__}).`)
      } catch (error) {
        setNotice(`Couldn't check for updates: ${errorText(error)}`)
      }
    }
    window.addEventListener('check-for-updates', onCheck)
    return () => window.removeEventListener('check-for-updates', onCheck)
  }, [])

  // Notices disappear after a few seconds (not "Checking…", which the result replaces)
  useEffect(() => {
    if (!notice || notice === 'Checking for updates…') return
    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  if (applyWebUpdate) {
    return (
      <div className="update-banner">
        A new version of SyncR is available.
        <button
          onClick={async () => {
            setInstalling(true)
            await finalSync() // max 5 s, then reload anyway
            applyWebUpdate()
          }}
          disabled={installing}
        >
          {installing ? 'Reloading…' : 'Reload'}
        </button>
      </div>
    )
  }

  if (update) {
    const onInstall = async () => {
      setInstalling(true)
      setInstallError(null)
      try {
        await installUpdate(update)
      } catch (error) {
        console.error('Update failed:', error)
        setInstallError(errorText(error))
        setInstalling(false)
      }
    }

    return (
      <div className="update-banner">
        {installError ? `Update failed: ${installError}` : `SyncR ${update.version} is available.`}
        <button onClick={onInstall} disabled={installing}>
          {installing ? 'Installing…' : installError ? 'Try again' : 'Update now'}
        </button>
      </div>
    )
  }

  if (notice) return <div className="update-banner">{notice}</div>
  return null
}

export default UpdateBanner
