import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalTable,SEATS} from '../packages/preview/src/local-table.ts';

const deck=Array.from('天地人和风雨云山开心快乐英雄联盟篮球好球妙传胜利',glyph=>({glyph,copies:4}));
while(deck.reduce((n,e)=>n+e.copies,0)<136)deck.push({glyph:'字',copies:4});

test('local four-seat adapter covers private hands on handoff and resolves votes through core',()=>{
  const table=new LocalTable(deck);
  let view=table.view() as any;
  assert.equal(view.config.planned_rounds,1,'a completed local round is already a standalone result');
  assert.equal(view.round.hand.length===13||view.round.hand.length===14,true);
  const dealer=view.round.active_player_id;
  table.switchSeat(dealer);assert.equal(table.view(),null);
  assert.equal(table.draw().receipt.error,'HANDOFF_COVERED');table.confirmHandoff();
  view=table.view();const ids=view.round.hand.slice(0,2).map((t:any)=>t.id);
  assert.equal(table.propose(ids,['demo.cheer']).receipt.ok,true);
  let index=0;
  for(const seat of SEATS)if(seat!==dealer){table.switchSeat(seat);assert.equal(table.view(),null);table.confirmHandoff();assert.equal(table.vote(index++!==0,[3,0,2][index-1]).receipt.ok,true);}
  table.switchSeat(dealer);table.confirmHandoff();view=table.view();
  assert.equal(view.round.sentences.length,1);assert.equal(view.round.rating_bonus_thirds[dealer],5);
  assert.equal(view.round.sentence_points[dealer],2);
  assert.equal(view.round.phase,'AWAIT_DRAW','an accepted sentence updates score without ending the round');
  assert.equal(view.round.pending_sentence,null);
});

test('each local round consumes a fresh seed for its deal and dice',()=>{
  const supplied:number[]=[];
  const seeds=[41,42,43];
  const newTable=()=>new LocalTable(deck,()=>{
    const seed=seeds.shift()!;
    supplied.push(seed);
    return seed;
  });
  const table=newTable();
  const first=table.view() as any;
  assert.equal(first.round.active_player_id,'west'); // Old fixed seed made every new game start here.
  assert.equal(table.endRound().receipt.ok,true);
  assert.equal(table.nextRound(true).receipt.ok,true);
  const second=table.view() as any;
  assert.notDeepEqual(second.round.hand,first.round.hand);
  assert.notDeepEqual(second.round.dice,first.round.dice);
  const another=newTable();
  const third=another.view() as any;
  assert.notDeepEqual(third.round.hand,first.round.hand);
  assert.deepEqual(supplied,[41,42,43]);
});
