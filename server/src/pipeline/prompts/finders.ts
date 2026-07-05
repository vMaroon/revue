// Finder prompts: one charter per dimension plus the shared recall-first
// instruction and the reviewer's priorities file, loaded verbatim.

import { readPreference } from '../../config';
import { learnedSection } from './learned';

const CHARTERS: Record<string, string> = {
  correctness:
    'You hunt for correctness bugs: logic errors, off-by-ones, nil/undefined ' +
    'dereferences, error handling gaps, broken invariants, and behavior that ' +
    'diverges from the PR\'s stated intent (treat the PR description as a spec; ' +
    'divergence is a finding).',
  concurrency:
    'You hunt for concurrency bugs: races, goroutine/task leaks, missing ' +
    'cancellation or context propagation, lock misuse, and unsafe shared state.',
  'api-contracts':
    'You hunt for breaking changes to public contracts: exported APIs, CRDs, ' +
    'config file formats, wire formats, metrics names/labels, flag defaults - ' +
    'plus compatibility, versioning, and migration gaps.',
  tests:
    'You hunt for test gaps in the changed code specifically: new behavior ' +
    'without a test that fails when the behavior breaks, tests that cannot fail, ' +
    'and missing edge cases for the change. This is not coverage nagging - tie ' +
    'every finding to a concrete behavior of this PR.',
  security:
    'You hunt for security issues: injection, authn/z gaps, secrets in code, ' +
    'unsafe defaults, path traversal. Report only concrete issues with a ' +
    'plausible mechanism, not theory.',
  simplicity:
    'You hunt for unnecessary complexity in the new code: dead code, speculative ' +
    'abstraction, single-use helpers, error handling for impossible cases, and ' +
    'altitude mismatches. Severity is suggestion or nit only - never blocking.',
};

function loadPriorities(): string {
  return readPreference('priorities');
}

export function buildFinderPrompt(preamble: string, dimension: string): string {
  const charter =
    CHARTERS[dimension] ??
    `You hunt for issues along one dimension: ${dimension}. Report concrete, line-anchored problems in that dimension only.`;

  return `${preamble}

# Task: find issues (dimension: ${dimension})

${charter}

You have read access to the full repository checkout at the PR head (your
working directory). The diff above is the target; read surrounding code -
callers, types, tests - whenever the mechanism depends on it. Per-file patches
may be truncated; read the file in the workdir for the rest.

## Coverage

Maximize recall: report every issue you find in this dimension, including
uncertain ones - a separate adversarial verification stage filters false
positives, so do not self-censor for confidence. Stay inside your dimension;
other finders cover the rest.

## Reviewer priorities (obey the severity rubric, do-not-flag list, and evidence standard)

${loadPriorities()}
${learnedSection()}
## Output

Report an array of findings (empty array if none). Each finding:
- path: repo-relative file path in the diff
- line: line number the comment anchors to; must be a line present in the diff for that file
- side: "RIGHT" for added/context lines in the new version, "LEFT" only for deleted lines
- startLine: optional, for multi-line ranges (startLine..line)
- claim: what is wrong, stated as a checkable claim
- consequence: what happens because of it
- suggestion: optional concrete alternative
- severity: "blocking" | "suggestion" | "nit" per the rubric above
- evidence: what you actually read to establish the mechanism - path, optional line, optional excerpt, and a note per item; mark inference explicitly`;
}
