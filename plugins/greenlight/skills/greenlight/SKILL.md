---
name: greenlight
description: >-
  Use when a citizen developer describes an internal app idea or asks to build,
  change, deploy, verify, debug, or maintain an app in a Greenlight-governed
  environment, even if they do not mention Greenlight or deployment. Also use in
  any repo with greenlight.yml. Whenever the Greenlight plugin is invoked, read
  this skill in its entirety before acting — including, and especially, when the
  Greenlight MCP server is missing from the tool list, disconnected, or failing
  auth: the skill explains the bundled greenlight CLI, which authenticates
  independently and can do everything MCP can, so an MCP failure is never a
  reason to stop. Do not use for unmanaged apps or direct GitHub, cloud, or
  data provider access.
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

If the Greenlight MCP tools aren't in your tool list, or a tool call starts returning auth errors,
you are not connected — **do not** tell the user "the tools aren't available" and stop. You have two
interchangeable ways in (see _Two interchangeable surfaces_): the MCP tools, **or** the `greenlight`
CLI, which holds its own auto-refreshing credential and keeps working when the MCP session doesn't.
**When MCP is the blocker, silently and automatically switch to the CLI and keep going** — it is
built for exactly this. Do not stop to ask the user to complete an MCP OAuth sign-in; the sign-in
tool often isn't even available to you, and the CLI does everything MCP can. Only if the CLI itself
has no usable credential, sign it in first (`greenlight pair` reuses a healthy MCP session,
`greenlight login` runs a standalone browser flow — hand the user the URL if you can't open it).
Surface a real error only if both paths genuinely fail.

## Who you're building for

Greenlight is the governed platform an enterprise runs its internal apps on. You — the coding
agent — are the developer. A non-technical person describes what they want; you build it and ship
it _through_ Greenlight, which governs source control, CI, deployment, secrets, data access, and
audit on their behalf.

**Assume the citizen developer is not a software engineer.** Unless they show you otherwise, they
don't know — and shouldn't have to care about — GitHub, git, pull requests, CI, pipelines,
Kubernetes, hosting, repos, or Greenlight internals. What they care about is **what their app looks
like, what it does, and whether they can share it yet.** Do the entire technical workflow yourself.
Never ask them to open a repo, read a diff or logs, inspect pipeline status, approve a GitHub
prompt, or run a command.

**Voice rules — apply to every user-facing message, not just the final one:**

- **Talk about the app, never the plumbing.** PRs, merges, branches, pipelines, repos, MCP vs CLI,
  proxied vs injected credentials, grants, tokens, Kubernetes — none of it appears in what you say
  to the user unless they ask. Say "publishing your change now — it takes a couple of minutes," not
  "opening a PR and waiting for the pipeline." Say "your app can read the company CRM," not "the
  proxied grant is live."
- **Never ask technical permission.** "Want me to merge the PR?", "Should I go diagnose the
  failure?", "Should I switch to the CLI?" are your calls — make them and keep moving. Fixing a
  failed check, retrying auth, choosing a surface, merging after a green pipeline once the user has
  asked to publish: all yours, done silently.
- **The only questions you ask are product questions** — what it should look like, what it should
  do, who uses it, which company data it should show. Offer concrete options rather than open-ended
  prompts (see _Starting from an idea_).
- **Their main feedback signal is seeing the app.** Show a running app early and often, and narrate
  what changed in product terms. See _Show your work_.

## Starting from an idea: discover, then propose

When the user invokes Greenlight with just an idea — or nothing at all — don't jump into
scaffolding, and don't interrogate them cold. Ground yourself first (all read-only and fast; run
them together):

1. `listGrantableIntegrations` — which company systems apps here can use.
2. `listApps` — what already exists (something similar may already ship, and it shows the org's
   naming conventions).
3. Org Knowledge — `knowledgeList({ scope: 'org' })` — customer-specific conventions and context.

Then **open with what's possible at their company**: name the data sources you could wire in (by
friendly name — "your CRM", "your ticketing system" — whatever the integration list actually
returns), mention any existing app that overlaps, and make 2–3 concrete suggestions tailored to
what they said (or to their role, if they said nothing). You are the one who knows what Greenlight
can do here; lead with it.

Then gather intent as a **short structured intake** — a few product questions with selectable
options, not an engineering interview. Use your environment's structured-question affordance (a
form, a multiple-choice prompt) when it has one; otherwise ask the same things in plain chat:

- What do you want to build, in your own words?
- Who will use it? _(just me / my team / the whole company)_
- Does it need to remember data between visits? _(yes, save records / yes, files too / no / not sure)_
- Should it pull from any company systems? — offer the actual integrations you discovered, by
  friendly name.

Map the answers yourself and keep the mapping invisible: "save records" → a postgres resource;
"files too" → blob; a named company system → a grant; "whole company" → nothing special (SSO
already handles who can sign in).

**Knowledge is the customer-context store** — DB-backed Markdown scoped to org, integration, or
app. Read org Knowledge at the start of **every** session — not just cold starts; a session that
jumps straight into an existing app still needs the org's conventions. Then: read app Knowledge
(`knowledgeList({ scope: 'app', app_id })`) and
`getApp` before changing an existing app; read integration Knowledge
(`knowledgeList({ scope: 'integration', integration })` + `knowledgeGet`) before writing
data-access code; `knowledgeSearch({ query })` when you're stuck; `knowledgePropose({ …, rationale })`
when you learn something future sessions need — it files a proposal for human review, never a
direct edit. Each has a CLI twin (`greenlight knowledge list/get/search/propose`). `getPolicies`
(the enforced pipeline rules) is not available yet; infer policy from pipeline output and the
manifest.

