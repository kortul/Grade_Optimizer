import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SkierController } from './skier-controller.js';

let saved=null;
try{ saved=JSON.parse(localStorage.getItem('ssgo_default_preset')||'null'); }catch(e){}

const state = {
  slope:(saved&&saved.slope)||'A1',
  ang:(saved&&saved.slope_angle)||35,
  prof:(saved&&saved.profile_level)!==undefined&&(saved&&saved.profile_level)!==null?(saved.profile_level):0,
  cut:(saved&&saved.max_cut_depth)||5,
  off:-0.75, cross:0.264, optimize:false,
usable:90, earthwork_w:0.03, max_fill:0, off_range:3, cross_max:3, labelOpacity:1,
  terrainVisible:true, terrainOpacity:1, designVisible:true, gridVisible:true,
  labelsVisible:true, terrainLabelsVisible:true, terrainSlopesVisible:false,
  root:null, terrain:null, terrainMats:[], curves:null,
  designGroup:null, labelsGroup:null, terrainLabelsGroup:null,
  homePos:null, homeTarget:null, mode:'overview', dayTime:13, autoTime:false, optimizeMode:false,
  forestGroup:null, billboardMesh:null, billboardTrees:[]
};

const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(view.clientWidth, view.clientHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(view.clientWidth, view.clientHeight);
labelRenderer.domElement.style.position='absolute';
labelRenderer.domElement.style.top='0';
labelRenderer.domElement.style.left='0';
labelRenderer.domElement.style.pointerEvents='none';
view.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = null;
scene.fog = new THREE.Fog(0x9bb4c8, 1800, 9000);
const camera = new THREE.PerspectiveCamera(55, view.clientWidth/view.clientHeight, 0.5, 20000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.enableZoom = false;
controls.rotateSpeed = 0.8;
controls.minDistance = 30;
controls.maxDistance = 4000;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

const hemisphere = new THREE.HemisphereLight(0xbfd4ff, 0x3a3a2f, 0.9);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xfff3df, 3.0);
sun.position.set(300, 600, 200);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 3000;
sun.shadow.camera.left = -1200; sun.shadow.camera.right = 1200;
sun.shadow.camera.top = 1200; sun.shadow.camera.bottom = -1200;
sun.shadow.bias = -0.0005;
scene.add(sun);
scene.add(sun.target);

// Procedural sky dome keeps the scene self-contained; no external HDRI is required.
const skyUniforms = {
  topColor: { value: new THREE.Color(0x4b83b8) },
  horizonColor: { value: new THREE.Color(0xb8d0df) },
  bottomColor: { value: new THREE.Color(0x71869a) },
  sunDirection: { value: new THREE.Vector3(0,1,0) },
  sunColor: { value: new THREE.Color(0xffd4a0) },
  sunStrength: { value: 0.8 }
};
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(12000, 32, 18),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    vertexShader: `varying vec3 vWorldDirection;
      void main(){
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldDirection = normalize(worldPosition.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }`,
    fragmentShader: `uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 bottomColor;
      uniform vec3 sunDirection; uniform vec3 sunColor; uniform float sunStrength;
      varying vec3 vWorldDirection;
      void main(){
        vec3 dir = normalize(vWorldDirection);
        float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 sky = mix(bottomColor, horizonColor, smoothstep(0.0, 0.55, h));
        sky = mix(sky, topColor, smoothstep(0.48, 1.0, h));
        float sunDot = max(dot(dir, normalize(sunDirection)), 0.0);
        sky += sunColor * pow(sunDot, 380.0) * sunStrength * 2.4;
        sky += sunColor * pow(sunDot, 15.0) * sunStrength * 0.15;
        gl_FragColor = vec4(sky, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false
  })
);
skyDome.frustumCulled = false;
skyDome.renderOrder = -1000;
scene.add(skyDome);

const lightingCenter = new THREE.Vector3();
let sunAzimuthOffset = 0;
let sunIntensityScale = 1;
let sunEnabled = true;
const daylightColors = {
  nightTop: new THREE.Color(0x071322), nightHorizon: new THREE.Color(0x24384a), nightBottom: new THREE.Color(0x101b29),
  dayTop: new THREE.Color(0x4b83b8), dayHorizon: new THREE.Color(0xd6e5ef), dayBottom: new THREE.Color(0x94a9b8),
  warmTop: new THREE.Color(0x9a6170), warmHorizon: new THREE.Color(0xf4b77d), warmBottom: new THREE.Color(0x8f6970),
  nightGround: new THREE.Color(0x151c28), dayGround: new THREE.Color(0x4c594f),
  nightHemisphere: new THREE.Color(0x40516d), dayHemisphere: new THREE.Color(0xc7dfff),
  warmSun: new THREE.Color(0xffa45f), daySun: new THREE.Color(0xfff2d9)
};
const smooth01 = (a,b,x) => { const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
function updateDaylight(hours = state.dayTime) {
  const phase = (hours - 6) / 12 * Math.PI;
  const altitude = Math.sin(phase) * 1.25;
  const azimuth = phase - Math.PI/2 + THREE.MathUtils.degToRad(sunAzimuthOffset);
  const sunDir = new THREE.Vector3(
    Math.cos(altitude)*Math.cos(azimuth),
    Math.sin(altitude),
    Math.cos(altitude)*Math.sin(azimuth)
  ).normalize();
  const daylight = smooth01(-0.08, 0.22, sunDir.y);
  const warm = Math.max(
    1 - Math.abs(hours-7.1)/2.2,
    1 - Math.abs(hours-19.0)/2.2,
    0
  );
  const top = daylightColors.nightTop.clone().lerp(daylightColors.dayTop, daylight).lerp(daylightColors.warmTop, warm*0.45);
  const horizon = daylightColors.nightHorizon.clone().lerp(daylightColors.dayHorizon, daylight).lerp(daylightColors.warmHorizon, warm*0.88);
  const bottom = daylightColors.nightBottom.clone().lerp(daylightColors.dayBottom, daylight).lerp(daylightColors.warmBottom, warm*0.5);
  const sunColor = daylightColors.warmSun.clone().lerp(daylightColors.daySun, 1-warm*0.8);

  skyUniforms.topColor.value.copy(top);
  skyUniforms.horizonColor.value.copy(horizon);
  skyUniforms.bottomColor.value.copy(bottom);
  skyUniforms.sunDirection.value.copy(sunDir);
  skyUniforms.sunColor.value.copy(sunColor);
  skyUniforms.sunStrength.value = daylight;
  sun.position.copy(lightingCenter).addScaledVector(sunDir, 1400);
  sun.target.position.copy(lightingCenter);
  sun.intensity = sunEnabled ? 3.0 * daylight * (sunIntensityScale/3) : 0;
  sun.visible = sunEnabled && daylight > 0.01;
  sun.castShadow = sunEnabled && daylight > 0.08;
  hemisphere.color.copy(daylightColors.nightHemisphere).lerp(daylightColors.dayHemisphere, daylight);
  hemisphere.groundColor.copy(daylightColors.nightGround).lerp(daylightColors.dayGround, daylight);
  hemisphere.intensity = 0.28 + daylight*0.62;
  scene.fog.color.copy(horizon);
}
function formatClock(hours) {
  const total = Math.round(hours*60);
  return String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');
}
const timeSlider = document.getElementById('timeOfDay');
const timeValue = document.getElementById('timeValue');
const autoDayButton = document.getElementById('autoDay');
function setTimeOfDay(value) {
  state.dayTime = THREE.MathUtils.clamp(value, 5, 22);
  timeSlider.value = String(state.dayTime);
  timeValue.textContent = formatClock(state.dayTime);
  updateDaylight(state.dayTime);
}
timeSlider.addEventListener('input', e => {
  state.autoTime = false;
  autoDayButton.classList.remove('active');
  autoDayButton.textContent = '▶';
  setTimeOfDay(parseFloat(e.target.value));
});
autoDayButton.addEventListener('click', () => {
  state.autoTime = !state.autoTime;
  autoDayButton.classList.toggle('active', state.autoTime);
  autoDayButton.textContent = state.autoTime ? 'Ⅱ' : '▶';
});
setTimeOfDay(state.dayTime);

let targetDist = null;
renderer.domElement.addEventListener('wheel', ev=>{
  if(state.mode !== 'overview') return;
  ev.preventDefault();
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  let d = dir.length();
  const factor = Math.exp(ev.deltaY * 0.0012);
  d = THREE.MathUtils.clamp(d * factor, 30, 4000);
  targetDist = d;
}, { passive:false });

let resizeRaf = 0;
let lastViewWidth = 0, lastViewHeight = 0;
function syncViewportSize() {
  const rect = view.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (width === lastViewWidth && height === lastViewHeight) return;
  lastViewWidth = width; lastViewHeight = height;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  labelRenderer.setSize(width, height);
}
function scheduleViewportResize() {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    syncViewportSize();
  });
}
window.addEventListener('resize', scheduleViewportResize);
if (typeof ResizeObserver !== 'undefined') {
  const viewResizeObserver = new ResizeObserver(scheduleViewportResize);
  viewResizeObserver.observe(view);
}
scheduleViewportResize();

const dbgEl = document.getElementById('debug');
function dbg(msg){ dbgEl.textContent += msg + "\n"; }
const bust = () => '?t=' + Date.now();
const assetManager = new THREE.LoadingManager();
let assetToken = Date.now();
assetManager.setURLModifier(url => {
  if (/\.bin(\?|$)/i.test(url)) return url + (url.includes('?') ? '&' : '?') + 't=' + assetToken;
  return url;
});
const loader = new GLTFLoader(assetManager);
const loadGLTF = url => new Promise((res, rej) => loader.load(url, res, undefined, rej));
const loadJSON = url => fetch(url).then(r => { if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });

function alignDir(ref, pts){
  const d1=Math.hypot(ref[0][0]-pts[0][0],ref[0][2]-pts[0][2])+Math.hypot(ref[ref.length-1][0]-pts[pts.length-1][0],ref[ref.length-1][2]-pts[pts.length-1][2]);
  const d2=Math.hypot(ref[0][0]-pts[pts.length-1][0],ref[0][2]-pts[pts.length-1][2])+Math.hypot(ref[ref.length-1][0]-pts[0][0],ref[ref.length-1][2]-pts[0][2]);
  return d2<d1 ? pts.slice().reverse() : pts;
}

const raycaster=new THREE.Raycaster();
const down=new THREE.Vector3(0,-1,0);
function terrainY(x,z){
  raycaster.set(new THREE.Vector3(x,1e5,z), down);
  const h=raycaster.intersectObject(state.terrain,true);
  return h.length? h[0].point.y : null;
}

// ---------- Snow surface + lightweight test forest ----------
let snowTextures = null;
let treeBillboardMaterial = null;

function makeSnowTextures() {
  if (snowTextures) return snowTextures;
  const size = 512;
  let seed = 0xA1B2026;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = size;
  const colorCtx = colorCanvas.getContext('2d');
  const colorImage = colorCtx.createImageData(size,size);
  for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
    const i=(y*size+x)*4;
    const broad = Math.sin(y*0.035 + Math.sin(x*0.013)*2.2)*2.5
                + Math.sin((x+y)*0.021)*1.2;
    const grain = (rnd()-0.5)*12 + broad;
    colorImage.data[i]   = Math.max(0,Math.min(255,231+grain));
    colorImage.data[i+1] = Math.max(0,Math.min(255,239+grain));
    colorImage.data[i+2] = Math.max(0,Math.min(255,246+grain));
    colorImage.data[i+3] = 255;
  }
  colorCtx.putImageData(colorImage,0,0);
  // Fine wind-combed streaks: barely visible, so the snow does not look striped.
  for (let i=0;i<150;i++) {
    const y=rnd()*size, x=rnd()*size, len=12+rnd()*90;
    colorCtx.strokeStyle = rnd()>0.5 ? 'rgba(255,255,255,0.09)' : 'rgba(112,139,159,0.035)';
    colorCtx.lineWidth = 0.5+rnd()*1.4;
    colorCtx.beginPath(); colorCtx.moveTo(x,y); colorCtx.lineTo(x+len,y+(rnd()-0.5)*2); colorCtx.stroke();
  }

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = bumpCanvas.height = size;
  const bumpCtx = bumpCanvas.getContext('2d');
  const bumpImage = bumpCtx.createImageData(size,size);
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const i=(y*size+x)*4;
    const v=Math.max(0,Math.min(255,128+(rnd()-0.5)*38+Math.sin(y*0.07+x*0.025)*5));
    bumpImage.data[i]=bumpImage.data[i+1]=bumpImage.data[i+2]=v;
    bumpImage.data[i+3]=255;
  }
  bumpCtx.putImageData(bumpImage,0,0);

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1,1);
  map.anisotropy = Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const bump = new THREE.CanvasTexture(bumpCanvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(1,1);
  bump.anisotropy = Math.min(8,renderer.capabilities.getMaxAnisotropy());
  snowTextures = { map, bump };
  return snowTextures;
}

function setTerrainSnowMaterial(mesh) {
  const geometry = mesh.geometry;
  const position = geometry && geometry.attributes && geometry.attributes.position;
  if (!position) return;
  const uv = new Float32Array(position.count*2);
  // World-like planar UVs: one tile covers roughly 34 metres.
  for (let i=0;i<position.count;i++) {
    uv[i*2] = position.getX(i)/34;
    uv[i*2+1] = position.getZ(i)/34;
  }
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  const tex = makeSnowTextures();
  const material = new THREE.MeshStandardMaterial({
    color:0xffffff, map:tex.map, bumpMap:tex.bump, bumpScale:0.035,
    roughness:0.97, metalness:0, side:THREE.DoubleSide
  });
  mesh.material = material;
  mesh.receiveShadow = true;
  state.terrainMats.push(material);
}

function makePineTextures() {
  const width=256, height=512;
  const canvas=document.createElement('canvas');
  canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext('2d');
  const cx=128;

  // Trunk and layered conifer silhouette, with small snowy branch highlights.
  const trunk=ctx.createLinearGradient(115,0,143,0);
  trunk.addColorStop(0,'#382f2a'); trunk.addColorStop(0.45,'#765b43'); trunk.addColorStop(1,'#302b29');
  ctx.fillStyle=trunk;
  ctx.beginPath(); ctx.moveTo(119,490); ctx.lineTo(121,275); ctx.lineTo(136,275); ctx.lineTo(140,490); ctx.closePath(); ctx.fill();

  const greens=['#477d58','#538b63','#60996d','#3e724f','#6b9d70'];
  for (let layer=0;layer<5;layer++) {
    const top=24+layer*63;
    const base=105+layer*58;
    const half=31+layer*18;
    const grad=ctx.createLinearGradient(0,top,0,base);
    grad.addColorStop(0,greens[layer]);
    grad.addColorStop(1,layer%2?'#315b40':'#356448');
    ctx.fillStyle=grad;
    ctx.beginPath();
    ctx.moveTo(cx,top);
    ctx.lineTo(cx-half*0.55,top+27);
    ctx.lineTo(cx-half*0.37,top+26);
    ctx.lineTo(cx-half,base-8);
    ctx.lineTo(cx-half*0.56,base-2);
    ctx.lineTo(cx-half*0.72,base+8);
    ctx.lineTo(cx,base-4);
    ctx.lineTo(cx+half*0.72,base+8);
    ctx.lineTo(cx+half*0.56,base-2);
    ctx.lineTo(cx+half,base-8);
    ctx.lineTo(cx+half*0.37,top+26);
    ctx.lineTo(cx+half*0.55,top+27);
    ctx.closePath(); ctx.fill();

    ctx.strokeStyle='rgba(218,238,229,0.42)';
    ctx.lineWidth=3.2;
    ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(cx-half*0.80,base-10);
    ctx.lineTo(cx-half*0.43,top+34);
    ctx.lineTo(cx-half*0.14,top+7);
    ctx.stroke();
    for (let k=0;k<12;k++) {
      const yy=top+18+Math.random()*Math.max(8,base-top-26);
      const side=Math.random()<0.5?-1:1;
      const xx=cx+side*(8+Math.random()*half*0.72);
      ctx.strokeStyle='rgba(8,28,25,0.22)';
      ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(xx,yy); ctx.lineTo(xx+side*7,yy+4); ctx.stroke();
    }
  }

  const map=new THREE.CanvasTexture(canvas);
  map.colorSpace=THREE.SRGBColorSpace;
  map.minFilter=THREE.LinearMipmapLinearFilter;
  map.magFilter=THREE.LinearFilter;
  map.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());

  // Approximate tangent-space normal map from the cutout silhouette.
  // The alpha gradient gives the card subtle edge lighting rather than a flat plane look.
  const src=ctx.getImageData(0,0,width,height).data;
  const normalCanvas=document.createElement('canvas');
  normalCanvas.width=width; normalCanvas.height=height;
  const nctx=normalCanvas.getContext('2d');
  const nimg=nctx.createImageData(width,height);
  const alpha=(x,y)=> {
    if(x<0||x>=width||y<0||y>=height)return 0;
    return src[(y*width+x)*4+3];
  };
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=(y*width+x)*4;
    const dx=(alpha(x+1,y)-alpha(x-1,y))/255;
    const dy=(alpha(x,y+1)-alpha(x,y-1))/255;
    nimg.data[i]=Math.max(0,Math.min(255,128-dx*42));
    nimg.data[i+1]=Math.max(0,Math.min(255,128+dy*42));
    nimg.data[i+2]=245;
    nimg.data[i+3]=255;
  }
  nctx.putImageData(nimg,0,0);
  const normalMap=new THREE.CanvasTexture(normalCanvas);
  normalMap.minFilter=THREE.LinearMipmapLinearFilter;
  normalMap.magFilter=THREE.LinearFilter;
  treeBillboardMaterial=new THREE.MeshStandardMaterial({
    map, normalMap, normalScale:new THREE.Vector2(0.32,0.32),
    color:0xffffff, emissive:0x243a2a, emissiveIntensity:0.48,
    roughness:1, metalness:0, side:THREE.DoubleSide,
    alphaTest:0.12, transparent:false
  });
  return treeBillboardMaterial;
}

function clearTestForest() {
  if (state.forestGroup) {
    scene.remove(state.forestGroup);
    state.forestGroup.traverse(o=>{
      if(o.geometry) o.geometry.dispose();
      if(o.material) {
        const mats=Array.isArray(o.material)?o.material:[o.material];
        mats.forEach(m=>{ if(m!==treeBillboardMaterial) m.dispose(); });
      }
    });
  }
  if(treeBillboardMaterial) {
    treeBillboardMaterial.map?.dispose();
    treeBillboardMaterial.normalMap?.dispose();
    treeBillboardMaterial.dispose();
    treeBillboardMaterial=null;
  }
  state.forestGroup=null;
  state.billboardMesh=null;
  state.billboardTrees=[];
}

function buildTestForest() {
  clearTestForest();
  if(!state.terrain) return;
  const bounds=new THREE.Box3().setFromObject(state.terrain);
  const spanX=bounds.max.x-bounds.min.x;
  const spanZ=bounds.max.z-bounds.min.z;
  const laneZ=bounds.min.z+spanZ*0.187;
  let seed=0x51A1;
  const rnd=()=>{ seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; };
  const trees=[];
  const xMin=bounds.min.x+spanX*0.025, xMax=bounds.max.x-spanX*0.025;
  const zMin=bounds.min.z+spanZ*0.025, zMax=bounds.max.z-spanZ*0.025;

  // Populate the full terrain extent while preserving a clear fall-line corridor.
  const desiredCount=380;
  const minSpacing=11.5;
  for(let attempt=0;attempt<5200 && trees.length<desiredCount;attempt++) {
    const x=THREE.MathUtils.lerp(xMin,xMax,rnd());
    const z=THREE.MathUtils.lerp(zMin,zMax,rnd());
    const corridor=27+rnd()*8;
    if(Math.abs(z-laneZ)<corridor) continue;
    if(trees.some(t=>Math.hypot(t.x-x,t.z-z)<minSpacing)) continue;
    const y=terrainY(x,z);
    if(y===null) continue;
    const height=6.0+rnd()*5.6;
    trees.push({x,y,z,height,width:height*(0.44+rnd()*0.10)});
  }

  if(!trees.length) return;
  const forest=new THREE.Group();
  forest.name='TestForest_Billboards_LOD';
  state.forestGroup=forest;
  scene.add(forest);

  // A small near-field set uses simple instanced 3D firs.
  const closeTrees=trees.filter((t,i)=>Math.abs(t.z-laneZ)<105 && i%4===0).slice(0,42);
  if(closeTrees.length) {
    const trunkGeo=new THREE.CylinderGeometry(0.08,0.13,1,5);
    const coneGeo=new THREE.ConeGeometry(1,2,6,1);
    const trunkMat=new THREE.MeshStandardMaterial({color:0x8b7055,roughness:1});
    const foliageMat=new THREE.MeshStandardMaterial({
      color:0x4d875c, emissive:0x173522, emissiveIntensity:0.35, roughness:0.96
    });
    const trunkMesh=new THREE.InstancedMesh(trunkGeo,trunkMat,closeTrees.length);
    const lowerMesh=new THREE.InstancedMesh(coneGeo,foliageMat,closeTrees.length);
    const middleMesh=new THREE.InstancedMesh(coneGeo,foliageMat,closeTrees.length);
    const topMesh=new THREE.InstancedMesh(coneGeo,foliageMat,closeTrees.length);
    const dummy=new THREE.Object3D();
    closeTrees.forEach((t,i)=>{
      const h=t.height*1.04;
      dummy.rotation.set(0,rnd()*Math.PI*2,0);
      dummy.position.set(t.x,t.y+h*0.15,t.z);
      dummy.scale.set(0.82,h*0.19,0.82);
      dummy.updateMatrix(); trunkMesh.setMatrixAt(i,dummy.matrix);

      const tiers=[[0.46,0.40,0.43],[0.68,0.33,0.34],[0.86,0.23,0.26]];
      for(const [index,mesh] of [lowerMesh,middleMesh,topMesh].entries()) {
        const tier=tiers[index];
        dummy.position.set(t.x,t.y+h*tier[0],t.z);
        dummy.scale.set(h*tier[1],h*tier[2],h*tier[1]);
        dummy.updateMatrix(); mesh.setMatrixAt(i,dummy.matrix);
      }
      const tint=new THREE.Color().setHSL(0.36+rnd()*0.035,0.28+rnd()*0.10,0.43+rnd()*0.09);
      lowerMesh.setColorAt(i,tint);
      middleMesh.setColorAt(i,tint.clone().offsetHSL(0,0,0.035));
      topMesh.setColorAt(i,tint.clone().offsetHSL(0,0,0.07));
    });
    [trunkMesh,lowerMesh,middleMesh,topMesh].forEach(m=>{
      m.castShadow=false; m.receiveShadow=true; m.frustumCulled=false; forest.add(m);
    });
  }

  const billboardTrees=trees.filter(t=>!closeTrees.includes(t));
  if(billboardTrees.length) {
    const material=makePineTextures();
    const geometry=new THREE.PlaneGeometry(1,1);
    const mesh=new THREE.InstancedMesh(geometry,material,billboardTrees.length);
    mesh.name='Pine_Billboard_Impostors';
    mesh.frustumCulled=false;
    mesh.castShadow=false;
    mesh.receiveShadow=false;
    const dummy=new THREE.Object3D();
    billboardTrees.forEach((t,i)=>{
      dummy.position.set(t.x,t.y+t.height*0.5,t.z);
      dummy.rotation.set(0,rnd()*Math.PI*2,0);
      dummy.scale.set(t.width,t.height,1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i,dummy.matrix);
      // Keep billboard albedo untinted: setColorAt here multiplied an already dark map.
    });
    mesh.instanceMatrix.needsUpdate=true;
    forest.add(mesh);
    state.billboardMesh=mesh;
    state.billboardTrees=billboardTrees.map(t=>({x:t.x,y:t.y,z:t.z,height:t.height,width:t.width}));
  }
  dbg('Лес тестового склона: '+trees.length+' деревьев · 3D '+closeTrees.length+' · billboard '+billboardTrees.length);
}

const forestUp=new THREE.Vector3(0,1,0);
const forestPosition=new THREE.Vector3();
const forestScale=new THREE.Vector3();
const forestQuaternion=new THREE.Quaternion();
const forestMatrix=new THREE.Matrix4();
function updateForestBillboards() {
  if(!state.billboardMesh || !state.billboardTrees.length) return;
  state.billboardTrees.forEach((t,i)=>{
    const yaw=Math.atan2(camera.position.x-t.x,camera.position.z-t.z);
    forestQuaternion.setFromAxisAngle(forestUp,yaw);
    forestPosition.set(t.x,t.y+t.height*0.5,t.z);
    forestScale.set(t.width,t.height,1);
    forestMatrix.compose(forestPosition,forestQuaternion,forestScale);
    state.billboardMesh.setMatrixAt(i,forestMatrix);
  });
  state.billboardMesh.instanceMatrix.needsUpdate=true;
}


function clearGroup(g){ if(g){ scene.remove(g); g.traverse(o=>{ if(o.geometry) o.geometry.dispose(); }); } return null; }

function applyTerrainLook(){
  state.terrainMats.forEach(m=>{
    m.opacity=state.terrainOpacity;
    m.transparent=state.terrainOpacity<1;
  });
  if(state.terrain) state.terrain.visible=state.terrainVisible;
  if(state.terrainLabelsGroup) state.terrainLabelsGroup.visible=state.terrainLabelsVisible;
}
function applyDesignLook(){
  if(state.designGroup) state.designGroup.visible=state.designVisible;
  if(state.labelsGroup) state.labelsGroup.visible=state.labelsVisible;
}

const clickRay=new THREE.Raycaster();
const ndc=new THREE.Vector2();
renderer.domElement.addEventListener('dblclick', ev=>{
  if(state.mode !== 'overview') return;
  const rect=renderer.domElement.getBoundingClientRect();
  ndc.x=((ev.clientX-rect.left)/rect.width)*2-1;
  ndc.y=-((ev.clientY-rect.top)/rect.height)*2+1;
  clickRay.setFromCamera(ndc,camera);
  const targets=[];
  if(state.designGroup&&state.designVisible) targets.push(state.designGroup);
  if(state.terrain&&state.terrainVisible) targets.push(state.terrain);
  const hits=clickRay.intersectObjects(targets,true);
  if(!hits.length) return;
  const p=hits[0].point;
  const dist=camera.position.distanceTo(controls.target);
  controls.target.copy(p);
  const dir=new THREE.Vector3().subVectors(camera.position,controls.target).normalize();
  camera.position.copy(p).addScaledVector(dir,Math.min(dist,200));
  controls.update(); targetDist=null;
});

// ===== Прозрачность лейблов =====
function applyLabelOpacity(){
  const v=(state.labelOpacity===undefined)?1:state.labelOpacity;
  const hide=v<=0.1;
  [state.labelsGroup,state.terrainLabelsGroup,measureGroup].forEach(g=>{
    if(!g)return;
    g.traverse(o=>{
      if(o.isSprite&&o.material){
        o.material.opacity=v;
        o.material.transparent=true;
        o.material.depthWrite=false;
        o.visible=!hide;
      }
    });
  });
}

// ===== 3D-линейка =====
let measureMode=false,measurePts=[],measureGroup=null,measureComplete=false;
const measureBtn=document.getElementById('measureBtn');
const ELEV_OFF=21.21;
function clearMeasure(){
  if(measureGroup){
    scene.remove(measureGroup);
    measureGroup.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material&&o.material.map)o.material.map.dispose();});
    measureGroup=null;
  }
  measurePts=[];
  measureComplete=false;
}
function measureLabel(text,p,small){
  const cnv=document.createElement('canvas');cnv.width=small?300:640;cnv.height=96;
  const ctx=cnv.getContext('2d');
  ctx.fillStyle='rgba(0,0,0,0.3)';ctx.fillRect(0,0,cnv.width,96);
  ctx.fillStyle='#ffd54a';ctx.font=(small?'bold 40px':'bold 38px')+' sans-serif';ctx.textAlign='center';
  ctx.fillText(text,cnv.width/2,62);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cnv),depthTest:false,transparent:true,opacity:state.labelOpacity}));
  sp.scale.set(small?11:28,small?3.5:4.2,1);sp.position.copy(p);sp.renderOrder=11;
  return sp;
}
measureBtn.addEventListener('click',()=>{
  measureMode=!measureMode;
  measureBtn.classList.toggle('active',measureMode);
  measureBtn.title=measureMode?'Выключить линейку':'Включить линейку';
  if(!measureMode)clearMeasure();
});
let measureDown=null;
renderer.domElement.addEventListener('pointerdown',e=>{measureDown=[e.clientX,e.clientY];});
renderer.domElement.addEventListener('pointerup',e=>{
  if(state.mode !== 'overview'||!measureMode||!measureDown)return;
  if(Math.hypot(e.clientX-measureDown[0],e.clientY-measureDown[1])>5){measureDown=null;return;}
  measureDown=null;
  const rect=renderer.domElement.getBoundingClientRect();
  ndc.x=((e.clientX-rect.left)/rect.width)*2-1;
  ndc.y=-((e.clientY-rect.top)/rect.height)*2+1;
  clickRay.setFromCamera(ndc,camera);
  const targets=[];
  if(state.designGroup&&state.designVisible)targets.push(state.designGroup);
  if(state.terrain&&state.terrainVisible)targets.push(state.terrain);
  const hits=clickRay.intersectObjects(targets,true);
  if(!hits.length)return;
  const p=hits[0].point.clone();
  if(measureComplete){clearMeasure();}
  if(!measureGroup){measureGroup=new THREE.Group();scene.add(measureGroup);}
  measurePts.push(p);
  const mk=new THREE.Mesh(new THREE.SphereGeometry(1.1,12,12),new THREE.MeshBasicMaterial({color:0xffd54a}));
  mk.position.copy(p);measureGroup.add(mk);
  measureGroup.add(measureLabel('H '+(p.y+ELEV_OFF).toFixed(1),new THREE.Vector3(p.x,p.y+5,p.z),true));
  if(measurePts.length===2){
    const a=measurePts[0],b=measurePts[1];
    const g=new THREE.BufferGeometry().setFromPoints([a,b]);
    const ln=new THREE.Line(g,new THREE.LineDashedMaterial({color:0xffd54a,dashSize:4,gapSize:2.5}));
    ln.computeLineDistances();
    measureGroup.add(ln);
    const d3=a.distanceTo(b),dh=Math.hypot(b.x-a.x,b.z-a.z),dzv=b.y-a.y;
    const ang=Math.atan2(Math.abs(dzv),Math.max(dh,1e-6))*180/Math.PI;
    const mid=new THREE.Vector3().addVectors(a,b).multiplyScalar(0.5);
    mid.y+=7;
    measureGroup.add(measureLabel(
      d3.toFixed(1)+' м · '+ang.toFixed(1)+'° (Δh '+(dzv>=0?'+':'')+dzv.toFixed(1)+')',mid,false));
    applyLabelOpacity();
    measurePts=[];
    measureComplete=true;
  }
});

function goHome(){
  if(state.homePos&&state.homeTarget){
    camera.position.copy(state.homePos);
    controls.target.copy(state.homeTarget);
    controls.update(); targetDist=null;
  }
}
document.getElementById('homeBtn').addEventListener('click',goHome);

// ================== ПОРТ ДВИЖКА MAYA ==================
const p2=p=>[p[0],p[2]];
const hyp=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function signedArea(poly){
  let a=0,n=poly.length;
  for(let i=0;i<n;i++){a+=poly[i][0]*poly[(i+1)%n][1]-poly[(i+1)%n][0]*poly[i][1];}
  return 0.5*a;
}
function pointInPoly(x,z,poly){
  let inside=false,n=poly.length,j=n-1;
  for(let i=0;i<n;i++){
    const xi=poly[i][0],zi=poly[i][1],xj=poly[j][0],zj=poly[j][1];
    if((zi>z)!==(zj>z)){ if(x<(xj-xi)*(z-zi)/(zj-zi)+xi) inside=!inside; }
    j=i;
  }
  return inside;
}
const _orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function segsCross(a,b,c,d){
  const o1=_orient(a,b,c),o2=_orient(a,b,d),o3=_orient(c,d,a),o4=_orient(c,d,b);
  return (o1*o2<0)&&(o3*o4<0);
}
function pointInTri(q,a,b,c){
  const d1=_orient(a,b,q),d2=_orient(b,c,q),d3=_orient(c,a,q);
  return !(((d1<0)||(d2<0)||(d3<0))&&((d1>0)||(d2>0)||(d3>0)));
}
const unit=v=>{const l=Math.hypot(v[0],v[1]);return l<1e-12?[0,0]:[v[0]/l,v[1]/l];};
class TriSampler{
  constructor(verts,tris){
    const xs=verts.map(v=>v[0]),zs=verts.map(v=>v[2]);
    this.minx=Math.min(...xs);this.minz=Math.min(...zs);
    let tot=0,cnt=0;
    for(const t of tris.slice(0,3000)){
      const A=verts[t[0]],B=verts[t[1]],C=verts[t[2]];
      tot+=hyp(p2(A),p2(B))+hyp(p2(B),p2(C))+hyp(p2(C),p2(A));cnt+=3;
    }
    this.cell=Math.max(1e-3,2*(tot/Math.max(1,cnt)));
    this.grid={};this.tri=[];
    tris.forEach((t,ti)=>{
      const A=verts[t[0]],B=verts[t[1]],C=verts[t[2]];
      const den=(B[2]-C[2])*(A[0]-C[0])+(C[0]-B[0])*(A[2]-C[2]);
      const inv=Math.abs(den)<1e-12?0:1/den;
      this.tri.push([A[0],A[2],B[0],B[2],C[0],C[2],A[1],B[1],C[1],inv]);
      if(inv===0)return;
      const x0=Math.min(A[0],B[0],C[0]),x1=Math.max(A[0],B[0],C[0]);
      const z0=Math.min(A[2],B[2],C[2]),z1=Math.max(A[2],B[2],C[2]);
      for(let ix=Math.floor((x0-this.minx)/this.cell);ix<=Math.floor((x1-this.minx)/this.cell);ix++)
        for(let iz=Math.floor((z0-this.minz)/this.cell);iz<=Math.floor((z1-this.minz)/this.cell);iz++){
          const k=ix+','+iz;(this.grid[k]=this.grid[k]||[]).push(ti);
        }
    });
  }
  call(x,z){
    const key=Math.floor((x-this.minx)/this.cell)+','+Math.floor((z-this.minz)/this.cell);
    let best=null;
    for(const ti of (this.grid[key]||[])){
      const t=this.tri[ti];if(t[9]===0)continue;
      const l1=((t[3]-t[5])*(x-t[4])+(t[2]-t[4])*(z-t[5]))*t[9];
      const l2=((t[5]-t[1])*(x-t[4])+(t[0]-t[4])*(z-t[5]))*t[9];
      const l3=1-l1-l2;
      if(l1>=-1e-9&&l2>=-1e-9&&l3>=-1e-9){
        const y=l1*t[6]+l2*t[7]+l3*t[8];
        if(best===null||y>best)best=y;
      }
    }
    return best;
  }
}
class Engine{
  constructor(verts,tris,sampler,P){
    this.V=verts;this.T=tris;this.sampler=sampler;
    this._rcHit=0;this._rcMiss=0;this._triHit=0;
    this._cache=new Map();
    this.S=(x,z)=>{
      const key=Math.round(x*100)+'_'+Math.round(z*100);
      let v=this._cache.get(key);
      if(v===undefined){
        v=terrainY(x,z);
        this._cache.set(key,v);
      }
      if(v===null){this._rcMiss++;return null;}
      this._rcHit++;
      return v;
    };
    this.P=P;this.nV=verts.length;
    this.step=P.march_step;
    let pos=0,neg=0;this.edgeFaces={};
    tris.forEach((t,f)=>{
      const A=verts[t[0]],B=verts[t[1]],C=verts[t[2]];
      const cy=(B[2]-A[2])*(C[0]-A[0])-(B[0]-A[0])*(C[2]-A[2]);
      if(cy>0)pos++;else if(cy<0)neg++;
      for(const e of [[t[0],t[1]],[t[1],t[2]],[t[2],t[0]]]){
        const key=e[0]<e[1]?e[0]+','+e[1]:e[1]+','+e[0];
        (this.edgeFaces[key]=this.edgeFaces[key]||[]).push(f);
      }
    });
    this.up=pos>=neg?1:-1;
    let area=0;
    tris.forEach(t=>{
      const A=verts[t[0]],B=verts[t[1]],C=verts[t[2]];
      area+=Math.abs((B[2]-A[2])*(C[0]-A[0])-(B[0]-A[0])*(C[2]-A[2]))*0.5;
    });
    this.area0=area;
  }
  prepare(centre,left,right){
    const P=this.P,n=centre.length;
    const fix=(line,name)=>{
      const fwd=hyp(p2(centre[0]),p2(line[0]))+hyp(p2(centre[n-1]),p2(line[n-1]));
      const rev=hyp(p2(centre[0]),p2(line[n-1]))+hyp(p2(centre[n-1]),p2(line[0]));
      if(rev<fwd){line=line.slice().reverse();dbg(name+' развернута.');}
      return line;
    };
    left=fix(left,'Left');right=fix(right,'Right');
    this.n=n;this.m=P.core_cols;
    this.A=left.map(p2);this.B=right.map(p2);this.C=centre.map(p2);
    const tb=new THREE.Box3().setFromObject(state.terrain);
    const tmin=tb.min,tmax=tb.max;
    dbg('--- ДИАГНОСТИКА ---');
    dbg('Terrain bbox: X['+tmin.x.toFixed(1)+'..'+tmax.x.toFixed(1)+'] Y['+tmin.y.toFixed(1)+'..'+tmax.y.toFixed(1)+'] Z['+tmin.z.toFixed(1)+'..'+tmax.z.toFixed(1)+']');
    let cminx=1e9,cmaxx=-1e9,cminz=1e9,cmaxz=-1e9,cminy=1e9,cmaxy=-1e9;
    centre.forEach(p=>{cminx=Math.min(cminx,p[0]);cmaxx=Math.max(cmaxx,p[0]);cminz=Math.min(cminz,p[2]);cmaxz=Math.max(cmaxz,p[2]);cminy=Math.min(cminy,p[1]);cmaxy=Math.max(cmaxy,p[1]);});
    dbg('Centre bbox: X['+cminx.toFixed(1)+'..'+cmaxx.toFixed(1)+'] Y(Z кривой)['+cminy.toFixed(1)+'..'+cmaxy.toFixed(1)+'] Z['+cminz.toFixed(1)+'..'+cmaxz.toFixed(1)+']');
    const gc=[];
    let missCount=0;
    for(let i=0;i<n;i++){
      const v=this.S(this.C[i][0],this.C[i][1]);
      if(v===null){gc.push(null);missCount++;}
      else gc.push(v);
    }
    dbg('Центральные станции: raycast='+this._rcHit+', не найдено='+missCount+' (единый метод сэмплинга — raycast).');
    let diffSum=0,diffCnt=0;
    for(let i=0;i<n;i++){
      if(gc[i]!==null){
        const dz=gc[i]-centre[i][1];
        diffSum+=dz;diffCnt++;
      }
    }
    if(diffCnt)dbg('Средняя разница (terrainY - Z кривой): '+(diffSum/diffCnt).toFixed(2)+' м по '+diffCnt+' станциям.');
    const valid=gc.map((v,i)=>v!==null?i:-1).filter(i=>i>=0);
    if(valid.length){
      for(let i=0;i<n;i++){
        if(gc[i]!==null)continue;
        let prev=-1,next=-1;
        for(const vi of valid){if(vi<i)prev=vi;if(vi>i){next=vi;break;}}
        if(prev<0&&next>=0)gc[i]=gc[next];
        else if(next<0&&prev>=0)gc[i]=gc[prev];
        else if(prev>=0&&next>=0){
          const t=(i-prev)/(next-prev);
          gc[i]=gc[prev]+(gc[next]-gc[prev])*t;
        }
      }
    }
    for(let i=0;i<n;i++)if(gc[i]===null)gc[i]=centre[i][1];
    let gmin=1e9,gmax=-1e9;
    gc.forEach(v=>{gmin=Math.min(gmin,v);gmax=Math.max(gmax,v);});
    dbg('Высоты рельефа по оси: min='+gmin.toFixed(1)+', max='+gmax.toFixed(1)+' м.');
    let prof=gc.slice();
    for(let k=0;k<P.profile_passes;k++){
      const old=prof.slice();
      for(let i=1;i<n-1;i++){
        const a=Math.max(0,i-2),b=Math.min(n,i+3);
        let s=0;for(let j=a;j<b;j++)s+=old[j];
        prof[i]=s/(b-a);
      }
    }
    dbg('Профиль оси: из высот рельефа по оси (как в Maya; сглажено '+P.profile_passes+' проходов).');
    this.groundC=gc;this.prof=prof;
    this.G=[];this.TG=[];this.u=[];
    for(let i=0;i<n;i++){
      const e=unit([this.B[i][0]-this.A[i][0],this.B[i][1]-this.A[i][1]]);
      const row=[],trow=[],urow=[];
      for(let j=0;j<this.m;j++){
        const t=j/(this.m-1);
        const q=[this.A[i][0]+(this.B[i][0]-this.A[i][0])*t,this.A[i][1]+(this.B[i][1]-this.A[i][1])*t];
        let z=this.S(q[0],q[1]);if(z===null)z=prof[i];
        row.push(q);trow.push(z);
        urow.push((q[0]-this.C[i][0])*e[0]+(q[1]-this.C[i][1])*e[1]);
      }
      this.G.push(row);this.TG.push(trow);this.u.push(urow);
    }
    this.cellArea=[];
    for(let i=0;i<n-1;i++){
      const row=[];
      for(let j=0;j<this.m-1;j++)row.push(Math.abs(signedArea([this.G[i][j],this.G[i][j+1],this.G[i+1][j+1],this.G[i+1][j]])));
      this.cellArea.push(row);
    }
    let steep=[];
    for(let i=1;i<n;i++){
      const h=hyp(this.C[i],this.C[i-1]);
      if(h>0.1){
        const s=Math.atan2(prof[i]-prof[i-1],h)*180/Math.PI;
        if(Math.abs(s)>25)steep.push(i+':'+s.toFixed(0)+'°');
      }
    }
    dbg('Станции с уклоном профиля >25°: '+(steep.length?steep.slice(0,15).join(', ')+(steep.length>15?' …':''):'нет'));
    dbg('--- КОНЕЦ ДИАГНОСТИКИ ---');
  }
  makeRays(limitPoly){
    const P=this.P,n=this.n,m=this.m;
    const loop=[];
    for(let i=0;i<n;i++)loop.push([i,0]);
    for(let j=1;j<m;j++)loop.push([n-1,j]);
    for(let i=n-2;i>=0;i--)loop.push([i,m-1]);
    for(let j=m-2;j>0;j--)loop.push([0,j]);
    this.loop=loop;
    const q=loop.map(ij=>this.G[ij[0]][ij[1]]);
    const area=signedArea(q),sgn=area>0?1:-1;
    const outn=e=>[sgn*e[1],-sgn*e[0]];
    const theta=[],ds=[],rays=[];
    for(let k=0;k<q.length;k++){
      const qp=q[(k-1+q.length)%q.length],qc=q[k],qn=q[(k+1)%q.length];
      const ep=unit([qc[0]-qp[0],qc[1]-qp[1]]),en=unit([qn[0]-qc[0],qn[1]-qc[1]]);
      const cr=ep[0]*en[1]-ep[1]*en[0],dt=ep[0]*en[0]+ep[1]*en[1];
      theta.push(sgn*Math.atan2(cr,dt));
      ds.push(0.5*(hyp(qp,qc)+hyp(qc,qn)));
      const np_=outn(ep),nn=outn(en);
      const ang=Math.abs(Math.atan2(np_[0]*nn[1]-np_[1]*nn[0],np_[0]*nn[0]+np_[1]*nn[1]))*180/Math.PI;
      if(ang>P.corner_deg){
        const F=Math.max(1,Math.ceil(ang/P.fan_deg));
        const a0=Math.atan2(np_[1],np_[0]);
        const dl=Math.atan2(np_[0]*nn[1]-np_[1]*nn[0],np_[0]*nn[0]+np_[1]*nn[1]);
        for(let f=0;f<=F;f++){
          const aa=a0+dl*f/F;
          rays.push({k,p:qc,n:[Math.cos(aa),Math.sin(aa)],corner:true});
        }
      } else rays.push({k,p:qc,n:unit([np_[0]+nn[0],np_[1]+nn[1]]),corner:false});
    }
    this.rays=rays;
    const w=3,clamp=new Array(q.length).fill(1e9);
    for(let k=0;k<q.length;k++){
      let st=0,sd=0;
      for(let o=-w;o<=w;o++){st+=theta[(k+o+q.length)%q.length];sd+=ds[(k+o+q.length)%q.length];}
      const kap=st/Math.max(sd,1e-9);
      if(kap<-1e-6)clamp[k]=P.curv_factor/Math.abs(kap);
    }
    const kmax=Math.floor(P.max_skirt/this.step);
    for(const ray of rays){
      const px=ray.p[0],pz=ray.p[1],nx=ray.n[0],nz=ray.n[1];
      let T=[];
      for(let kk=0;kk<=kmax;kk++){
        const s=kk*this.step,x=px+nx*s,z=pz+nz*s;
        if(limitPoly&&!pointInPoly(x,z,limitPoly))break;
        const h=this.S(x,z);
        if(h===null)break;
        T.push(h);
      }
      if(!T.length)T=[this.TG[loop[ray.k][0]][loop[ray.k][1]]];
      ray.T=T;
      let dcl=(T.length-1)*this.step;
      if(clamp[ray.k]<dcl)dcl=clamp[ray.k];
      ray.dclamp=dcl;
    }
  }
  design(off,cross){
    const n=this.n,m=this.m;
    const zc=this.prof.map(v=>v+off);
    const Z=[];
    for(let i=0;i<n;i++){
      const row=[];
      for(let j=0;j<m;j++)row.push(zc[i]-cross*this.u[i][j]);
      Z.push(row);
    }
    const mc=this.P.max_cut_depth;
    if(mc>0){
      for(let i=0;i<n;i++){
        const floorI=Math.min(...this.TG[i])-mc;
        if(zc[i]<floorI)zc[i]=floorI;
        for(let j=0;j<m;j++){
          const floor=this.TG[i][j]-mc;
          if(Z[i][j]<floor)Z[i][j]=floor;
        }
      }
    }
    const zl=this.loop.map(ij=>Z[ij[0]][ij[1]]);
    return {zc,Z,zl};
  }
  static tget(T,step,s){
    if(s<=0)return T[0];
    const f=s/step,k=Math.floor(f);
    if(k>=T.length-1)return T[T.length-1];
    return T[k]+(T[k+1]-T[k])*(f-k);
  }
  solveRays(zl,fillN,cutN){
    const P=this.P,step=this.step,R=this.rays.length;
    const d=new Array(R).fill(0),mode=new Array(R).fill(1),forced=new Array(R).fill(0);
    this.rays.forEach((ray,r)=>{
      const T=ray.T,K=T.length,ze=zl[ray.k];
      const diff0=ze-T[0];
      let slope,mm;
      if(diff0>=0){slope=-1/fillN;mm=1;}else{slope=1/cutN;mm=-1;}
      let prev=diff0,found=null;
      for(let k=1;k<K;k++){
        const dk=ze+slope*k*step-T[k];
        if((mm===1&&dk<=0)||(mm===-1&&dk>=0)){
          const t=prev!==dk?prev/(prev-dk):1;
          found=(k-1+t)*step;break;
        }
        prev=dk;
      }
      let dd;
      if(found===null){dd=ray.dclamp;forced[r]=1;}
      else if(found>ray.dclamp){dd=ray.dclamp;forced[r]=1;}
      else dd=found;
      d[r]=dd;mode[r]=mm;
    });
    for(let p=0;p<P.smooth_passes;p++){
      const old=d.slice();
      for(let r=0;r<R;r++)d[r]=(old[(r-1+R)%R]+2*old[r]+old[(r+1)%R])*0.25;
    }
    const dmin=P.min_skirt,zout=new Array(R).fill(0);
    this.rays.forEach((ray,r)=>{
      if(d[r]>ray.dclamp)d[r]=ray.dclamp;
      if(d[r]<dmin){d[r]=dmin;if(forced[r]===0)forced[r]=2;}
      zout[r]=Engine.tget(ray.T,step,d[r]);
    });
    return {d,zout,mode,forced};
  }
  volumes(Z,zl,d,zout){
    const n=this.n,m=this.m;let cut=0,fill=0,coreCut=0,coreFill=0;
    for(let i=0;i<n-1;i++)for(let j=0;j<m-1;j++){
      const df=0.25*((Z[i][j]-this.TG[i][j])+(Z[i+1][j]-this.TG[i+1][j])+(Z[i][j+1]-this.TG[i][j+1])+(Z[i+1][j+1]-this.TG[i+1][j+1]));
      const v=df*this.cellArea[i][j];
      if(v>=0){fill+=v;coreFill+=v;}else{cut-=v;coreCut+=v;}
    }
    const step=this.step;
    this.rays.forEach((ray,r)=>{
      const T=ray.T,K=T.length,D=d[r],ze=zl[ray.k],zo=zout[r];
      let k=0;
      while(k*step<D){
        const sa=k*step,sb=Math.min((k+1)*step,D);
        const za=ze+(zo-ze)*sa/D,zb=ze+(zo-ze)*sb/D;
        const ta=T[Math.min(k,K-1)],tb=Engine.tget(T,step,sb);
        const v=0.5*((za-ta)+(zb-tb))*step*(sb-sa);
        if(v>=0)fill+=v;else cut-=v;
        k++;
      }
    });
    return {cut,fill,coreCut,coreFill};
  }
  evaluate(off,cross,fillN,cutN){
    const P=this.P;
    const {zc,Z,zl}=this.design(off,cross);
    const {d,zout,mode,forced}=this.solveRays(zl,fillN,cutN);
    const {cut,fill,coreCut,coreFill}=this.volumes(Z,zl,d,zout);
    const usable=cut*P.usable,bal=usable-fill;
    const nforced=forced.reduce((s,f)=>s+(f===1?1:0),0);
    let score=Math.abs(bal)+P.earthwork_w*(cut+fill)+200*nforced;
    if(P.max_fill>0&&fill>P.max_fill)score+=1000*(fill-P.max_fill)/P.max_fill;
    return {off,cross,fillN,cutN,cut,fill,usable,bal,nforced,score,coreCut,coreFill};
  }
  optimize(progress){
    const P=this.P,fill0=P.fill_n,cut0=P.cut_n;
    if(!P.optimize)return this.evaluate(P.offset,P.crossfall/100,fill0,cut0);
    const Roff=P.off_range,cmax=P.cross_max/100;
    const offs=Array.from({length:13},(_,i)=>-Roff+2*Roff*i/12);
    const crs=cmax>0?Array.from({length:9},(_,i)=>-cmax+2*cmax*i/8):[0];
    let best=null,tot=offs.length*crs.length,k=0;
    for(const o of offs)for(const c of crs){
      const r=this.evaluate(o,c,fill0,cut0);
      if(!best||r.score<best.score)best=r;
      k++;
      if(progress&&k%10===0)progress(60*k/tot,'Coarse '+k+'/'+tot);
    }
    let so=2*Roff/12*0.5,sc=cmax>0?2*cmax/8*0.5:0,it=0;
    while(it<60){
      it++;let improved=false;const cands=[];
      for(const sgn of [-1,1]){
        cands.push([best.off+sgn*so,best.cross,fill0,cut0]);
        if(cmax>0)cands.push([best.off,best.cross+sgn*sc,fill0,cut0]);
      }
      for(const [o,c,f,cu] of cands){
        o=Math.max(-Roff*1.5,Math.min(Roff*1.5,o));
        c=Math.max(-cmax,Math.min(cmax,c));
        const r=this.evaluate(o,c,f,cu);
        if(r.score<best.score-1e-6){best=r;improved=true;}
      }
      if(!improved){so*=0.5;sc*=0.5;if(so<0.005&&sc<0.00005)break;}
      if(progress)progress(60+35*it/60,'Refining '+it);
    }
    return best;
  }
  labelRows(best){
    const n=this.n,m=this.m;
    const {Z}=this.design(best.off,best.cross);
    const mid=Math.floor(m/2);
    const step=Math.max(1,Math.round(20/Math.max(0.5,this.P.spacing)));
    const idxs=[];for(let i=0;i<n;i+=step)idxs.push(i);
    if(idxs[idxs.length-1]!==n-1)idxs.push(n-1);
    const rows=[];let prev=null;
    for(const i of idxs){
      const cp=[this.C[i][0],Z[i][mid],this.C[i][1]];
      const lp=[this.A[i][0],Z[i][0],this.A[i][1]];
      const rp=[this.B[i][0],Z[i][m-1],this.B[i][1]];
      let slope=null;
      if(prev){
        const h=hyp([cp[0],cp[2]],[prev[0],prev[2]]);
        slope=h<=0.1?0:Math.atan2(cp[1]-prev[1],h)*180/Math.PI;
      }
      rows.push({station:i,centerPoint:cp,leftPoint:lp,rightPoint:rp,slope,centerHeight:cp[1],leftHeight:lp[1],rightHeight:rp[1]});
      prev=cp;
    }
    return rows;
  }
}
// ================== КОНЕЦ ДВИЖКА ==================

function rebuild(){
  if(!state.terrain||!state.curves) return;
  clearMeasure();
  state.designGroup=clearGroup(state.designGroup);
  state.labelsGroup=clearGroup(state.labelsGroup);
  state.terrainLabelsGroup=clearGroup(state.terrainLabelsGroup);
  const g=new THREE.Group();state.designGroup=g;scene.add(g);
  const lg=new THREE.Group();state.labelsGroup=lg;scene.add(lg);
  const tg=new THREE.Group();state.terrainLabelsGroup=tg;scene.add(tg);
  applyDesignLook();applyTerrainLook();

  const verts=[],tris=[];
  state.terrain.updateMatrixWorld(true);
  state.terrain.traverse(o=>{
    if(o.isMesh&&o.geometry){
      const geo=o.geometry,pos=geo.attributes.position,vBase=verts.length,v=new THREE.Vector3();
      for(let i=0;i<pos.count;i++){
        v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);
        verts.push([v.x,v.y,v.z]);
      }
      const index=geo.index;
      if(index){
        for(let i=0;i<index.count;i+=3)tris.push([vBase+index.getX(i),vBase+index.getX(i+1),vBase+index.getX(i+2)]);
      } else {
        for(let i=0;i<pos.count;i+=3)tris.push([vBase+i,vBase+i+1,vBase+i+2]);
      }
    }
  });
  dbg('Terrain: '+verts.length+' вершин, '+tris.length+' треугольников.');
  const sampler=new TriSampler(verts,tris);
  const cv=state.curves;
  const P={
    spacing:5,core_cols:9,skirt_rings:6,march_step:1.0,min_skirt:2.0,max_skirt:60.0,
    smooth_passes:3,profile_passes:state.prof*2,corner_deg:25,fan_deg:20,curv_factor:0.85,
    slope_angle:state.ang,max_cut_depth:state.cut,usable:state.usable/100,
    earthwork_w:state.earthwork_w,max_fill:state.max_fill,
    off_range:state.off_range,cross_max:state.cross_max,
    offset:state.off,crossfall:state.cross,
    optimize:state.optimize===true,opt_slopes:false,
    fill_n:1/Math.tan(THREE.MathUtils.degToRad(state.ang)),
    cut_n:1/Math.tan(THREE.MathUtils.degToRad(state.ang))
  };
  const eng=new Engine(verts,tris,sampler,P);
  let C=cv.centre.map(p=>[p[0],p[1],p[2]]);
  let L=alignDir(C,cv.left.map(p=>[p[0],p[1],p[2]]));
  let R=alignDir(C,cv.right.map(p=>[p[0],p[1],p[2]]));
  // Maya-style: 3D длина + ресемплинг; точные Maya-станции имеют приоритет
  const spacing=P.spacing;
  const dist3=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  function polyLen3(pts){let s=0;for(let i=1;i<pts.length;i++)s+=dist3(pts[i],pts[i-1]);return s;}
  function densifyCatmullRom(pts,per=20){
    if(pts.length<3)return pts.slice();
    const out=[];const get=i=>pts[Math.max(0,Math.min(pts.length-1,i))];
    for(let i=0;i<pts.length-1;i++){
      const p0=get(i-1),p1=get(i),p2p=get(i+1),p3=get(i+2);
      for(let k=0;k<per;k++){
        const t=k/per,t2=t*t,t3=t2*t;
        out.push([
          0.5*((2*p1[0])+(-p0[0]+p2p[0])*t+(2*p0[0]-5*p1[0]+4*p2p[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2p[0]+p3[0])*t3),
          0.5*((2*p1[1])+(-p0[1]+p2p[1])*t+(2*p0[1]-5*p1[1]+4*p2p[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2p[1]+p3[1])*t3),
          0.5*((2*p1[2])+(-p0[2]+p2p[2])*t+(2*p0[2]-5*p1[2]+4*p2p[2]-p3[2])*t2+(-p0[2]+3*p1[2]-3*p2p[2]+p3[2])*t3)
        ]);
      }
    }
    out.push(pts[pts.length-1].slice());
    return out;
  }
  function resampleByLength3(pts,count){
    if(pts.length<2||count<2)return pts.slice();
    const segs=[];let total=0;
    for(let i=1;i<pts.length;i++){const d=dist3(pts[i],pts[i-1]);segs.push(d);total+=d;}
    const out=[];
    for(let k=0;k<count;k++){
      const target=total*k/(count-1);
      let acc=0,i=0;
      while(i<segs.length-1&&acc+segs[i]<target){acc+=segs[i];i++;}
      const t=segs[i]>0?(target-acc)/segs[i]:0;
      const a=pts[i],b=pts[i+1];
      out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]);
    }
    return out;
  }
  if(cv.centre_stations&&cv.left_stations&&cv.right_stations&&cv.centre_stations.length===cv.left_stations.length&&cv.centre_stations.length===cv.right_stations.length){
    C=cv.centre_stations.map(p=>[p[0],p[1],p[2]]);
    L=cv.left_stations.map(p=>[p[0],p[1],p[2]]);
    R=cv.right_stations.map(p=>[p[0],p[1],p[2]]);
    dbg('Коридор: '+C.length+' станций — использованы ТОЧНЫЕ станции, экспортированные из Maya.');
  } else {
    const Cd=densifyCatmullRom(C,20),Ld=densifyCatmullRom(L,20),Rd=densifyCatmullRom(R,20);
    const centreLen3=polyLen3(Cd),centreLen2=(()=>{let s=0;for(let i=1;i<Cd.length;i++)s+=hyp(p2(Cd[i]),p2(Cd[i-1]));return s;})();
    const ns=Math.max(3,Math.ceil(centreLen3/Math.max(0.5,spacing))+1);
    C=resampleByLength3(Cd,ns);L=resampleByLength3(Ld,ns);R=resampleByLength3(Rd,ns);
    dbg('Коридор: '+C.length+' станций (3D длина '+centreLen3.toFixed(1)+' м; 2D проекция '+centreLen2.toFixed(1)+' м; spacing '+spacing+' м).');
  }
  const widths=C.map((c,i)=>hyp(p2(L[i]),p2(R[i])));
  dbg('Ширина коридора: min '+Math.min(...widths).toFixed(1)+' / mean '+(widths.reduce((a,b)=>a+b,0)/widths.length).toFixed(1)+' / max '+Math.max(...widths).toFixed(1)+' м.');
  eng.prepare(C,L,R);
  const limitPoly=(cv.limit&&cv.limit.length)?cv.limit.map(p=>[p[0],p[2]]):null;
  eng.makeRays(limitPoly);
  dbg('Лучей: '+eng.rays.length);
  const best=state.optimize===true?eng.optimize():eng.evaluate(state.off,state.cross/100,P.fill_n,P.cut_n);
  const {Z,zl}=eng.design(state.off,state.cross/100);
  const {d,zout}=eng.solveRays(zl,P.fill_n,P.cut_n);
  const n=eng.n,m=eng.m,S=P.skirt_rings;

  const pos=[],cols=[],idx=[];
  const zoneOf=dz=>dz>0.02?[0.35,0.55,0.85]:(dz<-0.02?[0.82,0.48,0.36]:[0.76,0.74,0.70]);
  function addTri(a,b,c,col){
    const ar=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
    if(Math.abs(ar)<1e-9)return;
    if(ar*eng.up<0){const t=b;b=c;c=t;}
    const base=pos.length/3;
    for(const p of [a,b,c]){pos.push(p[0],p[1],p[2]);cols.push(...col);}
    idx.push(base,base+1,base+2);
  }
  function addQuad(a,b,c,dd,col){addTri(a,b,c,col);addTri(a,c,dd,col);}
  const IDc=[];
  for(let i=0;i<n;i++){
    const row=[];
    for(let j=0;j<m;j++)row.push([eng.G[i][j][0],Z[i][j],eng.G[i][j][1]]);
    IDc.push(row);
  }
  for(let i=0;i<n-1;i++)for(let j=0;j<m-1;j++){
    const a=IDc[i][j],b=IDc[i][j+1],c=IDc[i+1][j+1],e=IDc[i+1][j];
    const dz=0.25*((a[1]-eng.TG[i][j])+(b[1]-eng.TG[i][j+1])+(c[1]-eng.TG[i+1][j+1])+(e[1]-eng.TG[i+1][j]));
    addQuad(a,b,c,e,zoneOf(dz));
  }
  const rid=[],zex=[];
  eng.rays.forEach((ray,r)=>{
    const i=eng.loop[ray.k][0],j=eng.loop[ray.k][1];
    const ze=zl[ray.k],px=ray.p[0],pz=ray.p[1],nx=ray.n[0],nz=ray.n[1];
    const ox=px+nx*d[r],oz=pz+nz*d[r];
    let zo=eng.S(ox,oz);if(zo===null)zo=zout[r];
    zex.push(zo);
    const col=[IDc[i][j]];
    for(let k=1;k<=S;k++){
      const s=d[r]*k/S,zz=ze+(zo-ze)*k/S;
      col.push([px+nx*s,zz,pz+nz*s]);
    }
    rid.push(col);
  });
  for(let r=0;r<eng.rays.length;r++){
    const r2=(r+1)%eng.rays.length;
    for(let k=0;k<S;k++){
      const a=rid[r][k],b=rid[r2][k],c=rid[r2][k+1],e=rid[r][k+1];
      const za0=eng.S(a[0],a[2]),zb0=eng.S(b[0],b[2]),zc0=eng.S(c[0],c[2]),ze0=eng.S(e[0],e[2]);
      const za=(za0===null?a[1]:za0),zb=(zb0===null?b[1]:zb0);
      const zc2=(zc0===null?c[1]:zc0),ze2=(ze0===null?e[1]:ze0);
      const dz=0.25*((a[1]-za)+(b[1]-zb)+(c[1]-zc2)+(e[1]-ze2));
      addQuad(a,b,c,e,zoneOf(dz));
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));
  geo.setIndex(idx);geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:0.95,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  mesh.castShadow=true;mesh.receiveShadow=true;
  g.add(mesh);

  if(state.gridVisible){
    const rows=eng.labelRows(best);
    const linePos=[];
    for(const r of rows){
      const i=r.station;
      if(i===undefined||i<0||i>=n-1)continue;
      for(let j=0;j<m-1;j++){
        const a=IDc[i][j],b=IDc[i][j+1];
        linePos.push(a[0],a[1]+0.2,a[2],b[0],b[1]+0.2,b[2]);
      }
    }
    const lgeo=new THREE.BufferGeometry();
    lgeo.setAttribute('position',new THREE.Float32BufferAttribute(linePos,3));
    const lines=new THREE.LineSegments(lgeo,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.85}));
    lines.renderOrder=1;g.add(lines);
  }

  const rows=eng.labelRows(best);
  const labelDiv=document.getElementById('labels');
  labelDiv.innerHTML=rows.map(r=>{
    const s=r.slope===null?'—':r.slope.toFixed(1);
    return '<div>Ст. '+r.station+': уклон <b>'+s+'°</b> | H: '+r.centerHeight.toFixed(1)+' / '+r.leftHeight.toFixed(1)+' / '+r.rightHeight.toFixed(1)+' м</div>';
  }).join('')||'-';
  const ELEV_OFF=21.21;
  const makeSprite=(text, p, color, small)=>{
    const cnv=document.createElement('canvas'); cnv.width=384; cnv.height=96;
    const ctx=cnv.getContext('2d');
    ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.fillRect(0,0,384,96);
    ctx.fillStyle=color; ctx.font=(small?'33px':'bold 45px')+' sans-serif'; ctx.textAlign='center';
    ctx.fillText(text,192,small?60:66);
    const tex=new THREE.CanvasTexture(cnv);
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex, depthTest:false, transparent:true, opacity:state.labelOpacity}));
    sp.scale.set(small?10.5:15, small?2.6:3.75, 1);
    sp.position.copy(p);
    sp.renderOrder=10;
    return sp;
  };
  const slopeColor=s=>s<0?'#ff9a3c':(s<10?'#5cff7a':(s<15?'#6aa8ff':(s<25?'#ff5c5c':'#ffffff')));
  rows.forEach(r=>{
    const i=r.station;
    if(i===undefined||i<0)return;
    const cp=new THREE.Vector3(r.centerPoint[0],r.centerPoint[1],r.centerPoint[2]);
    const pl=new THREE.Vector3(r.leftPoint[0],r.leftPoint[1],r.leftPoint[2]);
    const pr=new THREE.Vector3(r.rightPoint[0],r.rightPoint[1],r.rightPoint[2]);
    const slope=(r.slope===null||r.slope===undefined)?0:r.slope;
    const across=new THREE.Vector3().subVectors(pr,pl).setY(0).normalize();
    const inward=across.clone();
    const smpL=pl.clone().addScaledVector(inward,1.5);
    const smpR=pr.clone().addScaledVector(inward,-1.5);
    const tgl=terrainY(smpL.x,smpL.z),tgr=terrainY(smpR.x,smpR.z);
    lg.add(makeSprite((r.slope===null?'—':slope.toFixed(1))+'°',new THREE.Vector3(cp.x,cp.y+10,cp.z),slopeColor(slope)));
    lg.add(makeSprite((r.centerHeight+ELEV_OFF).toFixed(1),new THREE.Vector3(cp.x,cp.y+5,cp.z),'#ffffff'));
    lg.add(makeSprite((r.leftHeight+ELEV_OFF).toFixed(1),new THREE.Vector3(pl.x,pl.y+5,pl.z),'#7fd4ff'));
    lg.add(makeSprite((r.rightHeight+ELEV_OFF).toFixed(1),new THREE.Vector3(pr.x,pr.y+5,pr.z),'#ffb0a0'));
    tg.add(makeSprite('орг.: '+(eng.groundC[i]+ELEV_OFF).toFixed(1),new THREE.Vector3(cp.x,cp.y-2.8,cp.z),'#cfe3cf',true));
    tg.add(makeSprite('орг.: '+(tgl!==null?(tgl+ELEV_OFF).toFixed(1):'-'),new THREE.Vector3(pl.x,pl.y-2.8,pl.z),'#cfe3cf',true));
    tg.add(makeSprite('орг.: '+(tgr!==null?(tgr+ELEV_OFF).toFixed(1):'-'),new THREE.Vector3(pr.x,pr.y-2.8,pr.z),'#cfe3cf',true));
    if(state.terrainSlopesVisible&&r.slope!==null){
      lg.add(makeSprite('орг. уклон: '+slope.toFixed(1)+'°',new THREE.Vector3(cp.x,eng.groundC[i]+6.5,cp.z),'#7fd4ff',true));
    }
  });
  applyLabelOpacity();

  dbg('3D-подписей создано: проект '+lg.children.length+', рельеф '+tg.children.length+'.');

  const f=v=>Math.round(v).toLocaleString('ru-RU');
  document.getElementById('stats').innerHTML=
    'Угол откоса: <b>'+state.ang+'°</b> (1:'+best.fillN.toFixed(2)+')<br>'+
    'Срезано: <b>'+f(best.cut)+'</b> м³ (core '+f(best.coreCut)+')<br>'+
    'Пригодно к использованию: <b>'+f(best.usable)+'</b> м³ (90%)<br>'+
    'Насыпано: <b>'+f(best.fill)+'</b> м³ (core '+f(best.coreFill)+')<br>'+
    'Требуется привезти: <b>'+f(Math.max(0,best.fill-best.usable))+'</b> м³<br>'+
    'Останется вывезти: <b>'+f(Math.max(0,best.usable-best.fill))+'</b> м³<br>'+
    'Баланс: <b>'+(best.bal>=0?'+':'')+f(best.bal)+'</b> м³';
}

async function loadSlopeList(){
  let names=['A1'];
  try{
    const m=await loadJSON('./assets/slopes.json'+bust());
    if(Array.isArray(m)&&m.length)names=m.map(String);
  }catch(e){dbg('slopes.json не найден — использую A1');}
  const list=document.getElementById('slopeList');
  list.innerHTML='';
  names.forEach(n=>{
    const b=document.createElement('button');
    b.className='slope-btn'+(n===state.slope?' active':'');
    b.dataset.slope=n;b.textContent=n;
    b.addEventListener('click',()=>{
      document.querySelectorAll('.slope-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');state.slope=n;loadSlope(n);
    });
    list.appendChild(b);
  });
  return state.slope;
}

const loadingEl=document.getElementById('loading');
async function loadOptimizerData(id){
    const cv=await loadJSON('./assets/'+id+'.curves.json'+bust());
    state.curves=cv;
    dbg('Кривые загружены: centre '+(cv.centre||[]).length+', left '+(cv.left||[]).length+', right '+(cv.right||[]).length);
    const mayaEl=document.getElementById('mayaLabels');
    mayaEl.textContent='Загрузка подписей Maya…';
    let mayaLoaded=false;
    try{
      const m=await loadJSON('./assets/'+id+'_labels.json'+bust());
      const rows=(m&&Array.isArray(m.labels))?m.labels:[];
      if(rows.length){
        mayaEl.textContent=rows.map(r=>{
          const s=(r.slope_deg===null||r.slope_deg===undefined)?'—':Number(r.slope_deg).toFixed(1);
          return 'Ст. '+r.station+': уклон '+s+'° | H: '+Number(r.h_center).toFixed(1)+' / '+Number(r.h_left).toFixed(1)+' / '+Number(r.h_right).toFixed(1)+' м';
        }).join('\n');
        mayaLoaded=true;
        dbg('Подписи Maya загружены: '+rows.length+' станций');
      }
    }catch(e){}
    if(!mayaLoaded){mayaEl.textContent='Нет данных — файл '+id+'_labels.json не найден в assets/ (сначала ЗАПУСК в Maya).';}
}

async function loadSlope(id){
  clearTestForest();
  if(state.root){scene.remove(state.root);state.root=null;}
  state.terrain=null;state.curves=null;state.terrainMats=[];
  state.designGroup=clearGroup(state.designGroup);
  state.labelsGroup=clearGroup(state.labelsGroup);
  state.terrainLabelsGroup=clearGroup(state.terrainLabelsGroup);
  dbgEl.textContent='';
  clearMeasure();
  assetToken=Date.now();
  document.getElementById('stats').textContent='Загрузка…';
  loadingEl.style.display='flex';
  try{
    const gltf=await loadGLTF('./assets/'+id+'.gltf'+bust());
    const root=gltf.scene;scene.add(root);state.root=root;
    root.traverse(o=>{
      if((o.name||'').toLowerCase().includes('terrain')){
        state.terrain=o;
        o.traverse(c=>{
          if(c.isMesh){
            setTerrainSnowMaterial(c);
          }
        });
      }
    });
    applyTerrainLook();
    root.updateMatrixWorld(true);
    buildTestForest();
    dbg('Terrain загружен.');
    if(state.optimizeMode){
      await loadOptimizerData(id);
    }else{
      state.curves=null;
      document.getElementById('stats').textContent='Презентационный режим. Откройте «Оптимизация», чтобы загрузить инструменты выравнивания.';
      document.getElementById('mayaLabels').textContent='Инструменты оптимизации не загружены.';
    }
    const box=new THREE.Box3().setFromObject(root);
    const ctr=box.getCenter(new THREE.Vector3()),sz=box.getSize(new THREE.Vector3()).length();
    lightingCenter.copy(ctr); updateDaylight(state.dayTime);
    camera.position.set(ctr.x+sz*.5,ctr.y+sz*.5,ctr.z+sz*.7);
    controls.target.copy(ctr);controls.update();
    state.homePos=camera.position.clone();
    state.homeTarget=controls.target.clone();
    if(state.optimizeMode){
      await new Promise(r=>setTimeout(r,50));
      try{ rebuild(); }
      catch(e){
        dbg('ОШИБКА РАСЧЁТА: '+(e&&e.message?e.message:String(e)));
        console.error(e);
        document.getElementById('stats').textContent='Ошибка расчёта: '+(e&&e.message?e.message:String(e));
      }
    }else{
      document.getElementById('stats').textContent='Рельеф загружен. Режим презентации готов.';
    }
  }catch(err){
    const msg=err&&(err.message||err.description)?(err.message||err.description):String(err);
    document.getElementById('stats').textContent='Ошибка загрузки склона "'+id+'": '+msg;
    dbg('ОШИБКА: '+msg);
    console.error(err);
  }finally{
    loadingEl.style.display='none';
  }
}

const map=[['pAng','ang','vAng',v=>v+'°'],['pProf','prof','vProf',v=>v],['pCut','cut','vCut',v=>v.toFixed(1)],['pOff','off','vOff',v=>v],['pCross','cross','vCross',v=>v],['pUsable','usable','vUsable',v=>v],['pEarth','earthwork_w','vEarth',v=>v],['pMaxFill','max_fill','vMaxFill',v=>v],['pOffR','off_range','vOffR',v=>v],['pCrossMax','cross_max','vCrossMax',v=>v]];
let timer=null;
function scheduleRebuild(delay=150){
  clearTimeout(timer);
  timer=setTimeout(()=>{
    loadingEl.style.display='flex';
    setTimeout(()=>{
      try{rebuild();}catch(e){dbg('ОШИБКА РАСЧЁТА: '+(e&&e.message?e.message:String(e)));console.error(e);}
      loadingEl.style.display='none';
    },30);
  },delay);
}
map.forEach(([id,key,vid,fm])=>{
  const el=document.getElementById(id);
  const vEl=document.getElementById(vid);
  if(!el||!vEl){console.warn('Нет элемента',id,vid);return;}
  el.value=state[key];
  vEl.textContent=fm(state[key]);
  el.addEventListener('input',()=>{
    state[key]=parseFloat(el.value);
    vEl.textContent=fm(state[key]);
  });
});

document.getElementById('apply').addEventListener('click',()=>{
  loadingEl.style.display='flex';
  setTimeout(()=>{
    try{rebuild();}catch(e){dbg('ОШИБКА РАСЧЁТА: '+(e&&e.message?e.message:String(e)));console.error(e);}
    loadingEl.style.display='none';
  },30);
});

document.getElementById('pTerrain').addEventListener('change',e=>{
  state.terrainVisible=e.target.checked;applyTerrainLook();
});
document.getElementById('pTerrOp').addEventListener('input',e=>{
  state.terrainOpacity=parseFloat(e.target.value)/100;
  document.getElementById('vTerrOp').textContent=e.target.value+'%';
  applyTerrainLook();
});
document.getElementById('pDesign').addEventListener('change',e=>{
  state.designVisible=e.target.checked;applyDesignLook();
});
document.getElementById('pGrid').addEventListener('change',e=>{
  state.gridVisible=e.target.checked;scheduleRebuild(50);
});
document.getElementById('pLabels').addEventListener('change',e=>{
  state.labelsVisible=e.target.checked;applyDesignLook();
});
document.getElementById('pTerrainLabels').addEventListener('change',e=>{
  state.terrainLabelsVisible=e.target.checked;applyTerrainLook();
});
document.getElementById('pTerrainSlopes').addEventListener('change',e=>{
  state.terrainSlopesVisible=e.target.checked;scheduleRebuild(50);
});
document.getElementById('pLight').addEventListener('input',e=>{
  sunIntensityScale=parseFloat(e.target.value); updateDaylight(state.dayTime);
});
document.getElementById('pSunRot').addEventListener('input',e=>{
  sunAzimuthOffset=parseFloat(e.target.value); updateDaylight(state.dayTime);
});
const shadowSizes=[1024,2048,4096,8192];
document.getElementById('pShadow').addEventListener('input',e=>{
  const s=shadowSizes[parseInt(e.target.value)];
  if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}
  sun.shadow.mapSize.set(s,s);
});
document.getElementById('pLabelOp').addEventListener('input',e=>{
  state.labelOpacity=parseFloat(e.target.value)/100;
  document.getElementById('vLabelOp').textContent=e.target.value+'%';
  applyLabelOpacity();
});
document.getElementById('pLightOn').addEventListener('change',e=>{
  sunEnabled=e.target.checked; updateDaylight(state.dayTime);
});

document.querySelectorAll('.slope-btn').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.slope-btn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');state.slope=b.dataset.slope;loadSlope(b.dataset.slope);
}));

document.getElementById('save').addEventListener('click',()=>{
  const fillN=1/Math.tan(THREE.MathUtils.degToRad(state.ang));
  const preset={
    version:'web-preset-2',slope:state.slope,slope_angle:state.ang,
    profile_level:state.prof,max_cut_depth:state.cut,offset:state.off,
    crossfall_percent:state.cross,fill_n:parseFloat(fillN.toFixed(4)),
    cut_n:parseFloat(fillN.toFixed(4)),saved_at:new Date().toISOString()
  };
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(preset,null,2)],{type:'application/json'}));
  a.download='ssgo_preset_'+state.slope+'_'+Date.now()+'.json';
  a.click();
});

document.getElementById('reset').addEventListener('click',()=>{
  localStorage.removeItem('ssgo_default_preset');
  const d={pAng:35,pProf:0,pCut:5,pOff:-0.75,pCross:0.264,pUsable:90,pEarth:0.03,pMaxFill:0,pOffR:3,pCrossMax:3};
  for(const k in d){const e=document.getElementById(k);if(e){e.value=d[k];e.dispatchEvent(new Event('input'));}}
});


const appRoot = document.getElementById('app');
const optimizerToggleButton = document.getElementById('optimizerToggle');
const overviewModeButton = document.getElementById('overviewMode');
async function setOptimizerOpen(open) {
  state.optimizeMode = open;
  appRoot.classList.toggle('optimizer-open',open);
  optimizerToggleButton.classList.toggle('active',open);
  optimizerToggleButton.textContent = open ? 'ЗАКРЫТЬ ОПТИМИЗАЦИЮ' : 'ОПТИМИЗАЦИЯ СКЛОНОВ';
  if(!open || !state.terrain || state.curves) return;
  loadingEl.style.display='flex';
  try {
    await loadOptimizerData(state.slope);
    await new Promise(resolve=>setTimeout(resolve,40));
    rebuild();
  } catch(e) {
    dbg('ОШИБКА ЗАГРУЗКИ ИНСТРУМЕНТОВ: '+(e?.message||String(e)));
    document.getElementById('stats').textContent='Ошибка загрузки инструментов: '+(e?.message||String(e));
  } finally {
    loadingEl.style.display='none';
  }
}
optimizerToggleButton.addEventListener('click',()=>setOptimizerOpen(!state.optimizeMode));
const skierModeButton = document.getElementById('skierMode');
const speedValueEl = document.getElementById('speedValue');
const slopeValueEl = document.getElementById('slopeValue');
const groundStateEl = document.getElementById('groundState');
const skierLockHintEl = document.getElementById('skierLockHint');
let overviewSnapshot = null;
let hiddenOverviewObjects = [];

const skierController = new SkierController({
  camera,
  domElement: renderer.domElement,
  onHud: ({speed,slope,grounded}) => {
    speedValueEl.textContent = String(Math.round(speed*3.6));
    slopeValueEl.textContent = Number(slope).toFixed(1);
    groundStateEl.textContent = grounded ? 'GROUND CONTACT' : 'EDGE / NO CONTACT';
    groundStateEl.style.color = grounded ? '#82d6a6' : '#f3cf79';
  },
  onPointerLock: locked => {
    skierLockHintEl.textContent = locked
      ? 'Мышь захвачена · ESC освобождает курсор'
      : 'Кликни по сцене, чтобы снова захватить мышь';
  }
});

function resizeSceneAfterModeChange() {
  scheduleViewportResize();
  requestAnimationFrame(() => scheduleViewportResize());
}

function setSceneMode(mode) {
  if (mode === state.mode) return;
  if (mode === 'skier') {
    if (!state.terrain) { dbg('SKIER: сначала дождитесь загрузки рельефа.'); return; }
    overviewSnapshot = { position: camera.position.clone(), target: controls.target.clone() };
    hiddenOverviewObjects = [state.designGroup,state.labelsGroup,state.terrainLabelsGroup,measureGroup]
      .filter(Boolean).map(g => [g,g.visible]);
    hiddenOverviewObjects.forEach(([g]) => { g.visible = false; });
    const terrainWasVisible = state.terrain.visible;
    state.terrain.visible = true;
    const mats = state.terrainMats.map(m => [m,m.opacity,m.transparent]);
    state.terrainMats.forEach(m => { m.opacity=1; m.transparent=false; });
    if (!skierController.start(state.terrain)) {
      state.terrain.visible = terrainWasVisible;
      mats.forEach(([m,opacity,transparent]) => {m.opacity=opacity;m.transparent=transparent;});
      hiddenOverviewObjects.forEach(([g,visible]) => {g.visible=visible;});
      hiddenOverviewObjects = [];
      dbg('SKIER: не удалось найти стартовую позицию на этом рельефе.');
      return;
    }
    overviewSnapshot.terrainVisible = terrainWasVisible;
    overviewSnapshot.materials = mats;
    state.mode = 'skier';
    controls.enabled = false;
    labelRenderer.domElement.style.display = 'none';
    appRoot.classList.add('skier-mode');
    overviewModeButton.classList.remove('active');
    skierModeButton.classList.add('active');
    resizeSceneAfterModeChange();
    return;
  }

  skierController.stop();
  state.mode = 'overview';
  controls.enabled = true;
  labelRenderer.domElement.style.display = '';
  if (overviewSnapshot) {
    camera.position.copy(overviewSnapshot.position);
    controls.target.copy(overviewSnapshot.target);
    if (state.terrain) state.terrain.visible = overviewSnapshot.terrainVisible;
    (overviewSnapshot.materials||[]).forEach(([m,opacity,transparent]) => {m.opacity=opacity;m.transparent=transparent;});
  }
  hiddenOverviewObjects.forEach(([g,visible]) => {g.visible=visible;});
  hiddenOverviewObjects = [];
  overviewSnapshot = null;
  appRoot.classList.remove('skier-mode');
  overviewModeButton.classList.add('active');
  skierModeButton.classList.remove('active');
  controls.update();
  resizeSceneAfterModeChange();
}
overviewModeButton.addEventListener('click', () => setSceneMode('overview'));
skierModeButton.addEventListener('click', () => setSceneMode('skier'));
document.getElementById('exitSkier').addEventListener('click', () => setSceneMode('overview'));
document.addEventListener('keydown', e => {
  if(state.mode !== 'skier') return;
  if(e.code === 'KeyQ' || (e.key||'').toLowerCase() === 'q') {
    e.preventDefault();
    e.stopPropagation();
    setSceneMode('overview');
  }
}, true);

loadSlopeList().then(first=>loadSlope(first));
let previousFrameTime = performance.now();
(function loop(){
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min((now-previousFrameTime)/1000, 0.04);
  previousFrameTime = now;
  if(state.autoTime){
    state.dayTime += dt*0.16;
    if(state.dayTime > 22) state.dayTime = 5;
    timeSlider.value = String(state.dayTime);
    timeValue.textContent = formatClock(state.dayTime);
    updateDaylight(state.dayTime);
  }
  if(state.mode === 'skier') skierController.update(dt);
  if(state.mode === 'overview' && targetDist!==null){
    const dir=new THREE.Vector3().subVectors(camera.position,controls.target);
    const cur=dir.length();
    const nd=THREE.MathUtils.lerp(cur,targetDist,0.15);
    if(Math.abs(nd-targetDist)<0.5)targetDist=null;
    camera.position.copy(controls.target).addScaledVector(dir.normalize(),nd);
  }
  if(controls.enabled) controls.update();
  skyDome.position.copy(camera.position);
  updateForestBillboards();
  renderer.render(scene,camera);
  if(labelRenderer.domElement.style.display !== 'none') labelRenderer.render(scene,camera);
})();
