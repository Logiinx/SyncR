# SyncR

A personal note app (Notesnook replacement): notes as tabs, collapsible sections, and encrypted sync between a Windows PC and an Android phone.

## Where we are
- **Read the "Current status" section at the top of `DECISIONS.md` first.** It says what's done and what's next.
- `DECISIONS.md` is the decision log: what was decided, why, the alternatives, open questions. It's **local only** (gitignored, not on GitHub). Read only the section relevant to the task, not the whole file.
- When a step is finished: update "Current status" in `DECISIONS.md`, add a decision entry if something was decided, and suggest a `/clear`.

## Stack
- React 19 + TypeScript + Vite. TipTap 3 editor (StarterKit + Details for collapsible sections).
- Local storage: IndexedDB via Dexie (`src/db.ts`). Per-device UI state (tabs, scroll, sidebar) in localStorage (`src/localState.ts`).
- Desktop: Tauri 2 (`src-tauri/`), Windows NSIS installer, auto-updater via GitHub Releases. Custom title bar (`decorations: false`).
- Phone: the same web app as a PWA (planned: GitHub Pages).
- Sync (in progress): Dropbox App folder + client-side AES-GCM encryption. See "Sync plan" in `DECISIONS.md`.

## Commands
- `npm run dev`: dev server at http://localhost:5173 (launch config `syncr-dev` in `.claude/launch.json`)
- `npm run build`: type-check + production build. Run it before every commit.
- **Rust is not installed locally**, so the desktop app can't be built here. GitHub Actions builds it when a `v*` tag is pushed (`.github/workflows/build-desktop.yml`).
- In the Bash tool, Node may not be on PATH: prefix with `export PATH="/c/Program Files/nodejs:$PATH"`.

## Files
- `src/App.tsx`: layout, tabs state, rename/delete dialogs
- `src/NoteEditor.tsx`: editor + autosave · `src/NoteView.tsx`: scroll restore · `src/SelectionMenu.tsx`: menu on text selection ("Section", "Unwrap")
- `src/TabBar.tsx`, `src/Sidebar.tsx`, `src/ContextMenu.tsx`, `src/Dialog.tsx`, `src/WindowControls.tsx`, `src/UpdateBanner.tsx` + `src/updater.ts`
- `src/clickTitleToToggle.ts`: clicking a section title opens/closes it
- `design/icon.svg`: icon source. Regenerate with `npx tauri icon design/icon.svg`, then delete `src-tauri/icons/android` and `ios`.

## Conventions
- Small steps, one commit per step, clear commit messages. **No Co-Authored-By or other AI attribution lines.**
- Every user-visible change gets a line under `## [Unreleased]` in `CHANGELOG.md` (written for the user, plain language).
- The repo is **public**: no personal details in committed files (personal context belongs in `DECISIONS.md`).
- Dark theme only. Colors are CSS variables in `src/index.css`. Keep the window clean: no permanent toolbars; actions go in the selection menu or right-click menus.

## Releasing
1. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and add a new empty `## [Unreleased]` above it. The build fails without this section.
2. `npm version X.Y.Z --no-git-tag-version`, commit "Release vX.Y.Z", push, `git tag vX.Y.Z`, `git push origin vX.Y.Z`.
3. The user publishes the draft release on GitHub. Installed apps then offer "Update now".

## Testing notes
- Test in the browser pane with `javascript_tool` (e.g. `document.querySelector('.tiptap').editor` gives the editor).
- When the pane is hidden, `requestAnimationFrame` and CSS transitions are paused and screenshots time out. Don't mistake that for app bugs.
- After changing `vite.config.ts`, or if hot reload gets stuck on old modules, restart the dev server.
