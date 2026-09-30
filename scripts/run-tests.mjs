import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('Node 24+ required. Use scripts/test.ps1 or set WORD_TILES_NODE.');
  process.exit(1);
}
const files = readdirSync(resolve('tests')).filter(x => /\.test\.(ts|mjs)$/.test(x)).sort().map(x => resolve('tests', x));
if (!files.length) throw new Error('No test files discovered');
const result = spawnSync(process.execPath, ['--test', ...files], {stdio: 'inherit'});
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
