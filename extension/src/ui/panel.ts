// Panel orchestration: shadow-DOM host with the floating button and side
// panel, overlay-card lifecycle through the anchorer, and reconciliation of
// every RevueEvent into the single held ReviewDraft.

import type {
  DraftComment,
  Finding,
  PipelineStage,
  PublishValidation,
  ReviewDraft,
  ReviewVerdict,
  RevueEvent,
  Severity,
} from '@revue/shared';
import type { MountPanel } from '../lib/contract';
import { createCard, type CardContext, type CardHandle } from './card';
import { append, clear, errorMessage, h, isolateKeys, type Child } from './dom';
import { styles } from './styles';

const STAGES: { id: PipelineStage; label: string }[] = [
  { id: 'context', label: 'Context' },
  { id: 'triage', label: 'Triage' },
  { id: 'find', label: 'Find' },
  { id: 'verify', label: 'Verify' },
  { id: 'draft', label: 'Draft' },
];

const SEVERITY_ORDER: Record<Severity, number> = { blocking: 0, suggestion: 1, nit: 2 };

export const mountPanel: MountPanel = (client, anchorer, pr) => {
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
  let modalEl: HTMLElement | null = null;

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
  const bannerBox = h('div');
  const stagesBox = h('div');
  const listBox = h('div');
  const footBox = h('div', { class: 'rv-foot' });

  const summaryInput = h('textarea', { class: 'rv-input rv-summary-input', rows: 5, placeholder: 'Review summary (markdown)' });
  const verdictSelect = h(
    'select',
    { class: 'rv-select' },
    h('option', { value: 'COMMENT' }, 'Comment'),
    h('option', { value: 'APPROVE' }, 'Approve'),
    h('option', { value: 'REQUEST_CHANGES' }, 'Request changes'),
  );
  const summarySection = h(
    'div',
    { class: 'rv-section rv-hidden' },
    h('div', { class: 'rv-section-title' }, 'Summary'),
    summaryInput,
    h('div', { class: 'rv-verdict-row' }, h('span', { class: 'rv-muted' }, 'Verdict'), verdictSelect),
  );

  const addPathSelect = h('select', { class: 'rv-select rv-add-path' });
  const addPathInput = h('input', { class: 'rv-input', type: 'text', placeholder: 'path/to/file (overrides dropdown)' });
  const addLineInput = h('input', { class: 'rv-input', type: 'number', min: 1, placeholder: 'line' });
  const addSideSelect = h('select', { class: 'rv-select' }, h('option', { value: 'RIGHT' }, 'RIGHT'), h('option', { value: 'LEFT' }, 'LEFT'));
  const addBodyInput = h('textarea', { class: 'rv-input rv-add-body', rows: 3, placeholder: 'Comment body (markdown)' });
  const addErrorEl = h('div', { class: 'rv-form-error rv-hidden' });
  const addSection = h(
    'div',
    { class: 'rv-section rv-hidden' },
    h('div', { class: 'rv-section-title' }, 'Add comment'),
    addPathSelect,
    h('div', { class: 'rv-add-grid' }, addPathInput, addLineInput, addSideSelect),
    addBodyInput,
    addErrorEl,
    h('div', { class: 'rv-card-actions' }, h('button', { class: 'rv-btn rv-btn-primary', onclick: () => void submitAdd() }, 'Add comment')),
  );

  const bodyEl = h('div', { class: 'rv-body' }, bannerBox, stagesBox, summarySection, listBox, addSection);
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

  verdictSelect.addEventListener('change', () => {
    if (!draft) return;
    const v = verdictSelect.value;
    const verdict: ReviewVerdict = v === 'APPROVE' ? 'APPROVE' : v === 'REQUEST_CHANGES' ? 'REQUEST_CHANGES' : 'COMMENT';
    client
      .patchReview(reviewId, { verdict })
      .then((d) => {
        if (!destroyed) {
          draft = d;
          renderAll();
        }
      })
      .catch((e) => {
        if (!destroyed) showNotice(`Saving verdict failed: ${errorMessage(e)}`);
      });
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
    };
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
    clear(headBox);
    headBox.appendChild(
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
    if (draft) headBox.appendChild(h('div', { class: 'rv-head-title', title: draft.pr.title }, draft.pr.title));
    headBox.appendChild(h('div', { class: 'rv-head-actions' }, runButton()));
  }

  function runButton(): HTMLElement {
    const hasRun = draft !== null && draft.status !== 'pending';
    const running = draft !== null && (draft.status === 'running' || draft.status === 'publishing');
    const label = runBusy ? 'Starting...' : running ? 'Running...' : hasRun ? 'Re-run review' : 'Run review';
    return h('button', { class: 'rv-btn rv-btn-primary', disabled: runBusy || running || undefined, onclick: () => void onRun() }, label);
  }

  async function onRun(): Promise<void> {
    if (runBusy) return;
    const rerun = draft !== null && draft.status !== 'pending';
    if (rerun && !confirm('Re-run the review? Current pipeline comments will be discarded.')) return;
    runBusy = true;
    notice = null;
    renderHead();
    renderBanners();
    try {
      const d = await client.createReview(pr, rerun);
      if (destroyed) return;
      liveFindings.clear();
      draft = d;
      renderAll();
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
    const list = h('div', { class: 'rv-section' }, h('div', { class: 'rv-section-title' }, 'Pipeline'));
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
    if (active !== verdictSelect) verdictSelect.value = draft.verdict;
  }

  function syncAddForm(): void {
    const paths = [...new Set((draft?.comments ?? []).map((c) => c.path))].sort();
    const prev = addPathSelect.value;
    clear(addPathSelect);
    for (const p of paths) addPathSelect.appendChild(h('option', { value: p }, p));
    if (paths.includes(prev)) addPathSelect.value = prev;
    addPathSelect.classList.toggle('rv-hidden', paths.length === 0);
  }

  async function submitAdd(): Promise<void> {
    if (!draft) return;
    const path = addPathInput.value.trim() !== '' ? addPathInput.value.trim() : addPathSelect.value;
    const line = Number.parseInt(addLineInput.value, 10);
    const side = addSideSelect.value === 'LEFT' ? 'LEFT' : 'RIGHT';
    const body = addBodyInput.value.trim();
    if (path === '' || !Number.isFinite(line) || line < 1 || body === '') {
      addErrorEl.textContent = 'Path, a positive line number, and a body are required.';
      addErrorEl.classList.remove('rv-hidden');
      return;
    }
    addErrorEl.classList.add('rv-hidden');
    try {
      const c = await client.addComment(reviewId, { path, line, side, body });
      if (destroyed) return;
      upsertComment(c);
      addBodyInput.value = '';
      addLineInput.value = '';
      renderAll();
    } catch (e) {
      addErrorEl.textContent = errorMessage(e);
      addErrorEl.classList.remove('rv-hidden');
    }
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
        c.status === 'accepted' ? h('span', { class: 'rv-badge rv-badge-accepted' }, 'accepted') : null,
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

  // ---- footer / publish --------------------------------------------------

  function renderFoot(): void {
    clear(footBox);
    if (!draft) return;
    if (draft.published) {
      footBox.appendChild(h('a', { class: 'rv-btn rv-btn-primary rv-publish', href: draft.published.url, target: '_blank', rel: 'noreferrer' }, 'View published review'));
      return;
    }
    const accepted = draft.comments.filter((c) => c.status === 'accepted').length;
    const disabled = draft.status === 'running' || draft.status === 'publishing' || runBusy;
    footBox.appendChild(
      h('button', { class: 'rv-btn rv-btn-primary rv-publish', disabled: disabled || undefined, onclick: () => void openPublish() }, `Publish (${accepted} accepted)`),
    );
  }

  function closeModal(): void {
    modalEl?.remove();
    modalEl = null;
  }

  function jumpTo(commentId: string): void {
    closeModal();
    if (!panelOpen) toggle();
    const c = findComment(commentId);
    if (!c) return;
    navigateToComment(c);
    if (!(overlayCards.get(commentId)?.host.isConnected ?? false)) {
      panelCards.get(commentId)?.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  async function openPublish(): Promise<void> {
    if (!draft) return;
    closeModal();
    const dialog = h('div', { class: 'rv-modal' });
    const backdrop = h('div', { class: 'rv-modal-backdrop' }, dialog);
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) closeModal();
    });
    root.appendChild(backdrop);
    modalEl = backdrop;

    const setContent = (...nodes: Child[]): void => {
      clear(dialog);
      append(dialog, nodes);
    };

    const runDryRun = async (): Promise<void> => {
      setContent(h('h3', { class: 'rv-modal-title' }, 'Publish review'), h('p', { class: 'rv-muted' }, 'Validating against the live diff...'));
      let v: PublishValidation;
      try {
        v = await client.publishDryRun(reviewId);
      } catch (e) {
        setContent(
          h('h3', { class: 'rv-modal-title' }, 'Publish review'),
          h('div', { class: 'rv-banner rv-banner-error' }, errorMessage(e)),
          h(
            'div',
            { class: 'rv-modal-actions' },
            h('button', { class: 'rv-btn', onclick: () => closeModal() }, 'Close'),
            h('button', { class: 'rv-btn rv-btn-primary', onclick: () => void runDryRun() }, 'Retry'),
          ),
        );
        return;
      }
      renderValidation(v);
    };

    const renderValidation = (v: PublishValidation): void => {
      const summaryPreview = (draft?.summary ?? '').trim();
      const problems = v.problems.map((p) => {
        const c = findComment(p.commentId);
        return h(
          'li',
          { class: 'rv-problem' },
          h('button', { class: 'rv-link', onclick: () => jumpTo(p.commentId) }, c ? `${c.path}:${c.line}` : p.commentId),
          ` ${p.reason}`,
        );
      });
      setContent(
        h('h3', { class: 'rv-modal-title' }, 'Publish review'),
        h(
          'div',
          { class: 'rv-publish-stats' },
          h('div', null, `${v.willPost.comments} comment${v.willPost.comments === 1 ? '' : 's'} will be posted`),
          h('div', null, `Verdict: ${v.willPost.verdict}`),
          h('div', null, `Summary: ${v.willPost.summaryChars} characters`),
        ),
        summaryPreview !== ''
          ? h('div', { class: 'rv-summary-preview' }, summaryPreview.length > 400 ? `${summaryPreview.slice(0, 400)}...` : summaryPreview)
          : null,
        problems.length > 0
          ? h('div', { class: 'rv-banner rv-banner-error' }, `${problems.length} comment${problems.length === 1 ? '' : 's'} failed anchor validation. Fix or discard them, then re-validate.`)
          : null,
        problems.length > 0 ? h('ul', { class: 'rv-problems' }, ...problems) : null,
        h(
          'div',
          { class: 'rv-modal-actions' },
          h('button', { class: 'rv-btn', onclick: () => closeModal() }, 'Cancel'),
          h('button', { class: 'rv-btn', onclick: () => void runDryRun() }, 'Re-validate'),
          h('button', { class: 'rv-btn rv-btn-primary', disabled: !v.ok || undefined, onclick: () => void doPublish() }, 'Publish to GitHub'),
        ),
      );
    };

    const doPublish = async (): Promise<void> => {
      setContent(h('h3', { class: 'rv-modal-title' }, 'Publish review'), h('p', { class: 'rv-muted' }, 'Posting to GitHub...'));
      try {
        const res = await client.publish(reviewId);
        if (destroyed) return;
        if (draft) {
          draft.status = 'published';
          draft.published = { url: res.url, at: res.at };
          for (const c of draft.comments) if (c.status === 'accepted') c.status = 'published';
        }
        renderAll();
        setContent(
          h('h3', { class: 'rv-modal-title' }, 'Review published'),
          h('p', null, h('a', { class: 'rv-link', href: res.url, target: '_blank', rel: 'noreferrer' }, 'View the review on GitHub')),
          h('div', { class: 'rv-modal-actions' }, h('button', { class: 'rv-btn rv-btn-primary', onclick: () => closeModal() }, 'Done')),
        );
      } catch (e) {
        setContent(
          h('h3', { class: 'rv-modal-title' }, 'Publish failed'),
          h('div', { class: 'rv-banner rv-banner-error' }, errorMessage(e)),
          h(
            'div',
            { class: 'rv-modal-actions' },
            h('button', { class: 'rv-btn', onclick: () => closeModal() }, 'Close'),
            h('button', { class: 'rv-btn rv-btn-primary', onclick: () => void runDryRun() }, 'Re-validate'),
          ),
        );
      }
    };

    await runDryRun();
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
    addSection.classList.toggle('rv-hidden', !draft);
    syncSummaryControls();
    syncAddForm();
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
    closeModal();
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
