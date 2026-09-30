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

## AI

The AI tile on the phone's start screen is a text chat with an assistant that reads and writes the
other apps' data. Ask "what was my mood yesterday" or "max bench press in the past month" and it
calls the matching read tool, then answers with the number. Tell it "Publix $42 and gas $30",
"bench 3x8 at 185", "mood 4 today", or "I read today" and it records that.

- Money writes stop on a Confirm card listing every transaction the message named, with account,
  category, and date. Nothing is saved until you tap Confirm. Typing a new message drops the card.
- Mood, habit, gym, study, and task card writes apply at once. The reply carries an Undo line for
  each. "Add call the landlord to To Do for Friday 5pm" adds a card; "mark pay rent done" or "what's
  due this week" works on the boards.
- Under each reply, a short trail says what was read or changed, like "Read mood for yesterday".
- The paperclip attaches a receipt photo from the camera, the gallery, or the clipboard. Ego sends
  it to the model once and keeps only a note that an image was attached.
- Chats are separate. The list icon opens earlier chats or starts a new one; the tile opens the
  latest. The diary is out of reach: the assistant has no tool for it.

The Worker runs the loop. It holds the OpenRouter key, builds the system prompt from the accounts,
categories, habits, exercises, and task boards in D1, runs each tool against D1, and streams the reply back
while the model writes it. The default model is `openai/gpt-6-sol`; set `ASSISTANT_MODEL` on the
Worker to change it. Arguments are checked against each tool's schema before anything runs, tool
results are marked untrusted in the prompt, and a turn stops after eight model calls. Chats,
messages, and tool calls live in `assistant_chats`, `assistant_messages`, and
`assistant_tool_calls`. The tile asks for a fingerprint like Mood and Diary, since a reply can
quote a mood note.

## Money

The Money sidebar has six views:

- Accounts holds manual USD accounts and derives each balance from its opening balance and history.
- Categories holds user-created income and expense groups.
- Transactions records income, expenses, and transfers between two accounts.
- Purchases shows itemized receipts, their product names, and line prices.
- Budget plans one month at a time: the income you expect and an amount per expense category.
- Overview reports balance changes, cash flow, monthly totals, averages, and top categories.

On the phone, typed purchases and receipt photos go through the AI tile: "Publix $42 and gas $30"
becomes one Confirm card with both transactions, and an itemized receipt keeps its purchase rows.
Desktop still accepts Ctrl+V, drag and drop, and file selection for one-shot transaction image
analysis, and still reads its OpenRouter key from its own Settings.

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

## Health

The phone's start screen has a Health tile for the data a Fitbit records in Google Health: steps,
sleep, calories, distance, zone minutes, heart rate, resting heart rate, HRV, and weight.

- The overview shows one day, with the same arrows and calendar as Mood. A readiness card sits on
  top, then a tile per metric. Weekly cardio counts zone minutes since Monday against Google's goal
  of 150.
- A tile opens that metric by week, month, or year, with a chart, the average and extremes, and
  every value listed under it. Sleep adds the night's stages, heart rate adds the day in
  five-minute steps, and readiness shows what went into the score.
- The gear holds the units switch (miles and pounds, or kilometers and kilograms) and the Google
  Health connection.

Google does not let other apps read its readiness or cardio load scores. Readiness here is Ego's
own estimate from the same inputs Google names: HRV and resting heart rate against the previous 30
days, and sleep against 7.5 hours. A usual day scores near 60. It needs a week of readings first.

The phone connects Google Health once, through the Worker's Google OAuth client with the read-only
activity, health metrics, sleep, and settings scopes. The Worker keeps the refresh token encrypted
and copies the data into D1: a year of history on the first connection, in slices of 84 days, then
the last ten days every 15 minutes from a cron trigger. Opening Health asks the Worker to sync
again if the last pull is more than a minute old, then downloads only the rows that changed. The
phone keeps its own copy in SQLite, so Health opens offline.

## Mood

The phone's start screen has a Mood tile. It opens a mood journal with one entry per day: a mood
from Awful to Great and an optional note of up to 2,000 characters. The arrows and the calendar
reach earlier days, but not future ones. Past entries appear below the editor. Tapping one opens
that day.

Entries use the same local database, outbox, and change log as money and gym. A saved day is on
the phone before it syncs. It lands in the `mood_entries` table in D1, and Clear this day deletes
it on every device.

Mood and Diary ask for a fingerprint, or the phone's PIN, every time they open and every time Ego
comes back from the background. Trips Ego starts itself, like the photo picker, the camera, or
opening a PDF in another app, do not count.

## Diary

The Diary tile is a chat with yourself, laid out like Telegram's Saved Messages: dark bubbles on
the right, a composer at the bottom, and the newest message at the bottom of the screen.

- Type and send. The paperclip attaches photos and videos from the gallery (up to 20 in one
  message), a photo or video from the camera, or any file. Hold the microphone to record a voice
  message, slide left to cancel, and let go to send.
- Photos and videos show as images in the bubble, grouped into a grid when there are several. A tap
  opens them full screen, where you can swipe between every photo and video in the diary and pinch
  to zoom. GIFs loop on their own. Round video messages play in place. Songs and voice messages
  play in the bubble, one at a time. Other files open in whichever app on the phone handles them.
- Swipe a bubble left to reply. Hold one for Reply, Copy text, Edit, Pin, and Delete. The bar under
  the header shows the latest pin, and each tap goes to the next one.
- The search icon searches every message, file name, and song title on the phone, offline. With an
  empty query it lists your hashtags by use. Tapping a hashtag in a message searches for it.
- Messages forwarded from other chats say "Forwarded from" and the sender, or "Forwarded message"
  when Telegram hid who sent it.

