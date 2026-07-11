#!/usr/bin/env node
// One-shot setup: check prerequisites with actionable messages, install
// workspace deps, build the extension, then walk a short customization —
// every question has a default, so Enter-through works. Run `npm start`
// afterwards; the daemon's first boot opens the guided welcome page.
//
//   node scripts/setup.mjs               prompts when run in a terminal
//   node scripts/setup.mjs --defaults    accept every default, never prompt
//   node scripts/setup.mjs --customize   prompt even when stdin is piped

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const interactive =
  args.includes('--customize') || (process.stdin.isTTY === true && !args.includes('--defaults'));

const ok = (msg) => console.log(`  \x1b[32mok\x1b[0m   ${msg}`);
const warn = (msg, fix) => console.log(`  \x1b[33mwarn\x1b[0m ${msg}\n       fix: ${fix}`);
const fail = (msg, fix) => {
  console.error(`  \x1b[31mFAIL\x1b[0m ${msg}\n       fix: ${fix}`);
  process.exit(1);
};
const note = (msg) => console.log(`  \x1b[2m${msg}\x1b[0m`);
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

const ghOk = has('gh', ['auth', 'status']);
if (ghOk) ok('gh authenticated');
else
  warn(
    'gh CLI missing or not logged in — publishing and the style bootstrap need it',
    'install https://cli.github.com then `gh auth login` (public-repo reviews still work without)',
  );

const claudeOk = has('claude', ['--version']) || process.env.ANTHROPIC_API_KEY !== undefined;
if (has('claude', ['--version'])) ok('claude found (Agent SDK rides its login)');
else if (process.env.ANTHROPIC_API_KEY) ok('ANTHROPIC_API_KEY set');
else
  warn(
    'no claude binary and no ANTHROPIC_API_KEY — the pipeline cannot call models',
    'install Claude Code and log in, or export ANTHROPIC_API_KEY (`npm run mock` works without either)',
  );

// Children never read stdin: piped answers must survive for the questions.
console.log('\ninstalling dependencies:');
execFileSync('npm', ['install'], { stdio: ['ignore', 'inherit', 'inherit'], cwd: root });

console.log('\nbuilding the extension:');
execFileSync('npm', ['run', 'build'], { stdio: ['ignore', 'inherit', 'inherit'], cwd: root });

// readline.question drops lines that arrive between questions (piped input
// delivers everything at once), so queue lines and hand them out per ask.
// EOF answers null - distinct from '' (Enter), which consents to a default.
function createPrompter() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const lines = [];
  const waiters = [];
  let closed = false;
  rl.on('line', (line) => {
    const waiter = waiters.shift();
    if (waiter !== undefined) waiter(line);
    else lines.push(line);
  });
  rl.on('close', () => {
    closed = true;
    for (const waiter of waiters.splice(0)) waiter(null);
  });
  return {
    async ask(question) {
      process.stdout.write(question);
      let line;
      if (lines.length > 0) line = lines.shift();
      else if (closed) line = null;
      else line = await new Promise((resolve) => waiters.push(resolve));
      // A terminal echoes typing on its own; piped answers echo here so the
      // transcript stays readable.
      if (process.stdin.isTTY !== true) process.stdout.write(`${line ?? ''}\n`);
      return line;
    },
    close: () => rl.close(),
  };
}

const prioritiesFile = path.join(root, 'preferences', 'priorities.md');
const contextSection = /## Reviewer context\n+([\s\S]*?)(?=\n## |$)/;

