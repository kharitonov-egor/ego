# Ego

My personal app, on an Android phone and a Windows desktop. The phone is Expo and React Native,
the desktop is Electron, React, and Tailwind, and a Cloudflare Worker in `apps/api` holds the data
and the keys.

The desktop app opens on the phone's start screen, in the phone's black and white, with every app
in a sidebar. It keeps its own SQLite copy of the data and syncs it through the Worker the way the
phone does. It also has what only a computer needs: a global Trello capture hotkey, Quick tools,
and T3 Code notifications. The phone's apps arrive on the desktop one at a time.

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
"bench 3x8 at 185", "mood 4 today", "I read today", or "two eggs and toast for breakfast" and it
records that.

- Every write waits on a card that lists what is about to be saved, with account, category, date,
  sets, or calories in place of IDs. A bar runs down for three seconds and then the card saves. Undo
  stops it before then; after that nothing can be taken back. Sending another message, switching
  chats, or leaving the tile saves the card too. When one message asks for several things, they all
  go on the same card. A photo of a meal is logged in the reply to that message, since a photo
  cannot be attached later.
- "Add call the landlord to To Do for Friday 5pm" adds a card; "mark pay rent done" or "what's due
  this week" works on the boards. "How much protein today?" and "what's in my fridge?" read Food.
- Under each reply, a short trail says what was read or changed, like "Read mood for yesterday".
- The paperclip attaches a photo from the camera, the gallery, or the clipboard: a receipt, a meal,
  or groceries. Ego sends it to the model once. It keeps the photo only when the model logs it as a
  meal, so the Food log can show it. A receipt or a grocery photo leaves only a note that an image
  was attached.
- Chats are separate. The list icon opens earlier chats or starts a new one; the tile opens the
  latest. The diary is out of reach: the assistant has no tool for it.

The Worker runs the loop. It holds the OpenRouter key, builds the system prompt from the accounts,
categories, habits, exercises, task boards, and food targets in D1, runs each read against D1, and
streams the reply back while the model writes it. Writes wait in `assistant_tool_calls` until the
card saves; the Worker claims each one before it runs, so the phone's timer and a new message
arriving together cannot save the same write twice. The default model is `openai/gpt-6-sol`; set `ASSISTANT_MODEL` on the
Worker to change it. Arguments are checked against each tool's schema before anything runs, tool
results are marked untrusted in the prompt, and a turn stops after eight model calls. Chats,
messages, and tool calls live in `assistant_chats`, `assistant_messages`, and
`assistant_tool_calls`. The tile asks for a fingerprint like Mood and Diary, since a reply can
quote a mood note.

## Money

Finance has four tabs, along the bottom on the phone and across the header on the desktop:

- Home shows the balance across accounts, what was spent and received against the period before,
  a cash flow chart, a calendar of spending by day for a month, upcoming bills found in the
  history, average spending, and the top categories. The period bar steps through days, weeks,
  months, and years, or shows all time or a custom range.
- Activity lists every transaction, newest first, with search, filters by type, account, and
  category, and the net for each day. Tapping one opens it to edit or delete it. Holding one starts
  a selection for deleting several at once.
- Categories draws the period's spending as a ring with each category around it. Tapping a
  category opens its transactions; holding it edits it.
- Budget plans one month at a time: the income you expect and an amount per expense category.

Accounts are manual USD accounts, and each balance comes from its opening balance and history. The
plus in the header records an expense, income, or a transfer between two accounts, with a
calculator keypad for the amount. Itemized receipts keep their product names and line prices under
Purchase details.

On the phone, typed purchases and receipt photos go through the AI tile: "Publix $42 and gas $30"
becomes one card with both transactions, and an itemized receipt keeps its purchase rows. A grocery
receipt also puts the food on it in the Food app's fridge, under plain names like "Whole milk".

A budget covers one month. Set the planned income, give each expense category an amount, and the
view tracks what is left. A category turns amber at 80 percent of its amount and red once spending
passes it. Crossing the line raises an in-app banner, and on the desktop a Windows notification as
well. Money spent in a category with no amount is listed separately as unplanned.

The daily reminder, off by default, sends a notification at 7, 8, 9, or 10 PM on days with nothing
logged. Tapping it opens a new transaction.

