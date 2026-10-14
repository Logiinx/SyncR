import { useEffect, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'
import { finalSync } from './autoSync'
import { registerServiceWorker } from './pwa'
import { findUpdate, installUpdate } from './updater'

// Shows a bar at the top when a new version of SyncR is available.
// Desktop app: downloads and installs it. Phone / browser: reloads into the new version.
function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null)
  const [applyWebUpdate, setApplyWebUpdate] = useState<(() => void) | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    findUpdate().then(setUpdate)
    // A function in state must be wrapped, or React would call it
    registerServiceWorker((apply) => setApplyWebUpdate(() => apply))
  }, [])

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

  if (!update) return null

  async function onInstall() {
    setInstalling(true)
    try {
      await installUpdate(update!)
    } catch (error) {
      console.error('Update failed:', error)
      setInstalling(false)
    }
  }

  return (
    <div className="update-banner">
      SyncR {update.version} is available.
      <button onClick={onInstall} disabled={installing}>
        {installing ? 'Installing…' : 'Update now'}
      </button>
    </div>
  )
}

export default UpdateBanner
