// The video player window: its pages, its shape, its taskbar button, and the own Twitch player's
// address (https://syncr-video.localhost). Its extensions are in video_extensions.rs.
use super::video_extensions;
use tauri::Manager;

// The video player window (videoPlayer.ts): two separate pages in one window, our bar
// (public/video-bar.html) above the real site, so the site can't touch or fake the bar. A third
// one, hidden, is the bar's menu (public/video-menu.html). The site is in no capability file, and
// they have their own storage folder, apart from the notes. The next
// video replaces the current one, closed first so the window-state plugin remembers its place and
// size. The site's address is either a site's page or our page that forwards to YouTube's player
// (public/video-forward.html).
pub const VIDEO_WINDOW: &str = "video-player";
pub const VIDEO_BAR: &str = "video-player-bar";
pub const VIDEO_SITE: &str = "video-player-site";
pub const VIDEO_MENU: &str = "video-player-menu";
// See video-watch.js
pub const VIDEO_REQUEST: &str = "syncr-video.invalid";

// The own Twitch player (player/player.js). Its page lives at its own address,
// https://syncr-video.localhost, which has no permissions at all (capabilities/). The same address
// fetches the video, because Twitch's video servers don't let a page read their answers, while
// Rust isn't held to that. /v/<host>/<path> fetches https://<host>/<path>, only from Twitch's
// video addresses.
fn twitch_host(host: &str) -> bool {
  host.ends_with(".ttvnw.net") || host.ends_with(".twitch.tv") || host.ends_with(".cloudfront.net")
}

// Playlists name their pieces by full address: those must come through /v/ too. A piece with its
// sound cut is listed as "-unmuted", but only its "-muted" file can be fetched.
fn local_playlist(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  for line in text.lines() {
    match line.strip_prefix("https://") {
      Some(rest) if rest.split('/').next().is_some_and(twitch_host) => {
        out.push_str("/v/");
        out.push_str(rest);
      }
      _ => match line.strip_suffix("-unmuted.ts") {
        Some(start) => {
          out.push_str(start);
          out.push_str("-muted.ts");
        }
        None => out.push_str(line),
      },
    }
    out.push('\n');
  }
  out
}

fn player_client() -> &'static reqwest::Client {
  use std::sync::OnceLock;
  use std::time::Duration;
  static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
  CLIENT.get_or_init(|| {
    // Same as the updater, which may or may not have done this first
    if rustls::crypto::CryptoProvider::get_default().is_none() {
      let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
      .connect_timeout(Duration::from_secs(10))
      .read_timeout(Duration::from_secs(30))
      .redirect(reqwest::redirect::Policy::custom(|attempt| {
        let allowed = attempt.url().scheme() == "https" && attempt.url().host_str().is_some_and(twitch_host);
        if allowed && attempt.previous().len() < 5 { attempt.follow() } else { attempt.stop() }
      }))
      .build()
      .unwrap_or_default()
  })
}

// One value of an address's ?a=1&b=2 part, as it is (not decoded)
fn query_value<'a>(uri: &'a tauri::http::Uri, name: &str) -> Option<&'a str> {
  uri.query()?.split('&').find_map(|pair| pair.split_once('=').filter(|(key, _)| *key == name)).map(|(_, value)| value)
}

