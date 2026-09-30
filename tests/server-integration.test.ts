import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../apps/server/src/server.ts';

test('four WS clients start, vote, settle once and receive private views',async()=>{
  const service=await startServer({port:0,localMode:true});const base=`http://127.0.0.1:${service.port}`;
  const sockets:WebSocket[]=[];
  try{
    async function post(path:string,body:unknown,token?:string){const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
    const people=['alice','bob','carol','dave'];const tokens:string[]=[];
    for(const p of people){const r=await post('/auth/local',{player_id:p});assert.equal(r.status,200);tokens.push(r.data.token);}
    const created=await post('/rooms',{preset_id:'nba.words'},tokens[0]);assert.equal(created.status,200);const room=created.data.room_id;
    for(let i=1;i<4;i++)assert.equal((await post('/rooms/join',{room_id:room},tokens[i])).status,200);
    for(let i=0;i<4;i++)assert.equal((await post(`/rooms/${room}/ready`,{ready:true},tokens[i])).status,200);
    const clients=[] as ReturnType<typeof client>[];
    for(let i=0;i<4;i++){const c=client(`ws://127.0.0.1:${service.port}/play`);clients.push(c);sockets.push(c.ws);await c.open;c.send({type:'AUTH',token:tokens[i],room_id:room});assert.equal((await c.next()).type,'AUTH_OK');const snap=await c.next();assert.equal(snap.type,'SNAPSHOT');assert.equal(snap.view.viewer_id,people[i]);assert.equal(snap.view.config.planned_rounds,1);}
    const command=(id:string,type:string,payload:any,view?:any)=>({type:'COMMAND',command:{protocol:'word-tiles-wx/1',room_id:room,command_id:id,type,payload,...(view?{round_id:view.round.round_id,...(['DRAW_TILE','DISCARD_TILE','PROPOSE_SENTENCE'].includes(type)?{turn_id:view.round.turn_id}:{}),...(type==='SUBMIT_VOTE'?{proposal_id:view.round.pending_sentence?.id}:{})}: {})}});
    clients[0].send(command('start','REQUEST_START_ROUND',{preset_id:'nba.words'}));
    assert.equal((await clients[0].next()).receipt.ok,true);
    const views=[];for(const c of clients){const msg=await c.next();assert.equal(msg.type,'STATE');views.push(msg.view);assert.equal('wall'in msg.view.round,false);}
    const owner=views[0].round.active_player_id,ownerIndex=people.indexOf(owner),hand=views[ownerIndex].round.hand;
    assert.equal(hand.length,14);
    clients[ownerIndex].send(command('propose','PROPOSE_SENTENCE',{tile_ids:hand.map((t:any)=>t.id),resource_keys:[]},views[ownerIndex]));
    assert.equal((await clients[ownerIndex].next()).receipt.ok,true);
    const proposalViews=[];for(const c of clients){const msg=await c.next();assert.equal(msg.type,'STATE');proposalViews.push(msg.view);}
    const voters=people.map((_,i)=>i).filter(i=>i!==ownerIndex);
    voters.forEach((i,n)=>clients[i].send(command(`vote-${n}`,'SUBMIT_VOTE',{approve:n!==0,rating:0},proposalViews[i])));
    for(const i of voters){const receipt=await clients[i].nextType('RECEIPT');assert.equal(receipt.receipt.ok,true);}
    const finals=[];for(const c of clients){let message;do{message=await c.nextType('STATE');}while(message.view.round.phase!=='COMPLETED');finals.push(message.view);}
    for(const v of finals){assert.equal(v.round.winner_id,owner);assert.equal(v.history.length,1);assert.equal(v.round.phase,'COMPLETED');}
    clients[voters[2]].send(command('vote-2','SUBMIT_VOTE',{approve:true,rating:0},proposalViews[voters[2]]));
    const retry=await clients[voters[2]].nextType('RECEIPT');assert.equal(retry.receipt.ok,true);assert.equal(retry.receipt.revision,finals[0].revision);
    clients[0].send(command('replay','REQUEST_START_ROUND',{preset_id:'nba.words',allow_extra_round:true}));
    assert.equal((await clients[0].nextType('RECEIPT')).receipt.ok,true,'another round is optional after this result');
    for(const c of clients){let message;do{message=await c.nextType('STATE');}while(message.view.round_number!==2);assert.equal(message.view.round.phase,'AWAIT_ACTION');}
  }finally{for(const ws of sockets)ws.close();await service.close();}
});

function client(url:string){
  const ws=new WebSocket(url),queue:any[]=[],waiters:((x:any)=>void)[]=[];
  const open=new Promise<void>((resolve,reject)=>{ws.addEventListener('open',()=>resolve(),{once:true});ws.addEventListener('error',()=>reject(Error('WS_ERROR')),{once:true});});
  ws.addEventListener('message',e=>{const msg=JSON.parse(String(e.data));const waiter=waiters.shift();if(waiter)waiter(msg);else queue.push(msg);});
  const next=()=>queue.length?Promise.resolve(queue.shift()):new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('WS_TIMEOUT')),5000);waiters.push(msg=>{clearTimeout(timer);resolve(msg);});});
  const nextType=async(type:string)=>{let msg;do{msg=await next();}while(msg.type!==type);return msg;};
  return {ws,open,send:(x:unknown)=>ws.send(JSON.stringify(x)),next,nextType};
}
