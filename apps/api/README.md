# @ego/api

The Cloudflare Worker that owns the money database. The phone and the desktop app talk to this
Worker over HTTPS with a device credential. Neither of them needs a Cloudflare account API token
on this path, because the Worker reaches D1 through its binding.

Phase 2 of `docs/mobile-transactions-overhaul.md`, with the device side in
`apps/mobile/lib/sync`. Nothing here is deployed yet. See `docs/ledger-setup.md` to run it.

## Endpoints

All routes except `/v1/health` need `Authorization: Bearer <device token>`.

| Route | Returns |
| --- | --- |
| `GET /v1/health` | API version, no credential needed |
| `GET /v1/reference` | Accounts and categories, including archived ones, plus the server sequence |
| `GET /v1/transactions` | Up to 50 feed rows, a next cursor, the matching count, and the query identity |
| `GET /v1/transactions/:id` | One transaction with its receipt linkage |
| `GET /v1/receipts/:id` | One receipt with its item rows |
| `GET /v1/balances` | Complete account balances, computed over the whole ledger |
| `GET /v1/summary` | Income, expenses, transfers, and budget totals for a date range |
| `GET /v1/changes` | Committed changes after a server sequence |
| `POST /v1/operations` | Applies up to 25 sync operations in order |
| `GET /v1/legacy/snapshot` | The whole ledger, for desktop until it moves to pages |
| `GET /v1/legacy/revisions` | Revisions by entity ID, so a snapshot client can still send a revision check |

Feed parameters: `from`, `to`, `accounts`, `categories`, `kinds`, `search`, `limit`, `cursor`.
`limit` is capped at 100. A cursor is bound to the filters that produced it and a mismatch is a
400, not a silent restart from the first page. Percent and underscore are literal characters in
`search`.

## Writes

Every write arrives as an operation with a device-generated `operationId`, the `entityId`, and
the revision the device expected. Repeating an operation returns its first result instead of
writing again, and reusing an ID with a different payload is rejected. A stale revision returns
409 with the current record so the app can offer Keep mine or Use saved version.

Each command runs as one D1 batch. The statements that carry out the command share one
precondition and run before the primary write, so a command either commits with its change-log
entry and operation receipt or leaves nothing behind. A receipt and its transaction are one
command; a transfer is one record with two account references.

## Running the database

```sh
npx wrangler d1 create ego-money             # once, then paste the ID into wrangler.toml
npm run migrate:local --workspace @ego/api   # or migrate:remote for the deployed database
npm run deploy --workspace @ego/api
```

Migrations are additive so the current desktop and mobile clients keep working against the same
tables during the migration.

## Enrolling a device

```sh
node scripts/ego-device.mjs enroll "Phone" --apply --remote
node scripts/ego-device.mjs list --remote
node scripts/ego-device.mjs revoke device-abc123 --apply --remote
```

The token is printed once. Only its SHA-256 hash reaches the database. Put the value in the
app's secure storage, never in this repository.

## Tests

`npm test --workspace @ego/api` runs the Worker's SQL against `node:sqlite` through a D1-shaped
adapter, including the transactional behaviour of `batch()`. That covers ordering, cursors,
balances, idempotency, and rollback, but it is not the D1 engine. Run the same checks against a
staging D1 database before pointing anything at the real ledger.
