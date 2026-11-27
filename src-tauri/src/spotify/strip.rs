// What Spotify plays, inside the taskbar (main screen): a see-through child window of the taskbar,
// left of the mouse battery's strip (or in its place when that one is off), 4 px apart. The cover,
// then the title (semibold) over the artist (a little dimmer), cut with "…" past 150 px. Paused:
// cover and text at half strength. Spotify closed, or shown as the widget: no strip.
// Hover: a soft highlight like the taskbar's own icons, a tooltip with the full title and artist
// only when one of them is cut, ⏮ and ⏭ at the ends, ⏯ on the cover under a dark veil. Their room: made on hover (the strip grows
// to the left, as its right edge is held by the battery) or always kept, or no ⏮ ⏭ at all
// (Settings → Spotify).
// Clicks: ⏮ ⏭, and the cover or the text for play/pause; the reading thread asks Spotify.
// Wheel: Spotify's volume (the reading thread changes it), shown in the artist's place until
// 1.5 s after the last notch; the strip never gets narrower meanwhile.
// Its own thread, like the battery's: once inside the taskbar it shares Windows' input with it, so
// it never waits on anything slow (the reading thread decodes the cover and talks to Spotify).
// Placed again every second, whenever the song, the mouse or the battery strip changes, and on
// each frame of the buttons' fade.

use super::{ask, strip_shown, volume_line, Ask, Cover, Room};
use crate::mouse_battery::gdi::Canvas;
use crate::mouse_battery::{theme, wide};
use crate::taskbar::{self, register, rounded_box, scaled, Spot, Tooltip};
use std::cell::{Cell, RefCell};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{ScreenToClient, DT_CENTER, DT_END_ELLIPSIS, DT_LEFT, FW_NORMAL, FW_SEMIBOLD};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Controls::{InitCommonControlsEx, ICC_WIN95_CLASSES, INITCOMMONCONTROLSEX, WM_MOUSELEAVE};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos, GetMessageW, KillTimer, PostMessageW,
  PostQuitMessage, SetTimer, TranslateMessage, MA_NOACTIVATE, MSG, WM_APP, WM_CLOSE, WM_DESTROY, WM_LBUTTONDOWN, WM_LBUTTONUP,
  WM_MOUSEACTIVATE, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_SETTINGCHANGE, WM_TIMER, WHEEL_DELTA, WS_EX_TOOLWINDOW, WS_POPUP,
};

const WM_REFRESH: u32 = WM_APP + 1;
const PLACE_TIMER: usize = 1;
const MOTION_TIMER: usize = 2; // the buttons' fade: one frame each time
const VOLUME_TIMER: usize = 3; // the volume goes back to the artist
const VOLUME_MS: u32 = 1500;
const FRAME_MS: u32 = 15;
const FADE_SECONDS: f32 = 0.12;
const CONTROLLER_CLASS: &str = "SyncRSpotifyControl";
const STRIP_CLASS: &str = "SyncRSpotifyStrip";
const TEXT_FONTS: &[&str] = &["Segoe UI Variable Text", "Segoe UI"]; // the clock's, Windows 11 then 10
const ICON_FONTS: &[&str] = &["Segoe Fluent Icons", "Segoe MDL2 Assets"]; // Windows 11's, then 10's
const PREVIOUS: &str = "\u{E892}";
const NEXT: &str = "\u{E893}";
const PLAY: &str = "\u{E768}";
const PAUSE: &str = "\u{E769}";
const ARTIST_STRENGTH: f32 = 0.62; // the artist line, against the title's full white (or black)
const VEIL: f32 = 0.55; // the cover's dark veil under ⏯
const TEXT_MAX: i32 = 150; // the text's width before it's cut with "…" (at 100%)
const SLIDE: f32 = 6.0; // room kept: ⏮ ⏭ come this far in from the middle as they fade in (at 100%)

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

// The parts of the strip the mouse can be over
#[derive(Clone, Copy, PartialEq)]
enum Part {
  Previous,
  Cover,
  Text,
  Next,
}

// Where each part is (strip pixels, at the strip's scale), from the text's width and how far the
// buttons are in (0 to 1)
#[derive(Clone, Copy, PartialEq, Default)]
struct Layout {
  side: i32, // each button's room (0: none)
  cover_left: i32,
  cover_side: i32,
  text_left: i32,
  text_right: i32, // ⏭'s room starts here
  width: i32,
}

