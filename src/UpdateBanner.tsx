import { useEffect, useState } from 'react'
import type { Update } from '@tauri-apps/plugin-updater'
import { findUpdate, installUpdate } from './updater'

// Shows a bar at the top when a new version of SyncR is available.
function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    findUpdate().then(setUpdate)
  }, [])

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
