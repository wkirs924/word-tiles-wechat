/** Run against a LOCAL_MODE=1 server with Node 24+: four real HTTP/WS clients. */
import assert from 'node:assert/strict';

const base = (process.env.WORD_TILES_HTTP || 'http://127.0.0.1:8787').replace(/\/$/, '');
const socketUrl = base.replace(/^http/, 'ws') + '/play';
const suffix = Date.now().toString(36);
const ids = ['a', 'b', 'c', 'd'].map(letter => `smoke-${suffix}-${letter}`);

async function http(method, path, token, body) {
  const response = await fetch(base + path, {method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
    body: body === undefined ? undefined : JSON.stringify(body)});
  const data = await response.json();
  assert.equal(response.ok, true, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}

class Wire {
  constructor(id, token, roomId) {
    this.id = id; this.token = token; this.roomId = roomId;
    this.frames = []; this.waiters = [];
    this.socket = new WebSocket(socketUrl);
    this.socket.addEventListener('message', event => {
      const frame = JSON.parse(event.data);
      const waiterIndex = this.waiters.findIndex(waiter => waiter.match(frame));
      if (waiterIndex >= 0) {
        const waiter = this.waiters.splice(waiterIndex, 1)[0]; clearTimeout(waiter.timer); waiter.resolve(frame);
      } else this.frames.push(frame);
    });
  }
  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.id}: websocket open timeout`)), 5000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, {once: true});
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`${this.id}: websocket error`)); }, {once: true});
    });
    this.send({type: 'AUTH', token: this.token, room_id: this.roomId});
    await this.next(frame => frame.type === 'AUTH_OK');
    const snapshot = await this.next(frame => frame.type === 'SNAPSHOT');
    assert.equal(snapshot.view.viewer_id, this.id);
    return snapshot.view;
  }
  next(match) {
    const found = this.frames.findIndex(match);
    if (found >= 0) return Promise.resolve(this.frames.splice(found, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = {match, resolve, timer: null};
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter(item => item !== waiter);
        reject(new Error(`${this.id}: frame timeout; queued=${this.frames.map(frame => frame.type).join(',')}`));
      }, 5000);
      this.waiters.push(waiter);
    });
  }
  send(frame) { this.socket.send(JSON.stringify(frame)); }
  async command(type, payload, view, serial) {
    const command = {protocol: 'word-tiles-wx/1', room_id: this.roomId,
      command_id: `${this.id}-${serial}`, type, payload};
    if (view.round && type !== 'REQUEST_START_ROUND') {
      command.round_id = view.round.round_id;
      if (['DRAW_TILE', 'DISCARD_TILE', 'PROPOSE_SENTENCE'].includes(type)) command.turn_id = view.round.turn_id;
      if (type === 'SUBMIT_VOTE') command.proposal_id = view.round.pending_sentence.id;
    }
    this.send({type: 'COMMAND', command});
    const frame = await this.next(item => item.type === 'RECEIPT' && item.receipt.command_id === command.command_id);
    assert.equal(frame.receipt.ok, true, `${type}: ${JSON.stringify(frame.receipt)}`);
  }
  close() { this.socket.close(); }
}

const wires = [];
try {
  const tokens = [];
  for (const id of ids) tokens.push((await http('POST', '/auth/local', '', {player_id: id})).token);
  const room = await http('POST', '/rooms', tokens[0], {preset_id: 'nba.words'});
  assert.equal(typeof room.room_id, 'string');
  for (let i = 1; i < ids.length; i++) await http('POST', '/rooms/join', tokens[i], {room_id: room.room_id});
  for (let i = 0; i < ids.length; i++) await http('POST', `/rooms/${encodeURIComponent(room.room_id)}/ready`, tokens[i], {ready: true});
  for (let i = 0; i < ids.length; i++) {
    const wire = new Wire(ids[i], tokens[i], room.room_id);
    wires.push(wire); await wire.open();
  }
  await wires[0].command('REQUEST_START_ROUND', {preset_id: 'nba.words', allow_extra_round: false}, {round: null}, 1);
  let views = await Promise.all(wires.map(wire => wire.next(frame => frame.type === 'STATE').then(frame => frame.view)));
  for (let i = 0; i < views.length; i++) {
    assert.equal(views[i].viewer_id, ids[i]);
    assert.ok(Array.isArray(views[i].round.hand));
    assert.equal(Object.hasOwn(views[i].round, 'hands'), false, 'full hands must stay server-side');
  }
  const activeId = views[0].round.active_player_id;
  const activeIndex = ids.indexOf(activeId);
  assert.ok(activeIndex >= 0);
  if (views[activeIndex].round.phase === 'AWAIT_DRAW') {
    await wires[activeIndex].command('DRAW_TILE', {}, views[activeIndex], 2);
    views = await Promise.all(wires.map(wire => wire.next(frame => frame.type === 'STATE').then(frame => frame.view)));
  }
  const tileIds = views[activeIndex].round.hand.slice(0, 2).map(tile => tile.id);
  await wires[activeIndex].command('PROPOSE_SENTENCE', {tile_ids: tileIds, resource_keys: []}, views[activeIndex], 3);
  views = await Promise.all(wires.map(wire => wire.next(frame => frame.type === 'STATE').then(frame => frame.view)));
  assert.equal(views[0].round.phase, 'AWAIT_VOTES');
  for (let i = 0; i < ids.length; i++) {
    if (i === activeIndex) continue;
    await wires[i].command('SUBMIT_VOTE', {approve: true, rating: 0}, views[i], 4);
    views = await Promise.all(wires.map(wire => wire.next(frame => frame.type === 'STATE').then(frame => frame.view)));
  }
  assert.equal(views[0].round.pending_sentence, null);
  console.log(`PASS four-player room ${room.room_id}: private views, proposal, three ballots`);
} finally {
  for (const wire of wires) wire.close();
}
