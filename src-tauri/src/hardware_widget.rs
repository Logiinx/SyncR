// The Hardware widget (PC): a small box on the desktop with the readings the user ticked (look A:
// per hardware its name, then a row per reading, label left, value right).
// The page builds its words and numbers (hardware.ts, the same text as the settings window) and
// sends them with hardware_widget; this only draws them, with Direct2D + DirectWrite (Windows'
// modern drawing, the same text engine as WebView2), into a see-through picture.
// It lives inside the desktop: a child of the desktop's icon view (Explorer's), so it sits under
// every window, never comes to the front, and stays on Win+D. "Always on top": a window of its own
// instead, above the others. Dragged anywhere to move it (not when locked); where it's left goes
// back to the page, which saves it. Right-click: its menu (open_menu). First time: top left of the 2nd monitor (the
// main one if there's only one); a saved place on no monitor any more: top left of the main one.
// Its own thread, with a hidden window that rebuilds it when Explorer restarts (which takes the
// desktop and its children along) and moves it when monitors change.
// Nothing here may panic: the app is built with panic = "abort", so a panic would close SyncR.

use super::lock;
use crate::mouse_battery::gdi::Canvas;
use std::cell::RefCell;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, AtomicU8, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use windows::core::Interface;
use windows::Win32::Graphics::Direct2D::Common::{
  D2D1_ALPHA_MODE_PREMULTIPLIED, D2D1_COLOR_F, D2D1_PIXEL_FORMAT, D2D_RECT_F, D2D_SIZE_F,
};
use windows::Win32::Graphics::Direct2D::{
  D2D1CreateFactory, ID2D1DeviceContext5, ID2D1Factory, D2D1_DRAW_TEXT_OPTIONS_NONE, D2D1_FACTORY_TYPE_SINGLE_THREADED, D2D1_FEATURE_LEVEL_DEFAULT,
  D2D1_RENDER_TARGET_PROPERTIES, D2D1_RENDER_TARGET_TYPE_SOFTWARE, D2D1_RENDER_TARGET_USAGE_NONE, D2D1_ROUNDED_RECT,
  D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE,
};
use windows::Win32::Graphics::DirectWrite::{
  DWriteCreateFactory, IDWriteFactory, IDWriteTextFormat, IDWriteTextLayout, DWRITE_FACTORY_TYPE_SHARED,
  DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_WEIGHT_SEMI_BOLD,
  DWRITE_LINE_METRICS, DWRITE_TEXT_METRICS,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows::Win32::UI::Shell::SHCreateMemStream;
use windows_numerics::Matrix3x2;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, SIZE, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
  EnumDisplayMonitors, GetMonitorInfoW, MonitorFromPoint, ScreenToClient, AC_SRC_ALPHA, AC_SRC_OVER, BLENDFUNCTION, HDC,
  HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTONULL, MONITOR_DEFAULTTOPRIMARY,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  CallNextHookEx, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, FindWindowExW, FindWindowW, GetAncestor,
  GetCursorPos, GetMessageW, GetParent, GetWindow, GetWindowLongPtrW, GetWindowRect, IsWindow, KillTimer, LoadCursorW, PostMessageW, PostQuitMessage,
  RegisterClassExW, SetTimer, SetWindowLongPtrW, SetWindowPos, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx,
  UpdateLayeredWindow, WindowFromPoint, GA_ROOT, GWL_EXSTYLE, GW_HWNDPREV, HC_ACTION, HHOOK, MSLLHOOKSTRUCT, HTCAPTION,
  HTCLIENT, HWND_TOP, HWND_TOPMOST, IDC_ARROW, MA_NOACTIVATE, MSG, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, ULW_ALPHA, WM_APP, WM_CLOSE, WM_CONTEXTMENU, WM_DESTROY,
  WM_DISPLAYCHANGE, WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_MOUSEACTIVATE, WM_MOUSEWHEEL, WM_NCHITTEST, WM_NCRBUTTONDOWN, WM_NCRBUTTONUP, WM_RBUTTONDOWN,
  WM_RBUTTONUP, WM_TIMER, WNDCLASSEXW, WNDPROC, WS_CHILD, WS_CLIPSIBLINGS, WS_EX_LAYERED, WS_EX_NOACTIVATE,
  WS_EX_NOPARENTNOTIFY, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP, WH_MOUSE_LL, WHEEL_DELTA,
};
use windows_sys::Win32::System::SystemServices::MK_CONTROL;

const WM_REFRESH: u32 = WM_APP + 1;
const CHECK_TIMER: usize = 1;
const WATCH_TIMER: usize = 2; // click-through: the mouse and Ctrl (follow_mouse)
const CONTROLLER_CLASS: &str = "SyncRHardwareControl";
const WIDGET_CLASS: &str = "SyncRHardwareWidget";

// Look A, in CSS pixels (DIPs), with SyncR's colors (index.css)
const FONT: &str = "Segoe UI";
const FONT_SIZE: f32 = 13.0;
const ASCENT: f32 = 1.01; // 'SyncR UI' (index.css): Segoe UI's letters moved up, by its ascent
const DESCENT: f32 = 0.325; // and descent overrides
const ROW: f32 = 20.0; // each line's height
const PAD_TOP: f32 = 8.0;
const PAD_SIDE: f32 = 12.0;
const PAD_BOTTOM: f32 = 10.0;
const GROUP_GAP: f32 = 6.0; // above every hardware but the first
const ICON: f32 = 15.0; // as in the settings window's cards
const INDENT: f32 = 21.0; // the icon and its gap (6): the names and rows start there
const VALUE_GAP: f32 = 16.0; // least room between a label and its value
const RADIUS: f32 = 8.0;
// Look D (rows with bars, design/hardware-looks.html): each row is a shorter line, then its bar
const BAR_LINE: f32 = 18.0;
const BAR_GAP: f32 = 1.0; // above the bar
const BAR: f32 = 3.0;
const BAR_BELOW: f32 = 4.0;
const BAR_ROW: f32 = BAR_LINE + BAR_GAP + BAR + BAR_BELOW;
const BAR_LEAST: f32 = 200.0; // narrowest width, so short bars still read
const MARGIN: f32 = 16.0; // from the monitor's corner, the first time

// The widget's colors (index.css), per theme and frame line (hardware.ts); the same as the
// mockups in design/hardware-looks.html
struct Colors {
  bg: u32,
  bg_alpha: f32, // how solid the box is (the see-through background); text, icons and frame stay solid
  text: u32,
  dim: u32, // the labels
  warm: u32, // a temperature past its first limit (hot colors, hardware.ts)
  hot: u32,  // past its second
  bar: u32,  // look D's bars, warm or hot when the value is
  track: (u32, f32), // under them (color, how solid)
  icon: &'static str,
  frame: Option<u32>,
}

