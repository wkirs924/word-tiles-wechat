import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const lanSource = readFileSync(resolve(root, 'apps/wechat-preview/lan-client.js'), 'utf8');
const coreSource = readFileSync(resolve(root, 'apps/wechat-preview/core.bundle.js'), 'utf8');
const contentSource = readFileSync(resolve(root, 'apps/wechat-preview/content.js'), 'utf8');

function network(drop = () => false, options = {}) {
  const endpoints = new Map(), sockets = [], storage = new Map();
  let nextPort = 22000;
  function device(ip) {
    if (!storage.has(ip)) storage.set(ip, new Map());
    const wx = {
      getStorageSync(key) { return storage.get(ip).get(key); },
      setStorageSync(key, value) { storage.get(ip).set(key, value); },
      createUDPSocket() {
        const socket = {
          port: 0, listener: null, closed: false,
          onMessage(fn) { this.listener = fn; }, onError() {},
          bind(port) { this.port = port || nextPort++; endpoints.set(`${ip}:${this.port}`, this); sockets.push(this); return this.port; },
          send({address, port, message, setBroadcast}) {
            if (drop({from: ip, address, port, message})) return;
            const data = Buffer.from(message, 'utf8');
            const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            const targets = setBroadcast && address === '255.255.255.255'
              ? [...endpoints.entries()].filter(([key, target]) => key.endsWith(`:${port}`) && !target.closed && !key.startsWith(`${ip}:`)).map(([, target]) => target)
              : [endpoints.get(`${address}:${port}`)];
            for (const target of targets) if (target && !target.closed)
              queueMicrotask(() => target.listener?.({message: bytes, remoteInfo: {address: ip, port: this.port}}));
          },
          close() { this.closed = true; endpoints.delete(`${ip}:${this.port}`); }
        };
        return socket;
      },
      getLocalIPAddress({success}) { success({localip: ip}); },
      getRandomValues({length, success}) { const value = randomBytes(length); success({randomValues: value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)}); }
    };
    if (options.withoutWxRandom) delete wx.getRandomValues;
    const sandbox = {wx, setTimeout, clearTimeout, Date, structuredClone};
    sandbox.globalThis = sandbox; sandbox.GameGlobal = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(contentSource, sandbox);
    vm.runInContext(coreSource, sandbox);
    vm.runInContext(lanSource, sandbox);
    const client = new sandbox.WordTilesLan.Client();
    client.TestTransport = sandbox.WordTilesLan.Transport;
    return client;
  }
  return {device, sockets};
}

