// Style-analysis prompt and output schema. One call profiles the corpus on
// three levels (linguistic, interactional, technical) and drafts the
// voice.md/priorities.md rewrites; runJson enforces the schema.

import { z } from 'zod';
import type { StyleCorpusStats } from '@revue/shared';

import { ANTISLOP_RULES } from '../pipeline/prompts/antislop';

const Observation = z.object({
  observation: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1).max(3),
});

export const StyleOut = z.object({
  linguistic: z.array(Observation).min(1).max(8),
  interactional: z.array(Observation).min(1).max(8),
  technical: z.array(Observation).min(1).max(8),
  caveats: z.string(),
  voiceMd: z.string().min(80),
  prioritiesMd: z.string().min(80),
});
export type StyleOut = z.infer<typeof StyleOut>;

export function buildStylePrompt(args: {
  login: string;
  corpusText: string;
  stats: StyleCorpusStats;
  currentVoice: string;
  currentPriorities: string;
  finderDimensions: readonly string[];
}): string {
  const { login, corpusText, stats, currentVoice, currentPriorities, finderDimensions } = args;
  const range =
    stats.oldest !== undefined && stats.newest !== undefined
      ? `${stats.oldest.slice(0, 10)} to ${stats.newest.slice(0, 10)}`
      : 'unknown range';

  return `You are profiling the code-review style of GitHub user "${login}" from a
corpus of their own public PR comments, to configure an automated reviewer
that drafts review comments in their name.

## Corpus

${stats.comments} comments across ${stats.repos} repos, ${range}. Each entry is
tagged with the user's role on that PR ([reviewer] = reviewing someone else's
PR, [author] = replying on their own) and its kind (review-comment = inline
diff comment, review-summary = review body, discussion = PR thread).

<corpus>
${corpusText}
</corpus>

## Task 1: analyze on three levels

1. linguistic - how they write. Sentence length and density; formatting
   habits (backticks around identifiers, bullets, code fences, GitHub
   suggestion blocks); openings and closings (greetings, sign-offs, or their
   absence); punctuation and capitalization habits; emoji; recurring stock
   phrases, connectives, and prefixes such as "nit:".
2. interactional - how they engage. Directness versus hedging, and the
   specific hedge words they reach for; how they voice disagreement or push
   back; question-framed versus statement-framed asks; praise frequency and
   placement; pronoun stance (I / we / you); how they concede or hold ground
   when pushed back on ([author]-role replies are the main evidence here).
3. technical - what they review for. Which of these dimensions their
   comments concentrate on: ${finderDimensions.join(', ')}; typical altitude
   (design-level versus line-level); what they escalate as blocking versus
   soften to a suggestion or nit; whether and how they cite evidence (code
   they read, links, measurements). Derive this level from [reviewer]-role
   comments; [author]-role comments inform levels 1 and 2 only.

Evidence discipline:
- Every observation carries 1-3 VERBATIM quotes from the corpus (ellipsis
  trimming allowed, no paraphrase).
- Claim only what at least two distinct comments support. One striking
  example is a caveat, not an observation.
- Describe observable communication behavior only; no personality or
  psychological trait claims.
- State sample weaknesses in caveats: small size, one dominant repo, short
  timespan, few reviewer-role comments.

## Task 2: draft the preference files

The reviewer pipeline injects two markdown files into every prompt. Rewrite
both so they encode the observed style. Current contents:

<current-voice-md>
${currentVoice.trim() === '' ? '(empty)' : currentVoice}
</current-voice-md>

<current-priorities-md>
${currentPriorities.trim() === '' ? '(empty)' : currentPriorities}
</current-priorities-md>

The pipeline always injects a built-in baseline of writing rules ahead of
voice.md. This rewrite cannot edit the baseline; voice.md wins on conflict:

<baseline-writing-rules>
${ANTISLOP_RULES}
</baseline-writing-rules>

Rules:
- The current text is a hand-written baseline. Keep its structure and any
  rule the corpus is silent on; revise rules the corpus contradicts (observed
  behavior wins); add rules for strong observed habits it lacks.
- voiceMd encodes levels 1 and 2: structure, tone, phrasing, formatting rules
  a model can follow while drafting a comment.
- voiceMd must not restate the baseline. Where the corpus clearly contradicts
  a baseline rule (the user really does open with praise, or use emoji or
  exclamation points), add an explicit override to voiceMd; otherwise leave
  the topic to the baseline.
- prioritiesMd encodes level 3: what to hunt for (ranked by observed
  emphasis), the severity rubric as they actually apply it, and what they do
  not flag.
- Every line must be a followable rule, not a description of the person.
- Keep each file under roughly 60 lines; they are injected into every prompt.`;
}
