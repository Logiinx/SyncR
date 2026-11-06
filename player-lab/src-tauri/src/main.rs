// Player Lab: a throwaway test of extensions and userscripts in WebView2, the window type SyncR
// uses. A manager window adds and removes them; player windows open real sites with them on.
//
// Extensions are kept in one WebView2 profile, which only exists while a window uses it, so a
// hidden "host" window stays open to hold it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::webview::PlatformWebview;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;
use webview2_com::Microsoft::Web::WebView2::Win32::{
  ICoreWebView2_13, ICoreWebView2BrowserExtension, ICoreWebView2BrowserExtensionList, ICoreWebView2Profile7,
};
use webview2_com::{
  BrowserExtensionRemoveCompletedHandler, ProfileAddBrowserExtensionCompletedHandler,
  ProfileGetBrowserExtensionsCompletedHandler, take_pwstr,
};
use windows::core::{HSTRING, Interface, PWSTR};

const HOST: &str = "host";
const PLAYER_PREFIX: &str = "player-";

#[derive(Default)]
struct Lab {
  ids: Mutex<HashMap<String, String>>,    // extension folder -> WebView2's id for it
  errors: Mutex<HashMap<String, String>>, // extension folder -> why it didn't load
  notes: Mutex<Vec<String>>,              // other problems, shown in the manager
  next_label: AtomicU32,
}

#[derive(Serialize)]
struct ExtensionRow {
  folder: String,
  name: String,
  version: String,
  manifest_version: u64,
  id: Option<String>,
  error: Option<String>,
  popup: Option<String>,
  settings: Option<String>,
}

fn data_dir(app: &AppHandle) -> PathBuf {
  app.path().app_local_data_dir().expect("no local data folder")
}
fn extensions_dir(app: &AppHandle) -> PathBuf {
  data_dir(app).join("extensions")
}
fn scripts_dir(app: &AppHandle) -> PathBuf {
  data_dir(app).join("userscripts")
}
fn ids_file(app: &AppHandle) -> PathBuf {
  data_dir(app).join("extension-ids.json")
}

fn note(app: &AppHandle, text: String) {
  app.state::<Lab>().notes.lock().unwrap().push(text);
  changed(app);
}
fn changed(app: &AppHandle) {
  let _ = app.emit("lab-changed", ());
}
fn save_ids(app: &AppHandle) {
  let ids = app.state::<Lab>().ids.lock().unwrap().clone();
  if let Ok(text) = serde_json::to_string_pretty(&ids) {
    let _ = fs::write(ids_file(app), text);
  }
}

// Every window using the extensions' profile: WebView2 needs the same data folder and the same
// options on each of them. The debug port is only on when LAB_DEBUG_PORT is set.
fn in_profile<'a>(
  app: &'a AppHandle,
  label: &str,
  url: WebviewUrl,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
  let mut args = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection");
  if let Ok(port) = std::env::var("LAB_DEBUG_PORT") {
    args.push_str(&format!(" --remote-debugging-port={port}"));
  }
  WebviewWindowBuilder::new(app, label, url)
    .data_directory(data_dir(app).join("player-profile"))
    .browser_extensions_enabled(true)
    .additional_browser_args(&args)
    .devtools(true)
}

fn next_label(app: &AppHandle, prefix: &str) -> String {
  let n = app.state::<Lab>().next_label.fetch_add(1, Ordering::Relaxed);
  format!("{prefix}{n}")
}

// ---------- Extensions in the profile ----------

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

fn installed(
  list: &ICoreWebView2BrowserExtensionList,
) -> windows::core::Result<Vec<(String, ICoreWebView2BrowserExtension)>> {
  let mut out = Vec::new();
  unsafe {
    let mut count = 0u32;
    list.Count(&mut count)?;
    for index in 0..count {
      let extension = list.GetValueAtIndex(index)?;
      let mut id = PWSTR::null();
      extension.Id(&mut id)?;
      out.push((take_pwstr(id), extension));
    }
  }
  Ok(out)
}

fn extension_folders(app: &AppHandle) -> Vec<String> {
  let mut folders: Vec<String> = fs::read_dir(extensions_dir(app))
    .map(|entries| {
      entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect()
    })
    .unwrap_or_default();
  folders.sort();
  folders
}

