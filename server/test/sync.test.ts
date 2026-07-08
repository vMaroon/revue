import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DraftComment, ReviewDraft } from '@revue/shared';
import type { GithubService, PendingAnchor } from '../src/interfaces.ts';
import {
  pushComment,
  retractAll,
  retractComment,
  updateCommentBody,
  updateSummary,
} from '../src/sync.ts';

function draftOf(overrides: Partial<ReviewDraft> = {}): ReviewDraft {
  return {
    id: 'o__r__1',
    pr: {
      owner: 'o',
      repo: 'r',
      number: 1,
      title: 't',
      author: 'a',
      url: 'https://github.com/o/r/pull/1',
      headSha: 'abc',
      baseRef: 'main',
      headRef: 'feat',
      body: '',
    },
    status: 'ready',
    stages: [],
    summary: 'the summary',
    verdict: 'COMMENT',
    comments: [],
    dropped: [],
    createdAt: 'now',
    updatedAt: 'now',
    ...overrides,
  };
}

function commentOf(overrides: Partial<DraftComment> = {}): DraftComment {
  return {
    id: 'c-1',
    path: 'src/a.ts',
    line: 10,
    side: 'RIGHT',
    severity: 'suggestion',
    body: 'the body',
    status: 'proposed',
    origin: 'pipeline',
    chat: [],
    anchor: { valid: true },
    updatedAt: 'now',
    ...overrides,
  };
}

interface Calls {
  find: number;
  create: { body: string }[];
  add: { reviewId: string; anchor: PendingAnchor; body: string }[];
  update: { commentId: string; body: string }[];
  del: string[];
  updateBody: { reviewId: string; body: string }[];
}

function fakeGithub(behavior: {
  pendingReviewId?: string | undefined;
  addError?: () => Error | undefined;
}): { github: GithubService; calls: Calls } {
  const calls: Calls = { find: 0, create: [], add: [], update: [], del: [], updateBody: [] };
  let addCalls = 0;
  const github = {
    findPendingReview: async () => {
      calls.find++;
      return {
        pullRequestId: 'PR_1',
        ...(behavior.pendingReviewId !== undefined
          ? { pendingReviewId: behavior.pendingReviewId }
          : {}),
      };
    },
    createPendingReview: async (_prId: string, body: string) => {
      calls.create.push({ body });
      return 'REV_created';
    },
    addPendingComment: async (reviewId: string, anchor: PendingAnchor, body: string) => {
      addCalls++;
      const err = behavior.addError?.();
      if (err && addCalls === 1) throw err;
      calls.add.push({ reviewId, anchor, body });
      return `CMT_${addCalls}`;
    },
    updatePendingComment: async (commentId: string, body: string) => {
      calls.update.push({ commentId, body });
    },
    deletePendingComment: async (commentId: string) => {
      calls.del.push(commentId);
    },
    updatePendingReviewBody: async (reviewId: string, body: string) => {
      calls.updateBody.push({ reviewId, body });
    },
  } as Partial<GithubService> as GithubService;
  return { github, calls };
}

test('pushComment creates the pending review seeded with the summary', async () => {
  const { github, calls } = fakeGithub({});
  const draft = draftOf();
  const comment = commentOf();

  await pushComment(github, draft, comment, 'posted body');

  assert.deepEqual(calls.create, [{ body: 'the summary' }]);
  assert.equal(calls.add[0]?.reviewId, 'REV_created');
  assert.equal(calls.add[0]?.body, 'posted body');
  assert.equal(draft.pendingReviewId, 'REV_created');
  assert.equal(comment.pendingCommentId, 'CMT_1');
});

test('pushComment reuses an existing pending review on GitHub', async () => {
  const { github, calls } = fakeGithub({ pendingReviewId: 'REV_existing' });
  const draft = draftOf();
  const comment = commentOf();

  await pushComment(github, draft, comment, comment.body);

  assert.equal(calls.create.length, 0);
  assert.equal(calls.add[0]?.reviewId, 'REV_existing');
  assert.equal(draft.pendingReviewId, 'REV_existing');
});

