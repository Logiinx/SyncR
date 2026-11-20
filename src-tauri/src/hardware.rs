// Hardware module (PC, off unless turned on in Settings → Modules): reads the sensors the page asks
// for, at the chosen speed, and sends them to the page (event "hardware").
// Without admin: the GPU through NVIDIA's own library (nvml.dll, comes with the driver), the CPU's
// load and clock through Windows' performance counters, the RAM through Windows' memory status.
// The CPU temperature needs the PawnIO driver, which only answers admin programs: it will come from
// a small admin helper (later step).
// Only the sensors asked for are read; the libraries are opened only when one of theirs is asked
// for, and closed when the module is turned off (the thread ends).
// Nothing here may panic: the app is built with panic = "abort", so a panic would close SyncR.

use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// What the page sends (hardware.ts)
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
  on: bool,
  every_ms: u64,        // how often to read
  sensors: Vec<String>, // which to read: the names of Readings' fields below
}

// Sent to the page after each read (event "hardware") and by hardware_readings. None: not asked
// for, or this PC can't give it.
#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Readings {
  cpu_name: Option<String>, // as Windows has it ("AMD Ryzen 7 5700X3D 8-Core Processor"): the page shortens it
  gpu_name: Option<String>, // as NVIDIA has it ("NVIDIA GeForce RTX 5070 Ti")
  cpu_load: Option<f64>,    // %, like Task Manager
  cpu_clock: Option<f64>,   // MHz, average over all cores, like Task Manager's "Speed"
  gpu_temp: Option<f64>,    // °C
  gpu_load: Option<f64>,    // %
  gpu_clock: Option<f64>,   // MHz, graphics clock
  gpu_mem_clock: Option<f64>, // MHz, video memory clock
  gpu_fan: Option<f64>,     // % of full speed (0 while the fans stand still)
  gpu_fan_rpm: Option<f64>, // turns per minute, when the driver gives it
  ram_used: Option<f64>,    // bytes
  ram_total: Option<f64>,   // bytes
  at: u64,                  // when it was read, ms since 1970
}

static CONFIG: Mutex<Option<Config>> = Mutex::new(None);
static LAST: Mutex<Option<Readings>> = Mutex::new(None);
static WORKER: Mutex<Option<Sender<()>>> = Mutex::new(None);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
  mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// Called at start and on every settings change
#[tauri::command]
pub fn hardware_config(app: AppHandle, config: Config) {
  let mut worker = lock(&WORKER);
  if !config.on {
    *lock(&CONFIG) = None;
    *lock(&LAST) = None;
    worker.take(); // dropping the channel ends the thread, which closes the libraries
    return;
  }
  *lock(&CONFIG) = Some(config);
  if let Some(sender) = worker.as_ref() {
    let _ = sender.send(()); // read now with the new settings
    return;
  }
  let (sender, receiver) = mpsc::channel();
  std::thread::spawn(move || run(app, receiver));
  *worker = Some(sender);
}

#[tauri::command]
pub fn hardware_readings() -> Option<Readings> {
  lock(&LAST).clone()
}

fn run(app: AppHandle, receiver: Receiver<()>) {
  let mut nvml: Option<Option<nvml::Nvml>> = None; // None: not tried yet; Some(None): no NVIDIA GPU
  let mut counters: Option<Option<counters::Counters>> = None;
  let cpu_name = registry::cpu_name();
  loop {
    let Some(config) = lock(&CONFIG).clone() else { return };
    let wants = |name: &str| config.sensors.iter().any(|sensor| sensor == name);
    let mut readings = Readings { cpu_name: cpu_name.clone(), at: now_ms(), ..Default::default() };

    let gpu = ["gpuTemp", "gpuLoad", "gpuClock", "gpuMemClock", "gpuFan"].iter().any(|name| wants(name));
    if gpu {
      if let Some(gpu) = nvml.get_or_insert_with(nvml::Nvml::open) {
        readings.gpu_name = gpu.name.clone();
        if wants("gpuTemp") {
          readings.gpu_temp = gpu.temperature();
        }
        if wants("gpuLoad") {
          readings.gpu_load = gpu.load();
        }
        if wants("gpuClock") {
          readings.gpu_clock = gpu.clock(nvml::CLOCK_GRAPHICS);
        }
        if wants("gpuMemClock") {
          readings.gpu_mem_clock = gpu.clock(nvml::CLOCK_MEMORY);
        }
        if wants("gpuFan") {
          readings.gpu_fan = gpu.fan();
          readings.gpu_fan_rpm = gpu.fan_rpm();
        }
      }
    }
    if wants("cpuLoad") || wants("cpuClock") {
      if let Some(cpu) = counters.get_or_insert_with(counters::Counters::open) {
        let (load, performance) = cpu.read();
        if wants("cpuLoad") {
          readings.cpu_load = load.map(|load| load.min(100.0));
        }
        if wants("cpuClock") {
          readings.cpu_clock = performance.zip(cpu.base_mhz).map(|(percent, base)| percent / 100.0 * base);
        }
      }
    }
    if wants("ram") {
      if let Some((used, total)) = memory() {
        readings.ram_used = Some(used);
        readings.ram_total = Some(total);
      }
    }

    *lock(&LAST) = Some(readings.clone());
    let _ = app.emit("hardware", readings);
    let wait = Duration::from_millis(config.every_ms.clamp(500, 10_000));
    match receiver.recv_timeout(wait) {
      Ok(()) | Err(RecvTimeoutError::Timeout) => {}
      Err(RecvTimeoutError::Disconnected) => return, // turned off
    }
  }
}