fn add_to_profile(app: &AppHandle, profile: &ICoreWebView2Profile7, folder: String) {
  let path = extensions_dir(app).join(&folder);
  let path = HSTRING::from(path.as_path());
  let done_app = app.clone();
  let done_folder = folder.clone();
  let handler = ProfileAddBrowserExtensionCompletedHandler::create(Box::new(move |result, extension| {
    let lab = done_app.state::<Lab>();
    let mut failure = None;
    match (result, extension) {
      (Ok(()), Some(extension)) => {
        let mut id = PWSTR::null();
        match unsafe { extension.Id(&mut id) } {
          Ok(()) => {
            lab.ids.lock().unwrap().insert(done_folder.clone(), take_pwstr(id));
          }
          Err(error) => failure = Some(error.to_string()),
        }
      }
      (Ok(()), None) => failure = Some("WebView2 gave no extension back".to_string()),
      (Err(error), _) => failure = Some(error.to_string()),
    }
    match failure {
      Some(text) => {
        lab.errors.lock().unwrap().insert(done_folder.clone(), text);
      }
      None => {
        lab.errors.lock().unwrap().remove(&done_folder);
      }
    }
    save_ids(&done_app);
    changed(&done_app);
    Ok(())
  }));
  if let Err(error) = unsafe { profile.AddBrowserExtension(&path, &handler) } {
    app.state::<Lab>().errors.lock().unwrap().insert(folder, error.to_string());
    changed(app);
  }
}

// Adds what's in the folder but not in the profile yet. An extension already there is left alone:
// adding it again would reinstall it.
fn sync_extensions(app: &AppHandle) {
  let Some(host) = app.get_webview_window(HOST) else {
    note(app, "The hidden host window is missing".to_string());
    return;
  };
  let app = app.clone();
  let result = host.with_webview(move |webview| {
    let run = || -> windows::core::Result<()> {
      let profile = profile_of(&webview)?;
      let done_profile = profile.clone();
      let done_app = app.clone();
      let handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |result, list| {
        let listed = result.and_then(|()| match list {
          Some(list) => installed(&list),
          None => Ok(Vec::new()),
        });
        match listed {
          Ok(present) => {
            let known = done_app.state::<Lab>().ids.lock().unwrap().clone();
            for folder in extension_folders(&done_app) {
              let there = known.get(&folder).is_some_and(|id| present.iter().any(|(other, _)| other == id));
              if !there {
                add_to_profile(&done_app, &done_profile, folder);
              }
            }
          }
          Err(error) => note(&done_app, format!("Couldn't list the extensions: {error}")),
        }
        changed(&done_app);
        Ok(())
      }));
      unsafe { profile.GetBrowserExtensions(&handler) }
    };
    if let Err(error) = run() {
      note(&app, format!("Couldn't reach the extensions' profile: {error}"));
    }
  });
  if let Err(error) = result {
    eprintln!("{error}");
  }
}

// ---------- Reading an extension's folder ----------

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

fn extension_row(app: &AppHandle, folder: &str) -> ExtensionRow {
  let path = extensions_dir(app).join(folder);
  let manifest = read_json(&path.join("manifest.json")).unwrap_or(Value::Null);
  let text = |value: &Value| value.as_str().filter(|page| !page.is_empty()).map(String::from);
  let lab = app.state::<Lab>();
  let id = lab.ids.lock().unwrap().get(folder).cloned();
  let error = lab.errors.lock().unwrap().get(folder).cloned();
  ExtensionRow {
    folder: folder.to_string(),
    name: localized(&path, &manifest, manifest["name"].as_str().unwrap_or(folder)),
    version: manifest["version"].as_str().unwrap_or("?").to_string(),
    manifest_version: manifest["manifest_version"].as_u64().unwrap_or(0),
    id,
    error,
    popup: text(&manifest["action"]["default_popup"]).or(text(&manifest["browser_action"]["default_popup"])),
    settings: text(&manifest["options_ui"]["page"]).or(text(&manifest["options_page"])),
  }
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

fn folder_name(name: &str) -> String {
  let cleaned: String = name
    .to_lowercase()
    .chars()
    .map(|c| if c.is_alphanumeric() { c } else { '-' })
    .collect();
  let cleaned = cleaned.trim_matches('-').to_string();
  if cleaned.is_empty() { "extension".to_string() } else { cleaned }
}

// ---------- Userscripts ----------

const RUN_USERSCRIPT: &str = r#"(function (meta, body) {
  if (meta.noframes && window.top !== window) return;
  function pattern(text) {
    if (text === '<all_urls>') return /^https?:/;
    if (text.length > 2 && text[0] === '/' && text[text.length - 1] === '/') return new RegExp(text.slice(1, -1));
    var escaped = text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // "*://*.site.com/*" also means site.com itself
    escaped = escaped.replace('://*\\.', '://\u0001').replace(/\*/g, '.*').replace('\u0001', '(?:[^/]*\\.)?');
    return new RegExp('^' + escaped + '$');
  }
  function matches(list) {
    return list.some(function (text) { try { return pattern(text).test(location.href); } catch (e) { return false; } });
  }
  if (meta.include.length && !matches(meta.include)) return;
  if (matches(meta.exclude)) return;
  function addStyle(css) {
    var style = document.createElement('style');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
    return style;
  }
  function run() {
    try { body.call(window, window, addStyle, { script: { name: meta.name } }); }
    catch (error) { console.error('[userscript ' + meta.name + ']', error); }
  }
  if (meta.runAt === 'document-start' || document.readyState !== 'loading') run();
  else document.addEventListener('DOMContentLoaded', run, { once: true });
})"#;

