// Spotify module (PC, off unless turned on in Settings → Spotify): what Spotify is playing, read
// from Windows' media info (the same as the media keys' pop-up), so no Spotify sign-in. Only the
// Spotify app's session counts (not browsers or SyncR's own player).
// One thread while on: it reads the song when Windows says something changed (song, play/pause,
// apps opening or closing) and every second anyway, then tells the page ("spotify" event) only
// when something differs. Off: no thread, nothing is read.
// Nothing here may panic: the app is built with panic = "abort", so a panic would close SyncR.

use base64::Engine;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
  GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
  GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Storage::Streams::DataReader;

const CHECK_EVERY: Duration = Duration::from_secs(1);
// Spotify may give the new song's words before its cover: the cover is read again this many times
// (one per check) after a song change, in case it was still the last song's
const COVER_READS: u8 = 3;
const COVER_MAX: u32 = 4 * 1024 * 1024; // bytes; a cover is usually about 30 KB

// What the page sends (spotify.ts)
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
  on: bool,
  #[allow(dead_code)] // read by the strip and the widget (next steps)
  show_as: String, // "strip" (in the taskbar) · "widget" (floating)
}

// Sent to the page (event "spotify", and by spotify_status): None = Spotify closed or not playing
// anything Windows knows about
#[derive(Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Song {
  title: String,
  artist: String,
  album: String,
  playing: bool,         // false: paused or stopped
  cover: Option<String>, // the album cover as a data: address, None while unknown
}

static CONFIG: Mutex<Option<Config>> = Mutex::new(None);
static SONG: Mutex<Option<Song>> = Mutex::new(None);
static WORKER: Mutex<Option<Sender<()>>> = Mutex::new(None);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
  mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// Called at start and on every settings change
#[tauri::command]
pub fn spotify_config(app: AppHandle, config: Config) {
  let mut worker = lock(&WORKER);
  if !config.on {
    *lock(&CONFIG) = None;
    *lock(&SONG) = None;
    worker.take(); // the thread ends at its next wait
    return;
  }
  *lock(&CONFIG) = Some(config);
  if worker.is_some() {
    return;
  }
  let (sender, receiver) = mpsc::channel();
  let wake = sender.clone();
  std::thread::spawn(move || run(app, receiver, wake));
  *worker = Some(sender);
}

#[tauri::command]
pub fn spotify_status() -> Option<Song> {
  lock(&SONG).clone()
}

// The Spotify session being followed, with its change signals' tokens (removed when it goes)
struct Followed {
  session: Session,
  tokens: (i64, i64),
}

impl Drop for Followed {
  fn drop(&mut self) {
    let _ = self.session.RemoveMediaPropertiesChanged(self.tokens.0);
    let _ = self.session.RemovePlaybackInfoChanged(self.tokens.1);
  }
}

