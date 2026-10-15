# Changelog

All notable changes to SyncR. Newest version first.

## [Unreleased]

### Changed
- Links in notes are underlined only when the mouse is over them (on the phone they stay underlined).
- Hovering a link shows its address in a small popup, when the link text is something else.
- The note list shows each note's last edit date ("Today, 14:32", "Yesterday", …), its title in bold and the start of its text. The open note is marked with a blue bar.

### Added
- Settings: "Show dates in the note list" lets you hide the dates.
- Drag tabs to change their order. On the phone: hold a tab, then drag (hold and let go still opens its menu).
- New sync button design: a plain cloud with a small status dot in the corner. Green: synced. Blue: changes waiting. A turning blue ring: syncing. Red: error. Empty gray dot: offline. Orange padlock: enter your passphrase.

## [0.6.7] - 2026-10-14

### Changed
- Sync recovers by itself when Dropbox ends a session early, instead of showing an error for up to a few hours.
- Sync cleans up after itself: the small "this note was deleted" records in Dropbox are removed after 90 days.

### Added
- "Check for updates" at the bottom of the note list (☰): looks for a new version right away, on the PC and on the phone.

### Fixed
- If installing an update fails, the bar now says why and offers "Try again".
- Sync: if you edited a note at the very moment a newer version of it arrived from your other device, your edit could be replaced. Now it's kept, and the other version is saved as a conflict copy.
- Right-click menus open exactly at the mouse again when the app scaling isn't 100 %.
- Windows app: the window appears directly in its saved place, instead of first showing in the center and then jumping there.

## [0.6.6] - 2026-10-14

### Fixed
- Windows app: the window now really reopens with the size and position you left it in, also on a second monitor (this didn't work in 0.6.5).

## [0.6.5] - 2026-10-14

### Added
- Windows app: the window opens with the same size and position as when you closed it, also on a second monitor, and maximized if it was. If that monitor isn't connected anymore, it opens on the main one.
- Settings (bottom of the note list ☰): choose the font of your notes (System default, Sans-serif, Inter, Google Sans Flex, Literata or JetBrains Mono), the text size (12–24 px), and the app scaling (80–150 %) to make everything bigger or smaller. Each device keeps its own settings.

### Changed
- No more red spelling lines under words in your notes.

## [0.6.0] - 2026-10-14

### Added
- Toolbar buttons: Undo, Redo, Bold, Italic, Underline and Strikethrough. A button lights up when the cursor is in that kind of text. On a narrow phone screen, swipe the toolbar sideways to see all buttons.
- Checklists: use the checklist button, or type "[ ] " at the start of a line. Ticked items are dimmed but stay readable. Press Tab to indent an item under another.
- Links: paste a web address to make it a link, or paste it over selected text to turn that text into a link. Typed addresses become links too. Click (tap) a link to open it in your web browser.

## [0.5.2] - 2026-10-14

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
