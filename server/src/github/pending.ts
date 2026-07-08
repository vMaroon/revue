// GraphQL operations on the viewer's pending PR review. The REST API cannot
// append to a pending review, so everything here goes through GraphQL node
// ids: the pending review id is cached on the draft, each synced comment
// carries its comment node id. Mutations on comments check the comment's
// state first so a review the user already submitted on GitHub is never
// edited or deleted from here.

import type { PrRef } from '@revue/shared';
import type { PendingAnchor } from '../interfaces';

/** Executor shape of octokit.graphql: resolves with the data object. */
export type GraphQL = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

function isNotFound(err: unknown): boolean {
  const e = err as { errors?: { type?: string }[] } | null;
  return Array.isArray(e?.errors) && e.errors.some((x) => x.type === 'NOT_FOUND');
}

export async function findPendingReview(
  gql: GraphQL,
  ref: PrRef,
): Promise<{ pullRequestId: string; pendingReviewId?: string }> {
  const data = await gql<{
    viewer: { login: string };
    repository: {
      pullRequest: {
        id: string;
        reviews: { nodes: { id: string; author: { login: string } | null }[] };
      } | null;
    } | null;
  }>(
    `query($owner: String!, $repo: String!, $number: Int!) {
      viewer { login }
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          id
          reviews(first: 10, states: [PENDING]) {
            nodes { id author { login } }
          }
        }
      }
    }`,
    { owner: ref.owner, repo: ref.repo, number: ref.number },
  );
  const pr = data.repository?.pullRequest;
  if (!pr) throw new Error(`pull request ${ref.owner}/${ref.repo}#${ref.number} not found`);
  const mine = pr.reviews.nodes.find((r) => r.author?.login === data.viewer.login);
  return { pullRequestId: pr.id, ...(mine !== undefined ? { pendingReviewId: mine.id } : {}) };
}

export async function createPendingReview(
  gql: GraphQL,
  pullRequestId: string,
  body: string,
): Promise<string> {
  const data = await gql<{ addPullRequestReview: { pullRequestReview: { id: string } } }>(
    `mutation($pullRequestId: ID!, $body: String) {
      addPullRequestReview(input: { pullRequestId: $pullRequestId, body: $body }) {
        pullRequestReview { id }
      }
    }`,
    { pullRequestId, body },
  );
  return data.addPullRequestReview.pullRequestReview.id;
}

export async function addPendingComment(
  gql: GraphQL,
  pendingReviewId: string,
  anchor: PendingAnchor,
  body: string,
): Promise<string> {
  const data = await gql<{
    addPullRequestReviewThread: { thread: { comments: { nodes: { id: string }[] } } };
  }>(
    `mutation($input: AddPullRequestReviewThreadInput!) {
      addPullRequestReviewThread(input: $input) {
        thread { comments(first: 1) { nodes { id } } }
      }
    }`,
    {
      input: {
        pullRequestReviewId: pendingReviewId,
        path: anchor.path,
        line: anchor.line,
        side: anchor.side,
        ...(anchor.startLine !== undefined
          ? { startLine: anchor.startLine, startSide: anchor.side }
          : {}),
        body,
      },
    },
  );
  const id = data.addPullRequestReviewThread.thread.comments.nodes[0]?.id;
  if (id === undefined) throw new Error('GitHub returned a thread without a comment node');
  return id;
}

type CommentState = 'PENDING' | 'SUBMITTED' | 'MISSING';

async function pendingCommentState(gql: GraphQL, commentId: string): Promise<CommentState> {
  try {
    const data = await gql<{ node: { state?: string } | null }>(
      `query($id: ID!) {
        node(id: $id) { ... on PullRequestReviewComment { state } }
      }`,
      { id: commentId },
    );
    if (data.node?.state === 'PENDING') return 'PENDING';
    if (data.node?.state === undefined) return 'MISSING';
    return 'SUBMITTED';
  } catch (err) {
    if (isNotFound(err)) return 'MISSING';
    throw err;
  }
}

export async function updatePendingComment(
  gql: GraphQL,
  commentId: string,
  body: string,
): Promise<void> {
  const state = await pendingCommentState(gql, commentId);
  if (state === 'MISSING') {
    throw new Error('the pending comment no longer exists on GitHub; restore and re-accept it');
  }
  if (state === 'SUBMITTED') {
    throw new Error('the comment was already submitted on GitHub; edit it there');
  }
  await gql(
    `mutation($id: ID!, $body: String!) {
      updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) {
        pullRequestReviewComment { id }
      }
    }`,
    { id: commentId, body },
  );
}

// Submitted comments are left alone by design: deleting published content as
// a side effect of a local discard would be surprising; the local comment
// just stops tracking it.
export async function deletePendingComment(gql: GraphQL, commentId: string): Promise<void> {
  const state = await pendingCommentState(gql, commentId);
  if (state !== 'PENDING') return;
  try {
    await gql(
      `mutation($id: ID!) {
        deletePullRequestReviewComment(input: { id: $id }) {
          pullRequestReview { id }
        }
      }`,
      { id: commentId },
    );
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

export async function updatePendingReviewBody(
  gql: GraphQL,
  pendingReviewId: string,
  body: string,
): Promise<void> {
  await gql(
    `mutation($id: ID!, $body: String!) {
      updatePullRequestReview(input: { pullRequestReviewId: $id, body: $body }) {
        pullRequestReview { id }
      }
    }`,
    { id: pendingReviewId, body },
  );
}
