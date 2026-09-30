import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,randomInt,randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {upgrade,Peer} from './websocket.ts';
import {Store} from './store.ts';
import {createSession,reduceSession,type SessionState,type Receipt} from '../../../packages/core/src/session.ts';
import {playerView,playerEvents} from '../../../packages/core/src/projection.ts';
import {expandDeck} from '../../../packages/core/src/setup.ts';
import {defaults} from '../../../packages/core/src/rules.ts';
import {canonical,json,object,onlyKeys,identifier,type Json} from '../../../packages/core/src/json.ts';
import {validateCommand} from '../../../packages/protocol/src/validate.ts';

type LedgerEntry={fingerprint:string;receipt:Receipt};
type Room={id:string;host_player_id:string;players:string[];ready:Record<string,boolean>;preset_id:string;session:SessionState|null;ledger:Record<string,LedgerEntry>};
const catalog=JSON.parse(readFileSync(resolve(import.meta.dirname,'../../../reference/godot/content/catalog.json'),'utf8'));
const presets=new Map<string,{deck:{glyph:string;copies:number}[]}>(catalog.deck_presets.map((p:any)=>[p.id,p]));
const memeKeys=new Set<string>(catalog.assets.filter((a:any)=>a.kind==='meme').map((a:any)=>a.key));
const contentVersion=`content-${catalog.revision}`;
const MAX_BODY=16*1024;
const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');