fn now_ms() -> u64 {
  std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |since| since.as_millis() as u64)
}

fn wide(text: &str) -> Vec<u16> {
  text.encode_utf16().chain(Some(0)).collect()
}

// RAM in use and in total, in bytes
fn memory() -> Option<(f64, f64)> {
  use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
  let mut status = MEMORYSTATUSEX { dwLength: size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
  // status is a MEMORYSTATUSEX with its length set, as Windows asks
  if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
    return None;
  }
  Some(((status.ullTotalPhys - status.ullAvailPhys) as f64, status.ullTotalPhys as f64))
}

// The CPU's name and base clock, from where Windows keeps them
mod registry {
  use super::wide;
  use std::ptr::null_mut;
  use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ};

  const CPU_KEY: &str = r"HARDWARE\DESCRIPTION\System\CentralProcessor\0";

  pub fn cpu_name() -> Option<String> {
    let (key, value) = (wide(CPU_KEY), wide("ProcessorNameString"));
    let mut text = [0u16; 128];
    let mut size = size_of_val(&text) as u32;
    // text has room for size bytes; Windows writes a text ending in 0 there
    let result = unsafe {
      RegGetValueW(HKEY_LOCAL_MACHINE, key.as_ptr(), value.as_ptr(), RRF_RT_REG_SZ, null_mut(), text.as_mut_ptr().cast(), &mut size)
    };
    if result != 0 {
      return None;
    }
    let end = text.iter().position(|&c| c == 0).unwrap_or(text.len());
    Some(String::from_utf16_lossy(&text[..end]).trim().to_string())
  }

  // The base clock in MHz (Task Manager's "Base speed")
  pub fn base_mhz() -> Option<f64> {
    let (key, value) = (wide(CPU_KEY), wide("~MHz"));
    let mut mhz = 0u32;
    let mut size = size_of::<u32>() as u32;
    // mhz has room for the 4 bytes of a DWORD
    let result = unsafe {
      RegGetValueW(HKEY_LOCAL_MACHINE, key.as_ptr(), value.as_ptr(), RRF_RT_REG_DWORD, null_mut(), (&mut mhz as *mut u32).cast(), &mut size)
    };
    (result == 0 && mhz > 0).then_some(mhz as f64)
  }
}

