# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- The first review run on a PR streamed no live progress until a page refresh: the SSE subscription was only wired when a draft existed at mount, never after **Run review** created one. The panel now hands the new draft back to the bootstrap, which subscribes on the spot; and since the event hub does not replay, every stream open refetches the draft once to reconcile frames emitted before the stream was listening.

### Added
- Guided customization in `npm run setup`: Claude billing (tunes `maxParallel`), one line of reviewer context written to `preferences/priorities.md`, and an optional voice scan of your public PR comments — every question defaults sensibly, `--defaults` skips them all, `--customize` forces them without a TTY.
- `npm run style -- --interactive`: dry-run profile and diffs, then a single confirmation before applying.
- Built-in anti-slop baseline (`server/src/pipeline/prompts/antislop.ts`) injected ahead of `voice.md` in the drafting and chat prompts, so comments read human before any personalization; voice rules override it on conflict, and the style bootstrap writes only overrides where the corpus contradicts it.
- Server unit tests (`node --test` via `tsx`) for diff parsing, anchor validation, dedupe, config, and auth.
- CI workflow: typecheck, test, and build on every push and pull request.
- `npm run package` builds a distributable extension zip; a tag-triggered release workflow attaches it to a GitHub Release.
- Contribution scaffolding: `CONTRIBUTING.md`, `SECURITY.md`, issue and pull-request templates.

## [0.1.0]

Initial public version: multi-model review pipeline, inline overlay on the GitHub
PR page, per-comment Claude chat, preference-driven voice with a learning loop, a
live control page, and atomic single-review publish.
