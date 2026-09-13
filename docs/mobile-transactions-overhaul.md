# Mobile transactions overhaul

## Recommendation

Make the phone's local database the source for everything the user sees. Save a transaction locally, update the list and balance immediately, then synchronize through a small Cloudflare Worker. Keep D1 as the remote database initially.

The app should open to usable data without waiting for the network. Recording lunch in a basement should work. Returning from a receipt should preserve the transaction list's position. A failed synchronization should leave a recoverable pending change, with a clear explanation of what happened.

HTTPS remains the transport between the phone and the server. The architectural change is to stop sending SQL and Cloudflare account credentials from the phone to the account management API. A Worker owns remote validation, SQL, migrations, and synchronization. Its D1 binding provides database access without a Cloudflare account API token in the app. This is the documented [Workers binding model](https://developers.cloudflare.com/workers/runtime-apis/bindings/).

This recommendation assumes one person using mobile and desktop, modest personal transaction volume, USD amounts, and a preference for low maintenance. Keep Expo, React Native, the existing domain rules, and D1. A different database provider or a native rewrite would add migration work before addressing the current experience.

## Scope and delivery status

This document plans the architecture migration and the mobile Activity experience. Account, category, receipt, and budget changes appear only where transactions depend on them. Desktop redesign, Trello, T3, bank integrations, investment tracking, and multi-user accounts are outside this phase.

Implemented with this plan:

- Activity displays at most 50 transactions per page.
- Previous and next buttons include disabled boundary states and a visible page count.
- A result count states which transactions the current page contains.
- Sorting uses date, creation timestamp, and ID as a deterministic tie breaker.
- Search and period changes return to page one and clear selection.
- Select page replaces the ambiguous Select all action. Moving between pages clears selection.
- Search includes receipt merchants and destination account names.
- Rows and selection controls have larger touch areas.
- Date group totals say Shown when the list contains only a page of the matching history.
- Empty search results suggest changing the search or period.

This is presentation pagination over the existing snapshot. The client still downloads all transactions and receipt items. It is an immediate bound on rendered rows, not a completed data architecture migration. The next phase must replace snapshot-dependent reads before reducing downloaded history.

Validation completed for this change is mobile TypeScript checking and 43 passing mobile tests. New tests cover page boundaries, deletion shrinkage, empty results, deterministic ties, and preserving the original snapshot. Native visual and interaction checks remain necessary. No infrastructure has been deployed and no production data has been migrated.

Phase 2 now exists in the repository as `packages/api-contracts` and `apps/api`, with the migrations, device authorization, paginated reads, aggregates, change log, and idempotent operations described below. It is not deployed. 60 tests cover it: cursor and filter validation, operation guards, and the Worker's SQL run against `node:sqlite` through a D1-shaped adapter. That adapter is not the D1 engine, so the Phase 2 gate still needs a staging D1 database, a query-plan inspection of the feed index, and an aggregate comparison against the current snapshot calculation.

Three follow-up fixes named in the writes section are also done: the provider's mutation wrapper takes a callback and starts the request only after the read-only, configuration, and busy checks; busy state uses try/finally; request generations stop a superseded refresh from overwriting a newer snapshot. The mobile snapshot cache key is now derived from the connection, so a failing new connection cannot show the previous connection's ledger.

Phases 3 and 4 now exist as well. The phone has its own SQLite database (`apps/mobile/lib/database`), local feed, detail, and aggregate queries (`apps/mobile/lib/repositories`), and an outbox with a sync coordinator (`apps/mobile/lib/sync`). Activity reads and writes that database when the storage-mode switch in Settings is on, showing Pending and Needs attention states with Keep mine and Use saved version. The desktop app can route its money transport through the Worker as a narrow compatibility change, keeping its snapshot UI. See [the setup guide](ledger-setup.md).

221 tests cover the repository now, including ten that run the real Worker against the real device sync code over `node:sqlite`: one operation delivered twice creates one transaction, a transfer moves both balances and agrees with the server, a receipt and its items save as one command, another device's edit and deletion arrive on the next sync, a stale edit comes back as a conflict, and the local and remote feeds return the same order. That integration test also caught a real defect: the device kept its own `created_at` after the server acknowledged a write, which would have desynchronised the feed's sort key between devices.

Phase 5 replaced the page buttons with a virtualized SectionList, added a transaction detail screen with Edit, Delete, and View items, a filter sheet with removable chips, Activity's own period independent from Overview and Budget, restored query, filters, loaded pages, and scroll position when returning from a detail screen, a draft that survives a failed save, and one primary Add action beside Scan receipt. Selection has an explicit Select control rather than only a long press.

Phase 6 exists as tooling rather than a completed migration. `scripts/ego-migrate.mjs` exports the legacy database and compares row counts, every account balance, and the income and expense totals across both sides without writing to either. Settings offers Remove the old connection, which deletes the Cloudflare account token and the cached snapshot chunks from the phone, and stays disabled while any local change is still undelivered. The runbook, the restore procedure, and the rollback are in [the setup guide](ledger-setup.md).

229 tests pass. What is still missing is the part that needs your hardware and your account: no Worker is deployed, the migration scripts have never contacted Cloudflare, and nothing has run on a phone. Expo SQLite needs a development build, and `node:sqlite` is not Expo SQLite. The Phase 5 gate is a device test, and the Phase 6 gate is a verified cutover; neither has happened.

## What the current code does

| Location | Current behavior | Consequence |
| --- | --- | --- |
| `apps/mobile/lib/money.ts` | Posts SQL to Cloudflare's D1 account API | Mobile owns database access and SQL decisions |
| `snapshotQueries` in that file | Fetches all accounts, categories, transactions, purchases, receipt items, budgets, and allocations | Startup and each successful mutation scale with total history |
| `mutateBatch` in that file | Appends all snapshot queries to writes | Recording one transaction also retrieves the ledger |
| `snapshotFrom` in that file | Derives account balances from all transactions | Truncating the snapshot would silently change balances |
| `readCache` and `writeCache` in that file | Split a JSON snapshot across SecureStore entries | No indexed local queries; replacement is not one database transaction |
| `apps/mobile/lib/money-context.tsx` | Holds one snapshot and global busy, error, and read-only states | Unrelated screens share broad refreshes and mutation state |
| `run` in that provider | Receives an already-started request promise | The read-only guard runs after the client method has been called |
| `apps/mobile/app/(money)/transactions.tsx` | Previously mapped all date groups and all rows into a ScrollView | Render work grew with matching history |
| `apps/mobile/lib/period-context.tsx` | Defaults to all time and shares the period across money screens | Activity can open with the largest possible result set |
| `packages/core/src/money.ts` | Contains domain validation and table definitions | Useful foundation to keep, rather than rewrite |

The cache key is also global rather than tied to a database identity. Changing the connection can therefore expose the previous connection's cached snapshot during failure. The replacement local store must have an explicit dataset identity.

The current cache is an offline fallback after a request fails. It is not a database the UI can read and edit independently. Failures and successful remote writes can also be hard to distinguish when the response is lost. Retrying a creation needs an idempotency contract before offline writes are safe.

## Target experience

### Opening Activity

1. Render the last selected period and the first local page.
2. Show existing data immediately when it is available.
3. Start a foreground sync without covering the list with a spinner.
4. Keep the current scroll anchor when remote changes arrive.
5. Offer a small New activity action if applying new rows would move what the user is reading.

Use This month as the initial default for a fresh installation. Thereafter restore the user's last Activity filter. Keep Activity filters independent from Overview and Budget so reading an old receipt does not change the dashboard period.

### Recording an expense

1. Tap Add at the bottom of the screen.
2. Open the existing amount keypad with Expense selected.
3. Prefill today and the last valid account. Leave the category explicit unless a remembered merchant rule supplies it.
4. Keep amount, account, category, date, and notes in one predictable editor.
5. Validate locally and focus the first field that needs correction.
6. Commit the transaction and its pending sync operation together.
7. Close the editor only after that local commit succeeds.
8. Show the new row with a small Pending indicator until the server acknowledges it.

If the row falls outside the current period, say Saved outside this period and offer View transaction. Do not silently change the filter. If local storage fails, retain the draft and show Retry. Do not label a draft as saved until it is durable.

### Editing and deleting

Tapping a transaction should open its detail screen. Put Edit and Delete there. For a receipt-backed transaction, include the merchant, receipt total, and a View items action in the same detail screen. Avoid making similar rows unexpectedly navigate to different tabs.

Edits update the local row after a durable commit. Deletions use a tombstone and expose Undo for a short window. A server-acknowledged deletion needs a defined restore operation if Undo is still offered. Until that exists, keep the existing confirmation and permanent-delete wording.

Long press can continue to enter selection, but add an explicit Select action for discoverability and accessibility. Selection applies to visible or loaded rows and must say so. A future Select all matching action needs a separate confirmation that states the exact count and filter. It should never be implied by Select page.

### Finding an old transaction

Search merchant, notes, category, and both account names for transfers. Add account, type, category, and date filters in a bottom sheet. Show active filters as removable chips above the list. Keep search on the current period and make that period obvious. An empty result can offer Search all time.

Preserve query, filters, loaded page, and scroll anchor when opening a detail screen and coming back. Store filter preferences, but avoid persisting raw search text unless there is a reason to keep it. Do not add trending searches to a private transaction ledger.

## Visual direction

Keep the existing graphite and blue identity. The signature is a readable daily ledger with a clear amount column and quiet date separators. Avoid turning each transaction into a large card or placing charts above the list. Activity's job is to find and change a transaction.

Proposed tokens, to verify on a device:

| Role | Value or treatment |
| --- | --- |
| Screen background | `#121214` |
| Row and sheet background | `#1c1d1f` |
| Primary text | `#e6e6e8` |
| Secondary text | `#b5b5bc` |
| Action accent | `#91c4ff` |
| Positive amount | `#34d399`, always accompanied by a plus sign |
| Typography | Native system family, regular and semibold, tabular amount digits |
| Type scale | 14 for metadata, 16 for rows, 20 for screen emphasis, 32 for amount entry |
| Spacing | 4, 8, 12, 16, 24, and 32 |
| Touch areas | At least 44 by 44 logical points |
| Row height | About 64 points at default text size, allowed to grow |

Use neutral expense text in the eventual redesign and reserve red for destructive actions and failures. The minus sign already communicates outflow. Test this against the existing red expenses before switching the whole screen.

Proposed screen structure:

```text
Activity                                 Select
Search activity
This month       Account       Filters

Today                              Net -$48.20
Groceries                             -$42.20
Checking                 Food
Coffee                                 -$6.00
Credit card              Food         Pending

Yesterday
Salary                             +$2,500.00
Checking                 Income

                  Load older activity

Scan receipt                       Add
```

Date totals must have an explicit scope. A complete daily net can come from a separate aggregate query. A sum of a partial page must say Shown. Filtered totals must reflect the same filters as the rows. Transfers should contribute zero to cash-flow net, while still changing individual account balances.

Keep one primary Add action in the thumb area. Rename the ordinary receipt entry point Scan receipt. The existing Money agent can remain available from the add menu for text and multi-transaction input. Avoid duplicate Add buttons in the header and floating area once this interaction is validated.

Support large text without truncating amounts. Allow account metadata to wrap when necessary. Announce transaction type and formatted amount to screen readers. Selection state, pending state, and errors must have text or accessibility labels as well as color. Respect reduced motion and avoid animated entrances for every row.

## Architecture and ownership

```text
Activity, detail, transaction editor
                 |
       Local transaction repository
                 |
       SQLite records and outbox
                 |
       Foreground sync coordinator
                 |
          HTTPS domain API
                 |
       Cloudflare Worker with D1 binding
                 |
      D1 records, changes, operation receipts
```

Use one Worker and one D1 database. Do not add queues, Durable Objects, a message broker, or a WebSocket connection for the first version. Sync on launch, foreground resume, local writes, and explicit refresh. Add a modest foreground interval only if using both devices demonstrates a need. Push notifications can be considered later; they are not the data transport.

Suggested ownership:

| Module | Responsibility |
| --- | --- |
| `packages/core` | Money types, validation, amount rules, balance rules, receipt invariants |
| `packages/api-contracts` | Request and response schemas, cursor validation, sync operation types |
| `apps/api` | Worker routes, device authorization, domain commands, D1 migrations |
| `apps/mobile/lib/database` | SQLite initialization, migrations, transactions, dataset identity |
| `apps/mobile/lib/repositories` | Local feed, detail, lookup, and aggregate queries |
| `apps/mobile/lib/sync` | Outbox delivery, remote change application, retries, conflicts |
| `apps/mobile/components/money` | Rows, date headers, filters, detail and editor UI |

Use narrow subscriptions. The feed subscribes to feed changes, an account header to its balance, and the editor to reference data. Keep temporary UI state out of database records. Keep network code out of transaction rows.

Expo SQLite provides persistent local SQL storage and supports SQLCipher on native platforms. SecureStore should hold the encryption key and device credential, rather than the ledger itself. Confirm compatibility with this repository's installed Expo SDK before adding it. SQLCipher requires a native build configuration and a development build. See [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/) and [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/).

## Read contracts and real pagination

Split the current snapshot contract into independently useful reads:

| Read | Contents |
| --- | --- |
| Reference data | Accounts and categories, including archived records needed to label history |
| Transaction page | Up to 50 rows, minimal merchant metadata, next cursor, query identity |
| Transaction detail | One transaction and its receipt linkage |
| Receipt detail | One receipt and its item rows |
| Account balances | Complete balances, computed independently of loaded pages |
| Period summary | Income, expenses, and relevant budget totals for the selected range |
| Change page | Ordered committed changes after a sync sequence |

Never calculate a complete account balance from a feed page. Reuse the existing opening-balance and opening-date semantics and verify the SQL aggregate against the core implementation. Treat a transfer as a debit on its source and credit on its destination. Preserve integer cents throughout.

For both local and remote feeds, use descending keyset pagination on `date`, `created_at`, and `id`. Add a matching composite index. A cursor represents the final row of the preceding page. A subsequent page uses this predicate with bound parameters:

```sql
WHERE date < ?
   OR (date = ? AND created_at < ?)
   OR (date = ? AND created_at = ? AND id < ?)
ORDER BY date DESC, created_at DESC, id DESC
LIMIT 51;
```

Combine that predicate with date and other filters inside correctly grouped conditions. Return 50 records and use the extra record to determine whether another page exists. Validate cursor version, tuple fields, and filter identity on the server. Cap page size at 100 even if the caller requests more. Reject malformed cursors as invalid requests.

Apply identical filters to list and count queries. Search values are parameters, never SQL fragments. Decide whether percent and underscore are literal characters in search and escape them accordingly. Start with simple indexed date and account filtering plus text matching. Add full-text search only after measurements show a need.

A keyset cursor does not freeze mutable history. Editing a transaction's date can move it between pages. For the first version, invalidate the loaded feed after a relevant edit, deduplicate appended rows by ID, and restore the nearest surviving scroll anchor. Do not claim snapshot-stable pagination unless the API implements a revision-pinned read.

Keep the immediate Previous and Next implementation until the repository layer exists. Then use a SectionList with individual rows virtualized and Load older activity at the end. Automatic prefetch can run near the end, but retain an explicit retry/load button. Do not virtualize whole date cards containing hundreds of children.

## Writes, local durability, and synchronization

Every local write commits both the changed record and an outbox operation in one SQLite transaction. Generate stable record and operation IDs on the device. The operation includes its entity, command type, expected server revision, payload, and creation time. Generate IDs once, not on retry.

The Worker validates the request and applies a command atomically with an operation receipt and a change-log entry. A unique operation ID makes retries safe. If the response is lost after commit, sending the same operation returns its previous result. Reject reuse of an operation ID with a different payload.

Use D1's prepared statements and batch API for atomic groups, with all preconditions represented inside the database operation. A separate read followed by an unconditional write is not a conflict check. Cloudflare documents transactional batch behavior in the [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/). Test conditional revision updates, operation receipt insertion, and change-log insertion together before enabling offline writes.

Sync order:

1. Acquire one local sync lock for the current dataset.
2. Deliver pending operations in dependency order.
3. Apply acknowledgements without overwriting newer pending local edits.
4. Pull changes after the last committed server sequence, in bounded pages.
5. Apply each change page and its new cursor in one local transaction.
6. Refresh affected local queries and release the lock in a finally block.

Use a server sequence for changes, not device timestamps. Include deletes as tombstones so an offline device learns about them later. For a personal ledger, retain the change log and tombstones initially. Compaction needs a minimum supported cursor and a defined rebootstrap response before it can be introduced.

On transient failures, retry with capped exponential delay and jitter while the app is active. Keep operations durable when the operating system suspends the app. On authentication failure, pause delivery and ask for reconnection. On validation failure, leave the transaction visible as Needs attention with an Edit action. On conflict, retain both versions for review.

Prefer optimistic concurrency to silent last-write-wins for money records. An operation supplies its expected revision. A stale revision returns the current server version. Offer Keep mine or Use saved version, with amounts, dates, account names, and notes visible. Keep mine is a new validated command against the latest revision.

Receipt items and their parent transaction are one command. A partial receipt save must never leave an unmatched total. A transfer remains one transaction record with two account references. Do not implement it as two unrelated offline writes.

Before the full migration, change the existing provider's mutation wrapper to accept a callback and invoke it only after read-only, configuration, and busy checks. Use try/finally for busy state. Track request generations so an old refresh or old connection cannot overwrite a newer snapshot. These are separate follow-up fixes, not part of the pagination implementation above.

## Personal authentication and setup

Keep setup small. Provision one high-entropy, revocable credential per device through an owner-operated setup command. Store only its hash on the server and its value in native SecureStore. Use HTTPS, redact authorization headers, and bind each credential to this personal dataset. A stolen phone credential should not be a Cloudflare account credential.

The setup UI needs the API address and device credential, preferably imported through a QR code. Do not add organizations, invitations, billing, or a general identity platform. Show device names and allow revocation through the owner tool. Document how to revoke a lost device and enroll a replacement.

Store Cloudflare deployment credentials outside app builds. Keep migrations in the API project and run them as a deployment step. Remove schema creation from mobile startup after cutover. Mobile handles only its own SQLite migrations.

## Migration without breaking desktop

Desktop currently also writes directly to D1. That matters even though its UI is outside this phase. A Worker-only change log would miss desktop writes.

Use this migration sequence:

1. Export a remote backup and verify that it can be restored into a separate database. Record counts and balance totals without logging personal transaction contents.
2. Introduce versioned remote migrations and additive API metadata. Preserve existing entity IDs, cents, transaction dates, and receipt relationships.
3. Build the Worker against a test copy. Compare API balances, summaries, and transaction pages with the current snapshot calculation.
4. Implement paginated remote reads and separate aggregates before cutting down snapshot downloads.
5. Build and migrate local SQLite. Namespace it by dataset identity. Import any existing cache only after matching it to the intended dataset; otherwise fetch a fresh bootstrap.
6. Bootstrap from a consistent server boundary. Prefer a brief write pause for this personal migration, record the starting sequence, download bounded tables, then resume and pull later changes. Do not mix pages from an uncontrolled moving dataset and call them a snapshot.
7. Replace desktop's money transport with the Worker API as a narrow compatibility change. Its existing UI can still request a complete legacy snapshot temporarily.
8. Confirm all writers pass through the Worker before relying on the change log. Alternatively, design and test database triggers for every legacy mutation. Do not leave direct writes untracked.
9. Enable mobile local reads with online-only writes first. Compare values and inspect sync behavior.
10. Enable the mobile outbox after idempotency, crash recovery, and conflict tests pass.
11. Remove the mobile D1 account token and old snapshot cache only after a verified sync and successful cold restart.
12. Revoke obsolete direct-access credentials once desktop has migrated.

Use an explicit storage-mode setting during development. Never run the legacy client and new outbox as simultaneous writers for the same action. Keep the prior database export and release available through the first migration validation period.

Rollback must account for pending local writes. First pause synchronization and export or reconcile the outbox. Do not downgrade to the read-only snapshot implementation while unsent transactions exist. Keep migrations additive until rollback no longer depends on the old schema.

## Failure behavior

| Situation | User experience | Recovery |
| --- | --- | --- |
| No network, local data exists | Activity remains usable; pending count stays visible | Sync when foreground connectivity returns |
| First launch without data or network | Setup explanation and Retry | Bootstrap when connected |
| Server rejects credentials | Existing local history remains readable | Reconnect device |
| Remote write succeeds, response disappears | Local row remains pending briefly | Retry the same operation ID |
| Local disk commit fails | Editor retains unsaved input | Free space and retry |
| App closes after local save | Transaction survives restart | Resume outbox delivery |
| Another device edits the same row | Needs attention on that row | Resolve against current server revision |
| A deleted account is referenced by pending input | Preserve pending draft and explain account problem | Choose a valid account |
| A later transaction page fails | Keep already loaded rows | Retry that page |
| Dataset changes in Settings | Clear subscriptions and switch stores | Bootstrap the selected dataset |

Show sync status near Activity's title or in a compact status row. Use Synced, 2 pending, or Needs attention. A successful local save and a completed remote sync are different events and need different wording.

## Delivery phases and acceptance gates

### Phase 1. Bounded Activity rendering

The included change completes the immediate page controls and search improvements. Validate 0, 1, 50, 51, and several hundred matching transactions on a native device. Check a date spanning two pages, deletion on the final page, period changes while selecting, keyboard dismissal, receipt navigation, and font scaling. Keep the full-snapshot limitation visible in technical documentation.

### Phase 2. API and independent read models

Create the Worker, device authorization, migrations, domain commands, paginated reads, and aggregate queries. Add a transaction-feed index and inspect representative query plans. Compare balances and budget values against current core calculations for income, expenses, transfers, archived references, opening dates, and receipts.

Gate: an Activity page query has a bounded response, and loading a partial history never changes a complete balance. The app binary no longer needs a Cloudflare account token for the new path. Test against a staging database, not the user's ledger.

### Phase 3. Local database and fast opening

Add SQLite repositories, migrations, dataset-scoped storage, bootstrap, and query subscriptions. Read Activity locally. Retain online-only writes during this step to isolate storage migration defects from sync defects.

Gate: cold launch shows stored history without internet, changing a filter does not require a remote request, and process termination cannot leave the bootstrap cursor ahead of committed data.

### Phase 4. Durable writes and cross-device sync

Add the outbox, operation receipts, revision checks, tombstones, conflict UI, and narrow desktop transport migration. Exercise lost responses, duplicate delivery, reordered acknowledgements, and process termination at each commit boundary.

Gate: repeating an operation creates one transaction, a transfer changes both balances correctly, receipt saves are atomic, and desktop edits reach mobile after the next foreground sync.

### Phase 5. Mobile interaction and visual pass

Replace page navigation with a virtualized feed if device testing supports it. Add the detail screen, filter sheet, scroll restoration, draft recovery, sync labels, and a single primary Add action. Apply the visual tokens and audit large text, screen readers, safe areas, keyboard overlap, and small screens.

Gate: the user can find an old receipt, edit its category, and return to the same location without losing filters. Airplane mode supports durable transaction creation. No essential action depends only on a swipe or long press.

### Phase 6. Cutover and cleanup

Run the migration on the personal dataset, compare counts and aggregates, verify a restart, and remove legacy credentials and cache only after sync is confirmed. Update README and setup instructions. Retain a restore procedure and exercise it against a disposable copy.

Gate: mobile's normal transaction path contains no Cloudflare account API requests, full-ledger refresh after every write, or ledger JSON stored as secure-store chunks.

## Measurement and verification

These are proposed targets, not measured claims:

- Warm return to Activity displays cached rows within 150 ms on the user's phone.
- Cold opening displays existing local rows within 500 ms after JavaScript starts.
- A local transaction commit and visible acknowledgement complete within 150 ms for ordinary entries.
- Local search returns the first page within 100 ms for 10,000 synthetic transactions.
- A standard transaction page stays below 100 KB and excludes receipt item arrays.
- Mounted rows remain bounded during long browsing sessions.
- No network request is required to save an offline transaction once initial setup is complete.

Measure startup, local query duration, local commit duration, page payload bytes, retry count, pending-operation age, and sync duration. Use synthetic data in tests and logs. Keep financial text, credentials, and raw SQL parameters out of diagnostic output.

Unit tests should cover ordering ties, cursor filters, date boundaries, transfer accounting, archive behavior, revisions, and receipt totals. Database tests should cover local write plus outbox atomicity and remote operation deduplication. Integration tests should interrupt synchronization between commits. Native interaction tests should cover keyboard and sheet behavior, navigation restoration, large text, and page controls.

Benchmark a release build on the actual phone. A desktop browser preview cannot establish native scrolling performance, keychain behavior, SQLCipher compatibility, or app suspension behavior.

## Later improvements, in priority order

1. Remember the last valid account and preserve unfinished transaction drafts.
2. Add Duplicate transaction for recurring manual expenses.
3. Add merchant rules that suggest categories and always allow correction.
4. Add CSV import preview with duplicate detection before any commit.
5. Add encrypted export and a tested restore flow independent of a device installation.
6. Add optional amount privacy on the app switcher and screen.
7. Consider recurring transaction templates after ordinary creation and sync are reliable.

Leave banking connections, predictive spending, extensive dashboards, and background AI classification for later. The next useful milestone is a phone that opens the ledger immediately and records an expense reliably when the network is unavailable.