fn wrap_userscript(file_name: &str, source: &str) -> String {
  let (mut include, mut exclude) = (Vec::new(), Vec::new());
  let mut name = file_name.to_string();
  let mut run_at = "document-end".to_string();
  let mut noframes = false;
  for line in source.lines() {
    let line = line.trim();
    if line.contains("==/UserScript==") {
      break;
    }
    let Some(rest) = line.strip_prefix("// @") else { continue };
    let (key, value) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
    let value = value.trim().to_string();
    match key {
      "match" | "include" => include.push(value),
      "exclude" | "exclude-match" => exclude.push(value),
      "run-at" => run_at = value,
      "noframes" => noframes = true,
      "name" => name = value,
      _ => {}
    }
  }
  let meta = json!({ "name": name, "include": include, "exclude": exclude, "runAt": run_at, "noframes": noframes });
  format!("{RUN_USERSCRIPT}({meta}, function (unsafeWindow, GM_addStyle, GM_info) {{\n{source}\n}});")
}

fn userscript_names(app: &AppHandle) -> Vec<String> {
  let mut names: Vec<String> = fs::read_dir(scripts_dir(app))
    .map(|entries| {
      entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".js"))
        .collect()
    })
    .unwrap_or_default();
  names.sort();
  names
}

// ---------- Commands of the manager window ----------

#[tauri::command]
fn get_state(app: AppHandle) -> Value {
  let extensions: Vec<ExtensionRow> =
    extension_folders(&app).iter().map(|folder| extension_row(&app, folder)).collect();
  json!({
    "extensions": extensions,
    "userscripts": userscript_names(&app),
    "notes": *app.state::<Lab>().notes.lock().unwrap(),
    "dataDir": data_dir(&app).to_string_lossy(),
  })
}

#[tauri::command]
async fn add_extension(app: AppHandle) -> Result<(), String> {
  let Some(picked) = app.dialog().file().set_title("Choose the extension's folder").blocking_pick_folder() else {
    return Ok(());
  };
  let from = picked.into_path().map_err(|error| error.to_string())?;
  let manifest = read_json(&from.join("manifest.json"))
    .ok_or("This folder has no manifest.json at its top level, so it isn't an unpacked extension")?;
  let name = localized(&from, &manifest, manifest["name"].as_str().unwrap_or("extension"));
  let to = extensions_dir(&app).join(folder_name(&name));
  if to.exists() {
    fs::remove_dir_all(&to).map_err(|error| error.to_string())?;
  }
  copy_folder(&from, &to, true).map_err(|error| error.to_string())?;
  // Same folder = same id, so it installs again over the old copy and keeps its settings
  let folder = to.file_name().unwrap().to_string_lossy().into_owned();
  app.state::<Lab>().ids.lock().unwrap().remove(&folder);
  sync_extensions(&app);
  Ok(())
}

