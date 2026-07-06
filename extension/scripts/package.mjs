// Zips the built extension into a Chrome Web Store upload package.
// Run via `npm run package` (which builds a minified dist first).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
const { version } = manifest;

// Everything the store package ships, relative to the extension root.
const include = ['manifest.json', 'options.html', 'dist', 'icons'];
for (const path of ['dist/content.js', 'dist/background.js', 'dist/options.js', 'icons/icon-128.png']) {
  if (!existsSync(resolve(root, path))) {
    console.error(`missing ${path} — run \`npm run build\` first`);
    process.exit(1);
  }
}

const outDir = resolve(root, 'build');
mkdirSync(outDir, { recursive: true });
const zipPath = resolve(outDir, `revue-${version}.zip`);
rmSync(zipPath, { force: true });

// -r recurse, -X strip extra file attrs; exclude sourcemaps and cruft.
execFileSync(
  'zip',
  ['-r', '-X', zipPath, ...include, '-x', 'dist/*.map', '-x', 'icons/*.svg', '-x', '*/.DS_Store'],
  { cwd: root, stdio: 'inherit' },
);

console.log(`\npackaged ${zipPath}`);
