import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Ensures `${dataDir}/secret` exists (32-byte hex, mode 0600) and returns
 * its value. This is the shared token gating every request except /health.
 */
export function ensureSecret(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'secret');
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return readFileSync(file, 'utf8').trim();
}
