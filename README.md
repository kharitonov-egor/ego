# Ego

My personal desktop app for Windows. Electron, TypeScript, React, Tailwind.

The desktop app has a personal budget tracker and a global Trello capture hotkey. The Electron
main process reads and writes budget data through Cloudflare's D1 HTTPS API. Accounts, categories,
transactions, transfers, and reports are available from the main window.

Talk to AI has voice and text chat modes. Both use `gpt-live-1` with delegated work handled by
`gpt-5.6-terra`. The delegated model can use hosted web search plus the read tools enabled in
Settings for Gmail, Google Drive, Wispr Flow, and Ego Money. Recording an Ego transaction or
creating a Trello card always stops on a card with Confirm and Reject buttons. Voice alone cannot
approve either write. Messages, audio, connector results, and tool arguments stay out of the audit
log and disappear from Electron when the session closes.

## Money

The Money sidebar has six views:

- Accounts holds manual USD accounts and derives each balance from its opening balance and history.
- Categories holds user-created income and expense groups.
- Transactions records income, expenses, and transfers between two accounts.
- Purchases shows itemized receipts, their product names, and line prices.
- Budget plans one month at a time: the income you expect and an amount per expense category.
- Overview reports balance changes, cash flow, monthly totals, averages, and top categories.

Mobile has a money agent for messages and receipt images. A message can describe one transaction
or several. The agent produces one `record_transactions` tool call with an entry for each one.
The user checks the entries before Ego saves them. The agent can also read a photo, library image,
or clipboard image. Itemized receipts keep their purchase rows. Ego discards each image after
OpenRouter reads it. The phone sends the request to the Worker, which holds the OpenRouter key.
Desktop still accepts Ctrl+V, drag and drop, and file selection for one-shot transaction image
analysis, and still reads its OpenRouter key from its own Settings. The default model is
`openai/gpt-5.6-terra`; set `OPENROUTER_MODEL` on the Worker to change it for the phone.

A budget covers one month. Set the planned income, give each expense category an amount, and the
view tracks what is left. A category turns amber at 80 percent of its amount and red once spending
passes it. Crossing the line raises a desktop notification and an in-app banner on mobile. Money
spent in a category with no amount is listed separately as unplanned.

When D1 cannot be reached, the app opens the last encrypted snapshot in read-only mode. Configure
the Cloudflare account ID, D1 database ID, and a token limited to D1 Read and D1 Write under
Settings. The app creates its tables and indexes when the connection first succeeds.

### Ego service

A Cloudflare Worker in `apps/api` can own the money database instead of each device talking to D1
itself. It holds the migrations, the domain commands, paginated reads, and a change log, and each
device authenticates with its own revocable token rather than a Cloudflare account token.

The phone keeps its own SQLite copy of the ledger. Every money screen reads it without the
network, a saved transaction is durable before it is delivered, and conflicts offer Keep mine or
Use saved version. The desktop app can route its writes through the same Worker while keeping its
current screens.

The phone signs in once with Google on its start screen and gets its device token from the
Worker. That one sign-in covers Finance and Gym, and neither opens until it is done. The phone
keeps no API keys. The Worker holds the OpenRouter, Trello, and OpenAI keys as secrets and calls
those services on the phone's behalf.

Money sync and Talk to AI use the same Worker address and device token. Desktop money sync falls back to
the direct D1 connection when the Worker is not configured. `docs/ledger-setup.md` covers Worker
deployment, device enrolment, Live setup, the money cutover, and rollback.

The repo is public so I can point people at it. The credentials are not in it.

## Gym

The Gym tile on the phone is a workout log laid out like FitNotes, in the Finance black theme.

- The home screen shows one day with a card per exercise and its sets. Swipe sideways or use the
  arrows to change days. The calendar marks each workout day with a dot per muscle group trained.
- An exercise opens on Track, History, and Graph tabs. Track has weight and rep steppers, Save and
  Clear, and turns into Update and Delete when you tap a logged set. Each set can carry a comment.
- The trophy lists the best weight for each rep count and an estimated one-rep max (Epley). A
  trophy icon marks the sets that hold a record.
- The side panel lists the day's exercises. Hold one to reorder it, put it in a superset, or delete
  that day's sets.
- A rest timer starts after each saved set. It vibrates at zero, or sends a notification if the
  app is in the background. The length and the auto start are in Settings.

Weights are in pounds unless an exercise is set to kilograms. The library holds 116 standard
exercises across Abs, Back, Biceps, Cardio, Chest, Legs, Shoulders, and Triceps.

Gym data lives in the same phone database and Worker as money: categories, exercises, sets, and a
per-day record for order and supersets. It syncs through the same outbox and change log, so it
works offline. `scripts/gym-import.mjs` loads a FitNotes CSV export through the Worker; see
`docs/ledger-setup.md`.

## Quick tools

Press `Alt+S` anywhere in Windows to open a three-item chooser. Use the arrow keys and Enter, or
press `1`, `2`, or `3`.

- Ask Claude opens `https://claude.ai/` in the default browser.
- Read text from image accepts a clipboard screenshot or an image file. It uses Windows OCR on the
  computer and copies the result to the clipboard.
- Save video or audio runs `yt-dlp` for one URL and writes the result under `Downloads\Ego`. MP3
  conversion also needs `ffmpeg` on `PATH`.

The Quick tools hotkey can be changed in Settings. If another program owns `Alt+S`, remove that
binding or choose a different combination.

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
the main, preload, and renderer projects. `npm test` runs the shared core and mobile suites.

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
