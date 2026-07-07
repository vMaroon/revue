// Shared types between the revue daemon and the Chrome extension.
// This file is the single source of truth for the wire format; docs/API.md
// describes which endpoints exchange which of these shapes.

export type Side = 'LEFT' | 'RIGHT';
export type Severity = 'blocking' | 'suggestion' | 'nit';
export type CommentStatus = 'proposed' | 'accepted' | 'discarded' | 'published';
export type ReviewStatus = 'pending' | 'running' | 'ready' | 'publishing' | 'published' | 'error';
export type ReviewVerdict = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
export type PipelineStage = 'context' | 'triage' | 'find' | 'verify' | 'draft';

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export interface PrMeta extends PrRef {
  title: string;
  author: string;
  url: string;
  headSha: string;
  baseRef: string;
  headRef: string;
  body: string;
}

export interface PrFile {
  path: string;
  previousPath?: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  /** Unified diff hunks for this file; absent for binary or very large files. */
  patch?: string;
}

export interface Evidence {
  path: string;
  line?: number;
  excerpt?: string;
  note: string;
}

export interface Verification {
  verdict: 'CONFIRMED' | 'REFUTED' | 'UNCERTAIN';
  notes: string;
  model: string;
}

export interface Finding {
  id: string;
  /** Finder dimension that produced it, e.g. "correctness", "concurrency". */
  dimension: string;
  path: string;
  line: number;
  side: Side;
  startLine?: number;
  /** What is wrong, stated as a checkable claim. */
  claim: string;
  /** What happens because of it. */
  consequence: string;
  /** Concrete alternative, if the finder has one. */
  suggestion?: string;
  severity: Severity;
  evidence: Evidence[];
  verification?: Verification;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

export interface AnchorState {
  valid: boolean;
  reason?: string;
}

export interface DraftComment {
  id: string;
  path: string;
  line: number;
  side: Side;
  startLine?: number;
  severity: Severity;
  /** The comment text as it would be posted to GitHub (markdown). */
  body: string;
  status: CommentStatus;
  origin: 'pipeline' | 'manual';
  /** Present for pipeline comments: full provenance. */
  finding?: Finding;
  /** The body as first drafted by the pipeline; the baseline a correction is
   *  measured against. Set once at materialization; absent for manual comments. */
  originalBody?: string;
  chat: ChatMessage[];
  /** Agent SDK session id for the comment's chat thread; set after first message. */
  chatSessionId?: string;
  /** Diff hunk excerpt so the comment renders standalone even if DOM anchoring fails. */
  hunk?: string;
  anchor: AnchorState;
  publishedUrl?: string;
  updatedAt: string;
}

export interface StageProgress {
  stage: PipelineStage;
  status: 'pending' | 'running' | 'done' | 'error';
  /** Short human-readable progress note, e.g. "4 finders running". */
  detail?: string;
  startedAt?: string;
  endedAt?: string;
  /** Accumulated model cost for this stage, USD. */
  costUsd?: number;
}

export interface ReviewDraft {
  /** Stable id: `${owner}__${repo}__${number}`. */
  id: string;
  pr: PrMeta;
  status: ReviewStatus;
  stages: StageProgress[];
  /** Top-level review body (markdown). */
  summary: string;
  verdict: ReviewVerdict;
  comments: DraftComment[];
  /** Findings killed by verification, kept for transparency. */
  dropped: Finding[];
  /** Total model cost of this review (pipeline plus per-comment chats), USD. */
  costUsd?: number;
  /** True when the PR head moved since the pipeline ran. */
  stale?: boolean;
  error?: string;
  published?: { url: string; at: string };
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// SSE events (GET /reviews/:id/events)
// ---------------------------------------------------------------------------

export type RevueEvent =
  | { type: 'stage'; reviewId: string; stage: StageProgress }
  | { type: 'finding'; reviewId: string; finding: Finding }
  | { type: 'finding-verdict'; reviewId: string; findingId: string; verification: Verification; dropped: boolean }
  | { type: 'comment'; reviewId: string; comment: DraftComment }
  | { type: 'comment-removed'; reviewId: string; commentId: string }
  | { type: 'review'; reviewId: string; draft: ReviewDraft }
  | { type: 'chat-delta'; reviewId: string; commentId: string; delta: string }
  | { type: 'chat-done'; reviewId: string; commentId: string; reply: ChatMessage; revisedBody?: string }
  | { type: 'error'; reviewId: string; message: string }
  | { type: 'done'; reviewId: string };

// ---------------------------------------------------------------------------
// HTTP request/response payloads (see docs/API.md)
// ---------------------------------------------------------------------------

export interface CreateReviewRequest extends PrRef {
  /** Re-run the pipeline even if a draft exists. */
  force?: boolean;
}

export interface PatchReviewRequest {
  summary?: string;
  verdict?: ReviewVerdict;
}

export interface PatchCommentRequest {
  body?: string;
  status?: CommentStatus;
  severity?: Severity;
}

export interface AddCommentRequest {
  path: string;
  line: number;
  side: Side;
  startLine?: number;
  body: string;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  reply: ChatMessage;
  /** When the chat produced a concrete rewrite of the comment body. */
  revisedBody?: string;
}

export interface PublishRequest {
  dryRun?: boolean;
}

export interface PublishValidation {
  ok: boolean;
  problems: { commentId: string; reason: string }[];
  willPost: { comments: number; verdict: ReviewVerdict; summaryChars: number };
}

export interface PublishResult {
  url: string;
  at: string;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  mock: boolean;
  /** Present only when the request carried the token. */
  ghUser?: string;
  /** Present only when the request carried the token. */
  dataDir?: string;
}

// ---------------------------------------------------------------------------
// Configuration (revue.config.json, loaded by the daemon)
// ---------------------------------------------------------------------------

export interface ModelsConfig {
  triage: string;
  finder: string;
  verifier: string;
  voice: string;
  chat: string;
}

export interface RevueConfig {
  port: number;
  models: ModelsConfig;
  /** Enabled finder dimensions; see docs/PIPELINE.md for the catalog. */
  finders: string[];
  /** Max concurrent agent sessions (each is a claude subprocess). */
  maxParallel: number;
  /** Per-agent-call timeout (ms); a wedged subprocess aborts at this bound. */
  agentTimeoutMs: number;
  /** Root for review state, workdirs, and the auth secret. Default ~/.revue */
  dataDir: string;
  /** Serve canned pipeline output instead of calling Claude (UI dev / e2e). */
  mock: boolean;
}

/** Full catalog of finder dimensions the pipeline knows how to run. */
export const FINDER_DIMENSIONS = [
  'correctness',
  'concurrency',
  'api-contracts',
  'tests',
  'security',
  'simplicity',
] as const;

/** Model IDs offered in the control page dropdowns (free text also allowed). */
export const KNOWN_MODELS = [
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
] as const;

// ---------------------------------------------------------------------------
// Control page (see docs/CONTROL.md): GET/PUT /config, served at /control.
// ---------------------------------------------------------------------------

/** The subset of config the control page tunes (never exposes the secret). */
export interface ControlConfig {
  models: ModelsConfig;
  finders: string[];
  maxParallel: number;
  agentTimeoutMs: number;
  port: number;
  mock: boolean;
}

export interface ControlData {
  config: ControlConfig;
  preferences: { voice: string; priorities: string; learnings: string };
  /** Full finder catalog, for the checkbox list. */
  availableFinders: string[];
  /** Suggested model IDs for the dropdowns. */
  knownModels: string[];
  /** Absolute path of the config file writes land in. */
  configPath: string;
}

export interface UpdateControlRequest {
  models?: Partial<ModelsConfig>;
  finders?: string[];
  maxParallel?: number;
  agentTimeoutMs?: number;
  preferences?: { voice?: string; priorities?: string; learnings?: string };
}

// ---------------------------------------------------------------------------
// Style bootstrap (see docs/STYLE.md): profiles the user's public GitHub PR
// comments and proposes voice.md/priorities.md rewrites, staged behind an
// explicit apply. Exchanged on /style/bootstrap and /style/bootstrap/apply.
// ---------------------------------------------------------------------------

/** Where a corpus comment came from: an inline diff comment, a review's
 *  top-level body, or the PR conversation thread. */
export type StyleCommentKind = 'review-comment' | 'review-summary' | 'discussion';
/** The user's role on the PR the comment was made on. */
export type StyleCommentRole = 'reviewer' | 'author';

export interface StyleCorpusStats {
  comments: number;
  byKind: Record<StyleCommentKind, number>;
  byRole: Record<StyleCommentRole, number>;
  repos: number;
  /** Most-sampled repos, `owner/name`, largest first. */
  topRepos: string[];
  /** ISO timestamps of the oldest and newest comment sampled. */
  oldest?: string;
  newest?: string;
  chars: number;
  /** True when more usable comments existed than the sampling caps allowed. */
  truncated: boolean;
}

/** One evidence-backed trait; quotes are verbatim corpus excerpts. */
export interface StyleObservation {
  observation: string;
  evidence: string[];
}

export interface StyleProfile {
  /** How they write: register, formatting habits, phrasing. */
  linguistic: StyleObservation[];
  /** How they engage: directness, disagreement, praise, framing. */
  interactional: StyleObservation[];
  /** What they review for: dimensions, altitude, severity habits. */
  technical: StyleObservation[];
  /** Sample-quality caveats: size, repo skew, timespan. */
  caveats: string;
}

/** Proposed preference-file rewrites; nothing is written until apply. */
export interface StyleProposal {
  voiceMd: string;
  prioritiesMd: string;
}

export interface StyleProgress {
  phase: 'searching' | 'collecting' | 'analyzing';
  prsScanned: number;
  prsTotal?: number;
  comments: number;
}

export type StyleBootstrapState =
  | { status: 'idle' }
  | { status: 'running'; login?: string; progress: StyleProgress; startedAt: string }
  | {
      status: 'ready';
      login: string;
      stats: StyleCorpusStats;
      profile: StyleProfile;
      proposal: StyleProposal;
      finishedAt: string;
      /** Set once the proposal has been written to the preference files. */
      appliedAt?: string;
    }
  | { status: 'error'; message: string; login?: string };

/** Body of POST /style/bootstrap/apply; fields override the stored proposal
 *  (the control page lets you edit the text before applying). */
export interface ApplyStyleRequest {
  voiceMd?: string;
  prioritiesMd?: string;
}

// ---------------------------------------------------------------------------
// Chat quick actions (rendered as one-click buttons in the comment chat UI)
// ---------------------------------------------------------------------------

export interface QuickAction {
  id: string;
  label: string;
  message: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'tighten',
    label: 'Tighten',
    message:
      'Tighten this comment. Keep the claim-consequence-fix structure, cut anything that does not change what the author would do next. Return the revised comment.',
  },
  {
    id: 'soften',
    label: 'Make it a nit',
    message:
      'Downgrade this to a nit: prefix with "nit:", make it one or two sentences, suggestion-framed. Return the revised comment.',
  },
  {
    id: 'verify',
    label: 'Re-verify',
    message:
      'Re-verify this claim against the repository. Read the relevant code and state exactly what you checked and whether the claim holds. If it does not hold, say so plainly.',
  },
  {
    id: 'steelman',
    label: 'Steelman the author',
    message:
      "Argue the author's side: is this comment wrong, or not worth making? Give the strongest case against posting it, then your verdict.",
  },
  {
    id: 'evidence',
    label: 'Show evidence',
    message:
      'Walk me through the evidence for this finding: the exact code paths, what you read, and how each piece supports the claim.',
  },
];
