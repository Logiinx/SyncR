// The Hardware module's admin helper, seen from SyncR (the helper itself: hardware-helper/, built
// by build.rs and carried in SyncR). The CPU temperature needs admin rights SyncR doesn't have:
// the helper, set up once through an admin prompt, answers one reading per question over a local
// pipe. Here: asking it, knowing why it can't answer, and setting it up or removing it.
// Nothing here may panic (panic = "abort").

use super::{registry, wide};
use std::ffi::OsStr;
use std::path::PathBuf;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};

#[allow(dead_code)] // the helper uses some of these that SyncR doesn't
mod shared {
  include!("../hardware-helper/src/shared.rs");
}

const HELPER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/syncr-hardware.exe"));

// Why there's no CPU temperature, for the settings window (hardware.ts has the same names)
pub const OK: &str = "ok";
pub const UNSUPPORTED: &str = "unsupported"; // not a Ryzen: the page doesn't offer it
pub const NO_PAWNIO: &str = "noPawnio";
pub const NO_HELPER: &str = "noHelper"; // not set up (or removed)
pub const NOT_RUNNING: &str = "notRunning"; // set up, but not answering
pub const OUTDATED: &str = "outdated"; // set up by an older SyncR: needs updating
pub const FAILED: &str = "failed"; // this reading failed

// Belongs to the reading thread (hardware.rs); dropping it closes the pipe, so the helper rests
pub struct Reader {
  supported: bool,
  client: Option<Client>,
}

impl Reader {
  pub fn new() -> Reader {
    Reader { supported: ryzen(), client: None }
  }

  // (°C, why not)
  pub fn read(&mut self) -> (Option<f64>, &'static str) {
    if !self.supported {
      return (None, UNSUPPORTED);
    }
    if self.client.is_none() {
      if !pawnio_installed() {
        return (None, NO_PAWNIO);
      }
      self.client = Client::connect();
      if self.client.is_none() {
        return (None, if installed() { NOT_RUNNING } else { NO_HELPER });
      }
    }
    let answer = self.client.as_ref().and_then(Client::ask);
    let Some(answer) = answer else {
      self.client = None; // gone (stopped, or being updated): tried again next time
      return (None, NOT_RUNNING);
    };
    let mut words = answer.split(' ');
    if words.next() != Some(&shared::VERSION.to_string()) {
      return (None, OUTDATED);
    }
    match (words.next(), words.next(), words.next()) {
      (Some("ok"), Some(number), None) => match number.parse::<f64>() {
        Ok(celsius) if celsius.is_finite() => (Some(celsius), OK),
        _ => (None, FAILED),
      },
      (Some(shared::NO_PAWNIO), None, None) => (None, NO_PAWNIO),
      (Some(shared::UNSUPPORTED), None, None) => (None, UNSUPPORTED),
      _ => (None, FAILED),
    }
  }
}

// An AMD CPU of the families PawnIO's AMD module reads (0x17-0x1A: every Ryzen so far), as
// Windows describes it: "AMD64 Family 25 Model 33 Stepping 2"
fn ryzen() -> bool {
  let amd = registry::cpu_text("VendorIdentifier").is_some_and(|vendor| vendor == "AuthenticAMD");
  let family = registry::cpu_text("Identifier").and_then(|identifier| {
    let mut words = identifier.split_whitespace().skip_while(|word| *word != "Family");
    words.nth(1)?.parse::<u32>().ok()
  });
  amd && family.is_some_and(|family| (0x17..=0x1A).contains(&family))
}

fn program_files() -> Option<PathBuf> {
  use std::os::windows::ffi::OsStringExt;
  use windows_sys::Win32::System::Com::CoTaskMemFree;
  use windows_sys::Win32::UI::Shell::{FOLDERID_ProgramFiles, SHGetKnownFolderPath};
  let mut path: windows_sys::core::PWSTR = null_mut();
  // path receives a text ending in 0, freed below (also on failure, as Windows asks)
  let result = unsafe { SHGetKnownFolderPath(&FOLDERID_ProgramFiles, 0, null_mut(), &mut path) };
  let folder = (result >= 0 && !path.is_null()).then(|| {
    // path is a text ending in 0
    let length = (0..).take_while(|&i| unsafe { *path.add(i) } != 0).count();
    PathBuf::from(std::ffi::OsString::from_wide(unsafe { std::slice::from_raw_parts(path, length) }))
  });
  unsafe { CoTaskMemFree(path.cast()) };
  folder
}

