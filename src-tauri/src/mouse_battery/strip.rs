// The mouse battery inside the taskbar (main screen): a see-through child window of the taskbar,
// just left of the notification area, with an outlined mouse (Windows' icon font) and the percent
// in the clock's font. A click opens the Mouse battery window in SyncR.
// Its own thread: once inside the taskbar it shares Windows' input with it, so it must never wait
// on anything slow (the receiver is asked by the check thread). Placed again every second: the
// notification area changes width when icons come and go, and an Explorer restart takes the strip
// along. Taskbar on a side of the screen or not found for 3 s: the tray icon stands in.

use super::gdi::Canvas;
use super::{config, icon, lock, shown, wake, wide};
use std::cell::RefCell;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{AC_SRC_ALPHA, AC_SRC_OVER, BLENDFUNCTION, DT_LEFT, FW_NORMAL};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::GetDpiForWindow;
use windows_sys::Win32::UI::WindowsAndMessaging::{
  CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, FindWindowExW, FindWindowW, GetMessageW, GetParent,
  GetWindowRect, IsWindow, LoadCursorW, PostMessageW, PostQuitMessage, RegisterClassExW, SetTimer, SetWindowPos,
  TranslateMessage, UpdateLayeredWindow, HWND_TOP, IDC_ARROW, MA_NOACTIVATE, MSG, SWP_NOACTIVATE, SWP_SHOWWINDOW,
  ULW_ALPHA, WM_APP, WM_CLOSE, WM_DESTROY, WM_LBUTTONUP, WM_MOUSEACTIVATE, WM_SETTINGCHANGE, WM_TIMER, WNDCLASSEXW,
  WNDPROC, WS_CHILD, WS_CLIPSIBLINGS, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_NOPARENTNOTIFY, WS_EX_TOOLWINDOW, WS_POPUP,
};

const WM_REFRESH: u32 = WM_APP + 1;
const PLACE_TIMER: usize = 1;
const CONTROLLER_CLASS: &str = "SyncRMouseBatteryControl";
const STRIP_CLASS: &str = "SyncRMouseBatteryStrip";
const MOUSE_GLYPH: &str = "\u{E962}"; // "Mouse" in Windows' icon fonts
const ICON_FONTS: &[&str] = &["Segoe Fluent Icons", "Segoe MDL2 Assets"]; // Windows 11, Windows 10
const TEXT_FONTS: &[&str] = &["Segoe UI Variable Text", "Segoe UI"]; // the clock's, Windows 11 then 10

// The running strip thread's hidden window (0: none), the number of the latest start or stop (an
// older thread that comes up late closes itself), whether the tray icon stands in, and the app (clicks)
static CONTROLLER: Mutex<isize> = Mutex::new(0);
static STARTS: AtomicU64 = AtomicU64::new(0);
static STANDS_IN: AtomicBool = AtomicBool::new(false);
static APP: Mutex<Option<AppHandle>> = Mutex::new(None);

// The module turned on (the thread also runs while only the tray icon shows: step 3 hangs plug-in
// and wake-up signals on it)
pub fn start(app: AppHandle) {
  *lock(&APP) = Some(app);
  let start = STARTS.fetch_add(1, Ordering::SeqCst) + 1;
  std::thread::spawn(move || run(start));
}

pub fn stop() {
  STARTS.fetch_add(1, Ordering::SeqCst);
  STANDS_IN.store(false, Ordering::SeqCst);
  let controller = std::mem::take(&mut *lock(&CONTROLLER));
  if controller != 0 {
    unsafe { PostMessageW(controller as HWND, WM_CLOSE, 0, 0) };
  }
}

// New settings or a new check: draw again
pub fn refresh() {
  let controller = *lock(&CONTROLLER);
  if controller != 0 {
    unsafe { PostMessageW(controller as HWND, WM_REFRESH, 0, 0) };
  }
}

// The strip is wanted but can't be placed (taskbar on a side, or not found): the tray icon shows
pub fn stands_in() -> bool {
  STANDS_IN.load(Ordering::SeqCst)
}

fn set_stands_in(on: bool) {
  if STANDS_IN.swap(on, Ordering::SeqCst) != on {
    wake();
  }
}

// What's drawn: redrawn only when one of these changes
#[derive(Clone, PartialEq)]
struct Look {
  dpi: u32,
  height: i32,
  text: String,
  low: bool,
  light: bool,
}

