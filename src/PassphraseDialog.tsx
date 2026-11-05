import { useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { createPassphrase, hasPassphrase, MIN_PASSPHRASE_LENGTH, unlock } from './crypto'
import Window from './Window'
import Spinner from './Spinner'
import SecretField from './SecretField'

// Asks for the sync passphrase. First device: create it (typed twice). Other devices: enter it.
// Closing it without a passphrase is fine: sync just stays locked.
// note: why it's asked again (e.g. the PC's key was moved under Windows encryption, SyncButton)
function PassphraseDialog({ note, onClose }: { note?: string; onClose: () => void }) {
  const [mode, setMode] = useState<'loading' | 'create' | 'unlock'>('loading')
  const [passphrase, setPassphrase] = useState('')
  const [repeat, setRepeat] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    hasPassphrase()
      .then((exists) => setMode(exists ? 'unlock' : 'create'))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => {
    if (mode !== 'loading') inputRef.current?.focus()
  }, [mode])

  async function submit() {
    if (busy || mode === 'loading') return
    setError(null)
    if (mode === 'create') {
      if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        setError(t('Use at least {n} characters', { n: MIN_PASSPHRASE_LENGTH }))
        return
      }
      if (passphrase !== repeat) {
        setError(t('The two passphrases are different'))
        return
      }
    }
    setBusy(true)
    try {
      if (mode === 'create') await createPassphrase(passphrase)
      else if (!(await unlock(passphrase))) {
        setError(t('Wrong passphrase'))
        setBusy(false)
        inputRef.current?.select()
        return
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const type = visible ? 'text' : 'password'

  return (
    <Window
      className="dialog"
      label={t('Passphrase')}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <h2>{mode === 'create' ? t('Create a passphrase') : t('Enter your passphrase')}</h2>
      {mode === 'loading' && !error && (
        <p className="loading-line">
          <Spinner /> {t('Checking Dropbox…')}
        </p>
      )}
      {mode === 'create' && (
        <p>
          {t("Your notes are encrypted with it before they go to Dropbox. You'll enter it once on each device. If you forget it, the copies in Dropbox can't be read. Your notes on each device are still fine.")}
        </p>
      )}
      {mode === 'unlock' && <p>{note ?? t('The passphrase you created on your other device.')}</p>}

      {mode !== 'loading' && (
        <>
          <SecretField
            inputRef={inputRef}
            value={passphrase}
            placeholder={t('Passphrase')}
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            onChange={setPassphrase}
            visible={visible}
            onToggle={() => setVisible(!visible)}
          />
          {mode === 'create' && (
            <input
              type={type}
              value={repeat}
              placeholder={t('Repeat passphrase')}
              autoComplete="new-password"
              onChange={(e) => setRepeat(e.target.value)}
            />
          )}
        </>
      )}

      {error && <p className="dialog-error">{error}</p>}

      <div className="dialog-buttons">
        <button type="button" onClick={onClose}>
          {t('Not now')}
        </button>
        <button type="submit" className="primary" disabled={busy || mode === 'loading'}>
          {busy ? t('Working…') : mode === 'create' ? t('Create') : t('Unlock')}
        </button>
      </div>
    </Window>
  )
}

export default PassphraseDialog
