import type { Octokit } from '@octokit/rest';
import type { PublishResult, PublishValidation, ReviewDraft } from '@revue/shared';
import type { PrSnapshot } from '../interfaces';
import { diffUtils } from './diff';

export function validate(draft: ReviewDraft, snapshot: PrSnapshot): PublishValidation {
  const accepted = draft.comments.filter((c) => c.status === 'accepted');
  const problems: PublishValidation['problems'] = [];
  for (const c of accepted) {
    const anchor = diffUtils.validateAnchor(snapshot.files, c.path, c.line, c.side);
    if (!anchor.valid) {
      problems.push({ commentId: c.id, reason: anchor.reason ?? 'invalid anchor' });
    }
    if (c.body.trim() === '') {
      problems.push({ commentId: c.id, reason: 'empty body' });
    }
  }
  return {
    ok: problems.length === 0,
    problems,
    willPost: {
      comments: accepted.length,
      verdict: draft.verdict,
      summaryChars: draft.summary.length,
    },
  };
}

/**
 * Posts summary + accepted comments as one PR review, then marks the draft
 * and its accepted comments published. Caller has already validated, and is
 * responsible for saving/emitting the mutated draft.
 */
export async function publish(
  octokit: Octokit,
  draft: ReviewDraft,
  snapshot: PrSnapshot,
): Promise<PublishResult> {
  const accepted = draft.comments.filter((c) => c.status === 'accepted');
  const { data: review } = await octokit.pulls.createReview({
    owner: draft.pr.owner,
    repo: draft.pr.repo,
    pull_number: draft.pr.number,
    commit_id: snapshot.meta.headSha,
    body: draft.summary,
    event: draft.verdict,
    comments: accepted.map((c) => ({
      path: c.path,
      line: c.line,
      side: c.side,
      body: c.body,
      ...(c.startLine !== undefined ? { start_line: c.startLine, start_side: c.side } : {}),
    })),
  });
  const at = new Date().toISOString();
  const url = review.html_url;
  draft.published = { url, at };
  draft.status = 'published';
  draft.updatedAt = at;
  for (const c of accepted) {
    c.status = 'published';
    c.updatedAt = at;
  }
  return { url, at };
}
