import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DraftComment } from '@revue/shared';

import { buildSeedPrompt } from '../src/chat/prompts.ts';
import { ANTISLOP_RULES } from '../src/pipeline/prompts/antislop.ts';
import { buildVoicePrompt } from '../src/pipeline/prompts/voice.ts';
import { buildStylePrompt } from '../src/style/prompts.ts';

function comment(): DraftComment {
  return {
    id: 'c1',
    path: 'src/a.ts',
    line: 10,
    side: 'RIGHT',
    severity: 'suggestion',
    body: 'off by one in the loop bound',
    status: 'proposed',
    origin: 'manual',
    chat: [],
    anchor: { valid: true },
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

test('drafting prompt carries the baseline ahead of the voice rules', () => {
  const prompt = buildVoicePrompt('preamble', []);
  const baselineAt = prompt.indexOf(ANTISLOP_RULES);
  assert.ok(baselineAt >= 0);
  assert.ok(baselineAt < prompt.indexOf('## Voice rules'));
});

test('chat seed prompt carries the baseline ahead of the voice preferences', () => {
  const prompt = buildSeedPrompt(comment(), 'voice rules here', '', 'shorten this');
  const baselineAt = prompt.indexOf(ANTISLOP_RULES);
  assert.ok(baselineAt >= 0);
  assert.ok(baselineAt < prompt.indexOf('## Reviewer voice preferences'));
});

test('style prompt shows the baseline so the rewrite only adds overrides', () => {
  const prompt = buildStylePrompt({
    login: 'octocat',
    corpusText: '[reviewer] review-comment: nit: rename this',
    stats: {
      comments: 1,
      byKind: { 'review-comment': 1, 'review-summary': 0, discussion: 0 },
      byRole: { reviewer: 1, author: 0 },
      repos: 1,
      topRepos: ['octo/repo'],
      chars: 30,
      truncated: false,
    },
    currentVoice: '',
    currentPriorities: '',
    finderDimensions: ['correctness'],
  });
  assert.ok(prompt.includes(ANTISLOP_RULES));
  assert.ok(prompt.includes('must not restate the baseline'));
});
