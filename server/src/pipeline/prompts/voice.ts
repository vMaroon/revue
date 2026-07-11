// Voice prompt: one call drafts every comment body plus the review summary
// and verdict, so severity and tone stay consistent across the review.

import type { Finding } from '@revue/shared';
import { readPreference } from '../../config';
import { ANTISLOP_RULES } from './antislop';
import { learnedSection } from './learned';

function loadVoice(): string {
  return readPreference('voice');
}

export function buildVoicePrompt(preamble: string, findings: Finding[]): string {
  const findingsJson = JSON.stringify(
    findings.map((f) => ({
      id: f.id,
      dimension: f.dimension,
      path: f.path,
      line: f.line,
      side: f.side,
      ...(f.startLine !== undefined ? { startLine: f.startLine } : {}),
      claim: f.claim,
      consequence: f.consequence,
      ...(f.suggestion !== undefined ? { suggestion: f.suggestion } : {}),
      severity: f.severity,
      evidence: f.evidence,
      verification: f.verification ?? null,
    })),
    null,
    2,
  );

  return `${preamble}

# Task: draft the review

You are drafting the review comments and summary in the reviewer's voice, from
the verified findings below. Each finding carries its verification verdict and
notes (what was actually checked); ground every claim in those notes, and
qualify comments whose verification is UNCERTAIN instead of asserting them.

## Baseline writing rules

${ANTISLOP_RULES}

## Voice rules (follow verbatim)

${loadVoice()}
${learnedSection()}
## Findings

${findingsJson.length > 0 && findings.length > 0 ? findingsJson : '(no findings survived verification)'}

## Output

Report:
- comments: one entry per finding worth posting, keyed by its findingId.
  Each entry: { findingId, severity, body }. The body is the full markdown
  comment as it would be posted to GitHub, written per the baseline and voice
  rules. Keep the finding's severity unless the verification notes justify
  changing it.
- summary: the top-level review body per the baseline summary defaults and
  the voice rules.
- verdict: "REQUEST_CHANGES" only when at least one CONFIRMED blocking finding
  remains; "APPROVE" when nothing blocking remains and the PR is sound;
  otherwise "COMMENT".`;
}
