// SyncR's admin helper for the Hardware module (PC). The CPU temperature and power need the PawnIO
// driver, which only answers admin programs; SyncR itself stays a normal program, so this small one
// does that single job and nothing else. It reads only the CPU temperature and power, only when SyncR
// asks, and takes no commands: one byte from SyncR asks for one reading, it answers with one line.
//
// Three ways it's started (SyncR, src/hardware_helper.rs, starts the first two through an admin
// prompt, from a copy it writes in a fresh temp folder):
//   --install <SyncR's program>  copies itself to Program Files (only admins can change files
//                                there), makes the scheduled task that starts it at login, starts it
//   --uninstall                  removes the task and the Program Files folder
//   --run <SyncR's program>      what the task runs: answers SyncR through the local pipe. If SyncR's
//                                program is gone (uninstalled), removes itself instead.
//
// The AMD module (pawnio/AMDFamily17.bin) is PawnIO's own, signed by its author (PawnIO loads no
// other), from github.com/namazso/PawnIO.Modules release 0.2.12, under the LGPL 2.1 (pawnio/COPYING).
// Nothing here may panic: built with panic = "abort".

#![windows_subsystem = "windows"]

mod shared;

use shared::*;
use std::ffi::{OsStr, OsString};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::ptr::{null, null_mut};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};

fn main() {
  let args: Vec<OsString> = std::env::args_os().skip(1).collect();
  let code = match (args.first().and_then(|arg| arg.to_str()), args.len()) {
    (Some("--install"), 2) => install(&args[1]),
    (Some("--uninstall"), 1) => uninstall(),
    (Some("--run"), 2) => run(&args[1]),
    _ => 2,
  };
  std::process::exit(code);
}

// --- Setting up and removing ---

fn install(syncr: &OsStr) -> i32 {
  if !Path::new(syncr).is_absolute() || !Path::new(syncr).is_file() {
    return 2;
  }
  let (Some(folder), Some(user), Ok(me)) = (install_folder(), user_sid(), std::env::current_exe()) else { return 3 };
  let exe = folder.join(EXE);
  stop_running(&exe);
  if std::fs::create_dir_all(&folder).is_err() {
    return 4;
  }
  // The old helper may take a moment to let go of its file. Removed first, so the file takes this
  // name's case (version 1 was "syncr-hardware.exe": copying over it would keep that).
  let copied = (0..20).any(|_| {
    let _ = std::fs::remove_file(&exe);
    std::fs::copy(&me, &exe).is_ok() || pause(100)
  });
  if !copied {
    return 4;
  }
  // The task is described in a file, as only that way it can run without a time limit (the
  // default stops it after 3 days) and on battery
  let file = folder.join("task.xml");
  let xml: Vec<u8> = [0xFEFFu16] // UTF-16 with its byte-order mark, as the file says it is
    .into_iter()
    .chain(task_xml(&user, &exe, syncr).encode_utf16())
    .flat_map(|unit| unit.to_le_bytes())
    .collect();
  if std::fs::write(&file, xml).is_err() {
    return 5;
  }
  let made = schtasks(&["/Create".as_ref(), "/F".as_ref(), "/TN".as_ref(), TASK.as_ref(), "/XML".as_ref(), file.as_os_str()]);
  let _ = std::fs::remove_file(&file);
  if !made {
    return 5;
  }
  if !schtasks(&["/Run".as_ref(), "/TN".as_ref(), TASK.as_ref()]) {
    return 6;
  }
  0
}

fn uninstall() -> i32 {
  let Some(folder) = install_folder() else { return 3 };
  schtasks(&["/Delete".as_ref(), "/F".as_ref(), "/TN".as_ref(), TASK.as_ref()]); // fails if it was never made: fine
  stop_running(&folder.join(EXE));
  let removed = (0..20).any(|_| !folder.exists() || std::fs::remove_dir_all(&folder).is_ok() || pause(100));
  if removed { 0 } else { 7 }
}

