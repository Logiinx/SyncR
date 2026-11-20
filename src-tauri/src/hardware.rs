// Hardware module (PC, off unless turned on in Settings → Modules): reads the sensors the page asks
// for, at the chosen speed, and sends them to the page (event "hardware").
// Without admin: the GPU through NVIDIA's own libraries (nvml.dll, and nvapi64.dll for the memory
// temperature; both come with the driver), the CPU's load and clock through Windows' performance
// counters, the RAM through Windows' memory status.
// The CPU temperature needs the PawnIO driver, which only answers admin programs: it comes from a
// small admin helper, set up once by the user (hardware_helper.rs).
// Only the sensors asked for are read; the libraries are opened only when one of theirs is asked
// for, and closed when the module is turned off (the thread ends).
// Nothing here may panic: the app is built with panic = "abort", so a panic would close SyncR.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[path = "hardware_widget.rs"]
pub mod widget;
#[path = "hardware_helper.rs"]
pub mod helper;

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
  cpu_temp: Option<f64>,    // °C, "Core (Tctl/Tdie)", from the admin helper
  cpu_temp_state: Option<&'static str>, // why there's no cpu_temp (helper::OK... ), when asked for
  gpu_temp: Option<f64>,    // °C
  gpu_mem_temp: Option<f64>, // °C, video memory, from nvapi (None on cards without that sensor)
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
// Which reading thread is the current one: a thread stopped while reading (module off, maybe on
// again) ends without sending its last readings
static RUN: AtomicU64 = AtomicU64::new(0);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
  mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// Called at start and on every settings change
