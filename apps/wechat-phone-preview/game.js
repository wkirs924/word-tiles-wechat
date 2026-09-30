(function () {
  'use strict';
  var inWeChat = typeof wx !== 'undefined' && typeof wx.createCanvas === 'function';
  var globalRoot = typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof globalThis !== 'undefined' ? globalThis : this);
  var CONTENT = globalRoot.__WORD_TILES_CONTENT__ || null;
  var CORE = globalRoot.WordTilesCore || null;
  var NETWORK = globalRoot.WordTilesNetwork || null;
  var LAN_NETWORK = globalRoot.WordTilesLan || null;
  var CUSTOM = globalRoot.WordTilesCustomMemes || null;
  if (!CONTENT && typeof require === 'function') { try { CONTENT = require('./content.js'); } catch (e) { CONTENT = null; } }
  if (!CORE && typeof require === 'function') { try { CORE = require('./core.bundle.js'); } catch (e) { CORE = null; } }
  if (!NETWORK && typeof require === 'function') { try { NETWORK = require('./network-client.js'); } catch (e) { NETWORK = null; } }
  if (inWeChat && !LAN_NETWORK && typeof require === 'function') { try { LAN_NETWORK = require('./lan-client.js'); } catch (e) { LAN_NETWORK = null; } }
  if (!CUSTOM && typeof require === 'function') { try { CUSTOM = require('./custom-memes.js'); } catch (e) { CUSTOM = null; } }
  if (inWeChat) NETWORK = LAN_NETWORK || null;
  if (CONTENT) globalRoot.__WORD_TILES_CONTENT__ = CONTENT;
  if (CORE) globalRoot.WordTilesCore = CORE;

  var canvas = inWeChat ? wx.createCanvas() : document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var W = 1280, H = 720;
  var THEME = CONTENT && CONTENT.theme ? CONTENT.theme : {
    background: '#091d23', surface: '#183d3a', paper: '#f4eddc', ink: '#223c39',
    accent: '#e4c086', muted: '#a6bbb0', digital: '#80ffb0'
  };
  var UI = CONTENT && CONTENT.ui ? CONTENT.ui : {};
  var UI_PATHS = CONTENT && CONTENT.ui_paths ? CONTENT.ui_paths : {};
  var MEMES = CONTENT && CONTENT.memes ? CONTENT.memes : [];
  var ANIMATIONS = {}, ANIMATION_PACKAGES = {};
  for (var ai = 0; ai < MEMES.length; ai++) if (MEMES[ai].animation) {
    ANIMATIONS[MEMES[ai].path] = MEMES[ai].animation;
    if (MEMES[ai].animation.package) ANIMATION_PACKAGES[MEMES[ai].animation.path] = MEMES[ai].animation.package;
  }
  var DECKS = CONTENT && CONTENT.deck_presets ? CONTENT.deck_presets : [];
  var PLAYBACK = CONTENT && CONTENT.playback ? CONTENT.playback : { seconds_per_image: 2 };
  var FONT = CONTENT && CONTENT.font ? CONTENT.font : { families: [], size: 18, roles: {} };
  var FAMILIES = (FONT.families && FONT.families.length ? FONT.families : ['Microsoft YaHei', 'sans-serif']).join(',');
  var TILE_FONT = FONT.roles && FONT.roles.tile ? '"' + FONT.roles.tile + '","' + FAMILIES + '"' : '"' + FAMILIES + '"';
  var SEATS = CORE ? CORE.SEATS : ['east', 'south', 'west', 'north'];
  var COMPASS = { east: '东', south: '南', west: '西', north: '北' };
  var C = {
    bg: THEME.background, panel: THEME.surface, paper: THEME.paper, ink: THEME.ink,
    gold: THEME.accent, muted: THEME.muted, digital: THEME.digital,
    deep: '#0b2f2f', dark: '#071e22', line: '#41695f', red: '#d38575'
  };
  var TXT = function (key, fallback) { return UI[key] || fallback; };

  var app = {
    screen: 'menu', deckIndex: 0, table: null, viewer: 'east', selection: [], chosen: [],
    memeQuery: '', memeScroll: 0, voteQueue: [], decision: null, carousel: 0, timer: null,
    message: '', toast: '', resultMode: '', selectedRating: 0,
    online: null, onlineId: '', onlineRoomId: '',
    onlinePoll: null, onlineControlSeat: '', onlineRoundId: '', onlineCopyStatus: '',
    diceIntro: null, sentencesOpen: false, sentenceScroll: 0,
    memeScope: 'all', memeForm: null, memeTitle: '', memeKeywords: '', memeBusy: false, memeNotice: ''
  };

  var scale = 1, offsetX = 0, offsetY = 0, pixelRatio = 1, hits = [];
  var activeAnimation = '', pausedAnimation = '', animationStarted = 0, animationTimer = null;
  var touchPreviewHit = null, touchCopyHit = null, touchStartX = 0, touchStartY = 0, panelDragY = null;
  var diceRollTimer = null, diceSettleTimer = null, diceHandoffTimer = null, diceIntroToken = 0;
  var clipboardSerial = 0, lastWxClipboardAt = 0;
  var draftTicker = null;

  var imageBudget = 24 * 1024 * 1024, imageBytes = 0, imageSerial = 0, paintGeneration = 0;
  var images = {}, packages = {}, appHidden = false, drawing = false, dirty = false, scheduledFrame = null;
  var frameView, windowInfo = null, lastAnimationFrame = -1;
  var requestFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame :
    (!inWeChat && typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame.bind(window) : null);
  var cancelFrame = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame :
    (!inWeChat && typeof window.cancelAnimationFrame === 'function' ? window.cancelAnimationFrame.bind(window) : null);
  var perf = {drawRequests: 0, frames: 0, imageLoads: 0, evictions: 0, rankComputations: 0};
  // Read-only diagnostics, for a real-device memory/CPU trace without player data.
  globalRoot.WordTilesPerformance = {snapshot: function () {
    return {drawRequests: perf.drawRequests, frames: perf.frames, imageLoads: perf.imageLoads,
      evictions: perf.evictions, rankComputations: perf.rankComputations,
      decodedImageBytes: imageBytes, imageCount: Object.keys(images).length, hidden: appHidden};
  }};
  function releaseImage(path) {
    var entry = images[path];
    if (!entry) return;
    imageBytes -= entry.bytes || 0;
    if (entry.img) {
      entry.img.onload = null; entry.img.onerror = null;
      if (inWeChat) { try { entry.img.src = ''; } catch (e) {} }
    }
    delete images[path]; perf.evictions++;
  }
  function trimImages(all) {
    var paths = Object.keys(images).sort(function (a, b) { return images[a].used - images[b].used; });
    for (var i = 0; i < paths.length; i++) {
      var entry = images[paths[i]];
      if (all || ((imageBytes > imageBudget || paths.length - i > 40) && entry.generation !== paintGeneration)) releaseImage(paths[i]);
    }
  }
  function packageReady(name) {
    if (!name || !inWeChat) return true;
    var state = packages[name];
    if (state && state.ready) return true;
    if (state && (state.loading || Date.now() < state.retryAt)) return false;
    state = packages[name] = {ready: false, loading: true, retryAt: 0};
    function failed() { state.loading = false; state.retryAt = Date.now() + 8000; draw(); }
    if (!wx.loadSubpackage) { failed(); return false; }
    try { wx.loadSubpackage({name: name, success: function () {
      state.ready = true; state.loading = false; draw();
    }, fail: failed}); } catch (e) { failed(); }
    return state.ready;
  }
  function previewAnimation(path) {
    if (appHidden || !ANIMATIONS[path]) path = '';
    if (activeAnimation === path) return;
    var previous = ANIMATIONS[activeAnimation];
    if (previous) releaseImage(previous.path);
    if (CUSTOM && previous && previous.custom) CUSTOM.release(false);
    activeAnimation = path; animationStarted = Date.now(); lastAnimationFrame = -1;
    if (animationTimer !== null && typeof clearInterval === 'function') clearInterval(animationTimer);
    animationTimer = null;
    if (path && typeof setInterval === 'function') animationTimer = setInterval(function () {
      // Keep the selected image playing after release. Skip paints while it is off screen.
      if (!hits.some(function (hit) { return hit.previewPath === activeAnimation; })) return;
      var meta = ANIMATIONS[activeAnimation], entry = meta && images[meta.path];
      if (meta && meta.custom) {
        var customSlot = CUSTOM.image(activeAnimation.slice(9), true);
        if (!customSlot.value) return;
        var customFrame = Math.floor((Date.now() - animationStarted) / Math.max(20, customSlot.value.frame_ms)) % customSlot.value.frames;
        if (customFrame !== lastAnimationFrame) { lastAnimationFrame = customFrame; draw(); }
        return;
      }
      if (!entry || !entry.ready) return;
      var frame = Math.floor((Date.now() - animationStarted) / Math.max(20, meta.frame_ms)) % meta.frames;
      if (frame !== lastAnimationFrame) { lastAnimationFrame = frame; draw(); }
    }, Math.min(50, Math.max(20, ANIMATIONS[path].frame_ms / 2)));
    draw();
  }
  function imageFor(path) {
    if (!path || !packageReady(ANIMATION_PACKAGES[path])) return null;
    if (!Object.prototype.hasOwnProperty.call(images, path)) {
      var entry = {img: null, ready: false, failed: false, bytes: 0, used: ++imageSerial, generation: paintGeneration};
      images[path] = entry;
      var img = inWeChat && wx.createImage ? wx.createImage() : typeof Image !== 'undefined' ? new Image() : null;
      if (img) {
        entry.img = img; perf.imageLoads++;
        img.onload = function () {
          if (images[path] !== entry) return;
          entry.ready = true; entry.bytes = img.width * img.height * 4; imageBytes += entry.bytes;
          if (ANIMATIONS[activeAnimation] && ANIMATIONS[activeAnimation].path === path) {
            animationStarted = Date.now(); lastAnimationFrame = 0;
          }
          trimImages(false); draw();
        };
        img.onerror = function () { if (images[path] !== entry) return; entry.failed = true; draw(); };
        img.src = path;
      } else entry.failed = true;
    }
    var result = images[path];
    result.used = ++imageSerial; result.generation = paintGeneration;
    return result.ready && !result.failed ? result.img : null;
  }
  function localView() {
    if (!drawing) return app.table ? app.table.view() : null;
    if (frameView === undefined) frameView = app.table ? app.table.view() : null;
    return frameView;
  }
  function draw() {
    perf.drawRequests++; dirty = true;
    if (appHidden || drawing || scheduledFrame !== null) return;
    if (requestFrame) scheduledFrame = requestFrame(paint);
    else paint();
  }
  function paint() {
    scheduledFrame = null;
    if (appHidden) return;
    drawing = true; dirty = false; paintGeneration++; perf.frames++; frameView = undefined;
    try { renderScreen(); } finally { drawing = false; trimImages(false); }
    if (dirty) draw();
  }
  function hideGame() {
    appHidden = true;
    if (scheduledFrame !== null && cancelFrame) cancelFrame(scheduledFrame);
    scheduledFrame = null;
    pausedAnimation = activeAnimation; previewAnimation(''); stopCarousel();
    if (app.screen === 'dice' && app.diceIntro) {
      settleDiceIntro();
      if (diceHandoffTimer !== null && typeof clearTimeout === 'function') clearTimeout(diceHandoffTimer);
      diceHandoffTimer = null;
    }
    touchPreviewHit = null; touchCopyHit = null; panelDragY = null;
    if (app.onlinePoll) { clearInterval(app.onlinePoll); app.onlinePoll = null; }
    trimImages(true);
    if (CUSTOM) CUSTOM.release();
  }
  function showGame() {
    appHidden = false; windowInfo = null;
    if (pausedAnimation && app.screen !== 'menu') previewAnimation(pausedAnimation);
    pausedAnimation = '';
    if (app.online && app.online.authenticated) { app.online.resume(); startOnlinePoll(); }
    if (app.screen === 'decision' || app.screen === 'rating' || app.screen === 'online-vote' || app.screen === 'online-rating') startCarousel();
    draw();
  }

  function rr(x, y, w, h, r, fill, stroke, width) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width || 1; ctx.stroke(); }
  }
  function label(str, x, y, size, color, align, weight, maxWidth) {
    ctx.fillStyle = color || C.paper;
    ctx.font = (weight || '500') + ' ' + size + 'px ' + '"' + FAMILIES + '"';
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    if (maxWidth) ctx.fillText(String(str), x, y, maxWidth); else ctx.fillText(String(str), x, y);
  }
  function tileFace(str, x, y, size, color, weight, align) {
    ctx.fillStyle = color || C.ink;
    ctx.font = (weight || '700') + ' ' + size + 'px ' + TILE_FONT;
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(str), x, y);
  }
  function digital(str, x, y, size, align) {
    ctx.save();
    ctx.shadowColor = C.digital; ctx.shadowBlur = 12;
    ctx.fillStyle = C.digital;
    ctx.font = '700 ' + size + 'px "Consolas","Courier New",monospace';
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(String(str), x, y);
    ctx.restore();
  }
  function line(x1, y1, x2, y2, color, width) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = width || 1; ctx.stroke();
  }
  function button(text, x, y, w, h, fn, kind, disabled) {
    var primary = kind === 'primary';
    var fill = disabled ? C.deep : primary ? C.gold : C.panel;
    var border = disabled ? C.line : primary ? C.gold : C.line;
    rr(x, y, w, h, 14, fill, border, 1.5);
    label(text, x + w / 2, y + h / 2 + 1, 17, primary && !disabled ? C.dark : C.paper, 'center', '600', w - 12);
    if (!disabled && fn) hits.push({ x: x, y: y, w: w, h: h, fn: fn });
  }
  function pill(text, x, y, w, color) {
    rr(x, y, w, 28, 14, color || C.panel, C.line, 1);
    label(text, x + w / 2, y + 14, 13, C.paper, 'center', '500', w - 10);
  }
  function cover(path, x, y, w, h, radius) {
    if (CUSTOM && path && path.indexOf('custom://') === 0) { customCover(path, x, y, w, h, radius); return; }
    var animation = path === activeAnimation ? ANIMATIONS[path] : null;
    var animatedImage = animation ? imageFor(animation.path) : null;
    var img = animatedImage || imageFor(path);
    ctx.save();
    rr(x, y, w, h, radius || 8, C.deep, null, 0);
    ctx.clip();
    if (img) {
      var sourceWidth = animatedImage ? animation.frame_width : img.width;
      var sourceHeight = animatedImage ? animation.frame_height : img.height;
      var ratio = Math.min(w / sourceWidth, h / sourceHeight);
      var dw = sourceWidth * ratio, dh = sourceHeight * ratio;
      if (animatedImage) {
        var frame = Math.floor((Date.now() - animationStarted) / Math.max(20, animation.frame_ms)) % animation.frames;
        ctx.drawImage(img, (frame % animation.columns) * animation.frame_width,
          Math.floor(frame / animation.columns) * animation.frame_height,
          animation.frame_width, animation.frame_height,
          x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      } else ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = C.deep; ctx.fillRect(x, y, w, h);
      label('图', x + w / 2, y + h / 2, 26, C.muted, 'center', '600');
    }
    ctx.restore();
    rr(x, y, w, h, radius || 8, null, C.line, 1);
    if (animation && !animatedImage) {
      var pack = animation.package && packages[animation.package];
      var unavailable = (pack && !pack.loading && !pack.ready) || (images[animation.path] && images[animation.path].failed);
      rr(x + 8, y + h - 32, w - 16, 24, 8, 'rgba(4,23,24,.88)', null);
      label(unavailable ? '动图暂不可用，稍后重试' : '动图加载中', x + w / 2, y + h - 20, 12, C.paper, 'center', '500', w - 24);
    }
  }
  function contain(path, x, y, w, h) {
    var img = imageFor(path);
    if (!img) return false;
    var ratio = Math.min(w / img.width, h / img.height);
    var dw = img.width * ratio, dh = img.height * ratio;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    return true;
  }

  function background() {
    var img = imageFor(UI_PATHS['ui.background']);
    if (img) {
      var ratio = Math.max(W / img.width, H / img.height);
      var dw = img.width * ratio, dh = img.height * ratio;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    }
  }
  function header(subtitle, rightFn) {
    tileFace(TXT('title', '字有意思'), 56, 56, 34, C.gold, '700', 'left');
    line(230, 40, 230, 74, C.line, 1);
    if (subtitle) label(subtitle, 248, 57, 13, C.muted, 'left', '600');
    if (rightFn) button(TXT('back', '返回菜单'), 1100, 36, 124, 42, rightFn);
  }
  function footer(text) {
    label(text || TXT('footer', '四人字牌 · 点击头像下方交接 · 字牌两张起出句'), 56, 690, 13, C.muted);
  }

  function handoffScreen() {
    rr(370, 210, 540, 300, 30, C.panel, '#bd9359', 2);
    rr(392, 232, 496, 256, 24, null, 'rgba(241,202,124,.24)', 1);
    label(TXT('handoff', '请把设备交给下一位玩家'), 640, 282, 22, C.paper, 'center', '600');
    tileFace(COMPASS[app.viewer] + ' · 玩家', 640, 352, 54, C.gold);
    label(TXT('handoff_hint', '上一位玩家的手牌已隐藏。接手后再点击下方按钮。'), 640, 410, 15, C.muted, 'center', '500', 460);
    button(TXT('confirm', '我已接手 · 查看手牌'), 450, 448, 380, 52, confirmHandoff, 'primary');
  }

  function dieFace(value, x, y) {
    rr(x, y, 96, 96, 20, C.paper, C.gold, 3);
    var dots = {
      1: [[48, 48]], 2: [[27, 27], [69, 69]],
      3: [[27, 27], [48, 48], [69, 69]],
      4: [[27, 27], [69, 27], [27, 69], [69, 69]],
      5: [[27, 27], [69, 27], [48, 48], [27, 69], [69, 69]],
      6: [[27, 25], [69, 25], [27, 48], [69, 48], [27, 71], [69, 71]]
    };
    var positions = dots[value] || dots[1];
    for (var i = 0; i < positions.length; i++) {
      ctx.beginPath(); ctx.arc(x + positions[i][0], y + positions[i][1], 6, 0, Math.PI * 2);
      ctx.fillStyle = C.deep; ctx.fill();
    }
  }
  function diceScreen() {
    var intro = app.diceIntro;
    if (!intro) return;
    rr(350, 142, 580, 440, 32, C.panel, '#bd9359', 2);
    rr(370, 162, 540, 400, 24, null, 'rgba(241,202,124,.24)', 1);
    label('掷骰定主家', 640, 204, 30, C.gold, 'center', '700');
    label('点数决定主家，主家先行动', 640, 242, 15, C.muted, 'center');
    dieFace(intro.face[0], 501, 281);
    dieFace(intro.face[1], 683, 281);
    label('+', 640, 330, 38, C.gold, 'center', '600');
    if (intro.rolling) label('骰子转动中…', 640, 420, 18, C.paper, 'center', '600');
    else {
      label('骰子 ' + intro.dice[0] + ' + ' + intro.dice[1] + ' = ' + (intro.dice[0] + intro.dice[1]), 640, 420, 18, C.paper, 'center', '600');
      label(COMPASS[intro.dealer] + '位主家', 640, 464, 29, C.digital, 'center', '700');
    }
    var compass = ['east', 'south', 'west', 'north'];
    for (var i = 0; i < compass.length; i++) {
      var x = 519 + i * 64, selected = !intro.rolling && intro.dealer === compass[i];
      rr(x, 502, 48, 36, 8, selected ? C.gold : C.deep, selected ? C.gold : C.line, 1);
      tileFace(COMPASS[compass[i]], x + 24, 520, 20, selected ? C.ink : C.paper);
    }
    button(intro.rolling ? TXT('skip', '跳过动画') : '开始交接', 540, 598, 200, 46,
      intro.rolling ? settleDiceIntro : finishDiceIntro, intro.rolling ? 'secondary' : 'primary');
  }

  function menuScreen() {
    rr(280, 96, 720, 528, 34, C.panel, '#bd9359', 2);
    rr(302, 118, 676, 484, 28, null, 'rgba(241,202,124,.24)', 1);
    var mark = UI_PATHS['ui.mark'];
    if (mark && contain(mark, 592, 140, 96, 96)) { /* drawn */ }
    else { rr(592, 140, 96, 96, 20, C.gold, '#bd9359', 2); tileFace('字', 640, 190, 58, C.ink); }
    label(TXT('title', '字有意思'), 640, 286, 58, C.gold, 'center', '700');
    label(TXT('subtitle', '把手里的字，变成一句好玩的表达。'), 640, 342, 22, C.paper, 'center');
    for (var i = 0; i < DECKS.length; i++) {
      (function (index) {
        var x = 640 - (DECKS.length * 220 - 20) / 2 + index * 220;
        var selected = app.deckIndex === index;
        button(DECKS[index].title, x, 420, 200, 50, function () { app.deckIndex = index; draw(); }, selected ? 'primary' : 'secondary');
      })(i);
    }
    button(inWeChat ? '同 Wi-Fi 联机 · 手机房主' : '联机开发版 · 四人房间', 440, 486, 400, 44, openOnline, 'secondary', !NETWORK);
    button(TXT('new_game', '开始四人试玩'), 440, 544, 400, 54, startGame, 'primary');
  }

  function onlineId() {
    var saved = '';
    try { saved = inWeChat && wx.getStorageSync ? wx.getStorageSync('word_tiles_dev_id') : window.localStorage.getItem('word_tiles_dev_id'); } catch (e) {}
    if (!saved && !inWeChat) {
      try { saved = new URLSearchParams(window.location.search).get('player') || ''; } catch (e) {}
    }
    return saved || 'player-' + Math.floor(Math.random() * 90000 + 10000);
  }
  function saveOnlineId() {
    try { if (inWeChat && wx.setStorageSync) wx.setStorageSync('word_tiles_dev_id', app.onlineId);
      else window.localStorage.setItem('word_tiles_dev_id', app.onlineId); } catch (e) {}
  }
  function openOnline() {
    app.onlineId = onlineId(); app.onlineRoomId = ''; app.onlineControlSeat = '';
    app.onlineRoundId = ''; app.onlineCopyStatus = '';
    app.online = new NETWORK.Client(function (client) {
      if (app.online !== client) return;
      if ((app.memeNotice === '已加入房间表情库，等待其他玩家接收' || app.memeNotice === '已保存并加入房间表情库，其他玩家正在接收') &&
          client.room && Array.isArray(client.room.custom_memes) && client.room.custom_memes.length && client.memeReady &&
          client.room.custom_memes.every(function (m) { return client.memeReady(m.key); })) app.memeNotice = '房间表情已同步，所有玩家均可选用';
      var seats = client.view && client.view.controlled_players;
      if (Array.isArray(seats) && seats.length && seats.indexOf(app.onlineControlSeat) < 0) app.onlineControlSeat = seats[0];
      var round = client.view && client.view.round;
      if (round && round.round_id && round.round_id !== app.onlineRoundId) {
        app.onlineRoundId = round.round_id;
        closeMemeForm(); app.memeBusy = false; app.memeNotice = '';
        app.selection = []; app.chosen = []; app.memeQuery = ''; app.memeScroll = 0;
        if (round.phase === 'COMPLETED' || round.phase === 'ABORTED') { app.screen = 'online-result'; draw(); return; }
        startDiceIntro(client.view, true);
        return;
      }
      if (round && (round.phase === 'COMPLETED' || round.phase === 'ABORTED') && app.screen !== 'online-result') {
        stopCarousel(); app.screen = 'online-result';
      }
      draw();
    });
    app.screen = 'online-lobby'; draw();
  }
  function closeOnline() {
    stopDiceIntro();
    previewAnimation(''); pausedAnimation = '';
    if (app.onlinePoll) { clearInterval(app.onlinePoll); app.onlinePoll = null; }
    if (app.online) app.online.close();
    closeMemeForm();
    app.memeBusy = false; app.memeNotice = ''; app.memeScope = 'all';
    if (CUSTOM) CUSTOM.clearRoom().catch(function () {});
    app.online = null; app.screen = 'menu'; app.selection = []; app.chosen = [];
    app.onlineRoundId = ''; app.onlineCopyStatus = '';
    app.sentencesOpen = false; app.sentenceScroll = 0; draw();
  }
  var activeOnlineInput = '';
  function editOnline(field, title) {
    if (inWeChat && wx.showKeyboard) {
      activeOnlineInput = field;
      wx.showKeyboard({defaultValue: app[field], maxLength: field === 'memeKeywords' ? 80 : field === 'memeTitle' ? 24 : 40, multiple: false, confirmType: field === 'memeQuery' ? 'search' : 'done'});
      if (!editOnline.hooked) {
        editOnline.hooked = true;
        if (wx.onKeyboardInput) wx.onKeyboardInput(function (event) { if (activeOnlineInput) { app[activeOnlineInput] = event.value || ''; if (activeOnlineInput === 'memeQuery') app.memeScroll = 0; draw(); } });
        if (wx.onKeyboardConfirm) wx.onKeyboardConfirm(function (event) {
          if (activeOnlineInput) app[activeOnlineInput] = event.value || '';
          if (activeOnlineInput === 'memeQuery') app.memeScroll = 0;
          activeOnlineInput = ''; if (wx.hideKeyboard) wx.hideKeyboard(); draw();
        });
        if (wx.onKeyboardComplete) wx.onKeyboardComplete(function () { activeOnlineInput = ''; });
      }
    } else if (typeof window !== 'undefined' && window.prompt) {
      var value = window.prompt(title, app[field]);
      if (value !== null) { app[field] = value.trim(); draw(); }
    }
  }
  function onlineAction(kind) {
    var client = app.online;
    var id = app.onlineId.trim(), room = app.onlineRoomId.trim();
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(id)) { client.fail('玩家代号需 2–40 位英文、数字、- 或 _'); return; }
    if (kind === 'join' && !room) { client.fail('先填房间号'); return; }
    saveOnlineId(); client.status = '登录中'; client.error = ''; app.onlineCopyStatus = ''; draw();
    client.login(id).then(function () { if (app.online !== client) return; return kind === 'create' ? client.create(DECKS[app.deckIndex].id) : client.join(room); })
      .then(function () { if (app.online !== client) return; app.onlineRoomId = client.room && (client.room.room_code || client.room.room_id) || client.roomId; client.connect(); startOnlinePoll(); draw(); })
      .catch(function (error) { if (app.online === client) client.fail(error); });
  }
  function startOnlinePoll() {
    if (app.onlinePoll) clearInterval(app.onlinePoll);
    app.onlinePoll = setInterval(function () {
      if (appHidden || !app.online || !app.online.roomId || app.screen !== 'online-lobby') return;
      app.online.refreshRoom().catch(function () { /* Socket state stays usable during a transient HTTP failure. */ });
    }, 2500);
  }
  function onlineReady() {
    var client = app.online, ready = client.room && client.room.ready;
    var mine = !!(ready && (Array.isArray(ready) ? ready.indexOf(client.playerId) >= 0 : ready[client.playerId]));
    client.ready(!mine).catch(function (error) { client.fail(error); });
  }
  function copyRoomId() {
    var client = app.online, room = client && client.room;
    var id = String(room && (room.room_code || room.room_id) || client && client.roomId || '').trim();
    if (!id) { if (client) client.fail('房间号尚未生成'); return; }
    var serial = ++clipboardSerial;
    function current() {
      var currentRoom = client && client.room;
      return app.online === client && serial === clipboardSerial &&
        String(currentRoom && (currentRoom.room_code || currentRoom.room_id) || client.roomId || '').trim() === id;
    }
    function report(ok, reason) {
      if (!current()) return;
      app.onlineCopyStatus = ok ? '房间号 ' + id + ' 已复制' :
        '复制失败（' + (reason || '剪贴板不可用') + '），房间号 ' + id;
      draw();
    }
    if (inWeChat && wx.setClipboardData) {
      function setWxClipboard(attempt) {
        if (!current()) return;
        var delay = Math.max(0, 1100 - (Date.now() - lastWxClipboardAt));
        if (delay && typeof setTimeout === 'function') { setTimeout(function () { setWxClipboard(attempt); }, delay); return; }
        lastWxClipboardAt = Date.now();
        try { wx.setClipboardData({data: id, success: function () { report(true); }, fail: function (error) {
          if (!current()) return;
          if (attempt === 0 && typeof setTimeout === 'function') setTimeout(function () { setWxClipboard(1); }, 1100);
          else report(false, error && error.errMsg);
        }}); } catch (error) { report(false, error && error.message); }
      }
      app.onlineCopyStatus = '正在复制房间号 ' + id; draw();
      setWxClipboard(0);
    } else if (copyRoomIdFallback(id)) report(true);
    else if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(id).then(function () { report(true); }).catch(function (error) { report(false, error && error.message); });
    else report(false, '当前浏览器不支持复制');
  }
  function copyRoomIdFallback(id) {
    if (typeof document === 'undefined' || !document.createElement || !document.execCommand) return false;
    var input = document.createElement('textarea');
    input.value = id; input.style.position = 'fixed'; input.style.opacity = '0';
    document.body.appendChild(input); input.select();
    var copied = false;
    try { copied = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(input);
    return copied;
  }
  function manualRoomCode() {
    var room = app.online && app.online.room;
    var id = String(room && (room.room_code || room.room_id) || '').trim();
    if (!id) return;
    if (inWeChat && wx.showKeyboard) {
      activeOnlineInput = '';
      wx.showKeyboard({defaultValue: id, maxLength: 40, multiple: false, confirmHold: false, confirmType: 'done'});
      app.onlineCopyStatus = '长按输入框内的房间号手动复制'; draw();
    } else if (typeof window !== 'undefined' && window.prompt) window.prompt('选中房间号后复制', id);
  }
  function onlineLobbyScreen() {
    var client = app.online, room = client.room;
    rr(250, 104, 780, 532, 30, C.panel, C.gold, 2);
    label(inWeChat ? '同 Wi-Fi 2–4 人房间' : '2–4 人联网开发版', 640, 148, 32, C.gold, 'center', '700');
    label(inWeChat ? '房主手机保持前台，四台手机连接同一 Wi-Fi' : '本地服务端 127.0.0.1:8787 · 每台设备只看自己的手牌', 640, 188, 14, C.muted, 'center');
    label('玩家代号', 330, 242, 16, C.paper);
    button(app.onlineId || '点击设置', 460, 218, 430, 46, function () { editOnline('onlineId', '输入玩家代号'); });
    if (!room) {
      button('创建 ' + (DECKS[app.deckIndex] ? DECKS[app.deckIndex].title : '') + ' 房间', 335, 290, 610, 50, function () { onlineAction('create'); }, 'primary');
      label(inWeChat ? '输入房主发来的 6 位房间号' : '或输入房间号加入', 330, 374, 16, C.paper);
      button(app.onlineRoomId || '点击填写房间号', 500, 350, 445, 46, function () { editOnline('onlineRoomId', '输入房间号'); });
      button('加入房间', 480, 426, 320, 52, function () { onlineAction('join'); }, 'primary');
    } else {
      label('房间号  ' + (room.room_code || room.room_id), 330, 294, 30, C.digital, 'left', '700', 620);
      label('复制 6 位房间号给另外三位玩家', 330, 327, 14, C.muted);
      button('复制', 852, 276, 90, 40, copyRoomId);
      if (app.onlineCopyStatus.indexOf('复制失败') === 0) button('手动取码', 846, 318, 102, 32, manualRoomCode);
      var players = Array.isArray(room.players) ? room.players : [];
      var ready = room.ready || {};
      for (var i = 0; i < 4; i++) {
        var player = players[i], x = 330 + i * 156;
        rr(x, 352, 144, 86, 10, C.deep, C.line, 1);
        label(player || '等待加入', x + 72, 380, 14, C.paper, 'center', '600', 130);
        label(player && (Array.isArray(ready) ? ready.indexOf(player) >= 0 : ready[player]) ? '已准备' : '未准备', x + 72, 414, 13, player && (Array.isArray(ready) ? ready.indexOf(player) >= 0 : ready[player]) ? C.digital : C.muted, 'center');
      }
      button('切换准备', 330, 466, 200, 50, onlineReady, 'primary');
      var allReady = players.length >= 2 && players.length <= 4 && players.every(function (player) { return Array.isArray(ready) ? ready.indexOf(player) >= 0 : ready[player] === true; });
      if (client.playerId === room.host_player_id) button('开始对局', 550, 466, 200, 50, function () {
        client.command('REQUEST_START_ROUND', {preset_id: room.preset_id || DECKS[app.deckIndex].id, allow_extra_round: false});
      }, 'primary', !client.view || !client.authenticated || !allReady);
      button('刷新房间', 770, 466, 175, 50, function () { client.refreshRoom().catch(function (error) { client.fail(error); }); });
    }
    label(app.onlineCopyStatus || client.status, 330, 552, 14, app.onlineCopyStatus.indexOf('复制失败') === 0 ? C.red : C.digital, 'left', '500', 620);
    if (client.error) label(client.error, 330, 582, 14, C.red, 'left', '600', 620);
  }
  function onlineCommand(type, payload) {
    if (app.online && app.online.setControlSeat) app.online.setControlSeat(app.onlineControlSeat);
    if (app.online.command(type, payload)) {
      app.selection = []; app.chosen = [];
      if (type !== 'REQUEST_START_ROUND' && app.screen !== 'dice') {
        var round = app.online.view && app.online.view.round;
        app.screen = round && (round.phase === 'COMPLETED' || round.phase === 'ABORTED') ? 'online-result' : 'online-table';
      }
      draw();
    }
  }
  function onlineTile(tile, x, y, selected, index) {
    var raised = selected ? y - 14 : y;
    rr(x, raised + 5, 56, 76, 9, '#b49d70', '#183b35', 1);
    rr(x, raised, 56, 76, 9, selected ? '#f3d899' : C.paper, selected ? C.gold : '#c9a25f', selected ? 2.5 : 1.5);
    rr(x + 4, raised + 4, 48, 68, 6, null, 'rgba(56,77,65,.16)', 1);
    tileFace(tile.glyph, x + 28, raised + 36, 32, C.ink);
    if (selected) {
      rr(x + 40, raised - 10, 20, 20, 10, C.gold, null, 0);
      label(String(index + 1), x + 50, raised, 12, C.ink, 'center', '700');
    }
    hits.push({x: x, y: raised, w: 56, h: 76, fn: function () {
      var i = app.selection.indexOf(tile.id);
      if (i >= 0) app.selection.splice(i, 1); else app.selection.push(tile.id);
      draw();
    }});
  }
  function switchOnlineControlSeat() {
    var view = app.online && app.online.view, seats = view && view.controlled_players;
    if (!Array.isArray(seats) || seats.length < 2) return;
    var index = seats.indexOf(app.onlineControlSeat);
    app.onlineControlSeat = seats[(index + 1 + seats.length) % seats.length];
    if (app.online.setControlSeat) app.online.setControlSeat(app.onlineControlSeat);
    app.selection = []; draw();
  }
  function onlineVirtual(view) {
    var players = view && Array.isArray(view.players) ? view.players : [];
    return players.length === 4 && players.every(function (item) { return SEATS.indexOf(item) >= 0; });
  }
  function onlineSeatOf(view, playerId) {
    if (!playerId) return '';
    if (COMPASS[playerId]) return playerId;
    var index = view && Array.isArray(view.players) ? view.players.indexOf(playerId) : -1;
    return index >= 0 && SEATS[index] ? SEATS[index] : '';
  }
  function onlineCompass(view, playerId) {
    var seat = onlineSeatOf(view, playerId);
    return seat ? COMPASS[seat] : String(playerId || '');
  }
  function onlinePlayerForSeat(view, seat) {
    var players = view && Array.isArray(view.players) ? view.players : [];
    if (players.indexOf(seat) >= 0) return seat;
    var index = SEATS.indexOf(seat);
    return index >= 0 && players[index] ? players[index] : '';
  }
  function onlineSeatLabel(view, seat, player) {
    if (!player) return COMPASS[seat] + ' · 等待玩家';
    if (onlineVirtual(view)) return COMPASS[seat] + ((view.controlled_players || []).indexOf(player) >= 0 ? ' · 我的操控位' : '');
    var text = COMPASS[seat];
    if (player === view.host_player_id) text += ' · 主机';
    if (player === view.viewer_id) text += ' · 我';
    return text;
  }
  function onlineSeatCard(seat, view) {
    var player = onlinePlayerForSeat(view, seat);
    drawPlayerCard(seat, view, player, onlineSeatLabel(view, seat, player));
  }

  function onlineStateMessage(view) {
    var round = view.round, controlled = view.controlled_players || [view.viewer_id];
    var activeMine = controlled.indexOf(round.active_player_id) >= 0;
    if (round.phase === 'AWAIT_DRAW') return activeMine ? '请先摸牌，再出句' : '等待 ' + onlineCompass(view, round.active_player_id) + ' 摸牌';
    if (round.phase === 'AWAIT_ACTION') return activeMine ? '依次点击手牌，组成你想说的话' : '等待 ' + onlineCompass(view, round.active_player_id) + ' 出句';
    if (round.phase === 'AWAIT_VOTES') return TXT('vote_progress', '已收到投票') + ' ' + round.pending_sentence.votes_received + ' / ' + Math.max(1, view.players.length - 1);
    if (round.phase === 'MUST_DISCARD') return activeMine ? TXT('phase_discard', '本手未通过，请弃一张牌') : '等待 ' + onlineCompass(view, round.active_player_id) + ' 弃牌';
    if (round.phase === 'COMPLETED') return TXT('phase_completed', '本局清算完成');
    if (round.phase === 'ABORTED') return '本局已中止';
    return '';
  }
  function onlineTableScreen() {
    var client = app.online, view = client.view;
    if (!view || !view.round) { onlineLobbyScreen(); return; }
    var round = view.round, controlled = view.controlled_players || [view.viewer_id], mine = controlled.indexOf(round.active_player_id) >= 0;
    if (mine) app.onlineControlSeat = round.active_player_id;
    else if (controlled.indexOf(app.onlineControlSeat) < 0) app.onlineControlSeat = controlled[0];
    if (client.setControlSeat) client.setControlSeat(app.onlineControlSeat);
    label(TXT('active', '当前行动：') + onlineCompass(view, round.active_player_id), 248, 57, 15, C.paper, 'left', '600');
    var compass = ['east', 'south', 'west', 'north'], activeSeat = onlineSeatOf(view, round.active_player_id);
    for (var h = 0; h < compass.length; h++) {
      var hx = 397 + h * 49, highlighted = activeSeat === compass[h];
      rr(hx, 39, 40, 36, 7, highlighted ? C.gold : C.deep, highlighted ? C.gold : C.line, 1);
      tileFace(COMPASS[compass[h]], hx + 20, 57, 19, highlighted ? C.ink : C.paper);
    }
    wallBacks(view);
    onlineSeatCard('south', view); onlineSeatCard('west', view); onlineSeatCard('east', view); onlineSeatCard('north', view);

    digital(String(round.wall_remaining), 640, 321, 52, 'center');
    label(TXT('wall', '牌墙剩余'), 640, 367, 16, C.paper, 'center', '600');
    sentencePill(view);

    var buttons = [];
    if (round.phase === 'AWAIT_DRAW' && mine) buttons.push({text: TXT('draw', '摸牌'), fn: function () { onlineCommand('DRAW_TILE', {}); }, primary: true});
    if (round.phase === 'AWAIT_ACTION' && mine) {
      buttons.push({text: TXT('meme_compose', '表情造句'), fn: function () { if (app.selection.length < 2) { client.fail('至少选择两张牌'); return; } app.chosen = []; app.memeQuery = ''; app.memeScroll = 0; app.screen = 'online-compose'; draw(); }, primary: false});
      buttons.push({text: TXT('discard', '出牌'), fn: function () { if (app.selection.length < 2) { client.fail('至少选择两张牌'); return; } onlineCommand('PROPOSE_SENTENCE', {tile_ids: app.selection.slice(), resource_keys: []}); }, primary: true});
    }
    if (round.phase === 'MUST_DISCARD' && mine) buttons.push({text: TXT('discard', '弃牌'), fn: function () { if (app.selection.length !== 1) { client.fail('请选择一张牌'); return; } onlineCommand('DISCARD_TILE', {tile_id: app.selection[0]}); }, primary: true});
    if (round.phase === 'AWAIT_VOTES' && round.pending_sentence) {
      var pending = round.pending_sentence, voted = pending.has_voted_by_player || {}, canVote = controlled.some(function (seat) { return seat !== pending.owner_id && !(pending.has_voted_by_player ? voted[seat] : seat === view.viewer_id && pending.has_voted); });
      if (canVote) buttons.push({text: '给句子投票', fn: function () { app.decision = {approve: null}; app.selectedRating = 0; app.carousel = 0; app.screen = 'online-vote'; startCarousel(); draw(); }, primary: true});
    }
    if (round.phase === 'COMPLETED' || round.phase === 'ABORTED') {
      buttons.push({text: '查看结算', fn: function () { app.screen = 'online-result'; draw(); }, primary: true});
    }
    if (controlled.length > 1) buttons.push({text: '切换操控位', fn: switchOnlineControlSeat, primary: false});
    buttons.push({text: TXT('clear', '清空选择'), fn: function () { app.selection = []; draw(); }, primary: false});
    var buttonWidth = Math.min(94, (300 - (buttons.length - 1) * 10) / buttons.length);
    for (var b = 0; b < buttons.length; b++) button(buttons[b].text, 928 + b * (buttonWidth + 10), 462, buttonWidth, 48, buttons[b].fn, buttons[b].primary ? 'primary' : 'secondary', false);
    var hand = round.hand_by_player && round.hand_by_player[app.onlineControlSeat] || round.hand || [], count = hand.length;
    var gap = count > 1 ? Math.min(66, (930 - 56) / (count - 1)) : 66;
    var rowWidth = count > 0 ? (count - 1) * gap + 56 : 0;
    var trayWidth = Math.max(180, rowWidth + 32);
    var trayX = 736 - trayWidth / 2, handStart = trayX + (trayWidth - rowWidth) / 2;
    rr(trayX, 568, trayWidth, 110, 18, '#102f33', '#537766', 1.5);
    for (var t = 0; t < count; t++) {
      var handIndex = app.selection.indexOf(hand[t].id);
      onlineTile(hand[t], handStart + t * gap, 588, handIndex >= 0, handIndex >= 0 ? handIndex : 0);
    }
    label(client.error || onlineStateMessage(view), 640, 452, 16, client.error ? C.red : C.paper, 'center', '600', 390);
  }
  function onlineComposeScreen() {
    if (!app.online || !app.online.view || !app.online.view.round) { app.screen = 'online-table'; onlineTableScreen(); return; }
    composeScreen();
  }
  function onlineVoteScreen() {
    var view = app.online.view, pending = view && view.round && view.round.pending_sentence;
    if (!pending) { stopCarousel(); app.screen = 'online-table'; onlineTableScreen(); return; }
    var controlled = view.controlled_players || [view.viewer_id], voted = pending.has_voted_by_player || {};
    var alreadyVoted = function (seat) { return pending.has_voted_by_player ? !!voted[seat] : seat === view.viewer_id && pending.has_voted; };
    if (controlled.indexOf(app.onlineControlSeat) < 0 || app.onlineControlSeat === pending.owner_id || alreadyVoted(app.onlineControlSeat)) {
      app.onlineControlSeat = controlled.find(function (seat) { return seat !== pending.owner_id && !alreadyVoted(seat); }) || controlled[0];
    }
    if (app.online.setControlSeat) app.online.setControlSeat(app.onlineControlSeat);
    decisionScreen();
    if (controlled.length > 1) {
      label('当前投票：' + onlineCompass(view, app.onlineControlSeat), 640, 558, 14, C.muted, 'center');
      button('切换位置', 850, 536, 140, 40, switchOnlineControlSeat);
    }
  }
  function onlineResultScreen() {
    var client = app.online, view = client.view;
    if (!view || !view.round) { onlineLobbyScreen(); return; }
    resultScreen();
  }

  // Rotate the table around the player whose hand is visible.
  function seatSlot(seat, view) {
    var viewer = app.screen.indexOf('online') === 0 ? onlineSeatOf(view, app.onlineControlSeat || view.viewer_id) : view.viewer_id;
    var order = ['east', 'south', 'west', 'north'];
    return (order.indexOf(seat) - Math.max(0, order.indexOf(viewer)) + 4) % 4;
  }
  function seatPosition(seat, view) {
    var slot = seatSlot(seat, view);
    if (slot === 0) return {x: 48, y: 574, w: 176, h: 94};
    if (slot === 1) return {x: 928, y: 224, w: 132, h: 210};
    if (slot === 2) return {x: 928, y: 100, w: 308, h: 70};
    return {x: 180, y: 224, w: 132, h: 210};
  }
  function drawPlayerCard(seat, view, player, name) {
    var pos = seatPosition(seat, view), round = view.round;
    var active = player && round.active_player_id === player;
    rr(pos.x, pos.y + 4, pos.w, pos.h, 18, '#061c20', null);
    rr(pos.x, pos.y, pos.w, pos.h, 18, active ? '#244e46' : '#102f33', active ? C.gold : '#41625d', active ? 2 : 1);
    var vertical = pos.h > 150;
    var cx = vertical ? pos.x + pos.w / 2 : pos.x + 34, cy = pos.y + 33, r = 22;
    var img = imageFor(UI_PATHS['ui.avatar_' + seat]);
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    if (img) {
      var ratio = Math.max(44 / img.width, 44 / img.height);
      ctx.drawImage(img, cx - img.width * ratio / 2, cy - img.height * ratio / 2, img.width * ratio, img.height * ratio);
    }
    ctx.restore();
    if (!img) tileFace(COMPASS[seat], cx, cy, 24, C.gold);
    var count = player ? (round.hand_counts[player] || 0) : 0;
    if (vertical) {
      label(name, cx, pos.y + 79, 16, C.paper, 'center', '600', pos.w - 20);
      label(count + ' 张', cx, pos.y + 108, 15, C.muted, 'center');
      label(player ? fmt(roundScoreThirds(round, player)) + ' 分' : '等待入座', cx, pos.y + 139, 18, C.gold, 'center');
      line(pos.x + 16, pos.y + 163, pos.x + pos.w - 16, pos.y + 163, C.line, 1);
      label(active ? '● 正在行动' : '等待出牌', cx, pos.y + 186, 13, active ? C.gold : C.muted, 'center');
    } else {
      label(name, pos.x + 66, pos.y + 23, 16, C.paper, 'left', '600', pos.w - 78);
      label(player ? count + ' 张 · ' + fmt(roundScoreThirds(round, player)) + ' 分' : '等待入座', pos.x + 66, pos.y + 47, 14, C.muted, 'left', '500', pos.w - 76);
      if (pos.h > 70) label(active ? '● 正在行动' : '我的手牌', pos.x + pos.w / 2, pos.y + 79, 13, active ? C.gold : C.muted, 'center');
    }
  }

  function roundScoreThirds(round, player) {
    var settled = round.result && round.result.scores && round.result.scores[player];
    if (settled) return settled.total.numerator;
    return ((round.sentence_points && round.sentence_points[player]) || 0) * 3 +
      ((round.rating_bonus_thirds && round.rating_bonus_thirds[player]) || 0);
  }
  function roundRanking(view) {
    if (!view.round.result || !view.round.result.scores) return [];
    var scores = view.round.result.scores;
    var entries = view.players.map(function (player, index) {
      return {player_id: player, seat_index: index, total: scores[player].total};
    });
    entries.sort(function (a, b) { return b.total.numerator - a.total.numerator || a.seat_index - b.seat_index; });
    for (var i = 0; i < entries.length; i++) entries[i].rank = i && entries[i].total.numerator === entries[i - 1].total.numerator ? entries[i - 1].rank : i + 1;
    return entries;
  }
  function seatCard(seat, view) {
    drawPlayerCard(seat, view, seat, COMPASS[seat] + (seat === view.viewer_id ? ' · 我' : ' · 玩家'));
  }

  function fmt(numeratorThirds) {
    var value = numeratorThirds / 3;
    var sign = value > 0 ? '+' : '';
    return sign + value.toFixed(2);
  }

  function tileBack(x, y, w, h) {
    // Dark mahjong body with a green inset back; keep its size at every seat.
    rr(x + 1, y + 5, w, h, 4, 'rgba(0,8,10,.38)', null);
    rr(x, y + 2, w, h, 4, '#101b1b', '#050b0c', 1);
    rr(x, y, w, h, 4, '#1d2926', '#030809', 1);
    rr(x + 2, y + 2, w - 4, h - 4, 2, '#196c4c', '#0a392c', 0.75);
    line(x + 4, y + 3, x + w - 4, y + 3, 'rgba(150,219,168,.25)', 1);
  }
  function wallBacks(view) {
    rr(410, 96, 460, 460, 32, '#081f22', null);
    rr(410, 90, 460, 460, 32, '#674c36', '#be9865', 2);
    rr(422, 102, 436, 436, 24, '#123f39', '#8c7550', 2);
    rr(434, 114, 412, 412, 18, '#205649', '#487761', 1);
    // Exactly one row per opponent. Wall tiles are represented by the central counter.
    // Every back has the same dimensions; side seats use the rotated dimensions.
    var shortEdge = 22, longEdge = 32, maxSpan = 348;
    for (var i = 0; i < SEATS.length; i++) {
      var seat = SEATS[i], slot = seatSlot(seat, view);
      if (!slot) continue;
      var player = app.screen.indexOf('online') === 0 ? onlinePlayerForSeat(view, seat) : seat;
      var handCount = player ? view.round.hand_counts[player] || 0 : 0;
      var pitch = handCount > 1 ? Math.min(26, (maxSpan - shortEdge) / (handCount - 1)) : 26;
      var span = handCount ? (handCount - 1) * pitch + shortEdge : 0;
      for (var t = 0; t < handCount; t++) {
        if (slot === 2) tileBack(640 - span / 2 + t * pitch, 130, shortEdge, longEdge);
        else tileBack(slot === 3 ? 450 : 798, 344 - span / 2 + t * pitch, longEdge, shortEdge);
      }
    }
    rr(558, 250, 164, 142, 22, '#173f39', '#57806a', 1);
    label('字 有 意 思', 640, 270, 13, '#9bb39a', 'center', '600');
  }

  function peopleIcon(x, y, scale, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x - 7 * scale, y - 3 * scale, 3 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 7 * scale, y - 3 * scale, 3 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y - 6 * scale, 4 * scale, 0, Math.PI * 2); ctx.fill();
    rr(x - 11 * scale, y + scale, 8 * scale, 7 * scale, 3 * scale, color, null, 0);
    rr(x + 3 * scale, y + scale, 8 * scale, 7 * scale, 3 * scale, color, null, 0);
    rr(x - 5 * scale, y - scale, 10 * scale, 9 * scale, 4 * scale, color, null, 0);
  }
  function chevron(x, y, color, size) {
    var s = size || 6;
    ctx.beginPath(); ctx.moveTo(x - s / 2, y - s); ctx.lineTo(x + s / 2, y); ctx.lineTo(x - s / 2, y + s);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }
  function sentencePill(view) {
    var x = 56, y = 462, w = 280, h = 48;
    rr(x, y, w, h, h / 2, C.deep, C.line, 1.5);
    peopleIcon(x + 34, y + h / 2, 1.15, C.paper);
    label(TXT('accepted', '大家认可的句子'), x + 58, y + h / 2 + 1, 14, C.paper, 'left', '600', w - 106);
    chevron(x + w - 24, y + h / 2, C.paper);
    hits.push({x: x, y: y, w: w, h: h, fn: function () { app.sentencesOpen = true; app.sentenceScroll = 0; draw(); }});
  }
  function sentencesPanel(view) {
    ctx.fillStyle = 'rgba(3,16,20,.72)'; ctx.fillRect(0, 82, W, H - 82);
    var sentences = view && view.round && Array.isArray(view.round.sentences) ? view.round.sentences : [];
    var rows = sentences.slice().reverse();
    rr(300, 160, 680, 400, 28, C.panel, C.gold, 2);
    rr(318, 178, 644, 364, 22, null, 'rgba(241,202,124,.24)', 1);
    rr(500, 194, 280, 46, 14, C.deep, C.line, 1.5);
    label(TXT('accepted', '大家认可的句子'), 640, 218, 19, C.paper, 'center', '700');
    var top = 252, bottom = 508, rowH = 72, tileH = 52, maxRowW = 560, gap = 8;
    var viewH = bottom - top, contentH = Math.max(rows.length, 1) * rowH;
    var maxScroll = Math.max(0, contentH - viewH);
    if (app.sentenceScroll > maxScroll) app.sentenceScroll = maxScroll;
    if (app.sentenceScroll < 0) app.sentenceScroll = 0;
    rr(336, top, 608, viewH, 16, '#0a2e2e', '#2f5a50', 1);
    ctx.save();
    rr(336, top, 608, viewH, 16, null, null, 0);
    ctx.clip();
    if (!rows.length) label('还没有被认可的句子', 640, top + viewH / 2, 15, C.muted, 'center');
    for (var i = 0; i < rows.length; i++) {
      var glyphs = Array.from(String(rows[i].text || ''));
      if (!glyphs.length) continue;
      var tw = Math.min(42, (maxRowW - gap * (glyphs.length - 1)) / glyphs.length);
      var rowWidth = glyphs.length * tw + gap * (glyphs.length - 1);
      var rowX = 640 - rowWidth / 2, rowY = top + 10 + i * rowH - app.sentenceScroll;
      if (rowY + tileH < top || rowY > bottom) continue;
      for (var g = 0; g < glyphs.length; g++) {
        var tx = rowX + g * (tw + gap);
        rr(tx, rowY, tw, tileH, 8, C.paper, C.gold, 1.5);
        tileFace(glyphs[g], tx + tw / 2, rowY + tileH / 2 + 1, Math.min(26, tw * 0.68), C.ink);
      }
    }
    ctx.restore();
    if (contentH > viewH) {
      var trackH = viewH - 20, thumbH = Math.max(36, trackH * viewH / contentH);
      var thumbY = top + 10 + (trackH - thumbH) * (maxScroll ? app.sentenceScroll / maxScroll : 0);
      rr(952, thumbY, 6, thumbH, 3, C.line, null, 0);
    }
    hits.push({x: 0, y: 0, w: W, h: H, fn: function () { app.sentencesOpen = false; draw(); }});
    hits.push({x: 310, y: 172, w: 660, h: 380});
  }

  function handTile(tile, x, y, selected, index) {
    var raised = selected ? y - 14 : y;
    rr(x, raised + 5, 56, 76, 9, '#b49d70', '#183b35', 1);
    rr(x, raised, 56, 76, 9, selected ? '#f3d899' : C.paper, selected ? C.gold : '#c9a25f', selected ? 2.5 : 1.5);
    rr(x + 4, raised + 4, 48, 68, 6, null, 'rgba(56,77,65,.16)', 1);
    tileFace(tile.glyph, x + 28, raised + 36, 32, C.ink);
    if (selected) {
      rr(x + 40, raised - 10, 20, 20, 10, C.gold, null, 0);
      label(String(index + 1), x + 50, raised, 12, C.ink, 'center', '700');
    }
    hits.push({ x: x, y: raised, w: 56, h: 76, fn: function () { toggleTile(tile.id); } });
  }

  function tableScreen() {
    var view = app.table ? localView() : null;
    if (!view) { handoffScreen(); return; }
    var round = view.round;
    label(TXT('active', '当前行动：') + COMPASS[round.active_player_id], 248, 57, 15, C.paper, 'left', '600');
    var compass = ['east', 'south', 'west', 'north'];
    for (var h = 0; h < compass.length; h++) {
      var hx = 397 + h * 49, highlighted = round.active_player_id === compass[h];
      rr(hx, 39, 40, 36, 7, highlighted ? C.gold : C.deep, highlighted ? C.gold : C.line, 1);
      tileFace(COMPASS[compass[h]], hx + 20, 57, 19, highlighted ? C.ink : C.paper);
    }
    wallBacks(view);
    seatCard('south', view); seatCard('west', view); seatCard('east', view); seatCard('north', view);

    digital(String(round.wall_remaining), 640, 321, 52, 'center');
    label(TXT('wall', '牌墙剩余'), 640, 367, 16, C.paper, 'center', '600');

    sentencePill(view);

    var canAct = round.active_player_id === view.viewer_id;
    var buttons = [];
    if (canAct && round.phase === 'AWAIT_ACTION') {
      buttons.push({ text: TXT('meme_compose', '表情造句'), fn: openCompose, primary: false });
      buttons.push({ text: TXT('discard', '出牌'), fn: proposePlain, primary: true });
    }
    if (canAct && round.phase === 'AWAIT_DRAW') {
      buttons.push({ text: TXT('draw', '摸牌'), fn: doDraw, primary: true });
    }
    if (canAct && round.phase === 'MUST_DISCARD') {
      buttons.push({ text: TXT('discard', '弃牌'), fn: discardSelected, primary: true });
    }
    buttons.push({ text: TXT('clear', '清空选择'), fn: function () { app.selection = []; draw(); }, primary: false });
    for (var b = 0; b < buttons.length; b++) {
      var buttonWidth = Math.min(94, (300 - (buttons.length - 1) * 10) / buttons.length);
      button(buttons[b].text, 928 + b * (buttonWidth + 10), 462, buttonWidth, 48, buttons[b].fn, buttons[b].primary ? 'primary' : 'secondary', false);
    }
    var hand = round.hand, count = hand.length;
    var gap = count > 1 ? Math.min(66, (930 - 56) / (count - 1)) : 66;
    var rowWidth = count > 0 ? (count - 1) * gap + 56 : 0;
    var trayWidth = Math.max(180, rowWidth + 32);
    var trayX = 736 - trayWidth / 2, handStart = trayX + (trayWidth - rowWidth) / 2;
    rr(trayX, 568, trayWidth, 110, 18, '#102f33', '#537766', 1.5);
    for (var t = 0; t < count; t++) {
      var index = app.selection.indexOf(hand[t].id);
      handTile(hand[t], handStart + t * gap, 588, index >= 0, index >= 0 ? index : 0);
    }
    label(app.toast || stateMessage(view), 640, 452, 16, app.toast ? C.red : C.paper, 'center', '600', 390);
  }
  function stateMessage(view) {
    var round = view.round;
    if (round.phase === 'AWAIT_DRAW') return round.active_player_id === view.viewer_id ? '请先摸牌，再出句' : '等待 ' + COMPASS[round.active_player_id] + ' 摸牌';
    if (round.phase === 'AWAIT_ACTION') return round.active_player_id === view.viewer_id ? '依次点击手牌，组成你想说的话' : '等待 ' + COMPASS[round.active_player_id] + ' 出句';
    if (round.phase === 'AWAIT_VOTES') return TXT('vote_progress', '已收到投票') + ' ' + round.pending_sentence.votes_received + ' / 3';
    if (round.phase === 'MUST_DISCARD') return round.active_player_id === view.viewer_id ? TXT('phase_discard', '本手未通过，请弃一张牌') : '等待 ' + COMPASS[round.active_player_id] + ' 弃牌';
    if (round.phase === 'COMPLETED') return TXT('phase_completed', '本局清算完成');
    if (round.phase === 'ABORTED') return '本局已中止';
    return '';
  }

  function toggleTile(tileId) {
    var view = app.table && localView();
    if (!view || view.round.active_player_id !== view.viewer_id) return;
    var phase = view.round.phase;
    if (phase === 'MUST_DISCARD') { app.selection = [tileId]; app.toast = ''; draw(); return; }
    if (phase !== 'AWAIT_ACTION') { app.toast = phase === 'AWAIT_DRAW' ? '请先摸牌' : '当前不能选牌'; draw(); return; }
    var index = app.selection.indexOf(tileId);
    if (index >= 0) app.selection.splice(index, 1);
    else app.selection.push(tileId);
    app.toast = '';
    draw();
  }
  function selectedTiles() {
    var online = app.screen === 'online-compose';
    var view = online ? app.online && app.online.view : localView();
    if (!view || !view.round) return [];
    var hand = online ? (view.round.hand_by_player && view.round.hand_by_player[app.onlineControlSeat] || view.round.hand || []) : view.round.hand;
    return app.selection.map(function (id) {
      for (var i = 0; i < hand.length; i++) if (hand[i].id === id) return hand[i];
      return null;
    }).filter(Boolean);
  }
  function proposePlain() {
    if (app.selection.length < 2) { app.toast = TXT('no_selection', '至少选两张牌，再点「出句」'); draw(); return; }
    doPropose([]);
  }
  function discardSelected() {
    if (app.selection.length !== 1) { app.toast = '请选择一张要弃掉的牌'; draw(); return; }
    var feedback = app.table.discard(app.selection[0]);
    app.selection = [];
    if (!feedback.receipt.ok) app.toast = feedback.receipt.error; else app.toast = '';
    route();
  }
  function doDraw() {
    var feedback = app.table.draw();
    if (!feedback.receipt.ok) app.toast = feedback.receipt.error; else app.toast = '';
    route();
  }
  function doPropose(keys) {
    var ids = app.selection.slice();
    var feedback = app.table.propose(ids, keys);
    if (!feedback.receipt.ok) { app.toast = feedback.receipt.error; draw(); return; }
    app.selection = []; app.chosen = []; app.memeQuery = ''; app.memeScroll = 0; app.toast = '';
    app.voteQueue = SEATS.filter(function (seat) { return seat !== app.viewer; });
    nextVoter();
  }

  function openCompose() {
    if (app.selection.length < 2) { app.toast = TXT('no_selection', '至少选两张牌，再点「出句」'); draw(); return; }
    app.chosen = app.chosen.filter(function (key) { return !!memeByKey(key); });
    app.memeScroll = 0;
    app.screen = 'compose';
    draw();
  }
  function composeScreen() {
    hits = [];
    ctx.fillStyle = 'rgba(3,16,20,.78)'; ctx.fillRect(0, 82, W, H - 82);
    var online = app.screen === 'online-compose';
    var view = online ? app.online && app.online.view : localView();
    if (!view || !view.round) return;
    var tiles = selectedTiles();
    rr(110, 64, 1060, 600, 30, C.panel, '#bd9359', 2);
    rr(126, 80, 1028, 568, 22, null, 'rgba(241,202,124,.24)', 1);
    hits.push({ x: 110, y: 64, w: 1060, h: 600 });
    label(TXT('meme_compose', '表情造句'), 142, 120, 23, C.gold, 'left', '700');
    rr(294, 96, 476, 48, 12, C.deep, C.line, 1);
    label(TXT('selected', '已选') + '字牌', 310, 120, 13, C.muted, 'left', '600');
    label(tiles.map(function (t) { return t.glyph; }).join(''), 378, 120, 24, C.paper, 'left', '700', 376);
    rr(786, 96, 176, 48, 12, C.deep, C.line, 1);
    label('已选表情 ' + app.chosen.length + ' / ' + (view.config.max_meme_images || 12), 874, 120, 14, C.muted, 'center');
    button('返回改字', 978, 96, 160, 48, function () { app.screen = online ? 'online-table' : 'table'; draw(); });

    if (app.chosen.length) {
      for (var i = 0; i < app.chosen.length && i < 12; i++) {
        (function (index) {
          var key = app.chosen[index];
          var meme = memeByKey(key);
          var x = 142 + (index % 6) * 168, y = 160 + Math.floor(index / 6) * 60;
          rr(x, y, 156, 48, 12, C.deep, C.gold, 1.5);
          label((index + 1) + '. ' + (meme ? meme.title : key), x + 8, y + 22, 12, C.paper, 'left', '600', 100);
          label('‹', x + 112, y + 22, 16, C.muted, 'center', '700');
          label('›', x + 130, y + 22, 16, C.muted, 'center', '700');
          label('×', x + 140, y + 38, 14, C.red, 'center', '700');
          hits.push({ x: x + 104, y: y, w: 20, h: 44, fn: function () { moveChosen(index, -1); } });
          hits.push({ x: x + 124, y: y, w: 18, h: 44, fn: function () { moveChosen(index, 1); } });
          hits.push({ x: x + 136, y: y + 22, w: 14, h: 22, fn: function () { removeChosen(index); } });
        })(i);
      }
    }

    var contentTop = 160 + Math.ceil(app.chosen.length / 6) * 60;
    rr(142, contentTop, 492, 44, 12, C.deep, C.line, 1);
    label(app.memeQuery || '按名称或关键词搜索', 158, contentTop + 22, 14, app.memeQuery ? C.paper : C.muted, 'left', '500', 416);
    if (app.memeQuery) { label('×', 612, contentTop + 22, 16, C.red, 'center', '700'); hits.push({ x: 590, y: contentTop, w: 44, h: 44, fn: function () { app.memeQuery = ''; app.memeScroll = 0; draw(); } }); }
    hits.push({ x: 142, y: contentTop, w: 440, h: 44, fn: askSearch });
    function scope(value) { app.memeScope = value; app.memeScroll = 0; draw(); }
    button('全部', 650, contentTop, 84, 44, function () { scope('all'); }, app.memeScope === 'all' ? 'primary' : 'secondary');
    button('我的表情', 742, contentTop, 108, 44, function () { scope('mine'); }, app.memeScope === 'mine' ? 'primary' : 'secondary');
    button('房间表情', 858, contentTop, 108, 44, function () { scope('room'); }, app.memeScope === 'room' ? 'primary' : 'secondary', !online || !app.online.shareMeme);
    button('＋ 添加表情', 974, contentTop, 164, 44, openMemeForm, 'secondary', !CUSTOM);

    var ranked = rankMemes(app.memeQuery, selectedTiles().map(function (t) { return t.glyph; }));
    var top = contentTop + 60, bottom = 580, colW = (996 - 32) / 3, gap = 16, coverH = 168;
    var rows = Math.max(1, Math.ceil(ranked.length / 3));
    var contentH = rows * (coverH + 12), viewH = bottom - top;
    var maxScroll = Math.max(0, contentH - viewH);
    if (app.memeScroll > maxScroll) app.memeScroll = maxScroll;
    if (app.memeScroll < 0) app.memeScroll = 0;
    rr(142, top, 996, viewH, 16, '#0a2e2e', '#2f5a50', 1);
    ctx.save();
    rr(142, top, 996, viewH, 16, null, null, 0);
    ctx.clip();
    for (var m = 0; m < ranked.length; m++) {
      (function (meme, slot) {
        var row = Math.floor(slot / 3), col = slot % 3;
        var x = 142 + col * (colW + gap), y = top + row * (coverH + 12) - app.memeScroll;
        if (y + coverH < top || y > bottom) return;
        var order = app.chosen.indexOf(meme.key);
        cover(meme.path, x, y, colW, coverH, 10);
        if (meme.key.indexOf('meme.user.') === 0) {
          var available = !!CUSTOM.get(meme.key), shared = roomMemeKeys().indexOf(meme.key) >= 0;
          pill(!available ? '接收中' : shared ? (app.online.memeReady && app.online.memeReady(meme.key) ? '房间共享' : '共享中') : '我的表情', x + 8, y + 8, 84);
        }
        if (order >= 0) { rr(x + colW - 36, y + 8, 28, 28, 14, C.gold, null, 0); label(String(order + 1), x + colW - 22, y + 22, 14, C.ink, 'center', '700'); }
        var hitTop = Math.max(top, y), hitBottom = Math.min(bottom, y + coverH);
        hits.push({ x: x, y: hitTop, w: colW, h: hitBottom - hitTop, previewPath: meme.path, fn: function () { toggleMeme(meme.key); } });
        if (app.memeScope === 'mine' && meme.personal && y + coverH - 38 >= top && y + coverH - 8 <= bottom) button('删除', x + colW - 64, y + coverH - 38, 56, 30, function () { deleteMeme(meme.key); });
      })(ranked[m], m);
    }
    ctx.restore();
    if (!ranked.length) label(app.memeScope === 'mine' ? '还没有自己的表情，点击「添加表情」从相册导入' : app.memeScope === 'room' ? '本房间还没有共享表情' : '没有找到匹配的表情', 640, top + viewH / 2, 16, C.muted, 'center', '500', 900);
    if (contentH > viewH) {
      var trackH = viewH - 20, thumbH = Math.max(36, trackH * viewH / contentH);
      var thumbY = top + 10 + (trackH - thumbH) * (maxScroll ? app.memeScroll / maxScroll : 0);
      rr(1142, thumbY, 4, thumbH, 3, C.line, null, 0);
    }
    var syncing = online && app.chosen.some(function (key) { return key.indexOf('meme.user.') === 0 && (!app.online.memeReady || !app.online.memeReady(key)); });
    label(app.memeNotice || app.toast || (online && app.online.error) || '自定义表情会保存在本机；加入房间后可共享', 142, 618, 13, C.muted, 'left', '500', 706);
    button(syncing ? '表情同步中…' : '提交句子', 878, 596, 260, 44, function () {
      if (online) onlineCommand('PROPOSE_SENTENCE', {tile_ids: app.selection.slice(), resource_keys: app.chosen.slice()});
      else doPropose(app.chosen.slice());
    }, 'primary', syncing || app.memeBusy);
  }
  function memeByKey(key) {
    for (var i = 0; i < MEMES.length; i++) if (MEMES[i].key === key) return MEMES[i];
    var custom = customCatalog();
    for (var j = 0; j < custom.length; j++) if (custom[j].key === key) return custom[j];
    return null;
  }
  function roomMemeKeys() {
    return app.online && app.online.room && Array.isArray(app.online.room.custom_memes) ? app.online.room.custom_memes.map(function (m) { return m.key; }) : [];
  }
  function customCatalog() {
    if (!CUSTOM) return [];
    var list = CUSTOM.list().filter(function (m) { return m.personal || roomMemeKeys().indexOf(m.key) >= 0; });
    var known = list.map(function (m) { return m.key; });
    var shared = app.online && app.online.room && app.online.room.custom_memes || [];
    shared.forEach(function (m) {
      if (known.indexOf(m.key) < 0) list.push(Object.assign({}, m, {kind: 'meme', path: 'custom://' + m.key, personal: false}));
    });
    return list;
  }
  function refreshCustomAnimations() {
    if (!CUSTOM) return;
    var valid = {};
    CUSTOM.list().forEach(function (m) {
      valid[m.path] = true;
      if (m.format === 'gif' && m.frames > 1) ANIMATIONS[m.path] = {custom: true, path: m.path, frames: 2, frame_ms: 83.34};
    });
    Object.keys(ANIMATIONS).forEach(function (path) {
      if (ANIMATIONS[path].custom && !valid[path]) { if (activeAnimation === path) previewAnimation(''); delete ANIMATIONS[path]; }
    });
  }
  function drawCustomSurface(value, frame, x, y, w, h) {
    var ratio = Math.min(w / value.width, h / value.height), dw = value.width * ratio, dh = value.height * ratio;
    ctx.drawImage(value.canvas, (frame % value.columns) * value.width, Math.floor(frame / value.columns) * value.height,
      value.width, value.height, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function customCover(path, x, y, w, h, radius) {
    var key = path.slice(9), available = CUSTOM.get(key), slot = available ? CUSTOM.image(key, path === activeAnimation) : null;
    ctx.save(); rr(x, y, w, h, radius || 10, C.deep); ctx.clip();
    if (slot && slot.value) {
      var frame = path === activeAnimation ? Math.floor((Date.now() - animationStarted) / Math.max(20, slot.value.frame_ms)) % slot.value.frames : 0;
      drawCustomSurface(slot.value, frame, x, y, w, h);
    } else label(!available ? '表情接收中…' : slot && slot.state === 'failed' ? '图片无法加载' : '图片加载中…', x + w / 2, y + h / 2, 15, C.muted, 'center', '500', w - 20);
    ctx.restore(); rr(x, y, w, h, radius || 10, null, C.line, 1);
  }
  function closeMemeForm() {
    if (draftTicker !== null) clearInterval(draftTicker);
    draftTicker = null; app.memeForm = null; activeOnlineInput = '';
    if (inWeChat && wx.hideKeyboard) wx.hideKeyboard();
  }
  function openMemeForm() {
    if (!CUSTOM || app.memeBusy) return;
    previewAnimation(''); app.memeTitle = ''; app.memeKeywords = ''; app.memeNotice = '';
    app.memeForm = {selected: null, preview: null, previewReady: false, saved: null, busy: false, status: '从手机相册选择一张图片', started: Date.now(), client: app.online};
    draw(); chooseMemeFile();
  }
  function chooseMemeFile() {
    var form = app.memeForm; if (!form || form.busy) return;
    form.busy = true; form.status = '正在打开相册…'; draw();
    CUSTOM.choose().then(function (selected) {
      if (app.memeForm !== form) return;
      form.selected = selected; form.preview = null; form.previewReady = false; form.saved = null; form.status = '正在准备预览…'; draw();
      return CUSTOM.preview(selected).then(function (preview) {
        if (app.memeForm !== form) return;
        form.preview = preview; form.previewReady = true; form.busy = false; form.started = Date.now(); form.status = '请填写名称和关键词';
        if (draftTicker !== null) clearInterval(draftTicker);
        draftTicker = setInterval(function () { if (!appHidden && app.memeForm === form && form.preview && form.preview.frames > 1) draw(); }, 84);
        draw();
      });
    }).catch(function (e) { if (app.memeForm === form) { form.busy = false; form.status = e.message; draw(); } });
  }
  function saveMemeForm() {
    var form = app.memeForm; if (!form || form.busy || !form.selected) return;
    form.busy = true; form.status = form.saved ? '正在分享到房间…' : '正在保存到我的表情…'; draw();
    var save = form.saved ? Promise.resolve(form.saved) : CUSTOM.add(form.selected, app.memeTitle, app.memeKeywords);
    save.then(function (meta) {
      form.saved = meta;
      if (app.memeForm !== form) return;
      if (form.client && form.client !== app.online) throw new Error('表情已保存，但原房间已退出');
      if (form.client) {
        if (!form.client.shareMeme) throw new Error('表情已保存；请在手机同 Wi-Fi 房间中分享');
        form.status = '已保存，正在分享到房间…'; draw();
        return form.client.shareMeme(meta.key);
      }
    }).then(function () {
      if (app.memeForm !== form) return;
      app.memeScope = form.client ? 'room' : 'mine'; app.memeQuery = ''; app.memeScroll = 0;
      app.memeNotice = form.client ? '已保存并加入房间表情库，其他玩家正在接收' : '已保存到我的表情，下次还能使用';
      closeMemeForm(); draw();
    }).catch(function (e) { if (app.memeForm === form) { form.busy = false; form.status = (form.saved ? '已保存在本机；' : '') + e.message; draw(); } });
  }
  function customMemeScreen() {
    hits = [];
    var form = app.memeForm;
    rr(110, 64, 1060, 600, 30, C.panel, '#bd9359', 2);
    rr(126, 80, 1028, 568, 22, null, 'rgba(241,202,124,.24)', 1);
    hits.push({x: 110, y: 64, w: 1060, h: 600});
    label('添加表情', 142, 120, 24, C.gold, 'left', '700');
    button('返回表情库', 978, 96, 160, 48, function () { closeMemeForm(); draw(); });
    rr(142, 168, 396, 350, 18, C.deep, C.line, 1);
    if (form.preview) drawCustomSurface(form.preview, Math.floor((Date.now() - form.started) / Math.max(20, form.preview.frame_ms)) % form.preview.frames, 158, 184, 364, 318);
    else label(form.busy ? '正在读取图片…' : form.previewReady ? '预览已暂停' : '还没有选择图片', 340, 340, 18, C.muted, 'center');
    button('从相册重新选择', 142, 538, 396, 44, chooseMemeFile, 'secondary', form.busy || !!form.saved);
    label('表情名称', 570, 184, 16, C.paper, 'left', '600');
    rr(570, 208, 568, 52, 12, C.deep, C.line, 1);
    label(app.memeTitle || '填写名称（最多 24 字）', 586, 234, 17, app.memeTitle ? C.paper : C.muted, 'left', '500', 536);
    if (!form.busy && !form.saved) hits.push({x: 570, y: 208, w: 568, h: 52, fn: function () { editOnline('memeTitle', '表情名称（最多 24 字）'); }});
    label('关键词 · 必填', 570, 296, 16, C.paper, 'left', '600');
    rr(570, 320, 568, 52, 12, C.deep, C.line, 1);
    label(app.memeKeywords || '例如：开心，庆祝，赢了', 586, 346, 17, app.memeKeywords ? C.paper : C.muted, 'left', '500', 536);
    if (!form.busy && !form.saved) hits.push({x: 570, y: 320, w: 568, h: 52, fn: function () { editOnline('memeKeywords', '填写 1–5 个关键词，用逗号或空格分隔'); }});
    label('1–5 个关键词，每个最多 12 字，用逗号或空格分隔', 570, 397, 14, C.muted);
    label('GIF / JPG / PNG · 单张最多 2 MB · 宽高最多 1024 像素', 570, 435, 14, C.muted);
    if (form.selected) label(form.selected.info.format.toUpperCase() + ' · ' + Math.round(form.selected.bytes.length / 1024) + ' KB' + (form.selected.info.format === 'gif' ? ' · ' + (form.selected.info.duration / 1000).toFixed(1) + ' 秒' : ''), 570, 469, 14, C.gold);
    label(form.client ? '加入当前房间后，所有玩家都能搜索和选用' : '保存在我的表情，之后进入 Wi-Fi 房间可分享', 570, 506, 14, C.paper);
    label(form.status, 142, 618, 14, C.muted, 'left', '500', 706);
    button(form.busy ? '处理中…' : form.saved ? '重试分享到房间' : form.client ? '保存并分享到房间' : '保存到我的表情', 878, 596, 260, 44, saveMemeForm, 'primary', form.busy || !form.previewReady);
  }
  function deleteMeme(key) {
    var name = memeByKey(key), message = '删除“' + (name ? name.title : '这个表情') + '”的本机收藏？当前房间的共享副本会保留。';
    function remove() {
      CUSTOM.remove(key).then(function () { if (roomMemeKeys().indexOf(key) < 0) app.chosen = app.chosen.filter(function (k) { return k !== key; }); app.memeNotice = '已删除本机收藏'; draw(); })
        .catch(function (e) { app.memeNotice = e.message; draw(); });
    }
    if (inWeChat && wx.showModal) wx.showModal({title: '删除表情', content: message, success: function (r) { if (r.confirm) remove(); }});
    else if (!inWeChat && window.confirm(message)) remove();
  }
  function toggleMeme(key) {
    var index = app.chosen.indexOf(key);
    if (index >= 0) { app.chosen.splice(index, 1); draw(); return; }
    if (key.indexOf('meme.user.') === 0) {
      if (!CUSTOM || !CUSTOM.get(key)) { app.memeNotice = '表情正在接收，请稍候'; draw(); return; }
      if (app.screen === 'online-compose' && roomMemeKeys().indexOf(key) < 0) {
        if (app.memeBusy) return;
        if (!app.online.shareMeme) { app.memeNotice = '当前联机入口不支持自定义表情，请使用手机同 Wi-Fi 房间'; draw(); return; }
        var client = app.online; app.memeBusy = true; app.memeNotice = '正在分享到房间…'; draw();
        client.shareMeme(key).then(function () {
          if (app.online !== client) return;
          app.memeBusy = false; app.memeNotice = '已加入房间表情库，等待其他玩家接收'; if (app.screen === 'online-compose') toggleMeme(key); else draw();
        }).catch(function (e) { app.memeBusy = false; if (app.online === client) { app.memeNotice = e.message; draw(); } }); return;
      }
    }
    var view = app.screen === 'online-compose' ? app.online && app.online.view : localView();
    var max = view && view.config && view.config.max_meme_images || 12;
    if (app.chosen.length >= max) { app.toast = TXT('meme_limit', '已达到最大图片数量'); draw(); return; }
    app.chosen.push(key);
    draw();
  }
  function moveChosen(index, delta) {
    var target = index + delta;
    if (target < 0 || target >= app.chosen.length) return;
    var tmp = app.chosen[index]; app.chosen[index] = app.chosen[target]; app.chosen[target] = tmp;
    draw();
  }
  function removeChosen(index) { app.chosen.splice(index, 1); draw(); }
  var rankKey = null, rankResult = null;
  function rankMemes(query, glyphs) {
    var catalog = MEMES.concat(customCatalog());
    var roomKeys = roomMemeKeys();
    if (app.memeScope === 'mine') catalog = catalog.filter(function (m) { return m.personal; });
    else if (app.memeScope === 'room') catalog = catalog.filter(function (m) { return roomKeys.indexOf(m.key) >= 0; });
    var key = JSON.stringify([query, glyphs, app.memeScope, catalog.map(function (m) { return m.key; })]);
    if (key !== rankKey) {
      rankKey = key; perf.rankComputations++;
      rankResult = CORE && CORE.rankMemes ? CORE.rankMemes(catalog, query, glyphs) : catalog;
    }
    return rankResult;
  }
  function askSearch() {
    editOnline('memeQuery', '搜索表情名称或关键词'); app.memeScroll = 0;
  }

  function nextVoter() {
    if (!app.voteQueue.length) {
      var probe = localView();
      var owner = probe && probe.round && probe.round.pending_sentence ? probe.round.pending_sentence.owner_id : null;
      if (owner) app.voteQueue = SEATS.filter(function (seat) { return seat !== owner; });
    }
    var seat = app.voteQueue.shift();
    if (seat === undefined) { afterVote(); return; }
    openHandoff(seat);
  }
  function openDecision() {
    app.decision = { approve: null };
    app.carousel = 0;
    app.screen = 'decision';
    startCarousel();
    draw();
  }
  function pendingMemes(view) {
    var pending = view.round.pending_sentence;
    if (!pending || !pending.resource_keys.length) return [];
    return pending.resource_keys.map(memeByKey).filter(Boolean);
  }
  function decisionScreen() {
    hits = [];
    ctx.fillStyle = 'rgba(3,16,20,.78)'; ctx.fillRect(0, 82, W, H - 82);
    var online = app.screen === 'online-vote';
    var view = online ? app.online && app.online.view : localView();
    if (!view || !view.round) return;
    var pending = view.round.pending_sentence;
    if (!pending) { if (online) { stopCarousel(); app.screen = 'online-table'; draw(); } else route(); return; }
    var memes = pendingMemes(view);
    rr(260, 100, 760, 508, 30, C.panel, '#bd9359', 2);
    rr(282, 122, 716, 464, 24, null, 'rgba(241,202,124,.24)', 1);
    label((online ? onlineCompass(view, pending.owner_id) : COMPASS[pending.owner_id]) + ' · ' + pending.text, 640, 158, 26, C.paper, 'center', '700', 680);
    label(TXT('vote_progress', '已收到投票') + ' ' + pending.votes_received + ' / ' + (view.players.length - 1), 640, 194, 14, C.muted, 'center');
    if (memes.length) {
      carousel(memes, 300, 220, 280, 220);
      label(TXT('decision_title', '这句话，你认可吗？'), 610, 236, 22, C.gold, 'left', '700');
      label('先判断句子。带表情的句子，接着为表情打分。', 610, 274, 14, C.muted, 'left', '500', 340);
      button(TXT('approve', '认可'), 610, 320, 360, 62, function () { castDecision(true); }, 'primary');
      button(TXT('oppose', '反对'), 610, 400, 360, 62, function () { castDecision(false); });
    } else {
      label(TXT('decision_title', '这句话，你认可吗？'), 640, 268, 24, C.gold, 'center', '700');
      label('无表情句子直接提交判断，不需要评分。', 640, 306, 14, C.muted, 'center');
      button(TXT('approve', '认可'), 370, 350, 260, 64, function () { castDecision(true); }, 'primary');
      button(TXT('oppose', '反对'), 650, 350, 260, 64, function () { castDecision(false); });
    }
  }
  function carousel(memes, x, y, w, h) {
    var index = app.carousel % memes.length;
    if (memes[index].key.indexOf('meme.user.') === 0 && ANIMATIONS[memes[index].path] && activeAnimation !== memes[index].path) previewAnimation(memes[index].path);
    cover(memes[index].path, x, y, w, h, 12);
    hits.push({x: x, y: y, w: w, h: h, previewPath: memes[index].path});
    label((index + 1) + ' / ' + memes.length, x + w / 2, y + h + 22, 14, C.muted, 'center');
    button(TXT('meme_previous', '上一张'), x, y + h + 42, 84, 36, function () { app.carousel = (app.carousel + memes.length - 1) % memes.length; draw(); });
    button(TXT('meme_pause', '暂停'), x + 94, y + h + 42, 84, 36, function () { stopCarousel(); draw(); });
    button(TXT('meme_next', '下一张'), x + 188, y + h + 42, 84, 36, function () { app.carousel++; draw(); });
  }
  function startCarousel() {
    stopCarousel();
    if (typeof setInterval !== 'function') return;
    var seconds = Math.max(0.25, Number(PLAYBACK.seconds_per_image) || 2);
    app.timer = setInterval(function () { app.carousel++; draw(); }, seconds * 1000);
  }
  function stopCarousel() { if (app.timer !== null && typeof clearInterval === 'function') clearInterval(app.timer); app.timer = null; }
  function castDecision(approve) {
    app.decision = { approve: approve };
    var online = app.screen === 'online-vote';
    var view = online ? app.online.view : localView();
    var pending = view.round.pending_sentence;
    if (pending && pending.resource_keys.length) { app.selectedRating = 0; app.screen = online ? 'online-rating' : 'rating'; draw(); }
    else submitVote(0);
  }
  function ratingScreen() {
    hits = [];
    ctx.fillStyle = 'rgba(3,16,20,.78)'; ctx.fillRect(0, 82, W, H - 82);
    var online = app.screen === 'online-rating';
    var view = online ? app.online && app.online.view : localView();
    if (!view || !view.round) return;
    var pending = view.round.pending_sentence;
    if (!pending) { if (online) { stopCarousel(); app.screen = 'online-table'; draw(); } else route(); return; }
    var memes = pendingMemes(view);
    rr(260, 100, 760, 508, 30, C.panel, '#bd9359', 2);
    rr(282, 122, 716, 464, 24, null, 'rgba(241,202,124,.24)', 1);
    label((online ? onlineCompass(view, pending.owner_id) : COMPASS[pending.owner_id]) + ' · ' + pending.text, 640, 158, 26, C.paper, 'center', '700', 680);
    label(TXT('vote_progress', '已收到投票') + ' ' + pending.votes_received + ' / ' + (view.players.length - 1), 640, 194, 14, C.muted, 'center');
    if (memes.length) carousel(memes, 300, 220, 280, 220);
    label(TXT('rating_title', '给这组表情打个分'), 610, 240, 22, C.gold, 'left', '700');
    label(TXT('rating_hint', '点击 0–3 分完成提交。评分与刚才的判断一起送出。'), 610, 278, 14, C.muted, 'left', '500', 360);
    for (var n = 0; n <= 3; n++) {
      (function (score) {
        var x = 610 + score * 92, selected = app.selectedRating === score;
        rr(x, 316, 76, 64, 10, selected ? C.gold : C.deep, selected ? C.gold : C.line, selected ? 2 : 1);
        digital(String(score), x + 38, 348, 34, 'center');
      })(n);
      (function (score) { hits.push({ x: 610 + score * 92, y: 316, w: 76, h: 64, fn: function () { app.selectedRating = score; draw(); } }); })(n);
    }
    button('提交', 610, 400, 360, 54, function () { submitVote(app.selectedRating); }, 'primary');
    button(TXT('decision_back', '返回修改判断'), 610, 470, 360, 44, function () { app.screen = online ? 'online-vote' : 'decision'; draw(); });
  }
  function submitVote(rating) {
    if (app.screen === 'online-vote' || app.screen === 'online-rating') {
      stopCarousel();
      onlineCommand('SUBMIT_VOTE', {approve: app.decision.approve === true, rating: rating});
      return;
    }
    var view = localView();
    if (!view || !view.round.pending_sentence) { route(); return; }
    var feedback = app.table.vote(app.decision.approve === true, rating);
    stopCarousel();
    if (!feedback.receipt.ok) { app.toast = feedback.receipt.error; route(); return; }
    afterVote();
  }
  function afterVote() {
    var view = localView();
    if (!view) { app.screen = 'handoff'; draw(); return; }
    var phase = view.round.phase;
    if (phase === 'COMPLETED' || phase === 'ABORTED') { openResult(); return; }
    if (phase === 'MUST_DISCARD') { openHandoff(view.round.active_player_id); return; }
    if (phase === 'AWAIT_VOTES') { nextVoter(); return; }
    route();
  }

  function openResult() {
    stopCarousel();
    app.screen = 'result';
    draw();
  }
  function resultScreen() {
    hits = [];
    ctx.fillStyle = 'rgba(3,16,20,.78)'; ctx.fillRect(0, 82, W, H - 82);
    var online = app.screen === 'online-result';
    var view = online ? app.online && app.online.view : localView();
    if (!view || !view.round) return;
    var round = view.round;
    var completed = round.phase === 'COMPLETED';
    app.resultMode = completed ? 'completed' : 'aborted';
    rr(120, 70, 1040, 580, 32, C.panel, '#bd9359', 2);
    rr(142, 92, 996, 536, 24, null, 'rgba(241,202,124,.24)', 1);
    label(completed ? TXT('phase_completed', '本局清算完成') : '本局已中止', 160, 124, 26, C.gold, 'left', '700');
    if (completed) {
      var scores = round.result.scores;
      label('玩家', 160, 170, 14, C.muted, 'left', '600');
      label(TXT('sentence_points', '出句'), 330, 170, 14, C.muted, 'left', '600');
      label(TXT('meme_points', '评分加分'), 470, 170, 14, C.muted, 'left', '600');
      label(TXT('penalty', '剩牌扣分'), 640, 170, 14, C.muted, 'left', '600');
      label(TXT('round_points', '本局总分'), 830, 170, 14, C.muted, 'left', '600');
      for (var i = 0; i < view.players.length; i++) {
        var p = view.players[i], row = scores[p], y = 205 + i * 38;
        label((online ? onlineCompass(view, p) : COMPASS[p]) + ((online ? (view.controlled_players || []).indexOf(p) >= 0 : p === view.viewer_id) ? ' · 我' : ''), 160, y, 16, C.paper, 'left', '600');
        label(String(row.sentence_points), 330, y, 16, C.paper, 'left', '500');
        label((row.rating_bonus.numerator / 3).toFixed(2), 470, y, 16, C.paper, 'left', '500');
        label(String(-row.remaining_tiles), 640, y, 16, C.paper, 'left', '500');
        label(fmt(row.total.numerator), 830, y, 17, row.total.numerator >= 0 ? C.digital : C.red, 'left', '700');
      }
      if (round.winner_id) label('胡牌：' + (online ? onlineCompass(view, round.winner_id) : COMPASS[round.winner_id]), 1000, 124, 16, C.gold, 'right', '700');
    } else {
      label(TXT('aborted_hint', '本局已中止。已确认的句子保留在历史中，但不计入累计分。'), 160, 176, 15, C.muted, 'left', '500', 940);
    }
    if (completed) label('本局排名', 160, 400, 16, C.muted, 'left', '600');
    var cards = completed ? roundRanking(view) : [];
    for (var r = 0; r < cards.length; r++) {
      var rank = cards[r], x = 160 + r * 244;
      rr(x, 420, 224, 92, 12, C.deep, rank.rank === 1 ? C.gold : C.line, rank.rank === 1 ? 2 : 1);
      label(rank.rank + ' · ' + (online ? onlineCompass(view, rank.player_id) : COMPASS[rank.player_id]) + (online ? (rank.player_id === view.players[0] ? ' · 主机' : '') : (rank.player_id === 'east' ? ' · 主机' : '')), x + 12, 446, 14, C.paper, 'left', '600');
      digital(fmt(rank.total.numerator), x + 12, 482, 30, 'left');
    }
    button(TXT('next_round', '开始下一局'), 400, 552, 240, 54, online ? function () {
      onlineCommand('REQUEST_START_ROUND', {preset_id: app.online.room && app.online.room.preset_id || DECKS[app.deckIndex].id, allow_extra_round: true});
    } : nextRound, 'primary', online && app.online.playerId !== view.host_player_id);
    button(TXT('back', '返回菜单'), 660, 552, 200, 54, online ? closeOnline : backToMenu);
  }
  function nextRound() {
    stopDiceIntro();
    app.table.switchSeat('east');
    app.table.confirmHandoff();
    var feedback = app.table.nextRound(true);
    if (!feedback.receipt.ok) { app.toast = feedback.receipt.error; draw(); return; }
    app.selection = []; app.chosen = []; app.memeQuery = ''; app.memeScroll = 0; app.voteQueue = [];
    var view = localView();
    startDiceIntro(view);
  }
  function stopDiceIntro() {
    diceIntroToken++;
    if (diceRollTimer !== null && typeof clearInterval === 'function') clearInterval(diceRollTimer);
    if (diceSettleTimer !== null && typeof clearTimeout === 'function') clearTimeout(diceSettleTimer);
    if (diceHandoffTimer !== null && typeof clearTimeout === 'function') clearTimeout(diceHandoffTimer);
    diceRollTimer = null; diceSettleTimer = null; diceHandoffTimer = null;
    app.diceIntro = null;
  }
  function finishDiceIntro() {
    if (!app.diceIntro) return;
    var intro = app.diceIntro;
    if (!intro.online && !app.table) return;
    stopDiceIntro();
    if (intro.online) { app.screen = 'online-table'; draw(); }
    else openHandoff(intro.active);
  }
  function settleDiceIntro() {
    if (!app.diceIntro || app.screen !== 'dice') return;
    if (diceRollTimer !== null && typeof clearInterval === 'function') clearInterval(diceRollTimer);
    if (diceSettleTimer !== null && typeof clearTimeout === 'function') clearTimeout(diceSettleTimer);
    diceRollTimer = null; diceSettleTimer = null;
    app.diceIntro.face = app.diceIntro.dice.slice();
    app.diceIntro.rolling = false;
    draw();
  }
  function startDiceIntro(view, online) {
    stopDiceIntro();
    if (!view || !view.round) { if (!online) openHandoff('east'); return; }
    var round = view.round;
    var dice = Array.isArray(round.dice) && round.dice.length >= 2 ? round.dice.slice(0, 2) : [1, 1];
    app.diceIntro = {
      dice: dice, face: [1, 1], dealer: online ? onlineSeatOf(view, round.dealer_id || round.active_player_id) : round.dealer_id || round.active_player_id,
      active: round.active_player_id, rolling: true, frame: 0, online: !!online
    };
    app.screen = 'dice';
    var token = diceIntroToken;
    if (typeof setInterval !== 'function' || typeof clearInterval !== 'function' ||
      typeof setTimeout !== 'function' || typeof clearTimeout !== 'function') {
      app.diceIntro.face = dice.slice(); app.diceIntro.rolling = false;
      draw();
      return;
    }
    diceRollTimer = setInterval(function () {
      if (token !== diceIntroToken || app.screen !== 'dice' || !app.diceIntro.rolling) return;
      var intro = app.diceIntro;
      intro.frame++;
      intro.face = [1 + (intro.frame * 5 % 6), 1 + ((intro.frame * 7 + 2) % 6)];
      draw();
    }, 80);
    diceSettleTimer = setTimeout(function () {
      if (token !== diceIntroToken || app.screen !== 'dice' || !app.diceIntro.rolling) return;
      settleDiceIntro();
      diceHandoffTimer = setTimeout(function () {
        diceHandoffTimer = null;
        if (token === diceIntroToken && app.screen === 'dice') finishDiceIntro();
      }, 1300);
    }, 1050);
    draw();
  }
  function backToMenu() {
    stopDiceIntro();
    previewAnimation(''); pausedAnimation = '';
    app.table = null; app.screen = 'menu'; app.selection = []; app.chosen = [];
    app.toast = ''; app.memeQuery = '';
    closeMemeForm(); app.memeBusy = false; app.memeNotice = ''; app.memeScope = 'all';
    app.sentencesOpen = false; app.sentenceScroll = 0;
    stopCarousel();
    draw();
  }

  function startGame() {
    if (!CORE || !DECKS.length) { app.screen = 'menu'; draw(); return; }
    stopDiceIntro();
    app.table = new CORE.LocalTable(DECKS[app.deckIndex].deck);
    app.selection = []; app.chosen = []; app.memeQuery = ''; app.memeScroll = 0; app.voteQueue = []; app.toast = '';
    app.sentencesOpen = false; app.sentenceScroll = 0;
    var view = localView();
    startDiceIntro(view);
  }
  function openHandoff(seat) {
    app.table.switchSeat(seat);
    app.viewer = seat;
    app.screen = 'handoff';
    draw();
  }
  function confirmHandoff() {
    app.table.confirmHandoff();
    route();
  }
  function route() {
    var view = app.table && localView();
    if (!view) { app.screen = 'handoff'; draw(); return; }
    var round = view.round;
    if (round.phase === 'COMPLETED' || round.phase === 'ABORTED') { openResult(); return; }
    if (round.phase === 'AWAIT_VOTES') {
      var pending = round.pending_sentence;
      if (pending.owner_id !== view.viewer_id && !pending.has_voted) { openDecision(); return; }
      nextVoter(); return;
    }
    if (round.phase === 'MUST_DISCARD') {
      if (round.active_player_id !== view.viewer_id) { openHandoff(round.active_player_id); return; }
      app.screen = 'table'; draw(); return;
    }
    if (round.phase === 'AWAIT_DRAW' && round.active_player_id !== view.viewer_id) { openHandoff(round.active_player_id); return; }
    app.screen = 'table';
    draw();
  }

  function renderScreen() {
    hits = [];
    var vw, vh, ratio = 1, safeLeft = 0, safeTop = 0, safeWidth, safeHeight;
    if (inWeChat) {
      var info = windowInfo || (windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync());
      vw = info.windowWidth || info.screenWidth || W;
      vh = info.windowHeight || info.screenHeight || H;
      ratio = Math.min(2, info.pixelRatio || 1);
      var safe = info.safeArea;
      if (safe && safe.width > 0 && safe.height > 0) {
        safeLeft = Math.max(0, safe.left || 0); safeTop = Math.max(0, safe.top || 0);
        safeWidth = Math.min(vw - safeLeft, safe.width); safeHeight = Math.min(vh - safeTop, safe.height);
      }
    } else {
      vw = Math.max(1, window.innerWidth); vh = Math.max(1, window.innerHeight);
      ratio = Math.min(2, window.devicePixelRatio || 1);
    }
    pixelRatio = ratio;
    var cw = Math.max(1, Math.round(vw * ratio)), ch = Math.max(1, Math.round(vh * ratio));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    scale = Math.min((safeWidth || vw) / W, (safeHeight || vh) / H);
    offsetX = safeLeft + ((safeWidth || vw) - W * scale) / 2;
    offsetY = safeTop + ((safeHeight || vh) - H * scale) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.dark; ctx.fillRect(0, 0, cw, ch);
    ctx.setTransform(scale * ratio, 0, 0, scale * ratio, offsetX * ratio, offsetY * ratio);
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    background();
    if (!CONTENT || !CORE) {
      label('缺少生成内容：请先运行 scripts/build-preview-content.py 与 scripts/build-preview-core.mjs', 640, 340, 20, C.red, 'center', '600', 1000);
      return;
    }
    if (app.memeForm) { header(); customMemeScreen(); footer('名称用于辨认表情 · 关键词用于搜索和推荐'); return; }
    if (app.screen === 'menu') { header(); menuScreen(); footer('字库与素材来自电脑版 · 本地四席预览'); return; }
    if (app.screen === 'online-lobby') { header('联网开发版', closeOnline); onlineLobbyScreen(); footer('创建或加入房间 · 2–4 人准备后由房主开局'); return; }
    if (app.screen === 'online-table') { header('', closeOnline); onlineTableScreen(); if (app.sentencesOpen && app.online && app.online.view) sentencesPanel(app.online.view); footer(); return; }
    if (app.screen === 'online-compose') { header('', closeOnline); onlineComposeScreen(); footer('点击图片选择或取消 · 左右箭头调整播放顺序'); return; }
    if (app.screen === 'online-vote') { header('', closeOnline); onlineVoteScreen(); footer('投票期间只显示票数，不显示其他玩家的选择'); return; }
    if (app.screen === 'online-rating') { header('', closeOnline); ratingScreen(); footer('评分与判断一起提交'); return; }
    if (app.screen === 'online-result') { header('', closeOnline); onlineResultScreen(); footer('房主可开始下一局'); return; }
    if (app.screen === 'dice') { header('', app.diceIntro && app.diceIntro.online ? closeOnline : backToMenu); diceScreen(); footer('掷骰确定主家 · 结果由牌局规则决定'); return; }
    if (app.screen === 'handoff') { header('交接后查看手牌'); handoffScreen(); footer(); return; }
    header('', backToMenu);
    if (app.screen === 'table') { tableScreen(); if (app.sentencesOpen && app.table) sentencesPanel(localView()); footer(); return; }
    if (app.screen === 'compose') { if (!app.table || !localView()) { handoffScreen(); return; } composeScreen(); footer('点击图片选择或取消 · 可拖动顺序在正式端提供 · 本轮预览用左右箭头排序'); return; }
    if (app.screen === 'decision') { if (!app.table || !localView()) { handoffScreen(); return; } decisionScreen(); footer('投票期间只显示人数，不显示他人判断和分数'); return; }
    if (app.screen === 'rating') { if (!app.table || !localView()) { handoffScreen(); return; } ratingScreen(); footer('评分与判断一起提交 · 可返回修改'); return; }
    if (app.screen === 'result') { tableScreen(); resultScreen(); footer('本局结束后由主机开下一局 · 返回菜单可重开'); return; }
  }

  function hitAt(cx, cy) {
    var x = (cx - offsetX) / scale, y = (cy - offsetY) / scale;
    for (var i = hits.length - 1; i >= 0; i--) {
      var h = hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }
  function press(cx, cy) {
    var hit = hitAt(cx, cy);
    if (hit && hit.fn) hit.fn();
  }

  if (inWeChat) {
    wx.onTouchStart(function (event) {
      var touch = event.touches && event.touches[0];
      if (touch) {
        var hit = hitAt(touch.clientX, touch.clientY);
        touchPreviewHit = null;
        touchCopyHit = null;
        panelDragY = (app.sentencesOpen || app.screen === 'compose' || app.screen === 'online-compose') ? touch.clientY : null;
        if (hit && hit.previewPath) {
          touchPreviewHit = hit;
          touchStartX = touch.clientX; touchStartY = touch.clientY;
        } else if (hit && hit.fn === copyRoomId) {
          touchCopyHit = hit;
          touchStartX = touch.clientX; touchStartY = touch.clientY;
        } else press(touch.clientX, touch.clientY);
      }
    });
    if (wx.onTouchMove) wx.onTouchMove(function (event) {
      var touch = event.touches && event.touches[0];
      if (touch && panelDragY !== null) {
        var dragDelta = touch.clientY - panelDragY;
        if (Math.abs(dragDelta) >= 8) {
          touchPreviewHit = null; touchCopyHit = null;
          if (app.sentencesOpen) app.sentenceScroll -= dragDelta;
          else if (app.screen === 'compose') app.memeScroll -= dragDelta;
          else if (app.screen === 'online-compose') app.memeScroll -= dragDelta;
          panelDragY = touch.clientY;
          draw();
        }
        return;
      }
      if (touch && touchPreviewHit && Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY) > 12) {
        touchPreviewHit = null;
      }
      if (touch && touchCopyHit && Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY) > 12) touchCopyHit = null;
    });
    if (wx.onTouchEnd) wx.onTouchEnd(function () {
      panelDragY = null;
      var tapped = touchPreviewHit;
      var copied = touchCopyHit;
      touchPreviewHit = null; touchCopyHit = null;
      if (tapped) {
        if (ANIMATIONS[tapped.previewPath]) previewAnimation(tapped.previewPath);
        if (tapped.fn) tapped.fn();
      }
      if (copied && copied.fn) copied.fn();
    });
    if (wx.onWindowResize) wx.onWindowResize(function () { windowInfo = null; draw(); });
    if (wx.onHide) wx.onHide(hideGame);
    if (wx.onMemoryWarning) wx.onMemoryWarning(function () {
      previewAnimation(''); pausedAnimation = ''; trimImages(true); if (CUSTOM) CUSTOM.release();
      if (app.memeForm && app.memeForm.previewReady) {
        app.memeForm.preview = null; app.memeForm.status = '内存紧张，预览已暂停；仍可保存或重新选图';
        if (draftTicker !== null) clearInterval(draftTicker); draftTicker = null;
      }
      draw();
    });
    if (wx.onShow) wx.onShow(showGame);
  } else {
    canvas.addEventListener('pointerdown', function (event) {
      var hit = hitAt(event.clientX, event.clientY);
      if (hit && ANIMATIONS[hit.previewPath]) previewAnimation(hit.previewPath);
      if (hit && hit.fn) hit.fn();
    });
    window.addEventListener('wheel', function (event) {
      if (app.sentencesOpen) app.sentenceScroll += event.deltaY;
      else if (app.screen === 'compose') app.memeScroll += event.deltaY;
      else if (app.screen === 'online-compose') app.memeScroll += event.deltaY;
      else return;
      draw();
      event.preventDefault();
    }, {passive: false});
    window.addEventListener('resize', draw);
    if (document.addEventListener) document.addEventListener('visibilitychange', function () { if (document.hidden) hideGame(); else showGame(); });
    // Browser-only review hook: index.html?frame=table|compose|memes|online jumps straight into a screen.
    var frame = null;
    try { frame = new URLSearchParams(window.location.search).get('frame'); } catch (e) { frame = null; }
    if (frame && CORE && DECKS.length) {
      startGame();
      finishDiceIntro();
      confirmHandoff();
      if (frame === 'compose') {
        var reviewView = localView();
        app.selection = reviewView.round.hand.slice(0, 2).map(function (tile) { return tile.id; });
        openCompose();
      }
      if (frame === 'memes') {
        var memeView = localView();
        app.selection = memeView.round.hand.slice(0, 2).map(function (tile) { return tile.id; });
        app.chosen = MEMES.slice(0, 3).map(function (meme) { return meme.key; });
        openCompose();
      }
    }
    if (frame === 'online' && CORE) {
      var onlineTiles = '伤吓库尸裆笑你子詹摔无水疯牌'.split('').map(function (glyph, index) {
        return {id: 'review-tile-' + index, glyph: glyph};
      });
      app.online = {
        playerId: 'player-75811', status: '同 Wi-Fi 预览', view: {
          viewer_id: 'player-75811', players: ['east', 'south', 'west', 'north'],
          host_player_id: 'player-75811', controlled_players: ['east', 'west'], round_number: 1,
          config: {max_meme_images: 12},
          round: {
            phase: 'AWAIT_ACTION', active_player_id: 'east', dealer_id: 'east', wall_remaining: 83,
            hand_counts: {east: 14, south: 13, west: 13, north: 13},
            hand_by_player: {east: onlineTiles, west: onlineTiles.slice(0, 13)}, hand: onlineTiles,
            sentence_points: {east: 0, south: 0, west: 0, north: 0}, rating_bonus_thirds: {}, sentences: [{text: '詹库联手登顶总冠军'}, {text: '水花兄弟三分雨'}, {text: '伤兵满营'}, {text: '替补席站出来'}, {text: '绝杀时刻'}, {text: '防守赢得总冠军'}],
            pending_sentence: null, result: null
          }
        },
        command: function () { return false; },
        fail: function (message) { this.error = message; draw(); },
        setControlSeat: function () {}, close: function () {}, resume: function () {}, refreshRoom: function () { return Promise.resolve(); }
      };
      app.screen = 'online-table';
      if (frame === 'online' && new URLSearchParams(window.location.search).get('panel') === '1') app.sentencesOpen = true;
    }
  }
  if (CUSTOM) {
    CUSTOM.onChange(function () { refreshCustomAnimations(); rankKey = null; draw(); });
    CUSTOM.initialise().then(function () { refreshCustomAnimations(); draw(); }).catch(function (e) { app.memeNotice = e.message; draw(); });
  }
  draw();
})();
