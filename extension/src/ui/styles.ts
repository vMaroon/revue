// All extension CSS, injected as a <style> element into every revue shadow
// root: the panel host and each overlay-card host. Rules must therefore not
// assume panel context. Violet accent so revue UI is unmistakably not GitHub.

export const styles = `
:host {
  all: initial;
  display: block;
  --rv-accent: #7c5cff;
  --rv-accent-strong: #6647ee;
  --rv-accent-soft: rgba(124, 92, 255, 0.13);
  --rv-bg: #ffffff;
  --rv-bg-soft: #f7f6fc;
  --rv-bg-inset: #efedf9;
  --rv-fg: #24222f;
  --rv-fg-muted: #6e6b81;
  --rv-border: #dedaf0;
  --rv-ok: #299e5d;
  --rv-ok-soft: rgba(41, 158, 93, 0.15);
  --rv-warn: #a97e13;
  --rv-warn-soft: rgba(180, 140, 30, 0.14);
  --rv-danger: #d44852;
  --rv-add-bg: rgba(38, 158, 91, 0.13);
  --rv-del-bg: rgba(230, 80, 90, 0.12);
  --rv-hdr-bg: rgba(124, 92, 255, 0.10);
  --rv-shadow: 0 10px 32px rgba(30, 20, 70, 0.22);
  --rv-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 13px;
  line-height: 1.45;
  color: var(--rv-fg);
}
@media (prefers-color-scheme: dark) {
  :host {
    --rv-accent: #9c82ff;
    --rv-accent-strong: #8a6bff;
    --rv-accent-soft: rgba(156, 130, 255, 0.16);
    --rv-bg: #201e2a;
    --rv-bg-soft: #282534;
    --rv-bg-inset: #2f2b3d;
    --rv-fg: #e9e7f2;
    --rv-fg-muted: #9f9bb4;
    --rv-border: #3b3750;
    --rv-ok: #4cc38a;
    --rv-ok-soft: rgba(76, 195, 138, 0.16);
    --rv-warn: #d3a53c;
    --rv-warn-soft: rgba(211, 165, 60, 0.16);
    --rv-danger: #e5636d;
    --rv-add-bg: rgba(70, 180, 110, 0.16);
    --rv-del-bg: rgba(235, 95, 105, 0.16);
    --rv-hdr-bg: rgba(156, 130, 255, 0.14);
    --rv-shadow: 0 10px 36px rgba(0, 0, 0, 0.55);
  }
}
*, *::before, *::after { box-sizing: border-box; }

.rv-hidden { display: none !important; }
.rv-muted { color: var(--rv-fg-muted); }
.rv-empty { color: var(--rv-fg-muted); font-size: 12px; padding: 8px 0; }

/* ---- buttons, links, inputs ---- */
.rv-btn {
  appearance: none; font: inherit; font-size: 12px; font-weight: 600;
  border: 1px solid var(--rv-border); background: var(--rv-bg); color: var(--rv-fg);
  border-radius: 6px; padding: 3px 10px; cursor: pointer;
}
.rv-btn:hover:not(:disabled) { border-color: var(--rv-accent); color: var(--rv-accent); }
.rv-btn:disabled { opacity: 0.5; cursor: default; }
.rv-btn-primary { background: var(--rv-accent); border-color: var(--rv-accent); color: #fff; }
.rv-btn-primary:hover:not(:disabled) { background: var(--rv-accent-strong); border-color: var(--rv-accent-strong); color: #fff; }
.rv-btn-on { background: var(--rv-accent-soft); border-color: var(--rv-accent); color: var(--rv-accent); }
.rv-btn-danger:hover:not(:disabled) { border-color: var(--rv-danger); color: var(--rv-danger); }
a.rv-btn { text-decoration: none; display: inline-block; }
.rv-link {
  background: none; border: none; padding: 0; font: inherit; font-size: inherit;
  color: var(--rv-accent); cursor: pointer; text-decoration: underline;
}
.rv-input, .rv-select {
  font: inherit; font-size: 12.5px; color: var(--rv-fg); background: var(--rv-bg);
  border: 1px solid var(--rv-border); border-radius: 6px; padding: 5px 8px; width: 100%;
}
.rv-input:focus, .rv-select:focus {
  outline: none; border-color: var(--rv-accent); box-shadow: 0 0 0 2px var(--rv-accent-soft);
}
textarea.rv-input { resize: vertical; min-height: 64px; font-family: inherit; }
.rv-form-error { color: var(--rv-danger); font-size: 12px; margin: 4px 0; }

/* ---- floating button ---- */
.rv-fab {
  position: fixed; right: 22px; bottom: 22px; width: 46px; height: 46px;
  border-radius: 50%; border: none; background: var(--rv-accent); color: #fff;
  cursor: pointer; z-index: 2147483000; box-shadow: var(--rv-shadow);
  display: flex; align-items: center; justify-content: center;
}
.rv-fab:hover { background: var(--rv-accent-strong); }
.rv-fab-mark { font-size: 20px; font-weight: 800; font-family: Georgia, 'Times New Roman', serif; font-style: italic; }
.rv-fab-dot {
  position: absolute; top: 1px; right: 1px; width: 12px; height: 12px;
  border-radius: 50%; border: 2px solid var(--rv-bg);
}
.rv-status-ok { background: var(--rv-ok); }
.rv-status-down { background: var(--rv-danger); }
.rv-status-unauthorized { background: var(--rv-warn); }
.rv-fab-count {
  position: absolute; bottom: -3px; right: -5px; min-width: 18px; height: 18px;
  border-radius: 9px; background: var(--rv-fg); color: var(--rv-bg);
  font-size: 10px; font-weight: 700; display: flex; align-items: center;
  justify-content: center; padding: 0 4px;
}

/* ---- side panel ---- */
.rv-panel {
  position: fixed; top: 0; right: 0; height: 100vh; width: 380px; max-width: 96vw;
  background: var(--rv-bg); border-left: 1px solid var(--rv-border);
  box-shadow: var(--rv-shadow); z-index: 2147483000;
  display: flex; flex-direction: column;
  transform: translateX(105%); transition: transform 0.18s ease;
}
.rv-panel.rv-open { transform: none; }
.rv-head { padding: 10px 12px; border-bottom: 1px solid var(--rv-border); background: var(--rv-bg-soft); flex: none; }
.rv-head-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.rv-logo { font-weight: 800; color: var(--rv-accent); letter-spacing: 0.3px; }
.rv-pr-ref { color: var(--rv-fg-muted); font-size: 12px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rv-head-title { margin-top: 4px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rv-head-actions { margin-top: 8px; display: flex; gap: 8px; }
.rv-icon-btn {
  background: none; border: none; font: inherit; font-size: 14px; font-weight: 700;
  color: var(--rv-fg-muted); cursor: pointer; padding: 0 4px; flex: none;
}
.rv-icon-btn:hover { color: var(--rv-fg); }
.rv-status-chip {
  flex: none; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;
  padding: 1px 7px; border-radius: 999px; background: var(--rv-bg-inset);
  color: var(--rv-fg-muted); font-weight: 700;
}
.rv-status-chip-running, .rv-status-chip-publishing { background: var(--rv-accent-soft); color: var(--rv-accent); }
.rv-status-chip-ready, .rv-status-chip-published { background: var(--rv-ok-soft); color: var(--rv-ok); }
.rv-status-chip-error { background: var(--rv-del-bg); color: var(--rv-danger); }
.rv-body { flex: 1; overflow-y: auto; padding: 10px 12px 16px; }
.rv-foot { flex: none; padding: 10px 12px; border-top: 1px solid var(--rv-border); background: var(--rv-bg-soft); }
.rv-publish { width: 100%; padding: 7px 10px; font-size: 13px; text-align: center; display: block; }
.rv-section { margin-bottom: 14px; }
.rv-section-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px;
  color: var(--rv-fg-muted); margin: 0 0 6px;
}

/* ---- banners ---- */
.rv-banner { border-radius: 6px; padding: 7px 9px; font-size: 12px; margin-bottom: 8px; border: 1px solid; }
.rv-banner-error { background: var(--rv-del-bg); border-color: var(--rv-danger); color: var(--rv-danger); }
.rv-banner-warn { background: var(--rv-warn-soft); border-color: var(--rv-warn); color: var(--rv-warn); }
.rv-banner-dismiss { margin-left: 6px; font-size: 11px; }

/* ---- stage progress ---- */
.rv-stage { display: flex; align-items: center; gap: 8px; padding: 2px 0; font-size: 12px; min-width: 0; }
.rv-stage-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--rv-border); flex: none; }
.rv-stage-running .rv-stage-dot { background: var(--rv-accent); animation: rv-pulse 1.1s ease-in-out infinite; }
.rv-stage-done .rv-stage-dot { background: var(--rv-ok); }
.rv-stage-error .rv-stage-dot { background: var(--rv-danger); }
.rv-stage-name { font-weight: 600; width: 52px; flex: none; }
.rv-stage-pending .rv-stage-name { color: var(--rv-fg-muted); font-weight: 400; }
.rv-stage-detail { color: var(--rv-fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rv-stage-findings { font-size: 12px; margin-top: 2px; }
@keyframes rv-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* ---- summary / verdict ---- */
.rv-verdict-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 12px; }
.rv-verdict-row .rv-select { width: auto; flex: 1; }

/* ---- comment list ---- */
.rv-file-head {
  font-family: var(--rv-mono); font-size: 11.5px; color: var(--rv-fg-muted);
  background: var(--rv-bg-inset); border-radius: 6px; padding: 3px 8px;
  margin: 10px 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rv-row { border: 1px solid var(--rv-border); border-radius: 8px; margin: 4px 0; background: var(--rv-bg); }
.rv-row-open { border-color: var(--rv-accent); }
.rv-row-discarded { opacity: 0.6; }
.rv-row-head {
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 8px;
  background: none; border: none; cursor: pointer; text-align: left;
  font: inherit; color: var(--rv-fg); min-width: 0;
}
.rv-row-loc { font-family: var(--rv-mono); font-size: 11px; color: var(--rv-fg-muted); flex: none; }
.rv-row-preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.rv-row .rv-card { border: none; border-top: 1px solid var(--rv-border); border-radius: 0 0 8px 8px; margin: 0; box-shadow: none; }

/* ---- chips and badges ---- */
.rv-chip {
  flex: none; font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.4px; padding: 1px 7px; border-radius: 999px;
}
.rv-chip-blocking { background: var(--rv-del-bg); color: var(--rv-danger); }
.rv-chip-suggestion { background: var(--rv-accent-soft); color: var(--rv-accent); }
.rv-chip-nit { background: var(--rv-bg-inset); color: var(--rv-fg-muted); }
.rv-badge {
  flex: none; font-size: 10px; font-weight: 600; padding: 1px 6px;
  border-radius: 4px; background: var(--rv-bg-inset); color: var(--rv-fg-muted);
}
.rv-badge-unverified { background: var(--rv-warn-soft); color: var(--rv-warn); }
.rv-badge-published { background: var(--rv-ok-soft); color: var(--rv-ok); }
.rv-badge-discarded { text-decoration: line-through; }

/* ---- dropped findings ---- */
.rv-fold-toggle {
  background: none; border: none; color: var(--rv-accent); font: inherit;
  font-size: 12px; cursor: pointer; padding: 2px 0; display: block;
}
.rv-fold-toggle:hover { text-decoration: underline; }
.rv-dropped { margin-top: 10px; }
.rv-dropped-item { border: 1px dashed var(--rv-border); border-radius: 8px; padding: 7px 9px; margin: 5px 0; opacity: 0.85; }
.rv-dropped-head { display: flex; gap: 6px; align-items: center; margin-bottom: 3px; }
.rv-dropped-claim { font-size: 12px; }
.rv-dropped-notes { font-size: 11.5px; color: var(--rv-fg-muted); margin-top: 3px; }

/* ---- add comment form ---- */
.rv-add-grid { display: grid; grid-template-columns: 1fr 68px 80px; gap: 6px; margin: 6px 0; }
.rv-add-path { margin-bottom: 6px; }
.rv-add-body { margin-bottom: 4px; }

/* ---- comment card ---- */
.rv-card {
  position: relative; border: 1px solid var(--rv-border);
  border-left: 3px solid var(--rv-accent); border-radius: 8px;
  background: var(--rv-bg); color: var(--rv-fg); padding: 9px 11px; margin: 6px 0;
  box-shadow: 0 2px 10px rgba(30, 20, 70, 0.08); max-width: 880px;
  font-size: 13px; line-height: 1.45;
}
.rv-sev-blocking { border-left-color: var(--rv-danger); }
.rv-sev-suggestion { border-left-color: var(--rv-accent); }
.rv-sev-nit { border-left-color: var(--rv-fg-muted); }
.rv-card-discarded { opacity: 0.55; }
.rv-card-published { border-left-color: var(--rv-ok); }
.rv-card-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
.rv-card-loc {
  font-family: var(--rv-mono); font-size: 11px; color: var(--rv-fg-muted);
  background: none; border: none; padding: 0; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
}
.rv-card-loc:hover { color: var(--rv-accent); text-decoration: underline; }
.rv-anchor-mark { font-size: 10px; flex: none; }
.rv-anchor-ok { color: var(--rv-ok); }
.rv-anchor-miss { color: var(--rv-fg-muted); }
.rv-card-head-btn { cursor: pointer; }
.rv-collapsed .rv-card-head { margin-bottom: 0; }
.rv-caret {
  margin-left: auto; flex: none; width: 0; height: 0;
  border-left: 5px solid var(--rv-fg-muted);
  border-top: 4px solid transparent; border-bottom: 4px solid transparent;
  transition: transform 0.12s ease;
}
.rv-open .rv-caret { transform: rotate(90deg); }
.rv-card-summary { color: var(--rv-fg-muted); cursor: pointer; margin-top: 4px; }
.rv-badge-accepted { background: var(--rv-ok-soft); color: var(--rv-ok); }
.rv-card-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.rv-card-edit { font-family: var(--rv-mono); font-size: 12px; width: 100%; min-height: 96px; }
.rv-card-error { color: var(--rv-danger); font-size: 12px; margin-top: 6px; }
.rv-card-published-link { display: inline-block; margin-top: 6px; font-size: 12px; color: var(--rv-accent); }

/* ---- minimal markdown ---- */
.rv-md p { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
.rv-md p:last-child { margin-bottom: 0; }
.rv-md code { font-family: var(--rv-mono); font-size: 12px; background: var(--rv-bg-inset); border-radius: 4px; padding: 1px 4px; }
.rv-md-pre {
  font-family: var(--rv-mono); font-size: 12px; background: var(--rv-bg-inset);
  border-radius: 6px; padding: 8px 10px; overflow-x: auto; margin: 0 0 8px;
}
.rv-md-pre code { background: none; padding: 0; white-space: pre; }

/* ---- evidence / provenance ---- */
.rv-evidence {
  border-top: 1px dashed var(--rv-border); margin-top: 8px; padding-top: 8px;
  font-size: 12px; display: flex; flex-direction: column; gap: 5px;
}
.rv-evidence-row { display: flex; gap: 6px; }
.rv-evidence-label {
  flex: none; font-weight: 700; color: var(--rv-fg-muted); font-size: 10.5px;
  text-transform: uppercase; letter-spacing: 0.4px; padding-top: 2px;
}
.rv-evidence-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.rv-evidence-item { border-left: 2px solid var(--rv-border); padding-left: 8px; margin: 2px 0; }
.rv-evidence-loc { font-family: var(--rv-mono); font-size: 11px; color: var(--rv-accent); display: block; }
.rv-evidence-note { font-size: 12px; }
.rv-evidence-meta { color: var(--rv-fg-muted); font-size: 11px; font-family: var(--rv-mono); }

/* ---- diff hunk ---- */
.rv-hunk {
  font-family: var(--rv-mono); font-size: 11.5px; line-height: 1.5;
  border: 1px solid var(--rv-border); border-radius: 6px; overflow-x: auto;
  margin-top: 8px; background: var(--rv-bg-soft);
}
.rv-hunk-line { padding: 0 8px; white-space: pre; min-height: 1.5em; }
.rv-hunk-add { background: var(--rv-add-bg); }
.rv-hunk-del { background: var(--rv-del-bg); }
.rv-hunk-hdr { background: var(--rv-hdr-bg); color: var(--rv-accent); }
.rv-hunk-meta { color: var(--rv-fg-muted); }

/* ---- chat thread ---- */
.rv-chat { border-top: 1px solid var(--rv-border); margin-top: 10px; padding-top: 8px; }
.rv-chat-history { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 2px 0 6px; }
.rv-chat-empty { color: var(--rv-fg-muted); font-size: 12px; }
.rv-chat-msg {
  max-width: 88%; padding: 6px 9px; border-radius: 10px; font-size: 12.5px;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.rv-chat-user { align-self: flex-end; background: var(--rv-accent-soft); border-bottom-right-radius: 3px; }
.rv-chat-assistant { align-self: flex-start; background: var(--rv-bg-soft); border: 1px solid var(--rv-border); border-bottom-left-radius: 3px; }
.rv-chat-streaming::after {
  content: ''; display: inline-block; width: 7px; height: 12px; margin-left: 3px;
  vertical-align: -2px; background: var(--rv-accent); animation: rv-blink 0.9s step-end infinite;
}
@keyframes rv-blink { 50% { opacity: 0; } }
.rv-chat-quick { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0; }
.rv-chat-qa { font-size: 11px; padding: 2px 8px; border-radius: 999px; }
.rv-chat-inputrow { display: flex; gap: 6px; }
.rv-chat-inputrow .rv-chat-input { flex: 1; }
.rv-chat-send { flex: none; }
.rv-chat-proposal-box {
  border: 1px solid var(--rv-accent); background: var(--rv-accent-soft);
  border-radius: 8px; padding: 8px 10px; margin: 8px 0;
}
.rv-proposal-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;
  color: var(--rv-accent); margin-bottom: 5px;
}
.rv-proposal-body {
  font-family: var(--rv-mono); font-size: 12px; margin: 0; white-space: pre-wrap;
  overflow-wrap: anywhere; background: var(--rv-bg); border-radius: 6px;
  padding: 7px 9px; max-height: 200px; overflow-y: auto;
}

/* ---- publish modal ---- */
.rv-modal-backdrop {
  position: fixed; inset: 0; background: rgba(15, 10, 35, 0.45);
  z-index: 2147483001; display: flex; align-items: center; justify-content: center;
}
.rv-modal {
  width: 420px; max-width: 92vw; max-height: 80vh; overflow-y: auto;
  background: var(--rv-bg); border: 1px solid var(--rv-border); border-radius: 10px;
  box-shadow: var(--rv-shadow); padding: 16px;
}
.rv-modal-title { margin: 0 0 10px; font-size: 15px; font-weight: 700; }
.rv-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.rv-publish-stats { display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; margin-bottom: 10px; }
.rv-summary-preview {
  background: var(--rv-bg-soft); border: 1px solid var(--rv-border); border-radius: 6px;
  padding: 8px 10px; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere;
  max-height: 140px; overflow-y: auto; margin-bottom: 10px;
}
.rv-problems { margin: 0 0 6px; padding-left: 18px; font-size: 12px; }
.rv-problem { margin: 3px 0; }
`;
