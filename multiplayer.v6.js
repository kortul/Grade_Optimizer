import * as THREE from 'three';

const SEND_INTERVAL_MS = 50;
const FULL_RETRY_BASE_MS = 2500;
const FULL_RETRY_MAX_MS = 10000;
const STALE_PEER_MS = 45000;
const LEAVE_GRACE_MS = 8000;
const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_TIMEOUT_MS = 12000;
const MAX_VISIBLE_MARKERS = 50;
const JOINT_FLOATS = 72;
const JOINTS_PER_NODE = 6;

function getSessionClientId() {
  // Generate once per live page instance, not from sessionStorage: duplicated
  // browser tabs may inherit a copied sessionStorage and must remain distinct.
  return crypto.randomUUID().toLowerCase();
}

function normalizeEndpoint(value) {
  let url=String(value||'').trim();
  if(!url)return '';
  if(/^https?:\/\//i.test(url))url=url.replace(/^http/i,'ws');
  if(!/^wss?:\/\//i.test(url))url='wss://'+url;
  url=url.replace(/\/+$/,'');
  if(!/\/ws$/i.test(url))url+='/ws';
  return url;
}

function cloneModel(source) {
  const root=source?source.clone(true):new THREE.Group();
  root.position.set(0,0,0);
  root.quaternion.identity();
  const materials=new Set();
  root.traverse(object=>{
    object.visible=true;
    if(!object.isMesh||!object.material)return;
    const cloneMaterial=material=>{
      if(!material?.clone)return material;
      const copy=material.clone();
      materials.add(copy);
      // First person hides the local avatar by fading its materials.
      if(copy.opacity<=0.01){
        copy.opacity=1;copy.transparent=false;copy.depthWrite=true;copy.needsUpdate=true;
      }
      return copy;
    };
    object.material=Array.isArray(object.material)?object.material.map(cloneMaterial):cloneMaterial(object.material);
    object.castShadow=true;object.receiveShadow=true;
  });
  return {root,dispose(){materials.forEach(material=>material.dispose?.());materials.clear();}};
}

function makeDrone() {
  const root=new THREE.Group();
  root.name='GO_RemoteDrone';
  const frame=new THREE.MeshStandardMaterial({color:0x283846,roughness:0.42,metalness:0.55});
  const accent=new THREE.MeshStandardMaterial({color:0x75c7ee,roughness:0.32,metalness:0.42,emissive:0x16384a});
  const warning=new THREE.MeshStandardMaterial({color:0xf39a51,roughness:0.4,metalness:0.25});
  const black=new THREE.MeshStandardMaterial({color:0x111a21,roughness:0.5,metalness:0.25});
  const geometries=[],rotors=[],materials=[frame,accent,warning,black];
  const add=(geometry,material,position,parent=root)=>{
    geometries.push(geometry);
    const mesh=new THREE.Mesh(geometry,material);
    mesh.position.copy(position);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(0.34,0.105,0.31),frame,new THREE.Vector3(0,0,0));
  add(new THREE.BoxGeometry(0.19,0.07,0.20),accent,new THREE.Vector3(0,0.035,-0.035));
  const lens=add(new THREE.SphereGeometry(0.075,14,10),black,new THREE.Vector3(0,-0.035,-0.17));
  lens.scale.set(1.15,0.8,0.78);
  const armA=add(new THREE.BoxGeometry(0.78,0.035,0.052),frame,new THREE.Vector3(0,0.025,0));
  armA.rotation.y=Math.PI*0.25;
  const armB=add(new THREE.BoxGeometry(0.78,0.035,0.052),frame,new THREE.Vector3(0,0.025,0));
  armB.rotation.y=-Math.PI*0.25;
  for(const x of [-0.265,0.265])for(const z of [-0.265,0.265]){
    const motor=new THREE.Group();motor.position.set(x,0.045,z);root.add(motor);
    add(new THREE.CylinderGeometry(0.052,0.056,0.07,12),black,new THREE.Vector3(0,0.04,0),motor);
    const rotor=new THREE.Group();rotor.position.y=0.085;motor.add(rotor);
    const bladeA=add(new THREE.BoxGeometry(0.27,0.009,0.034),accent,new THREE.Vector3(0,0,0),rotor);
    bladeA.rotation.y=0.18;
    const bladeB=add(new THREE.BoxGeometry(0.27,0.009,0.034),accent,new THREE.Vector3(0,0,0),rotor);
    bladeB.rotation.y=Math.PI*0.5+0.18;
    add(new THREE.SphereGeometry(0.024,10,8),warning,new THREE.Vector3(0,0.008,0),rotor);
    rotors.push(rotor);
    const leg=add(new THREE.CylinderGeometry(0.012,0.015,0.16,7),frame,new THREE.Vector3(x*0.68,-0.095,z*0.68));
    leg.rotation.z=Math.sign(x)*0.22;
    add(new THREE.SphereGeometry(0.025,8,6),warning,new THREE.Vector3(x*0.68,-0.17,z*0.68));
  }
  root.scale.setScalar(1.35);
  return {root,rotors,dispose(){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());}};
}

function makeOverviewCamera() {
  const root=new THREE.Group();
  root.name='GO_RemoteOverviewCamera';
  const cameraBody=new THREE.Group();
  cameraBody.scale.setScalar(3);
  root.add(cameraBody);
  const body=new THREE.MeshStandardMaterial({color:0x203747,roughness:0.42,metalness:0.52});
  const trim=new THREE.MeshStandardMaterial({color:0x5bbfe8,roughness:0.3,metalness:0.35,emissive:0x12384a});
  const glass=new THREE.MeshStandardMaterial({color:0x9ae6ff,roughness:0.18,metalness:0.35,emissive:0x286b86});
  const beamMaterial=new THREE.LineBasicMaterial({color:0x65cfff,transparent:true,opacity:0.82,depthWrite:false});
  const geometries=[new THREE.BoxGeometry(0.58,0.34,0.38),new THREE.CylinderGeometry(0.105,0.13,0.20,16),new THREE.SphereGeometry(0.09,14,10),new THREE.ConeGeometry(0.22,0.7,8)];
  const materials=[body,trim,glass,beamMaterial];
  const housing=new THREE.Mesh(geometries[0],body);
  cameraBody.add(housing);
  const barrel=new THREE.Mesh(geometries[1],trim);
  barrel.rotation.x=-Math.PI/2;
  barrel.position.set(0,0,-0.27);
  cameraBody.add(barrel);
  const lens=new THREE.Mesh(geometries[2],glass);
  lens.position.set(0,0,-0.39);
  cameraBody.add(lens);
  const direction=new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,-1.5),new THREE.Vector3(0,0,-20)]),
    beamMaterial
  );
  geometries.push(direction.geometry);
  root.add(direction);
  const arrow=new THREE.Mesh(geometries[3],trim);
  arrow.rotation.x=-Math.PI/2;
  arrow.position.set(0,0,-20);
  root.add(arrow);
  return {
    root,
    dispose(){
      geometries.forEach(geometry=>geometry.dispose());
      materials.forEach(material=>material.dispose());
    }
  };
}

