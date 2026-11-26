// Muted sound saved ahead (src/mutedSound.ts): for a finished Twitch video of a channel with "Save
// the sound of muted parts" on, the original sound of its muted pieces, downloaded from its
// audio-only folder before Twitch deletes it (often within hours). Kept in the app's data folder,
// muted-sound/<video>/<piece number>.ts (older videos) or .mp4 (newer ones), never synced. A piece
// Twitch refused both ways is noted in gone.txt and never asked again; one that failed for a reason
// that may pass (network, too many requests, Twitch busy) is asked again at the next check.
// A video's sound is deleted once it leaves the Video list (tidy_muted_sound), or "stopped" (its
// sound deleted, a stopped.txt left so it's never downloaded again while it's in the list) by
// Settings → Video's Delete or the 2 GB cap, oldest videos first. One video gets at most half of it
// (a 24 h stream can have thousands of muted pieces): saving stops there, keeping its first hours.
use std::path::{Path, PathBuf};
use tauri::Manager;

const CLIENT_ID: &str = "kimne78kx3ncx6brgo4mv6wki5h1ko"; // the one Twitch's own website uses (as player.js)
const GONE: &str = "gone.txt";
const STOPPED: &str = "stopped.txt";
const CAP: u64 = 2 * 1024 * 1024 * 1024; // bytes

// A Twitch video's id (also a folder's name)
fn video_id(text: &str) -> bool {
  !text.is_empty() && text.len() <= 20 && text.bytes().all(|byte| byte.is_ascii_digit())
}

#[derive(serde::Serialize)]
pub struct SavedSound {
  muted: usize,   // muted pieces in the video's audio-only list
  saved: usize,   // of those, saved on this PC
  gone: usize,    // refused by Twitch both ways: never asked again
  waiting: usize, // failed for a reason that may pass: asked again next time
  full: bool,     // stopped at its room (room): the rest never saved
}

pub fn sound_folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("muted-sound"))
}

enum Piece {
  Sound(Vec<u8>),
  Gone,
  Passing,
}

// Asked as the player asks (video_window.rs, like_browser): Twitch's delivery network keeps one copy
// for requests that accept gzip and one for those that don't, and either can still have the sound
// after the other refuses
async fn download(url: &str) -> Piece {
  use reqwest::header::{ACCEPT_ENCODING, CONTENT_ENCODING};
  let mut passing = false;
  for encoding in ["gzip, deflate, br, zstd", "identity"] {
    let Ok(response) = super::video_window::player_client().get(url).header(ACCEPT_ENCODING, encoding).send().await else {
      passing = true;
      continue;
    };
    let status = response.status().as_u16();
    // Compressed after all (never seen for pieces): not a usable file, maybe next time
    let compressed = response.headers().get(CONTENT_ENCODING).is_some_and(|value| value != "identity");
    if status == 200 && !compressed {
      match response.bytes().await {
        Ok(body) if !body.is_empty() => return Piece::Sound(body.to_vec()),
        _ => passing = true,
      }
    } else if status == 200 || status == 408 || status == 429 || status >= 500 {
      passing = true;
    }
  }
  if passing { Piece::Passing } else { Piece::Gone }
}

// A video's piece format, the same in all its pieces and qualities: .ts (older videos) or .mp4
#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
  Ts,
  Mp4,
}
impl Kind {
  fn extension(self) -> &'static str {
    match self {
      Kind::Ts => "ts",
      Kind::Mp4 => "mp4",
    }
  }
  // Where a muted piece's original sound is on Twitch: "N.ts", or "N-unmuted.mp4" (in .mp4 videos
  // that name is the original itself, "N-muted.mp4" the silent copy: probe 2026-11-26)
  fn original(self, number: u32) -> String {
    match self {
      Kind::Ts => format!("{number}.ts"),
      Kind::Mp4 => format!("{number}-unmuted.mp4"),
    }
  }
}