On the desktop, Finance is the phone's screens on a wider page. Home and Budget split into two
columns when the window is wide enough. The keypad becomes a text field that takes the same sums,
like `12.50+3*2`, and Enter saves. In Activity, a right-click or Ctrl+click starts a selection,
Shift+click extends it, and Delete removes it. A right-click on a category edits it, and the left
and right arrow keys step the period. The desktop also reads receipts itself: paste an image with
Ctrl+V, drop one on the window, or use the scan button in the header. OpenRouter reads it with the
key from the desktop's Settings, the phone's receipt editor opens with the result, and the entry
saves and syncs like one made on the phone. The reminder keeps running while Ego sits in the tray.

### Ego service

A Cloudflare Worker in `apps/api` can own the money database instead of each device talking to D1
itself. It holds the migrations, the domain commands, paginated reads, and a change log, and each
device authenticates with its own revocable token rather than a Cloudflare account token.

The phone and the desktop each keep their own SQLite copy of the ledger. Every money screen reads
it without the network, a saved transaction is durable before it is delivered, and conflicts offer
Keep mine or Use saved version.

The phone signs in once with Google on its start screen and gets its device token from the
Worker. That one sign-in covers Finance and Gym, and neither opens until it is done. The phone
keeps no API keys. The Worker holds the OpenRouter, Trello, and OpenAI keys as secrets and calls
those services on the phone's behalf.

Money sync and Talk to AI use the same Worker address and device token. `docs/ledger-setup.md`
covers Worker deployment, device enrolment, Live setup, the money cutover, and rollback.

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

On the computer, Mood has no lock and opens straight away. Once the window is wide enough, the past
days sit beside the editor instead of below it. The left and right arrow keys step a day, the
calendar stops at today, and `Ctrl+Enter` in the note saves.

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

On the computer, the three tabs sit in the header. A click adds a check-off and a right-click, or
`Delete` on a focused row, takes one back. A habit counted several times a day also shows a minus
on hover. The left and right arrow keys move Home's week strip a week at a time and Progress a month
at a time. Progress puts the month and its calendar beside the streaks and the habit list, and Quit
lays two or more clocks side by side.

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
- Goals sit between Boards and Upcoming: an outcome, why it matters, a horizon from this quarter
  to someday, a target and a review date, and a status. A goal holds checkpoints and links whole
  boards or single cards as its next actions. The filter shows Active, Someday, or All.

Reminders are local notifications. Every change to a card, including one synced from another
device or made by the AI, cancels what Tasks scheduled and schedules again, so a done, moved, or
archived card never rings. Tapping a reminder opens its card. The morning digest, off by default,
sends one notification at 9 AM with the cards due that day, and date-only cards then wait for it
instead of reminding on their own.

Tasks uses the same local database, outbox, and change log as the other apps, as `taskBoard`,
`taskList`, `taskLabel`, `taskCard`, and `taskGoal`. A card is one row with its checklists, attachments, and
activity inside it, so each edit is one operation and the log always matches the card. Positions
are fractions, so a drag rewrites only the card that moved. Attachments go to R2 under `tasks/`
through the same upload queue as the diary, and a card edit that adds files waits until they are
up. Deleting a board or a list hides everything under it on every device.

On the desktop, Boards, Goals, and Upcoming are tabs in the header. A board shows every list side by side
at a fixed width and scrolls sideways, and each list scrolls on its own. Drag a card with the mouse
to move it within its list or into another, or drag a list's name to move the list. Resting near
an edge scrolls, Escape puts the card back, and dragging the empty board pans it. Boards reorder
by dragging too, or with Alt and the arrow keys. "Add a card" stays open after Enter for the next
card. A card opens as its own page. Double-click the description to edit it, where Ctrl+B, Ctrl+I,
and Ctrl+K format and Ctrl+Enter saves. Files attach from the picker, by dropping them on the card,
or with Ctrl+V. Photos open in a viewer that steps with the arrow keys, other files open in their
Windows app, and a right-click removes one. Reminders and the digest are Windows notifications
timed by the window, which keeps running in the tray, and clicking one opens its card. Goals sit
two to a row, and a goal's page keeps its linked work beside its checkpoints. The Alt+N quick add
still sends cards to Trello.

## Sheets

The Sheets tile holds small spreadsheets in black and white, built for the phone first. The empty
screen offers Connections, a sheet with a Name column and Person and Company as row types, or a
blank sheet.

- A sheet is a grid. The Name column stays put while the other columns scroll sideways, and the
  header row stays at the top. Tap a cell to edit it in a sheet that slides up, with arrows to the
  previous and next cell. Tap a checkbox to tick it. Tap a name to open the whole row as a form,
  or hold it to duplicate or delete the row. A deleted row can be brought back with Undo for five
  seconds.
