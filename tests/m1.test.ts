import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSession, reduceSession, exportReplay, replay, ranking, type SessionState} from '../packages/core/src/session.ts';
import {playerView, playerEvents} from '../packages/core/src/projection.ts';
import {canonical, type Json} from '../packages/core/src/json.ts';
import {defaults} from '../packages/core/src/rules.ts';

const players=['alice','bob','carol','dave'];
const tiles=(count=136)=>Array.from({length:count},(_,i)=>({id:`tile_${String(i).padStart(3,'0')}`,glyph:['天','地','人','和','风','雨','云','山'][i%8],syllable_key:`syllable_${i%8}`,base_tone:1}));
const setup=(id='r1',count=136,seed=42)=>({round_id:id,tiles:tiles(count),seed});
let serial=0;
function cmd(s:SessionState,type:string,payload:Record<string,unknown>={}) {
  const c:Record<string,unknown>={command_id:`cmd_${++serial}`,type,payload};
  if(s.round){c.round_id=s.round.round_id;c.turn_id=s.round.turn_id;if(s.round.pending)c.proposal_id=s.round.pending.id;}
  return c;
}
function create(config:unknown={}) {const x=createSession('session',players,'alice',config);assert.equal(x.ok,true);if(!x.ok)throw Error();return x.state;}
function send(s:SessionState,type:string,payload:Record<string,unknown>={},actor?:string) {
  const p=actor??(type==='START_NEXT_ROUND'||type==='END_GAME'||!s.round?'alice':s.round.players[s.round.active_seat]);
  const before=canonical(s as unknown as Json),x=reduceSession(s,cmd(s,type,payload),p);
  assert.equal(x.receipt.ok,true,`${type}: ${x.receipt.error}`);assert.equal(canonical(s as unknown as Json),before);
  return x.state;
}
function started(config:unknown={}) {const s=create(config);return send(s,'START_NEXT_ROUND',setup('r1',(s.config).tile_count));}
function propose(s:SessionState,count:number,resource_keys:string[]=[]) {const r=s.round!,p=r.players[r.active_seat];return send(s,'PROPOSE_SENTENCE',{tile_ids:r.hands[p].slice(0,count),resource_keys});}
function voteAll(s:SessionState,approves:boolean[],ratings=[0,0,0]) {
  const owner=s.round!.pending!.owner_id, voters=players.filter(p=>p!==owner);
  for(let i=0;i<3;i++)s=send(s,'SUBMIT_VOTE',{approve:approves[i],rating:ratings[i]},voters[i]);
  return s;
}
function reject(s:SessionState,type:string,payload:Record<string,unknown>,actor:string,error:string) {
  const before=canonical(s.round as unknown as Json),x=reduceSession(s,cmd(s,type,payload),actor);
  assert.equal(x.receipt.error,error);assert.equal(x.events.length,0);assert.equal(x.state.revision,s.revision);
  assert.equal(canonical(x.state.round as unknown as Json),before);return x.state;
}

test('setup, dealer, privacy, and host draw agree with rule phases',()=>{
  let s=started();const r=s.round!, dealer=r.players[r.dealer_seat];
  assert.equal(r.hands[dealer].length,14);assert.equal(r.wall.length-r.wall_cursor,83);
  for(const p of players) if(p!==dealer)assert.equal(r.hands[p].length,13);
  s=reject(s,'DRAW_TILE',{},dealer,'WRONG_PHASE');
  const next=players[(r.dealer_seat+1)%4];
  s=reject(s,'DISCARD_TILE',{tile_id:r.hands[next][0]},next,'NOT_YOUR_TURN');
  s=send(s,'DISCARD_TILE',{tile_id:r.hands[dealer][0]});
  assert.equal(s.round!.phase,'AWAIT_DRAW');s=send(s,'DRAW_TILE',{},'alice');
  assert.equal(s.round!.hands[next].length,14);
  for(const viewer of players){const v=playerView(s,viewer) as any;assert.equal(v.round.hand.length,s.round!.hands[viewer].length);assert.equal('wall' in v.round,false);assert.equal('catalog' in v.round,false);assert.equal('journal' in v,false);}
});