pub async fn player_answer(app: tauri::AppHandle, uri: tauri::http::Uri) -> tauri::http::Response<Vec<u8>> {
  use tauri::http::Response;
  use tauri::Emitter;
  let answer = |status: u16, kind: &str, body: Vec<u8>| {
    let mut response = Response::builder().status(status).header("Content-Type", kind);
    if kind == "text/html" {
      response = response.header(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; connect-src 'self' https://gql.twitch.tv https://api.betterttv.net https://api.frankerfacez.com https://7tv.io; media-src blob: data:; img-src https://static-cdn.jtvnw.net https://cdn.betterttv.net https://cdn.frankerfacez.com https://cdn.7tv.app 'self'; worker-src blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      );
    }
    response.body(body).unwrap_or_default()
  };
  let number = |name: &str| query_value(&uri, name)?.parse::<f64>().ok().filter(|value| value.is_finite());
  let path = uri.path();
  match path {
    "/player.html" => return answer(200, "text/html", include_bytes!("../player/player.html").to_vec()),
    "/player.js" => return answer(200, "text/javascript", include_bytes!("../player/player.js").to_vec()),
    "/chat.js" => return answer(200, "text/javascript", include_bytes!("../player/chat.js").to_vec()),
    "/timeline.js" => return answer(200, "text/javascript", include_bytes!("../player/timeline.js").to_vec()),
    "/hls.min.js" => return answer(200, "text/javascript", include_bytes!("../player/hls.min.js").to_vec()),
    // How far the video is (video-watch.js), from any page in the player window, so a site could
    // fake it: only numbers pass, and all it can change is the current video's position and Watched mark
    "/position" => {
      if let (Some(t), Some(length)) = (number("t"), number("length")) {
        let _ = app.emit_to("main", "video-position", serde_json::json!({ "t": t, "length": length }));
      }
      return answer(204, "text/plain", Vec::new());
    }
    // The video's shape (player.js, video-watch.js). Also open to any site in the window: only
    // sensible numbers pass, and all it can do is change this window's size within the screen.
    "/fit" => {
      if let (Some(ratio), Some(beside)) = (number("ratio"), number("beside")) {
        if (0.2..=5.0).contains(&ratio) && (0.0..=20000.0).contains(&beside) {
          *VIDEO_SHAPE.lock().unwrap() = Some((ratio, beside));
          // While the mouse holds an edge, letting go does it (settle_video_window)
          if let (Some(window), false) = (app.get_window(VIDEO_WINDOW), left_button_down()) {
            fit_video_window(&window, false);
          }
        }
      }
      return answer(204, "text/plain", Vec::new());
    }
    // Subtitles turned on or off by hand (video-watch.js). Also open to any site in the window: the
    // app only takes it for the video that's open, and it only changes that channel's subtitles.
    "/subtitles" => {
      if let (Some(on), Some(video)) = (query_value(&uri, "on"), query_value(&uri, "video")) {
        let _ = app.emit_to("main", "video-subtitles", serde_json::json!({ "on": on == "1", "video": video }));
      }
      return answer(204, "text/plain", Vec::new());
    }
    _ => {}
  }
  // A past stream's main playlist, token included (twitch.rs). 404: the video doesn't exist or
  // Twitch says no (the player then tries Twitch's page); 502: try again.
  if let Some(video) = path.strip_prefix("/twitch/").and_then(|rest| rest.strip_suffix(".m3u8")) {
    if !crate::twitch::valid_video(video) {
      return answer(404, "text/plain", Vec::new());
    }
    let token = match crate::twitch::token(player_client(), video).await {
      Ok(Some(token)) => token,
      Ok(None) => return answer(404, "text/plain", Vec::new()),
      Err(()) => return answer(502, "text/plain", Vec::new()),
    };
    let Ok(response) = player_client().get(crate::twitch::usher_url(video, &token)).send().await else {
      return answer(502, "text/plain", Vec::new());
    };
    let status = response.status().as_u16();
    let Ok(body) = response.bytes().await else {
      return answer(502, "text/plain", Vec::new());
    };
    return answer(status, "application/vnd.apple.mpegurl", local_playlist(&String::from_utf8_lossy(&body)).into_bytes());
  }
  let Some((host, rest)) = path.strip_prefix("/v/").and_then(|rest| rest.split_once('/')) else {
    return answer(404, "text/plain", Vec::new());
  };
  if !twitch_host(host) {
    return answer(403, "text/plain", Vec::new());
  }
  let query = uri.query().map(|query| format!("?{query}")).unwrap_or_default();
  let Ok(response) = player_client().get(format!("https://{host}/{rest}{query}")).send().await else {
    return answer(502, "text/plain", Vec::new());
  };
  let status = response.status().as_u16();
  let Ok(body) = response.bytes().await else {
    return answer(502, "text/plain", Vec::new());
  };
  if rest.ends_with(".m3u8") {
    return answer(status, "application/vnd.apple.mpegurl", local_playlist(&String::from_utf8_lossy(&body)).into_bytes());
  }
  // Preview pictures and their list; the rest is video
  let kind = if rest.ends_with(".jpg") { "image/jpeg" } else if rest.ends_with(".json") { "application/json" } else { "video/mp2t" };
  answer(status, kind, body.to_vec())
}

// All pages of the player's storage folder must start the same way (also video_extensions.rs). A
// video opened by a click should play: without this switch the browser refuses to start it.
pub const VIDEO_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

// Bar on top and the site below. In full screen (the player's button: Tauri does it by itself)
// only the site.
fn place_video_pages(window: &tauri::Window, bar_height: f64) {
  use tauri::{PhysicalPosition, PhysicalSize, Rect};
  let (Some(bar), Some(site)) = (window.get_webview(VIDEO_BAR), window.get_webview(VIDEO_SITE)) else {
    return;
  };
  let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else {
    return;
  };
  if size.width == 0 || size.height == 0 {
    return; // minimized
  }
  let fullscreen = window.is_fullscreen().unwrap_or(false);
  let top = if fullscreen { 0 } else { ((bar_height * scale).round() as u32).min(size.height) };
  let _ = if fullscreen { bar.hide() } else { bar.show() };
  let _ = bar.set_bounds(Rect {
    position: PhysicalPosition::new(0, 0).into(),
    size: PhysicalSize::new(size.width, top).into(),
  });
  let _ = site.set_bounds(Rect {
    position: PhysicalPosition::new(0, top as i32).into(),
    size: PhysicalSize::new(size.width, size.height - top).into(),
  });
}

// The player window takes the video's shape, so there are no black bars: on opening, when the chat
// changes and after letting go of an edge. Its width stays and its height follows; after dragging
// only the height, the other way round, or that edge couldn't be moved. Never maximized or in full
// screen, where it has to fill the screen.
// The video's width / height, and the pixels the chat takes beside it
static VIDEO_SHAPE: std::sync::Mutex<Option<(f64, f64)>> = std::sync::Mutex::new(None);
static VIDEO_SIZE: std::sync::Mutex<(u32, u32)> = std::sync::Mutex::new((0, 0)); // as it last fitted
static VIDEO_BAR_HEIGHT: std::sync::Mutex<f64> = std::sync::Mutex::new(0.0);
static VIDEO_RESIZES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[cfg(windows)]
fn left_button_down() -> bool {
  use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
  unsafe { GetAsyncKeyState(VK_LBUTTON as i32) < 0 }
}

#[cfg(not(windows))]
fn left_button_down() -> bool {
  false
}

fn fit_video_window(window: &tauri::Window, change_width: bool) {
  use tauri::{PhysicalPosition, PhysicalSize};
  let Some((ratio, beside)) = *VIDEO_SHAPE.lock().unwrap() else {
    return;
  };
  if window.is_fullscreen().unwrap_or(true) || window.is_maximized().unwrap_or(true) || window.is_minimized().unwrap_or(true) {
    return;
  }
  let (Ok(size), Ok(scale), Ok(place), Ok(Some(monitor))) = (window.inner_size(), window.scale_factor(), window.outer_position(), window.current_monitor()) else {
    return;
  };
  let bar = (*VIDEO_BAR_HEIGHT.lock().unwrap() * scale).round();
  let height_for = |width: f64| (width - beside).max(1.0) / ratio + bar;
  let width_for = |height: f64| (height - bar).max(1.0) * ratio + beside;
  let screen = monitor.work_area();
  let (mut width, mut height) = (size.width as f64, size.height as f64);
  if change_width {
    width = width_for(height);
  } else {
    height = height_for(width);
  }
  // Not bigger than the screen, not smaller than the window can be
  if height > screen.size.height as f64 {
    height = screen.size.height as f64;
    width = width_for(height);
  }
  if width > screen.size.width as f64 {
    width = screen.size.width as f64;
    height = height_for(width);
  }
  if width < 480.0 * scale {
    width = 480.0 * scale;
    height = height_for(width);
  }
  let height = height.max(300.0 * scale).round() as u32;
  let width = width.round() as u32;
  if width.abs_diff(size.width) <= 1 && height.abs_diff(size.height) <= 1 {
    *VIDEO_SIZE.lock().unwrap() = (size.width, size.height);
    return;
  }
  *VIDEO_SIZE.lock().unwrap() = (width, height);
  let _ = window.set_size(PhysicalSize::new(width, height));
  // Grown past the screen's edge: back on it
  let right = screen.position.x + screen.size.width as i32;
  let bottom = screen.position.y + screen.size.height as i32;
  let x = place.x.min(right - width as i32).max(screen.position.x);
  let y = place.y.min(bottom - height as i32).max(screen.position.y);
  if x != place.x || y != place.y {
    let _ = window.set_position(PhysicalPosition::new(x, y));
  }
}

// A size that isn't the one fitted: someone is dragging an edge. Fits once it's been let go.
fn settle_video_window(window: &tauri::Window, now: tauri::PhysicalSize<u32>) {
  use std::sync::atomic::Ordering;
  if now.width == 0 || now.height == 0 || (now.width, now.height) == *VIDEO_SIZE.lock().unwrap() {
    return;
  }
  let this = VIDEO_RESIZES.fetch_add(1, Ordering::SeqCst) + 1;
  let window = window.clone();
  std::thread::spawn(move || {
    std::thread::sleep(std::time::Duration::from_millis(300));
    while left_button_down() && VIDEO_RESIZES.load(Ordering::SeqCst) == this {
      std::thread::sleep(std::time::Duration::from_millis(50));
    }
    if VIDEO_RESIZES.load(Ordering::SeqCst) != this {
      return;
    }
    let Ok(size) = window.inner_size() else {
      return;
    };
    let (width, height) = *VIDEO_SIZE.lock().unwrap();
    fit_video_window(&window, size.width == width && size.height != height);
  });
}

fn close_video_window(app: &tauri::AppHandle) -> Result<(), String> {
  let Some(current) = app.get_window(VIDEO_WINDOW) else {
    return Ok(());
  };
  current.close().map_err(|e| e.to_string())?;
  for tries in 0..40 {
    if app.get_window(VIDEO_WINDOW).is_none() {
      break;
    }
    if tries == 30 {
      let _ = current.destroy(); // a site asking "leave this page?"
    }
    std::thread::sleep(std::time::Duration::from_millis(50));
  }
  Ok(())
}

// bar: what the bar shows, already encoded for an address. bar_height: in the app's scale.
// SyncR's own pages shown in the site's place
fn is_video_page(address: &str) -> bool {
  address.starts_with("video-forward.html?v=") || address.starts_with("video-stopped.html?data=")
}

// The player window gets its own taskbar button, apart from SyncR's: Windows groups windows by
// their app id, so it gets one of its own. No shortcut has this id, so a pinned button would lead
// nowhere (pinning isn't wanted). Its icon is the video's site's (icons/video-*.rgba: 64 x 64,
// raw pixels, drawn from VideoLogo.tsx's logos).
#[cfg(windows)]
const VIDEO_APP_ID: &str = "com.logiinx.syncr.video";

#[cfg(windows)]
fn own_taskbar_button(window: &tauri::Window, site: &str) {
  use windows::core::PWSTR;
  use windows::Win32::Foundation::HWND;
  use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
  use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
  use windows::Win32::System::Variant::VT_LPWSTR;
  use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
  let icon: &'static [u8] = if site == "twitch" {
    include_bytes!("../icons/video-twitch.rgba")
  } else {
    include_bytes!("../icons/video-youtube.rgba")
  };
  if let Err(e) = window.set_icon(tauri::image::Image::new(icon, 64, 64)) {
    log::warn!("Video window icon: {e}");
  }
  let Ok(hwnd) = window.hwnd() else { return };
  // As a number: a window handle can't be sent to another thread
  let raw = hwnd.0 as isize;
  // On the main thread, where COM is set up, and before the window shows (same queue)
  let _ = window.app_handle().run_on_main_thread(move || unsafe {
    let store = match SHGetPropertyStoreForWindow::<IPropertyStore>(HWND(raw as *mut _)) {
      Ok(store) => store,
      Err(e) => return log::warn!("Video window app id: {e}"),
    };
    // A plain wide string (VT_LPWSTR), as Windows wants for this property. The text is ours, so
    // ManuallyDrop keeps the value from freeing it as if Windows had made it.
    let id: Vec<u16> = VIDEO_APP_ID.encode_utf16().chain([0]).collect();
    let mut value = std::mem::ManuallyDrop::new(PROPVARIANT::default());
    let inner = &mut value.Anonymous.Anonymous;
    inner.vt = VT_LPWSTR;
    inner.Anonymous.pwszVal = PWSTR(id.as_ptr() as *mut u16);
    if let Err(e) = store.SetValue(&PKEY_AppUserModel_ID, &*value).and_then(|()| store.Commit()) {
      log::warn!("Video window app id: {e}");
    }
  });
}

