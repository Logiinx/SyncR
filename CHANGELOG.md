# Changelog

All notable changes to SyncR. Newest version first.

## [Unreleased]

### Fixed
- Phone version: an update installed shortly after another one could leave the app on a black screen. Updates now always download fresh files, and a broken update is rejected instead of installed.

## [0.5.1] - 2026-10-14

### Added
- Right-click an image (long press on the phone) → "Delete image".

### Changed
- Sync starts 1 second after you stop typing instead of 1.5 seconds, so changes reach your other devices a bit faster.

## [0.5.0] - 2026-10-14

### Added
- Images in notes: paste a screenshot or picture (Ctrl+V), drag an image file into a note, or use the image button in the new slim toolbar above the note (on the phone it lets you pick from your gallery or take a photo). Works anywhere in a note, also inside sections.
- Large images are made smaller to save space; screenshots stay sharp.
- Click or tap an image to see it full screen; click it again for its real size.
- Images sync to your other devices, encrypted like your notes. Until an image has arrived, the note shows "Image loading…".
- Images you remove from your notes are deleted automatically after a week.

### Changed
- Darker colors: the background and grays are a bit darker for a calmer, higher-contrast look.

## [0.4.0] - 2026-10-14

### Added
- Sync between your devices through your own Dropbox: connect it with the new cloud button in the title bar.
- Passphrase to encrypt your notes before they go to Dropbox. You create it on the first device and enter it once on each other device. A lock on the cloud button means this device still needs it.
- Automatic sync: your notes sync by themselves when the app opens, a few seconds after you stop typing, right away when you leave the note or the app (e.g. the phone's back button), when you come back to the window, and within seconds when your other device changes something. Your notes are encrypted before they go to Dropbox.
- The cloud button shows the sync status: ✓ synced, ↑ changes waiting to be sent, a crossed-out cloud when offline, and ! for an error (hover for details). Click it to sync right away; right-click (long press on a phone) for "Sync now" and "Disconnect Dropbox".
- If a note changed on both devices, the newest version keeps the note and the other one is saved as a separate "(conflict, …)" note, so nothing is lost. A note deleted on one device but edited on the other comes back.
- Before the app closes or installs an update, it sends your last changes to Dropbox first (it waits at most 5 seconds; if you're offline, they're sent next time).
- Phone version: open https://logiinx.github.io/SyncR/ and install it to your home screen (Samsung Internet: Menu → Add page to → Home screen). It works without internet, and shows "A new version of SyncR is available" with a Reload button after each release.

### Fixed
- No more white flash when the app starts: the window is dark from the first moment.

## [0.3.2] - 2026-10-13

### Changed
- Darker, near-black icon background for better contrast on the taskbar.

## [0.3.1] - 2026-10-13

### Fixed
- Window buttons (minimize, maximize, close) now share the same slightly thicker line weight. The maximize square is no longer clipped and has softly rounded corners like Windows 11.

## [0.3.0] - 2026-10-13

### Changed
- New SyncR icon: a note page between two arrows, white on dark.
- Custom title bar in the Windows app, merged with the tabs: drag empty space to move the window, double-click it to maximize. The minimize, maximize and close buttons match the app colors.
- The update banner now appears below the bar.

## [0.2.0] - 2026-10-13

### Added
- Notes, saved automatically on your device.
- Hidden sidebar (☰) with the note list, newest edits first, and a "New note" button. It pushes the note aside, or slides over it on narrow screens.
- Tabs at the top: open several notes, switch between them, close one with × or a middle-click, and create a note with "+".
- Open tabs, the active tab and each note's scroll position are restored after a restart. A note left at the bottom reopens at the bottom.
- Collapsible sections: select lines, then click "Section". Click the ▶ arrow or the title to open or close. Sections can be nested and are closed whenever a note opens. "Unwrap" removes a section and keeps its text.
- Rename a note: right-click a tab or sidebar note, or double-click a tab. Leave the name empty to use the first line again.
- Delete a note: right-click, then confirm.

### Changed
- Note text starts on the left and uses the full width.
- Pressing Enter goes to the next line with no extra gap.

## [0.1.1] - 2026-10-13

### Added
- The version number is shown in the app.

## [0.1.0] - 2026-10-13

### Added
- First Windows release: installer and automatic updates from GitHub Releases.