#[tauri::command]
async fn remove_extension(app: AppHandle, folder: String) -> Result<(), String> {
  let id = app.state::<Lab>().ids.lock().unwrap().get(&folder).cloned();
  let host = app.get_webview_window(HOST).ok_or("The hidden host window is missing")?;
  let run_app = app.clone();
  host
    .with_webview(move |webview| {
      let app = run_app;
      let done_app = app.clone();
      let finish = move |app: &AppHandle| {
        let lab = app.state::<Lab>();
        lab.ids.lock().unwrap().remove(&folder);
        lab.errors.lock().unwrap().remove(&folder);
        save_ids(app);
        if let Err(error) = fs::remove_dir_all(extensions_dir(app).join(&folder)) {
          note(app, format!("Couldn't delete the folder {folder}: {error}"));
        }
        changed(app);
      };
      let Some(id) = id else {
        finish(&app);
        return;
      };
      let run = || -> windows::core::Result<()> {
        let profile = profile_of(&webview)?;
        let handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |result, list| {
          let listed = result.and_then(|()| match list {
            Some(list) => installed(&list),
            None => Ok(Vec::new()),
          });
          match listed.map(|present| present.into_iter().find(|(other, _)| *other == id)) {
            Ok(Some((_, extension))) => {
              let removed_app = done_app.clone();
              let removed = BrowserExtensionRemoveCompletedHandler::create(Box::new(move |result| {
                if let Err(error) = result {
                  note(&removed_app, format!("WebView2 couldn't remove it: {error}"));
                }
                finish(&removed_app);
                Ok(())
              }));
              if let Err(error) = unsafe { extension.Remove(&removed) } {
                note(&done_app, format!("WebView2 couldn't remove it: {error}"));
              }
            }
            Ok(None) => finish(&done_app),
            Err(error) => note(&done_app, format!("Couldn't list the extensions: {error}")),
          }
          Ok(())
        }));
        unsafe { profile.GetBrowserExtensions(&handler) }
      };
      if let Err(error) = run() {
        note(&app, format!("Couldn't reach the extensions' profile: {error}"));
      }
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn add_userscript(app: AppHandle) -> Result<(), String> {
  let Some(picked) = app
    .dialog()
    .file()
    .set_title("Choose the userscript")
    .add_filter("Userscript", &["js"])
    .blocking_pick_file()
  else {
    return Ok(());
  };
  let from = picked.into_path().map_err(|error| error.to_string())?;
  let name = from.file_name().ok_or("No file name")?.to_string_lossy().into_owned();
  let dir = scripts_dir(&app);
  fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  fs::copy(&from, dir.join(&name)).map_err(|error| error.to_string())?;
  changed(&app);
  Ok(())
}

#[tauri::command]
async fn remove_userscript(app: AppHandle, name: String) -> Result<(), String> {
  // Only a plain name from the list, never a path
  if !userscript_names(&app).contains(&name) {
    return Err("No such userscript".to_string());
  }
  fs::remove_file(scripts_dir(&app).join(&name)).map_err(|error| error.to_string())?;
  changed(&app);
  Ok(())
}

// The window is created anew, so userscripts added since then apply. Only one player at a time.
#[tauri::command]
async fn open_player(app: AppHandle, url: String) -> Result<(), String> {
  let url = Url::parse(url.trim()).map_err(|error| format!("Not a web address: {error}"))?;
  for (label, window) in app.webview_windows() {
    if label.starts_with(PLAYER_PREFIX) {
      let _ = window.destroy();
    }
  }
  let label = next_label(&app, PLAYER_PREFIX);
  let mut builder = in_profile(&app, &label, WebviewUrl::External(url)).title("Player").inner_size(1280.0, 760.0);
  for name in userscript_names(&app) {
    match fs::read_to_string(scripts_dir(&app).join(&name)) {
      Ok(source) => builder = builder.initialization_script(wrap_userscript(&name, &source)),
      Err(error) => note(&app, format!("Couldn't read {name}: {error}")),
    }
  }
  builder.build().map_err(|error| error.to_string())?;
  Ok(())
}

// An extension's own page (its popup or its settings), since WebView2 has no toolbar to reach them
#[tauri::command]
async fn open_extension_page(app: AppHandle, id: String, page: String) -> Result<(), String> {
  let url = Url::parse(&format!("chrome-extension://{id}/{}", page.trim_start_matches('/')))
    .map_err(|error| error.to_string())?;
  let label = next_label(&app, "extension-");
  in_profile(&app, &label, WebviewUrl::External(url))
    .title("Extension")
    .inner_size(1100.0, 760.0)
    .build()
    .map_err(|error| error.to_string())?;
  Ok(())
}

// The video player window (videoPlayer.ts): two separate pages in one window, our bar
// (public/video-bar.html) above the real site, so the site can't touch or fake the bar. Neither
// is in a capability file, and they have their own storage folder, apart from the notes. The next
// video replaces the current one, closed first so the window-state plugin remembers its place and
// size. The site's address is either a site's page or our page that forwards to YouTube's player
// (public/video-forward.html).
const VIDEO_WINDOW: &str = "video-player";
const VIDEO_BAR: &str = "video-player-bar";
const VIDEO_SITE: &str = "video-player-site";

// Bar on top and the site below. In full screen (the player's button: Tauri does it by itself)
// only the site.
fn place_video_pages(window: &tauri::Window, bar_height: f64) {
  use tauri::{PhysicalPosition, PhysicalSize, Rect};
  let (Some(bar), Some(site)) = (window.get_webview(VIDEO_BAR), window.get_webview(VIDEO_SITE)) else {
    return;
  };
  let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) else {
    return;
  };
  if size.width == 0 || size.height == 0 {
    return; // minimized
  }
  let fullscreen = window.is_fullscreen().unwrap_or(false);
  let top = if fullscreen { 0 } else { ((bar_height * scale).round() as u32).min(size.height) };
  let _ = if fullscreen { bar.hide() } else { bar.show() };
  let _ = bar.set_bounds(Rect {
    position: PhysicalPosition::new(0, 0).into(),
    size: PhysicalSize::new(size.width, top).into(),
  });
  let _ = site.set_bounds(Rect {
    position: PhysicalPosition::new(0, top as i32).into(),
    size: PhysicalSize::new(size.width, size.height - top).into(),
  });
}

