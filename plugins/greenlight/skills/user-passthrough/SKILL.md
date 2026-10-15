---
name: user-passthrough
description: Builds app features that act as the signed-in person in another system through Greenlight's user passthrough integrations (Microsoft Graph, Microsoft Fabric, Power BI semantic models, Box and others with auth_category user-delegated). Use when a Greenlight-governed app reads or writes a person's own mail, files, calendar, workspace or warehouse data, handles 401 proxy.user_connection_required or a connect_url, shows a Connect button, or decides between acting as the person and acting as the app.
---

# User passthrough

Read the core [Greenlight skill](../greenlight/SKILL.md) in full before acting. Follow its
authorization, Knowledge, local-development, delivery, and user-communication rules, and its
"Preserve user attribution" section on forwarding the actor token. This skill owns the contract for
integrations that act as the person using the app.

## What these integrations are

Some integrations reach the upstream **as the person using the app** rather than as a shared
service identity, so the upstream sees that person and applies their own permissions:

- **Microsoft Graph** — mail, calendar, files and directory as the person.
- **Microsoft Fabric** — the REST API and the API for GraphQL under the person's workspace role.
- **Power BI semantic models** — DAX with the model's row-level security.
- **Box** — files and folders the person can open, with no connect step.
- **Any other per-user OAuth integration** IT registers, including a custom one.
- **A Fabric Warehouse connected database** — SQL as the person; the
  [connected-databases skill](../connected-databases/SKILL.md) covers its `/query` route.

`listGrantableIntegrations` shows the HTTP ones with `auth_category: user-delegated`; a Fabric
Warehouse lists as `auth_category: connected-database`. Each one's `usage_note` says it acts as
the signed-in user, then gives that upstream's own paths, paging, limits and errors. Read it before
writing calls.

## Rules, in order

1. **Implement no OAuth.** No redirect, no callback, no consent screen, no token storage.
   Greenlight hosts the connect flow at the `connect_url` its errors carry, stores each person's
   token, and refreshes it. The app's only job is to show a Connect button when a call says the
   person has not connected.
2. **Send the data key and the actor token exactly as received** on every proxy call made while
   serving a user request: `Authorization: Bearer $GREENLIGHT_DATA_KEY` plus the forwarded
   `X-Greenlight-Actor-Token`. The proxy swaps them for that person's own upstream token.
3. **Call the proxy as you would call the upstream** — same paths and bodies, under
   `${GREENLIGHT_PROXY_URL}/<integration>/…`. **Rewrite absolute paging links** onto the proxy
   base URL; following one directly leaves the proxy and fails with no token. A `429` arrives with
   `Retry-After`: wait that long and retry, because the proxy does not retry for you. A download
   that answers `302` to a short-lived pre-authenticated URL is followed without a token.
4. **Never lock the person out: a Connect button, never a redirect.** The app always renders.
   `401 proxy.user_connection_required` means the person has not connected this integration, or
   their stored token stopped working; `details.connect_url` is the link. Show it as a
   **Connect <integration>** button where the feature lives and keep the rest of the page working.
   **Never open `connect_url` without the person clicking** — not on page load, not from an error
   handler, not from a script that navigates — and never retry with another identity. The link
   opens a Greenlight page that explains the connection and goes on to the upstream only when they
   click there; afterwards it returns them to the app's home page, or to the page they were on when
   you set `return_to` to that page's absolute URL. `403 proxy.upstream_user_unmapped` means the
   upstream has no account for the person: show `next_steps` with no button, since only IT can fix
   it.
5. **What you read as one person, you show only to that person.** Key any cache or table you fill
   from these calls by the `X-User-Id` the rows were read as, never pool several people's results,
   and never answer one person's request with rows read as another. Work for a group runs once per
   person, as each of them; a view across people needs a service-identity integration IT granted
   for that purpose.
6. **The actor token is read from the request and never stored, queued, or reused.**
7. **No background work.** These integrations refuse any call with no present person, so
   scheduled, queued, or startup work cannot use them. Work that must run with nobody signed in
   binds a separate service-identity credential and grant.
8. **Locally, the developer is the person.** `greenlight run` (either mode) and
   `inspectIntegrationApi` call these integrations as the developer, with real effects: a local
   send-mail sends from their own mailbox. No actor token exists or is needed locally. The first
   time, `greenlight run` prints a connect link per integration and starts anyway; ask the
   developer to open it, then retry, with no restart. Until they do, every proxied call answers
   `401 proxy.user_connection_required`, so a local run is also where you see your Connect button.
   Use fixtures when real effects are unwanted.

## The Connect button

Every app built on these integrations handles the same four outcomes the same way. Build one small
server-side helper that makes the proxied call and classifies the answer, and one front-end state
per outcome. [`connect.ts`](./connect.ts) is a worked example in TypeScript: copy it into a
TypeScript or JavaScript app, or port it to the app's language — it is one HTTP call and the
classification below, with no dependencies. If you fetched this skill through `getBuilderSkill` /
`greenlight skill show` and the file is not beside the markdown, read it from the installed plugin
at `skills/user-passthrough/connect.ts`.

| Proxy answer                                                                | Outcome         | What the page shows                                                                                         |
| --------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------- |
| 2xx                                                                         | `ok`            | The feature.                                                                                                |
| `401` with `code: proxy.user_connection_required` and `details.connect_url` | `not_connected` | A **Connect <integration>** button: a plain link to `connect_url` with `return_to` set to the current page. |
| `403` with `code: proxy.upstream_user_unmapped`                             | `unavailable`   | The error's `next_steps`, and no button.                                                                    |
| Anything else                                                               | `failed`        | "<App> can't reach <integration> right now." and a **Retry** that repeats the call.                         |

The helper runs on the server, because the data key must never reach a browser; the page asks the
app's own backend and renders the outcome it returns. Two details make the button behave well:

- **Remember the click.** When the person clicks Connect, note it in the browser (session storage
  is enough). If they come back and the next call is still `not_connected`, say "<App> can't
  connect to <integration>. You can keep using the rest of the app; contact IT if this keeps
  happening." and offer **Try again** with the same link. Greenlight's own pages already explain
  anything that went wrong at the upstream, so the app never needs the reason.
- **Show the error's words, not its body.** Never render a raw JSON error to the person.

A front-end sketch, in React here but the same in any framework or server-rendered template:

```tsx
function Inbox({ result }: { result: PassthroughOutcome<Mail[]> }) {
  if (result.kind === 'ok') return <MailList items={result.body} />;
  if (result.kind === 'unavailable') return <Notice>{result.message}</Notice>;
  if (result.kind === 'failed')
    return (
      <Notice>
        {result.message} <RetryButton />
      </Notice>
    );
  const key = `connect:${result.integration}`;
  const tried = sessionStorage.getItem(key) === '1';
  return (
    <Notice>
      {tried
        ? `This app can't connect to ${result.integration}. You can keep using the rest of the app; contact IT if this keeps happening.`
        : `Connect ${result.integration} to see your inbox here.`}
      <a href={result.connectUrl} onClick={() => sessionStorage.setItem(key, '1')}>
        {tried ? 'Try again' : `Connect ${result.integration}`}
      </a>
    </Notice>
  );
}
```