**Knowledge is a best-effort head start, not a precondition.** Check it — it often saves real work —
but do not assume an entry exists for a given org, app, or integration, or that any entry it does
have tells you how to call an upstream API. Many integrations will have no Knowledge at all. When
it's missing or thin, **don't stop and don't guess** — go find the information yourself: read the
upstream provider's own public docs, API reference, or SDK source to work out its endpoints, required
params, and auth convention (this is normal, expected work). Then, when you've figured something out
that the next session would otherwise have to rediscover — an integration's real endpoints and auth
shape, a non-obvious symbol/ID lookup, a data-model quirk — **write it back with `knowledgePropose`**
(scope it to the integration or app, with a `rationale`). That turns your one-time reverse-engineering
into durable context and is how integration Knowledge gets seeded in practice. Propose facts you
verified by actually calling the API, not assumptions.

## Two interchangeable surfaces: MCP tools and the `greenlight` CLI

Greenlight's builder surface is reachable two equivalent ways — use whichever is authenticated:

- **MCP tools** — `listApps`, `getApp`, `getPipelineRun`, … in your tool list.
- **The `greenlight` CLI** — a bundled client that calls the **same `/mcp` tools** but holds its
  **own OAuth credential with working refresh**. On Claude Code the plugin's `bin/` directory is
  already on the Bash tool's PATH, so invoke it as plain `greenlight …` — no path needed. If the
  bare command isn't found (another runtime, or an older client), run the bundled artifact
  directly with Node: `node "${CLAUDE_PLUGIN_ROOT}/bin/greenlight.mjs"` on Claude Code, or
  `bin/greenlight.mjs` under wherever your runtime installed the plugin. Either way a Node
  runtime must be present. Never re-author it — it is the trusted bundled artifact.

**When MCP auth is failing, switch to the CLI — that is exactly what it is for.** Coding-agent MCP
OAuth clients refresh unreliably; the CLI refreshes its own credential, so the same operation
succeeds through it.

**Sign the CLI in** (either path yields the same auto-refreshing credential):

- **`greenlight pair`** — reuses a healthy MCP session: it prints a code, you approve it with
  `approveCliSession({ code })` over MCP. No second browser sign-in.
- **`greenlight login`** — standalone browser OAuth (loopback flow) when there is no usable MCP
  session; open the URL it prints (or hand it to the human).

**CLI ↔ MCP equivalence** — builder goals, callable from either surface:

| Goal                                                          | MCP tool                                                                  | `greenlight` CLI                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Register a new app                                            | `registerApp`                                                             | `apps register`                                    |
| List apps                                                     | `listApps`                                                                | `apps list`                                        |
| App detail / live state                                       | `getApp`                                                                  | `apps show --app <id>`                             |
| Provision a DB / blob, add a workload, request data access    | edit `greenlight.yml` → PR → merge                                        | —                                                  |
| Discover grantable integrations / credential slugs            | `listGrantableIntegrations`                                               | `integrations list`                                |
| Read declared env (names/values)                              | `envList`                                                                 | `env list --app <id>`                              |
| Set / remove env values                                       | `envSet` / `envRemove`                                                    | `env set` / `env rm`                               |
| Open / merge a PR                                             | `createPullRequest` / `mergePullRequest`                                  | `pr open` / `pr merge`                             |
| Pipeline status (`--wait` to poll, `detail: 'full'` to debug) | `getPipelineRun`                                                          | `pipeline --app <id> …`                            |
| Pod logs                                                      | `getLogs`                                                                 | `logs --app <id>`                                  |
| Verify a deployed response                                    | `curlApp`                                                                 | `curl --app <id> --path <p>`                       |
| Metrics (point / series)                                      | `getMetrics` / `getMetricsSeries`                                         | `metrics` / `metrics series --app <id>`            |
| Knowledge (read / propose)                                    | `knowledgeList` / `knowledgeGet` / `knowledgeSearch` / `knowledgePropose` | `knowledge list` / `get` / `search` / `propose`    |
| Clone the repo (minted token)                                 | `getRepoAccess`                                                           | `repo clone --app <id>`                            |
| Refresh an expired repo token on a checkout                   | `getRepoAccess` → `git remote set-url`                                    | `repo refresh --app <id> [--dir <d>]`              |
| Run locally — app env with `--app`, else your own grants      | —                                                                         | `run [--app <id>] -- <cmd>` (after `pair`/`login`) |
| See a deployed app in a browser (render, click, screenshot)   | `getAppPreviewUrl`                                                        | `preview --app <id>`                               |
| Share / unshare app ownership                                 | `addCoOwner` / `removeCoOwner`                                            | `share` / `unshare`                                |
| Report platform friction to the Greenlight team               | `submitFeedback`                                                          | `feedback --category <c> --title "…"`              |

CLI-only helpers: `greenlight doctor`, `greenlight whoami`, `greenlight logout`. Recover flag
detail from `greenlight help` or `greenlight <command> --help` — never guess.

**Write payloads use stdin/file, never argv.** Env values and Markdown/PR bodies can contain
secrets or multiline text, so the CLI refuses `--value` and `--body`:

```bash
printf '%s' "$VALUE" | greenlight env set --app <id> --name API_KEY --sensitive --reason "rotate key"
greenlight pr open --app <id> --head feature/demo --title "Ship demo" --body-file /tmp/pr-body.md
greenlight knowledge propose --scope app --app <id> --topic schema-notes --title "Schema notes" \
  --rationale "Future agents need this" --body-file /tmp/schema-notes.md
```

After `greenlight apps register`, use `greenlight repo clone --app <id>` for an authenticated
checkout; the register response's `repo_url` is intentionally token-free.

**If the CLI is missing or stale**, try in order: (1) the plugin bundle (this artifact);
(2) control-plane-hosted — `curl` the `/cli/install.sh` route on the same host as your MCP
endpoint; (3) the public marketplace repo's raw `plugins/greenlight/bin/greenlight.mjs`. **Output
contract:** stdout is machine JSON only, diagnostics go to stderr, and failures are the canonical
`{ code, message, details?, next_steps?, request_id }` envelope with a stable non-zero exit
(2 validation, 3 auth, 4 not-found/forbidden, 1 other). Add `--debug` for transport diagnostics.

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
2. **Clone and write code — showing the user as you go.** Fill in the required `docs` block (the
   pipeline blocks deploy without it) and a `README.md`. Write your `Dockerfile` and `src/`. As
   soon as there is anything to render, run the app locally and put it in front of the user — see
   _Show your work_. Iterate here, where a change costs seconds, not in the deploy loop.
