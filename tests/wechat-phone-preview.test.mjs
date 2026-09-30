import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';

const dir = resolve(import.meta.dirname, '../apps/wechat-phone-preview');
const source = resolve(import.meta.dirname, '../apps/wechat-preview');

function jpegDimensions(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.readUInt16BE(0), 0xffd8, `${path} is a JPEG`);
  let offset = 2;
  while (offset < bytes.length) {
    assert.equal(bytes[offset++], 0xff);
    let marker = bytes[offset++];
    while (marker === 0xff) marker = bytes[offset++];
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
      return {width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3)};
    }
    if (marker === 0xd9 || marker === 0xda) break;
    offset += bytes.readUInt16BE(offset);
  }
  throw new Error(`${path} has no JPEG size marker`);
}

test('phone package keeps a sub-4MB main package and lossless copies of clear animation atlases', () => {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(resolve(dir, 'content.js'), 'utf8'), sandbox);
  const content = sandbox.__WORD_TILES_CONTENT__;
  assert.equal(content.memes.length, 74);
  assert.equal(content.memes.filter(meme => meme.animation).length, 59);
  assert.equal(content.deck_presets.length, 2);
  const game = JSON.parse(readFileSync(resolve(dir, 'game.json'), 'utf8'));
  const packs = new Map(game.subpackages.map(pack => [pack.name, pack.root]));
  assert.ok(packs.size > 0);
  const expected = new Set(['game.js', 'game.json', 'core.bundle.js', 'network-client.js', 'lan-client.js', 'gif-codec.js', 'custom-memes.js', 'lan-assets.js', 'content.js', 'project.config.json', 'README.md']);
  for (const root of packs.values()) expected.add(root + 'game.js');
  for (const meme of content.memes) {
    expected.add(meme.path);
    assert.ok(existsSync(resolve(dir, meme.path)), meme.path);
    if (meme.animation) {
      const animation = meme.animation;
      expected.add(animation.path);
      assert.ok(packs.has(animation.package));
      assert.ok(animation.path.startsWith(packs.get(animation.package)));
      assert.deepEqual(readFileSync(resolve(dir, animation.path)), readFileSync(resolve(source, 'assets/animations/' + meme.key + '.jpg')), 'phone build must not re-encode JPEGs');
      assert.equal(Math.max(animation.frame_width, animation.frame_height), Math.min(288, Math.max(animation.source_width, animation.source_height)));
      const actual = jpegDimensions(resolve(dir, animation.path));
      assert.ok(actual.width * actual.height * 4 <= 10 * 1024 * 1024, 'single atlas decoded memory is bounded');
      assert.equal(actual.width, animation.columns * animation.frame_width, animation.path);
      assert.equal(actual.height, Math.ceil(animation.frames / animation.columns) * animation.frame_height, animation.path);
      assert.ok(animation.frames >= 2 && animation.frames <= 32);
    }
  }
  for (const asset of Object.values(content.ui_paths)) {
    expected.add(asset);
    assert.ok(existsSync(resolve(dir, asset)), asset);
  }
  const files = readdirSync(dir, {recursive: true, withFileTypes: true})
    .filter(entry => entry.isFile()).map(entry => entry.parentPath.slice(dir.length + 1).replaceAll('\\', '/') + '/' + entry.name)
    .map(path => path.startsWith('/') ? path.slice(1) : path);
  assert.deepEqual(new Set(files), expected, 'generated package has only required upload files');
  const total = files.reduce((sum, path) => sum + statSync(resolve(dir, path)).size, 0);
  assert.ok(total < 19_000_000, `total resource budget: ${total}`);
  const isSubpackage = path => [...packs.values()].some(root => path.startsWith(root));
  const mainBytes = files.filter(path => !isSubpackage(path)).reduce((sum, path) => sum + statSync(resolve(dir, path)).size, 0);
  assert.ok(mainBytes < 3_800_000, `main package ${mainBytes} has headroom under 4 MB`);
  for (const root of packs.values()) {
    const size = files.filter(path => path.startsWith(root)).reduce((sum, path) => sum + statSync(resolve(dir, path)).size, 0);
    assert.ok(size < 3_500_000, `${root} exceeds download budget`);
  }
  assert.equal(readFileSync(resolve(dir, 'game.js'), 'utf8'), readFileSync(resolve(source, 'game.js'), 'utf8'));
  assert.equal(readFileSync(resolve(dir, 'core.bundle.js'), 'utf8'), readFileSync(resolve(source, 'core.bundle.js'), 'utf8'));
  const config = JSON.parse(readFileSync(resolve(dir, 'project.config.json'), 'utf8'));
  assert.equal(config.compileType, 'game');
  assert.equal(config.setting.minified, true);
  assert.equal(config.appid, JSON.parse(readFileSync(resolve(source, 'project.config.json'), 'utf8')).appid);
  assert.match(config.libVersion, /^\d+\.\d+\.\d+$/);
});
