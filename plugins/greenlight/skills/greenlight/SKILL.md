---
name: greenlight
description: >-
  Use when a citizen developer describes an internal app idea or asks to build,
  change, deploy, verify, debug, or maintain an app in a Greenlight-governed
  environment, even if they do not mention Greenlight or deployment. Also use in
  any repo with greenlight.yml. Do not use for unmanaged apps or direct GitHub,
  cloud, or data provider access.
compatibility: Claude Code, Codex, Cursor
metadata:
  author: Shift Engineering
  version: 1.0.0
  mcp-server: greenlight
---

# Greenlight

## Using this skill

Read this skill **in full** before you act on Greenlight work, and read it again after any context
compaction or summary — the order of operations and the tool choices below are load-bearing, and
acting on a half-remembered version is how apps get built the wrong way. If you delegate Greenlight
work to a subagent, make sure it has read this skill too.

If the Greenlight MCP tools aren't in your tool list, or a tool call starts coming back with an auth
error, you are not connected — **do not** tell the user "the tools aren't available" and stop. You
have two interchangeable ways in (see the next section): retry over MCP after a one-time OAuth
sign-in, **or** use the `greenlight` CLI, which carries its own auto-refreshing credential and keeps
working when the MCP session doesn't. Ask the user to complete the plugin's MCP sign-in when MCP is
the blocker; surface a real error only if both paths genuinely fail.

## Two interchangeable surfaces: MCP tools and the `greenlight` CLI

Greenlight's builder surface is reachable **two equivalent ways** — treat them as fully
interchangeable and use whichever is authenticated:

- **MCP tools** — `listApps`, `getApp`, `getPipelineRun`, … in your tool list.
- **The `greenlight` CLI** — a bundled agent client that calls the **same `/mcp` tools** but holds its
  **own OAuth credential with working refresh**. Resolve it at `${CLAUDE_PLUGIN_ROOT}/cli/greenlight.mjs`
  (Claude Code; the per-runtime equivalent elsewhere), with a Node runtime present. Never re-author it —
  it is the trusted bundled artifact.

**When MCP auth is failing, switch to the CLI — that is exactly what it is for.** Coding-agent MCP
OAuth clients refresh unreliably, so MCP tool calls can start returning auth errors mid-session; the
CLI refreshes its own credential, so the same operation succeeds through it. The goals in the map
below work from either surface.

**Sign the CLI in** (either path yields the same credential; refresh is then automatic):

- **`greenlight pair`** — reuses your existing healthy MCP session: it prints a code, you approve it with
  `approveCliSession({ code })` over MCP. No second browser sign-in.
- **`greenlight login`** — standalone browser OAuth (a loopback flow) for when there is no usable MCP
  session; open the URL it prints (or hand it to the human).

**CLI ↔ MCP equivalence** — builder goals, callable from either surface:

| Goal                               | MCP tool                                                                  | `greenlight` CLI                                |
| ---------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------- |
| Register a new app                 | `registerApp`                                                             | `apps register`                                 |
| List apps                          | `listApps`                                                                | `apps list`                                     |
| App detail / live state            | `getApp`                                                                  | `apps show --app <id>`                          |
| Discover grantable integrations    | `listGrantableIntegrations`                                               | `integrations list`                             |
| Read declared env (names/values)   | `envList`                                                                 | `env list --app <id>`                           |
| Set / remove env values            | `envSet` / `envRemove`                                                    | `env set` / `env rm`                            |
| Open / merge a PR                  | `createPullRequest` / `mergePullRequest`                                  | `pr open` / `pr merge`                          |
| Pipeline status (`--wait` to poll) | `getPipelineRun`                                                          | `pipeline --app <id> …`                         |
| Pod logs                           | `getLogs`                                                                 | `logs --app <id>`                               |
| Metrics (point / series)           | `getMetrics` / `getMetricsSeries`                                         | `metrics` / `metrics series --app <id>`         |
| Knowledge (read / propose)         | `knowledgeList` / `knowledgeGet` / `knowledgeSearch` / `knowledgePropose` | `knowledge list` / `get` / `search` / `propose` |
| Clone the repo (minted token)      | `getRepoAccess`                                                           | `repo clone --app <id>`                         |
| Preview URL for verification       | `getAppPreviewUrl`                                                        | `preview --app <id>`                            |
| Share / unshare app ownership      | `addCoOwner` / `removeCoOwner`                                            | `share` / `unshare`                             |

CLI-only helpers: `greenlight run -- <cmd>` (local dev — see _Local development_), `greenlight doctor`,
`greenlight whoami`, `greenlight logout`. Recover flag detail from `greenlight help` or
`greenlight <command> --help` — never guess.

**Write payloads use stdin/file, never argv.** Env values and Markdown/PR bodies can contain secrets
or multiline text, so the CLI refuses `--value` and `--body`. Pipe or use a file/fd instead:

```bash
printf '%s' "$VALUE" | greenlight env set --app <id> --name API_KEY --sensitive --reason "rotate key"
greenlight pr open --app <id> --head feature/demo --title "Ship demo" --body-file /tmp/pr-body.md
greenlight knowledge propose --scope app --app <id> --topic schema-notes --title "Schema notes" \
  --rationale "Future agents need this" --body-file /tmp/schema-notes.md
```

After `greenlight apps register`, use `greenlight repo clone --app <id>` for an authenticated checkout;
the register response's `repo_url` is intentionally token-free.

**If the CLI is missing or stale**, it has three install paths — try the next on failure: (1) the
**plugin bundle** (this artifact); (2) **control-plane-hosted** — `curl` the `/cli/install.sh` route on
the same host as your MCP endpoint; (3) the **public marketplace repo**'s raw
`plugins/greenlight/cli/greenlight.mjs`. Re-run the install one-liner to update a stale copy. **Output
contract:** stdout is machine JSON only, diagnostics go to stderr, and failures are the canonical
`{ code, message, details?, next_steps?, request_id }` envelope with a stable non-zero exit
(2 validation, 3 auth, 4 not-found/forbidden, 1 other). Add `--debug` for transport diagnostics on stderr.

## What Greenlight is, and your place in it

Greenlight is the governed platform an enterprise runs its internal apps on. You — the coding
agent — are the developer. A non-technical person describes what they want; you build it and ship
it _through_ Greenlight, which governs source control, CI, deployment, secrets, data access, and
audit on their behalf.

**Assume the citizen developer is not a software engineer.** Unless they show you otherwise, they
don't know — and shouldn't have to care about — GitHub, git, pull requests, CI, pipelines,
Kubernetes, hosting, repos, or Greenlight internals. What they care about is **what their app looks
like, what it does, and whether they can share it yet.** Do the entire technical workflow yourself
through Greenlight. Never ask them to open a repo, read a diff or logs, inspect pipeline status,
approve a GitHub prompt, or run a command. Talk to them in product terms: what you built, what's
ready to try, what needs their decision, and what they can click in the running app. Keep git, PRs,
and pipeline mechanics out of the conversation unless they explicitly ask.

## How work flows: declare in greenlight.yml, apply on merge

Infrastructure is **declarative**. You express what the app needs by editing `greenlight.yml`, and
Greenlight applies it when the pull request merges — there is no imperative "create database" call.
The standard new-app loop:

1. **`registerApp({ name, slug, type: "server", description })`** — creates the repo
   and scaffolds it (a seeded `greenlight.yml` with the `docs` block and commented-out
   `workloads` / `resources` / `grants` / `env`, branch protection, pipeline wiring). **No
   Dockerfile is seeded** — you author it for your stack. It provisions **no** cloud resources.
   The app sits idle, at zero cost, until the first merge. Returns `app_id` and a short-lived
   clone token.
2. **Clone and write code.** Fill in the required `docs` block (the pipeline blocks deploy without
   it) and a `README.md`. Write your `Dockerfile` and `src/`.
3. **Declare infrastructure** by uncommenting and editing `greenlight.yml`: add `workloads.web`,
   any `resources`, any integration `grants`, and the _names_ of env vars under `env`.
4. **Set env-var values** for each name you declared, with `envSet` or `greenlight env set` — pass
   `app_id`, the `name`, the value via stdin/file, a `sensitive` flag, and a `reason`. Names live in
   the manifest; values live in the vault. Set the value before or after declaring its name, but
   every declared name must have a value by merge time or the deploy fails with `MISSING_ENV_VALUE`.
5. **Open the PR** with `createPullRequest` or `greenlight pr open` — **after** your head branch is
   pushed (pass `app_id` and that branch). Do this through Greenlight, never with `gh` or the GitHub
   API (see _Source control_ below).
6. **Wait, then merge.** Poll `getPipelineRun` (`greenlight pipeline --pr <n> --wait`) with
   `pull_request_number` and `wait: true`. Once it passes, merge through Greenlight with
   `mergePullRequest({ app_id, pull_request_number })` or `greenlight pr merge` — **never** `gh pr merge`
   or the GitHub API. **The merge is the apply trigger** — it provisions declared resources, reconciles
   grants, builds and rolls out the workload.
7. **Observe the deploy, then verify.** Poll `getPipelineRun` again on the merge SHA (`commit_sha`,
   `wait: true`), then `getApp` (`greenlight apps show`) for the live state and deployment URL. **Then verify the change
   actually does what the user asked** (see _Verifying a deployed app_) before you tell them anything
   is ready.

Updating an app later is the same loop minus step 1: edit `greenlight.yml` and/or code, PR, merge,
verify. **Every change ends with verification** — there is no "done" you report without having
watched the requested behavior work.

<!-- cancelled-tools-note:start -->

There are **no imperative infrastructure tools** — no `resource.add`, no `requestPermissions`, no
`workload.add` / `workload.update` / `workload.remove`. Anyone who remembers those from an older
Greenlight is remembering a model that no longer exists. Every resource, workload, and grant change
is a `greenlight.yml` edit applied by a merge. (This paragraph is the _only_ place those names
appear, precisely to say they are gone.)

<!-- cancelled-tools-note:end -->

### A complete greenlight.yml