function makeNameLabel(name) {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=112;
  const ctx=canvas.getContext('2d');
  if(ctx){
    ctx.fillStyle='rgba(9,17,25,0.86)';ctx.strokeStyle='rgba(185,216,239,0.7)';ctx.lineWidth=3;
    ctx.beginPath();
    if(typeof ctx.roundRect==='function')ctx.roundRect(8,8,496,96,22);else ctx.rect(8,8,496,96);
    ctx.fill();ctx.stroke();ctx.fillStyle='#f1f7fc';ctx.font='bold 38px system-ui,sans-serif';
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(name||'Лыжник').slice(0,20),256,57,450);
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,depthTest:false,toneMapped:false});
  const sprite=new THREE.Sprite(material);sprite.scale.set(3.25,0.72,1);sprite.renderOrder=50;
  return {sprite,dispose(){texture.dispose();material.dispose();}};
}

function makeFlagMarker(owner) {
  const root=new THREE.Group();
  root.name='GO_SharedFlagMarker';
  const geometries=[];
  const materials=[
    new THREE.MeshStandardMaterial({color:0x263d4d,roughness:0.5,metalness:0.28}),
    new THREE.MeshStandardMaterial({color:0xffb64b,roughness:0.48,metalness:0.12,side:THREE.DoubleSide,emissive:0x5c2a05}),
    new THREE.MeshBasicMaterial({color:0xffd58b,transparent:true,opacity:0.88,side:THREE.DoubleSide})
  ];
  const add=(geometry,material,position)=>{
    geometries.push(geometry);
    const mesh=new THREE.Mesh(geometry,material);
    mesh.position.copy(position);
    mesh.castShadow=true;mesh.receiveShadow=true;
    root.add(mesh);
    return mesh;
  };
  const ring=add(new THREE.TorusGeometry(0.42,0.025,6,24),materials[2],new THREE.Vector3(0,0.035,0));
  ring.rotation.x=Math.PI/2;
  add(new THREE.CylinderGeometry(0.022,0.035,1.65,8),materials[0],new THREE.Vector3(0,0.84,0));
  const flagGeometry=new THREE.BufferGeometry();
  flagGeometry.setAttribute('position',new THREE.Float32BufferAttribute([
    0,1.62,0, 0.72,1.43,0, 0,1.20,0
  ],3));
  flagGeometry.setIndex([0,1,2]);flagGeometry.computeVertexNormals();
  add(flagGeometry,materials[1],new THREE.Vector3(0,0,0));
  add(new THREE.SphereGeometry(0.065,10,8),materials[1],new THREE.Vector3(0,1.69,0));
  const label=makeNameLabel(owner);
  label.sprite.scale.set(2.45,0.55,1);
  label.sprite.position.set(0.82,1.95,0);
  root.add(label.sprite);
  return {
    root,
    dispose(){
      label.dispose();
      geometries.forEach(geometry=>geometry.dispose());
      materials.forEach(material=>material.dispose());
    }
  };
}

