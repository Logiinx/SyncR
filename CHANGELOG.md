# Changelog

All notable changes to SyncR. Newest version first.

## [Unreleased]

### Added
- Board: a panel on the right for small cards (quick tasks, priority things). Open it with the small ‹ tab in the middle of the window's right edge; the › tab on its left edge hides it again. On the PC it sits beside the note and you can drag its left edge to make it wider or narrower; on the phone it slides over the note. "+" adds a card; cards use the same editor as notes (checklists, bold, links…) and save as you type. ✕ deletes a card, with "Undo" for 5 seconds. Cards stay on this device for now (sync comes later).

## [0.9.5] - 2026-10-16

### Fixed
- The PC version of 0.9.4 never came out: its build failed because the `zip` package (used by the updater) withdrew all its older versions. The updater no longer uses it (it only unpacked .zip updates, and SyncR's updates are a plain installer). This update brings the 0.9.4 changes below to the PC. Nothing new on the phone.

## [0.9.4] - 2026-10-16

### Added
- Settings → Window: "Start hidden in the tray" (off by default). With "Start with Windows" on, SyncR now opens its window when you sign in to Windows; turn this on to have it start quietly in the tray instead, as before.

### Changed
- Bullet and numbered lists no longer leave a gap above and below them. Browsers give lists a default margin of 1em (one line of text) at the top and bottom; it's now 0, so a list sits right against the lines around it, like lines that start with a plain "-".
- Phone: the sync status dot on the cloud button is bigger and uses stronger colors (a vivid green for synced, a vivid blue for waiting). The softer PC colors had the same brightness and looked alike on bright phone screens. The PC is unchanged.

## [0.9.3] - 2026-10-15

### Fixed
- The reminder pop-up on the PC was empty (no text, no buttons, no sound). It was opened from a different internal address than the main window (`http://` instead of `https://tauri.localhost`), and since each address gets its own local database, it found no reminders. It now uses the same address, so it shows the reminders.

## [0.9.2] - 2026-10-15

### Added
- Reminder pop-up on the PC: when a reminder is due, a small window appears in the bottom-right corner of the screen, on top of other windows, even when SyncR is minimized or hidden in the tray. It doesn't take the keyboard away from what you're typing. Buttons: Done, Snooze (10 min / 1 hour / tomorrow at the same time) and Open SyncR. It stays until you click Done or Snooze, and grows to fit several reminders.
- A short chime when a reminder comes due (pop-up on the PC, card in the browser / on the phone). Settings → Reminders → "Sound when a reminder is due" turns it off; turning it on plays it once as a preview.
- Tray icon on the PC: click it to open SyncR; right-click for "Open SyncR" and "Quit SyncR".
- Settings → Window (PC only): "✕ hides SyncR in the tray" (off by default): ✕ then hides the window instead of quitting, so reminders and sync keep running in the background. "Start with Windows": SyncR starts hidden in the tray when you sign in to Windows.
- Starting SyncR while it's already running (e.g. from the Start menu while it's in the tray) now brings up the running one instead of opening a second copy.

## [0.9.1] - 2026-10-15

