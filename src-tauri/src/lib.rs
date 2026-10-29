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

// Files that run something when opened (often how malware comes): saved only, never opened.
// Same list as RISKY in mailFiles.ts.
const RISKY: &[&str] = &[
  "exe", "com", "bat", "cmd", "msi", "msix", "msp", "scr", "pif", "cpl", "jar", "js", "jse", "vbs", "vbe",
  "wsf", "wsh", "hta", "ps1", "psm1", "lnk", "reg", "appx", "appxbundle", "application", "gadget", "iso",
  "img", "vhd", "vhdx",
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

fn is_risky(name: &str) -> bool {
  name.rsplit_once('.').is_some_and(|(_, ext)| RISKY.contains(&ext.to_ascii_lowercase().as_str()))
}

// Opens a file in its normal program: written to a new folder in Windows' temporary files
// ("SyncR attachments"; folders older than a day are removed then), then opened like a
// double-click would
#[tauri::command]
async fn open_attachment(app: tauri::AppHandle, name: String, data: String) -> Result<(), String> {
  use std::time::{Duration, SystemTime, UNIX_EPOCH};
  use tauri_plugin_opener::OpenerExt;
  let name = safe_file_name(&name);
  if is_risky(&name) {
    return Err("Programs and scripts can only be saved".to_string());
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
  Ok(true)
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
    .plugin(tauri_plugin_process::init())
    // Opens links from notes in the normal web browser
    .plugin(tauri_plugin_opener::init())
    // "Save as" window for an email's attached files (save_attachment)
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      started_hidden,
      google_sign_in,
      protect_secret,
      unprotect_secret,
      open_attachment,
      save_attachment
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
