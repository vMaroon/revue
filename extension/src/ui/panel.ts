// Panel orchestration: shadow-DOM host with the floating button and side
// panel, overlay-card lifecycle through the anchorer, and reconciliation of
// every RevueEvent into the single held ReviewDraft. Accepted comments live
// in the viewer's pending GitHub review; the footer links to GitHub's own
// submit flow.

import type {
  DraftComment,
  Finding,
  PipelineStage,
  ReviewDraft,
  RevueEvent,
  Severity,
} from '@revue/shared';
import type { MountPanel } from '../lib/contract';
import { createCard, type CardContext, type CardHandle } from './card';
import { clear, errorMessage, h, isolateKeys } from './dom';
import { styles } from './styles';

const STAGES: { id: PipelineStage; label: string }[] = [
  { id: 'context', label: 'Context' },
  { id: 'triage', label: 'Triage' },
  { id: 'find', label: 'Find' },
  { id: 'verify', label: 'Verify' },
  { id: 'draft', label: 'Draft' },
];

const SEVERITY_ORDER: Record<Severity, number> = { blocking: 0, suggestion: 1, nit: 2 };

export const mountPanel: MountPanel = (client, anchorer, pr, onDraftCreated) => {
  // Draft ids are deterministic, so the review can be addressed before the
  // first snapshot arrives.
  const reviewId = `${pr.owner}__${pr.repo}__${pr.number}`;

  let draft: ReviewDraft | null = null;
  let destroyed = false;
  let panelOpen = false;
  let daemonStatus: 'ok' | 'down' | 'unauthorized' = 'ok';
  let runBusy = false;
  let notice: string | null = null;
  let droppedOpen = false;
  let listDirty = false;
  let summaryTimer: number | undefined;
  // The focus input belongs to the user once touched; only an untouched
  // input adopts the draft's stored focus.
  let focusTouched = false;

  const liveFindings = new Map<string, Finding>();
  const expandedIds = new Set<string>();
  const overlayCards = new Map<string, { host: HTMLElement; card: CardHandle }>();
  const panelCards = new Map<string, CardHandle>();

  // ---- shadow host -------------------------------------------------------
  const host = document.createElement('revue-root');
  const root = host.attachShadow({ mode: 'open' });
  isolateKeys(root);
  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  root.appendChild(styleEl);

  // ---- floating button ---------------------------------------------------
  const fabDot = h('span', { class: 'rv-fab-dot rv-status-ok' });
  const fabCount = h('span', { class: 'rv-fab-count rv-hidden' }, '0');
  const fab = h('button', { class: 'rv-fab', title: 'Revue', onclick: () => toggle() }, h('span', { class: 'rv-fab-mark' }, 'R'), fabDot, fabCount);
  root.appendChild(fab);

  // ---- panel skeleton; persistent form controls keep focus across renders -
  const headBox = h('div', { class: 'rv-head' });
  // Re-rendered head parts; the focus input between them is persistent so
  // typing survives stage-event re-renders.
  const headTop = h('div');
  const headActionsBox = h('div', { class: 'rv-head-actions' });
  const bannerBox = h('div');
  const stagesBox = h('div');
  const listBox = h('div');
  const footBox = h('div', { class: 'rv-foot' });

  const summaryInput = h('textarea', { class: 'rv-input rv-summary-input', rows: 5, placeholder: 'Review summary (markdown)' });
  const verdictHint = h('span', { class: 'rv-muted rv-verdict-hint' });
  const summarySection = h(
    'div',
    { class: 'rv-section rv-hidden' },
    h(
      'div',
      { class: 'rv-section-title rv-section-title-row', title: 'Doubles as the body of your pending GitHub review' },
      h('span', {}, 'Summary (pending review body)'),
      verdictHint,
    ),
    summaryInput,
  );

  // Free-text focus for the next pipeline run, e.g. "concurrency in the
  // producer path; ignore test files".
  const focusInput = h('textarea', {
    class: 'rv-input rv-focus-input',
    rows: 2,
    placeholder: 'Focus this review (optional): what to weight, what to ignore',
  });
  focusInput.addEventListener('input', () => {
    focusTouched = true;
  });

  const bodyEl = h('div', { class: 'rv-body' }, bannerBox, stagesBox, summarySection, listBox);
  headBox.appendChild(headTop);
  headBox.appendChild(focusInput);
  headBox.appendChild(headActionsBox);
  const panelEl = h('section', { class: 'rv-panel' }, headBox, bodyEl, footBox);
  root.appendChild(panelEl);
  document.body.appendChild(host);

  summaryInput.addEventListener('input', () => {
    if (!draft) return;
    if (summaryTimer !== undefined) clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => {
      summaryTimer = undefined;
      client
        .patchReview(reviewId, { summary: summaryInput.value })
        .then((d) => {
          if (!destroyed) {
            draft = d;
            renderAll();
          }
        })
        .catch((e) => {
          if (!destroyed) showNotice(`Saving summary failed: ${errorMessage(e)}`);
        });
    }, 600);
  });

  // List re-renders are deferred while the user types inside a card so the
  // focused element is not detached mid-keystroke.
  listBox.addEventListener('focusout', () => {
    if (!listDirty || destroyed) return;
    setTimeout(() => {
      if (destroyed || !listDirty) return;
      const active = root.activeElement;
      if (active && listBox.contains(active) && isTextEntry(active)) return;
      renderList();
    }, 0);
  });

  function isTextEntry(el: Element): boolean {
    return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement;
  }

  // ---- draft helpers -----------------------------------------------------

  function findComment(id: string): DraftComment | undefined {
    return draft?.comments.find((c) => c.id === id);
  }

  function upsertComment(c: DraftComment): void {
    if (!draft) return;
    const idx = draft.comments.findIndex((x) => x.id === c.id);
    if (idx >= 0) draft.comments[idx] = c;
    else draft.comments.push(c);
  }

  function cardCtx(commentId: string, startExpanded = false): CardContext {
    return {
      client,
      reviewId,
      startExpanded,
      onLocalUpdate: (c) => {
        upsertComment(c);
        overlayCards.get(c.id)?.card.update(c);
        panelCards.get(c.id)?.update(c);
        renderList();
        renderFoot();
        updateFab();
      },
      scrollTo: () => {
        const c = findComment(commentId);
        if (c) anchorer.scrollTo(c.path, c.line, c.side);
      },
      fileUrl,
    };
  }

  // Links an evidence path/line to its file at the exact commit the pipeline
  // read (headSha), so the target matches what the finding cites. Undefined
  // until the first snapshot carries the PR head.
  function fileUrl(path: string, line?: number): string | undefined {
    const meta = draft?.pr;
    if (!meta) return undefined;
    const segments = path.split('/').map(encodeURIComponent).join('/');
    const url = `https://github.com/${meta.owner}/${meta.repo}/blob/${meta.headSha}/${segments}`;
    return line !== undefined ? `${url}#L${line}` : url;
  }

  // Panel rows are a navigator: click jumps to the inline card in the diff and
  // expands it. Only when the comment can't be anchored (anchor miss, or the
  // file is virtualized out of the DOM) does it fall back to expanding in the
  // panel, so nothing is unreachable.
  function navigateToComment(c: DraftComment): void {
    const scrolled = anchorer.scrollTo(c.path, c.line, c.side);
    if (scrolled) {
      syncOverlay();
      overlayCards.get(c.id)?.card.setExpanded(true);
      expandedIds.delete(c.id);
    } else {
      if (expandedIds.has(c.id)) expandedIds.delete(c.id);
      else expandedIds.add(c.id);
    }
    renderList();
  }

  function pruneCards(): void {
    const ids = new Set((draft?.comments ?? []).map((c) => c.id));
    for (const [id, entry] of overlayCards) {
      if (!ids.has(id)) {
        entry.host.remove();
        overlayCards.delete(id);
      }
    }
    for (const id of [...panelCards.keys()]) if (!ids.has(id)) panelCards.delete(id);
    for (const id of [...expandedIds]) if (!ids.has(id)) expandedIds.delete(id);
  }

  function dropCardsFor(commentId: string): void {
    overlayCards.get(commentId)?.host.remove();
    overlayCards.delete(commentId);
    panelCards.delete(commentId);
    expandedIds.delete(commentId);
  }

  // ---- overlay cards -----------------------------------------------------

  function syncOverlay(): void {
    if (destroyed) return;
    if (!anchorer.onFilesTab()) return;
    for (const c of draft?.comments ?? []) {
      let entry = overlayCards.get(c.id);
      if (!entry) {
        const cardHost = document.createElement('revue-root');
        cardHost.dataset['revueCommentId'] = c.id;
        const shadow = cardHost.attachShadow({ mode: 'open' });
        isolateKeys(shadow);
        const st = document.createElement('style');
        st.textContent = styles;
        shadow.appendChild(st);
        const card = createCard(c, cardCtx(c.id));
        shadow.appendChild(card.el);
        entry = { host: cardHost, card };
        overlayCards.set(c.id, entry);
      } else {
        entry.card.update(c);
      }
      // Re-injection is idempotent: connected hosts are left alone.
      if (!entry.host.isConnected) {
        const ok = anchorer.injectBelow(c.path, c.line, c.side, entry.host);
        entry.card.setAnchored(ok);
        panelCards.get(c.id)?.setAnchored(ok);
      }
    }
  }

  // ---- panel sections ----------------------------------------------------

  function renderHead(): void {
    clear(headTop);
    headTop.appendChild(
      h(
        'div',
        { class: 'rv-head-row' },
        h('span', { class: 'rv-logo' }, 'Revue'),
        h('span', { class: 'rv-pr-ref' }, `${pr.owner}/${pr.repo} #${pr.number}`),
        draft ? h('span', { class: `rv-status-chip rv-status-chip-${draft.status}` }, draft.status) : null,
        h('button', { class: 'rv-icon-btn', title: 'Tune the pipeline (control page)', onclick: () => client.openControlPage() }, 'tune'),
        h('button', { class: 'rv-icon-btn', title: 'Close panel', onclick: () => toggle() }, 'x'),
      ),
    );
    if (draft) headTop.appendChild(h('div', { class: 'rv-head-title', title: draft.pr.title }, draft.pr.title));
    // An untouched input adopts the focus the current draft ran with.
    if (!focusTouched && draft?.focus !== undefined && root.activeElement !== focusInput) {
      focusInput.value = draft.focus;
    }
    clear(headActionsBox);
    headActionsBox.appendChild(runButton());
  }

  function runButton(): HTMLElement {
    const hasRun = draft !== null && draft.status !== 'pending';
    const running = draft !== null && draft.status === 'running';
    const label = runBusy ? 'Starting...' : running ? 'Running...' : hasRun ? 'Re-run review' : 'Run review';
    return h('button', { class: 'rv-btn rv-btn-primary', disabled: runBusy || running || undefined, onclick: () => void onRun() }, label);
  }

  async function onRun(): Promise<void> {
    if (runBusy) return;
    const rerun = draft !== null && draft.status !== 'pending';
    if (
      rerun &&
      !confirm(
        'Re-run the review? Current comments are discarded and any synced ones are retracted from your pending GitHub review.',
      )
    ) {
      return;
    }
    runBusy = true;
    notice = null;
    renderHead();
    renderBanners();
    try {
      const focus = focusInput.value.trim();
      const d = await client.createReview(pr, rerun, focus === '' ? undefined : focus);
      if (destroyed) return;
      liveFindings.clear();
      draft = d;
      renderAll();
      onDraftCreated?.(d);
    } catch (e) {
      if (!destroyed) showNotice(`Run failed: ${errorMessage(e)}`);
    }
    runBusy = false;
    if (!destroyed) renderHead();
  }

  function renderBanners(): void {
    clear(bannerBox);
    if (daemonStatus === 'down') {
      bannerBox.appendChild(h('div', { class: 'rv-banner rv-banner-error' }, 'Revue daemon is unreachable. Start it, or check the port in the extension options.'));
    } else if (daemonStatus === 'unauthorized') {
      bannerBox.appendChild(h('div', { class: 'rv-banner rv-banner-error' }, 'The daemon rejected the token. Paste the current secret in the extension options.'));
    }
    if (notice) {
      bannerBox.appendChild(
        h('div', { class: 'rv-banner rv-banner-error' }, notice, h('button', { class: 'rv-link rv-banner-dismiss', onclick: () => { notice = null; renderBanners(); } }, 'dismiss')),
      );
    }
    if (draft?.stale) {
      bannerBox.appendChild(h('div', { class: 'rv-banner rv-banner-warn' }, 'The PR head moved since this review ran; results may be stale. Re-run to refresh.'));
    }
    if (draft?.error) {
      bannerBox.appendChild(h('div', { class: 'rv-banner rv-banner-error' }, `Pipeline error: ${draft.error}`));
    }
  }

  function renderStages(): void {
    clear(stagesBox);
    if (!draft) return;
    const show = draft.status === 'running' || draft.stages.some((s) => s.status !== 'pending');
    if (!show) return;
    const total = draft.costUsd;
    const title = h(
      'div',
      { class: 'rv-section-title rv-section-title-row' },
      h('span', {}, 'Pipeline'),
      total !== undefined && total > 0
        ? h('span', { class: 'rv-cost-total', title: 'Total model cost of this review' }, formatCost(total))
        : null,
    );
    const list = h('div', { class: 'rv-section' }, title);
    for (const def of STAGES) {
      const p = draft.stages.find((s) => s.stage === def.id);
      const status = p?.status ?? 'pending';
      list.appendChild(
        h(
          'div',
          { class: `rv-stage rv-stage-${status}` },
          h('span', { class: 'rv-stage-dot' }),
          h('span', { class: 'rv-stage-name' }, def.label),
          p?.detail ? h('span', { class: 'rv-stage-detail', title: p.detail }, p.detail) : null,
          p?.costUsd ? h('span', { class: 'rv-stage-cost' }, formatCost(p.costUsd)) : null,
        ),
      );
    }
    if (draft.status === 'running' && liveFindings.size > 0) {
      list.appendChild(h('div', { class: 'rv-stage-findings rv-muted' }, `${liveFindings.size} finding${liveFindings.size === 1 ? '' : 's'} surfaced so far`));
    }
    stagesBox.appendChild(list);
  }

  function syncSummaryControls(): void {
    if (!draft) return;
    const active = root.activeElement;
    if (active !== summaryInput && summaryTimer === undefined) summaryInput.value = draft.summary;
    verdictHint.textContent = `pipeline suggests: ${draft.verdict}`;
  }

  // ---- comment list ------------------------------------------------------

  function renderList(): void {
    if (destroyed) return;
    const active = root.activeElement;
    if (active && listBox.contains(active) && isTextEntry(active)) {
      listDirty = true;
      return;
    }
    listDirty = false;
    clear(listBox);
    listBox.appendChild(renderCommentList());
  }

  function renderCommentList(): HTMLElement {
    const box = h('div', { class: 'rv-section' });
    if (!draft) return box;
    const comments = draft.comments;
    box.appendChild(h('div', { class: 'rv-section-title' }, `Comments (${comments.length})`));
    if (comments.length === 0) {
      box.appendChild(h('div', { class: 'rv-empty' }, draft.status === 'running' ? 'Comments appear here as the pipeline drafts them.' : 'No draft comments.'));
    } else {
      const byFile = new Map<string, DraftComment[]>();
      for (const c of comments) {
        const group = byFile.get(c.path);
        if (group) group.push(c);
        else byFile.set(c.path, [c]);
      }
      for (const path of [...byFile.keys()].sort()) {
        const group = byFile.get(path) ?? [];
        group.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line);
        box.appendChild(h('div', { class: 'rv-file-head', title: path }, path));
        for (const c of group) box.appendChild(renderRow(c));
      }
    }
    const dropped = renderDropped();
    if (dropped) box.appendChild(dropped);
    return box;
  }

  function renderRow(c: DraftComment): HTMLElement {
    // The full card shows in the panel only as an anchor-miss fallback.
    const inlineInjected = overlayCards.get(c.id)?.host.isConnected ?? false;
    const isOpen = expandedIds.has(c.id) && !inlineInjected;
    const baseName = c.path.split('/').pop() ?? c.path;
    const row = h(
      'div',
      { class: `rv-row${c.status === 'discarded' ? ' rv-row-discarded' : ''}${isOpen ? ' rv-row-open' : ''}` },
      h(
        'button',
        {
          class: 'rv-row-head',
          title: `Jump to ${c.path}:${c.line}`,
          onclick: () => navigateToComment(c),
        },
        h('span', { class: `rv-chip rv-chip-${c.severity}` }, c.severity),
        h('span', { class: 'rv-row-loc' }, `${baseName}:${c.line}`),
        c.finding?.verification?.verdict === 'UNCERTAIN' ? h('span', { class: 'rv-badge rv-badge-unverified' }, 'unverified') : null,
        c.status === 'accepted' ? h('span', { class: 'rv-badge rv-badge-accepted', title: 'In your pending GitHub review' }, 'pending') : null,
        c.status === 'discarded' ? h('span', { class: 'rv-badge rv-badge-discarded' }, 'discarded') : null,
        c.status === 'published' ? h('span', { class: 'rv-badge rv-badge-published' }, 'published') : null,
        h('span', { class: 'rv-row-preview' }, firstBodyLine(c.body)),
      ),
    );
    if (isOpen) row.appendChild(getPanelCard(c).el);
    return row;
  }

  function getPanelCard(c: DraftComment): CardHandle {
    let card = panelCards.get(c.id);
    if (!card) {
      // Panel fallback starts expanded — it only appears because the user
      // clicked a comment that has no inline card to jump to.
      card = createCard(c, cardCtx(c.id, true));
      panelCards.set(c.id, card);
    } else {
      card.update(c);
    }
    card.setAnchored(overlayCards.get(c.id)?.host.isConnected ?? false);
    return card;
  }

  function formatCost(usd: number): string {
    if (usd < 0.01) return '<$0.01';
    return `$${usd.toFixed(2)}`;
  }

  function firstBodyLine(body: string): string {
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (t !== '') return t;
    }
    return '';
  }

  function renderDropped(): HTMLElement | null {
    const dropped = draft?.dropped ?? [];
    if (dropped.length === 0) return null;
    const box = h('div', { class: 'rv-dropped' });
    box.appendChild(
      h(
        'button',
        { class: 'rv-fold-toggle', onclick: () => { droppedOpen = !droppedOpen; renderList(); } },
        `Pipeline dropped ${dropped.length} refuted finding${dropped.length === 1 ? '' : 's'}${droppedOpen ? ' (hide)' : ' (show)'}`,
      ),
    );
    if (droppedOpen) {
      for (const f of dropped) {
        box.appendChild(
          h(
            'div',
            { class: 'rv-dropped-item' },
            h(
              'div',
              { class: 'rv-dropped-head' },
              h('span', { class: `rv-chip rv-chip-${f.severity}` }, f.severity),
              h('span', { class: 'rv-row-loc' }, `${f.path}:${f.line}`),
              h('span', { class: 'rv-badge' }, f.dimension),
            ),
            h('div', { class: 'rv-dropped-claim' }, f.claim),
            f.verification ? h('div', { class: 'rv-dropped-notes' }, `${f.verification.verdict}: ${f.verification.notes}`) : null,
          ),
        );
      }
    }
    return box;
  }

  // ---- footer: the review is submitted from GitHub's own UI ---------------

  function renderFoot(): void {
    clear(footBox);
    if (!draft) return;
    if (draft.published) {
      footBox.appendChild(h('a', { class: 'rv-btn rv-btn-primary rv-finish', href: draft.published.url, target: '_blank', rel: 'noreferrer' }, 'View published review'));
      return;
    }
    const accepted = draft.comments.filter((c) => c.status === 'accepted').length;
    if (accepted === 0) {
      footBox.appendChild(
        h('div', { class: 'rv-foot-hint rv-muted' }, 'Accepted comments join your pending review on GitHub.'),
      );
      return;
    }
    footBox.appendChild(
      h(
        'a',
        {
          class: 'rv-btn rv-btn-primary rv-finish',
          href: `${draft.pr.url}/files`,
          target: '_blank',
          rel: 'noreferrer',
          title: 'Opens the PR diff; submit the pending review from there',
        },
        `Finish review on GitHub (${accepted} pending)`,
      ),
    );
  }

  // ---- top-level render --------------------------------------------------

  function updateFab(): void {
    const count = draft ? draft.comments.filter((c) => c.status !== 'discarded').length : 0;
    fabCount.textContent = String(count);
    fabCount.classList.toggle('rv-hidden', count === 0);
    fabDot.className = `rv-fab-dot rv-status-${daemonStatus}`;
    fab.title = daemonStatus === 'ok' ? 'Revue' : daemonStatus === 'down' ? 'Revue: daemon unreachable' : 'Revue: unauthorized (set the token in options)';
  }

  function renderPanel(): void {
    if (destroyed) return;
    renderHead();
    renderBanners();
    renderStages();
    summarySection.classList.toggle('rv-hidden', !draft);
    syncSummaryControls();
    renderList();
    renderFoot();
  }

  function renderAll(): void {
    if (destroyed) return;
    pruneCards();
    syncOverlay();
    renderPanel();
    updateFab();
  }

  function showNotice(msg: string): void {
    notice = msg;
    renderBanners();
  }

  // ---- PanelHandle -------------------------------------------------------

  function setDraft(d: ReviewDraft | null): void {
    if (destroyed) return;
    draft = d;
    if (!d) {
      for (const [, entry] of overlayCards) entry.host.remove();
      overlayCards.clear();
      panelCards.clear();
      expandedIds.clear();
      liveFindings.clear();
    }
    renderAll();
  }

  function handleEvent(e: RevueEvent): void {
    if (destroyed || e.reviewId !== reviewId) return;
    switch (e.type) {
      case 'review':
        setDraft(e.draft);
        break;
      case 'stage': {
        if (!draft) break;
        const idx = draft.stages.findIndex((s) => s.stage === e.stage.stage);
        if (idx >= 0) draft.stages[idx] = e.stage;
        else draft.stages.push(e.stage);
        if (draft.status === 'pending') draft.status = 'running';
        renderPanel();
        break;
      }
      case 'finding':
        liveFindings.set(e.finding.id, e.finding);
        renderStages();
        break;
      case 'finding-verdict': {
        const f = liveFindings.get(e.findingId);
        if (f) {
          f.verification = e.verification;
          if (e.dropped) {
            liveFindings.delete(e.findingId);
            if (draft && !draft.dropped.some((d) => d.id === f.id)) draft.dropped.push(f);
          }
        }
        renderPanel();
        break;
      }
      case 'comment':
        if (!draft) break;
        upsertComment(e.comment);
        renderAll();
        break;
      case 'comment-removed':
        if (!draft) break;
        draft.comments = draft.comments.filter((c) => c.id !== e.commentId);
        dropCardsFor(e.commentId);
        renderAll();
        break;
      case 'chat-delta':
      case 'chat-done':
        overlayCards.get(e.commentId)?.card.handleChatEvent(e);
        panelCards.get(e.commentId)?.handleChatEvent(e);
        break;
      case 'error':
        if (draft) {
          draft.status = 'error';
          draft.error = e.message;
          renderPanel();
        } else {
          showNotice(e.message);
        }
        break;
      case 'done':
        if (draft && draft.status === 'running') {
          draft.status = 'ready';
          renderPanel();
        }
        break;
    }
  }

  function setDaemonStatus(state: 'ok' | 'down' | 'unauthorized'): void {
    if (destroyed) return;
    daemonStatus = state;
    updateFab();
    renderBanners();
  }

  function toggle(): void {
    if (destroyed) return;
    panelOpen = !panelOpen;
    panelEl.classList.toggle('rv-open', panelOpen);
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    if (summaryTimer !== undefined) clearTimeout(summaryTimer);
    for (const [, entry] of overlayCards) entry.host.remove();
    overlayCards.clear();
    panelCards.clear();
    host.remove();
  }

  anchorer.observe(() => {
    if (!destroyed) syncOverlay();
  });

  renderAll();

  return { setDraft, handleEvent, setDaemonStatus, toggle, destroy };
};
