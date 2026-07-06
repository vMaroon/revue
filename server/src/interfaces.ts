// Module contracts for the revue daemon. Each module implements exactly the
// interface(s) named here; routes and the composition root consume modules
// only through these types. See docs/ARCHITECTURE.md for the module map.

import type {
  DraftComment,
  Finding,
  PrFile,
  PrMeta,
  PrRef,
  PublishResult,
  PublishValidation,
  RevueConfig,
  RevueEvent,
  ReviewDraft,
  Side,
} from '@revue/shared';

// ---------------------------------------------------------------------------
// State (server/src/store.ts)
// ---------------------------------------------------------------------------

export interface Store {
  get(id: string): ReviewDraft | undefined;
  getByPr(ref: PrRef): ReviewDraft | undefined;
  /** Upserts and persists to `${dataDir}/reviews/${draft.id}.json`. */
  put(draft: ReviewDraft): void;
  list(): ReviewDraft[];
}

// ---------------------------------------------------------------------------
// SSE fan-out (server/src/events.ts)
// ---------------------------------------------------------------------------

export interface EventHub {
  emit(reviewId: string, event: RevueEvent): void;
  /** Registers a subscriber; returns an unsubscribe function. */
  subscribe(reviewId: string, send: (event: RevueEvent) => void): () => void;
}

// ---------------------------------------------------------------------------
// GitHub (server/src/github/*.ts)
// ---------------------------------------------------------------------------

export interface PrSnapshot {
  meta: PrMeta;
  files: PrFile[];
}

export interface GithubService {
  /** PR metadata plus per-file patches, via the GitHub REST API. */
  fetchPr(ref: PrRef): Promise<PrSnapshot>;
  /**
   * Clone (once) and fetch+checkout the PR head into
   * `${dataDir}/workdirs/${owner}__${repo}` (detached at headSha).
   * Returns the absolute workdir path.
   */
  ensureWorkdir(meta: PrMeta): Promise<string>;
  /** Login of the authenticated user, if a token is available. */
  ghUser(): Promise<string | undefined>;
  /** Anchor-check every accepted comment against the live diff. */
  validate(draft: ReviewDraft, snapshot: PrSnapshot): PublishValidation;
  /**
   * Post summary + accepted comments as a single PR review
   * (POST /repos/{o}/{r}/pulls/{n}/reviews with event = draft.verdict).
   * Caller has already validated.
   */
  publish(draft: ReviewDraft, snapshot: PrSnapshot): Promise<PublishResult>;
}

// Pure helpers exported by server/src/github/diff.ts (also used by the
// pipeline to validate finder output and attach hunks):
//   parsePatch(patch: string): Hunk[]
//   validateAnchor(files: PrFile[], path: string, line: number, side: Side): { valid: boolean; reason?: string }
//   extractHunk(files: PrFile[], path: string, line: number, side: Side, context?: number): string | undefined
export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Raw hunk text including the @@ header. */
  text: string;
}

export interface DiffUtils {
  parsePatch(patch: string): Hunk[];
  validateAnchor(
    files: PrFile[],
    path: string,
    line: number,
    side: Side,
  ): { valid: boolean; reason?: string };
  extractHunk(
    files: PrFile[],
    path: string,
    line: number,
    side: Side,
    context?: number,
  ): string | undefined;
}

// ---------------------------------------------------------------------------
// Agent invocation (server/src/pipeline/agent.ts) — the only module that
// touches @anthropic-ai/claude-agent-sdk. Pipeline and chat both go through
// it, so mock mode lives in exactly one place.
// ---------------------------------------------------------------------------

