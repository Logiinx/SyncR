// The Spotify widget (PC): what Spotify plays, in a small card (look W2, the Hardware widget's dark
// box, see-through as set): the cover, then the title (semibold) over the artist and the album
// (dimmer), each cut with "…" past 170 px. Paused: cover and text at half strength. Spotify
// closed, or shown as the strip: no widget. Drawn with Direct2D + DirectWrite like the Hardware
// widget (the same text engine as the page), into a see-through picture.
// "Always on top" (the default): a window of its own above the others; else inside the desktop (a
// child of its icon view: under every window, stays on Win+D). Press and move a few pixels to drag
// it (not when locked); press and let go without moving: play/pause. Where it's left goes back to
// the page, which saves it. First time: bottom right of the main monitor, just above the taskbar;
// a saved place on no monitor any more, or a monitor that goes: the same corner.
// Right-click: its menu (widget_menu.rs).
// Its own thread, with a hidden window that rebuilds it when Explorer restarts (which takes the
// desktop and its children along) and moves it when monitors change.
// Nothing here may panic: the app is built with panic = "abort", so a panic would close SyncR.

use super::{ask, lock, shrink, widget_locked, widget_moved, widget_shown, Ask, Cover, WidgetShown};
use crate::hardware::widget::{color, text_baseline};
use crate::mouse_battery::gdi::Canvas;
use crate::widget_menu::{self, Owner};
use crate::widget_place::{desktop, dpi_at, main_monitor, margin, monitor_dpi, on_a_monitor, to_parent, window_place, work_area};
use std::cell::{Cell, RefCell};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use windows::Win32::Graphics::Direct2D::Common::{D2D1_ALPHA_MODE_PREMULTIPLIED, D2D1_COLOR_F, D2D1_PIXEL_FORMAT, D2D_RECT_F, D2D_SIZE_U};
use windows::Win32::Graphics::Direct2D::{
  D2D1CreateFactory, ID2D1Factory, ID2D1RenderTarget, D2D1_BITMAP_BRUSH_PROPERTIES, D2D1_BITMAP_INTERPOLATION_MODE_NEAREST_NEIGHBOR,
  D2D1_BITMAP_PROPERTIES, D2D1_BRUSH_PROPERTIES, D2D1_DRAW_TEXT_OPTIONS_NONE, D2D1_EXTEND_MODE_CLAMP, D2D1_FACTORY_TYPE_SINGLE_THREADED,
  D2D1_FEATURE_LEVEL_DEFAULT, D2D1_RENDER_TARGET_PROPERTIES, D2D1_RENDER_TARGET_TYPE_SOFTWARE, D2D1_RENDER_TARGET_USAGE_NONE,
  D2D1_ROUNDED_RECT, D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE,
};
use windows::Win32::Graphics::DirectWrite::{
  DWriteCreateFactory, IDWriteFactory, IDWriteTextFormat, IDWriteTextLayout, DWRITE_FACTORY_TYPE_SHARED, DWRITE_FONT_STRETCH_NORMAL,
  DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_WEIGHT, DWRITE_FONT_WEIGHT_NORMAL, DWRITE_FONT_WEIGHT_SEMI_BOLD, DWRITE_LINE_METRICS,
  DWRITE_TRIMMING, DWRITE_TRIMMING_GRANULARITY_CHARACTER, DWRITE_WORD_WRAPPING_NO_WRAP,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows_numerics::Matrix3x2;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{AC_SRC_ALPHA, AC_SRC_OVER, BLENDFUNCTION, HMONITOR};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture};