fn colors(theme: &str, frame: &str, background: u32) -> Colors {
  let blue = theme == "blue";
  // Never quite 0: Windows lets clicks through fully clear pixels, and the box must stay draggable
  let bg_alpha = (background.min(100) as f32 / 100.0).max(1.0 / 255.0);
  let frame = match frame {
    "none" => None,
    "gray" if blue => Some(0x40536e), // white at 15 % over the blue
    "gray" => Some(0x2a2a2a),         // --border
    _ if blue => Some(0x7aa7e0),      // --link
    _ => Some(0x2d4f7c),              // --accent
  };
  if blue {
    // A deep SyncR blue (user's pick of 6 shades: --accent was too bright), white text, labels
    // white at 70 %, white icons; --text-orange as on Dark, --text-red a little lighter to read as
    // well on the blue; white bars on white at 18 %
    let track = (0xffffff, 0.18);
    Colors { bg: 0x1e3554, bg_alpha, text: 0xffffff, dim: 0xbcc2cc, warm: 0xf0a052, hot: 0xff8a85, bar: 0xffffff, track, icon: "#ffffff", frame }
  } else {
    // --bg, --text, --text-dim, --text-orange, --text-red, --link (the settings cards' icons);
    // bars in --text-blue on --hover (white at 8 %)
    let track = (0xffffff, 0.08);
    Colors { bg: 0x161616, bg_alpha, text: 0xe4e4e4, dim: 0x808080, warm: 0xf0a052, hot: 0xf0716b, bar: 0x6fa9f2, track, icon: "#7aa7e0", frame }
  }
}

// Each hardware's icon: Lucide's own shapes (lucide-react 1.57: Cpu, Gpu, MemoryStick, ISC license)
// with Lucide's usual strokes, drawn by Direct2D's SVG support
fn icon_svg(icon: &str, color: &str) -> Option<String> {
  let shapes = match icon {
    "cpu" => concat!(
      r#"<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/>"#,
      r#"<path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/>"#,
      r#"<path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/>"#,
      r#"<rect x="8" y="8" width="8" height="8" rx="1"/>"#,
    ),
    "gpu" => concat!(
      r#"<path d="M2 17h18a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H2"/><path d="M2 21V3"/>"#,
      r#"<path d="M7 17v3a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-3"/><circle cx="16" cy="11" r="2"/><circle cx="8" cy="11" r="2"/>"#,
    ),
    "memory" => concat!(
      r#"<path d="M12 12v-2"/><path d="M12 18v-2"/><path d="M16 12v-2"/><path d="M16 18v-2"/><path d="M2 11h1.5"/>"#,
      r#"<path d="M20 18v-2"/><path d="M20.5 11H22"/><path d="M4 18v-2"/><path d="M8 12v-2"/><path d="M8 18v-2"/>"#,
      r#"<rect x="2" y="6" width="20" height="10" rx="2"/>"#,
    ),
    _ => return None,
  };
  Some(format!(
    r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{shapes}</svg>"#
  ))
}

// What the page sends: per hardware its name, icon and rows (label, value, its hot color: 0 none,
// 1 warm, 2 hot, and how full its bar is in look D, 0–1, none for readings without a top), in order; the saved
// place (screen pixels, top left), used when the widget appears; and the menu's options
#[derive(Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
  title: String,
  icon: String, // "cpu", "gpu", "memory" (icon_svg)
  rows: Vec<(String, String, u8, Option<f32>)>,
}

#[derive(Clone, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Content {
  groups: Vec<Group>,
  place: Option<(i32, i32)>,
  #[serde(default)]
  on_top: bool, // above other windows, put back on top every second; else on the desktop
  #[serde(default)]
  locked: bool, // can't be dragged
  #[serde(default)]
  look: String, // "rows" (A, or anything else) · "bars" (D: a bar under each value)
  #[serde(default)]
  theme: String, // "dark" (or anything else) · "blue"
  #[serde(default)]
  frame: String, // "none" · "gray" · "blue" (or anything else)
  #[serde(default = "full")]
  size: u32, // %, on top of Windows' scaling of its monitor
  #[serde(default = "full")]
  background: u32, // how solid the box is, in %
  #[serde(default)]
  click_through: String, // "off" (or anything else) · "all" · "left" (right-clicks still open its menu)
  #[serde(default)]
  animations: bool, // the app's Animations setting: its fade under the mouse
}

fn full() -> u32 {
  100
}

static CONTENT: Mutex<Option<Content>> = Mutex::new(None);
static CONTROLLER: Mutex<isize> = Mutex::new(0); // the running thread's hidden window (0: none)
static STARTS: AtomicU64 = AtomicU64::new(0); // an older thread that comes up late closes itself
static APP: Mutex<Option<AppHandle>> = Mutex::new(None);
static LOCKED: AtomicBool = AtomicBool::new(false);
pub const MENU: &str = "hardware-menu";
// Click-through (follow_mouse): which clicks go through, the app's Animations setting, the widget
// (for the mouse hook), whether clicks go through it right now, and whether it's being dragged
const THROUGH_OFF: u8 = 0;
const THROUGH_ALL: u8 = 1;
const THROUGH_LEFT: u8 = 2;
static THROUGH: AtomicU8 = AtomicU8::new(THROUGH_OFF);
static ANIMATIONS: AtomicBool = AtomicBool::new(true);
static WIDGET: AtomicIsize = AtomicIsize::new(0);
static PASSING: AtomicBool = AtomicBool::new(false);
static DRAGGING: AtomicBool = AtomicBool::new(false);
const FADED: u8 = 51; // ~20 %: under the mouse while clicks go through, to see what's under it
const FADE_MS: u32 = 120;
const FADE_EVERY: u32 = 15; // ms between fade steps
const WATCH_EVERY: u32 = 50; // ms between looks at the mouse and Ctrl, only while click-through is on

// After every reading, and when the settings change. None or nothing to show: no widget.
#[tauri::command]
pub fn hardware_widget(app: AppHandle, content: Option<Content>) {
  let content = content.filter(|content| content.groups.iter().any(|group| !group.rows.is_empty()));
  let Some(content) = content else {
    *lock(&CONTENT) = None;
    stop();
    return;
  };
  LOCKED.store(content.locked, Ordering::SeqCst);
  let through = match content.click_through.as_str() {
    "all" => THROUGH_ALL,
    "left" => THROUGH_LEFT,
    _ => THROUGH_OFF,
  };
  THROUGH.store(through, Ordering::SeqCst);
  ANIMATIONS.store(content.animations, Ordering::SeqCst);
  *lock(&CONTENT) = Some(content);
  let controller = *lock(&CONTROLLER);
  if controller != 0 {
    unsafe { PostMessageW(controller as HWND, WM_REFRESH, 0, 0) };
    return;
  }
  *lock(&APP) = Some(app);
  let start = STARTS.fetch_add(1, Ordering::SeqCst) + 1;
  std::thread::spawn(move || run(start));
}

