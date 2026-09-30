import {createHash} from 'node:crypto';
import type {Socket} from 'node:net';
import type {IncomingMessage} from 'node:http';

const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export class Peer {
  private buffer=Buffer.alloc(0);private closed=false;private socket:Socket;
  onMessage:(text:string)=>void=()=>{};onClose:()=>void=()=>{};
  constructor(socket:Socket,head?:Buffer){this.socket=socket;socket.on('data',chunk=>this.feed(chunk));socket.on('close',()=>{this.closed=true;this.onClose();});socket.on('error',()=>this.close());if(head?.length)queueMicrotask(()=>this.feed(head));}
  send(value:unknown){if(!this.closed)this.frame(1,Buffer.from(JSON.stringify(value)));}
  close(){if(this.closed)return;this.closed=true;this.frame(8,Buffer.alloc(0));this.socket.end();}
  private frame(op:number,data:Buffer){
    const length=data.length;let header:Buffer;
    if(length<126)header=Buffer.from([128|op,length]);
    else if(length<=65535){header=Buffer.alloc(4);header[0]=128|op;header[1]=126;header.writeUInt16BE(length,2);}
    else{header=Buffer.alloc(10);header[0]=128|op;header[1]=127;header.writeBigUInt64BE(BigInt(length),2);}
    this.socket.write(Buffer.concat([header,data]));
  }
  private feed(chunk:Buffer){
    this.buffer=Buffer.concat([this.buffer,chunk]);
    while(this.buffer.length>=2){
      const a=this.buffer[0],b=this.buffer[1],op=a&15,masked=(b&128)!==0;let length=b&127,head=2;
      if((a&128)===0||!masked){this.close();return;}
      if(length===126){if(this.buffer.length<4)return;length=this.buffer.readUInt16BE(2);head=4;}
      if(length===127){this.close();return;}
      if(length>16*1024){this.close();return;}
      if(this.buffer.length<head+4+length)return;
      const mask=this.buffer.subarray(head,head+4),data=Buffer.from(this.buffer.subarray(head+4,head+4+length));
      this.buffer=this.buffer.subarray(head+4+length);for(let i=0;i<data.length;i++)data[i]^=mask[i%4];
      if(op===8){this.close();return;}if(op===9){this.frame(10,data);continue;}if(op!==1){this.close();return;}
      try{this.onMessage(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{this.close();return;}
    }
  }
}
export function upgrade(req:IncomingMessage,socket:Socket,head?:Buffer):Peer|null{
  const key=req.headers['sec-websocket-key'];
  const connection=req.headers.connection;
  if(req.url!=='/play'||req.headers.upgrade?.toLowerCase()!=='websocket'||typeof connection!=='string'||!connection.toLowerCase().split(',').map(x=>x.trim()).includes('upgrade')||req.headers['sec-websocket-version']!=='13'||typeof key!=='string'||!/^[A-Za-z0-9+/]{22}==$/.test(key)){socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');return null;}
  const accept=createHash('sha1').update(key+GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return new Peer(socket,head);
}
