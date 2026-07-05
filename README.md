# revue

Stage your PR review before it goes public.

revue runs a multi-model agentic pipeline over a GitHub pull request, drafts
review comments in your voice, and overlays them on the actual GitHub PR page.
Every draft comment is editable and has its own Claude chat thread for
converging on substance and wording. Nothing touches GitHub until you click
**Publish**, which posts the whole batch as a single review.

- **Multi-model pipeline** — cheap models triage and scan, strong models verify
  and write; every finding is adversarially verified before it becomes a
  comment. ([docs/PIPELINE.md](docs/PIPELINE.md))
- **Inline overlay** — draft comments render under their diff lines on the real
  PR, collapsed to a summary and expandable, with a side-panel index that jumps
  to each one. ([docs/EXTENSION.md](docs/EXTENSION.md))
- **Per-comment chat** — a Claude thread on each comment that can read the repo,
  with one-click apply of proposed rewrites.
- **Your voice, enforced** — the review voice and priorities live in editable
  preference files that shape every prompt. ([preferences/](preferences))
- **It learns** — editing or chat-correcting a drafted comment distills a
  durable lesson that feeds back into future reviews.
  ([docs/LEARNING.md](docs/LEARNING.md))
- **Control page** — tune models, finders, concurrency, and the voice/priorities
  text live, no file editing. ([docs/CONTROL.md](docs/CONTROL.md))
- **Atomic publish** — one deliberate click posts summary, verdict, and accepted
  comments as a single GitHub review; nothing else ever writes to GitHub.

## How it works

```
┌────────────────────────┐   HTTP + SSE   ┌──────────────────────────────┐
│ Chrome extension (MV3) │ <────────────> │ local daemon (localhost:7388)│
│ overlay on github.com  │                │ pipeline · chats · publish   │
└────────────────────────┘                └──────────┬───────────────────┘
                                                     │ Claude Agent SDK (your claude login)
                                                     │ GitHub REST (your gh token)
                                                     ▼
                                       ~/.revue/  drafts · repo workdirs
```

- **Daemon** (`server/`): fetches the PR, checks out its head into a cached
  workdir, runs the review pipeline, holds draft state, serves per-comment
  chats, publishes to GitHub. See [docs/PIPELINE.md](docs/PIPELINE.md).
- **Extension** (`extension/`): renders draft comments inline in the PR diff,
  plus a side panel with pipeline progress, the full comment list, the review
  summary editor, and the publish flow. See [docs/EXTENSION.md](docs/EXTENSION.md).

### The pipeline (multi-model, tiered by cost)

| Stage  | Model (default)   | What it does |
|--------|-------------------|--------------|
| triage | claude-haiku-4-5  | Classifies the PR, picks which finders are worth running |
| find   | claude-sonnet-5   | Parallel finders per dimension (correctness, concurrency, API contracts, tests, security, simplicity) with read access to the checked-out repo |
| verify | claude-opus-4-8   | Adversarial pass per finding — tries to *refute* it against the repo; refuted findings are dropped |
| draft  | claude-fable-5    | Rewrites surviving findings as review comments under `preferences/voice.md` + drafts the review summary |
| chat   | claude-fable-5    | Per-comment conversations while you converge |

Only verified findings get drafted; cheap models do the broad scanning,
expensive models do judgment and voice. Models are configurable per stage in
`revue.config.json` or live from the [control page](docs/CONTROL.md).

A correction you make to any drafted comment (an edit, or an applied chat
revision) is distilled into `preferences/learnings.md` and fed back into the
finder, drafting, and chat prompts, so the reviewer improves over time. See
[docs/LEARNING.md](docs/LEARNING.md).

### Safety model

- Nothing is posted to GitHub until you click Publish; the pipeline and chats
  use **read-only** tools (Read/Grep/Glob + read-only git).
- Publish posts one review (summary + accepted comments + verdict) via the
  GitHub API — a single, deliberate, per-action authorization.
- The daemon binds to 127.0.0.1 and requires a shared secret
  (`~/.revue/secret`) on every request; you paste it once into the extension
  options page.

## Setup

Prerequisites: Node 20+, `gh` CLI authenticated (`gh auth status`), Claude
Code installed and logged in (the Agent SDK rides that auth; alternatively
set `ANTHROPIC_API_KEY`).

```sh
npm install
npm run build          # bundles the extension into extension/dist
npm run dev            # starts the daemon on 127.0.0.1:7388
```

Then in Chrome:

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select
   the `extension/` directory.
2. Open the extension's options page, paste the token printed by the daemon
   on startup (also at `~/.revue/secret`), and the port if you changed it.

## Using it

1. Open a PR on github.com (any tab; the **Files changed** tab gives you the
   inline overlay).
2. Click the Revue floating button (or the extension toolbar icon) → **Run
   review**. Pipeline progress streams into the panel; comments appear as
   they are drafted.
3. Converge:
   - **Edit** a comment inline, change its severity, or discard it.
   - **Chat** on any comment — quick actions: *Tighten*, *Make it a nit*,
     *Re-verify*, *Steelman the author*, *Show evidence* — and apply the
     rewrite the chat proposes with one click. The chat can read the repo.
   - **Add** your own comments on any diff line; they join the same batch.
   - Edit the review **summary** and pick the verdict (comment / approve /
     request changes).
4. **Publish** — you get a preview of exactly what will post (n comments,
   verdict, summary) with anchors re-validated against the live diff, then
   one click posts it as a single GitHub review under your account.

Comments the DOM can't anchor (collapsed files, huge diffs) still render in
the panel with their own diff hunk, so nothing is ever lost — see
[docs/EXTENSION.md](docs/EXTENSION.md) for the degradation model.

If the PR gets new pushes after the pipeline ran, the draft is marked stale;
re-run when you want fresh anchors (your edits and accepted comments are
re-validated at publish time regardless).

## Configuration

Two ways to tune the pipeline:

- **Control page** (no file editing): open
  `http://127.0.0.1:7388/control?token=<secret>` — the daemon prints this URL
  on startup. Edit the per-stage models, which finders run, concurrency and the
  agent timeout, and the review voice/priorities text, all with live save. See
  [docs/CONTROL.md](docs/CONTROL.md).
- **Config file**: copy `revue.config.example.json` to `revue.config.json`
  (repo root) or `~/.revue/config.json` and edit. Env overrides: `REVUE_PORT`,
  `REVUE_MOCK=1`, `REVUE_MAX_PARALLEL`, `REVUE_AGENT_TIMEOUT_MS`.

## Mock mode

`npm run mock` serves canned pipeline output and chat replies without calling
Claude — full UI development and end-to-end testing (including a real GitHub
fetch and a dry-run publish) with zero token spend.

## Development

```sh
npm run typecheck      # all three workspaces
npm run watch:ext      # rebuild the extension on change
```

Layout: `shared/` wire types · `server/` daemon · `extension/` Chrome
extension · `docs/` architecture, API, pipeline, extension internals ·
`preferences/` the review voice and priorities the pipeline enforces.