fn stop() {
  STARTS.fetch_add(1, Ordering::SeqCst);
  let controller = std::mem::take(&mut *lock(&CONTROLLER));
  if controller != 0 {
    unsafe { PostMessageW(controller as HWND, WM_CLOSE, 0, 0) };
  }
}

// What's on screen now, so an unchanged reading isn't drawn again
struct Drawn {
  groups: Vec<Group>,
  style: (String, String, String, u32), // look, theme, frame, background
  scale: f32,
  width: i32,
  height: i32,
}

// This thread's own state (only the widget thread touches it)
struct Local {
  widget: HWND,
  parent: HWND,
  painter: Option<Painter>,
  drawn: Option<Drawn>,
  // The widest it has been for these labels (DIPs): it grows with a longer value but doesn't
  // shrink back each second; new labels start over
  widest: (Vec<String>, f32),
  opacity: u8,      // the whole widget's (255: solid), lower under the mouse while clicks go through
  watch_every: u32, // the mouse-watching timer's ms (0: off)
  hook: HHOOK,      // the system-wide mouse hook, only for "left clicks only" (null: none)
}

thread_local! {
  static LOCAL: RefCell<Local> = const {
    RefCell::new(Local {
      widget: null_mut(),
      parent: null_mut(),
      painter: None,
      drawn: None,
      widest: (Vec::new(), 0.0),
      opacity: 255,
      watch_every: 0,
      hook: null_mut(),
    })
  };
  // A right-click caught by the hook over the widget: its release opens the menu
  static RIGHT_PRESSED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

fn run(start: u64) {
  unsafe {
    let instance = GetModuleHandleW(null());
    let controller_class = wide(CONTROLLER_CLASS);
    let widget_class = wide(WIDGET_CLASS);
    register(instance, &controller_class, Some(controller_proc));
    register(instance, &widget_class, Some(widget_proc));
    // Hidden and never shown: a top-level window, so it hears monitors change
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
    SetTimer(controller, CHECK_TIMER, 1000, None);
    show();
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
    cbSize: size_of::<WNDCLASSEXW>() as u32,
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
    WM_TIMER if wparam == WATCH_TIMER => {
      follow(window);
      0
    }
    WM_TIMER | WM_REFRESH => {
      show();
      follow(window);
      if message == WM_TIMER {
        menu_away(WIDGET.load(Ordering::SeqCst) as HWND);
      }
      0
    }
    // A monitor came or went: a widget left on no monitor goes to the main one
    WM_DISPLAYCHANGE => {
      LOCAL.with(|local| {
        if let Ok(mut local) = local.try_borrow_mut() {
          rescue(&mut local);
        }
      });
      show();
      0
    }
    WM_CLOSE => {
      LOCAL.with(|local| {
        if let Ok(mut local) = local.try_borrow_mut() {
          hide(&mut local);
          local.painter = None;
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

unsafe extern "system" fn widget_proc(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
  match message {
    // Anywhere on it counts as its title bar: dragging it moves it (Windows does the moving).
    // Locked: a plain window part, which doesn't move
    // The mouse over it also gets its right-click menu ready (prepare_menu).
    WM_NCHITTEST => {
      prepare_menu();
      (if LOCKED.load(Ordering::SeqCst) { HTCLIENT } else { HTCAPTION }) as LRESULT
    }
    // Ctrl + mouse wheel: one size up or down per notch, chosen by the page (hardware.ts), which
    // saves it. Never passed on: Ctrl + wheel on the desktop would resize its icons.
    WM_MOUSEWHEEL => {
      if (wparam & MK_CONTROL as usize) != 0 && !LOCKED.load(Ordering::SeqCst) {
        zoom(((wparam >> 16) & 0xffff) as u16 as i16 as i32);
      }
      0
    }
    // Right-click (on the "title bar", or anywhere when locked): its menu, where the mouse is.
    // Windows' own title bar menu never shows.
    WM_NCRBUTTONUP | WM_RBUTTONUP => {
      open_menu();
      0
    }
    WM_NCRBUTTONDOWN | WM_RBUTTONDOWN | WM_CONTEXTMENU => 0,
    // A click never takes the focus from the app in front
    WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
    // Click-through: a drag started with Ctrl held goes on after Ctrl is let go (follow_mouse)
    WM_ENTERSIZEMOVE => {
      DRAGGING.store(true, Ordering::SeqCst);
      0
    }
    // Let go after a drag: the page saves the new place; another monitor may need another scale
    WM_EXITSIZEMOVE => {
      DRAGGING.store(false, Ordering::SeqCst);
      let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
      if unsafe { GetWindowRect(window, &mut rect) } != 0 {
        if let Some(app) = lock(&APP).clone() {
          let _ = app.emit("hardware-widget-moved", (rect.left, rect.top));
        }
      }
      let controller = *lock(&CONTROLLER);
      if controller != 0 {
        unsafe { PostMessageW(controller as HWND, WM_REFRESH, 0, 0) };
      }
      0
    }
    _ => unsafe { DefWindowProcW(window, message, wparam, lparam) },
  }
}

// Notches add up (a smooth wheel sends small steps): each full one is a size step
fn zoom(delta: i32) {
  thread_local! { static WHEEL: std::cell::Cell<i32> = const { std::cell::Cell::new(0) }; }
  let total = WHEEL.with(|wheel| wheel.get()) + delta;
  let steps = total / WHEEL_DELTA as i32;
  WHEEL.with(|wheel| wheel.set(total - steps * WHEEL_DELTA as i32));
  if steps != 0 {
    if let Some(app) = lock(&APP).clone() {
      let _ = app.emit_to("main", "hardware-widget-zoom", steps.signum());
    }
  }
}

// Click-through: clicks go to what's under the widget (Windows lets them through a window marked
// "transparent"). It looks at the mouse and Ctrl every 50 ms, only while click-through is on:
// under the mouse it fades to ~20 % to show what's under it; Ctrl held over it makes it a normal
// widget again (solid, dragged, right-clicked, Ctrl + wheel). "Left clicks only": Windows lets
// clicks through all or nothing, so a system-wide mouse hook (only then) catches right-clicks over
// it and opens its menu. After a reading, a change, or a timer tick.
fn follow(controller: HWND) {
  LOCAL.with(|local| {
    let Ok(mut local) = local.try_borrow_mut() else { return };
    let every = follow_mouse(&mut local);
    if every != local.watch_every {
      unsafe {
        if every == 0 {
          KillTimer(controller, WATCH_TIMER);
        } else {
          SetTimer(controller, WATCH_TIMER, every, None);
        }
      }
      local.watch_every = every;
    }
  });
}

// The next look's ms (0: no need)
fn follow_mouse(local: &mut Local) -> u32 {
  let through = THROUGH.load(Ordering::SeqCst);
  if local.widget.is_null() {
    unhook(local);
    return 0;
  }
  if through == THROUGH_LEFT && local.hook.is_null() {
    // Runs on this thread (its message loop); 0: every program's mouse
    local.hook = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), GetModuleHandleW(null()), 0) };
  } else if through != THROUGH_LEFT {
    unhook(local);
  }
  let mut mouse = POINT { x: 0, y: 0 };
  let over = through != THROUGH_OFF && unsafe { GetCursorPos(&mut mouse) } != 0 && mouse_over(local.widget, mouse);
  let ctrl = unsafe { GetAsyncKeyState(VK_CONTROL as i32) } < 0;
  // Clicks going through it bring no moves over it: "left clicks only" readies the menu from here
  // (with "all clicks", Ctrl makes it a normal widget, which gets the moves)
  if over && through == THROUGH_LEFT {
    prepare_menu();
  }
  let dragging = DRAGGING.load(Ordering::SeqCst);
  set_passing(local.widget, through != THROUGH_OFF && !(over && ctrl) && !dragging);

  let target = if over && !ctrl && !dragging { FADED } else { 255 };
  if local.opacity != target {
    let step = ((255 - FADED as u32) * FADE_EVERY / FADE_MS) as u8;
    local.opacity = if !ANIMATIONS.load(Ordering::SeqCst) {
      target
    } else if local.opacity < target {
      local.opacity.saturating_add(step).min(target)
    } else {
      local.opacity.saturating_sub(step).max(target)
    };
    let blend = BLENDFUNCTION {
      BlendOp: AC_SRC_OVER as u8,
      BlendFlags: 0,
      SourceConstantAlpha: local.opacity,
      AlphaFormat: AC_SRC_ALPHA as u8,
    };
    // Only the opacity changes: the picture stays
    unsafe { UpdateLayeredWindow(local.widget, null_mut(), null(), null(), null_mut(), null(), 0, &blend, ULW_ALPHA) };
  }
  if local.opacity != target {
    FADE_EVERY
  } else if through != THROUGH_OFF {
    WATCH_EVERY
  } else {
    0
  }
}

// The mouse is on the widget, and no window covers it there. Windows skips the widget while clicks
// go through it, so what's under the mouse is then what's under the widget: on the desktop, the
// desktop itself (not a window over it); "on top", any window not above the widget.
fn mouse_over(widget: HWND, mouse: POINT) -> bool {
  let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
  unsafe {
    if GetWindowRect(widget, &mut rect) == 0
      || mouse.x < rect.left
      || mouse.x >= rect.right
      || mouse.y < rect.top
      || mouse.y >= rect.bottom
    {
      return false;
    }
    let under = WindowFromPoint(mouse);
    if under.is_null() {
      return false;
    }
    let root = GetAncestor(under, GA_ROOT);
    let parent = GetParent(widget);
    if !parent.is_null() {
      return root == GetAncestor(parent, GA_ROOT);
    }
    let mut above = GetWindow(widget, GW_HWNDPREV);
    while !above.is_null() {
      if above == root {
        return false;
      }
      above = GetWindow(above, GW_HWNDPREV);
    }
    true
  }
}

fn set_passing(widget: HWND, on: bool) {
  if PASSING.swap(on, Ordering::SeqCst) == on {
    return;
  }
  unsafe {
    let style = GetWindowLongPtrW(widget, GWL_EXSTYLE);
    let transparent = WS_EX_TRANSPARENT as isize;
    SetWindowLongPtrW(widget, GWL_EXSTYLE, if on { style | transparent } else { style & !transparent });
  }
}

fn unhook(local: &mut Local) {
  let hook = std::mem::replace(&mut local.hook, null_mut());
  if !hook.is_null() {
    unsafe { UnhookWindowsHookEx(hook) };
  }
  RIGHT_PRESSED.with(|pressed| pressed.set(false));
}

// Every mouse event on the PC goes through here while "left clicks only" is on, so it only looks
// at right-clicks and answers at once. One on the widget (while clicks go through it) is kept from
// what's under it; letting go opens the widget's menu.
unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
  if code == HC_ACTION as i32 && lparam != 0 {
    let message = wparam as u32;
    if message == WM_RBUTTONDOWN {
      let widget = WIDGET.load(Ordering::SeqCst) as HWND;
      // lparam is the event, as Windows sends it for this hook
      let mouse = unsafe { (*(lparam as *const MSLLHOOKSTRUCT)).pt };
      let ours = !widget.is_null() && PASSING.load(Ordering::SeqCst) && !menu_open() && mouse_over(widget, mouse);
      RIGHT_PRESSED.with(|pressed| pressed.set(ours));
      if ours {
        return 1;
      }
    } else if message == WM_RBUTTONUP && RIGHT_PRESSED.with(|pressed| pressed.replace(false)) {
      open_menu();
      return 1;
    }
  }
  unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) }
}

// The right-click menu: a page of its own (hardware-menu.html) in a see-through window over the
// whole monitor, so the menu and its side lists can open anywhere on it, and a click elsewhere
// lands on it and closes the menu, like the app's own menus. Making that window and loading its
// page takes ~0.1 s (measured), which showed as a pause before the menu, so it's made hidden as
// soon as the mouse is over the widget (prepare_menu), and a right-click only has to show it
// (open_menu). Not right-clicked: removed a few seconds after the mouse leaves (menu_away), so
// nothing stays loaded while unused. Closed: removed too.
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
  area: RECT,             // the monitor it covers (screen pixels)
  open_at: Option<POINT>, // right-clicked while it was being made: opened there once its page is in
  away: u32,              // seconds the mouse has been off the widget while it waits
}
const NO_AREA: RECT = RECT { left: 0, top: 0, right: 0, bottom: 0 };
static MENU_STATE: Mutex<MenuState> = Mutex::new(MenuState { stage: Stage::None, area: NO_AREA, open_at: None, away: 0 });
const MENU_KEPT: u32 = 5; // seconds a waiting menu stays after the mouse leaves the widget

