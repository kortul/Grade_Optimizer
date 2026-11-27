// Automatic alpine safety-net placement with time-sliced analysis and persistent IndexedDB caching.
function pointKey(x,z){return Math.round(x*4)+','+Math.round(z*4);}
export function buildSafetyFenceBoundaryChains(edges){
 const nodes=new Map(),edgeData=[];
 const addNode=(key,x,z)=>{let node=nodes.get(key);if(!node){node={x,z,edges:[]};nodes.set(key,node);}return node;};
 for(const edge of edges||[]){
  const aKey=pointKey(edge.ax,edge.az),bKey=pointKey(edge.bx,edge.bz);if(aKey===bKey)continue;
  const a=addNode(aKey,edge.ax,edge.az),b=addNode(bKey,edge.bx,edge.bz),id=edgeData.length;
  edgeData.push({aKey,bKey});a.edges.push(id);b.edges.push(id);
 }
 const visited=new Uint8Array(edgeData.length);
 const walk=(startKey,firstEdge)=>{
  const start=nodes.get(startKey);if(!start)return [];
  const points=[{x:start.x,z:start.z}];let currentKey=startKey,edgeId=firstEdge,guard=0;
  while(edgeId!==undefined&&!visited[edgeId]&&guard++<=edgeData.length){
   visited[edgeId]=1;const edge=edgeData[edgeId],nextKey=edge.aKey===currentKey?edge.bKey:edge.aKey,next=nodes.get(nextKey);
   if(!next)break;points.push({x:next.x,z:next.z});currentKey=nextKey;
   if(next.edges.length!==2)break;edgeId=next.edges.find(id=>!visited[id]);
  }
  return points;
 };
 const chains=[];
 for(const [key,node] of nodes)if(node.edges.length!==2)for(const edgeId of node.edges)if(!visited[edgeId]){
  const chain=walk(key,edgeId);if(chain.length>1)chains.push(chain);
 }
 for(let id=0;id<edgeData.length;id++)if(!visited[id]){
  const chain=walk(edgeData[id].aKey,id);if(chain.length>1)chains.push(chain);
 }
 return chains;
}
function cumulativeLengths(points){
 const lengths=new Float64Array(points.length);
 for(let i=1;i<points.length;i++)lengths[i]=lengths[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);
 return lengths;
}
function pointAtDistance(points,cumulative,distance){
 const total=cumulative[cumulative.length-1]||0,d=Math.max(0,Math.min(total,distance));let lo=0,hi=cumulative.length-1;
 while(lo<hi-1){const mid=(lo+hi)>>1;if(cumulative[mid]<d)lo=mid;else hi=mid;}
 const length=cumulative[hi]-cumulative[lo],t=length>1e-6?(d-cumulative[lo])/length:0;
 return {x:points[lo].x+(points[hi].x-points[lo].x)*t,z:points[lo].z+(points[hi].z-points[lo].z)*t};
}
function deterministicUnit(x,z,salt){const value=Math.sin(x*12.9898+z*78.233+salt*37.719)*43758.5453;return value-Math.floor(value);}
const yieldOneFrame=()=>new Promise(resolve=>{
 if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>resolve());
 else setTimeout(resolve,0);
});
export async function findSteepSafetyFencePlacements(footprint,isInsidePiste,sampleTerrainY,{
 spacing=5.5,panelWidth=5.8,panelHeight=1.38,minimumAngleDegrees=26,
 edgeSampleDistance=8,maxPanels=1600,maxChains=3,yieldEvery=12,yieldControl=yieldOneFrame
}={}){
 if(!footprint?.edges?.length||typeof isInsidePiste!=='function'||typeof sampleTerrainY!=='function')return [];
 const chains=buildSafetyFenceBoundaryChains(footprint.edges).map(points=>({points,length:cumulativeLengths(points)}))
  .filter(chain=>chain.length[chain.length-1]>=spacing*.72)
  .sort((a,b)=>b.length[b.length-1]-a.length[a.length-1]).slice(0,maxChains);
 const placements=[],left={x:0,z:0},minimumDrop=edgeSampleDistance*Math.tan(minimumAngleDegrees*Math.PI/180);
 let candidateCount=0;
 for(const chain of chains){
  const points=chain.points,cumulative=chain.distances,total=cumulative[cumulative.length-1];
  for(let distance=spacing*.5;distance<total-spacing*.28;distance+=spacing){
   const before=pointAtDistance(points,cumulative,Math.max(0,distance-1.15));
   const after=pointAtDistance(points,cumulative,Math.min(total,distance+1.15));
   const center=pointAtDistance(points,cumulative,distance);
   let tx=after.x-before.x,tz=after.z-before.z;const tangentLength=Math.hypot(tx,tz);
   if(tangentLength<1e-5)continue;
   tx/=tangentLength;tz/=tangentLength;left.x=-tz;left.z=tx;
   let insideLeft=null;
   for(const probeDistance of [1.1,2.2,4.0]){
    const li=!!isInsidePiste(center.x+left.x*probeDistance,center.z+left.z*probeDistance);
    const ri=!!isInsidePiste(center.x-left.x*probeDistance,center.z-left.z*probeDistance);
    if(li!==ri){insideLeft=li;break;}
   }
   if(debug&&candidateCount<5)console.log('FENCE SIDES',{insideLeft,left,tx,tz});
   if(insideLeft!==null){
    const outX=insideLeft?-left.x:left.x,outZ=insideLeft?-left.z:left.z;
    const edgeY=sampleTerrainY(center.x-outX*.55,center.z-outZ*.55)??sampleTerrainY(center.x,center.z);
    if(Number.isFinite(edgeY)){
     const outerY=sampleTerrainY(center.x+outX*edgeSampleDistance,center.z+outZ*edgeSampleDistance);
     if(Number.isFinite(outerY)){
      const drop=edgeY-outerY;
      if(drop>=minimumDrop){
       const angle=Math.atan(drop/edgeSampleDistance)*180/Math.PI;
       if(angle>=minimumAngleDegrees){
        placements.push({x:center.x+outX*.68,y:edgeY,z:center.z+outZ*.68,tx,tz,width:panelWidth,height:panelHeight,
         tint:.94+deterministicUnit(center.x,center.z,31)*.06});
        if(placements.length>=maxPanels)return placements;
       }
      }
     }
    }
   }
   if(++candidateCount%yieldEvery===0)await yieldControl();
  }
  await yieldControl();
 }
 return placements;
}
const SAFETY_FENCE_DB='grade-optimizer-derived-cache-v1',SAFETY_FENCE_STORE='safety-fence-placements';
let safetyFenceDbPromise=null;
const safetyFenceMemoryCache=new Map();
function openSafetyFenceDb(){
 if(typeof indexedDB==='undefined')return Promise.resolve(null);
 if(!safetyFenceDbPromise)safetyFenceDbPromise=new Promise(resolve=>{
  let request;try{request=indexedDB.open(SAFETY_FENCE_DB,1);}catch{return resolve(null);}
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(SAFETY_FENCE_STORE))db.createObjectStore(SAFETY_FENCE_STORE,{keyPath:'key'});};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null);request.onblocked=()=>resolve(null);
 });
 return safetyFenceDbPromise;
}
export async function getCachedSafetyFencePlacements(key){
 if(safetyFenceMemoryCache.has(key))return safetyFenceMemoryCache.get(key);
 const db=await openSafetyFenceDb();if(!db)return null;
 try{
  const value=await new Promise((resolve,reject)=>{
   const req=db.transaction(SAFETY_FENCE_STORE,'readonly').objectStore(SAFETY_FENCE_STORE).get(key);
   req.onsuccess=()=>resolve(req.result?.placements??null);req.onerror=()=>reject(req.error);
  });
  if(Array.isArray(value))safetyFenceMemoryCache.set(key,value);
  return Array.isArray(value)?value:null;
 }catch(error){console.warn('[Grade Optimizer] Safety-fence cache read failed:',error);return null;}
}
export async function setCachedSafetyFencePlacements(key,placements){
 safetyFenceMemoryCache.set(key,placements);
 const db=await openSafetyFenceDb();if(!db)return false;
 try{return await new Promise(resolve=>{
  const tx=db.transaction(SAFETY_FENCE_STORE,'readwrite');
  tx.objectStore(SAFETY_FENCE_STORE).put({key,placements,savedAt:Date.now()});
  tx.oncomplete=()=>resolve(true);tx.onerror=()=>resolve(false);tx.onabort=()=>resolve(false);
 });}catch(error){console.warn('[Grade Optimizer] Safety-fence cache write failed:',error);return false;}
}
export function buildSafetyFenceGroup(THREE,placements,texture,{visible=true}={}){
 if(!Array.isArray(placements)||!placements.length||!texture)return {group:null,count:0};
 const group=new THREE.Group();group.name='Piste_Safety_Fences';group.visible=!!visible;
 const geometry=new THREE.PlaneGeometry(1,1);
 const material=new THREE.MeshBasicMaterial({map:texture,color:0xffffff,transparent:true,alphaTest:.16,
  side:THREE.DoubleSide,depthWrite:false,toneMapped:false});
 const mesh=new THREE.InstancedMesh(geometry,material,placements.length);
 mesh.name='Instanced_Orange_Safety_Nets';mesh.castShadow=false;mesh.receiveShadow=false;mesh.frustumCulled=false;
 mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
 const dummy=new THREE.Object3D(),tint=new THREE.Color();
 placements.forEach((panel,index)=>{
  dummy.position.set(panel.x,panel.y+panel.height*.5,panel.z);
  dummy.rotation.set(0,Math.atan2(-panel.tz,panel.tx),0);dummy.scale.set(panel.width,panel.height,1);dummy.updateMatrix();
  mesh.setMatrixAt(index,dummy.matrix);const brightness=panel.tint||1;
  tint.setRGB(1,.94*brightness,.84*brightness);mesh.setColorAt(index,tint);
 });
 mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
 mesh.computeBoundingSphere();mesh.renderOrder=7;group.add(mesh);
 return {group,count:placements.length};
}