// Windows' performance counters for the whole CPU, read by English name so they work in every
// Windows language. "% Processor Utility" is what Task Manager shows as the CPU's load;
// "% Processor Performance" is the clock as a share of the base clock (Task Manager's "Speed").
// Both compare two reads: the first read after opening gives nothing.
mod counters {
  use super::wide;
  use std::ptr::null_mut;
  use windows_sys::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterValue, PDH_FMT_COUNTERVALUE,
    PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY,
  };

  pub struct Counters {
    query: PDH_HQUERY,
    load: PDH_HCOUNTER,
    performance: PDH_HCOUNTER,
    pub base_mhz: Option<f64>,
  }

  // The query belongs to the reading thread alone
  unsafe impl Send for Counters {}

  impl Counters {
    pub fn open() -> Option<Counters> {
      use windows_sys::Win32::System::Performance::PdhOpenQueryW;
      let mut query: PDH_HQUERY = null_mut();
      // query receives a new query handle, closed in drop
      if unsafe { PdhOpenQueryW(std::ptr::null(), 0, &mut query) } != 0 {
        return None;
      }
      let add = |path: &str| {
        let path = wide(path);
        let mut counter: PDH_HCOUNTER = null_mut();
        // query is open; counter receives a handle that lives as long as the query
        (unsafe { PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut counter) } == 0).then_some(counter)
      };
      let load = add(r"\Processor Information(_Total)\% Processor Utility");
      let performance = add(r"\Processor Information(_Total)\% Processor Performance");
      let counters = Counters {
        query,
        load: load.unwrap_or(null_mut()),
        performance: performance.unwrap_or(null_mut()),
        base_mhz: super::registry::base_mhz(),
      };
      // The first sample, so the next read has something to compare with
      // query is open
      unsafe { PdhCollectQueryData(counters.query) };
      Some(counters)
    }

    // (load %, clock as % of the base clock)
    pub fn read(&self) -> (Option<f64>, Option<f64>) {
      // query is open
      if unsafe { PdhCollectQueryData(self.query) } != 0 {
        return (None, None);
      }
      (value(self.load), value(self.performance))
    }
  }

  fn value(counter: PDH_HCOUNTER) -> Option<f64> {
    if counter.is_null() {
      return None;
    }
    let mut value = PDH_FMT_COUNTERVALUE::default();
    // counter belongs to an open query; value is a PDH_FMT_COUNTERVALUE for Windows to fill
    if unsafe { PdhGetFormattedCounterValue(counter, PDH_FMT_DOUBLE, null_mut(), &mut value) } != 0 || value.CStatus != 0 {
      return None;
    }
    // PDH_FMT_DOUBLE: Windows filled the double
    let number = unsafe { value.Anonymous.doubleValue };
    number.is_finite().then_some(number)
  }

  impl Drop for Counters {
    fn drop(&mut self) {
      // query is open and closed only here (its counters go with it)
      unsafe { PdhCloseQuery(self.query) };
    }
  }
}