- Each column has one type: text, long text, number, date, checkbox, dropdown, tags, phone, email,
  or link. Dropdown and tags options come in five greys, and a new option can be typed straight
  into the picker. Phone cells call, text, or open WhatsApp; email and link cells open mail or the
  browser.
- Tap a column's name to rename it, change its type, edit its options, sort by it, group by it,
  hide it, move it, or delete it. The plus at the end of the header adds a column.
- Changing a type converts what it can: "1,200" becomes a number and "Mar 4, 2026" a date. A text
  column turning into a dropdown gets an option for each value it held. A value that does not fit
  stays as typed and shows in red until it is fixed.
- Row types are a switch on each sheet, off by default. With them on, every row has a type and a
  column can apply to some types only. Cells that do not apply show a dash, and the chips above
  the grid show one type at a time and hide the columns it does not use.
- Filter rows by any column, sort by up to three, group by a dropdown into sections that fold,
  and search every cell. The sheet remembers its type chip, filters, sorts, and grouping.
- Sheets can be renamed, given an emoji, reordered by holding them, duplicated, archived, and
  deleted.

On the desktop the grid fills the window and scrolls both ways, with the Name column and the
header row pinned. It works like a spreadsheet: click a cell to select it, move with the arrow
keys, and press Enter or double-click to edit it in the same sheet, with arrows to the previous and
next cell. Typing on a text or number cell starts the edit with that key. In the editor, Enter
saves and moves to the next cell, Shift+Enter goes back, and Escape closes it without saving what
was typed. Space or a click on the box ticks a checkbox, Delete clears a cell with five seconds of
Undo, and Ctrl+F searches.

Clicking a name opens the row's form, where Enter in a new row's name adds it. Coming back finds the
grid as you left it: the same search, folded groups, selected cell, and scroll. Right-click a row,
or use its "..." button, to duplicate or delete it; Ctrl+Z works like Undo while a toast shows.
Column headers and the sheet's "..." open their menus where you clicked. Sheets reorder by dragging,
or with Alt+Up and Alt+Down.

Sheets uses the same local database, outbox, and change log as the other apps, as `sheet` and
`sheetRow`. A sheet is one record holding its columns, options, row types, and view. A row is one
record with its cells keyed by column ID, so an edit on another device asks Keep mine or Use saved
version, the same as Tasks. Changing a column's type rewrites only the rows whose values convert.

## Food

The Food tile has two tabs: Log, for what you ate, and Fridge, for the food you have at home.

- Log lists every entry grouped by day, newest first: today at the top, yesterday under it, and so
  on as you scroll. Each day's header has its calories. Each entry shows the time, the serving,
  calories, and protein, carbs, and fat. The Pictures checkbox at the top shows or hides the photo
  beside each entry.
- The card at the top compares today with the daily targets for calories, protein, carbs, and fat.
  Tap it, or the target icon, to set them. An empty box means no target for that number.
- The camera button takes a photo of a plate or a nutrition label. The plus also chooses a photo
  from the gallery, scans a barcode, or takes a description like "a large bowl of pho". The model
  reads the photo or the words and splits the meal into parts, each with its own numbers. On a
  label it copies the label's serving and values.
- A barcode is looked up in USDA FoodData Central and Open Food Facts. USDA's numbers come from the
  label, so they win when both know the product; Open Food Facts usually has the plainer name. The
  scanner keeps a still of the package as the entry's photo. When neither database knows a code,
  the card offers a photo of the label instead.
- Whatever gets read lands on a card that saves itself after three seconds, the same as the AI
  tile's. Undo throws it away. Tapping the card holds the timer and opens the editor, where the
  name, day, time, serving, and numbers can change before it saves. Any entry in the log opens the
  same editor later, with Delete. A card saves even if you leave Food before the bar runs out.
- An entry whose photo the server refuses stays on the phone and says so in the list. Its editor
  has Try again.
- Fridge lists items with their brand, when they were added, and where they came from. Add them
  with a barcode, a photo of groceries or a shelf, a typed name, or a grocery receipt sent to the
  AI tile. A photo turns into a list of items; tapping its card drops the ones the model got wrong.
  The check on a row marks an item used up. It leaves the list after three seconds unless you tap
  Undo. Logging a meal does not touch the fridge.
- The AI tile reads and writes both: "log my lunch" with a photo, "how much protein today", "what's
  in my fridge", or "we're out of milk".

