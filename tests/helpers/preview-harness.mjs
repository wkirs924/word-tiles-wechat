import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';

export function previewHarness({native = false, phone = false, sourcePath, sourceDirectory, search = '?frame=compose', seed} = {}) {
  const root = sourceDirectory || resolve(import.meta.dirname, '../../apps', phone ? 'wechat-phone-preview' : 'wechat-preview');
  const handlers = {}, images = [], packages = [], timers = new Map(), rafs = new Map(), draws = [], labels = [];
  let serial = 0, now = 1000, transforms = 0, rankCalls = 0;
  const context = new Proxy({
    drawImage(...args) { draws.push(args); }, fillText(text) { labels.push(String(text)); },
    setTransform() { transforms++; }
  }, {get(target, key) { return key in target ? target[key] : () => {}; }});
  const canvas = {getContext: () => context, addEventListener: (name, fn) => { handlers[name] = fn; }};
  class MockImage {
    set src(path) { this.path = path; if (path) images.push(this); }
    finish(width = 640, height = 640) { this.width = width; this.height = height; this.onload?.(); }
  }
  const sandbox = {
    console, URLSearchParams, Image: MockImage, Date: {now: () => now},
    requestAnimationFrame: fn => { const id = ++serial; rafs.set(id, fn); return id; },
    cancelAnimationFrame: id => rafs.delete(id),
    setInterval: (fn, delay) => { const id = ++serial; timers.set(id, {fn, delay, interval: true}); return id; },
    clearInterval: id => timers.delete(id),
    setTimeout: (fn, delay) => { const id = ++serial; timers.set(id, {fn, delay}); return id; },
    clearTimeout: id => timers.delete(id),
    document: {hidden: false, getElementById: () => canvas, addEventListener: (name, fn) => { handlers[name] = fn; }},
    window: {innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
      location: {search}, addEventListener: (name, fn) => { handlers[name] = fn; }}
  };
  if (seed !== undefined) sandbox.crypto = {getRandomValues: values => { values[0] = seed; return values; }};
  if (native) sandbox.wx = {
    createCanvas: () => canvas, createImage: () => new MockImage(),
    getWindowInfo: () => ({windowWidth: 1280, windowHeight: 720, pixelRatio: 1}),
    onTouchStart: fn => { handlers.touch = fn; }, onTouchEnd: fn => { handlers.end = fn; },
    onTouchMove: fn => { handlers.move = fn; },
    onHide: fn => { handlers.hide = fn; }, onShow: fn => { handlers.show = fn; },
    onMemoryWarning: fn => { handlers.memory = fn; },
    loadSubpackage: args => { packages.push(args); },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const name of ['content.js', 'core.bundle.js']) vm.runInContext(readFileSync(resolve(root, name), 'utf8'), sandbox);
  const rank = sandbox.WordTilesCore.rankMemes;
  sandbox.WordTilesCore.rankMemes = (...args) => { rankCalls++; return rank(...args); };
  vm.runInContext(readFileSync(sourcePath || resolve(root, 'game.js'), 'utf8'), sandbox);
  function flush() {
    let passes = 0;
    while (rafs.size) {
      if (++passes > 20) throw Error('unexpected permanent render loop');
      const callbacks = [...rafs.values()]; rafs.clear(); callbacks.forEach(fn => fn(now));
    }
  }
  function tap(x, y) {
    if (native) handlers.touch({touches: [{clientX: x, clientY: y}]});
    else handlers.pointerdown({clientX: x, clientY: y});
    flush();
  }
  function fire(delay) {
    const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
    if (!entry) return false;
    if (!entry[1].interval) timers.delete(entry[0]);
    entry[1].fn(); flush(); return true;
  }
  function openNativeComposer() {
    for (const [x, y] of [[640,571], [640,621], [640,621], [640,474], [307,626], [373,626], [975,486]]) tap(x, y);
  }
  function finishImages() {
    // Complete only current requests; a follow-up redraw can load additional visible assets.
    for (const image of [...new Set(images)]) if (image.path && !image.width) image.finish();
    flush();
  }
  flush();
  return {sandbox, handlers, images, packages, draws, labels, timers, rafs, flush, tap, fire,
    openNativeComposer, finishImages, advance: ms => { now += ms; },
    measured: () => ({frames: transforms / 2, rankCalls}),
    stats: () => sandbox.WordTilesPerformance?.snapshot()};
}
