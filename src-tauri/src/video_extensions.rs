// The video window's extensions (uBlock…), managed from Settings (VideoExtensions.tsx). They're
// copies of the folders the user picked, in the app's data under "video-extensions", and are
// loaded into the video window's own WebView2 storage: never the notes' one, and with no app
// commands (no capability), so an extension can't reach the notes.
//
// WebView2 keeps them in its profile, which only exists while a page uses it: the video window's
// site if it's open, else a hidden window that lives as long as the manager is open.
//
// The answers from WebView2 come on the main thread, and its objects can't leave that thread, so
// each step below is one round trip that sends plain values back.
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{Sender, channel};
use std::time::{Duration, Instant};
use tauri::utils::config::Color;
use tauri::webview::PlatformWebview;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use webview2_com::Microsoft::Web::WebView2::Win32::{
  ICoreWebView2_13, ICoreWebView2BrowserExtension, ICoreWebView2BrowserExtensionList, ICoreWebView2Profile7,
};
use webview2_com::{
  BrowserExtensionEnableCompletedHandler, BrowserExtensionRemoveCompletedHandler, ExecuteScriptCompletedHandler,
  ProfileAddBrowserExtensionCompletedHandler, ProfileGetBrowserExtensionsCompletedHandler, take_pwstr,
};
use windows::core::{BOOL, HSTRING, Interface, PWSTR};

use super::{VIDEO_ARGS, VIDEO_BAR, VIDEO_REQUEST, VIDEO_SITE, VIDEO_WINDOW};

pub const HOST: &str = "video-extensions-host";
const SETTINGS: &str = "video-extension-settings";
pub const POPUP: &str = "video-extension-popup";
// An icon is sent as text, so a big one isn't worth it
const ICON_LIMIT: u64 = 200_000;

#[derive(Serialize)]
pub struct ExtensionRow {
  folder: String,
  name: String,
  version: String,
  icon: Option<String>,
  enabled: bool,
  has_settings: bool,
  error: Option<String>, // why it didn't load
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
  app.path().app_local_data_dir().map_err(|e| e.to_string())
}
fn extensions_dir(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(data_dir(app)?.join("video-extensions"))
}
pub fn player_folder(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(data_dir(app)?.join("video-player"))
}
fn ids_file(app: &AppHandle) -> Result<PathBuf, String> {
  Ok(data_dir(app)?.join("video-extension-ids.json"))
}

// Folder -> WebView2's id for it
fn load_ids(app: &AppHandle) -> HashMap<String, String> {
  ids_file(app)
    .ok()
    .and_then(|file| fs::read_to_string(file).ok())
    .and_then(|text| serde_json::from_str(&text).ok())
    .unwrap_or_default()
}
fn save_ids(app: &AppHandle, ids: &HashMap<String, String>) -> Result<(), String> {
  let text = serde_json::to_string_pretty(ids).map_err(|e| e.to_string())?;
  fs::write(ids_file(app)?, text).map_err(|e| e.to_string())
}

// Every window using this storage: WebView2 needs the same options on each of them (lib.rs, the
// video window's two pages)
fn in_profile<'a>(
  app: &'a AppHandle,
  label: &str,
  url: WebviewUrl,
) -> Result<WebviewWindowBuilder<'a, tauri::Wry, AppHandle>, String> {
  Ok(
    WebviewWindowBuilder::new(app, label, url)
      .data_directory(player_folder(app)?)
      .browser_extensions_enabled(true)
      .additional_browser_args(VIDEO_ARGS)
      .use_https_scheme(true)
      .background_color(Color(0x16, 0x16, 0x16, 255))
      .on_navigation(|url| url.host_str() != Some("tauri.localhost")),
  )
}

// ---------- WebView2's profile ----------

fn profile_of(webview: &PlatformWebview) -> windows::core::Result<ICoreWebView2Profile7> {
  unsafe {
    webview
      .controller()
      .CoreWebView2()?
      .cast::<ICoreWebView2_13>()?
      .Profile()?
      .cast::<ICoreWebView2Profile7>()
  }
}

