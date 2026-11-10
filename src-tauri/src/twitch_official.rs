// Twitch's own player, hidden, for videos Twitch refuses to the own player (subscribers only). It
// plays with the user's Twitch sign-in (made on twitch.tv in the video window). Twitch fetches the
// master playlist from a Web Worker, on the browser's own connection, which usher accepts; Rust
// can't fetch it (403) or read that worker response, so a script injected into the page (twitch-
// capture.js, the Adblock extension's way in) hooks the worker's fetch and hands the playlist to the
// page, where Rust reads it. The quality lists and pieces sit on cloudfront with no token, so the
// own player fetches those itself through /v/. Nothing here is saved or synced.
use std::sync::mpsc::channel;
use std::time::Duration;
use tauri::utils::config::Color;
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use webview2_com::ExecuteScriptCompletedHandler;
use windows::core::HSTRING;

use super::video_window::VIDEO_ARGS;

const OFFICIAL: &str = "video-player-official";
// How long to wait for the player to load the playlist. Without access (not signed in, not
// subscribed) it never comes, and the own player then goes to Twitch's page, as before.
const WAIT: Duration = Duration::from_secs(15);

// The master playlist Twitch's own player loads for this video, or None
pub async fn catch(app: &tauri::AppHandle, video: &str) -> Option<Vec<u8>> {
  if let Some(earlier) = app.get_webview_window(OFFICIAL) {
    let _ = earlier.destroy();
  }
  let script = include_str!("twitch-capture.js").replace("__VIDEO__", video);
  let address = tauri::Url::parse(&format!("https://player.twitch.tv/?video=v{video}&parent=twitch.tv&autoplay=true&muted=true")).ok()?;
  // A full-size window off the screen, not a tiny hidden one, so Windows keeps it awake and its
  // player loads. The user never sees it. Same storage and options as the video window (the user's
  // Twitch sign-in, VIDEO_ARGS).
  let window = WebviewWindowBuilder::new(app, OFFICIAL, WebviewUrl::External(address))
    .data_directory(super::video_extensions::player_folder(app).ok()?)
    .browser_extensions_enabled(true)
    .additional_browser_args(VIDEO_ARGS)
    .use_https_scheme(true)
    .initialization_script(&script)
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
  let polling = window.clone();
  let master = tauri::async_runtime::spawn_blocking(move || poll(&polling)).await.ok().flatten();
  if let Some(trace) = exec(&window, "JSON.stringify({status: window.__syncrStatus ?? null, err: window.__syncrErr ?? null, master: (window.__syncrMaster||'').length})") {
    debug(app, &format!("video {video}: trace {trace}")); // PROOF ONLY
  }
  let _ = window.destroy();
  master
}

// Read window.__syncrMaster until the playlist is there or the time runs out
fn poll(window: &WebviewWindow) -> Option<Vec<u8>> {
  let steps = WAIT.as_millis() / 300;
  for _ in 0..steps {
    if let Some(value) = exec(window, "window.__syncrMaster || ''") {
      if let Ok(text) = serde_json::from_str::<String>(&value) {
        if text.contains("#EXTM3U") {
          return Some(text.into_bytes());
        }
      }
    }
    std::thread::sleep(Duration::from_millis(300));
  }
  None
}

// Run one script in the window, give back its JSON result
fn exec(window: &WebviewWindow, script: &str) -> Option<String> {
  let (sender, receiver) = channel();
  let script = HSTRING::from(script);
  window
    .with_webview(move |platform| {
      let failed = sender.clone();
      let run = || -> windows::core::Result<()> {
        let handler = ExecuteScriptCompletedHandler::create(Box::new(move |result, value| {
          let _ = sender.send(result.ok().map(|()| value));
          Ok(())
        }));
        unsafe { platform.controller().CoreWebView2()?.ExecuteScript(&script, &handler) }
      };
      if run().is_err() {
        let _ = failed.send(None);
      }
    })
    .ok()?;
  receiver.recv_timeout(Duration::from_secs(2)).ok()?
}

// PROOF ONLY (test branch): one line to twitch-debug.txt
pub fn debug(app: &tauri::AppHandle, line: &str) {
  use std::io::Write;
  if let Ok(folder) = app.path().app_local_data_dir() {
    if let Ok(mut out) = std::fs::OpenOptions::new().create(true).append(true).open(folder.join("twitch-debug.txt")) {
      let _ = writeln!(out, "{line}");
    }
  }
}
