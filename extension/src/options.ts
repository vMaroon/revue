// Options page: daemon port + token in chrome.storage.sync, plus a /health
// round-trip through the service worker so the test exercises the exact path
// the content script uses.

import type { HealthResponse } from '@revue/shared';
import type { BgRequest, BgResponse, ExtensionSettings } from './lib/contract';
import { DEFAULT_SETTINGS } from './lib/contract';

const portInput = document.getElementById('port') as HTMLInputElement;
const tokenInput = document.getElementById('token') as HTMLInputElement;
const form = document.getElementById('settings-form') as HTMLFormElement;
const testButton = document.getElementById('test') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLElement;

function showStatus(kind: 'ok' | 'error' | 'info', text: string): void {
  statusEl.hidden = false;
  statusEl.className = kind;
  statusEl.textContent = text;
}

function readForm(): ExtensionSettings {
  const port = Number.parseInt(portInput.value, 10);
  return {
    daemonPort:
      Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_SETTINGS.daemonPort,
    token: tokenInput.value.trim(),
  };
}

async function save(): Promise<void> {
  const settings = readForm();
  await chrome.storage.sync.set(settings);
  portInput.value = String(settings.daemonPort);
  tokenInput.value = settings.token;
}

async function testConnection(): Promise<void> {
  await save(); // test what is typed, not what was last saved
  showStatus('info', 'Connecting...');
  const req: BgRequest = { kind: 'http', method: 'GET', path: '/health' };
  let res: BgResponse | undefined;
  try {
    res = (await chrome.runtime.sendMessage(req)) as BgResponse | undefined;
  } catch (err) {
    showStatus('error', err instanceof Error ? err.message : String(err));
    return;
  }
  if (!res) {
    showStatus('error', 'No response from the service worker.');
    return;
  }
  if (!res.ok) {
    showStatus(
      'error',
      res.status !== undefined
        ? `Daemon error (${res.status}): ${res.error}`
        : `Cannot reach the daemon: ${res.error}`,
    );
    return;
  }
  const health = res.data as HealthResponse;
  const parts = [`version ${health.version}`];
  parts.push(health.ghUser ? `gh user ${health.ghUser}` : 'gh user unknown');
  if (health.mock) parts.push('mock mode');
  showStatus('ok', `Connected: ${parts.join(', ')}`);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  void save().then(
    () => showStatus('ok', 'Saved.'),
    (err: unknown) => showStatus('error', err instanceof Error ? err.message : String(err)),
  );
});

testButton.addEventListener('click', () => {
  void testConnection();
});

void (async () => {
  const stored = (await chrome.storage.sync.get(DEFAULT_SETTINGS)) as ExtensionSettings;
  portInput.value = String(stored.daemonPort);
  tokenInput.value = stored.token;
})();