// Runs a step on the profile and waits for its answer. Only from a thread other than the main one
// (async commands), which has to stay free for the answer to come.
fn ask<T: Send + 'static>(
  app: &AppHandle,
  run: impl FnOnce(ICoreWebView2Profile7, Sender<Result<T, String>>) -> windows::core::Result<()> + Send + 'static,
) -> Result<T, String> {
  let (sender, receiver) = channel();
  let on_webview = move |webview: PlatformWebview| {
    let failed = sender.clone();
    if let Err(error) = profile_of(&webview).and_then(|profile| run(profile, sender)) {
      let _ = failed.send(Err(error.to_string()));
    }
  };
  let asked = match app.get_webview(VIDEO_SITE) {
    Some(site) => site.with_webview(on_webview),
    None => {
      let host = match app.get_webview_window(HOST) {
        Some(host) => host,
        None => {
          let blank = tauri::Url::parse("about:blank").map_err(|e| e.to_string())?;
          in_profile(app, HOST, WebviewUrl::External(blank))?
            .visible(false)
            .skip_taskbar(true)
            .build()
            .map_err(|e| e.to_string())?
        }
      };
      host.with_webview(on_webview)
    }
  };
  asked.map_err(|e| e.to_string())?;
  receiver.recv_timeout(Duration::from_secs(30)).map_err(|_| "WebView2 didn't answer".to_string())?
}

fn listed(
  list: &ICoreWebView2BrowserExtensionList,
) -> windows::core::Result<Vec<(String, bool, ICoreWebView2BrowserExtension)>> {
  let mut out = Vec::new();
  unsafe {
    let mut count = 0u32;
    list.Count(&mut count)?;
    for index in 0..count {
      let extension = list.GetValueAtIndex(index)?;
      let mut id = PWSTR::null();
      extension.Id(&mut id)?;
      let mut enabled = BOOL::default();
      extension.IsEnabled(&mut enabled)?;
      out.push((take_pwstr(id), enabled.as_bool(), extension));
    }
  }
  Ok(out)
}

// What the profile has: id -> switched on
fn profile_list(app: &AppHandle) -> Result<HashMap<String, bool>, String> {
  ask(app, |profile, sender| {
    let handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |result, list| {
      let answer = result.and_then(|()| match list {
        Some(list) => listed(&list),
        None => Ok(Vec::new()),
      });
      let _ = sender.send(
        answer.map(|all| all.into_iter().map(|(id, enabled, _)| (id, enabled)).collect()).map_err(|e| e.to_string()),
      );
      Ok(())
    }));
    unsafe { profile.GetBrowserExtensions(&handler) }
  })
}

// Does something to one extension. Not there anymore: nothing to do.
fn with_extension(
  app: &AppHandle,
  id: String,
  act: impl FnOnce(ICoreWebView2BrowserExtension, Sender<Result<(), String>>) -> windows::core::Result<()> + Send + 'static,
) -> Result<(), String> {
  ask(app, move |profile, sender| {
    let handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |result, list| {
      let answer = result.and_then(|()| match list {
        Some(list) => listed(&list),
        None => Ok(Vec::new()),
      });
      match answer.map(|all| all.into_iter().find(|(other, _, _)| *other == id)) {
        Ok(Some((_, _, extension))) => {
          let failed = sender.clone();
          if let Err(error) = act(extension, sender) {
            let _ = failed.send(Err(error.to_string()));
          }
        }
        Ok(None) => {
          let _ = sender.send(Ok(()));
        }
        Err(error) => {
          let _ = sender.send(Err(error.to_string()));
        }
      }
      Ok(())
    }));
    unsafe { profile.GetBrowserExtensions(&handler) }
  })
}

