"""Prepare a Raindrop CSV backfill. SQL output belongs outside tracked source files."""

import argparse
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def web_url(value):
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Expected an http or https URL without credentials")
    return value


def prepare(source, now):
    with source.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    collections = {}
    items = []
    ids = set()
    urls = set()
    for index, row in enumerate(rows, 2):
        if not row["id"].isdigit() or row["id"] in ids:
            raise ValueError(f"Row {index}: missing or duplicate Raindrop ID")
        ids.add(row["id"])
        url = web_url(row["url"])
        if url in urls:
            raise ValueError(f"Row {index}: duplicate URL needs review")
        urls.add(url)
        created = datetime.fromisoformat(row["created"].replace("Z", "+00:00"))
        if created.tzinfo is None:
            raise ValueError(f"Row {index}: saved date needs a timezone")
        folder = row["folder"].strip()
        collection_id = None
        if folder and folder.lower() != "unsorted":
            collection_id = "raindrop-folder-" + hashlib.sha256(folder.encode()).hexdigest()[:20]
            collections[folder] = collection_id
        if row["highlights"].strip():
            raise ValueError(f"Row {index}: highlights need an explicit mapping")
        tags = list(dict.fromkeys(tag.strip() for tag in row["tags"].split(",") if tag.strip()))
        host = urlsplit(url).hostname.removeprefix("www.")
        kind = "video" if host in ("youtube.com", "youtu.be", "vimeo.com") else "link"
        if urlsplit(url).path.lower().endswith(".pdf"):
            kind = "document"
        elif host in ("globalnerdy.com", "blog.samaltman.com", "paulgraham.com"):
            kind = "article"
        if row["favorite"].lower() not in ("true", "false"):
            raise ValueError(f"Row {index}: invalid favorite flag")
        data = {
            "url": url, "title": row["title"], "description": row["excerpt"],
            "coverUrl": web_url(row["cover"]) if row["cover"] else None,
            "collectionId": collection_id, "tags": tags, "notes": row["note"],
            "favorite": row["favorite"].lower() == "true", "trashedAt": None, "kind": kind,
        }
        limits = {"title": 500, "description": 4000, "notes": 20000, "url": 4096}
        if not data["title"].strip() or any(len(data[key]) > limit for key, limit in limits.items()):
            raise ValueError(f"Row {index}: a field exceeds Content's limits")
        if len(tags) > 30 or any(len(tag) > 80 for tag in tags) or len(folder) > 100:
            raise ValueError(f"Row {index}: tags or collection exceed Content's limits")
        items.append({"id": "raindrop-" + row["id"], "data": data, "createdAt": row["created"], "updatedAt": now, "folder": folder})
    return collections, items


def change_sql(table, entity, record_id, now):
    return f"""INSERT INTO changes (entity, entity_id, action, revision, committed_at, payload)
SELECT {quote(entity)}, id, 'upsert', revision, {quote(now)},
  json_patch(data, json_object('id', id, 'createdAt', created_at, 'updatedAt', updated_at, 'revision', revision))
FROM {table} WHERE id = {quote(record_id)} AND revision = 1 AND deleted_at IS NULL
AND NOT EXISTS (SELECT 1 FROM changes WHERE entity = {quote(entity)} AND entity_id = {quote(record_id)});"""


def sql_for(collections, items, now):
    statements = []
    for name, record_id in collections.items():
        statements.append(f"""INSERT OR IGNORE INTO content_collections (id, data, created_at, updated_at, revision)
SELECT {quote(record_id)}, {quote(json.dumps({'name': name}, ensure_ascii=False))}, {quote(now)}, {quote(now)}, 1
WHERE NOT EXISTS (SELECT 1 FROM content_collections WHERE json_extract(data, '$.name') = {quote(name)} AND deleted_at IS NULL);""")
        statements.append(change_sql("content_collections", "contentCollection", record_id, now))
    for item in items:
        data = quote(json.dumps(item["data"], ensure_ascii=False))
        if item["data"]["collectionId"]:
            data = f"json_set({data}, '$.collectionId', (SELECT id FROM content_collections WHERE json_extract(data, '$.name') = {quote(item['folder'])} AND deleted_at IS NULL LIMIT 1))"
        statements.append(f"""INSERT OR IGNORE INTO content_items (id, data, created_at, updated_at, revision)
SELECT {quote(item['id'])}, {data}, {quote(item['createdAt'])}, {quote(now)}, 1
WHERE NOT EXISTS (SELECT 1 FROM content_items WHERE json_extract(data, '$.url') = {quote(item['data']['url'])});""")
        statements.append(change_sql("content_items", "contentItem", item["id"], now))
    return "\n\n".join(statements) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    collections, items = prepare(args.csv, now)
    args.output.write_text(sql_for(collections, items, now), encoding="utf-8")
    print(json.dumps({"bookmarks": len(items), "collections": list(collections), "covers": sum(bool(item['data']['coverUrl']) for item in items), "output": str(args.output)}))
