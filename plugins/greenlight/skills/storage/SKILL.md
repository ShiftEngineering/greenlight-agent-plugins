---
name: storage
description: >-
  Builds, reads, and deletes app object storage through Greenlight's storage
  proxy. Use when a Greenlight-governed app declares kind: blob, copies in the
  storage client, streams uploads or downloads, lists objects, or authorizes
  end-user file access.
---

# Storage

Read the core [Greenlight skill](../greenlight/SKILL.md) in full before acting. Follow its
authorization, Knowledge, local-development, delivery, and user-communication rules. This skill
owns the contract for `kind: blob` — the copy-in client, key encoding, end-user authorization, and
the app-relay download pattern.

## Use the copy-in client

When the manifest declares `kind: blob`, copy [`storage.ts`](./storage.ts) from this Skill into the
app (typically `src/storage.ts`). The module is dependency-free (`fetch` + Web Streams). It reads
`GREENLIGHT_PROXY_URL` and `GREENLIGHT_DATA_KEY` and owns per-segment key encoding so the app never
hand-builds storage URLs. Do not `fetch` `${GREENLIGHT_PROXY_URL}/storage/...` yourself.

If you fetched this Skill via `getBuilderSkill` / `greenlight skill show` and `storage.ts` is not
beside the markdown, copy it from the installed plugin at `skills/storage/storage.ts` —
`getBuilderSkill` returns markdown only.

```ts
import { putObject, getObject, headObject, deleteObject, listObjects } from './storage.js';

const actorToken = req.headers['x-greenlight-actor-token'];

await putObject('receipts/2026/a.pdf', bytes, {
  contentLength: bytes.byteLength,
  contentType: 'application/pdf',
  ...(actorToken ? { actorToken } : {}),
});
const { stream, metadata } = await getObject(
  'receipts/2026/a.pdf',
  actorToken ? { actorToken } : {},
);
```

Do not import `@google-cloud/storage`, `@aws-sdk/client-s3`, the Azure Blob SDK, or any `STORAGE_*`
env var as an app storage path. Those names stay reserved so stale generated code fails on an unset
variable.

The same module works under `greenlight run` in app mode: local and deployed storage use the same
proxy pair. User mode does not inject blob resources.

## Authorize end users in the app

The proxy authenticates the workload. Before every storage call, check ownership against the app's
own records. Never pass a client-supplied raw object key through to storage unchecked.

**Relay browser downloads through the app.** The workload key must never reach a browser. Stream
`getObject` from a server route the signed-in user is allowed to hit.

**Forward the inbound actor token through the copy-in API** — `putObject(..., { contentLength,
actorToken })` / `getObject(key, { actorToken })` — on storage calls made while serving a user
request (audit attribution only; it does not change authorization). Pass
`req.headers['x-greenlight-actor-token']` when present. Follow the core skill's _Preserve user
attribution_ rule: omit `actorToken` when the header is absent; never mint or replay a token for
background work. Do not add `X-Greenlight-Actor-Token` on a raw `fetch` to `/storage/...`.
