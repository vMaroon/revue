// The only module that imports @anthropic-ai/claude-agent-sdk. Everything
// else (pipeline stages, chat) consumes the AgentInvoker interface, which is
// also where mock mode swaps in.

import { randomUUID } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { RevueConfig } from '@revue/shared';
import type { AgentInvoker, AgentResult, AgentRunOptions } from '../interfaces';
import { debugEnabled, dlog, elog } from '../log';

// Read-only tool policy for every pipeline/chat agent: repo reads plus
// read-only git via Bash; writes and network hard-removed.
const ALLOWED_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git diff:*)',
  'Bash(git blame:*)',
];
const DISALLOWED_TOOLS = ['Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite'];
const REPO_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];

export function createAgentInvoker(config: RevueConfig): AgentInvoker {
  if (config.mock) return createMockInvoker(config);

  // The limit and timeout are read live so the control page can retune
  // concurrency and the agent ceiling without a daemon restart.
  const withSlot = createSemaphore(() => config.maxParallel);
  return {
    run(opts: AgentRunOptions): Promise<AgentResult> {
      return withSlot(() => runQuery(opts, config.agentTimeoutMs));
    },
  };
}

async function runQuery(opts: AgentRunOptions, timeoutMs: number): Promise<AgentResult> {
  // Single-turn calls (triage/voice) get no base tools at all; everything
  // else gets the read-only repo set.
  const tools = opts.maxTurns === 1 ? [] : REPO_TOOLS;
  const label = `${opts.tag ?? 'agent'} ${opts.model}${opts.resume !== undefined ? ' (resume)' : ''}`;
  const started = Date.now();
  dlog('agent', `start ${label}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const q = query({
    prompt: opts.prompt,
    options: {
      model: opts.model,
      abortController: controller,
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts.systemPrompt !== undefined ? { systemPrompt: opts.systemPrompt } : {}),
      ...(opts.maxTurns !== undefined ? { maxTurns: opts.maxTurns } : {}),
      ...(opts.resume !== undefined ? { resume: opts.resume } : {}),
      tools,
      allowedTools: ALLOWED_TOOLS,
      disallowedTools: DISALLOWED_TOOLS,
      permissionMode: 'dontAsk',
      strictMcpConfig: true,
      mcpServers: {},
      settingSources: [],
      includePartialMessages: opts.onDelta !== undefined,
      // Surface why a subprocess stalls (rate-limit backoff, auth) under DEBUG.
      ...(debugEnabled ? { stderr: (d: string) => elog('agent-stderr', `${label}: ${d.trim()}`) } : {}),
    },
  });

  let sessionId: string | undefined;
  let text: string | undefined;
  let costUsd: number | undefined;

  try {
    for await (const message of q) {
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;
      } else if (message.type === 'rate_limit_event') {
        const info = message.rate_limit_info;
        if (info.status !== 'allowed') {
          const resets = info.resetsAt !== undefined ? `, resets ${new Date(info.resetsAt * 1000).toISOString()}` : '';
          elog('agent', `${label} RATE LIMITED (${info.status}${info.rateLimitType !== undefined ? `/${info.rateLimitType}` : ''}${resets})`);
        }
      } else if (message.type === 'stream_event') {
        const delta = extractTextDelta(message.event);
        if (delta !== undefined && opts.onDelta) opts.onDelta(delta);
      } else if (message.type === 'result') {
        sessionId = sessionId ?? message.session_id;
        costUsd = message.total_cost_usd;
        if (message.subtype === 'success') {
          text = message.result;
        } else {
          throw new Error(`agent failed (${message.subtype}): ${message.errors.join('; ')}`);
        }
      }
      // Other message types (assistant turns, status, hooks, ...) are ignored;
      // the final text arrives via the result message.
    }
  } catch (err) {
    if (controller.signal.aborted) {
      const msg = `agent ${label} timed out after ${timeoutMs}ms`;
      elog('agent', msg);
      throw new Error(msg);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (text === undefined) {
    if (controller.signal.aborted) {
      const msg = `agent ${label} timed out after ${timeoutMs}ms`;
      elog('agent', msg);
      throw new Error(msg);
    }
    throw new Error('agent produced no result message');
  }
  dlog(
    'agent',
    `done ${label} in ${Date.now() - started}ms${costUsd !== undefined ? ` ($${costUsd.toFixed(4)})` : ''}`,
  );
  if (costUsd !== undefined && costUsd > 0) opts.onCost?.(costUsd);
  return {
    text,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
}

// The SDK stream event union is large; narrow with any-shaped access and
// fall back to no-op so shape drift never breaks a run.
function extractTextDelta(event: unknown): string | undefined {
  const e = event as { type?: unknown; delta?: { type?: unknown; text?: unknown } } | null;
  if (
    e !== null &&
    typeof e === 'object' &&
    e.type === 'content_block_delta' &&
    e.delta?.type === 'text_delta' &&
    typeof e.delta.text === 'string'
  ) {
    return e.delta.text;
  }
  return undefined;
}

function createSemaphore(getLimit: () => number): <T>(fn: () => Promise<T>) => Promise<T> {
  const limit = (): number => Math.max(1, getLimit());
  let active = 0;
  const waiters: Array<() => void> = [];

  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (active < limit()) {
        active++;
        resolve();
      } else {
        waiters.push(() => {
          active++;
          resolve();
        });
      }
    });

  const release = (): void => {
    active--;
    // Wake as many waiters as the (possibly raised) limit now allows.
    while (waiters.length > 0 && active < limit()) {
      const next = waiters.shift();
      if (next) next();
    }
  };

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

// ---------------------------------------------------------------------------
// Mock mode: schema-valid canned output per tag, small delay so the UI's
// streaming paths exercise. See docs/PIPELINE.md "Mock mode".
// ---------------------------------------------------------------------------

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const MOCK_FINDINGS = [
  {
    path: 'src/index.ts',
    line: 10,
    side: 'RIGHT',
    claim: 'The retry loop has no backoff, so a failing upstream is hammered in a tight loop.',
    consequence: 'A transient outage turns into sustained load against the failing dependency.',
    suggestion: 'Add exponential backoff with jitter between attempts.',
    severity: 'suggestion',
    evidence: [{ path: 'src/index.ts', line: 10, note: 'retry loop added by this PR, no delay between iterations' }],
  },
  {
    path: 'src/index.ts',
    line: 42,
    side: 'RIGHT',
    claim: 'The error from the second call is discarded, so partial failures are invisible to callers.',
    consequence: 'Callers observe success while the write was only partially applied.',
    severity: 'blocking',
    evidence: [{ path: 'src/index.ts', line: 42, note: 'return value ignores err from the second call' }],
  },
];

// Mock findings must anchor to lines that exist in the PR's diff or the
// runner (correctly) drops them. The finder prompt embeds the preamble, whose
// Diff section is `### <path>` headers followed by unified-diff hunks; pull
// the first added lines out of it.
function mockAnchorsFromPrompt(prompt: string): { path: string; line: number }[] {
  const anchors: { path: string; line: number }[] = [];
  let path: string | undefined;
  let newLine = 0;
  let inHunk = false;
  for (const raw of prompt.split('\n')) {
    const header = raw.match(/^### (.+)$/);
    if (header !== null && header[1] !== undefined) {
      path = header[1].trim();
      inHunk = false;
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk !== null && hunk[1] !== undefined) {
      newLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || path === undefined) continue;
    if (raw.startsWith('+')) {
      anchors.push({ path, line: newLine });
      newLine++;
      if (anchors.length >= 2 && anchors[0]!.path !== anchors[1]!.path) return anchors;
      if (anchors.length >= 4) return anchors.slice(0, 2);
    } else if (raw.startsWith('-') || raw.startsWith('\\')) {
      // deletions and no-newline markers do not advance new-file numbering
    } else {
      newLine++;
    }
  }
  return anchors.slice(0, 2);
}

const MOCK_CHAT_REPLY =
  'Checked the claim against the checkout; it holds. Tightened the body.\n\n' +
  '<revised-comment>The error from the second call is discarded, so callers observe success ' +
  'while the write was only partially applied. Wonder if we could return the joined error here.</revised-comment>';

// Plausible per-stage costs so the cost display is exercisable in mock mode.
const MOCK_COST: Record<string, number> = {
  triage: 0.004,
  finder: 0.021,
  verify: 0.016,
  voice: 0.032,
  chat: 0.006,
  learn: 0.002,
  style: 0.045,
};

// Schema-valid StyleOut (see style/prompts.ts) so the bootstrap flow is
// exercisable end-to-end in mock mode.
const MOCK_STYLE = {
  linguistic: [
    {
      observation: 'Leads with the claim; no greetings or praise preambles.',
      evidence: ['The retry loop has no backoff, so a transient failure turns into sustained load.'],
    },
    {
      observation: 'Puts identifiers and config names in backticks.',
      evidence: ['`maxParallel` caps concurrent agents', 'the `PATCH` route already validates this'],
    },
  ],
  interactional: [
    {
      observation: 'Softens asks with suggestion framing rather than pleasantries.',
      evidence: ['Wonder if we could return the joined error here.', 'might be simpler to reuse the existing helper'],
    },
  ],
  technical: [
    {
      observation: 'Concentrates on error handling and concurrency; nits stay prefixed and short.',
      evidence: ['the error from the second call is discarded', 'nit: rename to match the field it mirrors'],
    },
  ],
  caveats: 'Mock profile from canned data; not derived from a real corpus.',
  voiceMd:
    '# Review voice (mock bootstrap)\n\n- Lead with the claim; no greetings or praise preambles.\n- Suggestion-framed asks: "Wonder if we could...".\n- Identifiers, types, and config names in backticks.\n',
  prioritiesMd:
    '# Review priorities (mock bootstrap)\n\n1. Error handling: swallowed errors, lost context, partial failures.\n2. Concurrency: races, leaks, missing cancellation.\n\nDo not flag style the formatter owns.\n',
};

function createMockInvoker(config: RevueConfig): AgentInvoker {
  let verifyCalls = 0;
  return {
    async run(opts: AgentRunOptions): Promise<AgentResult> {
      const sessionId = opts.resume ?? `mock-${randomUUID()}`;
      const costUsd = MOCK_COST[opts.tag ?? ''] ?? 0;

      if (opts.tag === 'chat') {
        // Stream a few chunks so chat-delta paths exercise.
        const chunks = MOCK_CHAT_REPLY.match(/.{1,60}/gs) ?? [MOCK_CHAT_REPLY];
        for (const chunk of chunks.slice(0, 5)) {
          await sleep(60);
          if (opts.onDelta) opts.onDelta(chunk);
        }
        if (costUsd > 0) opts.onCost?.(costUsd);
        return { text: MOCK_CHAT_REPLY, sessionId, costUsd };
      }

      await sleep(300);

      let text: string;
      switch (opts.tag) {
        case 'triage':
          text = JSON.stringify({
            size: 'small',
            kind: 'feature',
            finders: config.finders,
            notes: 'mock triage: running all configured finders',
          });
          break;
        case 'finder': {
          const anchors = mockAnchorsFromPrompt(opts.prompt);
          const findings = MOCK_FINDINGS.map((f, i) => {
            const anchor = anchors[i % Math.max(anchors.length, 1)];
            if (anchor === undefined) return f;
            return {
              ...f,
              path: anchor.path,
              line: anchor.line,
              evidence: f.evidence.map((e) => ({ ...e, path: anchor.path, line: anchor.line })),
            };
          });
          text = JSON.stringify(findings);
          break;
        }
        case 'verify':
          verifyCalls++;
          text = JSON.stringify(
            verifyCalls % 2 === 1
              ? { verdict: 'CONFIRMED', notes: 'mock verification: read the changed function; the claim holds.' }
              : { verdict: 'REFUTED', notes: 'mock verification: the caller already handles this case.' },
          );
          break;
        case 'voice': {
          // Echo the finding ids actually present in the prompt so comments
          // materialize regardless of how many findings survived.
          const ids = [...new Set([...opts.prompt.matchAll(/"id":\s*"(f-\d+)"/g)].map((m) => m[1]))];
          const bodies = [
            'The retry loop has no backoff, so a transient upstream failure turns into sustained load. Wonder if we could add exponential backoff with jitter between attempts.',
            'The error from the second call is discarded, so callers observe success while the write was only partially applied. Returning the joined error keeps partial failures visible.',
          ];
          text = JSON.stringify({
            comments: ids.map((id, i) => ({
              findingId: id,
              severity: i === 0 ? 'suggestion' : 'blocking',
              body: bodies[i % bodies.length],
            })),
            summary:
              'The PR adds the retry path and wires it into the write flow. The approach is sound; the comments are about error propagation and backoff on the new code.',
            verdict: 'COMMENT',
          });
          break;
        }
        case 'style':
          text = JSON.stringify(MOCK_STYLE);
          break;
        case 'learn':
          // Echo a mock merged learnings.md wrapped in the tags the distiller
          // extracts, so the learning loop is exercisable in mock mode.
          text =
            '<learnings>\n# Learned corrections\n\n' +
            '- (mock) Prefer suggestion-framed wording over imperative phrasing.\n' +
            '</learnings>';
          break;
        default:
          text = 'mock reply';
      }
      if (costUsd > 0) opts.onCost?.(costUsd);
      return { text, sessionId, costUsd };
    },
  };
}
