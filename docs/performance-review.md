Mobile has several avoidable data-loading costs. I would start with transaction pagination and Gym history loading, then replace the full money snapshot with queries for each screen. These changes address work the app does repeatedly as its history grows.

Reviewed on September 28, 2026, at commit `66d5b6d`. The review covers the mobile app and its Worker, with desktop observations at the end. Application behavior was not changed.

**What I measured.** I ran the repository's actual mobile repositories and sync code against its Node SQLite test adapter. Fixtures contain synthetic data only. Timings are medians of seven runs after one warm-up, except the bootstrap measurement, which is one run. The environment is Windows with Node 22.19.0 and an in-memory database. These measurements exclude native SQLite call overhead, disk I/O, React rendering, and network latency. They establish scaling problems, not launch times or frame rates on a phone. No Android device was attached.

| Priority | Improvement | Expected benefit | Scope | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Remove repeated counts and improve the transaction cursor predicate | Faster Activity pagination as history grows | Small | Measured SQL costs and query plans |
| 2 | Load Gym days independently of lifetime records | Faster day changes and exercise opening | Medium | Measured history-loading cost |
| 3 | Replace global money snapshots with screen queries | Less startup work, memory use, and work after saves | Large, incremental | Measured snapshot costs and confirmed call paths |
| 4 | Reuse statements during bootstrap, then consider resumable downloads | Faster first sign-in and recovery after a database reset | Medium to large | Measured statement count and inspected Expo implementation |
| 5 | Paginate and virtualize Purchases | Smoother receipt browsing and lower memory use | Medium | Confirmed unbounded rendering |
| 6 | Resize receipt photos before base64 encoding | Smaller uploads and less temporary memory | Small to medium | Confirmed full-resolution input path |
| 7 | Cache the Canvas feed on the Worker | Faster Study refreshes and fewer upstream requests | Medium | Confirmed upstream request path |

**1. Transaction pagination spends most of its time recounting rows.**

[`localTransactionPage`](../packages/local/src/repositories/transactions.ts) fetches a page and then runs a joined `COUNT(*)` across every matching transaction. It repeats that count on every page. [`loadOlder`](../apps/mobile/components/money/LocalActivity.tsx) does not even use the returned count.

| Synthetic transactions | Complete local page, 50 items | Joined count alone | Shared page SQL alone, 51 rows |
| --- | ---: | ---: | ---: |
| 1,000 | 0.64 ms | 0.26 ms | 0.15 ms |
| 10,000 | 2.95 ms | 2.65 ms | 0.15 ms |
| 50,000 | 17.17 ms | 16.01 ms | 0.15 ms |

The page-only column excludes the local outbox-status subquery, so it is not an exact prediction of the complete page after removing the count. It does show that counting dominates this fixture.

Compute the count for the first page and reuse it until the filters or relevant data change. Key any cache by dataset, query identity, and money data version. Use `LIMIT pageSize + 1`, which the code already does, to determine whether another page exists. For filters that do not need account, category, or merchant names, simplify the count to avoid unnecessary joins.

There is a second fix in [`cursorCondition`](../packages/api-contracts/src/queries.ts). The current descending cursor expands into three `OR` branches. In the local query plan, it scans the feed index. The equivalent row comparison uses an index search:

```sql
WHERE t.deleted_at IS NULL
  AND (t.date, t.created_at, t.id) < (?, ?, ?)
ORDER BY t.date DESC, t.created_at DESC, t.id DESC
LIMIT ?
```

At a cursor 90 percent through 50,000 transactions, the existing shared page query took 2.79 ms. The row-comparison experiment took 0.19 ms and returned identical rows. The existing composite index already supports it. This comparison used unfiltered fixtures; verify account, category, date, and search filters, equal timestamps, transfers, tombstones, and outbox states before adopting it. The shared helper affects both mobile and the API. Verify the remote D1 plan too.

**2. Gym loads lifetime history to decorate a single day.**

[`loggedDay`](../apps/mobile/app/gym/index.tsx) reads the chosen day, then sequentially fetches every historical set for each exercise in that day. It calculates personal records before returning the day to the screen. [`Track`](../apps/mobile/app/gym/track.tsx) also loads the exercise's entire history before rendering its Track page, even though History and Graph mount only after visiting their tabs.

For a fixture with six exercises, five sets per exercise per day, and 1,000 days:

| Work | Result |
| --- | ---: |
| Sets visible on the chosen day | 30 |
| Rows returned by the current day-plus-records path | 30,036 |
| Queries in that path | 9 |
| Day query without lifetime records | 1.10 ms |
| Day query plus lifetime records | 91.37 ms |

Render the day's sets first. Read the latest previous set separately for form defaults. Calculate trophy markers separately and cache them per exercise and data version. Invalidate affected exercises after local edits or sync, including deletions and changes to units. Fetch paginated history when History opens and date-bounded aggregates when Graph opens. Preserve the existing record rules and tie handling.

Simply putting the historical reads in `Promise.all` still reads and converts all the same rows. Reducing that work is the larger improvement.

**3. Money snapshots load every transaction and receipt item.**

[`localSnapshot`](../packages/local/src/repositories/snapshot.ts) issues eight sequential queries. It reads all transactions, purchases, receipt items, budgets, and allocations, then constructs a complete JavaScript snapshot. [`MoneyProvider`](../apps/mobile/lib/money-context.tsx) runs this when the ledger becomes ready and when the money version changes. It lives in the [root layout](../apps/mobile/app/_layout.tsx), so the work starts even if the user wants Gym or Study.

| Synthetic transactions | Snapshot time | JSON size of snapshot |
| --- | ---: | ---: |
| 1,000 | 2.40 ms | 0.25 MB |
| 10,000 | 22.10 ms | 2.49 MB |
| 50,000 | 161.51 ms | 12.47 MB |

These fixtures have ten accounts, twenty categories, and no receipts or budgets. JSON size describes the amount of data represented, not measured JavaScript heap usage. Mobile does not transmit this local snapshot over the network.

[`LedgerProvider`](../apps/mobile/lib/ledger-context.tsx) already reads reference data and balances before setting the cached ledger ready. The snapshot then reads that information again. After a money write, it refreshes those reads and increments the version. A subsequent sync acknowledgment can trigger another refresh. Gym readiness also waits behind the initial money reference and balance reads.

Replace snapshot consumers gradually. Accounts needs balances and account metadata. Overview needs date-bounded totals and chart buckets. Budget needs the selected month's spending and allocations. Purchases needs receipt headers and item counts, with items loaded on open. The Activity screen already demonstrates the paginated approach, and `localSummary` already supplies some of the needed aggregate queries.

Separate database readiness from each area's query readiness. Keep the shared sync coordinator, but defer unrelated screen data. [`ReminderProvider`](../apps/mobile/lib/reminder-context.tsx) currently depends on the complete snapshot just to check whether a transaction exists today. Replace that with an indexed existence query before moving or deferring MoneyProvider.

Budget warnings and validation also consume snapshots today. Preserve those rules with targeted queries; moving the provider alone is not a complete fix. Account balances must continue to cover the full ledger, including pending local writes.

**4. First download performs one prepared-write cycle per record.**

The Worker [`readBootstrap`](../apps/api/src/reads.ts) returns all live money, gym, and mood records in one response. Mobile [`bootstrap`](../packages/local/src/sync/coordinator.ts) applies them one at a time inside one transaction. A synthetic 10,030-record download issued 10,041 statements inside that transaction and took 260 ms in the Node adapter, excluding download time.

The transaction already avoids a disk commit per row. The remaining issue is repeated statement preparation and native calls. [`database/index.ts`](../apps/mobile/lib/database/index.ts) delegates each write to Expo's `runAsync`. The installed Expo implementation prepares, executes, and finalizes a statement for each call.

Expose prepared statements or a bounded bulk-write method in the database adapter. Prepare each entity's upsert once per import, reuse bound parameters, and finalize in `finally`. Keep revision checks and pending-write protection. Do not replace parameter binding with string interpolation.

If first-download size remains a problem, add resumable pages with progress reporting. That is a protocol change. Preserve the sequence captured before download, replay later changes, and only infer deletions after the complete bootstrap arrives. A partial download must never look like a complete ledger. Measure first download separately from ordinary launches, which already use the local copy.

**5. Purchases renders the whole list.**

The [Purchases screen](../apps/mobile/app/(money)/purchases.tsx) groups every purchase and renders every row inside a `ScrollView`. Each receipt's items are already present in the snapshot, even while only its merchant, total, and item count are visible.

Use a paginated header query and `SectionList`, with items loaded when the user opens a receipt. Keep row props stable. Add `getItemLayout` only if the actual row and section heights are predictable. Measure with a large receipt history before tuning window sizes or replacing the list library.

**6. Receipt uploads need a pixel limit.**