// The muted pieces in an audio-only list: "123-unmuted.ts" (or "-muted", or .mp4), maybe as a full
// address. The format of the first one found; each number once, in the list's order.
fn muted_numbers(list: &str) -> (Kind, Vec<u32>) {
  let mut kind = None;
  let mut numbers = Vec::new();
  for line in list.lines().filter(|line| !line.starts_with('#')) {
    let name = line.trim().rsplit('/').next().unwrap_or("");
    let Some((start, found)) = [("-unmuted.ts", Kind::Ts), ("-muted.ts", Kind::Ts), ("-unmuted.mp4", Kind::Mp4), ("-muted.mp4", Kind::Mp4)].into_iter().find_map(|(end, found)| Some((name.strip_suffix(end)?, found))) else { continue };
    if *kind.get_or_insert(found) != found {
      continue;
    }
    if let Some(number) = Some(start).filter(|text| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())).and_then(|text| text.parse().ok()) {
      if !numbers.contains(&number) {
        numbers.push(number);
      }
    }
  }
  (kind.unwrap_or(Kind::Ts), numbers)
}

// Newer videos (.mp4) keep the original sound of all their muted pieces or of none (probe
// 2026-11-26: 41 videos, never some), so a few pieces spread over the video are asked first: all
// gone, the others are noted gone without asking (a 24 h stream has thousands)
const SAMPLE: usize = 5;
// count numbers spread from the first to the last (all of them when there are no more)
fn spread(numbers: &[u32], count: usize) -> Vec<u32> {
  if numbers.len() <= count {
    return numbers.to_vec();
  }
  (0..count).map(|index| numbers[index * (numbers.len() - 1) / (count - 1)]).collect()
}

// Room for a video's sound (bytes): half the cap, and never what newer videos use (above the cap
// tidy stops the oldest first, so older ones make way). Without it a very long stream would be saved
// whole, then stopped whole at the next tidy, and never saved again.
fn room(root: &Path, video: u64, cap: u64) -> u64 {
  let newer: u64 = folders(root).iter().filter(|(id, _)| *id > video).map(|(_, folder)| folder_size(folder)).sum();
  (cap / 2).min(cap.saturating_sub(newer))
}

#[tauri::command]
pub async fn save_muted_sound(app: tauri::AppHandle, video: String) -> Result<SavedSound, String> {
  save(sound_folder(&app)?, video).await
}

// root: the muted-sound folder
async fn save(root: PathBuf, video: String) -> Result<SavedSound, String> {
  if !video_id(&video) {
    return Err("not a Twitch video".into());
  }
  let mut report = SavedSound { muted: 0, saved: 0, gone: 0, waiting: 0, full: false };
  if root.join(&video).join(STOPPED).exists() {
    return Ok(report);
  }
  // Where its files are (next to its preview pictures, as player.js's rebuild), which also works
  // for subscriber-only videos
  let query = r#"query($id: ID!) { video(id: $id) { seekPreviewsURL broadcastType } }"#;
  let body = serde_json::json!({ "query": query, "variables": { "id": video } }).to_string();
  let client = super::video_window::player_client();
  let response = client.post("https://gql.twitch.tv/gql").header("Client-ID", CLIENT_ID).header("Content-Type", "application/json").body(body).send().await.map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    return Err(format!("Twitch answered {}", response.status().as_u16()));
  }
  let answer: serde_json::Value = serde_json::from_slice(&response.bytes().await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
  let files = &answer["data"]["video"];
  // Deleted or private (nothing to save), or a highlight or upload (Twitch mutes past streams)
  if files.is_null() || files["broadcastType"] != "ARCHIVE" {
    return Ok(report);
  }
  let address = reqwest::Url::parse(files["seekPreviewsURL"].as_str().ok_or("no files address")?).map_err(|e| e.to_string())?;
  let host = address.host_str().filter(|host| super::video_window::twitch_host(host)).ok_or("not Twitch's address")?;
  let parts: Vec<&str> = address.path_segments().ok_or("no files address")?.collect();
  let folder = parts.iter().position(|part| *part == "storyboards").filter(|at| *at > 0).map(|at| parts[at - 1]).ok_or("no files folder")?;
  let base = format!("https://{host}/{folder}/audio_only/");
  let response = client.get(format!("{base}index-dvr.m3u8")).send().await.map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    return Err(format!("audio-only list: {}", response.status().as_u16()));
  }
  let (kind, numbers) = muted_numbers(&response.text().await.map_err(|e| e.to_string())?);
  report.muted = numbers.len();
  if numbers.is_empty() {
    return Ok(report);
  }
  let here = root.join(&video);
  std::fs::create_dir_all(&here).map_err(|e| e.to_string())?;
  let gone: std::collections::HashSet<u32> = std::fs::read_to_string(here.join(GONE)).unwrap_or_default().lines().filter_map(|line| line.parse().ok()).collect();
  let file = |number: u32| here.join(format!("{number}.{}", kind.extension()));
  let mut left = Vec::new(); // neither saved nor gone yet, in the list's order
  for &number in &numbers {
    if file(number).exists() {
      report.saved += 1;
    } else if gone.contains(&number) {
      report.gone += 1;
    } else {
      left.push(number);
    }
  }
  let room = room(&root, video.parse().unwrap_or(0), CAP);
  let mut used = folder_size(&here);
  // .mp4: the spread few first (SAMPLE). .ts pieces lose their sound one by one: all in order.
  let sample = if kind == Kind::Mp4 && left.len() > SAMPLE { spread(&left, SAMPLE) } else { Vec::new() };
  let order: Vec<u32> = sample.iter().copied().chain(left.iter().copied().filter(|number| !sample.contains(number))).collect();
  let (mut sound, mut passing) = (false, false);
  for (index, &number) in order.iter().enumerate() {
    // The spread few done, none with its sound: the rest is gone too (or asked next time, when one
    // failed for a reason that may pass)
    if index == sample.len() && !sample.is_empty() && !sound {
      let rest = &order[index..];
      if passing {
        report.waiting += rest.len();
      } else {
        note_gone(&here, rest)?;
        report.gone += rest.len();
      }
      break;
    }
    if used >= room {
      report.full = true;
      break;
    }
    match save_piece(&here, &format!("{base}{}", kind.original(number)), &file(number), number).await? {
      Saved::Sound(size) => {
        used += size;
        report.saved += 1;
        sound = true;
      }
      Saved::Gone => report.gone += 1,
      Saved::Passing => {
        report.waiting += 1;
        passing = true;
      }
      Saved::Stopped => break,
    }
  }
  Ok(report)
}

