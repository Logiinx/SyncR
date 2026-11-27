// The mouse battery inside the taskbar (main screen): a see-through child window of the taskbar,
// just left of the notification area, with an outlined mouse (Windows' icon font), the percent in
// the clock's font and a blue bolt on the mouse while charging; half strength and a "Zz" (the
// taskbar's white or black) when the last check got no answer.
// Hover: a soft highlight like the taskbar's own icons and a tooltip (its words come from the
// page). A click opens the Mouse battery window in SyncR.
// Its own thread: once inside the taskbar it shares Windows' input with it, so it must never wait
// on anything slow (the receiver is asked by the check thread). Placed again every second: the
// notification area changes width when icons come and go, and an Explorer restart takes the strip
// along. Taskbar on a side of the screen or not found: no strip.
// Its hidden window also hears devices being plugged in and the PC waking up: a check then.

use super::gdi::Canvas;
use super::{check_now, config, lock, shown, theme, tip, wide};
use crate::taskbar::{self, register, rounded_box, scaled, Spot, Tooltip};
use std::cell::{Cell, RefCell};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{DT_LEFT, FW_NORMAL, FW_SEMIBOLD};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Controls::{InitCommonControlsEx, ICC_WIN95_CLASSES, INITCOMMONCONTROLSEX, WM_MOUSELEAVE};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, KillTimer, PostMessageW, PostQuitMessage, SetTimer,
  TranslateMessage, MA_NOACTIVATE, MSG, PBT_APMRESUMEAUTOMATIC, WM_APP, WM_CLOSE, WM_DESTROY, WM_DEVICECHANGE, WM_LBUTTONUP,
  WM_MOUSEACTIVATE, WM_MOUSEMOVE, WM_POWERBROADCAST, WM_SETTINGCHANGE, WM_TIMER, WS_EX_TOOLWINDOW, WS_POPUP,
};

const WM_REFRESH: u32 = WM_APP + 1;
const PLACE_TIMER: usize = 1;
const CHECK_TIMER: usize = 2;
const PLUGGED_WAIT: u32 = 2000; // Windows sends many signals while it sets a device up
const WOKEN_WAIT: u32 = 5000; // USB needs a moment after the PC wakes up
const CONTROLLER_CLASS: &str = "SyncRMouseBatteryControl";
const STRIP_CLASS: &str = "SyncRMouseBatteryStrip";
const MOUSE_GLYPH: &str = "\u{E962}"; // "Mouse" in Windows' icon fonts
const ICON_FONTS: &[&str] = &["Segoe Fluent Icons", "Segoe MDL2 Assets"]; // Windows 11, Windows 10
const TEXT_FONTS: &[&str] = &["Segoe UI Variable Text", "Segoe UI"]; // the clock's, Windows 11 then 10

// The running strip thread's hidden window (0: none), the number of the latest start or stop (an
// older thread that comes up late closes itself), and the app (clicks)
static CONTROLLER: Mutex<isize> = Mutex::new(0);
static STARTS: AtomicU64 = AtomicU64::new(0);
static APP: Mutex<Option<AppHandle>> = Mutex::new(None);

// The module turned on
pub fn start(app: AppHandle) {
  *lock(&APP) = Some(app);
  let start = STARTS.fetch_add(1, Ordering::SeqCst) + 1;
  std::thread::spawn(move || run(start));
}

pub fn stop() {
  STARTS.fetch_add(1, Ordering::SeqCst);
  let controller = std::mem::take(&mut *lock(&CONTROLLER));
  if controller != 0 {
    unsafe { PostMessageW(controller as HWND, WM_CLOSE, 0, 0) };
  }
}

// New settings, a new check, a new tooltip, the mouse over it: draw again
pub fn refresh() {
  let controller = *lock(&CONTROLLER);
  if controller != 0 {
    unsafe { PostMessageW(controller as HWND, WM_REFRESH, 0, 0) };
  }
}

// What's drawn: redrawn only when one of these changes
#[derive(Clone, PartialEq)]
struct Look {
  dpi: u32,
  height: i32,
  text: String,
  low: bool,
  charging: bool,
  dim: bool,
  hover: bool,
  light: bool,
}

struct Drawn {
  look: Look,
  x: i32,
  width: i32,
}

// This thread's own state (only the strip thread touches it)
struct Local {
  controller: HWND,
  strip: HWND,
  tooltip: Option<Tooltip>,
  drawn: Option<Drawn>,
}

thread_local! {
  static LOCAL: RefCell<Local> = const {
    RefCell::new(Local {
      controller: null_mut(),
      strip: null_mut(),
      tooltip: None,
      drawn: None,
    })
  };
  // Apart from LOCAL: the strip's own messages change it, also while LOCAL is busy
  static HOVER: Cell<bool> = const { Cell::new(false) };
}

