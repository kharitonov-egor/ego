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

Migrations `0002` and `0003` are additive. The existing desktop and mobile clients keep working against the
same tables while you try this out.

## 2. Enrol each device

```sh
node scripts/ego-device.mjs enroll "Phone" --apply --remote
node scripts/ego-device.mjs enroll "Desktop" --apply --remote
```

Each token is printed once and only its hash reaches the database. Revoke with
`node scripts/ego-device.mjs revoke <device-id> --apply --remote`.

## 3. Point the phone at it

Settings has a Ledger service panel: the API address and the device token, then Save and check.
That only stores the connection. Activity still reads the old snapshot until you turn on
**Read Activity from this device**.

With it on:

- Activity reads the phone's own SQLite database. Filters, search, and paging never touch the network.
- A saved transaction writes the row and its outbox operation in one SQLite transaction, then
  shows as Pending until the server acknowledges it.
- Sync runs on launch, on foreground, after each write, and when you tap the status row.
- A row the server rejects reads Needs attention and offers Keep mine or Use saved version.

Overview, Accounts, Budget, and Purchases still use the direct D1 connection in this phase. The
two writers never touch the same action, but they are two writers: leave the switch off unless
you are testing this path.

## 4. Point the desktop app at it

The desktop Settings screen calls this the Ego service and uses the same two fields. While a device token is stored, every money
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
- `sync_state` holds the dataset, the last applied server sequence, and whether the bootstrap finished.

The bootstrap writes its starting sequence last, so an interrupted first download restarts
instead of leaving the device believing it is current.

## 5. Cutover

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

Once `compare` agrees and Activity has synced clean, Settings offers **Remove the old connection**
on the phone. It deletes the Cloudflare account token and the cached ledger chunks from the
device. It stays disabled while any local change is still undelivered, because those changes exist
nowhere else. On desktop, clear the D1 fields in Settings after the same check.

After that, revoke the D1 API token in the Cloudflare dashboard. The device tokens stay; revoke
those individually with `ego-device revoke`.

## Rollback

Turn the Activity switch off and clear the desktop token. Both fall back to the direct D1 path.
Check the outbox is empty first: a pending operation that never reached the server is only
stored on the phone.

## Still to do before trusting it

- Run against a staging D1 database and compare balances and summaries with the current snapshot.
- The device tests use `node:sqlite`, not Expo SQLite. Nothing has run on the phone yet.
- Expo SQLite needs a development build; a plain Expo Go session will not open the database.
- SQLCipher is not configured. The local ledger is a plain SQLite file for now.
- The cutover above has not been run. The scripts have not touched a real Cloudflare account.
