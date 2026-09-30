import {copy, dictionary} from './json.ts';
import {activePlayer, tileRecords, type Event} from './round.ts';
import {ranking, type SessionState, type Step} from './session.ts';

/** Constructed from explicit public fields; never spread authoritative state. */
export function playerView(session:SessionState,playerId:string):Record<string,unknown> {
  if(!session.players.includes(playerId)) return {ok:false,error:'UNKNOWN_IDENTITY'};
  const view:Record<string,unknown>={ok:true,schema_version:1,session_id:session.session_id,revision:session.revision,viewer_id:playerId,players:copy(session.players),host_player_id:session.host_player_id,config:copy(session.config),round_number:session.round_counter,history:copy(session.history),ranking:ranking(session),round:null};
  const s=session.round;if(!s)return view;
  const counts=dictionary<number>(),rivers=dictionary<unknown[]>();
  for(const p of s.players){counts[p]=s.hands[p].length;rivers[p]=tileRecords(s,s.rivers[p]);}
  const pending=s.pending?{id:s.pending.id,owner_id:s.pending.owner_id,tile_ids:copy(s.pending.tile_ids),text:s.pending.text,characters:copy(s.pending.characters),resource_keys:copy(s.pending.resource_keys),reading_choices:copy(s.pending.reading_choices),votes_received:Object.keys(s.pending.votes).length,has_voted:Object.hasOwn(s.pending.votes,playerId)}:null;
  view.round={round_id:s.round_id,phase:s.phase,turn_id:s.turn_id,dealer_id:s.players[s.dealer_seat],active_player_id:activePlayer(s),dice:copy(s.setup.dice),hand:tileRecords(s,s.hands[playerId]),hand_counts:counts,rivers,wall_remaining:s.wall.length-s.wall_cursor,sentences:copy(s.sentences),sentence_points:copy(s.scores),pending_sentence:pending,winner_id:s.winner_id,end_reason:s.end_reason,rating_bonus_thirds:copy(s.rating_bonus_thirds),result:copy(s.result)};
  return view;
}
export function playerEvents(events:Event[],playerId:string,players:string[]) {
  if(!players.includes(playerId))return [];
  return events.map(e=>({id:e.id,revision:e.revision,round_id:e.round_id,type:e.type,data:{...copy(e.public),...copy(Object.hasOwn(e.private,playerId)?e.private[playerId]:{})}}));
}
export function delivery(session:SessionState,step:Step,playerId:string){return {view:playerView(session,playerId),events:playerEvents(step.events,playerId,session.players)};}
