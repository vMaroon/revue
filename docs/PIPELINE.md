<sub>[revue](../README.md) · docs · **Pipeline**</sub>

# Review pipeline

> The multi-model, cost-tiered path from a raw diff to verified, in-voice review comments.

Implemented in `server/src/pipeline/` (orchestration, prompts, schemas) with
all model calls going through `pipeline/agent.ts` (`AgentInvoker`), the only
module that imports `@anthropic-ai/claude-agent-sdk`. Contracts:
`server/src/interfaces.ts`.

## Stages at a glance

| Stage | Model (default) | What it does |
|--------|-------------------|--------------|
| **triage** | `claude-haiku-4-5` | Classifies the PR, picks which finders are worth running |
| **find** | `claude-sonnet-5` | Parallel finders per dimension, with read access to the checkout |
| **verify** | `claude-opus-4-8` | Adversarial pass per finding — tries to refute it against the repo |
| **draft** | `claude-opus-4-8` | Rewrites surviving findings as comments under `preferences/voice.md` |
| **chat** | `claude-opus-4-8` | Per-comment conversations while the reviewer converges |

Cheap models do the broad scanning; expensive models do judgment and voice.
Models are configurable per stage in `revue.config.json` or live from the
[control page](CONTROL.md).

## Agent invocation

`AgentInvoker.run(opts)` wraps one SDK `query()`:

- `model`, `cwd`, `resume`, `maxTurns` pass through.
- Read-only tool policy for **every** pipeline/chat agent:
  `allowedTools: ['Read', 'Grep', 'Glob', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git diff:*)', 'Bash(git blame:*)']`,
  `disallowedTools: ['Write', 'Edit', 'NotebookEdit', 'WebSearch', 'WebFetch']`,
  permission mode that never prompts (`bypassPermissions`; if the installed
  SDK supports a deny-by-default headless mode such as `dontAsk`, prefer it),
  and MCP disabled (`strictMcpConfig: true`, `mcpServers: {}`).
- Session id is captured from the `system/init` (or result) message and
  returned; `onDelta` receives incremental assistant text when the SDK
  surfaces partial messages (`includePartialMessages: true`) — implement the
  delta extraction defensively against SDK shape drift and fall back to
  no-op (the final text still arrives via the result message).
- The result message's final text is returned as `AgentResult.text`.
- **Align field access with the installed SDK's type declarations**
  (`node_modules/@anthropic-ai/claude-agent-sdk/`), not with recalled names.

Concurrency: a semaphore in `agent.ts` caps concurrent `query()` calls at
`config.maxParallel` (each spawns a subprocess).

**Mock mode** (`config.mock`): `createAgentInvoker` returns a mock that
switches on `opts.tag` and returns schema-valid canned output (two findings
for `finder`, a CONFIRMED and a REFUTED verdict for `verify`, plausible
comment bodies for `voice`, a short reply wrapping a `<revised-comment>` for
`chat`), with a small artificial delay so the UI's streaming paths exercise.

## JSON discipline

`pipeline/schemas.ts` defines zod schemas for every stage's output and
`runJson<T>(invoker, opts, schema)`: appends an explicit "reply with only a
JSON object matching this schema" instruction, extracts the first JSON
object/array from the reply (tolerating code fences), parses, validates; on
failure retries once with the validation error appended; then throws.

## Stages

`PipelineRunner.run` executes, updating `draft.stages` and emitting
`stage`/`finding`/`finding-verdict`/`comment` events as it goes (save after
each mutation):

### 1. context
Already-fetched `PrSnapshot` + `ensureWorkdir` checkout. Builds the shared
prompt preamble: PR title/body/author/branches, the reviewer's focus
(`draft.focus`, when the run was requested with one) as a section that
weights attention without forbidding findings outside it, file list with
+/- counts, and the full unified diff (per-file patches truncated at ~400
lines with a note; finders read the rest from the workdir).

### 2. triage — `models.triage`
No repo access needed (`cwd` still set, `maxTurns: 1`). Input: preamble.
Output (JSON): `{ size: 'trivial'|'small'|'medium'|'large', kind: string,
finders: string[], notes: string }` — `finders` ⊆ `config.finders`, the
dimensions worth running for this PR (docs-only PR → skip concurrency etc.).
On triage failure, fall back to all configured finders.

### 3. find — `models.finder`, parallel per dimension
Each finder gets: preamble, its dimension charter (below), the
`preferences/priorities.md` file contents, and repo read access
(`cwd = workdir`). Explicit coverage instruction: report every issue found,
including uncertain ones — a separate verification stage filters; do not
self-censor for confidence. Output (JSON): array of findings
`{ path, line, side, startLine?, claim, consequence, suggestion?, severity,
evidence: [{path, line?, excerpt?, note}] }`.

