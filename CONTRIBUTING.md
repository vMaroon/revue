# Contributing

Thanks for looking. revue is a local-first tool with a small, typed codebase; the
bar for a change is that it stays simple, keeps GitHub writes behind the single
Publish action, and is covered by a test where the logic is non-trivial.

## Setup

```sh
npm install
npm run mock       # canned pipeline + chat, zero token spend — the fastest dev loop
npm run dev        # real pipeline; needs the gh CLI and a Claude login (see README)
```

Load the extension unpacked from `extension/` after `npm run build` (or keep
`npm run watch:ext` running). See the [README](README.md#quickstart) for the token step.

## Before you push

```sh
npm run typecheck  # all three workspaces
npm test           # server unit tests
npm run build      # extension bundles
```

CI runs the same three on every PR. Green is required.

## Where things live

- `shared/` — wire types shared by both processes. Change here ripples to both; keep it minimal.
- `server/` — the daemon: pipeline, chats, GitHub client, publish. Pure logic (`pipeline/dedupe`, `github/diff`, `config`, `auth`) is unit-tested under `server/test/`.
- `extension/` — the MV3 Chrome extension: overlay, panel, anchoring.
- `docs/` — architecture and internals. Update the relevant doc when a change is user-visible.

## Tests

Unit tests use the Node built-in runner via `tsx` — no framework. Add a `*.test.ts`
under `server/test/`; prefer the pure modules (diff parsing, anchor validation,
dedupe, config). A behavior change to that logic should come with a test.

## Style

- Match the surrounding code. Strict TypeScript, no `any` escapes.
- Comments describe the current state, not the history of the change.
- Surgical diffs — touch only what the change needs.

## Commits and PRs

- Imperative subject, ~72 chars; body explains the why.
- One logical change per PR. Fill in the PR template.
- No new runtime dependency without saying why in the PR description.

## Reporting bugs and security issues

Bugs: open an issue with the template. Security: see [SECURITY.md](SECURITY.md) —
do not file a public issue for a vulnerability.
