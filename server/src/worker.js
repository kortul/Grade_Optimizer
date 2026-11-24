import { DurableObject } from 'cloudflare:workers';
import {
  MAX_IDLE_MS,MAX_MESSAGE_CHARS,MAX_MESSAGE_RATE,MAX_PLAYERS,
  normalizeState,sanitizeName
} from './protocol.js';

const ALLOWED_ORIGIN='https://kortul.github.io';
const PUBLIC_RESORT='grade-optimizer-public-resort';

export class PublicResort extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.ctx=ctx;}

  async fetch(request){
    const url=new URL(request.url);
    if(url.pathname==='/status'&&request.method==='GET'){
      return Response.json({online:this.activeSockets().filter(entry=>entry.player.name).length,maxPlayers:MAX_PLAYERS});
    }
    if(url.pathname!=='/ws')return new Response('Not found',{status:404});
    if(request.headers.get('Upgrade')!=='websocket')return new Response('WebSocket upgrade required',{status:426,headers:{Upgrade:'websocket'}});
    const origin=request.headers.get('Origin');
    const localDev=/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin||'');
    if(origin!==ALLOWED_ORIGIN&&!localDev)return new Response('Origin not allowed',{status:403});
    const existing=this.activeSockets();
    const pair=new WebSocketPair(),client=pair[0],server=pair[1];
    if(existing.length>=MAX_PLAYERS){
      try{server.accept();server.send(JSON.stringify({t:'full'}));}catch{}
      try{server.close(1013,'Shared resort is full');}catch{}
      return new Response(null,{status:101,webSocket:client});
    }
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      id:crypto.randomUUID(),name:'',state:null,lastSeen:Date.now(),
      rateStart:Date.now(),rateCount:0,left:false
    });
    return new Response(null,{status:101,webSocket:client});
  }

  activeSockets(){
    const now=Date.now(),result=[];
    for(const socket of this.ctx.getWebSockets()){
      let player;try{player=socket.deserializeAttachment();}catch{player=null;}
      if(!player||(player.lastSeen&&now-player.lastSeen>MAX_IDLE_MS)){
        try{socket.close(1001,'Idle connection');}catch{}
        continue;
      }
      result.push({socket,player});
    }
    return result;
  }

  send(socket,message){try{socket.send(JSON.stringify(message));}catch{try{socket.close(1011,'Send failed');}catch{}}}
  publicPlayer(player){return{id:player.id,name:player.name,state:player.state};}

  webSocketMessage(socket,raw){
    let player;try{player=socket.deserializeAttachment();}catch{return;}
    if(!player||player.left)return;
    if(typeof raw!=='string'||raw.length>MAX_MESSAGE_CHARS){try{socket.close(1009,'Message too large');}catch{}return;}
    const now=Date.now();
    if(!player.rateStart||now-player.rateStart>=1000){player.rateStart=now;player.rateCount=0;}
    player.rateCount=(player.rateCount||0)+1;
    if(player.rateCount>MAX_MESSAGE_RATE){try{socket.close(1008,'Message rate exceeded');}catch{}return;}
    let msg;try{msg=JSON.parse(raw);}catch{return;}
    if(!msg||typeof msg!=='object'||Array.isArray(msg))return;

    if(msg.t==='hello'){
      player.name=sanitizeName(msg.name);player.lastSeen=now;socket.serializeAttachment(player);
      const peers=this.activeSockets().filter(entry=>entry.socket!==socket&&entry.player.name).map(entry=>this.publicPlayer(entry.player));
      this.send(socket,{t:'welcome',id:player.id,players:peers});
      const joined={t:'join',player:{id:player.id,name:player.name}};
      for(const entry of this.activeSockets())if(entry.socket!==socket&&entry.player.name)this.send(entry.socket,joined);
      return;
    }
    if(msg.t!=='state'||!player.name)return;
    const state=normalizeState(msg.state);if(!state)return;
    player.state=state;player.lastSeen=now;socket.serializeAttachment(player);
    const packet={t:'state',player:this.publicPlayer(player)};
    for(const entry of this.activeSockets())if(entry.socket!==socket&&entry.player.name)this.send(entry.socket,packet);
  }

  webSocketClose(socket){this.announceLeave(socket);}
  webSocketError(socket){this.announceLeave(socket);}
  announceLeave(socket){
    let player;try{player=socket.deserializeAttachment();}catch{player=null;}
    if(!player||player.left||!player.id)return;
    player.left=true;try{socket.serializeAttachment(player);}catch{}
    const packet={t:'leave',id:player.id};
    for(const entry of this.activeSockets())if(entry.socket!==socket&&entry.player.name)this.send(entry.socket,packet);
  }
}

export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(path!=='/ws'&&path!=='/status')return new Response('Not found',{status:404});
    const id=env.PUBLIC_RESORT.idFromName(PUBLIC_RESORT);
    return env.PUBLIC_RESORT.get(id).fetch(request);
  }
};