enum Saved {
  Sound(u64), // its size
  Gone,
  Passing,
  Stopped, // Settings → Video's Delete, meanwhile
}

// One piece's sound into file, written whole first, so the player never finds half a piece
async fn save_piece(here: &Path, address: &str, file: &Path, number: u32) -> Result<Saved, String> {
  if here.join(STOPPED).exists() {
    return Ok(Saved::Stopped);
  }
  match download(address).await {
    Piece::Sound(bytes) => {
      let size = bytes.len() as u64;
      let part = here.join(format!("{number}.part"));
      std::fs::write(&part, bytes).and_then(|_| std::fs::rename(&part, file)).map_err(|e| e.to_string())?;
      // Stopped while it downloaded: not kept
      if here.join(STOPPED).exists() {
        let _ = std::fs::remove_file(file);
        return Ok(Saved::Stopped);
      }
      Ok(Saved::Sound(size))
    }
    Piece::Gone => {
      note_gone(here, &[number])?;
      Ok(Saved::Gone)
    }
    Piece::Passing => Ok(Saved::Passing),
  }
}

// Pieces refused both ways, added to gone.txt: never asked again
fn note_gone(here: &Path, numbers: &[u32]) -> Result<(), String> {
  use std::io::Write;
  let text: String = numbers.iter().map(|number| format!("{number}\n")).collect();
  std::fs::OpenOptions::new().create(true).append(true).open(here.join(GONE)).and_then(|mut gone| gone.write_all(text.as_bytes())).map_err(|e| e.to_string())
}

fn folder_size(folder: &Path) -> u64 {
  std::fs::read_dir(folder).into_iter().flatten().flatten().filter_map(|entry| entry.metadata().ok()).filter(|data| data.is_file()).map(|data| data.len()).sum()
}

// Its sound deleted, never downloaded again: the mark first, so a save running stops
fn stop(folder: &Path) -> Result<(), String> {
  std::fs::write(folder.join(STOPPED), "").map_err(|e| e.to_string())?;
  for entry in std::fs::read_dir(folder).map_err(|e| e.to_string())?.flatten() {
    if entry.file_name() != STOPPED {
      let _ = std::fs::remove_file(entry.path());
    }
  }
  Ok(())
}

