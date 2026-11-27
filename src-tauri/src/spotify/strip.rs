// What Spotify plays, inside the taskbar (main screen): a see-through child window of the taskbar,
// left of the mouse battery's strip (or in its place when that one is off), 4 px apart. The cover,
// then the title (semibold) over the artist (a little dimmer), cut with "…" past 150 px. Paused:
// cover and text at half strength. Spotify closed, or shown as the widget: no strip.
// Hover: a soft highlight like the taskbar's own icons and a tooltip (its words come from the page).
// Its own thread, like the battery's: once inside the taskbar it shares Windows' input with it, so
// it never waits on anything slow (the reading thread decodes the cover). Placed again every second
// and whenever the song or the battery strip changes.

use super::{strip_shown, tip, Cover};
use crate::mouse_battery::gdi::Canvas;
use crate::mouse_battery::{theme, wide};
use crate::taskbar::{self, register, rounded_box, scaled, Spot, Tooltip};
use std::cell::{Cell, RefCell};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{DT_END_ELLIPSIS, DT_LEFT, FW_NORMAL, FW_SEMIBOLD};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Controls::{InitCommonControlsEx, ICC_WIN95_CLASSES, INITCOMMONCONTROLSEX, WM_MOUSELEAVE};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, PostMessageW, PostQuitMessage, SetTimer,
  TranslateMessage, MA_NOACTIVATE, MSG, WM_APP, WM_CLOSE, WM_DESTROY, WM_MOUSEACTIVATE, WM_MOUSEMOVE, WM_SETTINGCHANGE,
  WM_TIMER, WS_EX_TOOLWINDOW, WS_POPUP,
};

const WM_REFRESH: u32 = WM_APP + 1;
const PLACE_TIMER: usize = 1;
const CONTROLLER_CLASS: &str = "SyncRSpotifyControl";
const STRIP_CLASS: &str = "SyncRSpotifyStrip";
const TEXT_FONTS: &[&str] = &["Segoe UI Variable Text", "Segoe UI"]; // the clock's, Windows 11 then 10
const ARTIST_STRENGTH: f32 = 0.62; // the artist line, against the title's full white (or black)

// The running strip thread's hidden window (0: none) and the number of the latest start or stop
// (an older thread that comes up late closes itself)
static CONTROLLER: Mutex<isize> = Mutex::new(0);
static STARTS: AtomicU64 = AtomicU64::new(0);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
  mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// The module turned on
