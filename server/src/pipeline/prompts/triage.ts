// Triage prompt: classify the PR and pick which finder dimensions are worth
// running. Single turn, no repo access; the preamble is all it sees.

const DIMENSION_HINTS: Record<string, string> = {
  correctness: 'logic errors, error handling gaps, wrong behavior vs stated intent',
  concurrency: 'races, leaks, missing cancellation, lock misuse',
  'api-contracts': 'breaking changes to public APIs/CRDs/configs/wire formats',
  tests: 'untested new behavior, tests that cannot fail',
  security: 'injection, authn/z gaps, secrets, unsafe defaults',
  simplicity: 'dead code, speculative abstraction, altitude mismatches',
};

export function buildTriagePrompt(preamble: string, availableFinders: string[]): string {
  const catalog = availableFinders
    .map((f) => {
      const hint = DIMENSION_HINTS[f];
      return hint !== undefined ? `- ${f}: ${hint}` : `- ${f}`;
    })
    .join('\n');

  return `${preamble}

# Task: triage

You are triaging this pull request for an automated review pipeline. Classify
it and choose which finder dimensions are worth running against it. Available
finders (choose only from these names):

${catalog}

Pick every dimension that could plausibly surface a real issue in this diff,
and skip dimensions that clearly cannot apply (for example: a docs-only PR
does not need the concurrency finder). When in doubt, include the dimension.

Report:
- size: trivial | small | medium | large (by review effort, not just line count)
- kind: a short label for what the PR is (e.g. "feature", "bugfix", "refactor", "docs", "ci")
- finders: the subset of the available finder names to run
- notes: one or two sentences of context useful to the finders (what the PR is really doing, anything suspicious)`;
}
