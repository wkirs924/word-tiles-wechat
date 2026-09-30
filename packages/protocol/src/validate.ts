import {identifier,integer,json,object,onlyKeys} from '../../core/src/json.ts';
import {PROTOCOL,type PlayerCommand} from './commands.ts';

export type Validation={ok:true;command:PlayerCommand}|{ok:false;error:string};
export function validateCommand(input:unknown):Validation {
  if(!json(input)||!object(input)||!onlyKeys(input,['protocol','room_id','command_id','type','round_id','turn_id','proposal_id','payload']))return {ok:false,error:'INVALID_COMMAND'};
  if(input.protocol!==PROTOCOL||!identifier(input.room_id)||!identifier(input.command_id)||typeof input.type!=='string'||!object(input.payload))return {ok:false,error:'INVALID_COMMAND'};
  const p=input.payload;
  if(input.type==='REQUEST_START_ROUND'){
    if(!onlyKeys(p,['preset_id','allow_extra_round'])||!identifier(p.preset_id)||('allow_extra_round'in p&&typeof p.allow_extra_round!=='boolean')||'round_id'in input||'turn_id'in input||'proposal_id'in input)return {ok:false,error:'INVALID_PAYLOAD'};
  } else if(input.type==='DRAW_TILE'){
    if(Object.keys(p).length||!turn(input)||'proposal_id'in input)return {ok:false,error:'INVALID_PAYLOAD'};
  } else if(input.type==='DISCARD_TILE'){
    if(Object.keys(p).length!==1||!identifier(p.tile_id)||!turn(input)||'proposal_id'in input)return {ok:false,error:'INVALID_PAYLOAD'};
  } else if(input.type==='PROPOSE_SENTENCE'){
    if(!onlyKeys(p,['tile_ids','reading_choices','resource_keys'])||!Array.isArray(p.tile_ids)||!p.tile_ids.every(identifier)||!turn(input)||'proposal_id'in input)return {ok:false,error:'INVALID_PAYLOAD'};
    if('resource_keys'in p&&(!Array.isArray(p.resource_keys)||!p.resource_keys.every(identifier)))return {ok:false,error:'INVALID_PAYLOAD'};
    if('reading_choices'in p&&(!Array.isArray(p.reading_choices)||!p.reading_choices.every(r=>r===null||(object(r)&&Object.keys(r).length===1&&integer(r.tone)&&r.tone>=1&&r.tone<=4))))return {ok:false,error:'INVALID_PAYLOAD'};
  } else if(input.type==='SUBMIT_VOTE'){
    if(!identifier(input.round_id)||!identifier(input.proposal_id)||'turn_id'in input||Object.keys(p).length!==2||typeof p.approve!=='boolean'||!integer(p.rating))return {ok:false,error:'INVALID_PAYLOAD'};
  } else if(input.type==='REQUEST_END_ROUND'){
    if(!identifier(input.round_id)||'turn_id'in input||'proposal_id'in input||Object.keys(p).length)return {ok:false,error:'INVALID_PAYLOAD'};
  } else return {ok:false,error:'UNKNOWN_ACTION'};
  return {ok:true,command:input as PlayerCommand};
}
function turn(x:Record<string,unknown>){return identifier(x.round_id)&&integer(x.turn_id)&&x.turn_id>0;}
