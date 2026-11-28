// The right-click menu of SyncR's windows outside the app (the Hardware widget, the Spotify strip
// and the Spotify widget): a page of its own (widget-menu.html) in a see-through window over the
// whole monitor, so the menu and its side lists can open anywhere on it, and a click elsewhere
// lands on it and closes the menu, like the app's own menus. Making that window and loading its
// page takes ~0.1 s (measured), which showed as a pause before the menu, so it's made hidden as
// soon as the mouse is over its owner (prepare), and a right-click only has to show it (open).
// Not right-clicked: removed a few seconds after the mouse leaves (away), so nothing stays loaded
// while unused. Closed: removed too.
// One menu at a time, shared by all owners: the page is told whose it is when it opens, so a menu
// made for one serves another just as well.
// Nothing here may panic: the app is built with panic = "abort", so a panic would close SyncR.

use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  GetCursorPos, GetWindowLongPtrW, GetWindowRect, IsWindowVisible, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
};

pub const MENU: &str = "widget-menu";

// Whose menu it is: its page shows that one's items, and its choices go to that one's part of the
// main window (hardware.ts, spotify.ts)
#[derive(Clone, Copy, PartialEq)]
pub enum Owner {
  Hardware,
  SpotifyStrip,
  SpotifyWidget,
}

impl Owner {
  // For the page: which items
  fn page(self) -> &'static str {
    match self {
      Owner::Hardware => "hardware",
      Owner::SpotifyStrip => "spotify-strip",
      Owner::SpotifyWidget => "spotify-widget",
    }
  }
  // For the main window: "<module>-menu" (a choice) and "<module>-open" (its settings…)
  fn module(self) -> &'static str {
    match self {
      Owner::Hardware => "hardware",
      Owner::SpotifyStrip | Owner::SpotifyWidget => "spotify",
    }
  }
}

#[derive(Clone, Copy, PartialEq)]
enum Stage {
  None,
  Making,  // its window and page are loading
  Waiting, // ready, hidden, for a right-click
  Open,
  Closing,
}
struct MenuState {
  stage: Stage,
  owner: Owner,           // the last one the mouse was over, or the one it's open for
  window: isize,          // that one's window (screen pixels: the mouse over it keeps a waiting menu)
  area: RECT,             // the monitor it covers (screen pixels)
  open_at: Option<POINT>, // right-clicked while it was being made: opened there once its page is in
  away: u32,              // seconds the mouse has been off the owner while it waits
  making: u32,            // seconds it has been loading
  made: u64,              // which menu (each one made gets the next number): a late one knows it's not wanted
}
const NO_AREA: RECT = RECT { left: 0, top: 0, right: 0, bottom: 0 };
static STATE: Mutex<MenuState> = Mutex::new(MenuState {
  stage: Stage::None,
  owner: Owner::Hardware,
  window: 0,
  area: NO_AREA,
  open_at: None,
  away: 0,
  making: 0,
  made: 0,
});
static APP: Mutex<Option<AppHandle>> = Mutex::new(None);
const KEPT: u32 = 5; // seconds a waiting menu stays after the mouse leaves its owner
// A page that hasn't said "loaded" by then never will (it failed): the menu goes, and the next
// time the mouse comes it's made again (else no right-click would open it until SyncR restarts)
const LOAD_LIMIT: u32 = 10;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
  mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// At start (lib.rs): menus are made from the owners' own threads
pub fn init(app: AppHandle) {
  *lock(&APP) = Some(app);
}

// No menu any more: the next mouse over an owner makes one again
fn gone(state: &mut MenuState) {
  state.stage = Stage::None;
  state.open_at = None;
  state.away = 0;
  state.making = 0;
}

// Open (for any owner: it covers the whole monitor). "On top" then leaves the menu above the
// widget, and a right-click on it isn't the widget's
pub fn is_open() -> bool {
  lock(&STATE).stage == Stage::Open
}

// The mouse, and the monitor it's on
fn mouse_monitor() -> Option<(POINT, RECT)> {
  let mut mouse = POINT { x: 0, y: 0 };
  let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, rcMonitor: NO_AREA, rcWork: NO_AREA, dwFlags: 0 };
  // info has its size set, as Windows asks
  let found = unsafe { GetCursorPos(&mut mouse) != 0 && GetMonitorInfoW(MonitorFromPoint(mouse, MONITOR_DEFAULTTONEAREST), &mut info) != 0 };
  found.then_some((mouse, info.rcMonitor))
}

