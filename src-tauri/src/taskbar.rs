// What the strips inside the taskbar share (the mouse battery's: mouse_battery/strip.rs, Spotify's:
// spotify/strip.rs): where they go, their window class, Windows' tooltip, sizes, the hover
// highlight's shape. Each strip has its own thread; they only meet in BATTERY_LEFT.
// Order from the right: the notification area, the battery, then Spotify, 4 px apart.

use crate::mouse_battery::wide;
use std::ptr::{null, null_mut};
use std::sync::Mutex;
use crate::mouse_battery::gdi::Canvas;
use windows_sys::Win32::Foundation::{HMODULE, HWND, LPARAM, POINT, RECT, SIZE};
use windows_sys::Win32::Graphics::Gdi::{AC_SRC_ALPHA, AC_SRC_OVER, BLENDFUNCTION};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Controls::{
  SetWindowTheme, TOOLTIPS_CLASSW, TTF_IDISHWND, TTF_SUBCLASS, TTM_ADDTOOLW, TTM_SETMAXTIPWIDTH, TTM_UPDATETIPTEXTW, TTS_ALWAYSTIP,
  TTS_NOPREFIX, TTTOOLINFOW,
};
use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
use windows_sys::Win32::UI::WindowsAndMessaging::{
  CreateWindowExW, DestroyWindow, FindWindowExW, FindWindowW, GetParent, GetWindowRect, IsWindow, LoadCursorW, RegisterClassExW,
  SendMessageW, SetWindowPos, UpdateLayeredWindow, HWND_TOP, IDC_ARROW, SWP_NOACTIVATE, SWP_SHOWWINDOW, ULW_ALPHA, WNDCLASSEXW,
  WNDPROC, WS_CHILD, WS_CLIPSIBLINGS, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_NOPARENTNOTIFY, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
  WS_POPUP,
};

pub const GAP: i32 = 4; // between two strips, and between the battery and the notification area (at 100%)

// The battery strip's left edge (taskbar pixels) and its taskbar while it's shown
static BATTERY_LEFT: Mutex<Option<(isize, i32)>> = Mutex::new(None);

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
  mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// The battery strip moved, changed width, came or went (None): Spotify's goes along at once
pub fn set_battery_left(left: Option<(HWND, i32)>) {
  let left = left.map(|(taskbar, x)| (taskbar as isize, x));
  let changed = {
    let mut now = lock(&BATTERY_LEFT);
    let changed = *now != left;
    *now = left;
    changed
  };
  if changed {
    crate::spotify::strip_refresh();
  }
}

// Where the main screen's taskbar has room for a strip: the left edge of its notification area (in
// the taskbar's own pixels), its height and scale
pub struct Spot {
  pub taskbar: HWND,
  pub right: i32,
  pub height: i32,
  pub dpi: u32,
}

impl Spot {
  // The right edge for Spotify's strip: left of the battery's when it's shown, else in its place
  pub fn left_of_battery(&self) -> i32 {
    match *lock(&BATTERY_LEFT) {
      Some((taskbar, left)) if taskbar == self.taskbar as isize => left - scaled(GAP, self.dpi),
      _ => self.right - scaled(GAP, self.dpi),
    }
  }
}

// None: no taskbar, or it's on a side of the screen
pub fn spot() -> Option<Spot> {
  unsafe {
    let taskbar = FindWindowW(wide("Shell_TrayWnd").as_ptr(), null());
    if taskbar.is_null() {
      return None;
    }
    let notify = FindWindowExW(taskbar, null_mut(), wide("TrayNotifyWnd").as_ptr(), null());
    if notify.is_null() {
      return None;
    }
    let mut bar = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    let mut area = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    if GetWindowRect(taskbar, &mut bar) == 0 || GetWindowRect(notify, &mut area) == 0 {
      return None;
    }
    let (width, height) = (bar.right - bar.left, bar.bottom - bar.top);
    if height <= 0 || width <= height {
      return None; // on a side of the screen
    }
    let dpi = GetDpiForWindow(taskbar);
    Some(Spot { taskbar, right: area.left - bar.left, height, dpi: if dpi == 0 { 96 } else { dpi } })
  }
}

// Sizes in the taskbar's pixels: `px` at 100% scale
pub fn scaled(px: i32, dpi: u32) -> i32 {
  (px * dpi as i32 + 48) / 96
}

// Fails harmlessly when an earlier start already registered it
pub unsafe fn register(instance: HMODULE, class: &[u16], procedure: WNDPROC) {
  let info = WNDCLASSEXW {
    cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
    style: 0,
    lpfnWndProc: procedure,
    cbClsExtra: 0,
    cbWndExtra: 0,
    hInstance: instance,
    hIcon: null_mut(),
    hCursor: unsafe { LoadCursorW(null_mut(), IDC_ARROW) },
    hbrBackground: null_mut(),
    lpszMenuName: null(),
    lpszClassName: class.as_ptr(),
    hIconSm: null_mut(),
  };
  unsafe { RegisterClassExW(&info) };
}

