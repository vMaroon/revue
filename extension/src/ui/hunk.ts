// Renders a unified-diff hunk string line by line. All content is set via
// textContent: the hunk text comes off the wire and is untrusted.

import { h } from './dom';

export function renderHunk(hunk: string): HTMLElement {
  const root = h('div', { class: 'rv-hunk' });
  const lines = hunk.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    let kind = 'ctx';
    if (line.startsWith('@@')) kind = 'hdr';
    else if (line.startsWith('+')) kind = 'add';
    else if (line.startsWith('-')) kind = 'del';
    else if (line.startsWith('\\')) kind = 'meta';
    const lineEl = h('div', { class: `rv-hunk-line rv-hunk-${kind}` });
    lineEl.textContent = line;
    root.appendChild(lineEl);
  }
  return root;
}