use windows_sys::Win32::UI::WindowsAndMessaging::{
  CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos, GetMessageW, GetParent, GetSystemMetrics, IsWindow,
  LoadCursorW, PostMessageW, PostQuitMessage, RegisterClassExW, SetTimer, SetWindowPos, TranslateMessage, UpdateLayeredWindow,
  HWND_TOP, HWND_TOPMOST, IDC_ARROW, MA_NOACTIVATE, MSG, SM_CXDRAG, SM_CYDRAG, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
  SWP_NOZORDER, SWP_SHOWWINDOW, ULW_ALPHA, WM_APP, WM_CAPTURECHANGED, WM_CLOSE, WM_CONTEXTMENU, WM_DESTROY, WM_DISPLAYCHANGE,
  WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEACTIVATE, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_TIMER, WNDCLASSEXW,
  WNDPROC, WS_CHILD, WS_CLIPSIBLINGS, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_NOPARENTNOTIFY, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

const WM_REFRESH: u32 = WM_APP + 1;
const CHECK_TIMER: usize = 1;
const CONTROLLER_CLASS: &str = "SyncRSpotifyWidgetControl";
const WIDGET_CLASS: &str = "SyncRSpotifyWidget";

// Look W2 (.claude/mockups/spotify-strip.html), in CSS pixels (DIPs), with the Hardware widget's
// dark colors (index.css: --bg, --text, --text-dim)
const FONT: &str = "Segoe UI";
const PAD: f32 = 8.0;
const COVER: f32 = 56.0;
const COVER_RADIUS: f32 = 4.0;
const GAP: f32 = 10.0; // between the cover and the text
const TEXT_WIDTH: f32 = 170.0; // cut with "…" past it
const LINE: f32 = 18.0;
const TITLE_SIZE: f32 = 13.0;
const LINE_SIZE: f32 = 12.0; // the artist and the album
const RADIUS: f32 = 8.0;
const WIDTH: f32 = PAD + COVER + GAP + TEXT_WIDTH + PAD;
const HEIGHT: f32 = PAD + COVER + PAD;
const BG: u32 = 0x161616;
const TEXT: u32 = 0xe4e4e4;
const DIM: u32 = 0x808080;
const PAUSED: f32 = 0.5; // cover and text, paused
const EMPTY: f32 = 0.12; // no cover yet: a faint white square

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

// A new song, cover or settings: draw or place again
pub fn refresh() {
  let controller = *lock(&CONTROLLER);
  if controller != 0 {
    unsafe { PostMessageW(controller as HWND, WM_REFRESH, 0, 0) };
  }
}

// What's drawn: drawn again only when one of these changes
#[derive(Clone)]
struct Look {
  scale: f32,
  title: String,
  artist: String,
  album: String,
  playing: bool,
  cover: Option<Arc<Cover>>, // held here, so a new cover can't reuse the old one's place and look the same
  background: u32,
}

impl PartialEq for Look {
  fn eq(&self, other: &Look) -> bool {
    let same_cover = match (&self.cover, &other.cover) {
      (Some(a), Some(b)) => Arc::ptr_eq(a, b),
      (None, None) => true,
      _ => false,
    };
    same_cover
      && (self.scale, &self.title, &self.artist, &self.album, self.playing, self.background)
        == (other.scale, &other.title, &other.artist, &other.album, other.playing, other.background)
  }
}

// This thread's own state (only the widget thread touches it)
struct Local {
  widget: HWND,
  parent: HWND,
  painter: Option<Painter>,
  drawn: Option<Look>,
}

// A press on the widget: where the mouse and the widget were (screen pixels)
#[derive(Clone, Copy)]
struct Press {
  mouse: POINT,
  place: (i32, i32),
}

thread_local! {
  static LOCAL: RefCell<Local> = const { RefCell::new(Local { widget: null_mut(), parent: null_mut(), painter: None, drawn: None }) };
  // Apart from LOCAL: the widget's own messages change them, also while LOCAL is busy
  static PRESS: Cell<Option<Press>> = const { Cell::new(None) };
  static DRAGGING: Cell<bool> = const { Cell::new(false) };
}

fn run(start: u64) {
  unsafe {
    let instance = GetModuleHandleW(null());
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
    WM_TIMER | WM_REFRESH => {
      show();
      if message == WM_TIMER {
        let widget = LOCAL.with(|local| local.try_borrow().map(|local| local.widget).unwrap_or(null_mut()));
        widget_menu::away(Owner::SpotifyWidget, widget);
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

fn mouse() -> POINT {
  let mut point = POINT { x: 0, y: 0 };
  unsafe { GetCursorPos(&mut point) };
  point
}

unsafe extern "system" fn widget_proc(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
  match message {
    // A click never takes the focus from the app in front
    WM_MOUSEACTIVATE => MA_NOACTIVATE as LRESULT,
    // The mouse over it gets its right-click menu ready (widget_menu::prepare). Pressed and moved
    // past Windows' drag distance: dragged (Windows' own moving would take every click as a drag);
    // locked, it stays put, but that press is no click any more
    WM_MOUSEMOVE => {
      widget_menu::prepare(Owner::SpotifyWidget, window);
      if let Some(press) = PRESS.get() {
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
      0
    }
    WM_LBUTTONDOWN => {
      if let Some(place) = window_place(window) {
        PRESS.set(Some(Press { mouse: mouse(), place }));
        unsafe { SetCapture(window) };
      }
      0
    }
    // Let go: after a drag, the new place is kept; without one, a click (play/pause)
    WM_LBUTTONUP => {
      let pressed = PRESS.take().is_some();
      let dragged = DRAGGING.replace(false);
      unsafe { ReleaseCapture() };
      if dragged {
        moved(window);
      } else if pressed {
        ask(Ask::Toggle);
      }
      0
    }
    // The mouse taken away mid-press (another window took it): a drag ends where it is
    WM_CAPTURECHANGED => {
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
    // Never passed on: Ctrl + wheel on the desktop would resize its icons
    WM_MOUSEWHEEL => 0,
    _ => unsafe { DefWindowProcW(window, message, wparam, lparam) },
  }
}

// Left after a drag: kept, the page saves it; another monitor may need another scale
fn moved(window: HWND) {
  let Some(place) = window_place(window) else { return };
  widget_moved(place);
  if let Some(app) = lock(&APP).clone() {
    let _ = app.emit_to("main", "spotify-widget-moved", place);
  }
  refresh();
}

fn show() {
  // Being dragged: drawn again once let go (another monitor's scale)
  if DRAGGING.get() {
    return;
  }
  LOCAL.with(|local| {
    // Busy already (Windows can call in while the widget is being placed): the next second does it
    let Ok(mut local) = local.try_borrow_mut() else { return };
    let shown = widget_shown().is_some_and(|now| draw_and_place(&mut local, now));
    if !shown {
      hide(&mut local);
    }
  });
}

fn hide(local: &mut Local) {
  let widget = std::mem::replace(&mut local.widget, null_mut());
  if !widget.is_null() {
    widget_menu::away(Owner::SpotifyWidget, null_mut()); // a waiting menu goes with it
  }
  local.parent = null_mut();
  local.drawn = None;
  PRESS.set(None);
  DRAGGING.set(false);
  unsafe {
    if !widget.is_null() && IsWindow(widget) != 0 {
      DestroyWindow(widget);
    }
  }
}

// The picture's size in pixels at this scale (Windows' scaling × the widget's size)
fn pixels(scale: f32) -> (i32, i32) {
  let whole = |dips: f32| (dips * scale - 0.001).ceil() as i32;
  (whole(WIDTH), whole(HEIGHT))
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

// false: it couldn't be drawn or put on the desktop
fn draw_and_place(local: &mut Local, now: WidgetShown) -> bool {
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
  // Where it goes (screen pixels): where it is, else the saved place, else the main monitor's corner
  let here = if local.widget.is_null() { None } else { window_place(local.widget) };
  let (place, scale) = match here.or(now.place.filter(|&(x, y)| on_a_monitor(x, y))) {
    Some(place) => (place, dpi_at(place.0, place.1) as f32 / 96.0 * size_scale(now.size)),
    None => {
      let monitor = main_monitor();
      let scale = monitor_dpi(monitor) as f32 / 96.0 * size_scale(now.size);
      (corner(monitor, pixels(scale)), scale)
    }
  };
  if local.painter.is_none() {
    local.painter = Painter::new();
  }
  let Some(painter) = local.painter.as_ref() else { return false };
  let look = Look {
    scale,
    title: now.title,
    artist: now.artist,
    album: now.album,
    playing: now.playing,
    cover: now.cover,
    background: now.background,
  };
  let picture = if local.drawn.as_ref() == Some(&look) {
    None
  } else {
    let Some(picture) = painter.draw(&look) else { return false };
    Some(picture)
  };
  let (width, height) = pixels(scale);

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
    }
    if let Some(picture) = &picture {
      let size = SIZE { cx: width, cy: height };
      let source = POINT { x: 0, y: 0 };
      let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: 255, AlphaFormat: AC_SRC_ALPHA as u8 };
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
    if parent.is_null() && !widget_menu::is_open() {
      SetWindowPos(local.widget, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
  }
  local.drawn = Some(look);
  true
}

// Its monitor is gone: to the main monitor's bottom right (drawn again there, at its scale)
fn rescue(local: &mut Local) {
  if local.widget.is_null() {
    return;
  }
  let Some((x, y)) = window_place(local.widget) else { return };
  if on_a_monitor(x, y) {
    return;
  }
  let monitor = main_monitor();
  let size = size_scale(widget_shown().map_or(100, |now| now.size));
  let place = corner(monitor, pixels(monitor_dpi(monitor) as f32 / 96.0 * size));
  let point = to_parent(local.parent, place);
  unsafe { SetWindowPos(local.widget, HWND_TOP, point.x, point.y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE) };
  local.drawn = None;
  widget_moved(place);
  if let Some(app) = lock(&APP).clone() {
    let _ = app.emit_to("main", "spotify-widget-moved", place);
  }
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
}

impl Painter {
  fn new() -> Option<Painter> {
    unsafe {
      let d2d: ID2D1Factory = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None).ok()?;
      let write: IDWriteFactory = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED).ok()?;
      let font = wide(FONT);
      let locale = wide("en-us");
      // One line, cut with "…" at its width
      let format = |weight: DWRITE_FONT_WEIGHT, size: f32| -> Option<IDWriteTextFormat> {
        let format = write
          .CreateTextFormat(
            windows::core::PCWSTR(font.as_ptr()),
            None,
            weight,
            DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL,
            size,
            windows::core::PCWSTR(locale.as_ptr()),
          )
          .ok()?;
        format.SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP).ok()?;
        let sign = write.CreateEllipsisTrimmingSign(&format).ok()?;
        let trimming = DWRITE_TRIMMING { granularity: DWRITE_TRIMMING_GRANULARITY_CHARACTER, delimiter: 0, delimiterCount: 0 };
        format.SetTrimming(&trimming, &sign).ok()?;
        Some(format)
      };
      let title = format(DWRITE_FONT_WEIGHT_SEMI_BOLD, TITLE_SIZE)?;
      let line = format(DWRITE_FONT_WEIGHT_NORMAL, LINE_SIZE)?;
      Some(Painter { d2d, write, title, line })
    }
  }

  // A line laid out TEXT_WIDTH wide, and where its baseline sits from its top (DIPs)
  fn text(&self, text: &str, format: &IDWriteTextFormat) -> Option<(IDWriteTextLayout, f32)> {
    let text: Vec<u16> = text.encode_utf16().collect();
    unsafe {
      let layout = self.write.CreateTextLayout(&text, format, TEXT_WIDTH, LINE).ok()?;
      let mut lines = [DWRITE_LINE_METRICS::default(); 1];
      let mut count = 0;
      // One line (no wrapping): the first line's metrics are enough
      let _ = layout.GetLineMetrics(Some(&mut lines), &mut count);
      Some((layout, lines[0].baseline))
    }
  }

  // [8][cover 56][10][title / artist / album, 170][8] × [8][56][8] at 100%, as a see-through
  // picture. None if Windows' drawing failed.
  fn draw(&self, look: &Look) -> Option<Canvas> {
    let scale = look.scale;
    let snap = |dips: f32| (dips * scale).round() / scale;
    // A line's top (DIPs) plus an offset in pixels → DIPs, on a whole pixel (as the Hardware widget)
    let at = |top: f32, offset: f32| ((top * scale + 0.001).floor() + offset) / scale;
    let strength = if look.playing { 1.0 } else { PAUSED };
    // The lines there are (no artist or album: fewer), centered on the cover together
    let lines: Vec<(&str, &IDWriteTextFormat, f32, u32)> = [
      (look.title.as_str(), &self.title, TITLE_SIZE, TEXT),
      (look.artist.as_str(), &self.line, LINE_SIZE, DIM),
      (look.album.as_str(), &self.line, LINE_SIZE, DIM),
    ]
    .into_iter()
    .filter(|(text, ..)| !text.is_empty())
    .collect();
    let text_top = PAD + (COVER - lines.len() as f32 * LINE) / 2.0;

    let (pixels_wide, pixels_high) = pixels(scale);
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
      target.BeginDraw();
      target.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
      target.Clear(Some(&D2D1_COLOR_F { r: 0.0, g: 0.0, b: 0.0, a: 0.0 }));
      let rounded = |rect: D2D_RECT_F, radius: f32| D2D1_ROUNDED_RECT { rect, radiusX: radius, radiusY: radius };
      target.FillRoundedRectangle(&rounded(D2D_RECT_F { left: 0.0, top: 0.0, right: width, bottom: height }, RADIUS), &bg);

      // The cover, on whole pixels, one picture pixel per screen pixel
      let (left, top) = (snap(PAD), snap(PAD));
      let side = (COVER * scale).round().max(1.0) as usize;
      let cover_rect = D2D_RECT_F { left, top, right: left + side as f32 / scale, bottom: top + side as f32 / scale };
      match &look.cover {
        Some(cover) => {
          let pixels: Vec<u8> = shrink(cover, side).iter().enumerate().map(|(i, &v)| if i % 4 == 3 { (v * 255.0).round() as u8 } else { v.round() as u8 }).collect();
          let bitmap_properties = D2D1_BITMAP_PROPERTIES {
            pixelFormat: D2D1_PIXEL_FORMAT { format: DXGI_FORMAT_B8G8R8A8_UNORM, alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED },
            dpiX: 96.0 * scale,
            dpiY: 96.0 * scale,
          };
          let size = D2D_SIZE_U { width: side as u32, height: side as u32 };
          let bitmap = target.CreateBitmap(size, Some(pixels.as_ptr() as *const _), (side * 4) as u32, &bitmap_properties).ok();
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

      // The lines, each on its baseline as the page would paint it; across, on a whole pixel too
      let text_left = ((PAD + COVER + GAP) * scale - 0.5).ceil() / scale;
      for (index, (text, format, size, ink)) in lines.into_iter().enumerate() {
        let Some((layout, baseline)) = self.text(text, format) else { continue };
        let line_top = text_top + index as f32 * LINE;
        let y = at(line_top, text_baseline(size, LINE, scale, false));
        let brush = target.CreateSolidColorBrush(&color(ink, strength), None).ok()?;
        let origin = windows_numerics::Vector2 { X: text_left, Y: y - baseline };
        target.DrawTextLayout(origin, &layout, &brush, D2D1_DRAW_TEXT_OPTIONS_NONE);
      }
      target.EndDraw(None, None).ok()?;
    }
    Some(canvas)
  }
}
