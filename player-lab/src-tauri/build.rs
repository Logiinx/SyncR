// Every command of the app needs a permission, per window (capabilities/): without this list any
// page of the app's own addresses can call all of them.
fn main() {
  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
    "get_state",
    "add_extension",
    "remove_extension",
    "add_userscript",
    "remove_userscript",
    "open_player",
    "open_extension_page",
    "open_video_player",
    "video_bar",
    "video_player_way",
    "video_player_watched",
    "close_video_player",
  ])))
  .expect("failed to build");
}
