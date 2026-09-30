import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function library() {
  const keys = ['a', 'b'].map(c => 'meme.user.' + c.repeat(64));
  const records = keys.map(key => ({key, title: '动图', keywords: ['动图'], format: 'gif',
    size: 16, width: 1, height: 1, frames: 2, duration: 200}));
  const pending = [];
  const sandbox = {console, Uint8Array, WordTilesGif: {decode() {
    return new Promise(resolve => pending.push(() => resolve({width: 1, height: 1,
      frames: [new Uint8Array(4), new Uint8Array(4)], frame_ms: 100})));
  }}, wx: {
    env: {USER_DATA_PATH: '/mock'},
    getFileSystemManager: () => ({mkdirSync() {}, accessSync() {}, readdirSync: () => [],
      readFileSync: () => JSON.stringify(records),
      readFile: options => options.success({data: new Uint8Array(16).buffer})}),
    createOffscreenCanvas: () => ({getContext: () => ({
      createImageData: () => ({data: new Uint8Array(4)}), putImageData() {}
    })})
  }};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(new URL('../apps/wechat-preview/custom-memes.js', import.meta.url), 'utf8'), sandbox);
  return {api: sandbox.WordTilesCustomMemes, keys, pending};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('custom GIFs keep separate decoded surfaces, and releasing one preserves the other', async () => {
  const {api, keys, pending} = library();
  await api.initialise();
  const first = api.image(keys[0], true), second = api.image(keys[1], true);
  await settle();
  assert.equal(pending.length, 2);
  pending.splice(0).forEach(finish => finish()); await settle();
  assert.equal(first.state, 'ready'); assert.equal(second.state, 'ready');
  assert.notEqual(first.value.canvas, second.value.canvas);
  assert.equal(api.image(keys[0], true), first);
  assert.equal(api.image(keys[1], true), second);
  api.releaseImage(keys[0], true);
  assert.equal(api.image(keys[1], true), second);
  assert.notEqual(api.image(keys[0], true), first);
  api.release(false);
  assert.notEqual(api.image(keys[1], true), second);
});

test('custom GIF decode completion after release cannot restore a discarded animation', async () => {
  const {api, keys, pending} = library();
  await api.initialise();
  let notifications = 0; api.onChange(() => notifications++);
  const old = api.image(keys[0], true);
  await settle();
  api.release(false);
  pending.splice(0).forEach(finish => finish()); await settle();
  assert.equal(old.value, undefined);
  assert.equal(notifications, 0);
  const fresh = api.image(keys[0], true);
  await settle();
  pending.splice(0).forEach(finish => finish()); await settle();
  assert.equal(fresh.state, 'ready');
  assert.equal(notifications, 1);
});
