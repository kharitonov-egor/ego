# @ego/api

The Cloudflare Worker that owns the money database. The phone and the desktop app talk to this
Worker over HTTPS with a device credential. Neither needs a Cloudflare account API token on this
path, because the Worker reaches D1 through its binding. The Worker also creates desktop Talk to
AI sessions without sending its OpenAI key to Electron.

Phase 2 of `docs/mobile-transactions-overhaul.md`, with the device side in
`apps/mobile/lib/sync`. Nothing here is deployed yet. See `docs/ledger-setup.md` to run it.

## Endpoints

All routes except `/v1/health`, the two sign-in routes, and the two OAuth callbacks need
`Authorization: Bearer <device token>`.

| Route | Returns |
| --- | --- |
| `GET /v1/health` | API version, no credential needed |
| `POST /v1/auth/google/start` | Starts Google sign-in and returns the one-time exchange secret, no credential needed |
| `POST /v1/auth/exchange` | Trades the code from `ego://auth` and the secret for a new device token |
| `GET /v1/session` | The signed-in account and which server keys exist, never their values |
| `DELETE /v1/session` | Signs out by revoking this device's token |
| `GET /v1/bootstrap` | Every live money and gym record, with receipt items and budget allocations, plus the sequence it was read after |
| `GET /v1/assistant/chats` | The dataset's AI chats, newest first |
| `DELETE /v1/assistant/chats/:id` | Hides one chat |
| `GET /v1/assistant/messages` | The shown messages of one chat (`chat=`), plus any money write waiting on the Confirm card |
| `POST /v1/assistant/turns` | Sends one message and streams the turn back as NDJSON: the stored user message, text deltas, tool trail lines, the stored reply, and a pending write |
| `POST /v1/assistant/confirm` | Answers the Confirm card, applies the write, and streams the model's follow-up |
| `POST /v1/assistant/undo` | Takes back a write the assistant made and adds an "Undid" line to the chat |
| `GET /v1/trello/boards` | Trello boards, with the Worker's Trello key and token |
| `GET /v1/trello/boards/:id/lists` | Lists on one board |
| `POST /v1/trello/cards` | Creates a card |
| `POST /v1/trello/cards/:id/attachments` | Forwards one file up to 10 MB to a card |
| `GET /v1/health/data` | Google Health rows in D1 that changed after `since`, plus the connection state |
| `POST /v1/health/sync` | Pulls from Google Health unless a pull just ran, then answers like `/v1/health/data` |
| `POST /v1/health/connect` | Starts Google OAuth with the read-only Google Health scopes |
| `DELETE /v1/health/connection` | Revokes the Google Health grant and stops syncing. Synced days stay |
| `PUT /v1/diary/media/:id` | Stores one diary file up to 95 MB in R2. The same ID again returns the stored file |
| `POST /v1/diary/media/:id/multipart` | Starts a larger upload, or returns the file if it is already stored |
| `PUT /v1/diary/media/:id/multipart/:upload/:part` | Stores one part of a larger upload |
| `POST /v1/diary/media/:id/multipart/:upload/complete` | Joins the parts into the file |
| `GET /v1/diary/media/:id` | Streams a diary file, with byte ranges for seeking. `HEAD` says whether it exists |
| `/v1/tasks/media/...` | The same four upload routes and the download route for task attachments, under `tasks/` in R2 |
| `GET /v1/reference` | Accounts and categories, including archived ones, plus the server sequence |
| `GET /v1/transactions` | Up to 50 feed rows, a next cursor, the matching count, and the query identity |
| `GET /v1/transactions/:id` | One transaction with its receipt linkage |
| `GET /v1/receipts/:id` | One receipt with its item rows |
| `GET /v1/balances` | Complete account balances, computed over the whole ledger |
| `GET /v1/summary` | Income, expenses, transfers, and budget totals for a date range |
| `GET /v1/changes` | Committed changes after a server sequence |
| `POST /v1/operations` | Applies up to 25 sync operations in order |
| `POST /v1/live/sessions` | Exchanges a WebRTC SDP offer for a GPT-Live session ID and answer |
| `POST /v1/live/tools/execute` | Runs one schema-checked Gmail or Ego tool for the current device and session |
| `POST /v1/live/tools/audit-local` | Records a confirmed Trello call that Electron runs with its existing credentials |
| `POST /v1/connectors/google/start` | Starts Google OAuth with Gmail and Drive read-only scopes |
| `GET /v1/connectors/google/status` | Returns the connected Google account without a token |
| `DELETE /v1/connectors/google` | Removes the saved Google refresh token |
| `POST /v1/connectors/wispr/start` | Discovers and starts OAuth for an allowlisted Wispr Flow MCP URL |
| `GET /v1/connectors/wispr/status` | Returns the Wispr connection state without a token |
| `DELETE /v1/connectors/wispr` | Removes the saved Wispr refresh token |
| `GET /v1/legacy/snapshot` | The whole ledger, for desktop until it moves to pages |
| `GET /v1/legacy/revisions` | Revisions by entity ID, so a snapshot client can still send a revision check |

