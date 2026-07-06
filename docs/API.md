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
(publishing an already-published review, publishing with failing validation,
chatting while the pipeline is still running), 500 with the message for
unexpected failures.

## Endpoints

### `GET /health` → `HealthResponse`
No auth. `ghUser` is resolved lazily and may be absent if `gh` is not
authenticated. `mock` reflects mock mode.

### `POST /reviews` — body `CreateReviewRequest` → `202 ReviewDraft`
Idempotent per PR: if a draft exists for `${owner}__${repo}__${number}` and
`force` is not set, returns the existing draft (200). Otherwise (or with
`force: true`) resets the draft and starts the pipeline **asynchronously**,
returning the initial draft immediately (202) — progress arrives over SSE.
`force` preserves nothing (fresh run); the previous file is overwritten.

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
Edits summary and/or verdict. Emits `{type: 'review'}`.

### `POST /reviews/:id/comments` — body `AddCommentRequest` → `201 DraftComment`
Manual comment: validated against the PR diff (`validateAnchor`); hunk is
attached; `origin: 'manual'`, `status: 'accepted'`. Emits `{type: 'comment'}`.

### `PATCH /reviews/:id/comments/:cid` — body `PatchCommentRequest` → `DraftComment`
Edit body / severity / status (accept, discard, un-discard). Emits
`{type: 'comment'}`.

### `DELETE /reviews/:id/comments/:cid` → 204
Only for `origin: 'manual'` comments (pipeline comments are discarded, not
deleted, so provenance survives). Emits `{type: 'comment-removed'}`.

### `POST /reviews/:id/comments/:cid/chat` — body `ChatRequest` → `ChatResponse`
Runs one turn of the comment's chat session (see docs/PIPELINE.md §Chat).
Assistant text streams as `{type: 'chat-delta'}` events on the review's SSE
stream while the request is in flight; the request resolves with the final
`ChatResponse` and a `{type: 'chat-done'}` event is emitted. 409 while the
pipeline is running. Concurrent chats on different comments are allowed
(subject to `maxParallel`).

### `POST /reviews/:id/publish` — body `PublishRequest`
1. Re-fetches the PR (fresh snapshot; also updates `stale`).
2. Validates every **accepted** comment's anchor against the live diff →
   `PublishValidation`.
3. `dryRun: true` → `200 PublishValidation` (never posts).
4. Otherwise: if validation fails → `409 PublishValidation`. If it passes →
   posts a single review via
   `POST /repos/{owner}/{repo}/pulls/{number}/reviews` with `body` =
   summary, `event` = verdict, `comments` = accepted comments
   (`{path, line, side, start_line?, start_side?, body}`), marks the draft
   and comments `published`, saves, emits `{type: 'review'}`, and returns
   `200 PublishResult`.

A comment whose anchor fails validation blocks publish; the UI offers
discard-or-fix per problem comment (the `problems` array names them).

---

<sub>**revue docs** · [Architecture](ARCHITECTURE.md) · [Pipeline](PIPELINE.md) · [Extension](EXTENSION.md) · [API](API.md) · [Control](CONTROL.md) · [Learning](LEARNING.md) · [README](../README.md)</sub>