// "On top" then leaves the menu above the widget, and a right-click on it isn't the widget's
fn menu_open() -> bool {
  lock(&MENU_STATE).stage == Stage::Open
}

// The mouse, and the monitor it's on
fn mouse_monitor() -> Option<(POINT, RECT)> {
  let mut mouse = POINT { x: 0, y: 0 };
  let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, rcMonitor: NO_AREA, rcWork: NO_AREA, dwFlags: 0 };
  // info has its size set, as Windows asks
  let found = unsafe { GetCursorPos(&mut mouse) != 0 && GetMonitorInfoW(MonitorFromPoint(mouse, MONITOR_DEFAULTTONEAREST), &mut info) != 0 };
  found.then_some((mouse, info.rcMonitor))
}

// The mouse is over the widget (a move over it, or click-through's look at the mouse): its menu
// gets ready, hidden, if it isn't yet
fn prepare_menu() {
  let making = {
    let mut state = lock(&MENU_STATE);
    state.away = 0;
    state.stage == Stage::None
  };
  if making {
    if let Some((_, area)) = mouse_monitor() {
      make_menu(area, None);
    }
  }
}

// Right-click on the widget: its menu where the mouse is. Waiting: shown now; still being made:
// once its page is in; not made (a right-click without a move over it first): made now.
fn open_menu() {
  let Some((mouse, area)) = mouse_monitor() else { return };
  let made_for = {
    let mut state = lock(&MENU_STATE);
    match state.stage {
      Stage::None => None,
      Stage::Making => {
        state.open_at = Some(mouse);
        return;
      }
      Stage::Waiting => {
        state.stage = Stage::Open;
        Some(state.area)
      }
      Stage::Open | Stage::Closing => return,
    }
  };
  match made_for {
    Some(made_for) => show_menu(mouse, area, made_for),
    None => make_menu(area, Some(mouse)),
  }
}

