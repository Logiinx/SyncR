// What the helper and SyncR must agree on. SyncR includes this file (src/hardware_helper.rs).

// Raise it on every change to the helper: SyncR then offers to update the installed one (one admin
// prompt). The same number means the same helper, so an unchanged helper never asks again.
pub const VERSION: u32 = 2;

// The local pipe SyncR asks through: one byte asks for one reading, the answer is one line
// "<VERSION> ok <°C>" or "<VERSION> <problem>" (problems below).
pub const PIPE: &str = r"\\.\pipe\SyncR-hardware";
pub const NO_PAWNIO: &str = "nopawnio"; // PawnIO's library is missing or its driver doesn't answer
pub const UNSUPPORTED: &str = "unsupported"; // PawnIO refused the AMD module: not a Ryzen
pub const FAILED: &str = "failed"; // this reading failed (busy, or the CPU didn't answer)

// Where the helper lives once set up: Program Files\FOLDER\EXE, started at login by the scheduled
// task TASK
pub const FOLDER: &str = "SyncR Hardware";
// Windows ignores case in file names: version 1's "syncr-hardware.exe" is the same file
pub const EXE: &str = "SyncR-Hardware.exe";
pub const TASK: &str = "SyncR Hardware";