### Added
- Reminders: a small "Reminders" section at the bottom of the note list (click the header to fold it). The + button adds one: what to remember, a date and time, and an optional note (shown when hovering over the reminder). Reminders are listed soonest first; overdue ones show their time in red. Click a reminder to edit it; right-click for Done / Not done and Delete. Done reminders move into a folded "Done" group with a Clear button. Tick "Also on my phone (Google Calendar)" to add the reminder to Google Calendar: saving opens Calendar with the event filled in (a 15-minute event at the reminder's time, with the note as description), and you tap Save there. Your phone then notifies you through the Calendar app. This is a one-way link: changing, snoozing or deleting the reminder in SyncR doesn't change the calendar event (the dialog says when to delete the old one). Reminders on your phone show a small phone icon; right-click → "Add to Google Calendar" opens Calendar again. Reminders sync between devices, end-to-end encrypted like notes (the Google Calendar copy is not encrypted).
- When a reminder is due and SyncR is open, a card appears in the bottom-right corner with the text, time and note: Done, or Snooze for 10 min, 1 hour, or until tomorrow at the same time. It stays until you click one. Reminders that came due while SyncR was closed show up when you open it. Done or snoozed on one device, the card also disappears on the other. (A pop-up while SyncR is in the background comes in a later update.)

## [0.9.0] - 2026-10-15

### Added
- Settings → Typing → "Smart typography" (off by default, per device): while typing, `--` becomes —, `->` becomes →, `...` becomes …, `1/2` becomes ½, `(c)` becomes ©, and straight quotes become curly quotes. Not applied inside code. Backspace right after a replacement undoes it.
- Code blocks with syntax highlighting. Each has a header like a section: ▶ folds it (showing the number of lines), and a menu picks the language (Bash, C, C++, C#, CSS, Go, HTML/XML, Java, JavaScript, JSON, Markdown, PowerShell, Python, Rust, SQL, TypeScript, YAML, or plain text). New code button in the selection menu: turns the selected lines into one code block (only plain text and lists, so images, tables or sections are never flattened), or a code block back into normal lines. Inside code, the selection menu hides bold/italic/underline/color, which don't apply there. Tab indents by 2 spaces inside code. Typing ``` and a space still creates one.
- Move sections by dragging: a ⋮⋮ grip appears left of a section's title (on hover with a mouse; on the phone, for the section the cursor is in). A blue line shows where it will land, anywhere between blocks, also inside another section. The whole section moves with its content; Ctrl+Z puts it back.
- "/" menu: type / at the start of a line or after a space to insert a Section, Code block, Checklist, Bullet list, Numbered list, Table, Heading 1–3, Quote or Divider. Typing more filters the list (e.g. /tab), ↑ ↓ choose, Enter inserts, Esc closes. Only what fits at the cursor is offered (e.g. no Quote inside a list). It doesn't open in code, after a digit (1/2) or inside a web address.
- Links between notes: select some text, then the link button in the selection menu copies a link to that exact spot (paragraph, list item, heading, section, …). Paste it in any note: it shows as "Note title › start of the text". Clicking it opens the note, unfolds the sections around the spot, scrolls to it and briefly highlights it. Hovering shows the target note's name. If the note or the spot was deleted, the link is grayed out and struck through, and clicking it says so.
- Type [[ to link to a note: a list of notes, filtered as you type. Enter links to the whole note; Tab, → or the › button shows the note's headings and sections, and Enter links to that one.

### Changed
- One way to create a note: the big "+ New note" button in the sidebar is gone, the "+" after the tabs is now an icon and sits outside the scrolling tab strip, so it stays visible when many tabs are open. When no note is open, the page shows a "New note" button.

## [0.8.2] - 2026-10-15

### Changed
- The program file is now called SyncR.exe instead of syncr.exe.
- Faster desktop builds (~6 min → ~3 min): the Rust build cache is now saved on `main` (tag builds could only restore a stale `main` cache, so ~90 crates were recompiled each release), and the Rust toolchain is pinned to 1.99.0 so new stable releases no longer invalidate the cache.

## [0.8.1] - 2026-10-15

### Changed
- Bullet and numbered lists line up with the text: the bullet stays where you typed the "-" instead of moving inward.
- Pressing Enter on the first, still empty item of a list adds a second item instead of removing the list. Further down, Enter on an empty item still ends the list.
- Typing "1." or "-" and pressing Enter makes the list and goes straight to the next item (before, Enter only made the list). Shift+Enter works the same way here.
- Settings are grouped into sections (Appearance, Note list, Notes, About), each saying whether it applies to this device or all devices. The version and "Check for updates" moved from the bottom of the note list into Settings → About.
- The text size and app scaling sliders have a slim bar as handle and a ruler underneath showing every value you can pick, with a longer mark at the default (16 px, 100 %).
- The menu for selected text has bold, italic and underline buttons, and looks like the toolbar: icons only, with the section buttons after a thin line.
- The color button (menu and toolbar) is now a palette, so it can't be mistaken for underline.

### Fixed
- Opening the note list while at the bottom of a long note no longer moves the end of the note out of view.

## [0.8.0] - 2026-10-15

### Added
- Text colors and a highlighter (8 colors each). Select text and use the new color button in the menu above it, or the color button in the toolbar.
- Tables. Insert one with the new table button in the toolbar (the first row is a header). Right-click a cell (long press on the phone) to add or delete rows and columns, switch the header row on or off, color the cell or delete the table. Tab jumps to the next cell, and adds a row at the end. Drag the line between two columns to resize them.
- Color rules (Settings → Color rules): words like "Fire" get a color automatically in all your notes. Rules are kept in groups that you can switch on and off, and switching off removes the colors right away. Words you colored by hand keep their color. Rules sync between your devices.

### Changed
- The menu for selected text now appears below the selection, so it doesn't cover the text.
- Selected text keeps its color (it used to turn white), so a new color shows right away.

## [0.7.0] - 2026-10-15

### Changed
- Links in notes are underlined only when the mouse is over them (on the phone they stay underlined).
- Hovering a link shows its address in a small popup, when the link text is something else.
- The note list shows each note's last edit date ("Today, 14:32", "Yesterday", …), its title in bold and the start of its text. The open note is marked with a blue bar.
- New sync button design: a plain cloud with a small status dot in the corner. Green: synced. Blue: changes waiting. A turning blue ring: syncing. Red: error. Empty gray dot: offline. Orange padlock: enter your passphrase.
- Hovering the sync button shows its status and when the last sync was ("Synced · 2 min ago"), in a small box instead of the plain tooltip.
- The message after clicking the sync button is shorter ("✓ 2 sent · 1 received", "✓ Up to date"), sits right under the button and fades in and out after 3 seconds.

### Added
- Settings: "Show dates in the note list" lets you hide the dates.
- Drag tabs to change their order. On the phone: hold a tab, then drag (hold and let go still opens its menu).

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