```yaml
# greenlight.yml
schema_version: 1
app_id: 3f2504e0-4f89-41d3-9a0c-0305e82c3301 # returned by registerApp; do not invent
slug: expense-tracker
owner: jane@example.com

docs: # required from the first PR
  summary: Tracks employee expense submissions and routes them for manager approval.
  purpose: Replaces a manual spreadsheet so approvals are auditable and faster.
  architecture: Node web workload backed by Postgres; reads the company CRM through the Greenlight data proxy.

workloads:
  web:
    kind: web
    dockerfile: Dockerfile
    port: 8080
    routes: ['/*']
    compute: # optional; START by omitting this — the baseline fits most apps. Add it only after a
      # deploy shows you need more (OOMKilled → raise memory; CPU throttling or slow starts →
      # raise cpu), and raise one step at a time. Caps are org-set (default cpu<=2, memory<=4Gi).
      cpu: '500m'
      memory: '512Mi'

resources: # one entry max per kind at MVP
  - kind: postgres
    name: db
  - kind: blob
    name: receipts

grants: # integration access requests
  - integration: <integration-name> # use the real integration names the user/org provides
    credential: <slug> # the credential to bind, by its slug (e.g. crm-readonly); IT registers the slugs — discover integrations and their slugs with listGrantableIntegrations. Not a fixed read/write/access enum.
    reason: Read CRM accounts to prefill expense categories.

env: # names only; values go through envSet
  - { name: APPROVAL_SECRET, sensitive: true }
  - { name: FEATURE_FLAGS, sensitive: false }
```

Before you add or change a `grants:` entry, call `listGrantableIntegrations` (or `greenlight
integrations list`) to see which integrations and credential slugs the org has registered, whether
each is `injected` or `proxied`, and to copy its ready-made `manifest_grant_example` straight into
`greenlight.yml`. It is read-only and
returns no secrets — a grant naming a slug it does not list (or one marked `configured: false`) cannot
be approved.

Grants are request signals, not merge blockers: an auto-approved grant works the moment the PR
merges; an IT-required grant deploys in `pending` and the proxy returns `403` for it until IT
approves out of band (no redeploy needed). Watch grant status in `getApp`; the dedicated
`getPermissions` tool is still being wired.

## Current release availability

This Skill describes the intended MVP builder workflow, but the running MVP is still filling in a
few surfaces. Prefer the workflow above, and treat these as temporary availability notes:

- **Authentication / scoped ownership:** full MCP OAuth bearer enforcement and session-scoped app
  access are still being wired. If the MCP client prompts for auth, complete the sign-in, but do
  not assume every ownership/co-owner path is live yet.
- **Policy reads:** `getPolicies()` is not available in the current release. For now, infer the
  enforced rules from the pipeline gate's output and the manifest rather than fetching policy config.
  (Knowledge — `knowledgeList`, `knowledgeGet`, `knowledgeSearch`, `knowledgePropose` — is available;
  see "Runtime context" below.)
- **Permission status:** `getPermissions()` is not available yet; read grant/resource/env
  state from `getApp` where exposed.
- **App self-verification:** `getAppPreviewUrl()` is available — open the returned URL in
  your browser tool to render the deployed app, click through it, and screenshot it, signed in as
  yourself. `curlApp()` (the cheaper response-level default) is still being wired; until
  it ships, use pipeline status, `getApp`, logs/metrics, and a preview session when you
  need to confirm the live response through the edge.
- **Sharing apps:** `addCoOwner()` and the full share/co-owner flow are not available
  yet. Do not promise to add collaborators through Greenlight until that tool ships.

When the unavailable tools ship, this note should shrink. Until then, a `tool not found` response
for one of the tools above means the release is incomplete, not that the workflow is wrong.

## Operating constraints

- **Never hardcode a credential, connection string, or API key.** Greenlight injects every secret
  at deploy time. A secret in source is a security incident, and the pipeline will block it.
- **Never provision cloud infrastructure directly, and never reach an external service directly.**
  Databases, storage, and integration access are _declared_ in `greenlight.yml` and applied when a
  pull request merges. Company data is reached only through the Greenlight proxy.

## Runtime context

Customer-specific context lives in **Knowledge** — DB-backed Markdown entries scoped to org,
integration, or app, served through MCP. Start a session by reading org and app Knowledge, and
read integration Knowledge before writing data-access code (each Knowledge operation has a CLI twin —
`greenlight knowledge list` / `get` / `search` / `propose`):

- `knowledgeList({ scope: 'org' })` and `knowledgeList({ scope: 'app', app_id })` at session start.
- `knowledgeList({ scope: 'integration', integration })` + `knowledgeGet` before data-access code.
- `knowledgeSearch({ query })` when you're stuck and want related prose across scopes.
- `knowledgePropose({ … , rationale })` after you learn something worth saving for the next session —
  it files a proposal for human review and never edits Knowledge directly.

`getPolicies` (the enforced pipeline rules) is not available yet; until it ships, keep policy
assumptions local to the repo and the current `greenlight.yml`.

