import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GraphQL } from '../src/github/pending.ts';
import {
  addPendingComment,
  createPendingReview,
  deletePendingComment,
  findPendingReview,
  updatePendingComment,
} from '../src/github/pending.ts';

const REF = { owner: 'o', repo: 'r', number: 1 };

interface Recorded {
  query: string;
  variables: Record<string, unknown> | undefined;
}

function fakeGql(respond: (query: string, variables?: Record<string, unknown>) => unknown): {
  gql: GraphQL;
  recorded: Recorded[];
} {
  const recorded: Recorded[] = [];
  const gql = (async (query: string, variables?: Record<string, unknown>) => {
    recorded.push({ query, variables });
    return respond(query, variables);
  }) as GraphQL;
  return { gql, recorded };
}

function reviewsPayload(nodes: { id: string; author: { login: string } | null }[]): unknown {
  return {
    viewer: { login: 'me' },
    repository: { pullRequest: { id: 'PR_1', reviews: { nodes } } },
  };
}

test('findPendingReview returns the viewer-authored pending review', async () => {
  const { gql } = fakeGql(() =>
    reviewsPayload([
      { id: 'REV_bot', author: { login: 'some-bot' } },
      { id: 'REV_mine', author: { login: 'me' } },
    ]),
  );
  assert.deepEqual(await findPendingReview(gql, REF), {
    pullRequestId: 'PR_1',
    pendingReviewId: 'REV_mine',
  });
});

test('findPendingReview omits the review id when the viewer has none pending', async () => {
  const { gql } = fakeGql(() => reviewsPayload([]));
  assert.deepEqual(await findPendingReview(gql, REF), { pullRequestId: 'PR_1' });
});

test('findPendingReview throws on a missing pull request', async () => {
  const { gql } = fakeGql(() => ({ viewer: { login: 'me' }, repository: { pullRequest: null } }));
  await assert.rejects(() => findPendingReview(gql, REF), /o\/r#1 not found/);
});

test('createPendingReview returns the new review node id', async () => {
  const { gql, recorded } = fakeGql(() => ({
    addPullRequestReview: { pullRequestReview: { id: 'REV_new' } },
  }));
  assert.equal(await createPendingReview(gql, 'PR_1', 'seed body'), 'REV_new');
  assert.equal(recorded[0]?.variables?.['body'], 'seed body');
});

test('addPendingComment returns the comment node id and sets startSide only for ranges', async () => {
  const { gql, recorded } = fakeGql(() => ({
    addPullRequestReviewThread: { thread: { comments: { nodes: [{ id: 'CMT_1' }] } } },
  }));

  const single = { path: 'a.ts', line: 3, side: 'RIGHT' as const };
  assert.equal(await addPendingComment(gql, 'REV_1', single, 'b'), 'CMT_1');
  const singleInput = recorded[0]?.variables?.['input'] as Record<string, unknown>;
  assert.equal(singleInput['startLine'], undefined);
  assert.equal(singleInput['startSide'], undefined);

  const range = { path: 'a.ts', line: 3, side: 'RIGHT' as const, startLine: 1 };
  await addPendingComment(gql, 'REV_1', range, 'b');
  const rangeInput = recorded[1]?.variables?.['input'] as Record<string, unknown>;
  assert.equal(rangeInput['startLine'], 1);
  assert.equal(rangeInput['startSide'], 'RIGHT');
});

test('updatePendingComment refuses submitted and missing comments', async () => {
  const submitted = fakeGql(() => ({ node: { state: 'SUBMITTED' } }));
  await assert.rejects(() => updatePendingComment(submitted.gql, 'CMT_1', 'b'), /already submitted/);

  const missing = fakeGql(() => ({ node: null }));
  await assert.rejects(() => updatePendingComment(missing.gql, 'CMT_1', 'b'), /no longer exists/);
});

test('updatePendingComment rewrites a pending comment', async () => {
  const { gql, recorded } = fakeGql((query) =>
    query.includes('node(') ? { node: { state: 'PENDING' } } : { updatePullRequestReviewComment: {} },
  );
  await updatePendingComment(gql, 'CMT_1', 'new body');
  assert.equal(recorded.length, 2);
  assert.equal(recorded[1]?.variables?.['body'], 'new body');
});

test('deletePendingComment deletes only pending comments', async () => {
  const submitted = fakeGql(() => ({ node: { state: 'SUBMITTED' } }));
  await deletePendingComment(submitted.gql, 'CMT_1');
  assert.equal(submitted.recorded.length, 1); // state query only, no mutation

  const pendingComment = fakeGql((query) =>
    query.includes('node(') ? { node: { state: 'PENDING' } } : { deletePullRequestReviewComment: {} },
  );
  await deletePendingComment(pendingComment.gql, 'CMT_1');
  assert.equal(pendingComment.recorded.length, 2);
});

test('deletePendingComment tolerates a comment that is already gone', async () => {
  const notFound = Object.assign(new Error('not found'), { errors: [{ type: 'NOT_FOUND' }] });
  const { gql, recorded } = fakeGql(() => {
    throw notFound;
  });
  await deletePendingComment(gql, 'CMT_1');
  assert.equal(recorded.length, 1);
});
