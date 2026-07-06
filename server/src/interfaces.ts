// Module contracts for the revue daemon. Each module implements exactly the
// interface(s) named here; routes and the composition root consume modules
// only through these types. See docs/ARCHITECTURE.md for the module map.

import type {
  ApplyStyleRequest,
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
  StyleBootstrapState,
  StyleCommentKind,
  StyleCommentRole,
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

/** One comment of the user's, sampled for the style corpus (docs/STYLE.md). */
export interface UserComment {
  kind: StyleCommentKind;
  /** The user's role on the PR the comment was made on. */
  role: StyleCommentRole;
  /** `owner/name`. */
  repo: string;
  prNumber: number;
  body: string;
  createdAt: string;
}

export interface UserCommentsOptions {
  /** How many recently-active PRs to sample. */
  maxPrs: number;
  /** Stop collecting once this many comments are gathered. */
  maxComments: number;
  onProgress?: (prsScanned: number, prsTotal: number, comments: number) => void;
}

export interface GithubService {
  /** PR metadata plus per-file patches, via the GitHub REST API. */
  fetchPr(ref: PrRef): Promise<PrSnapshot>;
  /**
   * The user's recent public PR comments (inline review comments, review
   * bodies, discussion), newest PRs first, for the style bootstrap.
   */
  fetchUserComments(login: string, opts: UserCommentsOptions): Promise<UserComment[]>;
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
  tag?: 'triage' | 'finder' | 'verify' | 'voice' | 'chat' | 'learn' | 'style';
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
// Style bootstrap (server/src/style/service.ts)
// ---------------------------------------------------------------------------

export interface StyleService {
  /** Current bootstrap state (idle / running / ready / error). */
  get(): StyleBootstrapState;
  /**
   * Kicks off the scan+analysis asynchronously and returns the initial
   * running state; progress is observable by polling get(). Throws when a
   * run is already in flight. The finished result persists at
   * `${dataDir}/style-bootstrap.json` until applied, discarded, or re-run.
   */
  start(github: GithubService, invoker: AgentInvoker): StyleBootstrapState;
  /**
   * Writes the ready proposal (with any field overridden by `overrides`) to
   * preferences/voice.md and preferences/priorities.md, and the evidence-
   * backed profile to preferences/style-profile.md. Throws unless ready.
   */
  apply(overrides: ApplyStyleRequest): StyleBootstrapState;
  /** Clears a ready or errored bootstrap back to idle. Throws while running. */
  discard(): StyleBootstrapState;
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
  style: StyleService;
  /** Shared-secret check for every request except GET /health. */
  auth: { token: string };
}
