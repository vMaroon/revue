// Pure-code dedupe run before verification: parallel finders overlap, and a
// duplicate finding would otherwise burn a verifier call and a comment slot.

import type { Finding, Severity } from '@revue/shared';

const SEVERITY_RANK: Record<Severity, number> = { blocking: 2, suggestion: 1, nit: 0 };

function claimTokens(claim: string): Set<string> {
  return new Set(claim.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t.length > 0));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Merges findings that target the same path, land within two lines of each
 * other, and make token-overlapping claims (Jaccard > 0.5 on lowercased word
 * sets). The first finding wins (id, claim, anchor); the merge keeps the
 * higher severity and concatenates evidence.
 */
export function dedupe(findings: Finding[]): Finding[] {
  const out: Finding[] = [];
  for (const finding of findings) {
    const existing = out.find(
      (o) =>
        o.path === finding.path &&
        Math.abs(o.line - finding.line) <= 2 &&
        jaccard(claimTokens(o.claim), claimTokens(finding.claim)) > 0.5,
    );
    if (!existing) {
      out.push(finding);
      continue;
    }
    if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[existing.severity]) {
      existing.severity = finding.severity;
    }
    existing.evidence = existing.evidence.concat(finding.evidence);
  }
  return out;
}
