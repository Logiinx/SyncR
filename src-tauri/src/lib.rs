#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_process::init())
    // Opens links from notes in the normal web browser
    .plugin(tauri_plugin_opener::init());

  // Remembers the window's size, position (also on another monitor) and maximized state,
  // saved when the app closes and restored at the next start.
  // Must be registered here, before the window exists: it only looks after windows created
  // after it (registered in setup(), it missed the main window and remembered nothing).
  // Visibility isn't managed by it: the window starts hidden (tauri.conf.json) and the page
  // shows it once it has drawn its first screen (WindowControls.tsx), so it appears in place.
  #[cfg(desktop)]
  let builder = {
    use tauri_plugin_window_state::StateFlags;
    builder.plugin(
      tauri_plugin_window_state::Builder::default()
        .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
        .build(),
    )
  };

  builder
    .setup(|app| {
      #[cfg(desktop)]
      {
        use tauri::Manager;
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

        // Safety net: if the page never shows the window (e.g. it failed to load),
        // show it after 3 seconds anyway, so the app can't run invisibly
        if let Some(window) = app.get_webview_window("main") {
          std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let _ = window.show();
          });
        }
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
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