// site: "youtube" or "twitch", for the taskbar button's icon
#[tauri::command]
pub async fn open_video_player(
  app: tauri::AppHandle,
  address: String,
  title: String,
  site: String,
  bar: String,
  bar_height: f64,
  always_on_top: bool,
) -> Result<(), String> {
  use std::sync::atomic::{AtomicBool, Ordering};
  use tauri::utils::config::Color;
  use tauri::webview::WebviewBuilder;
  use tauri::window::WindowBuilder;
  use tauri::{PhysicalPosition, PhysicalSize, WebviewUrl, WindowEvent};
  let url = if is_video_page(&address) {
    WebviewUrl::App(address.into())
  } else {
    let url = tauri::Url::parse(&address).map_err(|e| e.to_string())?;
    if url.scheme() != "https" {
      return Err("Not a web address".to_string());
    }
    WebviewUrl::External(url)
  };
  close_video_window(&app)?;
  let folder = video_extensions::player_folder(&app)?;
  let requests = app.clone();
  // With its border for now: the window-state plugin removes it here before restoring the size.
  // Without this change a new window still counts a title bar, and each opening gets that much
  // taller.
  let window = WindowBuilder::new(&app, VIDEO_WINDOW)
    .title(title)
    .inner_size(1280.0, 760.0)
    .min_inner_size(480.0, 300.0)
    .center()
    .always_on_top(always_on_top)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
  #[cfg(windows)]
  own_taskbar_button(&window, &site);
  #[cfg(not(windows))]
  let _ = site;
  let size = window.inner_size().map_err(|e| e.to_string())?;
  window
    .add_child(
      WebviewBuilder::new(VIDEO_BAR, WebviewUrl::App(format!("video-bar.html?data={bar}").into()))
        .background_color(Color(0x16, 0x16, 0x16, 255))
        .use_https_scheme(true)
        .additional_browser_args(VIDEO_ARGS)
        .browser_extensions_enabled(true)
        .data_directory(folder.clone())
        .on_navigation(|url| url.path() == "/video-bar.html"),
      PhysicalPosition::new(0, 0),
      PhysicalSize::new(size.width, 1),
    )
    .map_err(|e| e.to_string())?;
  let site = window
    .add_child(
      WebviewBuilder::new(VIDEO_SITE, url)
        .background_color(Color(0, 0, 0, 255))
        .use_https_scheme(true)
        .additional_browser_args(VIDEO_ARGS)
        .browser_extensions_enabled(true)
        .data_directory(folder)
        .initialization_script_for_all_frames(include_str!("video-watch.js"))
        .on_navigation(move |url| {
          if url.host_str() == Some(VIDEO_REQUEST) {
            use tauri::Emitter;
            let value = |name: &str| url.query_pairs().find(|(key, _)| key == name).map(|(_, value)| value.into_owned());
            // /refused (video-watch.js), /failed (player.js) or /browser (video-stopped.html's button,
            // only obeyed there)
            let _ = requests.emit_to("main", "video-site", serde_json::json!({ "request": url.path(), "code": value("code"), "video": value("video") }));
            return false;
          }
          // A site can't send this window to SyncR's own pages
          url.host_str() != Some("tauri.localhost") || url.path() == "/video-forward.html" || url.path() == "/video-stopped.html"
        }),
      PhysicalPosition::new(0, 1),
      size,
    )
    .map_err(|e| e.to_string())?;
  // After the site, so it lies on top of it
  let menu = window
    .add_child(
      WebviewBuilder::new(VIDEO_MENU, WebviewUrl::App(format!("video-menu.html?data={bar}").into()))
        .background_color(Color(0x20, 0x20, 0x20, 255))
        .use_https_scheme(true)
        .additional_browser_args(VIDEO_ARGS)
        .browser_extensions_enabled(true)
        .data_directory(video_extensions::player_folder(&app)?)
        .focused(false)
        .on_navigation(|url| url.path() == "/video-menu.html"),
      PhysicalPosition::new(0, 0),
      PhysicalSize::new(1, 1),
    )
    .map_err(|e| e.to_string())?;
  let _ = menu.hide();
  video_extensions::menu_is_new();
  // On its first opening, or after an older version, the plugin left the border on
  let _ = window.set_decorations(false);
  // The resize edges of a borderless window sit under pages added later: this makes new ones on top
  let _ = window.set_resizable(false);
  let _ = window.set_resizable(true);
  // The app was quit while in full screen: the site isn't anymore, and there'd be no bar to get out
  let _ = window.set_fullscreen(false);
  place_video_pages(&window, bar_height);
  *VIDEO_SHAPE.lock().unwrap() = None;
  *VIDEO_BAR_HEIGHT.lock().unwrap() = bar_height;
  if let Ok(size) = window.inner_size() {
    *VIDEO_SIZE.lock().unwrap() = (size.width, size.height);
  }
  let moved = window.clone();
  let was_maximized = AtomicBool::new(false);
  window.on_window_event(move |event| {
    let fullscreen = moved.is_fullscreen().unwrap_or(false);
    match event {
      // Full screen from a maximized window: it stays the size of the screen without the taskbar,
      // and no resize comes to hide the bar (only this move). So full screen from a normal window.
      WindowEvent::Moved(_) if fullscreen && moved.is_maximized().unwrap_or(false) => {
        let _ = moved.set_fullscreen(false);
        let _ = moved.unmaximize();
        let _ = moved.set_fullscreen(true);
        was_maximized.store(true, Ordering::SeqCst);
      }
      WindowEvent::Resized(new) => {
        if !fullscreen && was_maximized.swap(false, Ordering::SeqCst) {
          let _ = moved.maximize();
        }
        place_video_pages(&moved, bar_height);
        settle_video_window(&moved, *new);
        if let Some(bar) = moved.get_webview(VIDEO_BAR) {
          let maximized = moved.is_maximized().unwrap_or(false);
          let _ = bar.eval(format!("window.setMaximized?.({maximized})"));
        }
      }
      // Out of full screen first, or the plugin remembers the size of the screen
      WindowEvent::CloseRequested { api, .. } if fullscreen => {
        api.prevent_close();
        let _ = moved.set_fullscreen(false);
        let _ = moved.close();
      }
      _ => {}
    }
  });
  window.show().map_err(|e| e.to_string())?;
  let _ = window.set_focus();
  let _ = site.set_focus();
  // The site holds the extensions' storage now (video_extensions.rs)
  if let Some(host) = app.get_webview_window(video_extensions::HOST) {
    let _ = host.destroy();
  }
  Ok(())
}

