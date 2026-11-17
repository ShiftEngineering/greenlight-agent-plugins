---
name: app-roles
description: >-
  Builds app features that some people can use and others cannot, with roles the
  app declares in greenlight.yml and Greenlight assigns to people and groups.
  Use when the citizen developer describes approvers, admins, editors, managers,
  a pilot or beta group, or "only X can do Y"; when an app declares roles:,
  reads X-User-Roles or DEV_USER_ROLES, assigns holders with appRoleAssign, or
  still compares group names in its code.
---

# App roles

Read the core [Greenlight skill](../greenlight/SKILL.md) in full before acting. Follow its
authorization, Knowledge, local-development, delivery, and user-communication rules. This skill
adds the contract for giving some people more than others inside one app.

An app **declares** the roles its code checks, for example `pto_approver`, in `greenlight.yml`.
The app's owner, an editor, or IT **assigns** people, Greenlight groups and registered IdP groups
to each role, usually by asking you. Every allowed request to the app then carries
**`X-User-Roles`**, the roles the signed-in person holds on this app. Your code checks
`pto_approver`, never a group name or an email list. Who holds a role changes within 60 seconds,
with no redeploy.

Roles decide what someone can do once they are in the app. Who can open the app at all is the
app's access list, which roles never change.

## Before the first role: agree the baseline

**First check that roles are on for this install.** `appRolesList({ app_id })`
(`greenlight roles list --app <id>`) answers `enabled: false` while Shift has app roles off. Then
no request carries `X-User-Roles` and assigning holders is refused, so a feature behind a role would
be hidden from everyone. Tell the citizen developer their admin needs to ask Shift to turn app roles on, and ask
whether to wait or to ship the feature to everyone for now. Declarations still merge and are kept
for when roles turn on.

Every app works for a person holding none of its roles. Before you declare the first role, agree
with the citizen developer what that **baseline view** shows: what everyone who can open the app
sees and can do. Ask it as one plain question, for example: "Everyone at the company can open this
app. What should someone who isn't an approver see: just their own requests?" A person with no
roles gets that view, never an error page.

Then ask **which roles they need themselves**. Owners hold no role automatically, so an owner who
must approve PTO is assigned `pto_approver` like anyone else, in the same step as the other
holders.

## Declaring roles

Declare a role for each distinct permission or group-targeted feature the citizen developer
describes:

```yaml
# greenlight.yml
roles:
  - name: pto_approver
    description: Approves and rejects PTO requests for their team
  - name: beta_calendar
    description: Sees the new team calendar before it ships to everyone
```

- **`name`**: lowercase letters, digits and underscores, starting with a letter, at most 48
  characters. At most 32 roles per app.
- **`description`**: 1 to 200 characters, written for a non-engineer. It is what the person
  assigning the role reads, so say what holding it lets someone do.
- **A switch that is on or off for everyone is an env var, not a role.** A role is for a feature
  that some people get and others do not.

**Roles only add.** A person holds every role assigned to them directly or through a group, so
they can hold several or none. Declare no role that is the opposite of another: a `non_management`
beside `management` leaves people who hold neither and people who hold both. Declare `management`
and give everyone else the baseline. Someone with two roles sees both sets of screens in one app,
with nothing to switch. Where two roles grant different things, check each permission on its own
rather than ranking roles.

## Checking roles in code

Read the header as a set. Split on commas and drop empty values, because splitting an empty header
gives one empty string. A missing header means no roles:

```ts
function userRoles(req: { headers: Record<string, string | string[] | undefined> }): Set<string> {
  const raw =
    process.env.NODE_ENV === 'development'
      ? process.env.DEV_USER_ROLES
      : req.headers['x-user-roles'];
  return new Set((typeof raw === 'string' ? raw : '').split(',').filter(Boolean));
}

app.post('/api/requests/:id/approve', async (req, reply) => {
  if (!userRoles(req).has('pto_approver')) return reply.code(403).send();
  // ...approve
});
```