// Loads a folder from the app's data; gives WebView2's id. A folder it knows gets the same id, and
// its settings stay.
fn load_folder(app: &AppHandle, folder: &str) -> Result<String, String> {
  let path = extensions_dir(app)?.join(folder);
  ask(app, move |profile, sender| {
    let path = HSTRING::from(path.as_path());
    let handler = ProfileAddBrowserExtensionCompletedHandler::create(Box::new(move |result, extension| {
      let answer = result.map_err(|e| e.to_string()).and_then(|()| {
        let extension = extension.ok_or("WebView2 gave no extension back".to_string())?;
        let mut id = PWSTR::null();
        unsafe { extension.Id(&mut id) }.map_err(|e| e.to_string())?;
        Ok(take_pwstr(id))
      });
      let _ = sender.send(answer);
      Ok(())
    }));
    unsafe { profile.AddBrowserExtension(&path, &handler) }
  })
}

// ---------- An extension's folder ----------

fn read_json(path: &Path) -> Option<Value> {
  // Some files start with a byte order mark, which the JSON reader refuses
  let text = fs::read_to_string(path).ok()?;
  serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

// "__MSG_extName__" -> the text in the extension's default language
fn localized(folder: &Path, manifest: &Value, text: &str) -> String {
  let Some(key) = text.strip_prefix("__MSG_").and_then(|rest| rest.strip_suffix("__")) else {
    return text.to_string();
  };
  let locale = manifest["default_locale"].as_str().unwrap_or("en");
  read_json(&folder.join("_locales").join(locale).join("messages.json"))
    .and_then(|messages| {
      messages.as_object()?.iter().find_map(|(name, entry)| {
        if name.eq_ignore_ascii_case(key) { entry["message"].as_str().map(String::from) } else { None }
      })
    })
    .unwrap_or_else(|| text.to_string())
}

fn page_of(manifest: &Value, keys: &[&[&str]]) -> Option<String> {
  keys.iter().find_map(|path| {
    let mut value = manifest;
    for key in *path {
      value = &value[*key];
    }
    value.as_str().filter(|page| !page.is_empty()).map(|page| page.trim_start_matches('/').to_string())
  })
}
fn settings_page(manifest: &Value) -> Option<String> {
  page_of(manifest, &[&["options_ui", "page"], &["options_page"]])
}

// The picture closest above 32 px, else the biggest, as text for an <img>
fn icon_of(folder: &Path, manifest: &Value) -> Option<String> {
  use base64::Engine;
  let mut sizes: Vec<(u32, String)> = manifest["icons"]
    .as_object()?
    .iter()
    .filter_map(|(size, file)| Some((size.parse().ok()?, file.as_str()?.trim_start_matches('/').to_string())))
    .collect();
  sizes.sort_by_key(|(size, _)| *size);
  let (_, file) = sizes.iter().find(|(size, _)| *size >= 32).or(sizes.last())?;
  let kind = match Path::new(file).extension()?.to_str()?.to_lowercase().as_str() {
    "png" => "image/png",
    "svg" => "image/svg+xml",
    "jpg" | "jpeg" => "image/jpeg",
    "webp" => "image/webp",
    _ => return None,
  };
  let path = folder.join(file);
  if fs::metadata(&path).ok()?.len() > ICON_LIMIT {
    return None;
  }
  let text = base64::engine::general_purpose::STANDARD.encode(fs::read(path).ok()?);
  Some(format!("data:{kind};base64,{text}"))
}

// Copies waiting to be swapped start with a dot and never count
fn extension_folders(app: &AppHandle) -> Result<Vec<String>, String> {
  let mut folders: Vec<String> = fs::read_dir(extensions_dir(app)?)
    .map(|entries| {
      entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| !name.starts_with('.'))
        .collect()
    })
    .unwrap_or_default();
  folders.sort();
  Ok(folders)
}

fn folder_name(name: &str) -> String {
  let cleaned: String = name.to_lowercase().chars().map(|c| if c.is_alphanumeric() { c } else { '-' }).collect();
  let cleaned = cleaned.trim_matches('-').to_string();
  if cleaned.is_empty() { "extension".to_string() } else { cleaned }
}