// SyncR was uninstalled: the task goes now, the folder at the next restart (a running program can't
// delete its own file)
fn remove_self() {
  use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_DELAY_UNTIL_REBOOT};
  schtasks(&["/Delete".as_ref(), "/F".as_ref(), "/TN".as_ref(), TASK.as_ref()]);
  let Some(folder) = install_folder() else { return };
  // Files first, then the folder, which must be empty by then
  for path in [folder.join(EXE), folder] {
    let path = wide(path.as_os_str());
    // path ends in 0; no new name means "delete"
    unsafe { MoveFileExW(path.as_ptr(), null(), MOVEFILE_DELAY_UNTIL_REBOOT) };
  }
}

// Always false, so it can sit in an any() that retries
fn pause(ms: u64) -> bool {
  std::thread::sleep(Duration::from_millis(ms));
  false
}

fn task_xml(user: &str, exe: &Path, syncr: &OsStr) -> String {
  let (user, exe, syncr) = (escape(user), escape(&exe.to_string_lossy()), escape(&syncr.to_string_lossy()));
  format!(
    r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Reads the CPU temperature for SyncR's Hardware module, only when SyncR asks. Removes itself when SyncR is uninstalled.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{user}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>"{exe}"</Command>
      <Arguments>--run "{syncr}"</Arguments>
    </Exec>
  </Actions>
</Task>
"#
  )
}

fn escape(text: &str) -> String {
  text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

// Windows' own schtasks.exe, from System32 (never through PATH, which any program can change)
fn schtasks(args: &[&OsStr]) -> bool {
  use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;
  use windows_sys::Win32::UI::Shell::FOLDERID_System;
  let Some(system) = known_folder(&FOLDERID_System) else { return false };
  let status = Command::new(system.join("schtasks.exe")).args(args).creation_flags(CREATE_NO_WINDOW).status();
  status.is_ok_and(|status| status.success())
}

// Ends the helper running from exe (not this one), so its file can be replaced or removed
fn stop_running(exe: &Path) {
  use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
  };
  use windows_sys::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, TerminateProcess, WaitForSingleObject,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, PROCESS_SYNCHRONIZE,
  };
  let wanted = exe.to_string_lossy().to_lowercase();
  // A list of the running programs, closed below
  let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
  if snapshot == INVALID_HANDLE_VALUE {
    return;
  }
  let mut entry = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
  let me = unsafe { GetCurrentProcessId() };
  // snapshot is open; entry has its size set, as Windows asks
  let mut more = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
  while more {
    let end = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
    let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
    if entry.th32ProcessID != me && name.eq_ignore_ascii_case(EXE) {
      // A handle to that program, closed below
      let process = unsafe {
        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, 0, entry.th32ProcessID)
      };
      if !process.is_null() {
        let mut path = [0u16; 1024];
        let mut size = path.len() as u32;
        // path has room for size characters
        let named = unsafe { QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, path.as_mut_ptr(), &mut size) } != 0;
        if named && String::from_utf16_lossy(&path[..size as usize]).to_lowercase() == wanted {
          // process is open with the right to end it and wait for it
          unsafe {
            TerminateProcess(process, 0);
            WaitForSingleObject(process, 3000);
          }
        }
        unsafe { CloseHandle(process) };
      }
    }
    // as above
    more = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
  }
  unsafe { CloseHandle(snapshot) };
}

// --- Answering SyncR ---

