# Running the ledger service

How to move the phone and the desktop app off the direct D1 connection and onto the Worker.
Phases 2 through 4 of [the transactions plan](mobile-transactions-overhaul.md). Nothing here has
run against the real ledger yet.

## 1. Deploy the Worker

```sh
npx wrangler d1 create ego-money            # paste the ID into apps/api/wrangler.toml
npm run migrate:remote --workspace @ego/api
npm run deploy --workspace @ego/api
```

Migration `0002` is additive. The existing desktop and mobile clients keep working against the
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

The desktop Settings screen has the same two fields. While a device token is stored, every money
write becomes one operation with a revision check, and reads come from
`/v1/legacy/snapshot`. Clear the token to fall back to the direct D1 connection.

Desktop writes through the Worker appear on the phone at its next foreground sync. Desktop writes
through the old direct D1 path do not, because they never reach the change log.

## What the device stores

`ego-money-<dataset>.db`, one file per API address. Tables mirror the server, plus:

- `outbox` holds undelivered operations with their attempt count and retry time.
- `sync_state` holds the dataset, the last applied server sequence, and whether the bootstrap finished.

The bootstrap writes its starting sequence last, so an interrupted first download restarts
instead of leaving the device believing it is current.

## Rollback

Turn the Activity switch off and clear the desktop token. Both fall back to the direct D1 path.
Check the outbox is empty first: a pending operation that never reached the server is only
stored on the phone.

## Still to do before trusting it

- Run against a staging D1 database and compare balances and summaries with the current snapshot.
- The device tests use `node:sqlite`, not Expo SQLite. Nothing has run on the phone yet.
- Expo SQLite needs a development build; a plain Expo Go session will not open the database.
- SQLCipher is not configured. The local ledger is a plain SQLite file for now.
