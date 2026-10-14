#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_process::init())
    // Opens links from notes in the normal web browser
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
      // Remembers the window's size, position (also on another monitor) and maximized state,
      // saved when the app closes and restored at the next start
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_window_state::Builder::default().build())?;

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
