// Shared prompt preamble: PR meta, file table, and the unified diff with
// per-file patches truncated so one huge file cannot blow the context.

import type { PrSnapshot } from '../../interfaces';

const MAX_PATCH_LINES = 400;

export function buildPreamble(snapshot: PrSnapshot): string {
  const { meta, files } = snapshot;
  const lines: string[] = [];

  lines.push('# Pull request under review');
  lines.push('');
  lines.push(`Repository: ${meta.owner}/${meta.repo}`);
  lines.push(`PR #${meta.number}: ${meta.title}`);
  lines.push(`Author: ${meta.author}`);
  lines.push(`Branches: ${meta.headRef} into ${meta.baseRef} (head ${meta.headSha})`);
  lines.push(`URL: ${meta.url}`);
  lines.push('');
  lines.push('## Description');
  lines.push('');
  lines.push(meta.body.trim() === '' ? '(no description)' : meta.body.trim());
  lines.push('');
  lines.push('## Files changed');
  lines.push('');
  lines.push('| path | status | +/- |');
  lines.push('|---|---|---|');
  for (const file of files) {
    const renamed = file.previousPath !== undefined ? ` (from ${file.previousPath})` : '';
    lines.push(`| ${file.path}${renamed} | ${file.status} | +${file.additions}/-${file.deletions} |`);
  }
  lines.push('');
  lines.push('## Diff');
  for (const file of files) {
    lines.push('');
    lines.push(`### ${file.path}`);
    if (file.patch === undefined) {
      lines.push('(no patch: binary or too large)');
      continue;
    }
    const patchLines = file.patch.split('\n');
    lines.push('```diff');
    if (patchLines.length <= MAX_PATCH_LINES) {
      lines.push(file.patch);
      lines.push('```');
    } else {
      lines.push(patchLines.slice(0, MAX_PATCH_LINES).join('\n'));
      lines.push('```');
      lines.push('[truncated - read the file in the workdir]');
    }
  }

  return lines.join('\n');
}
