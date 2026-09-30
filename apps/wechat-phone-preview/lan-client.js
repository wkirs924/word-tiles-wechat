(function (root, factory) {
  var api = factory(root);
  root.WordTilesLan = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
  'use strict';
  var assetApi = root.WordTilesLanAssets, customStore = root.WordTilesCustomMemes;
  if (typeof require === 'function') {
    if (!assetApi) assetApi = require('./lan-assets.js');
    if (!customStore) customStore = require('./custom-memes.js');
  }
  var PORT = 18787, PART = 400, MAX_PARTS = 384, RETRY_MS = 800, RETRIES = 8;
  var SEATS = ['东', '南', '西', '北'];
  var ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function bytesToString(value) {
    if (typeof value === 'string') return value;
    var bytes = new Uint8Array(value), encoded = '';
    for (var i = 0; i < bytes.length; i++) encoded += '%' + ('0' + bytes[i].toString(16)).slice(-2);
    return decodeURIComponent(encoded);
  }
  function hex(value) {
    return Array.prototype.map.call(new Uint8Array(value), function (byte) { return ('0' + byte.toString(16)).slice(-2); }).join('');
  }
  function fallbackBytes(size) {
    var bytes = new Uint8Array(size);
    var cryptoApi = (typeof globalThis !== 'undefined' && globalThis.crypto) || root.crypto;
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      cryptoApi.getRandomValues(bytes); return bytes;
    }
    // LAN preview compatibility only: this is not a cryptographic identity source.
    var state = (Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0;
    for (var i = 0; i < size; i++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      bytes[i] = (state ^ Math.floor(Math.random() * 256) ^ (Date.now() >>> ((i % 4) * 8))) & 255;
    }
    return bytes;
  }
  function randomHex(size) {
    return new Promise(function (resolve) {
      if (!wx.getRandomValues) { resolve(hex(fallbackBytes(size))); return; }
      try {
        wx.getRandomValues({length: size, success: function (res) {
          resolve(hex(res && res.randomValues && new Uint8Array(res.randomValues).length === size ? res.randomValues : fallbackBytes(size)));
        }, fail: function () { resolve(hex(fallbackBytes(size))); }});
      } catch (e) { resolve(hex(fallbackBytes(size))); }
    });
  }
  function shortRoomCode(secret) {
    var value = parseInt(String(secret).slice(0, 8), 16);
    if (!Number.isFinite(value)) value = Date.now() >>> 0;
    var code = '';
    for (var i = 0; i < 6; i++) {
      code = ROOM_ALPHABET[value % ROOM_ALPHABET.length] + code;
      value = Math.floor(value / ROOM_ALPHABET.length);
    }
    return code;
  }
  function normaliseRoomCode(value) { return String(value || '').trim().toUpperCase(); }
  function localIp() {
    return new Promise(function (resolve, reject) {
      if (!wx.getLocalIPAddress) { reject(new Error('当前微信版本无法获取局域网 IP')); return; }
      wx.getLocalIPAddress({success: function (res) {
        if (!res || !validIp(res.localip)) reject(new Error('请连接 Wi-Fi 后重试'));
        else resolve(res.localip);
      }, fail: function () { reject(new Error('获取 Wi-Fi 地址失败')); }});
    });
  }
  function validIp(ip) {
    if (typeof ip !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return false;
    var parts = ip.split('.').map(Number);
    return parts.every(function (n) { return n >= 0 && n <= 255; }) &&
      (parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  }
  function parseInvite(value) {
    var short = normaliseRoomCode(value);
    if (/^[A-HJ-NP-Z2-9]{6}$/.test(short)) return {code: short, discovery: true};
    var match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})\/([a-f0-9]{16})$/.exec(value || '');
    if (!match || !validIp(match[1]) || +match[2] < 1 || +match[2] > 65535) throw new Error('房间号应为房主显示的 IP:端口/密钥');
    return {address: match[1], port: +match[2], secret: match[3]};
  }
  function endpoint(address, port) { return address + ':' + port; }
  function onlyKeys(value, allowed) { return Object.keys(value).every(function (key) { return allowed.indexOf(key) >= 0; }); }
  function Transport(port, receive, fail) {
    if (typeof wx === 'undefined' || !wx.createUDPSocket) throw new Error('当前微信版本不支持局域网 UDP');
    this.socket = wx.createUDPSocket(); this.receive = receive; this.fail = fail;
    this.serial = 0; this.pending = {}; this.assembling = {}; this.seen = {}; this.closed = false;
    var self = this;
    this.socket.onMessage(function (event) { self.incoming(event); });
    if (this.socket.onError) this.socket.onError(function (event) { self.fail(new Error(event && event.errMsg || 'UDP 通信失败')); });
    this.port = port ? this.socket.bind(port) : this.socket.bind();
    if (!this.port || this.port < 1) throw new Error('UDP 端口绑定失败');
  }
  Transport.prototype.raw = function (address, port, packet) {
    if (!this.closed) this.socket.send({address: address, port: port, message: JSON.stringify(packet)});
  };
  Transport.prototype.broadcast = function (port, body) {
    if (this.closed) return;
    var value = JSON.stringify(body);
    if (value.length > PART) { this.fail(new Error('房间发现包过大')); return; }
    this.socket.send({address: '255.255.255.255', port: port,
      message: JSON.stringify({v: 1, id: this.port + '-discover-' + Date.now(), part: 0, total: 1, data: value}), setBroadcast: true});
  };
  Transport.prototype.send = function (address, port, body) {
    if (this.closed) return;
    var value = JSON.stringify(body), count = Math.ceil(value.length / PART);
    if (!count || count > MAX_PARTS) { this.fail(new Error('状态包过大')); return; }
    var id = this.port + '-' + (++this.serial) + '-' + Date.now();
    var packets = [];
    for (var i = 0; i < count; i++) packets.push({v: 1, id: id, part: i, total: count, data: value.slice(i * PART, (i + 1) * PART)});
    var self = this, key = endpoint(address, port) + '/' + id;
    var pending = {tries: 0, timer: null}; this.pending[key] = pending;
    function transmit() {
      if (self.closed || !self.pending[key]) return;
      if (++pending.tries > RETRIES) { delete self.pending[key]; self.fail(new Error('对方未应答，请检查同一 Wi-Fi')); return; }
      packets.forEach(function (packet) { self.raw(address, port, packet); });
      pending.timer = setTimeout(transmit, RETRY_MS);
    }
    transmit();
  };
  Transport.prototype.incoming = function (event) {
    if (this.closed || !event || !event.remoteInfo) return;
    var address = event.remoteInfo.address, port = event.remoteInfo.port;
    if (typeof address !== 'string' || !Number.isInteger(port) || port < 1 || port > 65535) return;
    var packet;
    try { packet = JSON.parse(bytesToString(event.message)); } catch (e) { return; }
    if (!packet || packet.v !== 1 || typeof packet.id !== 'string' || packet.id.length > 80) return;
    var key = endpoint(address, port) + '/' + packet.id;
    if (packet.ack === true) {
      var pending = this.pending[key];
      if (pending) { clearTimeout(pending.timer); delete this.pending[key]; }
      return;
    }
    if (!Number.isInteger(packet.part) || !Number.isInteger(packet.total) || packet.total < 1 || packet.total > MAX_PARTS ||
        packet.part < 0 || packet.part >= packet.total || typeof packet.data !== 'string' || packet.data.length > PART) return;
    if (this.seen[key]) { this.raw(address, port, {v: 1, id: packet.id, ack: true}); return; }
    var current = this.assembling[key];
    if (!current) {
      var incomingKeys = Object.keys(this.assembling), expiry = Date.now() - 30000;
      for (var ik = 0; ik < incomingKeys.length; ik++) if (this.assembling[incomingKeys[ik]].at < expiry) delete this.assembling[incomingKeys[ik]];
      if (Object.keys(this.assembling).length >= 16) return;
      current = {total: packet.total, parts: [], count: 0, at: Date.now()}; this.assembling[key] = current;
    }
    if (current.total !== packet.total) return;
    if (current.parts[packet.part] === undefined) { current.parts[packet.part] = packet.data; current.count++; }
    if (current.count !== current.total) return;
    delete this.assembling[key]; this.seen[key] = Date.now();
    this.raw(address, port, {v: 1, id: packet.id, ack: true});
    var body;
    try { body = JSON.parse(current.parts.join('')); } catch (e) { return; }
    this.receive(body, address, port);
    if (Object.keys(this.seen).length > 300) {
      var cutoff = Date.now() - 30000;
      for (var old in this.seen) if (this.seen[old] < cutoff) delete this.seen[old];
      for (var stale in this.assembling) if (this.assembling[stale].at < cutoff) delete this.assembling[stale];
    }
  };
  Transport.prototype.close = function () {
    this.closed = true;
    for (var key in this.pending) clearTimeout(this.pending[key].timer);
    this.pending = {}; this.socket.close();
  };

  function Client(onChange) {
    this.onChange = onChange || function () {};
    this.playerId = ''; this.roomId = ''; this.room = null; this.view = null;
    this.connected = false; this.authenticated = false; this.status = '未连接'; this.error = '';
    this.pendingCommand = null; this.commandSerial = 0; this.transport = null;
    this.host = false; this.hostRoom = null; this.hostPeers = {}; this.server = null; this.controlSeat = '';
    this.closed = false; this.lastSeen = 0;
    this.assets = assetApi && customStore ? new assetApi.Bridge(this, customStore) : null;
  }
  Client.prototype.update = function () { this.onChange(this); };
  Client.prototype.fail = function (error) { this.error = error && error.message ? error.message : String(error); this.update(); };
  Client.prototype.login = function (name) {
    if (!/^[A-Za-z0-9_-]{2,40}$/.test(name)) return Promise.reject(new Error('玩家代号需 2–40 位英文、数字、- 或 _'));
    this.playerId = name; this.update(); return Promise.resolve({player_id: name});
  };
  Client.prototype.create = function (presetId) {
    var self = this, core = root.WordTilesCore, content = root.__WORD_TILES_CONTENT__;
    if (!core || !content || !content.deck_presets.some(function (p) { return p.id === presetId; })) return Promise.reject(new Error('字库未加载'));
    return Promise.all([localIp(), randomHex(8)]).then(function (parts) {
      var code = shortRoomCode(parts[1]);
      self.transport = new Transport(PORT, function (body, address, port) { self.hostReceive(body, address, port); }, function (error) { self.fail(error); });
      self.roomId = code;
      self.roomCode = code;
      self.host = true; self.hostRoom = {room_id: self.roomId, host_player_id: self.playerId,
        room_code: code, players: [self.playerId], ready: {}, preset_id: presetId};
      self.hostRoom.ready[self.playerId] = false;
      self.server = {session: null, secret: parts[1], code: code, serial: 0, ledger: {}, tokens: {}};
      self.connected = true; self.authenticated = true; self.status = '房间已创建';
      self.publish(); return self.room;
    });
  };
  Client.prototype.join = function (invite) {
    var self = this, target = parseInvite(invite);
    this.roomId = target.code || String(invite || '').trim(); this.target = target.discovery ? null : target;
    this.discovering = !!target.discovery;
    this.storageKey = 'word_tiles_lan_' + invite + '_' + this.playerId;
    try { this.peerToken = wx.getStorageSync ? wx.getStorageSync(this.storageKey) || '' : ''; } catch (e) { this.peerToken = ''; }
    return new Promise(function (resolve, reject) {
      self.transport = new Transport(0, function (body, address, port) { self.guestReceive(body, address, port); }, function (error) { self.fail(error); });
      self.joinResolve = resolve; self.joinReject = reject;
      self.joinTimer = setTimeout(function () { self.joinResolve = null; self.joinReject = null; reject(new Error('连接房主超时，请检查同一 Wi-Fi')); }, 10000);
      if (target.discovery) self.transport.broadcast(PORT, {type: 'HELLO', room_code: self.roomId, player_id: self.playerId, token: self.peerToken});
      else self.transport.send(target.address, target.port, {type: 'HELLO', secret: target.secret, player_id: self.playerId, token: self.peerToken});
      self.status = '正在连接房主'; self.update();
    });
  };
  Client.prototype.connect = function () { this.update(); };
  Client.prototype.setRoom = function (room) {
    if (!room || room.room_id !== this.roomId || !Array.isArray(room.players)) return;
    if (room.custom_memes !== undefined) {
      if (!Array.isArray(room.custom_memes) || room.custom_memes.length > 24 || room.custom_memes.some(function (incoming) {
        if (!incoming || typeof incoming !== 'object') return true;
        var meta = Object.assign({}, incoming); delete meta.ready_players;
        return !customStore || !customStore.validMeta(meta) || !Array.isArray(incoming.ready_players) || incoming.ready_players.length > 4 ||
          incoming.ready_players.some(function (player) { return typeof player !== 'string' || room.players.indexOf(player) < 0; });
      })) return;
    }
    this.room = room; this.update();
  };
  Client.prototype.controlledSeats = function (controller) {
    if (this.server && this.server.controllerSeats && this.server.controllerSeats[controller]) return this.server.controllerSeats[controller].slice();
    if (this.room && this.room.controller_seats && this.room.controller_seats[controller]) return this.room.controller_seats[controller].slice();
    return [controller];
  };
  Client.prototype.setControlSeat = function (seat) { this.controlSeat = typeof seat === 'string' ? seat : ''; };
  Client.prototype.roomView = function (actor) {
    var s = this.server.session, r = this.hostRoom, core = root.WordTilesCore;
    var controlled = this.controlledSeats(actor);
    if (s) {
      var primary = controlled[0] && s.players.indexOf(controlled[0]) >= 0 ? controlled[0] : actor;
      var view = core.playerView(s, primary);
      view.room_id = r.room_id; view.ready = r.ready; view.viewer_id = actor; view.controller_id = actor; view.controlled_players = controlled.slice(); view.host_player_id = r.host_player_id;
      if (view.round && controlled.length > 1) {
        view.round.hand_by_player = {};
        for (var i = 0; i < controlled.length; i++) {
          var privateView = core.playerView(s, controlled[i]);
          if (privateView.round) view.round.hand_by_player[controlled[i]] = privateView.round.hand;
        }
        var active = view.round.active_player_id;
        view.round.hand = view.round.hand_by_player[active] || view.round.hand_by_player[controlled[0]] || [];
        view.round.controlled_players = controlled.slice();
        if (view.round.pending_sentence) {
          view.round.pending_sentence.has_voted_by_player = {};
          for (var j = 0; j < controlled.length; j++) view.round.pending_sentence.has_voted_by_player[controlled[j]] =
            Object.prototype.hasOwnProperty.call(s.round.pending.votes, controlled[j]);
        }
      }
      return view;
    }
    return {schema_version: 1, session_id: r.room_id, room_id: r.room_id, revision: 0,
      viewer_id: actor, controller_id: actor, controlled_players: controlled, players: r.players.slice(), host_player_id: r.host_player_id, ready: r.ready, round: null};
  };
  Client.prototype.publish = function () {
    if (!this.host || !this.hostRoom) return;
    var r = this.hostRoom;
    this.room = {room_id: r.room_id, room_code: r.room_code || r.room_id, host_player_id: r.host_player_id, players: r.players.slice(),
      controller_seats: r.controller_seats ? JSON.parse(JSON.stringify(r.controller_seats)) : undefined,
      ready: Object.assign({}, r.ready), preset_id: r.preset_id,
      custom_memes: this.assets ? this.assets.snapshot() : []};
    this.view = this.roomView(this.playerId); this.update();
    for (var key in this.hostPeers) {
      var peer = this.hostPeers[key];
      this.transport.send(peer.address, peer.port, {type: 'SYNC', room: this.room, view: this.roomView(peer.playerId)});
    }
  };
  Client.prototype.hostReceive = function (body, address, port) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    var key = endpoint(address, port), peer = this.hostPeers[key], self = this;
    if (body.type === 'HELLO') {
      var validRoom = body.room_code === this.server.code || body.secret === this.server.secret;
      if (!validRoom || !/^[A-Za-z0-9_-]{2,40}$/.test(body.player_id)) return;
      if (peer && peer.playerId !== body.player_id) return;
      var established = this.server.tokens[body.player_id];
      if (established && body.token !== established) {
        this.transport.send(address, port, {type: 'ERROR', error: '该玩家已入房，请使用原手机重连'}); return;
      }
      if (!peer) {
        if (!established && (this.hostRoom.players.length >= 4 || this.hostRoom.players.indexOf(body.player_id) >= 0 || this.server.session)) {
          this.transport.send(address, port, {type: 'ERROR', error: '房间已满或名字已被使用'}); return;
        }
        if (established) for (var oldKey in this.hostPeers) if (this.hostPeers[oldKey].playerId === body.player_id) delete this.hostPeers[oldKey];
        peer = {address: address, port: port, playerId: body.player_id}; this.hostPeers[key] = peer;
        if (!established) {
          this.hostRoom.players.push(body.player_id); this.hostRoom.ready[body.player_id] = false;
        }
      }
      var sendWelcome = function (token) {
        if (self.hostPeers[key] !== peer) return;
        if (!peer.assetHandshake) { if (self.assets) self.assets.rejoin(peer.playerId); peer.assetHandshake = true; }
        self.transport.send(address, port, {type: 'WELCOME', token: token, room: self.hostRoom, view: self.roomView(peer.playerId)});
        self.publish();
      };
      if (established) sendWelcome(established);
      else if (peer.tokenPromise) peer.tokenPromise.then(sendWelcome);
      else {
        peer.tokenPromise = randomHex(16).then(function (token) { self.server.tokens[peer.playerId] = token; return token; });
        peer.tokenPromise.then(sendWelcome).catch(function (error) { self.fail(error); });
      }
      return;
    }
    if (!peer) return; // The sender endpoint is the identity for this room.
    if (this.assets && typeof body.type === 'string' && body.type.indexOf('ASSET_') === 0) {
      this.assets.receive(body, address, port, peer.playerId); return;
    }
    if (body.type === 'RESUME') { this.transport.send(address, port, {type: 'SYNC', room: this.room, view: this.roomView(peer.playerId)}); return; }
    if (body.type === 'READY' && typeof body.ready === 'boolean') {
      this.hostRoom.ready[peer.playerId] = body.ready; this.publish(); return;
    }
    if (body.type === 'COMMAND') this.hostCommand(peer.playerId, body.command, function (receipt) {
      self.transport.send(address, port, {type: 'RECEIPT', receipt: receipt});
    });
  };
  Client.prototype.guestReceive = function (body, address, port) {
    if (!body || typeof body !== 'object') return;
    if (!this.target && this.discovering && (body.type === 'WELCOME' || body.type === 'ERROR') &&
        (body.type === 'ERROR' || body.room && body.room.room_id === this.roomId)) {
      this.target = {address: address, port: port}; this.discovering = false;
    }
    if (!this.target || address !== this.target.address || port !== this.target.port) return;
    this.lastSeen = Date.now();
    if (this.assets && typeof body.type === 'string' && body.type.indexOf('ASSET_') === 0) {
      this.assets.receive(body, address, port, this.room && this.room.host_player_id); return;
    }
    if (body.type === 'ERROR') { this.fail(body.error || '房主拒绝连接'); if (this.joinReject) { clearTimeout(this.joinTimer); this.joinReject(new Error(this.error)); this.joinReject = null; this.joinResolve = null; } return; }
    if (body.type === 'HOST_CLOSED') { this.connected = false; this.authenticated = false; this.status = '房主已离开'; this.update(); return; }
    if (body.type === 'WELCOME' || body.type === 'SYNC') {
      this.connected = true; this.status = '已连接房主'; this.error = '';
      if (body.type === 'WELCOME' && typeof body.token === 'string') {
        this.peerToken = body.token;
        try { if (wx.setStorageSync) wx.setStorageSync(this.storageKey, body.token); } catch (e) {}
      }
      this.authenticated = !!this.peerToken;
      this.setRoom(body.room);
      if (this.assets) this.assets.sync();
      if (body.view && body.view.viewer_id === this.playerId &&
          (!this.view || typeof body.view.revision === 'number' && body.view.revision >= this.view.revision)) this.view = body.view;
      if (this.joinResolve && this.authenticated) { clearTimeout(this.joinTimer); this.joinResolve(this.room); this.joinResolve = null; this.joinReject = null; }
      this.update(); return;
    }
    if (body.type === 'RECEIPT' && body.receipt) {
      if (this.pendingCommand && body.receipt.command_id === this.pendingCommand.command_id) this.pendingCommand = null;
      this.error = body.receipt.ok ? '' : (body.receipt.error || '操作未通过'); this.update();
    }
  };
  Client.prototype.hostCommand = function (actor, incoming, callback) {
    var self = this, r = this.hostRoom, s = this.server.session, core = root.WordTilesCore;
    if ((!s && (!incoming || incoming.type !== 'REQUEST_START_ROUND')) || !incoming || typeof incoming !== 'object' || incoming.room_id !== this.roomId ||
        typeof incoming.command_id !== 'string' || incoming.command_id.length > 128 ||
        typeof incoming.type !== 'string' || !incoming.payload || typeof incoming.payload !== 'object' || Array.isArray(incoming.payload) ||
        !onlyKeys(incoming, ['room_id', 'command_id', 'type', 'payload', 'round_id', 'turn_id', 'proposal_id', 'actor_id'])) {
      callback({command_id: incoming && incoming.command_id, ok: false, error: 'INVALID_COMMAND'}); return;
    }
    var actorSeats = self.controlledSeats(actor), actorSeat = incoming.actor_id || actor;
    if (actorSeats.indexOf(actorSeat) < 0) { callback({command_id: incoming.command_id, ok: false, error: 'INVALID_IDENTITY'}); return; }
    var ledgerKey = actor + '/' + incoming.command_id, fingerprint = JSON.stringify(incoming);
    var prior = this.server.ledger[ledgerKey];
    if (prior) {
      if (prior.fingerprint !== fingerprint) callback({command_id: incoming.command_id, ok: false, error: 'COMMAND_ID_REUSED'});
      else if (prior.receipt) callback(prior.receipt);
      else prior.callbacks.push(callback);
      return;
    }
    var entry = {fingerprint: fingerprint, receipt: null, callbacks: []};
    this.server.ledger[ledgerKey] = entry;
    var reply = function (receipt) {
      entry.receipt = receipt; callback(receipt);
      entry.callbacks.forEach(function (waiting) { waiting(receipt); }); entry.callbacks = [];
    };
    var type = incoming.type, allowed = ['REQUEST_START_ROUND', 'REQUEST_END_ROUND', 'DRAW_TILE', 'DISCARD_TILE', 'PROPOSE_SENTENCE', 'SUBMIT_VOTE'];
    if (allowed.indexOf(type) < 0) { reply({command_id: incoming.command_id, ok: false, error: 'INVALID_COMMAND'}); return; }
    var fields = type === 'REQUEST_START_ROUND' ? ['preset_id', 'allow_extra_round']
      : type === 'DISCARD_TILE' ? ['tile_id']
      : type === 'PROPOSE_SENTENCE' ? ['tile_ids', 'resource_keys']
      : type === 'SUBMIT_VOTE' ? ['approve', 'rating'] : [];
    if (!onlyKeys(incoming.payload, fields)) { reply({command_id: incoming.command_id, ok: false, error: 'INVALID_PAYLOAD'}); return; }
    if (type === 'REQUEST_START_ROUND') {
      if (actor !== r.host_player_id || r.players.length < 2 || r.players.length > 4 || r.players.some(function (p) { return r.ready[p] !== true; }) ||
          incoming.payload.preset_id !== r.preset_id ||
          (incoming.payload.allow_extra_round !== undefined && typeof incoming.payload.allow_extra_round !== 'boolean')) {
        reply({command_id: incoming.command_id, ok: false, error: 'PLAYERS_NOT_READY'}); return;
      }
      if (!self.server.session) {
        var virtual = r.players.length === 2;
        var sessionPlayers = virtual ? ['east', 'south', 'west', 'north'] : r.players.slice();
        var hostSeat = virtual ? 'east' : self.playerId;
        var controllerSeats = {};
        if (virtual) {
          controllerSeats[r.players[0]] = ['east', 'west']; controllerSeats[r.players[1]] = ['south', 'north'];
          r.controller_seats = controllerSeats; self.server.controllerSeats = controllerSeats; self.server.virtual = true; self.server.hostSeat = hostSeat;
        } else {
          for (var ci = 0; ci < r.players.length; ci++) controllerSeats[r.players[ci]] = [r.players[ci]];
          r.controller_seats = controllerSeats; self.server.controllerSeats = controllerSeats; self.server.hostSeat = hostSeat;
        }
        var playerCount = sessionPlayers.length;
        var created = core.createSession(self.roomId, sessionPlayers, hostSeat,
          Object.assign({}, core.defaults(), {planned_rounds: 1, player_count: playerCount,
            votes_required: Math.floor((playerCount - 1) / 2) + 1}));
        if (!created.ok) { reply({command_id: incoming.command_id, ok: false, error: created.error}); return; }
        self.server.session = created.state;
      }
      randomHex(4).then(function (entropy) {
        var preset = root.__WORD_TILES_CONTENT__.deck_presets.find(function (p) { return p.id === r.preset_id; });
        var tiles = core.expandDeck(preset.deck), seed = (parseInt(entropy, 16) % 2147483646) + 1;
        self.applyCore(self.server.hostSeat || actorSeat, {command_id: incoming.command_id, type: 'START_NEXT_ROUND',
          payload: {round_id: 'lan-' + (++self.server.serial), tiles: tiles, seed: seed,
            allow_extra_round: incoming.payload.allow_extra_round === true}}, reply);
      }).catch(function (error) { reply({command_id: incoming.command_id, ok: false, error: error.message}); });
      return;
    }
    var payload = {}, source = incoming.payload;
    if (type === 'DISCARD_TILE') payload.tile_id = source.tile_id;
    if (type === 'PROPOSE_SENTENCE') {
      var known = root.__WORD_TILES_CONTENT__.memes;
      if (!Array.isArray(source.resource_keys) || source.resource_keys.some(function (key) {
        return typeof key !== 'string' || (!known.some(function (meme) { return meme.key === key; }) && !(self.assets && Object.prototype.hasOwnProperty.call(self.assets.catalog, key)));
      })) { reply({command_id: incoming.command_id, ok: false, error: 'UNKNOWN_RESOURCE_KEY'}); return; }
      if (source.resource_keys.some(function (key) { return self.assets && self.assets.catalog[key] && !self.assets.isReady(key); })) {
        reply({command_id: incoming.command_id, ok: false, error: '表情尚在同步，请等所有玩家接收完成后再出句'}); return;
      }
      payload.tile_ids = source.tile_ids; payload.resource_keys = source.resource_keys;
    }
    if (type === 'SUBMIT_VOTE') { payload.approve = source.approve; payload.rating = source.rating; }
    var command = {command_id: incoming.command_id, type: type === 'REQUEST_END_ROUND' ? 'END_GAME' : type, payload: payload};
    if (incoming.round_id) command.round_id = incoming.round_id;
    if (incoming.turn_id !== undefined) command.turn_id = incoming.turn_id;
    if (incoming.proposal_id) command.proposal_id = incoming.proposal_id;
    this.applyCore(type === 'REQUEST_END_ROUND' ? (this.server.hostSeat || actorSeat) : actorSeat, command, reply);
  };
  Client.prototype.applyCore = function (actor, command, callback) {
    var step = root.WordTilesCore.reduceSession(this.server.session, command, actor);
    this.server.session = step.state; callback(step.receipt);
    if (step.receipt.ok && !step.duplicate) this.publish();
  };
  Client.prototype.ready = function (value) {
    if (this.host) { this.hostRoom.ready[this.playerId] = !!value; this.publish(); return Promise.resolve(this.room); }
    if (!this.transport || !this.connected) return Promise.reject(new Error('尚未连接房主'));
    this.transport.send(this.target.address, this.target.port, {type: 'READY', ready: !!value});
    return Promise.resolve(this.room);
  };
  Client.prototype.refreshRoom = function () {
    if (this.host) { this.publish(); return Promise.resolve(this.room); }
    if (!this.transport) return Promise.resolve(null);
    this.transport.send(this.target.address, this.target.port, {type: 'RESUME'});
    if (this.pendingCommand) this.transport.send(this.target.address, this.target.port, {type: 'COMMAND', command: this.pendingCommand});
    if (this.lastSeen && Date.now() - this.lastSeen > 10000) { this.connected = false; this.authenticated = false; this.status = '房主离线，请保持房主手机前台运行'; this.update(); }
    return Promise.resolve(this.room);
  };
  Client.prototype.command = function (type, payload) {
    if (!this.authenticated || !this.view) { this.fail('尚未连上对局'); return false; }
    if (this.pendingCommand) { this.fail('上一步还在确认中'); return false; }
    var round = this.view.round;
    var controlled = this.view.controlled_players || [this.playerId], actorSeat = this.playerId;
    if (controlled.length > 1 && round) {
      actorSeat = type === 'SUBMIT_VOTE' ? (this.controlSeat || controlled[0]) :
        (type === 'REQUEST_START_ROUND' || type === 'REQUEST_END_ROUND' ? (this.server && this.server.hostSeat || controlled[0]) : round.active_player_id);
      if (controlled.indexOf(actorSeat) < 0) { this.fail('当前轮到另一位操控者'); return false; }
    }
    var command = {room_id: this.roomId, command_id: this.playerId + '-' + Date.now() + '-' + (++this.commandSerial),
      type: type, payload: payload || {}, actor_id: actorSeat};
    if (round && type !== 'REQUEST_START_ROUND') {
      command.round_id = round.round_id;
      if (type === 'DRAW_TILE' || type === 'DISCARD_TILE' || type === 'PROPOSE_SENTENCE') command.turn_id = round.turn_id;
      if (type === 'SUBMIT_VOTE' && round.pending_sentence) command.proposal_id = round.pending_sentence.id;
    }
    this.pendingCommand = command;
    if (this.host) { var self = this; this.hostCommand(this.playerId, command, function (receipt) {
      self.pendingCommand = null; self.error = receipt.ok ? '' : receipt.error; self.update();
    }); }
    else this.transport.send(this.target.address, this.target.port, {type: 'COMMAND', command: command});
    return true;
  };
  Client.prototype.resume = function () { return this.refreshRoom(); };
  Client.prototype.shareMeme = function (key) { return this.assets ? this.assets.share(key) : Promise.reject(new Error('当前联机方式不支持自定义表情')); };
  Client.prototype.memeReady = function (key) { return this.assets && this.assets.isReady(key); };
  Client.prototype.close = function () {
    if (this.host && this.transport) for (var key in this.hostPeers) {
      var peer = this.hostPeers[key]; this.transport.send(peer.address, peer.port, {type: 'HOST_CLOSED'});
    }
    this.closed = true; this.connected = false; this.authenticated = false;
    if (this.assets) this.assets.close();
    if (this.joinTimer) clearTimeout(this.joinTimer);
    if (this.transport) this.transport.close(); this.transport = null; this.update();
  };
  return {Client: Client, Transport: Transport, parseInvite: parseInvite, validIp: validIp};
});
