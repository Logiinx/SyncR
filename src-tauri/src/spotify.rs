// Spotify module (PC, off unless turned on in Settings → Spotify): what Spotify is playing, read
// from Windows' media info (the same as the media keys' pop-up), so no Spotify sign-in. Only the
// Spotify app's session counts (not browsers or SyncR's own player).
// One thread while on: it reads the song when Windows says something changed (song, play/pause,
// apps opening or closing) and every second anyway, then tells the page ("spotify" event) only
// when something differs. Off: no thread, nothing is read.
// Shown as a strip in the taskbar (strip.rs, its own thread, drawn from CONFIG, SONG, COVER and
// TIP) or, later, a floating widget.
// Nothing here may panic: the app is built with panic = "abort", so a panic would close SyncR.

use base64::Engine;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use windows::core::Interface;
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
  GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
  GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Graphics::Imaging::{
  BitmapAlphaMode, BitmapBounds, BitmapDecoder, BitmapInterpolationMode, BitmapPixelFormat, BitmapTransform, ColorManagementMode,
  ExifOrientationMode,
};
use windows::Storage::Streams::{DataReader, IRandomAccessStream};

mod strip;

const CHECK_EVERY: Duration = Duration::from_secs(1);
// Spotify may give the new song's words before its cover: the cover is read again this many times
// (one per check) after a song change, in case it was still the last song's
const COVER_READS: u8 = 3;
const COVER_MAX: u32 = 4 * 1024 * 1024; // bytes; a cover is usually about 30 KB
// The cover's pixels for the strip and the widget: this many on each side (the strip's 32 px at
// 400% scale), made smaller by them as needed
const COVER_SIDE: u32 = 128;

// What the page sends (spotify.ts)
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
  on: bool,
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

// The album cover's pixels: blue, green, red, alpha (premultiplied), `side` square, top row first
pub struct Cover {
  pixels: Vec<u8>,
  side: usize,
}

// The settings while on (None: off), the song now, its cover's pixels, the strip's tooltip (made
// by the page, in its language) and the reading thread's channel (dropping it ends the thread)
static CONFIG: Mutex<Option<Config>> = Mutex::new(None);
static SONG: Mutex<Option<Song>> = Mutex::new(None);
static COVER: Mutex<Option<Arc<Cover>>> = Mutex::new(None);
static TIP: Mutex<String> = Mutex::new(String::new());
static WORKER: Mutex<Option<Sender<()>>> = Mutex::new(None);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
  mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// What the strip shows (None: nothing, or it's shown as the widget)
struct Shown {
  title: String,
  artist: String,
  playing: bool,
  cover: Option<Arc<Cover>>,
}

fn strip_shown() -> Option<Shown> {
  let as_strip = lock(&CONFIG).as_ref().is_some_and(|config| config.show_as == "strip");
  let song = lock(&SONG).clone().filter(|_| as_strip)?;
  Some(Shown { title: song.title, artist: song.artist, playing: song.playing, cover: lock(&COVER).clone() })
}

fn tip() -> String {
  lock(&TIP).clone()
}

// The battery strip moved (taskbar.rs): Spotify's goes along
pub fn strip_refresh() {
  strip::refresh();
}

// Called at start and on every settings change
#[tauri::command]
pub fn spotify_config(app: AppHandle, config: Config) {
  let mut worker = lock(&WORKER);
  if !config.on {
    *lock(&CONFIG) = None;
    *lock(&SONG) = None;
    *lock(&COVER) = None;
    if worker.take().is_some() {
      strip::stop(); // the reading thread ends at its next wait
    }
    return;
  }
  *lock(&CONFIG) = Some(config);
  if worker.is_some() {
    strip::refresh();
    return;
  }
  let (sender, receiver) = mpsc::channel();
  let wake = sender.clone();
  strip::start();
  std::thread::spawn(move || run(app, receiver, wake));
  *worker = Some(sender);
}