fn copy_folder(from: &Path, to: &Path, top: bool) -> std::io::Result<()> {
  fs::create_dir_all(to)?;
  for entry in fs::read_dir(from)? {
    let entry = entry?;
    let name = entry.file_name();
    // A store install has a _metadata folder, which refuses to load from a plain folder
    if top && name == "_metadata" {
      continue;
    }
    if entry.path().is_dir() {
      copy_folder(&entry.path(), &to.join(&name), false)?;
    } else {
      fs::copy(entry.path(), to.join(&name))?;
    }
  }
  Ok(())
}

// Files can stay busy for a moment after WebView2 lets go of an extension
fn delete_folder(path: &Path) -> std::io::Result<()> {
  let mut result = Ok(());
  for _ in 0..5 {
    result = fs::remove_dir_all(path);
    if result.is_ok() || !path.exists() {
      return Ok(());
    }
    std::thread::sleep(Duration::from_millis(200));
  }
  result
}

// An extension's own pages close when it reloads or goes off, and WebView2 leaves its empty start
// page in their place
fn close_settings(app: &AppHandle) {
  if let Some(open) = app.get_webview_window(SETTINGS) {
    let _ = open.destroy();
  }
  close_popup(app, false);
}

// Adds a picked folder, or updates the same extension (same name = same folder = same id, so its
// settings stay). The working copy stays until the new one has loaded.
fn install(app: &AppHandle, from: &Path, only: Option<&str>) -> Result<(), String> {
  let manifest = read_json(&from.join("manifest.json")).ok_or("no-manifest")?;
  let name = localized(from, &manifest, manifest["name"].as_str().unwrap_or("extension"));
  let folder = folder_name(&name);
  if only.is_some_and(|only| only != folder) {
    return Err("other-extension".to_string());
  }
  let dir = extensions_dir(app)?;
  let (target, staged, previous) = (dir.join(&folder), dir.join(format!(".new-{folder}")), dir.join(format!(".old-{folder}")));
  let _ = fs::remove_dir_all(&staged);
  let _ = fs::remove_dir_all(&previous);
  copy_folder(from, &staged, true).map_err(|e| e.to_string())?;
  let had_one = target.exists();
  close_settings(app);
  if had_one && fs::rename(&target, &previous).is_err() {
    let _ = fs::remove_dir_all(&staged);
    return Err("in-use".to_string());
  }
  fs::rename(&staged, &target).map_err(|e| e.to_string())?;
  match load_folder(app, &folder) {
    Ok(id) => {
      if had_one {
        let _ = delete_folder(&previous);
      }
      let mut ids = load_ids(app);
      ids.insert(folder, id);
      save_ids(app, &ids)
    }
    Err(error) => {
      log::warn!("Extension {folder} didn't load: {error}");
      let _ = delete_folder(&target);
      if had_one && fs::rename(&previous, &target).is_ok() {
        let _ = load_folder(app, &folder);
      }
      // WebView2's own message says nothing useful ("Class not registered")
      Err("not-loaded".to_string())
    }
  }
}

fn pick_folder(app: &AppHandle, window: &tauri::WebviewWindow, title: String) -> Result<Option<PathBuf>, String> {
  let picked = app.dialog().file().set_title(title).set_parent(window).blocking_pick_folder();
  picked.map(|path| path.into_path().map_err(|e| e.to_string())).transpose()
}

// ---------- Popups, from the video bar ----------

#[derive(Serialize)]
struct BarButton {
  folder: String,
  name: String,
  icon: Option<String>,
}

fn popup_page(manifest: &Value) -> Option<String> {
  page_of(manifest, &[&["action", "default_popup"], &["browser_action", "default_popup"]])
}