Runner assigns ids (`f-<n>`), tags the dimension, drops findings whose
anchor fails `validateAnchor` (log to `draft.dropped` with a synthetic
REFUTED verification noting the bad anchor), and emits `finding` events.

Finder charters (`pipeline/prompts/finders.ts`):

- **correctness** — logic errors, off-by-ones, nil/undefined derefs, error
  handling gaps, broken invariants, wrong behavior vs the PR's stated intent.
- **concurrency** — races, goroutine/task leaks, missing cancellation or
  context propagation, lock misuse, unsafe shared state.
- **api-contracts** — breaking changes to public APIs/CRDs/configs/wire
  formats, compatibility, versioning, migration gaps.
- **tests** — untested new behavior, tests that can't fail, missing edge
  cases for the changed code specifically (not coverage nagging).
- **security** — injection, authn/z gaps, secrets in code, unsafe defaults,
  path traversal (report only concrete issues, not theory).
- **simplicity** — dead code, speculative abstraction, single-use helpers,
  error handling for impossible cases, altitude mismatches (per
  priorities.md; suggestions/nits only).

### 4. verify — `models.verifier`, parallel per finding
Dedupe first (`pipeline/dedupe.ts`, pure code): same path + line within ±2
and token-overlapping claims → keep the higher-severity one, merge evidence.

Each surviving finding gets an adversarial verifier with repo access whose
charter is to **refute**: "Assume this finding is wrong until the code
proves otherwise. Read the actual code paths. If uncertain, say UNCERTAIN —
do not rubber-stamp." Output (JSON):
`{ verdict: 'CONFIRMED'|'REFUTED'|'UNCERTAIN', notes: string }`.

REFUTED → moved to `draft.dropped`. CONFIRMED/UNCERTAIN → proceed (UNCERTAIN
is surfaced in the UI as an "unverified" badge via `finding.verification`).
Emit `finding-verdict` for each.

### 5. draft — `models.voice`
One call for all comments + summary (the voice model sees everything, so
severity and tone stay consistent). Input: preamble, surviving findings with
verification notes, and the **full contents of `preferences/voice.md`**.
Output (JSON): `{ comments: [{ findingId, severity, body }], summary,
verdict: 'COMMENT'|'APPROVE'|'REQUEST_CHANGES' }`.

Runner materializes `DraftComment`s (`status: 'proposed'`, `origin:
'pipeline'`, anchor from the finding, `hunk` via `extractHunk`), sets
`draft.summary`/`draft.verdict`, marks the draft `ready`, emits `comment`
events and final `review` + `done`.

Verdict guidance in the prompt: REQUEST_CHANGES only for confirmed blocking
findings; APPROVE when nothing blocking and the PR is sound; else COMMENT.

## Per-comment chat (`server/src/chat/`)

First message seeds a fresh session (`cwd = workdir`, read-only tools,
`models.chat`) with: voice.md contents, the finding (claim, consequence,
evidence, verification), the hunk, the current comment body, and the
instruction:

> You are helping the reviewer converge on this one comment before it is
> posted. Be direct; disagree when the reviewer is wrong. You may read the
> repository to check claims. When you propose new comment text, wrap the
> complete replacement body in `<revised-comment>` tags — the UI offers it
> as a one-click apply. Only include the tags when you actually propose a
> rewrite.

Later turns `resume: comment.chatSessionId`. The service extracts
`<revised-comment>` content into `revisedBody` (stripped from the displayed
reply), streams deltas via `chat-delta`, appends user+assistant messages to
`comment.chat`, saves, emits `chat-done`.

Quick actions are plain messages (`QUICK_ACTIONS` in shared) — no special
server handling.

## Efficiency notes

- Tiered models: haiku triages, sonnet scans, opus verifies and writes.
- Finders run in parallel (semaphore-capped); verifiers run in parallel as
  findings arrive from dedupe.
- Refuted findings never reach the expensive voice stage.
- Voice is one call, not per-comment.
- Workdirs are cached per repo; only `git fetch` runs per review.

---

<sub>**revue docs** · [Architecture](ARCHITECTURE.md) · [Pipeline](PIPELINE.md) · [Extension](EXTENSION.md) · [API](API.md) · [Control](CONTROL.md) · [Learning](LEARNING.md) · [Style](STYLE.md) · [README](../README.md)</sub>
