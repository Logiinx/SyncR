import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { loadRuleGroups, saveRuleGroups, type ColorRule, type RuleGroup } from './colorRules'
import { COLORS } from './ColorPicker'
import CloseButton from './CloseButton'

const newRule = (): ColorRule => ({ id: crypto.randomUUID(), words: '', color: 'red', enabled: true })

// Edit the color rules (colorRules.ts). Every change is saved right away; ✕ just closes.
function ColorRulesDialog({ onClose }: { onClose: () => void }) {
  const [groups, setGroups] = useState<RuleGroup[] | null>(null)
  const [colorsFor, setColorsFor] = useState<string | null>(null) // rule whose palette is open
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null) // group id
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadRuleGroups().then(setGroups)
    dialogRef.current?.focus({ preventScroll: true }) // so Escape works
  }, [])

  function update(next: RuleGroup[]) {
    setGroups(next)
    saveRuleGroups(next)
  }
  const updateGroup = (id: string, change: Partial<RuleGroup>) =>
    update(groups!.map((g) => (g.id === id ? { ...g, ...change } : g)))
  const updateRule = (group: RuleGroup, id: string, change: Partial<ColorRule>) =>
    updateGroup(group.id, { rules: group.rules.map((r) => (r.id === id ? { ...r, ...change } : r)) })

  function addGroup() {
    update([...groups!, { id: crypto.randomUUID(), name: '', enabled: true, rules: [newRule()] }])
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog color-rules"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-label="Color rules"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="dialog-head">
          <h2>Color rules</h2>
          <CloseButton onClick={onClose} />
        </div>
        <p className="settings-note">
          Words in your notes get these colors automatically (whole words, any case). Separate several words with
          commas. Switch a group off when you don't need it.
        </p>

        {groups?.map((group) => (
          <section key={group.id} className={group.enabled ? 'rule-group' : 'rule-group off'}>
            <div className="rule-group-head">
              <input
                type="checkbox"
                checked={group.enabled}
                onChange={(e) => updateGroup(group.id, { enabled: e.target.checked })}
                aria-label="Group on"
                title={group.enabled ? 'Switch this group off' : 'Switch this group on'}
              />
              <input
                className="rule-group-name"
                value={group.name}
                placeholder="Group name (e.g. a game)"
                onChange={(e) => updateGroup(group.id, { name: e.target.value })}
              />
              <button
                className={confirmDelete === group.id ? 'icon-button danger confirm' : 'icon-button'}
                onClick={() => {
                  if (confirmDelete !== group.id && group.rules.some((r) => r.words.trim())) {
                    setConfirmDelete(group.id) // a second click deletes
                    return
                  }
                  update(groups.filter((g) => g.id !== group.id))
                }}
                onBlur={() => setConfirmDelete(null)}
                title="Delete group"
                aria-label="Delete group"
              >
                {confirmDelete === group.id ? 'Delete?' : <Trash2 size={15} />}
              </button>
            </div>

            {group.rules.map((rule) => (
              <div key={rule.id} className={rule.enabled ? 'rule' : 'rule off'}>
                <div className="rule-row">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => updateRule(group, rule.id, { enabled: e.target.checked })}
                    aria-label="Rule on"
                  />
                  <input
                    className="rule-words"
                    value={rule.words}
                    placeholder="Fire, Flame"
                    style={{ color: `var(--text-${rule.color})` }}
                    onChange={(e) => updateRule(group, rule.id, { words: e.target.value })}
                  />
                  <button
                    className="rule-color"
                    style={{ background: `var(--text-${rule.color})` }}
                    onClick={() => setColorsFor(colorsFor === rule.id ? null : rule.id)}
                    title="Color"
                    aria-label="Color"
                  />
                  <button
                    className="icon-button"
                    onClick={() => updateGroup(group.id, { rules: group.rules.filter((r) => r.id !== rule.id) })}
                    title="Delete rule"
                    aria-label="Delete rule"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                {colorsFor === rule.id && (
                  <div className="rule-palette">
                    {COLORS.map(({ id, name }) => (
                      <button
                        key={id}
                        className={id === rule.color ? 'rule-color selected' : 'rule-color'}
                        style={{ background: `var(--text-${id})` }}
                        onClick={() => {
                          updateRule(group, rule.id, { color: id })
                          setColorsFor(null)
                        }}
                        title={name}
                        aria-label={name}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
            <button className="add-button" onClick={() => updateGroup(group.id, { rules: [...group.rules, newRule()] })}>
              + Add rule
            </button>
          </section>
        ))}

        {groups && (
          <button className="add-button" onClick={addGroup}>
            + New group
          </button>
        )}
      </div>
    </div>
  )
}

export default ColorRulesDialog
