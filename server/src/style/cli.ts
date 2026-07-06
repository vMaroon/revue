// Terminal front-end for the style bootstrap (docs/STYLE.md): run the same
// scan+analysis the daemon runs, print the evidence-backed profile, diff the
// proposal against the current preference files, and optionally apply it.
// Direct mode - no daemon required, and the daemon's staged bootstrap state
// is not touched. Usage:
//
//   npm run style              dry run: profile + proposed-file diffs
//   npm run style -- --apply   also write voice.md, priorities.md, style-profile.md

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { StyleObservation } from '@revue/shared';
import { loadConfig, projectRoot } from '../config';
import { createGithubService } from '../github/client';
import { createAgentInvoker } from '../pipeline/agent';
import { analyzeStyle, writeStyleFiles } from './service';

const apply = process.argv.includes('--apply');
const config = loadConfig();
const github = createGithubService(config);
const invoker = createAgentInvoker(config);

const out = (line = ''): void => console.log(line);

function section(title: string, observations: StyleObservation[]): void {
  out();
  out(`${title.toUpperCase()}`);
  for (const o of observations) {
    out(`- ${o.observation}`);
    for (const q of o.evidence) out(`    "${q.replace(/\n/g, ' ')}"`);
  }
}

/** git diff --no-index of current preference file vs the proposed text;
 *  falls back to printing the proposal when git is unavailable. */
function showDiff(name: 'voice' | 'priorities', proposed: string): void {
  const current = path.join(projectRoot, 'preferences', `${name}.md`);
  const scratch = mkdtempSync(path.join(tmpdir(), 'revue-style-'));
  const proposedPath = path.join(scratch, `${name}.md`);
  writeFileSync(proposedPath, proposed);
  out();
  out(`proposed preferences/${name}.md (diff vs current)`);
  // Exits 1 when files differ, which is the expected case - never throw on it.
  const diff = spawnSync('git', ['diff', '--no-index', '--color=auto', current, proposedPath], {
    encoding: 'utf8',
  });
  if (diff.error !== undefined) {
    out('(git unavailable; full proposed text follows)');
    out(proposed);
  } else if (diff.stdout.trim() === '') {
    out('(no changes)');
  } else {
    // Drop the noisy header (diff --git, index, ---/+++ with tmp paths).
    out(diff.stdout.split('\n').slice(4).join('\n'));
  }
  rmSync(scratch, { recursive: true, force: true });
}

const started = Date.now();
out(`revue style bootstrap${config.mock ? ' (mock analysis)' : ''}`);

try {
  const tty = process.stdout.isTTY === true;
  const analysis = await analyzeStyle(config, github, invoker, (p) => {
    const label =
      p.phase === 'analyzing'
        ? `analyzing ${p.comments} comments with ${config.models.style}...`
        : `collecting: PR ${p.prsScanned}${p.prsTotal !== undefined ? `/${p.prsTotal}` : ''} - ${p.comments} comments`;
    // In a terminal the line rewrites in place; through a pipe, only phase
    // transitions print so logs stay readable.
    if (tty) process.stdout.write(`\r  ${label}          `);
    else if (p.phase === 'analyzing') out(`  ${label}`);
  });
  if (tty) out();

  const s = analysis.stats;
  const range =
    s.oldest !== undefined && s.newest !== undefined
      ? ` - ${s.oldest.slice(0, 10)}..${s.newest.slice(0, 10)}`
      : '';
  out();
  out(
    `corpus: @${analysis.login} - ${s.comments} comments (${s.byKind['review-comment']} inline, ` +
      `${s.byKind['review-summary']} summaries, ${s.byKind.discussion} discussion) - ` +
      `${s.repos} repos - reviewer ${s.byRole.reviewer} / author ${s.byRole.author}${range}` +
      `${s.truncated ? ' - sample capped' : ''}`,
  );

  section('Linguistic', analysis.profile.linguistic);
  section('Interactional', analysis.profile.interactional);
  section('Technical priorities', analysis.profile.technical);
  out();
  out(`CAVEATS`);
  out(analysis.profile.caveats);

  showDiff('voice', analysis.proposal.voiceMd);
  showDiff('priorities', analysis.proposal.prioritiesMd);

  out();
  if (apply) {
    writeStyleFiles(analysis);
    out('applied: preferences/voice.md, preferences/priorities.md written;');
    out('evidence saved to preferences/style-profile.md.');
    out();
    out('effect: both files are injected into every finder, draft, and chat');
    out('prompt from the next review on. A running daemon picks them up on the');
    out('next read - no restart. Tune or revert any of it on the control page.');
  } else {
    out('dry run: nothing written. Apply with: npm run style -- --apply');
  }
  out(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
} catch (err) {
  out();
  console.error(`style bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
