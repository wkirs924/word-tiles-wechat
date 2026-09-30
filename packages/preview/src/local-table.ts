import {createSession,reduceSession,type SessionState,type Receipt} from '../../core/src/session.ts';
import {playerView,playerEvents} from '../../core/src/projection.ts';
import {expandDeck,type DeckEntry} from '../../core/src/setup.ts';
import {defaults} from '../../core/src/rules.ts';

export const SEATS=['east','south','west','north'] as const;
export type Seat=typeof SEATS[number];
export interface LocalFeedback {receipt:Receipt;events:ReturnType<typeof playerEvents>}

const MAX_SEED=2147483646;
/** Entropy belongs to the preview adapter; the rules core remains replayable from its seed. */
function randomRoundSeed():number {
  if(typeof globalThis.crypto?.getRandomValues==='function') {
    const value=new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0]%MAX_SEED+1;
  }
  return Math.floor(Math.random()*MAX_SEED)+1;
}

/** One-device demonstration adapter. Its full state never leaves this instance. */
export class LocalTable {
  private state:SessionState;
  private viewer:Seat='east';
  private covered=false;
  private serial=0;
  private deck:readonly DeckEntry[];
  private roundSerial=0;
  private readonly seedSource:()=>number;
  public feedback:LocalFeedback|null=null;
  constructor(deck:readonly DeckEntry[],seedSource:()=>number=randomRoundSeed) {
    this.deck=deck;
    this.seedSource=seedSource;
    const created=createSession('local-preview',SEATS.slice(),'east',{...defaults(),planned_rounds:1});
    if(!created.ok)throw Error(created.error);
    this.state=created.state;
    const result=this.nextRound();
    if(!result.receipt.ok)throw Error(result.receipt.error);
  }
  get seat():Seat{return this.viewer;}
  get handoffCovered(){return this.covered;}
  get roundNumber(){return this.state.round_counter;}
  setNextDeck(deck:readonly DeckEntry[]){this.deck=deck;}
  switchSeat(seat:Seat) {if(!SEATS.includes(seat))throw Error('UNKNOWN_IDENTITY');this.viewer=seat;this.covered=true;this.feedback=null;}
  confirmHandoff(){this.covered=false;}
  view():Record<string,unknown>|null{return this.covered?null:playerView(this.state,this.viewer);}
  nextRound(allowExtra=false):LocalFeedback {
    if(this.covered)return this.blocked('HANDOFF_COVERED');
    const id=`round-${++this.roundSerial}`;
    return this.submit('START_NEXT_ROUND',{round_id:id,tiles:expandDeck(this.deck),seed:this.seedSource(),allow_extra_round:allowExtra});
  }
  draw(){return this.submit('DRAW_TILE',{});}
  discard(tileId:string){return this.submit('DISCARD_TILE',{tile_id:tileId});}
  propose(tileIds:string[],resourceKeys:string[]=[]){return this.submit('PROPOSE_SENTENCE',{tile_ids:tileIds,resource_keys:resourceKeys});}
  vote(approve:boolean,rating:number){return this.submit('SUBMIT_VOTE',{approve,rating});}
  endRound(){return this.submit('END_GAME',{});}
  private blocked(error:string):LocalFeedback {return {receipt:{ok:false,error,revision:0,event_ids:[]},events:[]};}
  private submit(type:string,payload:Record<string,unknown>):LocalFeedback {
    if(this.covered)return this.blocked('HANDOFF_COVERED');
    const command:Record<string,unknown>={command_id:`local-${++this.serial}`,type,payload};
    if(this.state.round){command.round_id=this.state.round.round_id;
      if(['DRAW_TILE','DISCARD_TILE','PROPOSE_SENTENCE'].includes(type))command.turn_id=this.state.round.turn_id;
      if(type==='SUBMIT_VOTE'&&this.state.round.pending)command.proposal_id=this.state.round.pending.id;
    }
    const step=reduceSession(this.state,command,this.viewer);
    this.state=step.state;
    const feedback={receipt:step.receipt,events:playerEvents(step.events,this.viewer,this.state.players)};
    this.feedback=feedback;
    return feedback;
  }
}
