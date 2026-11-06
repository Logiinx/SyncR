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
use std::sync::mpsc::{Sender, channel};
use std::time::Duration;
use tauri::utils::config::Color;
use tauri::webview::PlatformWebview;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use webview2_com::Microsoft::Web::WebView2::Win32::{
  ICoreWebView2_13, ICoreWebView2BrowserExtension, ICoreWebView2BrowserExtensionList, ICoreWebView2Profile7,
};
use webview2_com::{
  BrowserExtensionEnableCompletedHandler, BrowserExtensionRemoveCompletedHandler,
  ProfileAddBrowserExtensionCompletedHandler, ProfileGetBrowserExtensionsCompletedHandler, take_pwstr,
};
use windows::core::{BOOL, HSTRING, Interface, PWSTR};

use super::{VIDEO_ARGS, VIDEO_SITE};

pub const HOST: &str = "video-extensions-host";
const SETTINGS: &str = "video-extension-settings";
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
      let _ = delete_folder(&target);
      if had_one {
        if fs::rename(&previous, &target).is_ok() {
          let _ = load_folder(app, &folder);
        }
      }
      Err(error)
    }
  }
}

fn pick_folder(app: &AppHandle, window: &tauri::WebviewWindow, title: String) -> Result<Option<PathBuf>, String> {
  let picked = app.dialog().file().set_title(title).set_parent(window).blocking_pick_folder();
  picked.map(|path| path.into_path().map_err(|e| e.to_string())).transpose()
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
  install(&app, &from, folder.as_deref())?;
  Ok(true)
}

// Only a folder from the list, never a path
fn known(app: &AppHandle, folder: &str) -> Result<(), String> {
  if extension_folders(app)?.iter().any(|other| other == folder) { Ok(()) } else { Err("No such extension".to_string()) }
}

#[tauri::command]
pub async fn video_extension_remove(app: AppHandle, folder: String) -> Result<(), String> {
  known(&app, &folder)?;
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
  delete_folder(&extensions_dir(&app)?.join(&folder)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn video_extension_enable(app: AppHandle, folder: String, on: bool) -> Result<(), String> {
  known(&app, &folder)?;
  let id = load_ids(&app).get(&folder).cloned().ok_or("Not loaded")?;
  with_extension(&app, id, move |extension, sender| {
    let handler = BrowserExtensionEnableCompletedHandler::create(Box::new(move |result| {
      let _ = sender.send(result.map_err(|e| e.to_string()));
      Ok(())
    }));
    unsafe { extension.Enable(on, &handler) }
  })
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
  if let Some(open) = app.get_webview_window(SETTINGS) {
    let _ = open.destroy();
  }
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
