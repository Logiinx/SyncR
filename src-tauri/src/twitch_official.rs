// Twitch's official player, hidden, for videos Twitch refuses to the own player (subscribers only).
// It plays with the user's own Twitch sign-in (made on twitch.tv in the video window). Twitch's player
// fetches the master playlist from a background worker, so Rust can't read that response; instead it
// catches the worker's request — its address and headers — and fetches the playlist itself the same
// way, for the own player (/twitch/ in video_window.rs). Quality lists and pieces sit on cloudfront
// with no token, so the own player fetches those itself through /v/. Nothing here is saved or synced.
use std::sync::mpsc::{Sender, channel};
use std::time::Duration;
use tauri::utils::config::Color;
use tauri::webview::PlatformWebview;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use webview2_com::Microsoft::Web::WebView2::Win32::{
  COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL, ICoreWebView2_22,
};
use webview2_com::{WebResourceRequestedEventHandler, take_pwstr};
use windows::core::{BOOL, HSTRING, Interface, PWSTR};

use super::video_window::VIDEO_ARGS;

const OFFICIAL: &str = "video-player-official";
// Without access (not signed in, not subscribed) it never loads a playlist: the own player then goes
// to Twitch's page, as before.
const WAIT: Duration = Duration::from_secs(15);

// The master-playlist request Twitch's own player makes for this video: (address, headers), or None
pub async fn catch(app: &tauri::AppHandle, video: &str) -> Option<(String, Vec<(String, String)>)> {
  if let Some(earlier) = app.get_webview_window(OFFICIAL) {
    let _ = earlier.destroy();
  }
  // A full-size window off the screen, not a tiny hidden one: Windows then keeps it awake so its
  // player makes the request. The user never sees it. Same storage and options as the video window
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
  let started = window.with_webview(move |platform| {
    if let Err(e) = listen(platform, wanted, sender, &address) {
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

// Watch every request (all sources, so the worker's too); keep the one for this video's master
// playlist, with its headers.
fn listen(platform: PlatformWebview, video: String, sender: Sender<(String, Vec<(String, String)>)>, address: &str) -> windows::core::Result<()> {
  let core = unsafe { platform.controller().CoreWebView2()? };
  let newer = core.cast::<ICoreWebView2_22>()?;
  let pattern = HSTRING::from("https://usher.ttvnw.net/*");
  unsafe { newer.AddWebResourceRequestedFilterWithRequestSourceKinds(&pattern, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL)? };
  let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
    let Some(args) = args else { return Ok(()) };
    let request = unsafe { args.Request()? };
    let mut uri = PWSTR::null();
    unsafe { request.Uri(&mut uri)? };
    let url = take_pwstr(uri);
    if !super::twitch::caught_address(&url, &video) {
      return Ok(());
    }
    let headers = unsafe { read_headers(&request) }.unwrap_or_default();
    let _ = sender.send((url, headers));
    Ok(())
  }));
  let mut token = 0i64;
  unsafe {
    core.add_WebResourceRequested(&handler, &mut token)?;
    core.Navigate(&HSTRING::from(address))
  }
}

// Every header on the request, as (name, value)
unsafe fn read_headers(request: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebResourceRequest) -> windows::core::Result<Vec<(String, String)>> {
  let iterator = unsafe { request.Headers()?.GetIterator()? };
  let mut out = Vec::new();
  loop {
    let mut has = BOOL::default();
    unsafe { iterator.HasCurrentHeader(&mut has)? };
    if !has.as_bool() {
      break;
    }
    let (mut name, mut value) = (PWSTR::null(), PWSTR::null());
    unsafe { iterator.GetCurrentHeader(&mut name, &mut value)? };
    out.push((take_pwstr(name), take_pwstr(value)));
    let mut next = BOOL::default();
    unsafe { iterator.MoveNext(&mut next)? };
    if !next.as_bool() {
      break;
    }
  }
  Ok(out)
}

// PROOF ONLY (test branch): one line to twitch-debug.txt, no header values.
pub fn debug(app: &tauri::AppHandle, line: &str) {
  use std::io::Write;
  if let Ok(folder) = app.path().app_local_data_dir() {
    if let Ok(mut out) = std::fs::OpenOptions::new().create(true).append(true).open(folder.join("twitch-debug.txt")) {
      let _ = writeln!(out, "{line}");
    }
  }
}