// The clicks on the video bar. What needs the notes' database goes on to the main window
// (videoPlayer.ts).
#[tauri::command]
pub fn video_bar(
  app: tauri::AppHandle,
  webview: tauri::Webview,
  action: String,
  on: Option<bool>,
  left: Option<f64>,
  at: Option<f64>,
) -> Result<(), String> {
  use tauri::Emitter;
  if webview.label() != VIDEO_BAR {
    return Err("Only for the video bar".to_string());
  }
  let window = webview.window();
  let result = match action.as_str() {
    "ready" => {
      let maximized = window.is_maximized().unwrap_or(false);
      video_extensions::bar_ready(app);
      return webview.eval(format!("window.setMaximized({maximized})")).map_err(|e| e.to_string());
    }
    // left, at: the button's left edge and middle, in pixels from the window's left edge
    "extensions-menu" => {
      let (Some(left), Some(at)) = (left, at) else {
        return Err("Where's the button?".to_string());
      };
      std::thread::spawn(move || video_extensions::toggle_menu(&app, left, at));
      return Ok(());
    }
    "drag" => window.start_dragging(),
    "minimize" => window.minimize(),
    "maximize" => {
      if window.is_maximized().unwrap_or(false) { window.unmaximize() } else { window.maximize() }
    }
    "close" => return window.close().map_err(|e| e.to_string()),
    "always-on-top" | "watched" | "browser" | "another-way" => {
      if action == "always-on-top" {
        window.set_always_on_top(on.unwrap_or(false)).map_err(|e| e.to_string())?;
      }
      app.emit_to("main", "video-bar", serde_json::json!({ "action": action, "on": on }))
    }
    _ => return Err("Unknown action".to_string()),
  };
  // The keyboard goes back to the video (space, arrows)
  if let Some(site) = window.get_webview(VIDEO_SITE) {
    let _ = site.set_focus();
  }
  result.map_err(|e| e.to_string())
}

