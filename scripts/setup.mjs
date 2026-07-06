#!/usr/bin/env node
// One-shot setup: check prerequisites with actionable messages, install
// workspace deps, build the extension. Run `npm start` afterwards; the
// daemon's first boot opens the guided welcome page.

import { execFileSync } from 'node:child_process';

const ok = (msg) => console.log(`  \x1b[32mok\x1b[0m   ${msg}`);
const warn = (msg, fix) => console.log(`  \x1b[33mwarn\x1b[0m ${msg}\n       fix: ${fix}`);
const fail = (msg, fix) => {
  console.error(`  \x1b[31mFAIL\x1b[0m ${msg}\n       fix: ${fix}`);
  process.exit(1);
};
const has = (cmd, args) => {
  try {
    execFileSync(cmd, args, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

console.log('revue setup\n');
console.log('checking prerequisites:');

const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) ok(`node ${process.versions.node}`);
else fail(`node ${process.versions.node} is too old (need 20+)`, 'install Node 20+ (https://nodejs.org)');

if (has('gh', ['auth', 'status'])) ok('gh authenticated');
else
  warn(
    'gh CLI missing or not logged in — publishing and the style bootstrap need it',
    'install https://cli.github.com then `gh auth login` (public-repo reviews still work without)',
  );

if (has('claude', ['--version'])) ok('claude found (Agent SDK rides its login)');
else if (process.env.ANTHROPIC_API_KEY) ok('ANTHROPIC_API_KEY set');
else
  warn(
    'no claude binary and no ANTHROPIC_API_KEY — the pipeline cannot call models',
    'install Claude Code and log in, or export ANTHROPIC_API_KEY (`npm run mock` works without either)',
  );

console.log('\ninstalling dependencies:');
execFileSync('npm', ['install'], { stdio: 'inherit' });

console.log('\nbuilding the extension:');
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });

console.log(`
done. next:

  npm start        starts the daemon; on first run it opens a guided page
                   that walks you through loading the extension, connecting
                   it, and bootstrapping your review voice
`);
