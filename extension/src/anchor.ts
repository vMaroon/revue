// All GitHub-DOM knowledge lives here and nowhere else. GitHub ships two
// diff DOMs (classic server-rendered tables and the React diff view); every
// lookup tries classic first, then React, and returns null/false on a miss
// so callers degrade to panel-only rendering. The DOM is never load-bearing
// for what gets posted — misses are an accepted outcome.

import type { PrRef, Side } from '@revue/shared';
import type { Anchorer } from './lib/contract';

const PR_PATH_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/;

// ---------------------------------------------------------------------------
// Classic diff DOM
// ---------------------------------------------------------------------------

function classicFileContainer(path: string): Element | null {
  for (const container of Array.from(
    document.querySelectorAll('div.file[data-details-container-group]'),
  )) {
    const p =
      container.getAttribute('data-tagsearch-path') ??
      container.querySelector('[data-path]')?.getAttribute('data-path');
    if (p === path) return container;
  }
  return null;
}

// Side of a classic line-number cell. Split view: data-split-side. Unified
// view: addition rows carry only the new number (RIGHT), deletion rows only
// the old number (LEFT); context rows carry both, first cell old (LEFT),
// second cell new (RIGHT) — the positional rule also covers split rows
// missing data-split-side (left columns precede right columns).
function classicCellSide(cell: HTMLTableCellElement): Side | null {
  const split = cell.getAttribute('data-split-side');
  if (split === 'left') return 'LEFT';
  if (split === 'right') return 'RIGHT';
  if (cell.classList.contains('blob-num-addition')) return 'RIGHT';
  if (cell.classList.contains('blob-num-deletion')) return 'LEFT';
  const row = cell.parentElement;
  if (!(row instanceof HTMLTableRowElement)) return null;
  const nums = Array.from(row.cells).filter((c) => c.classList.contains('blob-num'));
  if (nums.length >= 2) return nums.indexOf(cell) === 0 ? 'LEFT' : 'RIGHT';
  return null;
}

function isUnifiedContextCell(cell: HTMLTableCellElement): boolean {
  if (cell.hasAttribute('data-split-side')) return false;
  if (cell.classList.contains('blob-num-addition') || cell.classList.contains('blob-num-deletion')) {
    return false;
  }
  const row = cell.parentElement;
  return (
    row instanceof HTMLTableRowElement &&
    Array.from(row.cells).filter((c) => c.classList.contains('blob-num')).length >= 2
  );
}

function findClassicRow(path: string, line: number, side: Side): HTMLTableRowElement | null {
  const container = classicFileContainer(path);
  if (!container) return null;
  const cells = Array.from(
    container.querySelectorAll<HTMLTableCellElement>(`td.blob-num[data-line-number="${line}"]`),
  );
  const strict = cells.find((c) => classicCellSide(c) === side);
  // Unified context rows carry both numbers; either satisfies the lookup,
  // preferring the RIGHT (new-number) cell.
  const fallback =
    cells.find((c) => isUnifiedContextCell(c) && classicCellSide(c) === 'RIGHT') ??
    cells.find((c) => isUnifiedContextCell(c));
  const cell = strict ?? fallback;
  return cell?.closest('tr') ?? null;
}

// ---------------------------------------------------------------------------
// "Changes" diff DOM (current github.com, 2026): a progressive-diffs-list of
// PullRequestDiffsList diffEntry regions. Each file is a `table[data-diff-anchor]`
// where the anchor is `diff-<sha256(path)>` and the table carries
// `aria-label="Diff for: <path>"`; line cells are
// `td[data-line-number][data-diff-side="left|right"]` carrying a
// `data-line-anchor="<anchor>{R|L}{line}"`; rows are `tr.diff-line-row`.
// The aria-label is the primary path lookup: `data-file-path` exists only on
// the header's expand-all button, which files rendered in full (added files,
// small diffs) don't have.
// ---------------------------------------------------------------------------

function attrValue(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}

function changesDiffTable(path: string): Element | null {
  const table = document.querySelector(
    `table[data-diff-anchor][aria-label="Diff for: ${attrValue(path)}"]`,
  );
  if (table) return table;
  const btn = document.querySelector(`[data-file-path="${attrValue(path)}"]`);
  const entry =
    btn?.closest('[class*="diffEntry"]') ?? btn?.closest('[class*="Diff-module__diff"]');
  return entry?.querySelector('table[data-diff-anchor]') ?? null;
}

