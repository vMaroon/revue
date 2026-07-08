// DaemonClient over the background relay: every HTTP call is a BgRequest
// round-trip through the service worker; SSE rides a long-lived port.

import type {
  ChatResponse,
  DraftComment,
  HealthResponse,
  PatchCommentRequest,
  PatchReviewRequest,
  PrRef,
  ReviewDraft,
} from '@revue/shared';
import type { BgRequest, BgResponse, DaemonClient, SsePortMessage } from './lib/contract';
import { SSE_PORT_PREFIX } from './lib/contract';

export class RevueHttpError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'RevueHttpError';
    this.status = status;
  }
}

async function request<T>(method: BgRequest['method'], path: string, body?: unknown): Promise<T> {
  const req: BgRequest = { kind: 'http', method, path, body };
  let res: BgResponse | undefined;
  try {
    res = (await chrome.runtime.sendMessage(req)) as BgResponse | undefined;
  } catch (err) {
    throw new RevueHttpError(err instanceof Error ? err.message : String(err));
  }
  if (!res) throw new RevueHttpError('no response from the service worker');
  if (!res.ok) throw new RevueHttpError(res.error, res.status);
  return res.data as T;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

export function createDaemonClient(): DaemonClient {
  return {
    async health() {
      try {
        return await request<HealthResponse>('GET', '/health');
      } catch {
        return null;
      }
    },

    createReview(pr: PrRef, force?: boolean, focus?: string) {
      return request<ReviewDraft>('POST', '/reviews', {
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
        force,
        focus,
      });
    },

    async getReviewByPr(pr: PrRef) {
      const query =
        `owner=${encodeURIComponent(pr.owner)}` +
        `&repo=${encodeURIComponent(pr.repo)}` +
        `&number=${pr.number}`;
      try {
        return await request<ReviewDraft>('GET', `/reviews?${query}`);
      } catch (err) {
        if (err instanceof RevueHttpError && err.status === 404) return null;
        throw err;
      }
    },

    patchReview(id: string, patch: PatchReviewRequest) {
      return request<ReviewDraft>('PATCH', `/reviews/${encodeURIComponent(id)}`, patch);
    },

    patchComment(id: string, cid: string, patch: PatchCommentRequest) {
      return request<DraftComment>(
        'PATCH',
        `/reviews/${encodeURIComponent(id)}/comments/${encodeURIComponent(cid)}`,
        patch,
      );
    },

    chat(id: string, cid: string, message: string) {
      return request<ChatResponse>(
        'POST',
        `/reviews/${encodeURIComponent(id)}/comments/${encodeURIComponent(cid)}/chat`,
        { message },
      );
    },

    openControlPage() {
      void chrome.runtime.sendMessage({ kind: 'open-control' }).catch(() => {
        // service worker asleep or gone; nothing to surface
      });
    },

    subscribe(id, onEvent, onStatus) {
      let active = true;
      let delay = RECONNECT_MIN_MS;
      let timer: number | undefined;
      let port: chrome.runtime.Port | null = null;

      const connect = (): void => {
        if (!active) return;
        const p = chrome.runtime.connect({ name: SSE_PORT_PREFIX + id });
        port = p;
        p.onMessage.addListener((raw) => {
          const msg = raw as SsePortMessage;
          if (msg.kind === 'event') {
            onEvent(msg.event);
            return;
          }
          if (msg.state === 'open') delay = RECONNECT_MIN_MS;
          onStatus?.(msg);
        });
        p.onDisconnect.addListener(() => {
          if (port === p) port = null;
          if (!active) return;
          timer = setTimeout(() => {
            timer = undefined;
            connect();
          }, delay);
          delay = Math.min(delay * 2, RECONNECT_MAX_MS);
        });
      };

      connect();

      return () => {
        active = false;
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (port) {
          try {
            port.disconnect();
          } catch {
            // already disconnected
          }
          port = null;
        }
      };
    },
  };
}
