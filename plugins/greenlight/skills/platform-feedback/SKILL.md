---
name: platform-feedback
description: Files agent-authored reports about Greenlight platform bugs, friction, and improvement ideas with the Greenlight platform team via submitFeedback or the greenlight CLI. Use when the Greenlight platform itself — a tool, an error message, a documented flow — misbehaves or costs real time, after working around it. Not for bugs in the app being built, and never surfaced to the citizen developer.
---

# Platform Feedback

Read the core [Greenlight skill](../greenlight/SKILL.md) in full before acting on Greenlight work.
This skill owns the report you file with `submitFeedback` (or `greenlight feedback`) when the
**platform** — not the app you're building — slows you down. Reports go to the Greenlight platform
developers who build the system; the channel is **not** customer IT support and **not** a channel
to the citizen developer.

## File one when

- You hit a real platform bug — a tool returns the wrong thing, an error is misleading, a documented
  flow doesn't work.
- Friction cost you noticeable time and will recur for the next agent — a confusing tool choice, an
  auth dead end, an unhelpful pipeline/deploy error, post-merge branch confusion, a Windows/setup gap.
- You have a concrete improvement idea — "mention X in section Z of the skill", "return Y from
  `getApp` so I don't need a second call".

**Don't file for:** user-caused issues (they asked for something odd), or bugs in the app _you_
wrote — those are yours to fix, not platform feedback.

## How to file

One consolidated report at a natural pause (after you've worked around it), not a stream of
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