// A strip's window: see-through, a child of the taskbar (null: it couldn't be made)
pub fn new_strip(class: &str, spot: &Spot, x: i32, width: i32) -> HWND {
  let class = wide(class);
  unsafe {
    CreateWindowExW(
      WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_NOPARENTNOTIFY,
      class.as_ptr(),
      null(),
      WS_CHILD | WS_CLIPSIBLINGS,
      x,
      0,
      width,
      spot.height,
      spot.taskbar,
      null_mut(),
      GetModuleHandleW(null()),
      null(),
    )
  }
}

// Gone with an Explorer restart, or inside an old taskbar: it must be made again
pub fn stale(strip: HWND, spot: &Spot) -> bool {
  !strip.is_null() && unsafe { IsWindow(strip) == 0 || GetParent(strip) != spot.taskbar }
}

// A new picture for the strip (premultiplied colors, as tall as the taskbar). false: refused.
pub fn paint(strip: HWND, picture: &Canvas) -> bool {
  let size = SIZE { cx: picture.width as i32, cy: picture.height as i32 };
  let source = POINT { x: 0, y: 0 };
  let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: 255, AlphaFormat: AC_SRC_ALPHA as u8 };
  unsafe { UpdateLayeredWindow(strip, null_mut(), null(), &size, picture.dc, &source, 0, &blend, ULW_ALPHA) != 0 }
}

pub fn move_strip(strip: HWND, spot: &Spot, x: i32, width: i32) {
  unsafe { SetWindowPos(strip, HWND_TOP, x, 0, width, spot.height, SWP_NOACTIVATE | SWP_SHOWWINDOW) };
}

pub fn remove(strip: HWND) {
  unsafe {
    if !strip.is_null() && IsWindow(strip) != 0 {
      DestroyWindow(strip);
    }
  }
}

// Windows' own tooltip for a strip (it follows the mouse over the strip by itself). Owned by the
// strip thread's hidden window, which is ours, not by the taskbar. Removed with it.
pub struct Tooltip {
  window: HWND,
  strip: HWND,
  text: String,         // its text now
  light: Option<bool>,  // its look now (light or dark, like the taskbar)
}

impl Tooltip {
  pub fn new(owner: HWND, strip: HWND) -> Option<Tooltip> {
    unsafe {
      let window = CreateWindowExW(
        WS_EX_TOPMOST,
        TOOLTIPS_CLASSW,
        null(),
        WS_POPUP | TTS_NOPREFIX | TTS_ALWAYSTIP,
        0,
        0,
        0,
        0,
        owner,
        null_mut(),
        GetModuleHandleW(null()),
        null(),
      );
      if window.is_null() {
        return None;
      }
      let mut text = wide("");
      let info = tool(strip, &mut text);
      SendMessageW(window, TTM_ADDTOOLW, 0, &info as *const TTTOOLINFOW as LPARAM);
      SendMessageW(window, TTM_SETMAXTIPWIDTH, 0, 600); // lets "\n" start new lines
      Some(Tooltip { window, strip, text: String::new(), light: None })
    }
  }

  // New words, or the taskbar turned light/dark
  pub fn update(&mut self, text: &str, light: bool) {
    unsafe {
      if text != self.text {
        let mut words = wide(text);
        let info = tool(self.strip, &mut words);
        SendMessageW(self.window, TTM_UPDATETIPTEXTW, 0, &info as *const TTTOOLINFOW as LPARAM);
        self.text = text.to_string();
      }
      if self.light != Some(light) {
        let theme = wide(if light { "Explorer" } else { "DarkMode_Explorer" });
        SetWindowTheme(self.window, theme.as_ptr(), null());
        self.light = Some(light);
      }
    }
  }
}

impl Drop for Tooltip {
  fn drop(&mut self) {
    unsafe {
      if IsWindow(self.window) != 0 {
        DestroyWindow(self.window);
      }
    }
  }
}

fn tool(strip: HWND, text: &mut [u16]) -> TTTOOLINFOW {
  TTTOOLINFOW {
    cbSize: std::mem::size_of::<TTTOOLINFOW>() as u32,
    uFlags: TTF_IDISHWND | TTF_SUBCLASS,
    hwnd: strip,
    uId: strip as usize,
    lpszText: text.as_mut_ptr(),
    ..Default::default()
  }
}

// The hover highlight, like the taskbar's own: its color and strength on a light or dark taskbar
pub fn highlight(light: bool) -> ([u8; 3], f32) {
  if light { ([0, 0, 0], 0.06) } else { ([255, 255, 255], 0.08) }
}

// How much of a pixel (its center) is inside a box with rounded corners: 0 to 1, soft at the edge
pub fn rounded_box(x: f32, y: f32, left: f32, top: f32, right: f32, bottom: f32, corner: f32) -> f32 {
  let (center_x, center_y) = ((left + right) / 2.0, (top + bottom) / 2.0);
  let (half_x, half_y) = ((right - left) / 2.0 - corner, (bottom - top) / 2.0 - corner);
  let (qx, qy) = ((x - center_x).abs() - half_x, (y - center_y).abs() - half_y);
  let outside = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt() + qx.max(qy).min(0.0) - corner;
  (0.5 - outside).clamp(0.0, 1.0)
}