export interface AgentRunOptions {
  model: string;
  prompt: string;
  systemPrompt?: string;
  /** Repo checkout the agent may read. */
  cwd?: string;
  /**
   * true => allowedTools limited to Read/Grep/Glob plus read-only git Bash
   * (log/show/diff/blame). false => same read-only set (never grant writes);
   * kept for future use.
   */
  readOnly?: boolean;
  /** Agent SDK session id for multi-turn chats. */
  resume?: string;
  maxTurns?: number;
  /** Streamed assistant text, when the SDK surfaces partial messages. */
  onDelta?: (text: string) => void;
  /** Called once with this call's USD cost when the result arrives. */
  onCost?: (usd: number) => void;
  /** Label used by the mock invoker to pick a canned response. */
  tag?: 'triage' | 'finder' | 'verify' | 'voice' | 'chat' | 'learn';
}

export interface AgentResult {
  text: string;
  sessionId?: string;
  costUsd?: number;
}

export interface AgentInvoker {
  run(opts: AgentRunOptions): Promise<AgentResult>;
}

// Also exported by pipeline/schemas.ts:
//   runJson<T>(invoker, opts, zodSchema): Promise<T>
// Prompts the agent for JSON, extracts the first JSON block from the reply,
// zod-parses it, and retries once with the validation error appended before
// throwing.

// ---------------------------------------------------------------------------
// Pipeline (server/src/pipeline/runner.ts)
// ---------------------------------------------------------------------------

export interface PipelineDeps {
  config: RevueConfig;
  invoker: AgentInvoker;
  snapshot: PrSnapshot;
  /** Absolute path of the checked-out PR head. */
  workdir: string;
  diff: DiffUtils;
  emit: (event: RevueEvent) => void;
  /** Persist the (mutated) draft. Call after every meaningful mutation. */
  save: () => void;
}

export interface PipelineRunner {
  /**
   * Runs context -> triage -> find -> verify -> draft, mutating `draft`
   * (stages, comments, dropped, summary, verdict, status) in place.
   * Emits progress events and saves as it goes. Never throws: on failure it
   * sets draft.status = 'error', draft.error, emits an error event, saves.
   */
  run(draft: ReviewDraft, deps: PipelineDeps): Promise<void>;
}

// ---------------------------------------------------------------------------
// Per-comment chat (server/src/chat/service.ts)
// ---------------------------------------------------------------------------

export interface ChatDeps {
  config: RevueConfig;
  invoker: AgentInvoker;
  workdir: string;
  emit: (event: RevueEvent) => void;
  save: () => void;
}

export interface ChatService {
  /**
   * Sends one user message on the comment's chat thread. First message
   * seeds the session with the finding, hunk, current body, and the voice
   * preferences; later messages resume via comment.chatSessionId.
   * Streams assistant text as 'chat-delta' events, appends both messages to
   * comment.chat, stores the session id, emits 'chat-done', saves, and
   * resolves with the reply (plus revisedBody when the assistant proposed a
   * rewrite inside <revised-comment>...</revised-comment> tags).
   */
  send(
    draft: ReviewDraft,
    comment: DraftComment,
    message: string,
    deps: ChatDeps,
  ): Promise<{ reply: import('@revue/shared').ChatMessage; revisedBody?: string }>;
}

// ---------------------------------------------------------------------------
// Learning loop (server/src/learn/service.ts)
// ---------------------------------------------------------------------------

export interface LearnService {
  /**
   * Called after a pipeline comment's body is edited (directly or via an
   * applied chat revision). Fire-and-forget: distills the change from
   * originalBody into preferences/learnings.md via the chat model. No-op for
   * manual comments or unchanged bodies; never throws.
   */
  onCorrection(comment: DraftComment, config: RevueConfig, invoker: AgentInvoker): void;
}

// ---------------------------------------------------------------------------
// Composition (server/src/app.ts wires these; server/src/index.ts starts it)
// ---------------------------------------------------------------------------

export interface Deps {
  config: RevueConfig;
  store: Store;
  hub: EventHub;
  github: GithubService;
  diff: DiffUtils;
  invoker: AgentInvoker;
  pipeline: PipelineRunner;
  chat: ChatService;
  learn: LearnService;
  /** Shared-secret check for every request except GET /health. */
  auth: { token: string };
}