export function startServer(options:{port?:number;host?:string;localMode?:boolean;databasePath?:string}={}){
  const databasePath=options.databasePath??process.env.WORD_TILES_DB??(options.port===0?':memory:':resolve(import.meta.dirname,'../data/server.sqlite'));
  const store=new Store<Room>(databasePath);
  const rooms=new Map<string,Room>(store.rooms().map(room=>{room.ready=Object.assign(Object.create(null),room.ready);room.ledger=Object.assign(Object.create(null),room.ledger);return [room.id,room];})),tokens=new Map<string,string>(store.tokens()),peers=new Map<string,Map<string,Peer>>(),queues=new Map<string,Promise<unknown>>();
  const localMode=options.localMode??process.env.LOCAL_MODE==='1';
  const http=createServer(async(req,res)=>{
    try{await route(req,res);}catch(e){if(e instanceof RequestError){response(res,e.status,{error:e.code});return;}response(res,500,{error:'INTERNAL_ERROR'});console.error('server error',e instanceof Error?e.message:e);}
  });
  http.on('upgrade',(req,socket,head)=>{
    const peer=upgrade(req,socket,head);if(!peer)return;
    let identity:string|null=null,room:Room|null=null;
    const timer=setTimeout(()=>peer.close(),5000);
    peer.onClose=()=>{clearTimeout(timer);if(identity&&room&&peers.get(room.id)?.get(identity)===peer)peers.get(room.id)!.delete(identity);};
    peer.onMessage=raw=>{
      let msg:unknown;try{msg=JSON.parse(raw);}catch{peer.send({type:'ERROR',error:'INVALID_JSON'});return;}
      if(!json(msg)||!object(msg)||typeof msg.type!=='string'){peer.send({type:'ERROR',error:'INVALID_MESSAGE'});return;}
      if(!identity){
        if(msg.type!=='AUTH'||!onlyKeys(msg,['type','token','room_id'])||typeof msg.token!=='string'||!identifier(msg.room_id)){peer.send({type:'ERROR',error:'AUTH_REQUIRED'});return;}
        const actor=tokens.get(tokenHash(msg.token)),candidate=rooms.get(msg.room_id);
        if(!actor||!candidate||!candidate.players.includes(actor)){peer.send({type:'ERROR',error:'AUTH_FAILED'});peer.close();return;}
        identity=actor;room=candidate;clearTimeout(timer);
        if(!peers.has(room.id))peers.set(room.id,new Map());
        const old=peers.get(room.id)!.get(actor);if(old&&old!==peer)old.close();
        peers.get(room.id)!.set(actor,peer);
        peer.send({type:'AUTH_OK',room_id:room.id,player_id:actor,content_version:contentVersion});
        peer.send({type:'SNAPSHOT',view:view(room,actor),events:[]});return;
      }
      if(msg.type==='RESUME'&&onlyKeys(msg,['type'])){peer.send({type:'SNAPSHOT',view:view(room!,identity),events:[]});return;}
      if(msg.type!=='COMMAND'||!onlyKeys(msg,['type','command'])){peer.send({type:'ERROR',error:'INVALID_MESSAGE'});return;}
      const actor=identity,target=room!;
      enqueue(target.id,async()=>{try{const working=structuredClone(target),result=handleCommand(working,actor,msg.command);store.putRoom(working);Object.assign(target,working);peer.send({type:'RECEIPT',receipt:result.receipt});if(result.changed)broadcast(target,result.events);}catch(e){console.error('command error',e);peer.send({type:'ERROR',error:'INTERNAL_ERROR'});}});
    };
  });

  async function route(req:IncomingMessage,res:ServerResponse){
    const origin=req.headers.origin;
    if(localMode&&typeof origin==='string'&&isLocalOrigin(origin)){
      res.setHeader('Access-Control-Allow-Origin',origin);
      res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
    }
    if(req.method==='OPTIONS'){response(res,localMode&&typeof origin==='string'&&isLocalOrigin(origin)?204:403,{});return;}
    const path=new URL(req.url??'/', 'http://localhost').pathname;
    if(path==='/health'&&req.method==='GET'){response(res,200,{ok:true,mode:localMode?'LOCAL':'PRODUCTION',content_version:contentVersion});return;}
    const body=req.method==='POST'?await readBody(req):{};
    if(req.method==='POST'&&path==='/auth/local'){
      if(!localMode){response(res,403,{error:'LOCAL_AUTH_DISABLED'});return;}
      if(!object(body)||!onlyKeys(body,['player_id'])||!identifier(body.player_id)){response(res,400,{error:'INVALID_PAYLOAD'});return;}
      const token=randomBytes(32).toString('base64url'),hash=tokenHash(token);store.putToken(hash,body.player_id);tokens.set(hash,body.player_id);response(res,200,{token,player_id:body.player_id});return;
    }
    if(req.method==='POST'&&path==='/auth/wechat'){response(res,503,{error:'WECHAT_AUTH_NOT_CONFIGURED'});return;}
    const actor=authenticate(req);if(!actor){response(res,401,{error:'AUTH_REQUIRED'});return;}
    if(req.method==='POST'&&path==='/rooms'){
      if(!object(body)||!onlyKeys(body,['preset_id'])||!identifier(body.preset_id)||!presets.has(body.preset_id)){response(res,400,{error:'INVALID_PRESET'});return;}
      const id=randomUUID(),ready=Object.create(null) as Record<string,boolean>;ready[actor]=false;
      const room:Room={id,host_player_id:actor,players:[actor],ready,preset_id:body.preset_id,session:null,ledger:Object.create(null)};store.putRoom(room);rooms.set(id,room);response(res,200,publicRoom(room));return;
    }
    if(req.method==='POST'&&path==='/rooms/join'){
      if(!object(body)||!onlyKeys(body,['room_id'])||!identifier(body.room_id)){response(res,400,{error:'INVALID_PAYLOAD'});return;}
      const room=rooms.get(body.room_id);if(!room){response(res,404,{error:'ROOM_NOT_FOUND'});return;}
      if(!room.players.includes(actor)){
        if(room.players.length===4){response(res,409,{error:'ROOM_FULL'});return;}
        const working=structuredClone(room);working.players.push(actor);working.ready[actor]=false;
        if(working.players.length===4){const created=createSession(working.id,working.players,working.host_player_id,{...defaults(),planned_rounds:1});if(!created.ok)throw Error(created.error);working.session=created.state;}
        store.putRoom(working);Object.assign(room,working);
        broadcast(room,[]);
      }
      response(res,200,publicRoom(room));return;
    }
    const match=/^\/rooms\/([^/]+)(?:\/(ready|leave))?$/.exec(path);if(!match){response(res,404,{error:'NOT_FOUND'});return;}
    const room=rooms.get(match[1]);if(!room||!room.players.includes(actor)){response(res,404,{error:'ROOM_NOT_FOUND'});return;}
    if(req.method==='GET'&&!match[2]){response(res,200,publicRoom(room));return;}
    if(req.method==='POST'&&match[2]==='ready'){
      if(!object(body)||Object.keys(body).length!==1||typeof body.ready!=='boolean'){response(res,400,{error:'INVALID_PAYLOAD'});return;}
      const working=structuredClone(room);working.ready[actor]=body.ready;store.putRoom(working);Object.assign(room,working);broadcast(room,[]);response(res,200,publicRoom(room));return;
    }
    if(req.method==='POST'&&match[2]==='leave'){
      if(!object(body)||Object.keys(body).length){response(res,400,{error:'INVALID_PAYLOAD'});return;}
      if(room.session?.round&&room.session.round.phase!=='COMPLETED'&&room.session.round.phase!=='ABORTED'){response(res,409,{error:'ROUND_STILL_ACTIVE'});return;}
      const working=structuredClone(room);working.players=working.players.filter(p=>p!==actor);delete working.ready[actor];
      if(working.players.length&&actor===working.host_player_id)working.host_player_id=working.players[0];
      working.session=null;if(working.players.length)store.putRoom(working);else store.deleteRoom(working.id);
      Object.assign(room,working);if(!room.players.length)rooms.delete(room.id);peers.get(room.id)?.get(actor)?.close();
      broadcast(room,[]);response(res,200,publicRoom(room));return;
    }
    response(res,405,{error:'METHOD_NOT_ALLOWED'});
  }
  function authenticate(req:IncomingMessage){const auth=req.headers.authorization;return auth?.startsWith('Bearer ')?tokens.get(tokenHash(auth.slice(7))):undefined;}
  function view(room:Room,actor:string){if(room.session)return {...playerView(room.session,actor),room_id:room.id,ready:{...room.ready},content_version:contentVersion};return {ok:true,schema_version:1,session_id:room.id,room_id:room.id,revision:0,viewer_id:actor,players:[...room.players],host_player_id:room.host_player_id,ready:{...room.ready},round:null,content_version:contentVersion};}
  function publicRoom(room:Room){return {room_id:room.id,host_player_id:room.host_player_id,players:[...room.players],ready:{...room.ready},preset_id:room.preset_id,content_version:contentVersion};}
  function broadcast(room:Room,events:any[]){for(const [actor,p] of peers.get(room.id)??[])p.send({type:'STATE',view:view(room,actor),events:playerEvents(events,actor,room.players)});}
  function enqueue(id:string,job:()=>Promise<void>){const prior=queues.get(id)??Promise.resolve();const next=prior.then(job,job).catch(e=>console.error('queue error',e));queues.set(id,next);}
  function handleCommand(room:Room,actor:string,input:unknown):{receipt:Receipt;events:any[];changed:boolean}{
    const checked=validateCommand(input);
    const fail=(error:string):{receipt:Receipt;events:any[];changed:boolean}=>({receipt:{command_id:object(input)&&typeof input.command_id==='string'?input.command_id:undefined,ok:false,error,revision:room.session?.revision??0,event_ids:[]},events:[],changed:false});
    if(!checked.ok)return fail(checked.error);const c=checked.command;
    if(c.room_id!==room.id)return fail('WRONG_ROOM');
    if(!room.session)return fail('ROOM_NOT_FULL');
    const key=canonical([actor,c.command_id] as Json),fingerprint=canonical(c as unknown as Json),stored=room.ledger[key];
    if(stored)return stored.fingerprint===fingerprint?{receipt:stored.receipt,events:[],changed:false}:fail('COMMAND_ID_REUSED');
    let core:Record<string,unknown>={command_id:c.command_id,type:c.type,payload:c.payload};
    if('round_id'in c)core.round_id=c.round_id;if('turn_id'in c)core.turn_id=c.turn_id;if('proposal_id'in c)core.proposal_id=c.proposal_id;
    if(c.type==='REQUEST_START_ROUND'){
      if(actor!==room.host_player_id)return cache(fail('HOST_REQUIRED'));
      if(room.players.length!==4||room.players.some(p=>room.ready[p]!==true))return cache(fail('PLAYERS_NOT_READY'));
      if(c.payload.preset_id!==room.preset_id)return cache(fail('PRESET_MISMATCH'));
      const tiles=expandDeck(presets.get(room.preset_id)!.deck),wall=tiles.map(t=>t.id);
      for(let i=wall.length-1;i>0;i--){const j=randomInt(i+1);[wall[i],wall[j]]=[wall[j],wall[i]];}
      core={command_id:c.command_id,type:'START_NEXT_ROUND',payload:{round_id:randomUUID(),tiles,wall,dice:[randomInt(1,7),randomInt(1,7)],allow_extra_round:c.payload.allow_extra_round??false}};
    } else if(c.type==='REQUEST_END_ROUND')core.type='END_GAME';
    else if(c.type==='PROPOSE_SENTENCE'&&c.payload.resource_keys?.some(k=>!memeKeys.has(k)))return cache(fail('UNKNOWN_RESOURCE_KEY'));
    const step=reduceSession(room.session,core,actor);room.session=step.state;
    return cache({receipt:step.receipt,events:step.events,changed:step.receipt.ok&&!step.duplicate});
    function cache(result:{receipt:Receipt;events:any[];changed:boolean}){room.ledger[key]={fingerprint,receipt:result.receipt};return result;}
  }
  const host=options.host??'127.0.0.1',port=options.port??8787;
  return new Promise<{server:typeof http;port:number;close:()=>Promise<void>}>(resolveReady=>http.listen(port,host,()=>{
    const bound=http.address();resolveReady({server:http,port:typeof bound==='object'&&bound?bound.port:port,close:()=>new Promise(done=>{for(const connections of peers.values())for(const p of connections.values())p.close();http.close(()=>{store.close();done();});})});
  }));
}
function isLocalOrigin(origin:string){if(origin==='null')return true;try{const url=new URL(origin);return ['http:','https:'].includes(url.protocol)&&['localhost','127.0.0.1','[::1]'].includes(url.hostname);}catch{return false;}}
class RequestError extends Error{status:number;code:string;constructor(status:number,code:string){super(code);this.status=status;this.code=code;}}
function response(res:ServerResponse,status:number,data:unknown){if(res.headersSent)return;res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}
function readBody(req:IncomingMessage):Promise<unknown>{return new Promise((resolveBody,reject)=>{
  let size=0,chunks:Buffer[]=[];req.on('data',chunk=>{size+=chunk.length;if(size<=MAX_BODY)chunks.push(chunk);});
  req.on('end',()=>{if(size>MAX_BODY){reject(new RequestError(413,'BODY_TOO_LARGE'));return;}try{const text=Buffer.concat(chunks).toString('utf8'),value=JSON.parse(text);if(!json(value))throw Error('INVALID_JSON');resolveBody(value);}catch{reject(new RequestError(400,'INVALID_JSON'));}});req.on('error',reject);
});}
