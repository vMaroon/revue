// Pure unified-diff helpers over GitHub API `patch` strings (hunks only, no
// file headers). Used by the pipeline to validate finder anchors and to
// attach standalone hunk excerpts to comments.

import type { PrFile, Side } from '@revue/shared';
import type { DiffUtils, Hunk } from '../interfaces';

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let header: { oldStart: number; oldLines: number; newStart: number; newLines: number } | null = null;
  let lines: string[] = [];

  const flush = (): void => {
    if (header) {
      hunks.push({ ...header, text: lines.join('\n') });
    }
  };

  const raw = patch.split('\n');
  // A trailing newline in the patch yields a spurious empty last element.
  if (raw[raw.length - 1] === '') raw.pop();

  for (const line of raw) {
    const m = HUNK_HEADER.exec(line);
    if (m) {
      flush();
      header = {
        oldStart: Number(m[1]),
        // Omitted count in a hunk header means 1.
        oldLines: m[2] !== undefined ? Number(m[2]) : 1,
        newStart: Number(m[3]),
        newLines: m[4] !== undefined ? Number(m[4]) : 1,
      };
      lines = [line];
    } else if (header) {
      lines.push(line);
    }
    // Lines before the first @@ (file headers, if any) are ignored.
  }
  flush();
  return hunks;
}

interface AnnotatedLine {
  raw: string;
  /** Set for deleted and context lines. */
  oldLine?: number;
  /** Set for added and context lines. */
  newLine?: number;
  /** Old/new counters before this line is consumed (for header synthesis). */
  oldPos: number;
  newPos: number;
}

function annotate(patch: string): { hunk: Hunk; lines: AnnotatedLine[] }[] {
  return parsePatch(patch).map((hunk) => {
    let oldPos = hunk.oldStart;
    let newPos = hunk.newStart;
    const lines: AnnotatedLine[] = [];
    for (const raw of hunk.text.split('\n').slice(1)) {
      const entry: AnnotatedLine = { raw, oldPos, newPos };
      const prefix = raw[0];
      if (prefix === '+') {
        entry.newLine = newPos++;
      } else if (prefix === '-') {
        entry.oldLine = oldPos++;
      } else if (prefix === '\\') {
        // "\ No newline at end of file" is not a diff line.
      } else {
        // Context line; a bare '' also occurs for blank context lines.
        entry.oldLine = oldPos++;
        entry.newLine = newPos++;
      }
      lines.push(entry);
    }
    return { hunk, lines };
  });
}

function matches(line: AnnotatedLine, target: number, side: Side): boolean {
  return side === 'RIGHT' ? line.newLine === target : line.oldLine === target;
}

export function validateAnchor(
  files: PrFile[],
  path: string,
  line: number,
  side: Side,
): { valid: boolean; reason?: string } {
  const file = files.find((f) => f.path === path);
  if (!file) return { valid: false, reason: 'file not in diff' };
  if (file.patch === undefined) return { valid: false, reason: 'no patch (binary or too large)' };
  for (const { lines } of annotate(file.patch)) {
    if (lines.some((l) => matches(l, line, side))) return { valid: true };
  }
  return { valid: false, reason: 'line not in diff' };
}

export function extractHunk(
  files: PrFile[],
  path: string,
  line: number,
  side: Side,
  context = 3,
): string | undefined {
  const file = files.find((f) => f.path === path);
  if (!file || file.patch === undefined) return undefined;
  for (const { lines } of annotate(file.patch)) {
    const idx = lines.findIndex((l) => matches(l, line, side));
    if (idx === -1) continue;
    const slice = lines.slice(Math.max(0, idx - context), Math.min(lines.length, idx + context + 1));
    const first = slice[0];
    if (!first) continue;
    const oldCount = slice.filter((l) => l.oldLine !== undefined).length;
    const newCount = slice.filter((l) => l.newLine !== undefined).length;
    // Zero-count side uses the line before the slice, per unified-diff convention.
    const oldStart = slice.find((l) => l.oldLine !== undefined)?.oldLine ?? Math.max(first.oldPos - 1, 0);
    const newStart = slice.find((l) => l.newLine !== undefined)?.newLine ?? Math.max(first.newPos - 1, 0);
    const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
    return [header, ...slice.map((l) => l.raw)].join('\n');
  }
  return undefined;
}

export const diffUtils: DiffUtils = { parsePatch, validateAnchor, extractHunk };