fn run(syncr: &OsStr) -> i32 {
  if !Path::new(syncr).is_file() {
    remove_self();
    return 0;
  }
  let Some(pipe) = Pipe::create() else { return 8 }; // already running
  loop {
    if !pipe.connect() {
      // SyncR opened and closed the pipe before this waited for it (module off and on quickly):
      // Windows then refuses every wait until the old connection is let go, so it would never
      // answer again until the next sign-in
      pipe.disconnect();
      pause(200);
      continue;
    }
    // PawnIO is opened at SyncR's first question, and closed when SyncR goes
    let mut cpu: Option<Result<Cpu, &str>> = None;
    while pipe.read_byte() {
      let answer = match cpu.get_or_insert_with(Cpu::open) {
        Ok(cpu) => match (cpu.temperature(), cpu.power()) {
          (None, None) => format!("{VERSION} {FAILED}\n"),
          (celsius, watts) => {
            let number = |n: Option<f64>| n.map_or("-".to_string(), |n| format!("{n:.3}"));
            format!("{VERSION} ok {} {}\n", number(celsius), number(watts))
          }
        },
        Err(problem) => format!("{VERSION} {problem}\n"),
      };
      if !pipe.write(answer.as_bytes()) {
        break;
      }
    }
    drop(cpu);
    pipe.disconnect();
  }
}

// The local pipe: one at a time, never from another PC, and only this Windows account (besides
// Windows itself and admins) may open it, to read and to ask (nothing else).
struct Pipe(HANDLE);

impl Pipe {
  fn create() -> Option<Pipe> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
    use windows_sys::Win32::Security::{PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES};
    use windows_sys::Win32::Storage::FileSystem::{FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_ACCESS_DUPLEX};
    use windows_sys::Win32::System::Pipes::{
      CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_WAIT,
    };
    let user = user_sid()?;
    // Windows and admins: everything. This account: 0x12008b = read, write data (the question),
    // read attributes and wait; nothing else, so no second pipe of that name can be made by it.
    // Medium integrity label: SyncR (a normal program) may write to it although the helper is admin.
    let rules = wide(format!("D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x12008b;;;{user})S:(ML;;NW;;;ME)").as_ref());
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // rules ends in 0; descriptor receives memory freed below
    let made = unsafe { ConvertStringSecurityDescriptorToSecurityDescriptorW(rules.as_ptr(), SDDL_REVISION_1, &mut descriptor, null_mut()) };
    if made == 0 {
      return None;
    }
    let attributes = SECURITY_ATTRIBUTES {
      nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
      lpSecurityDescriptor: descriptor,
      bInheritHandle: 0,
    };
    let name = wide(PIPE.as_ref());
    // name ends in 0; attributes holds a valid descriptor
    let pipe = unsafe {
      CreateNamedPipeW(
        name.as_ptr(),
        PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
        1,
        128,
        128,
        0,
        &attributes,
      )
    };
    // descriptor came from the conversion above; the pipe keeps its own copy
    unsafe { LocalFree(descriptor) };
    (pipe != INVALID_HANDLE_VALUE).then_some(Pipe(pipe))
  }

  // Waits for SyncR
  fn connect(&self) -> bool {
    use windows_sys::Win32::Foundation::{GetLastError, ERROR_PIPE_CONNECTED};
    use windows_sys::Win32::System::Pipes::ConnectNamedPipe;
    // self.0 is the open pipe; no overlapped: it waits
    unsafe { ConnectNamedPipe(self.0, null_mut()) != 0 || GetLastError() == ERROR_PIPE_CONNECTED }
  }

  // Waits for SyncR's question; false once SyncR is gone
  fn read_byte(&self) -> bool {
    use windows_sys::Win32::Storage::FileSystem::ReadFile;
    let mut byte = 0u8;
    let mut read = 0u32;
    // the pipe is open; byte has room for 1 byte
    unsafe { ReadFile(self.0, &mut byte, 1, &mut read, null_mut()) != 0 && read == 1 }
  }

  fn write(&self, bytes: &[u8]) -> bool {
    use windows_sys::Win32::Storage::FileSystem::WriteFile;
    let mut written = 0u32;
    // the pipe is open; bytes is a short line
    unsafe { WriteFile(self.0, bytes.as_ptr(), bytes.len() as u32, &mut written, null_mut()) != 0 && written as usize == bytes.len() }
  }

  fn disconnect(&self) {
    use windows_sys::Win32::System::Pipes::DisconnectNamedPipe;
    // the pipe is open
    unsafe { DisconnectNamedPipe(self.0) };
  }
}

