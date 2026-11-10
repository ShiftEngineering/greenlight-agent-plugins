---
name: app-apis
description: >-
  Builds a Greenlight app that provides an API to other Greenlight apps, or one
  that consumes another app's API through the data proxy. Use when an app
  declares api: in greenlight.yml, enforces app-API scopes, reads
  X-Greenlight-Caller-* headers, writes or updates its openapi.yaml, or when an
  app needs data another Greenlight app owns, finds an integration with kind
  "app", reads it with getAppApi, or handles 503 proxy.app_api_unavailable.
---

# App APIs

Read the core [Greenlight skill](../greenlight/SKILL.md) in full before acting. Follow its
authorization, Knowledge, local-development, delivery, and user-communication rules. This skill
adds the contract for one Greenlight app calling another.

An app API works like any proxied integration. The **provider** app declares an API in
`greenlight.yml`. An IT administrator publishes it in Integrations; until then nobody can call
it. A **consumer** app declares a grant to one of its scopes and calls it through
`${GREENLIGHT_PROXY_URL}`. The proxy checks the grant, audits the call, and forwards it to the
provider with headers that say who is calling. Apps never reach each other directly.

## Providing an API

### Rule 1: the provider app enforces its scopes

**Greenlight decides whether a consumer may call the API at all. Your app decides what each scope
may do.** The proxy only checks that the caller holds an approved grant to one of your scopes and
names that scope in `X-Greenlight-Caller-Scope`. It never looks at the method, path or body, and
never maps a scope to routes. An app that ignores the header serves its whole API to every
granted consumer, whatever scope IT approved. Scope enforcement is part of building a provider,
not optional hardening:

1. **Declare scopes that match real capability boundaries**, such as `read` and `write`, or
   `expenses-read` and `receipts-read`. Describe each in what-it-permits terms IT can approve on:
   "Read approved and pending expenses (no receipts)", not "read access".
2. **Keep one scope map in code**: each API route and method, and the scopes allowed to call it.
   The map is the single place authorization is decided. Do not scatter scope checks across
   handlers.
3. **Deny by default.** A request carrying `X-Greenlight-Caller-Kind` gets `403` when its route is
   not in the map, or when its `X-Greenlight-Caller-Scope` is not one of the route's scopes. No
   scope implies another (`write` does not include `read`) unless the map says so.
4. **Keep the two kinds of request apart.** Honor `X-Greenlight-Caller-*` headers only on requests
   that carry `X-Greenlight-Caller-Kind`. A request without it came from a browser and goes
   through the app's ordinary sign-in rules, never the scope map. Greenlight's edge strips any
   `X-Greenlight-Caller-*` header a browser sends, so only the proxy can set them.
5. **Layer per-user checks on top.** On an app-API call the proxy sets the same `X-User-*`
   headers an SSO request carries, for the person the consumer is serving, when there is one.
   When they are present, the
   scope says what the consumer may do, and your app's own per-user rules still decide which rows
   that person may see. A call with no `X-User-*` is the consumer app acting for nobody in
   particular; serve it only what the scope allows an app to see.
6. **Document each operation's scope** in the OpenAPI document, in the operation's description
   ("Requires scope `read` or `write`."), so a consumer's agent knows which grant to ask for.
7. **Test every scope**, plus an app-API call with no matching scope and one to a route outside
   the map, and assert the `403`s.

A scope map in an Express-style app:

```js
// Every API route and method, and the scopes that may call it. Nothing else is served to an app.
const SCOPE_MAP = [
  { method: 'GET', path: /^\/api\/expenses$/, scopes: ['read', 'write'] },
  { method: 'GET', path: /^\/api\/expenses\/[^/]+$/, scopes: ['read', 'write'] },
  { method: 'POST', path: /^\/api\/expenses$/, scopes: ['write'] },
];

function appApiScopes(req, res, next) {
  const kind = req.get('x-greenlight-caller-kind');
  if (!kind) return next(); // a browser request: the app's sign-in rules apply
  const scope = req.get('x-greenlight-caller-scope');
  const route = SCOPE_MAP.find((r) => r.method === req.method && r.path.test(req.path));
  if (!route || !route.scopes.includes(scope)) {
    return res.status(403).json({ error: 'scope_not_allowed', scope, path: req.path });
  }
  req.appCaller = {
    kind,
    appSlug: req.get('x-greenlight-caller-app-slug') ?? null,
    scope,
    purpose: req.get('x-greenlight-caller-purpose'),
  };
  next();
}

app.use(appApiScopes);
```

Mount it before every route, not only under the base path, so an app-API call can never reach a
browser-only route such as an admin page. A test sends a request with `X-Greenlight-Caller-Kind: app`
and each scope to each route, and asserts `403` for a scope the map does not list, for a missing
scope, and for a route outside the map.

### Rule 2: data read as a person never leaves through the app API

Never serve, through the app API, data your app read through a **user passthrough** integration
(`auth_category: user-delegated` in `listGrantableIntegrations`): data the upstream returned to
your app as one person, with that person's own token. Read the
[user-passthrough skill](../user-passthrough/SKILL.md) for what those integrations are.