// The videos' folders: (id, folder), oldest first (Twitch's ids grow with time)
fn folders(root: &Path) -> Vec<(u64, PathBuf)> {
  let mut list: Vec<(u64, PathBuf)> = std::fs::read_dir(root)
    .into_iter()
    .flatten()
    .flatten()
    .filter(|entry| entry.path().is_dir())
    .filter_map(|entry| {
      let name = entry.file_name().to_str()?.to_owned();
      Some((name.parse().ok().filter(|_| video_id(&name))?, entry.path()))
    })
    .collect();
  list.sort_by_key(|(id, _)| *id);
  list
}

// After each Video check (mutedSound.ts): the sound of videos no longer in the Video list deleted
// (keep: the Twitch ids still there), then above the cap the oldest videos' stopped. Its space used.
#[tauri::command]
pub async fn tidy_muted_sound(app: tauri::AppHandle, keep: Vec<String>) -> Result<u64, String> {
  tidy(&sound_folder(&app)?, &keep, CAP)
}

fn tidy(root: &Path, keep: &[String], cap: u64) -> Result<u64, String> {
  let mut kept = Vec::new();
  for (id, folder) in folders(root) {
    if keep.iter().any(|one| one == &id.to_string()) {
      kept.push((folder_size(&folder), folder));
    } else {
      std::fs::remove_dir_all(&folder).map_err(|e| e.to_string())?;
    }
  }
  let mut total: u64 = kept.iter().map(|(size, _)| size).sum();
  for (size, folder) in kept {
    if total <= cap {
      break;
    }
    if size > 0 {
      stop(&folder)?;
      total -= size;
    }
  }
  Ok(total)
}

// Settings → Video's line
#[tauri::command]
pub async fn muted_sound_space(app: tauri::AppHandle) -> Result<u64, String> {
  Ok(folders(&sound_folder(&app)?).iter().map(|(_, folder)| folder_size(folder)).sum())
}

// Settings → Video's Delete: all saved sound; those videos are never downloaded again (new ones are)
#[tauri::command]
pub async fn delete_muted_sound(app: tauri::AppHandle) -> Result<(), String> {
  for (_, folder) in folders(&sound_folder(&app)?) {
    stop(&folder)?;
  }
  Ok(())
}

// The player's "/saved/<video>" (the numbers of its saved pieces, one per line) and
// "/saved/<video>/<number>.ts" or ".mp4" (one piece's sound), from player_answer. Also open to any
// site in the player window: only digits pass, and all it gives is sound Twitch itself published.
pub fn saved_answer(app: &tauri::AppHandle, rest: &str) -> (u16, &'static str, Vec<u8>) {
  let digits = video_id;
  let number = |name: &str| name.strip_suffix(".ts").or_else(|| name.strip_suffix(".mp4")).filter(|number| digits(number)).map(str::to_owned);
  let Ok(root) = sound_folder(app) else { return (404, "text/plain", Vec::new()) };
  match rest.split_once('/') {
    None if digits(rest) => {
      let numbers: String = std::fs::read_dir(root.join(rest)).into_iter().flatten().flatten().filter_map(|entry| number(entry.file_name().to_str()?)).map(|number| format!("{number}\n")).collect();
      (200, "text/plain", numbers.into_bytes())
    }
    Some((video, piece)) if digits(video) && number(piece).is_some() => match std::fs::read(root.join(video).join(piece)) {
      Ok(bytes) => (200, if piece.ends_with(".mp4") { "video/mp4" } else { "video/mp2t" }, bytes),
      Err(_) => (404, "text/plain", Vec::new()),
    },
    _ => (404, "text/plain", Vec::new()),
  }
}

#[cfg(test)]
mod tests {
  use super::{muted_numbers, Kind};

  // Against Twitch itself: cargo test --lib muted_sound -- --ignored --nocapture, with
  // SYNCR_TEST_VIDEO=<a past stream's id with muted parts>. Saves into the system's temp folder.
  #[test]
  #[ignore]
  fn saves_from_twitch() {
    let video = std::env::var("SYNCR_TEST_VIDEO").expect("SYNCR_TEST_VIDEO");
    let root = std::env::temp_dir().join("syncr-muted-sound-test");
    let started = std::time::Instant::now();
    let report = tauri::async_runtime::block_on(super::save(root.clone(), video.clone())).unwrap();
    println!("first: muted {} saved {} gone {} waiting {} full {} in {:?}", report.muted, report.saved, report.gone, report.waiting, report.full, started.elapsed());
    let started = std::time::Instant::now();
    let again = tauri::async_runtime::block_on(super::save(root.clone(), video.clone())).unwrap();
    println!("again: muted {} saved {} gone {} waiting {} full {} in {:?}", again.muted, again.saved, again.gone, again.waiting, again.full, started.elapsed());
    println!("folder: {}", root.join(&video).display());
  }

