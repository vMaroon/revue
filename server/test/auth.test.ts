import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { ensureSecret } from '../src/auth.ts';
import { resolveTilde } from '../src/config.ts';

const scratch = mkdtempSync(path.join(tmpdir(), 'revue-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

test('resolveTilde expands a bare tilde to the home directory', () => {
  assert.notEqual(resolveTilde('~'), '~');
  assert.ok(path.isAbsolute(resolveTilde('~')));
});

test('resolveTilde expands a leading ~/ prefix', () => {
  assert.ok(resolveTilde('~/.revue').endsWith(path.join('.revue')));
  assert.ok(path.isAbsolute(resolveTilde('~/.revue')));
});

test('resolveTilde leaves an absolute path untouched', () => {
  assert.equal(resolveTilde('/etc/revue'), '/etc/revue');
});

test('ensureSecret creates a 64-char hex token', () => {
  const { token } = ensureSecret(path.join(scratch, 'a'));
  assert.match(token, /^[0-9a-f]{64}$/);
});

test('ensureSecret is idempotent across calls', () => {
  const dir = path.join(scratch, 'b');
  assert.equal(ensureSecret(dir).token, ensureSecret(dir).token);
});

test('ensureSecret reports created only on the first call', () => {
  const dir = path.join(scratch, 'e');
  assert.equal(ensureSecret(dir).created, true);
  assert.equal(ensureSecret(dir).created, false);
});

test('ensureSecret writes the secret file with mode 0600', () => {
  const dir = path.join(scratch, 'c');
  ensureSecret(dir);
  const mode = statSync(path.join(dir, 'secret')).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('ensureSecret persists the token to disk', () => {
  const dir = path.join(scratch, 'd');
  const { token } = ensureSecret(dir);
  assert.equal(readFileSync(path.join(dir, 'secret'), 'utf8').trim(), token);
});
