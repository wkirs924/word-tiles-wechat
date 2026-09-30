import {_decorator,Color,Component,Graphics,Label,Node,UITransform} from 'cc';
import {LocalTable,SEATS,type Seat} from './generated/LocalTable';
import {DECK_PRESETS} from './generated/deckPresets';
import {ranking} from './generated/core/scoring';
const {ccclass}=_decorator;

const NAME:Record<string,string>={east:'东 · 房主',south:'南',west:'西',north:'北'};
const C={deep:'#091d23',table:'#113b38',panel:'#183d3a',panel2:'#204b45',paper:'#f4eddc',gold:'#e4c086',muted:'#a6bbb0',ink:'#223c39',green:'#80ffb0',red:'#e49a92'};
function color(hex:string,a=255){const n=parseInt(hex.slice(1),16);return new Color((n>>16)&255,(n>>8)&255,n&255,a);}
function seatScoreThirds(round:any,id:Seat){
  return round.result?.scores?.[id]?.total.numerator ??
    3*(round.sentence_points?.[id]??0)+(round.rating_bonus_thirds?.[id]??0);
}
function displayScore(numerator:number){return `${numerator>0?'+':''}${(numerator/3).toFixed(2)}`;}

@ccclass('TableBootstrap')
export class TableBootstrap extends Component {
  private model!:LocalTable;
  private board:Node|null=null;
  private selected:string[]=[];
  private withMeme=false;
  private choice:boolean|null=null;
  private rating=0;
  private presetIndex=0;
  private status='四人本地轮流试玩 · 点击座位交接';