## Environment variables: which names exist, and what is safe to expose

### Managed names are derived — you do not set them

Greenlight injects a set of **managed** env vars into the running pod, derived from what the
manifest declares. Your code reads them from the environment; you never declare or set them, and
`envSet` rejects them as reserved.

| If the manifest declares…                         | The pod receives…                                               |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `resources:` with `kind: postgres`                | `DATABASE_URL`                                                  |
| `resources:` with `kind: blob`                    | `STORAGE_SAS_URL`, `STORAGE_CONTAINER_NAME`                     |
| a `grants:` entry for a **proxied** integration   | `GREENLIGHT_DATA_KEY`, `GREENLIGHT_PROXY_URL`                   |
| a `grants:` entry for an **injected** integration | that integration's credential, under its own fixed env-var name |
| an `ai_*` grant _(post-MVP)_                      | `GREENLIGHT_AI_KEY`, `GREENLIGHT_AI_BASE_URL`                   |
| always (a `web` workload)                         | `PORT`                                                          |

Whether a grant delivers `GREENLIGHT_DATA_KEY` + `GREENLIGHT_PROXY_URL` (**proxied**) or the
integration's own credential under a fixed name (**injected**) is a property of the integration
(`delivery_mode`), not something the manifest carries — so the exact names depend on which
integrations the app is granted. An app with no `resources` and no `grants` receives only `PORT`.
**Always call `getApp` (or `envList`) for the exact managed names a specific
app gets.** The fixed reserved set — rejected by `envSet` and by the manifest validator regardless
of what the app currently declares — is `DATABASE_URL`, `STORAGE_SAS_URL`, `STORAGE_CONTAINER_NAME`,
`GREENLIGHT_DATA_KEY`, `GREENLIGHT_PROXY_URL`, `PORT`, `GREENLIGHT_AI_KEY`, `GREENLIGHT_AI_BASE_URL`,
`PUBLIC_BASE_URL`, `DEV_USER_EMAIL`, `DEV_USER_GROUPS`; each injected integration additionally
reserves its own env-var name per-app. User-declared names must match `^[A-Z][A-Z0-9_]{0,127}$`.

### Values inject at runtime, not at build time

Greenlight-managed values land in the **running pod**, never in the CI image build — `docker build`
receives only a registry push token, never vault values. So a value set through `envSet` is
available from `process.env` on the server at runtime, but it is **not** present during the build.

This is why build-time inlining of a Greenlight value into a client bundle (`NEXT_PUBLIC_*`,
`VITE_*`, `REACT_APP_*`) does not work: those are baked at `docker build`, when the value does not
yet exist. To get a _non-sensitive_ config value to the frontend, read it on the server at runtime
and expose it deliberately — e.g. a `GET /api/config` endpoint or server-side templating.

App-owned build-time constants are a separate, fine thing: a Dockerfile may set `NEXT_PUBLIC_API_BASE=/api`
or similar for values you control in the repo. Anything inlined into a client bundle is public —
never put a secret there.

### Never serve a secret to the browser

A `/api/config`-style endpoint is for values that are safe to be public. Env vars carry a class:

- **`plain`** — readable config you set; safe to expose only if it is genuinely non-sensitive.
- **`sensitive`** — write-only after creation; never returned by reads. **Never** send a
  `sensitive` value (or any secret, or any managed credential like `DATABASE_URL` /
  `GREENLIGHT_DATA_KEY`) to the client, through `/api/config` or any other route.
- **`managed`** — platform-derived (above); read on the server, never exposed to the browser.

The failure to avoid: an endpoint that returns _all_ of `process.env` to the frontend. That leaks
every secret in the pod. Return only the specific, public-safe keys the frontend actually needs.

## Packaging the app for deployment

Greenlight app compute runs as Kubernetes workloads in a per-app namespace. Namespace isolation is
kind-agnostic: future `worker`, `cron`, `job`, `static`, and other workload kinds may get different
manifest fields, but they inherit this runtime posture unless Greenlight documents a kind-specific
exception.

MVP ships one `workloads.web` workload per app. It renders as a Kubernetes `Deployment`, `Service`,
and route. The contract (some items the pipeline enforces, others noted as recommended):

- **You author the `Dockerfile`** for your stack — nothing is seeded. Use an **org-approved base
  image**. When `getPolicies()` is available, read the `approved-base-images` policy;
  until then, follow the user's/org's stated base-image guidance and avoid guessing.