test('proposal validates physical tiles, reading choices and ordered images',()=>{
  let s=started(), r=s.round!, p=r.players[r.active_seat], ids=r.hands[p];
  s=reject(s,'PROPOSE_SENTENCE',{tile_ids:[ids[0]]},p,'INVALID_SENTENCE_SIZE');
  s=reject(s,'PROPOSE_SENTENCE',{tile_ids:[ids[0],ids[0]]},p,'INVALID_SENTENCE_TILES');
  s=reject(s,'PROPOSE_SENTENCE',{tile_ids:ids.slice(0,2),reading_choices:[{tone:5},null]},p,'INVALID_READINGS');
  s=reject(s,'PROPOSE_SENTENCE',{tile_ids:ids.slice(0,2),resource_keys:['a','a']},p,'DUPLICATE_MEME_IMAGE');
  s=send(s,'PROPOSE_SENTENCE',{tile_ids:[ids[1],ids[0]],reading_choices:[{tone:2},null],resource_keys:['meme.c','meme.a']});
  assert.equal(s.round!.phase,'AWAIT_VOTES');assert.equal(s.round!.hands[p].length,14);
  assert.equal(s.round!.pending!.text,r.catalog[ids[1]].glyph+r.catalog[ids[0]].glyph);
  assert.deepEqual(s.round!.pending!.resource_keys,['meme.c','meme.a']);
  assert.equal((playerView(s,p) as any).round.pending_sentence.votes,undefined);
});

test('all three atomic ballots resolve once, including opposing rating, then retry is inert',()=>{
  let s=propose(started(),2,['meme.c']);const owner=s.round!.pending!.owner_id,voters=players.filter(p=>p!==owner);
  s=reject(s,'SUBMIT_VOTE',{approve:true,rating:3},owner,'SELF_VOTE_FORBIDDEN');
  s=reject(s,'SUBMIT_VOTE',{approve:true,rating:4},voters[0],'RATING_OUT_OF_RANGE');
  const queued=voters.map((p,i)=>({actor:p,command:cmd(s,'SUBMIT_VOTE',{approve:i!==0,rating:[3,0,2][i]})}));
  for(let i=0;i<3;i++){
    const x=reduceSession(s,queued[i].command,queued[i].actor);assert.equal(x.receipt.ok,true);s=x.state;
    for(const viewer of players) for(const e of playerEvents(x.events,viewer,players)) if(e.type==='VOTE_SUBMITTED')assert.deepEqual(Object.keys(e.data).sort(),['proposal_id','votes_received']);
    if(i<2){const pending=(playerView(s,voters[0]) as any).round.pending_sentence;assert.equal(pending.votes_received,i+1);assert.equal(pending.has_voted,true);assert.equal('rating_average' in pending,false);}
    const retry=reduceSession(s,queued[i].command,queued[i].actor);assert.equal(retry.duplicate,true);assert.deepEqual(retry.events,[]);
  }
  assert.equal(s.round!.rating_bonus_thirds[owner],5);assert.equal(s.round!.scores[owner],2);
  assert.deepEqual((s.round!.sentences[0] as any).rating_average,{numerator:5,denominator:3});
  assert.equal((s.round!.sentences[0] as any).votes,undefined);
  const after=canonical(s as unknown as Json);const retry=reduceSession(s,queued[2].command,queued[2].actor);
  assert.equal(canonical(retry.state as unknown as Json),after);
});

test('rejection scores zero, forces discard, and plain sentence rejects nonzero rating',()=>{
  let s=propose(started(),2,['meme.c']);const owner=s.round!.pending!.owner_id;
  s=voteAll(s,[false,false,true],[3,3,3]);
  assert.equal(s.round!.phase,'MUST_DISCARD');assert.equal(s.round!.scores[owner],0);assert.equal(s.round!.rating_bonus_thirds[owner],0);assert.equal(s.round!.hands[owner].length,14);
  s=reject(s,'PROPOSE_SENTENCE',{tile_ids:s.round!.hands[owner].slice(0,2)},owner,'WRONG_PHASE');
  s=send(s,'DISCARD_TILE',{tile_id:s.round!.hands[owner][0]});assert.equal(s.round!.phase,'AWAIT_DRAW');
  let plain=propose(started(),2), voter=players.find(p=>p!==plain.round!.pending!.owner_id)!;
  plain=reject(plain,'SUBMIT_VOTE',{approve:true,rating:1},voter,'RATING_REQUIRES_MEME');
  plain=voteAll(plain,[true,true,false]);assert.equal((plain.round!.sentences[0] as any).rating_average.numerator,0);
});

