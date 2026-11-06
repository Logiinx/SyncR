import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import CloseButton from './CloseButton'
import Dialog from './Dialog'
import InfoTip from './InfoTip'
import Spinner from './Spinner'
import VideoLogo from './VideoLogo'
import Window from './Window'
import { type VideoFollow } from './db'
import { t } from './i18n'
import { addFollow, addVideo, findChannel, looksLikeYouTube, minuteCount, removeFollow, tidyChannelLink, updateFollow, useFollows, wordList, type PastChoice } from './video'

// Add a follow, or change one: which channel (only when adding), which of its videos count, and
// (only when adding) how far back to start.
export function FollowDialog({ follow, onClose }: { follow?: VideoFollow; onClose: () => void }) {
  // Each label names its input: without that it takes the first thing it can inside it, the ⓘ
  // button, which then lights up when the mouse is anywhere on the field and opens on its click
  const fieldId = useId()
  const [link, setLink] = useState('')
  const [only, setOnly] = useState(follow?.onlyWords.join(', ') ?? '')
  const [except, setExcept] = useState(follow?.exceptWords.join(', ') ?? '')
  const [minutes, setMinutes] = useState(follow?.minMinutes ? String(follow.minMinutes) : '')
  const [hideShorts, setHideShorts] = useState(follow?.hideShorts ?? true)
  const [past, setPast] = useState<PastChoice>('today')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const youtube = follow ? follow.platform === 'youtube' : looksLikeYouTube(link)
  const title = follow ? t('Edit follow') : t('Add a follow')

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || (!follow && !link.trim())) return
    setBusy(true)
    setError('')
    const settings = { onlyWords: wordList(only), exceptWords: wordList(except), minMinutes: minuteCount(minutes), hideShorts }
    try {
      if (follow) await updateFollow(follow.id, settings)
      else await addFollow(await findChannel(link), settings, past)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Window className="dialog video-follow-dialog" label={title} onClose={onClose} onSubmit={save}>
      <h2>{title}</h2>
      {follow ? (
        <p className="video-follow-channel" title={follow.name}>{follow.name}</p>
      ) : (
        <label className="video-field">
          {t('Channel link')}
          <input
            autoFocus
            value={link}
            placeholder={t('name for Twitch, @name for YouTube, or a link')}
            onChange={(e) => setLink(e.target.value)}
            onBlur={() => setLink(tidyChannelLink)}
            onPaste={(e) => {
              if (link) return // Pasted in the middle of what's there: tidied when leaving the field
              e.preventDefault()
              setLink(tidyChannelLink(e.clipboardData.getData('text')))
            }}
          />
        </label>
      )}
      <label className="video-field" htmlFor={`${fieldId}-only`}>
        <span className="video-field-name">
          {t('Only titles with')}
          <InfoTip label={t('Only titles with')}>
            {t('Keeps a video if its title has one of these words. Separate them with commas. Capitals and accents don’t matter. Empty: all titles.')}
          </InfoTip>
        </span>
        <input id={`${fieldId}-only`} autoFocus={!!follow} value={only} placeholder={t('hotline, talk show')} onChange={(e) => setOnly(e.target.value)} />
      </label>
      <label className="video-field" htmlFor={`${fieldId}-except`}>
        <span className="video-field-name">
          {t('Except titles with')}
          <InfoTip label={t('Except titles with')}>
            {t('Leaves out a video if its title has one of these words, even when it has a word from the list above.')}
          </InfoTip>
        </span>
        <input id={`${fieldId}-except`} value={except} placeholder={t('trailer, best of')} onChange={(e) => setExcept(e.target.value)} />
      </label>
      <label className="video-field" htmlFor={`${fieldId}-minutes`}>
        <span className="video-field-name">
          {t('Hide videos shorter than (minutes)')}
          <InfoTip label={t('Hide videos shorter than (minutes)')}>
            {t('Useful when a stream breaks: each piece becomes a video with the same title. Empty: show them all.')}
          </InfoTip>
        </span>
        {/* No min, max or step: the browser would refuse the form with its own bubble; minuteCount cleans up */}
        <input id={`${fieldId}-minutes`} type="number" value={minutes} placeholder={t('Off')} onChange={(e) => setMinutes(e.target.value)} />
      </label>
      {youtube && (
        <label className="dialog-check">
          <input type="checkbox" checked={hideShorts} onChange={(e) => setHideShorts(e.target.checked)} />
          {t('Hide Shorts')}
        </label>
      )}
      {!follow && (
        <label className="video-field">
          {t('Include past videos')}
          <select value={past} onChange={(e) => setPast(e.target.value as PastChoice)}>
            <option value="today">{t('No, start from today')}</option>
            <option value="30">{t('Last 30 days')}</option>
            <option value="60">{t('Last 60 days')}</option>
            <option value="all">{t('All that are still available')}</option>
          </select>
        </label>
      )}
      {error && <p className="event-error">{error}</p>}
      <div className="dialog-buttons">
        <button type="button" onClick={onClose}>{t('Cancel')}</button>
        <button type="submit" className="primary" disabled={busy || (!follow && !link.trim())}>
          {busy ? (
            <span className="loading-line">
              <Spinner size={13} /> {t('Saving…')}
            </span>
          ) : follow ? (
            t('Save')
          ) : (
            t('Add')
          )}
        </button>
      </div>
    </Window>
  )
}