  #[test]
  fn tidies_and_stops() {
    let root = std::env::temp_dir().join("syncr-muted-sound-tidy-test");
    let _ = std::fs::remove_dir_all(&root);
    for (video, pieces) in [("100", 3), ("200", 2), ("300", 2), ("400", 1)] {
      std::fs::create_dir_all(root.join(video)).unwrap();
      for piece in 0..pieces {
        std::fs::write(root.join(video).join(format!("{piece}.ts")), vec![0u8; 1000]).unwrap();
      }
    }
    std::fs::write(root.join("not-a-video.txt"), "x").unwrap();
    // 100 left the list; then 5000 bytes for a 3000 cap: the oldest kept one (200) is stopped
    let keep: Vec<String> = ["200", "300", "400"].map(String::from).to_vec();
    assert_eq!(super::tidy(&root, &keep, 3000).unwrap(), 3000);
    assert!(!root.join("100").exists());
    assert!(root.join("not-a-video.txt").exists());
    let left = |video: &str| {
      let mut names: Vec<String> = std::fs::read_dir(root.join(video)).unwrap().flatten().map(|entry| entry.file_name().to_string_lossy().into_owned()).collect();
      names.sort();
      names
    };
    assert_eq!(left("200"), vec!["stopped.txt"]);
    assert_eq!(left("300"), vec!["0.ts", "1.ts"]);
    // Under the cap: nothing more stopped; a stopped video is never asked again (no network here)
    assert_eq!(super::tidy(&root, &keep, 3000).unwrap(), 3000);
    let report = tauri::async_runtime::block_on(super::save(root.clone(), "200".into())).unwrap();
    assert_eq!((report.muted, report.saved), (0, 0));
    let _ = std::fs::remove_dir_all(&root);
  }

  #[test]
  fn finds_muted_pieces() {
    let list = "#EXTM3U\n#EXTINF:10.000,\n0.ts\n#EXTINF:10.000,\n1-unmuted.ts\n#EXTINF:10.000,\n2-muted.ts\n#EXTINF:10.000,\nhttps://x.cloudfront.net/f/audio_only/3-unmuted.ts\n1-unmuted.ts\n4-unmuted.mp4\nx-unmuted.ts\n";
    assert_eq!(muted_numbers(list), (Kind::Ts, vec![1, 2, 3]));
    // Newer videos: .mp4 names (a .ts one among them is left out), and a list with none
    assert_eq!(muted_numbers("0.mp4
5-unmuted.mp4
6-muted.mp4
7-unmuted.ts
5-unmuted.mp4
"), (Kind::Mp4, vec![5, 6]));
    assert_eq!(muted_numbers("#EXTM3U
0.mp4
"), (Kind::Ts, vec![]));
    assert_eq!(Kind::Mp4.original(12), "12-unmuted.mp4");
    assert_eq!(Kind::Ts.original(12), "12.ts");
  }

  #[test]
  fn spreads_the_sample() {
    let numbers: Vec<u32> = (0..=100).collect();
    assert_eq!(super::spread(&numbers, 5), vec![0, 25, 50, 75, 100]);
    assert_eq!(super::spread(&[7, 8, 9, 10, 11, 12], 5), vec![7, 8, 9, 10, 12]);
    assert_eq!(super::spread(&[1, 2, 3], 5), vec![1, 2, 3]);
  }

  #[test]
  fn gives_room() {
    let root = std::env::temp_dir().join("syncr-muted-sound-room-test");
    let _ = std::fs::remove_dir_all(&root);
    for (video, size) in [("100", 1000), ("200", 1500), ("300", 500)] {
      std::fs::create_dir_all(root.join(video)).unwrap();
      std::fs::write(root.join(video).join("0.mp4"), vec![0u8; size]).unwrap();
    }
    // At most half the cap, and never what newer videos use
    assert_eq!(super::room(&root, 300, 3000), 1500);
    assert_eq!(super::room(&root, 200, 3000), 1500);
    assert_eq!(super::room(&root, 100, 3000), 1000);
    assert_eq!(super::room(&root, 100, 1000), 0);
    let _ = std::fs::remove_dir_all(&root);
  }
}
