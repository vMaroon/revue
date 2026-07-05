// MV3 service worker: relays daemon HTTP and SSE traffic for the content
// script (which runs with github.com's origin and cannot attach the auth
// header cross-origin), and forwards the toolbar action click as a
// toggle-panel message to the active tab.

import type { RevueEvent } from '@revue/shared';
import type { BgRequest, BgResponse, ExtensionSettings, SsePortMessage } from './lib/contract';
import { DEFAULT_SETTINGS, SSE_PORT_PREFIX } from './lib/contract';

async function getSettings(): Promise<ExtensionSettings> {
  try {
    const stored = (await chrome.storage.sync.get(DEFAULT_SETTINGS)) as Partial<ExtensionSettings>;
    return {
      daemonPort:
        typeof stored.daemonPort === 'number' && Number.isFinite(stored.daemonPort)
          ? stored.daemonPort
          : DEFAULT_SETTINGS.daemonPort,
      token: typeof stored.token === 'string' ? stored.token : DEFAULT_SETTINGS.token,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// ---------------------------------------------------------------------------
// One-shot HTTP relay
// ---------------------------------------------------------------------------

async function handleHttp(req: BgRequest): Promise<BgResponse> {
  const settings = await getSettings();
  const url = `http://127.0.0.1:${settings.daemonPort}${req.path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: req.method,
      headers: {
        'X-Revue-Token': settings.token,
        ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
    });
  } catch (err) {
    // Network failure: no status, so the client can distinguish "daemon down".
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const text = await res.text();
  let data: unknown = null;
  if (text !== '') {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (res.ok) return { ok: true, status: res.status, data };
  let error = `HTTP ${res.status}`;
  if (data !== null && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    error = (data as { error: string }).error;
  } else if (typeof data === 'string' && data !== '') {
    error = data;
  } else if (data !== null && typeof data === 'object') {
    // e.g. publish 409 returns a PublishValidation body; keep it readable.
    error = JSON.stringify(data);
  }
  return { ok: false, error, status: res.status };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const req = message as Partial<BgRequest> | undefined;
  if (!req || req.kind !== 'http') return;
  void handleHttp(req as BgRequest).then(sendResponse);
  return true; // keep sendResponse valid across the async work
});

// ---------------------------------------------------------------------------
// SSE relay over long-lived ports
// ---------------------------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith(SSE_PORT_PREFIX)) return;
  const reviewId = port.name.slice(SSE_PORT_PREFIX.length);
  void relaySse(port, reviewId);
});

async function relaySse(port: chrome.runtime.Port, reviewId: string): Promise<void> {
  const controller = new AbortController();
  let disconnected = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
    controller.abort();
  });

  const post = (msg: SsePortMessage): void => {
    if (disconnected) return;
    try {
      port.postMessage(msg);
    } catch {
      disconnected = true;
    }
  };
  const finish = (msg: SsePortMessage): void => {
    post(msg);
    if (!disconnected) {
      disconnected = true;
      try {
        port.disconnect();
      } catch {
        // port already gone
      }
    }
  };

  const settings = await getSettings();
  const url =
    `http://127.0.0.1:${settings.daemonPort}` +
    `/reviews/${encodeURIComponent(reviewId)}/events?token=${encodeURIComponent(settings.token)}`;

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (!controller.signal.aborted) {
      finish({ kind: 'sse-status', state: 'error', detail: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (!res.ok || !res.body) {
    finish({ kind: 'sse-status', state: 'error', detail: `HTTP ${res.status}` });
    return;
  }

  post({ kind: 'sse-status', state: 'open' });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        // Blank separators and ':hb' heartbeat comments carry no data.
        if (!line.startsWith('data:')) continue;
        const payload = line.slice('data:'.length).trimStart();
        if (payload === '') continue;
        try {
          post({ kind: 'event', event: JSON.parse(payload) as RevueEvent });
        } catch {
          // malformed frame: skip it rather than kill the stream
        }
      }
    }
    finish({ kind: 'sse-status', state: 'closed' });
  } catch (err) {
    if (controller.signal.aborted) return; // client disconnected on purpose
    finish({ kind: 'sse-status', state: 'error', detail: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------
// Toolbar action → toggle panel in the active tab
// ---------------------------------------------------------------------------

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  void chrome.tabs.sendMessage(tab.id, { kind: 'toggle-panel' }).catch(() => {
    // no content script in this tab (not a github.com page)
  });
});