- **Prefer small, standard base images — and pick the _same_ one every app on a runtime uses.** A
  smaller image builds faster, pushes faster, and pulls onto the node faster (a faster rollout); and
  when every Node app starts from the identical `node:20-alpine`, the registry and the AKS nodes
  already hold those base layers, so later builds and deploys hit cache instead of re-fetching. Don't
  invent a bespoke base per app. Sensible defaults by runtime (override only when the org says so):
  - **Node:** `node:20-alpine` (or `node:22-alpine`).
  - **Static / SPA / reverse proxy:** `nginxinc/nginx-unprivileged:alpine` — already non-root and
    `/tmp`-friendly under the security posture below (plain `nginx:alpine` needs the `/tmp` tweaks).
  - **Python:** `python:3.12-slim` (Debian slim), **not** `python:3.12-alpine`. Alpine's musl libc
    forces many wheels to recompile from source — slower, flakier builds — so slim is the faster,
    more reliable default here despite the name.
  - **Go / Rust / other compiled:** multi-stage build, then copy the static binary into
    `gcr.io/distroless/static` or `alpine:3.20` for a tiny final image.
    Keep deps in their own layer (copy lockfiles and install _before_ copying source) so an unchanged
    dependency set stays cached across builds. The cross-app cache payoff grows once registry/node
    layer caching is fully enabled platform-side; smaller images help build/push/pull time regardless.
- **Expose port 8080** and bind your server to it (`PORT` is injected; read it). Do not require
  privileged ports like `80` or `443`.
