import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PrFile } from '@revue/shared';

import { extractHunk, parsePatch, validateAnchor } from '../src/github/diff.ts';

// Hunk: old lines 5-7, new lines 5-8. `old b` (old 6) is deleted; `new b`/`new c`
// (new 6/7) are added; `ctx a` and `ctx d` are context on both sides.
const PATCH = ['@@ -5,3 +5,4 @@', ' ctx a', '-old b', '+new b', '+new c', ' ctx d'].join('\n');

function file(over: Partial<PrFile> = {}): PrFile {
  return { path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, patch: PATCH, ...over };
}

test('parsePatch reads hunk start positions', () => {
  const hunks = parsePatch(PATCH);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0]?.oldStart, 5);
  assert.equal(hunks[0]?.newStart, 5);
});

test('parsePatch splits multiple hunks', () => {
  const multi = [PATCH, '@@ -20,1 +21,2 @@', ' ctx', '+added'].join('\n');
  assert.equal(parsePatch(multi).length, 2);
});

test('parsePatch treats an omitted line count as 1', () => {
  const hunks = parsePatch(['@@ -1 +1 @@', '-a', '+b'].join('\n'));
  assert.equal(hunks[0]?.oldLines, 1);
  assert.equal(hunks[0]?.newLines, 1);
});

test('validateAnchor accepts an added line on RIGHT', () => {
  assert.deepEqual(validateAnchor([file()], 'src/a.ts', 6, 'RIGHT'), { valid: true });
});

test('validateAnchor accepts a deleted line on LEFT', () => {
  assert.deepEqual(validateAnchor([file()], 'src/a.ts', 6, 'LEFT'), { valid: true });
});

test('validateAnchor accepts a context line on either side', () => {
  assert.equal(validateAnchor([file()], 'src/a.ts', 5, 'RIGHT').valid, true);
  assert.equal(validateAnchor([file()], 'src/a.ts', 5, 'LEFT').valid, true);
});

test('validateAnchor rejects a line outside the diff', () => {
  const r = validateAnchor([file()], 'src/a.ts', 99, 'RIGHT');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'line not in diff');
});

test('validateAnchor rejects a path not in the diff', () => {
  const r = validateAnchor([file()], 'src/missing.ts', 6, 'RIGHT');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'file not in diff');
});

test('validateAnchor rejects a file with no patch', () => {
  const r = validateAnchor([file({ patch: undefined })], 'src/a.ts', 6, 'RIGHT');
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'no patch (binary or too large)');
});

test('extractHunk returns a hunk around the target line', () => {
  const hunk = extractHunk([file()], 'src/a.ts', 6, 'RIGHT', 1);
  assert.ok(hunk);
  assert.match(hunk, /^@@ -\d+,\d+ \+\d+,\d+ @@/);
  assert.ok(hunk.includes('+new b'));
});

test('extractHunk returns undefined when the line is absent', () => {
  assert.equal(extractHunk([file()], 'src/a.ts', 99, 'RIGHT'), undefined);
});
