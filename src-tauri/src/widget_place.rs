// Where SyncR's desktop widgets (the Hardware widget, the Spotify widget) live: the desktop's icon
// view they sit in (or the screen when "always on top"), their monitors and those monitors' scale,
// and whether a full-screen app is in front of them.
// Nothing here may panic: the app is built with panic = "abort", so a panic would close SyncR.

use std::ptr::{null, null_mut};
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows_sys::Win32::Graphics::Gdi::{
  GetMonitorInfoW, MonitorFromPoint, ScreenToClient, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTONULL,
  MONITOR_DEFAULTTOPRIMARY,
};
use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  EnumWindows, FindWindowExW, FindWindowW, GetClassNameW, GetParent, GetWindowLongW, GetWindowRect, IsIconic, IsWindowVisible, IsZoomed,
  SetWindowPos, GWL_EXSTYLE, GWL_STYLE, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, WS_CAPTION, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
  WS_EX_TRANSPARENT,
};

pub const MARGIN: f32 = 16.0; // from the monitor's edges, the first time (DIPs)

// The desktop's icon view, which a widget lives in: inside "Progman", or on older Windows (after
// a wallpaper change) inside one of the "WorkerW" windows
pub fn desktop() -> HWND {
  unsafe {
    let view_class = wide("SHELLDLL_DefView");
    let progman = FindWindowW(wide("Progman").as_ptr(), null());
    if !progman.is_null() {
      let view = FindWindowExW(progman, null_mut(), view_class.as_ptr(), null());
      if !view.is_null() {
        return view;
      }
    }
    let worker_class = wide("WorkerW");
    let mut worker: HWND = null_mut();
    loop {
      worker = FindWindowExW(null_mut(), worker, worker_class.as_ptr(), null());
      if worker.is_null() {
        return null_mut();
      }
      let view = FindWindowExW(worker, null_mut(), view_class.as_ptr(), null());
      if !view.is_null() {
        return view;
      }
    }
  }
}

// Screen pixels → inside the desktop (no parent: the screen's own)
pub fn to_parent(parent: HWND, (x, y): (i32, i32)) -> POINT {
  let mut point = POINT { x, y };
  if !parent.is_null() {
    unsafe { ScreenToClient(parent, &mut point) };
  }
  point
}

// A window's top left on screen
pub fn window_place(window: HWND) -> Option<(i32, i32)> {
  let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
  (unsafe { GetWindowRect(window, &mut rect) } != 0).then_some((rect.left, rect.top))
}

// A point just inside the widget's corner is on a monitor (a few pixels, so a widget pushed to an
// edge still counts)
pub fn on_a_monitor(x: i32, y: i32) -> bool {
  !unsafe { MonitorFromPoint(POINT { x: x + 8, y: y + 8 }, MONITOR_DEFAULTTONULL) }.is_null()
}

// Where a widget goes now (screen pixels, top left), checked every second and when monitors
// change. The place the user left it (`saved`) is never replaced by a stand-in: while its monitor
// is gone (asleep, unplugged, a game's resolution) the widget waits at `fallback` ("away"), and
// goes back once that monitor is there again.
pub struct Placed {
  pub at: (i32, i32),
  pub moved: bool, // it must be put there (new, or moved away or back)
  pub away: bool,  // it's at `fallback` because the saved place is on no monitor
}

pub fn place_now(here: Option<(i32, i32)>, saved: Option<(i32, i32)>, away: bool, fallback: impl Fn() -> (i32, i32)) -> Placed {
  let shown = saved.filter(|&(x, y)| on_a_monitor(x, y));
  match (here, shown) {
    // New: the saved place, else the first-time corner (away only if there was a saved place)
    (None, Some(at)) => Placed { at, moved: true, away: false },
    (None, None) => Placed { at: fallback(), moved: true, away: saved.is_some() },
    // Its monitor is back
    (Some(_), Some(at)) if away => Placed { at, moved: true, away: false },
    // Its corner is on no monitor (a monitor went, or the desktop shifted after a change)
    (Some((x, y)), _) if !on_a_monitor(x, y) => Placed { at: fallback(), moved: true, away: true },
    (Some(at), _) => Placed { at, moved: false, away },
  }
}

// Let go after a drag: a widget whose corner is on no monitor (pushed past an edge, or into the
// gap between two monitors) is pushed back inside the nearest one's work area, so the place saved
// is one it can come back to. Its place on screen, after that.
pub fn keep_inside(window: HWND) -> Option<(i32, i32)> {
  let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
  if unsafe { GetWindowRect(window, &mut rect) } == 0 {
    return None;
  }
  if on_a_monitor(rect.left, rect.top) {
    return Some((rect.left, rect.top));
  }
  let monitor = unsafe { MonitorFromPoint(POINT { x: rect.left + 8, y: rect.top + 8 }, MONITOR_DEFAULTTONEAREST) };
  let work = work_area(monitor)?;
  let (width, height) = (rect.right - rect.left, rect.bottom - rect.top);
  // The left and top edges win when it's bigger than the room
  let x = rect.left.min(work.right - width).max(work.left);
  let y = rect.top.min(work.bottom - height).max(work.top);
  let corner = to_parent(unsafe { GetParent(window) }, (x, y));
  unsafe { SetWindowPos(window, null_mut(), corner.x, corner.y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE) };
  Some((x, y))
}

