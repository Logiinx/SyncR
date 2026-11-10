// Twitch's official player, hidden, for videos Twitch refuses to the own player (subscribers only).
// It plays with the user's own Twitch sign-in (made on twitch.tv in the video window), and Rust takes
// the playlist address it asks for, token included, for the own player (/twitch/ in
// video_window.rs). The address is kept in memory only: never saved, synced or logged.
use std::sync::mpsc::{Sender, channel};
use std::time::Duration;
use tauri::webview::{PlatformWebview, WebviewBuilder};
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewUrl};
use webview2_com::Microsoft::Web::WebView2::Win32::{
  COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL, ICoreWebView2_22,
};
use webview2_com::{WebResourceRequestedEventHandler, take_pwstr};
use windows::core::{HSTRING, Interface, PWSTR};

use super::video_window::{VIDEO_ARGS, VIDEO_WINDOW};

const OFFICIAL: &str = "video-player-official";
// Without access (not signed in, not subscribed) it never gets a playlist that plays: the own
// player then goes to Twitch's page, as before
const WAIT: Duration = Duration::from_secs(15);

// The playlist address the official player asks for, or None
pub async fn catch(app: &tauri::AppHandle, video: &str) -> Option<String> {
  let window = app.get_window(VIDEO_WINDOW)?;
  if let Some(earlier) = app.get_webview(OFFICIAL) {
    let _ = earlier.close();
  }
  let folder = super::video_extensions::player_folder(app).ok()?;
  // 1 pixel in a corner of the bar: a hidden page may not start its video at all. Same options as
  // every page of this storage (VIDEO_ARGS), muted by its address.
  let webview = window
    .add_child(
      WebviewBuilder::new(OFFICIAL, WebviewUrl::External(tauri::Url::parse("about:blank").ok()?))
        .use_https_scheme(true)
        .additional_browser_args(VIDEO_ARGS)
        .browser_extensions_enabled(true)
        .data_directory(folder)
        .focused(false)
        .on_navigation(|url| url.as_str() == "about:blank" || url.host_str() == Some("player.twitch.tv")),
      PhysicalPosition::new(0, 0),
      PhysicalSize::new(1, 1),
    )
    .ok()?;
  let (sender, receiver) = channel();
  let wanted = video.to_string();
  let address = format!("https://player.twitch.tv/?video=v{video}&parent=twitch.tv&autoplay=true&muted=true");
  let started = webview.with_webview(move |platform| {
    if let Err(e) = listen(platform, wanted, sender, &address) {
      log::warn!("Twitch's player: {e}");
    }
  });
  let found = match started {
    Ok(()) => tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(WAIT).ok()).await.ok().flatten(),
    Err(_) => None,
  };
  let _ = webview.close();
  found
}

// Watching starts before the page opens, so its first request can't slip by. Should Twitch's player ask
// from a background helper (a worker) one day, "all sources" covers those too.
fn listen(platform: PlatformWebview, video: String, sender: Sender<String>, address: &str) -> windows::core::Result<()> {
  let core = unsafe { platform.controller().CoreWebView2()? };
  let pattern = HSTRING::from("https://usher.ttvnw.net/*");
  match core.cast::<ICoreWebView2_22>() {
    Ok(newer) => unsafe {
      newer.AddWebResourceRequestedFilterWithRequestSourceKinds(&pattern, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL)?
    },
    Err(_) => unsafe { core.AddWebResourceRequestedFilter(&pattern, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)? },
  }
  let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
    let Some(args) = args else { return Ok(()) };
    let mut uri = PWSTR::null();
    unsafe { args.Request()?.Uri(&mut uri)? };
    let address = take_pwstr(uri);
    if super::twitch::caught_address(&address, &video) {
      let _ = sender.send(address);
    }
    Ok(())
  }));
  let mut token = 0i64;
  unsafe {
    core.add_WebResourceRequested(&handler, &mut token)?;
    core.Navigate(&HSTRING::from(address))
  }
}
