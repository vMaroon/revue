// Per-comment chat thread UI. The POST /chat request resolves with the final
// reply while deltas arrive on the review SSE stream; the panel routes
// chat-delta / chat-done events here via handleChatEvent. Finalization is
// idempotent because both the POST resolution and the chat-done event land in
// finalize().

import { QUICK_ACTIONS } from '@revue/shared';
import type { ChatMessage, DraftComment, RevueEvent } from '@revue/shared';
import type { DaemonClient } from '../lib/contract';
import { append, clear, errorMessage, h } from './dom';

export type ChatEvent = Extract<RevueEvent, { type: 'chat-delta' } | { type: 'chat-done' }>;

export interface ChatContext {
  client: DaemonClient;
  reviewId: string;
  /** Server echo after Apply patches the comment body. */
  onLocalUpdate: (comment: DraftComment) => void;
}

export interface ChatThreadHandle {
  el: HTMLElement;
  update(comment: DraftComment): void;
  handleChatEvent(e: ChatEvent): void;
}

export function createChatThread(comment: DraftComment, ctx: ChatContext): ChatThreadHandle {
  let current = comment;
  let messages: ChatMessage[] = [...comment.chat];
  let streamText: string | null = null;
  let streamEl: HTMLElement | null = null;
  let pending = false;
  let proposal: string | null = null;
  let applyBusy = false;
  let error: string | null = null;

  const historyEl = h('div', { class: 'rv-chat-history' });
  const proposalEl = h('div', { class: 'rv-chat-proposal-box rv-hidden' });
  const errorEl = h('div', { class: 'rv-card-error rv-hidden' });
  const quickEl = h('div', { class: 'rv-chat-quick' });
  const inputEl = h('input', { class: 'rv-input rv-chat-input', type: 'text', placeholder: 'Ask about this comment' });
  const sendBtn = h('button', { class: 'rv-btn rv-btn-primary rv-chat-send', onclick: () => void send(inputEl.value) }, 'Send');
  inputEl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      void send(inputEl.value);
    }
  });
  for (const qa of QUICK_ACTIONS) {
    quickEl.appendChild(h('button', { class: 'rv-btn rv-chat-qa', title: qa.message, onclick: () => void send(qa.message) }, qa.label));
  }
  const el = h(
    'div',
    { class: 'rv-chat' },
    historyEl,
    proposalEl,
    errorEl,
    quickEl,
    h('div', { class: 'rv-chat-inputrow' }, inputEl, sendBtn),
  );

  function bubble(role: ChatMessage['role'], content: string): HTMLElement {
    const b = h('div', { class: `rv-chat-msg rv-chat-${role}` });
    b.textContent = content;
    return b;
  }

  function renderHistory(): void {
    clear(historyEl);
    if (messages.length === 0 && streamText === null) {
      historyEl.appendChild(h('div', { class: 'rv-chat-empty' }, 'Ask the reviewing agent about this comment.'));
    }
    for (const m of messages) historyEl.appendChild(bubble(m.role, m.content));
    streamEl = null;
    if (streamText !== null) {
      streamEl = bubble('assistant', streamText);
      streamEl.classList.add('rv-chat-streaming');
      historyEl.appendChild(streamEl);
    }
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  function renderExtras(): void {
    errorEl.textContent = error ?? '';
    errorEl.classList.toggle('rv-hidden', error === null);

    clear(proposalEl);
    proposalEl.classList.toggle('rv-hidden', proposal === null);
    if (proposal !== null) {
      const pre = h('pre', { class: 'rv-proposal-body' });
      pre.textContent = proposal;
      append(proposalEl, [
        h('div', { class: 'rv-proposal-title' }, 'Proposed revision'),
        pre,
        h(
          'div',
          { class: 'rv-card-actions' },
          h('button', { class: 'rv-btn rv-btn-primary', disabled: applyBusy || undefined, onclick: () => void apply() }, applyBusy ? 'Applying...' : 'Apply to comment'),
          h('button', { class: 'rv-btn', disabled: applyBusy || undefined, onclick: () => { proposal = null; renderExtras(); } }, 'Dismiss'),
        ),
      ]);
    }

    for (const b of quickEl.querySelectorAll('button')) b.disabled = pending;
    sendBtn.disabled = pending;
  }

  async function send(text: string): Promise<void> {
    const message = text.trim();
    if (pending || message === '') return;
    pending = true;
    error = null;
    if (text === inputEl.value) inputEl.value = '';
    messages.push({ role: 'user', content: message, at: new Date().toISOString() });
    streamText = '';
    renderHistory();
    renderExtras();
    try {
      const res = await ctx.client.chat(ctx.reviewId, current.id, message);
      finalize(res.reply, res.revisedBody);
    } catch (e) {
      pending = false;
      streamText = null;
      error = errorMessage(e);
      renderHistory();
      renderExtras();
    }
  }

  function finalize(reply: ChatMessage, revisedBody?: string): void {
    if (!pending && streamText === null) {
      // Already finalized by the other path (POST resolution vs chat-done).
      if (revisedBody !== undefined && proposal === null) {
        proposal = revisedBody;
        renderExtras();
      }
      return;
    }
    pending = false;
    streamText = null;
    const last = messages[messages.length - 1];
    if (!(last && last.role === 'assistant' && last.content === reply.content)) messages.push(reply);
    if (revisedBody !== undefined) proposal = revisedBody;
    renderHistory();
    renderExtras();
  }

  async function apply(): Promise<void> {
    if (applyBusy || proposal === null) return;
    applyBusy = true;
    error = null;
    renderExtras();
    try {
      const updated = await ctx.client.patchComment(ctx.reviewId, current.id, { body: proposal });
      current = updated;
      proposal = null;
      applyBusy = false;
      renderExtras();
      ctx.onLocalUpdate(updated);
    } catch (e) {
      applyBusy = false;
      error = errorMessage(e);
      renderExtras();
    }
  }

  function update(comment: DraftComment): void {
    current = comment;
    // Adopt the server's history unless a turn is mid-flight (streaming) or
    // the echo lags behind what is already rendered locally.
    if (!pending && streamText === null && comment.chat.length >= messages.length) {
      messages = [...comment.chat];
      renderHistory();
    }
  }

  function handleChatEvent(e: ChatEvent): void {
    if (e.commentId !== current.id) return;
    if (e.type === 'chat-delta') {
      streamText = (streamText ?? '') + e.delta;
      if (streamEl) {
        streamEl.textContent = streamText;
        historyEl.scrollTop = historyEl.scrollHeight;
      } else {
        renderHistory();
      }
    } else {
      finalize(e.reply, e.revisedBody);
    }
  }

  renderHistory();
  renderExtras();

  return { el, update, handleChatEvent };
}
