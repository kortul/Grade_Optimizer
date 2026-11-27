// Lightweight auto-placement of alpine piste safety nets.
// Connected boundary chains are sampled at panel intervals; only steep drops and cliff edges are fenced.
function pointKey(x,z){return Math.round(x*4)+','+Math.round(z*4);}
function buildBoundaryChains(edges){
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
/** Finds panels where the terrain falls away steeply immediately outside a piste. */
/** Finds panels only when the terrain falls away steeply immediately outside a piste.
 * Two height queries per sample keep this cheap enough for manual/on-demand generation.
 */
export function findSteepSafetyFencePlacements(footprint,isInsidePiste,sampleTerrainY,{
 spacing=5.5,panelWidth=5.8,panelHeight=1.38,minimumAngleDegrees=26,
 edgeSampleDistance=8,maxPanels=2400
}={}){
 if(!footprint?.edges?.length||typeof isInsidePiste!=='function'||typeof sampleTerrainY!=='function')return [];
 const placements=[],left={x:0,z:0},minimumDrop=edgeSampleDistance*Math.tan(minimumAngleDegrees*Math.PI/180);
 for(const points of buildBoundaryChains(footprint.edges)){
  if(points.length<2)continue;
  const cumulative=cumulativeLengths(points),total=cumulative[cumulative.length-1];
  if(total<spacing*.72)continue;
  for(let distance=spacing*.5;distance<total-spacing*.28;distance+=spacing){
   const before=pointAtDistance(points,cumulative,Math.max(0,distance-1.15));
   const after=pointAtDistance(points,cumulative,Math.min(total,distance+1.15));
   const center=pointAtDistance(points,cumulative,distance);
   let tx=after.x-before.x,tz=after.z-before.z;
   const tangentLength=Math.hypot(tx,tz);if(tangentLength<1e-5)continue;
   tx/=tangentLength;tz/=tangentLength;left.x=-tz;left.z=tx;
   let insideLeft=null;
   for(const probeDistance of [1.1,2.2,4.0]){
    const leftInside=!!isInsidePiste(center.x+left.x*probeDistance,center.z+left.z*probeDistance);
    const rightInside=!!isInsidePiste(center.x-left.x*probeDistance,center.z-left.z*probeDistance);
    if(leftInside!==rightInside){insideLeft=leftInside;break;}
   }
   if(insideLeft===null)continue;
   const outX=insideLeft?-left.x:left.x,outZ=insideLeft?-left.z:left.z;
   const edgeX=center.x-outX*.55,edgeZ=center.z-outZ*.55;
   const edgeY=sampleTerrainY(edgeX,edgeZ)??sampleTerrainY(center.x,center.z);
   if(!Number.isFinite(edgeY))continue;
   const outerY=sampleTerrainY(center.x+outX*edgeSampleDistance,center.z+outZ*edgeSampleDistance);
   if(!Number.isFinite(outerY))continue;
   const drop=edgeY-outerY;
   if(drop<minimumDrop)continue;
   const angle=Math.atan(drop/edgeSampleDistance)*180/Math.PI;
   if(angle<minimumAngleDegrees)continue;
   placements.push({
    x:center.x+outX*.68,y:edgeY,z:center.z+outZ*.68,
    tx,tz,width:panelWidth,height:panelHeight,
    tint:.94+deterministicUnit(center.x,center.z,31)*.06
   });
   if(placements.length>=maxPanels)return placements;
  }
 }
 return placements;
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