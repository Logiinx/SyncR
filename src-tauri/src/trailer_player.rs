// A game's trailer in SyncR's own YouTube player (GameExtrasView.tsx's trailer view): the video
// window's site page (our controls, its extensions, its storage), as a page of its own inside the
// main window, laid over the view's video box. The page in the main window places it (in the
// window's pixels) and hides it while something of SyncR's covers that box.
//
// It's in no capability file (capabilities/default.json covers only the "main" page), and its
// requests to https://syncr-video.localhost only get what can't touch the video window or the
// Video lists (player_answer in video_window.rs).
use super::video_extensions;
use super::video_window::{VIDEO_ARGS, VIDEO_REQUEST};
use std::sync::Mutex;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize};

pub const TRAILER: &str = "trailer-player";

// Where the page wants it (x, y, width, height, the radius of its bottom corners), kept for when
// the window leaves full screen
type Place = (i32, i32, u32, u32, u32);
static PLACE: Mutex<Option<Place>> = Mutex::new(None);
// The window was maximized when the trailer took it to full screen: maximized again after
static WAS_MAXIMIZED: Mutex<bool> = Mutex::new(false);

// Escape on the page, not in full screen: back to the game, like Escape on the view. Its own
// script, after the video window's ones.
const BACK_ON_ESCAPE: &str = r#"
addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || document.fullscreenElement || event.defaultPrevented) return
  fetch('https://syncr-video.localhost/trailer-back', { mode: 'no-cors', cache: 'no-store' }).catch(() => {})
}, true)
"#;

fn place(webview: &tauri::Webview, (x, y, width, height, radius): Place) {
  let _ = webview.set_position(PhysicalPosition::new(x, y));
  let _ = webview.set_size(PhysicalSize::new(width.max(1), height.max(1)));
  round_corners(webview, width.max(1), height.max(1), radius);
}

// The view's box has round bottom corners (the window's), a page is a plain rectangle: its own
// window is cut to the same shape. 0: square (full screen).
#[cfg(windows)]
fn round_corners(webview: &tauri::Webview, width: u32, height: u32, radius: u32) {
  use windows_sys::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};
  let _ = webview.with_webview(move |platform| unsafe {
    let mut parent = windows::Win32::Foundation::HWND::default();
    if platform.controller().ParentWindow(&mut parent).is_err() || parent.0.is_null() {
      return;
    }
    let hwnd = parent.0 as windows_sys::Win32::Foundation::HWND;
    if radius == 0 {
      SetWindowRgn(hwnd, std::ptr::null_mut(), 1);
      return;
    }
    let (width, height, radius) = (width as i32, height as i32, radius as i32);
    // The top corners lie above the window, so only the bottom ones are round. Windows owns the
    // shape once set (no DeleteObject).
    let shape = CreateRoundRectRgn(0, -radius, width + 1, height + 1, radius * 2, radius * 2);
    if !shape.is_null() {
      SetWindowRgn(hwnd, shape, 1);
    }
  });
}

#[cfg(not(windows))]
fn round_corners(_webview: &tauri::Webview, _width: u32, _height: u32, _radius: u32) {}