function makeDroneObserverBeacon() {
  const root=new THREE.Group();
  root.name='GO_RemoteDroneObserverBeacon';
  const material=new THREE.LineBasicMaterial({color:0x70e6ff,transparent:true,opacity:0.88,depthTest:false,depthWrite:false});
  const glow=new THREE.MeshBasicMaterial({color:0x70e6ff,transparent:true,opacity:0.78,depthTest:false,depthWrite:false});
  const stemGeometry=new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0,0.2,0),new THREE.Vector3(0,6.2,0)
  ]);
  const stem=new THREE.Line(stemGeometry,material);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(0.72,0.075,8,28),glow);
  ring.rotation.x=Math.PI/2;
  ring.position.y=6.2;
  const beacon=new THREE.Mesh(new THREE.SphereGeometry(0.19,12,10),glow);
  beacon.position.y=6.2;
  root.add(stem,ring,beacon);
  root.visible=false;
  return {
    root,
    dispose(){
      stemGeometry.dispose();
      ring.geometry.dispose();
      beacon.geometry.dispose();
      material.dispose();
      glow.dispose();
    }
  };
}

export class ResortMultiplayer {
  constructor({scene,endpoint,name,statusElement,statusTextElement,templateProvider,poseNodeNames=[]}) {
    this.scene=scene;this.endpoint=normalizeEndpoint(endpoint);this.clientId=getSessionClientId();
    const nameBase=String(name||'Лыжник').slice(0,14);
    this.name=(nameBase+'-'+this.clientId.replace(/-/g,'').slice(-4).toUpperCase()).slice(0,20);
    this.statusElement=statusElement||null;this.statusTextElement=statusTextElement||null;
    this.templateProvider=templateProvider||(()=>({}));this.poseNodeNames=poseNodeNames.slice();
    this.socket=null;this.id='';this.slot=null;this.connected=false;this.disposed=false;this.full=false;
    this.retries=0;this.reconnectTimer=null;this.lastSent=0;this.lastStatus='';this.lastClose=null;this.superseded=false;
    this.slotWaiters=new Set();this.sentStates=0;this.receivedStates=0;this.lastStateAt=0;this.lastPong=0;
    this.sessionSentBaseline=0;this.sessionReceivedBaseline=0;this.sessionStartedAt=0;this.lastHeartbeatTimeoutAt=0;
    this.stateSequence=0;this.lastStateAckAt=0;this.serverAcceptedStates=0;this.serverRejectedStates=0;
    this.serverReceivedStates=0;this.serverLastStateAt=0;this.serverLastStateSeq=0;this.serverLastMessageAt=0;this.serverLastStateRejectReason='';
    this.serverPeerCount=0;this.serverBroadcastPeers=0;this.serverBroadcastAttempts=0;this.lastPayloadChars=0;this.lastSendError='';
    this.heartbeatTimer=this.endpoint?setInterval(()=>this.sendHeartbeat(),HEARTBEAT_INTERVAL_MS):null;
    this.players=new Map();this.names=new Map();this.lastSeen=new Map();this.leaveTimers=new Map();this.markers=new Map();
    this.setStatus(this.endpoint?'connecting':'disabled');
  }