The [money agent](../apps/mobile/app/transaction-image.tsx) asks the camera and image picker for base64 with quality `0.85`, but does not resize image dimensions. JPEG quality does not cap resolution. Base64 adds roughly one third to the binary size before JSON and temporary copies.

Resize before encoding, with an initial experimental longest-edge limit around 1,600 to 2,000 pixels. Verify small text and long receipts before choosing a default. Keep a file URI for previews and release encoded data when the request finishes. Track image bytes, upload duration, and model response duration separately so an upload fix is not confused with faster inference. The existing 10 MiB validation limit is a rejection limit, not an optimization.

**7. Study refreshes always fetch Canvas upstream.**

The mobile [Study provider](../apps/mobile/lib/study/context.tsx) already shows cached SQLite data and uses a five-minute freshness check. On a server refresh, [`readStudyAssignments`](../apps/api/src/study.ts) downloads and parses the Canvas calendar again, then reads completion marks.

Cache the feed or parsed assignments on the Worker for a short interval, initially aligned with the existing five-minute client policy. Use conditional requests if Canvas returns validators. Scope the cache to the dataset and feed configuration, retain current completion marks separately, and keep the secret feed URL out of public cache keys and logs. Read marks concurrently with a needed feed refresh. This improves refresh latency and resilience; Study's cached first display already avoids the network.

Several existing choices are worth keeping. Activity already uses a `SectionList`, memoized rows, keyset pagination, and a 250 ms search debounce. Gym history and calendar, and Study assignments, also use virtualized lists. SQLite uses WAL. Writes enter a durable outbox before network delivery. Sync prevents overlapping runs and separates money, gym, and health invalidation. The rest timer separates clock updates from action state, so a ticking clock does not automatically invalidate every timer consumer. There is no reason to replace these systems wholesale.

I would implement the small pagination changes first, then decouple Gym rendering from records. Next, migrate money screens away from full snapshots. Add prepared imports alongside first-download measurements. Prioritize photos, Purchases, and Study according to actual use. The broader Ledger context also changes for sync status, errors, and writes; split subscriptions only if a React profile shows costly unrelated renders.

Before calling the mobile work complete, measure a release build on a physical Android phone. Capture cold process launch to launcher, launcher to usable Finance and Gym, warm return from background, local save acknowledgment, first download, Activity search and pagination, receipt upload, and Study refresh. Record median and p95 durations, query counts, rows returned, peak memory, and JS/UI frame behavior. Run offline, on ordinary Wi-Fi, and with a slow connection. Include both representative data and the larger fixtures used here. Keep measurements free of financial notes, receipt contents, tokens, and secret URLs. No numeric phone launch target is justified by the current measurements.

Desktop findings are secondary to this review. The production build succeeded and emitted one 777,713-byte renderer JavaScript bundle. It is not minified. An isolated esbuild minification experiment reduced it to 441,845 bytes, about 43 percent smaller, without establishing a launch-time improvement. Desktop also waits for a write, a complete legacy snapshot, and all revisions in sequence. Returning from Settings or Talk to AI remounts MoneyWorkspace and fetches again. Reusing cached data immediately, maintaining workspace state, and adopting paginated reads would be more consequential than bundle size alone. Keep snapshot data and revisions consistent when changing that protocol.

The local benchmark sources and raw measurements are in the ignored `out/performance-audit` directory. `measure.ts` exercises money reads, bootstrap, cursor plans, and bundle minification. `gym.ts` reproduces the existing day-plus-records query sequence. `results.json` and `gym-results.json` contain the results. These scratch artifacts are available in this workspace but are not tracked by Git.

Research references, accessed September 28, 2026:

- [React Native performance overview](https://reactnative.dev/docs/performance). Explains JS and UI frame behavior and why profiling must use release builds.
- [React Native list configuration](https://reactnative.dev/docs/optimizing-flatlist-configuration). Covers virtualization, memoized rows, window-size tradeoffs, and fixed-height layout hints.
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/). Documents reusable prepared statements, finalization, WAL, and transaction behavior. The installed package source confirms the convenience-method preparation cycle.
- [SQLite row values](https://www.sqlite.org/rowvalue.html). Documents compound comparisons for scrolling queries.
- [Cloudflare D1 indexes](https://developers.cloudflare.com/d1/best-practices/use-indexes/). Recommends checking query plans and rows read before adding indexes. Existing feed indexes were sufficient for the local cursor experiment.
- [Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance). Supports deferring unused work and avoiding blocking network and main-process work for the secondary desktop findings.