// What a follow keeps, in words, e.g. "Only: hotline · Under 15 min hidden"
function followSummary(follow: VideoFollow) {
  const rules = [
    follow.onlyWords.length ? t('Only: {words}', { words: follow.onlyWords.join(', ') }) : '',
    follow.exceptWords.length ? t('Except: {words}', { words: follow.exceptWords.join(', ') }) : '',
    follow.minMinutes ? t('Under {minutes} min hidden', { minutes: follow.minMinutes }) : '',
    follow.platform === 'youtube' && !follow.hideShorts ? t('Shorts shown') : '',
  ].filter(Boolean)
  return (rules.length ? rules : [t('All videos')]).join(' · ')
}

// The channels you follow: change or remove them
// One video by its link. onAdded gets the followId it's listed under.
export function AddVideoDialog({ onAdded, onClose }: { onAdded: (followId: string) => void; onClose: () => void }) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || !link.trim()) return
    setBusy(true)
    setError('')
    try {
      onAdded(await addVideo(link))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Window className="dialog video-follow-dialog" label={t('Add a video')} onClose={onClose} onSubmit={save}>
      <h2>{t('Add a video')}</h2>
      <label className="video-field">
        {t('Video link')}
        <input autoFocus value={link} placeholder={t('Paste a YouTube or Twitch video’s link')} onChange={(e) => setLink(e.target.value)} />
      </label>
      {error && <p className="event-error">{error}</p>}
      <div className="dialog-buttons">
        <button type="button" onClick={onClose}>{t('Cancel')}</button>
        <button type="submit" className="primary" disabled={busy || !link.trim()}>
          {busy ? (
            <span className="loading-line">
              <Spinner size={13} /> {t('Saving…')}
            </span>
          ) : (
            t('Add')
          )}
        </button>
      </div>
    </Window>
  )
}

export function FollowsWindow({ onClose }: { onClose: () => void }) {
  const follows = useFollows()
  const [editing, setEditing] = useState<VideoFollow | null>(null)
  const [removing, setRemoving] = useState<VideoFollow | null>(null)
  const boxRef = useRef<HTMLElement>(null)
  // The focus has to be inside the window for Escape to close it, also after a window on top closed
  useEffect(() => {
    if (!editing && !removing) boxRef.current?.focus()
  }, [editing, removing])

  return (
    <>
      <Window className="dialog video-follows" label={t('Follows')} onClose={onClose} ref={boxRef}>
        <div className="dialog-head">
          <h2>{t('Follows')}</h2>
          <CloseButton onClick={onClose} />
        </div>
        {follows?.length === 0 && <p>{t('No follows yet')}</p>}
        <ul className="video-follow-list">
          {follows?.map((follow) => {
            const summary = followSummary(follow)
            return (
              <li key={follow.id} className="video-follow-row">
                {follow.icon ? (
                  <img className="video-follow-icon" src={follow.icon} alt="" loading="lazy" referrerPolicy="no-referrer" />
                ) : (
                  <span className="video-follow-icon" />
                )}
                <span className="video-follow-text">
                  <span className="video-follow-name" title={follow.name}>{follow.name}</span>
                  <span className="video-follow-line">
                    <VideoLogo platform={follow.platform} />
                    <span className="video-follow-summary" title={summary}>{summary}</span>
                  </span>
                </span>
                <button onClick={() => setEditing(follow)} title={t('Edit')}>
                  <Pencil size={15} />
                </button>
                <button onClick={() => setRemoving(follow)} title={t('Remove')}>
                  <Trash2 size={15} />
                </button>
              </li>
            )
          })}
        </ul>
      </Window>
      {editing && <FollowDialog follow={editing} onClose={() => setEditing(null)} />}
      {removing && (
        <Dialog
          request={{
            title: t('Stop following {name}?', { name: removing.name }),
            confirmLabel: t('Remove'),
            danger: true,
            onConfirm: () => void removeFollow(removing.id),
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  )
}