  connect() {
    if(this.disposed||this.socket||this.superseded)return;
    if(!this.endpoint){this.setStatus('disabled');return;}
    this.setStatus(this.retries?'reconnecting':'connecting');
    let socket;
    try{
      const target=new URL(this.endpoint,window.location.href);
      target.searchParams.set('clientId',this.clientId);
      socket=new WebSocket(target.toString());
    }catch(error){this.scheduleReconnect();return;}
    this.socket=socket;
    socket.onopen=()=>{
      if(this.socket===socket&&!this.disposed)socket.send(JSON.stringify({t:'hello',name:this.name,clientId:this.clientId}));
    };
    socket.onmessage=event=>{
      if(this.socket===socket&&!this.disposed&&typeof event.data==='string')this.onMessage(event.data);
    };
    socket.onerror=()=>{try{socket.close();}catch{}};
    socket.onclose=event=>{
      if(this.socket!==socket)return;
      this.lastClose={code:event.code,reason:event.reason||'',wasClean:event.wasClean,at:Date.now()};
      console.warn('[Grade Optimizer multiplayer] WebSocket closed',this.lastClose);
      this.socket=null;this.connected=false;this.id='';this.slot=null;
      // A local transport reconnect does not mean every remote skier has left.
      // Keep their last transforms until the server's next welcome snapshot reconciles them.
      this.resolveSlotWaiters(null);
      if(this.disposed)return;
      if(event.code===4001){
        this.superseded=true;
        this.setStatus('replaced');
        return;
      }
      if(this.full){
        this.setStatus('full');
        this.scheduleReconnect();
        return;
      }
      this.setStatus('reconnecting');this.scheduleReconnect();
    };
  }

  sendHeartbeat() {
    const socket=this.socket;
    if(this.disposed||!this.connected||socket?.readyState!==WebSocket.OPEN)return;
    const now=performance.now();
    if(this.lastPong&&now-this.lastPong>HEARTBEAT_TIMEOUT_MS){
      this.lastHeartbeatTimeoutAt=now;
      console.warn('[Grade Optimizer multiplayer] Heartbeat timeout; reconnecting',Math.round(now-this.lastPong)+' ms');
      try{socket.close(4000,'Heartbeat timeout');}catch{}
      return;
    }
    try{socket.send(JSON.stringify({t:'ping'}));}
    catch(error){try{socket.close();}catch{}}
  }

  resolveSlotWaiters(slot) {
    for(const resolve of [...this.slotWaiters]){
      this.slotWaiters.delete(resolve);
      resolve(Number.isInteger(slot)?slot:null);
    }
  }

  waitForSlot(timeoutMs=1600) {
    if(Number.isInteger(this.slot))return Promise.resolve(this.slot);
    if(!this.endpoint||this.disposed)return Promise.resolve(null);
    return new Promise(resolve=>{
      let settled=false;
      const finish=value=>{
        if(settled)return;
        settled=true;
        clearTimeout(timer);
        this.slotWaiters.delete(finish);
        resolve(Number.isInteger(value)?value:null);
      };
      const timer=setTimeout(()=>finish(null),Math.max(0,timeoutMs));
      this.slotWaiters.add(finish);
      if(Number.isInteger(this.slot))finish(this.slot);
    });
  }

  getSpawnSlot() {
    if(Number.isInteger(this.slot))return this.slot;
    let hash=2166136261;
    for(let i=0;i<this.clientId.length;i++){
      hash^=this.clientId.charCodeAt(i);
      hash=Math.imul(hash,16777619);
    }
    return (hash>>>0)%4;
  }

