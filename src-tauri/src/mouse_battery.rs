// Mouse battery module (PC, off unless turned on in Settings → Modules): asks the mouse's receiver
// for its battery every 60 s and shows it inside the taskbar (strip.rs).
// Only ever sends the two read questions in `hid` (online? battery?), never anything that changes
// the mouse. When the module is off, no thread runs and no device is opened.
// The protocol facts (not code) come from krisgfx9's Wireless-Device-Battery-Monitor.
// Nothing here may panic: the app is built with panic = "abort", so a panic would close SyncR.
// Two threads while on: the checks (here; a check can wait up to a second for the receiver) and
// the taskbar strip's (strip.rs; it shares Windows' input with the taskbar, so it never waits).
// The strip draws from CONFIG and STATUS, so a late signal can never draw something out of date.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

mod strip;

const CHECK_EVERY: Duration = Duration::from_secs(60);

// What the page sends (mouseBattery.ts)
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
  on: bool,
  low: u8, // at or below this percent the number turns red
}

#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
  percent: u8,
  charging: bool,
  millivolts: u16,
  at: u64, // when it was read, ms since 1970
}

// Sent to the page after each check (event "mouse-battery") and by mouse_battery_status
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
  last: Option<Reading>, // the last answer, kept while the mouse sleeps or the receiver is out
  answering: bool,       // the last check got an answer
}

// The settings while on (None: off), the last check, the strip's tooltip (made by the page, in
// its language) and the check thread's channel (a message = check now; dropping it ends the thread)
static CONFIG: Mutex<Option<Config>> = Mutex::new(None);
static STATUS: Mutex<Status> = Mutex::new(Status { last: None, answering: false });
static TIP: Mutex<String> = Mutex::new(String::new());
static WORKER: Mutex<Option<Sender<()>>> = Mutex::new(None);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
  mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn config() -> Option<Config> {
  lock(&CONFIG).clone()
}

fn status() -> Status {
  lock(&STATUS).clone()
}

// What the strip shows: the percent (or a dash before any answer), whether it's at or below the
// low level, charging, and no answer to the last check (dimmed)
struct Shown {
  text: String,
  low: bool,
  charging: bool,
  dim: bool,
}

fn shown() -> Shown {
  let (status, low) = (status(), config().map_or(0, |config| config.low));
  let dim = !status.answering;
  match status.last {
    Some(reading) => Shown { text: format!("{}%", reading.percent), low: reading.percent <= low, charging: reading.charging, dim },
    None => Shown { text: "–".to_string(), low: false, charging: false, dim },
  }
}

fn tip() -> String {
  lock(&TIP).clone()
}

// The receiver was plugged in or the PC woke up (strip.rs): ask now
fn check_now() {
  if let Some(sender) = lock(&WORKER).as_ref() {
    let _ = sender.send(());
  }
}

// Called at start and on every settings change
#[tauri::command]
pub fn mouse_battery_config(app: AppHandle, config: Config) {
  let mut worker = lock(&WORKER);
  if !config.on {
    *lock(&CONFIG) = None;
    if worker.take().is_some() {
      strip::stop();
    }
    return;
  }
  *lock(&CONFIG) = Some(config);
  if worker.is_some() {
    strip::refresh();
    return;
  }
  let (sender, receiver) = mpsc::channel();
  strip::start(app.clone());
  std::thread::spawn(move || run(app, receiver));
  *worker = Some(sender);
}

#[tauri::command]
pub fn mouse_battery_status() -> Status {
  status()
}

// The strip's tooltip, sent by the page after each check and when the language changes
#[tauri::command]
pub fn mouse_battery_tip(text: String) {
  *lock(&TIP) = text;
  strip::refresh();
}

fn run(app: AppHandle, receiver: Receiver<()>) {
  loop {
    let reading = hid::read_battery();
    let now = {
      let mut status = lock(&STATUS);
      status.answering = reading.is_some();
      if reading.is_some() {
        status.last = reading;
      }
      status.clone()
    };
    let _ = app.emit("mouse-battery", now);
    strip::refresh();
    // A message: check now (plug-in, wake-up); closed: the module was turned off
    match receiver.recv_timeout(CHECK_EVERY) {
      Ok(()) | Err(RecvTimeoutError::Timeout) => {}
      Err(RecvTimeoutError::Disconnected) => return,
    }
  }
}