// --- The CPU temperature and power, through PawnIO ---

type Open = unsafe extern "system" fn(*mut HANDLE) -> i32;
type Load = unsafe extern "system" fn(HANDLE, *const u8, usize) -> i32;
type Execute = unsafe extern "system" fn(HANDLE, *const u8, *const u64, usize, *mut u64, usize, *mut usize) -> i32;
type Close = unsafe extern "system" fn(HANDLE) -> i32;

const MODULE: &[u8] = include_bytes!("../pawnio/AMDFamily17.bin");
// The CPU's temperature register (THM_TCON_CUR_TMP), read through the SMN (the CPU's internal bus)
const TEMPERATURE_REGISTER: u64 = 0x0005_9800;
// The power: AMD's RAPL registers (MSRs). The unit register's bits 8-12 say how much energy one step
// of the counter is (1 / 2^n joules); the counter is the whole package's energy, 32 bits, wrapping.
const POWER_UNIT_MSR: u64 = 0xC001_0299;
const PACKAGE_ENERGY_MSR: u64 = 0xC001_029B;

struct Cpu {
  library: windows_sys::Win32::Foundation::HMODULE,
  handle: HANDLE,
  execute: Execute,
  close: Close,
  // Windows-wide lock that hardware tools share around the SMN, as PawnIO's module asks: a read is
  // two steps, and another tool's read in between would mix them up
  lock: HANDLE,
  offset: f64, // what some old Ryzens add to their temperature (see offset())
  energy_unit: Option<f64>, // joules per step of the energy counter (None: unreadable, no power)
  // The power is the energy used between two readings: the last counter and when it was read, and
  // the last power (given again when SyncR asks twice within a moment, too short to measure)
  energy: Option<(u32, Instant)>,
  watts: Option<f64>,
}

