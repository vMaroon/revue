import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  sourcemap: true,
  target: ['chrome120'],
  logLevel: 'info',
};

// Content scripts cannot be ES modules; the MV3 service worker can.
const builds = [
  { ...common, entryPoints: ['src/content.ts'], outfile: 'dist/content.js', format: 'iife' },
  { ...common, entryPoints: ['src/background.ts'], outfile: 'dist/background.js', format: 'esm' },
  { ...common, entryPoints: ['src/options.ts'], outfile: 'dist/options.js', format: 'iife' },
];

if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('watching...');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