fn run(start: u64) {
  unsafe {
    let instance = GetModuleHandleW(null());
    let controls = INITCOMMONCONTROLSEX { dwSize: std::mem::size_of::<INITCOMMONCONTROLSEX>() as u32, dwICC: ICC_WIN95_CLASSES };
    InitCommonControlsEx(&controls); // the tooltip
    let controller_class = wide(CONTROLLER_CLASS);
    let strip_class = wide(STRIP_CLASS);
    register(instance, &controller_class, Some(controller_proc));
    register(instance, &strip_class, Some(strip_proc));
    // Hidden and never shown: a top-level window, so it hears Windows' settings, device and power changes
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
    LOCAL.with(|local| {
      if let Ok(mut local) = local.try_borrow_mut() {
        local.controller = controller;
      }
    });
    SetTimer(controller, PLACE_TIMER, 1000, None);
    place();
    let mut message: MSG = std::mem::zeroed();
    while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
  }
}

unsafe extern "system" fn controller_proc(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
  match message {
    WM_TIMER if wparam == CHECK_TIMER => {
      unsafe { KillTimer(window, CHECK_TIMER) };
      check_now();
      0
    }
    WM_TIMER | WM_REFRESH => {
      place();
      0
    }
    // A device was plugged in or out (maybe the receiver): check once things settle. A new signal
    // restarts the wait, so a burst of them gives one check.
    WM_DEVICECHANGE => {
      unsafe { SetTimer(window, CHECK_TIMER, PLUGGED_WAIT, None) };
      1
    }
    WM_POWERBROADCAST => {
      if wparam as u32 == PBT_APMRESUMEAUTOMATIC {
        unsafe { SetTimer(window, CHECK_TIMER, WOKEN_WAIT, None) };
      }
      1
    }
    // Light/dark may have changed. It arrives while Windows waits, so redrawn a moment later.
    WM_SETTINGCHANGE => {
      unsafe { PostMessageW(window, WM_REFRESH, 0, 0) };
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
    // The mouse came over it: highlight, and hear when it leaves
    WM_MOUSEMOVE => {
      if !HOVER.get() {
        HOVER.set(true);
        let mut track = TRACKMOUSEEVENT {
          cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
          dwFlags: TME_LEAVE,
          hwndTrack: window,
          dwHoverTime: 0,
        };
        unsafe { TrackMouseEvent(&mut track) };
        refresh();
      }
      0
    }
    WM_MOUSELEAVE => {
      HOVER.set(false);
      refresh();
      0
    }
    _ => unsafe { DefWindowProcW(window, message, wparam, lparam) },
  }
}

fn place() {
  LOCAL.with(|local| {
    // Busy already (Windows can call in while the strip is being moved): the next second does it
    let Ok(mut local) = local.try_borrow_mut() else { return };
    let shown = config().is_some() && taskbar::spot().is_some_and(|spot| show(&mut local, &spot));
    if !shown {
      hide(&mut local);
    }
  });
}

fn hide(local: &mut Local) {
  local.tooltip = None;
  taskbar::remove(std::mem::replace(&mut local.strip, null_mut()));
  local.drawn = None;
  HOVER.set(false);
  taskbar::set_battery_left(None);
}

// false: it couldn't be drawn or put in the taskbar
fn show(local: &mut Local, spot: &Spot) -> bool {
  let now = shown();
  let look = Look {
    dpi: spot.dpi,
    height: spot.height,
    text: now.text,
    low: now.low,
    charging: now.charging,
    dim: now.dim,
    hover: HOVER.get(),
    light: theme::light_taskbar(),
  };
  if taskbar::stale(local.strip, spot) {
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
  let x = spot.right - width - scaled(taskbar::GAP, spot.dpi);
  if local.strip.is_null() {
    let strip = taskbar::new_strip(STRIP_CLASS, spot, x, width);
    if strip.is_null() {
      return false;
    }
    local.strip = strip;
    local.tooltip = Tooltip::new(local.controller, strip);
  }
  if let Some(picture) = &picture {
    if !taskbar::paint(local.strip, picture) {
      return false;
    }
  }
  let moved = local.drawn.as_ref().is_none_or(|drawn| drawn.x != x || drawn.width != width);
  if moved || picture.is_some() {
    taskbar::move_strip(local.strip, spot, x, width);
  }
  if let Some(tooltip) = local.tooltip.as_mut() {
    tooltip.update(&tip(), look.light);
  }
  local.drawn = Some(Drawn { look, x, width });
  taskbar::set_battery_left(Some((spot.taskbar, x)));
  true
}

// [space][mouse][gap][93%][space], as tall as the taskbar. Premultiplied colors (as Windows wants
// them); the empty parts are nearly invisible but not fully, so the whole strip takes clicks and
// hovering.
fn draw(look: &Look) -> Option<Canvas> {
  let size = |px: i32| scaled(px, look.dpi);
  let (pad, gap, icon_px, text_px) = (size(6), size(4), size(16), size(12));
  let ruler = Canvas::new(1, 1)?;
  let icon_width = ruler.with_font(ICON_FONTS, icon_px, FW_NORMAL, |canvas| canvas.measure(MOUSE_GLYPH).0)?;
  let text_width = ruler.with_font(TEXT_FONTS, text_px, FW_NORMAL, |canvas| canvas.measure(&look.text).0)?;
  drop(ruler);
  let text_left = pad + icon_width + gap;
  let width = text_left + text_width + pad;
  let height = look.height;
  let mut canvas = Canvas::new(width.max(1) as usize, height.max(1) as usize)?;
  canvas.with_font(ICON_FONTS, icon_px, FW_NORMAL, |canvas| canvas.text(MOUSE_GLYPH, pad, 0, pad + icon_width, height, DT_LEFT))?;
  canvas.with_font(TEXT_FONTS, text_px, FW_NORMAL, |canvas| canvas.text(&look.text, text_left, 0, width, height, DT_LEFT))?;
  // Only the number turns red when low; the mouse keeps the taskbar's color
  let (plain, number) = (theme::paint(look.light, false), theme::paint(look.light, look.low));
  let strength = if look.dim { 0.5 } else { 1.0 };
  // The hover highlight: like the taskbar's own, a little inside its height, rounded
  let (highlight, highlight_alpha) = taskbar::highlight(look.light);
  let inset = size(4) as f32;
  let corner = size(4) as f32;
  // A badge on the mouse's bottom right corner, at full strength, with a thin gap cut around it like
  // Windows' badges: "Zz" (the taskbar's white or black) when there's no answer, else a blue bolt
  // while charging (the two never meet: charging is only known from an answer)
  let (badge_x, badge_y) = ((pad + icon_width) as f32 - size(2) as f32, height as f32 / 2.0 + size(5) as f32);
  let scale = look.dpi as f32 / 96.0;
  let badge_gap = 1.5 * scale;
  let badge = if look.dim {
    Some(Badge::Asleep(Sleep::draw(look.dpi, badge_x, badge_y)?))
  } else if look.charging {
    Some(Badge::Bolt(bolt_points(badge_x, badge_y, size(8) as f32)))
  } else {
    None
  };
  let badge_color = if look.dim { plain } else { theme::charging(look.light) };
  let columns = canvas.width;
  for (index, pixel) in canvas.pixels().chunks_exact_mut(4).enumerate() {
    let (x, y) = ((index % columns) as i32, (index / columns) as i32);
    let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
    let (badge_cover, gap_cover) = match &badge {
      // How far the pixel's center is from the bolt's edge (below 0: inside)
      Some(Badge::Bolt(bolt)) => {
        let from_badge = from_shape(px, py, bolt);
        ((0.5 - from_badge).clamp(0.0, 1.0), (badge_gap + 0.5 - from_badge).clamp(0.0, 1.0))
      }
      Some(Badge::Asleep(sleep)) => (sleep.cover(x, y), sleep.near(x, y, badge_gap)),
      None => (0.0, 0.0),
    };
    let cover = pixel[2] as f32 / 255.0 * strength * (1.0 - gap_cover);
    let color = if x < text_left { plain } else { number };
    let background = if look.hover {
      highlight_alpha * rounded_box(px, py, 0.0, inset, width as f32, height as f32 - inset, corner)
    } else {
      0.0
    };
    // Text over the highlight, then the badge over both
    let under = cover + background * (1.0 - cover);
    let alpha = badge_cover + under * (1.0 - badge_cover);
    if alpha < 1.0 / 255.0 {
      pixel.copy_from_slice(&[0, 0, 0, 1]);
      continue;
    }
    let channel = |part: usize| {
      let below = color[part] as f32 * cover + highlight[part] as f32 * background * (1.0 - cover);
      (badge_color[part] as f32 * badge_cover + below * (1.0 - badge_cover)).round().clamp(0.0, 255.0) as u8
    };
    pixel[0] = channel(2);
    pixel[1] = channel(1);
    pixel[2] = channel(0);
    pixel[3] = (alpha * 255.0).round().clamp(1.0, 255.0) as u8;
  }
  Some(canvas)
}

enum Badge {
  Asleep(Sleep),
  Bolt(Vec<(f32, f32)>),
}

// "Zz" (Z 9 px, z 7 px at 100%, the clock's font, semibold) drawn on a small sheet of its own, its
// ink centered on the badge's spot; then read as how much of each strip pixel it covers
struct Sleep {
  cover: Vec<f32>,
  side: i32,
  left: i32,
  top: i32,
}

impl Sleep {
  fn draw(dpi: u32, x: f32, y: f32) -> Option<Sleep> {
    let size = |px: i32| scaled(px, dpi);
    let side = size(20);
    let mut sheet = Canvas::new(side as usize, side as usize)?;
    let (big, small) = (size(9), size(7));
    let (big_width, big_height) = sheet.with_font(TEXT_FONTS, big, FW_SEMIBOLD, |canvas| canvas.measure("Z"))?;
    let small_height = sheet.with_font(TEXT_FONTS, small, FW_SEMIBOLD, |canvas| canvas.measure("z").1)?;
    // Both letters on one baseline: a box as tall as each font's line puts its text at the top, and
    // the baseline sits at the same share of the line in both sizes (~80% in Segoe UI)
    let (start, top) = (size(2), size(2));
    let small_top = top + ((big_height - small_height) as f32 * 0.8).round() as i32;
    sheet.with_font(TEXT_FONTS, big, FW_SEMIBOLD, |canvas| canvas.text("Z", start, top, side, top + big_height, DT_LEFT))?;
    sheet.with_font(TEXT_FONTS, small, FW_SEMIBOLD, |canvas| {
      canvas.text("z", start + big_width, small_top, side, small_top + small_height, DT_LEFT)
    })?;
    let cover: Vec<f32> = sheet.pixels().chunks_exact(4).map(|pixel| pixel[2] as f32 / 255.0).collect();
    // The ink's box, to center it on the spot
    let (mut low_x, mut low_y, mut high_x, mut high_y) = (side, side, 0, 0);
    for (index, &value) in cover.iter().enumerate() {
      if value > 0.1 {
        let (cx, cy) = (index as i32 % side, index as i32 / side);
        (low_x, low_y, high_x, high_y) = (low_x.min(cx), low_y.min(cy), high_x.max(cx + 1), high_y.max(cy + 1));
      }
    }
    if low_x >= high_x {
      return None;
    }
    let left = (x - (low_x + high_x) as f32 / 2.0).round() as i32;
    let top = (y - (low_y + high_y) as f32 / 2.0).round() as i32;
    Some(Sleep { cover, side, left, top })
  }

  // How much of the strip's pixel (x, y) the letters cover: 0 to 1
  fn cover(&self, x: i32, y: i32) -> f32 {
    let (sx, sy) = (x - self.left, y - self.top);
    if sx < 0 || sy < 0 || sx >= self.side || sy >= self.side {
      return 0.0;
    }
    self.cover[(sy * self.side + sx) as usize]
  }

  // The gap around the letters: how much of the pixel lies within `gap` of them, soft at its edge
  fn near(&self, x: i32, y: i32, gap: f32) -> f32 {
    let reach = (gap + 0.5).ceil() as i32;
    let mut most: f32 = 0.0;
    for dy in -reach..=reach {
      for dx in -reach..=reach {
        let falloff = (gap + 0.5 - ((dx * dx + dy * dy) as f32).sqrt()).clamp(0.0, 1.0);
        if falloff > 0.0 {
          most = most.max(self.cover(x + dx, y + dy) * falloff);
        }
      }
    }
    most
  }
}

// A lightning bolt `tall` pixels high, centered on (x, y)
fn bolt_points(x: f32, y: f32, tall: f32) -> Vec<(f32, f32)> {
  let unit = tall / 14.0;
  [(6.2, 0.0), (0.0, 8.2), (4.4, 8.2), (3.4, 14.0), (10.0, 5.6), (5.6, 5.6)]
    .iter()
    .map(|&(px, py)| (x + (px - 5.0) * unit, y + (py - 7.0) * unit))
    .collect()
}

// How far a point is from a shape's edge, in pixels: below 0 inside, above 0 outside
fn from_shape(x: f32, y: f32, points: &[(f32, f32)]) -> f32 {
  let squared = |a: f32, b: f32| a * a + b * b;
  let mut nearest = squared(x - points[0].0, y - points[0].1);
  let mut inside = false;
  let mut previous = points[points.len() - 1];
  for &point in points {
    let (edge_x, edge_y) = (previous.0 - point.0, previous.1 - point.1);
    let (to_x, to_y) = (x - point.0, y - point.1);
    let along = ((to_x * edge_x + to_y * edge_y) / squared(edge_x, edge_y)).clamp(0.0, 1.0);
    nearest = nearest.min(squared(to_x - edge_x * along, to_y - edge_y * along));
    // Even-odd rule: crossing the edges an odd number of times = inside
    if (point.1 > y) != (previous.1 > y) && x < point.0 + (y - point.1) * edge_x / edge_y {
      inside = !inside;
    }
    previous = point;
  }
  if inside { -nearest.sqrt() } else { nearest.sqrt() }
}
