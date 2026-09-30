import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';

const source = readFileSync(resolve(import.meta.dirname, '../apps/wechat-preview/network-client.js'), 'utf8');

test('network client authenticates, joins a room, receives only its view and sends a scoped command', async () => {
  const requests = [], sockets = [];
  const sandbox = {console, Date, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      requests.push({url, options});
      const response = url.endsWith('/auth/local') ? {token: 'secret', player_id: 'alice'}
        : url.endsWith('/rooms/join') ? {room_id: 'room-1', host_player_id: 'alice', players: ['alice'], ready: {}}
          : {room_id: 'room-1', host_player_id: 'alice', players: ['alice'], ready: {alice: true}};
      return {ok: true, text: async () => JSON.stringify(response)};
    },
    WebSocket: class {
      constructor(url) { this.url = url; this.sent = []; sockets.push(this); }
      send(message) { this.sent.push(JSON.parse(message)); }
      close() {}
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, {filename: 'network-client.js'});
  const client = new sandbox.WordTilesNetwork.Client();
  await client.login('alice');
  await client.join('room-1');
  await client.ready(true);
  assert.equal(requests[1].options.headers.Authorization, 'Bearer secret');
  assert.equal(client.room.ready.alice, true);
  client.connect();
  sockets[0].onopen();
  assert.equal(sockets[0].sent[0].type, 'AUTH');
  assert.equal(sockets[0].sent[0].token, 'secret');
  sockets[0].onmessage({data: JSON.stringify({type: 'AUTH_OK', room_id: 'room-1', player_id: 'alice'})});
  const view = {viewer_id: 'alice', revision: 3, round: {round_id: 'r1', turn_id: 2, pending_sentence: null}};
  sockets[0].onmessage({data: JSON.stringify({type: 'SNAPSHOT', view, events: []})});
  assert.equal(client.view.round.round_id, 'r1');
  assert.equal(client.command('DRAW_TILE', {}), true);
  assert.deepEqual(JSON.parse(JSON.stringify(sockets[0].sent[1])), {
    type: 'COMMAND', command: {protocol: 'word-tiles-wx/1', room_id: 'room-1',
      command_id: sockets[0].sent[1].command.command_id, type: 'DRAW_TILE', payload: {}, round_id: 'r1', turn_id: 2}
  });
  assert.equal(client.command('DRAW_TILE', {}), false, 'pending command blocks duplicate taps');
  sockets[0].onmessage({data: JSON.stringify({type: 'RECEIPT', receipt: {command_id: sockets[0].sent[1].command.command_id, ok: true}})});
  assert.equal(client.pendingCommand, null);
  sockets[0].onmessage({data: JSON.stringify({type: 'STATE', view: {viewer_id: 'bob', revision: 9}, events: []})});
  assert.equal(client.view.viewer_id, 'alice');
  assert.equal(client.error, 'PRIVATE_VIEW_MISMATCH');
  client.close();
});

test('reconnect resends the same pending command id after authentication', () => {
  const sockets = [];
  let retry;
  const sandbox = {console, Date, clearTimeout() {}, setTimeout: callback => { retry = callback; return 1; },
    WebSocket: class {
      constructor() { this.sent = []; sockets.push(this); }
      send(message) { this.sent.push(JSON.parse(message)); }
      close() {}
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, {filename: 'network-client.js'});
  const client = new sandbox.WordTilesNetwork.Client();
  client.token = 'token'; client.playerId = 'alice'; client.roomId = 'room-1';
  client.connect(); sockets[0].onopen();
  sockets[0].onmessage({data: JSON.stringify({type: 'AUTH_OK'})});
  sockets[0].onmessage({data: JSON.stringify({type: 'SNAPSHOT', view: {viewer_id: 'alice', revision: 1, round: {round_id: 'r1', turn_id: 1}}})});
  assert.equal(client.command('DRAW_TILE', {}), true);
  const firstId = sockets[0].sent[1].command.command_id;
  sockets[0].onclose(); retry(); sockets[1].onopen();
  assert.equal(sockets[1].sent[0].type, 'AUTH');
  assert.equal(client.command('DRAW_TILE', {}), false, 'unauthenticated reconnect cannot send a new command');
  sockets[1].onmessage({data: JSON.stringify({type: 'AUTH_OK'})});
  assert.equal(sockets[1].sent[1].command.command_id, firstId);
  client.close();
});
