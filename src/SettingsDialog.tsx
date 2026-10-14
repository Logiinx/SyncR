import { useState } from 'react'
import { loadAppearance, saveAppearance, SCALE_MAX, SCALE_MIN } from './appearance'

// Settings for this device. Changes are saved right away; "Done" just closes.
function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [appearance, setAppearance] = useState(loadAppearance)

  // The slider shows the new value while dragging; the app is scaled when it's released
  // (scaling while dragging would move the slider away under the finger).
  const [scale, setScale] = useState(appearance.scale)
  function applyScale() {
    if (scale === appearance.scale) return
    const next = { ...appearance, scale }
    setAppearance(next)
    saveAppearance(next)
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog settings"
        role="dialog"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>Settings</h2>
        <p className="settings-note">These settings are for this device only.</p>

        <label className="setting">
          <span className="setting-label">
            App scaling <span className="setting-value">{scale} %</span>
          </span>
          <input
            type="range"
            min={SCALE_MIN}
            max={SCALE_MAX}
            step={5}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            onPointerUp={applyScale}
            onKeyUp={applyScale}
            onBlur={applyScale}
          />
        </label>

        <div className="dialog-buttons">
          <button className="primary" onClick={onClose} autoFocus>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsDialog
