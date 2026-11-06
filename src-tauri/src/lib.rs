use tauri::Manager;

// Brings the main window back (from the tray, minimized, or behind other windows)
#[cfg(desktop)]
fn show_main(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
}

// True when Windows started SyncR at sign-in ("Start with Windows" adds --hidden):
// then the window stays hidden in the tray if "Start hidden in the tray" is on
// (WindowControls.tsx asks this and decides)
// The tray menu's words, in the app's language: the page sends them at start and when it changes
#[tauri::command]
fn set_tray_texts(app: tauri::AppHandle, open: String, quit: String) -> Result<(), String> {
  #[cfg(desktop)]
  {
    use tauri::menu::{Menu, MenuItem};
    let open = MenuItem::with_id(&app, "open", open, true, None::<&str>).map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(&app, "quit", quit, true, None::<&str>).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&app, &[&open, &quit]).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("main") {
      tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
  }
  Ok(())
}

#[tauri::command]
fn started_hidden() -> bool {
  std::env::args().any(|arg| arg == "--hidden")
}

// Google Calendar sign-in (google.ts). Google doesn't allow its sign-in page inside an app
// window, so it opens in the normal browser, and Google sends the browser back to
// http://localhost:47615/?code=… (a redirect address of SyncR's Google client). This listens
// there for that one visit, shows a short "you can close this tab" page, brings SyncR to the
// front and returns the part after "?" to the app. Gives up after 5 minutes (e.g. the browser
// tab was closed without signing in).
#[tauri::command]
async fn google_sign_in(app: tauri::AppHandle, url: String) -> Result<String, String> {
  use tauri_plugin_opener::OpenerExt;
  // Listening before the browser opens, so Google's answer can't come too early
  let listener = std::net::TcpListener::bind("127.0.0.1:47615")
    .map_err(|_| "A Google sign-in is already waiting in your browser".to_string())?;
  app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())?;
  let query = tauri::async_runtime::spawn_blocking(move || wait_for_google(listener))
    .await
    .map_err(|e| e.to_string())??;
  #[cfg(desktop)]
  show_main(&app);
  Ok(query)
}

fn wait_for_google(listener: std::net::TcpListener) -> Result<String, String> {
  use std::io::{ErrorKind, Read, Write};
  use std::time::{Duration, Instant};
  listener.set_nonblocking(true).map_err(|e| e.to_string())?; // so the 5-minute limit works
  let deadline = Instant::now() + Duration::from_secs(300);
  while Instant::now() < deadline {
    match listener.accept() {
      Ok((mut stream, _)) => {
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buffer = [0u8; 8192];
        let length = stream.read(&mut buffer).unwrap_or(0);
        let request = String::from_utf8_lossy(&buffer[..length]);
        // The first line: "GET /?state=google&code=… HTTP/1.1"
        let path = request.lines().next().and_then(|line| line.split(' ').nth(1)).unwrap_or("");
        let Some(query) = path.strip_prefix("/?") else {
          // Something else, e.g. the browser asking for /favicon.ico
          let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
          continue;
        };
        let page = "<!doctype html><meta charset=\"utf-8\"><title>SyncR</title>\
          <body style=\"background:#161616;color:#e4e4e4;font-family:system-ui;text-align:center;padding-top:20vh\">\
          <h2>Back to SyncR</h2><p>You can close this tab.</p></body>";
        let _ = write!(
          stream,
          "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
          page.len(),
          page
        );
        return Ok(query.to_string());
      }
      Err(error) if error.kind() == ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
      Err(error) => return Err(error.to_string()),
    }
  }
  Err("Google sign-in timed out. Please try again.".to_string())
}

// Secrets on the PC (secrets.ts): Windows DPAPI encrypts them with a key tied to this Windows
// user, so another user (or the files copied to another PC) can't read them. Windows keeps
// the key itself; nothing to store or type. The extra "entropy" bytes must be the same to
// decrypt, so other programs can't just ask Windows to decrypt SyncR's secrets.
#[cfg(windows)]
mod dpapi {
  use std::ptr::{null, null_mut};
  use windows_sys::Win32::Foundation::LocalFree;
  use windows_sys::Win32::Security::Cryptography::{
    CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
  };

  const ENTROPY: &[u8] = b"SyncR secrets";

  fn blob(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: bytes.len() as u32, pbData: bytes.as_ptr() as *mut u8 }
  }

  // Copies Windows' result out and frees it
  fn take(output: CRYPT_INTEGER_BLOB) -> Vec<u8> {
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe { LocalFree(output.pbData as _) };
    bytes
  }

  pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(data);
    let entropy = blob(ENTROPY);
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
    let ok = unsafe {
      CryptProtectData(&input, null(), &entropy, null(), null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output)
    };
    if ok == 0 {
      return Err(format!("Windows couldn't encrypt: {}", std::io::Error::last_os_error()));
    }
    Ok(take(output))
  }

  pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(data);
    let entropy = blob(ENTROPY);
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: null_mut() };
    let ok = unsafe {
      CryptUnprotectData(&input, null_mut(), &entropy, null(), null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output)
    };
    if ok == 0 {
      return Err(format!("Windows couldn't decrypt: {}", std::io::Error::last_os_error()));
    }
    Ok(take(output))
  }
}