pub fn start() {
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

// A new song, settings, tooltip, the mouse over it, the battery strip moved: draw or place again
pub fn refresh() {
  let controller = *lock(&CONTROLLER);
  if controller != 0 {
    unsafe { PostMessageW(controller as HWND, WM_REFRESH, 0, 0) };
  }
}

// What's drawn: redrawn only when one of these changes
#[derive(Clone)]
struct Look {
  dpi: u32,
  height: i32,
  title: String,
  artist: String,
  playing: bool,
  cover: Option<Arc<Cover>>, // held here, so a new cover can't reuse the old one's place and look the same
  hover: bool,
  light: bool,
}

impl PartialEq for Look {
  fn eq(&self, other: &Look) -> bool {
    let same_cover = match (&self.cover, &other.cover) {
      (Some(a), Some(b)) => Arc::ptr_eq(a, b),
      (None, None) => true,
      _ => false,
    };
    same_cover
      && (self.dpi, self.height, &self.title, &self.artist, self.playing, self.hover, self.light)
        == (other.dpi, other.height, &other.title, &other.artist, other.playing, other.hover, other.light)
  }
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
  static LOCAL: RefCell<Local> = const { RefCell::new(Local { controller: null_mut(), strip: null_mut(), tooltip: None, drawn: None }) };
  // Apart from LOCAL: the strip's own messages change it, also while LOCAL is busy
  static HOVER: Cell<bool> = const { Cell::new(false) };
}

fn run(start: u64) {
  unsafe {
    let instance = GetModuleHandleW(null());
    let controls = INITCOMMONCONTROLSEX { dwSize: std::mem::size_of::<INITCOMMONCONTROLSEX>() as u32, dwICC: ICC_WIN95_CLASSES };
    InitCommonControlsEx(&controls); // the tooltip
    let controller_class = wide(CONTROLLER_CLASS);
    register(instance, &controller_class, Some(controller_proc));
    register(instance, &wide(STRIP_CLASS), Some(strip_proc));
    // Hidden and never shown: a top-level window, so it hears Windows' light/dark changes
    let controller =
      CreateWindowExW(WS_EX_TOOLWINDOW, controller_class.as_ptr(), null(), WS_POPUP, 0, 0, 0, 0, null_mut(), null_mut(), instance, null());
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
    WM_TIMER | WM_REFRESH => {
      place();
      0
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
    let shown = taskbar::spot().is_some_and(|spot| show(&mut local, &spot));
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
}

// false: nothing to show, or it couldn't be drawn or put in the taskbar
fn show(local: &mut Local, spot: &Spot) -> bool {
  let Some(now) = strip_shown() else { return false };
  let look = Look {
    dpi: spot.dpi,
    height: spot.height,
    title: now.title,
    artist: now.artist,
    playing: now.playing,
    cover: now.cover,
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
  let x = spot.left_of_battery() - width;
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
  true
}

// [4][cover 32][8][title over artist, up to 150][6] at 100%, as tall as the taskbar. Premultiplied
// colors (as Windows wants them); the empty parts are nearly invisible but not fully, so the whole
// strip takes the mouse.
fn draw(look: &Look) -> Option<Canvas> {
  let size = |px: i32| scaled(px, look.dpi);
  let (left_pad, cover_side, gap, right_pad, text_px, line, longest) = (size(4), size(32), size(8), size(6), size(12), size(16), size(150));
  let ruler = Canvas::new(1, 1)?;
  let title_width = ruler.with_font(TEXT_FONTS, text_px, FW_SEMIBOLD, |canvas| canvas.measure(&look.title).0)?;
  let artist_width = ruler.with_font(TEXT_FONTS, text_px, FW_NORMAL, |canvas| canvas.measure(&look.artist).0)?;
  drop(ruler);
  let text_left = left_pad + cover_side + gap;
  let text_right = text_left + title_width.max(artist_width).min(longest);
  let width = text_right + right_pad;
  let height = look.height;
  let cover_top = (height - cover_side) / 2;
  // Two lines centered on the cover; just the title when there's no artist
  let two_lines = !look.artist.is_empty();
  let title_top = if two_lines { (height - 2 * line) / 2 } else { (height - line) / 2 };
  let artist_top = title_top + line;
  let mut canvas = Canvas::new(width.max(1) as usize, height.max(1) as usize)?;
  let align = DT_LEFT | DT_END_ELLIPSIS;
  canvas.with_font(TEXT_FONTS, text_px, FW_SEMIBOLD, |canvas| canvas.text(&look.title, text_left, title_top, text_right, title_top + line, align))?;
  if two_lines {
    canvas.with_font(TEXT_FONTS, text_px, FW_NORMAL, |canvas| canvas.text(&look.artist, text_left, artist_top, text_right, artist_top + line, align))?;
  }
  let cover = look.cover.as_deref().map(|cover| shrink(cover, cover_side as usize));
  let color = theme::paint(look.light, false);
  let strength = if look.playing { 1.0 } else { 0.5 };
  // The hover highlight: like the taskbar's own, a little inside its height, rounded
  let (highlight, highlight_alpha) = taskbar::highlight(look.light);
  let (inset, corner, cover_corner) = (size(4) as f32, size(4) as f32, size(3) as f32);
  let (cover_left, cover_right, cover_bottom) = (left_pad, left_pad + cover_side, cover_top + cover_side);
  // Without a cover yet (still being read): a faint square in its place
  let (empty_color, empty_alpha) = if look.light { ([0u8, 0, 0], 0.10) } else { ([255u8, 255, 255], 0.12) };
  let columns = canvas.width;
  for (index, pixel) in canvas.pixels().chunks_exact_mut(4).enumerate() {
    let (x, y) = ((index % columns) as i32, (index / columns) as i32);
    let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
    let background = if look.hover {
      highlight_alpha * rounded_box(px, py, 0.0, inset, width as f32, height as f32 - inset, corner)
    } else {
      0.0
    };
    // What's in front: the cover (premultiplied, blue/green/red) or the text, and how much it covers
    let (front, cover_alpha) = if x >= cover_left && x < cover_right && y >= cover_top && y < cover_bottom {
      let shape = strength * rounded_box(px, py, cover_left as f32, cover_top as f32, cover_right as f32, cover_bottom as f32, cover_corner);
      match &cover {
        Some(cover) => {
          let at = (((y - cover_top) as usize) * cover_side as usize + (x - cover_left) as usize) * 4;
          let part = |i: usize| cover[at + i] * shape;
          ([part(0), part(1), part(2)], cover[at + 3] * shape)
        }
        None => {
          let alpha = empty_alpha * shape;
          ([empty_color[2] as f32 * alpha, empty_color[1] as f32 * alpha, empty_color[0] as f32 * alpha], alpha)
        }
      }
    } else {
      let line_strength = if y >= artist_top && two_lines { ARTIST_STRENGTH } else { 1.0 };
      let alpha = pixel[2] as f32 / 255.0 * strength * line_strength;
      ([color[2] as f32 * alpha, color[1] as f32 * alpha, color[0] as f32 * alpha], alpha)
    };
    // The front over the highlight
    let alpha = cover_alpha + background * (1.0 - cover_alpha);
    if alpha < 1.0 / 255.0 {
      pixel.copy_from_slice(&[0, 0, 0, 1]);
      continue;
    }
    for part in 0..3 {
      let below = highlight[2 - part] as f32 * background * (1.0 - cover_alpha);
      pixel[part] = (front[part] + below).round().clamp(0.0, 255.0) as u8;
    }
    pixel[3] = (alpha * 255.0).round().clamp(1.0, 255.0) as u8;
  }
  Some(canvas)
}

// The cover made `side` pixels square: each new pixel is the average of the ones it covers.
// Premultiplied blue, green, red as 0–255, alpha as 0–1.
fn shrink(cover: &Cover, side: usize) -> Vec<f32> {
  let mut out = vec![0f32; side * side * 4];
  let from = cover.side;
  for y in 0..side {
    let (top, bottom) = (y * from / side, ((y + 1) * from / side).max(y * from / side + 1).min(from));
    for x in 0..side {
      let (left, right) = (x * from / side, ((x + 1) * from / side).max(x * from / side + 1).min(from));
      let mut sum = [0f32; 4];
      for row in top..bottom {
        for column in left..right {
          let at = (row * from + column) * 4;
          for part in 0..4 {
            sum[part] += cover.pixels[at + part] as f32;
          }
        }
      }
      let count = ((bottom - top) * (right - left)) as f32;
      let at = (y * side + x) * 4;
      for part in 0..3 {
        out[at + part] = sum[part] / count;
      }
      out[at + 3] = sum[3] / count / 255.0;
    }
  }
  out
}