// What the bar shows: the extensions that are on and have a popup. Never starts a hidden window.
fn bar_buttons(app: &AppHandle) -> Result<Vec<BarButton>, String> {
  let dir = extensions_dir(app)?;
  let mut with_popup = Vec::new();
  for folder in extension_folders(app)? {
    let path = dir.join(&folder);
    let manifest = read_json(&path.join("manifest.json")).unwrap_or(Value::Null);
    if popup_page(&manifest).is_some() {
      let button = BarButton {
        name: localized(&path, &manifest, manifest["name"].as_str().unwrap_or(&folder)),
        icon: icon_of(&path, &manifest),
        folder,
      };
      with_popup.push(button);
    }
  }
  if with_popup.is_empty() || app.get_webview(VIDEO_SITE).is_none() {
    return Ok(Vec::new());
  }
  let present = profile_list(app)?;
  let ids = load_ids(app);
  with_popup.retain(|button| ids.get(&button.folder).and_then(|id| present.get(id)).copied().unwrap_or(false));
  Ok(with_popup)
}

// Only from a thread other than the main one
pub fn show_on_bar(app: &AppHandle) {
  let Some(bar) = app.get_webview(VIDEO_BAR) else {
    return;
  };
  match bar_buttons(app).and_then(|list| serde_json::to_string(&list).map_err(|e| e.to_string())) {
    Ok(list) => {
      let _ = bar.eval(format!("window.setExtensions?.({list})"));
    }
    Err(error) => log::warn!("Extensions for the video bar: {error}"),
  }
}

// The bar's page has just started: the site below it may not exist yet
pub fn bar_ready(app: AppHandle) {
  std::thread::spawn(move || {
    for _ in 0..50 {
      if app.get_webview(VIDEO_SITE).is_some() {
        show_on_bar(&app);
        return;
      }
      std::thread::sleep(Duration::from_millis(100));
    }
  });
}

// A popup expects to be part of the video's browser window, and here it's a window of its own, so
// it would think it's about itself. Its first opening finds the video's tab (the size tells it
// from the bar, an extension's settings and the popup itself: tabs can hide their address) and
// reloads with it in the address, where uBlock reads it; for the others, asking for the current
// tab gives that one. window.close() and Escape go through the same signal as the video's window.
const POPUP_SCRIPT: &str = r#"(function (width, height) {
  if (location.protocol !== 'chrome-extension:') return
  const close = () => location.assign('https://syncr-video.invalid/close')
  window.close = close
  addEventListener('keydown', (event) => { if (event.key === 'Escape') close() }, true)
  const tabs = window.chrome && chrome.tabs
  if (!tabs) return
  const params = new URLSearchParams(location.search)
  if (!params.has('tabId')) {
    tabs.getCurrent((self) => tabs.query({}, (all) => {
      const off = (tab) => Math.abs(tab.width - width) + Math.abs(tab.height - height)
      const others = all.filter((tab) => tab.id !== (self && self.id) && tab.height > 80).sort((a, b) => off(a) - off(b))
      params.set('tabId', others.length ? others[0].id : 0)
      location.replace(location.pathname + '?' + params)
    }))
    return
  }
  const id = Number(params.get('tabId'))
  if (!id) return
  const query = tabs.query.bind(tabs)
  tabs.query = (info, done) => {
    const current = info && info.active && (info.currentWindow || info.lastFocusedWindow)
    const ask = (answer) => (current ? tabs.get(id, (tab) => answer([tab])) : query(info, answer))
    if (done) ask(done)
    else return new Promise(ask)
  }
})"#;

// Ready, width the page wants, height it wants, height it has
const POPUP_MEASURE: &str = "[document.readyState === 'complete' && location.search.includes('tabId'), document.body ? Math.ceil(document.body.getBoundingClientRect().width) : 0, document.documentElement.scrollHeight, innerHeight]";

// The sizes popups are made for go up to 800 x 600. This width lets each take its own; the low
// height gives the height of its content.
const POPUP_PROBE: (f64, f64) = (440.0, 100.0);
const POPUP_LOST: Duration = Duration::from_millis(1500);

struct PopupState {
  open: String,
  closed: Option<(String, Instant)>,
}
static POPUP_STATE: Mutex<PopupState> = Mutex::new(PopupState { open: String::new(), closed: None });
static POPUP_TURN: AtomicU32 = AtomicU32::new(0);