impl Cpu {
  fn open() -> Result<Cpu, &'static str> {
    use windows_sys::Win32::Foundation::FreeLibrary;
    use windows_sys::Win32::System::LibraryLoader::{
      GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR, LOAD_LIBRARY_SEARCH_SYSTEM32,
    };
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use windows_sys::Win32::UI::Shell::FOLDERID_ProgramFiles;
    // PawnIO's library, from its own Program Files folder only
    let path = known_folder(&FOLDERID_ProgramFiles).ok_or(NO_PAWNIO)?.join(r"PawnIO\PawnIOLib.dll");
    let path = wide(path.as_os_str());
    // path ends in 0; the library's own needs come from its folder or System32
    let library = unsafe { LoadLibraryExW(path.as_ptr(), null_mut(), LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32) };
    if library.is_null() {
      return Err(NO_PAWNIO);
    }
    // Each function has the type PawnIOLib.h gives it (HRESULT, stdcall)
    let function = |name: &[u8]| unsafe { GetProcAddress(library, name.as_ptr()) };
    let (Some(open), Some(load), Some(execute), Some(close)) =
      (function(b"pawnio_open\0"), function(b"pawnio_load\0"), function(b"pawnio_execute\0"), function(b"pawnio_close\0"))
    else {
      unsafe { FreeLibrary(library) };
      return Err(NO_PAWNIO);
    };
    let (open, load, execute, close): (Open, Load, Execute, Close) =
      unsafe { (std::mem::transmute(open), std::mem::transmute(load), std::mem::transmute(execute), std::mem::transmute(close)) };
    let mut handle: HANDLE = null_mut();
    // handle receives PawnIO's handle, closed in drop (or here)
    if unsafe { open(&mut handle) } < 0 {
      unsafe { FreeLibrary(library) };
      return Err(NO_PAWNIO);
    }
    // MODULE is the signed module; PawnIO checks it and refuses it on a CPU it isn't for
    if unsafe { load(handle, MODULE.as_ptr(), MODULE.len()) } < 0 {
      unsafe {
        close(handle);
        FreeLibrary(library);
      }
      return Err(UNSUPPORTED);
    }
    let name = wide(r"Global\Access_PCI".as_ref());
    // name ends in 0; opens the lock when another tool made it first; null when it can't
    let lock = unsafe { CreateMutexW(null(), 0, name.as_ptr()) };
    let mut cpu = Cpu { library, handle, execute, close, lock, offset: offset(), energy_unit: None, energy: None, watts: None };
    cpu.energy_unit = cpu.msr(POWER_UNIT_MSR).map(|units| 1.0 / (1u64 << ((units >> 8) & 0x1F)) as f64);
    Ok(cpu)
  }

  // One of the MSRs the module lets programs read
  fn msr(&self, register: u64) -> Option<u64> {
    let input = [register];
    let mut output = [0u64];
    let mut count = 0usize;
    // handle has the module loaded; its "ioctl_read_msr" takes 1 value and gives 1
    let result = unsafe {
      (self.execute)(self.handle, b"ioctl_read_msr\0".as_ptr(), input.as_ptr(), 1, output.as_mut_ptr(), 1, &mut count)
    };
    (result >= 0 && count == 1).then_some(output[0])
  }

  // Watts, the whole package (as tools name it "Package"), over the time since the last reading
  fn power(&mut self) -> Option<f64> {
    let unit = self.energy_unit?;
    let counter = self.msr(PACKAGE_ENERGY_MSR)? as u32;
    let now = Instant::now();
    if let Some((before, at)) = self.energy {
      let seconds = now.duration_since(at).as_secs_f64();
      if seconds < 0.2 {
        return self.watts; // too short to measure well: the last one again
      }
      let watts = counter.wrapping_sub(before) as f64 * unit / seconds;
      self.watts = (0.0..1000.0).contains(&watts).then_some(watts);
    }
    self.energy = Some((counter, now));
    self.watts
  }

  // °C, as tools name it "Core (Tctl/Tdie)"
  fn temperature(&self) -> Option<f64> {
    use windows_sys::Win32::Foundation::{WAIT_ABANDONED, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Threading::{ReleaseMutex, WaitForSingleObject};
    // lock is the shared lock (or null: then read without it, as nothing else can be done)
    let locked = !self.lock.is_null() && {
      let result = unsafe { WaitForSingleObject(self.lock, 200) };
      result == WAIT_OBJECT_0 || result == WAIT_ABANDONED // abandoned: its last owner closed, it's ours now
    };
    if !self.lock.is_null() && !locked {
      return None; // busy: no reading this time
    }
    let input = [TEMPERATURE_REGISTER];
    let mut output = [0u64];
    let mut count = 0usize;
    // handle has the module loaded; its "ioctl_read_smn" takes 1 value and gives 1
    let result = unsafe {
      (self.execute)(self.handle, b"ioctl_read_smn\0".as_ptr(), input.as_ptr(), 1, output.as_mut_ptr(), 1, &mut count)
    };
    if locked {
      // locked above
      unsafe { ReleaseMutex(self.lock) };
    }
    if result < 0 || count != 1 {
      return None;
    }
    let raw = output[0] as u32;
    // Bits 21-31: the temperature in eighths of a degree. Bit 19, or both bits 16-17: it counts from
    // -49 °C (the way AMD documents it, and Linux reads it)
    let mut celsius = (raw >> 21) as f64 / 8.0;
    if raw & (1 << 19) != 0 || (raw >> 16) & 3 == 3 {
      celsius -= 49.0;
    }
    celsius -= self.offset;
    (-40.0..150.0).contains(&celsius).then_some(celsius)
  }
}

impl Drop for Cpu {
  fn drop(&mut self) {
    use windows_sys::Win32::Foundation::FreeLibrary;
    // all three were opened in open and are closed only here
    unsafe {
      (self.close)(self.handle);
      FreeLibrary(self.library);
      if !self.lock.is_null() {
        CloseHandle(self.lock);
      }
    }
  }
}