Entries, fridge items, and the targets use the same local database, outbox, and change log as the
other apps, as `foodEntry`, `fridgeItem`, and `foodGoal`, in `food_entries`, `fridge_items`, and
`food_goals` in D1. An entry keeps its own totals and parts, so it never depends on a database that
changes later. Photos go to R2 under `food/` through the same upload queue as the diary, with a
480 px copy for the list, and an entry with a photo waits on the phone until both are up. The Worker
calls OpenRouter for photos and descriptions (`POST /v1/food/analyze`) with a strict JSON schema,
then adds the parts up itself rather than trusting the model's arithmetic. `FOOD_MODEL` picks the
model and falls back to `ASSISTANT_MODEL`. Barcodes go through `GET /v1/food/products/:barcode`,
which asks USDA only when `USDA_API_KEY` is set.

## Desktop

The desktop app opens on Home, which is the phone's start screen. Every app is also in the sidebar,
with the sync state, Blur, and Settings at the bottom.

- Sign in once with Google from Home. Ego opens the browser, Google sends it back to an
  `ego://auth` link, and Windows hands that link to the running app. A device token from
  `ego-device enroll` also works. Settings signs out.
- The main process keeps the data in SQLite in the app's data folder, using the phone's schema,
  outbox, and sync code from `packages/local`. Screens read that copy, so they open offline. Sync
  runs after each change, when the window comes back to the front (at most once a minute), and
  every ten minutes while Ego sits in the tray.
- Blur personal data works as it does on the phone. `Ctrl+Shift+B` turns it on or off from any
  screen, for a screen share that starts suddenly.
- Diary and task files load through `ego-media://` links. The main process answers them from the
  copy it sent, from its cache, or from the Worker, so the device token never reaches the page.

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

Settings is the last row of the sidebar. It starts with the phone's sections: the account, Blur,
the daily reminder, accounts, sync, and which keys the Worker has. Then the desktop's own:

- Quick add to Trello: the global hotkey, the Trello API key and token, the board, the default
  list, and Ctrl+number list shortcuts. The token field warns you if the value doesn't start with
  `ATTA`, since pasting the OAuth secret there instead is an easy mistake and returns a bare 401
- The Quick tools hotkey
- Start with Windows
- Talk to AI: the Google and Wispr Flow connections, the tools the AI may use, and the voice
- T3 Code notifications
- The OpenRouter key Finance uses to read receipt photos

Cards are created through the Trello REST API. `POST /1/cards`, then one `POST /1/cards/{id}/attachments`
per pasted screenshot.

## Credentials

Nothing secret is committed. Copy `.env.example` to `.env.local` and fill it in:

```
MAIN_VITE_TRELLO_API_KEY=
MAIN_VITE_TRELLO_TOKEN=
MAIN_VITE_TRELLO_BOARD_ID=
MAIN_VITE_TRELLO_LIST_ID=
MAIN_VITE_EGO_API_URL=
```

`MAIN_VITE_EGO_API_URL` is the Worker address, so a fresh install only needs the sign-in button.
The Trello values only seed the settings store the first time the app runs. After that the Settings UI is the
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

`npm run dev` starts electron-vite with hot reload. Electron 42 and later download their binary on
first use rather than at install, so `dev` runs `install-electron` first. Electron 44 needs Node
22.12 or newer. `npm run typecheck` runs `tsc --build` across the main, preload, and renderer
projects. `npm test` runs every package's tests.

To package a Windows installer, use the package icon in the title bar. It runs the build, packages
with electron-builder, and opens `dist/Ego-<version>-Setup.exe`. `npm run dist` does the same from
a terminal.

## Layout

```
packages/local/       the phone's data layer: SQLite schema, repositories, outbox, sync, API client
apps/desktop/
  src/main/           Electron main process
    index.ts          app lifecycle, tray, IPC handlers, the build-and-install command
    local/            the ledger database, sync, Google sign-in, and ego-media files
    quickAdd.ts       the capture window and the toasts
    trello.ts         Trello REST calls
    settings.ts       electron-store schema and accessors
    hotkeys.ts        global shortcut registration
  src/preload/        contextBridge API
  src/renderer/       the React app, plus the plain-HTML overlay windows
    lib/              the phone's contexts, reading the ledger over IPC
    screens/          one folder per app
  src/shared/         types shared across the process boundary
```

The renderer runs the phone's repositories and commands unchanged. Their SQL goes over IPC to the
main process, which owns the one SQLite connection and takes turns between the screens and sync.

The quick add and toast windows are plain HTML with inline styles rather than React. They open on a
hotkey and need to paint instantly, so there's no bundle to boot first.
