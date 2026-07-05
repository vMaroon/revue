import path from 'node:path';
import { createApp } from './app';

const { app, deps } = createApp();
const { config } = deps;
const secretPath = path.join(config.dataDir, 'secret');

app.listen(config.port, '127.0.0.1', () => {
  console.log(`revue daemon listening on http://127.0.0.1:${config.port}`);
  console.log(`  dataDir: ${config.dataDir}`);
  console.log(`  secret:  ${secretPath}`);
  console.log(`  mock:    ${config.mock}`);
  console.log(
    `  paste this token into the revue extension options: ${deps.auth.token}`,
  );
  console.log(
    `  tune the pipeline: http://127.0.0.1:${config.port}/control?token=${deps.auth.token}`,
  );
});
