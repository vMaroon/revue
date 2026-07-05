// Verifier prompt: adversarial, refute-first. One finding per call.

import type { Finding } from '@revue/shared';

export function buildVerifyPrompt(preamble: string, finding: Finding): string {
  const findingJson = JSON.stringify(
    {
      dimension: finding.dimension,
      path: finding.path,
      line: finding.line,
      side: finding.side,
      ...(finding.startLine !== undefined ? { startLine: finding.startLine } : {}),
      claim: finding.claim,
      consequence: finding.consequence,
      ...(finding.suggestion !== undefined ? { suggestion: finding.suggestion } : {}),
      severity: finding.severity,
      evidence: finding.evidence,
    },
    null,
    2,
  );

  return `${preamble}

# Task: verify one finding

An automated finder tuned for recall produced the finding below. Your only job
is to refute it. Assume this finding is wrong until the code proves otherwise.
Read the actual code paths in the repository checkout (your working directory):
the cited lines, their callers, the types involved, and any tests that pin the
behavior. Do not trust the finding's own evidence - re-derive it.

## Finding

${findingJson}

## Verdict

- REFUTED: the claimed mechanism does not hold (the case is handled, the code
  path is unreachable, the claim misreads the code, or it violates the
  reviewer's do-not-flag rules such as pre-existing issues the PR does not
  worsen). Say exactly what you read that kills it.
- CONFIRMED: you traced the mechanism in the code and it holds as claimed.
- UNCERTAIN: you could not establish it either way. Say UNCERTAIN honestly -
  do not rubber-stamp a CONFIRMED you did not earn.

Report { verdict, notes }. The notes must state what you actually read
(functions, paths) and how it supports the verdict.`;
}