impl Layout {
  fn new(dpi: u32, text_width: i32, room: Room, open: f32) -> Layout {
    let size = |px: i32| scaled(px, dpi);
    let full_side = size(26);
    let side = match room {
      Room::Keep => full_side,
      Room::Grow => (full_side as f32 * open).round() as i32,
      Room::None => 0,
    };
    let cover_left = size(4) + side;
    let cover_side = size(32);
    let text_left = cover_left + cover_side + size(8);
    let text_right = text_left + text_width.min(size(TEXT_MAX));
    Layout { side, cover_left, cover_side, text_left, text_right, width: text_right + side + size(6) }
  }

  // The part under `x`: ⏮ and ⏭ take the strip's ends, the cover reaches halfway to the text
  fn part(&self, x: i32) -> Option<Part> {
    if x < 0 || x >= self.width {
      None
    } else if self.side > 0 && x < self.cover_left {
      Some(Part::Previous)
    } else if x < (self.cover_left + self.cover_side + self.text_left) / 2 {
      Some(Part::Cover)
    } else if self.side > 0 && x >= self.text_right {
      Some(Part::Next)
    } else {
      Some(Part::Text)
    }
  }
}

// What's drawn: redrawn only when one of these changes
#[derive(Clone)]
struct Look {
  dpi: u32,
  height: i32,
  layout: Layout,
  title: String,
  artist: String,
  playing: bool,
  cover: Option<Arc<Cover>>, // held here, so a new cover can't reuse the old one's place and look the same
  hover: bool,
  part: Option<Part>, // under the mouse (⏮ ⏭ get a box)
  open: u8,           // ⏮ ⏭ faded in, 0 to 255
  veil: u8,           // the cover's veil and ⏯, 0 to 255
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
      && (self.dpi, self.height, self.layout, &self.title, &self.artist, self.playing, self.hover, self.part, self.open, self.veil, self.light)
        == (other.dpi, other.height, other.layout, &other.title, &other.artist, other.playing, other.hover, other.part, other.open, other.veil, other.light)
  }
}

struct Drawn {
  look: Look,
  x: i32,
}

// The text's width (the longer line), kept for the song and scale it was measured for
struct Measured {
  title: String,
  artist: String,
  dpi: u32,
  width: i32,
}

// This thread's own state (only the strip thread touches it)
struct Local {
  controller: HWND,
  strip: HWND,
  tooltip: Option<Tooltip>,
  drawn: Option<Drawn>,
  measured: Option<Measured>,
  buttons: bool, // ⏮ ⏭ come in on hover (not when they're off)
  open: f32,     // ⏮ ⏭ coming in: 0 (gone) to 1 (there)
  veil: f32, // the cover's veil and ⏯, 0 to 1
  last_frame: Option<Instant>,
  moving: bool, // the frame timer runs
}

