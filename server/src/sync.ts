// Mirrors accepted draft comments into the viewer's pending GitHub review,
// so the review is submitted from GitHub's own UI. The pending review is
// created on the first accept (seeded with the draft summary) and its node id
// cached on the draft; a cached id that went stale (review submitted or
// discarded on GitHub) is re-resolved once and the operation retried.
// Callers mutate comment.status only after the GitHub call succeeds.

import type { DraftComment, ReviewDraft } from '@revue/shared';
import type { GithubService, PendingAnchor } from './interfaces';

function anchorOf(comment: DraftComment): PendingAnchor {
  return {
    path: comment.path,
    line: comment.line,
    side: comment.side,
    ...(comment.startLine !== undefined ? { startLine: comment.startLine } : {}),
  };
}

async function ensurePendingReview(github: GithubService, draft: ReviewDraft): Promise<string> {
  if (draft.pendingReviewId !== undefined) return draft.pendingReviewId;
  const { pullRequestId, pendingReviewId } = await github.findPendingReview(draft.pr);
  const id = pendingReviewId ?? (await github.createPendingReview(pullRequestId, draft.summary));
  draft.pendingReviewId = id;
  return id;
}

/** Adds the comment (posting `body`) to the pending review and records the
 *  created comment's node id. Throws without local state change on failure. */
export async function pushComment(
  github: GithubService,
  draft: ReviewDraft,
  comment: DraftComment,
  body: string,
): Promise<void> {
  const cached = draft.pendingReviewId !== undefined;
  const reviewId = await ensurePendingReview(github, draft);
  try {
    comment.pendingCommentId = await github.addPendingComment(reviewId, anchorOf(comment), body);
  } catch (err) {
    if (!cached) throw err;
    delete draft.pendingReviewId;
    const fresh = await ensurePendingReview(github, draft);
    comment.pendingCommentId = await github.addPendingComment(fresh, anchorOf(comment), body);
  }
}

/** Removes the comment from the pending review. Tolerates the comment being
 *  gone or the review already submitted; always clears the link. */
export async function retractComment(
  github: GithubService,
  comment: DraftComment,
): Promise<void> {
  if (comment.pendingCommentId === undefined) return;
  await github.deletePendingComment(comment.pendingCommentId);
  delete comment.pendingCommentId;
}

/** Pushes an edited body to the comment's pending-review comment. */
export async function updateCommentBody(
  github: GithubService,
  comment: DraftComment,
  body: string,
): Promise<void> {
  if (comment.pendingCommentId === undefined) return;
  await github.updatePendingComment(comment.pendingCommentId, body);
}

/** Mirrors the summary into the pending review body. Re-resolves the pending
 *  review first so a review already submitted on GitHub is never edited; a
 *  vanished review just drops the cached id. */
export async function updateSummary(
  github: GithubService,
  draft: ReviewDraft,
  summary: string,
): Promise<void> {
  if (draft.pendingReviewId === undefined) return;
  const { pendingReviewId } = await github.findPendingReview(draft.pr);
  if (pendingReviewId === undefined) {
    delete draft.pendingReviewId;
    return;
  }
  draft.pendingReviewId = pendingReviewId;
  await github.updatePendingReviewBody(pendingReviewId, summary);
}

/** Best-effort removal of every synced comment, before a force re-run
 *  discards the draft. Failures are swallowed: a re-run must not be blocked
 *  by GitHub cleanup. */
export async function retractAll(github: GithubService, draft: ReviewDraft): Promise<void> {
  for (const comment of draft.comments) {
    if (comment.pendingCommentId === undefined) continue;
    try {
      await retractComment(github, comment);
    } catch {
      // stale link; the new run starts a fresh pending review anyway
    }
  }
}
