// The Spotify widget (PC): what Spotify plays, in a small card (look W2, the Hardware widget's dark
// box, see-through as set): the cover, then the title (semibold) over the artist and the album
// (dimmer), each cut with "…" past 170 px. Paused: cover and text at half strength. Spotify
// closed, or shown as the strip: no widget. Drawn with Direct2D + DirectWrite like the Hardware
// widget (the same text engine as the page), into a see-through picture.
// Hover: ⏯ on the cover under a dark veil (the cover or the text hovered), ⏮ and ⏭ fade in at the ends, in room always kept (so
// nothing moves under the mouse; "Buttons on hover: None": no ⏮ ⏭ and no room), and a tooltip
// with the full title, artist and album only when one of them is cut.
// Clicks: ⏮ ⏭, and the cover or the text for play/pause (the reading thread asks Spotify); a click
// counts when let go over the part it was pressed on. Wheel: Spotify's volume, shown in the
// artist's place until 1.5 s after the last notch. Ctrl + wheel: one size up or down (the page
// picks it and saves it), not when locked.
// "Always on top" (the default): a window of its own above the others; else inside the desktop (a
// child of its icon view: under every window, stays on Win+D). Press and move a few pixels to drag
// it (not when locked); press and let go without moving: a click. Where it's left goes back to
// the page, which saves it. First time: bottom right of the main monitor, just above the taskbar;
// while the saved place's monitor is gone, the same corner, then back where it was once the monitor
// returns (widget_place::place_now).
// "Colors from the cover" (on by default): the box takes a dark tint of the cover's main color
// behind the cover, fading into the plain dark box under the text (look C,
// .claude/mockups/spotify-cover-colors.html); a new song's color fades in over half a second.
// "Hide during full screen" (on by default, only when always on top): gone while a full-screen app
// is in front on its monitor (widget_place::full_screen_near), checked each second.
// "Fade when paused" (on by default): paused for 2 min, it fades down to faint over a second; the
// mouse over it, its menu open or the song playing: back to full at once (a quick fade). The wait
// starts again each time it plays or comes back (Spotify reopened, after a full-screen app).
// Right-click: its menu (widget_menu.rs).
// Progress line (.claude/mockups/spotify-progress.html, the chosen look): under the text, 3 px above
// the bottom, 2 px (4 px while the mouse is over the widget). The mouse on the bottom edge under it
// (Spotify taking jumps): a knob where the song is, the line bright, a faint part up to the mouse,
// and "1:24 / 5:13" in the album's place; press and drag there to jump (the song jumps when let
// go, the time shows where it lands). The rest of the widget still moves it.
// A line too long for its room scrolls (scroll.rs): drawn whole, slid left, cut to the text's room
// with soft ends.
// Its own thread, with a hidden window that rebuilds it when Explorer restarts (which takes the
// desktop and its children along) and moves it when monitors change.
// Nothing here may panic: the app is built with panic = "abort", so a panic would close SyncR.