fn pawnio_installed() -> bool {
  program_files().is_some_and(|folder| folder.join(r"PawnIO\PawnIOLib.dll").is_file())
}

fn installed_exe() -> Option<PathBuf> {
  Some(program_files()?.join(shared::FOLDER).join(shared::EXE))
}

fn installed() -> bool {
  installed_exe().is_some_and(|exe| exe.is_file())
}

// The program at the other end of the pipe is the helper set up in Program Files (only admins
// can put a program there), not another one that took the pipe's name first
fn genuine(pipe: HANDLE) -> bool {
  use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;
  use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
  let Some(wanted) = installed_exe() else { return false };
  let mut id = 0u32;
  // pipe is the open pipe; id receives its server's process id
  if unsafe { GetNamedPipeServerProcessId(pipe, &mut id) } == 0 {
    return false;
  }
  // A handle that may only ask for the program's name, closed below
  let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, id) };
  if process.is_null() {
    return false;
  }
  let mut path = [0u16; 1024];
  let mut size = path.len() as u32;
  // path has room for size characters
  let named = unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, path.as_mut_ptr(), &mut size) } != 0;
  unsafe { CloseHandle(process) };
  named && String::from_utf16_lossy(&path[..size as usize]).to_lowercase() == wanted.to_string_lossy().to_lowercase()
}

// The pipe, with a time limit on each question: a stuck helper must not stop the other readings
pub struct Client {
  pipe: HANDLE,
  event: HANDLE,
}

// Used by the reading thread alone
unsafe impl Send for Client {}

const WAIT_MS: u32 = 1000;

impl Client {
  fn connect() -> Option<Client> {
    use windows_sys::Win32::Foundation::GENERIC_READ;
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, FILE_FLAG_OVERLAPPED, FILE_WRITE_DATA, OPEN_EXISTING};
    use windows_sys::Win32::System::Threading::CreateEventW;
    let name = wide(shared::PIPE);
    // name ends in 0. Read, and write data (the question): exactly what the helper allows.
    let pipe = unsafe { CreateFileW(name.as_ptr(), GENERIC_READ | FILE_WRITE_DATA, 0, null(), OPEN_EXISTING, FILE_FLAG_OVERLAPPED, null_mut()) };
    if pipe == INVALID_HANDLE_VALUE {
      return None;
    }
    if !genuine(pipe) {
      unsafe { CloseHandle(pipe) };
      return None;
    }
    // A manual-reset event for the overlapped reads and writes
    let event = unsafe { CreateEventW(null(), 1, 0, null()) };
    if event.is_null() {
      unsafe { CloseHandle(pipe) };
      return None;
    }
    Some(Client { pipe, event })
  }

  // One reading: the helper's answer line, without its end
  fn ask(&self) -> Option<String> {
    let mut question = *b"?";
    if self.transfer(true, &mut question)? != 1 {
      return None;
    }
    let mut answer = Vec::new();
    let mut chunk = [0u8; 64];
    while !answer.contains(&b'\n') {
      let read = self.transfer(false, &mut chunk)?;
      if read == 0 || answer.len() + read > 64 {
        return None; // the answer is never that long
      }
      answer.extend_from_slice(&chunk[..read]);
    }
    let line = answer.split(|&byte| byte == b'\n').next()?;
    String::from_utf8(line.to_vec()).ok()
  }

  // Writes or reads buffer, waiting at most WAIT_MS; the bytes moved
  fn transfer(&self, write: bool, buffer: &mut [u8]) -> Option<usize> {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_IO_PENDING};
    use windows_sys::Win32::Storage::FileSystem::{ReadFile, WriteFile};
    use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, GetOverlappedResultEx, OVERLAPPED};
    let mut overlapped = OVERLAPPED { hEvent: self.event, ..Default::default() };
    let length = buffer.len() as u32;
    // pipe was opened for overlapped use; buffer and overlapped stay alive until the transfer is
    // over (finished, or cancelled and waited for below)
    unsafe {
      let started = if write {
        WriteFile(self.pipe, buffer.as_ptr(), length, null_mut(), &mut overlapped)
      } else {
        ReadFile(self.pipe, buffer.as_mut_ptr(), length, null_mut(), &mut overlapped)
      };
      if started == 0 && GetLastError() != ERROR_IO_PENDING {
        return None;
      }
      let mut moved = 0u32;
      if GetOverlappedResultEx(self.pipe, &overlapped, &mut moved, WAIT_MS, 0) == 0 {
        CancelIoEx(self.pipe, &overlapped);
        GetOverlappedResult(self.pipe, &overlapped, &mut moved, 1); // waits for the cancel
        return None;
      }
      Some(moved as usize)
    }
  }
}