fn make_menu(area: RECT, open_at: Option<POINT>) {
  let Some(app) = lock(&APP).clone() else { return };
  {
    let mut state = lock(&MENU_STATE);
    if state.stage != Stage::None {
      return;
    }
    *state = MenuState { stage: Stage::Making, area, open_at, away: 0 };
  }
  // Making a window waits for the app's main thread: not on this one, which draws the widget
  std::thread::spawn(move || {
    let built = WebviewWindowBuilder::new(&app, MENU, WebviewUrl::App("hardware-menu.html".into()))
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
      .on_navigation(|url| url.path() == "/hardware-menu.html")
      // Its file-drop listener is let go only after the window is gone, which Windows refuses:
      // each menu then kept 2 handles (shared memory) until SyncR closed. The menu takes no files.
      .disable_drag_drop_handler()
      .build();
    let Ok(menu) = built else {
      lock(&MENU_STATE).stage = Stage::None;
      return;
    };
    // Gone in any way: a look shown from it goes back to the saved one
    let handle = app.clone();
    menu.on_window_event(move |event| {
      if matches!(event, tauri::WindowEvent::Destroyed) {
        *lock(&MENU_STATE) = MenuState { stage: Stage::None, area: NO_AREA, open_at: None, away: 0 };
        let _ = handle.emit_to("main", "hardware-menu", serde_json::json!({ "preview": null }));
      }
    });
    place_menu(&menu, area);
  });
}

// Over the whole monitor (placed first: on another monitor's scale, Windows resizes it)
fn place_menu(menu: &tauri::WebviewWindow, area: RECT) {
  let _ = menu.set_position(tauri::PhysicalPosition::new(area.left, area.top));
  let _ = menu.set_size(tauri::PhysicalSize::new((area.right - area.left).max(1) as u32, (area.bottom - area.top).max(1) as u32));
}

// Tells its page where the mouse is and the window's size in screen pixels (moved first if the
// right-click is on another monitor than the one it was made for); the page draws the menu once
// the window has that size, then asks to be shown (hardware_menu "ready")
fn show_menu(mouse: POINT, area: RECT, made_for: RECT) {
  let Some(app) = lock(&APP).clone() else { return };
  std::thread::spawn(move || {
    let Some(menu) = app.get_webview_window(MENU) else { return };
    let same = (area.left, area.top, area.right, area.bottom) == (made_for.left, made_for.top, made_for.right, made_for.bottom);
    if !same {
      lock(&MENU_STATE).area = area;
      place_menu(&menu, area);
    }
    let at = serde_json::json!({
      "x": mouse.x - area.left,
      "y": mouse.y - area.top,
      "w": (area.right - area.left).max(1),
      "h": (area.bottom - area.top).max(1),
    });
    // Called in its page (hardwareMenu.tsx), which then needs no right to listen to the app's events
    let _ = menu.eval(format!("window.openHardwareMenu?.({at})"));
  });
}

// Every second: a waiting menu goes once the mouse has been off the widget for MENU_KEPT seconds
// (no widget: at once)
fn menu_away(widget: HWND) {
  let mut state = lock(&MENU_STATE);
  if state.stage != Stage::Waiting {
    return;
  }
  let mut mouse = POINT { x: 0, y: 0 };
  let mut rect = NO_AREA;
  let over = !widget.is_null()
    && unsafe { GetCursorPos(&mut mouse) != 0 && GetWindowRect(widget, &mut rect) != 0 }
    && (rect.left..rect.right).contains(&mouse.x)
    && (rect.top..rect.bottom).contains(&mouse.y);
  state.away = if over { 0 } else { state.away + 1 };
  if state.away >= MENU_KEPT || widget.is_null() {
    state.stage = Stage::Closing;
    drop(state);
    close_menu();
  }
}

fn close_menu() {
  let Some(app) = lock(&APP).clone() else { return };
  std::thread::spawn(move || {
    if let Some(menu) = app.get_webview_window(MENU) {
      let _ = menu.destroy();
    }
  });
}

