// One comment card, used both injected under diff rows (overlay) and expanded
// inside the panel list. Comment bodies, evidence, and chat text are
// untrusted: everything renders through textContent / text nodes.

import type { CommentStatus, DraftComment, Finding, PatchCommentRequest } from '@revue/shared';
import type { DaemonClient } from '../lib/contract';
import { createChatThread, type ChatEvent, type ChatThreadHandle } from './chat';
import { clear, errorMessage, h } from './dom';
import { renderHunk } from './hunk';

export interface CardContext {
  client: DaemonClient;
  reviewId: string;
  /** Server echo after any mutation, so the panel reconciles its draft. */
  onLocalUpdate: (comment: DraftComment) => void;
  /** Scrolls the diff row for this comment into view. */
  scrollTo: () => void;
  /** GitHub blob URL for an evidence location at the reviewed head commit, or
   *  undefined when the PR head isn't known yet. */
  fileUrl: (path: string, line?: number) => string | undefined;
  /** Start expanded (panel-only fallback); overlay cards start collapsed. */
  startExpanded?: boolean;
}

export interface CardHandle {
  el: HTMLElement;
  update(comment: DraftComment): void;
  /** DOM anchoring result from the panel; toggles the anchored/panel-only marker. */
  setAnchored(anchored: boolean): void;
  /** Expand/collapse the card body (used when the panel navigates to it). */
  setExpanded(expanded: boolean): void;
  handleChatEvent(e: ChatEvent): void;
}

function summaryLine(body: string): string {
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (t !== '') return t;
  }
  return '(empty)';
}