async function until(check, message) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw Error(`timeout: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('phone-hosted Wi-Fi room joins four phones and protects private hands', async () => {
  const {device, sockets} = network();
  const clients = ['alice', 'bob', 'carol', 'dave'].map((_, i) => device(`192.168.1.${i + 10}`));
  try {
    for (let i = 0; i < clients.length; i++) await clients[i].login(['alice', 'bob', 'carol', 'dave'][i]);
    const host = clients[0];
    await host.create('nba.words');
    assert.match(host.roomId, /^[A-HJ-NP-Z2-9]{6}$/);
    for (let i = 1; i < clients.length; i++) await clients[i].join(host.roomId);
    await until(() => clients.every(c => c.room?.players.length === 4), 'room sync');
    for (const client of clients) await client.ready(true);
    await until(() => clients.every(c => Object.values(c.room?.ready || {}).every(Boolean)), 'ready sync');
    assert.equal(host.command('REQUEST_START_ROUND', {preset_id: 'nba.words'}), true);
    await until(() => clients.every(c => c.view?.round?.hand), 'private game snapshots');
    assert.equal(host.view.round.phase, 'AWAIT_ACTION');
    for (const client of clients) {
      assert.equal(client.view.viewer_id, client.playerId);
      assert.equal(client.view.round.hand.length >= 13, true);
      assert.equal('wall' in client.view.round, false);
      assert.equal('hands' in client.view.round, false);
    }
    const active = clients.find(c => c.playerId === host.view.round.active_player_id);
    assert.ok(active);
    assert.equal(active.command('PROPOSE_SENTENCE', {tile_ids: active.view.round.hand.map(t => t.id), resource_keys: []}), true);
    await until(() => clients.every(c => c.view?.round?.phase === 'AWAIT_VOTES'), 'proposal sync');
    assert.equal(host.view.round.pending_sentence.owner_id, active.playerId);
    for (const voter of clients.filter(c => c !== active)) assert.equal(voter.command('SUBMIT_VOTE', {approve: true, rating: 0}), true);
    await until(() => clients.every(c => c.view?.round?.phase === 'COMPLETED'), 'round settlement');
    for (const client of clients) {
      assert.equal(client.view.round.winner_id, active.playerId);
      assert.equal(client.view.history.length, 1);
      assert.equal(client.view.round.result !== null, true);
    }
  } finally {
    clients.forEach(client => client.close());
    assert.ok(sockets.every(socket => socket.closed));
  }
});

test('LAN invite rejects loopback and malformed room codes', () => {
  const {device} = network(), client = device('192.168.1.3');
  assert.throws(() => client.join('127.0.0.1:18787/0011223344556677'), /房间号/);
  client.close();
});

test('room secret cannot steal an occupied seat; original phone can reconnect', async () => {
  const {device} = network();
  const host = device('192.168.1.20'), guest = device('192.168.1.21'), stranger = device('192.168.1.22');
  let resumed;
  try {
    await host.login('host'); await guest.login('guest'); await stranger.login('guest');
    await host.create('nba.words'); await guest.join(host.roomId);
    assert.equal(typeof guest.peerToken, 'string'); assert.equal(guest.peerToken.length, 32);
    await assert.rejects(stranger.join(host.roomId), /原手机重连/);
    guest.close();
    resumed = device('192.168.1.21'); await resumed.login('guest'); await resumed.join(host.roomId);
    assert.equal(resumed.playerId, 'guest');
    assert.equal(host.room.players.length, 2);
  } finally { host.close(); guest.close(); stranger.close(); resumed?.close(); }
});

test('two phones can create and join when wx.getRandomValues is absent', async () => {
  const {device} = network(() => false, {withoutWxRandom: true});
  const host = device('192.168.1.30'), guest = device('192.168.1.31');
  try {
    await host.login('host'); await guest.login('guest');
    await host.create('nba.words');
    assert.match(host.roomId, /^[A-HJ-NP-Z2-9]{6}$/);
    await guest.join(host.roomId);
    await until(() => host.room.players.length === 2 && guest.room.players.length === 2, 'two-phone room');
    assert.equal(guest.peerToken.length, 32);
    assert.equal(guest.authenticated, true);
  } finally { host.close(); guest.close(); }
});

test('two-phone rooms can start and settle with one vote', async () => {
  const {device} = network();
  const host = device('192.168.1.40'), guest = device('192.168.1.41');
  try {
    await host.login('host'); await guest.login('guest');
    await host.create('nba.words'); await guest.join(host.roomId);
    await until(() => host.room.players.length === 2 && guest.room.players.length === 2, 'two-player room');
    await host.ready(true); await guest.ready(true);
    await until(() => Object.values(host.room.ready).every(Boolean), 'two-player ready');
    assert.equal(host.command('REQUEST_START_ROUND', {preset_id: 'nba.words', allow_extra_round: false}), true);
    await until(() => host.view?.round?.hand && guest.view?.round?.hand, 'two-player private snapshots');
    const activeSeat = host.view.round.active_player_id;
    const active = host.view.controlled_players.includes(activeSeat) ? host : guest;
    active.setControlSeat(activeSeat);
    assert.equal(active.command('PROPOSE_SENTENCE', {tile_ids: active.view.round.hand.map(tile => tile.id), resource_keys: []}), true);
    await until(() => host.view?.round?.phase === 'AWAIT_VOTES' && guest.view?.round?.phase === 'AWAIT_VOTES', 'two-player proposal');
    for (const seat of ['east', 'south', 'west', 'north'].filter(value => value !== activeSeat)) {
      const voter = host.view.controlled_players.includes(seat) ? host : guest;
      voter.setControlSeat(seat);
      assert.equal(voter.command('SUBMIT_VOTE', {approve: true, rating: 0}), true);
      await until(() => host.view.round.pending_sentence ? host.view.round.pending_sentence.votes_received >= (['east', 'south', 'west', 'north'].filter(value => value !== activeSeat).indexOf(seat) + 1) : true, 'two-player vote');
    }
    await until(() => host.view?.round?.phase === 'COMPLETED' && guest.view?.round?.phase === 'COMPLETED', 'two-player settlement');
    assert.equal(host.view.round.result.scores[activeSeat].total.numerator > 0, true);
  } finally { host.close(); guest.close(); }
});

test('large UDP snapshots survive a lost fragment and are delivered once', async () => {
  let lost = false, delivered = 0, received;
  const {device} = network(packet => {
    const body = JSON.parse(packet.message);
    if (!lost && body.part === 1 && packet.from === '192.168.1.4') { lost = true; return true; }
    return false;
  });
  const a = device('192.168.1.4'), b = device('192.168.1.5');
  const sender = new a.TestTransport(19001, () => {}, error => { throw error; });
  const receiver = new b.TestTransport(19002, body => { delivered++; received = body; }, error => { throw error; });
  try {
    sender.send('192.168.1.5', 19002, {text: '牌'.repeat(3000)});
    await until(() => delivered === 1, 'retransmitted snapshot');
    assert.equal(lost, true);
    assert.equal(received.text, '牌'.repeat(3000));
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(delivered, 1);
  } finally { sender.close(); receiver.close(); a.close(); b.close(); }
});
