// Long names scroll (Settings → Spotify, "Scroll long names", on by default), on the strip and the
// widget alike: a line too long for its room slides to its end, waits, slides back. Once when the
// song changes, then again and again while the mouse is over it; when the mouse leaves, it slides
// back home. Paused, Animations off or the setting off: still, cut with "…".
// Each line goes by its own length. Distances in DIPs (pixels at 100%); the caller turns them into
// its own pixels.

const SPEED: f32 = 30.0; // DIPs per second
const REST: f32 = 1.5; // the wait at each end (seconds)
const HOVER_WAIT: f32 = 0.5; // the mouse came over it: the first slide starts after this

// Where a line is in its trip
#[derive(Clone, Copy, PartialEq)]
enum Phase {
  Still, // home, cut with "…"
  Wait(f32), // home, about to slide (seconds left)
  Out,
  End(f32), // at its end (seconds left)
  Back,
}

#[derive(Clone, Copy)]
struct Line {
  phase: Phase,
  offset: f32, // how far it slid (DIPs)
  once: bool, // the song change's trip: goes on to the end even without the mouse
}

const HOME: Line = Line { phase: Phase::Still, offset: 0.0, once: false };

pub struct Scroll {
  song: Option<String>, // the song the lines belong to (a new one starts a trip)
  lines: [Line; 3],
  hover: bool,
}

// One line as drawn: None = still (cut with "…"), else how far it slid and how much is past its
// room in all (DIPs)
pub type Slid = Option<(f32, f32)>;

impl Scroll {
  pub const fn new() -> Scroll {
    Scroll { song: None, lines: [HOME; 3], hover: false }
  }

  // One frame. `song`: what identifies the song · `past`: how far each line goes past its room (0:
  // it fits) · `allowed`: setting on, Animations on and playing · `seconds`: since the last frame.
  pub fn step(&mut self, song: &str, past: [f32; 3], hover: bool, allowed: bool, seconds: f32) -> [Slid; 3] {
    let new_song = self.song.as_deref() != Some(song);
    if new_song {
      self.song = Some(song.to_string());
    }
    let came = hover && !self.hover;
    self.hover = hover;
    for (line, &past) in self.lines.iter_mut().zip(past.iter()) {
      if !allowed || past <= 0.0 {
        *line = HOME;
        continue;
      }
      if new_song {
        *line = Line { phase: Phase::Wait(REST), offset: 0.0, once: true };
      } else if came && line.phase == Phase::Still {
        line.phase = Phase::Wait(HOVER_WAIT);
      }
      // The mouse left a trip it started: home now, or slide back
      if !hover && !line.once {
        line.phase = match line.phase {
          Phase::Wait(_) => Phase::Still,
          Phase::Out | Phase::End(_) => Phase::Back,
          phase => phase,
        };
      }
      line.offset = line.offset.min(past); // the room may have grown (another scale)
      line.phase = match line.phase {
        Phase::Still => Phase::Still,
        Phase::Wait(left) if left > seconds => Phase::Wait(left - seconds),
        Phase::Wait(_) => Phase::Out,
        Phase::Out => {
          line.offset = (line.offset + SPEED * seconds).min(past);
          if line.offset >= past { Phase::End(REST) } else { Phase::Out }
        }
        Phase::End(left) if left > seconds => Phase::End(left - seconds),
        Phase::End(_) => Phase::Back,
        Phase::Back => {
          line.offset = (line.offset - SPEED * seconds).max(0.0);
          if line.offset > 0.0 {
            Phase::Back
          } else {
            line.once = false;
            if hover { Phase::Wait(REST) } else { Phase::Still }
          }
        }
      };
    }
    let mut slid = [None; 3];
    for (index, line) in self.lines.iter().enumerate() {
      if line.phase != Phase::Still {
        slid[index] = Some((line.offset, past[index]));
      }
    }
    slid
  }

  // Something is on its way: frames are needed
  pub fn moving(&self) -> bool {
    self.lines.iter().any(|line| line.phase != Phase::Still)
  }

  // Gone (hidden): the next song shown counts as new
  pub fn reset(&mut self) {
    *self = Scroll::new();
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  // Runs frames of 1/60 s for `seconds`, returns the title line's last state
  fn run(scroll: &mut Scroll, past: f32, hover: bool, seconds: f32) -> Slid {
    let mut last = None;
    for _ in 0..(seconds * 60.0).round() as usize {
      last = scroll.step("song", [past, 0.0, 0.0], hover, true, 1.0 / 60.0)[0];
    }
    last
  }

  #[test]
  fn one_trip_at_a_new_song_then_still() {
    let mut scroll = Scroll::new();
    assert_eq!(run(&mut scroll, 30.0, false, 0.5), Some((0.0, 30.0))); // waiting, no "…"
    let (offset, _) = run(&mut scroll, 30.0, false, 1.5).unwrap(); // 1 s wait left, then sliding
    assert!(offset > 0.0 && offset < 30.0);
    assert_eq!(run(&mut scroll, 30.0, false, 1.0), Some((30.0, 30.0))); // at its end, waiting
    assert_eq!(run(&mut scroll, 30.0, false, 3.0), None); // back home and still
    assert!(!scroll.moving());
  }

  #[test]
  fn hover_goes_on_then_slides_back_when_the_mouse_leaves() {
    let mut scroll = Scroll::new();
    run(&mut scroll, 30.0, false, 6.0); // the song change's trip is over
    assert_eq!(run(&mut scroll, 30.0, false, 0.1), None);
    run(&mut scroll, 30.0, true, 1.2); // moving out
    let (offset, _) = run(&mut scroll, 30.0, false, 0.1).unwrap();
    assert!(offset > 0.0);
    assert_eq!(run(&mut scroll, 30.0, false, 2.0), None); // slid back home
  }

  #[test]
  fn a_line_that_fits_or_a_paused_song_stays_still() {
    let mut scroll = Scroll::new();
    assert_eq!(run(&mut scroll, 0.0, true, 3.0), None);
    let slid = scroll.step("other", [40.0, 0.0, 0.0], true, false, 0.1);
    assert_eq!(slid[0], None);
  }
}