// Where to send the site's page: one of SyncR's own pages (next to the bar's), or an https address
fn video_site_url(bar: &tauri::Webview, address: &str) -> Result<tauri::Url, String> {
  if is_video_page(address) {
    return bar.url().map_err(|e| e.to_string())?.join(address).map_err(|e| e.to_string());
  }
  let url = tauri::Url::parse(address).map_err(|e| e.to_string())?;
  if url.scheme() != "https" {
    return Err("Not a web address".to_string());
  }
  Ok(url)
}

fn show_video_way(bar: &tauri::Webview, via: &str, note: &str, note_stays: bool) -> Result<(), String> {
  let via = serde_json::to_string(via).map_err(|e| e.to_string())?;
  let note = serde_json::to_string(note).map_err(|e| e.to_string())?;
  bar.eval(format!("window.setVia?.({via}, {note}, {note_stays})")).map_err(|e| e.to_string())
}

// Opens the same video another way (videoPlayer.ts), and the bar says which
#[tauri::command]
pub fn video_player_way(app: tauri::AppHandle, address: String, via: String, note: String, note_stays: bool) -> Result<(), String> {
  let (Some(site), Some(bar)) = (app.get_webview(VIDEO_SITE), app.get_webview(VIDEO_BAR)) else {
    return Ok(()); // closed in the meantime
  };
  site.navigate(video_site_url(&bar, &address)?).map_err(|e| e.to_string())?;
  show_video_way(&bar, &via, &note, note_stays)
}