function findChangesRow(path: string, line: number, side: Side): Element | null {
  // Scope to the file's own table so a shared line number can't match another
  // file. A missing table means the file isn't rendered yet (virtualized) —
  // return null and let observe() re-inject when it scrolls into view.
  const table = changesDiffTable(path);
  if (!table) return null;
  const anchor = table.getAttribute('data-diff-anchor');
  const letter = side === 'RIGHT' ? 'R' : 'L';
  let cell = anchor
    ? table.querySelector(`td[data-line-anchor="${attrValue(anchor + letter + line)}"]`)
    : null;
  if (!cell) {
    const d = side === 'RIGHT' ? 'right' : 'left';
    const cands = Array.from(
      table.querySelectorAll<HTMLElement>(`td[data-line-number="${line}"][data-diff-side="${d}"]`),
    );
    cell = cands.find((c) => c.hasAttribute('data-line-anchor')) ?? cands[0] ?? null;
  }
  return cell?.closest('tr.diff-line-row') ?? cell?.closest('tr') ?? null;
}

// ---------------------------------------------------------------------------
// React diff DOM
// ---------------------------------------------------------------------------

function reactFileContainer(path: string): Element | null {
  const escaped = CSS.escape(path);
  for (const container of Array.from(document.querySelectorAll('[data-testid="diff-file"]'))) {
    if (
      container.getAttribute('data-path') === path ||
      container.querySelector(`[data-path="${escaped}"]`) !== null
    ) {
      return container;
    }
  }
  return null;
}

function findReactRow(path: string, line: number, side: Side): Element | null {
  const container = reactFileContainer(path);
  if (!container) return null;
  const want = side.toLowerCase();
  for (const cand of Array.from(container.querySelectorAll(`[data-line-number="${line}"]`))) {
    const sideAttr = (
      cand.getAttribute('data-side') ?? cand.closest('[data-side]')?.getAttribute('data-side')
    )?.toLowerCase();
    // No side attribute means an unpaired (unified/context) row: accept it.
    if (sideAttr !== undefined && sideAttr !== want) continue;
    return cand.closest('tr') ?? cand.closest('[role="row"]') ?? cand;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared lookup + injection
// ---------------------------------------------------------------------------

function findRow(path: string, line: number, side: Side): Element | null {
  // Current github.com first, then older/enterprise DOMs.
  return (
    findChangesRow(path, line, side) ??
    findClassicRow(path, line, side) ??
    findReactRow(path, line, side)
  );
}

function injectAfterRow(row: Element, el: HTMLElement): void {
  if (row instanceof HTMLTableRowElement) {
    const tr = document.createElement('tr');
    tr.className = 'revue-row';
    const td = document.createElement('td');
    td.colSpan = Math.max(row.cells.length, 1);
    td.appendChild(el);
    tr.appendChild(td);
    row.after(tr);
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'revue-row';
  // The React diff lays rows out on a grid; span the full width.
  wrap.style.gridColumn = '1 / -1';
  wrap.appendChild(el);
  row.after(wrap);
}

function isRevueNode(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.classList.contains('revue-row') ||
      node.hasAttribute('data-revue-comment-id') ||
      node.tagName.toLowerCase() === 'revue-root')
  );
}

export function createAnchorer(): Anchorer {
  return {
    getPrRef(): PrRef | null {
      const m = PR_PATH_RE.exec(location.pathname);
      if (!m) return null;
      const [, owner, repo, num] = m;
      if (!owner || !repo || !num) return null;
      return { owner, repo, number: Number(num) };
    },

    onFilesTab(): boolean {
      return (
        document.querySelector(
          '[data-testid="diff-content"], .diff-line-row, div.file[data-details-container-group], [data-testid="diff-file"]',
        ) !== null
      );
    },

    injectBelow(path: string, line: number, side: Side, el: HTMLElement): boolean {
      const id = el.getAttribute('data-revue-comment-id');
      if (id) {
        const existing = document.querySelector(`[data-revue-comment-id="${CSS.escape(id)}"]`);
        if (existing?.isConnected) return true; // already injected; idempotent
      }
      const row = findRow(path, line, side);
      if (!row) return false;
      injectAfterRow(row, el);
      return true;
    },

    scrollTo(path: string, line: number, side: Side): boolean {
      const row = findRow(path, line, side);
      if (!row) return false;
      row.scrollIntoView({ block: 'center' });
      return true;
    },

    observe(onRelayout: () => void): void {
      let timer: number | undefined;
      const schedule = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          onRelayout();
        }, 250);
      };

      const observer = new MutationObserver((records) => {
        // Our own injections mutate the diff; skip records that only touch
        // revue nodes to avoid a relayout feedback loop.
        const relevant = records.some((r) =>
          [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)].some(
            (n) => !isRevueNode(n),
          ),
        );
        if (relevant) schedule();
      });
      const target =
        document.querySelector('[data-testid="diff-content"]') ??
        document.querySelector('#files') ??
        document.querySelector('[data-testid="diff-file"]')?.parentElement ??
        document.body;
      observer.observe(target, { childList: true, subtree: true });

      for (const ev of ['turbo:load', 'turbo:render', 'popstate']) {
        window.addEventListener(ev, schedule);
      }
    },
  };
}
