# Content

Content saves bookmarks directly in Ego. It does not connect to Raindrop.io.
The web and desktop share a library screen. The phone has a native screen.

Bookmarks have a URL, title, description, cover image URL, notes, collection,
tags, type, and favorite flag. Search includes the URL, description, tags, and notes.
Card and list views are available on all three clients. The web and desktop can
export the current results as JSON.

Edits enter the existing local SQLite outbox and sync through the Worker.
Trash hides a bookmark without deleting it; Restore brings it back.
Deleting a collection leaves its bookmarks in Unsorted. Conflicting edits use
Ego's existing Keep mine and Use saved version controls.

## Release

Apply `apps/api/migrations/0026_content.sql` and deploy the Worker before releasing
the clients. The migration adds `content_items`, `content_collections`, and
`content_keys`. Numbers 0022 through 0025 belong to the separate agent work.

From the repo root, the existing release commands are:

```powershell
npm run migrate:remote --workspace @ego/api
npm run deploy --workspace @ego/api
```

Release web, desktop, and mobile through their usual workflows. Local databases
migrate on open. Bootstrap version 9 downloads Content for existing devices.

## Page screenshots

A bookmark saved without a cover image gets a screenshot of its page as the cover,
as in Raindrop. The Worker opens the page in Cloudflare Browser Rendering at
1024 by 576, saves a 640 by 360 JPEG to the `ego-content-previews` R2 bucket, and
sets the bookmark's cover URL to `/v1/content/previews/<random name>.jpg`. The
change syncs like any other edit, so no client release is needed.

The Worker renders one page right after an extension capture or a sync push, and
up to six more on each 15-minute cron run. A signed-in device can render four at
once with `POST /v1/content/previews`. A page that fails, for example by
answering 403 to the headless browser, is retried after six hours, at most three
times. Changing a bookmark's URL renders it again. Trashed bookmarks are skipped.

Screenshot URLs need no sign-in, so anyone with a link can see that image. The
48-character random names cannot be guessed or listed. Migration
`0027_content_previews.sql` adds `content_previews`, which records each attempt.
The Worker needs the `BROWSER` binding, the `CONTENT_PREVIEWS` bucket, and the
`nodejs_compat` flag from `wrangler.toml`.

## Install the Chrome extension

1. Open `chrome://extensions` and enable Developer mode.
2. Choose Load unpacked and select `apps/content-extension` in this checkout.
3. Pin Ego Content to the Chrome toolbar.
4. In the updated Ego web or desktop app, open Content, then Chrome extension.
5. Generate an extension key and copy it. Ego stores only its hash.
6. Press the extension button, paste the key, and choose Connect.
7. Open a page, press the extension button, choose a collection or add notes, and save.

The extension targets `https://ego-money.ega-khar.workers.dev`. A different
deployment must update both `API` in `popup.js` and the manifest's host permission.
Reload the extension from `chrome://extensions` after changing its files.

The extension can read the Content library and create bookmarks. It cannot read
the rest of Ego, edit existing bookmarks, or create more keys. Revoke its key from
Content's Chrome extension panel to disconnect it.

The extension requests access to the active tab when pressed. It reads the page
title and Open Graph metadata, with the tab title as a fallback for restricted
viewers. On YouTube video pages it reads the player's `VideoObject` data instead,
because YouTube switches videos without reloading and leaves the first page's Open
Graph tags in place. It does not read all tabs or run on pages in the background.
Interrupted saves retain their request ID in Chrome's session storage so retries
do not create a second record. A deliberate second save of an existing URL is
allowed and shows a notice first.

## Canvas dark mode

The extension also turns Canvas dark. It runs on every `https://*.instructure.com`
page except Instructure's marketing and community sites, and the moon button in
the popup header switches it off and on. The setting is `canvasDark` in
`chrome.storage.local`; open Canvas tabs follow a change without a reload.