- This covers live passthrough calls **and anything stored from them**: a cache, a table filled
  from passthrough reads, a derived summary.
- It holds **even when the app-API call carries that same person** in `X-User-*`. IT granted the
  passthrough integration to your app, not to its consumers, and the consumer's audit trail would
  never show that it reached the upstream.
- A consumer that needs that data asks for its own user passthrough grant to the upstream, and IT
  decides.

Before you declare `api:`, list which tables, caches and files hold data read through a user
passthrough grant, and keep every one of them out of every API route. Say so in the PR
description. If a feature the consumer wants needs that data, tell the user that the consumer
app must request its own access to that system.

### Declaring the API

Add a top-level `api:` block to `greenlight.yml`:

```yaml
api:
  base_path: /api # where the API lives in the app; absolute, no trailing slash, not /healthz
  openapi: openapi.yaml # repo-relative OpenAPI 3.x file with info.title and info.version, at most 512 KiB
  scopes: # 1 to 10
    - slug: read # lowercase kebab-case, at most 40 characters
      description: 'Read approved and pending expenses (no receipts)'
    - slug: write
      description: 'Create expenses and attach receipts'
```

- **Keep `openapi.yaml` current in the same PR as every API change.** It is the only description
  of the API a consumer's agent can read before it has a grant, and a deploy whose file no longer
  parses fails.
- **One API per app.** Put several resource families under one base path and one scope set.
- **Declaring is not publishing.** IT administrators are alerted when an app declares an API, and
  publish it from Integrations. Tell the user that IT publishes it before anyone can call it.
- **Changing scopes changes the integration.** A new scope starts at manual approval. A removed
  scope is withdrawn, and consumers holding it get `503 proxy.app_api_unavailable` until it comes
  back. Tell the user before removing a scope a consumer may depend on; the app's API panel in
  the dashboard shows which apps hold each scope.
- **An app cannot grant itself its own API** (`manifest.grant_own_api`).

### Calls your app makes while serving an app-API call

A provider receives no actor token on an app-API call, so the proxied calls it makes while
serving one are app-only, attributed to your app. A user passthrough integration refuses them.
Plan features so that an app-API route never needs to act as the person.

## Consuming an API

1. **Find it.** Call `listGrantableIntegrations`. An app API is an item with `kind: "app"`,
   naming its `provider_app` and offering one credential per scope. If the data the user wants
   lives in another Greenlight app and no such item exists, the provider has not declared an API
   or IT has not published it yet: tell the user plainly and name the provider app's owner.
2. **Read it.** Call `getAppApi({ integration })` (CLI: `greenlight integrations api
--integration <slug>`). It returns the base path, each scope with what it permits, and the full
   OpenAPI document. No grant is needed to read it. Pick the narrowest scope that covers the
   operations the feature calls.
3. **Declare the grant** in `greenlight.yml` from the item's `manifest_grant_example`:

   ```yaml
   grants:
     - integration: expense-tracker
       credential: read
   ```

   Scopes are usually manual approval, so the grant waits for IT after merge. Tell the user it is
   pending, as for any grant.

4. **Call it through the proxy.** Paths are relative to the provider's base path, so a provider
   serving `/api/expenses` is called as `${GREENLIGHT_PROXY_URL}/expense-tracker/expenses`:

   ```js
   const actorToken = req.headers['x-greenlight-actor-token'];

   const res = await fetch(
     `${process.env.GREENLIGHT_PROXY_URL}/expense-tracker/expenses?status=approved`,
     {
       headers: {
         Authorization: `Bearer ${process.env.GREENLIGHT_DATA_KEY}`,
         ...(actorToken ? { 'X-Greenlight-Actor-Token': actorToken } : {}),
       },
     },
   );
   ```

   Forward the inbound `X-Greenlight-Actor-Token` unchanged when serving a user request, per the
   core skill's _Preserve user attribution_ rule, so the provider sees the person and applies its
   own per-user rules. Without it the call is app-only. An app holding two scopes of one provider
   declares a grant per scope and names the scope in the path,
   `${GREENLIGHT_PROXY_URL}/expense-tracker~write/expenses`; the bare path answers `409` once it
   holds more than one.

5. **Handle the errors.**
   - `503 proxy.app_api_unavailable`: the provider app is paused, has no running pod, or withdrew
     the scope. Show that feature as temporarily unavailable and keep the rest of the app working.
     Do not retry in a tight loop.
   - `403 proxy.grant_missing`: the grant is not approved yet, or was revoked.
   - `403 proxy.app_api_user_not_admitted`: the signed-in person cannot open the provider app.
     Show them that this part of the page needs access to it.
   - `403` from the provider itself: the scope you hold does not allow that operation. Re-read the
     OpenAPI document and request the scope it names.
6. **Try it while building.** `inspectIntegrationApi` (CLI: `greenlight inspect api`) runs a real
   request through the proxy as you, once you hold a grant. Under `greenlight run`, local calls
   reach the **deployed** provider and its live data.