test('win settles in last vote, exact totals rank, terminal actions fail',()=>{
  let s=started(),owner=s.round!.players[s.round!.active_seat];s=propose(s,14,['meme.c']);s=voteAll(s,[false,true,true],[3,0,2]);
  assert.equal(s.round!.phase,'COMPLETED');assert.equal(s.round!.winner_id,owner);assert.equal(s.history.length,1);
  assert.equal(s.totals_thirds[owner],3*17+5);assert.equal(ranking(s)[0].player_id,owner);
  const other=players.find(p=>p!==owner)!;assert.equal(s.totals_thirds[other],-39);
  s=reject(s,'END_GAME',{},'alice','ROUND_TERMINAL');
  assert.equal(s.history.length,1);
});

test('wall final draw remains playable; next draw settles and discard never wins',()=>{
  const config=defaults();config.tile_count=54;
  let s=started(config),p=s.round!.players[s.round!.active_seat];s=send(s,'DISCARD_TILE',{tile_id:s.round!.hands[p][0]});
  s=send(s,'DRAW_TILE');assert.equal(s.round!.wall_cursor,54);assert.equal(s.round!.phase,'AWAIT_ACTION');
  p=s.round!.players[s.round!.active_seat];s=send(s,'DISCARD_TILE',{tile_id:s.round!.hands[p][0]});
  s=send(s,'DRAW_TILE');assert.equal(s.round!.phase,'COMPLETED');assert.equal(s.round!.end_reason,'WALL_EXHAUSTED');assert.equal(s.round!.winner_id,null);
});

test('abort retains confirmed points and does not consume planned completed rounds',()=>{
  const config=defaults();config.planned_rounds=1;
  let s=propose(started(config),2,['meme.a']);s=voteAll(s,[true,true,false],[1,2,3]);
  const before=canonical(s.round!.sentences as unknown as Json),score=canonical(s.round!.scores as unknown as Json);
  s=proposeAfterCycle(s);
  s=send(s,'END_GAME',{},'alice');assert.equal(s.round!.phase,'ABORTED');assert.equal(s.round!.pending,null);
  assert.equal(canonical(s.round!.sentences as unknown as Json),before);assert.equal(canonical(s.round!.scores as unknown as Json),score);
  assert.equal(s.history[0].settled,false);assert.equal(s.history[0].scores,null);
  assert.deepEqual(Object.values(s.totals_thirds),[0,0,0,0]);
  s=send(s,'START_NEXT_ROUND',setup('r2'));assert.equal(s.round_counter,2);
});
function proposeAfterCycle(s:SessionState){ // advance once, leaving a live proposal to cancel
  s=send(s,'DRAW_TILE');return propose(s,2);
}

test('receipt ledger includes failures; replay detects changed receipt and stays exact',()=>{
  let s=started(),p=s.round!.players[s.round!.active_seat],c=cmd(s,'PROPOSE_SENTENCE',{tile_ids:s.round!.hands[p].slice(0,2)});
  const first=reduceSession(s,c,p);assert.equal(first.receipt.ok,true);s=first.state;
  assert.equal(reduceSession(s,c,p).duplicate,true);
  const altered={...c,payload:{tile_ids:s.round!.hands[p].slice(0,3)}};
  assert.equal(reduceSession(s,altered,p).receipt.error,'COMMAND_ID_REUSED');
  const bad=cmd(s,'DRAW_TILE',{}),failure=reduceSession(s,bad,p);assert.equal(failure.receipt.error,'WRONG_PHASE');
  s=failure.state;assert.equal(reduceSession(s,bad,p).duplicate,true);
  const record=JSON.parse(JSON.stringify(exportReplay(s))),again=replay(record);assert.equal(again.ok,true);
  if(again.ok)assert.equal(canonical(again.state as unknown as Json),canonical(s as unknown as Json));
  record.journal[0].receipt.revision=999;assert.equal(replay(record).ok,false);
});

