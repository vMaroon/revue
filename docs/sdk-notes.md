# Agent SDK notes (verified against installed @anthropic-ai/claude-agent-sdk@0.3.201)

Ground truth: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`. When in
doubt, read it — not recall.

```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
for await (const msg of query({ prompt, options })) { ... }
```

## Options (subset we use)

- `model: string` — full IDs work: 'claude-haiku-4-5', 'claude-sonnet-5',
  'claude-opus-4-8', 'claude-fable-5'.
- `cwd: string` — session working directory (our repo workdir).
- `systemPrompt?: string | ...` — plain string is fine.
- `maxTurns?: number`
- `tools: string[]` — the BASE set of built-in tools. Use
  `['Read', 'Grep', 'Glob', 'Bash']` for repo agents; `[]` for no tools
  (triage/voice).
- `allowedTools: string[]` — auto-approved. Use
  `['Read', 'Grep', 'Glob', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git diff:*)', 'Bash(git blame:*)']`.
- `disallowedTools: string[]` — hard-removed; add
  `['Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite']`.
- `permissionMode: 'dontAsk'` — headless: deny anything not pre-approved.
  (Do NOT use bypassPermissions; dontAsk + allowedTools is the deny-by-default mode.)
- `strictMcpConfig: true` + `mcpServers: {}` — no MCP.
- `settingSources: []` — SDK isolation: don't load the user's
  ~/.claude/settings.json or project settings into daemon agents.
- `resume?: string` — session id for multi-turn chat;
  `persistSession` defaults to true (required for resume — leave default).
- `includePartialMessages: true` — emits stream events (below).
- `abortController?: AbortController`
- `outputFormat?: { type: 'json_schema'; schema: <JSON Schema object> }` —
  native structured output.
- `env` — REPLACES subprocess env entirely when set; if set, spread
  process.env first. Simplest: don't set it.

## Messages

- `{ type: 'system', subtype: 'init', session_id, model, tools, ... }` —
  first message; capture `session_id` here.
- `{ type: 'assistant', ... }` — full assistant turns (message.content blocks).
- `{ type: 'stream_event', event: BetaRawMessageStreamEvent }` — only with
  `includePartialMessages`. Text deltas:
  `event.type === 'content_block_delta' && event.delta?.type === 'text_delta'`
  → `event.delta.text`. Type the event access defensively (the event union is
  large); a small helper with `any`-narrowing is acceptable here.
- `{ type: 'result', subtype: 'success', result: string,
  structured_output?: unknown, total_cost_usd, session_id, ... }` — final.
- `{ type: 'result', subtype: 'error_during_execution' | 'error_max_turns' |
  'error_max_budget_usd' | 'error_max_structured_output_retries',
  errors: string[], ... }` — no `.result` field on errors.
- Many other message types exist; ignore anything unrecognized.

## JSON outputs

Prefer `outputFormat` + `result.structured_output`, validated with zod
(zod v4: build the JSON schema with `z.toJSONSchema(schema)`). Fall back to
extracting/parsing JSON from `result.result` text if `structured_output` is
absent, then zod-parse. `runJson` in pipeline/schemas.ts wraps this.

## Auth

The SDK bundles its own CLI runtime; it resolves credentials like Claude
Code does (ANTHROPIC_API_KEY, else the local Claude Code login). No key
handling in our code; document only.