fn close_popup(app: &AppHandle, back_to_video: bool) {
  let Some(popup) = app.get_webview_window(POPUP) else {
    return;
  };
  let _ = popup.destroy();
  if let Ok(mut state) = POPUP_STATE.lock() {
    let folder = std::mem::take(&mut state.open);
    state.closed = Some((folder, Instant::now()));
  }
  if back_to_video {
    if let Some(site) = app.get_webview(VIDEO_SITE) {
      let _ = site.set_focus();
    }
  }
}

fn popup_is_in_front(popup: &tauri::WebviewWindow) -> bool {
  use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
  popup.hwnd().is_ok_and(|hwnd| hwnd.0 as isize == unsafe { GetForegroundWindow() } as isize)
}

fn measure_popup(popup: &tauri::WebviewWindow) -> Option<(bool, f64, f64, f64)> {
  let (sender, receiver) = channel();
  popup
    .with_webview(move |webview| {
      let failed = sender.clone();
      let run = || -> windows::core::Result<()> {
        let handler = ExecuteScriptCompletedHandler::create(Box::new(move |result, value| {
          let _ = sender.send(result.ok().map(|()| value));
          Ok(())
        }));
        unsafe { webview.controller().CoreWebView2()?.ExecuteScript(&HSTRING::from(POPUP_MEASURE), &handler) }
      };
      if run().is_err() {
        let _ = failed.send(None);
      }
    })
    .ok()?;
  let text = receiver.recv_timeout(Duration::from_secs(1)).ok()??;
  let value: Value = serde_json::from_str(&text).ok()?;
  Some((value[0].as_bool()?, value[1].as_f64()?, value[2].as_f64()?, value[3].as_f64()?))
}

// Under the button, kept on the screen. center: the button's middle on the screen, in pixels.
fn place_popup(app: &AppHandle, popup: &tauri::WebviewWindow, center: i32, width: f64, height: f64) {
  use tauri::{PhysicalPosition, PhysicalSize};
  let Some(player) = app.get_window(VIDEO_WINDOW) else {
    return;
  };
  let (Ok(scale), Ok(at), Some(bar)) = (player.scale_factor(), player.inner_position(), app.get_webview(VIDEO_BAR)) else {
    return;
  };
  let top = at.y + bar.size().map(|size| size.height as i32).unwrap_or(0);
  let (mut w, mut h) = ((width * scale).ceil() as i32, (height * scale).ceil() as i32);
  let mut left = center - w / 2;
  if let Ok(Some(screen)) = player.current_monitor() {
    let area = screen.work_area();
    w = w.min(area.size.width as i32);
    h = h.min(area.position.y + area.size.height as i32 - top).max(1);
    left = left.min(area.position.x + area.size.width as i32 - w).max(area.position.x);
  }
  let _ = popup.set_size(PhysicalSize::new(w as u32, h as u32));
  let _ = popup.set_position(PhysicalPosition::new(left, top));
}