3. **Declare infrastructure** by uncommenting and editing `greenlight.yml`: add `workloads.web`,
   any `resources`, any integration `grants`, and the _names_ of env vars under `env`.
4. **Set env-var values** for each name you declared, with `envSet` or `greenlight env set` — pass
   `app_id`, the `name`, the value via stdin/file, a `sensitive` flag, and a `reason`. Names live in
   the manifest; values live in the vault. Every declared name must have a value by merge time or
   the deploy fails with `MISSING_ENV_VALUE`.
5. **Open the PR** with `createPullRequest` or `greenlight pr open` — after the user has seen the
   change working locally (_Show your work_) and **after** your head branch is pushed (pass `app_id`
   and that branch). Do this through Greenlight, never with `gh` or the GitHub API (see _Source
   control_ below).
6. **Wait, then merge.** Poll `getPipelineRun` (`greenlight pipeline --pr <n> --wait`) with
   `pull_request_number` and `wait: true`. Once it passes, merge through Greenlight with
   `mergePullRequest({ app_id, pull_request_number })` or `greenlight pr merge` — **never** `gh pr merge`
   or the GitHub API. **The merge is the apply trigger** — it provisions declared resources, reconciles
   grants, builds and rolls out the workload. Don't stop to ask the user whether to merge: if they
   asked for the change to go live, a green pipeline is your signal to proceed.
7. **Observe the deploy, then verify.** Poll `getPipelineRun` again on the merge SHA (`commit_sha`,
   `wait: true`), then `getApp` (`greenlight apps show`) for the live state and deployment URL.
   **Then verify the change actually does what the user asked** (see _Verifying a deployed app_)
   before you tell them anything is ready.

Updating an app later is the same loop minus step 1: edit `greenlight.yml` and/or code, show the
user locally, PR, merge, verify. **Every change ends with verification** — there is no "done" you
report without having watched the requested behavior work.

For any shipping change, copy this checklist and check items off as you go — it exists to stop the
two most-skipped steps (showing the user before shipping, and verifying after deploy):

```
Ship progress:
- [ ] Change built and running locally (greenlight run)
- [ ] User has seen it working in the preview (Show your work)
- [ ] Env names declared + values set (no MISSING_ENV_VALUE at merge)
- [ ] Branch pushed, PR opened through Greenlight
- [ ] Pipeline green on the PR head; merged through Greenlight
- [ ] Deploy run green on the merge SHA
- [ ] Requested behavior verified against the live app (Verifying a deployed app)
- [ ] Live app shown to the user (fresh preview URL)
```

<!-- cancelled-tools-note:start -->

