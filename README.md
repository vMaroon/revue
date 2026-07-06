# revue

<p align="center">
  <img src="docs/assets/banner.png" alt="revue" width="760">
</p>

<p align="center">
  <a href="https://github.com/vMaroon/revue/actions/workflows/ci.yml"><img src="https://github.com/vMaroon/revue/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-D97757.svg?style=flat-square" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/node-20%2B-D97757.svg?style=flat-square" alt="Node 20+">
  <img src="https://img.shields.io/badge/TypeScript-strict-D97757.svg?style=flat-square" alt="TypeScript">
  <img src="https://img.shields.io/badge/built%20with-Claude%20Agent%20SDK-D97757.svg?style=flat-square" alt="Claude Agent SDK">
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-D97757.svg?style=flat-square" alt="PRs welcome"></a>
</p>

**A friendly claw for your pull requests.** Draft your whole review privately,
converge on it with Claude, then publish once — as a single GitHub review.

<sub>[Quickstart](#quickstart) · [Why revue](#why-revue) · [How it works](#how-it-works) · [Docs](#documentation)</sub>

---

**revue** runs a multi-model agentic pipeline over a GitHub pull request, drafts
review comments in your voice, and overlays them on the *actual* GitHub PR page.
Every draft is editable and has its own Claude chat thread for converging on
substance and wording. Nothing touches GitHub until you click **Publish** — which
posts the whole batch as a single review.

## Quickstart

> **Prerequisites:** Node 20+, the [`gh` CLI](https://cli.github.com) authenticated
> (`gh auth status`), and Claude Code installed and logged in (the Agent SDK rides
> that auth; or set `ANTHROPIC_API_KEY`).

```sh
npm install
npm run build     # bundle the extension into extension/dist
npm run dev       # start the local daemon on 127.0.0.1:7388
```

Load the extension in Chrome (or grab a pre-built zip from
[Releases](https://github.com/vMaroon/revue/releases) and unzip it instead of building):

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick the `extension/` directory.
2. Open the extension's options page, paste the token the daemon printed on startup
   (also at `~/.revue/secret`), and set the port if you changed it.

Then review a PR:

1. Open any PR on **github.com** (the **Files changed** tab gives you the inline overlay).
2. Hit the floating **Revue** button → **Run review**. Progress streams into the panel; comments appear as they're drafted.
3. Edit, chat, re-verify, or add your own comments — then **Publish** posts it all as one GitHub review under your account.

Want to try the whole UI with **zero token spend**? `npm run mock` serves canned
pipeline output and chat replies (including a real GitHub fetch and a dry-run publish).

## Why revue

A review is high-stakes writing you usually do in one pass, in a textarea, with no
second opinion. revue turns it into a staging area:

- 🧠 **Multi-model pipeline** — cheap models triage and scan for recall, strong models verify and write. Every finding is *adversarially verified* against the checked-out repo before it becomes a comment. → [PIPELINE](docs/PIPELINE.md)
- 🔍 **Inline overlay** — drafts render under their diff lines on the real PR, collapsed to a summary and expandable, with a side-panel index that jumps to each one. → [EXTENSION](docs/EXTENSION.md)
- 💬 **Per-comment chat** — a Claude thread on each comment that can read the repo, with one-click apply of proposed rewrites.
- 🗣️ **Your voice, enforced** — the review voice and priorities live in editable preference files that shape every prompt. → [preferences/](preferences)
- 📈 **It learns** — editing or chat-correcting a drafted comment distills a durable lesson that feeds back into future reviews. → [LEARNING](docs/LEARNING.md)
- 🎛️ **Control page** — tune models, finders, concurrency, and the voice/priorities text live, no file editing. → [CONTROL](docs/CONTROL.md)
- 🚀 **Atomic publish** — one deliberate click posts summary, verdict, and accepted comments as a single GitHub review. Nothing else ever writes to GitHub.

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

- **Daemon** (`server/`) — fetches the PR, checks out its head into a cached workdir, runs the review pipeline, holds draft state, serves per-comment chats, and publishes to GitHub.
- **Extension** (`extension/`) — renders draft comments inline in the PR diff, plus a side panel with pipeline progress, the comment list, the summary editor, and the publish flow.

### The pipeline (multi-model, tiered by cost)

| Stage | Model (default) | What it does |
|--------|-------------------|--------------|
| **triage** | `claude-haiku-4-5` | Classifies the PR, picks which finders are worth running |
| **find** | `claude-sonnet-5` | Parallel finders per dimension (correctness, concurrency, API contracts, tests, security, simplicity) with read access to the checked-out repo |
| **verify** | `claude-opus-4-8` | Adversarial pass per finding — tries to *refute* it against the repo; refuted findings are dropped |
| **draft** | `claude-opus-4-8` | Rewrites surviving findings as review comments under `preferences/voice.md`, and drafts the review summary |
| **chat** | `claude-opus-4-8` | Per-comment conversations while you converge |

Only verified findings get drafted: cheap models do the broad scanning, expensive
models do judgment and voice. Models are configurable per stage in
`revue.config.json` or live from the [control page](docs/CONTROL.md).

A correction you make to any drafted comment — an edit, or an applied chat revision —
is distilled into `preferences/learnings.md` and fed back into the finder, drafting,
and chat prompts, so the reviewer improves over time. → [LEARNING](docs/LEARNING.md)

### Safety model

- Nothing is posted to GitHub until you click **Publish**; the pipeline and chats use **read-only** tools (Read/Grep/Glob + read-only git).
- **Publish** posts one review (summary + accepted comments + verdict) via the GitHub API — a single, deliberate, per-action authorization.
- The daemon binds to `127.0.0.1` and requires a shared secret (`~/.revue/secret`) on every request; you paste it once into the extension options page.

## Using it

1. Open a PR on github.com (any tab; the **Files changed** tab gives you the inline overlay).
2. Click the Revue floating button (or the extension toolbar icon) → **Run review**. Pipeline progress streams into the panel; comments appear as they are drafted.
3. **Converge:**
   - **Edit** a comment inline, change its severity, or discard it.
   - **Chat** on any comment — quick actions: *Tighten*, *Make it a nit*, *Re-verify*, *Steelman the author*, *Show evidence* — and apply the rewrite the chat proposes with one click. The chat can read the repo.
   - **Add** your own comments on any diff line; they join the same batch.
   - Edit the review **summary** and pick the verdict (comment / approve / request changes).
4. **Publish** — you get a preview of exactly what will post (n comments, verdict, summary) with anchors re-validated against the live diff, then one click posts it as a single GitHub review under your account.

Comments the DOM can't anchor (collapsed files, huge diffs) still render in the panel
with their own diff hunk, so nothing is ever lost — see [EXTENSION](docs/EXTENSION.md)
for the degradation model. If the PR gets new pushes after the pipeline ran, the draft
is marked stale; re-run when you want fresh anchors (your edits and accepted comments
are re-validated at publish time regardless).

## Configuration

Two ways to tune the pipeline:

- **Control page** (no file editing) — open `http://127.0.0.1:7388/control?token=<secret>` (the daemon prints this URL on startup). Edit the per-stage models, which finders run, concurrency and the agent timeout, and the review voice/priorities text, all with live save. → [CONTROL](docs/CONTROL.md)
- **Config file** — copy `revue.config.example.json` to `revue.config.json` (repo root) or `~/.revue/config.json` and edit. Env overrides: `REVUE_PORT`, `REVUE_MOCK=1`, `REVUE_MAX_PARALLEL`, `REVUE_AGENT_TIMEOUT_MS`.

## Development

```sh
npm run mock       # canned pipeline + chat, zero token spend
npm run typecheck  # all three workspaces
npm run watch:ext  # rebuild the extension on change
```

**Layout:** `shared/` wire types · `server/` daemon · `extension/` Chrome extension ·
`docs/` architecture, API, pipeline, extension internals · `preferences/` the review
voice and priorities the pipeline enforces.

## Documentation

| Doc | What's inside |
|-----|---------------|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | The two processes, the decisions behind them, data layout, flows, failure modes |
| [PIPELINE](docs/PIPELINE.md) | Every stage, model, prompt charter, and the JSON discipline that holds it together |
| [EXTENSION](docs/EXTENSION.md) | MV3 internals: networking, SPA detection, DOM anchoring, and the shadow-DOM UI |
| [API](docs/API.md) | The daemon's HTTP + SSE surface, auth, and error contract |
| [CONTROL](docs/CONTROL.md) | The live tuning page — models, finders, concurrency, voice |
| [LEARNING](docs/LEARNING.md) | How corrections become durable lessons for future reviews |

## Roadmap

Rough order, not a promise. Issues and PRs against any of these are welcome.

- **Chrome Web Store listing** so install is one click instead of load-unpacked.
- **One-command daemon start** (`npx revue`) that provisions the secret and prints the extension token.
- **GitLab and Bitbucket** overlays behind the same publish-once model.
- **Reviewer presets** — shareable `voice.md` / `priorities.md` bundles for a team.
- **Wider pipeline test coverage** as the finder/verify stages grow.

## Contributing

Setup, the pre-push checks, and where things live are in [CONTRIBUTING](CONTRIBUTING.md).
Security reports go through the private channel in [SECURITY](SECURITY.md), not public issues.
Changes are tracked in [CHANGELOG](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 Maroon Ayoub
