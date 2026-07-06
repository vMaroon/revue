# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Server unit tests (`node --test` via `tsx`) for diff parsing, anchor validation, dedupe, config, and auth.
- CI workflow: typecheck, test, and build on every push and pull request.
- `npm run package` builds a distributable extension zip; a tag-triggered release workflow attaches it to a GitHub Release.
- Contribution scaffolding: `CONTRIBUTING.md`, `SECURITY.md`, issue and pull-request templates.

## [0.1.0]

Initial public version: multi-model review pipeline, inline overlay on the GitHub
PR page, per-comment Claude chat, preference-driven voice with a learning loop, a
live control page, and atomic single-review publish.
