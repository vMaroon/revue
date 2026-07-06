<sub>[revue](../README.md) · docs · **Extension**</sub>

# Extension internals

> How the MV3 extension anchors AI drafts onto GitHub's diff DOM without ever breaking the page.

MV3, vanilla TypeScript, esbuild-bundled. Module contracts:
`extension/src/lib/contract.ts` (authoritative for exported shapes).

## Module map

| File | Owns |
|---|---|
| `src/background.ts` | Daemon HTTP relay + SSE relay (ports), settings access, action-button click → toggle message |
| `src/content.ts` | Bootstrap: detect PR pages (incl. SPA navigation), construct client + anchorer, mount/destroy panel |
| `src/daemon.ts` | `DaemonClient` over `chrome.runtime.sendMessage` / `connect` |
| `src/anchor.ts` | `Anchorer` — all GitHub-DOM knowledge lives here and nowhere else |
| `src/options.ts` + `options.html` | Token + port settings (`chrome.storage.sync`) |
| `src/ui/panel.ts` | `mountPanel` — side panel, floating button, orchestration of cards |
| `src/ui/card.ts` | One comment card (overlay + panel variants) |
| `src/ui/chat.ts` | Chat thread UI inside a card |
| `src/ui/hunk.ts` | Renders a unified-diff hunk string as HTML |
| `src/ui/styles.ts` | All CSS as a template string, injected into the shadow root |

## Networking (background.ts)

Content scripts run with github.com's origin, so all daemon traffic goes
through the service worker:

- One-shot: `BgRequest {kind:'http'}` → fetch
  `http://127.0.0.1:{port}{path}` with `X-Revue-Token` from settings →
  `BgResponse`. Network failure → `{ok:false, error}` with no status;
  daemon 401 → status 401 (content surfaces "unauthorized" state → options
  hint).
- SSE: port named `revue-sse:<reviewId>` → SW fetches
  `/reviews/<id>/events?token=...`, reads the body stream, parses
  `data:` lines, posts `SsePortMessage`s. Port disconnect aborts the fetch;
  fetch end/error posts `sse-status` and disconnects. The client
  (`daemon.ts`) auto-reconnects with backoff while subscribed.

## Page detection and SPA navigation (content.ts)

GitHub is a soft-navigating SPA. The content script loads on all
`github.com` pages and:

- Parses `location.pathname` for `/{owner}/{repo}/pull/{number}` (any PR
  tab; the diff overlay only activates on the files tab, but the panel works
  everywhere).
- Listens for `turbo:load`, `turbo:render`, and `popstate`, and as a
  fallback observes `document.title` changes, re-evaluating the route; on PR
  → PR/other transitions it destroys and re-mounts the panel.

## Anchoring (anchor.ts)

All selectors live behind `Anchorer`. GitHub currently ships two diff DOMs;
try strategies in order per lookup:

1. **Classic**: file containers `div.file[data-details-container-group]`
   with header `[data-path]` / `data-tagsearch-path`; line cells
   `td.blob-num[data-line-number]` (side from `data-split-side` or
   left/right column class in split view; unified view marks context/add
   /del rows). Inject a `<tr class="revue-row"><td colspan="…">` after the
   target row.
2. **React diff view** (`[data-testid="diff-file"]` / virtualized lists):
   locate by `data-path` attributes and row `data-line-number` /
   `data-side`; inject a block element after the row's grid row.
3. **Miss** → return false; the comment stays panel-only (it still renders
   its own `hunk`, so review flow is never blocked). This is the explicit
   degradation mode — anchoring is best-effort by design, and GitHub DOM
   changes must never break the panel.

`observe()`: one debounced (250ms) MutationObserver on the diff container +
turbo events, so cards re-inject after lazy-loaded/expanded diffs render.
Injected elements carry `data-revue-comment-id` so re-anchoring is
idempotent (skip if already present and connected).

## UI (shadow DOM)

Everything renders inside shadow roots (`revue-root` host elements) so
GitHub CSS and ours never interact. No framework — small `h()` helper +
explicit re-render per card/panel section. Distinct accent (violet) so
draft cards are unmistakably *not* real GitHub comments.

- **Floating button** bottom-right on PR pages: Revue mark + status dot
  (daemon ok/down/unauthorized) + draft comment count. Click toggles panel.
- **Panel** (right side, ~380px, resizable is out of scope): sections —
  - header: PR ref, pipeline status/stale banner, **Run review** /
    **Re-run** (confirm re-run: discards pipeline drafts, keeps manual),
  - stage progress list with live detail lines while running,
  - summary editor (textarea, debounced PATCH) + verdict select,
  - comment list grouped by file, ordered blocking → suggestion → nit;
    each row: severity chip, path:line, first line of body, unverified
    badge when `verification.verdict === 'UNCERTAIN'`, dropped-count line
    at the bottom ("pipeline dropped N refuted findings" — expandable),
  - **Publish** button with accepted-count; opens the publish flow.
- **Cards** (overlay under diff rows, and expandable in the panel list):
  severity chip · path:line · anchored/panel-only marker · body (markdown
  rendered minimally: paragraphs, inline code, code fences) · collapsible
  evidence section (claim, consequence, evidence notes, verification
  verdict + notes, dimension, model) · actions: **Edit** (textarea →
  save/cancel) · **Accept** / **Discard** (toggle) · **Chat**.
- **Chat thread** expands inside the card: history, streaming assistant
  text (from `chat-delta` events), quick-action buttons (`QUICK_ACTIONS`),
  input box. When a reply carries `revisedBody`, show a diff-ish preview
  block with **Apply to comment** (PATCH body) / dismiss.
- **Add comment**: per-line "+" affordance on diff row hover where the DOM
  supports it, plus an "Add comment" form in the panel (file dropdown from
  draft's files, line, side) as the always-available path.
- **Publish flow** (modal in the panel): calls dry-run, shows
  `PublishValidation` (count, verdict, summary preview, problems with
  jump-to links), then **Publish to GitHub** → publish, success state links
  to the posted review, cards flip to published styling.

State: the panel holds one `ReviewDraft` and reconciles SSE events into it
(`review` replaces, `comment` upserts, `stage` updates, chat events route to
the open thread). Edits are optimistic with server echo via events.

## Options page

Fields: daemon port, token; **Test connection** button hits `/health` via
the SW and reports version/ghUser/mock. Stored in `chrome.storage.sync`.

---

<sub>**revue docs** · [Architecture](ARCHITECTURE.md) · [Pipeline](PIPELINE.md) · [Extension](EXTENSION.md) · [API](API.md) · [Control](CONTROL.md) · [Learning](LEARNING.md) · [Style](STYLE.md) · [README](../README.md)</sub>