// address: video-forward.html's, as for the video window (videoPlayer.ts). x, y, width, height,
// radius: the box in the window's pixels.
#[tauri::command]
pub async fn open_trailer_player(app: tauri::AppHandle, address: String, x: i32, y: i32, width: u32, height: u32, radius: u32) -> Result<(), String> {
  use tauri::utils::config::Color;
  use tauri::webview::WebviewBuilder;
  use tauri::WebviewUrl;
  if !address.starts_with("video-forward.html?v=") {
    return Err("Not a trailer".to_string());
  }
  close(&app);
  let window = app.get_window("main").ok_or("No main window")?;
  let requests = app.clone();
  *PLACE.lock().unwrap() = Some((x, y, width, height, radius));
  let page = window
    .add_child(
      WebviewBuilder::new(TRAILER, WebviewUrl::App(address.into()))
        .background_color(Color(0, 0, 0, 255))
        .use_https_scheme(true)
        .additional_browser_args(VIDEO_ARGS)
        .browser_extensions_enabled(true)
        .data_directory(video_extensions::player_folder(&app)?)
        .initialization_script_for_all_frames(concat!(
          "(() => {\n",
          include_str!("../player/controls.js"),
          "\n;",
          include_str!("../player/startSkip.js"),
          "\n;",
          include_str!("video-watch.js"),
          "\n})()"
        ))
        .initialization_script_for_all_frames(BACK_ON_ESCAPE)
        .on_navigation(move |url| {
          // YouTube refused it (video-watch.js): the view says so, "Open on YouTube" is there
          if url.host_str() == Some(VIDEO_REQUEST) {
            if url.path() == "/refused" {
              let _ = requests.emit_to("main", "trailer-refused", ());
            }
            return false;
          }
          url.host_str() != Some("tauri.localhost") || url.path() == "/video-forward.html"
        }),
      PhysicalPosition::new(x, y),
      PhysicalSize::new(width.max(1), height.max(1)),
    )
    .map_err(|e| e.to_string())?;
  round_corners(&page, width.max(1), height.max(1), radius);
  Ok(())
}

#[tauri::command]
pub fn place_trailer_player(app: tauri::AppHandle, x: i32, y: i32, width: u32, height: u32, radius: u32) {
  *PLACE.lock().unwrap() = Some((x, y, width, height, radius));
  let Some(window) = app.get_window("main") else { return };
  // In full screen it fills the window (follow_window)
  if window.is_fullscreen().unwrap_or(false) {
    return;
  }
  if let Some(webview) = app.get_webview(TRAILER) {
    place(&webview, (x, y, width, height, radius));
  }
}

// Hidden while something of SyncR's covers its box (a menu, a window)
#[tauri::command]
pub fn show_trailer_player(app: tauri::AppHandle, show: bool) {
  if let Some(webview) = app.get_webview(TRAILER) {
    let _ = if show { webview.show() } else { webview.hide() };
  }
}

#[tauri::command]
pub fn close_trailer_player(app: tauri::AppHandle) {
  close(&app);
}

fn close(app: &tauri::AppHandle) {
  let Some(webview) = app.get_webview(TRAILER) else { return };
  let _ = webview.close();
  *PLACE.lock().unwrap() = None;
  // Its full screen ends with it
  if let Some(window) = app.get_window("main") {
    if window.is_fullscreen().unwrap_or(false) {
      let _ = window.set_fullscreen(false);
      if std::mem::take(&mut *WAS_MAXIMIZED.lock().unwrap()) {
        let _ = window.maximize();
      }
    }
  }
}

// The main window's moves and resizes (lib.rs). The page's full screen button makes the whole
// window full screen (Tauri does that for any page): the trailer fills it, then goes back to its box.
pub fn follow_window(window: &tauri::Window, event: &tauri::WindowEvent) {
  let Some(webview) = window.get_webview(TRAILER) else { return };
  let fullscreen = window.is_fullscreen().unwrap_or(false);
  match event {
    // Full screen from a maximized window stays the size of the screen without the taskbar (as in
    // the video window): from a normal one instead, maximized again after
    tauri::WindowEvent::Moved(_) if fullscreen && window.is_maximized().unwrap_or(false) => {
      let _ = window.set_fullscreen(false);
      let _ = window.unmaximize();
      let _ = window.set_fullscreen(true);
      *WAS_MAXIMIZED.lock().unwrap() = true;
    }
    tauri::WindowEvent::Resized(size) => {
      if fullscreen {
        let _ = webview.show(); // nothing of SyncR's shows over it now
        place(&webview, (0, 0, size.width, size.height, 0));
        return;
      }
      if std::mem::take(&mut *WAS_MAXIMIZED.lock().unwrap()) {
        let _ = window.maximize();
      }
      if let Some(spot) = *PLACE.lock().unwrap() {
        place(&webview, spot);
      }
    }
    _ => {}
  }
}

// Escape on the page (BACK_ON_ESCAPE), from player_answer
pub fn back(app: &tauri::AppHandle) {
  if app.get_webview(TRAILER).is_some() {
    let _ = app.emit_to("main", "trailer-back", ());
  }
}
