// Every command of the app needs a permission, per window (capabilities/): without this list any
// page of the app's own addresses can call all of them. A new command goes here and in the
// capability of each window that calls it.
// The Windows app manifest is our own (windows-app-manifest.xml: Tauri's + supported Windows versions).
fn main() {
  build_hardware_helper();
  println!("cargo:rerun-if-changed=windows-app-manifest.xml");
  let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app-manifest.xml"));
  tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows).app_manifest(tauri_build::AppManifest::new().commands(&[
    "started_hidden",
    "set_tray_texts",
    "show_tray",
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
    "save_muted_sound",
    "tidy_muted_sound",
    "muted_sound_space",
    "delete_muted_sound",
    "start_link_shortcut",
    "mouse_battery_config",
    "mouse_battery_status",
    "mouse_battery_tip",
    "spotify_config",
    "spotify_status",
    "spotify_words",
    "hardware_config",
    "hardware_readings",
    "hardware_helper_setup",
    "hardware_helper_remove",
    "hardware_widget",
    "widget_menu",
  ])))
  .expect("failed to build");
}

// The Hardware module's admin helper (hardware-helper/): its own small program, built here and
// carried inside SyncR, which writes it out when the user sets it up (src/hardware_helper.rs).
// Its own target folder, so this build doesn't wait for the one running this script.
fn build_hardware_helper() {
  use std::env::var;
  use std::path::PathBuf;
  for path in ["hardware-helper/src", "hardware-helper/build.rs", "hardware-helper/Cargo.toml", "hardware-helper/Cargo.lock", "hardware-helper/pawnio", "icons/icon.ico"] {
    println!("cargo:rerun-if-changed={path}");
  }
  if var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
    return;
  }
  let here = PathBuf::from(var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
  let target = here.join("target").join("hardware-helper");
  let mut cargo = std::process::Command::new(var("CARGO").unwrap_or_else(|_| "cargo".into()));
  cargo
    .args(["build", "--release", "--locked", "--manifest-path"])
    .arg(here.join("hardware-helper").join("Cargo.toml"))
    .arg("--target-dir")
    .arg(&target);
  // Settings meant for SyncR's own build, not the helper's
  for name in ["CARGO_TARGET_DIR", "CARGO_BUILD_TARGET", "CARGO_ENCODED_RUSTFLAGS", "RUSTFLAGS"] {
    cargo.env_remove(name);
  }
  let status = cargo.status().expect("couldn't start cargo for hardware-helper");
  assert!(status.success(), "hardware-helper didn't build");
  let out = PathBuf::from(var("OUT_DIR").expect("OUT_DIR")).join("syncr-hardware.exe");
  std::fs::copy(target.join("release").join("syncr-hardware.exe"), out).expect("couldn't copy syncr-hardware.exe");
}