Canvas has no theme hooks, and most of its newer screens use InstUI, whose class
names are hashed per build, so a hand-written stylesheet cannot target them.
Instead `canvas-dark.js` rewrites the colors Canvas already ships. For every
stylesheet on the page it reads each rule, maps light backgrounds to dark greys,
dark text to light grey, pale borders to dark ones, and leaves saturated brand and
status colors alone. Text in a rule that also sets a kept colored background stays
as it is. Inline `<style>` tags, which is where InstUI puts its rules, are read
through the CSSOM as React adds them. Linked stylesheets go through `background.js`,
the service worker, which has host permissions for the Canvas CDN, the institution
upload bucket, and DesignPLUS, because CloudFront serves the bundles without a CORS
header. The worker owns all `chrome.storage.local` access, because the popup sets
the store to trusted contexts only (to keep the extension key out of content
scripts), which also bars the content script from storage. So the content script
asks the worker for each sheet: the worker returns the cached rewritten rules, or
the raw text for the content script to map and hand back to cache. Cache keys are
the sheet URL, `@import` targets are followed, and entries older than 45 days are
pruned, so only the first visit after a Canvas deploy pays for the fetch and parse.
The toggle lives in the same store: the content script reads it from the worker on
load, and the worker relays a change to every open Canvas tab so they update
without a reload. Inline `style` attributes and `bgcolor` in course content are
rewritten the same way. `canvas-dark.css` sets the base page colors,
`color-scheme: dark`, and the brand variables Canvas's own CSS reads.

When Canvas dark mode is on, the script adds a `<meta name="darkreader-lock">`
tag so Dark Reader and other extensions that honor the lock leave the page alone,
and it removes the tag when the toggle is off so they can take over again. Running
two dark-mode extensions on Canvas without the lock leaves half-mapped surfaces,
such as a white breadcrumb bar or a light grades hover row.

The content script turns itself off in frames from another host, such as New
Quizzes, and on a document with no Canvas markup. Cross-origin tools in iframes,
such as Simple Syllabus, keep their own colors. On the first visit to a page whose
bundles are not cached yet, the inner surfaces can flash light for a moment while
the sheets are fetched.

To check a change visually, launch Playwright's Chromium with `--headless=new`,
`--load-extension`, and `--remote-debugging-port`, then screenshot pages over
CDP. Public Canvas courses, such as UBC's student resource site, render the full
layout without a login; USF pages need the DOM serialized out of a logged-in
browser. The harness used for this lives outside the repo.

## Import a Raindrop export

`python scripts/content-import.py export.csv --output out/content-backfill.sql`
prepares an import without changing the database. Run the SQL against the intended
D1 database after applying the Content migration. Keep exports and generated SQL
outside tracked source files because they contain the bookmark library.

The importer retains Raindrop IDs, saved dates, descriptions, covers, notes, tags,
and favorites. It creates named collections and leaves Unsorted unassigned. The
CSV has no content-type column, so the importer infers videos and PDF documents
from URLs. Existing IDs or URLs are skipped. Each new record gets a sync event;
rerunning the import adds neither duplicate records nor duplicate events.

Migration 0026 and the initial CSV backfill were applied to the live database on
2026-10-08. Worker and client releases are still separate steps.

## Limits

The first version saves links and metadata, not offline copies of entire pages.
Cover images from Open Graph tags load from their original URLs and can
disappear if a publisher removes them. A screenshot only replaces a missing cover,
not a broken one. Pasted links can be entered manually on every client; automatic
metadata capture currently belongs to the Chrome extension.

The extension is loaded locally, not published in the Chrome Web Store. Native
Android share-sheet capture, reminders, highlights, and saving all tabs are not
part of this version.

## Validation

`apps/api/test/content.test.ts` covers extension capture, duplicate request retries,
two-device sync, conflicts, Trash/Restore, collection deletion, key scope and
revocation, and URL validation. The Content UI tests cover search, failed saves,
and restoring bookmarks. The popup tests exercise the actual extension script
against mocked Chrome APIs and network responses.

The popup still needs a live Chrome smoke test against the deployed Worker, and
the native screen needs a phone smoke test after release.