use super::scroll::{Scroll, Slid};
use super::{
  ask, clock, ease, fade, lock, seek, shrink, target, timeline, to_byte, volume_line, wheel_notches, widget_locked, widget_moved, widget_shown, Ask,
  Bar, Cover, WidgetShown, GHOST, PLAYED, PLAYED_PAUSED, TRACK,
  FRAME_MS, ICON_FONTS, NEXT, PAUSE, PLAY, PREVIOUS, SLIDE, VEIL, VOLUME_MS,
};
use crate::hardware::widget::{color, text_baseline};
use crate::mouse_battery::gdi::Canvas;
use crate::taskbar::Tooltip;
use crate::widget_menu::{self, Owner};
use crate::widget_place::{desktop, dpi_at, full_screen_near, keep_inside, main_monitor, margin, monitor_dpi, place_now, to_parent, window_place, work_area};
use std::cell::{Cell, RefCell};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use windows::core::BOOL;
use windows::Win32::Graphics::Direct2D::Common::{D2D1_ALPHA_MODE_PREMULTIPLIED, D2D1_COLOR_F, D2D1_GRADIENT_STOP, D2D1_PIXEL_FORMAT, D2D_RECT_F, D2D_SIZE_U};
use windows::Win32::Graphics::Direct2D::{
  D2D1CreateFactory, ID2D1Factory, ID2D1RenderTarget, D2D1_BITMAP_BRUSH_PROPERTIES, D2D1_BITMAP_INTERPOLATION_MODE_NEAREST_NEIGHBOR,
  D2D1_BITMAP_PROPERTIES, D2D1_BRUSH_PROPERTIES, D2D1_DRAW_TEXT_OPTIONS_NONE, D2D1_EXTEND_MODE_CLAMP, D2D1_FACTORY_TYPE_SINGLE_THREADED,
  D2D1_FEATURE_LEVEL_DEFAULT, D2D1_GAMMA_2_2, D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES, D2D1_RENDER_TARGET_PROPERTIES, D2D1_RENDER_TARGET_TYPE_SOFTWARE, D2D1_RENDER_TARGET_USAGE_NONE,
  D2D1_ANTIALIAS_MODE_ALIASED, D2D1_ELLIPSE, D2D1_ROUNDED_RECT, D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE,
};
use windows::Win32::Graphics::DirectWrite::{
  DWriteCreateFactory, IDWriteFactory, IDWriteFontCollection, IDWriteTextFormat, IDWriteTextLayout, DWRITE_FACTORY_TYPE_SHARED,
  DWRITE_FONT_STRETCH_NORMAL, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT, DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_WEIGHT_SEMI_BOLD,
  DWRITE_LINE_METRICS, DWRITE_PARAGRAPH_ALIGNMENT_CENTER, DWRITE_TEXT_ALIGNMENT_CENTER, DWRITE_TEXT_METRICS, DWRITE_TRIMMING,
  DWRITE_TRIMMING_GRANULARITY_CHARACTER, DWRITE_WORD_WRAPPING_NO_WRAP,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows_numerics::Matrix3x2;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{AC_SRC_ALPHA, AC_SRC_OVER, BLENDFUNCTION, HMONITOR};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::SystemServices::MK_CONTROL;
use windows_sys::Win32::UI::Controls::{InitCommonControlsEx, ICC_WIN95_CLASSES, INITCOMMONCONTROLSEX, WM_MOUSELEAVE};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture, TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos, GetMessageW, GetParent, GetSystemMetrics, IsWindow,
  KillTimer, LoadCursorW, PostMessageW, PostQuitMessage, RegisterClassExW, SetTimer, SetWindowPos, TranslateMessage, UpdateLayeredWindow,
  HWND_TOP, HWND_TOPMOST, IDC_ARROW, MA_NOACTIVATE, MSG, SM_CXDRAG, SM_CYDRAG, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
  SWP_SHOWWINDOW, ULW_ALPHA, WM_APP, WM_CAPTURECHANGED, WM_CLOSE, WM_CONTEXTMENU, WM_DESTROY, WM_DISPLAYCHANGE, WM_LBUTTONDOWN,
  WM_LBUTTONUP, WM_MOUSEACTIVATE, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_TIMER, WNDCLASSEXW, WNDPROC, WS_CHILD,
  WS_CLIPSIBLINGS, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_NOPARENTNOTIFY, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

const WM_REFRESH: u32 = WM_APP + 1;
const CHECK_TIMER: usize = 1;
const MOTION_TIMER: usize = 2; // the fades: one frame each time
const VOLUME_TIMER: usize = 3; // the volume goes back to the artist
const CONTROLLER_CLASS: &str = "SyncRSpotifyWidgetControl";
const WIDGET_CLASS: &str = "SyncRSpotifyWidget";

// Look W2 (.claude/mockups/spotify-strip.html), in CSS pixels (DIPs), with the Hardware widget's
// dark colors (index.css: --bg, --text, --text-dim)
const FONT: &str = "Segoe UI";
const PAD: f32 = 8.0;
const SIDE: f32 = 26.0; // each of ⏮ ⏭'s room, inside the padding
const COVER: f32 = 56.0;
const COVER_RADIUS: f32 = 4.0;
const GAP: f32 = 10.0; // between the cover and the text
const TEXT_WIDTH: f32 = 170.0; // cut with "…" past it
const EDGE: f32 = 10.0; // a scrolling line's soft ends
const WHOLE: f32 = 100_000.0; // a line laid out this wide is never cut
const LINE: f32 = 18.0;
const TITLE_SIZE: f32 = 13.0;
const LINE_SIZE: f32 = 12.0; // the artist and the album
const ICON_SIZE: f32 = 13.0; // ⏮ ⏭
const PLAY_SIZE: f32 = 20.0; // ⏯ on the cover
const BUTTON_HIGH: f32 = 28.0; // the box under the mouse on ⏮ or ⏭
const BUTTON_RADIUS: f32 = 4.0;
const BUTTON_BOX: f32 = 0.09; // its strength (white), like the strip's on a dark taskbar
const RADIUS: f32 = 8.0;
const LINE_BOTTOM: f32 = 3.0; // the progress line: this far above the bottom
const LINE_THIN: f32 = 2.0;
const LINE_THICK: f32 = 4.0; // the mouse over the widget
const KNOB: f32 = 10.0;

const HEIGHT: f32 = PAD + COVER + PAD;
const BG: u32 = 0x161616;
const TEXT: u32 = 0xe4e4e4;
const DIM: u32 = 0x808080;
const PAUSED: f32 = 0.5; // cover and text, paused
const EMPTY: f32 = 0.12; // no cover yet: a faint white square
// The cover's tint (look C): full from the box's left edge to this far past the cover's left, then
// fading into the dark box until TINT_FADED past it (the mockup's 30 and 230 px)
const TINT_FULL: f32 = 22.0;
const TINT_FADED: f32 = 222.0;
const TINT_SECONDS: f32 = 0.5; // a new song's tint fades in
const PAUSED_WAIT: u64 = 120; // "Fade when paused": seconds paused before it fades
const FAINT: f32 = 0.15; // how solid it is, faded
const FAINT_SECONDS: f32 = 1.0; // the fade down (back up: the quick fade)

static CONTROLLER: Mutex<isize> = Mutex::new(0); // the running thread's hidden window (0: none)
static STARTS: AtomicU64 = AtomicU64::new(0); // an older thread that comes up late closes itself
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

// A new song, cover, volume or settings, the mouse over it: draw or place again
pub fn refresh() {
  let controller = *lock(&CONTROLLER);
  if controller != 0 {
    unsafe { PostMessageW(controller as HWND, WM_REFRESH, 0, 0) };
  }
}

// The widget's width (DIPs): ⏮ ⏭'s room (`side`) is kept at both ends, or 0 when they're off
fn width(side: f32) -> f32 {
  PAD + side + COVER + GAP + TEXT_WIDTH + side + PAD
}

// The parts of the widget the mouse can be over
#[derive(Clone, Copy, PartialEq)]
enum Part {
  Previous,
  Cover,
  Text,
  Next,
  Line, // the progress line's bottom edge
}

// What's under `x`, `y` (widget pixels) at this scale: ⏮ and ⏭ take the ends (with the padding),
// the cover reaches halfway to the text; the bottom padding under the text is the progress line's
// when `line` (Spotify takes jumps)
fn part_at(x: i32, y: i32, scale: f32, side: f32, line: bool) -> Option<Part> {
  let (x, y) = (x as f32 / scale, y as f32 / scale);
  let text_left = PAD + side + COVER + GAP;
  if x < 0.0 || x >= width(side) {
    None
  } else if line && y >= HEIGHT - PAD && x >= text_left && x < text_left + TEXT_WIDTH {
    Some(Part::Line)
  } else if side > 0.0 && x < PAD + side {
    Some(Part::Previous)
  } else if x < PAD + side + COVER + GAP / 2.0 {
    Some(Part::Cover)
  } else if side > 0.0 && x >= PAD + side + COVER + GAP + TEXT_WIDTH {
    Some(Part::Next)
  } else {
    Some(Part::Text)
  }
}

// The cover and the text both play/pause: either one under the mouse shows ⏯ on the cover
fn toggles(part: Option<Part>) -> bool {
  matches!(part, Some(Part::Cover | Part::Text))
}

// The text's left edge, in widget pixels (on a whole pixel, as drawn); the progress line starts there
fn text_left(scale: f32, side: f32) -> f32 {
  ((PAD + side + COVER + GAP) * scale - 0.5).ceil()
}

// The progress line's length, in widget pixels
fn line_room(scale: f32) -> f32 {
  (TEXT_WIDTH * scale).round().max(1.0)
}

// The place in the song (seconds) under `x` (widget pixels) on the progress line
fn line_seconds(x: i32, length: f64) -> f64 {
  let (scale, side) = SHAPE.get();
  let done = ((x as f32 - text_left(scale, side)) / line_room(scale)).clamp(0.0, 1.0);
  done as f64 * length
}

// What's drawn: drawn again only when one of these changes
#[derive(Clone)]
struct Look {
  scale: f32,
  side: f32,
  title: String,
  artist: String, // or the volume, while the wheel turns
  album: String, // or where the song is, the mouse on the progress line
  playing: bool,
  bar: Option<Bar>, // None: no length known
  cover: Option<Arc<Cover>>, // held here, so a new cover can't reuse the old one's place and look the same
  background: u32,
  tint: u32, // the cover's tint as drawn now (mid-fade too); BG: none
  part: Option<Part>, // under the mouse (⏮ ⏭ get a box)
  open: u8,           // ⏮ ⏭ faded in, 0 to 255
  veil: u8,           // the cover's veil and ⏯, 0 to 255
  slid: [Slid; 3],    // title, artist, album: None = cut with "…", else scrolling (on whole pixels)
  alpha: u8,          // the whole widget's strength (faded when paused), 255: solid
}

impl PartialEq for Look {
  fn eq(&self, other: &Look) -> bool {
    let same_cover = match (&self.cover, &other.cover) {
      (Some(a), Some(b)) => Arc::ptr_eq(a, b),
      (None, None) => true,
      _ => false,
    };
    same_cover
      && self.slid == other.slid
      && self.bar == other.bar
      && (self.scale, self.side, &self.title, &self.artist, &self.album, self.playing, self.background, self.tint, self.part, self.open, self.veil, self.alpha)
        == (
          other.scale,
          other.side,
          &other.title,
          &other.artist,
          &other.album,
          other.playing,
          other.background,
          other.tint,
          other.part,
          other.open,
          other.veil,
          other.alpha,
        )
  }
}

// This thread's own state (only the widget thread touches it)
struct Local {
  controller: HWND,
  widget: HWND,
  parent: HWND,
  tooltip: Option<Tooltip>,
  // The song it was made for (title, artist, album), its words ("": none) and the lines' widths
  // (DIPs)
  tip: Option<(String, String, [f32; 3])>,
  painter: Option<Painter>,
  drawn: Option<Look>,
  open: f32, // ⏮ ⏭ coming in: 0 (gone) to 1 (there)
  veil: f32, // the cover's veil and ⏯, 0 to 1
  scroll: Scroll,
  // The tint fading from one color to the next (BG: none): how far, 0 to 1
  tint_from: u32,
  tint_to: u32,
  tint_done: f32,
  last_frame: Option<Instant>,
  moving: bool, // the frame timer runs
  // "Fade when paused": paused since when (None: playing, or not shown), how faded (0 to 1) and
  // where it's going
  paused_since: Option<Instant>,
  faint: f32,
  faint_wanted: bool,
}

// A press on the widget: where the mouse and the widget were (screen pixels), and on which part
#[derive(Clone, Copy)]
struct Press {
  mouse: POINT,
  place: (i32, i32),
  part: Option<Part>,
}

thread_local! {
  static LOCAL: RefCell<Local> = const {
    RefCell::new(Local {
      controller: null_mut(),
      widget: null_mut(),
      parent: null_mut(),
      tooltip: None,
      tip: None,
      painter: None,
      drawn: None,
      open: 0.0,
      veil: 0.0,
      scroll: Scroll::new(),
      tint_from: BG,
      tint_to: BG,
      tint_done: 1.0,
      last_frame: None,
      moving: false,
      paused_since: None,
      faint: 0.0,
      faint_wanted: false,
    })
  };
  // Apart from LOCAL: the widget's own messages change or read them, also while LOCAL is busy
  static PRESS: Cell<Option<Press>> = const { Cell::new(None) };
  static DRAGGING: Cell<bool> = const { Cell::new(false) };
  static HOVER: Cell<bool> = const { Cell::new(false) };
  // Waiting in the main monitor's corner while the saved place's monitor is gone (place_now)
  static AWAY: Cell<bool> = const { Cell::new(false) };
  // A full-screen app in front on its monitor (checked each second): stepped aside
  static FULL_SCREEN: Cell<bool> = const { Cell::new(false) };
  static SHAPE: Cell<(f32, f32)> = const { Cell::new((1.0, 0.0)) }; // the drawn scale and side, for the clicks
  static LINE_ON: Cell<bool> = const { Cell::new(false) }; // the progress line takes clicks (Spotify takes jumps)
  static SEEKING: Cell<Option<f64>> = const { Cell::new(None) }; // dragging on the line: where it would land (seconds)
  // The volume shows in the artist's place; the part of a notch turned so far (fine-turning mice)
  static VOLUME_SHOWN: Cell<bool> = const { Cell::new(false) };
  static WHEEL_REST: Cell<i32> = const { Cell::new(0) };
}

fn run(start: u64) {
  unsafe {
    let instance = GetModuleHandleW(null());
    let controls = INITCOMMONCONTROLSEX { dwSize: size_of::<INITCOMMONCONTROLSEX>() as u32, dwICC: ICC_WIN95_CLASSES };
    InitCommonControlsEx(&controls); // the tooltip
    let controller_class = wide(CONTROLLER_CLASS);
    register(instance, &controller_class, Some(controller_proc));
    register(instance, &wide(WIDGET_CLASS), Some(widget_proc));
    // Hidden and never shown: a top-level window, so it hears monitors change
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
    SetTimer(controller, CHECK_TIMER, 1000, None);
    show(true);
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
    WM_TIMER | WM_REFRESH => {
      let tick = message == WM_TIMER && wparam == CHECK_TIMER;
      if tick {
        let widget = LOCAL.with(|local| local.try_borrow().map(|local| local.widget).unwrap_or(null_mut()));
        widget_menu::away(Owner::SpotifyWidget, widget);
      }
      if message == WM_TIMER && wparam == VOLUME_TIMER {
        unsafe { KillTimer(window, VOLUME_TIMER) };
        VOLUME_SHOWN.set(false);
      }
      show(tick);
      0
    }
    // A monitor came or went: away from it, or back to it, at once (place_now; else the next second)
    WM_DISPLAYCHANGE => {
      show(true);
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

fn mouse() -> POINT {
  let mut point = POINT { x: 0, y: 0 };
  unsafe { GetCursorPos(&mut point) };
  point
}

// Where the mouse is, from a mouse message (widget pixels)
fn point_from(lparam: LPARAM) -> (i32, i32) {
  ((lparam & 0xFFFF) as u16 as i16 as i32, ((lparam >> 16) & 0xFFFF) as u16 as i16 as i32)
}

// The part under the mouse, from a mouse message
fn part_from(lparam: LPARAM) -> Option<Part> {
  let (x, y) = point_from(lparam);
  let (scale, side) = SHAPE.get();
  part_at(x, y, scale, side, LINE_ON.get())
}

unsafe extern "system" fn widget_proc(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
  match message {
    // A click never takes the focus from the app in front
    WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
    // The mouse over it: buttons in, its right-click menu ready (widget_menu::prepare), and hear
    // when it leaves. Pressed and moved past Windows' drag distance: dragged (Windows' own moving
    // would take every click as a drag); locked, it stays put, but that press is no click any more
    WM_MOUSEMOVE => {
      if !HOVER.get() {
        HOVER.set(true);
        let mut track =
          TRACKMOUSEEVENT { cbSize: size_of::<TRACKMOUSEEVENT>() as u32, dwFlags: TME_LEAVE, hwndTrack: window, dwHoverTime: 0 };
        unsafe { TrackMouseEvent(&mut track) };
      }
      widget_menu::prepare(Owner::SpotifyWidget, window);
      if SEEKING.get().is_some() {
        if let Some(timeline) = timeline() {
          SEEKING.set(Some(line_seconds(point_from(lparam).0, timeline.length())));
        }
      } else if let Some(press) = PRESS.get() {
        let now = mouse();
        let (dx, dy) = (now.x - press.mouse.x, now.y - press.mouse.y);
        let far = dx.abs() >= unsafe { GetSystemMetrics(SM_CXDRAG) } || dy.abs() >= unsafe { GetSystemMetrics(SM_CYDRAG) };
        if DRAGGING.get() || far {
          DRAGGING.set(true);
          if !widget_locked() {
            let corner = to_parent(unsafe { GetParent(window) }, (press.place.0 + dx, press.place.1 + dy));
            unsafe { SetWindowPos(window, null_mut(), corner.x, corner.y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE) };
          }
        }
      }
      refresh();
      0
    }
    WM_MOUSELEAVE => {
      HOVER.set(false);
      refresh();
      0
    }
    // On the progress line: a jump, never a drag
    WM_LBUTTONDOWN => {
      if part_from(lparam) == Some(Part::Line) {
        if let Some(timeline) = timeline() {
          SEEKING.set(Some(line_seconds(point_from(lparam).0, timeline.length())));
          unsafe { SetCapture(window) };
          refresh();
        }
      } else if let Some(place) = window_place(window) {
        PRESS.set(Some(Press { mouse: mouse(), place, part: part_from(lparam) }));
        unsafe { SetCapture(window) };
      }
      0
    }
    // Let go: after a drag, the new place is kept; without one, a click on the part it was pressed on
    WM_LBUTTONUP => {
      if let Some(at) = SEEKING.take() {
        unsafe { ReleaseCapture() };
        seek(at);
        return 0;
      }
      let press = PRESS.take();
      let dragged = DRAGGING.replace(false);
      unsafe { ReleaseCapture() };
      if dragged {
        moved(window);
      } else if let Some(part) = press.and_then(|press| press.part).filter(|&part| Some(part) == part_from(lparam)) {
        ask(match part {
          Part::Previous => Ask::Previous,
          Part::Cover | Part::Text => Ask::Toggle,
          Part::Next => Ask::Next,
          Part::Line => return 0,
        });
      }
      0
    }
    // The mouse taken away mid-press (another window took it): a drag ends where it is, a jump
    // doesn't happen
    WM_CAPTURECHANGED => {
      if SEEKING.take().is_some() {
        refresh();
      }
      if PRESS.take().is_some() && DRAGGING.replace(false) {
        moved(window);
      }
      0
    }
    // Right-click: its menu, where the mouse is
    WM_RBUTTONUP => {
      widget_menu::open(Owner::SpotifyWidget, window);
      0
    }
    WM_RBUTTONDOWN | WM_CONTEXTMENU => 0,
    // Ctrl + wheel: one size up or down per notch (the page picks it and saves it; not when
    // locked). The wheel alone: 2 % of Spotify's volume per notch (the reading thread changes it,
    // then the widget is drawn again). Never passed on: Ctrl + wheel on the desktop would resize
    // its icons.
    WM_MOUSEWHEEL => {
      let notches = WHEEL_REST.with(|rest| wheel_notches(rest, wparam));
      if (wparam & MK_CONTROL as usize) != 0 {
        if notches != 0 && !widget_locked() {
          if let Some(app) = lock(&APP).clone() {
            let _ = app.emit_to("main", "spotify-widget-zoom", notches.signum());
          }
        }
        return 0;
      }
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

// Left after a drag (pushed back inside a monitor if its corner is on none): kept, the page saves
// it; another monitor may need another scale
fn moved(window: HWND) {
  let Some(place) = keep_inside(window) else { return };
  AWAY.set(false);
  widget_moved(place);
  if let Some(app) = lock(&APP).clone() {
    let _ = app.emit_to("main", "spotify-widget-moved", place);
  }
  refresh();
}

// `tick`: the second's check (not a fade's frame or the mouse moving)
fn show(tick: bool) {
  // Being dragged: drawn again once let go (another monitor's scale)
  if DRAGGING.get() {
    return;
  }
  LOCAL.with(|local| {
    // Busy already (Windows can call in while the widget is being placed): the next second does it
    let Ok(mut local) = local.try_borrow_mut() else { return };
    let now = widget_shown();
    let steps_aside = |now: &WidgetShown| now.on_top && now.hide_full_screen;
    if tick {
      let here = if local.widget.is_null() { None } else { window_place(local.widget) };
      let first = || work_area(main_monitor()).map_or((0, 0), |work| (work.left, work.top));
      FULL_SCREEN.set(now.as_ref().is_some_and(|now| steps_aside(now) && full_screen_near(here, now.place, first)));
    }
    let shown = now.filter(|now| !(steps_aside(now) && FULL_SCREEN.get())).is_some_and(|now| draw_and_place(&mut local, now, tick));
    if !shown {
      hide(&mut local);
    }
    // The fades go on while something isn't where it's going
    let veiled = local.drawn.as_ref().is_some_and(|drawn| toggles(drawn.part));
    let buttons = local.drawn.as_ref().is_some_and(|drawn| drawn.side > 0.0);
    let fading = local.open != target(HOVER.get() && buttons) || local.veil != target(veiled) || local.tint_done < 1.0
      || local.faint != target(local.faint_wanted);
    let moving = local.drawn.is_some() && (fading || local.scroll.moving());
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

fn hide(local: &mut Local) {
  let widget = std::mem::replace(&mut local.widget, null_mut());
  if !widget.is_null() {
    widget_menu::away(Owner::SpotifyWidget, null_mut()); // a waiting menu goes with it
  }
  local.tooltip = None;
  local.parent = null_mut();
  local.drawn = None;
  local.open = 0.0;
  local.veil = 0.0;
  local.paused_since = None;
  local.faint = 0.0;
  local.faint_wanted = false;
  local.scroll.reset();
  PRESS.set(None);
  SEEKING.set(None);
  DRAGGING.set(false);
  HOVER.set(false);
  VOLUME_SHOWN.set(false);
  WHEEL_REST.set(0);
  unsafe {
    if !widget.is_null() && IsWindow(widget) != 0 {
      DestroyWindow(widget);
    }
  }
}

// The picture's size in pixels at this scale (Windows' scaling × the widget's size)
fn pixels(scale: f32, side: f32) -> (i32, i32) {
  let whole = |dips: f32| (dips * scale - 0.001).ceil() as i32;
  (whole(width(side)), whole(HEIGHT))
}

// The first place, and where it goes when its monitor is gone: the main monitor's bottom right,
// inside its work area (just above the taskbar), MARGIN in from the edges
fn corner(monitor: HMONITOR, (width, height): (i32, i32)) -> (i32, i32) {
  let Some(work) = work_area(monitor) else { return (0, 0) };
  let margin = margin(monitor);
  (work.right - margin - width, work.bottom - margin - height)
}

fn size_scale(size: u32) -> f32 {
  size.clamp(50, 200) as f32 / 100.0
}

fn side_for(buttons: bool) -> f32 {
  if buttons { SIDE } else { 0.0 }
}

// false: it couldn't be drawn or put on the desktop
fn draw_and_place(local: &mut Local, now: WidgetShown, tick: bool) -> bool {
  // "Always on top": a window of its own (no parent); else inside the desktop
  let parent = if now.on_top { null_mut() } else { desktop() };
  if parent.is_null() && !now.on_top {
    return false;
  }
  unsafe {
    // Gone with an Explorer restart, inside an old desktop, or "on top" just switched: a new one
    if !local.widget.is_null() && (IsWindow(local.widget) == 0 || GetParent(local.widget) != parent) {
      hide(local);
    }
  }
  let side = side_for(now.buttons);
  // Where it goes (screen pixels): where it is, the saved place, or the main monitor's corner while
  // the saved place's monitor is gone (place_now)
  let here = if local.widget.is_null() { None } else { window_place(local.widget) };
  let placed = place_now(here, now.place, AWAY.get(), || {
    let monitor = main_monitor();
    corner(monitor, pixels(monitor_dpi(monitor) as f32 / 96.0 * size_scale(now.size), side))
  });
  let place = placed.at;
  let scale = dpi_at(place.0, place.1) as f32 / 96.0 * size_scale(now.size);
  if local.painter.is_none() {
    local.painter = Painter::new();
  }
  let Some(painter) = local.painter.as_ref() else { return false };
  let (width, height) = pixels(scale, side);

  // How far the fades are: a frame's time since the last one (at most 2 frames' worth, so a fade
  // starting after a quiet while doesn't jump)
  let frame = Instant::now();
  let seconds = local.last_frame.map_or(FRAME_MS as f32 / 1000.0, |last| frame.duration_since(last).as_secs_f32()).min(0.033);
  local.last_frame = Some(frame);
  let hover = HOVER.get() && !local.widget.is_null();
  local.open = fade(local.open, target(hover && side > 0.0), seconds, now.animations);
  // Faint after a while paused: slowly down, quickly back
  local.paused_since = if now.playing { None } else { Some(local.paused_since.unwrap_or(frame)) };
  let waited = local.paused_since.is_some_and(|since| frame.duration_since(since).as_secs() >= PAUSED_WAIT);
  local.faint_wanted = now.fade_paused && waited && !hover && SEEKING.get().is_none() && !widget_menu::is_open();
  local.faint = if local.faint_wanted && now.animations {
    (local.faint + seconds / FAINT_SECONDS).min(1.0)
  } else {
    fade(local.faint, target(local.faint_wanted), seconds, now.animations)
  };
  // The part under the mouse, where the widget is now
  let timeline = timeline();
  LINE_ON.set(timeline.is_some_and(|timeline| timeline.seekable()));
  let pointer = if hover {
    let mouse = mouse();
    Some((mouse.x - place.0, mouse.y - place.1)).filter(|(_, y)| (0..height).contains(y))
  } else {
    None
  };
  let part = pointer.and_then(|(x, y)| part_at(x, y, scale, side, LINE_ON.get()));
  // The progress line: where the song is (or would land, dragging), in pixels
  let seeking = SEEKING.get();
  let on_line = part == Some(Part::Line) || seeking.is_some();
  let room = line_room(scale);
  let bar = timeline.map(|timeline| {
    let at = seeking.unwrap_or_else(|| timeline.now());
    let ghost = pointer.filter(|_| part == Some(Part::Line) && seeking.is_none());
    Bar {
      played: (at / timeline.length() * room as f64).round() as i32,
      ghost: ghost.map(|(x, _)| (x as f32 - text_left(scale, side)).clamp(0.0, room) as i32),
      thick: hover || seeking.is_some(),
      knob: on_line,
    }
  });
  let time = timeline.filter(|_| on_line).map(|timeline| clock(seeking.unwrap_or_else(|| timeline.now()), timeline.length()));
  local.veil = fade(local.veil, target(toggles(part)), seconds, now.animations);
  // A new tint fades in from the one shown now; none shown yet (just appeared): at once
  let tint = now.tint.unwrap_or(BG);
  if tint != local.tint_to {
    local.tint_from = local.drawn.as_ref().map_or(tint, |drawn| drawn.tint);
    local.tint_to = tint;
    local.tint_done = 0.0;
  }
  local.tint_done = if now.animations && local.drawn.is_some() { (local.tint_done + seconds / TINT_SECONDS).min(1.0) } else { 1.0 };
  let tint = mix(local.tint_from, local.tint_to, ease(local.tint_done));

  // The tooltip: the full title, artist and album, only when one of them is cut (made again only
  // for a new song, with the lines' widths; "": Windows shows none)
  let song = format!("{}\n{}\n{}", now.title, now.artist, now.album);
  if local.tip.as_ref().is_none_or(|(made_for, ..)| *made_for != song) {
    let lines = [(&now.title, &painter.title_whole), (&now.artist, &painter.line_whole), (&now.album, &painter.line_whole)];
    let widths = lines.map(|(text, format)| painter.width(text, format));
    let cut = widths.iter().any(|&width| width > TEXT_WIDTH);
    let words = if cut { lines.iter().map(|(text, _)| text.as_str()).filter(|text| !text.is_empty()).collect::<Vec<_>>().join("\n") } else { String::new() };
    local.tip = Some((song.clone(), words, widths));
  }

  // The volume in the artist's place while the wheel turns
  let volume = now.volume.filter(|_| VOLUME_SHOWN.get()).map(volume_line);
  // Long lines scroll (the volume never does), on whole pixels
  let widths = local.tip.as_ref().map_or([0.0; 3], |(.., widths)| *widths);
  let mut past = widths.map(|width| (width - TEXT_WIDTH).max(0.0));
  if volume.is_some() {
    past[1] = 0.0;
  }
  if time.is_some() {
    past[2] = 0.0;
  }
  let allowed = now.scroll && now.animations && now.playing;
  let snap = |dips: f32| (dips * scale).round() / scale;
  let slid = local.scroll.step(&song, past, hover, allowed, seconds).map(|slid| slid.map(|(offset, past)| (snap(offset), past)));
  let look = Look {
    scale,
    side,
    title: now.title,
    artist: volume.unwrap_or(now.artist),
    album: time.unwrap_or(now.album),
    playing: now.playing,
    bar,
    cover: now.cover,
    background: now.background,
    tint,
    part,
    open: to_byte(ease(local.open)),
    veil: to_byte(ease(local.veil)),
    slid,
    alpha: to_byte(1.0 - (1.0 - FAINT) * ease(local.faint)),
  };
  let picture = if local.drawn.as_ref() == Some(&look) {
    None
  } else {
    let Some(picture) = painter.draw(&look) else { return false };
    Some(picture)
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
      local.tooltip = Tooltip::new(local.controller, widget);
    }
    // A new size (scale, or ⏮ ⏭'s room) comes with the picture: its top left stays
    if let Some(picture) = &picture {
      let size = SIZE { cx: width, cy: height };
      let source = POINT { x: 0, y: 0 };
      let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: look.alpha, AlphaFormat: AC_SRC_ALPHA as u8 };
      if UpdateLayeredWindow(local.widget, null_mut(), null(), &size, picture.dc, &source, 0, &blend, ULW_ALPHA) == 0 {
        return false;
      }
    }
    // Above the desktop's icons; placed only when new, or moved away from or back to a monitor
    if local.drawn.is_none() || placed.moved {
      SetWindowPos(local.widget, HWND_TOP, corner.x, corner.y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
    AWAY.set(placed.away);
    // On top: Windows keeps all "on top" windows in one layer, where the latest shown wins, so it
    // goes back to the top of that layer every second. Not while its menu is open over it.
    if parent.is_null() && tick && !widget_menu::is_open() {
      SetWindowPos(local.widget, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
  }
  if let (Some(tooltip), Some((_, words, _))) = (local.tooltip.as_mut(), local.tip.as_ref()) {
    tooltip.update(words, false);
  }
  SHAPE.set((scale, side));
  local.drawn = Some(look);
  true
}

fn wide(text: &str) -> Vec<u16> {
  text.encode_utf16().chain(std::iter::once(0)).collect()
}

// Direct2D and DirectWrite, made once per widget thread
struct Painter {
  d2d: ID2D1Factory,
  write: IDWriteFactory,
  title: IDWriteTextFormat,
  line: IDWriteTextFormat, // the artist and the album
  title_whole: IDWriteTextFormat, // the same, never cut (measured, or scrolling)
  line_whole: IDWriteTextFormat,
  icon: IDWriteTextFormat, // ⏮ ⏭, centered in their room
  play: IDWriteTextFormat, // ⏯, centered on the cover
}

impl Painter {
  fn new() -> Option<Painter> {
    unsafe {
      let d2d: ID2D1Factory = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None).ok()?;
      let write: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED).ok()?;
      let locale = wide("en-us");
      let format = |family: &str, weight: DWRITE_FONT_WEIGHT, size: f32| -> Option<IDWriteTextFormat> {
        let family = wide(family);
        write
          .CreateTextFormat(
            windows::core::PCWSTR(family.as_ptr()),
            None,
            weight,
            DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL,
            size,
            windows::core::PCWSTR(locale.as_ptr()),
          )
          .ok()
      };
      // One line, whole, or cut with "…" at its width
      let whole_line = |weight: DWRITE_FONT_WEIGHT, size: f32| -> Option<IDWriteTextFormat> {
        let format = format(FONT, weight, size)?;
        format.SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP).ok()?;
        Some(format)
      };
      let cut_line = |weight: DWRITE_FONT_WEIGHT, size: f32| -> Option<IDWriteTextFormat> {
        let format = whole_line(weight, size)?;
        let sign = write.CreateEllipsisTrimmingSign(&format).ok()?;
        let trimming = DWRITE_TRIMMING { granularity: DWRITE_TRIMMING_GRANULARITY_CHARACTER, delimiter: 0, delimiterCount: 0 };
        format.SetTrimming(&trimming, &sign).ok()?;
        Some(format)
      };
      // An icon in the middle of its box, from Windows 11's icon font, else Windows 10's
      let family = icon_family(&write);
      let centered = |size: f32| -> Option<IDWriteTextFormat> {
        let format = format(family, DWRITE_FONT_WEIGHT_NORMAL, size)?;
        format.SetTextAlignment(DWRITE_TEXT_ALIGNMENT_CENTER).ok()?;
        format.SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_CENTER).ok()?;
        Some(format)
      };
      let title = cut_line(DWRITE_FONT_WEIGHT_SEMI_BOLD, TITLE_SIZE)?;
      let line = cut_line(DWRITE_FONT_WEIGHT_NORMAL, LINE_SIZE)?;
      let title_whole = whole_line(DWRITE_FONT_WEIGHT_SEMI_BOLD, TITLE_SIZE)?;
      let line_whole = whole_line(DWRITE_FONT_WEIGHT_NORMAL, LINE_SIZE)?;
      let icon = centered(ICON_SIZE)?;
      let play = centered(PLAY_SIZE)?;
      Some(Painter { d2d, write, title, line, title_whole, line_whole, icon, play })
    }
  }

  // A line laid out `width` wide, and where its baseline sits from its top (DIPs)
  fn text(&self, text: &str, format: &IDWriteTextFormat, width: f32) -> Option<(IDWriteTextLayout, f32)> {
    let text: Vec<u16> = text.encode_utf16().collect();
    unsafe {
      let layout = self.write.CreateTextLayout(&text, format, width, LINE).ok()?;
      let mut lines = [DWRITE_LINE_METRICS::default(); 1];
      let mut count = 0;
      // One line (no wrapping): the first line's metrics are enough
      let _ = layout.GetLineMetrics(Some(&mut lines), &mut count);
      Some((layout, lines[0].baseline))
    }
  }

  // A line's whole width (DIPs; 0 when empty or not measured). Past TEXT_WIDTH it's drawn cut with
  // "…", or scrolls.
  fn width(&self, text: &str, format: &IDWriteTextFormat) -> f32 {
    if text.is_empty() {
      return 0.0;
    }
    let text: Vec<u16> = text.encode_utf16().collect();
    unsafe {
      let Ok(layout) = self.write.CreateTextLayout(&text, format, WHOLE, LINE) else { return 0.0 };
      let mut metrics = DWRITE_TEXT_METRICS::default();
      if layout.GetMetrics(&mut metrics).is_ok() { metrics.width } else { 0.0 }
    }
  }

  // An icon centered in a box (DIPs)
  fn icon(&self, icon: &str, format: &IDWriteTextFormat, area: D2D_RECT_F) -> Option<IDWriteTextLayout> {
    let text: Vec<u16> = icon.encode_utf16().collect();
    unsafe { self.write.CreateTextLayout(&text, format, area.right - area.left, area.bottom - area.top).ok() }
  }

  // [8][⏮ 26][cover 56][10][title / artist / album, 170][⏭ 26][8] × [8][56][8] at 100% (no ⏮ ⏭'s
  // room when they're off), as a see-through picture. None if Windows' drawing failed.
  fn draw(&self, look: &Look) -> Option<Canvas> {
    let scale = look.scale;
    let snap = |dips: f32| (dips * scale).round() / scale;
    // A line's top (DIPs) plus an offset in pixels → DIPs, on a whole pixel (as the Hardware widget)
    let at = |top: f32, offset: f32| ((top * scale + 0.001).floor() + offset) / scale;
    let strength = if look.playing { 1.0 } else { PAUSED };
    let open = look.open as f32 / 255.0;
    let veil = look.veil as f32 / 255.0;
    let side = look.side;
    // The lines there are (no artist or album: fewer), centered on the cover together
    // Each: its words, its format cut with "…" and whole, size, color, and how far it slid
    type Line<'a> = (&'a str, &'a IDWriteTextFormat, &'a IDWriteTextFormat, f32, u32, Slid);
    let lines: Vec<Line> = [
      (look.title.as_str(), &self.title, &self.title_whole, TITLE_SIZE, TEXT, look.slid[0]),
      (look.artist.as_str(), &self.line, &self.line_whole, LINE_SIZE, DIM, look.slid[1]),
      (look.album.as_str(), &self.line, &self.line_whole, LINE_SIZE, DIM, look.slid[2]),
    ]
    .into_iter()
    .filter(|(text, ..)| !text.is_empty())
    .collect();
    let text_top = PAD + (COVER - lines.len() as f32 * LINE) / 2.0;

    let (pixels_wide, pixels_high) = pixels(scale, side);
    let canvas = Canvas::new(pixels_wide as usize, pixels_high as usize)?;
    let (width, height) = (pixels_wide as f32 / scale, pixels_high as f32 / scale);
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
      let area = windows::Win32::Foundation::RECT { left: 0, top: 0, right: pixels_wide, bottom: pixels_high };
      target.BindDC(windows::Win32::Graphics::Gdi::HDC(canvas.dc), &area).ok()?;
      let target: &ID2D1RenderTarget = &target;
      // Never quite 0: Windows lets clicks through fully clear pixels, and the box must stay draggable
      let bg_alpha = (look.background.min(100) as f32 / 100.0).max(1.0 / 255.0);
      let bg = target.CreateSolidColorBrush(&color(BG, bg_alpha), None).ok()?;
      // The cover's tint behind the cover, fading into the dark box (two stops, drawn as the page
      // would mix them)
      let tinted = if look.tint == BG {
        None
      } else {
        let stops = [D2D1_GRADIENT_STOP { position: 0.0, color: color(look.tint, bg_alpha) }, D2D1_GRADIENT_STOP { position: 1.0, color: color(BG, bg_alpha) }];
        let stops = target.CreateGradientStopCollection(&stops, D2D1_GAMMA_2_2, D2D1_EXTEND_MODE_CLAMP).ok()?;
        let cover_left = PAD + side;
        let line = D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES {
          startPoint: windows_numerics::Vector2 { X: cover_left + TINT_FULL, Y: 0.0 },
          endPoint: windows_numerics::Vector2 { X: cover_left + TINT_FADED, Y: 0.0 },
        };
        Some(target.CreateLinearGradientBrush(&line, None, &stops).ok()?)
      };
      target.BeginDraw();
      target.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
      target.Clear(Some(&D2D1_COLOR_F { r: 0.0, g: 0.0, b: 0.0, a: 0.0 }));
      let rounded = |rect: D2D_RECT_F, radius: f32| D2D1_ROUNDED_RECT { rect, radiusX: radius, radiusY: radius };
      let box_rect = rounded(D2D_RECT_F { left: 0.0, top: 0.0, right: width, bottom: height }, RADIUS);
      match &tinted {
        Some(tinted) => target.FillRoundedRectangle(&box_rect, tinted),
        None => target.FillRoundedRectangle(&box_rect, &bg),
      }

      // The cover, on whole pixels, one picture pixel per screen pixel
      let (left, top) = (snap(PAD + side), snap(PAD));
      let cover_side = (COVER * scale).round().max(1.0) as usize;
      let cover_rect = D2D_RECT_F { left, top, right: left + cover_side as f32 / scale, bottom: top + cover_side as f32 / scale };
      match &look.cover {
        Some(cover) => {
          let pixels: Vec<u8> =
            shrink(cover, cover_side).iter().enumerate().map(|(i, &v)| if i % 4 == 3 { (v * 255.0).round() as u8 } else { v.round() as u8 }).collect();
          let bitmap_properties = D2D1_BITMAP_PROPERTIES {
            pixelFormat: D2D1_PIXEL_FORMAT { format: DXGI_FORMAT_B8G8R8A8_UNORM, alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED },
            dpiX: 96.0 * scale,
            dpiY: 96.0 * scale,
          };
          let size = D2D_SIZE_U { width: cover_side as u32, height: cover_side as u32 };
          let bitmap = target.CreateBitmap(size, Some(pixels.as_ptr() as *const _), (cover_side * 4) as u32, &bitmap_properties).ok();
          let brush = bitmap.and_then(|bitmap| {
            let extend = D2D1_BITMAP_BRUSH_PROPERTIES {
              extendModeX: D2D1_EXTEND_MODE_CLAMP,
              extendModeY: D2D1_EXTEND_MODE_CLAMP,
              interpolationMode: D2D1_BITMAP_INTERPOLATION_MODE_NEAREST_NEIGHBOR,
            };
            let placed = D2D1_BRUSH_PROPERTIES { opacity: strength, transform: Matrix3x2::translation(left, top) };
            target.CreateBitmapBrush(&bitmap, Some(&extend), Some(&placed)).ok()
          });
          if let Some(brush) = brush {
            target.FillRoundedRectangle(&rounded(cover_rect, COVER_RADIUS), &brush);
          }
        }
        // Not read yet: a faint square in its place
        None => {
          let empty = target.CreateSolidColorBrush(&color(0xffffff, EMPTY * strength), None).ok()?;
          target.FillRoundedRectangle(&rounded(cover_rect, COVER_RADIUS), &empty);
        }
      }
      // Hovered: a dark veil and ⏯ over it (never dimmed when paused)
      if veil > 0.0 {
        let shade = target.CreateSolidColorBrush(&color(0x000000, VEIL * veil), None).ok()?;
        target.FillRoundedRectangle(&rounded(cover_rect, COVER_RADIUS), &shade);
        let icon = if look.playing { PAUSE } else { PLAY };
        if let Some(layout) = self.icon(icon, &self.play, cover_rect) {
          let ink = target.CreateSolidColorBrush(&color(TEXT, veil), None).ok()?;
          target.DrawTextLayout(windows_numerics::Vector2 { X: cover_rect.left, Y: cover_rect.top }, &layout, &ink, D2D1_DRAW_TEXT_OPTIONS_NONE);
        }
      }

      // ⏮ ⏭ in their room, sliding in from the middle as they fade in; the one under the mouse in
      // a box. Never dimmed when paused.
      let text_left = text_left(scale, side) / scale;
      if side > 0.0 && open > 0.0 {
        let slide = (SLIDE * (1.0 - open) * scale).round() / scale;
        let (box_top, box_bottom) = (snap((HEIGHT - BUTTON_HIGH) / 2.0), snap((HEIGHT + BUTTON_HIGH) / 2.0));
        let previous = D2D_RECT_F { left: snap(PAD), top: box_top, right: snap(PAD + side), bottom: box_bottom };
        let next_left = snap(PAD + side + COVER + GAP + TEXT_WIDTH);
        let next = D2D_RECT_F { left: next_left, top: box_top, right: next_left + (previous.right - previous.left), bottom: box_bottom };
        let hovered = match look.part {
          Some(Part::Previous) => Some(previous),
          Some(Part::Next) => Some(next),
          _ => None,
        };
        if let Some(button) = hovered {
          let shade = target.CreateSolidColorBrush(&color(0xffffff, BUTTON_BOX * open), None).ok()?;
          target.FillRoundedRectangle(&rounded(button, BUTTON_RADIUS), &shade);
        }
        let ink = target.CreateSolidColorBrush(&color(TEXT, open), None).ok()?;
        for (icon, area, shift) in [(PREVIOUS, previous, slide), (NEXT, next, -slide)] {
          if let Some(layout) = self.icon(icon, &self.icon, area) {
            target.DrawTextLayout(windows_numerics::Vector2 { X: area.left + shift, Y: area.top }, &layout, &ink, D2D1_DRAW_TEXT_OPTIONS_NONE);
          }
        }
      }

      // The lines, each on its baseline as the page would paint it; across, on a whole pixel too.
      // A scrolling one: whole, slid left, cut to the text's room, its ends fading where more of
      // it is hidden (over EDGE at most, less while less is hidden, so the fade comes in smoothly).
      let text_right = text_left + TEXT_WIDTH;
      for (index, (text, cut, whole, size, ink, slid)) in lines.into_iter().enumerate() {
        let line_top = text_top + index as f32 * LINE;
        let y = at(line_top, text_baseline(size, LINE, scale, false));
        let Some((offset, past)) = slid else {
          let Some((layout, baseline)) = self.text(text, cut, TEXT_WIDTH) else { continue };
          let brush = target.CreateSolidColorBrush(&color(ink, strength), None).ok()?;
          target.DrawTextLayout(windows_numerics::Vector2 { X: text_left, Y: y - baseline }, &layout, &brush, D2D1_DRAW_TEXT_OPTIONS_NONE);
          continue;
        };
        let Some((layout, baseline)) = self.text(text, whole, WHOLE) else { continue };
        let (left_fade, right_fade) = (offset.min(EDGE) / TEXT_WIDTH, (past - offset).max(0.0).min(EDGE) / TEXT_WIDTH);
        let faded = |at_end: f32| color(ink, if at_end > 0.0 { 0.0 } else { strength });
        let stops = [
          D2D1_GRADIENT_STOP { position: 0.0, color: faded(left_fade) },
          D2D1_GRADIENT_STOP { position: left_fade, color: color(ink, strength) },
          D2D1_GRADIENT_STOP { position: 1.0 - right_fade, color: color(ink, strength) },
          D2D1_GRADIENT_STOP { position: 1.0, color: faded(right_fade) },
        ];
        let stops = target.CreateGradientStopCollection(&stops, D2D1_GAMMA_2_2, D2D1_EXTEND_MODE_CLAMP).ok()?;
        let across = D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES {
          startPoint: windows_numerics::Vector2 { X: text_left, Y: 0.0 },
          endPoint: windows_numerics::Vector2 { X: text_right, Y: 0.0 },
        };
        let brush = target.CreateLinearGradientBrush(&across, None, &stops).ok()?;
        let room = D2D_RECT_F { left: text_left, top: 0.0, right: text_right, bottom: height };
        target.PushAxisAlignedClip(&room, D2D1_ANTIALIAS_MODE_ALIASED);
        target.DrawTextLayout(windows_numerics::Vector2 { X: text_left - offset, Y: y - baseline }, &layout, &brush, D2D1_DRAW_TEXT_OPTIONS_NONE);
        target.PopAxisAlignedClip();
      }

      // The progress line under the text: the rest of the song, the faint part up to the mouse, the
      // part played, and the knob where the song is
      if let Some(bar) = look.bar {
        let thick = if bar.thick { LINE_THICK } else { LINE_THIN };
        let bottom = snap(HEIGHT - LINE_BOTTOM);
        let top = bottom - snap(thick);
        let part = |pixels: f32, strength: f32| -> Option<()> {
          if pixels <= 0.0 {
            return Some(());
          }
          let rect = D2D_RECT_F { left: text_left, top, right: text_left + pixels / scale, bottom };
          let brush = target.CreateSolidColorBrush(&color(0xffffff, strength), None).ok()?;
          target.FillRoundedRectangle(&rounded(rect, (bottom - top) / 2.0), &brush);
          Some(())
        };
        part(line_room(scale), TRACK)?;
        if let Some(ghost) = bar.ghost {
          part(ghost as f32, GHOST)?;
        }
        let played = if bar.knob { 1.0 } else if look.playing { PLAYED } else { PLAYED_PAUSED };
        part(bar.played as f32, played)?;
        if bar.knob {
          let center = windows_numerics::Vector2 { X: text_left + bar.played as f32 / scale, Y: (top + bottom) / 2.0 };
          let knob = D2D1_ELLIPSE { point: center, radiusX: KNOB / 2.0, radiusY: KNOB / 2.0 };
          let brush = target.CreateSolidColorBrush(&color(0xffffff, 1.0), None).ok()?;
          target.FillEllipse(&knob, &brush);
        }
      }
      target.EndDraw(None, None).ok()?;
    }
    Some(canvas)
  }
}

// Between two colors (0xRRGGBB), `done` of the way (0 to 1)
fn mix(from: u32, to: u32, done: f32) -> u32 {
  let part = |shift: u32| {
    let (a, b) = (((from >> shift) & 0xff) as f32, ((to >> shift) & 0xff) as f32);
    ((a + (b - a) * done).round() as u32) << shift
  };
  part(16) | part(8) | part(0)
}

// The first icon font Windows has (Windows 11's, else Windows 10's)
fn icon_family(write: &IDWriteFactory) -> &'static str {
  let has = |name: &str| -> bool {
    let name = wide(name);
    let mut collection: Option<IDWriteFontCollection> = None;
    let (mut index, mut exists) = (0u32, BOOL(0));
    unsafe {
      write.GetSystemFontCollection(&mut collection, false).is_ok()
        && collection.is_some_and(|collection| {
          collection.FindFamilyName(windows::core::PCWSTR(name.as_ptr()), &mut index, &mut exists).is_ok() && exists.as_bool()
        })
    }
  };
  ICON_FONTS.iter().copied().find(|name| has(name)).unwrap_or(ICON_FONTS[0])
}