fn wide(text: &str) -> Vec<u16> {
  text.encode_utf16().chain(Some(0)).collect()
}

// The receiver, through Windows' own HID functions (no extra library)
mod hid {
  use super::Reading;
  use std::ptr::{null, null_mut};
  use std::time::{Duration, Instant};
  use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
    SetupDiDestroyDeviceInfoList, SetupDiEnumDeviceInterfaces, SetupDiGetClassDevsW, SetupDiGetDeviceInterfaceDetailW,
    DIGCF_DEVICEINTERFACE, DIGCF_PRESENT, SP_DEVICE_INTERFACE_DATA, SP_DEVICE_INTERFACE_DETAIL_DATA_W,
  };
  use windows_sys::Win32::Devices::HumanInterfaceDevice::{
    HidD_FreePreparsedData, HidD_GetHidGuid, HidD_GetPreparsedData, HidP_GetCaps, HIDP_CAPS, HIDP_STATUS_SUCCESS,
    PHIDP_PREPARSED_DATA,
  };
  use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_IO_PENDING, GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0,
  };
  use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_FLAG_OVERLAPPED, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
  };
  use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};
  use windows_sys::Win32::System::Threading::{CreateEventW, ResetEvent, WaitForSingleObject};

  // Teevolution Terra Pro (CompX firmware). On its charging cable the mouse is a device of its own
  // (the receiver then says it isn't connected), answering the same questions: asked first, so a
  // charging mouse shows its bolt. Their other collections don't understand the questions, so the
  // right one is picked by its usage page and usage. More devices later: more IDs.
  const DEVICE_IDS: [&str; 2] = [
    "vid_3554&pid_f522", // the mouse on its USB cable
    "vid_3554&pid_f523", // the 8K receiver
  ];
  const USAGE_PAGE: u16 = 0xFF02;
  const USAGE: u16 = 0x0002;
  const REPORT: usize = 17; // [08][question][14 × 00][checksum]
  const REPORT_ID: u8 = 0x08;
  const ONLINE: u8 = 0x03; // reply byte 6: 1 when the mouse is connected (to the receiver)
  const BATTERY: u8 = 0x04; // reply byte 6: percent, 7: charging, 8–9: millivolts
  const REPLY_WAIT: Duration = Duration::from_millis(500);

  // None: neither cable nor receiver, the mouse sleeps or is off, or no valid answer
  pub fn read_battery() -> Option<Reading> {
    let paths: Vec<(Vec<u16>, String)> = device_paths()
      .into_iter()
      .map(|path| {
        let name = String::from_utf16_lossy(&path).to_lowercase();
        (path, name)
      })
      .collect();
    for id in DEVICE_IDS {
      for (path, _) in paths.iter().filter(|(_, name)| name.contains(id)) {
        let Some(device) = Device::open(path) else { continue };
        let Some((input, output)) = device.report_lengths() else { continue };
        if let Some(reading) = ask_battery(&device, input, output) {
          return Some(reading);
        }
        break; // the right collection didn't answer: the next device
      }
    }
    None
  }

  fn ask_battery(device: &Device, input: usize, output: usize) -> Option<Reading> {
    // Asleep or off: no battery question. No answer to this one: ask anyway.
    if device.ask(ONLINE, input, output).is_some_and(|reply| reply[6] == 0) {
      return None;
    }
    let reply = device.ask(BATTERY, input, output)?;
    if reply[6] > 100 {
      return None;
    }
    let at = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|since| since.as_millis() as u64)
      .unwrap_or(0);
    Some(Reading {
      percent: reply[6],
      charging: reply[7] != 0,
      millivolts: u16::from_be_bytes([reply[8], reply[9]]),
      at,
    })
  }

  // 0x55 minus the sum of the first 16 bytes, kept to one byte
  fn checksum(report: &[u8]) -> u8 {
    report.iter().take(16).fold(0x55u8, |sum, byte| sum.wrapping_sub(*byte))
  }

  // The paths of all HID devices plugged in now (each ends with a 0, ready for CreateFileW)
  fn device_paths() -> Vec<Vec<u16>> {
    let mut paths = Vec::new();
    unsafe {
      let mut guid: windows_sys::core::GUID = std::mem::zeroed();
      HidD_GetHidGuid(&mut guid);
      let set = SetupDiGetClassDevsW(&guid, null(), null_mut(), DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
      if set == -1 {
        return paths;
      }
      let mut index = 0;
      loop {
        let mut interface = SP_DEVICE_INTERFACE_DATA {
          cbSize: std::mem::size_of::<SP_DEVICE_INTERFACE_DATA>() as u32,
          ..Default::default()
        };
        if SetupDiEnumDeviceInterfaces(set, null(), &guid, index, &mut interface) == 0 {
          break;
        }
        index += 1;
        let mut needed = 0u32;
        SetupDiGetDeviceInterfaceDetailW(set, &interface, null_mut(), 0, &mut needed, null_mut());
        if needed < 8 || needed > 4096 {
          continue;
        }
        // u64s so the detail struct is aligned
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        let detail = buffer.as_mut_ptr() as *mut SP_DEVICE_INTERFACE_DETAIL_DATA_W;
        (*detail).cbSize = std::mem::size_of::<SP_DEVICE_INTERFACE_DETAIL_DATA_W>() as u32;
        if SetupDiGetDeviceInterfaceDetailW(set, &interface, detail, needed, null_mut(), null_mut()) == 0 {
          continue;
        }
        let start = std::ptr::addr_of!((*detail).DevicePath) as *const u16;
        let most = (needed as usize - 4) / 2;
        let chars = std::slice::from_raw_parts(start, most);
        let end = chars.iter().position(|&c| c == 0).unwrap_or(most);
        let mut path = chars[..end].to_vec();
        path.push(0);
        paths.push(path);
      }
      SetupDiDestroyDeviceInfoList(set);
    }
    paths
  }

  struct Device {
    handle: HANDLE,
    event: HANDLE, // signals when a read or write is done
  }

  impl Device {
    fn open(path: &[u16]) -> Option<Device> {
      unsafe {
        let handle = CreateFileW(
          path.as_ptr(),
          GENERIC_READ | GENERIC_WRITE,
          FILE_SHARE_READ | FILE_SHARE_WRITE,
          null(),
          OPEN_EXISTING,
          FILE_FLAG_OVERLAPPED,
          null_mut(),
        );
        if handle == INVALID_HANDLE_VALUE {
          return None; // e.g. the mouse's own pointer collection, which Windows keeps for itself
        }
        let event = CreateEventW(null(), 1, 0, null());
        if event.is_null() {
          CloseHandle(handle);
          return None;
        }
        Some(Device { handle, event })
      }
    }

    // The input and output report sizes, only for the collection that understands the questions
    fn report_lengths(&self) -> Option<(usize, usize)> {
      unsafe {
        let mut data: PHIDP_PREPARSED_DATA = 0;
        if !HidD_GetPreparsedData(self.handle, &mut data) {
          return None;
        }
        let mut caps = HIDP_CAPS::default();
        let result = HidP_GetCaps(data, &mut caps);
        HidD_FreePreparsedData(data);
        if result != HIDP_STATUS_SUCCESS || caps.UsagePage != USAGE_PAGE || caps.Usage != USAGE {
          return None;
        }
        let (input, output) = (caps.InputReportByteLength as usize, caps.OutputReportByteLength as usize);
        (input >= REPORT && output >= REPORT && input <= 64 && output <= 64).then_some((input, output))
      }
    }

    // One question; the reply must repeat it and have the right checksum (other reports are skipped)
    fn ask(&self, question: u8, input: usize, output: usize) -> Option<[u8; REPORT]> {
      let mut report = vec![0u8; output];
      report[0] = REPORT_ID;
      report[1] = question;
      report[16] = checksum(&report);
      self.transfer(false, &mut report, REPLY_WAIT)?;
      let until = Instant::now() + REPLY_WAIT;
      loop {
        let left = until.checked_duration_since(Instant::now())?;
        let mut reply = vec![0u8; input];
        let got = self.transfer(true, &mut reply, left)?;
        if got >= REPORT && reply[0] == REPORT_ID && reply[1] == question && reply[16] == checksum(&reply) {
          let mut answer = [0u8; REPORT];
          answer.copy_from_slice(&reply[..REPORT]);
          return Some(answer);
        }
      }
    }

    // One read or write, given up after `wait`
    fn transfer(&self, read: bool, buffer: &mut [u8], wait: Duration) -> Option<usize> {
      unsafe {
        let mut overlapped = OVERLAPPED { hEvent: self.event, ..Default::default() };
        ResetEvent(self.event);
        let length = buffer.len() as u32;
        let started = if read {
          ReadFile(self.handle, buffer.as_mut_ptr(), length, null_mut(), &mut overlapped)
        } else {
          WriteFile(self.handle, buffer.as_ptr(), length, null_mut(), &mut overlapped)
        };
        if started == 0 && GetLastError() != ERROR_IO_PENDING {
          return None;
        }
        let mut done = 0u32;
        let millis = wait.as_millis().clamp(1, 10_000) as u32;
        if WaitForSingleObject(self.event, millis) != WAIT_OBJECT_0 {
          // No answer in time: cancel, and wait until Windows lets go of the buffer
          CancelIoEx(self.handle, &overlapped);
          GetOverlappedResult(self.handle, &overlapped, &mut done, 1);
          return None;
        }
        (GetOverlappedResult(self.handle, &overlapped, &mut done, 0) != 0).then_some(done as usize)
      }
    }
  }

  impl Drop for Device {
    fn drop(&mut self) {
      unsafe {
        CloseHandle(self.event);
        CloseHandle(self.handle);
      }
    }
  }
}

