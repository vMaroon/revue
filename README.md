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

<sub>[Quickstart](#quickstart) · [First review](#your-first-review) · [Why revue](#why-revue) · [Docs](#documentation)</sub>

---

A PR review is high-stakes writing you usually do in one pass, in a textarea,
with no second opinion. revue stages it instead: an agentic reviewer reads the
PR, drafts comments in your voice, and lays them over the actual GitHub diff.
You edit, chat, and cut in private — then publish everything as one review.
It reads like you wrote it, because you did the last pass.

## Quickstart

```sh
npm run setup     # checks prereqs (Node 20+, gh auth, Claude login), installs, builds
npm start         # daemon on 127.0.0.1:7388; the first run opens a guided setup page
```

The first boot opens a one-time welcome page that hands you the token and walks
the three steps:

1. **Load the extension** — `chrome://extensions` → enable **Developer mode** →
   **Load unpacked** → pick the `extension/` directory (or a pre-built zip from
   [Releases](https://github.com/vMaroon/revue/releases), unzipped).
2. **Connect it** — copy the token from the welcome card into the extension's
   options page.
3. **Make it sound like you** — scan your public GitHub PR comments into a
   proposed review voice, review the evidence, apply it.

Prereqs, if you'd rather check by hand: Node 20+, the
[`gh` CLI](https://cli.github.com) authenticated, and Claude Code logged in
(or set `ANTHROPIC_API_KEY`).

## Your first review

1. Open a PR on **github.com** and hit the floating **Revue** button → **Run
   review**. Progress streams into the side panel; draft comments appear under
   their diff lines as they're written.
2. **Converge.** Edit a comment inline, change its severity, or discard it.
   Chat on any comment — *Tighten*, *Make it a nit*, *Re-verify*, *Steelman
   the author* — and apply the rewrite it proposes with one click. Add your
   own comments; set the summary and the verdict.
3. **Publish.** A preview shows exactly what will post, re-checked against the
   live diff; one click posts it all as a single GitHub review under your
   account.

If the PR gets new pushes mid-review, the draft is marked stale — your edits
survive, and anchors are re-validated at publish time regardless. Comments the
page can't anchor still render in the panel with their own diff snippet, so
nothing is ever lost.

## Why revue

- 🗺️ **On the PR itself** — drafts render inline under the diff lines of the
  real PR, with a side panel to run, track, and navigate the review. No
  separate app to live in.
- 🛡️ **Verified before you see it** — every candidate finding gets an
  adversarial pass that tries to *refute* it against the checked-out code.
  Only survivors become comments, and the dropped ones stay visible, so you
  know what was filtered and why.
- 🪞 **It sounds like you** — bootstrap the voice from your own public PR
  comments ([STYLE](docs/STYLE.md)), and every edit you make afterwards feeds
  a lesson back in ([LEARNING](docs/LEARNING.md)). Your wording, your severity
  bar, your priorities.
- 💬 **Converge, don't rewrite** — each comment carries its own repo-aware
  chat thread, so tightening, softening, or fact-checking a draft is a
  message, not a rewrite.
- 🔒 **Nothing posts until you say so** — the review stays local until you
  click **Publish**, and that click is the only thing that ever writes to
  GitHub.
- 🧪 **Zero-cost dry run** — `npm run mock` exercises the entire flow with
  canned model output. No tokens spent, real UI.

## Under the hood

Two pieces: a Chrome extension that renders the overlay, and a local daemon
(`127.0.0.1`) that does the work — it fetches the PR, checks out its head, and
runs a cost-tiered multi-model pipeline (cheap models scan broadly; strong
models verify adversarially, then write in your voice) through the Claude
Agent SDK on your existing `claude` login and `gh` token. Pipeline and chat
agents get read-only tools; draft state lives in `~/.revue`; publishing is the
single write path to GitHub. The full picture:
[ARCHITECTURE](docs/ARCHITECTURE.md) · [PIPELINE](docs/PIPELINE.md).

## Configuration

- **Control page** — the daemon prints its URL on startup (and opens it on
  first run): per-stage models, which finders run, concurrency, and the
  voice/priorities text, all editable live. → [CONTROL](docs/CONTROL.md)
- **Config file** — copy `revue.config.example.json` to `revue.config.json`
  (repo root) or `~/.revue/config.json`. Env overrides: `REVUE_PORT`,
  `REVUE_MOCK=1`, `REVUE_MAX_PARALLEL`, `REVUE_AGENT_TIMEOUT_MS`.

## Development

```sh
npm run mock       # canned pipeline + chat, zero token spend
npm run typecheck  # all three workspaces
npm run watch:ext  # rebuild the extension on change
```

## Documentation

| Doc | What's inside |
|-----|---------------|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | The two processes, the decisions behind them, data layout, flows, failure modes |
| [PIPELINE](docs/PIPELINE.md) | Every stage, model, prompt charter, and the JSON discipline that holds it together |
| [EXTENSION](docs/EXTENSION.md) | MV3 internals: networking, SPA detection, DOM anchoring, and the shadow-DOM UI |
| [API](docs/API.md) | The daemon's HTTP + SSE surface, auth, and error contract |
| [CONTROL](docs/CONTROL.md) | The live tuning page — models, finders, concurrency, voice |
| [LEARNING](docs/LEARNING.md) | How corrections become durable lessons for future reviews |
| [STYLE](docs/STYLE.md) | Bootstrapping your review voice from your public GitHub comments |

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