// The next video of a playlist (videoPlayer.ts): in the same window, which stays where it is. A new
// page would leave full screen, so while in it YouTube's page plays the video itself (video-watch.js);
// where it can't, as on another site, a new page it is. in_place: the next video opens the same way
// as this one (our own YouTube page), so the bar's "via" stays true.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn video_player_next(app: tauri::AppHandle, address: String, video: String, start: u64, subtitles: bool, in_place: bool, title: String, via: String, note: String, note_stays: bool) -> Result<(), String> {
  let (Some(window), Some(site), Some(bar)) = (app.get_window(VIDEO_WINDOW), app.get_webview(VIDEO_SITE), app.get_webview(VIDEO_BAR)) else {
    return Ok(()); // closed in the meantime
  };
  let url = video_site_url(&bar, &address)?;
  let _ = window.set_title(&title);
  *VIDEO_SHAPE.lock().unwrap() = None;
  let title = serde_json::to_string(&title).map_err(|e| e.to_string())?;
  bar.eval(format!("window.setTitle?.({title})")).map_err(|e| e.to_string())?;
  if in_place && window.is_fullscreen().unwrap_or(false) {
    let video = serde_json::to_string(&video).map_err(|e| e.to_string())?;
    let url = serde_json::to_string(url.as_str()).map_err(|e| e.to_string())?;
    site.eval(format!("if (!window.syncrNextVideo?.({video}, {start}, {subtitles})) location.href = {url}")).map_err(|e| e.to_string())?;
  } else {
    site.navigate(url).map_err(|e| e.to_string())?;
  }
  show_video_way(&bar, &via, &note, note_stays)
}

// The main window tells the bar when a video's Watched mark changes (also from the list)
#[tauri::command]
pub fn video_player_watched(app: tauri::AppHandle, watched: bool) -> Result<(), String> {
  match app.get_webview(VIDEO_BAR) {
    Some(bar) => bar.eval(format!("window.setWatched?.({watched})")).map_err(|e| e.to_string()),
    None => Ok(()),
  }
}

#[tauri::command]
pub async fn close_video_player(app: tauri::AppHandle) -> Result<(), String> {
  close_video_window(&app)
}
