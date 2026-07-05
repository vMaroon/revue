// Distillation prompt: given the current learnings.md and one correction
// (the pipeline's draft vs the reviewer's final wording, plus any chat that
// led there), return the full rewritten learnings.md with one concise, general
// lesson merged in. The agent owns dedup and merging so the file stays short.

import type { DraftComment } from '@revue/shared';

const LEARN_BLOCK = /<learnings>([\s\S]*?)<\/learnings>/;

export function buildLearnPrompt(current: string, comment: DraftComment): string {
  const chat = comment.chat
    .slice(-6)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');
  const dimension = comment.finding?.dimension ?? 'unknown';

  return [
    'You maintain a short markdown file of durable lessons that improve a code',
    "reviewer's future comments. A reviewer just changed one drafted comment",
    'before posting it. Distill what generalizes from that change into at most',
    'one new lesson, and return the full updated file.',
    '',
    '## Current learnings.md',
    current.trim() === '' ? '(empty)' : current.trim(),
    '',
    '## The correction',
    `File/dimension: ${comment.path} (${dimension})`,
    '',
    'Pipeline drafted:',
    comment.originalBody ?? '(unknown)',
    '',
    'Reviewer changed it to:',
    comment.body,
    ...(chat !== '' ? ['', 'Chat that led to the change:', chat] : []),
    '',
    '## Rules',
    '- Add at most one lesson, and only if something GENERAL is learnable',
    '  (a tone/structure/severity/scope preference, a recurring false positive,',
    '  a phrasing rule). A one-off wording tweak with no general signal means',
    '  return the file unchanged.',
    '- Merge into an existing lesson instead of duplicating; keep each lesson to',
    '  one line, imperative, no reference to this specific PR or file.',
    '- Preserve the existing header and comments. Keep the file short.',
    '',
    'Return ONLY the full updated file wrapped in <learnings></learnings> tags.',
  ].join('\n');
}

export function extractLearnings(text: string, fallback: string): string {
  const m = LEARN_BLOCK.exec(text);
  const body = m?.[1]?.trim();
  // Guard against an empty or truncated reply clobbering the file.
  if (body === undefined || body === '') return fallback;
  return body + '\n';
}