#[cfg(not(windows))]
mod dpapi {
  pub fn protect(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("Only on Windows".to_string())
  }
  pub fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("Only on Windows".to_string())
  }
}

#[tauri::command]
fn protect_secret(text: String) -> Result<Vec<u8>, String> {
  dpapi::protect(text.as_bytes())
}

#[tauri::command]
fn unprotect_secret(data: Vec<u8>) -> Result<String, String> {
  String::from_utf8(dpapi::unprotect(&data)?).map_err(|e| e.to_string())
}

// ---------- An email's attached files (mailFiles.ts) ----------

// The only kinds of files opened with a click: documents, pictures, audio and video, zip,
// invites and contact cards. Anything else (programs, scripts, shortcuts, macro documents, and
// types nobody thought of) can only be saved. Same list as OPENABLE in mailFiles.ts.
const OPENABLE: &[&str] = &[
  "pdf", "txt", "md", "rtf", "csv", "docx", "xlsx", "pptx", "odt", "ods", "odp", "jpg", "jpeg", "png", "gif",
  "webp", "bmp", "tif", "tiff", "heic", "avif", "mp3", "m4a", "aac", "wav", "flac", "ogg", "mp4", "m4v", "mov",
  "webm", "mkv", "avi", "zip", "ics", "vcf",
];

// Gmail gives a file as base64url text (with or without the trailing "=")
fn attachment_bytes(data: &str) -> Result<Vec<u8>, String> {
  use base64::engine::{general_purpose::GeneralPurposeConfig, DecodePaddingMode, GeneralPurpose};
  use base64::Engine;
  let config = GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent);
  GeneralPurpose::new(&base64::alphabet::URL_SAFE, config)
    .decode(data.trim())
    .map_err(|e| format!("The file came damaged ({e})"))
}

// A name Windows accepts: no folder parts, no forbidden or invisible characters (a right-to-left
// mark could make "photo<RLO>gpj.exe" look like a .jpg), no trailing dots or spaces
fn safe_file_name(name: &str) -> String {
  let cleaned: String = name
    .chars()
    .map(|c| {
      let invisible = matches!(c as u32, 0x200E..=0x200F | 0x202A..=0x202E | 0x2066..=0x2069);
      let forbidden = matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
      if c.is_control() || invisible || forbidden { '_' } else { c }
    })
    .collect();
  let cleaned = cleaned.trim().trim_end_matches(['.', ' ']);
  if cleaned.is_empty() { "file".to_string() } else { cleaned.to_string() }
}

fn can_open(name: &str) -> bool {
  name.rsplit_once('.').is_some_and(|(_, ext)| OPENABLE.contains(&ext.to_ascii_lowercase().as_str()))
}

// Marks a file as downloaded from the internet (like browsers do), so Windows and the programs
// that open it stay careful: SmartScreen, warnings before running what's inside a zip. A drive
// that can't hold the mark (a USB stick) still gets the file.
fn mark_from_internet(path: &std::path::Path) {
  let mut mark = path.as_os_str().to_owned();
  mark.push(":Zone.Identifier");
  let _ = std::fs::write(mark, "[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://mail.google.com/\r\n");
}

// Opens a file in its normal program: written to a new folder in Windows' temporary files
// ("SyncR attachments"; folders older than a day are removed then), then opened like a
// double-click would
#[tauri::command]
async fn open_attachment(app: tauri::AppHandle, name: String, data: String) -> Result<(), String> {
  use std::time::{Duration, SystemTime, UNIX_EPOCH};
  use tauri_plugin_opener::OpenerExt;
  let name = safe_file_name(&name);
  if !can_open(&name) {
    return Err("This kind of file can only be saved".to_string());
  }
  let bytes = attachment_bytes(&data)?;
  let folder = std::env::temp_dir().join("SyncR attachments");
  if let Ok(entries) = std::fs::read_dir(&folder) {
    for entry in entries.flatten() {
      let old = entry
        .metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|time| time.elapsed().ok())
        .is_some_and(|age| age > Duration::from_secs(24 * 3600));
      if old {
        let _ = std::fs::remove_dir_all(entry.path());
      }
    }
  }
  let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
  let dir = folder.join(stamp.to_string());
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let path = dir.join(&name);
  std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
  mark_from_internet(&path);
  app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>).map_err(|e| e.to_string())
}