export function createCard(comment: DraftComment, ctx: CardContext): CardHandle {
  let current = comment;
  let anchored = comment.anchor.valid;
  let expanded = ctx.startExpanded ?? false;
  let editing = false;
  let evidenceOpen = false;
  let chatOpen = false;
  let busy = false;
  let error: string | null = null;
  let chatThread: ChatThreadHandle | null = null;

  function toggleExpand(): void {
    expanded = !expanded;
    render();
  }

  const el = h('article', { class: 'rv-card' });
  // Persistent node so user text survives re-renders while editing.
  const editArea = h('textarea', { class: 'rv-input rv-card-edit' });

  function isUnverified(): boolean {
    return current.finding?.verification?.verdict === 'UNCERTAIN';
  }

  function render(): void {
    el.className = [
      'rv-card',
      `rv-sev-${current.severity}`,
      expanded ? 'rv-open' : 'rv-collapsed',
      current.status === 'discarded' ? 'rv-card-discarded' : '',
      current.status === 'published' ? 'rv-card-published' : '',
    ]
      .filter(Boolean)
      .join(' ');
    clear(el);

    const loc =
      current.startLine !== undefined && current.startLine !== current.line
        ? `${current.path}:${current.startLine}-${current.line}`
        : `${current.path}:${current.line}`;
    el.appendChild(
      h(
        'div',
        { class: 'rv-card-head rv-card-head-btn', title: expanded ? 'Collapse' : 'Expand', onclick: toggleExpand },
        h('span', { class: `rv-chip rv-chip-${current.severity}` }, current.severity),
        h(
          'button',
          {
            class: 'rv-card-loc',
            title: anchored ? 'Scroll to the diff row' : 'Row not found in the rendered diff',
            onclick: (e: Event) => {
              e.stopPropagation();
              if (anchored) ctx.scrollTo();
            },
          },
          loc,
        ),
        current.origin === 'manual' ? h('span', { class: 'rv-badge' }, 'manual') : null,
        isUnverified() ? h('span', { class: 'rv-badge rv-badge-unverified', title: 'The verifier could not confirm this claim' }, 'unverified') : null,
        current.status === 'discarded' ? h('span', { class: 'rv-badge rv-badge-discarded' }, 'discarded') : null,
        current.status === 'published' ? h('span', { class: 'rv-badge rv-badge-published' }, 'published') : null,
        h('span', { class: 'rv-caret' }),
      ),
    );

    // Collapsed: one-line summary only; click anywhere on the head or summary
    // to expand the full comment, evidence, and actions.
    if (!expanded) {
      el.appendChild(
        h('div', { class: 'rv-card-summary rv-row-preview', onclick: toggleExpand }, summaryLine(current.body)),
      );
      return;
    }

    if (editing) {
      el.appendChild(editArea);
      el.appendChild(
        h(
          'div',
          { class: 'rv-card-actions' },
          h('button', { class: 'rv-btn rv-btn-primary', disabled: busy || undefined, onclick: () => void saveEdit() }, busy ? 'Saving...' : 'Save'),
          h('button', { class: 'rv-btn', disabled: busy || undefined, onclick: () => { editing = false; error = null; render(); } }, 'Cancel'),
        ),
      );
    } else {
      el.appendChild(renderMarkdown(current.body));
    }

    // Panel-only comments carry their own hunk so they read standalone.
    if (!anchored && current.hunk) el.appendChild(renderHunk(current.hunk));

    if (current.finding) {
      el.appendChild(
        h('button', { class: 'rv-fold-toggle', onclick: () => { evidenceOpen = !evidenceOpen; render(); } }, evidenceOpen ? 'Hide evidence' : 'Evidence'),
      );
      if (evidenceOpen) el.appendChild(renderEvidence(current.finding));
    }

    if (error) el.appendChild(h('div', { class: 'rv-card-error' }, error));
    if (!editing) el.appendChild(renderActions());
    if (current.publishedUrl) {
      el.appendChild(h('a', { class: 'rv-card-published-link', href: current.publishedUrl, target: '_blank', rel: 'noreferrer' }, 'View on GitHub'));
    }
    if (chatOpen && chatThread) el.appendChild(chatThread.el);
  }

  function renderActions(): HTMLElement {
    const row = h('div', { class: 'rv-card-actions' });
    if (current.status !== 'published') {
      row.appendChild(h('button', { class: 'rv-btn', disabled: busy || undefined, onclick: startEdit }, 'Edit'));
      const accepted = current.status === 'accepted';
      row.appendChild(
        h(
          'button',
          { class: `rv-btn${accepted ? ' rv-btn-on' : ''}`, disabled: busy || undefined, onclick: () => void setStatus(accepted ? 'proposed' : 'accepted') },
          accepted ? 'Accepted' : 'Accept',
        ),
      );
      const discarded = current.status === 'discarded';
      row.appendChild(
        h(
          'button',
          {
            class: `rv-btn${discarded ? ' rv-btn-on' : ''}`,
            disabled: busy || undefined,
            onclick: () => void setStatus(discarded ? (current.origin === 'manual' ? 'accepted' : 'proposed') : 'discarded'),
          },
          discarded ? 'Restore' : 'Discard',
        ),
      );
      if (current.origin === 'manual') {
        row.appendChild(h('button', { class: 'rv-btn rv-btn-danger', disabled: busy || undefined, onclick: () => void remove() }, 'Delete'));
      }
    }
    row.appendChild(h('button', { class: `rv-btn${chatOpen ? ' rv-btn-on' : ''}`, onclick: toggleChat }, 'Chat'));
    return row;
  }

  function renderEvidence(f: Finding): HTMLElement {
    const box = h('div', { class: 'rv-evidence' });
    box.appendChild(evRow('Claim', f.claim));
    box.appendChild(evRow('Consequence', f.consequence));
    if (f.suggestion) box.appendChild(evRow('Suggestion', f.suggestion));
    for (const ev of f.evidence) {
      const loc = ev.line !== undefined ? `${ev.path}:${ev.line}` : ev.path;
      const url = ctx.fileUrl(ev.path, ev.line);
      const locEl = url
        ? h('a', { class: 'rv-evidence-loc', href: url, target: '_blank', rel: 'noopener noreferrer' }, loc)
        : h('span', { class: 'rv-evidence-loc' }, loc);
      const item = h(
        'div',
        { class: 'rv-evidence-item' },
        locEl,
        h('div', { class: 'rv-evidence-note' }, ev.note),
      );
      if (ev.excerpt) {
        const pre = h('pre', { class: 'rv-md-pre' });
        pre.textContent = ev.excerpt;
        item.appendChild(pre);
      }
      box.appendChild(item);
    }
    if (f.verification) box.appendChild(evRow(`Verify: ${f.verification.verdict}`, f.verification.notes));
    const meta = f.verification ? `dimension: ${f.dimension} | model: ${f.verification.model}` : `dimension: ${f.dimension}`;
    box.appendChild(h('div', { class: 'rv-evidence-meta' }, meta));
    return box;
  }

  function evRow(label: string, text: string): HTMLElement {
    return h('div', { class: 'rv-evidence-row' }, h('span', { class: 'rv-evidence-label' }, label), h('span', { class: 'rv-evidence-text' }, text));
  }

  function startEdit(): void {
    editArea.value = current.body;
    editing = true;
    error = null;
    render();
    editArea.focus();
  }

  async function saveEdit(): Promise<void> {
    await mutate({ body: editArea.value });
  }

  async function setStatus(status: CommentStatus): Promise<void> {
    await mutate({ status });
  }

  async function mutate(patch: PatchCommentRequest): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    render();
    try {
      const updated = await ctx.client.patchComment(ctx.reviewId, current.id, patch);
      current = updated;
      editing = false;
      busy = false;
      render();
      ctx.onLocalUpdate(updated);
    } catch (e) {
      busy = false;
      error = errorMessage(e);
      render();
    }
  }

  async function remove(): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    render();
    try {
      await ctx.client.deleteComment(ctx.reviewId, current.id);
      // The comment-removed SSE event tears the card down.
      busy = false;
      render();
    } catch (e) {
      busy = false;
      error = errorMessage(e);
      render();
    }
  }

  function toggleChat(): void {
    chatOpen = !chatOpen;
    if (chatOpen && !chatThread) {
      chatThread = createChatThread(current, {
        client: ctx.client,
        reviewId: ctx.reviewId,
        onLocalUpdate: (c) => {
          current = c;
          render();
          ctx.onLocalUpdate(c);
        },
      });
    }
    render();
  }

  function update(comment: DraftComment): void {
    current = comment;
    chatThread?.update(comment);
    // Skip the rebuild while the user is typing in this card; re-attaching
    // the focused element would blur it. State reconciles on the next render.
    const rootNode = el.getRootNode();
    const active = rootNode instanceof ShadowRoot || rootNode instanceof Document ? rootNode.activeElement : null;
    if (active && el.contains(active) && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)) return;
    render();
  }

  function setAnchored(a: boolean): void {
    if (anchored === a) return;
    anchored = a;
    update(current);
  }

  function setExpanded(e: boolean): void {
    if (expanded === e) return;
    expanded = e;
    render();
  }

  function handleChatEvent(e: ChatEvent): void {
    chatThread?.handleChatEvent(e);
  }

  render();
  return { el, update, setAnchored, setExpanded, handleChatEvent };
}