test('malformed inputs, unknown identities, old rules, custom bonus and hostile keys',()=>{
  const old=defaults();(old as any).rules_version='word-tiles-3';assert.equal(createSession('s',players,'alice',old).ok,false);
  const custom=defaults();custom.sentence_bonuses=[{min:2,max:-1,bonus:7}];
  let s=started(custom);s=propose(s,2);s=voteAll(s,[true,true,false]);
  const owner=(s.round!.sentences[0] as any).owner_id;assert.equal(s.round!.scores[owner],9);
  for(const v of [null,[],{},'DRAW_TILE',{'command_id':'x','type':'DRAW_TILE','payload':null}])assert.equal(reduceSession(s,v,'alice').receipt.ok,false);
  assert.equal(reduceSession(s,cmd(s,'END_GAME'), 'outsider').receipt.error,'UNKNOWN_IDENTITY');
  assert.equal(reduceSession(s,cmd(s,'SUBMIT_MEME'),owner).receipt.error,'UNKNOWN_ACTION');
  assert.equal(playerView(s,'outsider').ok,false);assert.deepEqual(playerEvents([], 'outsider',players),[]);
  assert.equal(createSession('s',['__proto__','constructor','x','y'],'__proto__').ok,true);
  const poison=JSON.parse('{"command_id":"poison","type":"DRAW_TILE","payload":{"__proto__":{}}}');
  assert.equal(reduceSession(s,poison,owner).receipt.error,'INVALID_COMMAND');
  const sparse:any[]=Array(2);sparse[1]=1;(sparse as any).extra=1;
  assert.equal(reduceSession(s,{command_id:'sparse',type:'PROPOSE_SENTENCE',payload:{tile_ids:sparse}},owner).receipt.error,'INVALID_COMMAND');
  const hidden={command_id:'hidden',type:'DRAW_TILE',payload:{}} as any;
  Object.defineProperty(hidden,'actor',{value:'alice'});
  assert.equal(reduceSession(s,hidden,owner).receipt.error,'INVALID_COMMAND');
});

test('Godot 4.7.2 actual fixed run matches receipts, public events and complete Alice views',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/godot-m1-golden.json',import.meta.url),'utf8'));
  assert.match(fixture.engine,/^4\.7\.2/);
  const config=defaults();config.tile_count=53;
  const created=createSession('golden-session',players,'alice',config);assert.equal(created.ok,true);if(!created.ok)throw Error();
  let s=created.state;
  for(let i=0;i<fixture.commands.length;i++) {
    const entry=fixture.commands[i],step=reduceSession(s,entry.command,entry.actor);
    assert.equal(step.receipt.ok,true,`golden step ${i}`);s=step.state;
    const actual={receipt:step.receipt,event_types:step.events.map(e=>e.type),alice_view:playerView(s,'alice'),alice_events:playerEvents(step.events,'alice',players)};
    assert.equal(canonical(actual as unknown as Json),canonical(fixture.steps[i]),`Godot mismatch at step ${i}`);
  }
});

test('two settled rounds accumulate exact thirds, planned limit and replay',()=>{
  const config=defaults();config.planned_rounds=1;
  let s=started(config),owner=s.round!.players[s.round!.active_seat];
  s=voteAll(propose(s,14,['meme.c']),[true,true,false],[3,2,0]);
  const first=s.totals_thirds[owner];assert.equal(first,56);
  s=reject(s,'START_NEXT_ROUND',setup('r1',136,43),'alice','ROUND_ID_REUSED');
  s=reject(s,'START_NEXT_ROUND',setup('r2',136,43),'alice','PLANNED_ROUNDS_FINISHED');
  s=send(s,'START_NEXT_ROUND',{...setup('r2',136,43),allow_extra_round:true});
  const secondOwner=s.round!.players[s.round!.active_seat];
  s=voteAll(propose(s,14),[true,true,false]);
  assert.equal(s.history.length,2);assert.equal(s.history[0].settled,true);assert.equal(s.history[1].settled,true);
  for(const p of players)assert.equal(s.totals_thirds[p],s.history[0].scores![p].total.numerator+s.history[1].scores![p].total.numerator);
  assert.equal(s.totals_thirds[owner]>=first-39,true);assert.equal(s.round!.winner_id,secondOwner);
  const restored=replay(JSON.parse(JSON.stringify(exportReplay(s))));assert.equal(restored.ok,true);
  if(restored.ok)assert.equal(canonical(restored.state as unknown as Json),canonical(s as unknown as Json));
});

test('deal and draw events reveal private tiles only to their owner',()=>{
  const initial=create(),start=reduceSession(initial,cmd(initial,'START_NEXT_ROUND',setup()),'alice');
  assert.equal(start.receipt.ok,true);let s=start.state;
  for(const viewer of players) {
    const visible=canonical(playerEvents(start.events,viewer,players) as unknown as Json);
    for(const other of players) if(other!==viewer) for(const id of s.round!.hands[other])assert.equal(visible.includes(JSON.stringify(id)),false);
  }
  const actor=s.round!.players[s.round!.active_seat];s=send(s,'DISCARD_TILE',{tile_id:s.round!.hands[actor][0]});
  const drawer=s.round!.players[s.round!.active_seat],draw=reduceSession(s,cmd(s,'DRAW_TILE'),'alice');
  const id=draw.state.round!.hands[drawer].at(-1)!;
  for(const viewer of players)assert.equal(canonical(playerEvents(draw.events,viewer,players) as unknown as Json).includes(JSON.stringify(id)),viewer===drawer);
});
