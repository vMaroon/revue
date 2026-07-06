import { spawn } from 'node:child_process';
import path from 'node:path';
import { createApp } from './app';

const { app, deps, firstBoot } = createApp();
const { config } = deps;
const secretPath = path.join(config.dataDir, 'secret');
const controlUrl = `http://127.0.0.1:${config.port}/control?token=${deps.auth.token}`;

app.listen(config.port, '127.0.0.1', () => {
  console.log(`revue daemon listening on http://127.0.0.1:${config.port}`);
  console.log(`  dataDir: ${config.dataDir}`);
  console.log(`  secret:  ${secretPath}`);
  console.log(`  mock:    ${config.mock}`);
  console.log(
    `  paste this token into the revue extension options: ${deps.auth.token}`,
  );
  console.log(`  tune the pipeline: ${controlUrl}`);
  if (firstBoot) {
    console.log('  first run: opening the guided setup page (REVUE_NO_OPEN=1 disables this)');
    openBrowser(`${controlUrl}&welcome=1`);
  }
});

/** Best-effort browser launch for the first-boot welcome; failure is silent
 *  (the control URL is printed above either way). */
function openBrowser(url: string): void {
  if (process.env.REVUE_NO_OPEN === '1') return;
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    // Headless or exotic platform; the printed URL is the fallback.
  }
}
