# Running the Ego service

How to move the phone and the desktop app off the direct D1 connection and onto the Worker.
Phases 2 through 4 of [the transactions plan](mobile-transactions-overhaul.md). Nothing here has
run against the real ledger yet.

## 1. Deploy the Worker

```sh
npx wrangler d1 create ego-money            # paste the ID into apps/api/wrangler.toml
npm run migrate:remote --workspace @ego/api
npm run deploy --workspace @ego/api
```

For Talk to AI, add an OpenAI project key with access to `gpt-live-1`, `gpt-5.6-terra`, Responses
delegation, and hosted web search:

```sh
cd apps/api
npx wrangler secret put OPENAI_API_KEY
```

Tool connections need a versioned 32-byte AES key. Generate the value once, save it in your
password manager, then add it as a Worker secret. Keep the old key in
`CONNECTOR_TOKEN_KEY_PREVIOUS` during rotation until every connector has reconnected.

```sh
node -e "console.log('v1:' + require('crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put CONNECTOR_TOKEN_KEY
```

For Google, create a Web OAuth client and add
`https://YOUR-WORKER/v1/connectors/google/callback` as an authorized redirect URI. Then set:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put PUBLIC_BASE_URL
```

`PUBLIC_BASE_URL` is the Worker origin, with no trailing slash. The requested Google scopes are
`openid`, `email`, `gmail.readonly`, and `drive.readonly`. A personal OAuth app can stay in testing
with your Google account listed as a test user.

Revoke any key that has appeared in chat or source control. The replacement belongs only in the
Worker secret store. Voice time currently costs $0.05 per minute. Backend model and search usage
cost extra. WebRTC session creation reserves 15 seconds and credits it against the running call.
See OpenAI's [GPT-Live model page](https://developers.openai.com/api/docs/models/gpt-live-1) and
[WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live).

### Server keys for the phone

The phone holds no API keys. It signs in with Google and the Worker calls every outside service for
it. Add these once:

```sh
cd apps/api
npx wrangler secret put ALLOWED_EMAILS        # your Google address; comma-separate several
npx wrangler secret put OPENROUTER_API_KEY    # the AI chat
npx wrangler secret put TRELLO_API_KEY        # Trello capture
npx wrangler secret put TRELLO_TOKEN
npx wrangler secret put TRELLO_WORK_API_KEY   # the Work list: the work Trello account
npx wrangler secret put TRELLO_WORK_TOKEN     # authorized with scope=read,write
npx wrangler secret put CANVAS_CALENDAR_URL   # Study: Canvas > Calendar > Calendar Feed link
```

`ASSISTANT_MODEL` is optional and defaults to `openai/gpt-6-sol`. `DATASET_ID` is optional and
defaults to `ego`, the dataset `ego-device.mjs` enrols into.

Sign-in uses the same Google OAuth client and the same redirect URI as the Gmail connector, so the
Google Cloud setup above covers it. It asks only for `openid` and `email`. Sign-in stays off until
`ALLOWED_EMAILS` has at least one address, and any other Google account is sent back to the phone
without a code.

Migrations `0002` through `0004` are additive. The existing desktop app keeps working against the
same tables.

## 2. Sign in on the phone

Deploy the Worker with the migration first:

```sh
npm run migrate:remote --workspace @ego/api
npm run deploy --workspace @ego/api
```

The phone app is now version 0.2.0. Updates are matched to the app version, so `eas update` only
reaches a build made from this version, and an older build without SQLite never receives code that
needs it. Build and install it once:

```sh
npm run build:preview --workspace @ego/mobile
```

Then open Settings on the phone and tap **Sign in with Google**. A phone that already had the
Worker address keeps it. A fresh install needs the address once, either typed on the sign-in card
or built in by setting `EXPO_PUBLIC_EGO_API_URL` in `apps/mobile/.env.local` or as an EAS
environment variable.

1. The phone asks the Worker to start a sign-in and receives a one-time exchange secret over HTTPS.
2. The browser opens Google. After you pick the allowed account, the Worker redirects to
   `ego://auth` with a one-time code.
3. The phone sends the code and the secret back, and the Worker enrols the device and returns its
   token. Only the token's hash reaches the database.

A code redeems once, only with the secret that started it, within ten minutes. Settings shows which
server keys exist, never their values. **Sign out** revokes this device's token on the server and
keeps the local ledger for the next sign-in.

