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
    .invoke_handler(tauri::generate_handler![started_hidden, google_sign_in]);

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
