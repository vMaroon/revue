// Fetches the user's recent public PR comments for the style bootstrap
// (docs/STYLE.md): search the PRs they commented on, then pull their inline
// review comments, review bodies, and discussion comments from each.

import type { Octokit } from '@octokit/rest';
import type { StyleCommentKind, StyleCommentRole } from '@revue/shared';
import { dlog } from '../log';
import type { UserComment, UserCommentsOptions } from '../interfaces';

interface PrTarget {
  owner: string;
  repo: string;
  number: number;
  role: StyleCommentRole;
}

// Per-PR sampling cap so one comment-heavy PR cannot crowd out repo diversity;
// filled in kind-priority order (inline comments carry the most review signal).
const PER_PR_CAP = 20;

export async function fetchUserComments(
  octokit: Octokit,
  login: string,
  opts: UserCommentsOptions,
): Promise<UserComment[]> {
  // `is:public` scopes the corpus to comments that are already public;
  // `sort:updated` favors recent activity so the profile reflects current habits.
  const search = await octokit.search.issuesAndPullRequests({
    q: `commenter:${login} is:pr is:public`,
    sort: 'updated',
    order: 'desc',
    per_page: opts.maxPrs,
  });

  const targets: PrTarget[] = [];
  for (const item of search.data.items) {
    if (item.pull_request === undefined) continue; // defensive: PRs only
    // repository_url = https://api.github.com/repos/{owner}/{repo}
    const m = /\/repos\/([^/]+)\/([^/]+)$/.exec(item.repository_url);
    if (m === null || m[1] === undefined || m[2] === undefined) continue;
    targets.push({
      owner: m[1],
      repo: m[2],
      number: item.number,
      role: item.user?.login === login ? 'author' : 'reviewer',
    });
  }

  const collected: UserComment[] = [];
  let scanned = 0;
  for (const target of targets) {
    if (collected.length >= opts.maxComments) break;
    try {
      collected.push(...(await fetchPrComments(octokit, login, target)));
    } catch (err) {
      // One inaccessible or flaky PR must not sink the corpus; skip it.
      dlog(
        'style',
        `skipping ${target.owner}/${target.repo}#${target.number}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    scanned++;
    opts.onProgress?.(scanned, targets.length, Math.min(collected.length, opts.maxComments));
  }
  return collected.slice(0, opts.maxComments);
}

async function fetchPrComments(
  octokit: Octokit,
  login: string,
  target: PrTarget,
): Promise<UserComment[]> {
  const params = { owner: target.owner, repo: target.repo, per_page: 100 };
  const [reviewComments, reviews, discussion] = await Promise.all([
    octokit.pulls.listReviewComments({ ...params, pull_number: target.number }),
    octokit.pulls.listReviews({ ...params, pull_number: target.number }),
    octokit.issues.listComments({ ...params, issue_number: target.number }),
  ]);

  const repo = `${target.owner}/${target.repo}`;
  const make = (kind: StyleCommentKind, body: string | null | undefined, createdAt: string): UserComment[] =>
    body === null || body === undefined || body.trim() === ''
      ? []
      : [{ kind, role: target.role, repo, prNumber: target.number, body, createdAt }];

  const mine: UserComment[] = [
    ...reviewComments.data
      .filter((c) => c.user?.login === login)
      .flatMap((c) => make('review-comment', c.body, c.created_at)),
    ...reviews.data
      .filter((r) => r.user?.login === login)
      .flatMap((r) => make('review-summary', r.body, r.submitted_at ?? '')),
    ...discussion.data
      .filter((c) => c.user?.login === login)
      .flatMap((c) => make('discussion', c.body, c.created_at)),
  ];
  return mine.slice(0, PER_PR_CAP);
}
