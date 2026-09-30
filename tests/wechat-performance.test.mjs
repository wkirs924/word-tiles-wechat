import test from 'node:test';
import assert from 'node:assert/strict';
import {previewHarness} from './helpers/preview-harness.mjs';

test('render requests coalesce, unchanged search ranking is reused and idle schedules nothing', () => {
  const h = previewHarness();
  const before = h.stats();
  for (let i = 0; i < 100; i++) h.handlers.wheel({deltaY: 0, preventDefault() {}});
  assert.equal(h.rafs.size, 1);
  h.flush();
  assert.equal(h.stats().frames - before.frames, 1);
  assert.equal(h.stats().rankComputations, before.rankComputations);
  assert.equal(h.rafs.size, 0);
});

test('hiding during dice presentation stops timers and keeps its authoritative outcome for return', () => {
  const h = previewHarness({native: true});
  h.tap(640, 571);
  assert.ok(h.timers.size > 0);
  h.handlers.hide(); h.flush();
  assert.equal(h.timers.size, 0);
  const frames = h.stats().frames;
  h.handlers.show(); h.flush();
  assert.ok(h.stats().frames > frames);
  assert.ok(h.labels.includes('开始交接'));
  h.tap(640, 621);
  assert.ok(h.labels.includes('请把设备交给下一位玩家'));
});

test('scrolling evicts old decoded images; hiding frees resources and ignores late image completions', () => {
  const h = previewHarness();
  h.finishImages();
  for (let i = 0; i < 24; i++) {
    h.handlers.wheel({deltaY: 180, preventDefault() {}}); h.flush(); h.finishImages();
  }
  assert.ok(h.stats().evictions > 0);
  assert.ok(h.stats().decodedImageBytes <= 24 * 1024 * 1024);
  h.handlers.wheel({deltaY: -10000, preventDefault() {}}); h.flush();
  const lateLoad = h.images.findLast(image => image.path && !image.width)?.onload;
  h.sandbox.document.hidden = true; h.handlers.visibilitychange();
  const frames = h.stats().frames;
  lateLoad?.(); h.flush();
  assert.equal(h.stats().decodedImageBytes, 0);
  assert.equal(h.stats().imageCount, 0);
  assert.equal(h.stats().frames, frames);
  h.sandbox.document.hidden = false; h.handlers.visibilitychange(); h.flush();
  assert.ok(h.stats().frames > frames);
});

test('animation package loads on demand once, failure retains stills, retry and release are safe', () => {
  const h = previewHarness({native: true, phone: true});
  h.openNativeComposer(); h.finishImages();
  assert.equal(h.packages.length, 0, 'launch and composer do not download all animations');
  for (let i = 0; i < 6 && !h.packages.length; i++) {
    h.tap(302 + (i % 3) * 337, 304 + Math.floor(i / 3) * 180);
    h.handlers.end(); h.flush();
  }
  assert.equal(h.packages.length, 1);
  assert.ok(!h.images.some(image => image.path.startsWith('packs/')), 'atlas waits for subpackage success');
  h.packages[0].fail(); h.flush();
  assert.ok(h.labels.includes('动图暂不可用，稍后重试'));
  assert.ok(h.draws.some(args => args.length === 5), 'static image stays usable');
  h.advance(8100);
  h.handlers.end(); h.flush();
  // Same visible card is still under the original touch position.
  const touches = h.images.filter(image => image.path.includes('/memes/'));
  assert.ok(touches.length);
  for (let i = 0; i < 6 && h.packages.length < 2; i++) {
    h.tap(302 + (i % 3) * 337, 304 + Math.floor(i / 3) * 180);
    h.handlers.end(); h.flush();
  }
  assert.equal(h.packages.length, 2);
  h.packages[1].success(); h.flush();
  const atlas = h.images.findLast(image => image.path.startsWith('packs/'));
  assert.ok(atlas);
  atlas.finish(1280, 1920); h.flush();
  assert.ok(h.draws.some(args => args.length === 9));
  h.handlers.hide(); h.flush();
  assert.equal(h.stats().decodedImageBytes, 0);
  assert.equal(h.timers.size, 0, 'no animation or presentation timer survives hiding');
  assert.equal(atlas.path, '', 'native texture is released');
});