thread_local! {
  static LOCAL: RefCell<Local> = const {
    RefCell::new(Local {
      controller: null_mut(),
      strip: null_mut(),
      tooltip: None,
      drawn: None,
      measured: None,
      buttons: true,
      open: 0.0,
      veil: 0.0,
      last_frame: None,
      moving: false,
    })
  };
  // Apart from LOCAL: the strip's own messages change or read them, also while LOCAL is busy
  static HOVER: Cell<bool> = const { Cell::new(false) };
  static LAYOUT: Cell<Layout> = const { Cell::new(Layout { side: 0, cover_left: 0, cover_side: 0, text_left: 0, text_right: 0, width: 0 }) };
  static PRESSED: Cell<Option<Part>> = const { Cell::new(None) };
  // The volume shows in the artist's place; the part of a notch turned so far (fine-turning mice)
  static VOLUME_SHOWN: Cell<bool> = const { Cell::new(false) };
  static WHEEL_REST: Cell<i32> = const { Cell::new(0) };
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
      if message == WM_TIMER && wparam == VOLUME_TIMER {
        unsafe { KillTimer(window, VOLUME_TIMER) };
        VOLUME_SHOWN.set(false);
      }
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

// The mouse's x in the strip, from a mouse message
fn mouse_x(lparam: LPARAM) -> i32 {
  (lparam & 0xFFFF) as u16 as i16 as i32
}

unsafe extern "system" fn strip_proc(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
  match message {
    // A click never takes the focus from the app in front
    WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
    // The mouse came over it (highlight, buttons in, and hear when it leaves) or moved to another part
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
      }
      refresh();
      0
    }
    WM_MOUSELEAVE => {
      HOVER.set(false);
      PRESSED.set(None);
      refresh();
      0
    }
    // A click counts when it's let go over the part it was pressed on
    WM_LBUTTONDOWN => {
      PRESSED.set(LAYOUT.get().part(mouse_x(lparam)));
      0
    }
    WM_LBUTTONUP => {
      let pressed = PRESSED.take();
      if let Some(part) = LAYOUT.get().part(mouse_x(lparam)).filter(|&part| Some(part) == pressed) {
        ask(match part {
          Part::Previous => Ask::Previous,
          Part::Cover | Part::Text => Ask::Toggle,
          Part::Next => Ask::Next,
        });
      }
      0
    }
    // Each notch: 2 % (the reading thread changes it, then the strip is drawn again)
    WM_MOUSEWHEEL => {
      let turned = WHEEL_REST.get() + ((wparam >> 16) & 0xFFFF) as u16 as i16 as i32;
      let notches = turned / WHEEL_DELTA as i32;
      WHEEL_REST.set(turned - notches * WHEEL_DELTA as i32);
      if notches != 0 {
        ask(Ask::Volume(notches));
      }
      VOLUME_SHOWN.set(true);
      let controller = *lock(&CONTROLLER);
      if controller != 0 {
        unsafe { SetTimer(controller as HWND, VOLUME_TIMER, VOLUME_MS, None) }; // again from now
      }
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
    let moving = local.drawn.is_some() && (local.open != target(HOVER.get() && local.buttons) || local.veil != target(local.drawn.as_ref().is_some_and(|drawn| drawn.look.part == Some(Part::Cover))));
    if moving != local.moving {
      unsafe {
        if moving {
          SetTimer(local.controller, MOTION_TIMER, FRAME_MS, None);
        } else {
          KillTimer(local.controller, MOTION_TIMER);
        }
      }
      local.moving = moving;
    }
    if !moving {
      local.last_frame = None;
    }
  });
}

fn target(on: bool) -> f32 {
  if on { 1.0 } else { 0.0 }
}

fn hide(local: &mut Local) {
  local.tooltip = None;
  taskbar::remove(std::mem::replace(&mut local.strip, null_mut()));
  local.drawn = None;
  local.open = 0.0;
  local.veil = 0.0;
  HOVER.set(false);
  PRESSED.set(None);
  VOLUME_SHOWN.set(false);
  WHEEL_REST.set(0);
  LAYOUT.set(Layout::default());
}

// One step of a fade toward `to`, `seconds` after the last frame (all at once: animations off)
fn fade(now: f32, to: f32, seconds: f32, animations: bool) -> f32 {
  if !animations {
    return to;
  }
  let step = seconds / FADE_SECONDS;
  if now < to { (now + step).min(to) } else { (now - step).max(to) }
}

// Slow start and end, like the page's fades
fn ease(progress: f32) -> f32 {
  progress * progress * (3.0 - 2.0 * progress)
}

fn to_byte(progress: f32) -> u8 {
  (progress * 255.0).round().clamp(0.0, 255.0) as u8
}