// Saves a file where the user picks ("Save as" window over the window that asked, starting in
// Downloads). False: the user cancelled.
#[tauri::command]
async fn save_attachment(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
  name: String,
  data: String,
) -> Result<bool, String> {
  use tauri_plugin_dialog::DialogExt;
  let bytes = attachment_bytes(&data)?;
  let mut dialog = app.dialog().file().set_file_name(safe_file_name(&name)).set_parent(&window);
  if let Ok(downloads) = app.path().download_dir() {
    dialog = dialog.set_directory(downloads);
  }
  let (sender, receiver) = std::sync::mpsc::channel();
  dialog.save_file(move |picked| {
    let _ = sender.send(picked);
  });
  let picked = tauri::async_runtime::spawn_blocking(move || receiver.recv().ok().flatten())
    .await
    .map_err(|e| e.to_string())?;
  let Some(path) = picked else { return Ok(false) };
  let path = path.into_path().map_err(|e| e.to_string())?;
  std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
  mark_from_internet(&path);
  Ok(true)
}

// The video player window (videoPlayer.ts): two separate pages in one window, our bar
// (public/video-bar.html) above the real site, so the site can't touch or fake the bar. Neither
// is in a capability file, and they have their own storage folder, apart from the notes. The next
// video replaces the current one, closed first so the window-state plugin remembers its place and
// size. The site's address is either a site's page or our page that forwards to YouTube's player
// (public/video-forward.html).
const VIDEO_WINDOW: &str = "video-player";
const VIDEO_BAR: &str = "video-player-bar";
const VIDEO_SITE: &str = "video-player-site";
// See video-watch.js
const VIDEO_REQUEST: &str = "syncr-video.invalid";

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

