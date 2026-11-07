// Every command of the app needs a permission, per window (capabilities/): without this list any
// page of the app's own addresses can call all of them. A new command goes here and in the
// capability of each window that calls it.
fn main() {
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
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
    "video_player_next",
    "video_player_watched",
    "close_video_player",
    "video_extensions_list",
    "video_extension_add",
    "video_extension_remove",
    "video_extension_enable",
    "video_extension_settings",
    "video_extensions_done",
  ])))
  .expect("failed to build");
}
