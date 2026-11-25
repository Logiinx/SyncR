// The main window's size, place and maximized state (tauri-plugin-window-state, lib.rs). The plugin
// writes them to disk only when the app ends cleanly: an update's installer (it ends the app at
// once), a crash or a frozen app ended by hand lost every move since the start. So they're also
// written once the window has stayed still for a second after moving or resizing. The main window
// is also put back here (restore), not by the plugin.
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

// What's remembered: everything but whether it shows (the page shows it, WindowControls.tsx)
pub fn flags() -> StateFlags {
  StateFlags::all() & !StateFlags::VISIBLE
}

// What the plugin saved for a window (its own type is private)
#[derive(serde::Deserialize)]
struct Saved {
  width: u32,
  height: u32,
  x: i32,
  y: i32,
  prev_x: i32,
  prev_y: i32,
  maximized: bool,
}

// The main window back where it was, done here instead of by the plugin (skip_initial_state,
// lib.rs): on Windows a window without a title bar came out one title bar taller (Tauri sizes it
// as if it had one), then saved so, growing at each start (37 px at 125 %). Still there (not
// solved): started maximized, its normal size comes back one title bar taller once un-maximized.
pub fn restore(window: &WebviewWindow) {
  let Some(saved) = read_saved(window.app_handle()) else { return };
  if saved.width == 0 || saved.height == 0 {
    return;
  }
  // Its place, when a screen still shows part of it (else Windows places it); a maximized one
  // goes back to where it was before maximizing
  let (x, y) = if saved.maximized { (saved.prev_x, saved.prev_y) } else { (saved.x, saved.y) };
  let size = PhysicalSize::new(saved.width, saved.height);
  let on_screen = window.available_monitors().unwrap_or_default().iter().any(|monitor| shows(monitor, PhysicalPosition::new(saved.x, saved.y), size));
  if on_screen {
    let _ = window.set_position(PhysicalPosition::new(x, y));
  }
  // The first resize of the new window still counts a title bar (one too tall); the size it
  // reports is the real one, and a second resize is exact
  let _ = window.set_size(size);
  if window.inner_size().is_ok_and(|got| got != size) {
    let _ = window.set_size(size);
  }
  if saved.maximized {
    let _ = window.maximize();
  }
}

fn read_saved(app: &AppHandle) -> Option<Saved> {
  let path = app.path().app_config_dir().ok()?.join(app.filename());
  let text = std::fs::read_to_string(path).ok()?;
  let mut all: std::collections::HashMap<String, serde_json::Value> = serde_json::from_str(&text).ok()?;
  serde_json::from_value(all.remove("main")?).ok()
}

// A corner of the window on this screen (the plugin's test)
fn shows(monitor: &Monitor, at: PhysicalPosition<i32>, size: PhysicalSize<u32>) -> bool {
  let (left, top) = (monitor.position().x, monitor.position().y);
  let (right, bottom) = (left + monitor.size().width as i32, top + monitor.size().height as i32);
  let (w, h) = (size.width as i32, size.height as i32);
  [(at.x, at.y), (at.x + w, at.y), (at.x, at.y + h), (at.x + w, at.y + h)]
    .into_iter()
    .any(|(x, y)| x >= left && x < right && y >= top && y < bottom)
}

static MOVED: OnceLock<Mutex<mpsc::Sender<()>>> = OnceLock::new();

// Called on each move or resize of the main window: one waiting thread, started the first time
pub fn save_soon(app: &AppHandle) {
  let moved = MOVED.get_or_init(|| {
    let (moved, still) = mpsc::channel::<()>();
    let app = app.clone();
    std::thread::spawn(move || {
      while still.recv().is_ok() {
        // Still for a second (a drag sends many moves)
        while still.recv_timeout(Duration::from_secs(1)).is_ok() {}
        // On the main thread: the plugin holds its lock while asking the window (maximized?);
        // from here that waits for the main thread, which may be waiting for the lock (a move)
        let main = app.clone();
        let _ = app.run_on_main_thread(move || {
          let _ = main.save_window_state(flags());
        });
      }
    });
    Mutex::new(moved)
  });
  let _ = moved.lock().unwrap().send(());
}