Feed parameters: `from`, `to`, `accounts`, `categories`, `kinds`, `search`, `limit`, `cursor`.
`limit` is capped at 100. A cursor is bound to the filters that produced it and a mismatch is a
400, not a silent restart from the first page. Percent and underscore are literal characters in
`search`.

## Sign-in and server keys

The phone signs in with Google instead of receiving a token from the enrolment script. The Worker
starts the flow, keeps the PKCE verifier, and hands the phone a one-time exchange secret over HTTPS.
Google returns to the connector callback, the Worker checks the ID token's issuer, audience,
expiry, and verified email against `ALLOWED_EMAILS`, then redirects to `ego://auth` with a
one-time code. The code redeems once, with the matching secret, within ten minutes, and creates a
device row with the account email.

API keys for outside services are Worker secrets: `OPENROUTER_API_KEY` (and optional
`ASSISTANT_MODEL`), `TRELLO_API_KEY`, `TRELLO_TOKEN`, and `OPENAI_API_KEY`. `GET /v1/session`
reports which exist so the phone can say what is set up. A new service follows the same shape: a
secret, a route that calls the service, and a flag in `ServiceStatus`.

## Writes

Every write arrives as an operation with a device-generated `operationId`, the `entityId`, and
the revision the device expected. Repeating an operation returns its first result instead of
writing again, and reusing an ID with a different payload is rejected. A stale revision returns
409 with the current record so the app can offer Keep mine or Use saved version.

Gym records use the same path: `gymCategory`, `gymExercise`, and `gymSet` take create, update, and
delete; `gymWorkout`, keyed by its date, takes save. Deleting an exercise keeps its sets and hides
them from every read, and a category with live exercises cannot be deleted. Migration `0005` adds
the tables and rebuilds `changes` without the CHECK that listed entity names, so another app can
join the change log without rebuilding it again.

`diaryMessage` takes create, update, and delete. A message carries its formatting and attachments
as JSON, and every media ID it names, previews and custom emoji included, must already have a row
in `diary_media`. The Worker writes that row only after R2 has the whole file, so a message can
never point at a file that is not there. An attachment whose `mediaId` is null is a file that never
reached Ego, like a video Telegram left out of an export.

`taskBoard`, `taskList`, `taskLabel`, and `taskCard` take create, update, and delete. Archiving is
an update that sets `archivedAt`. A list or label cannot move to another board. A card names its
board and list, and the list has to be live and on that board; label IDs are not checked, since a
label deleted on another device just stops showing. Every media ID a card's attachments name must
have a row in `task_media`. Deleting a board or list keeps the rows under it, and every read joins
on live parents.

`sheet` and `sheetRow` take create, update, and delete. A sheet is checked as a whole: its first
column is the row name and must be plain text, and option, column, and row type IDs are unique.
A row names its sheet, which has to be live; its cells are checked for shape only, so a cell left
behind by a deleted column is harmless. A row cannot move to another sheet. Deleting a sheet keeps
its rows, and every read joins on a live sheet.

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

## Backups

A second cron trigger runs at 07:00 UTC every day. It asks Cloudflare's D1 export API for a SQL
dump, the same file `wrangler d1 export` writes, and streams it into the private `ego-backups`
bucket as `d1/YYYY-MM-DD.sql`. The bucket has no lifecycle rule, so every dump is kept. Each object
carries the Time Travel bookmark it was taken at in its `bookmark` metadata.

The export API is not reachable through the D1 binding, so the Worker needs a Cloudflare API token.
Create one in the dashboard with Account, D1, Edit on this account only, then:

```sh
cd apps/api
npx wrangler r2 bucket create ego-backups   # once
npx wrangler secret put D1_EXPORT_TOKEN
```

A failed run throws, so it shows as an error on the Worker's cron events. To restore, download a
dump and load it into an empty database:

```sh
npx wrangler r2 object get ego-backups/d1/2026-10-02.sql --remote --file ego.sql
npx wrangler d1 create ego-restore
npx wrangler d1 execute ego-restore --remote --file ego.sql
```

Point `database_id` in `wrangler.toml` and `D1_DATABASE_ID` at the new database once it checks out.
For a mistake inside the Time Travel window (7 days on the free plan, 30 on Workers Paid),
`wrangler d1 time-travel restore ego` is faster.

## Google Health

The phone connects Google Health from its Health app. The Worker requests the read-only
`activity_and_fitness`, `health_metrics_and_measurements`, `sleep`, and `settings` scopes on the
same Google OAuth client and redirect URI as sign-in, then sends the browser to `ego://health`.
The Worker encrypts the refresh token with the connector key and keeps it in `health_connections`.

A cron trigger runs every 15 minutes. Each run reads the last ten days again, because a band syncs
late, and one more 84-day slice of history until a year is in D1. That keeps a run at about 30
Google requests. Rows land in `health_days`, `health_sleeps`, and `health_heart` through one
`json_each` statement per table, and only a changed row gets a new `updated_at`, which is how the
phone downloads just the difference. A run takes a lock in `sync_started_at`, so the cron and the
phone never pull at the same time.

Google's testing mode expires refresh tokens after seven days. Keep the OAuth consent screen in
production. An unverified app is fine for a single user.

## AI assistant

`POST /v1/assistant/turns` runs one turn of the phone's AI chat. The Worker stores the user's
message, builds a system prompt from today's date, the phone's time zone and units, and the live
accounts, categories, habits, and exercises, then calls OpenRouter with the tool list in
`packages/core/src/assistant-tools.ts`. Each tool call is validated against its schema, run
against D1, and fed back, up to eight model calls a turn. The answer is an NDJSON stream so the
phone can show text as it arrives.

Reads cover mood, habits, gym sets and records, Google Health days, sleeps and heart rate curves,
money summaries, accounts, budgets, transactions, and Canvas assignments. Writes go through the
same `applyOperation` path as sync, so every change lands in the change log and reaches the phone
on its next pull. `record_transactions` stops the turn and returns a Confirm card;
`POST /v1/assistant/confirm` applies or rejects it and lets the model finish its reply. The other
writes apply at once and keep an undo plan in `assistant_tool_calls`, which
`POST /v1/assistant/undo` runs. Every stored message is the model-format message, so the next turn
rebuilds its context from the table; a tool call left without a result by a dropped connection
gets a synthetic "interrupted" result. Migration `0012_assistant.sql` adds the three tables.

## Talk to AI

The Worker needs an OpenAI project API key with access to `gpt-live-1`, `gpt-5.6-terra`, Responses
delegation, and hosted web search. Store a replacement key as a Worker secret:

```sh
cd apps/api
npx wrangler secret put OPENAI_API_KEY
```

Never put this key in `wrangler.toml`, an app setting, or the repository. Revoke any key pasted
into chat before adding its replacement.

The Worker accepts an SDP offer and validated user preferences. Users can choose voice or text
chat, answer detail, reasoning effort, web search policy, delegated response limit, connected
read tools, and two confirmed write tools. The Worker fixes the models, schemas, host allowlists,
result limits, and tool policy. Successful session responses contain only `sessionId` and the
WebRTC answer SDP. Errors do not include OpenAI or provider response bodies.

Gmail calls use the Gmail API with `gmail.readonly`. Google Drive uses OpenAI's hosted connector
with `drive.readonly`. Wispr MCP URLs must use `https://api.wisprflow.ai`; OAuth discovery can only use
Wispr's `https://mcp-auth.wisprflow.com` authorization server and cannot send
the Worker to another host. The Worker filters the discovered Wispr tool list to read operations
before it gives those names to OpenAI. It stores refresh tokens with AES-GCM and never returns an
access or refresh token to Electron.

`ego_record_transaction` and `trello_create_card` stop until Electron sends the result of a visible
Confirm or Reject button. Call IDs are idempotency keys. The audit rows contain the tool name,
approval result, outcome, and time. They do not contain arguments, email text, documents,
transcripts, or audio.

GPT-Live voice time costs $0.05 per minute, billed per second. Delegated model tokens and web
search calls cost extra. Creating a WebRTC session reserves 15 seconds. OpenAI credits that amount
against the running session rather than adding 15 seconds to it. Check the current
[GPT-Live model page](https://developers.openai.com/api/docs/models/gpt-live-1) and
[WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live) before deployment.

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
