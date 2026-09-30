import test from 'node:test';
import assert from 'node:assert/strict';
import {previewHarness} from './helpers/preview-harness.mjs';

for (const native of [false, true]) {
  test(`${native ? 'phone' : 'browser'} retains multiple playing cards across scrolling and background, and stops on exit`, () => {
    const h = previewHarness({native, phone: native, seed: 47});
    if (native) h.openNativeComposer();
    h.finishImages();
    const isAtlas = image => image.path.includes('/animations/') || image.path.startsWith('packs/');
    for (let i = 0; i < 6 && h.images.filter(isAtlas).length < 2; i++) {
      h.tap(302 + (i % 3) * 337, 304 + Math.floor(i / 3) * 180);
      if (native) { h.handlers.end(); h.flush(); }
      h.packages.forEach(pack => pack.success()); h.flush();
    }
    const atlases = h.images.filter(isAtlas).slice(0, 2);
    assert.equal(atlases.length, 2);
    const paths = atlases.map(image => image.path);
    const metas = paths.map(path => h.sandbox.__WORD_TILES_CONTENT__.memes.find(meme => meme.animation && meme.animation.path === path).animation);
    atlases.forEach((image, i) => image.finish(metas[i].columns * metas[i].frame_width,
      Math.ceil(metas[i].frames / metas[i].columns) * metas[i].frame_height));
    h.flush();
    const before = atlases.map(image => h.draws.filter(args => args.length === 9 && args[0] === image).at(-1));
    assert.ok(before.every(Boolean), 'both visible atlases render together');
    h.advance(Math.max(...metas.map(meta => meta.frame_ms)) + 1); h.fire(20);
    atlases.forEach((image, i) => {
      const after = h.draws.filter(args => args.length === 9 && args[0] === image).at(-1);
      assert.notDeepEqual(after.slice(1, 3), before[i].slice(1, 3));
    });
    if (native) h.handlers.hide();
    else { h.sandbox.document.hidden = true; h.handlers.visibilitychange(); }
    h.flush();
    assert.equal(h.stats().decodedImageBytes, 0);
    assert.equal(h.timers.size, 0);
    if (native) h.handlers.show();
    else { h.sandbox.document.hidden = false; h.handlers.visibilitychange(); }
    h.flush();
    for (const path of paths) assert.equal(h.images.filter(image => image.path === path).length, native ? 1 : 2,
      'both atlases are loaded again (native releases the old Image src)');
    const loadedBeforeScroll = h.images.length;
    function scroll(delta) {
      if (native) {
        h.handlers.touch({touches: [{clientX: 200, clientY: 400}]});
        h.handlers.move({touches: [{clientX: 200, clientY: 400 - delta}]});
        h.handlers.end();
      } else h.handlers.wheel({deltaY: delta, preventDefault() {}});
      h.flush();
    }
    scroll(10000);
    const frames = h.stats().frames;
    h.advance(1000); h.fire(20);
    assert.equal(h.stats().frames, frames, 'offscreen animation does not repaint');
    scroll(-10000);
    assert.ok(h.images.length > loadedBeforeScroll, 'scrolling back reloads the playing atlases');
    h.tap(1100, 120); // Return from composer to the table.
    assert.equal([...h.timers.values()].filter(timer => timer.delay === 20).length, 0);
  });
}

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
