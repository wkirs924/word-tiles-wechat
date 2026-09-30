(function (root, factory) {
  var api = factory();
  root.WordTilesNetwork = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';
  var isWx = typeof wx !== 'undefined' && typeof wx.request === 'function';
  var HTTP = 'http://127.0.0.1:8787';
  var WS = 'ws://127.0.0.1:8787/play';

  function request(method, url, token, body) {
    var headers = {'Content-Type': 'application/json'};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (isWx) return new Promise(function (resolve, reject) {
      wx.request({url: url, method: method, header: headers, data: body,
        success: function (res) { if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data); else reject(new Error((res.data && res.data.error) || 'HTTP_' + res.statusCode)); },
        fail: function (error) { reject(new Error(error.errMsg || 'NETWORK_FAILED')); }
      });
    });
    return fetch(url, {method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body)})
      .then(function (res) { return res.text().then(function (raw) {
        var data; try { data = raw ? JSON.parse(raw) : {}; } catch (e) { data = {}; }
        if (!res.ok) throw new Error(data.error || 'HTTP_' + res.status);
        return data;
      }); });
  }

  function Client(onChange) {
    this.onChange = onChange || function () {};
    this.token = ''; this.playerId = ''; this.roomId = ''; this.room = null; this.view = null;
    this.socket = null; this.connected = false; this.authenticated = false; this.status = '未连接'; this.error = '';
    this.closed = false; this.commandSerial = 0; this.retryTimer = null; this.pendingCommand = null;
  }
  Client.prototype.update = function () { this.onChange(this); };
  Client.prototype.fail = function (error) { this.error = error && error.message ? error.message : String(error); this.update(); };
  Client.prototype.login = function (playerId) {
    var self = this;
    return request('POST', HTTP + '/auth/local', '', {player_id: playerId}).then(function (data) {
      if (!data || typeof data.token !== 'string') throw new Error('AUTH_RESPONSE_INVALID');
      self.token = data.token; self.playerId = data.player_id; self.error = ''; self.update();
      return data;
    });
  };
  Client.prototype.create = function (presetId) {
    var self = this;
    return request('POST', HTTP + '/rooms', this.token, {preset_id: presetId}).then(function (room) { self.setRoom(room); return room; });
  };
  Client.prototype.join = function (roomId) {
    var self = this;
    return request('POST', HTTP + '/rooms/join', this.token, {room_id: roomId}).then(function (room) { self.setRoom(room); return room; });
  };
  Client.prototype.setRoom = function (room) {
    if (!room || typeof room.room_id !== 'string') throw new Error('ROOM_RESPONSE_INVALID');
    this.roomId = room.room_id; this.room = room; this.error = ''; this.update();
  };
  Client.prototype.refreshRoom = function () {
    var self = this;
    if (!this.roomId || !this.token) return Promise.resolve(null);
    return request('GET', HTTP + '/rooms/' + encodeURIComponent(this.roomId), this.token).then(function (room) { self.setRoom(room); return room; });
  };
  Client.prototype.ready = function (value) {
    var self = this;
    return request('POST', HTTP + '/rooms/' + encodeURIComponent(this.roomId) + '/ready', this.token, {ready: value})
      .then(function (room) { self.setRoom(room); return room; });
  };
  Client.prototype.sendFrame = function (frame) {
    if (!this.socket || !this.connected) return false;
    var message = JSON.stringify(frame);
    if (isWx) this.socket.send({data: message}); else this.socket.send(message);
    return true;
  };
  Client.prototype.receive = function (raw) {
    var frame;
    try { frame = JSON.parse(typeof raw === 'string' ? raw : raw.data); } catch (e) { this.fail('BAD_FRAME'); return; }
    if (!frame || typeof frame.type !== 'string') { this.fail('BAD_FRAME'); return; }
    if (frame.type === 'AUTH_OK') {
      this.authenticated = true; this.status = '已连接'; this.error = '';
      if (this.pendingCommand) this.sendFrame(this.pendingCommand);
    }
    if (frame.type === 'SNAPSHOT' || frame.type === 'STATE') {
      if (!frame.view || frame.view.viewer_id !== this.playerId) { this.fail('PRIVATE_VIEW_MISMATCH'); return; }
      if (!this.view || frame.view.revision >= this.view.revision) this.view = frame.view;
      this.status = '对局同步中'; this.error = '';
    }
    if (frame.type === 'ROOM' && frame.room) this.setRoom(frame.room);
    if (frame.type === 'RECEIPT' && frame.receipt) {
      if (this.pendingCommand && frame.receipt.command_id === this.pendingCommand.command.command_id) this.pendingCommand = null;
      this.error = frame.receipt.ok ? '' : (frame.receipt.error || 'COMMAND_REJECTED');
    }
    if (frame.type === 'ERROR') this.error = frame.error || 'SERVER_ERROR';
    this.update();
  };
  Client.prototype.connect = function () {
    var self = this;
    if (!this.token || !this.roomId || this.closed) return;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    var oldSocket = this.socket; this.socket = null;
    if (oldSocket) { try { oldSocket.close(); } catch (e) {} }
    this.connected = false; this.authenticated = false; this.status = '连接中'; this.update();
    var socket = isWx ? wx.connectSocket({url: WS}) : new WebSocket(WS);
    this.socket = socket;
    var open = function () { if (self.socket !== socket || self.closed) return; self.connected = true; self.status = '身份验证中'; self.sendFrame({type: 'AUTH', token: self.token, room_id: self.roomId}); self.update(); };
    var message = function (event) { if (self.socket === socket && !self.closed) self.receive(event.data); };
    var close = function () { if (self.socket !== socket || self.closed) return; self.connected = false; self.authenticated = false; self.status = '连接断开，正在重试'; self.update(); self.retryTimer = setTimeout(function () { self.connect(); }, 2000); };
    var error = function () { if (self.socket === socket && !self.closed) { self.error = 'SOCKET_ERROR'; self.update(); } };
    if (isWx) { socket.onOpen(open); socket.onMessage(message); socket.onClose(close); socket.onError(error); }
    else { socket.onopen = open; socket.onmessage = message; socket.onclose = close; socket.onerror = error; }
  };
  Client.prototype.command = function (type, payload) {
    if (!this.view || !this.authenticated) { this.fail('尚未连上对局'); return false; }
    if (this.pendingCommand) { this.fail('上一步还在确认中'); return false; }
    var round = this.view.round;
    var command = {protocol: 'word-tiles-wx/1', room_id: this.roomId,
      command_id: this.playerId + '-' + Date.now() + '-' + (++this.commandSerial), type: type, payload: payload || {}};
    if (round && type !== 'REQUEST_START_ROUND') {
      command.round_id = round.round_id;
      if (type === 'DRAW_TILE' || type === 'DISCARD_TILE' || type === 'PROPOSE_SENTENCE') command.turn_id = round.turn_id;
      if (type === 'SUBMIT_VOTE' && round.pending_sentence) command.proposal_id = round.pending_sentence.id;
    }
    var frame = {type: 'COMMAND', command: command};
    this.pendingCommand = frame;
    if (!this.sendFrame(frame)) { this.pendingCommand = null; this.fail('连接已断开'); return false; }
    return true;
  };
  Client.prototype.resume = function () { return this.sendFrame({type: 'RESUME'}); };
  Client.prototype.close = function () {
    this.closed = true; this.connected = false; this.authenticated = false; this.pendingCommand = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.socket) { try { this.socket.close(); } catch (e) {} }
    this.socket = null;
  };
  return {Client: Client};
});
