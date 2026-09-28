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
npx wrangler secret put OPENROUTER_API_KEY    # the money agent
npx wrangler secret put TRELLO_API_KEY        # Trello capture
npx wrangler secret put TRELLO_TOKEN
```

`OPENROUTER_MODEL` is optional and defaults to `openai/gpt-5.6-terra`. `DATASET_ID` is optional and
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

## 3. Point the desktop app at it

The desktop Settings screen calls this the Ego service. It takes the Worker address and a token
from `ego-device enroll`. While a device token is stored, every money
write becomes one operation with a revision check, and reads come from
`/v1/legacy/snapshot`. The same credential authorizes Talk to AI session creation. Clear the token
to fall back to the direct D1 connection. Talk to AI stays unavailable until the service is set.
The Talk to AI settings in the desktop app apply to the next voice or chat session. Connect Google
and Wispr Flow in the same panel, then enable only the tools you want. The Worker validates each
value and keeps the models, tool schemas, storage policy, and host allowlists fixed on the server.

Desktop writes through the Worker appear on the phone at its next foreground sync. Desktop writes
through the old direct D1 path do not, because they never reach the change log.

## What the device stores

`ego-money-<dataset>.db`, one file per API address. Tables mirror the server, plus:

- `outbox` holds undelivered operations with their attempt count and retry time.
- `sync_state` holds the dataset, the last applied server sequence, whether the bootstrap finished,
  and which bootstrap version filled the tables.

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
which also deletes the cached ledger chunks. On desktop, clear the D1 fields in Settings after the
same check.

After that, revoke the D1 API token in the Cloudflare dashboard. The device tokens stay; revoke
those individually with `ego-device revoke` or by signing out on the phone.

## Rollback

Clear the desktop token to put desktop back on the direct D1 path. The phone has no direct path any
more; rolling it back means installing the previous build. Check its outbox is empty first
(Settings shows the pending count under Sync), because an operation that never reached the server
is only stored on the phone.

## Still to do before trusting it

- Run against a staging D1 database and compare balances and summaries with the current snapshot.
- The device tests use `node:sqlite`, not Expo SQLite.
- Google sign-in has run only against mocked Google responses. The `ego://auth` redirect has not
  been tried on a phone.
- Expo SQLite needs a development build; a plain Expo Go session will not open the database.
- SQLCipher is not configured. The local ledger is a plain SQLite file for now.
- The cutover above has not been run. The scripts have not touched a real Cloudflare account.
