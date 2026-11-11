// Ctrl+Alt+Shift+V anywhere in Windows: the copied text goes to the main window, which opens it in
// the Video tab if it's a video's link (videoPaste.ts). Four keys, so no other app or game is
// likely to use them: a shortcut like this takes its keys away from every other app.
// Started by the page once the Video tab is on, and kept until SyncR closes.

use std::sync::atomic::{AtomicBool, Ordering};

static STARTED: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn start_link_shortcut(app: tauri::AppHandle) {
  if STARTED.swap(true, Ordering::SeqCst) {
    return;
  }
  #[cfg(windows)]
  std::thread::spawn(move || listen(app));
  #[cfg(not(windows))]
  let _ = app;
}

// Windows sends the key press to the thread that asked for it, so this thread waits for its
// messages for as long as the app runs.
#[cfg(windows)]
fn listen(app: tauri::AppHandle) {
  use tauri::Emitter;
  use windows_sys::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT};
  use windows_sys::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY};
  unsafe {
    if RegisterHotKey(std::ptr::null_mut(), 1, MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, u32::from(b'V')) == 0 {
      log::warn!("Link shortcut: Ctrl+Alt+Shift+V is already taken by another app");
      return;
    }
    let mut message: MSG = std::mem::zeroed();
    while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
      if message.message == WM_HOTKEY {
        let _ = app.emit_to("main", "link-shortcut", clipboard_text().unwrap_or_default());
      }
    }
  }
}

// The copied text, or None if there's none (or it's too long to be a link). Another app may hold
// the clipboard for a moment, so it tries a few times.
#[cfg(windows)]
fn clipboard_text() -> Option<String> {
  use windows_sys::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
  use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};
  use windows_sys::Win32::System::Ole::CF_UNICODETEXT;
  const MAX: usize = 4096;
  unsafe {
    let mut open = false;
    for _ in 0..10 {
      if OpenClipboard(std::ptr::null_mut()) != 0 {
        open = true;
        break;
      }
      std::thread::sleep(std::time::Duration::from_millis(20));
    }
    if !open {
      return None;
    }
    let mut text = None;
    let handle = GetClipboardData(u32::from(CF_UNICODETEXT));
    if !handle.is_null() {
      let data = GlobalLock(handle) as *const u16;
      if !data.is_null() {
        let mut length = 0;
        while length < MAX && *data.add(length) != 0 {
          length += 1;
        }
        if length < MAX {
          text = Some(String::from_utf16_lossy(std::slice::from_raw_parts(data, length)));
        }
        GlobalUnlock(handle);
      }
    }
    CloseClipboard();
    text
  }
}