// Opens the popup, or closes it on a second click: clicking the button has already taken it out of
// the front, so it may have just closed by itself.
pub fn open_popup(app: AppHandle, folder: String, at: f64) -> Result<(), String> {
  known(&app, &folder)?;
  let was_open = POPUP_STATE.lock().map(|state| state.open == folder).unwrap_or(false) && app.get_webview_window(POPUP).is_some();
  close_popup(&app, false);
  let just_closed = POPUP_STATE
    .lock()
    .map(|state| state.closed.as_ref().is_some_and(|(name, time)| *name == folder && time.elapsed() < Duration::from_millis(400)))
    .unwrap_or(false);
  if was_open || just_closed {
    if let Some(site) = app.get_webview(VIDEO_SITE) {
      let _ = site.set_focus();
    }
    return Ok(());
  }
  let manifest = read_json(&extensions_dir(&app)?.join(&folder).join("manifest.json")).ok_or("no-manifest")?;
  let page = popup_page(&manifest).ok_or("No popup")?;
  let id = load_ids(&app).get(&folder).cloned().ok_or("Not loaded")?;
  let url = tauri::Url::parse(&format!("chrome-extension://{id}/{page}")).map_err(|e| e.to_string())?;
  let player = app.get_window(VIDEO_WINDOW).ok_or("No video window")?;
  let scale = player.scale_factor().map_err(|e| e.to_string())?;
  let site_size = app.get_webview(VIDEO_SITE).ok_or("No video window")?.size().map_err(|e| e.to_string())?;
  let script = format!("{POPUP_SCRIPT}({}, {})", f64::from(site_size.width) / scale, f64::from(site_size.height) / scale);
  let center = player.inner_position().map_err(|e| e.to_string())?.x + at.round() as i32;
  let signals = app.clone();
  let popup = in_profile(&app, POPUP, WebviewUrl::External(url))?
    .initialization_script(script)
    .on_navigation(move |url| {
      if url.host_str() == Some(VIDEO_REQUEST) {
        let app = signals.clone();
        std::thread::spawn(move || close_popup(&app, true));
        return false;
      }
      url.host_str() != Some("tauri.localhost")
    })
    .decorations(false)
    .resizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .inner_size(POPUP_PROBE.0, POPUP_PROBE.1)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
  place_popup(&app, &popup, center, POPUP_PROBE.0, POPUP_PROBE.1);
  if let Ok(mut state) = POPUP_STATE.lock() {
    state.open = folder;
  }
  let turn = POPUP_TURN.fetch_add(1, Ordering::SeqCst) + 1;
  let started = Instant::now();
  let (mut width, mut height) = (POPUP_PROBE.0, 0.0);
  let mut last_height = -1.0;
  let mut shown = false;
  let mut in_front = false;
  // Follows the popup for as long as it's open: it grows with its content (uBlock's "More") and
  // closes when something else comes to the front or the video window goes
  while POPUP_TURN.load(Ordering::SeqCst) == turn {
    std::thread::sleep(Duration::from_millis(100));
    let Some(popup) = app.get_webview_window(POPUP) else {
      return Ok(());
    };
    if app.get_window(VIDEO_WINDOW).is_none() {
      close_popup(&app, false);
      return Ok(());
    }
    let measured = measure_popup(&popup);
    if !shown {
      let settled = measured.is_some_and(|(ready, wanted, content, _)| ready && wanted > 0.0 && content == last_height);
      if let Some((_, _, content, _)) = measured {
        last_height = content;
      }
      if settled || started.elapsed() > POPUP_LOST {
        if let Some((_, wanted, content, _)) = measured.filter(|(_, wanted, _, _)| *wanted > 0.0) {
          width = wanted;
          height = content;
        } else {
          height = 520.0;
        }
        place_popup(&app, &popup, center, width, height);
        let _ = popup.show();
        let _ = popup.set_focus();
        shown = true;
      }
      continue;
    }
    if let Some((_, _, content, room)) = measured {
      if content > room + 1.0 && content != height {
        height = content;
        place_popup(&app, &popup, center, width, height);
      }
    }
    if popup_is_in_front(&popup) {
      in_front = true;
    } else if in_front {
      close_popup(&app, false);
      return Ok(());
    }
  }
  Ok(())
}

// ---------- Commands of the manager ----------

// Also brings back into the profile a folder it doesn't have (WebView2's storage was deleted)
#[tauri::command]
pub async fn video_extensions_list(app: AppHandle) -> Result<Vec<ExtensionRow>, String> {
  let folders = extension_folders(&app)?;
  if folders.is_empty() {
    return Ok(Vec::new()); // no need to start a hidden window
  }
  let present = profile_list(&app)?;
  let dir = extensions_dir(&app)?;
  let mut ids = load_ids(&app);
  let mut rows = Vec::new();
  for folder in folders {
    let path = dir.join(&folder);
    let manifest = read_json(&path.join("manifest.json")).unwrap_or(Value::Null);
    let there = ids.get(&folder).is_some_and(|id| present.contains_key(id));
    let mut enabled = ids.get(&folder).and_then(|id| present.get(id)).copied().unwrap_or(true);
    let mut error = None;
    if !there {
      match load_folder(&app, &folder) {
        Ok(id) => {
          enabled = true;
          ids.insert(folder.clone(), id);
        }
        Err(text) => error = Some(text),
      }
    }
    rows.push(ExtensionRow {
      name: localized(&path, &manifest, manifest["name"].as_str().unwrap_or(&folder)),
      version: manifest["version"].as_str().unwrap_or("").to_string(),
      icon: icon_of(&path, &manifest),
      enabled,
      has_settings: settings_page(&manifest).is_some(),
      error,
      folder,
    });
  }
  save_ids(&app, &ids)?;
  Ok(rows)
}

