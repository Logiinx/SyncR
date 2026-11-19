// The video player window: its pages, its shape, its taskbar button, and the own Twitch player's
// address (https://syncr-video.localhost). Its extensions are in video_extensions.rs.
use super::video_extensions;
use tauri::Manager;

// The video player window (videoPlayer.ts): two separate pages in one window, our bar
// (public/video-bar.html) above the real site, so the site can't touch or fake the bar. A third
// one, hidden, is the bar's menu (public/video-menu.html). The site is in no capability file, and
// they have their own storage folder, apart from the notes. The next
// video replaces the current one, closed first so its place is saved (VideoPlace). The site's address is either a site's page or our page that forwards to YouTube's player
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
// sound cut can be listed as "-unmuted" (always in a video folder's own list), but its "-muted"
// file is the one that's sure to be there. (player.js tries the uncut sound itself.)
fn local_playlist(text: &str) -> String {
  let mut out = String::with_capacity(text.len());
  for line in text.lines() {
    match line.strip_prefix("https://") {
      Some(rest) if rest.split('/').next().is_some_and(twitch_host) => {
        out.push_str("/v/");
        out.push_str(rest);
      }
      _ => match line.strip_suffix("-unmuted.ts").map(|start| (start, "-muted.ts")).or_else(|| line.strip_suffix("-unmuted.mp4").map(|start| (start, "-muted.mp4"))) {
        Some((start, end)) => {
          out.push_str(start);
          out.push_str(end);
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

// A Twitch video's list of qualities, asked while its player window opens (Twitch's access pass,
// then the list), so the page finds it ready (player.js, twitchList): ~0.4 s sooner. Only the
// latest video's, taken once. None: something failed, the page asks itself.
type EarlyList = tauri::async_runtime::JoinHandle<Option<(u16, Vec<u8>)>>;
static EARLY_LIST: std::sync::Mutex<Option<(String, EarlyList)>> = std::sync::Mutex::new(None);

fn start_early_list(address: &str) {
  let video = address
    .strip_prefix("https://syncr-video.localhost/player.html?")
    .and_then(|query| query.split('&').find_map(|pair| pair.strip_prefix("video=")))
    .filter(|id| !id.is_empty() && id.len() <= 20 && id.bytes().all(|byte| byte.is_ascii_digit()))
    .map(str::to_owned);
  // On a thread of its own: a plain spawn would wait until open_video_player lets go of its
  // thread, once the window is built (~0.4 s later, measured)
  let start = |video: String| tauri::async_runtime::spawn_blocking(move || tauri::async_runtime::block_on(early_list(video)));
  *EARLY_LIST.lock().unwrap() = video.map(|video| (video.clone(), start(video)));
}

// The same questions as player.js's load. 200: the list · 403: Twitch says no (deleted, private,
// subscribers only), the page rebuilds it from the video's folders
async fn early_list(video: String) -> Option<(u16, Vec<u8>)> {
  const CLIENT_ID: &str = "kimne78kx3ncx6brgo4mv6wki5h1ko"; // the one Twitch's own website uses (as player.js)
  let query = r#"query($id: ID!) { video: videoPlaybackAccessToken(id: $id, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }"#;
  let body = serde_json::json!({ "query": query, "variables": { "id": video } }).to_string();
  let response = player_client().post("https://gql.twitch.tv/gql").header("Client-ID", CLIENT_ID).header("Content-Type", "application/json").body(body).send().await.ok()?;
  if !response.status().is_success() {
    return None;
  }
  let answer: serde_json::Value = serde_json::from_slice(&response.bytes().await.ok()?).ok()?;
  let token = &answer["data"]["video"];
  if token.is_null() {
    // An error instead of an answer is a hiccup on Twitch's side, not a missing video
    let hiccup = answer["errors"].as_array().is_some_and(|errors| !errors.is_empty());
    return if hiccup { None } else { Some((403, Vec::new())) };
  }
  let (value, signature) = (token["value"].as_str()?, token["signature"].as_str()?);
  let url = reqwest::Url::parse_with_params(
    &format!("https://usher.ttvnw.net/vod/{video}.m3u8"),
    &[("nauth", value), ("nauthsig", signature), ("allow_source", "true"), ("allow_audio_only", "false")],
  )
  .ok()?;
  let response = player_client().get(url).send().await.ok()?;
  let status = response.status().as_u16();
  if (400..500).contains(&status) && status != 429 {
    return Some((403, Vec::new()));
  }
  if status != 200 {
    return None;
  }
  let list = response.bytes().await.ok()?;
  Some((200, local_playlist(&String::from_utf8_lossy(&list)).into_bytes()))
}

// One value of an address's ?a=1&b=2 part, as it is (not decoded)
fn query_value<'a>(uri: &'a tauri::http::Uri, name: &str) -> Option<&'a str> {
  uri.query()?.split('&').find_map(|pair| pair.split_once('=').filter(|(key, _)| *key == name)).map(|(_, value)| value)
}

// from: the label of the page asking
pub async fn player_answer(app: tauri::AppHandle, from: String, uri: tauri::http::Uri, range: Option<String>) -> tauri::http::Response<Vec<u8>> {
  use tauri::http::Response;
  use tauri::Emitter;
  let answer = |status: u16, kind: &str, body: Vec<u8>| {
    let mut response = Response::builder().status(status).header("Content-Type", kind);
    if kind == "text/html" {
      response = response.header(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; connect-src 'self' https://gql.twitch.tv https://api.betterttv.net https://api.frankerfacez.com https://7tv.io; media-src blob: data:; img-src https://static-cdn.jtvnw.net https://i.ytimg.com https://cdn.betterttv.net https://cdn.frankerfacez.com https://cdn.7tv.app 'self' blob:; worker-src blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      );
    }
    response.body(body).unwrap_or_default()
  };
  let number = |name: &str| query_value(&uri, name)?.parse::<f64>().ok().filter(|value| value.is_finite());
  let path = uri.path();
  // A game's trailer (trailer_player.rs) only hides the pointer, goes back and gives its shape (to
  // its own box): its position, subtitles or ⏭ would land on the video window's video
  if from == super::trailer_player::TRAILER {
    if let (Some(ratio), "/fit") = (number("ratio"), path) {
      super::trailer_player::shape(&app, ratio);
    }
    #[cfg(windows)]
    if path == "/hide-pointer" {
      hide_pointer(&app, "main", super::trailer_player::TRAILER);
    }
    if path == "/trailer-back" {
      super::trailer_player::back(&app);
    }
    return answer(204, "text/plain", Vec::new());
  }
  match path {
    "/player.html" => return answer(200, "text/html", include_bytes!("../player/player.html").to_vec()),
    "/controls.js" => return answer(200, "text/javascript", include_bytes!("../player/controls.js").to_vec()),
    "/player.js" => return answer(200, "text/javascript", include_bytes!("../player/player.js").to_vec()),
    "/chat.js" => return answer(200, "text/javascript", include_bytes!("../player/chat.js").to_vec()),
    "/timeline.js" => return answer(200, "text/javascript", include_bytes!("../player/timeline.js").to_vec()),
    "/previews.js" => return answer(200, "text/javascript", include_bytes!("../player/previews.js").to_vec()),
    "/startSkip.js" => return answer(200, "text/javascript", include_bytes!("../player/startSkip.js").to_vec()),
    "/hls.min.js" => return answer(200, "text/javascript", include_bytes!("../player/hls.min.js").to_vec()),
    // The list asked while the window opened (start_early_list); 204: none, the page asks itself
    "/early" => {
      let video = query_value(&uri, "video").unwrap_or("");
      let task = {
        let mut early = EARLY_LIST.lock().unwrap();
        if early.as_ref().is_some_and(|(id, _)| id == video) { early.take() } else { None }
      };
      if let Some((_, task)) = task {
        if let Ok(Some((status, body))) = task.await {
          return answer(status, "application/vnd.apple.mpegurl", body);
        }
      }
      return answer(204, "text/plain", Vec::new());
    }
    // How far the video is (video-watch.js), from any page in the player window, so a site could
    // fake it: only numbers pass, and all it can change is the current video's position and Watched mark.
    // The video it's for, when the page knows (letters, digits, - and _ only; else none).
    "/position" => {
      if let (Some(t), Some(length)) = (number("t"), number("length")) {
        let video = query_value(&uri, "video")
          .filter(|id| id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
          .unwrap_or("");
        let _ = app.emit_to("main", "video-position", serde_json::json!({ "t": t, "length": length, "video": video }));
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
    // The channel's waiting screen, learned (startSkip.js): up to 8 tiny pictures as text (base64 with
    // - and _, joined with dots: nothing to unescape). Also open
    // to any site in the window: only that exact shape passes, and the app only keeps it for the
    // open video's channel, if followed (a fake one could at worst make that channel's skip wrong).
    "/looks" => {
      let look = |text: &str| text.len() == 576 && text.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
      if let (Some(looks), Some(video)) = (query_value(&uri, "looks"), query_value(&uri, "video")) {
        let looks: Vec<&str> = looks.split('.').collect();
        let video_ok = !video.is_empty() && video.len() <= 40 && video.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-');
        if video_ok && (1..=8).contains(&looks.len()) && looks.iter().all(|one| look(one)) {
          let _ = app.emit_to("main", "video-start-looks", serde_json::json!({ "video": video, "looks": looks }));
        }
      }
      return answer(204, "text/plain", Vec::new());
    }
    // The ⏭ button or Shift+N (controls.js): the app plays the next video of the list. Also open to
    // any site in the window: that's all it can do.
    "/next" => {
      let _ = app.emit_to("main", "video-next", ());
      return answer(204, "text/plain", Vec::new());
    }
    // The controls faded (controls.js): the pointer goes with them. The page's "cursor: none" alone
    // is sometimes only applied once the mouse moves (user, 2026-11-19, in the window). Also open to
    // any site in the window: all it can do is hide the pointer over the video until the mouse moves.
    "/hide-pointer" => {
      #[cfg(windows)]
      hide_pointer(&app, VIDEO_WINDOW, VIDEO_SITE);
      return answer(204, "text/plain", Vec::new());
    }
    // Something the bar should say, or "finished": a live stream is over (player.js). Also open to
    // any site in the window: only these words pass, and the app only takes them while our own
    // Twitch player shows that video.
    "/note" => {
      if let (Some(code @ ("subscriber" | "sound" | "finished")), Some(video)) = (query_value(&uri, "code"), query_value(&uri, "video")) {
        let _ = app.emit_to("main", "video-note", serde_json::json!({ "code": code, "video": video }));
      }
      return answer(204, "text/plain", Vec::new());
    }
    _ => {}
  }
  let Some((host, rest)) = path.strip_prefix("/v/").and_then(|rest| rest.split_once('/')) else {
    return answer(404, "text/plain", Vec::new());
  };
  if !twitch_host(host) {
    return answer(403, "text/plain", Vec::new());
  }
  let query = uri.query().map(|query| format!("?{query}")).unwrap_or_default();
  // Only the start of a piece (previews.js's own preview pictures): only "bytes=<from>-<to>" passes
  let range = range.filter(|value| {
    let numbers = |text: &str| !text.is_empty() && text.len() <= 12 && text.bytes().all(|byte| byte.is_ascii_digit());
    value.strip_prefix("bytes=").and_then(|span| span.split_once('-')).is_some_and(|(from, to)| numbers(from) && numbers(to))
  });
  let mut ask = player_client().get(format!("https://{host}/{rest}{query}"));
  if let Some(range) = &range {
    ask = ask.header(reqwest::header::RANGE, range);
  }
  let Ok(response) = ask.send().await else {
    return answer(502, "text/plain", Vec::new());
  };
  let status = response.status().as_u16();
  let part = response.headers().get(reqwest::header::CONTENT_RANGE).and_then(|value| value.to_str().ok()).map(str::to_owned);
  let Ok(body) = response.bytes().await else {
    return answer(502, "text/plain", Vec::new());
  };
  if rest.ends_with(".m3u8") {
    return answer(status, "application/vnd.apple.mpegurl", local_playlist(&String::from_utf8_lossy(&body)).into_bytes());
  }
  // Preview pictures and their list; the rest is video
  let kind = if rest.ends_with(".jpg") { "image/jpeg" } else if rest.ends_with(".json") { "application/json" } else { "video/mp2t" };
  match part {
    Some(part) if status == 206 => Response::builder().status(206).header("Content-Type", kind).header("Content-Range", part).body(body.to_vec()).unwrap_or_default(),
    _ => answer(status, kind, body.to_vec()),
  }
}

// All pages of the player's storage folder must start the same way (also video_extensions.rs). A
// video opened by a click should play: without this switch the browser refuses to start it.
pub const VIDEO_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

// Hides the pointer while it rests on the video (not the bar, not another window over it). Moving
// the mouse brings it back by itself: the page sets its own pointer again. Done on the main thread,
// whose input is shared with the video's page (a child window).
#[cfg(windows)]
fn hide_pointer(app: &tauri::AppHandle, window: &str, page: &str) {
  use tauri::Manager;
  use windows_sys::Win32::{
    Foundation::POINT,
    UI::WindowsAndMessaging::{GetAncestor, GetCursorPos, SetCursor, WindowFromPoint, GA_ROOT},
  };
  let Some(window) = app.get_window(window) else { return };
  let Some(site) = window.get_webview(page) else { return };
  let (Ok(hwnd), Ok(client), Ok(spot), Ok(size)) = (window.hwnd(), window.inner_position(), site.position(), site.size()) else {
    return;
  };
  let (left, top) = (client.x + spot.x, client.y + spot.y);
  let (right, bottom) = (left + size.width as i32, top + size.height as i32);
  // As a number: a window handle can't be sent to another thread
  let raw = hwnd.0 as isize;
  let _ = app.run_on_main_thread(move || unsafe {
    let mut point = POINT { x: 0, y: 0 };
    if GetCursorPos(&mut point) == 0 || point.x < left || point.x >= right || point.y < top || point.y >= bottom {
      return;
    }
    if GetAncestor(WindowFromPoint(point), GA_ROOT) as isize != raw {
      return;
    }
    SetCursor(std::ptr::null_mut());
  });
}

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

// Where the window was last: its place and size out of maximized, and whether it was maximized
// (closed in full screen counts as maximized). Saved in video-window.json in the app's data at each
// closing, put back at the next opening. Not the window-state plugin: it only writes to disk when
// the app quits cleanly.
#[derive(serde::Serialize, serde::Deserialize, Clone, Copy)]
struct VideoPlace {
  x: i32,
  y: i32,
  width: u32,
  height: u32,
  maximized: bool,
}
static VIDEO_PLACE: std::sync::Mutex<Option<VideoPlace>> = std::sync::Mutex::new(None);
// From the closing on, the moves out of full screen and maximized aren't the place to remember
static VIDEO_CLOSING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn video_place_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
  app.path().app_local_data_dir().ok().map(|folder| folder.join("video-window.json"))
}

fn save_video_place(app: &tauri::AppHandle) {
  let Some(place) = *VIDEO_PLACE.lock().unwrap() else {
    return;
  };
  let (Some(file), Ok(text)) = (video_place_file(app), serde_json::to_vec(&place)) else {
    return;
  };
  if let Some(folder) = file.parent() {
    let _ = std::fs::create_dir_all(folder);
  }
  let _ = std::fs::write(file, text);
}

fn note_video_place(window: &tauri::Window) {
  use std::sync::atomic::Ordering;
  if VIDEO_CLOSING.load(Ordering::SeqCst) || window.is_fullscreen().unwrap_or(true) || window.is_minimized().unwrap_or(true) {
    return;
  }
  let mut place = VIDEO_PLACE.lock().unwrap();
  if window.is_maximized().unwrap_or(true) {
    if let Some(place) = place.as_mut() {
      place.maximized = true;
    }
    return;
  }
  let (Ok(at), Ok(size)) = (window.outer_position(), window.inner_size()) else {
    return;
  };
  if size.width > 0 && size.height > 0 {
    *place = Some(VideoPlace { x: at.x, y: at.y, width: size.width, height: size.height, maximized: false });
  }
}

// Back where it was, or centered with its last size when that screen is gone. Gives whether to
// maximize it, once shown: maximized while hidden, it can show up unmaximized or elsewhere.
fn restore_video_place(app: &tauri::AppHandle, window: &tauri::Window) -> bool {
  use tauri::{PhysicalPosition, PhysicalSize};
  let saved: Option<VideoPlace> = video_place_file(app)
    .and_then(|file| std::fs::read(file).ok())
    .and_then(|text| serde_json::from_slice(&text).ok());
  if let Some(place) = saved {
    let (middle_x, middle_y) = (place.x + place.width as i32 / 2, place.y + place.height as i32 / 2);
    let on_screen = window.available_monitors().unwrap_or_default().iter().any(|screen| {
      let area = screen.work_area();
      middle_x >= area.position.x
        && middle_x < area.position.x + area.size.width as i32
        && middle_y >= area.position.y
        && middle_y < area.position.y + area.size.height as i32
    });
    // The place first: on a screen with another scale Windows resizes the window
    if on_screen {
      let _ = window.set_position(PhysicalPosition::new(place.x, place.y));
    }
    let _ = window.set_size(PhysicalSize::new(place.width, place.height));
    if !on_screen {
      let _ = window.center();
    }
  }
  let maximized = saved.is_some_and(|place| place.maximized);
  // Known from the start, so maximizing before any move still has a size to come back to
  if let (Ok(at), Ok(size)) = (window.outer_position(), window.inner_size()) {
    *VIDEO_PLACE.lock().unwrap() = Some(VideoPlace { x: at.x, y: at.y, width: size.width, height: size.height, maximized });
  }
  VIDEO_CLOSING.store(false, std::sync::atomic::Ordering::SeqCst);
  maximized
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
  site_icon(window, site);
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

// The window's icon (its taskbar button): the video's site, "youtube" or "twitch"
fn site_icon(window: &tauri::Window, site: &str) {
  let icon: &'static [u8] = if site == "twitch" {
    include_bytes!("../icons/video-twitch.rgba")
  } else {
    include_bytes!("../icons/video-youtube.rgba")
  };
  if let Err(e) = window.set_icon(tauri::image::Image::new(icon, 64, 64)) {
    log::warn!("Video window icon: {e}");
  }
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
  start_early_list(&address);
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
  // With its border for now, removed below before its size is set
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
        // Our own controls (controls.js) and the waiting screen's search (startSkip.js) come along,
        // for YouTube's player page; wrapped so that other sites' pages don't see their names
        .initialization_script_for_all_frames(concat!("(() => {\n", include_str!("../player/controls.js"), "\n;", include_str!("../player/startSkip.js"), "\n;", include_str!("video-watch.js"), "\n})()"))
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
  let _ = window.set_decorations(false);
  // The resize edges of a borderless window sit under pages added later: this makes new ones on top
  let _ = window.set_resizable(false);
  let _ = window.set_resizable(true);
  // Never starts in full screen: the site isn't, and there'd be no bar to get out
  let _ = window.set_fullscreen(false);
  let maximize = restore_video_place(&app, &window);
  place_video_pages(&window, bar_height);
  *VIDEO_SHAPE.lock().unwrap() = None;
  *VIDEO_BAR_HEIGHT.lock().unwrap() = bar_height;
  if let Ok(size) = window.inner_size() {
    *VIDEO_SIZE.lock().unwrap() = (size.width, size.height);
  }
  let moved = window.clone();
  let was_maximized = AtomicBool::new(false);
  let closing = app.clone();
  window.on_window_event(move |event| {
    let fullscreen = moved.is_fullscreen().unwrap_or(false);
    match event {
      WindowEvent::Moved(_) | WindowEvent::Resized(_) => note_video_place(&moved),
      WindowEvent::CloseRequested { .. } => {
        if fullscreen {
          if let Some(place) = VIDEO_PLACE.lock().unwrap().as_mut() {
            place.maximized = true;
          }
        }
        VIDEO_CLOSING.store(true, Ordering::SeqCst);
        save_video_place(&closing);
      }
      // Closed without that (the app quitting), or forced shut after a site's "leave this page?"
      WindowEvent::Destroyed => save_video_place(&closing),
      _ => {}
    }
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
      // A screen plugged in or out while away: the bar's screen button follows
      WindowEvent::Focused(true) => {
        if let Some(bar) = moved.get_webview(VIDEO_BAR) {
          let screens = moved.available_monitors().map(|all| all.len()).unwrap_or(1);
          let _ = bar.eval(format!("window.setScreens?.({screens})"));
        }
      }
      // Out of full screen first, so the window closes as a normal one
      WindowEvent::CloseRequested { api, .. } if fullscreen => {
        api.prevent_close();
        let _ = moved.set_fullscreen(false);
        let _ = moved.close();
      }
      _ => {}
    }
  });
  window.show().map_err(|e| e.to_string())?;
  if maximize {
    let _ = window.maximize();
  }
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
      let screens = window.available_monitors().map(|all| all.len()).unwrap_or(1);
      video_extensions::bar_ready(app);
      return webview
        .eval(format!("window.setMaximized({maximized}); window.setScreens({screens})"))
        .map_err(|e| e.to_string());
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
    "next-screen" => move_to_next_screen(&window),
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

// The window to the next screen (left to right, then back to the first), always maximized there.
// Out of maximized first: a maximized window can't be moved.
fn move_to_next_screen(window: &tauri::Window) -> tauri::Result<()> {
  let mut screens = window.available_monitors()?;
  if screens.len() < 2 {
    return Ok(());
  }
  screens.sort_by_key(|screen| (screen.position().x, screen.position().y));
  let here = window.current_monitor()?.map(|screen| *screen.position());
  let next = screens
    .iter()
    .position(|screen| Some(*screen.position()) == here)
    .map_or(0, |index| (index + 1) % screens.len());
  if window.is_maximized()? {
    window.unmaximize()?;
  }
  let corner = screens[next].position();
  window.set_position(tauri::PhysicalPosition::new(corner.x + 40, corner.y + 40))?;
  window.maximize()
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

// A note on the bar while the video plays (videoPlayer.ts), gone after a moment
#[tauri::command]
pub fn video_player_note(app: tauri::AppHandle, via: String, note: String) -> Result<(), String> {
  let Some(bar) = app.get_webview(VIDEO_BAR) else {
    return Ok(()); // closed in the meantime
  };
  show_video_way(&bar, &via, &note, false)
}

// The next video of a playlist (videoPlayer.ts): in the same window, which stays where it is. A new
// page would leave full screen, so while in it YouTube's page plays the video itself (video-watch.js);
// where it can't, as on another site, a new page it is. in_place: the next video opens the same way
// as this one (our own YouTube page), so the bar's "via" stays true.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
// upcoming: what the new video's ⏭ shows (controls.js) and start_skip its waiting screen's search
// (video-watch.js), for a page that plays it in place. site: the new video's, for the taskbar
// button's icon (a next video can be from the other site).
pub fn video_player_next(app: tauri::AppHandle, address: String, video: String, start: u64, subtitles: bool, in_place: bool, upcoming: serde_json::Value, start_skip: serde_json::Value, site: String, title: String, via: String, note: String, note_stays: bool) -> Result<(), String> {
  let (Some(window), Some(page), Some(bar)) = (app.get_window(VIDEO_WINDOW), app.get_webview(VIDEO_SITE), app.get_webview(VIDEO_BAR)) else {
    return Ok(()); // closed in the meantime
  };
  let url = video_site_url(&bar, &address)?;
  site_icon(&window, &site);
  let site = page;
  let _ = window.set_title(&title);
  *VIDEO_SHAPE.lock().unwrap() = None;
  let title = serde_json::to_string(&title).map_err(|e| e.to_string())?;
  bar.eval(format!("window.setTitle?.({title})")).map_err(|e| e.to_string())?;
  if in_place && window.is_fullscreen().unwrap_or(false) {
    let video = serde_json::to_string(&video).map_err(|e| e.to_string())?;
    let url = serde_json::to_string(url.as_str()).map_err(|e| e.to_string())?;
    site.eval(format!("if (!window.syncrNextVideo?.({video}, {start}, {subtitles}, {upcoming}, {start_skip})) location.href = {url}")).map_err(|e| e.to_string())?;
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

// The open video's ⏭ changed while it plays (videoPlayer.ts: a Twitch stream's next part was
// found). Only our own player's page gets it (player.js): it's our data, not a site's. Gives back
// whether the window is still open, as a video waiting at its end sends no reports.
#[tauri::command]
pub fn video_player_upcoming(app: tauri::AppHandle, upcoming: serde_json::Value) -> Result<bool, String> {
  let Some(site) = app.get_webview(VIDEO_SITE) else {
    return Ok(false);
  };
  let own = site.url().map(|url| url.host_str() == Some("syncr-video.localhost")).unwrap_or(false);
  if own {
    site.eval(format!("window.syncrUpcoming?.({upcoming})")).map_err(|e| e.to_string())?;
  }
  Ok(true)
}

#[tauri::command]
pub async fn close_video_player(app: tauri::AppHandle) -> Result<(), String> {
  close_video_window(&app)
}
