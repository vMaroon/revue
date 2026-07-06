import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Ensures `${dataDir}/secret` exists (32-byte hex, mode 0600) and returns
 * its value. This is the shared token gating every request except /health.
 * `created` reports whether this call generated a fresh secret — the
 * first-boot signal that triggers the guided welcome (server/src/index.ts).
 */
export function ensureSecret(dataDir: string): { token: string; created: boolean } {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'secret');
  const created = !existsSync(file);
  if (created) {
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return { token: readFileSync(file, 'utf8').trim(), created };
}
