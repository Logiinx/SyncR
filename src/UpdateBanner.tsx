import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { Check, CircleArrowDown, TriangleAlert } from 'lucide-react'
import type { Update } from '@tauri-apps/plugin-updater'
import { finalSync } from './autoSync'
import { checkWebUpdate, registerServiceWorker } from './pwa'
import { checkDesktopUpdate, findUpdate, installUpdate } from './updater'
import Spinner from './Spinner'
import { updateRelease, WhatsNewDialog } from './WhatsNew'

// Asks the bar to check for a new version now (the update icon in the sidebar). Resolves once
// the check is done (the icon spins until then).
export function checkForUpdates(): Promise<void> {
  return new Promise((done) => window.dispatchEvent(new CustomEvent('check-for-updates', { detail: done })))
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

// Shows a slim bar at the top when a new version of SyncR is available.
// Desktop app: downloads and installs it (with the download's progress). Phone / browser:
// reloads into the new version. Also shows the result of "Check for updates" for a few
// seconds, as a small gray line.
function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null)
  const [applyWebUpdate, setApplyWebUpdate] = useState<(() => void) | null>(null)
  const [installing, setInstalling] = useState(false)
  // The downloaded part (0 to 1); null = downloading, size unknown; undefined = not yet
  const [progress, setProgress] = useState<number | null | undefined>(undefined)
  const [installError, setInstallError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(false)

  useEffect(() => {
    findUpdate().then(setUpdate)
    // A function in state must be wrapped, or React would call it
    registerServiceWorker((apply) => setApplyWebUpdate(() => apply))
  }, [])

  // "Check for updates"
  useEffect(() => {
    const onCheck = async (event: Event) => {
      const done = (event as CustomEvent<() => void>).detail
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
      } finally {
        done?.()
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
        {installing ? <Spinner /> : <CircleArrowDown size={16} className="update-icon" />}
        <span className="update-text">{installing ? 'Reloading…' : 'A new version of SyncR is ready.'}</span>
        {!installing && (
          <button
            className="update-button"
            onClick={async () => {
              setInstalling(true)
              await finalSync() // max 5 s, then reload anyway
              applyWebUpdate()
            }}
          >
            Reload
          </button>
        )}
      </div>
    )
  }

  if (update) {
    const onInstall = async () => {
      setInstalling(true)
      setInstallError(null)
      setProgress(undefined)
      try {
        await installUpdate(update, setProgress)
      } catch (error) {
        console.error('Update failed:', error)
        setInstallError(errorText(error))
        setInstalling(false)
      }
    }

    // While installing: first the last sync, then the download, then the installer
    const version = `SyncR ${update.version}`
    const status =
      progress === undefined
        ? 'Syncing before the update…'
        : progress === 1
          ? `Installing ${version}…`
          : `Downloading ${version}…`

    return (
      <div className={installError ? 'update-banner failed' : 'update-banner'}>
        {installing ? (
          <Spinner />
        ) : installError ? (
          <TriangleAlert size={16} className="update-icon" />
        ) : (
          <CircleArrowDown size={16} className="update-icon" />
        )}
        <span className="update-text">
          {installing ? (
            <>
              {status}
              {typeof progress === 'number' && progress < 1 && (
                <span className="update-dim"> {Math.round(progress * 100)}%</span>
              )}
            </>
          ) : installError ? (
            `Update failed: ${installError}`
          ) : (
            <>
              <b>{version}</b> is ready.
              {update.body?.trim() && (
                <>
                  <span className="update-dim"> · </span>
                  <button className="update-link" onClick={() => setNotesOpen(true)}>
                    What's new
                  </button>
                </>
              )}
            </>
          )}
        </span>
        {!installing && (
          <button className="update-button" onClick={onInstall}>
            {installError ? 'Try again' : 'Update now'}
          </button>
        )}
        {installing && typeof progress === 'number' && (
          <div className="update-progress" style={{ width: `${progress * 100}%` }} />
        )}
        {notesOpen && (
          <WhatsNewDialog
            releases={[updateRelease(update.version, update.body ?? '')]}
            version={update.version}
            onUpdate={() => {
              setNotesOpen(false)
              onInstall()
            }}
            onClose={() => setNotesOpen(false)}
          />
        )}
      </div>
    )
  }

  if (notice) {
    return (
      <div className="update-notice">
        {LOADING_NOTICES.includes(notice) ? (
          <Spinner size={13} />
        ) : notice.startsWith("Couldn't") ? (
          <TriangleAlert size={13} className="update-notice-error" />
        ) : (
          <Check size={13} className="update-notice-ok" />
        )}
        {notice}
      </div>
    )
  }
  return null
}

// Notices that mean "wait": shown with the loading ring
const LOADING_NOTICES = ['Checking for updates…', 'Downloading the new version…']

export default UpdateBanner
