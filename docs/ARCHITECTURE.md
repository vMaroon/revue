<sub>[revue](../README.md) · docs · **Architecture**</sub>

# Architecture

> Two processes, one shared type package — and the reasons each decision went the way it did.

Two processes, one shared type package:

- **Daemon** (`server/`, Express + tsx): state, pipeline, chats, GitHub.
- **Extension** (`extension/`, MV3): rendering and interaction on github.com.
- **`@revue/shared`**: every wire shape both sides touch. If a change isn't
  expressible in `shared/src/types.ts`, it isn't on the wire.

```
┌────────────────────────┐   HTTP + SSE   ┌──────────────────────────────┐
│ Chrome extension (MV3) │ <────────────> │ local daemon (localhost:7388)│
│ overlay on github.com  │                │ pipeline · chats · sync      │
└────────────────────────┘                └──────────┬───────────────────┘
                                                     │ Claude Agent SDK (your claude login)
                                                     │ GitHub REST + GraphQL (your gh token)
                                                     ▼
                                       ~/.revue/  drafts · repo workdirs
```

Module contracts: `server/src/interfaces.ts` and
`extension/src/lib/contract.ts`. Behavior specs: `docs/API.md`,
`docs/PIPELINE.md`, `docs/EXTENSION.md`.

## Decisions and why

**Extension overlay + local daemon, not a standalone web app.** The review
happens where reviews are read — on the PR itself, with GitHub's own diff
rendering. The daemon exists because the browser can't run the Agent SDK,
hold long-lived sessions, or keep repo checkouts; the extension stays a thin
view over daemon state.

**Draft state lives in the daemon; accepted comments live on GitHub.**
GitHub's pending reviews can't host per-comment AI chats, provenance, or
verification metadata, so the draft — proposals, chats, evidence — stays
local. Accepting a comment is the accept-quality gate: it immediately joins
the viewer's pending review on GitHub (created on first accept, reused if
one exists), un-accepting retracts it, and the review is submitted from
GitHub's own "Finish your review" dialog. GitHub goes first on every sync;
the local draft changes only after the write succeeds. Comments already
submitted on GitHub are never edited or deleted from here.

**Agent SDK over raw API.** Pipeline agents need repo tools (Read/Grep/
git-log) to verify claims against actual code, chats need resumable
multi-turn sessions, and the SDK rides the existing Claude Code login.
`server/src/pipeline/agent.ts` is the single SDK touchpoint; everything
else consumes the `AgentInvoker` interface, which is also where mock mode
swaps in.

**Adversarial verification before drafting.** The finder stage is tuned for
recall, which means false positives; a verifier whose only job is to refute
each finding against the checkout kills them before they cost voice-model
tokens or reviewer attention. Dropped findings stay visible in the draft for
trust ("what did it throw away?").

**Anchoring is best-effort, correctness lives server-side.** GitHub's DOM is
unstable; only `extension/src/anchor.ts` knows about it, misses degrade to
panel rendering with the comment's own hunk, and GitHub itself validates the
anchor when an accepted comment is pushed to the pending review — the DOM is
never load-bearing for what gets posted.

**Token-gated localhost daemon.** Any local page can POST to 127.0.0.1;
the shared secret (generated at `${dataDir}/secret`, pasted once into the
extension options) is the access control. CORS is deliberately permissive —
the token is the gate, not the origin.

## Data

```
~/.revue/
  secret                          # shared secret (0600)
  config.json                     # optional; repo-root revue.config.json wins
  reviews/<owner>__<repo>__<n>.json   # one ReviewDraft each
  workdirs/<owner>__<repo>/           # cached clone, detached at PR head
```

Store is in-memory, hydrated from `reviews/` at boot, written through on
every `put`. Single-user local tool: no locking, last write wins.

## Flows

**Run review** — `POST /reviews` → route builds the initial draft from a
fresh `PrSnapshot`, returns it, then fire-and-forgets
`pipeline.run(draft, deps)`; the extension follows along on
`GET /reviews/:id/events` (which always opens with a full `review`
snapshot, so reconnects converge).

**Chat** — `POST .../chat` → `ChatService.send` seeds or resumes the
comment's SDK session; deltas ride the review SSE stream; the POST resolves
with the reply and optional `revisedBody` (extracted from
`<revised-comment>` tags).

**Accept** — `PATCH .../comments/:cid {status: 'accepted'}` → `sync.ts`
resolves or creates the viewer's pending review (GraphQL,
`github/pending.ts`), adds the comment as a thread, and records both node
ids on the draft. Leaving `accepted` retracts; editing an accepted body
rewrites it in place; a stale cached review id is re-resolved once and
retried. The reviewer submits from GitHub, where the pending body arrives
pre-seeded with the draft summary.

**Staleness** — every fresh snapshot compares `headSha` to the draft's;
mismatch sets `draft.stale` (banner in UI). GitHub validates anchors on
every push regardless, so stale drafts fail safe.

## Failure modes

- Daemon down / wrong token → extension shows status on the floating
  button + options hint; page is otherwise untouched.
- Pipeline stage failure → draft `status: 'error'` with message; partial
  results (already-drafted comments) remain usable; Re-run available.
- Finder emits an unanchorable finding → auto-dropped with reason, never
  blocks the run.
- GitHub rejects a pending-review sync (bad anchor, stale review) → 502 with
  the reason, surfaced on the comment card; the local draft is unchanged.
- `gh` missing/unauthenticated → `GITHUB_TOKEN` env fallback; otherwise
  clear startup error (public repos still work unauthenticated for
  fetch/clone, pending-review sync requires the token).

## File ownership (build map)

| Area | Files |
|---|---|
| core daemon | `server/src/{index,app,routes,store,events,config,auth,log,control,sync}.ts` |
| github | `server/src/github/{client,workdir,diff,pending}.ts` |
| pipeline | `server/src/pipeline/{runner,agent,dedupe,schemas}.ts`, `server/src/pipeline/prompts/{preamble,triage,finders,verify,voice,learned}.ts` |
| chat | `server/src/chat/{service,prompts}.ts` |
| learning | `server/src/learn/{service,prompts}.ts` |
| style bootstrap | `server/src/style/{service,corpus,prompts}.ts`, `server/src/github/comments.ts` |
| ext core | `extension/src/{background,content,daemon,anchor,options}.ts`, `extension/options.html` |
| ext ui | `extension/src/ui/{panel,card,chat,hunk,styles}.ts` |

---

<sub>**revue docs** · [Architecture](ARCHITECTURE.md) · [Pipeline](PIPELINE.md) · [Extension](EXTENSION.md) · [API](API.md) · [Control](CONTROL.md) · [Learning](LEARNING.md) · [Style](STYLE.md) · [README](../README.md)</sub>
