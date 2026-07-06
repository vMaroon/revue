import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Finding, Severity } from '@revue/shared';

import { dedupe } from '../src/pipeline/dedupe.ts';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: over.id ?? 'f1',
    dimension: 'correctness',
    path: 'src/a.ts',
    line: 10,
    side: 'RIGHT',
    claim: 'off by one in the loop bound',
    consequence: 'last element is skipped',
    severity: 'suggestion',
    evidence: [{ path: 'src/a.ts', note: 'loop' }],
    ...over,
  };
}

test('keeps distinct findings on different paths', () => {
  const out = dedupe([
    finding({ id: 'a', path: 'src/a.ts' }),
    finding({ id: 'b', path: 'src/b.ts' }),
  ]);
  assert.equal(out.length, 2);
});

test('keeps findings far apart on the same path', () => {
  const out = dedupe([
    finding({ id: 'a', line: 10 }),
    finding({ id: 'b', line: 40 }),
  ]);
  assert.equal(out.length, 2);
});

test('merges overlapping claims within two lines, first wins', () => {
  const out = dedupe([
    finding({ id: 'first', line: 10, claim: 'off by one in the loop bound' }),
    finding({ id: 'second', line: 11, claim: 'off by one loop bound error' }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'first');
});

test('merge keeps the higher severity', () => {
  const out = dedupe([
    finding({ id: 'first', severity: 'nit' as Severity, claim: 'off by one in the loop bound' }),
    finding({ id: 'second', line: 11, severity: 'blocking' as Severity, claim: 'off by one loop bound' }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.severity, 'blocking');
});

test('merge concatenates evidence from both findings', () => {
  const out = dedupe([
    finding({ id: 'first', evidence: [{ path: 'src/a.ts', note: 'one' }], claim: 'off by one loop bound' }),
    finding({ id: 'second', line: 11, evidence: [{ path: 'src/a.ts', note: 'two' }], claim: 'off by one loop bound' }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.evidence.length, 2);
});

test('does not merge when claims share too few tokens', () => {
  const out = dedupe([
    finding({ id: 'a', claim: 'off by one in the loop bound' }),
    finding({ id: 'b', line: 11, claim: 'missing null check on the response' }),
  ]);
  assert.equal(out.length, 2);
});
