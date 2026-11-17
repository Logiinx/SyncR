// Mouse battery module (PC, off unless turned on in Settings → Modules): asks the mouse's receiver
// for its battery every 60 s and shows it as a second tray icon with the number in it.
// Only ever sends the two read questions in `hid` (online? battery?), never anything that changes
// the mouse. When the module is off, no thread runs and no device is opened.
// The protocol facts (not code) come from krisgfx9's Wireless-Device-Battery-Monitor.
// Nothing here may panic: the app is built with panic = "abort", so a panic would close SyncR.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const TRAY_ID: &str = "mouse-battery";
const CHECK_EVERY: Duration = Duration::from_secs(60);

// What the page sends (mouseBattery.ts): the settings, and the tray's words in the app's language
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
  on: bool,
  tray: bool,
  low: u8,            // at or below this percent the number turns red
  tip: String,        // tray tooltip, "{percent}" is replaced
  tip_waiting: String, // tray tooltip before the first answer
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

// The running check's channel (dropping it ends the thread) and its number: tray changes queued
// by an older check are ignored once a newer one started or the module was turned off
static WORKER: Mutex<Option<Sender<Config>>> = Mutex::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(0);
static STATUS: Mutex<Status> = Mutex::new(Status { last: None, answering: false });

fn status() -> Status {
  STATUS.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
}

// Called at start and on every settings or language change
#[tauri::command]
pub fn mouse_battery_config(app: AppHandle, config: Config) {
  let mut worker = WORKER.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
  if !config.on {
    if worker.take().is_some() {
      GENERATION.fetch_add(1, Ordering::SeqCst);
      let handle = app.clone();
      let _ = app.run_on_main_thread(move || drop(handle.remove_tray_by_id(TRAY_ID)));
    }
    return;
  }
  if let Some(sender) = worker.as_ref() {
    if sender.send(config.clone()).is_ok() {
      return;
    }
  }
  let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
  let (sender, receiver) = mpsc::channel();
  std::thread::spawn(move || run(app, config, receiver, generation));
  *worker = Some(sender);
}

#[tauri::command]
pub fn mouse_battery_status() -> Status {
  status()
}

fn run(app: AppHandle, mut config: Config, receiver: Receiver<Config>, generation: u64) {
  let mut check = true;
  loop {
    if check {
      let reading = hid::read_battery();
      let now = {
        let mut status = STATUS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        status.answering = reading.is_some();
        if reading.is_some() {
          status.last = reading;
        }
        status.clone()
      };
      let _ = app.emit("mouse-battery", now);
    }
    show(&app, &config, generation);
    match receiver.recv_timeout(CHECK_EVERY) {
      // New settings: redraw at once, the next check stays on its 60 s
      Ok(new) => {
        config = new;
        check = false;
      }
      Err(RecvTimeoutError::Timeout) => check = true,
      Err(RecvTimeoutError::Disconnected) => return,
    }
  }
}

