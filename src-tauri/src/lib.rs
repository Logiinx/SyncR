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
    .invoke_handler(tauri::generate_handler![started_hidden]);

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
