(function (root, factory) {
  var api = factory(); root.WordTilesLanAssets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis, function () {
  'use strict';
  var CHUNK = 8192, RETRY = 1800, MAX_RETRIES = 8;
  function keys(body, allowed) { return Object.keys(body).every(function (k) { return allowed.indexOf(k) >= 0; }); }
  // File messages use the existing reliable transport, but one bounded block at
  // a time. Binary assets never enter game snapshots or reducer commands.
  function Bridge(client, store) {
    this.client = client; this.store = store; this.catalog = {}; this.ready = {}; this.sent = {};
    this.receiving = {}; this.transfers = {}; this.queues = {}; this.requested = {}; this.serial = 0; this.closed = false;
  }
  Bridge.prototype.send = function (address, port, body) {
    if (!this.closed && this.client.transport) this.client.transport.send(address, port, Object.assign({room_id: this.client.roomId}, body));
  };
  Bridge.prototype.snapshot = function () {
    var self = this;
    return Object.keys(this.catalog).map(function (key) { return Object.assign({}, self.store.wire(self.catalog[key]), {ready_players: Object.keys(self.ready[key] || {})}); });
  };
  Bridge.prototype.isReady = function (key) {
    var self = this, c = this.client;
    if (c.host) return !!this.catalog[key] && c.hostRoom.players.every(function (p) { return self.ready[key] && self.ready[key][p]; });
    var meta = (c.room && c.room.custom_memes || []).find(function (m) { return m.key === key; });
    return !!meta && Array.isArray(meta.ready_players) && c.room.players.every(function (p) { return meta.ready_players.indexOf(p) >= 0; });
  };
  Bridge.prototype.share = function (key) {
    var self = this, c = this.client, meta = this.store.get(key);
    if (this.closed || !c.connected || !c.authenticated) return Promise.reject(new Error('请先加入 Wi-Fi 房间'));
    if (!meta) return Promise.reject(new Error('表情文件不存在'));
    if (c.host && this.catalog[key]) return Promise.resolve();
    if (!c.host && (c.room.custom_memes || []).some(function (m) { return m.key === key; })) return Promise.resolve();
    return this.store.read(key).then(function (bytes) {
      if (self.closed) throw new Error('房间已退出');
      if (c.host) return self.register(self.store.wire(meta), bytes, c.playerId);
      return self.transfer(c.target.address, c.target.port, self.store.wire(meta), bytes);
    });
  };
  Bridge.prototype.register = function (meta, bytes, sender) {
    var self = this;
    var count = Object.keys(this.catalog).length;
    var total = Object.keys(this.catalog).reduce(function (n, key) { return n + self.catalog[key].size; }, 0);
    if (!this.catalog[meta.key] && (count >= this.store.limits.room || total + meta.size > this.store.limits.bytes)) return Promise.reject(new Error('房间表情库已满（24 张 / 20 MB）'));
    return this.store.receive(meta, bytes).then(function () {
      if (self.closed) throw new Error('房间已退出');
      self.catalog[meta.key] = meta; if (!self.ready[meta.key]) self.ready[meta.key] = {};
      self.ready[meta.key][self.client.playerId] = true; self.ready[meta.key][sender] = true;
      self.client.publish();
    });
  };
  Bridge.prototype.mark = function (key, player) {
    if (!this.catalog[key]) return;
    var ready = this.ready[key] || (this.ready[key] = {});
    if (!ready[player]) { ready[player] = true; this.client.publish(); }
  };
  Bridge.prototype.rejoin = function (player) {
    var self = this;
    Object.keys(this.ready).forEach(function (key) { delete self.ready[key][player]; });
  };
  Bridge.prototype.sync = function () {
    var self = this, c = this.client;
    (c.room && c.room.custom_memes || []).slice(0, this.store.limits.room).forEach(function (incoming) {
      var meta = Object.assign({}, incoming); delete meta.ready_players;
      if (!self.store.validMeta(meta)) return;
      if (self.store.get(meta.key)) {
        if (!incoming.ready_players || incoming.ready_players.indexOf(c.playerId) < 0) self.send(c.target.address, c.target.port, {type: 'ASSET_HAVE', key: meta.key});
      } else if (!self.requested[meta.key] || Date.now() - self.requested[meta.key] > 15000) {
        self.requested[meta.key] = Date.now(); self.send(c.target.address, c.target.port, {type: 'ASSET_GET', key: meta.key});
      }
    });
  };
  Bridge.prototype.transfer = function (address, port, meta, bytes) {
    var self = this;
    // Queue reads too: do not preload the entire library once per receiver.
    var previous = this.queues.files || Promise.resolve();
    var task = previous.catch(function () {}).then(function () {
      if (self.closed) throw new Error('房间已退出');
      return typeof bytes === 'function' ? bytes() : bytes;
    }).then(function (loaded) {
      if (self.closed) throw new Error('房间已退出');
      return new Promise(function (resolve, reject) {
        var data = self.store.encode(loaded), count = Math.ceil(data.length / CHUNK), id = 'asset-' + Date.now() + '-' + (++self.serial);
        var tx = {id: id, address: address, port: port, meta: meta, data: data, count: count, index: -1, tries: 0, timer: null, resolve: resolve, reject: reject};
        self.transfers[id] = tx; self.advance(tx);
      });
    });
    this.queues.files = task; return task;
  };
  Bridge.prototype.advance = function (tx) {
    var self = this; clearTimeout(tx.timer);
    if (this.closed || !this.transfers[tx.id]) return;
    if (++tx.tries > MAX_RETRIES) { delete this.transfers[tx.id]; tx.reject(new Error('表情同步超时，请保持双方手机在前台后重试')); return; }
    if (tx.index < 0) this.send(tx.address, tx.port, {type: 'ASSET_BEGIN', id: tx.id, meta: tx.meta, count: tx.count});
    else if (tx.index < tx.count) this.send(tx.address, tx.port, {type: 'ASSET_CHUNK', id: tx.id, index: tx.index, data: tx.data.slice(tx.index * CHUNK, (tx.index + 1) * CHUNK)});
    else this.send(tx.address, tx.port, {type: 'ASSET_END', id: tx.id});
    tx.timer = setTimeout(function () { self.advance(tx); }, RETRY);
  };
  Bridge.prototype.receive = function (body, address, port, player) {
    if (this.closed || body.room_id !== this.client.roomId || typeof body.type !== 'string' || body.type.indexOf('ASSET_') !== 0) return;
    var self = this, c = this.client, endpoint = address + ':' + port;
    function fail(id, message) { self.send(address, port, {type: 'ASSET_ERROR', id: id, error: message}); }
    if (body.type === 'ASSET_GET') {
      if (!c.host || !keys(body, ['type', 'room_id', 'key']) || typeof body.key !== 'string' || !/^meme\.user\.[a-f0-9]{64}$/.test(body.key) || !this.catalog[body.key] || this.sent[endpoint + '/' + body.key]) return;
      this.sent[endpoint + '/' + body.key] = true;
      this.transfer(address, port, this.store.wire(this.catalog[body.key]), function () { return self.store.read(body.key); })
        .then(function () { delete self.sent[endpoint + '/' + body.key]; if (!self.closed) self.mark(body.key, player); })
        .catch(function (e) { delete self.sent[endpoint + '/' + body.key]; if (!self.closed) c.fail(e); }); return;
    }
    if (body.type === 'ASSET_HAVE') {
      if (c.host && keys(body, ['type', 'room_id', 'key']) && typeof body.key === 'string' && /^meme\.user\.[a-f0-9]{64}$/.test(body.key) && this.catalog[body.key]) this.mark(body.key, player); return;
    }
    if (typeof body.id !== 'string' || !/^asset-\d+-\d+$/.test(body.id) || body.id.length > 80) return;
    var tx = this.transfers[body.id];
    if (body.type === 'ASSET_ACK' || body.type === 'ASSET_ERROR') {
      if (!tx || tx.address !== address || tx.port !== port) return;
      if (body.type === 'ASSET_ERROR') {
        if (!keys(body, ['type', 'room_id', 'id', 'error']) || typeof body.error !== 'string' || body.error.length > 200) return;
        clearTimeout(tx.timer); delete this.transfers[tx.id]; tx.reject(new Error(body.error)); return;
      }
      if (!keys(body, ['type', 'room_id', 'id', 'index']) || body.index !== tx.index) return;
      clearTimeout(tx.timer);
      if (tx.index === tx.count) { delete this.transfers[tx.id]; tx.resolve(); }
      else { tx.index++; tx.tries = 0; this.advance(tx); } return;
    }
    var id = endpoint + '/' + body.id, record = this.receiving[id], now = Date.now();
    Object.keys(this.receiving).forEach(function (key) {
      var r = self.receiving[key]; if (!r.saving && now - r.at > 30000) delete self.receiving[key];
    });
    function ack(index) { self.send(address, port, {type: 'ASSET_ACK', id: body.id, index: index}); }
    if (body.type === 'ASSET_BEGIN') {
      if (!keys(body, ['type', 'room_id', 'id', 'meta', 'count']) || !this.store.validMeta(body.meta) ||
          !Number.isInteger(body.count) || body.count !== Math.ceil(Math.ceil(body.meta.size / 3) * 4 / CHUNK)) { fail(body.id, '表情描述无效'); return; }
      if (!c.host && !(c.room.custom_memes || []).some(function (m) { return m.key === body.meta.key; })) { fail(body.id, '表情尚未登记'); return; }
      if (record) { if (JSON.stringify(record.meta) !== JSON.stringify(body.meta)) fail(body.id, '传输标识重复'); else ack(-1); return; }
      var pending = Object.keys(this.receiving).filter(function (key) { return !self.receiving[key].done; });
      if (pending.length >= 4 || pending.some(function (key) { return key.indexOf(endpoint + '/') === 0; })) { fail(body.id, '正在接收其他表情，请稍后重试'); return; }
      this.receiving[id] = {meta: body.meta, count: body.count, parts: [], next: 0, at: now, saving: false, done: false}; ack(-1); return;
    }
    if (!record) { fail(body.id, '表情传输已过期，请重试'); return; }
    record.at = now;
    if (body.type === 'ASSET_CHUNK') {
      if (!keys(body, ['type', 'room_id', 'id', 'index', 'data']) || !Number.isInteger(body.index) || body.index < 0 || body.index >= record.count ||
          typeof body.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data) || body.data.length !==
          (body.index === record.count - 1 ? Math.ceil(record.meta.size / 3) * 4 - body.index * CHUNK : CHUNK)) { fail(body.id, '表情分块无效'); return; }
      if (body.index > record.next) return;
      if (body.index === record.next) { record.parts.push(body.data); record.next++; }
      ack(body.index); return;
    }
    if (body.type === 'ASSET_END' && keys(body, ['type', 'room_id', 'id'])) {
      if (record.done) { ack(record.count); return; }
      if (record.saving) return;
      if (record.next !== record.count) { fail(body.id, '表情文件不完整'); return; }
      record.saving = true;
      Promise.resolve().then(function () {
        if (self.closed) throw new Error('房间已退出');
        var bytes = self.store.decode(record.parts.join('')); record.parts = [];
        if (bytes.length !== record.meta.size) throw new Error('表情文件大小不符');
        return c.host ? self.register(record.meta, bytes, player) : self.store.receive(record.meta, bytes);
      }).then(function () {
        if (self.closed) return;
        record.saving = false; record.done = true; ack(record.count);
        if (!c.host) { self.send(address, port, {type: 'ASSET_HAVE', key: record.meta.key}); c.update(); }
      }).catch(function (e) { delete self.receiving[id]; if (!self.closed) fail(body.id, String(e.message || e).slice(0, 200)); });
    }
  };
  Bridge.prototype.close = function () {
    this.closed = true;
    for (var id in this.transfers) { var tx = this.transfers[id]; clearTimeout(tx.timer); tx.reject(new Error('房间已退出')); }
    this.transfers = {}; this.receiving = {}; this.catalog = {}; this.ready = {}; this.queues = {};
  };
  return {Bridge: Bridge};
});