// A small drawing surface for Windows' own text drawing (GDI): white on black, so each pixel's
// brightness is how much of it the text covers; the strip colors it itself.
mod gdi {
  use super::wide;
  use std::ptr::null_mut;
  use windows_sys::Win32::Foundation::{RECT, SIZE};
  use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, DrawTextW, GdiFlush, GetTextExtentPoint32W,
    GetTextFaceW, SelectObject, SetBkMode, SetTextColor, ANTIALIASED_QUALITY, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DEFAULT_PITCH, DIB_RGB_COLORS, DRAW_TEXT_FORMAT, DT_NOPREFIX, DT_SINGLELINE,
    DT_VCENTER, HBITMAP, HDC, HFONT, HGDIOBJ, OUT_DEFAULT_PRECIS, TRANSPARENT,
  };

  pub struct Canvas {
    pub dc: HDC,
    bitmap: HBITMAP,
    old_bitmap: HGDIOBJ,
    bits: *mut u8,
    pub width: usize,
    pub height: usize,
  }

  impl Canvas {
    pub fn new(width: usize, height: usize) -> Option<Canvas> {
      if width == 0 || height == 0 || width > 4096 || height > 4096 {
        return None;
      }
      unsafe {
        let dc = CreateCompatibleDC(null_mut());
        if dc.is_null() {
          return None;
        }
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader = BITMAPINFOHEADER {
          biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
          biWidth: width as i32,
          biHeight: -(height as i32), // top row first
          biPlanes: 1,
          biBitCount: 32,
          biCompression: BI_RGB,
          ..std::mem::zeroed()
        };
        let mut bits: *mut core::ffi::c_void = null_mut();
        let bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
        if bitmap.is_null() || bits.is_null() {
          DeleteDC(dc);
          return None;
        }
        let old_bitmap = SelectObject(dc, bitmap);
        SetBkMode(dc, TRANSPARENT as i32);
        SetTextColor(dc, 0x00FF_FFFF);
        let mut canvas = Canvas { dc, bitmap, old_bitmap, bits: bits as *mut u8, width, height };
        canvas.pixels().fill(0);
        Some(canvas)
      }
    }

    // Blue, green, red, alpha per pixel, top row first
    pub fn pixels(&mut self) -> &mut [u8] {
      unsafe {
        GdiFlush();
        std::slice::from_raw_parts_mut(self.bits, self.width * self.height * 4)
      }
    }

    // Runs `draw` with the first of `faces` this PC has (the last one is used anyway), `px` high
    pub fn with_font<T>(&self, faces: &[&str], px: i32, weight: u32, draw: impl FnOnce(&Canvas) -> T) -> Option<T> {
      let mut draw = Some(draw);
      for (index, face) in faces.iter().enumerate() {
        let name = wide(face);
        unsafe {
          let font: HFONT = CreateFontW(
            -px,
            0,
            0,
            0,
            weight as i32,
            0,
            0,
            0,
            DEFAULT_CHARSET as u32,
            OUT_DEFAULT_PRECIS as u32,
            CLIP_DEFAULT_PRECIS as u32,
            ANTIALIASED_QUALITY as u32, // gray edges, not ClearType's colored ones
            DEFAULT_PITCH as u32,
            name.as_ptr(),
          );
          if font.is_null() {
            continue;
          }
          let old_font = SelectObject(self.dc, font);
          // Windows silently picks another font for a missing one: check its name
          let mut got = [0u16; 64];
          let length = GetTextFaceW(self.dc, got.len() as i32, got.as_mut_ptr()).clamp(0, 64) as usize;
          let found = String::from_utf16_lossy(&got[..length]).trim_end_matches('\0').eq_ignore_ascii_case(face);
          let result = if found || index == faces.len() - 1 { draw.take().map(|draw| draw(self)) } else { None };
          SelectObject(self.dc, old_font);
          DeleteObject(font);
          if result.is_some() {
            return result;
          }
        }
      }
      None
    }

    // With a font selected (with_font): the text's width and height
    pub fn measure(&self, text: &str) -> (i32, i32) {
      let text: Vec<u16> = text.encode_utf16().collect();
      let mut size = SIZE { cx: 0, cy: 0 };
      unsafe { GetTextExtentPoint32W(self.dc, text.as_ptr(), text.len() as i32, &mut size) };
      (size.cx, size.cy)
    }

    // With a font selected: one line, centered up and down in this box (`align`: DT_LEFT, DT_CENTER…)
    pub fn text(&self, text: &str, left: i32, top: i32, right: i32, bottom: i32, align: DRAW_TEXT_FORMAT) {
      let text: Vec<u16> = text.encode_utf16().collect();
      let mut area = RECT { left, top, right, bottom };
      unsafe { DrawTextW(self.dc, text.as_ptr(), text.len() as i32, &mut area, align | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX) };
    }
  }

  impl Drop for Canvas {
    fn drop(&mut self) {
      unsafe {
        SelectObject(self.dc, self.old_bitmap);
        DeleteObject(self.bitmap);
        DeleteDC(self.dc);
      }
    }
  }
}


// The taskbar's colors: Windows' own light/dark setting, red for a low number
mod theme {
  use super::wide;
  use std::ptr::null_mut;
  use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

  pub fn paint(light: bool, low: bool) -> [u8; 3] {
    match (light, low) {
      (false, false) => [255, 255, 255],
      (true, false) => [0, 0, 0],
      (false, true) => [255, 92, 92],
      (true, true) => [196, 43, 28],
    }
  }

  // Windows' own "caution" yellow (no answer from the mouse): bright on a dark taskbar, amber on a light one
  pub fn caution(light: bool) -> [u8; 3] {
    if light { [157, 93, 0] } else { [252, 225, 0] }
  }

  pub fn light_taskbar() -> bool {
    let key = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");
    let name = wide("SystemUsesLightTheme");
    let mut value = 0u32;
    let mut size = 4u32;
    let result = unsafe {
      RegGetValueW(
        HKEY_CURRENT_USER,
        key.as_ptr(),
        name.as_ptr(),
        RRF_RT_REG_DWORD,
        null_mut(),
        &mut value as *mut u32 as *mut core::ffi::c_void,
        &mut size,
      )
    };
    result == 0 && value == 1
  }
}
