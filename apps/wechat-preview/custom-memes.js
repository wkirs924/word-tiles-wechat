(function (root, factory) {
  var codec = root.WordTilesGif;
  if (!codec && typeof require === 'function') codec = require('./gif-codec.js');
  var api = factory(root, codec); root.WordTilesCustomMemes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis, function (root, codec) {
  'use strict';
  var isWx = typeof wx !== 'undefined' && !!wx.getFileSystemManager;
  var MAX_FILE = 2 * 1024 * 1024, MAX_BYTES = 20 * 1024 * 1024, MAX_ITEMS = 50;
  var fs = isWx ? wx.getFileSystemManager() : null;
  var base = isWx ? wx.env.USER_DATA_PATH + '/word-tiles-memes-v1' : '';
  var own = {}, room = {}, posters = {}, animated = {}, dbPromise = null, listeners = [], generation = 0;
  var ioQueue = Promise.resolve();
  function changed() { listeners.forEach(function (fn) { fn(); }); }
  function error(message) { throw new Error(message); }
  function utf8(text) {
    var encoded = encodeURIComponent(text), bytes = [];
    for (var i = 0; i < encoded.length; i++) {
      if (encoded[i] === '%') { bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16)); i += 2; }
      else bytes.push(encoded.charCodeAt(i));
    }
    return new Uint8Array(bytes);
  }
  // SHA-256 addresses immutable files and metadata. Received bytes are checked
  // against the same address before they enter the room's resource whitelist.
  function digest(input) {
    var bytes = new Uint8Array(input), words = [], h = [], k = [], composite = {}, prime = 2, i, j;
    while (k.length < 64) {
      if (!composite[prime]) {
        if (h.length < 8) h.push((Math.sqrt(prime) * 4294967296) | 0);
        k.push((Math.pow(prime, 1 / 3) * 4294967296) | 0);
        for (j = prime * prime; j < 400; j += prime) composite[j] = true;
      }
      prime++;
    }
    for (i = 0; i < bytes.length; i++) words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << (24 - (i & 3) * 8));
    words[bytes.length >> 2] = (words[bytes.length >> 2] || 0) | (128 << (24 - (bytes.length & 3) * 8));
    var blocks = Math.ceil((bytes.length + 9) / 64); words[blocks * 16 - 1] = bytes.length * 8;
    function r(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (i = 0; i < blocks * 16; i += 16) {
      var w = [], state = h.slice();
      for (j = 0; j < 64; j++) {
        if (j < 16) w[j] = words[i + j] || 0;
        else { var a = w[j - 15], b = w[j - 2]; w[j] = (w[j - 16] + (r(a, 7) ^ r(a, 18) ^ (a >>> 3)) + w[j - 7] + (r(b, 17) ^ r(b, 19) ^ (b >>> 10))) | 0; }
        var t1 = (state[7] + (r(state[4], 6) ^ r(state[4], 11) ^ r(state[4], 25)) + ((state[4] & state[5]) ^ (~state[4] & state[6])) + k[j] + w[j]) | 0;
        var t2 = ((r(state[0], 2) ^ r(state[0], 13) ^ r(state[0], 22)) + ((state[0] & state[1]) ^ (state[0] & state[2]) ^ (state[1] & state[2]))) | 0;
        state = [(t1 + t2) | 0, state[0], state[1], state[2], (state[3] + t1) | 0, state[4], state[5], state[6]];
      }
      for (j = 0; j < 8; j++) h[j] = (h[j] + state[j]) | 0;
    }
    return h.map(function (v) { return ('00000000' + (v >>> 0).toString(16)).slice(-8); }).join('');
  }
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function encode(input) {
    var bytes = new Uint8Array(input), out = [];
    for (var i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out.push(alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + (i + 1 < bytes.length ? alphabet[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? alphabet[n & 63] : '='));
    }
    return out.join('');
  }
  function decode(text) {
    if (typeof text !== 'string' || text.length > Math.ceil(MAX_FILE / 3) * 4 || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) error('表情数据无效');
    var size = text.length / 4 * 3 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0), bytes = new Uint8Array(size), offset = 0;
    for (var i = 0; i < text.length; i += 4) {
      var n = (alphabet.indexOf(text[i]) << 18) | (alphabet.indexOf(text[i + 1]) << 12) |
        (Math.max(0, alphabet.indexOf(text[i + 2])) << 6) | Math.max(0, alphabet.indexOf(text[i + 3]));
      if (offset < size) bytes[offset++] = (n >> 16) & 255;
      if (offset < size) bytes[offset++] = (n >> 8) & 255;
      if (offset < size) bytes[offset++] = n & 255;
    }
    return bytes;
  }
  function keywords(text) {
    var values = String(text || '').split(/[\s,，、;；]+/).filter(Boolean), unique = [];
    values.forEach(function (v) { if (unique.indexOf(v) < 0) unique.push(v); });
    if (!unique.length || unique.length > 5 || unique.some(function (v) { return Array.from(v).length > 12; })) error('请填写 1–5 个关键词，每个最多 12 字');
    return unique;
  }
  function info(input) {
    var b = new Uint8Array(input), width = 0, height = 0, format = '', frames = 1, duration = 0;
    if (b.length < 16 || b.length > MAX_FILE) error('图片大小须在 16 B–2 MB 之间');
    if (b[0] === 71 && b[1] === 73 && b[2] === 70) {
      var gif = codec.inspect(b); width = gif.width; height = gif.height; format = 'gif'; frames = gif.frames.length; duration = gif.duration;
    } else if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71 && b[4] === 13 && b[5] === 10 && b[6] === 26 && b[7] === 10 && b.length >= 33 &&
        b[12] === 73 && b[13] === 72 && b[14] === 68 && b[15] === 82) {
      var view = new DataView(b.buffer, b.byteOffset, b.byteLength); width = view.getUint32(16); height = view.getUint32(20); format = 'png';
    } else if (b[0] === 255 && b[1] === 216) {
      var at = 2;
      while (at < b.length) {
        if (b[at++] !== 255) break;
        while (b[at] === 255) at++;
        var marker = b[at++]; if (marker === 217 || marker === 218) break;
        if (marker === 1 || marker >= 208 && marker <= 215) continue;
        var len = (b[at] << 8) | b[at + 1]; if (len < 2 || at + len > b.length) break;
        if (marker >= 192 && marker <= 195 || marker >= 197 && marker <= 199 || marker >= 201 && marker <= 203 || marker >= 205 && marker <= 207) {
          if (len < 8) break;
          height = (b[at + 3] << 8) | b[at + 4]; width = (b[at + 5] << 8) | b[at + 6]; format = 'jpg'; break;
        }
        at += len;
      }
    }
    if (!format) error('仅支持原始 GIF、JPG 和 PNG 图片');
    if (!width || !height || width > 1024 || height > 1024) error('图片宽高不能超过 1024 像素，请缩小后添加');
    return {format: format, size: b.length, width: width, height: height, frames: frames, duration: duration};
  }
  function wire(meta) {
    return {key: meta.key, title: meta.title, keywords: meta.keywords.slice(), format: meta.format,
      size: meta.size, width: meta.width, height: meta.height, frames: meta.frames, duration: meta.duration};
  }
  function validMeta(meta) {
    var fields = ['key', 'title', 'keywords', 'format', 'size', 'width', 'height', 'frames', 'duration'];
    return !!meta && typeof meta === 'object' && !Array.isArray(meta) && Object.keys(meta).length === fields.length &&
      Object.keys(meta).every(function (k) { return fields.indexOf(k) >= 0; }) && /^meme\.user\.[a-f0-9]{64}$/.test(meta.key) &&
      typeof meta.title === 'string' && meta.title === meta.title.trim() && Array.from(meta.title).length >= 1 && Array.from(meta.title).length <= 24 &&
      Array.isArray(meta.keywords) && meta.keywords.length >= 1 && meta.keywords.length <= 5 &&
      meta.keywords.every(function (k, i) { return typeof k === 'string' && k === k.trim() && k.length && Array.from(k).length <= 12 && !/[\s,，、;；]/.test(k) && meta.keywords.indexOf(k) === i; }) &&
      ['gif', 'png', 'jpg'].indexOf(meta.format) >= 0 && Number.isSafeInteger(meta.size) && meta.size >= 16 && meta.size <= MAX_FILE &&
      Number.isInteger(meta.width) && meta.width > 0 && meta.width <= 1024 && Number.isInteger(meta.height) && meta.height > 0 && meta.height <= 1024 &&
      Number.isInteger(meta.frames) && meta.frames > 0 && meta.frames <= 300 && Number.isInteger(meta.duration) && meta.duration >= 0 && meta.duration <= 30000;
  }
  function address(bytes, title, tags) { return 'meme.user.' + digest(utf8(JSON.stringify([digest(bytes), title, tags]))); }
  function serial(task) { var next = ioQueue.then(task); ioQueue = next.catch(function () {}); return next; }
  function fsCall(method, options) {
    return new Promise(function (resolve, reject) {
      options.success = resolve; options.fail = function (e) { reject(new Error(e.errMsg || '本地表情存储失败')); };
      fs[method](options);
    });
  }
  function database() {
    if (!dbPromise) dbPromise = new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('当前浏览器无法保存表情，请使用微信或支持本地存储的浏览器')); return; }
      var request = root.indexedDB.open('word-tiles-memes-v1', 1);
      request.onupgradeneeded = function () { request.result.createObjectStore('assets', {keyPath: 'key'}); };
      request.onerror = function () { reject(new Error('无法打开本地表情库')); };
      request.onsuccess = function () { resolve(request.result); };
    });
    return dbPromise;
  }
  function dbOp(mode, action) {
    return database().then(function (db) { return new Promise(function (resolve, reject) {
      var tx = db.transaction('assets', mode), request = action(tx.objectStore('assets'));
      tx.oncomplete = function () { resolve(request && request.result); };
      tx.onerror = tx.onabort = function () { reject(new Error('本地表情库保存失败，可能空间不足')); };
    }); });
  }
  function entry(key) { return own[key] || room[key]; }
  function read(key) {
    var meta = entry(key); if (!meta) return Promise.reject(new Error('表情文件已丢失，请重新添加'));
    return isWx ? fsCall('readFile', {filePath: meta.file}).then(function (r) { return new Uint8Array(r.data); }) :
      dbOp('readonly', function (store) { return store.get(key); }).then(function (r) { if (!r) error('表情文件已丢失'); return new Uint8Array(r.bytes); });
  }
  function makeCanvas(width, height) {
    var canvas = isWx ? (wx.createOffscreenCanvas ? wx.createOffscreenCanvas({type: '2d', width: width, height: height}) : wx.createCanvas()) : document.createElement('canvas');
    canvas.width = width; canvas.height = height; return canvas;
  }
  function surface(decoded) {
    var columns = Math.min(4, decoded.frames.length), rows = Math.ceil(decoded.frames.length / columns);
    var canvas = makeCanvas(decoded.width * columns, decoded.height * rows), ctx = canvas.getContext('2d');
    decoded.frames.forEach(function (rgba, i) {
      var data = ctx.createImageData(decoded.width, decoded.height); data.data.set(rgba);
      ctx.putImageData(data, i % columns * decoded.width, Math.floor(i / columns) * decoded.height);
    });
    return {canvas: canvas, width: decoded.width, height: decoded.height, columns: columns, frames: decoded.frames.length, frame_ms: decoded.frame_ms};
  }
  function nativeImage(bytes, meta, path) {
    return new Promise(function (resolve, reject) {
      var image = isWx ? wx.createImage() : new Image(), url = isWx ? path : URL.createObjectURL(new Blob([bytes], {type: 'image/' + (meta.format === 'jpg' ? 'jpeg' : meta.format)}));
      function cleanup() { image.onload = null; image.onerror = null; if (!isWx) URL.revokeObjectURL(url); }
      image.onload = function () {
        cleanup();
        if (!image.width || !image.height || image.width > 1024 || image.height > 1024) { reject(new Error('图片宽高超出限制')); return; }
        var ratio = Math.min(1, 256 / Math.max(image.width, image.height)), w = Math.max(1, Math.round(image.width * ratio)), h = Math.max(1, Math.round(image.height * ratio));
        var canvas = makeCanvas(w, h); canvas.getContext('2d').drawImage(image, 0, 0, w, h);
        resolve({canvas: canvas, width: w, height: h, columns: 1, frames: 1, frame_ms: 100});
      };
      image.onerror = function () { cleanup(); reject(new Error('图片无法解码，请重新选择')); }; image.src = url;
    });
  }
  function validate(bytes, meta) {
    var actual = info(bytes);
    if (meta) {
      if (!validMeta(meta) || Object.keys(actual).some(function (k) { return actual[k] !== meta[k]; }) || address(bytes, meta.title, meta.keywords) !== meta.key) error('表情校验失败，请重新添加');
    }
    return actual;
  }
  function total(map) { return Object.keys(map).reduce(function (n, k) { return n + map[k].size; }, 0); }
  function persistOwn(exclude) {
    var manifest = Object.keys(own).filter(function (k) { return k !== exclude; }).map(function (k) { return wire(own[k]); });
    return fsCall('writeFile', {filePath: base + '/mine.json.part', data: JSON.stringify(manifest), encoding: 'utf8'})
      .then(function () { return fsCall('rename', {oldPath: base + '/mine.json.part', newPath: base + '/mine.json'}); });
  }
  function save(bytes, meta, personal, sourcePath) {
    var token = generation;
    return serial(function () {
      if (!personal && token !== generation) error('房间已退出');
      var actual = validate(bytes, meta), target = personal ? own : room;
      if (target[meta.key]) return target[meta.key];
      if (!target[meta.key] && (Object.keys(target).length >= (personal ? MAX_ITEMS : 24) || total(target) + bytes.length > MAX_BYTES)) error(personal ? '我的表情已满（50 张 / 20 MB），请先删除一些' : '房间表情已满（24 张 / 20 MB）');
      var check = actual.format === 'gif' ? codec.decode(bytes, false).then(function () {}) : Promise.resolve();
      return check.then(function () {
        var local = Object.assign({}, meta, {personal: personal});
        if (isWx) {
          local.file = base + '/' + (personal ? 'mine' : 'room') + '/' + meta.key + '.' + meta.format;
          var temporary = local.file + '.part.' + meta.format;
          return fsCall('writeFile', {filePath: temporary, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)})
            .then(function () { return actual.format === 'gif' ? null : nativeImage(bytes, actual, temporary); })
            .then(function () { return fsCall('rename', {oldPath: temporary, newPath: local.file}); })
            .then(function () { return local; });
        }
        return (actual.format === 'gif' ? Promise.resolve() : nativeImage(bytes, actual)).then(function () {
          return dbOp('readwrite', function (store) { return store.put({key: meta.key, meta: wire(meta), bytes: bytes.slice().buffer, personal: personal || !!own[meta.key]}); });
        }).then(function () { return local; });
      }).then(function (local) {
        if (!personal && token !== generation) { if (isWx) fsCall('unlink', {filePath: local.file}).catch(function () {}); error('房间已退出'); }
        target[local.key] = local;
        if (personal && isWx) {
          return persistOwn()
            .then(function () { changed(); return local; }).catch(function (e) { delete target[local.key]; throw e; });
        }
        changed(); return local;
      });
    });
  }
  function init() {
    if (isWx) {
      try {
        [base, base + '/mine', base + '/room'].forEach(function (path) {
          try { fs.mkdirSync(path, true); } catch (e) { fs.accessSync(path); }
        });
        // Room files have no persistence guarantee and are never added to My Memes.
        fs.readdirSync(base + '/room').forEach(function (name) { if (/^meme\.user\.[a-f0-9]{64}\.(gif|png|jpg)(\.part\.(gif|png|jpg))?$/.test(name)) try { fs.unlinkSync(base + '/room/' + name); } catch (e) {} });
        var list = []; try { list = JSON.parse(fs.readFileSync(base + '/mine.json', 'utf8')); } catch (e) {}
        if (Array.isArray(list)) list.slice(0, MAX_ITEMS).forEach(function (m) {
          if (!validMeta(m) || total(own) + m.size > MAX_BYTES) return;
          var file = base + '/mine/' + m.key + '.' + m.format;
          try { fs.accessSync(file); own[m.key] = Object.assign({}, m, {file: file, personal: true}); } catch (e) {}
        });
        fs.readdirSync(base + '/mine').forEach(function (name) {
          var match = /^(meme\.user\.[a-f0-9]{64})\.(gif|png|jpg)(\.part\.(gif|png|jpg))?$/.exec(name);
          if (match && (!own[match[1]] || match[3])) try { fs.unlinkSync(base + '/mine/' + name); } catch (e) {}
        });
        changed(); return Promise.resolve();
      } catch (e) { return Promise.reject(new Error('无法建立本地表情库：' + (e.message || e.errMsg || e))); }
    }
    return dbOp('readonly', function (store) { return store.getAll(); }).then(function (list) {
      list.forEach(function (r) { if (r.personal && validMeta(r.meta) && Object.keys(own).length < MAX_ITEMS && total(own) + r.meta.size <= MAX_BYTES) own[r.key] = Object.assign({}, r.meta, {personal: true}); });
      return dbOp('readwrite', function (store) { list.forEach(function (r) { if (!r.personal) store.delete(r.key); }); });
    }).then(changed);
  }
  var ready = null;
  function initialise() { if (!ready) ready = init(); return ready; }
  function choose() {
    if (isWx) return new Promise(function (resolve, reject) {
      if (!wx.chooseImage) { reject(new Error('当前微信版本不支持相册选图')); return; }
      wx.chooseImage({count: 1, sourceType: ['album'], sizeType: ['original'], success: function (res) {
        var path = res.tempFilePaths && res.tempFilePaths[0]; if (!path) { reject(new Error('没有选到图片')); return; }
        var file = res.tempFiles && res.tempFiles[0]; if (file && file.size > MAX_FILE) { reject(new Error('图片不能超过 2 MB')); return; }
        fsCall('getFileInfo', {filePath: path}).then(function (r) { if (r.size > MAX_FILE) error('图片不能超过 2 MB'); return fsCall('readFile', {filePath: path}); })
          .then(function (r) { var bytes = new Uint8Array(r.data); resolve({bytes: bytes, info: info(bytes), path: path}); }).catch(reject);
      }, fail: function (e) { reject(new Error(/cancel/.test(e.errMsg || '') ? '已取消选图' : e.errMsg || '选图失败')); }});
    });
    return new Promise(function (resolve, reject) {
      var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/gif,image/png,image/jpeg'; input.style.display = 'none'; document.body.appendChild(input);
      function cleanup() { input.remove(); }
      input.oncancel = function () { cleanup(); reject(new Error('已取消选图')); };
      input.onchange = function () {
        var file = input.files[0]; cleanup(); if (!file) { reject(new Error('已取消选图')); return; }
        if (file.size > MAX_FILE) { reject(new Error('图片不能超过 2 MB')); return; }
        file.arrayBuffer().then(function (buffer) { var bytes = new Uint8Array(buffer); resolve({bytes: bytes, info: info(bytes)}); }).catch(reject);
      }; input.click();
    });
  }
  function add(selected, title, words) {
    title = String(title || '').trim(); if (!title || Array.from(title).length > 24) return Promise.reject(new Error('表情名称须为 1–24 字'));
    var tags, meta;
    try { tags = keywords(words); meta = Object.assign({key: address(selected.bytes, title, tags), title: title, keywords: tags}, info(selected.bytes)); } catch (e) { return Promise.reject(e); }
    return initialise().then(function () { return save(selected.bytes, meta, true, selected.path); });
  }
  function descriptor(meta) { return Object.assign(wire(meta), {path: 'custom://' + meta.key, kind: 'meme', usage: meta.format === 'gif' ? '自定义动图' : '自定义表情', personal: !!own[meta.key]}); }
  function list() { var combined = Object.assign({}, room, own); return Object.keys(combined).map(function (k) { return descriptor(combined[k]); }); }
  function image(key, animate) {
    var cache = animate ? animated : posters, slot = cache[key];
    if (!slot) {
      if (!animate) { var names = Object.keys(posters); if (names.length >= 16) delete posters[names[0]]; }
      slot = cache[key] = {key: key, state: null};
    }
    if (slot.state === null) {
      slot.state = 'loading'; var meta = entry(key), token = generation;
      function live() { return token === generation && (animate ? animated : posters)[key] === slot; }
      read(key).then(function (bytes) {
        if (!live()) return null;
        if (!meta) error('表情不存在');
        return meta.format === 'gif' ? codec.decode(bytes, !animate).then(function (decoded) {
          return live() ? surface(decoded) : null;
        }) : nativeImage(bytes, meta, meta.file);
      }).then(function (result) { if (!live()) return; slot.value = result; slot.state = 'ready'; changed(); })
        .catch(function (e) { if (!live()) return; slot.state = 'failed'; slot.error = e.message; changed(); });
    }
    return slot;
  }
  function clearRoom() {
    generation++; animated = {}; posters = {}; var old = room; room = {}; changed();
    return serial(function () {
      if (isWx) return Promise.all(Object.keys(old).map(function (key) { return fsCall('unlink', {filePath: old[key].file}).catch(function () {}); }));
      return dbOp('readwrite', function (store) { Object.keys(old).forEach(function (key) { if (!own[key]) store.delete(key); }); });
    });
  }
  function remove(key) {
    return serial(function () {
      var meta = own[key]; if (!meta) return;
      // A room copy remains valid until the room closes; removing a private copy
      // must never invalidate sentences that are already in the authoritative log.
      var preserve = room[key] && room[key].file === meta.file;
      return (isWx ? persistOwn(key).then(function () { return preserve ? null : fsCall('unlink', {filePath: meta.file}).catch(function () {}); }) : dbOp('readonly', function (store) { return store.get(key); }).then(function (record) {
        return dbOp('readwrite', function (store) { if (room[key] && record) { record.personal = false; return store.put(record); } return store.delete(key); });
      }))
        .then(function () {
          delete own[key]; delete posters[key]; if (!room[key]) delete animated[key];
        }).then(changed);
    });
  }
  return {initialise: initialise, choose: choose, add: add, list: list, get: entry, wire: wire, validMeta: validMeta,
    read: read, receive: function (meta, bytes) {
      var token = generation;
      return initialise().then(function () { if (token !== generation) error('房间已退出'); return save(bytes, meta, false); });
    },
    preview: function (selected) { return selected.info.format === 'gif' ? codec.decode(selected.bytes, false).then(surface) : nativeImage(selected.bytes, selected.info, selected.path); },
    clearRoom: clearRoom, release: function (all) { animated = {}; if (all !== false) posters = {}; },
    releaseImage: function (key, animate) { delete (animate ? animated : posters)[key]; }, image: image,
    encode: encode, decode: decode, digest: digest, remove: remove, onChange: function (fn) { listeners.push(fn); }, limits: {file: MAX_FILE, bytes: MAX_BYTES, room: 24}};
});