// false: nothing to show, or it couldn't be drawn or put in the taskbar
fn show(local: &mut Local, spot: &Spot) -> bool {
  let Some(now) = strip_shown() else { return false };
  // How far the fades are: a frame's time since the last one (at most 2 frames' worth, so a fade
  // starting after a quiet while doesn't jump)
  let frame = Instant::now();
  let seconds = local.last_frame.map_or(FRAME_MS as f32 / 1000.0, |last| frame.duration_since(last).as_secs_f32()).min(0.033);
  local.last_frame = Some(frame);
  let hover = HOVER.get();
  local.buttons = now.room != Room::None;
  local.open = fade(local.open, target(hover && local.buttons), seconds, now.animations);
  // The text's width, measured again only for a new song or scale
  let known = local.measured.as_ref().is_some_and(|measured| measured.title == now.title && measured.artist == now.artist && measured.dpi == spot.dpi);
  if !known {
    let Some(text_width) = measure(&now.title, &now.artist, spot.dpi) else { return false };
    local.measured = Some(Measured { title: now.title.clone(), artist: now.artist.clone(), dpi: spot.dpi, width: text_width });
  }
  let mut text_width = local.measured.as_ref().map_or(0, |measured| measured.width);
  // The tooltip: only when the title or the artist is cut (empty: Windows shows none)
  let tip = if text_width <= scaled(TEXT_MAX, spot.dpi) {
    String::new()
  } else if now.artist.is_empty() {
    now.title.clone()
  } else {
    format!("{}\n{}", now.title, now.artist)
  };
  // The volume in the artist's place while the wheel turns: as wide as it needs, never narrower
  let volume = now.volume.filter(|_| VOLUME_SHOWN.get()).map(volume_line);
  if let Some(volume) = &volume {
    let Some(volume_width) = measure(&now.title, volume, spot.dpi) else { return false };
    text_width = text_width.max(volume_width);
  }
  let layout = Layout::new(spot.dpi, text_width, now.room, ease(local.open));
  let width = layout.width;
  let x = spot.left_of_battery() - width;
  // The part under the mouse, where the strip is now (it may have just grown under it)
  let part = if hover { mouse_in_taskbar(spot.taskbar).and_then(|(mouse_x, mouse_y)| if (0..spot.height).contains(&mouse_y) { layout.part(mouse_x - x) } else { None }) } else { None };
  local.veil = fade(local.veil, target(part == Some(Part::Cover)), seconds, now.animations);
  let look = Look {
    dpi: spot.dpi,
    height: spot.height,
    layout,
    title: now.title,
    artist: volume.unwrap_or(now.artist),
    playing: now.playing,
    cover: now.cover,
    hover,
    part,
    open: to_byte(ease(local.open)),
    veil: to_byte(ease(local.veil)),
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
  let moved = local.drawn.as_ref().is_none_or(|drawn| drawn.x != x || drawn.look.layout.width != width);
  if moved || picture.is_some() {
    taskbar::move_strip(local.strip, spot, x, width);
  }
  if let Some(tooltip) = local.tooltip.as_mut() {
    tooltip.update(&tip, look.light);
  }
  LAYOUT.set(layout);
  local.drawn = Some(Drawn { look, x });
  true
}

// The mouse in the taskbar's own pixels (where the strips are placed)
fn mouse_in_taskbar(taskbar: HWND) -> Option<(i32, i32)> {
  let mut point = POINT { x: 0, y: 0 };
  unsafe { (GetCursorPos(&mut point) != 0 && ScreenToClient(taskbar, &mut point) != 0).then_some((point.x, point.y)) }
}

// The longer of the title (semibold) and the artist, in pixels
fn measure(title: &str, artist: &str, dpi: u32) -> Option<i32> {
  let text_px = scaled(12, dpi);
  let ruler = Canvas::new(1, 1)?;
  let title_width = ruler.with_font(TEXT_FONTS, text_px, FW_SEMIBOLD, |canvas| canvas.measure(title).0)?;
  let artist_width = ruler.with_font(TEXT_FONTS, text_px, FW_NORMAL, |canvas| canvas.measure(artist).0)?;
  Some(title_width.max(artist_width))
}

// A color with its strength, premultiplied (blue, green, red as 0–255, then alpha 0–1)
fn tint(rgb: [u8; 3], alpha: f32) -> [f32; 4] {
  [rgb[2] as f32 * alpha, rgb[1] as f32 * alpha, rgb[0] as f32 * alpha, alpha]
}

// `top` laid over `below`
fn over(top: [f32; 4], below: [f32; 4]) -> [f32; 4] {
  let rest = 1.0 - top[3];
  [top[0] + below[0] * rest, top[1] + below[1] * rest, top[2] + below[2] * rest, top[3] + below[3] * rest]
}

// [4][⏮ 26][cover 32][8][title over artist, up to 150][⏭ 26][6] at 100% (⏮ ⏭'s room: 0 until
// hovered when it's made on hover), as tall as the taskbar. Premultiplied colors (as Windows wants
// them); the empty parts are nearly invisible but not fully, so the whole strip takes the mouse.
fn draw(look: &Look) -> Option<Canvas> {
  let size = |px: i32| scaled(px, look.dpi);
  let Layout { side, cover_left, cover_side, text_left, text_right, width } = look.layout;
  let (text_px, line, icon_px, play_px) = (size(12), size(16), size(13), size(14));
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
  // ⏮ ⏭ in their room (cut to it while it grows). Room kept: they also come in from the middle.
  let open = look.open as f32 / 255.0;
  let veil = look.veil as f32 / 255.0;
  let (previous_left, next_left) = (cover_left - side, text_right);
  if side > 0 && open > 0.0 {
    let slide = (SLIDE * look.dpi as f32 / 96.0 * (1.0 - open)).round() as i32;
    canvas.with_font(ICON_FONTS, icon_px, FW_NORMAL, |canvas| {
      canvas.text(PREVIOUS, previous_left + slide, 0, cover_left + slide, height, DT_CENTER);
      canvas.text(NEXT, next_left - slide, 0, next_left + side - slide, height, DT_CENTER);
    })?;
  }
  let (cover_right, cover_bottom) = (cover_left + cover_side, cover_top + cover_side);
  if veil > 0.0 {
    let icon = if look.playing { PAUSE } else { PLAY };
    canvas.with_font(ICON_FONTS, play_px, FW_NORMAL, |canvas| canvas.text(icon, cover_left, cover_top, cover_right, cover_bottom, DT_CENTER))?;
  }
  let cover = look.cover.as_deref().map(|cover| shrink(cover, cover_side as usize));
  let color = theme::paint(look.light, false);
  let strength = if look.playing { 1.0 } else { 0.5 }; // paused: cover and text only, not the buttons
  // The hover highlight: like the taskbar's own, a little inside its height, rounded. The button
  // under the mouse gets a box of its own over it.
  let (highlight, highlight_alpha) = taskbar::highlight(look.light);
  let button_alpha = if look.light { 0.07 } else { 0.09 };
  let (inset, corner, cover_corner) = (size(4) as f32, size(4) as f32, size(3) as f32);
  let button = match look.part {
    Some(Part::Previous) if side > 0 => Some(previous_left),
    Some(Part::Next) if side > 0 => Some(next_left),
    _ => None,
  };
  let (button_top, button_bottom) = ((height - size(28)) as f32 / 2.0, (height + size(28)) as f32 / 2.0);
  // Without a cover yet (still being read): a faint square in its place
  let (empty_color, empty_alpha) = if look.light { ([0u8, 0, 0], 0.10) } else { ([255u8, 255, 255], 0.12) };
  let columns = canvas.width;
  for (index, pixel) in canvas.pixels().chunks_exact_mut(4).enumerate() {
    let (x, y) = ((index % columns) as i32, (index / columns) as i32);
    let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
    let coverage = pixel[2] as f32 / 255.0; // text or icon drawn here (white on black)
    let mut out = [0.0; 4];
    if look.hover {
      out = tint(highlight, highlight_alpha * rounded_box(px, py, 0.0, inset, width as f32, height as f32 - inset, corner));
    }
    if let Some(left) = button {
      let shape = rounded_box(px, py, left as f32, button_top, (left + side) as f32, button_bottom, corner);
      out = over(tint(highlight, button_alpha * open * shape), out);
    }
    if x >= cover_left && x < cover_right && y >= cover_top && y < cover_bottom {
      // The cover (dimmed when paused), then the veil and ⏯ (never dimmed)
      let shape = rounded_box(px, py, cover_left as f32, cover_top as f32, cover_right as f32, cover_bottom as f32, cover_corner);
      let picture = match &cover {
        Some(cover) => {
          let at = (((y - cover_top) as usize) * cover_side as usize + (x - cover_left) as usize) * 4;
          let part = |i: usize| cover[at + i] * shape * strength;
          [part(0), part(1), part(2), part(3)]
        }
        None => tint(empty_color, empty_alpha * shape * strength),
      };
      out = over(picture, out);
      out = over(tint([0, 0, 0], VEIL * veil * shape), out);
      out = over(tint([255, 255, 255], coverage * veil * shape), out);
    } else if x < cover_left || x >= text_right {
      out = over(tint(color, coverage * open), out); // ⏮ ⏭
    } else {
      let line_strength = if y >= artist_top && two_lines { ARTIST_STRENGTH } else { 1.0 };
      out = over(tint(color, coverage * strength * line_strength), out);
    }
    if out[3] < 1.0 / 255.0 {
      pixel.copy_from_slice(&[0, 0, 0, 1]);
      continue;
    }
    for part in 0..3 {
      pixel[part] = out[part].round().clamp(0.0, 255.0) as u8;
    }
    pixel[3] = (out[3] * 255.0).round().clamp(1.0, 255.0) as u8;
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