struct Drawn {
  look: Look,
  x: i32,
  width: i32,
}

// This thread's own state (only the strip thread touches it)
struct Local {
  strip: HWND,
  misses: u32, // seconds in a row without a usable taskbar
  drawn: Option<Drawn>,
}

thread_local! {
  static LOCAL: RefCell<Local> = const { RefCell::new(Local { strip: null_mut(), misses: 0, drawn: None }) };
}

fn run(start: u64) {
  unsafe {
    let instance = GetModuleHandleW(null());
    let controller_class = wide(CONTROLLER_CLASS);
    let strip_class = wide(STRIP_CLASS);
    register(instance, &controller_class, Some(controller_proc));
    register(instance, &strip_class, Some(strip_proc));
    // Hidden and never shown: a top-level window, so it hears Windows' settings changes
    let controller = CreateWindowExW(
      WS_EX_TOOLWINDOW,
      controller_class.as_ptr(),
      null(),
      WS_POPUP,
      0,
      0,
      0,
      0,
      null_mut(),
      null_mut(),
      instance,
      null(),
    );
    if controller.is_null() {
      return;
    }
    {
      let mut registered = lock(&CONTROLLER);
      if STARTS.load(Ordering::SeqCst) != start {
        drop(registered);
        DestroyWindow(controller);
        return;
      }
      *registered = controller as isize;
    }
    SetTimer(controller, PLACE_TIMER, 1000, None);
    place();
    let mut message: MSG = std::mem::zeroed();
    while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
  }
}

// Fails harmlessly when an earlier start already registered it
unsafe fn register(instance: windows_sys::Win32::Foundation::HMODULE, class: &[u16], procedure: WNDPROC) {
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

unsafe extern "system" fn controller_proc(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
  match message {
    WM_TIMER | WM_REFRESH => {
      place();
      0
    }
    // Light/dark may have changed. It arrives while Windows waits, so redrawn a moment later.
    WM_SETTINGCHANGE => {
      unsafe { PostMessageW(window, WM_REFRESH, 0, 0) };
      wake();
      0
    }
    WM_CLOSE => {
      LOCAL.with(|local| {
        if let Ok(mut local) = local.try_borrow_mut() {
          hide(&mut local);
        }
      });
      unsafe { DestroyWindow(window) };
      0
    }
    WM_DESTROY => {
      unsafe { PostQuitMessage(0) };
      0
    }
    _ => unsafe { DefWindowProcW(window, message, wparam, lparam) },
  }
}

unsafe extern "system" fn strip_proc(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
  match message {
    // A click never takes the focus from the app in front
    WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
    WM_LBUTTONUP => {
      if let Some(app) = lock(&APP).clone() {
        let _ = app.emit("mouse-battery-open", ());
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || crate::show_main(&handle));
      }
      0
    }
    _ => unsafe { DefWindowProcW(window, message, wparam, lparam) },
  }
}

fn place() {
  LOCAL.with(|local| {
    // Busy already (Windows can call in while the strip is being moved): the next second does it
    let Ok(mut local) = local.try_borrow_mut() else { return };
    if !config().is_some_and(|config| config.taskbar) {
      hide(&mut local);
      set_stands_in(false);
      return;
    }
    match taskbar_spot() {
      Some(spot) => {
        local.misses = 0;
        if show(&mut local, &spot) {
          set_stands_in(false);
        } else {
          hide(&mut local);
          set_stands_in(true);
        }
      }
      None => {
        local.misses += 1;
        if local.misses >= 3 {
          hide(&mut local);
          set_stands_in(true);
        }
      }
    }
  });
}

fn hide(local: &mut Local) {
  let strip = std::mem::replace(&mut local.strip, null_mut());
  local.drawn = None;
  if !strip.is_null() {
    unsafe {
      if IsWindow(strip) != 0 {
        DestroyWindow(strip);
      }
    }
  }
}

// Where it goes: the main screen's taskbar, the left edge of its notification area (in the
// taskbar's own pixels), its height and scale
struct Spot {
  taskbar: HWND,
  right: i32,
  height: i32,
  dpi: u32,
}