// False if nothing was picked
#[tauri::command]
pub async fn video_extension_add(
  app: AppHandle,
  window: tauri::WebviewWindow,
  title: String,
  folder: Option<String>,
) -> Result<bool, String> {
  let Some(from) = pick_folder(&app, &window, title)? else {
    return Ok(false);
  };
  let result = install(&app, &from, folder.as_deref());
  show_on_bar(&app);
  result.map(|()| true)
}

// Only a folder from the list, never a path
fn known(app: &AppHandle, folder: &str) -> Result<(), String> {
  if extension_folders(app)?.iter().any(|other| other == folder) { Ok(()) } else { Err("No such extension".to_string()) }
}

#[tauri::command]
pub async fn video_extension_remove(app: AppHandle, folder: String) -> Result<(), String> {
  known(&app, &folder)?;
  close_settings(&app);
  let mut ids = load_ids(&app);
  if let Some(id) = ids.get(&folder).cloned() {
    with_extension(&app, id, |extension, sender| {
      let handler = BrowserExtensionRemoveCompletedHandler::create(Box::new(move |result| {
        let _ = sender.send(result.map_err(|e| e.to_string()));
        Ok(())
      }));
      unsafe { extension.Remove(&handler) }
    })?;
  }
  ids.remove(&folder);
  save_ids(&app, &ids)?;
  let deleted = delete_folder(&extensions_dir(&app)?.join(&folder)).map_err(|e| e.to_string());
  show_on_bar(&app);
  deleted
}

#[tauri::command]
pub async fn video_extension_enable(app: AppHandle, folder: String, on: bool) -> Result<(), String> {
  known(&app, &folder)?;
  if !on {
    close_settings(&app);
  }
  let id = load_ids(&app).get(&folder).cloned().ok_or("Not loaded")?;
  with_extension(&app, id, move |extension, sender| {
    let handler = BrowserExtensionEnableCompletedHandler::create(Box::new(move |result| {
      let _ = sender.send(result.map_err(|e| e.to_string()));
      Ok(())
    }));
    unsafe { extension.Enable(on, &handler) }
  })?;
  show_on_bar(&app);
  Ok(())
}

// An extension's settings page, in a window of its own: WebView2 has no toolbar to reach it
#[tauri::command]
pub async fn video_extension_settings(app: AppHandle, folder: String) -> Result<(), String> {
  known(&app, &folder)?;
  let path = extensions_dir(&app)?.join(&folder);
  let manifest = read_json(&path.join("manifest.json")).ok_or("no-manifest")?;
  let page = settings_page(&manifest).ok_or("No settings page")?;
  let id = load_ids(&app).get(&folder).cloned().ok_or("Not loaded")?;
  let url = tauri::Url::parse(&format!("chrome-extension://{id}/{page}")).map_err(|e| e.to_string())?;
  close_settings(&app);
  let title = localized(&path, &manifest, manifest["name"].as_str().unwrap_or(&folder));
  in_profile(&app, SETTINGS, WebviewUrl::External(url))?
    .title(title)
    .theme(Some(tauri::Theme::Dark))
    .inner_size(1100.0, 760.0)
    .center()
    .build()
    .map_err(|e| e.to_string())?;
  Ok(())
}

// The manager closed: the hidden window has nothing more to do
#[tauri::command]
pub async fn video_extensions_done(app: AppHandle) -> Result<(), String> {
  if let Some(host) = app.get_webview_window(HOST) {
    host.destroy().map_err(|e| e.to_string())?;
  }
  Ok(())
}
