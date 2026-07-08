<sub>[revue](../README.md) · docs · **API**</sub>

# Daemon HTTP API

> The local daemon's HTTP + SSE surface: auth, endpoints, and the error contract.

Base URL: `http://127.0.0.1:{port}` (default 7388). All payload types are
defined in `shared/src/types.ts` — this document maps endpoints to those
types; the types file is authoritative for field shapes.

## Auth

On first start the daemon generates a 32-byte hex secret at
`${dataDir}/secret` and logs it. Every request **except `GET /health`** must
carry it:

- Header `X-Revue-Token: <secret>` — used by all fetch calls, or
- Query param `?token=<secret>` — accepted for the SSE endpoint.

Missing/wrong token → `401 {"error": "unauthorized"}`.

CORS: requests come from the extension's service worker (extension origin or
no origin). The daemon replies to preflights with
`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers:
Content-Type, X-Revue-Token`, `Access-Control-Allow-Methods: GET, POST,
PATCH, DELETE`. The token is the actual access control.

## Errors

Non-2xx responses are `{"error": string}`. 404 for unknown review/comment
ids, 400 for malformed bodies (zod-validated), 409 for state conflicts
(chatting while the pipeline is still running), 502 when a pending-review
sync against GitHub fails (the local draft is left unchanged), 500 with the
message for unexpected failures.

## Endpoints

### `GET /health` → `HealthResponse`
No auth. `ghUser` is resolved lazily and may be absent if `gh` is not
authenticated. `mock` reflects mock mode.

### `POST /reviews` — body `CreateReviewRequest` → `202 ReviewDraft`
Idempotent per PR: if a draft exists for `${owner}__${repo}__${number}` and
`force` is not set, returns the existing draft (200). Otherwise (or with
`force: true`) resets the draft and starts the pipeline **asynchronously**,
returning the initial draft immediately (202) — progress arrives over SSE.
`force` preserves nothing (fresh run); the previous file is overwritten, and
comments the old draft had synced into the pending GitHub review are
retracted first (best-effort). Optional `focus` (free text, ≤4000 chars) is
stored on the draft and steers the run: it lands in the shared prompt
preamble as a "Reviewer focus" section that weights triage, finders, and the
draft stage without forbidding serious findings outside it.

### `GET /reviews?owner=&repo=&number=` → `ReviewDraft` | 404
Lookup by PR.

### `GET /reviews/:id` → `ReviewDraft`

### `GET /reviews/:id/events` — SSE stream of `RevueEvent`
`Content-Type: text/event-stream`. Each event is written as
`data: <JSON RevueEvent>\n\n` (no named events; heartbeat comment `:hb`
every 25s). On connect, the daemon immediately sends a
`{type: 'review', draft}` snapshot so late subscribers converge, then live
events. Auth via `?token=` (EventSource/fetch from the SW can't set headers
on all paths).

### `PATCH /reviews/:id` — body `PatchReviewRequest` → `ReviewDraft`
Edits the summary. The summary doubles as the pending GitHub review's body:
when a pending review exists it is re-resolved and its body rewritten first;
a sync failure is a 502 and the local summary stays unchanged. Emits
`{type: 'review'}`.

### `PATCH /reviews/:id/comments/:cid` — body `PatchCommentRequest` → `DraftComment`
Edit body / severity / status (accept, discard, un-discard). Status
transitions mirror into the viewer's **pending GitHub review** (see "Pending
review" below): entering `accepted` pushes the comment, leaving `accepted`
retracts it, editing an accepted body rewrites it on GitHub. GitHub goes
first; on failure the draft is untouched and the response is a 502. Emits
`{type: 'comment'}`.

### `POST /reviews/:id/comments/:cid/chat` — body `ChatRequest` → `ChatResponse`
Runs one turn of the comment's chat session (see docs/PIPELINE.md §Chat).
Assistant text streams as `{type: 'chat-delta'}` events on the review's SSE
stream while the request is in flight; the request resolves with the final
`ChatResponse` and a `{type: 'chat-done'}` event is emitted. 409 while the
pipeline is running. Concurrent chats on different comments are allowed
(subject to `maxParallel`).

## Pending review

There is no publish endpoint: accepting a comment immediately places it in
the viewer's **pending review** on GitHub, and the review is submitted from
GitHub's own "Finish your review" dialog (verdict and final body are chosen
there; the pending body is pre-seeded with the draft summary).

Mechanics (`server/src/sync.ts` over the GraphQL ops in
`server/src/github/pending.ts`; all require an authenticated token):

- First accept resolves the viewer's pending review on the PR — reusing one
  started on GitHub — or creates it (`addPullRequestReview`), then adds the
  comment as a thread (`addPullRequestReviewThread`). The review node id is
  cached on `draft.pendingReviewId`, the comment node id on
  `comment.pendingCommentId`.
- A cached review id that went stale (submitted or discarded on GitHub) is
  re-resolved once and the push retried.
- Retract/update never touch a comment whose state on GitHub is no longer
  `PENDING`: a submitted comment is left alone (retract just severs the
  local link; update fails with a 502 naming the reason).
- GitHub validates anchors on push, so a bad anchor surfaces as the 502
  error on accept — there is no separate dry-run validation step.

### Style bootstrap (see docs/STYLE.md)

All exchange `StyleBootstrapState`, a status-discriminated union
(`idle` | `running` | `ready` | `error`).

- `GET /style/bootstrap` — current state; the control page polls this while
  a run is in flight (`running` carries `progress`).
- `POST /style/bootstrap` → `202 StyleBootstrapState` — starts the scan and
  analysis asynchronously. 409 while a run is already in flight; posting over
  a `ready`/`error` state starts a fresh run.
- `POST /style/bootstrap/apply` — body `ApplyStyleRequest` (optional
  `voiceMd`/`prioritiesMd` overriding the stored proposal) → the `ready`
  state with `appliedAt` set. Writes the preference files. 409 unless
  `ready`.
- `DELETE /style/bootstrap` → `{status: 'idle'}`. 409 while running.

---

<sub>**revue docs** · [Architecture](ARCHITECTURE.md) · [Pipeline](PIPELINE.md) · [Extension](EXTENSION.md) · [API](API.md) · [Control](CONTROL.md) · [Learning](LEARNING.md) · [Style](STYLE.md) · [README](../README.md)</sub>
