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
viewers. It does not read all tabs or run on pages in the background.
Interrupted saves retain their request ID in Chrome's session storage so retries
do not create a second record. A deliberate second save of an existing URL is
allowed and shows a notice first.

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
