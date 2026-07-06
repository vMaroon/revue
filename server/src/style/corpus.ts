// Pure corpus shaping for the style bootstrap: clean and sample the fetched
// comments into the analysis corpus, compute the stats the UI shows, and
// render the applied profile as preferences/style-profile.md.

import type {
  StyleCorpusStats,
  StyleObservation,
  StyleProfile,
} from '@revue/shared';
import type { UserComment } from '../interfaces';

export interface CorpusCaps {
  maxComments: number;
  maxChars: number;
  maxCommentChars: number;
}

export interface Corpus {
  entries: UserComment[];
  stats: StyleCorpusStats;
  /** The numbered, tagged text block the analysis prompt embeds. */
  text: string;
}

/** Quoted reply lines and HTML comments (bot templates) are other people's
 *  text or boilerplate, not the user's voice. */
function clean(body: string, maxCommentChars: number): string {
  const stripped = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (stripped.length <= maxCommentChars) return stripped;
  return `${stripped.slice(0, maxCommentChars)} [truncated]`;
}

export function buildCorpus(raw: UserComment[], caps: CorpusCaps): Corpus {
  const seen = new Set<string>();
  const entries: UserComment[] = [];
  let chars = 0;
  let truncated = false;

  for (const comment of raw) {
    const cleaned = clean(comment.body, caps.maxCommentChars);
    // Too short to carry style signal (bare "LGTM"/"+1" acks).
    if (cleaned.length < 8 || seen.has(cleaned)) continue;
    if (entries.length >= caps.maxComments || chars + cleaned.length > caps.maxChars) {
      truncated = true;
      break;
    }
    seen.add(cleaned);
    entries.push({ ...comment, body: cleaned });
    chars += cleaned.length;
  }

  return { entries, stats: computeStats(entries, chars, truncated), text: renderCorpus(entries) };
}

function computeStats(entries: UserComment[], chars: number, truncated: boolean): StyleCorpusStats {
  const byKind = { 'review-comment': 0, 'review-summary': 0, discussion: 0 };
  const byRole = { reviewer: 0, author: 0 };
  const repoCounts = new Map<string, number>();
  let oldest: string | undefined;
  let newest: string | undefined;

  for (const e of entries) {
    byKind[e.kind]++;
    byRole[e.role]++;
    repoCounts.set(e.repo, (repoCounts.get(e.repo) ?? 0) + 1);
    if (e.createdAt !== '') {
      if (oldest === undefined || e.createdAt < oldest) oldest = e.createdAt;
      if (newest === undefined || e.createdAt > newest) newest = e.createdAt;
    }
  }

  const topRepos = [...repoCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([repo]) => repo);

  return {
    comments: entries.length,
    byKind,
    byRole,
    repos: repoCounts.size,
    topRepos,
    ...(oldest !== undefined ? { oldest } : {}),
    ...(newest !== undefined ? { newest } : {}),
    chars,
    truncated,
  };
}

function renderCorpus(entries: UserComment[]): string {
  return entries
    .map((e, i) => {
      const month = e.createdAt.slice(0, 7) || 'undated';
      return `--- ${i + 1}. [${e.role}] ${e.repo}#${e.prNumber} ${e.kind} (${month}) ---\n${e.body}`;
    })
    .join('\n\n');
}

/** preferences/style-profile.md content: the evidence-backed analysis behind
 *  the applied voice/priorities text. Reference for the human; never injected
 *  into prompts. */
export function renderProfileMd(login: string, stats: StyleCorpusStats, profile: StyleProfile): string {
  const range =
    stats.oldest !== undefined && stats.newest !== undefined
      ? `${stats.oldest.slice(0, 10)} to ${stats.newest.slice(0, 10)}`
      : 'unknown range';
  const section = (title: string, observations: StyleObservation[]): string[] => [
    `## ${title}`,
    '',
    ...observations.flatMap((o) => [
      `- ${o.observation}`,
      ...o.evidence.map((q) => `  - > ${q.replace(/\n/g, ' ')}`),
    ]),
    '',
  ];

  return [
    '# Style profile',
    '',
    `Derived from ${stats.comments} public PR comments by @${login} ` +
      `(${stats.byRole.reviewer} as reviewer, ${stats.byRole.author} as author) ` +
      `across ${stats.repos} repos, ${range}. This is the evidence behind the`,
    'bootstrapped voice.md and priorities.md; it documents the analysis and is',
    'not read by the pipeline.',
    '',
    ...section('Linguistic', profile.linguistic),
    ...section('Interactional', profile.interactional),
    ...section('Technical priorities', profile.technical),
    '## Caveats',
    '',
    profile.caveats,
    '',
  ].join('\n');
}
