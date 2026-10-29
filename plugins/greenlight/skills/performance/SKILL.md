---
name: performance
description: >-
  Keeps Greenlight-governed apps fast when they show or export a lot of data.
  Use when an app lists, summarizes, or charts many rows from a connected
  database or upstream API, exports a CSV, caches upstream results, or is slow,
  errors out loading data, or hits the connected-database execution cap.
---

# Performance

Read the core [Greenlight skill](../greenlight/SKILL.md) in full before acting. Follow its
authorization, attribution, Knowledge, local-development, delivery, and verification rules. This
skill owns how an app reads a lot of data without fetching it all on every view: aggregating in the
source, paging, caching, and exporting from data the app already has.

Design for size from the first version. An app that works on 200 test rows falls over on the 2,000
open records the citizen developer actually has, and they read that as "Greenlight is slow".

## The limits you are designing against

| Limit                                | Value                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------- |
| Connected-database `/query` response | 1,000 rows and 1,000,000 row-data bytes (`truncated: true`)             |
| Connected-database statement         | 30 s, then `Statement exceeded the 30s execution cap.`                  |
| Connected-database concurrency       | 4 active + 8 queued per integration credential, 2 s queue wait          |
| Data proxy request budget            | 1,000 calls/min per app, shared by every integration, `/query`, storage |

Over the proxy budget the call returns `429` with `Retry-After`. Do not retry a statement that hit
the execution cap: it will time out again. Narrow it.

## Find what is slow first

When the user says a view is slow or fails to load, check `getLogs` for the execution-cap error,
`429` from the proxy, or `truncated: true` the app ignored, then log the duration and row count of
each upstream call while running the slow view locally under `greenlight run` with real data.

## Never send the whole dataset to the browser

- **Push work into the source.** Filter, sort, search, and aggregate in SQL (`WHERE`, `ORDER BY`,
  `GROUP BY`, `SUM`) or with the upstream API's own query parameters. Never fetch every row and
  summarize in JavaScript. A summary with months across needs one row per code per month, not the
  raw transactions behind it, and selecting more months should not mean pulling more raw rows.
- **Select only the columns the view shows.** `SELECT *` on a wide table burns the 1,000,000-byte
  budget on columns nobody reads.
- **Page on the server.** List endpoints take a page size (default 50–100, cap ~500) and return a
  cursor or page number plus `has_more`; the browser asks for the next page as the user scrolls or
  clicks _Load more_.
- **Prefer keyset (cursor) paging when the source supports it.** Filtering on the last row seen
  (`WHERE created_at < @p1 OR (created_at = @p1 AND id < @p2) ORDER BY created_at DESC, id DESC`)
  stays fast deep into a table; `OFFSET` gets slower the deeper it goes. Order by a unique key (or
  add one as a tiebreaker) so rows never repeat or skip between pages.

### Connected databases

A `/query` response holds at most 1,000 rows. Treat `truncated: true` as "there is more", never as
the full answer, and page with `ORDER BY <unique key> OFFSET @p1 ROWS FETCH NEXT @p2 ROWS ONLY` or
a keyset `WHERE` (the [connected-databases skill](../connected-databases/SKILL.md) owns the query
contract). A statement that hits the 30-second cap is doing too much at once: aggregate instead of
returning detail rows, filter on indexed columns, or split it into pages. Run at most a few queries
in parallel per request: the gateway runs four at a time per credential, and the rest queue for two
seconds before failing.

### Upstream APIs

Follow the upstream's own pagination (`next` links, `cursor`, `$skip`/`$top`, `page`) exactly as
its docs or integration Knowledge describe, confirmed with `inspectIntegrationApi`. Ask for the
largest page size the upstream allows so a full read takes fewer calls.

**Never look up related records one row at a time.** Showing a client name beside each discount
means fetching the clients once (or only the ids on this page, in one batched call), building a
`Map` by id, and joining in the app. One lookup per row turns 1,300 rows into 1,300 extra calls.

When you must fan out, cap concurrency at 4–8 and back off on `429` using `Retry-After`:

```ts
async function proxyFetch(url: string, init: RequestInit, attempt = 0): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== 429 || attempt >= 3) return res;
  const seconds = Number(res.headers.get('retry-after'));
  const wait = Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000, 10_000);
  await new Promise((r) => setTimeout(r, wait));
  return proxyFetch(url, init, attempt + 1);
}
```

Every call counts against the app's 1,000/min proxy budget, shared across all its users. Batch
endpoints, `$expand`/`include` parameters, and caching are how you stay under it.

## Load once, then fetch only what changed

When a view reads the same slow upstream data every time it opens, keep a copy in the app and
refresh only what changed since the last load, instead of re-reading everything. There is no Redis
or other managed cache to declare; the app's own memory and its `kind: postgres` database are the
caches.

| Layer                            | Survives restart/deploy | Use for                                              |
| -------------------------------- | ----------------------- | ---------------------------------------------------- |
| In-process (a bounded `Map`/LRU) | No                      | Short-lived lookups (seconds to minutes)             |
| App `kind: postgres` table       | Yes                     | A local copy of upstream records the views read from |

For a local copy in postgres:

1. Load the full set once, page by page, into a table keyed by the upstream record id, and record
   the highest `last_modified` (or equivalent) value seen.
2. On each refresh, ask the upstream only for records modified since that value, upsert them, and
   move the marker forward. Closed records that only need viewing stop costing calls.
3. Serve the app's views and exports from the local table with SQL.

The web workload runs as one pod, so an in-process cache is empty after every deploy, restart, or
crash. Cap its entries and evict so the cache itself does not exhaust pod memory.

## Export from what the app already has

A CSV export should read the same local copy or aggregated query the view uses, not re-fetch the
upstream in small batches and look up related records per row. If the export can only come from
the upstream, fetch the largest pages the upstream allows, a few at a time, and join lookups from a
`Map` as above. Quote every cell so commas and quotes in names do not break columns:

```ts
const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

app.get('/api/discounts.csv', async (req, res) => {
  const rows = await db.query(
    'SELECT d.id, c.name, d.amount FROM discounts d JOIN clients c ON c.id = d.client_id ORDER BY d.id',
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="discounts.csv"');
  res.send(
    ['Id', 'Client', 'Amount'].join(',') +
      '\r\n' +
      rows.map((r) => [r.id, r.name, r.amount].map(csvCell).join(',')).join('\r\n'),
  );
});
```

## Verify

Test with real-sized data before you call it done:

- open the large view and confirm it made one aggregated or paged query, not one per row or month;
- open it twice and confirm the second load fetched only changed records (log it);
- run the export and time it, and confirm it made no per-row upstream calls;
- after deploy, check `getLogs` for `429` or the execution-cap error.

Tell the citizen developer what changed in their terms: "The revenue view now totals by month in
the database and keeps a local copy that only pulls what changed, so it opens in seconds and the
export no longer re-downloads everything."
