---
name: connected-databases
description: Builds, queries, and debugs Azure SQL connected databases through Greenlight's bounded SQL gateway. Use when a Greenlight-governed app needs Azure SQL data, a connected-database grant, schema discovery, parameterized SQL, paging, result conversion, or query-error handling.
---

# Connected Databases

Read the core [Greenlight skill](../greenlight/SKILL.md) in full before acting. Follow its
authorization, Knowledge, local-development, delivery, and user-communication rules. This skill
adds the contract for Greenlight's connected-database gateway.

## Query Azure SQL

A granted **Azure SQL connected database** (`auth_category: 'connected-database'` in
`listGrantableIntegrations`) is proxied but is not an HTTP upstream. No SQL driver or connection
string exists in the app. POST a parameterized statement to the integration's one query route:

```
POST ${GREENLIGHT_PROXY_URL}/<integration>/query
Authorization: Bearer ${GREENLIGHT_DATA_KEY}
{ "sql": "SELECT id, name FROM [Worker] WHERE id = @p1", "params": [42] }
```

- **User attribution:** when calling `/query` while handling a user request, forward the inbound
  `X-Greenlight-Actor-Token` if present, following the core skill's _Preserve user attribution_
  rule.
- **Parameterize, always.** `params` binds positionally to Azure SQL's `@p1…` placeholders. Values
  are `string | number | boolean | null` only. Numeric integer params must fit JavaScript's
  safe-integer range; pass larger integers, exact decimals, dates, and binary as strings and
  `CAST`/`CONVERT` them in SQL. Never concatenate input into `sql`. A param cannot stand in for a
  table or column name, so strictly allowlist any identifier before adding it to the SQL text.
- **Treat parameter types as inferred.** Azure SQL strings arrive as `nvarchar`, booleans as `bit`,
  integer numbers as `int`/`bigint`, fractional numbers as `float`, and a bare `null` as
  `nvarchar`. Use an explicit bounded `CAST(@p1 AS …)`/`CONVERT` when the target column is
  `varchar`, decimal, temporal, or another exact type.
- **Read rows positionally.** The response is
  `{ columns: [{ name, type }], rows: [[…]], row_count, truncated }`. Pair `rows[i][j]` with
  `columns[j]`; zip them before rendering.
- **Return one bounded result grid.** A second result set is rejected with
  `400 proxy.query_result_unsupported`. Ordinary text, including `nvarchar(max)`/`varchar(max)`, is
  returned within the byte cap. Unbounded binary (`varbinary(max)`), legacy LOBs
  (`text`/`ntext`/`image`), `xml`, `sql_variant`, and UDTs are rejected; cast them to a bounded
  scalar when needed. `FOR XML` is rejected. `FOR JSON` returns text chunked across rows.
- **Assume every request is stateless.** Sessions are isolated and reset before reuse. Temp tables,
  session settings, and transactions do not carry to another request. There are no cross-request
  transactions, cursors, or streaming.
- **Respect every cap.** A response retains at most **1,000 rows** and **1,000,000 row-data bytes**;
  `truncated: true` means the rows are a contiguous prefix. Other caps are **256 columns**, **30 s**
  execution, **100,000 UTF-8 bytes** of SQL, **100 params**, and a **1 MiB** request body. Page with
  `ORDER BY … OFFSET @p1 ROWS FETCH NEXT @p2 ROWS ONLY` and never assume a response contains every
  matching row.
- **Handle JSON serialization deliberately.** `datetime2`, `time`, and `datetimeoffset` become
  ISO-8601 UTC strings at JavaScript millisecond precision; original offsets and sub-millisecond
  precision are lost. `bigint` values are strings. Binary becomes base64. `FLOAT` and exact
  numeric/money values travel as JSON numbers and may lose decimal fidelity. Cast to bounded text
  when those details matter.
- **Treat the database role as the authorization boundary.** `db_datareader` is recommended.
  Writes require a write-capable role. `row_count` counts returned rows, so an `INSERT`/`UPDATE`
  reports `0` unless it uses `OUTPUT` or ends with `SELECT @@ROWCOUNT`.

## Handle writes and failures

The customer database and Greenlight audit log cannot commit atomically. After a timeout,
connection loss, caller disconnect, or audit failure, a write may have committed even if no
success reached the caller. Use writable grants only with application- or database-native
idempotency. Never transport-retry DML merely because an HTTP call failed.

Every query error includes `fault_origin` (`request`, `policy`, `connected_database`, `platform`,
or `unknown`), `retryable`, `safe_to_retry`, `execution_outcome` (`not_started` or `unknown`), and
`database_code` when available. Retry automatically only when both retry booleans are `true`.
Preserve `request_id` and never infer rollback from a status code or missing response.

- `400 proxy.query_failed` — recognized database statement error; use `fault_origin` and
  `database_code` rather than parsing message prose.
- `400 proxy.query_timeout` — execution exceeded 30 seconds; narrow the query and do not replay a
  possible write.
- `400 proxy.query_result_unsupported` — reshape the result or cast unsupported values.
- `503 proxy.query_capacity` with `Retry-After` — execution did not start and the request is safe
  to retry after the stated delay.
- `502 proxy.upstream_unreachable` — masked connection, auth, or network failure. Replay only when
  `details.safe_to_retry` confirms execution did not start.
- `500 internal.audit_unavailable` / `internal.unexpected` — preserve `request_id`; an audit
  failure after execution is not a retry signal.
- `400 validation.body_invalid` / `413 validation.body_too_large` — fix the request shape or size.
- `403 proxy.grant_missing` — request or correct the grant.
- `499 proxy.query_canceled` — the caller disconnected while work was queued or active.

## Discover and verify

Read the database's integration Knowledge before writing queries. Discover schema through the same
route with `INFORMATION_SCHEMA.TABLES` and `INFORMATION_SCHEMA.COLUMNS`. Elevated metadata views
may be denied; fall back to `sys.partitions` or `INFORMATION_SCHEMA`. Confirm assumptions against a
real call, then use `knowledgePropose` to preserve verified schema, naming, and query patterns.

The gateway works under `greenlight run` in both app and user modes; use user mode to explore a
schema before an app exists.
