# Changelog

All notable changes to SyncR. Newest version first.

## [Unreleased]

### Added
- Board: card groups. Right-click a card (⋯ on the phone) → "Move to group…" to put it in a new or existing group, or take it out again. Click a group's header to fold its cards away; a folded group looks like a small pile of cards with the number of cards in it. Inside a group, priority cards stay on top, as on the Board. Groups can be dragged like cards. Right-click a group's header ("⋯" on the phone) to rename it, make it a priority, or delete it. When deleting, you choose whether its cards are deleted too or go back on the Board; "Undo" brings everything back. **Update the app on both PC and phone:** an older version shows a group as an empty card.

### Changed
- Board: clicking a card's title folds or unfolds it (not just the small arrow). To rename the title, use "Edit title" in the card's menu.
- Board: the ✕ and ✨ buttons on cards are gone, for a cleaner Board. Delete (or Unpin) and priority are in the card's menu: right-click on the PC, "⋯" on the phone (game cards got the "⋯" too).
- Board: the menus of cards and groups are sorted into groups of actions, with thin lines between them (edit · title · priority and group · delete).

## [0.12.19] - 2026-10-19

### Changed
- The menu that popped up over selected text is gone (it covered the text and got cut off after Ctrl+A). Its buttons are now in the toolbar, sorted into groups: undo · text style · what the lines are (checklist, section, code block, separate lines) · insert (table, image) · use elsewhere (copy link, pin to Board). Buttons that can't be used right now are grayed out, so the others never move. With nothing selected, section, code block, separate lines and copy link act on the line the cursor is in. Section and code block are one button each: lit when the cursor is inside one, click again to turn it back into normal lines.
- Phone: the toolbar keeps undo, text style and checklist; the other buttons are in a "⋯" list, which only shows what can be used right now.

## [0.12.18] - 2026-10-19

### Added
- Selection menu: a "Separate lines" button turns line breaks (Shift+Enter, or text pasted from Notesnook or web pages) into real lines. Both look the same, but lines joined by line breaks are one paragraph: triple-click selected all of them, and a heading, list or section applied to all of them at once. The button only shows when the selection contains line breaks; Ctrl+Z undoes it. In a list item, the lines stay in the same item.

### Changed
- Shift+Enter now makes a new line, like Enter, so pressing it out of habit no longer joins lines into one paragraph. Inside a list or checklist item it still makes a line break (a new line without a new bullet), and code blocks work as before. Ctrl+Enter still makes a line break anywhere. Also in Board cards.
- Pasted text with line breaks (from Notesnook, many web pages) now becomes separate lines, as if you had pressed Enter between them. Same rule as the "Separate lines" button: in a list item the lines stay in the same item, headings keep their line breaks, and pasting into a code block works as before.

### Fixed
- Typing "- " (or "1. ", "[ ] ") right after a line break made a list whose first line had the same hidden link id as the line above, so a link to that spot could jump to the wrong line.

## [0.12.17] - 2026-10-18