There are **no imperative infrastructure tools for an app** — no `resource.add`, no
`requestPermissions`, no `workload.add` / `workload.update` / `workload.remove`. Anyone who
remembers those from an older Greenlight is remembering a model that no longer exists. Every
resource, workload, and **app** grant change is a `greenlight.yml` edit applied by a merge. (This
paragraph is the _only_ place those names appear, precisely to say they are gone. The one
imperative grant request that _does_ exist — `requestCredentialAccess` — requests the **user's own
personal** access, never the app's; see _Personal data access_.)

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
    # omit compute: — baseline (25m/128Mi req, 500m/512Mi lim) fits most apps.
    # Declaring compute sets request=limit and reserves that capacity even when idle.
    # Add only after evidence (OOMKilled → memory; CPU throttle / slow starts → cpu).
    # Caps are org-set (default cpu<=2, memory<=4Gi). See Packaging → Sizing compute.

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

tags: # optional org-wide category labels for the /apps catalog filter
  - finance # prefer a fitting term from the suggested set: productivity, marketing,
  - productivity # finance, project management, games, test — else pick a relevant custom tag
```

Set `tags:` to the category the app belongs to so it groups with its peers in the `/apps`
catalog filter. Reach for the suggested vocabulary first (`productivity`, `marketing`, `finance`,
`project management`, `games`, `test`); when none fit, choose a short relevant tag of your own.
Tags apply on merge like the rest of the manifest and are read-only in the dashboard.

Before you add or change a `grants:` entry, call `listGrantableIntegrations` (or `greenlight
integrations list`) to see which integrations and credential slugs the org has registered, whether
each is `injected` or `proxied`, and to copy its ready-made `manifest_grant_example` straight into
`greenlight.yml`. It is read-only and returns no secrets — a grant naming a slug it does not list
(or one marked `configured: false`) cannot be approved.

Grants are request signals, not merge blockers: an auto-approved grant works the moment the PR
merges; an IT-required grant deploys in `pending` and the proxy returns `403` for it until IT
approves out of band (no redeploy needed). Watch grant status in `getApp`; the dedicated
`getPermissions` tool is still being wired.

## Personal data access (no app needed)

When the user wants governed data for **local work with no app** — a script, a notebook, a
visualizer they may never ship — do not register an app or edit a manifest. Request access under
the **user's own identity** instead:

- **Discover** with `listGrantableIntegrations`: each credential carries a `request_example` and
  the calling user's own `caller_grant_status` (none / pending / granted / denied / revoked), so
  never blind-re-request.
- **Request** with `requestCredentialAccess({ integration, credential_slug, reason })` (or
  `greenlight request --integration <slug> --credential <slug> --reason "..."`). The result is
  `granted` immediately when the credential auto-approves, else `pending` for IT review — tell the
  user to expect IT approval in that case.
- **Use** with `greenlight run -- <cmd>` (no `--app`): the process gets `GREENLIGHT_PROXY_URL` + a
  user-scoped `GREENLIGHT_DATA_KEY` resolving the user's own granted integrations through the same
  governed proxy. No credential lands on the laptop for proxied integrations.

An app's access and the user's personal access are separate authorities: an app never runs on the
user's grants, and holding personal access never activates an app grant. When personal work
graduates into a real app, `registerApp` and declare the app's own `grants:` in the manifest.

## Show your work: the local preview loop

Building is a conversation held through the running app. The citizen developer can't read your
diffs or your logs — **the local preview is the collaboration surface, not an agent-only
verification step.** The user needs to _see_ the app, live, while you build it, so they can react
and redirect while a change still costs seconds instead of a deploy's minutes. Work in this loop:

1. **Run it locally, early.** Start the app under `greenlight run -- <dev command>` (see _Local
   development_) as soon as there is anything to render — a skeleton page beats a description.
2. **Open it where the user can watch.** Put the `localhost` URL in a preview surface the user
   themselves can see and click:
   - **Claude Code:** use the built-in preview browser (`preview_start` and the other `preview_*`
     tools, configured via `.claude/launch.json`) — start the dev server _through_ the preview tool
     so the pane is live for the user, and reuse that running server across edits instead of
     restarting per change.
   - **Other agents:** the IDE's embedded browser or preview pane pointed at the port; if you have
     no live pane at all, fall back to posting a screenshot of each changed screen into chat.
   - **No browser tool at all** (no embedded pane, no browser extension — typical of remote or
     headless CLI environments): render screens yourself with the Playwright CLI and headless
     Chromium — `playwright screenshot --browser chromium --full-page "<url>" shot.png` — and post
     each changed screen into chat. If the CLI isn't installed, run
     `npx playwright install chromium` once, then `npx playwright screenshot …`.
3. **After each meaningful change, show it and say what it is.** Render the changed screen and
   exercise the specific thing you changed — click the button, submit the form; "the page loads" is
   not showing your work. Narrate in product terms: "here's the approval screen — managers now see
   pending expenses at the top." A live pane the user can click themselves is the goal; screenshots
   are the fallback.
4. **Invite reaction, then iterate right here.** Colors, layout, wording, flow — this loop is where
   the user's change requests are cheap. Don't accumulate five invisible changes and ship them
   blind.
5. **Ship only what the user has seen.** Before code moves toward the live app (push → publish),
   the user should have seen the change working locally. Two exceptions: changes with nothing to
   show (an invisible fix), and environments that genuinely can't render a page — then say what you
   couldn't show and verify it after deploy instead. This is a collaboration gate, not a permission
   gate: when the user has already said "publish it" or is clearly done iterating, ship without
   re-asking.

Tell the user which parts show real company data and which show sample data (you know from the
`greenlight run` startup status lines) — in plain words ("the CRM numbers are real; the archive is
sample data until it's published"), never delivery-mode jargon.

**After it ships, show the real thing.** Once the merge has rolled out and you've verified it
(_Verifying a deployed app_), mint a **fresh** `getAppPreviewUrl` for the user-facing open — the
URL is single use and expires in 5 minutes, so never hand over one your own browser already
consumed. Open it in the preview surface; if your browser tool can't open a non-`localhost` URL,
run an OS open command (`open` on macOS, `xdg-open` on Linux, `start` on Windows) so it lands in
the user's own browser, or give them the URL as a last resort.

**Embedded browsers block the clipboard.** `navigator.clipboard` and `execCommand('copy')` usually
fail silently in agent preview panes. If the app hands the user text (a generated file, an ID),
give them a download or a selectable text area — not only a "copy" button.

## Local development with `greenlight run`

The one CLI verb with no MCP equivalent — it delivers real secret values into a local process,
which never crosses MCP.

**`greenlight run`** is the standard — and only — local-run entry, with an explicit mode:

- **App mode — `greenlight run --app <app_id> -- <your dev command>`** (e.g.
  `greenlight run --app 3f25… -- npm run dev`) resolves the **app's** env contract server-side —
  the same grants the deployed pod runs on, so local access mirrors production exactly. Use this
  whenever you are developing an app.
- **User mode — `greenlight run -- <your dev command>`** (no `--app`) resolves the **user's own
  personal grants** instead (see _Personal data access_) — for no-app local work. It never injects
  `DATABASE_URL` or `STORAGE_SAS_URL` (app resources are app-scoped). Omitting `--app` inside an
  app checkout prints a warning and proceeds in user mode — mode is never guessed from the
  directory, so pass `--app` explicitly for app work.
- Extra local vars flow through unchanged: the ambient shell env, repeatable `--env KEY=VAL`, and
  `--env-file <path>` — with Greenlight-managed names always injected last (they cannot be
  clobbered).

Either mode injects values **into your dev process only**: no `.env.local`, no file on disk, no
local server, and no secret ever crosses MCP. App code is byte-identical to the deployed pod — same
env-var names, different values — so always read env vars and never hardcode endpoints. There is
**no `envPull` tool**; it was retired permanently — do not call it.

**Know what's live vs. fixtures before you run.** Read `getApp` (grant `delivery_mode` +
`local_dev_enabled`), and `greenlight run` prints a per-dependency status line at startup. At MVP:

- **Injected integration with `local_dev_enabled`** → the real credential, in-process. Live.
- **Injected integration with `local_dev_enabled: false`** → IT withholds it; author a fixture.
- **Proxied integration with `local_dev_enabled`** → live through the same broker: `greenlight run`
  mints a short-lived `purpose: 'local'` token and points the app at the real public proxy, so calls
  go through the unchanged grant-check + credential-swap + audit path. No upstream secret on the
  laptop.
- **Proxied integration with `local_dev_enabled: false`** → IT withholds it in app mode; calls get
  a `403`, so author a fixture for the loop. (In **user mode** a granted proxied integration is
  always live — the flag gates only raw credential delivery, and proxied calls expose no secret.)
- **App's own Postgres** → a local fixture database; `DATABASE_URL` is not injected locally.
- **Blob** → a freshly minted short-TTL SAS. Live (app mode only).

For anything fixture-only — or when the control plane is unreachable (corporate egress block) —
write your own fixtures/mocks for that dependency and keep iterating, then confirm the real wiring
after deploy (deployed-state reads, logs/metrics, and a `getAppPreviewUrl` session). If the app's
runtime/deps are a heavy lift to set up locally, ship the code and show the deployed app instead —
and tell the user that's what you did.

## Current release availability

The running MVP is still filling in a few surfaces. Not available yet: `getPolicies()` (infer
enforced rules from pipeline output and the manifest), `getPermissions()` (read an **app's**
grant/resource/env state from `getApp`; the user's own personal grant status is per credential on
`listGrantableIntegrations` — see _Personal data access_), and
`addCoOwner()`/the share flow (don't promise collaborator adds until it ships). Full MCP OAuth
bearer enforcement and session-scoped ownership are still being wired — complete sign-in when
prompted, but don't assume every co-owner path is live. A `tool not found` for one of these means
the release is incomplete, not that the workflow is wrong.

## Operating constraints

- **Never hardcode a credential, connection string, or API key.** Greenlight injects every secret
  at deploy time. A secret in source is a security incident, and the pipeline will block it.
- **Never provision cloud infrastructure directly, and never reach an external service directly.**
  Databases, storage, and integration access are _declared_ in `greenlight.yml` and applied when a
  pull request merges. Company data is reached only through the Greenlight proxy.

## Environment variables: which names exist, and what is safe to expose

### Managed names are derived — you do not set them

Greenlight injects **managed** env vars into the running pod, derived from what the manifest
declares. Your code reads them from the environment; you never declare or set them, and `envSet`
rejects them as reserved.

| If the manifest declares…                         | The pod receives…                                               |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `resources:` with `kind: postgres`                | `DATABASE_URL`                                                  |
| `resources:` with `kind: blob`                    | `STORAGE_SAS_URL`, `STORAGE_CONTAINER_NAME`                     |
| a `grants:` entry for a **proxied** integration   | `GREENLIGHT_DATA_KEY`, `GREENLIGHT_PROXY_URL`                   |
| a `grants:` entry for an **injected** integration | that integration's credential, under its own fixed env-var name |
| an `ai_*` grant _(post-MVP)_                      | `GREENLIGHT_AI_KEY`, `GREENLIGHT_AI_BASE_URL`                   |
| always (a `web` workload)                         | `PORT`                                                          |

Whether a grant delivers the proxy pair (**proxied**) or a direct credential under a fixed name
(**injected**) is a property of the integration (`delivery_mode`), not the manifest — so the exact
names depend on which integrations the app is granted. An app with no `resources` and no `grants`
receives only `PORT`. **Always call `getApp` (or `envList`) for the exact managed names a specific
app gets.** A grant awaiting IT approval (`status: pending`, `approval_mode: manual`) delivers
**no** runtime value yet: an injected grant's env var is not present until IT approves and the app
redeploys, and a pending injected grant does **not** give the app `GREENLIGHT_DATA_KEY` (that is only
for proxied grants). `getApp`/`envList` reflect this — a pending injected grant shows its
`env_var_name` on the grant but does not list it as a managed name. The fixed reserved set — rejected by `envSet` and the manifest validator regardless of
what the app declares — is `DATABASE_URL`, `STORAGE_SAS_URL`, `STORAGE_CONTAINER_NAME`,
`GREENLIGHT_DATA_KEY`, `GREENLIGHT_PROXY_URL`, `PORT`, `GREENLIGHT_AI_KEY`,
`GREENLIGHT_AI_BASE_URL`, `PUBLIC_BASE_URL`, `DEV_USER_EMAIL`, `DEV_USER_GROUPS`; each injected
integration additionally reserves its own env-var name per-app. User-declared names must match
`^[A-Z][A-Z0-9_]{0,127}$`.

### Values inject at runtime, not at build time

Greenlight-managed values land in the **running pod**, never in the CI image build — `docker build`
receives only a registry push token, never vault values. So a value set through `envSet` is
available from `process.env` at runtime but **not** during the build.

This is why build-time inlining of a Greenlight value into a client bundle (`NEXT_PUBLIC_*`,
`VITE_*`, `REACT_APP_*`) does not work: those are baked at `docker build`, when the value does not
yet exist. To get a _non-sensitive_ config value to the frontend, read it on the server at runtime
and expose it deliberately — e.g. a `GET /api/config` endpoint or server-side templating.

App-owned build-time constants are fine: a Dockerfile may set `NEXT_PUBLIC_API_BASE=/api` or
similar for values you control in the repo. Anything inlined into a client bundle is public —
never put a secret there.

### Never serve a secret to the browser

A `/api/config`-style endpoint is for values that are safe to be public. Env vars carry a class:

- **`plain`** — readable config you set; safe to expose only if genuinely non-sensitive.
- **`sensitive`** — write-only after creation; never returned by reads. **Never** send a
  `sensitive` value (or any secret, or any managed credential like `DATABASE_URL` /
  `GREENLIGHT_DATA_KEY`) to the client, through `/api/config` or any other route.
- **`managed`** — platform-derived (above); read on the server, never exposed to the browser.

The failure to avoid: an endpoint that returns _all_ of `process.env` to the frontend. That leaks
every secret in the pod. Return only the specific, public-safe keys the frontend actually needs.

## Packaging the app for deployment

Greenlight app compute runs as Kubernetes workloads in a per-app namespace. Namespace isolation is
kind-agnostic: future `worker`, `cron`, `job`, `static`, and other workload kinds may get different
manifest fields, but they inherit this runtime posture unless Greenlight documents an exception.

MVP ships one `workloads.web` workload per app. It renders as a Kubernetes `Deployment`, `Service`,
and route. The contract (some items pipeline-enforced, others recommended):

- **You author the `Dockerfile`** for your stack — nothing is seeded. Use an **org-approved base
  image**; until `getPolicies()` ships, follow the user's/org's stated base-image guidance and
  avoid guessing.
- **Prefer small, standard base images — the _same_ one every app on a runtime uses.** Smaller
  images build, push, and pull faster; identical bases mean the registry and nodes already hold
  those layers, so later builds and deploys hit cache. Don't invent a bespoke base per app.
  Defaults by runtime (override only when the org says so):
  - **Node:** `node:20-alpine` (or `node:22-alpine`).
  - **Static / SPA / reverse proxy:** `nginxinc/nginx-unprivileged:alpine` — already non-root and
    `/tmp`-friendly under the security posture below (plain `nginx:alpine` needs the `/tmp` tweaks).
  - **Python:** `python:3.12-slim` (Debian slim), **not** `python:3.12-alpine` — musl forces many
    wheels to recompile from source, so slim is the faster, more reliable default.
  - **Go / Rust / other compiled:** multi-stage build, static binary copied into
    `gcr.io/distroless/static` or `alpine:3.20`.

  Keep deps in their own layer (copy lockfiles and install _before_ copying source) so an unchanged
  dependency set stays cached across builds.

- **Expose port 8080** and bind to it (`PORT` is injected; read it). No privileged ports like `80`
  or `443`.
- **Sizing compute.** Every app namespace has a `ResourceQuota` ceiling you neither set nor see —
  Greenlight sizes it to admit any workload up to the org compute cap (default cpu 2 / memory 4Gi),
  including the extra pod a rolling update runs. **Start with no `compute:` block** — the baseline
  (25m CPU / 128Mi memory requests, 500m / 512Mi limits) fits static UIs and typical Node/Python
  APIs. Declaring `compute:` sets **request = limit** (Guaranteed QoS), so a copy-pasted
  `500m`/`512Mi` reserves half a core even when the app is idle. Raise only on evidence —
  `OOMKilled` (raise `memory`), sustained CPU throttling or slow responses (raise `cpu`), a cold
  start failing the readiness probe — one step at a time:

  | App shape                                    | Starting point                                                       |
  | -------------------------------------------- | -------------------------------------------------------------------- |
  | Static / mostly client UI                    | omit `compute:` (or `cpu: 25m` / `memory: 128Mi` if you must set it) |
  | Typical API + light DB                       | omit `compute:`                                                      |
  | Heavier server work (PDF, scraping, fan-out) | `cpu: 100m–250m` / `memory: 256Mi–512Mi`                             |

  Any value within the cap always deploys; a value above it is rejected at PR time
  (`POLICY_VIOLATION`, `workload-compute-limit`), never at runtime. Full reference:
  [docs/34 § compute](https://github.com/ShiftEngineering/greenlight/blob/main/docs/34-workloads.md).

- **Runtime security posture:** the namespace enforces Pod Security Admission `baseline` with
  `restricted` warnings/audits. Pods run with user namespaces (`hostUsers: false`),
  `seccompProfile: RuntimeDefault`, `allowPrivilegeEscalation: false`, and
  `capabilities.drop: ["ALL"]`. Greenlight does **not** set `runAsNonRoot` or
  `readOnlyRootFilesystem`.
- **Root images are accepted, but root is not privileged.** Container-root maps to an unprivileged
  host UID, no-new-privileges is set, capabilities are dropped. Startup code must not rely on
  privileged `chown`/`chmod`, setuid/setgid helpers, `sudo`, `gosu`, DAC bypass, or changing
  root-owned runtime paths.
- **The container filesystem is writable**, but write runtime state to `/tmp` or app-owned paths.
  `/tmp` is a small (64 MiB) in-memory tmpfs — it counts against pod memory and is wiped on
  restart. All filesystem writes are ephemeral; durable state belongs in a declared resource
  (postgres/blob). Avoid images that mutate root-owned paths (`/var/cache`, `/var/run`, `/run`,
  `/var/log`, `/etc`) during startup.
- **Prefer container-ready image variants.** For nginx/static serving, prefer
  `nginxinc/nginx-unprivileged` or point `pid` and `*_temp_path` at `/tmp`; stock nginx can
  schedule and still crash when its entrypoint tries to `chown` cache/log/pid paths after
  capabilities are dropped.
- Implement **`GET /healthz`** returning `200` with a small body (`{"status":"ok"}`) when ready.
  K8s liveness/readiness probes hit it; it is the one unauthenticated route.
- Do not implement authentication — SSO is enforced at the ingress for every route but `/healthz`.
  Your app still **receives** the signed-in user's identity on every request — see _Knowing who the
  signed-in user is_. Do not bundle a `.env` file or any credential.
- **Encouraged, but optional: a dashboard icon.** Make a simple, tasteful, unique icon for the app
  and commit it as `.greenlight/icon.svg` so the `/apps` dashboard tile shows it instead of the
  generated monogram — a **square** SVG, at least **120×120** logical size (square `viewBox` or
  square `width`/`height`), with **no** `<script>`, event-handler attributes, `<foreignObject>`, or
  external/remote references (no `http(s)`/`//` `href` or `url()`). Greenlight validates and
  normalizes it at deploy. Omitting the file is normal (the monogram stays); an invalid file is
  ignored and never fails the deploy. Prefer SVG (you can author it deterministically as text);
  raster icons are not read at MVP.

## Reaching company data

A granted integration reaches its upstream one of two ways, set per-integration by its
`delivery_mode` (read it from `getApp` / integration Knowledge — it is not in the manifest):

- **Proxied** (the default): call the Greenlight proxy, never the upstream directly. Base URL from
  `process.env.GREENLIGHT_PROXY_URL` (never hardcode it); path
  `${GREENLIGHT_PROXY_URL}/<integration>/...`. Put `process.env.GREENLIGHT_DATA_KEY` in the same
  auth slot the upstream normally uses (`Authorization: Bearer`, `X-Api-Key`, `?apikey=`, or the
  secret side of a multi-header/basic shape — read the provider instructions from integration
  Knowledge / `getApp`). The proxy validates that key, swaps in the real credential in the same
  slot, and audits the call — the app never holds the upstream credential. A connected database is
  also proxied but is not an HTTP upstream; read the bundled
  [connected-databases skill](../connected-databases/SKILL.md) before using one.
- **Injected**: the bound credential is injected into the pod under the integration's fixed
  env-var name (shown by `getApp`). Read it from `process.env` and call the upstream with it.

Either way, never hardcode or commit a credential. For user-delegated (always proxied)
integrations, forward the inbound `X-Greenlight-Actor-Token` request header to the proxy
unchanged — never inspect, log, or store it; it is an opaque token the proxy exchanges for a
user-scoped upstream credential.

### Connected databases

Before discovering a schema, writing a query, or handling a connected-database error, read the
bundled [connected-databases skill](../connected-databases/SKILL.md) in full. It owns the Azure SQL
query route, parameterization, result limits and conversion, session isolation, paging, write
ambiguity, and retry contract. Keep following this core skill for the surrounding Greenlight grant,
Knowledge, local-development, delivery, and verification workflow.

_Which_ integrations exist and each one's delivery mode is customer-specific —
`listGrantableIntegrations` enumerates them (with `delivery_mode` and `env_var_name` per
integration). _How_ to query a given upstream is best read from integration Knowledge — but that
entry frequently won't exist. When it's absent, read the provider's own public API docs or SDK
source to work out endpoints, params, and the auth slot yourself, confirm it against a real call,
and then `knowledgePropose` an integration-scope entry so the next agent doesn't repeat the dig
(see _Starting from an idea_). Never fall back to hardcoded assumptions baked into this file.

## Knowing who the signed-in user is (the `X-User-*` headers)

SSO runs at the edge, so your app never implements login — but it is **not** blind to who the user
is. On every authenticated request to the pod, Greenlight injects the caller's identity as request
headers; no app code triggers this:

- **`X-User-Id`** — the Greenlight user UUID. Stable per user; the key for anything per-user
  (settings, preferences, drafts, "my items").
- **`X-User-Email`** — for display, notifications, attribution.
- **`X-User-Name`** — display name (may be empty — fall back to the email).

This gives you per-user features for free — no login code, no session store.

**Trust rule (security-critical).** These headers are authoritative **because** Greenlight injects
them at the edge after `/auth/check`: Traefik strips any client-supplied `X-User-*` and overwrites
them with verified values, so an end user **cannot** spoof identity by sending them. Trust them,
and don't roll your own login beside them.

Read the headers case-insensitively (`x-user-email`, etc.). In a local dev loop there is no edge,
so they're absent — read the real headers in production and fall back behind a
`NODE_ENV === 'development'` check to a dev identity (Greenlight injects `DEV_USER_EMAIL` for
exactly this). `getAppPreviewUrl` signs you in as yourself, so the deployed app sees _your_
`X-User-*` — use it to verify per-user behavior end to end.

## Source control goes through Greenlight

These are **agent-internal mechanics** — never surfaced to the citizen developer. Use git for the
parts git owns — clone, branch, commit, push your feature branch — authenticated with the
short-lived token from `getRepoAccess({ app_id })`. **Don't reach for the `gh` CLI or the GitHub
API:** your session usually isn't logged into them, so they fail and waste a turn — and the
governed change request (opening and merging the PR) goes through MCP regardless.

For a plain clone, `greenlight repo clone --app <id> [--dir <dir>]` does it in one step with a
freshly minted token (never printed). For branch/commit/push work, `getRepoAccess({ app_id })`
returns a ready-to-run `clone_command` and `authenticated_clone_url`, plus the raw `token` and a
token-less `clone_url`. The token is a GitHub App installation token — it goes in the URL as the
`x-access-token` user, not a header or bare password:

```bash
git clone https://x-access-token:<token>@<host>/<owner>/<repo>.git
# Existing checkout — repoint origin, then pull/push:
git -C <dir> remote set-url origin https://x-access-token:<token>@<host>/<owner>/<repo>.git
git -C <dir> push origin <branch>
```

Refresh the token if your session runs past its `expires_at` (~1 hour): `greenlight repo refresh
--app <id> [--dir <dir>]` mints a fresh one and re-points `origin` on the existing checkout in a
single step (token never printed), or call `getRepoAccess` again and re-run the `remote set-url`
yourself. The governed change request then goes through MCP:

- **Open** with `createPullRequest` **after your feature branch is pushed** — an unpushed branch
  has no commits to propose. Pass `app_id` and the head branch; Greenlight resolves the repo.
- **Merge** with `mergePullRequest` only after you have observed a passing pipeline for the exact
  head SHA. Direct pushes to `main` are blocked by branch protection.

Do **not** use `gh`, the GitHub API, or any other path to open or merge a PR — the change must flow
through Greenlight so it is audited and policy-gated.

## Recovering from a pipeline failure

The pipeline is your feedback loop; fix and re-push autonomously. Never ask the citizen developer
whether you should investigate, and never tell them to check GitHub, read a pipeline page, or
interpret scanner output — at most, say "hit a snag publishing; fixing it now."

1. `getPipelineRun({ app_id, pull_request_number, wait: true })` — or `greenlight pipeline --app <id>
--pr <n> --wait` — long-polls server-side and returns a terminal `passed`/`failed`, or
   `running`/`deploying` with `retry_after_seconds` (call again). Do not busy-wait client-side.
2. On `failed`: `getPipelineRun({ app_id, run_id, detail: 'full' })` returns every check with its
   `error_summary`, `suggested_fix`, and `details[]` (`file`, `line`, `rule`, `severity`), plus the
   failing check's raw log tail.
3. Fix the flagged file at the flagged line, commit, and push — the pipeline reruns automatically.
4. Repeat until the PR head passes, then merge and wait on the merge SHA's deploy run.

## Verifying a deployed app

**Verify after every change and every deploy — mandatory, not a nicety.** Before you tell the
citizen developer anything is ready, prove the _specific thing they asked for_ works. "The pipeline
passed" and "the page loads" are **not** "it works", and "here's the URL" is no substitute for
having tried it. Reproduce the request end-to-end yourself — submit the form, call the endpoint,
walk the flow — and confirm the result is what they asked for.

**Be relentlessly proactive.** Drive verification yourself; never hand the app to the citizen
developer to test for you, and never report success you have not observed. If anything is wrong or
missing, fix it, redeploy, and verify again — loop until the requested behavior genuinely works.

Use these tools together:

- **`curlApp({ app_id, path, method?, headers?, body?, follow_redirects? })` — or `greenlight curl
--app <id> --path <p>` — the default response-level check.** It makes an authenticated request
  to the deployed app as you and returns status, headers, body, timing, and whether the request
  reached the app. Use it to assert the exact API or server behavior requested; request headers and
  bodies on the CLI come from `--headers-file` / stdin / `--body-file`, never argv. Platform admins
  may use `as_user` / `--as-user` to reproduce another same-org user's view; the selected user must
  still have access to the app. On `app.unreachable`, inspect `details.hit_app`, then call
  `getAppDiagnostics` and `getLogs` before retrying; other roles must not impersonate.
- **`getAppPreviewUrl({ app_id, path? })` — or `greenlight preview --app <id> [--path <p>]` — for
  browser behavior.** Mints a one-time URL you open in your own browser tool (IDE
  preview pane, Playwright, any headless browser). It signs you in through the SSO boundary with no
  interactive IdP login — the session is _you_, with your real identity and access — so you can
  render the page, run its client-side JS, click through the exact flow, and screenshot it. Single
  use, 5-minute expiry, confined to that one app's host: mint a fresh URL per browser context, and
  never share one. **When no browser tool exists in your environment** (remote or headless CLI
  setups),
  drive it with the Playwright CLI and headless Chromium instead: mint a fresh URL, run
  `playwright screenshot --browser chromium --full-page "<preview-url>" page.png`, and read the
  image — script clicks and typing through the `playwright` Node API when a flow needs interaction.
  Playwright completes the one-time token → session-cookie exchange. Do not give a preview URL to
  curl, a plain HTTP fetch, or a WebFetch-style tool: it drops the cookie, lands on the SSO login
  page, and burns the token. Use `curlApp` for response-level checks; if a non-browser tool touches
  a preview URL, mint a new one.
- `getLogs({ app_id, since?, filter? })` — bounded pod stdout/stderr with crash-loop context. Apps
  must log handler errors for this to help: a 500 that only returns JSON to the client leaves
  nothing in the pod log.
- `getApp({ app_id })` — deployed state, grant/resource status, latest pipeline result.
- `getMetrics({ app_id })` — recent CPU, memory, restart counts to spot resource pressure.

Verifying is for _you_; putting the result in front of the citizen developer is the separate,
equally required step — see _Show your work_.

## Sharing apps and working on a teammate's app

Owners and co-owners add or remove a co-owner by email: `addCoOwner` / `removeCoOwner`
(`{ app_id, user_email, reason }`), or `greenlight share` / `unshare` (`--app --email --reason`).
To work on a colleague's app, use `listApps({ slug })` only if the caller already has access;
otherwise the owner must share first. Once shared, pair the CLI and use `greenlight run` for the
local loop.

## Reporting platform friction (for the Greenlight team, not the user)

You are the best-placed observer of where Greenlight itself slows you down. When something about
the **platform** — not the app you're building — costs you turns or would trip up the next agent,
file a short report with `submitFeedback` (or `greenlight feedback`). It goes to the Greenlight
platform developers who build this system; it is **not** customer IT support and **not** a channel
to the citizen developer.

**File one when:**

- You hit a real platform bug — a tool returns the wrong thing, an error is misleading, a documented
  flow doesn't work.
- Friction cost you noticeable time and will recur for the next agent — a confusing tool choice, an
  auth dead end, an unhelpful pipeline/deploy error, post-merge branch confusion, a Windows/setup gap.
- You have a concrete improvement idea — "mention X in section Z of the skill", "return Y from
  `getApp` so I don't need a second call".

**Don't file for:** user-caused issues (they asked for something odd), or bugs in the app _you_
wrote — those are yours to fix, not platform feedback.

**How:** one consolidated report at a natural pause (after you've worked around it), not a stream of
micro-reports. Pick a `category` (`bug` / `friction` / `suggestion` / `other`), a one-line `title`,
and a concise Markdown body — aim for ≤ ~40 lines:

```
Context: what you were doing (register / grant / deploy / local run …).
What happened: the behaviour, with any error `code`s and `request_id`s from the error envelope
  (they let the team correlate to the audit log server-side).
What you tried / how it resolved (or didn't).
Suggested fix: the concrete change that would have prevented it.
```

The CLI twin takes the body on **stdin or `--body-file`**, never as an argv flag:
`greenlight feedback --category friction --title "…" --body-file report.md`.

**Never include** secrets, env values, tokens, credentials, or verbatim sensitive conversation
content — **summarize** the platform interaction, describe _what you were trying to do_, not the
business data. Include `request_id`s, not payloads.

**Voice rule — this is plumbing.** Reporting is invisible to the citizen developer: never mention it,
never ask permission to file, and treat it as fire-and-forget — if the call fails, drop it silently
and keep going. It must never block or delay the user's actual task. (The dashboard has its own
"Send feedback" form for humans; that's separate — you use the tool.)

## Scope

This skill covers Greenlight-governed app work only. Defer everything else to your other tools:
general coding questions, apps Greenlight does not manage, and anything that wants to reach GitHub,
a cloud console, or a data provider directly — Greenlight is the path for all three.