fn taskbar_spot() -> Option<Spot> {
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

// false: it couldn't be drawn or put in the taskbar
fn show(local: &mut Local, spot: &Spot) -> bool {
  let (text, low, _) = shown();
  let look = Look { dpi: spot.dpi, height: spot.height, text, low, light: icon::light_taskbar() };
  unsafe {
    // Gone with an Explorer restart, or inside an old taskbar: a new one
    if !local.strip.is_null() && (IsWindow(local.strip) == 0 || GetParent(local.strip) != spot.taskbar) {
      hide(local);
    }
    let picture = match &local.drawn {
      Some(drawn) if drawn.look == look => None,
      _ => match draw(&look) {
        Some(picture) => Some(picture),
        None => return false,
      },
    };
    let width = match (&picture, &local.drawn) {
      (Some(picture), _) => picture.width as i32,
      (None, Some(drawn)) => drawn.width,
      (None, None) => return false,
    };
    let x = spot.right - width - scaled(4, spot.dpi);
    if local.strip.is_null() {
      let class = wide(STRIP_CLASS);
      let strip = CreateWindowExW(
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
      );
      if strip.is_null() {
        return false;
      }
      local.strip = strip;
    }
    if let Some(picture) = &picture {
      let size = SIZE { cx: width, cy: spot.height };
      let source = POINT { x: 0, y: 0 };
      let blend = BLENDFUNCTION {
        BlendOp: AC_SRC_OVER as u8,
        BlendFlags: 0,
        SourceConstantAlpha: 255,
        AlphaFormat: AC_SRC_ALPHA as u8,
      };
      if UpdateLayeredWindow(local.strip, null_mut(), null(), &size, picture.dc, &source, 0, &blend, ULW_ALPHA) == 0 {
        return false;
      }
    }
    let moved = local.drawn.as_ref().is_none_or(|drawn| drawn.x != x || drawn.width != width);
    if moved || picture.is_some() {
      SetWindowPos(local.strip, HWND_TOP, x, 0, width, spot.height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
    local.drawn = Some(Drawn { look, x, width });
  }
  true
}

// Sizes in the taskbar's pixels: `px` at 100% scale
fn scaled(px: i32, dpi: u32) -> i32 {
  (px * dpi as i32 + 48) / 96
}

// [space][mouse][gap][93%][space], as tall as the taskbar. Premultiplied colors (as Windows wants
// them); the empty parts are nearly invisible but not fully, so the whole strip takes clicks.
fn draw(look: &Look) -> Option<Canvas> {
  let (pad, gap, icon_px, text_px) = (scaled(6, look.dpi), scaled(4, look.dpi), scaled(16, look.dpi), scaled(12, look.dpi));
  let ruler = Canvas::new(1, 1)?;
  let icon_width = ruler.with_font(ICON_FONTS, icon_px, FW_NORMAL, |canvas| canvas.measure(MOUSE_GLYPH).0)?;
  let text_width = ruler.with_font(TEXT_FONTS, text_px, FW_NORMAL, |canvas| canvas.measure(&look.text).0)?;
  drop(ruler);
  let width = pad + icon_width + gap + text_width + pad;
  let height = look.height;
  let mut canvas = Canvas::new(width.max(1) as usize, height.max(1) as usize)?;
  canvas.with_font(ICON_FONTS, icon_px, FW_NORMAL, |canvas| canvas.text(MOUSE_GLYPH, pad, 0, pad + icon_width, height, DT_LEFT))?;
  let text_left = pad + icon_width + gap;
  canvas.with_font(TEXT_FONTS, text_px, FW_NORMAL, |canvas| canvas.text(&look.text, text_left, 0, width, height, DT_LEFT))?;
  // Only the number turns red when low, the mouse keeps the taskbar's color
  let (icon_color, text_color) = (icon::paint(look.light, false), icon::paint(look.light, look.low));
  let columns = canvas.width;
  for (index, pixel) in canvas.pixels().chunks_exact_mut(4).enumerate() {
    let cover = pixel[2] as u32;
    if cover == 0 {
      pixel.copy_from_slice(&[0, 0, 0, 1]);
      continue;
    }
    let [red, green, blue] = if ((index % columns) as i32) < text_left { icon_color } else { text_color };
    pixel[0] = (blue as u32 * cover / 255) as u8;
    pixel[1] = (green as u32 * cover / 255) as u8;
    pixel[2] = (red as u32 * cover / 255) as u8;
    pixel[3] = cover as u8;
  }
  Some(canvas)
}