async fn player_answer(uri: tauri::http::Uri) -> tauri::http::Response<Vec<u8>> {
  use tauri::http::Response;
  let answer = |status: u16, kind: &str, body: Vec<u8>| {
    let mut response = Response::builder().status(status).header("Content-Type", kind);
    if kind == "text/html" {
      response = response.header(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; connect-src 'self' https://gql.twitch.tv; media-src blob: data:; img-src https://static-cdn.jtvnw.net; worker-src blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      );
    }
    response.body(body).unwrap_or_default()
  };
  let path = uri.path();
  match path {
    "/player.html" => return answer(200, "text/html", include_bytes!("../player/player.html").to_vec()),
    "/player.js" => return answer(200, "text/javascript", include_bytes!("../player/player.js").to_vec()),
    "/chat.js" => return answer(200, "text/javascript", include_bytes!("../player/chat.js").to_vec()),
    "/hls.min.js" => return answer(200, "text/javascript", include_bytes!("../player/hls.min.js").to_vec()),
    _ => {}
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
  answer(status, "video/mp2t", body.to_vec())
}

// Both pages of the player window share a storage folder, so they must start the same way. A
// video opened by a click should play: without this switch the browser refuses to start it.
const VIDEO_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

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

#[tauri::command]
async fn open_video_player(
  app: tauri::AppHandle,
  address: String,
  title: String,
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
  let folder = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("video-player");
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
  let size = window.inner_size().map_err(|e| e.to_string())?;
  window
    .add_child(
      WebviewBuilder::new(VIDEO_BAR, WebviewUrl::App(format!("video-bar.html?data={bar}").into()))
        .background_color(Color(0x16, 0x16, 0x16, 255))
        .use_https_scheme(true)
        .additional_browser_args(VIDEO_ARGS)
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
  // On its first opening, or after an older version, the plugin left the border on
  let _ = window.set_decorations(false);
  // The resize edges of a borderless window sit under pages added later: this makes new ones on top
  let _ = window.set_resizable(false);
  let _ = window.set_resizable(true);
  // The app was quit while in full screen: the site isn't anymore, and there'd be no bar to get out
  let _ = window.set_fullscreen(false);
  place_video_pages(&window, bar_height);
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
      WindowEvent::Resized(_) => {
        if !fullscreen && was_maximized.swap(false, Ordering::SeqCst) {
          let _ = moved.maximize();
        }
        place_video_pages(&moved, bar_height);
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
  Ok(())
}

// The clicks on the video bar. What needs the notes' database goes on to the main window
// (videoPlayer.ts).
#[tauri::command]
fn video_bar(app: tauri::AppHandle, webview: tauri::Webview, action: String, on: Option<bool>) -> Result<(), String> {
  use tauri::Emitter;
  if webview.label() != VIDEO_BAR {
    return Err("Only for the video bar".to_string());
  }
  let window = webview.window();
  let result = match action.as_str() {
    "ready" => {
      let maximized = window.is_maximized().unwrap_or(false);
      return webview.eval(format!("window.setMaximized({maximized})")).map_err(|e| e.to_string());
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

// Opens the same video another way (videoPlayer.ts), and the bar says which
#[tauri::command]
fn video_player_way(app: tauri::AppHandle, address: String, via: String) -> Result<(), String> {
  let (Some(site), Some(bar)) = (app.get_webview(VIDEO_SITE), app.get_webview(VIDEO_BAR)) else {
    return Ok(()); // closed in the meantime
  };
  let url = if is_video_page(&address) {
    bar.url().map_err(|e| e.to_string())?.join(&address).map_err(|e| e.to_string())?
  } else {
    let url = tauri::Url::parse(&address).map_err(|e| e.to_string())?;
    if url.scheme() != "https" {
      return Err("Not a web address".to_string());
    }
    url
  };
  site.navigate(url).map_err(|e| e.to_string())?;
  let via = serde_json::to_string(&via).map_err(|e| e.to_string())?;
  bar.eval(format!("window.setVia?.({via})")).map_err(|e| e.to_string())
}

// The main window tells the bar when a video's Watched mark changes (also from the list)
#[tauri::command]
fn video_player_watched(app: tauri::AppHandle, watched: bool) -> Result<(), String> {
  match app.get_webview(VIDEO_BAR) {
    Some(bar) => bar.eval(format!("window.setWatched?.({watched})")).map_err(|e| e.to_string()),
    None => Ok(()),
  }
}

#[tauri::command]
async fn close_video_player(app: tauri::AppHandle) -> Result<(), String> {
  close_video_window(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();

  // Only one SyncR at a time: starting it again (e.g. from the Start menu while it sits in
  // the tray) shows the running one instead. Must be the first plugin.
  #[cfg(desktop)]
  let builder = builder
    .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
    // "Start with Windows" setting (desktop.ts): starts with --hidden, see started_hidden()
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      Some(vec!["--hidden"]),
    ));

  let builder = builder
    // The own Twitch player's page and video
    .register_asynchronous_uri_scheme_protocol("syncr-video", |_context, request, responder| {
      let uri = request.uri().clone();
      tauri::async_runtime::spawn(async move { responder.respond(player_answer(uri).await) });
    })
    .plugin(tauri_plugin_process::init())
    // Opens links from notes in the normal web browser
    .plugin(tauri_plugin_opener::init())
    // "Save as" window for an email's attached files (save_attachment)
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      started_hidden,
      set_tray_texts,
      google_sign_in,
      protect_secret,
      unprotect_secret,
      open_attachment,
      save_attachment,
      open_video_player,
      video_bar,
      video_player_way,
      video_player_watched,
      close_video_player
    ]);

  // Remembers the window's size, position (also on another monitor) and maximized state,
  // saved when the app closes and restored at the next start.
  // Must be registered here, before the window exists: it only looks after windows created
  // after it (registered in setup(), it missed the main window and remembered nothing).
  // Visibility isn't managed by it: the window starts hidden (tauri.conf.json) and the page
  // shows it once it has drawn its first screen (WindowControls.tsx), so it appears in place.
  // The reminder pop-up places itself (ReminderPopup.tsx), so it's left out.
  #[cfg(desktop)]
  let builder = {
    use tauri_plugin_window_state::StateFlags;
    builder.plugin(
      tauri_plugin_window_state::Builder::default()
        .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
        .with_denylist(&["reminder-popup"])
        .build(),
    )
  };

  builder
    .setup(|app| {
      #[cfg(desktop)]
      {
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

        // Safety net: if the page never shows the window (e.g. it failed to load),
        // show it after 3 seconds anyway, so the app can't run invisibly.
        // Not when started hidden: then the tray icon is the way back.
        if !started_hidden() {
          if let Some(window) = app.get_webview_window("main") {
            std::thread::spawn(move || {
              std::thread::sleep(std::time::Duration::from_secs(3));
              let _ = window.show();
            });
          }
        }

        // Tray icon (always there on desktop): click = open SyncR, right-click = menu.
        // Lets SyncR keep running for reminders while its window is hidden.
        use tauri::menu::{Menu, MenuItem};
        use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
        let open = MenuItem::with_id(app, "open", "Open SyncR", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit SyncR", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &quit])?;
        let mut tray = TrayIconBuilder::with_id("main")
          .tooltip("SyncR")
          .menu(&menu)
          .show_menu_on_left_click(false)
          .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
          })
          .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
              button: MouseButton::Left,
              button_state: MouseButtonState::Up,
              ..
            } = event
            {
              show_main(tray.app_handle());
            }
          });
        if let Some(icon) = app.default_window_icon() {
          tray = tray.icon(icon.clone());
        }
        tray.build(app)?;
      }

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    // When the main window closes for good (Quit), end the app, so an open reminder
    // pop-up can't keep it running invisibly
    .on_window_event(|window, event| {
      if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
        window.app_handle().exit(0);
      }
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