// From the menu's page: "loaded" (its page is in, hidden), "ready" (the menu is drawn: show it),
// "choice" (a changed option or Hide widget, for the main window: hardware.ts), "settings"
// (Hardware settings…), "close"
#[tauri::command]
pub fn hardware_menu(app: AppHandle, action: String, choice: Option<serde_json::Value>) {
  match action.as_str() {
    "loaded" => {
      let mut state = lock(&MENU_STATE);
      if state.stage != Stage::Making {
        return;
      }
      match state.open_at.take() {
        Some(mouse) => {
          state.stage = Stage::Open;
          let made_for = state.area;
          drop(state);
          let area = mouse_monitor().map(|(_, area)| area).unwrap_or(made_for);
          show_menu(mouse, area, made_for);
        }
        // The widget went meanwhile (module off, nothing to show): not needed
        None if WIDGET.load(Ordering::SeqCst) == 0 => {
          state.stage = Stage::Closing;
          drop(state);
          close_menu();
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
      let _ = app.emit_to("main", "hardware-menu", choice);
    }
    "settings" => {
      let _ = app.emit_to("main", "hardware-open", ());
      crate::show_main(&app);
    }
    "close" => {
      lock(&MENU_STATE).stage = Stage::Closing;
      close_menu();
    }
    _ => {}
  }
}

fn show() {
  LOCAL.with(|local| {
    // Busy already (Windows can call in while the widget is being moved): the next second does it
    let Ok(mut local) = local.try_borrow_mut() else { return };
    let content = lock(&CONTENT).clone();
    let shown = content.is_some_and(|content| draw_and_place(&mut local, &content));
    if !shown {
      hide(&mut local);
    }
  });
}

fn hide(local: &mut Local) {
  let widget = std::mem::replace(&mut local.widget, null_mut());
  // Only if the shared state is still this widget's: a thread being closed (widget off, then on
  // again at once) may get here after the new widget is up
  if WIDGET.compare_exchange(widget as isize, 0, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
    menu_away(null_mut()); // a waiting menu goes with it
    PASSING.store(false, Ordering::SeqCst);
  }
  unhook(local);
  local.parent = null_mut();
  local.drawn = None;
  local.opacity = 255;
  unsafe {
    if !widget.is_null() && IsWindow(widget) != 0 {
      DestroyWindow(widget);
    }
  }
}

// The desktop's icon view, which the widget lives in: inside "Progman", or on older Windows (after
// a wallpaper change) inside one of the "WorkerW" windows
fn desktop() -> HWND {
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

// false: it couldn't be drawn or put on the desktop
fn draw_and_place(local: &mut Local, content: &Content) -> bool {
  // "Always on top": a window of its own (no parent); else inside the desktop
  let parent = if content.on_top { null_mut() } else { desktop() };
  if parent.is_null() && !content.on_top {
    return false;
  }
  unsafe {
    // Gone with an Explorer restart, inside an old desktop, or "on top" just switched: a new one
    if !local.widget.is_null() && (IsWindow(local.widget) == 0 || GetParent(local.widget) != parent) {
      hide(local);
    }
  }
  // Where it goes (screen pixels): where it is, else the saved place, else the first-time corner
  let here = if local.widget.is_null() { None } else { window_place(local.widget) };
  let place = here.or(content.place.filter(|&(x, y)| on_a_monitor(x, y))).unwrap_or_else(first_place);
  let scale = dpi_at(place.0, place.1) as f32 / 96.0 * content.size.clamp(50, 200) as f32 / 100.0;
  if local.painter.is_none() {
    local.painter = Painter::new();
  }
  let Some(painter) = local.painter.as_ref() else { return false };

  // Another look starts over too
  let labels: Vec<String> = std::iter::once(content.look.clone())
    .chain(content.groups.iter().flat_map(|group| std::iter::once(group.title.clone()).chain(group.rows.iter().map(|(label, ..)| label.clone()))))
    .collect();
  if local.widest.0 != labels {
    local.widest = (labels, 0.0);
  }
  let style = (content.look.clone(), content.theme.clone(), content.frame.clone(), content.background);
  let same = local.drawn.as_ref().is_some_and(|drawn| drawn.groups == content.groups && drawn.style == style && drawn.scale == scale);
  let picture = if same {
    None
  } else {
    let Some((picture, width)) = painter.draw(&content.groups, style.0 == "bars", &colors(&style.1, &style.2, style.3), scale, local.widest.1) else { return false };
    local.widest.1 = width;
    Some(picture)
  };
  let (width, height) = match (&picture, &local.drawn) {
    (Some(picture), _) => (picture.width as i32, picture.height as i32),
    (None, Some(drawn)) => (drawn.width, drawn.height),
    (None, None) => return false,
  };

  unsafe {
    let corner = to_parent(parent, place);
    if local.widget.is_null() {
      let class = wide(WIDGET_CLASS);
      let (extra, style) = if parent.is_null() {
        (WS_EX_TOOLWINDOW | WS_EX_TOPMOST, WS_POPUP) // no taskbar button, above other windows
      } else {
        (WS_EX_NOPARENTNOTIFY, WS_CHILD | WS_CLIPSIBLINGS)
      };
      let widget = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_NOACTIVATE | extra,
        class.as_ptr(),
        null(),
        style,
        corner.x,
        corner.y,
        width,
        height,
        parent,
        null_mut(),
        GetModuleHandleW(null()),
        null(),
      );
      if widget.is_null() {
        return false;
      }
      local.widget = widget;
      local.parent = parent;
      WIDGET.store(widget as isize, Ordering::SeqCst);
    }
    if let Some(picture) = &picture {
      let size = SIZE { cx: width, cy: height };
      let source = POINT { x: 0, y: 0 };
      let blend = BLENDFUNCTION {
        BlendOp: AC_SRC_OVER as u8,
        BlendFlags: 0,
        SourceConstantAlpha: local.opacity,
        AlphaFormat: AC_SRC_ALPHA as u8,
      };
      if UpdateLayeredWindow(local.widget, null_mut(), null(), &size, picture.dc, &source, 0, &blend, ULW_ALPHA) == 0 {
        return false;
      }
    }
    // Above the desktop's icons; placed only when new or moved by a monitor change (rescue)
    if local.drawn.is_none() || here.is_none() {
      SetWindowPos(local.widget, HWND_TOP, corner.x, corner.y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
    // On top: Windows keeps all "on top" windows in one layer, where the latest shown wins, so it
    // goes back to the top of that layer every second. Not while its menu is open over it.
    if parent.is_null() && !menu_open() {
      SetWindowPos(local.widget, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
  }
  local.drawn = Some(Drawn { groups: content.groups.clone(), style, scale, width, height });
  true
}

// Its monitor is gone: to the main monitor's corner (drawn again there, at its scale)
fn rescue(local: &mut Local) {
  if local.widget.is_null() {
    return;
  }
  let Some((x, y)) = window_place(local.widget) else { return };
  if on_a_monitor(x, y) {
    return;
  }
  let (x, y) = corner_of(main_monitor());
  let corner = to_parent(local.parent, (x, y));
  unsafe {
    SetWindowPos(local.widget, HWND_TOP, corner.x, corner.y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE);
  }
  local.drawn = None;
  if let Some(app) = lock(&APP).clone() {
    let _ = app.emit("hardware-widget-moved", (x, y));
  }
}

// Screen pixels → inside the desktop (no parent: the screen's own)
fn to_parent(parent: HWND, (x, y): (i32, i32)) -> POINT {
  let mut point = POINT { x, y };
  if !parent.is_null() {
    unsafe { ScreenToClient(parent, &mut point) };
  }
  point
}

fn window_place(window: HWND) -> Option<(i32, i32)> {
  let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
  (unsafe { GetWindowRect(window, &mut rect) } != 0).then_some((rect.left, rect.top))
}

// A point just inside the widget's corner is on a monitor (a few pixels, so a widget pushed to an
// edge still counts)
fn on_a_monitor(x: i32, y: i32) -> bool {
  !unsafe { MonitorFromPoint(POINT { x: x + 8, y: y + 8 }, MONITOR_DEFAULTTONULL) }.is_null()
}

// The first time: the 2nd monitor's corner, or the main one's if there's only one
fn first_place() -> (i32, i32) {
  let mut monitors: Vec<HMONITOR> = Vec::new();
  unsafe extern "system" fn add(monitor: HMONITOR, _: HDC, _: *mut RECT, list: LPARAM) -> i32 {
    // list is the Vec below, alive for the whole EnumDisplayMonitors call
    unsafe { (*(list as *mut Vec<HMONITOR>)).push(monitor) };
    1
  }
  // monitors outlives the call, which calls add once per monitor
  unsafe { EnumDisplayMonitors(null_mut(), null(), Some(add), &mut monitors as *mut _ as LPARAM) };
  let main = main_monitor();
  let second = monitors.into_iter().find(|&monitor| monitor != main);
  corner_of(second.unwrap_or(main))
}

fn main_monitor() -> HMONITOR {
  unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) }
}

// A monitor's top left, inside its work area (not under a taskbar), MARGIN in from the edges
fn corner_of(monitor: HMONITOR) -> (i32, i32) {
  let mut info = MONITORINFO {
    cbSize: size_of::<MONITORINFO>() as u32,
    rcMonitor: RECT { left: 0, top: 0, right: 0, bottom: 0 },
    rcWork: RECT { left: 0, top: 0, right: 0, bottom: 0 },
    dwFlags: 0,
  };
  // info has its size set, as Windows asks
  if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
    return (0, 0);
  }
  let margin = (MARGIN * monitor_dpi(monitor) as f32 / 96.0).round() as i32;
  (info.rcWork.left + margin, info.rcWork.top + margin)
}

fn dpi_at(x: i32, y: i32) -> u32 {
  monitor_dpi(unsafe { MonitorFromPoint(POINT { x: x + 8, y: y + 8 }, MONITOR_DEFAULTTONEAREST) })
}

fn monitor_dpi(monitor: HMONITOR) -> u32 {
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

// Direct2D and DirectWrite, made once per widget thread
struct Painter {
  d2d: ID2D1Factory,
  write: IDWriteFactory,
  regular: IDWriteTextFormat,
  semibold: IDWriteTextFormat,
}

// A line of text, laid out: its width and where its baseline sits from its top (DIPs)
struct Text {
  layout: IDWriteTextLayout,
  width: f32,
  baseline: f32,
}

impl Painter {
  fn new() -> Option<Painter> {
    unsafe {
      let d2d: ID2D1Factory = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None).ok()?;
      let write: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED).ok()?;
      let font = wide(FONT);
      let locale = wide("en-us");
      let format = |weight| {
        write.CreateTextFormat(
          windows::core::PCWSTR(font.as_ptr()),
          None,
          weight,
          DWRITE_FONT_STYLE_NORMAL,
          DWRITE_FONT_STRETCH_NORMAL,
          FONT_SIZE,
          windows::core::PCWSTR(locale.as_ptr()),
        )
      };
      let regular = format(DWRITE_FONT_WEIGHT_NORMAL).ok()?;
      let semibold = format(DWRITE_FONT_WEIGHT_SEMI_BOLD).ok()?;
      Some(Painter { d2d, write, regular, semibold })
    }
  }

  fn text(&self, text: &str, format: &IDWriteTextFormat) -> Option<Text> {
    let text: Vec<u16> = text.encode_utf16().collect();
    unsafe {
      let layout = self.write.CreateTextLayout(&text, format, 10_000.0, 1_000.0).ok()?;
      let mut metrics = DWRITE_TEXT_METRICS::default();
      layout.GetMetrics(&mut metrics).ok()?;
      let mut lines = [DWRITE_LINE_METRICS::default(); 1];
      let mut count = 0;
      // One line (no line breaks in a label or value): the first line's metrics are enough, and
      // a longer text fails here harmlessly
      let _ = layout.GetLineMetrics(Some(&mut lines), &mut count);
      Some(Text { layout, width: metrics.widthIncludingTrailingWhitespace, baseline: lines[0].baseline })
    }
  }

  // The widget as a see-through picture at this scale (Windows' scaling × the widget's size), at
  // least `least` DIPs wide; and its width in DIPs. `bars`: look D (a bar under each value), else
  // A. None if Windows' drawing failed.
  fn draw(&self, groups: &[Group], bars: bool, colors: &Colors, scale: f32, least: f32) -> Option<(Canvas, f32)> {
    struct Line<'a> {
      top: f32,
      icon: &'a str,
      title: Option<Text>,
      label: Option<Text>,
      value: Option<Text>,
      heat: u8,
      bar: Option<f32>,
    }
    let (row_height, line_height) = if bars { (BAR_ROW, BAR_LINE) } else { (ROW, ROW) };
    let mut lines = Vec::new();
    let mut top = PAD_TOP;
    let mut width = if bars { least.max(BAR_LEAST) } else { least };
    for (index, group) in groups.iter().filter(|group| !group.rows.is_empty()).enumerate() {
      if index > 0 {
        top += GROUP_GAP;
      }
      let title = self.text(&group.title, &self.semibold)?;
      width = width.max(PAD_SIDE + INDENT + title.width + PAD_SIDE);
      lines.push(Line { top, icon: &group.icon, title: Some(title), label: None, value: None, heat: 0, bar: None });
      top += ROW;
      for (label, value, heat, bar) in &group.rows {
        let label = self.text(label, &self.regular)?;
        let value = self.text(value, &self.regular)?;
        width = width.max(PAD_SIDE + INDENT + label.width + VALUE_GAP + value.width + PAD_SIDE);
        let bar = if bars { bar.map(|full| full.clamp(0.0, 1.0)) } else { None };
        lines.push(Line { top, icon: "", title: None, label: Some(label), value: Some(value), heat: *heat, bar });
        top += row_height;
      }
    }
    let pixels_wide = (width * scale).ceil() as usize;
    let pixels_high = ((top + PAD_BOTTOM) * scale).ceil() as usize;
    let (full_width, full_height) = (pixels_wide as f32 / scale, pixels_high as f32 / scale);
    let canvas = Canvas::new(pixels_wide, pixels_high)?;

    let snap = |dips: f32| (dips * scale).round() / scale;
    // Where the browser paints a line's baseline with 'SyncR UI', in screen pixels (measured in
    // the pane at 100, 125, 150 and 200 %, 2026-11-20): it rounds the font's ascent and descent to
    // whole pixels; a name is centered in its line (flex), a row gets the room left halved and
    // rounded down (CSS half-leading); the line starts on the whole pixel at or above it, and the
    // rest is rounded. At 175 % the browser paints ½ pixel higher than that, which isn't copied.
    let font = FONT_SIZE * scale;
    let (ascent, descent) = ((ASCENT * font).round(), (DESCENT * font).round());
    let room = |height: f32| height * scale - ascent - descent;
    let (title_offset, row_offset) = ((ascent + room(ROW) / 2.0).round(), ascent + (room(line_height) / 2.0).floor());
    // A line's top (DIPs) plus an offset in pixels → DIPs, on a whole pixel; the tiny amount keeps
    // a top like 74 × 1.25 = 92.5 from landing just under a whole pixel by float error
    let at = |top: f32, offset: f32| ((top * scale + 0.001).floor() + offset) / scale;
    unsafe {
      let properties = D2D1_RENDER_TARGET_PROPERTIES {
        r#type: D2D1_RENDER_TARGET_TYPE_SOFTWARE,
        pixelFormat: D2D1_PIXEL_FORMAT { format: DXGI_FORMAT_B8G8R8A8_UNORM, alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED },
        dpiX: 96.0 * scale,
        dpiY: 96.0 * scale,
        usage: D2D1_RENDER_TARGET_USAGE_NONE,
        minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
      };
      let target = self.d2d.CreateDCRenderTarget(&properties).ok()?;
      let area = windows::Win32::Foundation::RECT { left: 0, top: 0, right: pixels_wide as i32, bottom: pixels_high as i32 };
      target.BindDC(windows::Win32::Graphics::Gdi::HDC(canvas.dc), &area).ok()?;
      let brush = |rgb: u32| target.CreateSolidColorBrush(&color(rgb, 1.0), None);
      let bg = target.CreateSolidColorBrush(&color(colors.bg, colors.bg_alpha), None).ok()?;
      let (text, dim) = (brush(colors.text).ok()?, brush(colors.dim).ok()?);
      let (warm, hot) = (brush(colors.warm).ok()?, brush(colors.hot).ok()?);
      let (bar, track) = (brush(colors.bar).ok()?, target.CreateSolidColorBrush(&color(colors.track.0, colors.track.1), None).ok()?);
      target.BeginDraw();
      target.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
      target.Clear(Some(&D2D1_COLOR_F { r: 0.0, g: 0.0, b: 0.0, a: 0.0 }));
      let rounded = |inset: f32| D2D1_ROUNDED_RECT {
        rect: D2D_RECT_F { left: inset, top: inset, right: full_width - inset, bottom: full_height - inset },
        radiusX: RADIUS - inset,
        radiusY: RADIUS - inset,
      };
      target.FillRoundedRectangle(&rounded(0.0), &bg);
      // The frame: a 1-pixel line, on whole pixels (centered half a pixel in)
      if let Some(frame) = colors.frame {
        let border = brush(frame).ok()?;
        target.DrawRoundedRectangle(&rounded(0.5 / scale), &border, 1.0 / scale, None);
      }
      let put = |line: &Text, x: f32, y: f32, brush: &windows::Win32::Graphics::Direct2D::ID2D1SolidColorBrush| {
        // Across: on a whole pixel too, an exact half going left, as the browser does
        let origin = windows_numerics::Vector2 { X: ((x * scale - 0.5).ceil()) / scale, Y: y - line.baseline };
        target.DrawTextLayout(origin, &line.layout, brush, D2D1_DRAW_TEXT_OPTIONS_NONE);
      };
      // Icons need Direct2D's newer drawing (Windows 10 1703 and later); without it, none
      let svg: Option<ID2D1DeviceContext5> = target.cast().ok();
      for line in &lines {
        if let Some(title) = &line.title {
          put(title, PAD_SIDE + INDENT, at(line.top, title_offset), &text);
          // Centered on the line, as the card's title row centers it, rounded like the text
          if let (Some(svg), Some(icon)) = (&svg, icon_svg(line.icon, colors.icon)) {
            let stream = SHCreateMemStream(Some(icon.as_bytes()));
            let size = D2D_SIZE_F { width: ICON, height: ICON };
            if let Some(document) = stream.and_then(|stream| svg.CreateSvgDocument(&stream, size).ok()) {
              let top = at(line.top, ((ROW - ICON) * scale / 2.0).round());
              let corner = Matrix3x2::translation(snap(PAD_SIDE), top);
              svg.SetTransform(&corner);
              svg.DrawSvgDocument(&document);
              svg.SetTransform(&Matrix3x2::identity());
            }
          }
        }
        if let (Some(label), Some(value)) = (&line.label, &line.value) {
          let y = at(line.top, row_offset);
          put(label, PAD_SIDE + INDENT, y, &dim);
          let ink = match line.heat {
            2 => &hot,
            1 => &warm,
            _ => &text,
          };
          put(value, full_width - PAD_SIDE - value.width, y, ink);
        }
        // Look D: the track across the row, then the bar over it from the left, on whole pixels,
        // in the value's hot color if it has one
        if let Some(full) = line.bar {
          let (left, right) = (snap(PAD_SIDE + INDENT), snap(full_width - PAD_SIDE));
          let bar_top = snap(line.top + BAR_LINE + BAR_GAP);
          let bar_bottom = bar_top + snap(BAR);
          let pill = |right: f32| D2D1_ROUNDED_RECT {
            rect: D2D_RECT_F { left, top: bar_top, right, bottom: bar_bottom },
            radiusX: (BAR / 2.0).min((right - left) / 2.0),
            radiusY: BAR / 2.0,
          };
          target.FillRoundedRectangle(&pill(right), &track);
          let filled = left + (right - left) * full;
          if filled > left {
            let ink = match line.heat {
              2 => &hot,
              1 => &warm,
              _ => &bar,
            };
            target.FillRoundedRectangle(&pill(filled), ink);
          }
        }
      }
      target.EndDraw(None, None).ok()?;
    }
    Some((canvas, width))
  }
}

fn color(rgb: u32, alpha: f32) -> D2D1_COLOR_F {
  let channel = |shift: u32| ((rgb >> shift) & 0xff) as f32 / 255.0;
  D2D1_COLOR_F { r: channel(16), g: channel(8), b: channel(0), a: alpha }
}
