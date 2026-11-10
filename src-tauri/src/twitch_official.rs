// Twitch's official player, hidden, for videos Twitch refuses to the own player (subscribers only).
// It plays with the user's own Twitch sign-in (made on twitch.tv in the video window). Rust reads the
// master playlist that player loads, token already applied, and hands it to the own player (/twitch/
// in video_window.rs). The quality lists and pieces sit on cloudfront with no token, so the own
// player fetches those itself through /v/. Nothing here is saved, synced or logged.
use core::ffi::c_void;
use std::sync::mpsc::{Sender, channel};
use std::time::Duration;
use tauri::webview::PlatformWebview;
use tauri::utils::config::Color;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_2;
use webview2_com::{WebResourceResponseReceivedEventHandler, WebResourceResponseViewGetContentCompletedHandler, take_pwstr};
use windows::Win32::Foundation::{S_FALSE, S_OK};
use windows::Win32::System::Com::IStream;
use windows::core::{HSTRING, Interface, PWSTR};

use super::video_window::VIDEO_ARGS;

const OFFICIAL: &str = "video-player-official";
// Without access (not signed in, not subscribed) it never loads a playlist: the own player then goes
// to Twitch's page, as before.
const WAIT: Duration = Duration::from_secs(15);

// The master playlist Twitch's own player loads for this video, or None
pub async fn catch(app: &tauri::AppHandle, video: &str) -> Option<Vec<u8>> {
  if let Some(earlier) = app.get_webview_window(OFFICIAL) {
    let _ = earlier.destroy();
  }
  // A full-size window off the screen, not a tiny hidden one: Windows then keeps it awake so its
  // player finishes loading. The user never sees it. Same storage and options as the video window
  // (the user's Twitch sign-in, VIDEO_ARGS).
  let blank = tauri::Url::parse("about:blank").ok()?;
  let window = WebviewWindowBuilder::new(app, OFFICIAL, WebviewUrl::External(blank))
    .data_directory(super::video_extensions::player_folder(app).ok()?)
    .browser_extensions_enabled(true)
    .additional_browser_args(VIDEO_ARGS)
    .use_https_scheme(true)
    .background_color(Color(0, 0, 0, 255))
    .position(-4000.0, 0.0)
    .inner_size(1280.0, 720.0)
    .visible(true)
    .focused(false)
    .skip_taskbar(true)
    // Let Twitch's player load whatever it needs; only keep it off the app's own pages. The window
    // has no capability anyway, so it can reach no app command.
    .on_navigation(|url| url.host_str() != Some("tauri.localhost"))
    .build()
    .ok()?;
  let (sender, receiver) = channel();
  let wanted = video.to_string();
  let address = format!("https://player.twitch.tv/?video=v{video}&parent=twitch.tv&autoplay=true&muted=true");
  let trace = app.path().app_local_data_dir().ok().map(|f| f.join("twitch-debug.txt")); // PROOF ONLY
  let started = window.with_webview(move |platform| {
    if let Err(e) = listen(platform, wanted, sender, &address, trace) {
      log::warn!("Twitch's player: {e}");
    }
  });
  let found = match started {
    Ok(()) => tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(WAIT).ok()).await.ok().flatten(),
    Err(_) => None,
  };
  let _ = window.destroy();
  found
}

// PROOF ONLY: append one trace line
fn trace(path: &Option<std::path::PathBuf>, line: &str) {
  use std::io::Write;
  if let Some(path) = path {
    if let Ok(mut out) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
      let _ = writeln!(out, "  . {line}");
    }
  }
}

// Watch every response the player gets; keep the one for this video's master playlist (status 200).
fn listen(platform: PlatformWebview, video: String, sender: Sender<Vec<u8>>, address: &str, log: Option<std::path::PathBuf>) -> windows::core::Result<()> {
  let core = unsafe { platform.controller().CoreWebView2()? };
  let watched = core.cast::<ICoreWebView2_2>()?;
  let handler = WebResourceResponseReceivedEventHandler::create(Box::new(move |_, args| {
    let Some(args) = args else { return Ok(()) };
    let mut uri = PWSTR::null();
    unsafe { args.Request()?.Uri(&mut uri)? };
    let url = take_pwstr(uri);
    let view = unsafe { args.Response()? };
    let mut status = 0i32;
    unsafe { view.StatusCode(&mut status)? };
    if url.contains("usher.ttvnw.net") {
      trace(&log, &format!("usher response status={status} match={}", super::twitch::caught_address(&url, &video))); // PROOF ONLY
    }
    if !super::twitch::caught_address(&url, &video) || status != 200 {
      return Ok(());
    }
    // The body arrives on its own handler, a moment later
    let sender = sender.clone();
    let inner = log.clone();
    let content = WebResourceResponseViewGetContentCompletedHandler::create(Box::new(move |result: windows::core::Result<()>, stream: Option<IStream>| {
      let bytes = stream.as_ref().map(|stream| unsafe { read_stream(stream) });
      trace(&inner, &format!("getcontent ok={} stream={} bytes={:?}", result.is_ok(), stream.is_some(), bytes.as_ref().map(|b| b.len()))); // PROOF ONLY
      if let Some(bytes) = bytes {
        let _ = sender.send(bytes);
      }
      Ok(())
    }));
    let got = unsafe { view.GetContent(&content) };
    trace(&log, &format!("getcontent called ok={}", got.is_ok())); // PROOF ONLY
    Ok(())
  }));
  let mut token = 0i64;
  unsafe {
    watched.add_WebResourceResponseReceived(&handler, &mut token)?;
    core.Navigate(&HSTRING::from(address))
  }
}

// A COM byte stream into a Vec. Master playlists are tiny; the guard only stops a runaway.
unsafe fn read_stream(stream: &IStream) -> Vec<u8> {
  let mut out = Vec::new();
  let mut buffer = [0u8; 16384];
  loop {
    let mut read = 0u32;
    let result = unsafe { stream.Read(buffer.as_mut_ptr() as *mut c_void, buffer.len() as u32, Some(&mut read)) };
    if read > 0 {
      out.extend_from_slice(&buffer[..read as usize]);
    }
    if read == 0 || (result != S_OK && result != S_FALSE) || out.len() > 4_000_000 {
      break;
    }
  }
  out
}

// PROOF ONLY (test branch): one line to twitch-debug.txt, no playlist content beyond its first line.
pub fn debug(app: &tauri::AppHandle, video: &str, master: Option<&[u8]>) {
  use std::io::Write;
  let Ok(folder) = app.path().app_local_data_dir() else {
    return;
  };
  let note = match master {
    Some(bytes) => format!("captured video {video}: {} bytes, starts \"{}\"", bytes.len(), String::from_utf8_lossy(bytes).lines().next().unwrap_or("").chars().take(30).collect::<String>()),
    None => format!("captured video {video}: nothing"),
  };
  if let Ok(mut out) = std::fs::OpenOptions::new().create(true).append(true).open(folder.join("twitch-debug.txt")) {
    let _ = writeln!(out, "{note}");
  }
}
