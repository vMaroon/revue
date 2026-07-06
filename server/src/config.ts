import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelsConfig, RevueConfig } from '@revue/shared';

/** Repo root: two levels up from server/src. */
export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

export function resolveTilde(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
  return p;
}

// Config file writes land in the file config was loaded from, or the repo-root
// revue.config.json when none existed. Tracked so the control page reports it.
let loadedConfigPath = path.join(projectRoot, 'revue.config.json');
export function configPath(): string {
  return loadedConfigPath;
}

const PREFERENCE_NAMES = ['voice', 'priorities', 'learnings'] as const;
export type PreferenceName = (typeof PREFERENCE_NAMES)[number];
// Keyed by mtime so out-of-process writes (hand edits, the style CLI) are
// picked up on the next read without a daemon restart; a missing file caches
// as empty under mtime undefined.
const preferenceCache = new Map<PreferenceName, { content: string; mtimeMs?: number }>();

function preferencePath(name: PreferenceName): string {
  return path.join(projectRoot, 'preferences', `${name}.md`);
}

function preferenceMtime(name: PreferenceName): number | undefined {
  try {
    return statSync(preferencePath(name)).mtimeMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return undefined;
  }
}

/** Preference read, cached per on-disk mtime. A missing file reads as empty
 *  (learnings.md may not exist until the first correction). */
export function readPreference(name: PreferenceName): string {
  const mtimeMs = preferenceMtime(name);
  const cached = preferenceCache.get(name);
  if (cached !== undefined && cached.mtimeMs === mtimeMs) return cached.content;
  let content = '';
  if (mtimeMs !== undefined) {
    try {
      content = readFileSync(preferencePath(name), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  preferenceCache.set(name, { content, ...(mtimeMs !== undefined ? { mtimeMs } : {}) });
  return content;
}

export function writePreference(name: PreferenceName, content: string): void {
  writeFileSync(preferencePath(name), content);
  const mtimeMs = preferenceMtime(name);
  preferenceCache.set(name, { content, ...(mtimeMs !== undefined ? { mtimeMs } : {}) });
}

/** Persist the tunable config fields to configPath() as pretty JSON. */
export function saveConfig(config: RevueConfig): void {
  const onDisk = {
    port: config.port,
    models: config.models,
    finders: config.finders,
    maxParallel: config.maxParallel,
    agentTimeoutMs: config.agentTimeoutMs,
    dataDir: config.dataDir,
    mock: config.mock,
  };
  writeFileSync(loadedConfigPath, JSON.stringify(onDisk, null, 2) + '\n');
}

const defaults: RevueConfig = {
  port: 7388,
  models: {
    triage: 'claude-haiku-4-5',
    finder: 'claude-sonnet-5',
    verifier: 'claude-opus-4-8',
    voice: 'claude-opus-4-8',
    chat: 'claude-opus-4-8',
    style: 'claude-opus-4-8',
    learn: 'claude-opus-4-8',
  },
  finders: ['correctness', 'concurrency', 'api-contracts', 'tests', 'security', 'simplicity'],
  // Concurrent agent subprocesses. Kept low by default: each finder is a
  // multi-turn agent making many API calls, and a big fan-out bursts a
  // subscription's rate limit. Raise on a pay-as-you-go API key.
  maxParallel: 2,
  agentTimeoutMs: 300_000,
  dataDir: '~/.revue',
  mock: false,
};

type FileConfig = Partial<Omit<RevueConfig, 'models'>> & { models?: Partial<ModelsConfig> };

export function loadConfig(): RevueConfig {
  // First found wins: repo-root config shadows the home config entirely.
  const candidates = [
    path.join(projectRoot, 'revue.config.json'),
    path.join(homedir(), '.revue', 'config.json'),
  ];
  let fromFile: FileConfig = {};
  for (const file of candidates) {
    if (existsSync(file)) {
      try {
        fromFile = JSON.parse(readFileSync(file, 'utf8')) as FileConfig;
      } catch (err) {
        throw new Error(`invalid config file ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
      loadedConfigPath = file;
      break;
    }
  }

  const config: RevueConfig = {
    ...defaults,
    ...fromFile,
    models: { ...defaults.models, ...(fromFile.models ?? {}) },
  };

  const envPort = process.env.REVUE_PORT;
  if (envPort !== undefined) {
    const port = Number.parseInt(envPort, 10);
    if (Number.isFinite(port)) config.port = port;
  }
  if (process.env.REVUE_MOCK === '1') config.mock = true;
  const envParallel = process.env.REVUE_MAX_PARALLEL;
  if (envParallel !== undefined) {
    const n = Number.parseInt(envParallel, 10);
    if (Number.isFinite(n) && n > 0) config.maxParallel = n;
  }
  const envTimeout = process.env.REVUE_AGENT_TIMEOUT_MS;
  if (envTimeout !== undefined) {
    const n = Number.parseInt(envTimeout, 10);
    if (Number.isFinite(n) && n > 0) config.agentTimeoutMs = n;
  }

  config.dataDir = resolveTilde(config.dataDir);
  return config;
}
