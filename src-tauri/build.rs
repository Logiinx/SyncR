// Every command of the app needs a permission, per window (capabilities/): without this list any
// page of the app's own addresses can call all of them. A new command goes here and in the
// capability of each window that calls it.
// The Windows app manifest is our own (windows-app-manifest.xml: Tauri's + supported Windows versions).
fn main() {
  println!("cargo:rerun-if-changed=windows-app-manifest.xml");
  let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app-manifest.xml"));
  tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows).app_manifest(tauri_build::AppManifest::new().commands(&[
    "started_hidden",
    "set_tray_texts",
    "google_sign_in",
    "protect_secret",
    "unprotect_secret",
    "open_attachment",
    "save_attachment",
    "open_video_player",
    "video_bar",
    "video_menu",
    "video_player_way",
    "video_player_note",
    "video_player_next",
    "video_player_watched",
    "video_player_upcoming",
    "close_video_player",
    "open_trailer_player",
    "place_trailer_player",
    "show_trailer_player",
    "close_trailer_player",
    "video_extensions_list",
    "video_extension_add",
    "video_extension_remove",
    "video_extension_enable",
    "video_extension_settings",
    "video_extensions_done",
    "start_link_shortcut",
    "mouse_battery_config",
    "mouse_battery_status",
    "mouse_battery_tip",
  ])))
  .expect("failed to build");
}
