<sub>[revue](../README.md) · docs · **Learning**</sub>

# Learning loop

> How a single edit to a drafted comment becomes a durable lesson for every future review.

The pipeline is prompt-driven, so it learns the way the prompts do: by growing
a preference file that feeds back into future reviews. When you change a
drafted comment, the daemon captures the delta and distills a durable lesson
into `preferences/learnings.md`, which is injected into the finder, drafting,
and chat prompts on the next run.

This is the refinement half of a pair: the [style bootstrap](STYLE.md) seeds
`voice.md`/`priorities.md` from your public GitHub comments; corrections then
sharpen the behavior review by review.

## What counts as a correction

Every pipeline comment carries `originalBody` — the exact text the drafting
stage produced. A correction is any later change to that body:

- editing the comment inline in the panel, or
- applying a revision the per-comment chat proposed (both land as a
  `PATCH /reviews/:id/comments/:cid` with a new `body`).

Manual comments (which have no `originalBody`) and no-op edits are ignored.

## How it distills

On a qualifying edit the daemon fires `LearnService.onCorrection`
(fire-and-forget; it never blocks or fails the edit). It sends the chat model
the current `learnings.md`, the original vs. final wording, and the last few
chat turns, and asks for the whole file back with at most one concise, general
lesson merged in — a tone, structure, severity, scope, or false-positive rule,
never a one-off wording tweak or a reference to the specific PR. The agent owns
dedup and merging so the file stays short; an empty or truncated reply leaves
the file unchanged.

`preferences/learnings.md` is read through the same cache-busting reader as the
other preference files (`server/src/config.ts`), so a saved lesson applies to
the next review and chat with no restart.

## Staying in control

- The file is plain markdown you can edit or prune by hand, or from the control
  page's "Learned corrections" box (see [CONTROL.md](CONTROL.md)).
- Distillation uses `models.chat`; on a rate-limited subscription it simply
  logs a failure and moves on.
- Because lessons flow into the finder and drafting prompts, a bad lesson
  affects future reviews — review the file periodically and delete anything
  that overfits.

Implementation: `server/src/learn/{service,prompts}.ts`, wired from the
`PATCH` comment route in `server/src/routes.ts`.

---

<sub>**revue docs** · [Architecture](ARCHITECTURE.md) · [Pipeline](PIPELINE.md) · [Extension](EXTENSION.md) · [API](API.md) · [Control](CONTROL.md) · [Learning](LEARNING.md) · [Style](STYLE.md) · [README](../README.md)</sub>
