import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {previewHarness} from './helpers/preview-harness.mjs';

const previewDir = resolve(import.meta.dirname, '../apps/wechat-preview');
const read = name => readFileSync(resolve(previewDir, name), 'utf8');

function createSandbox(extra = {}) {
  const sandbox = {console, ...extra};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

test('generated preview content keeps 74 real memes and both 136-tile decks', () => {
  const sandbox = createSandbox();
  vm.runInContext(read('content.js'), sandbox, {filename: 'content.js'});
  const content = sandbox.__WORD_TILES_CONTENT__;
  assert.ok(content, 'content.js must publish the manifest');
  assert.equal(content.memes.length, 74);
  assert.equal(content.deck_presets.length, 2);
  assert.equal(content.deck_presets.map(preset => preset.id).join(','), 'nba.words,lol.words');
  for (const preset of content.deck_presets) {
    assert.equal(preset.deck.reduce((sum, entry) => sum + entry.copies, 0), 136);
  }
  for (const meme of content.memes) {
    assert.ok(meme.keywords.length >= 1, `${meme.key} keeps keywords`);
    assert.ok(existsSync(resolve(previewDir, meme.path)), `${meme.path} exists`);
    if (meme.animation) {
      assert.ok(existsSync(resolve(previewDir, meme.animation.path)), `${meme.animation.path} exists`);
      assert.ok(meme.animation.frames >= 2 && meme.animation.frames <= 48);
      assert.ok(meme.animation.frame_ms > 0);
    }
  }
  assert.ok(content.memes.filter(meme => meme.animation).length >= 55, 'animated source memes keep frame atlases');
  for (const path of Object.values(content.ui_paths)) {
    assert.ok(existsSync(resolve(previewDir, path)), `${path} exists`);
  }
});

test('browser click loops the meme atlas and switching cards keeps one active atlas', () => {
  const h = previewHarness();
  h.handlers.pointerdown({clientX: 302, clientY: 304});
  h.flush();
  assert.ok(h.labels.includes('已选表情 1 / 12'), 'clicking a card still selects the meme');
  let cell = [302, 304];
  for (let i = 0; i < 6 && !h.images.some(image => image.path.includes('/animations/')); i++) {
    cell = [302 + (i % 3) * 337, 304 + Math.floor(i / 3) * 180];
    h.handlers.pointerdown({clientX: cell[0], clientY: cell[1]});
    h.flush();
  }
  const animated = h.images.find(image => image.path.includes('/animations/'));
  assert.ok(animated, 'click requests the animation atlas');
  const meta = h.sandbox.__WORD_TILES_CONTENT__.memes.find(meme => meme.animation && meme.animation.path === animated.path).animation;
  animated.finish(meta.columns * meta.frame_width, Math.ceil(meta.frames / meta.columns) * meta.frame_height);
  h.flush();
  const first = h.draws.filter(args => args.length === 9).at(-1);
  assert.ok(first, 'the selected card draws a cropped animation frame');
  h.advance(meta.frame_ms);
  h.fire(Math.min(50, Math.max(20, meta.frame_ms / 2)));
  const next = h.draws.filter(args => args.length === 9).at(-1);
  assert.notDeepEqual(next.slice(1, 3), first.slice(1, 3), 'the loop advances to another source frame');
  const other = cell[0] === 302 ? [977, 304] : [302, 304];
  h.handlers.pointerdown({clientX: other[0], clientY: other[1]});
  h.flush();
  h.handlers.pointerdown({clientX: cell[0], clientY: cell[1]});
  h.flush();
  assert.equal(h.images.filter(image => image.path === animated.path).length, 2, 'switching cards reloads exactly one active atlas');
});

test('WeChat tapping a meme starts a looping atlas and still selects it', () => {
  const h = previewHarness({native: true, phone: true});
  h.openNativeComposer();
  h.finishImages();
  for (let i = 0; i < 6 && !h.packages.length; i++) {
    h.tap(302 + (i % 3) * 337, 304 + Math.floor(i / 3) * 180);
    h.handlers.end(); h.flush();
  }
  assert.equal(h.packages.length, 1, 'tapping a card requests exactly one animation subpackage');
  h.packages[0].success(); h.flush();
  const animated = h.images.find(image => image.path.startsWith('packs/'));
  assert.ok(animated, 'the atlas loads only after the subpackage succeeds');
  const meta = h.sandbox.__WORD_TILES_CONTENT__.memes.find(meme => meme.animation && meme.animation.path === animated.path).animation;
  animated.finish(meta.columns * meta.frame_width, Math.ceil(meta.frames / meta.columns) * meta.frame_height);
  h.flush();
  const first = h.draws.filter(args => args.length === 9).at(-1);
  assert.ok(first, 'the tapped card plays an animation frame');
  h.advance(meta.frame_ms);
  h.fire(Math.min(50, Math.max(20, meta.frame_ms / 2)));
  const next = h.draws.filter(args => args.length === 9).at(-1);
  assert.notDeepEqual(next.slice(1, 3), first.slice(1, 3), 'the loop keeps advancing after the finger lifts');
  assert.ok(h.labels.some(text => text.startsWith('已选表情 ')), 'the tap still toggles selection');
  h.handlers.hide(); h.flush();
  assert.equal(h.stats().decodedImageBytes, 0, 'backgrounding releases the atlas');
});

test('bundled core runs the authoritative LocalTable flow without a bundler dependency', () => {
  const sandbox = createSandbox();
  vm.runInContext(read('content.js'), sandbox, {filename: 'content.js'});
  vm.runInContext(read('core.bundle.js'), sandbox, {filename: 'core.bundle.js'});
  const core = sandbox.WordTilesCore;
  assert.ok(core && core.LocalTable, 'bundle must expose LocalTable');
  const deck = sandbox.__WORD_TILES_CONTENT__.deck_presets[0].deck;
  const table = new core.LocalTable(deck);
  const view = table.view();
  assert.equal(view.round.hand.length === 13 || view.round.hand.length === 14, true);
  const active = view.round.active_player_id;
  table.switchSeat(active);
  table.confirmHandoff();
  const ids = table.view().round.hand.slice(0, 2).map(tile => tile.id);
  assert.equal(table.propose(ids, []).receipt.ok, true);
  for (const seat of core.SEATS) {
    if (seat === active) continue;
    table.switchSeat(seat);
    table.confirmHandoff();
    assert.equal(table.vote(true, 0).receipt.ok, true, `${seat} can vote`);
  }
  const after = table.view();
  assert.equal(after.round.pending_sentence, null);
});

test('WeChat canvas preview uses real decks, assets and LocalTable through touch flow', () => {
  const labels = [];
  let onTouchStart;
  const context = {
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
    fill() {}, stroke() {}, fillRect() {}, setTransform() {}, save() {}, restore() {},
    clip() {}, arc() {}, drawImage() {}, fillText(text) { labels.push(String(text)); }
  };
  const canvas = {width: 0, height: 0, getContext: () => context};
  const wx = {
    createCanvas: () => canvas,
    getWindowInfo: () => ({windowWidth: 1280, windowHeight: 720, pixelRatio: 1}),
    onTouchStart: handler => { onTouchStart = handler; },
    onWindowResize() {}, onShow() {}
  };
  const sandbox = createSandbox({wx});
  vm.runInContext(read('content.js'), sandbox, {filename: 'content.js'});
  vm.runInContext(read('core.bundle.js'), sandbox, {filename: 'core.bundle.js'});
  vm.runInContext(read('game.js'), sandbox, {filename: 'game.js'});

  assert.ok(labels.includes('开始四人试玩'), 'menu offers the trial start');
  assert.ok(labels.includes('NBA') && labels.includes('英雄联盟'), 'menu offers both decks');
  const tap = (x, y) => { labels.length = 0; onTouchStart({touches: [{clientX: x, clientY: y}]}); };

  tap(640, 571);
  assert.ok(labels.includes('掷骰定主家') && labels.includes('开始交接'), 'without timer APIs the dice result remains visible until the player continues');
  tap(640, 621);
  assert.ok(labels.includes('请把设备交给下一位玩家'), 'start opens the handoff screen');
  tap(640, 474);
  assert.ok(labels.includes('牌墙剩余'), 'handoff confirm reveals the table');
  tap(307, 626); tap(373, 626);
  tap(1078, 486);
  assert.ok(labels.includes('请把设备交给下一位玩家'), 'proposal hands off to the first voter');
  for (let round = 0; round < 3; round++) {
    if (labels.includes('请把设备交给下一位玩家')) tap(640, 474);
    assert.ok(labels.includes('这句话，你认可吗？'), `voter ${round + 1} sees the decision`);
    tap(500, 382);
  }
  if (labels.includes('请把设备交给下一位玩家')) tap(640, 474);
  assert.ok(labels.some(text => text.includes('+2.00 分')), 'accepted two-tile sentence updates live score beside a seat before round settlement');
  assert.ok(labels.includes('摸牌'), 'accepted sentence moves to the next draw');
  tap(975, 486);
  assert.ok(labels.includes('出牌'), 'draw unlocks the action');
  tap(1162, 57);
  assert.ok(labels.includes('开始四人试玩'), 'back to menu returns to the deck selection');
});

test('dice intro reveals authoritative dice and dealer before handoff on each local round', () => {
  const labels = [], textDraws = [], arcs = [], timers = new Map();
  let onTouchStart, timerId = 0, seedIndex = 0;
  const seeds = [47, 42, 47]; // seed 47 deals 4 + 5 to East; seed 42 deals 3 + 5 to North.
  const context = {
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
    fill() {}, stroke() {}, fillRect() {}, setTransform() {}, save() {}, restore() {}, clip() {},
    arc(x, y) { arcs.push({x, y}); }, drawImage() {},
    fillText(value, x, y) { labels.push(String(value)); textDraws.push({value: String(value), x, y, font: this.font}); }
  };
  const addTimer = (kind, callback, delay) => {
    const id = ++timerId;
    timers.set(id, {kind, callback, delay, active: true});
    return id;
  };
  const sandbox = createSandbox({
    wx: {
      createCanvas: () => ({width: 0, height: 0, getContext: () => context}),
      getWindowInfo: () => ({windowWidth: 1280, windowHeight: 720, pixelRatio: 1}),
      onTouchStart: handler => { onTouchStart = handler; }, onWindowResize() {}, onShow() {}
    },
    setInterval: (callback, delay) => addTimer('interval', callback, delay),
    clearInterval: id => { if (timers.has(id)) timers.get(id).active = false; },
    setTimeout: (callback, delay) => addTimer('timeout', callback, delay),
    clearTimeout: id => { if (timers.has(id)) timers.get(id).active = false; }
  });
  vm.runInContext(read('content.js'), sandbox, {filename: 'content.js'});
  vm.runInContext(read('core.bundle.js'), sandbox, {filename: 'core.bundle.js'});
  const BaseTable = sandbox.WordTilesCore.LocalTable;
  sandbox.WordTilesCore.LocalTable = class extends BaseTable {
    constructor(deck) { super(deck, () => seeds[seedIndex++]); }
  };
  vm.runInContext(read('game.js'), sandbox, {filename: 'game.js'});
  const tap = (x, y) => { labels.length = 0; textDraws.length = 0; onTouchStart({touches: [{clientX: x, clientY: y}]}); };
  const activeTimer = (kind, delay) => [...timers.values()].find(timer => timer.active && timer.kind === kind && timer.delay === delay);
  const fire = (kind, delay) => {
    const timer = activeTimer(kind, delay);
    assert.ok(timer, `${kind} ${delay} exists`);
    labels.length = 0; textDraws.length = 0; arcs.length = 0;
    if (kind === 'timeout') timer.active = false;
    timer.callback();
  };

  tap(640, 571);
  assert.ok(labels.includes('掷骰定主家') && labels.includes('骰子转动中…'));
  const secondDieValues = new Set();
  for (let frame = 0; frame < 6; frame++) {
    fire('interval', 80);
    secondDieValues.add(arcs.filter(dot => dot.x >= 683 && dot.x <= 779 && dot.y >= 281 && dot.y <= 377).length);
  }
  assert.deepEqual([...secondDieValues].sort(), [1, 2, 3, 4, 5, 6], 'rolling die cycles across all six faces');
  fire('timeout', 1050);
  assert.ok(labels.includes('骰子 4 + 5 = 9') && labels.includes('东位主家'), 'settled numbers and dealer come from the actual round');
  assert.ok(!labels.includes('请把设备交给下一位玩家'), 'the outcome remains visible before handoff');
  fire('timeout', 1300);
  assert.ok(labels.includes('请把设备交给下一位玩家'), 'handoff starts after the result reveal');
  tap(640, 474);
  assert.ok(labels.includes('当前行动：东'), 'turn appears in the header');
  assert.equal(textDraws.find(item => item.value === '牌墙剩余')?.font.includes('16px'), true, 'wall label fits the compact center panel');
  assert.ok(!labels.some(value => value.startsWith('第 1 局') || value.startsWith('骰子 4 · 5')), 'central round and dice lines are removed');

  tap(1162, 57);
  assert.ok(labels.includes('开始四人试玩'), 'back navigation exits the table');
  assert.equal([...timers.values()].some(timer => timer.active), false, 'dice timers are cleaned up on exit');
  tap(640, 571);
  tap(640, 621);
  assert.ok(labels.includes('骰子 3 + 5 = 8') && labels.includes('北位主家'), 'skip reveals the authoritative dice outcome without waiting');
  tap(1162, 57);
  assert.ok(labels.includes('开始四人试玩'), 'leaving a skipped reveal returns to the menu');
  tap(640, 571);
  fire('timeout', 1050);
  const canceledHandoff = activeTimer('timeout', 1300);
  tap(1162, 57);
  canceledHandoff.callback();
  assert.ok(labels.includes('开始四人试玩') && !labels.includes('请把设备交给下一位玩家'), 'leaving during the reveal cancels automatic handoff');
});

test('settlement ranks this round even when an older cumulative ranking differs', () => {
  const labels = [];
  let onTouchStart;
  const context = {
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
    fill() {}, stroke() {}, fillRect() {}, setTransform() {}, save() {}, restore() {},
    clip() {}, arc() {}, drawImage() {}, fillText(text) { labels.push(String(text)); }
  };
  const scores = {east: 15, south: -3, west: -9, north: -3};
  const view = {
    viewer_id: 'east', players: ['east', 'south', 'west', 'north'], round_number: 2,
    ranking: [{player_id: 'west', rank: 1, total: {numerator: 99, denominator: 3}}],
    round: {
      phase: 'COMPLETED', active_player_id: 'east', hand_counts: {east: 0, south: 13, west: 13, north: 13},
      hand: [], wall_remaining: 70, dice: [1, 2], sentences: [], winner_id: 'east',
      result: {scores: Object.fromEntries(Object.entries(scores).map(([player, numerator]) =>
        [player, {sentence_points: 0, rating_bonus: {numerator: 0}, remaining_tiles: 0, total: {numerator, denominator: 3}}]))}
    }
  };
  class FinishedTable {view() { return view; } switchSeat() {} confirmHandoff() {}}
  const wx = {
    createCanvas: () => ({width: 0, height: 0, getContext: () => context}),
    getWindowInfo: () => ({windowWidth: 1280, windowHeight: 720, pixelRatio: 1}),
    onTouchStart: handler => { onTouchStart = handler; }, onWindowResize() {}, onShow() {}
  };
  const sandbox = createSandbox({wx, WordTilesCore: {SEATS: view.players, LocalTable: FinishedTable}});
  vm.runInContext(read('content.js'), sandbox, {filename: 'content.js'});
  vm.runInContext(read('game.js'), sandbox, {filename: 'game.js'});
  const tap = (x, y) => { labels.length = 0; onTouchStart({touches: [{clientX: x, clientY: y}]}); };
  tap(640, 571); tap(640, 621); tap(640, 474);
  assert.ok(labels.includes('本局排名'));
  assert.ok(labels.some(text => text.includes('+5.00 分')), 'avatars show final score after remaining-tile settlement');
  assert.ok(labels.includes('1 · 东 · 主机') && labels.includes('4 · 西'), 'round scores override prior cumulative order');
  assert.ok(labels.includes('2 · 南') && labels.includes('2 · 北'), 'equal exact scores share a rank');
  assert.ok(!labels.includes('1 · 西'));
});

test('WeChat canvas online entry renders a room and private player view', async () => {
  const labels = [];
  let onTouchStart;
  const context = {
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
    fill() {}, stroke() {}, fillRect() {}, setTransform() {}, save() {}, restore() {},
    clip() {}, arc() {}, drawImage() {}, fillText(text) { labels.push(String(text)); }
  };
  const wx = {
    createCanvas: () => ({width: 0, height: 0, getContext: () => context}),
    getWindowInfo: () => ({windowWidth: 1280, windowHeight: 720, pixelRatio: 1}),
    onTouchStart: handler => { onTouchStart = handler; },
    onWindowResize() {}, onShow() {}, getStorageSync: () => 'alice', setStorageSync() {}
  };
  class FakeClient {
    constructor(onChange) { this.onChange = onChange; this.status = '未连接'; this.error = ''; this.connected = false; }
    login(id) { this.playerId = id; return Promise.resolve({token: 't', player_id: id}); }
    create() { this.room = {room_id: 'room-1', host_player_id: 'alice', preset_id: 'nba.words', players: ['alice'], ready: {}}; this.roomId = 'room-1'; return Promise.resolve(this.room); }
    connect() { this.connected = true; this.status = '已连接'; this.view = {viewer_id: 'alice', players: ['alice', 'bob', 'carol', 'dave'], host_player_id: 'alice', round_number: 1, ranking: [], config: {}, round: {round_id: 'round-1', dice: [4, 5], phase: 'AWAIT_ACTION', active_player_id: 'alice', dealer_id: 'alice', wall_remaining: 70, hand_counts: {alice: 14, bob: 13, carol: 13, dave: 13}, hand: [{id: 'tile-1', glyph: '好'}]}}; this.onChange(this); }
    refreshRoom() { return Promise.resolve(this.room); }
    close() {}
  }
  const sandbox = createSandbox({wx, WordTilesLan: {Client: FakeClient}, setInterval: () => 1, clearInterval() {}});
  vm.runInContext(read('content.js'), sandbox, {filename: 'content.js'});
  vm.runInContext(read('core.bundle.js'), sandbox, {filename: 'core.bundle.js'});
  vm.runInContext(read('game.js'), sandbox, {filename: 'game.js'});
  const tap = (x, y) => { labels.length = 0; onTouchStart({touches: [{clientX: x, clientY: y}]}); };
  tap(640, 508);
  assert.ok(labels.includes('同 Wi-Fi 2–4 人房间'));
  tap(640, 315);
  await new Promise(resolve => setImmediate(resolve));
  tap(640, 621);
  assert.ok(labels.some(text => text.includes('当前行动：东')), 'server view opens online table with the four-seat table layout');
  assert.ok(labels.includes('牌墙剩余'), 'wall panel matches the normal table');
  assert.ok(labels.includes('清空选择'), 'action row matches the normal table');
  assert.ok(labels.includes('好'), 'only delivered private hand renders');
  tap(196, 486);
  assert.ok(labels.includes('还没有被认可的句子'), 'sentence pill opens the accepted sentences panel');
  tap(100, 300);
  assert.ok(!labels.includes('还没有被认可的句子'), 'tapping outside closes the sentences panel');
});

test('opponents have one centered row each with identical mahjong back dimensions', () => {
  for (const counts of [[13, 13, 13], [5, 14, 20]]) {
    const backs = [];
    const context = {
      beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
      fill() {}, stroke() {}, fillRect() {}, setTransform() {}, save() {}, restore() {},
      clip() {}, arc() {}, fillText() {}, drawImage() {}
    };
    const canvas = {getContext: () => context, addEventListener() {}};
    const sandbox = createSandbox({
      __backs: backs, URLSearchParams,
      document: {getElementById: () => canvas},
      window: {innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
        location: {search: '?frame=online'}, addEventListener() {}}
    });
    vm.runInContext(read('content.js'), sandbox);
    vm.runInContext(read('core.bundle.js'), sandbox);
    const source = read('game.js').replace('function draw() {', 'function draw() { __backs.length = 0;')
      .replace('function tileBack(x, y, w, h) {', 'function tileBack(x, y, w, h) { __backs.push({x,y,w,h});')
      .replace('hand_counts: {east: 14, south: 13, west: 13, north: 13}',
        `hand_counts: {east: 14, south: ${counts[0]}, west: ${counts[1]}, north: ${counts[2]}}`);
    vm.runInContext(source, sandbox);
    assert.equal(backs.length, counts.reduce((sum, n) => sum + n, 0), 'only actual opponent hands create backs');
    const rows = [backs.filter(p => p.x === 798), backs.filter(p => p.y === 130), backs.filter(p => p.x === 450)];
    rows.forEach((row, index) => {
      assert.equal(row.length, counts[index]);
      const top = index === 1;
      assert.ok(row.every(p => p.w === (top ? 22 : 32) && p.h === (top ? 32 : 22)), 'count does not shrink individual tiles');
      const start = top ? row[0].x : row[0].y;
      const end = (top ? row.at(-1).x : row.at(-1).y) + 22;
      assert.equal((start + end) / 2, top ? 640 : 344, 'each row is centered');
      assert.ok(end - start <= 348, 'long hands stay inside the table');
    });
  }
});
