import { useEffect, useState } from 'react'
import { loadRuleGroups } from './colorRules'
import ColorRulesDialog from './ColorRulesDialog'
import {
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONTS,
  loadAppearance,
  saveAppearance,
  SCALE_MAX,
  SCALE_MIN,
  type Appearance,
  type FontId,
} from './appearance'

// Settings for this device. Changes are saved right away; "Done" just closes.
function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [appearance, setAppearance] = useState(loadAppearance)
  function update(change: Partial<Appearance>) {
    // Start from the saved settings (always current), not from `appearance`, which may not
    // have caught up yet when two changes come quickly after each other
    const next = { ...loadAppearance(), ...change }
    setAppearance(next)
    saveAppearance(next)
  }

  // The slider shows the new value while dragging; the app is scaled when it's released
  // (scaling while dragging would move the slider away under the finger).
  const [scale, setScale] = useState(appearance.scale)
  function applyScale() {
    if (scale !== appearance.scale) update({ scale })
  }

  // Color rules open in their own window (more room); back here when it closes
  const [showRules, setShowRules] = useState(false)
  const [rulesSummary, setRulesSummary] = useState('')
  useEffect(() => {
    if (showRules) return
    loadRuleGroups().then((groups) => {
      const on = groups.filter((g) => g.enabled).flatMap((g) => g.rules.filter((r) => r.enabled && r.words.trim()))
      setRulesSummary(groups.length === 0 ? 'None yet' : `${on.length} on`)
    })
  }, [showRules])

  if (showRules) return <ColorRulesDialog onClose={() => setShowRules(false)} />

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
        <p className="settings-note">Font, text size, scaling and dates are for this device only.</p>

        <div className="setting">
          <span className="setting-label">Font</span>
          {/* Each choice is shown in its own font */}
          <div className="font-choices">
            {(Object.keys(FONTS) as FontId[]).map((id) => (
              <button
                key={id}
                className={id === appearance.font ? 'selected' : ''}
                style={{ fontFamily: FONTS[id].css }}
                aria-pressed={id === appearance.font}
                onClick={() => update({ font: id })}
              >
                {FONTS[id].name}
              </button>
            ))}
          </div>
        </div>

        {/* The note behind the dialog changes while dragging */}
        <label className="setting">
          <span className="setting-label">
            Text size <span className="setting-value">{appearance.fontSize} px</span>
          </span>
          <input
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={appearance.fontSize}
            onChange={(e) => update({ fontSize: Number(e.target.value) })}
          />
        </label>

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

        <label className="setting setting-toggle">
          <span>Show dates in the note list</span>
          <input
            type="checkbox"
            checked={appearance.showDates}
            onChange={(e) => update({ showDates: e.target.checked })}
          />
        </label>

        <div className="setting setting-toggle">
          <span>
            Color rules <span className="setting-value">{rulesSummary}</span>
          </span>
          <button className="setting-button" onClick={() => setShowRules(true)}>
            Edit…
          </button>
        </div>

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