// The strip's tooltip, sent by the page after each song change and when the language changes
#[tauri::command]
pub fn spotify_tip(text: String) {
  *lock(&TIP) = text;
  strip::refresh();
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
        if let Some((cover, pixels)) = session.as_ref().and_then(|session| read_cover(session, song.cover.as_deref())) {
          if let Some(pixels) = pixels {
            *lock(&COVER) = Some(Arc::new(pixels));
          } else if song.cover.as_deref() != Some(cover.as_str()) {
            *lock(&COVER) = None; // a new picture Windows couldn't decode
          }
          song.cover = Some(cover);
        }
      }
      if song.cover.is_none() {
        *lock(&COVER) = None;
      }
    } else {
      cover_key.clear();
      *lock(&COVER) = None;
    }
    let changed = {
      let mut shown = lock(&SONG);
      let changed = *shown != song;
      *shown = song.clone();
      changed
    };
    if changed {
      strip::refresh();
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

// The album cover as a data: address (the picture's bytes in base64), and its pixels when it's a
// new picture (not `known`, the address shown now). None: no cover.
fn read_cover(session: &Session, known: Option<&str>) -> Option<(String, Option<Cover>)> {
  let properties = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
  let stream = properties.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
  let size = u32::try_from(stream.Size().ok()?).ok().filter(|&size| size > 0 && size <= COVER_MAX)?;
  let reader = DataReader::CreateDataReader(&stream).ok()?;
  let loaded = reader.LoadAsync(size).ok()?.join().ok()?;
  let mut bytes = vec![0u8; loaded as usize];
  reader.ReadBytes(&mut bytes).ok()?;
  let kind = stream.ContentType().map(|s| s.to_string_lossy()).ok().filter(|kind| kind.starts_with("image/"));
  let kind = kind.unwrap_or_else(|| "image/jpeg".to_string());
  let address = format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes));
  if known == Some(address.as_str()) {
    return Some((address, None));
  }
  let _ = reader.DetachStream();
  let pixels = stream.Seek(0).ok().and_then(|()| decode(&stream.cast().ok()?));
  Some((address, pixels))
}

// The picture's pixels, its middle square made COVER_SIDE wide (Windows' own decoder)
fn decode(stream: &IRandomAccessStream) -> Option<Cover> {
  let decoder = BitmapDecoder::CreateAsync(stream).ok()?.join().ok()?;
  let (width, height) = (decoder.OrientedPixelWidth().ok()?, decoder.OrientedPixelHeight().ok()?);
  if width == 0 || height == 0 {
    return None;
  }
  // Smaller side to COVER_SIDE, then the middle cut out (covers are square: nothing is cut)
  let scale = COVER_SIDE as f64 / width.min(height) as f64;
  let fit = |side: u32| ((side as f64 * scale).round() as u32).max(COVER_SIDE);
  let (scaled_width, scaled_height) = (fit(width), fit(height));
  let transform = BitmapTransform::new().ok()?;
  transform.SetScaledWidth(scaled_width).ok()?;
  transform.SetScaledHeight(scaled_height).ok()?;
  transform.SetInterpolationMode(BitmapInterpolationMode::Fant).ok()?;
  let middle = BitmapBounds { X: (scaled_width - COVER_SIDE) / 2, Y: (scaled_height - COVER_SIDE) / 2, Width: COVER_SIDE, Height: COVER_SIDE };
  transform.SetBounds(middle).ok()?;
  let data = decoder
    .GetPixelDataTransformedAsync(
      BitmapPixelFormat::Bgra8,
      BitmapAlphaMode::Premultiplied,
      &transform,
      ExifOrientationMode::RespectExifOrientation,
      ColorManagementMode::DoNotColorManage,
    )
    .ok()?
    .join()
    .ok()?;
  let pixels = data.DetachPixelData().ok()?.to_vec();
  let side = COVER_SIDE as usize;
  (pixels.len() == side * side * 4).then_some(Cover { pixels, side })
}
