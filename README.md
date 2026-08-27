# Ego

My personal desktop app for Windows. Electron, TypeScript, React, Tailwind.

Right now it does one thing: press a global hotkey anywhere in Windows, type a title and
description, paste screenshots, hit Enter, and a Trello card appears. Everything else that used
to live in my old desktop app is gone. This is the clean base I'm building the rest on.

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

The main window is tray-only. Double-click the tray icon or pick "Open settings".

- Global hotkey, captured by pressing the key combination you want
- Start with Windows
- Trello API key and token, then the board and list new cards go to
- Ctrl+number list shortcuts for the quick add window
- An optional webhook. When enabled, Ego POSTs JSON to it after each card is created:
  `{ event, title, description, listId, cardId, cardUrl, attachmentCount, createdAt }`.
  A webhook failure gets logged and never blocks the card.

## Credentials

Nothing secret is committed. Copy `.env.example` to `.env.local` and fill it in:

```
MAIN_VITE_TRELLO_API_KEY=
MAIN_VITE_TRELLO_TOKEN=
MAIN_VITE_TRELLO_BOARD_ID=
MAIN_VITE_TRELLO_LIST_ID=
MAIN_VITE_WEBHOOK_URL=
```

These only seed the settings store the first time the app runs. After that the Settings UI is the
source of truth, and values live in `ego-settings.json` under `%APPDATA%/ego`. Get your own key and
token at https://trello.com/power-ups/admin.

Note that `electron-vite` inlines these values into `out/main/index.js` at build time, so a packaged
installer carries them. Don't hand the installer to anyone.

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
  webhook.ts    optional POST after a card is created
  settings.ts   electron-store schema and accessors
  hotkeys.ts    global shortcut registration
src/preload/    contextBridge API
src/renderer/   React settings window, plus the two plain-HTML overlay windows
src/shared/     types shared across the process boundary
```

The quick add and toast windows are plain HTML with inline styles rather than React. They open on a
hotkey and need to paint instantly, so there's no bundle to boot first.