- **Sizing compute, and the namespace quota.** Every app namespace has a `ResourceQuota` ceiling.
  You do **not** set or see the quota — Greenlight sizes it to admit any workload up to the org
  compute cap (default cpu 2 / memory 4Gi), including the brief extra pod a rolling update runs. So
  the rule of thumb is simple: **start with no `compute:` block** (the baseline fits most apps), and
  raise it only when a deploy gives you evidence you need more — a pod `OOMKilled` (raise `memory`),
  sustained CPU throttling or slow responses (raise `cpu`), or a cold start that fails the readiness
  probe. Move one step at a time rather than jumping to the cap; an oversized `compute:` just reserves
  budget the app never spends. Any value **within the cap always deploys** — it can't be the reason a
  rollout fails. A value **above the cap is rejected at PR time** (`POLICY_VIOLATION`,
  `workload-compute-limit`), so you never reach a confusing runtime failure. Full reference:
  [docs/34 § compute](https://github.com/ShiftEngineering/greenlight/blob/main/docs/34-workloads.md).
- **Runtime security posture:** the namespace enforces Kubernetes Pod Security Admission
  `baseline`, with `restricted` warnings/audits. App pods run with user namespaces
  (`hostUsers: false`), `seccompProfile: RuntimeDefault`, `allowPrivilegeEscalation: false`, and
  `capabilities.drop: ["ALL"]`. Greenlight does **not** set `runAsNonRoot` and does **not** set
  `readOnlyRootFilesystem`.
- **Root images are accepted, but root is not privileged.** Container-root maps to an unprivileged
  host UID, no-new-privileges is set, and Linux capabilities are dropped. Startup code should not
  rely on privileged `chown`/`chmod`, setuid/setgid helpers, `sudo`, `gosu`, DAC bypass, or changing
  root-owned runtime paths.
- **The container filesystem is writable**, including your working directory, but write runtime
  state to `/tmp` or app-owned paths. `/tmp` is a small (64 MiB) in-memory tmpfs — handy for fast
  scratch, but it counts against the pod's memory and is wiped on restart. Treat all filesystem
  writes as ephemeral; durable state belongs in a requested resource (postgres/blob). Avoid images
  that need to mutate root-owned paths such as `/var/cache`, `/var/run`, `/run`, `/var/log`, or
  `/etc` during startup.
- **Prefer container-ready image variants** when they exist. For nginx/static serving, prefer
  `nginxinc/nginx-unprivileged` or configure `pid` and `*_temp_path` values to `/tmp`; stock nginx
  can schedule successfully but still crash if its entrypoint tries to `chown` cache/log/pid paths
  after capabilities have been dropped.
- Implement **`GET /healthz`** returning `200` with a small body (`{"status":"ok"}`) when ready.
  K8s liveness/readiness probes hit it; it is the one unauthenticated route.
- Do not implement authentication — SSO is enforced at the ingress for every route but `/healthz`.
  Your app still **receives** the signed-in user's identity on every request, though — see
  _Knowing who the signed-in user is_ for the `X-User-*` headers and how to build per-user features
  with them. Do not bundle a `.env` file or any credential.
- **Encouraged, but optional: a dashboard icon.** Make a simple, tasteful, unique icon for the app
  based on what it does, and commit it as `.greenlight/icon.svg` so the `/apps` dashboard tile shows
  it instead of Greenlight's generated monogram — a **square** SVG, at least **120×120** logical size
  (square `viewBox` or square `width`/`height`), with **no** `<script>`, event-handler attributes,
  `<foreignObject>`, or external/remote references (no `http(s)`/`//` `href` or `url()`). Greenlight
  reads it at deploy, validates it, and normalizes it to the platform format. It remains **optional**:
  omit the file and the app keeps the generated monogram — absence is normal, never an error. An
  invalid file is ignored (the monogram stays) and never fails your deploy. Prefer SVG (you can author
  it deterministically as text); raster icons are not read at MVP.

## Reaching company data

A granted integration reaches its upstream one of two ways, set per-integration by its
`delivery_mode` (read it from `getApp` / integration Knowledge — it is not in the
manifest):

- **Proxied** (the default): call the Greenlight proxy, never the upstream directly. Base URL from
  `process.env.GREENLIGHT_PROXY_URL` (never hardcode it); path
  `${GREENLIGHT_PROXY_URL}/<integration>/...`. Put `process.env.GREENLIGHT_DATA_KEY` in the same
  auth slot the upstream normally uses for that integration (for example `Authorization: Bearer`,
  `X-Api-Key`, `?apikey=`, or the secret side of a multi-header/basic shape — read the provider
  instructions from integration Knowledge / `getApp`). The proxy
  validates that key, swaps in the real credential in the same slot, and audits the call — the app
  never holds the upstream credential.
- **Injected**: the bound credential is injected directly into the pod under the integration's fixed
  env-var name (shown by `getApp`). Read it from `process.env` and call the upstream with it.

Either way, never hardcode a credential or commit one to the repo. For user-delegated (always
proxied) integrations, forward the inbound `X-Greenlight-Actor-Token` request header to the proxy
unchanged — never inspect, log, or store it; it is an opaque token the proxy exchanges for a
user-scoped upstream credential.

_Which_ integrations exist and each one's delivery mode is customer-specific — call
`listGrantableIntegrations` to enumerate them (it returns `delivery_mode` and `env_var_name`
per integration). _How_ to query a given upstream is best read from integration Knowledge —
`knowledgeList({ scope: 'integration', integration })` then `knowledgeGet` — falling back to the
user's/org's instructions plus `getApp`, never hardcoded assumptions in this file.

## Knowing who the signed-in user is (the `X-User-*` headers)

SSO runs at the edge, so your app never implements login — but it is **not** blind to who the user
is. On every authenticated request to the pod (after the user signs in through SSO), Greenlight
injects the caller's identity as request headers. No app code triggers this; the headers are simply
present on the inbound request:

- **`X-User-Id`** — the Greenlight user UUID. Stable per user, so this is the key to use for anything
  per-user (settings, preferences, drafts, "my items").
- **`X-User-Email`** — the signed-in user's email; for display, notifications, attribution.
- **`X-User-Name`** — the user's display name (may be empty — fall back to the email).

This lets you build per-user features for free: save settings keyed on `X-User-Id`, show the current
user's email in the UI, personalize the landing view, attribute in-app actions to a user — all
without writing or owning any authentication.

**Trust rule (security-critical).** These headers are authoritative **because** Greenlight injects
them at the edge after `/auth/check`: Traefik strips any client-supplied `X-User-*` and overwrites
them with the verified values, so an end user **cannot** spoof their identity by sending these headers
themselves. Trust them as identity, and don't roll your own login beside them.

Read the headers case-insensitively (`x-user-email`, etc.). In a local dev loop there is no edge, so
the headers aren't present — read the real headers in production and fall back behind a
`NODE_ENV === 'development'` check to a dev identity (Greenlight injects `DEV_USER_EMAIL` for exactly
this). `getAppPreviewUrl` signs you in as yourself, so the deployed app sees _your_ `X-User-*` — use
it to verify per-user behavior end to end.

## Source control goes through Greenlight

These are **agent-internal mechanics**, not instructions for the citizen developer. Use git for the
parts git owns — clone, branch, commit, push your feature branch — authenticated with the
short-lived token from `getRepoAccess({ app_id })`. **Don't reach for the `gh` CLI or the GitHub
API:** your session usually isn't logged into them, so they fail and waste a turn — and the governed
change request (opening and merging the PR) goes through MCP regardless.

For a plain clone, `greenlight repo clone --app <id> [--dir <dir>]` does it in one step with a freshly
minted token (never printed). For branch/commit/push work, `getRepoAccess({ app_id })` hands you a
ready-to-run `clone_command` and an `authenticated_clone_url`, plus the raw `token` and a token-less
`clone_url` if you'd rather assemble the command yourself. The token is
a GitHub App installation token, so it goes in the URL as the `x-access-token` user — not as a
header, and not as a bare password:

```bash
# Clone — use the returned clone_command, or build it from the token:
git clone https://x-access-token:<token>@<host>/<owner>/<repo>.git
# Existing checkout — point origin at the authenticated URL, then pull/push:
git -C <dir> remote set-url origin https://x-access-token:<token>@<host>/<owner>/<repo>.git
git -C <dir> push origin <branch>
```

Refresh the token with another `getRepoAccess` call if your session runs past its `expires_at`
(~1 hour). The governed change request then goes through MCP:

- **Open** with `createPullRequest` **after your feature branch is pushed** (above). Pass `app_id`
  and your head branch; Greenlight resolves the repo. You never name the repo and never hold a
  GitHub credential beyond the scoped clone token. Push the branch first — opening a PR for a branch
  that isn't pushed yet has no commits to propose.
- **Merge** with `mergePullRequest` only after you have observed a passing pipeline for
  the exact head SHA. Direct pushes to `main` are blocked by branch protection.

Do **not** use `gh`, the GitHub API, or any other path to open or merge a PR — the change must flow
through Greenlight so it is audited and policy-gated.

## Recovering from a pipeline failure

The pipeline is your feedback loop; fix and re-push autonomously rather than asking the user. Do not
tell the citizen developer to check GitHub, read a pipeline page, or interpret scanner output.

1. `getPipelineRun({ app_id, pull_request_number, wait: true })` — or `greenlight pipeline --app <id>
--pr <n> --wait` — long-polls server-side and returns a terminal `passed`/`failed`, or
   `running`/`deploying` with `retry_after_seconds` (call again). Do not busy-wait client-side.
2. On `failed`: `getPipelineRun({ app_id, run_id, detail: 'full' })` (`greenlight pipeline --app <id>
--run <id> --detail full`) returns every check with its `error_summary`, `suggested_fix`, and
   `details[]` (`file`, `line`, `rule`, `severity`); `detail: 'full'` additionally attaches the
   failing check's raw log tail.
3. Fix the flagged file at the flagged line, commit, and push — the pipeline reruns automatically.
4. Repeat until the PR head passes, then merge and wait on the merge SHA's deploy run.

## Verifying a deployed app

**Verify after every change and every deploy — this is mandatory, not a nicety.** Before you tell
the citizen developer anything is ready, prove that the _specific thing they asked for_ actually
works. "The pipeline passed" and "the page loads" are **not** "it works", and "here's the URL" is no
substitute for having tried it. Reproduce the user's request end-to-end yourself — submit the form,
call the endpoint, walk the flow they described — and confirm the result is what they asked for.
While building, exercise it in your local preview under `greenlight run` (live data per policy,
fixtures for the rest); after deploy, verify it for real against the live app.

**Be relentlessly proactive.** Drive the verification yourself; never hand the app to the citizen
developer to test for you, and never report success you have not observed. If anything is wrong or
missing, fix it, redeploy, and verify again — loop until the requested behavior genuinely works.
Only then is the change done.

Use these tools, together:

- **`getAppPreviewUrl({ app_id, path? })` — or `greenlight preview --app <id> [--path <p>]` — your
  main verification tool today.** Mints a one-time
  URL you open in your own browser tool (IDE preview pane, Playwright, any headless browser). It
  signs you in through the SSO boundary with no interactive IdP login, so you can render the page,
  run its client-side JS, click through the exact flow the user asked for, and screenshot it for PR
  evidence — the session is _you_, with your real identity and access. For a response-level check
  (status / JSON), drive a `fetch` from that same browser session. The URL is single use and expires
  in 5 minutes, and the session it creates is confined to that one app's host: mint a fresh URL per
  browser context, and never share one.
- `getLogs({ app_id, since?, filter? })` — or `greenlight logs --app <id>` — a bounded window of pod
  stdout/stderr, with crash-loop context, for diagnosing runtime errors. Apps must log their handler
  errors for this to help: a 500 that only returns JSON to the client leaves nothing in the pod log.
- `getApp({ app_id })` — or `greenlight apps show --app <id>` — deployed state, grant/resource status,
  and the latest pipeline result.
- `getMetrics({ app_id })` — or `greenlight metrics --app <id>` — recent CPU, memory, and restart
  counts to spot resource pressure.
- **`curlApp({ app_id, path, method? })` is not available yet.** When it ships it will be the
  cheaper, safer default for response-level checks (an authenticated server-side request straight
  into the in-cluster Service, no browser needed) and a fault-localizing complement to the preview
  URL — the Service-direct path vs. the full public edge (DNS/TLS/Traefik/ForwardAuth). Until then,
  use the preview session for response checks too.

Verifying is for _you_; putting the result in front of the citizen developer is a separate step —
see _Showing the citizen developer their app_.

## Local development with `greenlight run`

The one CLI verb with no MCP equivalent — it delivers real secret values into a local process, which
never crosses MCP. (Sign-in, the CLI ↔ MCP map, and install paths are in _Two interchangeable
surfaces_ above.)

**`greenlight run -- <your dev command>`** (e.g. `greenlight run -- npm run dev`) is the standard —
and only — local-run entry. It resolves the app's env contract server-side and injects the values
**into your dev process only**: no `.env.local`, no file on disk, no local server, and no secret
ever crosses MCP. App code is byte-identical to the deployed pod — same env-var names, different
values — so always read env vars and never hardcode endpoints. There is **no `envPull` tool**; it
was retired permanently — do not call it.

**Know what's live vs. fixtures before you run.** Read `getApp` (grant `delivery_mode` +
`local_dev_enabled`) to see what will be live, and `greenlight run` prints a per-dependency status
line at startup. At MVP:

- **Injected integration with `local_dev_enabled`** → the real credential, in-process. Live.
- **Injected integration with `local_dev_enabled: false`** → IT withholds it; author a fixture.
- **Proxied integration with `local_dev_enabled`** → live through the same broker: `greenlight run`
  mints a short-lived `purpose: 'local'` token and points the app at the real public proxy, so calls
  go through the unchanged grant-check + credential-swap + audit path. No upstream secret on the
  laptop.
- **Proxied integration with `local_dev_enabled: false`** → IT withholds it; calls get a `403`,
  so author a fixture for the loop.
- **App's own Postgres** → a local fixture database; `DATABASE_URL` is not injected locally.
- **Blob** → a freshly minted short-TTL SAS. Live.

For anything that's fixture-only — or when the control plane is unreachable (corporate egress
block) — write your own fixtures/mocks for that dependency and keep iterating, then confirm the real
wiring against deployed state after the pipeline passes (deployed-state reads, logs/metrics, and a
browser session via `getAppPreviewUrl`).

## Showing the citizen developer their app

Seeing the app is the citizen developer's main feedback signal — show it, don't just describe it.

- **While building — a local preview via `greenlight run`.** Start the app with
  `greenlight run -- <your dev command>` (see _Local development_) and open the `localhost` URL in
  your browser/preview tool so the user can watch it take shape. Live integrations and the blob
  carry real data per IT policy; fixture-only dependencies show sample data — tell the user which is
  which. Make sure a Node runtime is present; if the app's own runtime/deps are a heavy lift to set
  up, ship the code and show the deployed app instead. A local preview is a nicety, not a gate.
