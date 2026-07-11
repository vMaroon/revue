// Bootstrap: runs on every github.com page, detects PR routes (including
// soft SPA navigations), mounts/destroys the panel, loads the initial draft,
// and wires the SSE subscription when a draft exists or Run review creates
// one.

import type { PrRef, RevueEvent } from '@revue/shared';
import type { PanelHandle } from './lib/contract';
import { createAnchorer } from './anchor';
import { createDaemonClient, RevueHttpError } from './daemon';
import { mountPanel } from './ui/panel';

const client = createDaemonClient();

interface Mounted {
  pr: PrRef;
  panel: PanelHandle;
  unsubscribe: (() => void) | null;
}

let mounted: Mounted | null = null;
// Route evaluations are serialized: rapid turbo events must not double-mount.
let routeQueue: Promise<void> = Promise.resolve();

function samePr(a: PrRef, b: PrRef): boolean {
  return a.owner === b.owner && a.repo === b.repo && a.number === b.number;
}

// One subscription per mount: review ids are stable per PR, so a re-run
// streams over the same subscription. The event hub does not replay, so on
// every stream open (first connect and each reconnect) the draft is refetched
// once to reconcile frames emitted before the stream was listening.
function wireSubscription(m: Mounted, id: string): void {
  if (m.unsubscribe) return;
  m.unsubscribe = client.subscribe(
    id,
    (e: RevueEvent) => {
      if (mounted === m) m.panel.handleEvent(e);
    },
    (s) => {
      if (s.state !== 'open' || mounted !== m) return;
      client
        .getReviewByPr(m.pr)
        .then((draft) => {
          if (mounted === m && draft) m.panel.setDraft(draft);
        })
        .catch(() => {
          // refetch is best-effort; the next event or reconnect reconciles
        });
    },
  );
}

async function evaluateRoute(): Promise<void> {
  const anchorer = createAnchorer();
  const pr = anchorer.getPrRef();

  if (mounted && (!pr || !samePr(mounted.pr, pr))) {
    mounted.unsubscribe?.();
    mounted.panel.destroy();
    mounted = null;
  }
  if (!pr || mounted) return;

  const panel = mountPanel(client, anchorer, pr, (draft) => {
    // Run review created the draft after mount; start streaming its events.
    if (mounted && samePr(mounted.pr, pr)) wireSubscription(mounted, draft.id);
  });
  const m: Mounted = { pr, panel, unsubscribe: null };
  mounted = m;

  const health = await client.health();
  if (mounted !== m) return; // navigated away while loading
  panel.setDaemonStatus(health ? 'ok' : 'down');
  if (!health) {
    panel.setDraft(null);
    return;
  }

  try {
    const draft = await client.getReviewByPr(pr); // 404 → null → "Run review" state
    if (mounted !== m) return;
    panel.setDraft(draft);
    if (draft) wireSubscription(m, draft.id);
  } catch (err) {
    if (mounted !== m) return;
    if (err instanceof RevueHttpError && err.status === 401) {
      panel.setDaemonStatus('unauthorized');
    }
    panel.setDraft(null);
  }
}

let scheduleTimer: number | undefined;
function scheduleRouteCheck(): void {
  if (scheduleTimer !== undefined) clearTimeout(scheduleTimer);
  scheduleTimer = setTimeout(() => {
    scheduleTimer = undefined;
    routeQueue = routeQueue.then(evaluateRoute).catch(() => {
      // a failed evaluation must not wedge the queue
    });
  }, 150);
}

for (const ev of ['turbo:load', 'turbo:render', 'popstate']) {
  window.addEventListener(ev, scheduleRouteCheck);
}

// Fallback for soft navigations that fire no turbo events: the title changes
// on every GitHub page transition.
const titleEl = document.querySelector('head > title');
if (titleEl) {
  new MutationObserver(scheduleRouteCheck).observe(titleEl, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if ((message as { kind?: unknown } | undefined)?.kind === 'toggle-panel') {
    mounted?.panel.toggle();
  }
});

routeQueue = routeQueue.then(evaluateRoute).catch(() => {});