The first sync downloads every record in one request (`/v1/bootstrap`), including receipt items and
budgets. After that, every money screen reads the phone's SQLite copy:

- Overview, Accounts, Categories, Budget, Purchases, and Activity open without the network.
- A saved change writes the row and its outbox operation in one SQLite transaction, then shows as
  Pending until the server acknowledges it.
- Sync runs on launch, on foreground, after each write, and when you tap the status row.
- A row the server rejects reads Needs attention and offers Keep mine or Use saved version.

A phone that bootstrapped under the first version, without budgets and receipt items, downloads
again once and keeps its place in the change log.

`node scripts/ego-device.mjs` still enrols a device by hand, which the desktop app needs:

```sh
node scripts/ego-device.mjs enroll "Desktop" --apply --remote
node scripts/ego-device.mjs list --remote
node scripts/ego-device.mjs revoke <device-id> --apply --remote
```

## Gym

Migration `0005_gym.sql` adds the gym tables. It is additive for money, and it copies the change
log into a new table with every sequence number kept. Apply it and deploy before any phone gets
the gym screens, because those phones download the gym log on their next sync:

```sh
npm run migrate:remote --workspace @ego/api
npm run deploy --workspace @ego/api
```

To load a FitNotes history, export it from FitNotes (Settings, Spreadsheet export) and run the
import with a device token. Without `--apply` it prints the plan: categories, exercise types, and
set counts.

```sh
npm run typecheck                         # builds the core package the script reads
node scripts/gym-import.mjs FitNotes_Export.csv
EGO_API_URL=https://... EGO_DEVICE_TOKEN=... node scripts/gym-import.mjs FitNotes_Export.csv --apply
```

Every record goes through `POST /v1/operations`, so each phone receives it through the change log.
Operation IDs come from the data, so a second run reports every operation as already there. The
script's `CLEANUP` constant holds the fixes for my own export (test entries dropped, Пресс merged
into Abs, four misfiled exercises moved); `--as-exported` skips them. Enrol a throwaway device for
the token and revoke it afterwards.

## Health

Migration `0006_mood_entries.sql` adds the `mood_entries` table for the mood journal. It is
additive. Apply it and deploy before publishing a phone update that has the Health screen:

```sh
npm run migrate:remote --workspace @ego/api
npm run deploy --workspace @ego/api
```

An older Worker rejects any batch that contains a mood entry. Money and gym changes queued in the
same batch then wait until the Worker is updated.

## Study

Study reads the Canvas calendar feed on the Worker. In Canvas, open Calendar and copy the Calendar
Feed link at the bottom right. Anyone with the link can read the calendar, so it goes in the Worker
secret store and nowhere else. Migration `0007_study.sql` adds `study_completions`, which holds the
check marks and nothing else. It is additive.

```sh
cd apps/api
npx wrangler secret put CANVAS_CALENDAR_URL
npm run migrate:remote
npm run deploy
```

Study does not use the outbox or the change log. The Worker fetches the feed on each refresh, and
`PUT /v1/study/assignments/:id` sets or clears one check mark. Until the Worker has the secret,
Study shows how to add it, and Settings lists Canvas calendar as not set up.

## Habits

Migration `0008_habits.sql` adds `habits` and `habit_entries`. It is additive. Apply it and deploy
before publishing a phone update that has the Habits tile:

```sh
npm run migrate:remote --workspace @ego/api
npm run deploy --workspace @ego/api
```

An older Worker rejects any batch that contains a habit or a check-off. Money, gym, and mood
changes queued in the same batch then wait until the Worker is updated.

Migration `0009_habit_targets_and_clock.sql` adds a habit's target and period, the exact moment a
habit to break was quit, and the phone's own time on each restart. It is additive, and existing
habits become once a day. The fields are optional on the wire. A phone on an older build can still
save a habit, and the Worker keeps the saved values for anything that build leaves out.

## Diary

The diary keeps its files in R2. R2 has to be switched on once for the Cloudflare account, in the
dashboard under R2 Object Storage. Wrangler cannot do that step and fails with code 10042 until it
is done. Then create the bucket, apply migration `0011_diary.sql` (`diary_messages` and
`diary_media`, additive), and deploy. `wrangler.toml` binds the bucket as `DIARY_MEDIA`.

```sh
cd apps/api
npx wrangler r2 bucket create ego-diary
npm run migrate:remote
npm run deploy
```

The bucket stays private. Nothing in it has a public URL; `GET /v1/diary/media/:id` streams a file
to a device that presents its token, with byte ranges so a video can seek.