- **After deploy — the real thing.** Once the PR has merged and rolled out, call
  `getAppPreviewUrl({ app_id, path? })` and open the `preview_url` in your browser/preview tool to
  show the user the live, real-data result. If your browser tool can't open a non-`localhost` URL
  (a known limitation in some coding agents), run an OS open command instead (`open` on macOS,
  `xdg-open` on Linux, `start` on Windows) so it opens in the user's own browser; if even that isn't
  available, give the user the URL to open themselves. The preview URL is **single use and expires
  in 5 minutes**, so mint a fresh one for the user-facing open rather than reusing one your own
  browser already consumed.
- **Embedded browsers block the clipboard.** When you (or the user) view the app in an agent's
  embedded browser, `navigator.clipboard` and `execCommand('copy')` are usually blocked. If the app
  hands the user text (a generated file, an ID), give them a download or a selectable text area —
  not only a "copy" button — or the copy silently fails.

## Sharing apps and working on a teammate's app

Owners and co-owners can add or remove another co-owner by email:
`addCoOwner({ app_id, user_email, reason })` / `removeCoOwner({ app_id, user_email, reason })`,
or `greenlight share --app <id> --email <email> --reason "..."` /
`greenlight unshare --app <id> --email <email> --reason "..."`.

To work on an app a colleague built, use `listApps({ slug })` only if it is available and
the caller already has access; otherwise tell the user the app owner needs to share access first.
Once you have access, pair the CLI and use `greenlight run` for the local loop (fixtures for any
fixture-only dependency).

## Quick reference

Use whichever authenticated surface is working (see _Two interchangeable surfaces_). CLI write
payloads come from stdin/file/fd, never from `--value` or `--body`.

| Goal                                                        | MCP tool                                                                  | `greenlight` CLI                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| Register a new app                                          | `registerApp`                                                             | `apps register`                                          |
| Provision a DB / blob, add a workload, request data access  | edit `greenlight.yml` → PR → merge                                        | —                                                        |
| Discover grantable integrations / credential slugs          | `listGrantableIntegrations`                                               | `integrations list`                                      |
| Set or change an env-var value                              | `envSet` / `envRemove`                                                    | `env set` / `env rm`                                     |
| Read what's set / declared                                  | `getApp`, `envList`; `getPermissions` pending                             | `apps show`, `env list`                                  |
| Run the app locally (real data per policy, no file on disk) | —                                                                         | `greenlight run -- <cmd>` (after `pair`/`login`)         |
| Open / merge a PR                                           | `createPullRequest` / `mergePullRequest`                                  | `pr open` / `pr merge`                                   |
| Wait on / debug the pipeline                                | `getPipelineRun` (`detail: 'full'` for logs)                              | `pipeline --wait` (`--detail full`)                      |
| Verify a deploy / read logs / metrics                       | `getApp` + `getLogs` / `getMetrics`; `curlApp` pending                    | `apps show` + `logs` / `metrics`                         |
| See a deployed app in a browser (render, click, screenshot) | `getAppPreviewUrl` → open `preview_url`                                   | `preview` → open the URL                                 |
| Know who the signed-in user is                              | read the edge-injected `X-User-Id` / `X-User-Email` headers               | — (same headers)                                         |
| Show the citizen developer the app                          | `getAppPreviewUrl` after deploy                                           | `greenlight run` preview while building; `preview` after |
| Read / propose customer context                             | `knowledgeList` / `knowledgeGet` / `knowledgeSearch` / `knowledgePropose` | `knowledge list` / `get` / `search` / `propose`          |
| Read enforced rules                                         | `getPolicies` (pending)                                                   | —                                                        |
| Share or join an app                                        | `addCoOwner` / `removeCoOwner`                                            | `share` / `unshare`                                      |
| Write/commit/push code                                      | `getRepoAccess` token → git (not `gh`)                                    | `repo clone`, then git                                   |

## Scope

This skill covers Greenlight-governed app work only. Defer everything else to your other tools:
general coding questions, apps Greenlight does not manage, and anything that wants to reach GitHub,
a cloud console, or a data provider directly — Greenlight is the path for all three.
