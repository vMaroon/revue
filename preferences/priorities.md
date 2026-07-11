# Review priorities

What I care about when reviewing, in order. Loaded into every finder prompt.

Note: always follow repo context and standards.

## Reviewer context

I work mostly in Go on distributed systems and LLM inference infrastructure
(llm-d, Kubernetes ecosystem); calibrate examples and severity to that
world, but apply the principles to any language in the PR.

## Severity rubric

- **blocking** — would cause incorrect behavior, data loss, a race, a
  breaking API change, or a security hole if merged. Must be a confirmed,
  concrete mechanism, not a style preference.
- **suggestion** — real improvement to correctness-adjacent concerns
  (error handling, test coverage of new behavior, API ergonomics,
  simplification of new code). The author could reasonably decline.
- **nit** — naming, wording, placement, doc phrasing. Never block on these.

## Hunt for (high value)

1. Correctness of the change against its stated intent — the PR
   description is a spec; divergence is a finding.
2. Concurrency: goroutine leaks, missing context cancellation/propagation,
   races on shared maps/slices, channel misuse, lock ordering.
3. Error handling: swallowed errors, lost error context (`fmt.Errorf`
   without `%w` where callers unwrap), retries without backoff/jitter,
   partial-failure states left inconsistent.
4. Kubernetes/reconciliation: non-idempotent reconcile steps, status
   updates racing spec updates, missing owner refs/finalizer handling,
   watch/cache staleness assumptions.
5. API and wire compatibility: exported symbols, CRD schemas, config file
   formats, metrics names/labels, flag defaults.
6. Tests: new behavior without a test that fails when the behavior breaks;
   tests asserting implementation instead of behavior.
7. Simplicity: speculative abstraction, single-use helpers, error handling
   for impossible cases, features nobody asked for. Minimum code that
   solves the problem is the standard.

## Do not flag

- Style the linter/formatter owns (gofmt, import order).
- Pre-existing problems in code the PR merely touches — unless the PR makes
  them worse. Mention-worthy pre-existing issues go in the summary as an
  aside, not as comments.
- Hypothetical scale/perf concerns without a plausible path to the hot
  path.
- Missing docs/comments except on exported APIs with non-obvious contracts.
- Anything you cannot tie to a specific line and mechanism.

## Evidence standard

Every finding must cite what was read: the changed lines plus whatever
surrounding code (callers, types, tests) establishes the mechanism.
"I read this" and "I infer this" are different claims — mark inference
explicitly, and expect the verifier to kill unmarked inference.
