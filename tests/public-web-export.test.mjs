import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, writeFileSync, cpSync, symlinkSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {exportPublicWeb} from '../scripts/export-public-web.mjs';
import {previewHarness} from './helpers/preview-harness.mjs';

const source = resolve(import.meta.dirname, '../apps/wechat-preview');
function temporary(t) {
  const path = mkdtempSync(join(tmpdir(), 'public-web-test-'));
  t.after(() => rmSync(path, {recursive: true, force: true}));
  return path;
}
function fixture(t) {
  const root = temporary(t), input = join(root, 'input');
  cpSync(source, input, {recursive: true});
  return {input, output: join(root, 'output')};
}

test('public export includes only runnable scripts and manifest assets, and preserves the source', t => {
  const {input, output} = fixture(t);
  writeFileSync(join(input, '.env'), 'DO_NOT_PUBLISH');
  writeFileSync(join(input, 'assets/memes/private-note.txt'), 'DO_NOT_PUBLISH');
  const before = readFileSync(join(input, 'game.js'));
  const summary = exportPublicWeb(input, output);
  const files = readdirSync(output, {recursive: true, withFileTypes: true}).filter(f => f.isFile())
    .map(f => resolve(f.parentPath, f.name).slice(output.length + 1).replaceAll('\\', '/'));
  assert.equal(summary.files, files.length);
  const allowedScripts = ['content.js', 'core.bundle.js', 'gif-codec.js', 'custom-memes.js', 'game.js'];
  for (const file of files) {
    assert.ok(allowedScripts.includes(file) || ['index.html', 'README.md', '.nojekyll'].includes(file) ||
      /^assets\/(ui|memes|animations)\/[\w.-]+\.(jpg|jpeg|png)$/.test(file), file);
    assert.ok(!readFileSync(join(output, file)).includes(Buffer.from('DO_NOT_PUBLISH')), file);
  }
  const html = readFileSync(join(output, 'index.html'), 'utf8');
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]), allowedScripts);
  assert.deepEqual(readFileSync(join(input, 'game.js')), before);
  const harness = previewHarness({sourceDirectory: output, search: ''});
  assert.ok(harness.labels.includes('开始四人试玩'));
  assert.ok(!harness.labels.includes('联机开发版 · 四人房间'));
  harness.labels.length = 0;
  harness.tap(640, 571);
  assert.ok(harness.labels.includes('掷骰定主家'));
  harness.tap(640, 621); // reveal dice outcome
  harness.tap(640, 621); // handoff
  assert.ok(harness.labels.includes('请把设备交给下一位玩家'));
  harness.tap(640, 474);
  assert.ok(harness.labels.includes('牌墙剩余'));
  assert.throws(() => exportPublicWeb(input, output), /must not exist/);
});

test('public export rejects path traversal, symlinks and credential-like content', t => {
  const {input, output} = fixture(t);
  const original = readFileSync(join(input, 'content.js'), 'utf8');
  writeFileSync(join(input, 'content.js'), original.replace('assets/memes/', '../assets/memes/'));
  assert.throws(() => exportPublicWeb(input, output), /allowlist/);
  writeFileSync(join(input, 'content.js'), original);
  writeFileSync(join(input, 'content.js'), original.replace('var CONTENT = {', 'var CONTENT = {"private_notes":"hidden",'));
  assert.throws(() => exportPublicWeb(input, output), /publication review/);
  writeFileSync(join(input, 'content.js'), original);
  const game = readFileSync(join(input, 'game.js'));
  writeFileSync(join(input, 'game.js'), Buffer.concat([game, Buffer.from('\n// ghp_' + 'A'.repeat(36))]));
  assert.throws(() => exportPublicWeb(input, output), /Sensitive/);
  writeFileSync(join(input, 'game.js'), game);
  rmSync(join(input, 'gif-codec.js'));
  symlinkSync(join(source, 'gif-codec.js'), join(input, 'gif-codec.js'));
  assert.throws(() => exportPublicWeb(input, output), /Symlinks/);
});
