/** Reproducibility, syntax, data and publish-surface verification for the regional app. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [
  ['scripts/build-region.cjs', '--check'],
  ['--check', 'js/region/app.mjs'],
  ['--check', 'js/region/embed.mjs'],
  ['--check', 'js/region/model.mjs'],
  ['--check', 'js/region/geometry.mjs'],
  ['--check', 'js/region/learning.mjs'],
  ['--check', 'js/region/mapDetails.mjs'],
  ['--check', 'js/region/timeline.mjs'],
  ['--check', 'scripts/browser-learning.qa.mjs'],
  ['--check', 'scripts/browser-region.qa.js'],
  ['--test', 'scripts/tests/region.test.mjs'],
];
for (const args of checks) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Regional static/data verification passed. Browser interaction verification is reported separately.');