fn run(app: AppHandle, receiver: Receiver<()>, wake: Sender<()>) {
  let Some(manager) = Manager::RequestAsync().and_then(|op| op.join()).ok() else {
    log::warn!("Spotify: Windows' media info isn't available");
    return;
  };
  // Apps playing something come or go: check now. The signals arrive on Windows' threads, so
  // they only send a message; the reading is done here.
  let signal = wake.clone();
  let sessions_token = manager.SessionsChanged(&TypedEventHandler::new(move |_, _| {
    let _ = signal.send(());
    Ok(())
  }));
  let mut followed: Option<Followed> = None;
  let mut cover_key = String::new(); // the song whose cover was read (title, artist, album)
  let mut cover_reads = 0u8;
  loop {
    let session = spotify_session(&manager);
    match (&session, &followed) {
      (None, Some(_)) => followed = None,
      (Some(session), None) => followed = follow(session, &wake),
      _ => {}
    }
    let mut song = session.as_ref().and_then(read_song);
    if let Some(song) = song.as_mut() {
      let key = format!("{}\n{}\n{}", song.title, song.artist, song.album);
      let last = lock(&SONG).clone();
      if key != cover_key {
        cover_key = key;
        cover_reads = COVER_READS;
      } else if let Some(last) = last {
        song.cover = last.cover;
      }
      if cover_reads > 0 {
        cover_reads -= 1;
        if let Some(cover) = session.as_ref().and_then(read_cover) {
          song.cover = Some(cover);
        }
      }
    } else {
      cover_key.clear();
    }
    let changed = {
      let mut shown = lock(&SONG);
      let changed = *shown != song;
      *shown = song.clone();
      changed
    };
    if changed {
      let _ = app.emit("spotify", song);
    }
    // A message: something changed (Windows' signals); closed: the module was turned off
    match receiver.recv_timeout(CHECK_EVERY) {
      Ok(()) => while receiver.try_recv().is_ok() {}, // several signals at once: one read
      Err(RecvTimeoutError::Timeout) => {}
      Err(RecvTimeoutError::Disconnected) => break,
    }
  }
  drop(followed);
  if let Ok(token) = sessions_token {
    let _ = manager.RemoveSessionsChanged(token);
  }
}

// Spotify's session among the apps Windows knows are playing something (its id is "Spotify.exe",
// or longer for the Microsoft Store version)
fn spotify_session(manager: &Manager) -> Option<Session> {
  let sessions = manager.GetSessions().ok()?;
  (0..sessions.Size().ok()?).filter_map(|i| sessions.GetAt(i).ok()).find(|session| {
    session.SourceAppUserModelId().is_ok_and(|id| id.to_string_lossy().to_lowercase().contains("spotify"))
  })
}

fn follow(session: &Session, wake: &Sender<()>) -> Option<Followed> {
  let (first, second) = (wake.clone(), wake.clone());
  let properties = session
    .MediaPropertiesChanged(&TypedEventHandler::new(move |_, _| {
      let _ = first.send(());
      Ok(())
    }))
    .ok()?;
  let playback = session.PlaybackInfoChanged(&TypedEventHandler::new(move |_, _| {
    let _ = second.send(());
    Ok(())
  }));
  match playback {
    Ok(playback) => Some(Followed { session: session.clone(), tokens: (properties, playback) }),
    Err(_) => {
      let _ = session.RemoveMediaPropertiesChanged(properties);
      None
    }
  }
}

// The song without its cover (read separately, only when the song changes)
fn read_song(session: &Session) -> Option<Song> {
  let properties = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
  let title = properties.Title().ok()?.to_string_lossy();
  if title.is_empty() {
    return None; // Spotify open but nothing loaded yet
  }
  let playing = session
    .GetPlaybackInfo()
    .and_then(|info| info.PlaybackStatus())
    .is_ok_and(|status| status == PlaybackStatus::Playing);
  Some(Song {
    title,
    artist: properties.Artist().map(|s| s.to_string_lossy()).unwrap_or_default(),
    album: properties.AlbumTitle().map(|s| s.to_string_lossy()).unwrap_or_default(),
    playing,
    cover: None,
  })
}

// The album cover as a data: address (the picture's bytes in base64)
fn read_cover(session: &Session) -> Option<String> {
  let properties = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
  let stream = properties.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
  let size = u32::try_from(stream.Size().ok()?).ok().filter(|&size| size > 0 && size <= COVER_MAX)?;
  let reader = DataReader::CreateDataReader(&stream).ok()?;
  let loaded = reader.LoadAsync(size).ok()?.join().ok()?;
  let mut bytes = vec![0u8; loaded as usize];
  reader.ReadBytes(&mut bytes).ok()?;
  let kind = stream.ContentType().map(|s| s.to_string_lossy()).ok().filter(|kind| kind.starts_with("image/"));
  let kind = kind.unwrap_or_else(|| "image/jpeg".to_string());
  Some(format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}
