import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { PrMeta, RevueConfig } from '@revue/shared';

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string | undefined, token: string | undefined): Promise<void> {
  try {
    await execFileAsync('git', args, {
      cwd,
      // Fail fast instead of hanging on a credential prompt (no TTY guarantee).
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    let detail = (e.stderr ?? '').trim() || (e.message ?? String(err));
    if (token) detail = detail.split(token).join('***');
    throw new Error(`git ${args[0] ?? ''} failed: ${detail}`);
  }
}

/**
 * Clone (once, blobless) and fetch+checkout the PR head into
 * `${dataDir}/workdirs/${owner}__${repo}`, detached at FETCH_HEAD.
 * Returns the absolute workdir path.
 */
export async function ensureWorkdir(config: RevueConfig, meta: PrMeta, token?: string): Promise<string> {
  const dir = join(config.dataDir, 'workdirs', `${meta.owner}__${meta.repo}`);
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(dirname(dir), { recursive: true });
    const url = token
      ? `https://x-access-token:${token}@github.com/${meta.owner}/${meta.repo}`
      : `https://github.com/${meta.owner}/${meta.repo}`;
    await git(['clone', '--filter=blob:none', url, dir], undefined, token);
  }
  await git(['fetch', 'origin', `pull/${meta.number}/head`], dir, token);
  // -f discards any local changes left in the cached workdir.
  await git(['checkout', '-f', '--detach', 'FETCH_HEAD'], dir, token);
  return dir;
}
