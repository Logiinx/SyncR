import { useEffect, useRef, useState } from 'react'
import { plural, t, useLanguage } from './i18n'
import { KeyRound, Lock, LockOpen } from 'lucide-react'
import WindowControls from './WindowControls'
import SecretField from './SecretField'
import BackButton from './BackButton'
import { openWithKey } from './localDb'
import { changePin, MAX_TRIES, MIN_PIN_LENGTH, turnPinOff, unlockWithPassphrase, unlockWithPin, wrongTries } from './pinLock'

// Shown instead of the app while the PIN lock is on and SyncR isn't unlocked yet (pinLock.ts).
// An empty page on purpose: nothing about the notes shows, not even the tabs. Only the window
// buttons, which also show the window at start (or keep it in the tray) like the app's.
// PIN → app. Forgot it, or MAX_TRIES wrong ones → passphrase → a new PIN (or the lock off) → app.
// No way back if both are forgotten: sync needs the passphrase too (the phone keeps the notes).

type Step = 'pin' | 'passphrase' | 'new-pin'

function LockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  useLanguage()
  const [step, setStep] = useState<Step>(wrongTries() >= MAX_TRIES ? 'passphrase' : 'pin')
  const [value, setValue] = useState('')
  const [repeat, setRepeat] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pinsLeft = MAX_TRIES - wrongTries()

  // Ready to type at each step, and when the window is brought back from the tray
  useEffect(() => inputRef.current?.focus(), [step])
  useEffect(() => {
    const focus = () => inputRef.current?.focus()
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [])

  function go(next: Step) {
    setStep(next)
    setValue('')
    setRepeat('')
    setVisible(false)
    setError(null)
  }

  function wrong(message: string) {
    setBusy(false)
    setValue('')
    setError(message)
    inputRef.current?.focus()
  }

  async function submit() {
    if (busy) return
    setError(null)
    if (step === 'new-pin') {
      if (value.length < MIN_PIN_LENGTH) return setError(t('Use at least {n} characters', { n: MIN_PIN_LENGTH }))
      if (value !== repeat) return setError(t('The two PINs are different'))
    } else if (!value) return
    setBusy(true)
    try {
      if (step === 'new-pin') {
        await changePin(value)
        return onUnlocked()
      }
      const key = step === 'pin' ? await unlockWithPin(value) : await unlockWithPassphrase(value)
      if (!key && step === 'passphrase') return wrong(t('Wrong passphrase'))
      if (!key) {
        const left = MAX_TRIES - wrongTries()
        if (left > 0) return wrong(plural(left, 'Wrong PIN · {n} try left', 'Wrong PIN · {n} tries left'))
        setBusy(false)
        return go('passphrase')
      }
      openWithKey(key, false)
      setBusy(false)
      if (step === 'passphrase') go('new-pin')
      else onUnlocked()
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function lockOff() {
    if (busy) return
    setBusy(true)
    try {
      await turnPinOff()
      onUnlocked()
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const toggle = () => setVisible(!visible)

  return (
    <div className="lock-screen">
      <header className="lock-screen-bar" data-tauri-drag-region>
        <WindowControls />
      </header>
      <div className="lock-screen-body" data-tauri-drag-region>
        <form
          className="dialog lock-card"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {step === 'pin' && (
            <>
              <Lock className="lock-icon" size={22} strokeWidth={1.5} />
              <h2>{t('SyncR is locked')}</h2>
              <p>{t('Enter your PIN to open your notes.')}</p>
              <SecretField inputRef={inputRef} value={value} onChange={setValue} placeholder={t('PIN')} autoComplete="current-password" visible={visible} onToggle={toggle} />
            </>
          )}
          {step === 'passphrase' && (
            <>
              <KeyRound className="lock-icon" size={22} strokeWidth={1.5} />
              <h2>{t('Enter your passphrase')}</h2>
              <p>{pinsLeft > 0 ? t('Your sync passphrase opens your notes too.') : t('Too many wrong PINs. Your sync passphrase opens your notes.')}</p>
              <SecretField inputRef={inputRef} value={value} onChange={setValue} placeholder={t('Passphrase')} autoComplete="current-password" visible={visible} onToggle={toggle} />
            </>
          )}
          {step === 'new-pin' && (
            <>
              <LockOpen className="lock-icon open" size={22} strokeWidth={1.5} />
              <h2>{t('Choose a new PIN')}</h2>
              <p>{t('At least {n} characters, digits or letters.', { n: MIN_PIN_LENGTH })}</p>
              <SecretField inputRef={inputRef} value={value} onChange={setValue} placeholder={t('New PIN')} autoComplete="new-password" visible={visible} onToggle={toggle} />
              <input
                type={visible ? 'text' : 'password'}
                value={repeat}
                placeholder={t('Repeat PIN')}
                autoComplete="new-password"
                spellCheck={false}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </>
          )}

          {error && <p className="dialog-error">{error}</p>}

          <div className="dialog-buttons">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? (step === 'new-pin' ? t('Saving…') : t('Unlocking…')) : step === 'new-pin' ? t('Save PIN') : t('Unlock')}
            </button>
          </div>

          {step === 'pin' && (
            <button type="button" className="lock-link" onClick={() => go('passphrase')}>
              {t('Forgot your PIN?')}
            </button>
          )}
          {step === 'passphrase' && pinsLeft > 0 && (
            <BackButton onClick={() => go('pin')} title={t('Back to PIN')} />
          )}
          {step === 'new-pin' && (
            <button type="button" className="lock-link" onClick={() => void lockOff()}>
              {t('Turn the PIN lock off instead')}
            </button>
          )}
        </form>
      </div>
    </div>
  )
}

export default LockScreen
