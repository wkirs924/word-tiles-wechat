import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {existsSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../apps/server/src/server.ts';
import {validateCommand} from '../packages/protocol/src/validate.ts';

test('network commands reject identity spoofing and client-selected walls',()=>{
  const base={protocol:'word-tiles-wx/1',room_id:'room',command_id:'one',type:'REQUEST_START_ROUND',payload:{preset_id:'nba.words'}};
  assert.deepEqual(validateCommand({...base,actor:'bob'}),{ok:false,error:'INVALID_COMMAND'});
  assert.deepEqual(validateCommand({...base,payload:{...base.payload,wall:['tile']}}),{ok:false,error:'INVALID_PAYLOAD'});
  assert.deepEqual(validateCommand({...base,payload:{...base.payload,seed:5}}),{ok:false,error:'INVALID_PAYLOAD'});
});

test('local CORS is scoped and invalid JSON receives a client error',async()=>{
  const service=await startServer({port:0,localMode:true});const base=`http://127.0.0.1:${service.port}`;
  try{
    const preflight=await fetch(base+'/auth/local',{method:'OPTIONS',headers:{origin:'null','access-control-request-headers':'authorization, content-type'}});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'null');
    assert.match(preflight.headers.get('access-control-allow-headers')??'',/Authorization/);
    const hostile=await fetch(base+'/auth/local',{method:'OPTIONS',headers:{origin:'https://other.example'}});
    assert.equal(hostile.status,403);assert.equal(hostile.headers.get('access-control-allow-origin'),null);
    const bad=await fetch(base+'/auth/local',{method:'POST',body:'{',headers:{'content-type':'application/json'}});
    assert.equal(bad.status,400);assert.equal((await bad.json()).error,'INVALID_JSON');
  }finally{await service.close();}
});

test('SQLite restart restores hashed-token login, room and live private round',async()=>{
  const databasePath=join(tmpdir(),`word-tiles-${randomUUID()}.sqlite`);let service=await startServer({port:0,localMode:true,databasePath});
  let ws:WebSocket|undefined;
  try{
    let base=`http://127.0.0.1:${service.port}`;
    const post=async(path:string,body:unknown,token?:string)=>{const r=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
    const names=['alice','bob','carol','dave'],tokens=[] as string[];
    for(const name of names){const r=await post('/auth/local',{player_id:name});assert.equal(r.status,200);tokens.push(r.data.token);}
    const create=await post('/rooms',{preset_id:'nba.words'},tokens[0]),room=create.data.room_id;
    for(let i=1;i<4;i++)assert.equal((await post('/rooms/join',{room_id:room},tokens[i])).status,200);
    for(let i=0;i<4;i++)assert.equal((await post(`/rooms/${room}/ready`,{ready:true},tokens[i])).status,200);
    ws=new WebSocket(`ws://127.0.0.1:${service.port}/play`);await new Promise<void>(resolve=>ws!.addEventListener('open',()=>resolve(),{once:true}));
    const messages:any[]=[];ws.addEventListener('message',e=>messages.push(JSON.parse(String(e.data))));
    ws.send(JSON.stringify({type:'AUTH',token:tokens[0],room_id:room}));await until(()=>messages.some(m=>m.type==='SNAPSHOT'));
    ws.send(JSON.stringify({type:'COMMAND',command:{protocol:'word-tiles-wx/1',room_id:room,command_id:'persist-start',type:'REQUEST_START_ROUND',payload:{preset_id:'nba.words'}}}));
    await until(()=>messages.some(m=>m.type==='STATE'&&m.view.round));
    const before=messages.findLast(m=>m.type==='STATE').view;
    ws.close();await service.close();ws=undefined;
    service=await startServer({port:0,localMode:true,databasePath});base=`http://127.0.0.1:${service.port}`;
    const restored=await fetch(base+`/rooms/${room}`,{headers:{authorization:`Bearer ${tokens[0]}`}});
    assert.equal(restored.status,200);assert.equal((await restored.json()).players.length,4);
    ws=new WebSocket(`ws://127.0.0.1:${service.port}/play`);await new Promise<void>(resolve=>ws!.addEventListener('open',()=>resolve(),{once:true}));
    const after:any[]=[];ws.addEventListener('message',e=>after.push(JSON.parse(String(e.data))));
    ws.send(JSON.stringify({type:'AUTH',token:tokens[0],room_id:room}));await until(()=>after.some(m=>m.type==='SNAPSHOT'));
    const snapshot=after.find(m=>m.type==='SNAPSHOT').view;
    assert.equal(snapshot.revision,before.revision);assert.equal(snapshot.round.round_id,before.round.round_id);
    assert.deepEqual(snapshot.round.hand,before.round.hand);
    ws.send(JSON.stringify({type:'COMMAND',command:{protocol:'word-tiles-wx/1',room_id:room,command_id:'persist-start',type:'REQUEST_START_ROUND',payload:{preset_id:'nba.words'}}}));
    await until(()=>after.some(m=>m.type==='RECEIPT'));
    assert.equal(after.find(m=>m.type==='RECEIPT').receipt.ok,true);
    assert.equal(after.filter(m=>m.type==='STATE').length,0);
  }finally{ws?.close();await service.close();for(const suffix of ['','-wal','-shm']){const p=databasePath+suffix;if(existsSync(p))unlinkSync(p);}}
});

async function until(condition:()=>boolean){const end=Date.now()+5000;while(!condition()){if(Date.now()>end)throw Error('TIMEOUT');await new Promise(resolve=>setTimeout(resolve,10));}}
