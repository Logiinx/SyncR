// Where SyncR's desktop widgets (the Hardware widget, the Spotify widget) live: the desktop's icon
// view they sit in (or the screen when "always on top"), their monitors and those monitors' scale.
// Nothing here may panic: the app is built with panic = "abort", so a panic would close SyncR.

use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
use windows_sys::Win32::Graphics::Gdi::{
  GetMonitorInfoW, MonitorFromPoint, ScreenToClient, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTONULL,
  MONITOR_DEFAULTTOPRIMARY,
};
use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowExW, FindWindowW, GetWindowRect};

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

pub fn main_monitor() -> HMONITOR {
  unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) }
}

// A monitor's room without its taskbars (screen pixels)
pub fn work_area(monitor: HMONITOR) -> Option<RECT> {
  let empty = RECT { left: 0, top: 0, right: 0, bottom: 0 };
  let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, rcMonitor: empty, rcWork: empty, dwFlags: 0 };
  // info has its size set, as Windows asks
  (unsafe { GetMonitorInfoW(monitor, &mut info) } != 0).then_some(info.rcWork)
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