The diary needs native modules for video, audio, recording, and the fingerprint check, so the phone
app moved to version 0.3.0. Updates follow the app version, so an `eas update` from here on only
reaches a 0.3.0 build, and a 0.2.0 build never loads code it cannot run. Build and install it once:

```sh
npm run build:preview --workspace @ego/mobile
```

The first sync on the new build downloads everything again (bootstrap version 4). A 0.2.0 build
pulled diary changes it had no table for and moved past them, so pulling changes alone would miss
them.

To import a Telegram chat, export it from Telegram Desktop as JSON with the size limit raised so
large videos come along. Then, with a throwaway device token:

```sh
node scripts/diary-import.mjs <export folder>            # the plan, and which files are missing
EGO_API_URL=... EGO_DEVICE_TOKEN=... node scripts/diary-import.mjs <export folder> --apply
```

The script uploads each file once, checking the Worker first, then sends the messages in order.
IDs come from Telegram's message IDs, so a second run changes nothing. A later export that includes
files the first one left out fills them in on the existing messages. It uses `ffmpeg` for video
posters and smaller copies of large photos, and falls back to Telegram's thumbnails without it.

## Tasks

Migration `0014_tasks.sql` adds `task_boards`, `task_lists`, `task_labels`, `task_cards`, and
`task_media`. It is additive. Attachments share the `ego-diary` bucket under a `tasks/` prefix, so
there is nothing to create in R2. Apply the migration and deploy:

```sh
cd apps/api
npm run migrate:remote
npm run deploy
```

Tasks needs no new native module: file picking, notifications, and the photo picker were already
in the 0.4.0 build, so an `eas update` is enough. The first sync after the update downloads
everything again (bootstrap version 5), so a phone that pulled task changes before it had the
tables picks them up.

## Sheets

Migration `0016_sheets.sql` adds `sheets` and `sheet_rows`. It is additive. Apply it and deploy
before the phone update goes out, so the first sheet a phone saves has somewhere to go:

```sh
cd apps/api
npm run migrate:remote
npm run deploy
```

Sheets needs no new native module, so an `eas update` is enough. The first sync after the update
downloads everything again (bootstrap version 6).

## Food

Migration `0018_food.sql` adds `food_entries`, `fridge_items`, `food_goals`, and `food_media`. It is
additive. Food photos share the `ego-diary` bucket under a `food/` prefix, so there is nothing to
create in R2.

