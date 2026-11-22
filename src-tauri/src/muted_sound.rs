// Muted sound saved ahead (src/mutedSound.ts): for a finished Twitch video of a channel with "Save
// the sound of muted parts" on, the original sound of its muted pieces, downloaded from its
// audio-only folder before Twitch deletes it (often within hours). Older .ts videos only. Kept in
// the app's data folder, muted-sound/<video>/<piece number>.ts, never synced. A piece Twitch refused
// both ways is noted in gone.txt and never asked again; one that failed for a reason that may pass
// (network, too many requests, Twitch busy) is asked again at the next check.
use std::path::PathBuf;
use tauri::Manager;

const CLIENT_ID: &str = "kimne78kx3ncx6brgo4mv6wki5h1ko"; // the one Twitch's own website uses (as player.js)
const GONE: &str = "gone.txt";

#[derive(serde::Serialize)]
pub struct SavedSound {
  muted: usize,   // muted pieces in the video's audio-only list
  saved: usize,   // of those, saved on this PC
  gone: usize,    // refused by Twitch both ways: never asked again
  waiting: usize, // failed for a reason that may pass: asked again next time
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

// The numbers of the muted pieces in an audio-only list: "123-unmuted.ts" (or "-muted"), maybe as a
// full address. Each once, in the list's order.
fn muted_numbers(list: &str) -> Vec<u32> {
  let mut numbers = Vec::new();
  for line in list.lines().filter(|line| !line.starts_with('#')) {
    let name = line.trim().rsplit('/').next().unwrap_or("");
    let number = name.strip_suffix("-unmuted.ts").or_else(|| name.strip_suffix("-muted.ts"));
    if let Some(number) = number.filter(|text| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())).and_then(|text| text.parse().ok()) {
      if !numbers.contains(&number) {
        numbers.push(number);
      }
    }
  }
  numbers
}

#[tauri::command]
pub async fn save_muted_sound(app: tauri::AppHandle, video: String) -> Result<SavedSound, String> {
  save(sound_folder(&app)?, video).await
}

// root: the muted-sound folder
async fn save(root: PathBuf, video: String) -> Result<SavedSound, String> {
  if video.is_empty() || video.len() > 20 || !video.bytes().all(|byte| byte.is_ascii_digit()) {
    return Err("not a Twitch video".into());
  }
  let mut report = SavedSound { muted: 0, saved: 0, gone: 0, waiting: 0 };
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
  let numbers = muted_numbers(&response.text().await.map_err(|e| e.to_string())?);
  report.muted = numbers.len();
  if numbers.is_empty() {
    return Ok(report);
  }
  let here = root.join(&video);
  std::fs::create_dir_all(&here).map_err(|e| e.to_string())?;
  let mut gone: Vec<u32> = std::fs::read_to_string(here.join(GONE)).unwrap_or_default().lines().filter_map(|line| line.parse().ok()).collect();
  for number in numbers {
    let file = here.join(format!("{number}.ts"));
    if file.exists() {
      report.saved += 1;
      continue;
    }
    if gone.contains(&number) {
      report.gone += 1;
      continue;
    }
    match download(&format!("{base}{number}.ts")).await {
      Piece::Sound(bytes) => {
        // Written whole first, so the player never finds half a piece
        let part = here.join(format!("{number}.part"));
        std::fs::write(&part, bytes).and_then(|_| std::fs::rename(&part, &file)).map_err(|e| e.to_string())?;
        report.saved += 1;
      }
      Piece::Gone => {
        gone.push(number);
        let text: String = gone.iter().map(|number| format!("{number}\n")).collect();
        std::fs::write(here.join(GONE), text).map_err(|e| e.to_string())?;
        report.gone += 1;
      }
      Piece::Passing => report.waiting += 1,
    }
  }
  Ok(report)
}

// The player's "/saved/<video>" (the numbers of its saved pieces, one per line) and
// "/saved/<video>/<number>.ts" (one piece's sound), from player_answer. Also open to any site in the
// player window: only digits pass, and all it gives is sound Twitch itself published.
pub fn saved_answer(app: &tauri::AppHandle, rest: &str) -> (u16, &'static str, Vec<u8>) {
  let digits = |text: &str| !text.is_empty() && text.len() <= 20 && text.bytes().all(|byte| byte.is_ascii_digit());
  let Ok(root) = sound_folder(app) else { return (404, "text/plain", Vec::new()) };
  match rest.split_once('/') {
    None if digits(rest) => {
      let numbers: String = std::fs::read_dir(root.join(rest))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| entry.file_name().to_str()?.strip_suffix(".ts").filter(|number| digits(number)).map(|number| format!("{number}\n")))
        .collect();
      (200, "text/plain", numbers.into_bytes())
    }
    Some((video, piece)) if digits(video) && piece.strip_suffix(".ts").is_some_and(digits) => match std::fs::read(root.join(video).join(piece)) {
      Ok(bytes) => (200, "video/mp2t", bytes),
      Err(_) => (404, "text/plain", Vec::new()),
    },
    _ => (404, "text/plain", Vec::new()),
  }
}

#[cfg(test)]
mod tests {
  use super::muted_numbers;

  // Against Twitch itself: cargo test --lib muted_sound -- --ignored --nocapture, with
  // SYNCR_TEST_VIDEO=<a past stream's id with muted parts>. Saves into the system's temp folder.
  #[test]
  #[ignore]
  fn saves_from_twitch() {
    let video = std::env::var("SYNCR_TEST_VIDEO").expect("SYNCR_TEST_VIDEO");
    let root = std::env::temp_dir().join("syncr-muted-sound-test");
    let started = std::time::Instant::now();
    let report = tauri::async_runtime::block_on(super::save(root.clone(), video.clone())).unwrap();
    println!("first: muted {} saved {} gone {} waiting {} in {:?}", report.muted, report.saved, report.gone, report.waiting, started.elapsed());
    let started = std::time::Instant::now();
    let again = tauri::async_runtime::block_on(super::save(root.clone(), video.clone())).unwrap();
    println!("again: muted {} saved {} gone {} waiting {} in {:?}", again.muted, again.saved, again.gone, again.waiting, started.elapsed());
    println!("folder: {}", root.join(&video).display());
  }

  #[test]
  fn finds_muted_pieces() {
    let list = "#EXTM3U\n#EXTINF:10.000,\n0.ts\n#EXTINF:10.000,\n1-unmuted.ts\n#EXTINF:10.000,\n2-muted.ts\n#EXTINF:10.000,\nhttps://x.cloudfront.net/f/audio_only/3-unmuted.ts\n1-unmuted.ts\n4-unmuted.mp4\nx-unmuted.ts\n";
    assert_eq!(muted_numbers(list), vec![1, 2, 3]);
  }
}