pub fn main_monitor() -> HMONITOR {
  unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) }
}

// A monitor's room without its taskbars (screen pixels)
pub fn work_area(monitor: HMONITOR) -> Option<RECT> {
  monitor_info(monitor).map(|info| info.rcWork)
}

fn monitor_info(monitor: HMONITOR) -> Option<MONITORINFO> {
  let empty = RECT { left: 0, top: 0, right: 0, bottom: 0 };
  let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, rcMonitor: empty, rcWork: empty, dwFlags: 0 };
  // info has its size set, as Windows asks
  (unsafe { GetMonitorInfoW(monitor, &mut info) } != 0).then_some(info)
}

// "Hide during full screen": a full-screen app (a game, a video, a browser in F11) in front on the
// widget's monitor: where it is, else its saved place, else where it would first go (`first`).
pub fn full_screen_near(here: Option<(i32, i32)>, saved: Option<(i32, i32)>, first: impl Fn() -> (i32, i32)) -> bool {
  let (x, y) = here.or(saved.filter(|&(x, y)| on_a_monitor(x, y))).unwrap_or_else(first);
  let monitor = unsafe { MonitorFromPoint(POINT { x: x + 8, y: y + 8 }, MONITOR_DEFAULTTONEAREST) };
  let Some(info) = monitor_info(monitor) else { return false };
  let mut look = FullScreen { area: info.rcMonitor, found: false };
  // look outlives the call, which calls each_window once per window, front to back
  unsafe { EnumWindows(Some(each_window), &mut look as *mut FullScreen as LPARAM) };
  look.found
}

struct FullScreen {
  area: RECT, // the monitor
  found: bool,
}

// Front to back: the first window on the monitor that covers all of it, before any ordinary one.
// So a game stays "in front" on its monitor while the mouse works on another one. Looked past:
// hidden windows (minimized, on another virtual desktop), tool windows (SyncR's widgets, menus,
// tooltips), click-through ones (game overlays, often as big as the screen) and small ones kept on
// top (another widget). A maximized window with a title bar covers it all when the taskbar hides
// itself: ordinary, not full screen. The desktop is the end.
unsafe extern "system" fn each_window(window: HWND, lparam: LPARAM) -> BOOL {
  // lparam is the FullScreen above, alive for the whole EnumWindows call
  let look = unsafe { &mut *(lparam as *mut FullScreen) };
  let mut cloaked: u32 = 0;
  unsafe {
    let hidden = IsWindowVisible(window) == 0
      || IsIconic(window) != 0
      || (DwmGetWindowAttribute(window, DWMWA_CLOAKED as u32, &mut cloaked as *mut u32 as *mut _, size_of::<u32>() as u32) == 0 && cloaked != 0);
    let extended = GetWindowLongW(window, GWL_EXSTYLE) as u32;
    if hidden || extended & (WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT) != 0 {
      return 1;
    }
    let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    if GetWindowRect(window, &mut rect) == 0 {
      return 1;
    }
    let area = look.area;
    if rect.right <= area.left || rect.left >= area.right || rect.bottom <= area.top || rect.top >= area.bottom {
      return 1;
    }
    let mut class = [0u16; 16];
    let length = GetClassNameW(window, class.as_mut_ptr(), class.len() as i32).max(0) as usize;
    let class = String::from_utf16_lossy(&class[..length]);
    if class == "Progman" || class == "WorkerW" {
      return 0;
    }
    let covers = rect.left <= area.left && rect.top <= area.top && rect.right >= area.right && rect.bottom >= area.bottom;
    let titled = GetWindowLongW(window, GWL_STYLE) as u32 & WS_CAPTION == WS_CAPTION;
    if covers && !(IsZoomed(window) != 0 && titled) {
      look.found = true;
      return 0;
    }
    if !covers && extended & WS_EX_TOPMOST != 0 {
      return 1;
    }
    0
  }
}

// MARGIN on this monitor, in its pixels
pub fn margin(monitor: HMONITOR) -> i32 {
  (MARGIN * monitor_dpi(monitor) as f32 / 96.0).round() as i32
}

// The scale where a widget's corner is (its nearest monitor)
pub fn dpi_at(x: i32, y: i32) -> u32 {
  monitor_dpi(unsafe { MonitorFromPoint(POINT { x: x + 8, y: y + 8 }, MONITOR_DEFAULTTONEAREST) })
}

pub fn monitor_dpi(monitor: HMONITOR) -> u32 {
  let (mut x, mut y) = (0u32, 0u32);
  // monitor comes from MonitorFrom…, which never gives an invalid one with these flags
  let ok = unsafe { GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut x, &mut y) } == 0;
  if ok && x > 0 {
    x
  } else {
    96
  }
}

fn wide(text: &str) -> Vec<u16> {
  text.encode_utf16().chain(std::iter::once(0)).collect()
}
