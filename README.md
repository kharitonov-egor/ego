# Ego

My personal desktop app for Windows. Electron, TypeScript, React, Tailwind.

The desktop app has a personal budget tracker and a global Trello capture hotkey. The Electron
main process reads and writes budget data through Cloudflare's D1 HTTPS API. Accounts, categories,
transactions, transfers, and reports are available from the main window.

## Money

The Money sidebar has four views:

- Accounts holds manual USD accounts and derives each balance from its opening balance and history.
- Categories holds user-created income and expense groups.
- Transactions records income, expenses, and transfers between two accounts.
- Overview reports balance changes, cash flow, monthly totals, averages, and top categories.

When D1 cannot be reached, the app opens the last encrypted snapshot in read-only mode. Configure
the Cloudflare account ID, D1 database ID, and a token limited to D1 Read and D1 Write under
Settings. The app creates its tables and indexes when the connection first succeeds.

The repo is public so I can point people at it. The credentials are not in it.

## Quick add

Press the hotkey (`Alt+N` by default) and a small centered window appears over whatever you were
doing. It closes on blur.

- `Enter` creates the card, `Shift+Enter` adds a newline
- `Ctrl+V` in the window attaches pasted screenshots to the card
- `Tab` (or tapping `Alt`) cycles title, description, and the image preview
- `Ctrl+1` … `Ctrl+9` switch the target list, if you've assigned list shortcuts in Settings
- `Esc` closes without sending

A toast slides in from the bottom right on success or failure.

## Settings

One panel, "Add to Trello", holding everything the feature needs. The main window is tray-only, so
double-click the tray icon or pick "Open settings".

- Global hotkey, captured by pressing the key combination you want
- Start with Windows
- Trello API key and token. The token field warns you if the value doesn't start with `ATTA`, since
  pasting the OAuth secret there instead is an easy mistake and returns a bare 401
- Board and the default list new cards go to
- Ctrl+number list shortcuts, for sending a card somewhere other than the default

Cards are created through the Trello REST API. `POST /1/cards`, then one `POST /1/cards/{id}/attachments`
per pasted screenshot.

## Credentials

Nothing secret is committed. Copy `.env.example` to `.env.local` and fill it in:

```
MAIN_VITE_TRELLO_API_KEY=
MAIN_VITE_TRELLO_TOKEN=
MAIN_VITE_TRELLO_BOARD_ID=
MAIN_VITE_TRELLO_LIST_ID=
```

These only seed the settings store the first time the app runs. After that the Settings UI is the
source of truth, and values live in `ego-settings.json` under `%APPDATA%/ego`. Get your own key and
token at https://trello.com/power-ups/admin.

Note that `electron-vite` inlines these values into `out/main/index.js` at build time, so a packaged
installer carries them. Don't hand the installer to anyone.

## Icons

The mark is a white ring with a dot in the middle. The desktop app uses the dark variant, white on
black. Every source file plus the generated sizes live in `assets/brand`, including the web favicon,
the PWA maskable icon, and the iOS touch icon, so a web or mobile build later has them ready. See
`assets/brand/README.md` for what each file is for.

## Running it

```
npm install
npm run dev
```

`npm run dev` starts electron-vite with hot reload. `npm run typecheck` runs `tsc --build` across
the main, preload, and renderer projects.

To package a Windows installer, use the package icon in the title bar. It runs the build, packages
with electron-builder, and opens `dist/Ego-<version>-Setup.exe`. `npm run dist` does the same from
a terminal.

## Layout

```
src/main/       Electron main process
  index.ts      app lifecycle, tray, IPC handlers, the build-and-install command
  quickAdd.ts   the capture window and the toasts
  trello.ts     Trello REST calls
  settings.ts   electron-store schema and accessors
  hotkeys.ts    global shortcut registration
src/preload/    contextBridge API
src/renderer/   React settings window, plus the two plain-HTML overlay windows
src/shared/     types shared across the process boundary
```

The quick add and toast windows are plain HTML with inline styles rather than React. They open on a
hotkey and need to paint instantly, so there's no bundle to boot first.
