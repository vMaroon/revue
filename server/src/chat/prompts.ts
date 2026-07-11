// Prompt construction for the per-comment chat (docs/PIPELINE.md,
// "Per-comment chat"). The seed prompt carries everything the session needs
// once; later turns send only the user's message via resume.

import type { DraftComment } from '@revue/shared';

import { ANTISLOP_RULES } from '../pipeline/prompts/antislop';

// Verbatim converge instruction from docs/PIPELINE.md, including the
// <revised-comment> protocol the UI depends on for one-click apply.
const CONVERGE_INSTRUCTION = `> You are helping the reviewer converge on this one comment before it is
> posted. Be direct; disagree when the reviewer is wrong. You may read the
> repository to check claims. When you propose new comment text, wrap the
> complete replacement body in \`<revised-comment>\` tags — the UI offers it
> as a one-click apply. Only include the tags when you actually propose a
> rewrite.`;

const REVISED_BLOCK = /<revised-comment>([\s\S]*?)<\/revised-comment>/g;

export function buildSystemPrompt(): string {
  return 'You are a code review assistant helping a reviewer refine one draft PR review comment before it is posted.';
}

function findingSection(comment: DraftComment): string {
  const f = comment.finding;
  if (!f) {
    return 'This comment was written manually by the reviewer; there is no pipeline finding behind it.';
  }
  const lines: string[] = [
    `Dimension: ${f.dimension}`,
    `Severity: ${f.severity}`,
    `Claim: ${f.claim}`,
    `Consequence: ${f.consequence}`,
  ];
  if (f.suggestion) {
    lines.push(`Suggestion: ${f.suggestion}`);
  }
  if (f.evidence.length > 0) {
    lines.push('Evidence:');
    for (const e of f.evidence) {
      const loc = e.line === undefined ? e.path : `${e.path}:${e.line}`;
      lines.push(`- ${loc}: ${e.note}`);
      if (e.excerpt) {
        lines.push(`  excerpt: ${e.excerpt}`);
      }
    }
  }
  if (f.verification) {
    lines.push(
      `Verification (${f.verification.model}): ${f.verification.verdict} - ${f.verification.notes}`,
    );
  }
  return lines.join('\n');
}

function hunkSection(comment: DraftComment): string {
  const anchor = `${comment.path}:${comment.line} (${comment.side} side${
    comment.startLine !== undefined ? `, from line ${comment.startLine}` : ''
  })`;
  if (!comment.hunk) {
    return `Anchored at ${anchor}. No diff hunk is attached; read the file in the repository if you need the code.`;
  }
  return `Anchored at ${anchor}.\n\n\`\`\`diff\n${comment.hunk}\n\`\`\``;
}

export function buildSeedPrompt(
  comment: DraftComment,
  voiceMd: string,
  learned: string,
  userMessage: string,
): string {
  return [
    '## Baseline writing rules',
    ANTISLOP_RULES,
    '## Reviewer voice preferences (voice.md)',
    voiceMd.trim(),
    ...(learned.trim() !== '' ? ['## Learned corrections from past reviews', learned.trim()] : []),
    '## Finding',
    findingSection(comment),
    '## Diff hunk',
    hunkSection(comment),
    '## Current comment body',
    comment.body,
    '## Instructions',
    CONVERGE_INSTRUCTION,
    '## Reviewer message',
    userMessage,
  ].join('\n\n');
}

/**
 * Splits an assistant reply into the text to display and the proposed
 * comment rewrite: the LAST <revised-comment> block wins, and every block is
 * removed from the display text.
 */
export function extractRevised(text: string): { display: string; revisedBody?: string } {
  const matches = [...text.matchAll(REVISED_BLOCK)];
  const last = matches[matches.length - 1];
  if (!last) {
    return { display: text };
  }
  const display = text.replace(REVISED_BLOCK, '[proposed revision - shown below]').trim();
  return { display, revisedBody: (last[1] ?? '').trim() };
}