#[tauri::command]
pub fn hardware_config(app: AppHandle, config: Config) {
  let mut worker = lock(&WORKER);
  if !config.on {
    RUN.fetch_add(1, Ordering::SeqCst);
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
  let id = RUN.fetch_add(1, Ordering::SeqCst) + 1;
  std::thread::spawn(move || run(app, receiver, id));
  *worker = Some(sender);
}

#[tauri::command]
pub fn hardware_readings() -> Option<Readings> {
  lock(&LAST).clone()
}

// After the helper was set up or removed: read again at once
fn read_now() {
  if let Some(sender) = lock(&WORKER).as_ref() {
    let _ = sender.send(());
  }
}

fn run(app: AppHandle, receiver: Receiver<()>, id: u64) {
  let mut nvml: Option<Option<nvml::Nvml>> = None; // None: not tried yet; Some(None): no NVIDIA GPU
  let mut nvapi: Option<Option<nvapi::NvApi>> = None; // the same
  let mut counters: Option<Option<counters::Counters>> = None;
  let mut helper: Option<helper::Reader> = None; // dropped when not asked for, so the helper rests
  let cpu_name = registry::cpu_name();
  loop {
    let current = || RUN.load(Ordering::SeqCst) == id;
    let Some(config) = lock(&CONFIG).clone().filter(|_| current()) else { return };
    let wants = |name: &str| config.sensors.iter().any(|sensor| sensor == name);
    let mut readings = Readings { cpu_name: cpu_name.clone(), at: now_ms(), ..Default::default() };

    let gpu = ["gpuTemp", "gpuMemTemp", "gpuLoad", "gpuClock", "gpuMemClock", "gpuFan"].iter().any(|name| wants(name));
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
    if wants("gpuMemTemp") {
      readings.gpu_mem_temp = nvapi.get_or_insert_with(nvapi::NvApi::open).as_ref().and_then(|gpu| gpu.memory_temperature());
    } else {
      nvapi = None; // closes the library
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
    if wants("cpuTemp") {
      let (celsius, state) = helper.get_or_insert_with(helper::Reader::new).read();
      readings.cpu_temp = celsius;
      readings.cpu_temp_state = Some(state);
    } else {
      helper = None;
    }
    if wants("ram") {
      if let Some((used, total)) = memory() {
        readings.ram_used = Some(used);
        readings.ram_total = Some(total);
      }
    }

    {
      // Checked and saved under one lock, so turning off (which empties it) can't come in between
      let mut last = lock(&LAST);
      if !current() {
        return;
      }
      *last = Some(readings.clone());
    }
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

fn wide(text: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
  use std::os::windows::ffi::OsStrExt;
  text.as_ref().encode_wide().chain(Some(0)).collect()
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
    cpu_text("ProcessorNameString")
  }

  // A text value of the CPU's key
  pub fn cpu_text(name: &str) -> Option<String> {
    let (key, value) = (wide(CPU_KEY), wide(name));
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

// NVIDIA's second driver library (nvapi64.dll, also installed with the driver in System32, no
// admin), for the one number nvml doesn't give on GeForce cards: the video memory temperature. It
// comes from a function NVIDIA never documented (ThermalGetSensors, the one LHM, HWiNFO and GPU-Z
// use), found by its number through nvapi_QueryInterface. Checked on an RTX 5070 Ti: slot 2 is the
// memory (steady, 2 °C steps, stays warm when the core cools), slot 1 only copies the core (RTX 50
// cards no longer report a hot spot), other slots read 255 (no sensor). A driver that changes this
// gives an empty or impossible value, so the reading is just None. First GPU only, like nvml.
mod nvapi {
  use super::wide;
  use std::ffi::c_void;
  use windows_sys::Win32::Foundation::{FreeLibrary, HMODULE};
  use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32};

  type Gpu = *mut c_void;
  type QueryInterface = unsafe extern "C" fn(u32) -> *mut c_void;
  type Init = unsafe extern "C" fn() -> i32;
  type EnumGpus = unsafe extern "C" fn(*mut [Gpu; 64], *mut u32) -> i32;
  type ThermalSensors = unsafe extern "C" fn(Gpu, *mut Sensors) -> i32;

  // The functions' numbers, as nvapi_QueryInterface knows them
  const INITIALIZE: u32 = 0x0150_E828;
  const UNLOAD: u32 = 0xD22B_DD7E;
  const ENUM_PHYSICAL_GPUS: u32 = 0xE5AC_921F;
  const THERMAL_GET_SENSORS: u32 = 0x65FE_3AAD;
  const OK: i32 = 0;
  const MEMORY_SLOT: usize = 2;

  // What ThermalGetSensors fills: temperatures in 1/256 °C, for the slots whose bit is in mask
  #[repr(C)]
  struct Sensors {
    version: u32, // the struct's size | version 2 << 16
    mask: u32,
    reserved: [i32; 8],
    temperatures: [i32; 32],
  }

  pub struct NvApi {
    library: HMODULE,
    gpu: Gpu,
    unload: Option<Init>,
    sensors: ThermalSensors,
  }

  // The library and GPU belong to the reading thread alone
  unsafe impl Send for NvApi {}

  // A function of the library by its number, or None when this driver doesn't have it.
  // T is the function's real type, the same size as a function pointer.
  unsafe fn function<T>(query: QueryInterface, id: u32) -> Option<T> {
    // query is nvapi_QueryInterface of the loaded library: it takes a number, gives a pointer or null
    let found = unsafe { query(id) };
    (!found.is_null()).then(|| unsafe { std::mem::transmute_copy::<_, T>(&found) })
  }

  impl NvApi {
    pub fn open() -> Option<NvApi> {
      let path = wide("nvapi64.dll");
      // path ends in 0; only System32 is searched
      let library = unsafe { LoadLibraryExW(path.as_ptr(), std::ptr::null_mut(), LOAD_LIBRARY_SEARCH_SYSTEM32) };
      if library.is_null() {
        return None;
      }
      // library is loaded; the name ends in 0; nvapi_QueryInterface takes a u32 and gives a pointer
      let query: Option<QueryInterface> = unsafe {
        GetProcAddress(library, b"nvapi_QueryInterface\0".as_ptr()).map(|found| std::mem::transmute_copy(&found))
      };
      // Each call below is a function of the library, called with the shape nvapi gives it
      let opened = query.and_then(|query| unsafe {
        let init: Init = function(query, INITIALIZE)?;
        if init() != OK {
          return None;
        }
        let unload: Option<Init> = function(query, UNLOAD);
        let found = (|| {
          let enum_gpus: EnumGpus = function(query, ENUM_PHYSICAL_GPUS)?;
          let sensors: ThermalSensors = function(query, THERMAL_GET_SENSORS)?;
          let mut gpus = [std::ptr::null_mut(); 64];
          let mut count = 0u32;
          (enum_gpus(&mut gpus, &mut count) == OK && count > 0).then_some((gpus[0], sensors))
        })();
        if found.is_none() {
          if let Some(unload) = unload {
            unload();
          }
        }
        found.map(|(gpu, sensors)| (gpu, sensors, unload))
      });
      match opened {
        Some((gpu, sensors, unload)) => Some(NvApi { library, gpu, unload, sensors }),
        None => {
          // library was loaded above
          unsafe { FreeLibrary(library) };
          None
        }
      }
    }

    pub fn memory_temperature(&self) -> Option<f64> {
      let mut sensors = Sensors {
        version: size_of::<Sensors>() as u32 | (2 << 16),
        mask: (1 << (MEMORY_SLOT + 1)) - 1, // slots 0 to 2, asked together like the other tools do
        reserved: [0; 8],
        temperatures: [0; 32],
      };
      // gpu is valid while the library is started; sensors is the struct the function fills
      let ok = unsafe { (self.sensors)(self.gpu, &mut sensors) } == OK;
      let celsius = sensors.temperatures[MEMORY_SLOT] as f64 / 256.0;
      // 255 (raw, or in degrees): no sensor in that slot; anything outside 1–150 °C isn't a real reading
      (ok && (1.0..150.0).contains(&celsius)).then_some(celsius)
    }
  }

  impl Drop for NvApi {
    fn drop(&mut self) {
      // The library was started and loaded in open, and is stopped and freed only here
      unsafe {
        if let Some(unload) = self.unload {
          unload();
        }
        FreeLibrary(self.library);
      }
    }
  }
}