fn close_video_window(app: &tauri::AppHandle) -> Result<(), String> {
  let Some(current) = app.get_window(VIDEO_WINDOW) else {
    return Ok(());
  };
  current.close().map_err(|e| e.to_string())?;
  for tries in 0..40 {
    if app.get_window(VIDEO_WINDOW).is_none() {
      break;
    }
    if tries == 30 {
      let _ = current.destroy(); // a site asking "leave this page?"
    }
    std::thread::sleep(std::time::Duration::from_millis(50));
  }
  Ok(())
}

// bar: what the bar shows, already encoded for an address. bar_height: in the app's scale.
#[tauri::command]
async fn open_video_player(
  app: tauri::AppHandle,
  address: String,
  title: String,
  bar: String,
  bar_height: f64,
  always_on_top: bool,
) -> Result<(), String> {
  use tauri::utils::config::Color;
  use tauri::webview::WebviewBuilder;
  use tauri::window::WindowBuilder;
  use tauri::{PhysicalPosition, PhysicalSize, WebviewUrl, WindowEvent};
  let url = if address.starts_with("video-forward.html?v=") {
    WebviewUrl::App(address.into())
  } else {
    let url = tauri::Url::parse(&address).map_err(|e| e.to_string())?;
    if url.scheme() != "https" {
      return Err("Not a web address".to_string());
    }
    WebviewUrl::External(url)
  };
  close_video_window(&app)?;
  let folder = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("video-player");
  // With its border for now: the window-state plugin removes it here before restoring the size.
  // Without this change a new window still counts a title bar, and each opening gets that much
  // taller.
  let window = WindowBuilder::new(&app, VIDEO_WINDOW)
    .title(title)
    .inner_size(1280.0, 760.0)
    .min_inner_size(480.0, 300.0)
    .center()
    .always_on_top(always_on_top)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
  let size = window.inner_size().map_err(|e| e.to_string())?;
  window
    .add_child(
      WebviewBuilder::new(VIDEO_BAR, WebviewUrl::App(format!("video-bar.html?data={bar}").into()))
        .background_color(Color(0x16, 0x16, 0x16, 255))
        .use_https_scheme(true)
        .data_directory(folder.clone())
        .additional_browser_args(&video_args())
        .on_navigation(|url| url.path() == "/video-bar.html"),
      PhysicalPosition::new(0, 0),
      PhysicalSize::new(size.width, 1),
    )
    .map_err(|e| e.to_string())?;
  let site = window
    .add_child(
      WebviewBuilder::new(VIDEO_SITE, url)
        .background_color(Color(0, 0, 0, 255))
        .use_https_scheme(true)
        .data_directory(folder)
        .additional_browser_args(&video_args())
        // A site can't send this window to SyncR's own pages
        .on_navigation(|url| url.host_str() != Some("tauri.localhost") || url.path() == "/video-forward.html"),
      PhysicalPosition::new(0, 1),
      size,
    )
    .map_err(|e| e.to_string())?;
  // On its first opening, or after an older version, the plugin left the border on
  let _ = window.set_decorations(false);
  // The resize edges of a borderless window sit under pages added later: this makes new ones on top
  let _ = window.set_resizable(false);
  let _ = window.set_resizable(true);
  // Closed while in full screen: the site isn't anymore, and there'd be no bar to get out with
  let _ = window.set_fullscreen(false);
  place_video_pages(&window, bar_height);
  let moved = window.clone();
  window.on_window_event(move |event| {
    if matches!(event, WindowEvent::Resized(_)) {
      place_video_pages(&moved, bar_height);
      if let Some(bar) = moved.get_webview(VIDEO_BAR) {
        let maximized = moved.is_maximized().unwrap_or(false);
        let _ = bar.eval(format!("window.setMaximized?.({maximized})"));
      }
    }
  });
  window.show().map_err(|e| e.to_string())?;
  let _ = window.set_focus();
  let _ = site.set_focus();
  Ok(())
}

