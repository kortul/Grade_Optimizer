import { DurableObject } from 'cloudflare:workers';
import {
  MAX_IDLE_MS,MAX_MESSAGE_CHARS,MAX_MESSAGES_PER_SECOND,MAX_PLAYERS,
  appendSharedMarker,normalizeMarker,normalizeMeasurement,normalizeState,pruneSharedMarkers,sanitizeClientId,sanitizeName
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
    const requestedClientId=sanitizeClientId(url.searchParams.get('clientId'));
    const previous=this.activeSockets();
    if(requestedClientId){
      for(const entry of previous){
        if(entry.player.clientId!==requestedClientId)continue;
        // Reconnects reuse the client ID; do not broadcast a leave that would
        // make every viewer destroy and recreate this skier.
        this.announceLeave(entry.socket,{broadcast:false});
        try{entry.socket.close(4001,'Session replaced by reconnect');}catch{}
      }
    }
    const existing=this.activeSockets();
    this.assignMissingSlots(existing);
    const pair=new WebSocketPair(),client=pair[0],server=pair[1];
    if(existing.length>=MAX_PLAYERS){
      try{server.accept();server.send(JSON.stringify({t:'full'}));}catch{}
      try{server.close(1013,'Shared resort is full');}catch{}
      return new Response(null,{status:101,webSocket:client});
    }
    const occupiedSlots=new Set(existing.map(entry=>entry.player.slot).filter(slot=>Number.isInteger(slot)&&slot>=0&&slot<MAX_PLAYERS));
    let slot=0;while(occupiedSlots.has(slot)&&slot<MAX_PLAYERS)slot++;
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      id:requestedClientId||crypto.randomUUID(),clientId:requestedClientId,slot,name:'',state:null,lastSeen:Date.now(),
      rateStart:Date.now(),rateCount:0,acceptedStates:0,rejectedStates:0,stateMessagesReceived:0,
      lastStateAt:0,lastStateSeq:0,lastStateRejectReason:'',lastMessageAt:0,
      peerCount:0,lastBroadcastPeers:0,broadcastAttempts:0,left:false
    });
    return new Response(null,{status:101,webSocket:client});
  }

  assignMissingSlots(entries){
    const used=new Set(entries.map(entry=>entry.player.slot).filter(slot=>Number.isInteger(slot)&&slot>=0&&slot<MAX_PLAYERS));
    for(const entry of entries){
      if(Number.isInteger(entry.player.slot)&&entry.player.slot>=0&&entry.player.slot<MAX_PLAYERS)continue;
      let slot=0;while(used.has(slot)&&slot<MAX_PLAYERS)slot++;
      if(slot>=MAX_PLAYERS)continue;
      entry.player.slot=slot;used.add(slot);
      try{entry.socket.serializeAttachment(entry.player);this.send(entry.socket,{t:'slot',slot});}catch{}
    }
  }

  activeSockets(){
    const now=Date.now(),result=[];
    for(const socket of this.ctx.getWebSockets()){
      let player;try{player=socket.deserializeAttachment();}catch{player=null;}
      if(!player){try{socket.close(1001,'Missing player attachment');}catch{}continue;}
      if(player.left)continue;
      if(player.lastSeen&&now-player.lastSeen>MAX_IDLE_MS){
        this.announceLeave(socket);
        try{socket.close(1001,'Idle connection');}catch{}
        continue;
      }
      result.push({socket,player});
    }
    return result;
  }

  send(socket,message){try{socket.send(JSON.stringify(message));}catch{try{socket.close(1011,'Send failed');}catch{}}}
  publicPlayer(player){return{id:player.id,slot:player.slot,name:player.name,state:player.state};}

  async webSocketMessage(socket,raw){
    let player;try{player=socket.deserializeAttachment();}catch{return;}
    if(!player||player.left)return;
    if(typeof raw!=='string'||raw.length>MAX_MESSAGE_CHARS){try{socket.close(1009,'Message too large');}catch{}return;}
    const now=Date.now();
    if(!player.rateStart||now-player.rateStart>=1000){player.rateStart=now;player.rateCount=0;}
    player.rateCount=(player.rateCount||0)+1;
    if(player.rateCount>MAX_MESSAGES_PER_SECOND){try{socket.close(1008,'Message rate exceeded');}catch{}return;}
    let msg;try{msg=JSON.parse(raw);}catch{return;}
    if(!msg||typeof msg!=='object'||Array.isArray(msg))return;

    if(msg.t==='ping'){
      player.lastSeen=now;player.lastMessageAt=now;socket.serializeAttachment(player);
      const peers=this.activeSockets().filter(entry=>entry.socket!==socket&&entry.player.name);
      player.peerCount=peers.length;socket.serializeAttachment(player);
      this.send(socket,{
        t:'pong',at:now,
        acceptedStates:Number(player.acceptedStates)||0,
        rejectedStates:Number(player.rejectedStates)||0,
        lastStateAt:Number(player.lastStateAt)||0,
        lastStateSeq:Number(player.lastStateSeq)||0,
        stateMessagesReceived:Number(player.stateMessagesReceived)||0,
        lastMessageAt:Number(player.lastMessageAt)||0,
        lastStateRejectReason:String(player.lastStateRejectReason||''),
        peerCount:peers.length,
        broadcastPeers:Number(player.lastBroadcastPeers)||0,
        broadcastAttempts:Number(player.broadcastAttempts)||0
      });
      const presence={t:'presence',id:player.id,name:player.name};
      for(const entry of peers)this.send(entry.socket,presence);
      return;
    }

    if(msg.t==='hello'){
      const messageClientId=sanitizeClientId(msg.clientId);
      if(player.clientId&&messageClientId&&player.clientId!==messageClientId){
        try{socket.close(1008,'Session identity mismatch');}catch{}
        return;
      }
      if(!player.clientId&&messageClientId)player.clientId=messageClientId;
      player.name=sanitizeName(msg.name);player.lastSeen=now;player.lastMessageAt=now;socket.serializeAttachment(player);
      const markerUpdate=await this.ctx.storage.transaction(async transaction=>{
        const storedMarkers=await transaction.get('sharedMarkers');
        const update=pruneSharedMarkers(storedMarkers);
        await transaction.put('sharedMarkers',update.markers);
        return update;
      });
      const recipients=this.activeSockets().filter(entry=>entry.player.name);
      for(const entry of recipients){
        for(const removed of markerUpdate.removedMarkers)this.send(entry.socket,{t:'marker-remove',id:removed.id});
      }
      const storedMeasurements=await this.ctx.storage.get('sharedMeasurements');
      const measurements=Array.isArray(storedMeasurements)?storedMeasurements.slice(-MAX_PLAYERS):[];
      const peers=recipients.filter(entry=>entry.socket!==socket).map(entry=>this.publicPlayer(entry.player));
      this.send(socket,{t:'welcome',id:player.id,slot:player.slot,players:peers,markers:markerUpdate.markers,measurements});
      const joined={t:'join',player:{id:player.id,slot:player.slot,name:player.name}};
      for(const entry of this.activeSockets())if(entry.socket!==socket&&entry.player.name)this.send(entry.socket,joined);
      return;
    }
    if(msg.t==='marker'){
      if(!player.name)return;
      const marker=normalizeMarker(msg.marker,player.name,player.id);
      if(!marker){
        player.lastStateRejectReason='invalid-marker';
        player.lastSeen=now;player.lastMessageAt=now;socket.serializeAttachment(player);
        return;
      }
      const markerUpdate=await this.ctx.storage.transaction(async transaction=>{
        const storedMarkers=await transaction.get('sharedMarkers');
        const update=appendSharedMarker(storedMarkers,marker);
        await transaction.put('sharedMarkers',update.markers);
        return update;
      });
      player.lastSeen=now;player.lastMessageAt=now;socket.serializeAttachment(player);
      const recipients=this.activeSockets().filter(entry=>entry.player.name);
      for(const entry of recipients){
        // Confirm the new flag first; stale flags are removed only after its creation is broadcast.
        this.send(entry.socket,{t:'marker',marker:markerUpdate.acceptedMarker});
        for(const removed of markerUpdate.removedMarkers)this.send(entry.socket,{t:'marker-remove',id:removed.id});
      }
      return;
    }
    if(msg.t==='measure'){
      if(!player.name)return;
      const measurement=normalizeMeasurement(msg.measurement,player.name,player.id);
      if(!measurement){
        player.lastStateRejectReason='invalid-measurement';
        player.lastSeen=now;player.lastMessageAt=now;socket.serializeAttachment(player);
        return;
      }
      const stored=await this.ctx.storage.transaction(async transaction=>{
        const current=await transaction.get('sharedMeasurements');
        const measurements=Array.isArray(current)?current.filter(item=>item?.ownerId!==player.id):[];
        measurements.push(measurement);
        while(measurements.length>MAX_PLAYERS)measurements.shift();
        await transaction.put('sharedMeasurements',measurements);
        return measurement;
      });
      player.lastSeen=now;player.lastMessageAt=now;socket.serializeAttachment(player);
      const packet={t:'measure',measurement:stored};
      for(const entry of this.activeSockets())if(entry.player.name)this.send(entry.socket,packet);
      return;
    }
    if(msg.t==='measure-clear'){
      if(!player.name)return;
      const requestedId=msg.id?sanitizeClientId(msg.id):'';
      if(msg.id&&!requestedId)return;
      const removed=await this.ctx.storage.transaction(async transaction=>{
        const current=await transaction.get('sharedMeasurements');
        const measurements=Array.isArray(current)?current:[];
        const existing=measurements.find(item=>item?.ownerId===player.id&&(!requestedId||item.id===requestedId));
        if(!existing)return null;
        await transaction.put('sharedMeasurements',measurements.filter(item=>item?.ownerId!==player.id));
        return existing;
      });
      player.lastSeen=now;player.lastMessageAt=now;socket.serializeAttachment(player);
      if(removed){
        const packet={t:'measure-remove',ownerId:player.id,id:removed.id};
        for(const entry of this.activeSockets())if(entry.player.name)this.send(entry.socket,packet);
      }
      return;
    }
    if(msg.t!=='state'||!player.name)return;
    player.stateMessagesReceived=(Number(player.stateMessagesReceived)||0)+1;
    player.lastMessageAt=now;
    const state=normalizeState(msg.state);
    if(!state){
      player.rejectedStates=(Number(player.rejectedStates)||0)+1;
      player.lastStateRejectReason='invalid-state';
      player.lastSeen=now;socket.serializeAttachment(player);
      return;
    }
    player.lastStateRejectReason='';
    player.state=state;player.lastSeen=now;
    player.acceptedStates=(Number(player.acceptedStates)||0)+1;
    player.lastStateAt=now;
    if(Number.isInteger(msg.seq))player.lastStateSeq=msg.seq;
    socket.serializeAttachment(player);
    const packet={t:'state',seq:msg.seq,player:this.publicPlayer(player)};
    const recipients=this.activeSockets().filter(entry=>entry.socket!==socket&&entry.player.name);
    player.lastBroadcastPeers=recipients.length;
    player.broadcastAttempts=(Number(player.broadcastAttempts)||0)+1;
    socket.serializeAttachment(player);
    for(const entry of recipients)this.send(entry.socket,packet);
  }

  async clearMeasurementForPlayer(playerId){
    if(!playerId)return;
    const removed=await this.ctx.storage.transaction(async transaction=>{
      const current=await transaction.get('sharedMeasurements');
      const measurements=Array.isArray(current)?current:[];
      const existing=measurements.find(item=>item?.ownerId===playerId);
      if(!existing)return null;
      await transaction.put('sharedMeasurements',measurements.filter(item=>item?.ownerId!==playerId));
      return existing;
    });
    if(!removed)return;
    const packet={t:'measure-remove',ownerId:playerId,id:removed.id};
    for(const entry of this.activeSockets())if(entry.player.name)this.send(entry.socket,packet);
  }

  async webSocketClose(socket){
    let player;try{player=socket.deserializeAttachment();}catch{player=null;}
    this.announceLeave(socket);
    await this.clearMeasurementForPlayer(player?.id);
  }
  async webSocketError(socket){
    let player;try{player=socket.deserializeAttachment();}catch{player=null;}
    this.announceLeave(socket);
    await this.clearMeasurementForPlayer(player?.id);
  }
  announceLeave(socket,{broadcast=true}={}){
    let player;try{player=socket.deserializeAttachment();}catch{player=null;}
    if(!player||player.left||!player.id)return;
    player.left=true;try{socket.serializeAttachment(player);}catch{}
    if(!broadcast)return;
    const packet={t:'leave',id:player.id};
    const now=Date.now();
    for(const otherSocket of this.ctx.getWebSockets()){
      if(otherSocket===socket)continue;
      let other;try{other=otherSocket.deserializeAttachment();}catch{other=null;}
      if(!other||other.left||!other.name||(other.lastSeen&&now-other.lastSeen>MAX_IDLE_MS))continue;
      this.send(otherSocket,packet);
    }
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