// ---------------------------------------------------------------------------
// Minimal markdown: paragraphs, `inline code`, and fenced code blocks only.
// Built entirely from text nodes, so no escaping step can be forgotten.
// ---------------------------------------------------------------------------

export function renderMarkdown(md: string): HTMLElement {
  const out = h('div', { class: 'rv-md' });
  const lines = md.split('\n');
  let i = 0;
  let para: string[] = [];

  const flush = (): void => {
    if (para.length === 0) return;
    const p = h('p');
    appendInline(p, para.join('\n'));
    out.appendChild(p);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trimStart().startsWith('```')) {
      flush();
      i++;
      const code: string[] = [];
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith('```')) {
        code.push(lines[i] ?? '');
        i++;
      }
      i++; // closing fence (or end of input)
      const codeEl = h('code');
      codeEl.textContent = code.join('\n');
      out.appendChild(h('pre', { class: 'rv-md-pre' }, codeEl));
    } else if (line.trim() === '') {
      flush();
      i++;
    } else {
      para.push(line);
      i++;
    }
  }
  flush();
  return out;
}

function appendInline(parent: HTMLElement, text: string): void {
  const parts = text.split('`');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? '';
    // Odd indices are between backticks; an unmatched trailing backtick
    // (even part count) renders literally.
    const unmatchedTail = i === parts.length - 1 && parts.length % 2 === 0;
    if (i % 2 === 1 && !unmatchedTail) {
      const code = h('code');
      code.textContent = part;
      parent.appendChild(code);
    } else {
      parent.appendChild(document.createTextNode(i % 2 === 1 ? `\`${part}` : part));
    }
  }
}