test('pushComment carries the multi-line anchor', async () => {
  const { github, calls } = fakeGithub({});
  const draft = draftOf();
  const comment = commentOf({ startLine: 5, line: 10 });

  await pushComment(github, draft, comment, comment.body);

  assert.deepEqual(calls.add[0]?.anchor, { path: 'src/a.ts', line: 10, side: 'RIGHT', startLine: 5 });
});

test('pushComment re-resolves a stale cached review id and retries once', async () => {
  const { github, calls } = fakeGithub({
    pendingReviewId: 'REV_fresh',
    addError: () => new Error('review was submitted'),
  });
  const draft = draftOf({ pendingReviewId: 'REV_stale' });
  const comment = commentOf();

  await pushComment(github, draft, comment, comment.body);

  // First add hit the stale id and failed; the retry used the re-resolved id.
  assert.equal(calls.add.length, 1);
  assert.equal(calls.add[0]?.reviewId, 'REV_fresh');
  assert.equal(draft.pendingReviewId, 'REV_fresh');
  assert.equal(comment.pendingCommentId, 'CMT_2');
});

test('pushComment does not retry when the review id was just resolved', async () => {
  const { github } = fakeGithub({ addError: () => new Error('bad anchor') });
  const draft = draftOf();
  const comment = commentOf();

  await assert.rejects(() => pushComment(github, draft, comment, comment.body), /bad anchor/);
  assert.equal(comment.pendingCommentId, undefined);
});

test('retractComment deletes the pending comment and clears the link', async () => {
  const { github, calls } = fakeGithub({});
  const comment = commentOf({ status: 'accepted', pendingCommentId: 'CMT_9' });

  await retractComment(github, comment);

  assert.deepEqual(calls.del, ['CMT_9']);
  assert.equal(comment.pendingCommentId, undefined);
});

test('retractComment is a no-op without a synced comment', async () => {
  const { github, calls } = fakeGithub({});
  await retractComment(github, commentOf());
  assert.equal(calls.del.length, 0);
});

test('updateCommentBody rewrites the synced comment only', async () => {
  const { github, calls } = fakeGithub({});
  await updateCommentBody(github, commentOf(), 'x');
  assert.equal(calls.update.length, 0);

  await updateCommentBody(github, commentOf({ pendingCommentId: 'CMT_2' }), 'x');
  assert.deepEqual(calls.update, [{ commentId: 'CMT_2', body: 'x' }]);
});

test('updateSummary is a no-op before any comment synced', async () => {
  const { github, calls } = fakeGithub({});
  await updateSummary(github, draftOf(), 's');
  assert.equal(calls.find, 0);
  assert.equal(calls.updateBody.length, 0);
});

test('updateSummary re-resolves the pending review and updates its body', async () => {
  const { github, calls } = fakeGithub({ pendingReviewId: 'REV_now' });
  const draft = draftOf({ pendingReviewId: 'REV_old' });

  await updateSummary(github, draft, 'new summary');

  assert.equal(draft.pendingReviewId, 'REV_now');
  assert.deepEqual(calls.updateBody, [{ reviewId: 'REV_now', body: 'new summary' }]);
});

test('updateSummary drops the cache when the pending review vanished', async () => {
  const { github, calls } = fakeGithub({});
  const draft = draftOf({ pendingReviewId: 'REV_old' });

  await updateSummary(github, draft, 'new summary');

  assert.equal(draft.pendingReviewId, undefined);
  assert.equal(calls.updateBody.length, 0);
});

test('retractAll retracts every synced comment and survives failures', async () => {
  const { github, calls } = fakeGithub({});
  const failing = commentOf({ id: 'c-2', pendingCommentId: 'CMT_fail' });
  const original = github.deletePendingComment.bind(github);
  github.deletePendingComment = async (id: string) => {
    if (id === 'CMT_fail') throw new Error('gone');
    return original(id);
  };
  const draft = draftOf({
    comments: [commentOf({ pendingCommentId: 'CMT_a' }), failing, commentOf({ id: 'c-3' })],
  });

  await retractAll(github, draft);

  assert.deepEqual(calls.del, ['CMT_a']);
  assert.equal(draft.comments[0]?.pendingCommentId, undefined);
  // The failing retract keeps its link; the new run starts fresh anyway.
  assert.equal(failing.pendingCommentId, 'CMT_fail');
});