// Some early Ryzens report their temperature raised by a fixed amount (AMD's published offsets),
// taken off so the number is the real one
fn offset() -> f64 {
  let name = cpu_name().unwrap_or_default();
  let raised = [
    ("Ryzen 5 1600X", 20.0),
    ("Ryzen 7 1700X", 20.0),
    ("Ryzen 7 1800X", 20.0),
    ("Ryzen 7 2700X", 10.0),
    ("Ryzen Threadripper 19", 27.0),
    ("Ryzen Threadripper 29", 27.0),
  ];
  raised.iter().find(|(model, _)| name.contains(model)).map_or(0.0, |(_, offset)| *offset)
}

fn cpu_name() -> Option<String> {
  use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
  let (key, value) = (wide(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0".as_ref()), wide("ProcessorNameString".as_ref()));
  let mut text = [0u16; 128];
  let mut size = size_of_val(&text) as u32;
  // text has room for size bytes; Windows writes a text ending in 0 there
  let result = unsafe {
    RegGetValueW(HKEY_LOCAL_MACHINE, key.as_ptr(), value.as_ptr(), RRF_RT_REG_SZ, null_mut(), text.as_mut_ptr().cast(), &mut size)
  };
  let end = text.iter().position(|&c| c == 0).unwrap_or(text.len());
  (result == 0).then(|| String::from_utf16_lossy(&text[..end]))
}

// --- Small Windows helpers ---

fn wide(text: &OsStr) -> Vec<u16> {
  text.encode_wide().chain(Some(0)).collect()
}

fn install_folder() -> Option<PathBuf> {
  use windows_sys::Win32::UI::Shell::FOLDERID_ProgramFiles;
  Some(known_folder(&FOLDERID_ProgramFiles)?.join(FOLDER))
}

// A Windows folder (Program Files, System32), from Windows itself rather than the environment,
// which the program that started this one could have changed
fn known_folder(id: &windows_sys::core::GUID) -> Option<PathBuf> {
  use std::os::windows::ffi::OsStringExt;
  use windows_sys::Win32::System::Com::CoTaskMemFree;
  use windows_sys::Win32::UI::Shell::SHGetKnownFolderPath;
  let mut path: windows_sys::core::PWSTR = null_mut();
  // path receives a text ending in 0, freed below (also on failure, as Windows asks)
  let result = unsafe { SHGetKnownFolderPath(id, 0, null_mut(), &mut path) };
  let folder = (result >= 0 && !path.is_null()).then(|| {
    // path is a text ending in 0
    let length = (0..).take_while(|&i| unsafe { *path.add(i) } != 0).count();
    PathBuf::from(OsString::from_wide(unsafe { std::slice::from_raw_parts(path, length) }))
  });
  unsafe { CoTaskMemFree(path.cast()) };
  folder
}

// This Windows account's id ("S-1-5-21-…")
fn user_sid() -> Option<String> {
  use windows_sys::Win32::Foundation::LocalFree;
  use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
  use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
  use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
  let mut token: HANDLE = null_mut();
  // token receives this program's token, closed below
  if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
    return None;
  }
  let mut buffer = [0u64; 64]; // 512 bytes, aligned for TOKEN_USER
  let mut size = 0u32;
  // buffer has room for size_of_val(&buffer) bytes
  let got = unsafe { GetTokenInformation(token, TokenUser, buffer.as_mut_ptr().cast(), size_of_val(&buffer) as u32, &mut size) };
  unsafe { CloseHandle(token) };
  if got == 0 {
    return None;
  }
  // Windows filled buffer with a TOKEN_USER
  let sid = unsafe { (*buffer.as_ptr().cast::<TOKEN_USER>()).User.Sid };
  let mut text: windows_sys::core::PWSTR = null_mut();
  // sid points into buffer; text receives a text ending in 0, freed below
  if unsafe { ConvertSidToStringSidW(sid, &mut text) } == 0 {
    return None;
  }
  let length = (0..).take_while(|&i| unsafe { *text.add(i) } != 0).count();
  let sid = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(text, length) });
  unsafe { LocalFree(text.cast()) };
  Some(sid)
}