// Draws the tray icon here (this thread), then hands it to the main thread, which owns the tray
fn show(app: &AppHandle, config: &Config, generation: u64) {
  let last = status().last;
  let wanted = config.tray;
  let (text, tip) = match last {
    Some(reading) => (reading.percent.to_string(), config.tip.replace("{percent}", &reading.percent.to_string())),
    None => ("–".to_string(), config.tip_waiting.clone()),
  };
  let low = last.is_some_and(|reading| reading.percent <= config.low);
  let image = if wanted { icon::draw(&text, icon::color(low)) } else { None };
  let handle = app.clone();
  let _ = app.run_on_main_thread(move || {
    if GENERATION.load(Ordering::SeqCst) != generation {
      return;
    }
    if !wanted {
      drop(handle.remove_tray_by_id(TRAY_ID));
      return;
    }
    let Some((rgba, size)) = image else { return };
    let image = tauri::image::Image::new_owned(rgba, size, size);
    if let Some(tray) = handle.tray_by_id(TRAY_ID) {
      let _ = tray.set_icon(Some(image));
      let _ = tray.set_tooltip(Some(&tip));
      return;
    }
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let _ = TrayIconBuilder::with_id(TRAY_ID)
      .icon(image)
      .tooltip(&tip)
      .on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
          crate::show_main(tray.app_handle());
        }
      })
      .build(&handle);
  });
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

  // Teevolution Terra Pro, 8K receiver (CompX firmware). Its other collections don't understand
  // the questions, so the right one is picked by its usage page and usage.
  // More devices later: a list of these.
  const DEVICE_ID: &str = "vid_3554&pid_f523";
  const USAGE_PAGE: u16 = 0xFF02;
  const USAGE: u16 = 0x0002;
  const REPORT: usize = 17; // [08][question][14 × 00][checksum]
  const REPORT_ID: u8 = 0x08;
  const ONLINE: u8 = 0x03; // reply byte 6: 1 when the mouse is connected to the receiver
  const BATTERY: u8 = 0x04; // reply byte 6: percent, 7: charging, 8–9: millivolts
  const REPLY_WAIT: Duration = Duration::from_millis(500);

  // None: no receiver, the mouse sleeps or is off, or no valid answer
  pub fn read_battery() -> Option<Reading> {
    for path in device_paths() {
      if !String::from_utf16_lossy(&path).to_lowercase().contains(DEVICE_ID) {
        continue;
      }
      let Some(device) = Device::open(&path) else { continue };
      let Some((input, output)) = device.report_lengths() else { continue };
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
      return Some(Reading {
        percent: reply[6],
        charging: reply[7] != 0,
        millivolts: u16::from_be_bytes([reply[8], reply[9]]),
        at,
      });
    }
    None
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

// The tray icon: the number drawn by Windows itself (Segoe UI), at the tray's real size
mod icon {
  use super::wide;
  use std::ptr::null_mut;
  use windows_sys::Win32::Foundation::RECT;
  use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, DrawTextW, GdiFlush, SelectObject,
    SetBkMode, SetTextColor, ANTIALIASED_QUALITY, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CLIP_DEFAULT_PRECIS,
    DEFAULT_CHARSET, DEFAULT_PITCH, DIB_RGB_COLORS, DT_CENTER, DT_NOPREFIX, DT_SINGLELINE, DT_VCENTER, FW_SEMIBOLD,
    OUT_DEFAULT_PRECIS, TRANSPARENT,
  };
  use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
  use windows_sys::Win32::UI::HiDpi::{GetDpiForSystem, GetSystemMetricsForDpi};
  use windows_sys::Win32::UI::WindowsAndMessaging::SM_CXSMICON;

  // Light or dark taskbar (Windows' own setting), red when low
  pub fn color(low: bool) -> [u8; 3] {
    match (light_taskbar(), low) {
      (false, false) => [255, 255, 255],
      (true, false) => [0, 0, 0],
      (false, true) => [255, 92, 92],
      (true, true) => [196, 43, 28],
    }
  }

  fn light_taskbar() -> bool {
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

  // RGBA pixels and their side length. The biggest font whose drawn text fits the icon is used,
  // and the text is centered by its drawn pixels (digits sit off-center in their line otherwise).
  pub fn draw(text: &str, color: [u8; 3]) -> Option<(Vec<u8>, u32)> {
    unsafe {
      let size = GetSystemMetricsForDpi(SM_CXSMICON, GetDpiForSystem()).clamp(16, 64) as usize;
      let canvas = size * 2;
      let dc = CreateCompatibleDC(null_mut());
      if dc.is_null() {
        return None;
      }
      let mut info: BITMAPINFO = std::mem::zeroed();
      info.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: canvas as i32,
        biHeight: -(canvas as i32), // top row first
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
      let pixels = std::slice::from_raw_parts_mut(bits as *mut u8, canvas * canvas * 4);
      SetBkMode(dc, TRANSPARENT as i32);
      SetTextColor(dc, 0x00FF_FFFF); // white on black: each pixel's brightness is how much it's covered
      let face = wide("Segoe UI");
      let text: Vec<u16> = text.encode_utf16().collect();
      let mut result = None;
      for em in (6..=size * 3 / 2).rev() {
        let font = CreateFontW(
          -(em as i32),
          0,
          0,
          0,
          FW_SEMIBOLD as i32,
          0,
          0,
          0,
          DEFAULT_CHARSET as u32,
          OUT_DEFAULT_PRECIS as u32,
          CLIP_DEFAULT_PRECIS as u32,
          ANTIALIASED_QUALITY as u32, // gray edges, not ClearType's colored ones
          DEFAULT_PITCH as u32,
          face.as_ptr(),
        );
        if font.is_null() {
          break;
        }
        let old_font = SelectObject(dc, font);
        pixels.fill(0);
        let mut area = RECT { left: 0, top: 0, right: canvas as i32, bottom: canvas as i32 };
        DrawTextW(dc, text.as_ptr(), text.len() as i32, &mut area, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
        GdiFlush();
        SelectObject(dc, old_font);
        DeleteObject(font);
        let Some((left, top, right, bottom)) = drawn_box(pixels, canvas) else { continue };
        let (width, height) = (right - left + 1, bottom - top + 1);
        if width > size || height > size {
          continue;
        }
        let mut rgba = vec![0u8; size * size * 4];
        let (x0, y0) = ((size - width) / 2, (size - height) / 2);
        for y in 0..height {
          for x in 0..width {
            let from = ((top + y) * canvas + left + x) * 4;
            let to = ((y0 + y) * size + x0 + x) * 4;
            rgba[to..to + 3].copy_from_slice(&color);
            rgba[to + 3] = pixels[from + 2]; // the red channel (all three are the same)
          }
        }
        result = Some((rgba, size as u32));
        break;
      }
      SelectObject(dc, old_bitmap);
      DeleteObject(bitmap);
      DeleteDC(dc);
      result
    }
  }

  // The smallest box around the drawn pixels: left, top, right, bottom (inclusive)
  fn drawn_box(pixels: &[u8], canvas: usize) -> Option<(usize, usize, usize, usize)> {
    let mut found: Option<(usize, usize, usize, usize)> = None;
    for y in 0..canvas {
      for x in 0..canvas {
        if pixels[(y * canvas + x) * 4 + 2] == 0 {
          continue;
        }
        found = Some(match found {
          None => (x, y, x, y),
          Some((l, t, r, b)) => (l.min(x), t.min(y), r.max(x), b.max(y)),
        });
      }
    }
    found
  }
}
