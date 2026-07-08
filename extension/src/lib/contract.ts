// Contracts between the extension's modules. content.ts (bootstrap),
// background.ts (network relay), anchor.ts (DOM adapter), and ui/* (panel,
// cards, chat) each implement or consume exactly these shapes.
// See docs/EXTENSION.md for behavior requirements.

import type {
  ChatResponse,
  DraftComment,
  HealthResponse,
  PatchCommentRequest,
  PatchReviewRequest,
  PrRef,
  RevueEvent,
  ReviewDraft,
  Side,
} from '@revue/shared';

// ---------------------------------------------------------------------------
// Content script <-> service worker messaging. All daemon traffic goes
// through the service worker (content scripts share github.com's origin and
// cannot attach the auth header cross-origin reliably; the worker can).
// ---------------------------------------------------------------------------

/** chrome.runtime.sendMessage payloads handled by background.ts */
export type BgRequest = {
  kind: 'http';
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Daemon path starting with '/', e.g. '/reviews'. */
  path: string;
  body?: unknown;
};

/** Sent by the panel; the service worker opens the daemon control page (it
 *  holds the port + token, so the token never enters the content script). */
export type OpenControlMessage = { kind: 'open-control' };

export type BgResponse =
  | { ok: true; status: number; data: unknown }
  | { ok: false; error: string; status?: number };

/**
 * SSE relay: the content script opens chrome.runtime.connect with name
 * `${SSE_PORT_PREFIX}${reviewId}`; background.ts opens the daemon SSE stream
 * (fetch + ReadableStream) and posts each parsed RevueEvent on the port as
 * {kind: 'event', event}, plus {kind: 'sse-status', state: 'open'|'closed'|'error'}.
 * Disconnecting the port aborts the fetch.
 */
export const SSE_PORT_PREFIX = 'revue-sse:';
export type SsePortMessage =
  | { kind: 'event'; event: RevueEvent }
  | { kind: 'sse-status'; state: 'open' | 'closed' | 'error'; detail?: string };

/** chrome.storage.sync keys set by the options page. */
export interface ExtensionSettings {
  daemonPort: number; // default 7388
  token: string; // contents of ${dataDir}/secret
}
export const DEFAULT_SETTINGS: ExtensionSettings = { daemonPort: 7388, token: '' };

// ---------------------------------------------------------------------------
// Daemon client (implemented in src/daemon.ts, consumed by ui/*)
// ---------------------------------------------------------------------------

export interface DaemonClient {
  health(): Promise<HealthResponse | null>;
  /** POST /reviews — creates or returns existing; force re-runs the pipeline,
   *  focus steers the run (see CreateReviewRequest.focus). */
  createReview(pr: PrRef, force?: boolean, focus?: string): Promise<ReviewDraft>;
  /** GET /reviews?owner=&repo=&number= — null when no draft exists. */
  getReviewByPr(pr: PrRef): Promise<ReviewDraft | null>;
  patchReview(id: string, patch: PatchReviewRequest): Promise<ReviewDraft>;
  patchComment(id: string, cid: string, patch: PatchCommentRequest): Promise<DraftComment>;
  /** Resolves with the final reply; deltas arrive on the SSE stream. */
  chat(id: string, cid: string, message: string): Promise<ChatResponse>;
  /** Opens the daemon control page in a new tab (via the service worker). */
  openControlPage(): void;
  /** Opens the SSE relay; returns an unsubscribe function. */
  subscribe(id: string, onEvent: (e: RevueEvent) => void, onStatus?: (s: SsePortMessage & { kind: 'sse-status' }) => void): () => void;
}

// ---------------------------------------------------------------------------
// DOM adapter (implemented in src/anchor.ts, consumed by ui/*)
// ---------------------------------------------------------------------------

export interface Anchorer {
  /** PR the current page shows, or null when not a PR page. */
  getPrRef(): PrRef | null;
  /** True when the "Files changed" diff is present in the DOM. */
  onFilesTab(): boolean;
  /**
   * Inserts `el` directly below the diff row for (path, line, side).
   * Returns false when the row cannot be found (file collapsed, virtualized
   * out, or unknown DOM shape) — the caller then falls back to panel-only
   * rendering for that comment.
   */
  injectBelow(path: string, line: number, side: Side, el: HTMLElement): boolean;
  /** Scrolls the diff row into view; false when not found. */
  scrollTo(path: string, line: number, side: Side): boolean;
  /**
   * Fires on SPA navigations (turbo) and on diff DOM mutations that require
   * re-anchoring (files expanding/collapsing, lazy-loaded diffs).
   * Debounced by the implementation.
   */
  observe(onRelayout: () => void): void;
}

// ---------------------------------------------------------------------------
// UI (implemented in src/ui/panel.ts, consumed by content.ts)
// ---------------------------------------------------------------------------

export interface PanelHandle {
  /** Replace the whole draft (initial load, 'review' events). */
  setDraft(draft: ReviewDraft | null): void;
  /** Incremental SSE event; panel updates itself and any overlay cards. */
  handleEvent(e: RevueEvent): void;
  setDaemonStatus(state: 'ok' | 'down' | 'unauthorized'): void;
  /** Show/hide the side panel (wired to the toolbar action button). */
  toggle(): void;
  /** Tear down panel + overlay cards (SPA navigation away from the PR). */
  destroy(): void;
}

/**
 * Mounts the shadow-DOM panel and takes over rendering: overlay cards on the
 * diff (via anchorer), the side panel (progress, comment list, summary
 * editor, review-focus input), and per-comment chat threads. Accepted
 * comments live in the viewer's pending GitHub review; the review is
 * submitted from GitHub's own UI.
 */
export type MountPanel = (client: DaemonClient, anchorer: Anchorer, pr: PrRef) => PanelHandle;