  scheduleReconnect() {
    if(this.disposed||this.superseded||this.reconnectTimer)return;
    this.retries=Math.min(this.retries+1,8);
    const delay=this.full
      ?Math.min(FULL_RETRY_MAX_MS,FULL_RETRY_BASE_MS*2**Math.min(this.retries-1,2))
      :Math.min(10000,1200*2**(this.retries-1));
    this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=null;this.connect();},delay);
  }

  onMessage(raw) {
    if(raw.length>16000)return;
    let msg;try{msg=JSON.parse(raw);}catch{return;}
    if(msg.t==='full'){
      this.full=true;this.connected=false;this.setStatus('full');
      try{this.socket?.close(1013,'Shared resort is full');}catch{}
      return;
    }
    if(msg.t==='slot'){
      this.slot=Number.isInteger(msg.slot)?msg.slot:null;
      this.resolveSlotWaiters(this.slot);
    }else if(msg.t==='welcome'){
      this.full=false;
      this.id=String(msg.id||'');this.slot=Number.isInteger(msg.slot)?msg.slot:null;this.connected=!!this.id;this.retries=0;this.lastPong=performance.now();
      this.sessionSentBaseline=this.sentStates;this.sessionReceivedBaseline=this.receivedStates;this.sessionStartedAt=this.lastPong;
      this.serverAcceptedStates=0;this.serverRejectedStates=0;this.serverReceivedStates=0;this.serverLastStateAt=0;this.serverLastStateSeq=0;this.serverLastMessageAt=0;this.serverLastStateRejectReason='';
      this.resolveSlotWaiters(this.slot);
      const peers=Array.isArray(msg.players)?msg.players:[];
      const activeIds=new Set(peers.map(peer=>String(peer?.id||'')).filter(Boolean));
      for(const peerId of [...this.names.keys()])if(!activeIds.has(peerId))this.remove(peerId);
      for(const timer of this.leaveTimers.values())clearTimeout(timer);
      this.leaveTimers.clear();
      for(const peer of peers)this.upsert(peer);
      const markers=Array.isArray(msg.markers)?msg.markers:[];
      const markerIds=new Set(markers.map(marker=>String(marker?.id||'')).filter(Boolean));
      for(const markerId of [...this.markers.keys()])if(!markerIds.has(markerId))this.removeMarker(markerId);
      for(const marker of markers)this.upsertMarker(marker);
      this.setStatus(this.connected?'connected':'error');
    }else if(msg.t==='join'){
      if(msg.player?.id){
        const id=String(msg.player.id);this.cancelPendingRemoval(id);this.names.set(id,String(msg.player.name||'Лыжник'));
        this.lastSeen.set(id,performance.now());
      }
      this.setStatus('connected');
    }else if(msg.t==='state'){
      this.receivedStates++;this.lastStateAt=performance.now();
      this.upsert(msg.player);this.setStatus('connected');
    }else if(msg.t==='pong'){
      this.lastPong=performance.now();
      if(Number.isFinite(msg.acceptedStates)){this.serverAcceptedStates=msg.acceptedStates;this.lastStateAckAt=this.lastPong;}
      if(Number.isFinite(msg.rejectedStates))this.serverRejectedStates=msg.rejectedStates;
      if(Number.isFinite(msg.lastStateAt))this.serverLastStateAt=msg.lastStateAt;
      if(Number.isFinite(msg.lastStateSeq))this.serverLastStateSeq=msg.lastStateSeq;
      if(Number.isFinite(msg.stateMessagesReceived))this.serverReceivedStates=msg.stateMessagesReceived;
      if(Number.isFinite(msg.lastMessageAt))this.serverLastMessageAt=msg.lastMessageAt;
      if(typeof msg.lastStateRejectReason==='string')this.serverLastStateRejectReason=msg.lastStateRejectReason;
      if(Number.isFinite(msg.peerCount))this.serverPeerCount=msg.peerCount;
      if(Number.isFinite(msg.broadcastPeers))this.serverBroadcastPeers=msg.broadcastPeers;
      if(Number.isFinite(msg.broadcastAttempts))this.serverBroadcastAttempts=msg.broadcastAttempts;
    }else if(msg.t==='marker'){
      this.upsertMarker(msg.marker);
    }else if(msg.t==='marker-remove'){
      this.removeMarker(msg.id);
    }else if(msg.t==='presence'){
      const id=String(msg.id||'');
      if(id&&id!==this.id){
        const now=performance.now();
        this.names.set(id,String(msg.name||this.names.get(id)||'Лыжник').slice(0,20));
        this.lastSeen.set(id,now);
        const peer=this.players.get(id);if(peer)peer.lastSeen=now;
      }
      this.setStatus('connected');
    }else if(msg.t==='leave'){
      this.scheduleRemoval(String(msg.id||''));this.setStatus('connected');
    }
  }

  finiteArray(value,length) {
    if(!Array.isArray(value)||value.length!==length)return null;
    const result=value.map(Number);return result.every(Number.isFinite)?result:null;
  }

  upsert(peer) {
    if(!peer?.id)return;
    const id=String(peer.id);if(id===this.id)return;
    this.cancelPendingRemoval(id);
    const name=String(peer.name||this.names.get(id)||'Лыжник').slice(0,20);
    this.names.set(id,name);this.lastSeen.set(id,performance.now());
    const state=peer.state;
    if(!state||!['overview','skier','drone'].includes(state.mode))return;
    let remote=this.players.get(id);
    const p=this.finiteArray(state.p,3),q=this.finiteArray(state.q,4),v=this.finiteArray(state.v,3);
    if(!p||!q||!v)return;
    if(!remote){remote=this.createPeer(id,name);this.players.set(id,remote);}
    remote.mode=state.mode;remote.name=name;
    remote.targetPosition.fromArray(p);remote.targetQuaternion.fromArray(q).normalize();remote.velocity.fromArray(v);
    remote.targetPose=state.mode==='skier'&&Array.isArray(state.pose)&&state.pose.length===this.poseNodeNames.length*JOINTS_PER_NODE&&
      state.pose.every(value=>Number.isFinite(Number(value)))?state.pose.map(Number):[];
    if(state.mode!=='skier')remote.poseCurrent=[];
    else if(!remote.poseCurrent.length)remote.poseCurrent=remote.targetPose.slice();
    remote.lastSeen=performance.now();remote.lastStateAt=remote.lastSeen;
    if(!remote.initialized){
      remote.group.position.copy(remote.targetPosition);remote.group.quaternion.copy(remote.targetQuaternion);
      remote.initialized=true;
    }
  }

  createPeer(id,name) {
    const group=new THREE.Group();group.name='GO_RemotePlayer_'+id;
    const skier=new THREE.Group();skier.name='GO_RemoteSkier';
    const templates=this.templateProvider()||{};
    const avatar=cloneModel(templates.skierAvatar),skis=cloneModel(templates.skiRig);
    avatar.root.name='GO_RemoteSkierAvatar';skis.root.name='GO_RemoteSkis';skier.add(avatar.root,skis.root);
    const drone=makeDrone(),view=makeOverviewCamera(),beacon=makeDroneObserverBeacon(),label=makeNameLabel(name);
    group.add(skier,drone.root,view.root,beacon.root,label.sprite);this.scene.add(group);
    const joints=this.poseNodeNames.map(nodeName=>avatar.root.getObjectByName(nodeName));
    return {
      id,name,group,skier,drone:drone.root,view:view.root,beacon:beacon.root,rotors:drone.rotors,
      disposeDrone:drone.dispose,disposeView:view.dispose,disposeBeacon:beacon.dispose,
      disposeAvatar:avatar.dispose,disposeSkis:skis.dispose,label,joints,
      targetPosition:new THREE.Vector3(),targetQuaternion:new THREE.Quaternion(),velocity:new THREE.Vector3(),
      targetPose:[],poseCurrent:[],mode:'overview',initialized:false,lastSeen:performance.now(),lastStateAt:performance.now(),rotorTime:0
    };
  }

  cancelPendingRemoval(id) {
    const timer=this.leaveTimers.get(id);
    if(timer){clearTimeout(timer);this.leaveTimers.delete(id);}
  }

  scheduleRemoval(id) {
    if(!id||id===this.id)return;
    this.cancelPendingRemoval(id);
    const timer=setTimeout(()=>{
      this.leaveTimers.delete(id);
      this.remove(id);
      this.setStatus(this.connected?'connected':(this.endpoint?'reconnecting':'disabled'));
    },LEAVE_GRACE_MS);
    this.leaveTimers.set(id,timer);
  }

  remove(id) {
    this.cancelPendingRemoval(id);
    const peer=this.players.get(id);
    if(peer){
      this.scene.remove(peer.group);peer.label.dispose();peer.disposeDrone();peer.disposeView();peer.disposeBeacon();
      peer.disposeAvatar();peer.disposeSkis();this.players.delete(id);
    }
    this.names.delete(id);this.lastSeen.delete(id);
  }

  upsertMarker(marker) {
    if(!marker||typeof marker!=='object'||!marker.id)return false;
    const id=String(marker.id).slice(0,64);
    const position=this.finiteArray(marker.p,3);
    if(!position||position.some(value=>Math.abs(value)>50000))return false;
    const owner=String(marker.owner||'Лыжник').slice(0,20);
    const existing=this.markers.get(id);
    if(existing){
      existing.group.position.fromArray(position);
      return true;
    }
    const visual=makeFlagMarker(owner);
    visual.root.position.fromArray(position);
    this.scene.add(visual.root);
    this.markers.set(id,{group:visual.root,dispose:visual.dispose,owner,createdAt:Number(marker.createdAt)||Date.now()});
    while(this.markers.size>MAX_VISIBLE_MARKERS){
      const oldest=this.markers.keys().next().value;
      this.removeMarker(oldest);
    }
    return true;
  }

  removeMarker(id) {
    const marker=this.markers.get(String(id));
    if(!marker)return;
    this.scene.remove(marker.group);marker.dispose();this.markers.delete(String(id));
  }

  clearMarkers() {
    for(const id of [...this.markers.keys()])this.removeMarker(id);
  }

  addMarker(position) {
    if(!this.connected||this.socket?.readyState!==WebSocket.OPEN)return false;
    const p=this.finiteArray(position?.isVector3?position.toArray():position,3);
    if(!p||p.some(value=>Math.abs(value)>50000))return false;
    const marker={id:crypto.randomUUID().toLowerCase(),p};
    this.upsertMarker({...marker,owner:this.name,createdAt:Date.now()});
    try{
      this.socket.send(JSON.stringify({t:'marker',marker}));
      return true;
    }catch(error){
      this.removeMarker(marker.id);
      this.lastSendError=error?.message||String(error);
      return false;
    }
  }

  clearPlayers() {
    for(const timer of this.leaveTimers.values())clearTimeout(timer);
    this.leaveTimers.clear();
    for(const id of [...this.players.keys()])this.remove(id);
    this.names.clear();this.lastSeen.clear();
    this.clearMarkers();
  }

  setStatus(state) {
    if(!this.statusElement)return;
    this.statusElement.dataset.state=state;
    const count=this.names.size+(this.connected?1:0);
    let label='Сервер не настроен';
    if(state==='connecting')label='Подключение к склону…';
    else if(state==='reconnecting')label='Восстанавливаем связь…';
    else if(state==='connected')label=count>1?'Онлайн · '+count+' участника':'Онлайн · ожидаем клиента';
    else if(state==='full')label='Сервер занят';
    else if(state==='replaced')label='Подключение заменено другой вкладкой';
    else if(state==='error')label='Ошибка подключения';
    if(label!==this.lastStatus&&this.statusTextElement){
      this.statusTextElement.textContent=label;this.lastStatus=label;
    }
  }

  publish(state) {
    if(!this.connected||this.socket?.readyState!==WebSocket.OPEN||!state)return;
    const now=performance.now();if(now-this.lastSent<SEND_INTERVAL_MS)return;
    this.lastSent=now;
    const seq=++this.stateSequence;
    try{
      const packet=JSON.stringify({t:'state',seq,state});
      this.lastPayloadChars=packet.length;
      this.socket.send(packet);this.sentStates++;this.lastSendError='';
    }catch(error){
      this.lastSendError=error?.message||String(error);
      try{this.socket.close();}catch{}
    }
  }

  update(dt,localMode='overview') {
    const now=performance.now();
    const droneObserver=localMode==='drone';
    for(const [id,time] of this.lastSeen)if(now-time>STALE_PEER_MS)this.remove(id);
    for(const [id,peer] of this.players){
      if(now-peer.lastSeen>STALE_PEER_MS){this.remove(id);continue;}
      peer.group.visible=true;
      peer.skier.visible=peer.mode==='skier';
      peer.drone.visible=peer.mode==='drone';
      peer.view.visible=peer.mode==='overview';
      // In drone view, add an elevated locator while retaining each peer's actual avatar.
      peer.beacon.visible=droneObserver;
      if(droneObserver)peer.beacon.quaternion.copy(peer.group.quaternion).invert();
      peer.label.sprite.position.y=peer.mode==='drone'?1.35:(peer.mode==='overview'?1.85:2.25);
      const blend=1-Math.exp(-Math.max(0,dt)*20);
      const predictionAge=Math.min(0.12,Math.max(0,(now-(peer.lastStateAt||now))/1000));
      const prediction=peer.targetPosition.clone().addScaledVector(peer.velocity,predictionAge);
      if(peer.group.position.distanceToSquared(prediction)>1600)peer.group.position.copy(prediction);
      else peer.group.position.lerp(prediction,blend);
      peer.group.quaternion.slerp(peer.targetQuaternion,blend);
      if(peer.mode==='skier'&&peer.targetPose.length){
        for(let i=0;i<peer.joints.length;i++){
          const node=peer.joints[i];if(!node)continue;
          const offset=i*JOINTS_PER_NODE;
          for(let axis=0;axis<JOINTS_PER_NODE;axis++){
            peer.poseCurrent[offset+axis]+=(peer.targetPose[offset+axis]-peer.poseCurrent[offset+axis])*blend;
          }
          node.position.set(peer.poseCurrent[offset],peer.poseCurrent[offset+1],peer.poseCurrent[offset+2]);
          node.rotation.set(peer.poseCurrent[offset+3],peer.poseCurrent[offset+4],peer.poseCurrent[offset+5]);
        }
      }
      if(peer.mode==='drone'){
        peer.rotorTime+=Math.max(0,dt)*34;
        peer.rotors.forEach((rotor,index)=>{rotor.rotation.y=peer.rotorTime*(index%2?-1:1);});
      }
    }
    this.setStatus(this.connected?'connected':(this.endpoint?'reconnecting':'disabled'));
  }

  diagnostics(){
    const now=performance.now();
    return{
      configured:!!this.endpoint,connected:this.connected,full:this.full,retries:this.retries,reconnectScheduled:!!this.reconnectTimer,
      id:this.id,clientId:this.clientId,slot:this.slot,players:this.names.size,
      visibleOverviewCameras:[...this.players.values()].filter(peer=>peer.mode==='overview').length,
      visibleDroneBeacons:[...this.players.values()].filter(peer=>peer.beacon.visible).length,sharedFlags:this.markers.size,
      remotePlayers:[...this.players.values()].map(peer=>({id:peer.id,name:peer.name,mode:peer.mode,lastStateAgeMs:Math.round(now-peer.lastStateAt)})),
      sentStates:this.sentStates,receivedStates:this.receivedStates,
      sessionAgeMs:this.sessionStartedAt?Math.round(now-this.sessionStartedAt):null,
      sessionSentStates:this.sentStates-this.sessionSentBaseline,sessionReceivedStates:this.receivedStates-this.sessionReceivedBaseline,
      lastStateAt:this.lastStateAt,lastStateAgeMs:this.lastStateAt?Math.round(now-this.lastStateAt):null,
      lastPong:this.lastPong,lastPongAgeMs:this.lastPong?Math.round(now-this.lastPong):null,
      heartbeatTimeoutMs:HEARTBEAT_TIMEOUT_MS,lastHeartbeatTimeoutAt:this.lastHeartbeatTimeoutAt||null,
      serverAcceptedStates:this.serverAcceptedStates,serverRejectedStates:this.serverRejectedStates,serverReceivedStates:this.serverReceivedStates,
      serverLastStateAt:this.serverLastStateAt,serverLastStateSeq:this.serverLastStateSeq,
      serverLastMessageAt:this.serverLastMessageAt,serverLastStateRejectReason:this.serverLastStateRejectReason,
      serverLastStateAgeMs:this.serverLastStateAt?Math.max(0,Date.now()-this.serverLastStateAt):null,
      serverPeerCount:this.serverPeerCount,serverBroadcastPeers:this.serverBroadcastPeers,serverBroadcastAttempts:this.serverBroadcastAttempts,
      lastStateAckAt:this.lastStateAckAt,lastStateAckAgeMs:this.lastStateAckAt?Math.round(now-this.lastStateAckAt):null,
      stateSequence:this.stateSequence,lastPayloadChars:this.lastPayloadChars,lastSendError:this.lastSendError,
      sendIntervalMs:SEND_INTERVAL_MS,heartbeatIntervalMs:HEARTBEAT_INTERVAL_MS,
      endpoint:this.endpoint,lastClose:this.lastClose
    };
  }

  dispose() {
    if(this.disposed)return;this.disposed=true;
    if(this.reconnectTimer)clearTimeout(this.reconnectTimer);
    if(this.heartbeatTimer)clearInterval(this.heartbeatTimer);
    this.resolveSlotWaiters(null);
    this.reconnectTimer=null;this.heartbeatTimer=null;
    const socket=this.socket;this.socket=null;this.connected=false;this.slot=null;
    if(socket){socket.onclose=null;socket.onmessage=null;try{socket.close(1000,'page leaving');}catch{}}
    this.clearPlayers();
  }
}