Barcode lookups work through Open Food Facts with no key. USDA FoodData Central copies the numbers
from the label and covers more US store brands, so add its free key too
([sign up](https://fdc.nal.usda.gov/api-key-signup.html)). `FOOD_MODEL` is optional: without it,
food photos use `ASSISTANT_MODEL`, then `openai/gpt-6-sol`. Whichever model it is has to read
images.

```sh
cd apps/api
npx wrangler secret put USDA_API_KEY    # optional
npm run migrate:remote
npm run deploy
```

The barcode scanner is a native module (`expo-camera`), so the phone app moved to version 0.6.0.
Updates follow the app version, so an `eas update` only reaches a 0.6.0 build, and a 0.5.0 build
never loads code it cannot run. Build and install it once:

```sh
npm run build:preview --workspace @ego/mobile
```

The first sync on the new build downloads everything again (bootstrap version 8).

The same deploy changes the AI chat for every build: each write now waits on a card, and nothing
can be undone after it saves. A 0.5.0 build shows that card with its old Confirm and Reject
buttons, and a new message saves the card instead of dropping it.

## AI

Migration `0012_assistant.sql` adds `assistant_chats`, `assistant_messages`, and
`assistant_tool_calls`. It is additive. Apply it and deploy before publishing the phone update
with the AI tile, which replaces the money agent screen:

```sh
npm run migrate:remote --workspace @ego/api
npm run deploy --workspace @ego/api
npm run update --workspace @ego/mobile
```

The chat needs no new native module, so an `eas update` reaches the 0.3.0 build. The Worker's
`OPENROUTER_API_KEY` is the same one the money agent used. `ASSISTANT_MODEL` picks the model;
without it the Worker uses `openai/gpt-6-sol`. A turn is capped at eight model calls and about
110 seconds, and each device gets 30 turns a minute.

## App builds

Settings > About offers the newest preview build and installs it over the app. EAS reports each
finished build to `POST /v1/app/builds/webhook`, signed with a shared secret. The Worker keeps the
finished Android APKs from internal builds in `app_builds` (migration `0013_app_builds.sql`), and
the phone offers the newest one whose build number is above its own. Set it up once with a random
secret of at least 16 characters:

```sh
cd apps/api
npm run migrate:remote
npx wrangler secret put EAS_WEBHOOK_SECRET
npm run deploy
cd ../mobile
npx eas-cli webhook:create --event BUILD --url <worker URL>/v1/app/builds/webhook --secret <same secret>
```

Handing an APK to Android's installer needs the `REQUEST_INSTALL_PACKAGES` permission, which only a
new build can add, so the app moved to version 0.4.0. Install that build once by hand. After that,
`npm run build:preview --workspace @ego/mobile` is all it takes: when the build finishes, Settings
shows "Install build N". The first time, Android asks whether Ego may install apps. EAS deletes
internal builds after two weeks, and the Worker stops offering a build once it expires.

## 3. Point the desktop app at it

The desktop signs in like the phone: Google from its start screen, or a token from
`ego-device enroll`. It keeps its own SQLite copy of the ledger and syncs it through the same
outbox and change log, so it has no direct D1 path any more. The same credential authorizes Talk to
AI session creation. Talk to AI stays unavailable until the desktop is signed in.
The Talk to AI settings in the desktop app apply to the next voice or chat session. Connect Google
and Wispr Flow in the same panel, then enable only the tools you want. The Worker validates each
value and keeps the models, tool schemas, storage policy, and host allowlists fixed on the server.

Desktop writes appear on the phone at its next foreground sync, and phone writes on the desktop
at its next sync.

## What the device stores

`ego-money-<dataset>.db`, one file per API address. Tables mirror the server, plus:

- `outbox` holds undelivered operations with their attempt count and retry time.
- `sync_state` holds the dataset, the last applied server sequence, whether the bootstrap finished,
  and which bootstrap version filled the tables.
- `study_assignments` holds the last Canvas list. `done_pending` marks a check mark the server has
  not received yet. `study_state` holds when the list was fetched.

The bootstrap writes every record and its starting sequence in one SQLite transaction, so an
interrupted first download restarts instead of leaving the device believing it is current.

SecureStore holds the Worker address, the device token, the signed-in account, and the Trello board
and list choices. It holds no API keys.

## 4. Cutover

Run this once both apps have been on the Worker long enough to trust it.

```sh
set CF_ACCOUNT_ID=...        # the legacy direct connection
set CF_DATABASE_ID=...
set CF_API_TOKEN=...
set EGO_API_URL=https://ego-money.workers.dev
set EGO_DEVICE_TOKEN=...     # a device token, not a Cloudflare token

node scripts/ego-migrate.mjs backup ./ego-backup.json
node scripts/ego-migrate.mjs compare
```

`backup` exports every table to a JSON file. `compare` reads both sides and prints row counts,
each account balance, and the income and expense totals, marking any line that disagrees. It only
reads. Neither command writes to either database.

Keep the backup off this repository. To exercise the restore, create a second D1 database, load
the backup into it with `wrangler d1 execute`, point `CF_DATABASE_ID` at that copy, and run
`compare` again. A restore you have not tested is not a restore.

Once `compare` agrees, the phone has nothing left to retire: it no longer contains the direct D1
client. If it still holds keys from the earlier version, Settings lists them under **Old keys on
this phone**. Copy any you still need into Worker secrets, then tap **Remove from this phone**,
which also deletes the cached ledger chunks. The desktop no longer reads or stores D1 credentials.

After that, revoke the D1 API token in the Cloudflare dashboard. The device tokens stay; revoke
those individually with `ego-device revoke` or by signing out on the phone.

## Rollback

Neither app has a direct D1 path any more; rolling one back means installing its previous build.
Check its outbox is empty first (Settings shows the pending count under Sync), because an operation
that never reached the server is only stored on that device.

## Still to do before trusting it

- Run against a staging D1 database and compare balances and summaries with the current snapshot.
- The device tests use `node:sqlite`, not Expo SQLite.
- Google sign-in has run only against mocked Google responses. The `ego://auth` redirect has not
  been tried on a phone.
- Expo SQLite needs a development build; a plain Expo Go session will not open the database.
- SQLCipher is not configured. The local ledger is a plain SQLite file for now.
- The cutover above has not been run. The scripts have not touched a real Cloudflare account.
