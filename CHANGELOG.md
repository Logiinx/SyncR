# Changelog

All notable changes to SyncR. Newest version first.

## [Unreleased]

### Added
- Cloud button in the title bar to connect (or disconnect) your Dropbox account. Syncing itself comes in a later version.
- Passphrase to encrypt your notes before they go to Dropbox. You create it on the first device and enter it once on each other device. A lock on the cloud button means this device still needs it.

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