  onLoad(){
    if(!(Object as any).hasOwn)(Object as any).hasOwn=(o:object,k:PropertyKey)=>Object.prototype.hasOwnProperty.call(o,k);
    this.model=new LocalTable(DECK_PRESETS[0].deck);
    this.render();
  }
  private nodeAt(parent:Node,name:string,x:number,y:number,w:number,h:number){
    const node=new Node(name);node.layer=1<<13;node.setParent(parent);node.setPosition(x,y,0);
    const t=node.addComponent(UITransform);t.setContentSize(w,h);return node;
  }
  private block(parent:Node,name:string,x:number,y:number,w:number,h:number,fill:string,border?:string,radius=18){
    const node=this.nodeAt(parent,name,x,y,w,h),g=node.addComponent(Graphics);
    g.fillColor=color(fill);g.roundRect(-w/2,-h/2,w,h,radius);g.fill();
    if(border){g.strokeColor=color(border);g.lineWidth=2;g.roundRect(-w/2,-h/2,w,h,radius);g.stroke();}
    return node;
  }
  private label(parent:Node,name:string,value:string,x:number,y:number,w:number,h:number,size=22,ink=C.paper,bold=false){
    const node=this.nodeAt(parent,name,x,y,w,h),text=node.addComponent(Label);
    text.string=value;text.fontSize=size;text.lineHeight=size+6;text.color=color(ink);
    text.horizontalAlign=Label.HorizontalAlign.CENTER;text.verticalAlign=Label.VerticalAlign.CENTER;
    text.isBold=bold;return node;
  }
  private button(parent:Node,name:string,value:string,x:number,y:number,w:number,h:number,onTap:()=>void,accent=false,disabled=false){
    const node=this.block(parent,name,x,y,w,h,disabled?C.panel:C.panel2,accent?C.gold:C.muted,12);
    this.label(node,`${name}-label`,value,0,0,w-12,h-8,Math.min(22,h*.42),disabled?C.muted:accent?C.gold:C.paper,true);
    if(!disabled)node.on(Node.EventType.TOUCH_END,onTap,this);
    return node;
  }
  private action(result:{receipt:{ok:boolean;error:string};events:{type:string}[]},message:string){
    if(result.receipt.ok){this.selected=[];this.choice=null;this.rating=0;this.status=message;}
    else this.status=`操作未完成：${result.receipt.error}`;
    this.render();
  }
  private render(){
    this.board?.destroy();
    const canvas=this.node.getComponent(UITransform),size=canvas?.contentSize;
    this.board=this.nodeAt(this.node,'TableBoard',0,0,1280,720);
    this.board.setScale(Math.min((size?.width||1280)/1280,(size?.height||720)/720,1.5));
    const root=this.board;
    this.block(root,'felt',0,0,1280,720,C.deep,undefined,0);
    this.label(root,'brand','字 有 意 思',-468,318,270,48,33,C.gold,true);
    this.label(root,'mode',`${DECK_PRESETS[this.presetIndex].title} 字库  ·  本地四席轮流交接`,-154,318,380,36,17,C.muted);
    this.label(root,'round',`第 ${this.model.roundNumber} 局`,488,318,180,36,18,C.gold);
    if(this.model.handoffCovered){this.cover(root);return;}
    const view=this.model.view() as any;
    if(!view||!view.ok){this.label(root,'invalid','视图不可用',0,0,400,60,28,C.red);return;}
    const r=view.round;
    this.block(root,'table',0,48,792,398,C.table,C.gold,210);
    this.block(root,'table-inner',0,48,680,286,C.panel,undefined,145);
    this.label(root,'wall',`牌墙  ${r.wall_remaining}  张  ·  骰子  ${r.dice.join(' + ')}`,0,184,440,32,20,C.gold);
    const index=SEATS.indexOf(this.model.seat);
    this.seat(root,SEATS[index],0,-176,290,64,r);
    this.seat(root,SEATS[(index+1)%4],486,116,176,84,r);
    this.seat(root,SEATS[(index+2)%4],0,245,270,64,r);
    this.seat(root,SEATS[(index+3)%4],-486,116,176,84,r);
    this.center(root,r);
    this.hand(root,r);
    this.controls(root,r);
    this.label(root,'status',this.status,0,-345,1110,30,17,C.muted);
  }
  private cover(root:Node){
    this.block(root,'cover',0,0,920,520,C.panel,C.gold,30);
    this.label(root,'cover-title','请将设备交给下一位玩家',0,112,760,72,40,C.gold,true);
    this.label(root,'cover-seat',`接手座位：${NAME[this.model.seat]}`,0,33,500,56,28,C.paper);
    this.label(root,'cover-hint','上一位玩家的手牌已遮住，确认后才显示新手牌。',0,-39,760,42,20,C.muted);
    this.button(root,'confirm','我已接手 · 查看手牌',0,-134,340,68,()=>{this.model.confirmHandoff();this.status='已交接';this.render();},true);
  }
  private seat(root:Node,id:Seat,x:number,y:number,w:number,h:number,r:any){
    const active=r.active_player_id===id,viewer=this.model.seat===id;
    const node=this.block(root,`seat-${id}`,x,y,w,h,viewer?C.panel2:C.panel,active?C.gold:undefined,14);
    const avatar=this.nodeAt(node,`avatar-${id}`,-w/2+30,0,46,46),g=avatar.addComponent(Graphics);
    g.fillColor=color(C.table);g.strokeColor=color(C.gold);g.lineWidth=2;g.circle(0,0,23);g.fill();g.stroke();
    this.label(avatar,`avatar-glyph-${id}`,NAME[id][0],0,0,42,42,23,C.gold,true);
    const name=id==='east'?'东 · 房主':NAME[id],marker=viewer?' · 我':'';
    const score=seatScoreThirds(r,id),scoreText=`${r.result?'结算分':'已得分'} ${displayScore(score)}`;
    if(h<80){
      this.label(node,`name-${id}`,`${name}${marker} · ${r.hand_counts[id]} 张${active?' ●':''}`,30,14,w-69,25,17,active?C.gold:C.paper,true);
      this.label(node,`score-${id}`,scoreText,30,-15,w-69,22,15,score<0?C.red:C.green,true);
    }else{
      this.label(node,`name-${id}`,`${name}${marker}${active?' ●':''}`,30,22,w-69,24,16,active?C.gold:C.paper,true);
      this.label(node,`count-${id}`,`${r.hand_counts[id]} 张`,30,0,w-69,20,13,C.muted);
      this.label(node,`score-${id}`,scoreText,30,-23,w-69,20,14,score<0?C.red:C.green,true);
    }
    node.on(Node.EventType.TOUCH_END,()=>{if(id===this.model.seat)return;this.model.switchSeat(id);this.selected=[];this.choice=null;this.render();},this);
  }
  private center(root:Node,r:any){
    const phase=r.phase;
    if(phase==='AWAIT_VOTES'&&r.pending_sentence){
      const p=r.pending_sentence;
      this.label(root,'sentence','本轮出句',0,136,340,36,20,C.muted);
      this.label(root,'text',p.text,0,86,590,62,42,C.paper,true);
      this.label(root,'meme',p.resource_keys.length?`附表情  ${p.resource_keys.length} 张（示意）`:'无图 · 只判断认可',0,35,500,32,19,C.gold);
      this.label(root,'progress',`投票进度  ${p.votes_received} / 3`,0,-10,370,34,22,C.green);
      this.label(root,'owner',`出句者  ${NAME[p.owner_id]}`,0,-48,330,30,17,C.muted);
    } else if(phase==='COMPLETED'){
      const winner=r.winner_id?`${NAME[r.winner_id]} 胡牌`:'牌墙耗尽 · 流局';
      this.label(root,'finished',winner,0,145,580,50,32,C.gold,true);
      this.label(root,'round-rank-title','本局排名',0,104,300,28,18,C.muted);
      const totals:Record<string,number>={};
      for(const seat of SEATS)totals[seat]=r.result.scores[seat].total.numerator;
      ranking(SEATS,totals).forEach((entry,i)=>this.label(root,`rank-${i}`,`${entry.rank}  ${NAME[entry.player_id]}   ${displayScore(entry.total.numerator)} 分`,0,65-i*45,530,34,21,C.paper));
    } else {
      this.label(root,'turn',phase==='MUST_DISCARD'?'句子未通过，请弃一张':phase==='AWAIT_DRAW'?'等待摸牌':'轮到你表达',0,110,550,54,30,C.gold,true);
      const last=r.sentences[r.sentences.length-1];
      this.label(root,'last-sentence',last?`上一句  ${last.text}`:'依次点击手牌，组成一句有意思的话',0,45,580,50,22,C.paper);
      this.label(root,'phase',`当前行动：${NAME[r.active_player_id]}  ·  ${phase}`,0,-15,520,36,18,C.muted);
    }
  }
  private hand(root:Node,r:any){
    const hand=r.hand as {id:string;glyph:string}[],count=hand.length;
    this.label(root,'hand-title',`我的手牌  ${count} 张`,-505,-181,210,34,20,C.gold,true);
    if(!count)return;
    const width=Math.min(70,Math.max(47,(1130-7*(count-1))/count)),gap=7;
    const start=-((width+gap)*count-gap)/2+width/2;
    hand.forEach((tile,i)=>{
      const chosen=this.selected.includes(tile.id),x=start+i*(width+gap),y=chosen?-271:-282;
      const node=this.block(root,`tile-${i}`,x,y,width,chosen?92:78,chosen?C.gold:C.paper,chosen?C.green:C.gold,8);
      this.label(node,`glyph-${i}`,tile.glyph,0,0,width-5,68,Math.min(34,width*.6),C.ink,true);
      node.on(Node.EventType.TOUCH_END,()=>this.toggleTile(tile.id),this);
    });
  }
  private controls(root:Node,r:any){
    if(r.phase==='COMPLETED'||r.phase==='ABORTED'){
      if(this.model.seat==='east'){
        this.button(root,'deck',`下局主题：${DECK_PRESETS[this.presetIndex].title}`,175,-176,240,58,()=>{this.presetIndex=(this.presetIndex+1)%DECK_PRESETS.length;this.render();});
        this.button(root,'next','开始下一局',447,-176,230,58,()=>{this.model.setNextDeck(DECK_PRESETS[this.presetIndex].deck);this.action(this.model.nextRound(true),'下一局已开始');},true);
      }
      return;
    }
    if(r.phase==='AWAIT_VOTES'){
      const p=r.pending_sentence;if(!p)return;
      if(p.owner_id===this.model.seat){this.label(root,'wait','请交接给其余三位玩家投票',0,-91,520,32,18,C.gold);return;}
      if(p.has_voted){this.label(root,'voted','你已投票，请交接下一位',0,-91,520,32,18,C.green);return;}
      this.button(root,'approve','认可',-165,-90,140,55,()=>{this.choice=true;this.render();},this.choice===true);
      this.button(root,'oppose','反对',-5,-90,140,55,()=>{this.choice=false;this.render();},this.choice===false);
      if(p.resource_keys.length){
        this.label(root,'rate-caption','表情评分',218,-59,160,28,17,C.muted);
        for(let n=0;n<=3;n++)this.button(root,`rate-${n}`,String(n),150+n*49,-99,44,48,()=>{this.rating=n;this.render();},this.rating===n);
      }
      this.button(root,'vote-submit','提交投票',0,-145,210,50,()=>this.action(this.model.vote(this.choice!,p.resource_keys.length?this.rating:0),'投票已提交'),true,this.choice===null);
      return;
    }
    if(r.active_player_id!==this.model.seat){this.label(root,'handoff-hint',`请交接给 ${NAME[r.active_player_id]}`,0,-91,520,32,18,C.gold);return;}
    if(r.phase==='AWAIT_DRAW'){
      this.button(root,'draw','摸一张',0,-91,210,60,()=>this.action(this.model.draw(),'已摸牌'),true);return;
    }
    const size=this.selected.length;
    this.label(root,'draft',size?`已选 ${size} 字  ${this.selected.map(id=>(r.hand as any[]).find(t=>t.id===id)?.glyph).join('')}`:'点击下方手牌，可按选择顺序造句',0,-72,590,32,19,C.paper);
    if(r.phase==='AWAIT_ACTION')this.button(root,'meme',this.withMeme?'示意表情 ✓':'添加示意表情',-202,-129,190,50,()=>{this.withMeme=!this.withMeme;this.render();},this.withMeme);
    this.button(root,'discard','弃一张',r.phase==='MUST_DISCARD'?-106:16,-129,180,50,()=>this.action(this.model.discard(this.selected[0]),'已弃牌，请交接'),false,size!==1);
    if(r.phase==='AWAIT_ACTION')this.button(root,'propose','出句 · 请评判',231,-129,210,50,()=>this.action(this.model.propose(this.selected,this.withMeme?['demo.cheer']:[]),'句子已提交，请交接投票'),true,size<2);
  }
  private toggleTile(id:string){const i=this.selected.indexOf(id);if(i<0)this.selected.push(id);else this.selected.splice(i,1);this.render();}
}