### Fixed
- Sync: an edit you were typing at the very moment a sync ran is no longer lost. Before, the half-second of typing still waiting to be saved was invisible to sync: a newer version from your other device could be stored and then overwritten by that save (the other device's edit vanished, without a conflict copy), and a note deleted on your other device was deleted here even though you had just typed in it (your words were dropped). Sync now saves waiting edits first, so these become a normal conflict copy, and an edit beats a deletion as intended.
- Sync: deleting a note no longer deletes an edit your other device saved a moment earlier. The deletion now tells Dropbox "only if the note is still the version I saw" (its revision); if it changed, the edit wins and the note comes back, as with other edit-versus-deletion cases.
- Sync: a conflict no longer creates the same conflict copy twice. When the step after making the copy failed (your other device saved again a moment later) or was skipped (you kept typing), the retry made a second, identical copy. A conflict copy's id now comes from the note and the time of the version it keeps, so a retry finds the copy it already made.
- Sync: one file in Dropbox that can't be decrypted (for example saved with another passphrase, or put in the folder by hand) no longer stops all syncing. Before, sync stopped at that file with a cryptic error ("The operation failed for an operation-specific reason") and retried every minute, so nothing after it ever synced. Now such files are skipped and left untouched, everything else syncs, and a message says how many items couldn't be read.
- Dropbox: you're no longer signed out by a passing error. The app renews its Dropbox access every few hours; any "400" error answer during that renewal used to erase the sign-in, although Dropbox also uses 400 for temporary problems. Now only Dropbox's "invalid_grant" answer (the sign-in was really revoked) signs you out; other errors are retried later.

## [0.12.16] - 2026-10-18

### Added
- Search across all notes: a search box in the sidebar (Ctrl+Shift+F on the PC opens it). Only the matching notes stay in the list, each with the text around the match and the found words in bold. Case and accents don't matter ("ete" finds "été"), and with several words a note must contain all of them, in any order. The search stays while you open notes, until you clear it (✕ or Escape).
- Opening a search result scrolls the note to the match and makes it pulse in blue three times (fading in and out, about 3.5 seconds). With several words, it goes to the first line that has all of them (the snippet in the list shows that same spot). Collapsed sections around the match open. The cursor doesn't move there, so the phone keyboard stays closed.

### Fixed
- Phone: after picking a text color or highlight (in notes and cards), the color shows right away. Android draws its own selection (white text on blue) and ignores the app's selection style, so the new color stayed hidden until you unselected. Now the selection collapses to a cursor at the end of the colored text. On the PC the selection stays as before.

## [0.12.15] - 2026-10-18

### Changed
- Board on the phone: a long press on a card's text now only opens Android's own menu (copy, paste…), no longer the card's menu on top of it. The card's menu (title, priority, delete) moved to a new "⋯" button next to the flag and ✕. On the PC, right-click works as before.

## [0.12.14] - 2026-10-18

### Added
- Board on the phone: a "New card" button at the bottom of the panel, within reach of your thumb. The "+" at the top is still there.
- Phone: swipe right from the left third of the screen to open the sidebar, swipe left on it to close it (like the Board on the right side).
- Board: colored text in cards. While editing a card, select some text and a row of colors appears under it (the same colors as in notes).

## [0.12.13] - 2026-10-17

### Changed
- Games → My games: one status at a time. Tabs at the top ("Waiting 7 | To play 6 | …", with counts) replace the long page of collapsible groups, so there's much less scrolling. Your games show as big covers, 6 per row on the PC, with the countdown (Waiting), the year, or your stars underneath. Priority games get a blue ring. A switch on the right of the tabs goes back to the list with dates and notes. The tab and the layout you pick are remembered on each device.

## [0.12.12] - 2026-10-17

### Changed
- Games: the search shows the most popular matches first, by how many IGDB users want to play each game, which works for upcoming games too. Games whose name is exactly what you typed stay on top. Before, results came in IGDB's name-match order, so a well-known game like "Blight: Survival" could be missing from the first 20 when you searched "Blight".

### Fixed
- Games: the search finds games while you're still typing a word ("Cronos the new d" now finds "Cronos: The New Dawn"). IGDB's own search only matches whole words, so a half-typed word gave no results. SyncR now also looks for names whose words start with what you typed, ignoring punctuation like ":".

## [0.12.11] - 2026-10-17

### Fixed
- Notes: opening the sidebar (or the Board) at the end of a note no longer scrolls the end out of view. A note only counted as "at the bottom" within 4 pixels of its very end, but typing at the end leaves it about 21 pixels above that (the space under the last line). So the browser kept the top line in place instead, and as the narrower note's lines wrapped, the end slid down out of view. "At the bottom" now includes the last 50 pixels.

## [0.12.10] - 2026-10-17

### Fixed
- Games: the "My games" and "Calendar" buttons no longer jump sideways when you switch. They're now centered at the top. The calendar's month grid makes the page wider, and since the buttons were attached to the page's left edge, they moved with it. In the calendar's list layout, "Top" and the grid/list buttons now sit on their own line below.

## [0.12.9] - 2026-10-17

### Fixed
- Games → Calendar: the popup when you click a game is small again (cover beside the name and release date). Since 0.12.1 it used the new game details window's two-column layout and showed the cover at full size.

## [0.12.8] - 2026-10-17

### Fixed
- Clicking a link in a note (or a Board card) opened it twice in the browser: once by SyncR, and once more by the browser's own handling of the link, which SyncR didn't block. It now opens once.

## [0.12.7] - 2026-10-17

### Changed
- Calendars (Reminders and Games): today's date is shown in white on a small blue rounded square, instead of blue text.
- Tabs: the open tab's blue line is now a short rounded bar in a muted blue, only under the title, instead of a line along the whole tab.

### Fixed
- Settings → Games: a long error message stays on one line (cut with …) instead of making the dialog taller on the phone. Point at it or tap it to read it in full.
- Settings → Games: when the game search isn't set up, "Waiting for connection…" stays for a second before "Not set up", instead of flashing for a split second.

## [0.12.6] - 2026-10-17

### Fixed
- Settings → Games: the status line now shows "Waiting for connection…" from the start, so the dialog no longer grows a little when "Connected" appears.
- Settings → Games: once the connection has worked, reopening Settings shows "Connected" right away instead of checking again in view. A check still runs quietly, and the status only changes if it fails. Remembered until SyncR closes.

## [0.12.5] - 2026-10-17

### Changed
- "Check for updates" moved from Settings to a small icon right of Settings at the bottom of the sidebar. It spins while checking; the result shows in the bar at the top as before.
- Settings → About now says "by Logiinx" next to the version.
- Tabs look more finished: the ✕ is a real icon, centered in its button (it was a text character, placed by the font). The open tab has a thin blue line along its bottom. With a mouse, other tabs have even spacing and show their ✕ only when you point at them (the tab widens a little and the ✕ slides in).
- More symbols drawn as icons instead of text characters, so they're centered and match the rest: the ☰ menu button, the image viewer's ✕, the ✓ in sync messages, and the ♥ of liked games in the Games list. In conflict compare, sections are marked with › instead of the old ▸ triangle.
- Color rules: deleting a rule now uses the trash icon, like deleting a group (✕ is for closing and dismissing).
- Small icon buttons (toolbar, tab ✕, card buttons, fold arrows, dialog close, sidebar icons) now all light up the same way under the mouse. Before there were five slightly different greys, and on Board cards the hover was nearly invisible.
- Game ratings: the stars are now icons (in the game's window and in the Games list) instead of ★ text characters. The list shows a real half star instead of "½".
- Notes and cards: bullet, numbered and checklist items and section titles now all start their text at the same distance from the left (before: about 18, 23 and 26 px), so they line up in one column.
- Section arrows sit 2px lower, level with the title's letters (the font draws letters a bit low in their line, so the exact middle looked high). The ✦ and ✕ on Board cards got the same correction, so they line up with the fold arrow again, and the arrow now has the same 8px space from the edge as the buttons on the right.
- Game window: the ✕ is centered on the game's name, with the same space above it and to its right.
- Phone: the toolbar buttons are centered with equal space on both sides (the bar was 1px too wide and scrolled).

## [0.12.4] - 2026-10-17

### Added
- Board cards can have a title: right-click a card → "Add title". It's bold and centered (right-click → "Align title left" to switch), double-click it to edit, and the small arrow beside it folds the card's text away. Title, alignment and folding sync to your other devices. A card with only a title is kept.

### Changed
- Board: priority cards (text and games) no longer have the small blue dot before their first line, which looked off next to bullets. The blue tint and the blue ✦ still mark them.
- Notes: sections and code blocks now fold with the same small arrow (chevron) as Board card titles, instead of the ▶ triangle.
- Phone: the swipe that opens the Board can now start anywhere in the right third of the screen, not just at the edge. With Android's gesture navigation, a swipe starting right at the edge is taken as "Back" and never reaches the app. Swipes on a wide table still scroll the table.

## [0.12.3] - 2026-10-17

### Changed
- Notes and cards: "- ", "1. " or "[ ] " right after a Shift+Enter line break now starts a list too. Before, these shortcuts only worked at the start of a paragraph (after Enter), and a line break stays inside the paragraph. Now the paragraph is split at the line break and the new part becomes the list.

### Fixed
- Board cards: after leaving a list with Enter, the new empty line was removed again half a second later (when the card saved), putting the cursor back in the list, so "- " no longer made a bullet. Broken in 0.12.2.

## [0.12.2] - 2026-10-17

### Added
- Phone: swipe left from the right edge to open the Board, swipe right on it to close it.

### Fixed
- Board cards: a bullet, numbered or check list at the end of a card no longer leaves an empty line below it. TipTap's "trailing node" kept adding an empty paragraph after a final list. Cards don't use it anymore, and the empty line it already added is hidden.

## [0.12.1] - 2026-10-17

### Changed
- Settings is wider with two columns, so everything shows at a glance without scrolling (on the phone it stays one column).
- Games: a new details window. On the PC, the big cover is on the left with the actions under it: Priority, Pin to Board (or Unpin), Google Calendar for upcoming games, and "Remove from list" set apart at the bottom in a quiet red. On the right: the title with the date and the main platforms, the status as one joined bar, then (for finished or dropped games) the stars, heart and review, and the note. ✕ at the top right closes it (Escape and a click outside too); the Close button is gone. On the phone it's stacked: the cover beside the title, the actions as a row of icons, then the rest.
- "Flag" is now called "Priority" everywhere, with a sparkle icon instead of a flag: games (the icon on their row, "Mark as priority" in their menu, the details) and Board cards (the button and the menu). It works the same: a priority game or card stays at the top with a light blue tint.

### Fixed
- Settings opens at the top again (it used to open scrolled to the bottom), and the "Connected" text no longer pushes the Done button out of view: the Done button is gone. Close Settings with Escape or a click outside it, as before.

## [0.12.0] - 2026-10-17

### Added
- Board: pin games to it. Right-click a game in the Games tab → "Pin to Board" (the Board opens). The card shows the game's cover and name; click it for the game's details, drag it like any card. A flagged game starts as a priority card; after that the card's priority and the game's flag are separate. Unpin with the card's ✕ (with Undo) or "Unpin from Board" in the game's menu. The card stays if you remove the game from your list (dimmed, no longer opens).

### Fixed
- Games: the delay banner no longer shows for a release date that only moved by a few hours on the same day (it said e.g. "29 Oct 2026 → 29 Oct 2026"). Only a later day counts as a delay.

### Changed
- Sidebar: the Settings button has the same height and icon position as the Games and Reminders buttons.

## [0.11.1] - 2026-10-16

### Changed
- Settings → Games: the game search proxy address and password are now saved for all your devices (synced and encrypted like the rest), so you only set them up once. The values already set on a device are kept. The Test button is gone: SyncR checks the connection by itself when Settings opens and shortly after you type, and shows a green "Connected", or what went wrong (e.g. "Wrong password for the game search proxy").

### Fixed
- Sync: a reminder, Board card or game deleted on one device no longer comes back when it was changed (e.g. a reminder marked done) on another device that hadn't received the deletion yet. Before, the newest change won, so the deletion was undone. Deliberately bringing something back still works: adding a removed game again, Undo on a Board card, or a release reminder returning with a new date.

## [0.11.0] - 2026-10-16

### Added
- Games: a Games tab (open it with "Games" at the top of the notes list; its tab shows a gamepad icon). Search the IGDB game database and add games to your list: a game that isn't out yet goes to Waiting, otherwise to To play. Main games only by default; a checkbox includes DLCs, editions and bundles. Search results show up to 3 platforms, PC and Android first ("+4 more" for the rest). Your games are grouped by status (Waiting, To play, Playing, Done, Dropped); click a group's title to fold it. Each row shows the cover, the release date with a countdown such as "in 34 days" (just the year once it's out) and a preview of your note or review, plus your stars and heart for finished or dropped games. Flagged games get a light blue tint and stay at the top of their group. Waiting games are sorted by release date, the others newest first.
- Click a game for its details: platforms, status, flag, an optional note, and for finished or dropped games 5 stars (half stars allowed: click the left half of a star), a heart and an optional review. Right-click (long press on the phone) for a quick menu: move, flag, remove. Games sync between your devices, encrypted like notes.
- Games tab: a Calendar view (buttons "My games" | "Calendar" at the top; the last one is remembered). It shows popular upcoming PC games for the next 6 months. On the PC: one month grid per month (Monday first), stacked so you scroll through them; each day shows the games' covers and names, and a busy day makes its week taller. A switch next to the buttons changes to a list grouped by month (with the day and a countdown), which the phone always uses. Click a game for a small popup with its release date, countdown and platforms. Buttons "Top 100 · 300 · 500 · 1000" choose how many of Steam's most wishlisted upcoming games to show (500 by default; remembered on each device). Only the real release counts (not betas, early access or pre-order early access). Games with only a month ("Nov 2026") are listed under that month's grid; with only a quarter or year ("Q1 2027"), last under "No exact date yet" (in the list, all of them). Pin a game (the pin in the list, or "Add to Waiting" in its popup) to put it in your Waiting list. Games already in your list show where they are ("In Waiting"), and get a light blue tint in the grid.
- Games: release dates follow the PC release when a game comes to PC, else Android, else the first console release. A game with only a vague date shows it ("Q1 2027") instead of "TBA", and sorts last in Waiting. Once a day (after syncing) SyncR refreshes names, covers, platforms and release dates of your games from IGDB, and on release day a Waiting game moves to To play by itself. When a Waiting game gets delayed, a yellow banner at the top of My games says so ("Delayed: name · old date → new date"), on both devices, until you close it with ✕.
- Games: each Waiting game with an exact release date gets a reminder at 10:00 two days before it comes out ("Phantom Blade Zero comes out on Thu 29 Oct"); it pops up like any reminder. It follows delays by itself and comes back with the new date, and goes away if the game leaves Waiting. In the Reminders tab only the game shows (on its release day); click it to see the reminder in its details. In a Waiting game's details, "Google Calendar" adds that reminder to Google Calendar, for the phone.
- Reminders have their own tab: "Reminders" under "Games" in the sidebar (with the number of upcoming reminders) opens it. On the PC it shows a month grid (like the Games calendar) with your reminders ("14:30 text"; overdue in red, done crossed out) and the release days of your Waiting games; click a game for its details. A switch changes to the list, which the phone always uses. The list shows upcoming reminders and Waiting games together, soonest first (a reminder with a line of its note), then the folded "Done" group with "Clear". Click a reminder to edit it, right-click (long press on the phone) for the menu, "New reminder" at the top. The reminders list at the bottom of the sidebar is gone.

### Fixed
- Settings → Games: the proxy address works without "https://" in front. Before, the browser treated it as a page inside SyncR itself, and Test showed "Unexpected token '<'". A wrong address now gives a clear message.

## [0.10.7] - 2026-10-16

### Added
- Settings → Games: the address and password of your own game search proxy (a small Cloudflare Worker that talks to the IGDB game database), with a Test button. First step of the upcoming Games feature; the proxy's code is in `proxy/igdb-worker.js`.

## [0.10.6] - 2026-10-16

### Fixed
- Phone: typing near the bottom of a note no longer pushes the toolbar off the top of the screen. When the keyboard opens, the app now shrinks to the space above it instead of the whole page sliding up.

## [0.10.5] - 2026-10-16

### Changed
- PC: scrollbars (note, notes list, Board, dialogs) are now thin and invisible until you scroll; they fade out about a second after you stop. With the mouse over a scrollbar it stays visible, so you can still drag it. Their space stays reserved, so text doesn't shift when they appear. Tables and code blocks inside notes keep their normal scrollbars. The phone is unchanged (Android already shows scrollbars only while scrolling).
- PC: the Board's small edge tab (‹ to open, › to close) is hidden until the mouse comes near it (at any height), or is over the open Board; it fades in and out. On the phone it stays visible.

## [0.10.4] - 2026-10-16

### Changed
- The notes list and the Board now have the same dark background as the note, separated by the thin edge line, so the window looks calmer. Board cards keep the same contrast against the darker panel; the "Card deleted · Undo" bar is now slightly lighter so it still stands out.

## [0.10.3] - 2026-10-16

### Fixed
- Phone: holding a section title on its words now picks the section up. Before, Android's own long press selected the words and opened the keyboard, which cancelled the drag (only pressing beside the words worked). While your finger is down, the title is now briefly not editable or selectable; it is editable again as soon as you lift your finger.

## [0.10.2] - 2026-10-16

### Fixed
- Phone: holding a section title now always moves the section, even right after tapping it (the tap put the cursor in the title, and a long press there selected the words instead). A tap still places the cursor in a title you are editing.
- Dragging selected text that includes part of a section title is now blocked. Before, the browser's own text drag moved that piece, and the editor wrapped it in a new, broken "ghost" section and split the text around it. Dragging selected text elsewhere still works.

## [0.10.1] - 2026-10-16

### Fixed
- Phone: sections and Board cards can now really be dragged after holding them. Before, the page scrolled instead and the drag stopped: the code that stops scrolling was attached only once the finger was already down, and Chrome on Android had by then decided the touch could not be held back (its scroll events can't be cancelled any more). It is now attached once, ahead of time, like for tabs.
- PC: after moving a section, the cursor stays where it was before the drag, instead of jumping into the moved section's title (which also made the next click edit the title instead of opening the section). An open section stays open after moving.

## [0.10.0] - 2026-10-16

### Added
- Board: a panel on the right for small cards (quick tasks, priority things). Open it with the small ‹ tab in the middle of the window's right edge; the › tab on its left edge hides it again. On the PC it sits beside the note and you can drag its left edge to make it wider or narrower; on the phone it slides over the note. Its header shows how many cards you have, and "+" there adds a card; cards use the same editor as notes (checklists, bold, links…) and save as you type. Select text in a note and press the pin in the menu that appears to copy it into a new priority card (the Board opens to show it). With a mouse, hovering a card shows the same corner marks as sections (blue on priority cards) and a grab hand. Click and drag a card to move it: it lifts and the other cards slide out of the way (on the phone, press and hold it a moment first, so swiping still scrolls). Drop it above or below the line to make it a priority or a normal card (while you drag, the card already shows the look it will get); when all cards are on one side, a "Priority ↑" or "Normal ↓" zone appears while dragging so you can still switch. Double-click a card (or right-click → Edit) to edit it; clicking outside or Escape ends editing. Checkboxes can be ticked without editing. ✕ deletes a card, with "Undo" for 5 seconds; a card left empty disappears by itself. The flag button (or right-click → "Mark as priority") makes a card a priority: it gets a light blue tint and a small blue dot, and moves up with the other priority cards, above a thin line. Cards are soft tiles without borders, so they read as notes rather than text boxes. Cards sync between your devices, encrypted like notes; if the same card was changed on both, the newest version wins.
- Conflict copies (made by sync when a note was changed on two devices) are marked with an orange sign in the notes list, and show a banner when opened. "Compare" shows the differences with the original: side by side on the PC, in one view on the phone (red: only in the original, green: only in the copy, dotted: formatting changed). Only real changes count: text, formatting and ticked checkboxes. Long unchanged parts are folded. "Keep original" deletes the copy; "Keep this copy" puts its text into the original note (so links and tabs to it keep working) and deletes the copy.

### Changed
- Sections move without the ⋮⋮ grip: press a section title and drag it. A copy of the title follows the pointer and the blue line shows where it lands. A quick click still opens or closes the section (and a second click edits the title). With a mouse, hovering a title you can drag frames its section (a faint tint and two corner marks, like the app icon) and shows a grab hand; once you are editing that title it stays plain text. On the phone, hold the title a moment before dragging, so swiping still scrolls.

### Fixed
- In the menu that appears when you select text inside a section, the "make a section" and "remove the section, keep its text" buttons had almost identical icons (the same arrows, only pointing in or out). Removing a section now has its own icon (boxes coming apart).

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