- **Check the role on the server for every action it guards.** Hiding the Approve button is
  presentation. The route that approves checks `pto_approver` too, and so does every route that
  reads data only approvers may see.
- **Trust the header like `X-User-Email`.** The edge strips any value a client sends and sets the
  verified one.
- **Never read identity or roles on `/healthz`.** It is the one path that skips the edge check, so
  its headers are whatever the caller sent.
- **Test each check**: a request with the role succeeds, and one without it, or with no header,
  gets the baseline or a 403.

## Moving an app off group checks

When the app's code compares group names (an `X-User-Groups` header, a hardcoded list of emails or
group ids), declare a role for each group it checked and change every group check to a role check
**in the same change**. Straight after the merge, assign those groups to the roles. Until you do,
the new roles have no holders, so tell the citizen developer that the guarded features are hidden
from everyone for that minute.

## Assigning holders

1. **Find them.** Turn "the People Ops team" or "Priya" into a holder with
   `searchPeopleAndGroups({ app_id, q })` (`greenlight people search <term> --app <id>`), which
   searches people, Greenlight groups and registered IdP groups and needs at least two characters.
   To show the citizen developer the whole menu, page through every group with
   `listPeopleAndGroups({ app_id, kind: 'groups' })` (`greenlight people list --app <id>`). Listing
   every person is open only to IT; anyone else searches for people.
2. **Confirm the matches** with the citizen developer before assigning: "I found the group 'People
   Ops (Entra)' with 14 members. Is that who should approve PTO?"
3. **Assign after the role merges.** A role exists once the merge that declares it deploys;
   assigning before that returns `404 app_role.not_found`. Then call
   `appRoleAssign({ app_id, role, holder })` with `holder` as `{ email }`, `{ group }`,
   `{ idp_group }`, or the `{ user_id }` / `{ idp_group_registration_id }` the search returned
   (`greenlight roles assign <role> --app <id> --email … | --group … | --idp-group …`). Assigning
   twice is harmless. `appRolesList` (`greenlight roles list`) shows every role and its holders,
   and flags a holder who cannot open the app yet.

Until a role has holders, nobody sees the feature it guards. Say so when you report the merge,
and assign in the same turn. If roles are not turned on for the install, assigning returns
`409 app_roles.not_enabled`: tell the citizen developer their admin needs to ask Shift to turn
app roles on, and leave the declarations in place.

**Never rename a role that has holders.** A rename is a removal plus an addition, and the removal
deletes every assignment. Add the new name, assign its holders, then remove the old one in a later
change.

## Show the citizen developer every view

Before you call the work done, show the citizen developer the no-role view and each role's view on
the deployed app, and ask whether each is what they meant. You do not need to hold a role to see
its view:

- Mint `getAppPreviewUrl({ app_id, path, as_roles: [] })` (`greenlight preview --app <id>
--as-roles=`) for the no-role view, then `as_roles: ['pto_approver']`, and so on for each role
  and for any combination the citizen developer cares about.
- **Use one browser.** Open each new preview URL in the same browser as the last. A newer URL
  replaces the preview session and its roles, so you need no fresh browser context between views.
- **Look, don't act.** An action taken in a preview is real: approving a request in the approver
  view approves it.
- `as_roles` changes only your own roles, as yourself. `curlApp` (`greenlight curl --as-roles`)
  takes it too, but never beside `as_user`: that combination is refused, because it would send
  another person's identity with roles they do not hold.

## Local development

`greenlight run --app <id>` injects **`DEV_USER_ROLES`**, your own roles on the app as of the last
merge, in the same comma-separated form as the header (empty when you hold none). It is injected
only for an app whose merged `greenlight.yml` declares a role, and Greenlight's value wins over
`--env`. While app roles are off for the install, nothing is injected. Before the roles first
merge, or in user mode, nothing is injected either, so try a view locally
with `greenlight run --app <id> --env DEV_USER_ROLES=pto_approver -- <cmd>`. After that, preview
the other views on the deployed app with `as_roles`. `DEV_USER_ROLES` is reserved: `envSet`
refuses it.