A message with files waits on the phone until every file has uploaded, with a clock on the bubble
and a ring over each file while it goes. Then the message goes through the same outbox and change
log as everything else, in `diary_messages` in D1. The files are in a private R2 bucket,
`ego-diary`, which only the Worker can read; the phone downloads them through the Worker with its
device token. Files over 95 MB go up in 20 MB parts. The phone keeps its own copy of what it sent,
and caches what it has viewed.

`scripts/diary-import.mjs` loads a Telegram Desktop JSON export: text with its formatting, photos,
videos, GIFs, round videos, songs, files, stickers (the animated one too), replies, forwards, pins,
and edit times. Posts Telegram exported one by one as an album become one message with a grid.
See `docs/ledger-setup.md`.

## Study

The phone's start screen has a Study tile for Canvas assignments.

- Assignments groups everything by the day it is due. Upcoming starts with anything from an
  earlier day still unchecked, then lists today and every day after. Past lists earlier days,
  newest first. The chips under the toggle narrow the list to one course.
- Courses shows each course with how many assignments are left, how many are overdue, and the next
  deadline. Tapping a course opens its assignments.

Canvas does not report submissions, so the check marks belong to Ego. Tap the circle on a row to
check it off. Tap the row for the description and an Open in Canvas button.

The Worker downloads the Canvas calendar feed and parses it. Anyone holding the feed link can read
the calendar, so the link is a Worker secret, `CANVAS_CALENDAR_URL`, and never enters this repo.
D1 stores only the check marks, in `study_completions`. The assignments stay in Canvas, and copying
them into D1 would only add a second list that goes stale. The phone keeps the last list in SQLite.
Study opens offline and refreshes on open, on pull-down, and on return to the app once the saved
copy is five minutes old. A check mark made offline waits on the phone and goes out with the next
refresh.

Canvas sends deadlines in UTC. The phone places each one on its own calendar, so a deadline at
10:59 PM Eastern (02:59 UTC) shows on the evening it is due, not the next morning.

## Habits

The phone's start screen has a Habits tile with three tabs.

- Home lists the habits to build, each with an emoji. A habit is due once a day, several times a
  day (up to 10), or on a number of days each week (up to 6). Tap a habit to add a check-off for
  the selected day, and hold it to take one back. A habit done once a day, or a weekly one, toggles
  on tap instead. The pencil on each row opens the editor, which renames, sets the frequency, moves,
  or deletes. The week strip at the top has a ring on each day that fills as habits get done. Swipe
  it or use the arrows to move a week at a time. Future days stay locked.
- Progress shows one month: the share of targets met, a calendar where a day gets brighter as more
  gets done and turns solid white when everything is, the current and best streak, and each habit's
  rate. A weekly habit shows on Home every day until its week is done. On the calendar it only
  brightens the days it was done and never leaves a day unfinished. Its rate counts weeks, each
  belonging to the month its Thursday falls in. Tapping a habit narrows the calendar and the
  streaks to it. Tapping a day opens it on Home.
- Quit is for habits to break. Each card runs a clock from the moment you quit, in days, hours,
  minutes, and seconds, and shows the best run so far. The editor sets the quit day and time,
  restarts the clock after a relapse, and lists past restarts.

A daily habit is due every day from its start date, so adding one never counts against earlier
days. Habits use the same local database, outbox, and change log as the other apps. A check-off
shows at once and reaches D1 in `habits` and `habit_entries` on the next sync. Deleting a habit
hides its entries on every device.

## Tasks

The phone's start screen has a Tasks tile: Trello's boards, lists, and cards, in black and white.

- Boards lists every board with its emoji, open cards, and what is overdue or due soon. Hold a
  board to drag it into a new order. A new board starts with To Do, Doing, and Done. The bell sets
  up notifications; the plus makes a board.
- A board shows its lists side by side, one screen wide each, and snaps from list to list as you
  swipe. Hold a card to lift it and drop it anywhere: higher or lower in its list, or into another
  list. Resting at the side of the screen turns to the next list, and resting at the top or bottom
  of a list scrolls it. Hold a list's name to move the whole list. Each list ends with "Add a card",
  and the last column adds a list. The round button on a card marks it done.
- A card has its title, a Done button, labels, priority, dates, a Markdown description, any number
  of checklists, attachments, and an activity log. The first photo on a card becomes its cover.
  Checkboxes in the description tick with a tap. The menu moves the card to any list on any board,
  copies it (with or without its labels, checklists, and attachments), archives it, or deletes it.
- Labels belong to a board: a name, or none, and one of eight muted colors. Priority runs None,
  Low, Medium, High, Urgent, drawn as signal bars. A due date can have a time, and a reminder from
  "at due time" to two days before. A date-only card reminds at 9 AM.
- The board menu edits the name and emoji, manages labels, hides done cards, and opens the board's
  activity and its archived cards and lists. The filter narrows cards by text, label, priority,
  and due date.
- Upcoming lists every open card with a due date from every board, in Overdue, Today, Tomorrow,
  This week, and Later.

Reminders are local notifications. Every change to a card, including one synced from another
device or made by the AI, cancels what Tasks scheduled and schedules again, so a done, moved, or
archived card never rings. Tapping a reminder opens its card. The morning digest, off by default,
sends one notification at 9 AM with the cards due that day, and date-only cards then wait for it
instead of reminding on their own.

Tasks uses the same local database, outbox, and change log as the other apps, as `taskBoard`,
`taskList`, `taskLabel`, and `taskCard`. A card is one row with its checklists, attachments, and
activity inside it, so each edit is one operation and the log always matches the card. Positions
are fractions, so a drag rewrites only the card that moved. Attachments go to R2 under `tasks/`
through the same upload queue as the diary, and a card edit that adds files waits until they are
up. Deleting a board or a list hides everything under it on every device.

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
