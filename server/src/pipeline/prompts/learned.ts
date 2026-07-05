// The learnings section injected into finder, drafting, and chat prompts.
// Empty (no heading) until the first correction is distilled into learnings.md.

import { readPreference } from '../../config';

export function learnedSection(): string {
  const learnings = readPreference('learnings').trim();
  if (learnings === '') return '';
  return `\n## Learned corrections from past reviews (apply these)\n\n${learnings}\n`;
}