// The clicks on the video bar. What needs the notes' database goes on to the main window
// (videoPlayer.ts).
#[tauri::command]
fn video_bar(app: tauri::AppHandle, webview: tauri::Webview, action: String, on: Option<bool>) -> Result<(), String> {
  use tauri::Emitter;
  if webview.label() != VIDEO_BAR {
    return Err("Only for the video bar".to_string());
  }
  let window = webview.window();
  let result = match action.as_str() {
    "ready" => {
      let maximized = window.is_maximized().unwrap_or(false);
      return webview.eval(format!("window.setMaximized({maximized})")).map_err(|e| e.to_string());
    }
    "drag" => window.start_dragging(),
    "minimize" => window.minimize(),
    "maximize" => {
      if window.is_maximized().unwrap_or(false) { window.unmaximize() } else { window.maximize() }
    }
    "close" => return window.close().map_err(|e| e.to_string()),
    "always-on-top" | "watched" | "browser" => {
      if action == "always-on-top" {
        window.set_always_on_top(on.unwrap_or(false)).map_err(|e| e.to_string())?;
      }
      app.emit_to("main", "video-bar", serde_json::json!({ "action": action, "on": on }))
    }
    _ => return Err("Unknown action".to_string()),
  };
  // The keyboard goes back to the video (space, arrows)
  if let Some(site) = window.get_webview(VIDEO_SITE) {
    let _ = site.set_focus();
  }
  result.map_err(|e| e.to_string())
}

// The main window tells the bar when a video's Watched mark changes (also from the list)
#[tauri::command]
fn video_player_watched(app: tauri::AppHandle, watched: bool) -> Result<(), String> {
  match app.get_webview(VIDEO_BAR) {
    Some(bar) => bar.eval(format!("window.setWatched?.({watched})")).map_err(|e| e.to_string()),
    None => Ok(()),
  }
}

#[tauri::command]
async fn close_video_player(app: tauri::AppHandle) -> Result<(), String> {
  close_video_window(&app)
}

// Lab only: LAB_VIDEO_PORT opens the player's two pages to inspection from outside
fn video_args() -> String {
  let mut args = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required");
  if let Ok(port) = std::env::var("LAB_VIDEO_PORT") {
    args.push_str(&format!(" --remote-debugging-port={port}"));
  }
  args
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_window_state::Builder::default().with_denylist(&["host"]).build())
    .manage(Lab::default())
    .invoke_handler(tauri::generate_handler![
      get_state,
      add_extension,
      remove_extension,
      add_userscript,
      remove_userscript,
      open_player,
      open_extension_page,
      open_video_player,
      video_bar,
      video_player_watched,
      close_video_player
    ])
    .on_window_event(|window, event| {
      // The hidden host window would otherwise keep the app running
      if window.label() == "main" && matches!(event, WindowEvent::CloseRequested { .. }) {
        window.app_handle().exit(0);
      }
    })
    .setup(|app| {
      let handle = app.handle().clone();
      fs::create_dir_all(extensions_dir(&handle))?;
      fs::create_dir_all(scripts_dir(&handle))?;
      if let Some(ids) = read_json(&ids_file(&handle)).and_then(|value| serde_json::from_value(value).ok()) {
        *handle.state::<Lab>().ids.lock().unwrap() = ids;
      }
      in_profile(&handle, HOST, WebviewUrl::App("blank.html".into())).visible(false).build()?;
      sync_extensions(&handle);
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running the lab");
}