function currentContext() {
  if (!existsSync(prioritiesFile)) return '';
  const m = readFileSync(prioritiesFile, 'utf8').match(contextSection);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

function writeContext(focus) {
  const text = existsSync(prioritiesFile)
    ? readFileSync(prioritiesFile, 'utf8')
    : '# Review priorities\n';
  const section = `## Reviewer context\n\n${focus}\n`;
  const updated = contextSection.test(text)
    ? text.replace(contextSection, () => `${section}`)
    : `${text.trimEnd()}\n\n${section}`;
  writeFileSync(prioritiesFile, updated);
}

function writeMaxParallel(maxParallel) {
  const repoConfig = path.join(root, 'revue.config.json');
  const homeConfig = path.join(homedir(), '.revue', 'config.json');
  // Mirror the daemon's search order: the repo config shadows the home one.
  const source = existsSync(repoConfig) ? repoConfig : existsSync(homeConfig) ? homeConfig : undefined;
  let base = {};
  if (source !== undefined) {
    try {
      base = JSON.parse(readFileSync(source, 'utf8'));
    } catch {
      fail(`invalid JSON in ${source}`, 'fix or delete it, then rerun npm run setup');
    }
  }
  if (source === undefined && maxParallel === 2) return; // code default; no file needed
  writeFileSync(repoConfig, JSON.stringify({ ...base, maxParallel }, null, 2) + '\n');
}

if (interactive) {
  console.log('\ncustomize (Enter accepts the default):\n');
  const rl = createPrompter();

  // Parallelism follows billing: a subscription rate-limits agent bursts, a
  // pay-as-you-go key does not (same reasoning as the config.ts default).
  const payg = process.env.ANTHROPIC_API_KEY !== undefined;
  const billingDefault = payg ? '2' : '1';
  const billing =
    (
      (await rl.ask(
        `  Claude access — 1: subscription, 2: pay-as-you-go API key [${billingDefault}]: `,
      )) ?? ''
    ).trim() || billingDefault;
  const maxParallel = billing === '2' ? 4 : 2;
  writeMaxParallel(maxParallel);
  ok(`${maxParallel} parallel agents`);

  // One line of reviewer context, injected into every finder prompt via
  // preferences/priorities.md, so examples and severity match your world.
  console.log();
  const existing = currentContext();
  if (existing !== '') note(`current: ${existing.length > 100 ? `${existing.slice(0, 100)}...` : existing}`);
  const focus = (
    (await rl.ask(
      `  Your stack and review focus, one line${existing !== '' ? ' (Enter keeps current)' : ' (Enter skips)'}: `,
    )) ?? ''
  ).trim();
  if (focus !== '') {
    writeContext(focus);
    ok('saved to preferences/priorities.md (Reviewer context)');
  } else {
    ok(existing !== '' ? 'keeping current context' : 'skipped; editable later on the control page');
  }

  // The voice scan: learn how the user actually writes reviews. Shows the
  // evidence-backed proposal and confirms before writing any file.
  console.log();
  if (ghOk && claudeOk) {
    note('the voice scan reads your public GitHub PR comments and proposes voice and');
    note('priorities files in your own style; you see the diff and approve any write.');
    // Enter means yes; EOF (null) does not, so partial piped input never
    // consents to a model call on its own.
    const scanAnswer = await rl.ask('  Learn your review voice from GitHub now? [Y/n]: ');
    const scan =
      scanAnswer !== null && (scanAnswer.trim() || 'y').toLowerCase().startsWith('y');
    rl.close();
    if (scan) {
      console.log();
      try {
        execFileSync('npm', ['run', 'style', '--', '--interactive'], { stdio: 'inherit', cwd: root });
      } catch {
        warn('voice scan did not finish', 'rerun later with `npm run style -- --interactive`');
      }
    } else {
      note('later: npm run style -- --interactive (or from the control page)');
    }
  } else {
    rl.close();
    note(
      `voice scan skipped (${ghOk ? 'no Claude access' : 'gh not authenticated'}); ` +
        'later: npm run style -- --interactive',
    );
  }
} else {
  console.log('\ncustomization skipped (--defaults or no terminal); defaults in place.');
  note('customize later: npm run setup -- --customize');
  note('voice scan:      npm run style -- --interactive');
}

console.log(`
done. next:

  npm start        starts the daemon; on first run it opens a guided page
                   that walks you through loading the extension, connecting
                   it, and bootstrapping your review voice
`);
