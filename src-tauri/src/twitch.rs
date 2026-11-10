// A past stream's main playlist for the own Twitch player (/twitch/<id>.m3u8 in video_window.rs).
// It needs a token from Twitch first: the plain question, and if Twitch refuses that one, the saved
// ("persisted") question Twitch's own website uses. A fresh token for each playlist: only this first
// playlist uses it, so it can't run out while a video plays.

use serde_json::{json, Value};

const CLIENT_ID: &str = "kimne78kx3ncx6brgo4mv6wki5h1ko"; // the one Twitch's own website uses

// The saved question's name. Twitch changes it now and then: when it stops working, take the new
// one from a "PlaybackAccessToken" request on twitch.tv (the browser's network tools).
const SAVED_QUESTION: &str = "0828119ded1c13477966434e15800ff57ddacf13ba1911c129dc2200705b0712";

pub struct Token {
  pub value: String,
  pub signature: String,
}

#[derive(Debug, PartialEq)]
enum Answer {
  Token(String, String),
  NoVideo,  // deleted, or never existed: asking again won't help
  Refused,  // an error from Twitch: the other question may work
}

pub fn valid_video(video: &str) -> bool {
  (1..=20).contains(&video.len()) && video.bytes().all(|byte| byte.is_ascii_digit())
}

fn plain_question(video: &str) -> Value {
  json!({
    "query": "query($id: ID!) { videoPlaybackAccessToken(id: $id, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: \"site\"}) { value signature } }",
    "variables": { "id": video },
  })
}

fn saved_question(video: &str) -> Value {
  json!({
    "operationName": "PlaybackAccessToken",
    "extensions": { "persistedQuery": { "version": 1, "sha256Hash": SAVED_QUESTION } },
    "variables": { "isLive": false, "login": "", "isVod": true, "vodID": video, "playerType": "site" },
  })
}

fn read_answer(answer: &Value) -> Answer {
  if answer.get("errors").and_then(Value::as_array).is_some_and(|errors| !errors.is_empty()) {
    return Answer::Refused;
  }
  match answer.pointer("/data/videoPlaybackAccessToken") {
    Some(Value::Null) => Answer::NoVideo,
    Some(token) => match (token["value"].as_str(), token["signature"].as_str()) {
      (Some(value), Some(signature)) => Answer::Token(value.to_string(), signature.to_string()),
      _ => Answer::Refused,
    },
    None => Answer::Refused,
  }
}

async fn ask(client: &reqwest::Client, question: &Value) -> Option<Value> {
  let response = client
    .post("https://gql.twitch.tv/gql")
    .header("Client-ID", CLIENT_ID)
    .header("Content-Type", "application/json")
    .body(question.to_string())
    .send()
    .await
    .ok()?;
  serde_json::from_slice(&response.bytes().await.ok()?).ok()
}

// Ok(None): the video doesn't exist. Err: Twitch refused both questions, or no network.
pub async fn token(client: &reqwest::Client, video: &str) -> Result<Option<Token>, ()> {
  for question in [plain_question(video), saved_question(video)] {
    match ask(client, &question).await.as_ref().map(read_answer) {
      Some(Answer::Token(value, signature)) => return Ok(Some(Token { value, signature })),
      Some(Answer::NoVideo) => return Ok(None),
      Some(Answer::Refused) | None => {}
    }
  }
  Err(())
}

// Only the video's own qualities, no audio-only one
pub fn usher_url(video: &str, token: &Token) -> String {
  let params = [
    ("nauth", token.value.as_str()),
    ("nauthsig", token.signature.as_str()),
    ("allow_source", "true"),
    ("allow_audio_only", "false"),
  ];
  reqwest::Url::parse_with_params(&format!("https://usher.ttvnw.net/vod/{video}.m3u8"), params)
    .map(|url| url.to_string())
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn video_ids() {
    assert!(valid_video("2268401234"));
    assert!(!valid_video(""));
    assert!(!valid_video("12a4"));
    assert!(!valid_video("../secret"));
    assert!(!valid_video("123456789012345678901"));
  }

  #[test]
  fn reads_a_token() {
    let answer = json!({ "data": { "videoPlaybackAccessToken": { "value": "{\"a\":1}", "signature": "abc" } } });
    assert_eq!(read_answer(&answer), Answer::Token("{\"a\":1}".into(), "abc".into()));
  }

  #[test]
  fn reads_a_missing_video() {
    assert_eq!(read_answer(&json!({ "data": { "videoPlaybackAccessToken": null } })), Answer::NoVideo);
  }

  #[test]
  fn reads_a_refusal() {
    assert_eq!(read_answer(&json!({ "errors": [{ "message": "PersistedQueryNotFound" }] })), Answer::Refused);
    assert_eq!(read_answer(&json!({ "error": "Unauthorized", "status": 401 })), Answer::Refused);
    assert_eq!(read_answer(&json!({ "data": { "videoPlaybackAccessToken": { "value": "x" } } })), Answer::Refused);
  }

  #[test]
  fn saved_question_names_the_video() {
    let question = saved_question("42");
    assert_eq!(question["variables"]["vodID"], "42");
    assert_eq!(question["extensions"]["persistedQuery"]["sha256Hash"], SAVED_QUESTION);
  }

  #[test]
  fn usher_address_is_encoded() {
    let token = Token { value: "{\"v\":\"a&b\"}".into(), signature: "sig".into() };
    let url = usher_url("42", &token);
    assert!(url.starts_with("https://usher.ttvnw.net/vod/42.m3u8?nauth="));
    assert!(url.contains("%7B%22v%22%3A%22a%26b%22%7D"));
    assert!(url.contains("&nauthsig=sig&allow_source=true&allow_audio_only=false"));
  }
}