impl Drop for Client {
  fn drop(&mut self) {
    // both were opened in connect and are closed only here
    unsafe {
      CloseHandle(self.pipe);
      CloseHandle(self.event);
    }
  }
}

// --- Setting up and removing (each one admin prompt) ---

// Sets up (or updates) the helper. if_missing: only when it isn't set up yet (turning the module
// on). Answers "ok", "declined" (the user said No), "failed", or why it can't (UNSUPPORTED...).
#[tauri::command]
pub async fn hardware_helper_setup(window: tauri::WebviewWindow, if_missing: bool) -> String {
  let owner = owner(&window);
  let result = tauri::async_runtime::spawn_blocking(move || {
    if !ryzen() {
      return UNSUPPORTED;
    }
    if !pawnio_installed() {
      return NO_PAWNIO;
    }
    if if_missing && installed() {
      return OK;
    }
    let Ok(syncr) = std::env::current_exe() else { return "failed" };
    let mut arguments = std::ffi::OsString::from("--install \"");
    arguments.push(syncr.as_os_str());
    arguments.push("\"");
    run_as_admin(owner, &arguments)
  })
  .await;
  super::read_now();
  result.unwrap_or("failed").to_string()
}

#[tauri::command]
pub async fn hardware_helper_remove(window: tauri::WebviewWindow) -> String {
  let owner = owner(&window);
  let result = tauri::async_runtime::spawn_blocking(move || run_as_admin(owner, OsStr::new("--uninstall"))).await;
  super::read_now();
  result.unwrap_or("failed").to_string()
}

// The window the admin prompt belongs to, so it opens in front (as a number: it goes to another thread)
fn owner(window: &tauri::WebviewWindow) -> isize {
  window.hwnd().map_or(0, |hwnd| hwnd.0 as isize)
}

// Writes the helper to a new temp folder and runs it through the admin prompt, then removes it
fn run_as_admin(owner: isize, arguments: &OsStr) -> &'static str {
  use windows_sys::Win32::Foundation::{GetLastError, ERROR_CANCELLED};
  use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
  use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
  use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;
  let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |since| since.as_nanos());
  let folder = std::env::temp_dir().join(format!("SyncR-hardware-{}-{stamp}", std::process::id()));
  // create_dir (not _all): fails if something made that folder first
  if std::fs::create_dir(&folder).is_err() {
    return "failed";
  }
  let exe = folder.join(shared::EXE);
  let result = (|| {
    std::fs::write(&exe, HELPER).ok()?;
    // Kept open until the helper is done, so no other program can change, replace or delete it
    // before the admin prompt runs it (Windows can still read it to run it); read back through
    // that handle, so what runs is surely ours
    let mut kept = {
      use std::os::windows::fs::OpenOptionsExt;
      use windows_sys::Win32::Storage::FileSystem::FILE_SHARE_READ;
      std::fs::OpenOptions::new().read(true).share_mode(FILE_SHARE_READ).open(&exe).ok()?
    };
    let mut written = Vec::with_capacity(HELPER.len());
    std::io::Read::read_to_end(&mut kept, &mut written).ok()?;
    if written != HELPER {
      return None;
    }
    let (verb, file, parameters) = (wide("runas"), wide(exe.as_os_str()), wide(arguments));
    let mut info = SHELLEXECUTEINFOW {
      cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
      fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
      hwnd: owner as _,
      lpVerb: verb.as_ptr(),
      lpFile: file.as_ptr(),
      lpParameters: parameters.as_ptr(),
      nShow: SW_HIDE,
      ..Default::default()
    };
    // info is filled as Windows asks, its texts end in 0 and outlive the call; on success
    // hProcess is the helper, closed below
    if unsafe { ShellExecuteExW(&mut info) } == 0 {
      return Some(if unsafe { GetLastError() } == ERROR_CANCELLED { "declined" } else { "failed" });
    }
    let mut code = 1u32;
    unsafe {
      WaitForSingleObject(info.hProcess, 120_000);
      GetExitCodeProcess(info.hProcess, &mut code);
      CloseHandle(info.hProcess);
    }
    drop(kept);
    Some(if code == 0 { OK } else { "failed" })
  })();
  // The helper may still hold its file for a moment
  for _ in 0..20 {
    if std::fs::remove_dir_all(&folder).is_ok() {
      break;
    }
    std::thread::sleep(std::time::Duration::from_millis(100));
  }
  result.unwrap_or("failed")
}