// The mouse is over an owner's window: the menu gets ready, hidden, if it isn't yet
pub fn prepare(owner: Owner, window: HWND) {
  let making = {
    let mut state = lock(&STATE);
    if state.stage != Stage::Open {
      state.owner = owner;
      state.window = window as isize;
    }
    state.away = 0;
    state.stage == Stage::None
  };
  if making {
    if let Some((_, area)) = mouse_monitor() {
      make(area, None);
    }
  }
}

// Right-click on an owner: its menu where the mouse is. Waiting: shown now; still being made:
// once its page is in; not made (a right-click without a move over it first): made now.
pub fn open(owner: Owner, window: HWND) {
  let Some((mouse, area)) = mouse_monitor() else { return };
  let made_for = {
    let mut state = lock(&STATE);
    if matches!(state.stage, Stage::Open | Stage::Closing) {
      return;
    }
    state.owner = owner;
    state.window = window as isize;
    match state.stage {
      Stage::Making => {
        state.open_at = Some(mouse);
        return;
      }
      Stage::Waiting => {
        state.stage = Stage::Open;
        Some(state.area)
      }
      _ => None,
    }
  };
  match made_for {
    Some(made_for) => show(owner, mouse, area, made_for),
    None => make(area, Some(mouse)),
  }
}

fn make(area: RECT, open_at: Option<POINT>) {
  let Some(app) = lock(&APP).clone() else { return };
  let made = {
    let mut state = lock(&STATE);
    if state.stage != Stage::None {
      return;
    }
    state.stage = Stage::Making;
    state.area = area;
    state.open_at = open_at;
    state.away = 0;
    state.making = 0;
    state.made += 1;
    state.made
  };
  // Making a window waits for the app's main thread: not on the owner's, which draws it
  std::thread::spawn(move || {
    let mine = move |state: &MenuState| state.made == made;
    let built = WebviewWindowBuilder::new(&app, MENU, WebviewUrl::App("widget-menu.html".into()))
      .title("SyncR")
      .decorations(false)
      .transparent(true)
      .shadow(false)
      .always_on_top(true)
      .skip_taskbar(true)
      .resizable(false)
      .maximizable(false)
      .minimizable(false)
      .visible(false)
      .focused(false)
      // Same origin as the main window, so it reads the same saved settings and language
      .use_https_scheme(true)
      .on_navigation(|url| url.path() == "/widget-menu.html")
      // Its file-drop listener is let go only after the window is gone, which Windows refuses:
      // each menu then kept 2 handles (shared memory) until SyncR closed. The menu takes no files.
      .disable_drag_drop_handler()
      .build();
    let Ok(menu) = built else {
      let mut state = lock(&STATE);
      if mine(&state) {
        gone(&mut state);
      }
      return;
    };
    // Given up on while it was being made (it took too long): not wanted any more
    {
      let state = lock(&STATE);
      if !mine(&state) || state.stage != Stage::Making {
        drop(state);
        let _ = menu.destroy();
        return;
      }
    }
    // Gone in any way: a look shown from it goes back to the saved one
    let handle = app.clone();
    menu.on_window_event(move |event| {
      if matches!(event, tauri::WindowEvent::Destroyed) {
        let mut state = lock(&STATE);
        let owner = state.owner;
        if mine(&state) {
          gone(&mut state);
        }
        drop(state);
        let _ = handle.emit_to("main", &format!("{}-menu", owner.module()), serde_json::json!({ "preview": null }));
      }
    });
    // A tool window (still hidden, so it takes now): over the whole monitor it would otherwise
    // pass for a full-screen app, and "Hide during full screen" hid its owner while it was open
    if let Ok(hwnd) = menu.hwnd() {
      let window = hwnd.0 as HWND;
      // window is the menu's, alive: it's only destroyed from this app's own calls
      unsafe {
        let style = GetWindowLongPtrW(window, GWL_EXSTYLE);
        SetWindowLongPtrW(window, GWL_EXSTYLE, style | WS_EX_TOOLWINDOW as isize);
      }
    }
    place(&menu, area);
  });
}

// Over the whole monitor (placed first: on another monitor's scale, Windows resizes it)
fn place(menu: &tauri::WebviewWindow, area: RECT) {
  let _ = menu.set_position(tauri::PhysicalPosition::new(area.left, area.top));
  let _ = menu.set_size(tauri::PhysicalSize::new((area.right - area.left).max(1) as u32, (area.bottom - area.top).max(1) as u32));
}

