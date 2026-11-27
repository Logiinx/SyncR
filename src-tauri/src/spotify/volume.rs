// Spotify's volume in Windows' mixer (the sound of Spotify.exe, on each sound device it plays on),
// not the slider inside Spotify: that one is only reachable through Spotify's Web API, which needs
// Premium. Spotify has no sound in the mixer until it has played something: then None.
// Used by the reading thread only (COM, which it starts in spotify.rs).

use std::ffi::c_void;
use windows::core::Interface;
use windows::Win32::Media::Audio::{
  eRender, AudioSessionStateExpired, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume,
  MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};

const STEP: i32 = 2; // percent per wheel notch, like Windows' own volume

// The volume now, 0 to 100
pub fn read() -> Option<u8> {
  let first = sessions().into_iter().next()?;
  unsafe { first.GetMasterVolume() }.ok().map(percent)
}

// `notches` wheel notches up (or down when below 0): every Spotify sound gets the first one's
// volume plus the steps, so they stay together. The new volume, 0 to 100.
pub fn change(notches: i32) -> Option<u8> {
  let sessions = sessions();
  let now = unsafe { sessions.first()?.GetMasterVolume() }.ok().map(percent)?;
  let new = (now as i32 + notches * STEP).clamp(0, 100) as u8;
  for session in &sessions {
    let _ = unsafe { session.SetMasterVolume(new as f32 / 100.0, std::ptr::null()) };
  }
  Some(new)
}

fn percent(level: f32) -> u8 {
  (level * 100.0).round().clamp(0.0, 100.0) as u8
}

// Spotify's sounds on every working sound device (most often one)
fn sessions() -> Vec<ISimpleAudioVolume> {
  let mut found = Vec::new();
  unsafe {
    let Ok(enumerator) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else { return found };
    let Ok(devices) = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else { return found };
    for device in (0..devices.GetCount().unwrap_or(0)).filter_map(|i| devices.Item(i).ok()) {
      let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { continue };
      let Ok(list) = manager.GetSessionEnumerator() else { continue };
      for index in 0..list.GetCount().unwrap_or(0) {
        let Some(control) = list.GetSession(index).ok().and_then(|control| control.cast::<IAudioSessionControl2>().ok()) else { continue };
        if control.GetState().is_ok_and(|state| state == AudioSessionStateExpired) || !is_spotify(&control) {
          continue;
        }
        if let Ok(volume) = control.cast::<ISimpleAudioVolume>() {
          found.push(volume);
        }
      }
    }
  }
  found
}

// The sound's id holds the program's path ("…|\Device\…\Spotify.exe%b{…}"), also for the
// Microsoft Store version
fn is_spotify(control: &IAudioSessionControl2) -> bool {
  unsafe {
    let Ok(id) = control.GetSessionIdentifier() else { return false };
    if id.is_null() {
      return false;
    }
    let text = id.to_string().unwrap_or_default().to_lowercase();
    CoTaskMemFree(Some(id.0 as *const c_void));
    text.contains("\\spotify.exe")
  }
}
