import { DurableObject } from 'cloudflare:workers';
import {
  MAX_IDLE_MS,MAX_MESSAGE_CHARS,MAX_MESSAGES_PER_SECOND,MAX_PLAYERS,
  appendSharedMarker,normalizeMarker,normalizeMeasurement,normalizeState,pruneSharedMarkers,sanitizeClientId,sanitizeName,syncSharedMarkers
} from './protocol.v2.js';

const ALLOWED_ORIGIN='https://kortul.github.io';
const PUBLIC_RESORT='grade-optimizer-public-resort';
const MAX_STATE_BUFFERED_BYTES=12*1024;

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
        entry.player.preserveSharedStateOnClose=true;
        try{entry.socket.serializeAttachment(entry.player);}catch{}
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

  send(socket,message){
    try{socket.send(JSON.stringify(message));}
    catch{try{socket.close(1011,'Send failed');}catch{}}
  }
  publicPlayer(player){return{id:player.id,slot:player.slot,name:player.name,state:player.state};}
  broadcastMarkerSnapshot(markers,ackOwnerId='',revision=null){
    const packet={t:'marker-snapshot',markers:Array.isArray(markers)?markers:[],ackOwnerId,revision};
    for(const entry of this.activeSockets())if(entry.player.name)this.send(entry.socket,packet);
  }
  async updateSharedMarkers(player,desired,revision){
    return this.ctx.storage.transaction(async transaction=>{
      const stored=await transaction.get('sharedMarkers');
      const revisions=await transaction.get('sharedMarkerRevisions')||{};
      const previousRevision=Number(revisions[player.id])||0;
      const requested=Number.isSafeInteger(Number(revision))&&Number(revision)>0?Number(revision):previousRevision+1;
      if(requested<=previousRevision)return {markers:Array.isArray(stored)?stored:[],revision:previousRevision,accepted:false};
      const update=syncSharedMarkers(stored,desired,player.name,player.id);
      revisions[player.id]=requested;
      await transaction.put('sharedMarkers',update.markers);
      await transaction.put('sharedMarkerRevisions',revisions);
      return {markers:update.markers,revision:requested,accepted:true,update};
    });
  }
  async clearSharedMeasurement(player,id,revision){
    return this.ctx.storage.transaction(async transaction=>{
      const current=await transaction.get('sharedMeasurements');
      const measurements=Array.isArray(current)?current:[];
      const revisions=await transaction.get('sharedMeasurementRevisions')||{};
      const previousRevision=Number(revisions[player.id])||0;
      const requested=Number.isSafeInteger(Number(revision))&&Number(revision)>0?Number(revision):previousRevision+1;
      if(requested<=previousRevision)return {removed:null,revision:previousRevision,accepted:false};
      const existing=measurements.find(item=>item?.ownerId===player.id&&(!id||item.id===id));
      await transaction.put('sharedMeasurements',measurements.filter(item=>item?.ownerId!==player.id));
      revisions[player.id]=requested;
      await transaction.put('sharedMeasurementRevisions',revisions);
      return {removed:existing||null,revision:requested,accepted:true};
    });
  }

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
      player.lastSeen=now;player.lastMessageAt=now;
      const peers=this.activeSockets().filter(entry=>entry.socket!==socket&&entry.player.name);
      player.peerCount=peers.length;
      socket.serializeAttachment(player);
      this.send(socket,{
        t:'pong',at:now,echo:Number.isFinite(Number(msg.echo))?Number(msg.echo):null,
        acceptedStates:Number(player.acceptedStates)||0,
        rejectedStates:Number(player.rejectedStates)||0,
        lastStateAt:Number(player.lastStateAt)||0,
        lastStateSeq:Number(player.lastStateSeq)||0,
        stateMessagesReceived:Number(player.stateMessagesReceived)||0,
        lastMessageAt:Number(player.lastMessageAt)||0,
        lastStateRejectReason:String(player.lastStateRejectReason||''),
        peerCount:peers.length,
        broadcastPeers:Number(player.lastBroadcastPeers)||0,
        broadcastAttempts:Number(player.broadcastAttempts)||0,
        droppedBroadcasts:Number(player.droppedBroadcasts)||0
      });
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
      const markerState=await this.ctx.storage.transaction(async transaction=>{
        const stored=await transaction.get('sharedMarkers');
        const update=pruneSharedMarkers(stored);
        await transaction.put('sharedMarkers',update.markers);
        const revisions=await transaction.get('sharedMarkerRevisions')||{};
        return {markers:update.markers,revision:Number(revisions[player.id])||0,removed:update.removedMarkers};
      });
      const storedMeasurements=await this.ctx.storage.get('sharedMeasurements');
      const measurements=Array.isArray(storedMeasurements)?storedMeasurements.slice(-MAX_PLAYERS):[];
      const peers=this.activeSockets().filter(entry=>entry.player.name&&entry.socket!==socket).map(entry=>this.publicPlayer(entry.player));
      this.send(socket,{t:'welcome',id:player.id,slot:player.slot,players:peers,markers:markerState.markers,markerRevision:markerState.revision,measurements});
      if(markerState.removed.length)this.broadcastMarkerSnapshot(markerState.markers,'',null);
      const joined={t:'join',player:{id:player.id,slot:player.slot,name:player.name}};
      for(const entry of this.activeSockets())if(entry.socket!==socket&&entry.player.name)this.send(entry.socket,joined);
      return;
    }

    if(msg.t==='marker'){
      if(!player.name)return;
      const marker=normalizeMarker(msg.marker,player.name,player.id);
      if(!marker){
        player.lastStateRejectReason='invalid-marker';player.lastSeen=now;player.lastMessageAt=now;socket.serializeAttachment(player);return;
      }
      const result=await this.ctx.storage.transaction(async transaction=>{
        const stored=await transaction.get('sharedMarkers');
        const update=appendSharedMarker(stored,marker);
        const revisions=await transaction.get('sharedMarkerRevisions')||{};
        revisions[player.id]=(Number(revisions[player.id])||0)+1;
        await transaction.put('sharedMarkers',update.markers);
        await transaction.put('sharedMarkerRevisions',revisions);
        return {markers:update.markers,revision:revisions[player.id]};
      });
      player.lastSeen=now;player.lastMessageAt=now;socket.serializeAttachment(player);
      this.broadcastMarkerSnapshot(result.markers,player.id,result.revision);
      return;
    }

    if(msg.t==='marker-sync'){
      if(!player.name)return;
      const desired=Array.isArray(msg.markers)?msg.markers.slice(-10):[];
      const result=await this.updateSharedMarkers(player,desired,msg.revision);
      player.lastSeen=now;player.lastMessageAt=now;socket.serializeAttachment(player);
      this.broadcastMarkerSnapshot(result.markers,player.id,result.revision);
      return;
    }
    if(msg.t==='marker-clear'){
      if(!player.name)return;
      const result=await this.updateSharedMarkers(player,[],msg.revision);
      player.lastSeen=now;player.lastMessageAt=now;socket.serializeAttachment(player);
      this.broadcastMarkerSnapshot(result.markers,player.id,result.revision);
      return;
    }

    if(msg.t==='measure'){
      if(!player.name)return;
      const measurement=normalizeMeasurement(msg.measurement,player.name,player.id);
      if(!measurement){
        player.lastStateRejectReason='invalid-measurement';player.lastSeen=now;player.lastMessageAt=now;socket.serializeAttachment(player);return;
      }
      const result=await this.ctx.storage.transaction(async transaction=>{
        const current=await transaction.get('sharedMeasurements');
        const measurements=Array.isArray(current)?current.filter(item=>item?.ownerId!==player.id):[];
        const revisions=await transaction.get('sharedMeasurementRevisions')||{};
        const previousRevision=Number(revisions[player.id])||0;
        const requested=Number.isSafeInteger(Number(msg.revision))&&Number(msg.revision)>0?Number(msg.revision):previousRevision+1;
        if(requested<=previousRevision)return {measurement:measurements.find(item=>item?.ownerId===player.id)||null,revision:previousRevision,accepted:false};
        const stored={...measurement,revision:requested};
        measurements.push(stored);
        while(measurements.length>MAX_PLAYERS)measurements.shift();
        revisions[player.id]=requested;
        await transaction.put('sharedMeasurements',measurements);
        await transaction.put('sharedMeasurementRevisions',revisions);
        return {measurement:stored,revision:requested,accepted:true};
      });
      player.lastSeen=now;player.lastMessageAt=now;socket.serializeAttachment(player);
      if(result.accepted&&result.measurement){
        const packet={t:'measure',measurement:result.measurement};
        for(const entry of this.activeSockets())if(entry.player.name)this.send(entry.socket,packet);
      }
      this.send(socket,{t:'measure-ack',ownerId:player.id,revision:result.revision,accepted:result.accepted});
      return;
    }
    if(msg.t==='measure-clear'){
      if(!player.name)return;
      const requestedId=msg.id?sanitizeClientId(msg.id):'';
      if(msg.id&&!requestedId)return;
      const result=await this.clearSharedMeasurement(player,requestedId,Number(msg.revision)||0);
      player.lastSeen=now;player.lastMessageAt=now;socket.serializeAttachment(player);
      if(result.removed){
        const packet={t:'measure-remove',ownerId:player.id,id:result.removed.id};
        for(const entry of this.activeSockets())if(entry.player.name)this.send(entry.socket,packet);
      }
      this.send(socket,{t:'measure-ack',ownerId:player.id,revision:result.revision,accepted:result.accepted});
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
    const recipients=this.activeSockets().filter(entry=>entry.socket!==socket&&entry.player.name);
    player.lastBroadcastPeers=recipients.length;
    player.broadcastAttempts=(Number(player.broadcastAttempts)||0)+1;
    const packet={t:'state',seq:msg.seq,player:this.publicPlayer(player)};
    socket.serializeAttachment(player);
    for(const entry of recipients){
      if((Number(entry.socket.bufferedAmount)||0)>MAX_STATE_BUFFERED_BYTES){player.droppedBroadcasts=(Number(player.droppedBroadcasts)||0)+1;continue;}
      this.send(entry.socket,packet);
    }
  }

  async clearMarkersForPlayer(playerId){
    if(!playerId)return;
    const result=await this.ctx.storage.transaction(async transaction=>{
      const current=await transaction.get('sharedMarkers');
      const markers=Array.isArray(current)?current:[];
      const retained=markers.filter(marker=>marker?.ownerId!==playerId);
      const revisions=await transaction.get('sharedMarkerRevisions')||{};
      const revision=(Number(revisions[playerId])||0)+1;
      revisions[playerId]=revision;
      await transaction.put('sharedMarkerRevisions',revisions);
      if(retained.length!==markers.length)await transaction.put('sharedMarkers',retained);
      return {markers:retained,revision,removed:retained.length!==markers.length};
    });
    if(result.removed)this.broadcastMarkerSnapshot(result.markers,playerId,result.revision);
  }

  async clearMeasurementForPlayer(playerId){
    if(!playerId)return;
    const result=await this.ctx.storage.transaction(async transaction=>{
      const current=await transaction.get('sharedMeasurements');
      const measurements=Array.isArray(current)?current:[];
      const existing=measurements.find(item=>item?.ownerId===playerId);
      const revisions=await transaction.get('sharedMeasurementRevisions')||{};
      const revision=(Number(revisions[playerId])||0)+1;revisions[playerId]=revision;
      if(existing)await transaction.put('sharedMeasurements',measurements.filter(item=>item?.ownerId!==playerId));
      await transaction.put('sharedMeasurementRevisions',revisions);
      return {existing,revision};
    });
    if(result.existing){
      const packet={t:'measure-remove',ownerId:playerId,id:result.existing.id};
      for(const entry of this.activeSockets())if(entry.player.name)this.send(entry.socket,packet);
    }
  }

  async webSocketClose(socket){
    let player;try{player=socket.deserializeAttachment();}catch{player=null;}
    this.announceLeave(socket);
    if(!player?.preserveSharedStateOnClose){
      await this.clearMarkersForPlayer(player?.id);
      await this.clearMeasurementForPlayer(player?.id);
    }
  }
  async webSocketError(socket){
    let player;try{player=socket.deserializeAttachment();}catch{player=null;}
    this.announceLeave(socket);
    if(!player?.preserveSharedStateOnClose){
      await this.clearMarkersForPlayer(player?.id);
      await this.clearMeasurementForPlayer(player?.id);
    }
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