// Tells its page whose menu it is, where the mouse is and the window's size in screen pixels
// (moved first if the right-click is on another monitor than the one it was made for); the page
// draws the menu once the window has that size, then asks to be shown (widget_menu "ready")
fn show(owner: Owner, mouse: POINT, area: RECT, made_for: RECT) {
  let Some(app) = lock(&APP).clone() else { return };
  std::thread::spawn(move || {
    let Some(menu) = app.get_webview_window(MENU) else { return };
    let same = (area.left, area.top, area.right, area.bottom) == (made_for.left, made_for.top, made_for.right, made_for.bottom);
    if !same {
      lock(&STATE).area = area;
      place(&menu, area);
    }
    let at = serde_json::json!({
      "for": owner.page(),
      "x": mouse.x - area.left,
      "y": mouse.y - area.top,
      "w": (area.right - area.left).max(1),
      "h": (area.bottom - area.top).max(1),
    });
    // Called in its page (widgetMenu.tsx), which then needs no right to listen to the app's events
    let _ = menu.eval(format!("window.openWidgetMenu?.({at})"));
  });
}

// Every second, from each owner (window: its window, null when it has none now): a waiting menu
// last readied by it goes once the mouse has been off it for KEPT seconds (no window: at once);
// one still loading after LOAD_LIMIT seconds goes too
pub fn away(owner: Owner, window: HWND) {
  let mut state = lock(&STATE);
  if state.owner != owner {
    return;
  }
  if state.stage == Stage::Making {
    state.making += 1;
    if state.making >= LOAD_LIMIT {
      state.stage = Stage::Closing;
      drop(state);
      close();
    }
    return;
  }
  if state.stage != Stage::Waiting {
    return;
  }
  let mut mouse = POINT { x: 0, y: 0 };
  let mut rect = NO_AREA;
  let over = !window.is_null()
    && unsafe { GetCursorPos(&mut mouse) != 0 && GetWindowRect(window, &mut rect) != 0 }
    && (rect.left..rect.right).contains(&mouse.x)
    && (rect.top..rect.bottom).contains(&mouse.y);
  state.away = if over { 0 } else { state.away + 1 };
  if state.away >= KEPT || window.is_null() {
    state.stage = Stage::Closing;
    drop(state);
    close();
  }
}

// Its window goes, and with it (Destroyed, make) the stage. No window (already gone, or not built
// yet: make then drops it when it comes): back to no menu here, else it would stay "closing" and
// no right-click would open it again.
fn close() {
  let gone_now = || {
    let mut state = lock(&STATE);
    if state.stage == Stage::Closing {
      gone(&mut state);
    }
  };
  let Some(app) = lock(&APP).clone() else { return gone_now() };
  std::thread::spawn(move || match app.get_webview_window(MENU) {
    Some(menu) => {
      if menu.destroy().is_err() {
        gone_now();
      }
    }
    None => gone_now(),
  });
}

// From the menu's page: "loaded" (its page is in, hidden), "ready" (the menu is drawn: show it),
// "choice" (a changed option, for the main window: hardware.ts, spotify.ts), "settings" (the
// owner's settings…), "close". Whose menu it is comes from here, not from the page.
#[tauri::command]
pub fn widget_menu(app: AppHandle, action: String, choice: Option<serde_json::Value>) {
  let owner = lock(&STATE).owner;
  match action.as_str() {
    "loaded" => {
      let mut state = lock(&STATE);
      if state.stage != Stage::Making {
        return;
      }
      match state.open_at.take() {
        Some(mouse) => {
          state.stage = Stage::Open;
          let made_for = state.area;
          drop(state);
          let area = mouse_monitor().map(|(_, area)| area).unwrap_or(made_for);
          show(owner, mouse, area, made_for);
        }
        // Its owner went meanwhile (module off, nothing to show): not needed
        None if unsafe { IsWindowVisible(state.window as HWND) } == 0 => {
          state.stage = Stage::Closing;
          drop(state);
          close();
        }
        None => state.stage = Stage::Waiting,
      }
    }
    "ready" => {
      if let Some(menu) = app.get_webview_window(MENU) {
        let _ = menu.show();
        let _ = menu.set_focus();
      }
    }
    "choice" => {
      let _ = app.emit_to("main", &format!("{}-menu", owner.module()), choice);
    }
    "settings" => {
      let _ = app.emit_to("main", &format!("{}-open", owner.module()), ());
      crate::show_main(&app);
    }
    "close" => {
      lock(&STATE).stage = Stage::Closing;
      close();
    }
    _ => {}
  }
}