// NVIDIA's own library (nvml.dll, installed with the driver in System32), loaded only from
// System32 so no other file of that name can be picked up. First GPU only.
mod nvml {
  use super::wide;
  use std::ffi::c_void;
  use windows_sys::Win32::Foundation::{FreeLibrary, HMODULE};
  use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32};

  type Device = *mut c_void;
  type Init = unsafe extern "C" fn() -> i32;
  type HandleByIndex = unsafe extern "C" fn(u32, *mut Device) -> i32;
  type Name = unsafe extern "C" fn(Device, *mut u8, u32) -> i32;
  type Temperature = unsafe extern "C" fn(Device, u32, *mut u32) -> i32;
  type Utilization = unsafe extern "C" fn(Device, *mut [u32; 2]) -> i32; // gpu %, memory %
  type ClockInfo = unsafe extern "C" fn(Device, u32, *mut u32) -> i32;
  type FanSpeed = unsafe extern "C" fn(Device, *mut u32) -> i32;
  type FanSpeedRpm = unsafe extern "C" fn(Device, *mut [u32; 3]) -> i32; // version, fan, speed

  pub const CLOCK_GRAPHICS: u32 = 0;
  pub const CLOCK_MEMORY: u32 = 2;
  const SUCCESS: i32 = 0;
  const TEMPERATURE_GPU: u32 = 0;
  const FAN_SPEED_INFO_V1: u32 = 12 | (1 << 24); // the struct's size | version 1 << 24

  pub struct Nvml {
    library: HMODULE,
    device: Device,
    shutdown: Option<Init>,
    temperature: Option<Temperature>,
    utilization: Option<Utilization>,
    clock_info: Option<ClockInfo>,
    fan_speed: Option<FanSpeed>,
    fan_speed_rpm: Option<FanSpeedRpm>,
    pub name: Option<String>,
  }

  // The library and device belong to the reading thread alone
  unsafe impl Send for Nvml {}

  // A function of the library, or None when this driver doesn't have it
  unsafe fn function<T>(library: HMODULE, name: &str) -> Option<T> {
    let name = format!("{name}\0");
    // library is loaded; name ends in 0
    let found = unsafe { GetProcAddress(library, name.as_ptr()) }?;
    // T is the function's real type (from NVIDIA's nvml.h), the same size as a function pointer
    Some(unsafe { std::mem::transmute_copy::<_, T>(&found) })
  }

  impl Nvml {
    pub fn open() -> Option<Nvml> {
      let path = wide("nvml.dll");
      // path ends in 0; only System32 is searched
      let library = unsafe { LoadLibraryExW(path.as_ptr(), std::ptr::null_mut(), LOAD_LIBRARY_SEARCH_SYSTEM32) };
      if library.is_null() {
        return None;
      }
      // Each call below is a function of the loaded library, called with the types nvml.h gives
      let started = unsafe {
        let init: Option<Init> = function(library, "nvmlInit_v2");
        init.is_some_and(|init| init() == SUCCESS)
      };
      let mut device: Device = std::ptr::null_mut();
      let found = started
        && unsafe {
          let by_index: Option<HandleByIndex> = function(library, "nvmlDeviceGetHandleByIndex_v2");
          by_index.is_some_and(|by_index| by_index(0, &mut device) == SUCCESS)
        };
      // shutdown: "nvmlShutdown" has the same shape as init (no arguments, a result)
      let shutdown: Option<Init> = unsafe { function(library, "nvmlShutdown") };
      if !found {
        if started {
          if let Some(shutdown) = shutdown {
            unsafe { shutdown() };
          }
        }
        // library was loaded above
        unsafe { FreeLibrary(library) };
        return None;
      }
      let name = unsafe {
        let get_name: Option<Name> = function(library, "nvmlDeviceGetName");
        let mut text = [0u8; 96];
        get_name.filter(|get_name| get_name(device, text.as_mut_ptr(), text.len() as u32) == SUCCESS).map(|_| {
          let end = text.iter().position(|&c| c == 0).unwrap_or(text.len());
          String::from_utf8_lossy(&text[..end]).trim().to_string()
        })
      };
      unsafe {
        Some(Nvml {
          library,
          device,
          shutdown,
          temperature: function(library, "nvmlDeviceGetTemperature"),
          utilization: function(library, "nvmlDeviceGetUtilizationRates"),
          clock_info: function(library, "nvmlDeviceGetClockInfo"),
          fan_speed: function(library, "nvmlDeviceGetFanSpeed"),
          fan_speed_rpm: function(library, "nvmlDeviceGetFanSpeedRPM"),
          name,
        })
      }
    }

    pub fn temperature(&self) -> Option<f64> {
      let mut value = 0u32;
      // device is valid while the library is started; value is a u32 to fill
      let ok = self.temperature.is_some_and(|get| unsafe { get(self.device, TEMPERATURE_GPU, &mut value) } == SUCCESS);
      ok.then_some(value as f64)
    }

    pub fn load(&self) -> Option<f64> {
      let mut rates = [0u32; 2];
      // as above; rates is nvmlUtilization_t (two u32)
      let ok = self.utilization.is_some_and(|get| unsafe { get(self.device, &mut rates) } == SUCCESS);
      ok.then_some(rates[0] as f64)
    }

    pub fn clock(&self, kind: u32) -> Option<f64> {
      let mut mhz = 0u32;
      // as above
      let ok = self.clock_info.is_some_and(|get| unsafe { get(self.device, kind, &mut mhz) } == SUCCESS);
      ok.then_some(mhz as f64)
    }

    pub fn fan(&self) -> Option<f64> {
      let mut percent = 0u32;
      // as above
      let ok = self.fan_speed.is_some_and(|get| unsafe { get(self.device, &mut percent) } == SUCCESS);
      ok.then_some(percent as f64)
    }

    // The first fan, in turns per minute (newer drivers only)
    pub fn fan_rpm(&self) -> Option<f64> {
      let mut info = [FAN_SPEED_INFO_V1, 0, 0];
      // as above; info is nvmlFanSpeedInfo_v1_t (version, fan index, speed)
      let ok = self.fan_speed_rpm.is_some_and(|get| unsafe { get(self.device, &mut info) } == SUCCESS);
      ok.then_some(info[2] as f64)
    }
  }

  impl Drop for Nvml {
    fn drop(&mut self) {
      // The library was started and loaded in open, and is stopped and freed only here
      unsafe {
        if let Some(shutdown) = self.shutdown {
          shutdown();
        }
        FreeLibrary(self.library);
      }
    }
  }
}
