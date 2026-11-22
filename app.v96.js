import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SkierController } from './skier-controller.v73.js';
import { DroneController } from './drone-controller.v72.js';

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
  forestGroup:null, billboardMesh:null, billboardMeshes:[], billboardTrees:[],
  importedAssets:[], baseTerrain:null, baseTerrainMats:[], activeTerrainAssetId:null
};
const CLIENT_REPO_OWNER='kortul',CLIENT_REPO_NAME='Grade_Optimizer';
const CLIENT_ID_FROM_URL=new URLSearchParams(window.location.search).get('client')||'';
let currentClientSlug=CLIENT_ID_FROM_URL;
let clientWorkspaceReady=false;
let githubAdminToken='';


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
const dayCyclePanel=document.getElementById('dayCycle');
const timeToggleButton=document.getElementById('timeToggle');
timeToggleButton.addEventListener('click',()=>{
  const expanded=dayCyclePanel.classList.toggle('expanded');
  timeToggleButton.setAttribute('aria-expanded',String(expanded));
  timeToggleButton.title=expanded?'Свернуть управление временем':'Показать управление временем';
});
function setTimeOfDay(value) {
  state.dayTime = THREE.MathUtils.clamp(value, 5, 22);
  timeSlider.value = String(state.dayTime);
  timeValue.textContent = formatClock(state.dayTime);
  const compactTimeValue=document.getElementById('timeCompactValue');if(compactTimeValue)compactTimeValue.textContent=formatClock(state.dayTime);
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
const fbxLoader = new FBXLoader(assetManager);
function prepareFbxMaterials(root){
  const converted = new Map();
  const convert = source => {
    if(!source || source.isMeshStandardMaterial) return source;
    if(converted.has(source)) return converted.get(source);
    const shininess = Number(source.shininess);
    const roughness = Number.isFinite(shininess) && shininess > 0
      ? THREE.MathUtils.clamp(Math.sqrt(2 / (shininess + 2)), 0.08, 1)
      : 0.85;
    const material = new THREE.MeshStandardMaterial({
      color:source.color?.clone?.()||new THREE.Color(0xffffff),
      map:source.map||null, normalMap:source.normalMap||null, bumpMap:source.bumpMap||null,
      alphaMap:source.alphaMap||null, displacementMap:source.displacementMap||null,
      emissive:source.emissive?.clone?.()||new THREE.Color(0x000000),
      emissiveMap:source.emissiveMap||null,
      opacity:Number.isFinite(source.opacity)?source.opacity:1,
      transparent:!!source.transparent, side:source.side??THREE.FrontSide,
      wireframe:!!source.wireframe, vertexColors:!!source.vertexColors, roughness, metalness:0
    });
    material.name=source.name||'Material';
    material.userData={...(source.userData||{}),fbxSourceMaterialType:source.type||'unknown'};
    if(source.bumpScale!==undefined)material.bumpScale=source.bumpScale;
    if(source.displacementScale!==undefined)material.displacementScale=source.displacementScale;
    if(source.displacementBias!==undefined)material.displacementBias=source.displacementBias;
    converted.set(source,material);
    return material;
  };
  root.traverse(object=>{
    if(!object.isMesh||!object.material)return;
    object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);
  });
}
async function parseSceneModel(buffer,fileName,resourcePath=''){
  if(/\\.fbx$/i.test(String(fileName||''))){
    const root=fbxLoader.parse(buffer,resourcePath||'');
    if(!root)throw new Error('FBX не содержит сцены.');
    prepareFbxMaterials(root);
    return {scene:root};
  }
  return await new Promise((resolve,reject)=>loader.parse(buffer,'',resolve,reject));
}
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

const AI_PINE_VARIANTS=[
  'spruce_dense','spruce_slim','spruce_broad','spruce_windswept',
  'fir_compact','fir_layered','fir_irregular','spruce_mountain'
];
let aiPineTextures=null,aiPineTexturesPromise=null;
function loadAiPineTextures(){
  if(!aiPineTexturesPromise){
    aiPineTexturesPromise=(async()=>{
      const atlas=await new THREE.TextureLoader().loadAsync('./assets/trees/snowy_conifer_atlas.webp');
      const image=atlas.image;
      const cellWidth=Math.floor(image.width/4);
      const cellHeight=Math.floor(image.height/2);
      if(image.width!==1632||image.height!==1200){
        throw new Error('Unexpected OpenAI tree atlas dimensions: '+image.width+'x'+image.height);
      }

      // Crop each tree into its own canvas before mipmap generation.
      // This prevents mip levels from blending pixels from neighbouring atlas cells.
      aiPineTextures=AI_PINE_VARIANTS.map((name,index)=>{
        const column=index%4;
        const row=Math.floor(index/4);
        const canvas=document.createElement('canvas');
        canvas.width=cellWidth;
        canvas.height=cellHeight;
        const context=canvas.getContext('2d');
        if(!context)throw new Error('Cannot create canvas for '+name);
        context.clearRect(0,0,cellWidth,cellHeight);
        context.drawImage(
          image,
          column*cellWidth,row*cellHeight,cellWidth,cellHeight,
          0,0,cellWidth,cellHeight
        );
        const texture=new THREE.CanvasTexture(canvas);
        texture.colorSpace=THREE.SRGBColorSpace;
        texture.wrapS=THREE.ClampToEdgeWrapping;
        texture.wrapT=THREE.ClampToEdgeWrapping;
        texture.generateMipmaps=true;
        texture.minFilter=THREE.LinearMipmapLinearFilter;
        texture.magFilter=THREE.LinearFilter;
        texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
        texture.name='OpenAI_Generated_'+name;
        return texture;
      });
      atlas.dispose();
      return aiPineTextures;
    })().catch(error=>{
      console.warn('OpenAI snowy-tree atlas did not load; procedural forest fallback remains active.',error);
      aiPineTexturesPromise=null;
      return null;
    });
  }
  return aiPineTexturesPromise;
}
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
  if(state.forestGroup){
    scene.remove(state.forestGroup);
    disposeObjectTree(state.forestGroup);
  }
  if(treeBillboardMaterial) {
    treeBillboardMaterial.map?.dispose();
    treeBillboardMaterial.normalMap?.dispose();
    treeBillboardMaterial.dispose();
    treeBillboardMaterial=null;
  }
  state.forestGroup=null;
  state.billboardMesh=null;
  state.billboardMeshes=[];
  state.billboardTrees=[];
  lastBillboardCameraX=NaN;lastBillboardCameraZ=NaN;
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

  // A single camera-facing card per tree: no intersecting planes, so no z-fighting.
  if(aiPineTextures&&aiPineTextures.length===AI_PINE_VARIANTS.length){
    const byVariant=AI_PINE_VARIANTS.map(()=>[]);
    trees.forEach(t=>{
      t.variant=Math.floor(rnd()*AI_PINE_VARIANTS.length);
      byVariant[t.variant].push(t);
    });
    const sets=[];
    const dummy=new THREE.Object3D();
    const geometry=new THREE.PlaneGeometry(1,1);
    byVariant.forEach((variantTrees,variantIndex)=>{
      if(!variantTrees.length)return;
      const material=new THREE.MeshBasicMaterial({
        map:aiPineTextures[variantIndex].clone(),
        color:0xffffff,
        side:THREE.DoubleSide,
        alphaTest:0.10,
        alphaToCoverage:true,
        toneMapped:false,
        fog:true,
        depthWrite:true
      });
      const mesh=new THREE.InstancedMesh(geometry,material,variantTrees.length);
      mesh.name='OpenAI_'+AI_PINE_VARIANTS[variantIndex]+'_CameraFacing';
      mesh.frustumCulled=false;
      mesh.castShadow=false;
      mesh.receiveShadow=false;
      variantTrees.forEach((t,i)=>{
        const scale=t.height*(.92+rnd()*.16);
        t.billboardHeight=scale;
        t.billboardWidth=scale*.64;
        dummy.position.set(t.x,t.y+scale*.5,t.z);
        dummy.rotation.set(0,Math.atan2(camera.position.x-t.x,camera.position.z-t.z),0);
        dummy.scale.set(t.billboardWidth,scale,1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i,dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate=true;
      forest.add(mesh);
      sets.push({mesh,trees:variantTrees,offset:0});
    });
    state.billboardMesh=sets.length?sets[0].mesh:null;
    state.billboardMeshes=sets;
    state.billboardTrees=trees.map(t=>({
      x:t.x,y:t.y,z:t.z,
      height:t.billboardHeight||t.height,
      width:t.billboardWidth||t.width
    }));
    dbg('OpenAI AI-лес: '+trees.length+' деревьев · '+AI_PINE_VARIANTS.length+' вариантов · single camera-facing card');
    return;
  }
  // Procedural fallback while the generated texture is loading.
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
let lastBillboardCameraX=NaN,lastBillboardCameraZ=NaN;
function updateForestBillboards() {
  const cameraX=camera.position.x,cameraZ=camera.position.z;
  if(Number.isFinite(lastBillboardCameraX)&&
     (cameraX-lastBillboardCameraX)**2+(cameraZ-lastBillboardCameraZ)**2<0.0001)return;
  if(state.billboardMeshes?.length){
    state.billboardMeshes.forEach(set=>{
      const trees=set.trees||state.billboardTrees;
      trees.forEach((t,i)=>{
        const height=t.billboardHeight||t.height;
        const width=t.billboardWidth||t.width*1.08;
        const yaw=Math.atan2(camera.position.x-t.x,camera.position.z-t.z)+set.offset;
        forestQuaternion.setFromAxisAngle(forestUp,yaw);
        forestPosition.set(t.x,t.y+height*.5,t.z);
        forestScale.set(width,height,1);
        forestMatrix.compose(forestPosition,forestQuaternion,forestScale);
        set.mesh.setMatrixAt(i,forestMatrix);
      });
      set.mesh.instanceMatrix.needsUpdate=true;
    });
    lastBillboardCameraX=cameraX;lastBillboardCameraZ=cameraZ;
    return;
  }
  if(!state.billboardMesh||!state.billboardTrees.length)return;
  state.billboardTrees.forEach((t,i)=>{
    const yaw=Math.atan2(camera.position.x-t.x,camera.position.z-t.z);
    forestQuaternion.setFromAxisAngle(forestUp,yaw);
    forestPosition.set(t.x,t.y+t.height*.5,t.z);
    forestScale.set(t.width,t.height,1);
    forestMatrix.compose(forestPosition,forestQuaternion,forestScale);
    state.billboardMesh.setMatrixAt(i,forestMatrix);
  });
  state.billboardMesh.instanceMatrix.needsUpdate=true;
  lastBillboardCameraX=cameraX;lastBillboardCameraZ=cameraZ;
}


function disposeObjectTree(root){
  if(!root)return;
  const geometries=new Set(),materials=new Set(),textures=new Set();
  root.traverse(object=>{
    if(object.geometry)geometries.add(object.geometry);
    const list=Array.isArray(object.material)?object.material:(object.material?[object.material]:[]);
    list.forEach(material=>{
      if(!material)return;
      materials.add(material);
      Object.values(material).forEach(value=>{if(value&&value.isTexture)textures.add(value);});
    });
  });
  textures.forEach(texture=>{
    if(texture.userData?.editorObjectUrl)URL.revokeObjectURL(texture.userData.editorObjectUrl);
    texture.dispose();
  });
  materials.forEach(material=>material.dispose());
  geometries.forEach(geometry=>geometry.dispose());
}
function clearGroup(g){
  if(g){scene.remove(g);disposeObjectTree(g);}
  return null;
}

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
    disposeObjectTree(measureGroup);
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
const sceneLoadingEl=document.getElementById('sceneLoading');
async function loadOptimizerData(id,isCurrent=()=>true){
    const cv=await loadJSON('./assets/'+id+'.curves.json'+bust());
    if(!isCurrent())return;
    state.curves=cv;
    dbg('Кривые загружены: centre '+(cv.centre||[]).length+', left '+(cv.left||[]).length+', right '+(cv.right||[]).length);
    const mayaEl=document.getElementById('mayaLabels');
    mayaEl.textContent='Загрузка подписей Maya…';
    let mayaLoaded=false;
    try{
      const m=await loadJSON('./assets/'+id+'_labels.json'+bust());
      if(!isCurrent())return;
      const rows=(m&&Array.isArray(m.labels))?m.labels:[];
      if(rows.length){
        mayaEl.textContent=rows.map(r=>{
          const s=(r.slope_deg===null||r.slope_deg===undefined)?'—':Number(r.slope_deg).toFixed(1);
          return 'Ст. '+r.station+': уклон '+s+'° | H: '+Number(r.h_center).toFixed(1)+' / '+Number(r.h_left).toFixed(1)+' / '+Number(r.h_right).toFixed(1)+' м';
        }).join('\n');
        mayaLoaded=true;
        dbg('Подписи Maya загружены: '+rows.length+' станций');
      }
    }catch(e){
      if(!isCurrent())return;
    }
    if(!isCurrent())return;
    if(!mayaLoaded){mayaEl.textContent='Нет данных — файл '+id+'_labels.json не найден в assets/ (сначала ЗАПУСК в Maya).';}
}


// Depth-buffer priority for imported piste overlays; this never changes world-space Y.
function applyImportedSlopeDepthBias(target, factor = -1, units = -1) {
  target.traverse(object => {
    if (!object.isMesh || object.userData.renderDepthBiasApplied) return;
    const apply = material => {
      const copy = material.clone();
      copy.polygonOffset = true;
      copy.polygonOffsetFactor = factor;
      copy.polygonOffsetUnits = units;
      copy.needsUpdate = true;
      return copy;
    };
    object.material = Array.isArray(object.material) ? object.material.map(apply) : apply(object.material);
    object.userData.renderDepthBiasApplied = true;
  });
}

let slopeLoadSequence=0;
async function loadSlope(id){
  const loadSequence=++slopeLoadSequence;
  const isCurrentLoad=()=>loadSequence===slopeLoadSequence;
  if(state.mode!=='overview')setSceneMode('overview');
  clearEditorSelectionHelper();
  clearTestForest();
  if(state.root){scene.remove(state.root);state.root=null;}
  state.terrain=null;state.baseTerrain=null;state.baseTerrainMats=[];state.activeTerrainAssetId=null;state.curves=null;state.terrainMats=[];
  state.designGroup=clearGroup(state.designGroup);
  state.labelsGroup=clearGroup(state.labelsGroup);
  state.terrainLabelsGroup=clearGroup(state.terrainLabelsGroup);
  dbgEl.textContent='';
  clearMeasure();
  assetToken=Date.now();
  document.getElementById('stats').textContent='Загрузка рельефа…';
  sceneLoadingEl.style.display='flex';
  const loadTitle=sceneLoadingEl.querySelector('.load-title');
  const loadSub=sceneLoadingEl.querySelector('.load-sub');
  if(loadTitle)loadTitle.textContent='Подготавливаем склон';
  if(loadSub)loadSub.textContent='Загружаем рельеф и собираем 3D-сцену';
  try{
    const gltf=await loadGLTF('./assets/'+id+'.gltf'+bust());
    if(!isCurrentLoad())return;
    const root=gltf.scene;scene.add(root);state.root=root;
    if(loadSub)loadSub.textContent='Рельеф загружен · формируем зимний лес';
    root.traverse(o=>{
      const objectName=(o.name||'').toLowerCase();
      if(objectName.includes('slope')) applyImportedSlopeDepthBias(o,-1,-1);
      if(objectName.includes('terrain')){
        state.terrain=o;
        o.traverse(c=>{
          if(c.isMesh){
            setTerrainSnowMaterial(c);
          }
        });
      }
    });
    state.baseTerrain=state.terrain;
    state.baseTerrainMats=state.terrainMats.slice();
    const savedTerrainAsset=state.importedAssets.find(asset=>asset.meta?.category==='terrain'&&asset.meta?.activeTerrain);
    if(savedTerrainAsset)activateImportedTerrain(savedTerrainAsset,{rebuildForest:false,refreshList:false});
    applyTerrainLook();
    root.updateMatrixWorld(true);
    refreshEditorAssetList();
    buildTestForest();
    const loadedRoot=state.root;
    loadAiPineTextures().then(textures=>{if(textures&&state.root===loadedRoot){buildTestForest();dbg('OpenAI-текстуры зимних елей активированы: '+AI_PINE_VARIANTS.length+' вариантов.');}});
    dbg('Terrain загружен.');
    if(loadSub)loadSub.textContent=state.optimizeMode?'Подготавливаем параметры оптимизации':'Настраиваем освещение и камеру';
    if(state.optimizeMode){
      await loadOptimizerData(id,isCurrentLoad);
      if(!isCurrentLoad())return;
    }else{
      state.curves=null;
      document.getElementById('stats').textContent='Презентационный режим. Откройте «Оптимизация», чтобы загрузить инструменты выравнивания.';
      document.getElementById('mayaLabels').textContent='Инструменты оптимизации не загружены.';
    }
    const viewTarget=state.terrain||root;
    const box=new THREE.Box3().setFromObject(viewTarget);
    const ctr=box.getCenter(new THREE.Vector3()),sz=box.getSize(new THREE.Vector3()).length();
    lightingCenter.copy(ctr); updateDaylight(state.dayTime);
    camera.position.set(ctr.x+sz*.5,ctr.y+sz*.5,ctr.z+sz*.7);
    controls.target.copy(ctr);controls.update();
    state.homePos=camera.position.clone();
    state.homeTarget=controls.target.clone();
    if(state.optimizeMode){
      await new Promise(r=>setTimeout(r,50));
      if(!isCurrentLoad())return;
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
    if(!isCurrentLoad())return;
    const msg=err&&(err.message||err.description)?(err.message||err.description):String(err);
    document.getElementById('stats').textContent='Ошибка загрузки склона "'+id+'": '+msg;
    dbg('ОШИБКА: '+msg);
    console.error(err);
  }finally{
    if(isCurrentLoad())sceneLoadingEl.style.display='none';
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
  if(open&&appRoot.classList.contains('editor-open')){
    appRoot.classList.remove('editor-open');
    editorToggleButton.classList.remove('active');
    editorToggleButton.setAttribute('aria-expanded','false');
    if(editorSelectionHelper)editorSelectionHelper.visible=false;
  }
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

/* ---------- Scene Editor / GLB import / PBR material inspector ---------- */
const editorToggleButton=document.getElementById('editorToggle');
const editorPanel=document.getElementById('sceneEditorPanel');
const sceneHierarchyPanel=document.getElementById('sceneHierarchyPanel');
const editorTreeList=document.getElementById('editorTreeList');
const editorTreeSearch=document.getElementById('editorTreeSearch');
const glbFileInput=document.getElementById('glbFileInput');
const editorStatus=document.getElementById('editorStatus');
const editorObjectSelect=document.getElementById('editorObjectSelect');
const editorMaterialSelect=document.getElementById('editorMaterialSelect');
let editorSelectedAsset=null;
let editorSelectedNode=null;
let editorSelectedMaterialKey='';
const editorOriginalVisibility=new WeakMap();
let editorTreeExpanded=new Set();
let editorTreeInitialized=new Set();
let editorMaterialTargets=[];
let editorSelectionHelper=null;

function setEditorStatus(message,isError=false){
  editorStatus.textContent=message;
  editorStatus.classList.toggle('error',isError);
}
function updateTerrainResetControl(){
  const button=document.getElementById('resetTerrainButton');
  if(button)button.disabled=!state.activeTerrainAssetId;
}
function focusSceneObject(target){
  if(!target)return;
  target.updateWorldMatrix(true,true);
  const box=new THREE.Box3().setFromObject(target);
  if(box.isEmpty())return;
  const center=box.getCenter(new THREE.Vector3());
  const size=box.getSize(new THREE.Vector3());
  const radius=Math.max(size.length()*0.5,3);
  const distance=radius/Math.max(0.1,Math.sin(THREE.MathUtils.degToRad(camera.fov*0.5)))*1.18;
  const direction=new THREE.Vector3(1,0.68,1).normalize();
  camera.position.copy(center).addScaledVector(direction,distance);
  camera.near=0.1;
  camera.far=Math.max(10000,distance+radius*20);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
  lightingCenter.copy(center);
  updateDaylight(state.dayTime);
  state.homePos=camera.position.clone();
  state.homeTarget=controls.target.clone();
}
function collectTerrainMaterials(root){
  const materials=[];
  root?.traverse(object=>{
    if(!object.isMesh||!object.material)return;
    (Array.isArray(object.material)?object.material:[object.material]).forEach(material=>{
      if(material)materials.push(material);
    });
  });
  return materials;
}
function syncActiveTerrainTransform(asset,rebuildForest=false){
  if(!asset||asset.id!==state.activeTerrainAssetId)return;
  asset.root.updateWorldMatrix(true,true);
  state.terrain=asset.root;
  droneController.setTerrain(asset.root);
  if(rebuildForest){clearTestForest();buildTestForest();}
}
function activateImportedTerrain(asset,{rebuildForest=true,refreshList=true,persist=true}={}){
  if(!asset?.root||asset.sourceType==='scene')return false;
  state.importedAssets.forEach(other=>{
    if(other!==asset&&other.meta?.category==='terrain'){
      other.meta.activeTerrain=false;
      other.meta.visible=false;
      other.root.visible=false;
      persistImportedEditorAsset(other).catch(error=>console.warn('Не удалось сохранить переключение рельефа:',error));
    }
  });
  if(state.baseTerrain)state.baseTerrain.visible=false;
  asset.meta.category='terrain';
  asset.meta.activeTerrain=true;
  asset.meta.visible=true;
  asset.meta.collision=true;
  asset.root.visible=true;
  state.activeTerrainAssetId=asset.id;
  state.terrain=asset.root;
  state.terrainVisible=true;
  state.terrainMats=collectTerrainMaterials(asset.root);
  asset.root.updateWorldMatrix(true,true);
  droneController.setTerrain(asset.root);
  applyTerrainLook();
  if(rebuildForest){clearTestForest();buildTestForest();}
  updateTerrainResetControl();
  if(refreshList)refreshEditorAssetList(asset.id);
  if(persist)persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить настройки рельефа:',error));
  return true;
}
function resetImportedTerrain({rebuildForest=true,persist=true}={}){
  const active=state.importedAssets.find(asset=>asset.id===state.activeTerrainAssetId);
  if(active){
    active.meta.activeTerrain=false;
    active.meta.visible=false;
    active.root.visible=false;
    if(persist)persistImportedEditorAsset(active).catch(error=>console.warn('Не удалось сохранить настройки модели:',error));
  }
  state.activeTerrainAssetId=null;
  state.terrain=state.baseTerrain;
  state.terrainMats=state.baseTerrainMats.slice();
  state.terrainVisible=true;
  if(state.baseTerrain)state.baseTerrain.visible=true;
  if(state.terrain)state.terrain.updateWorldMatrix(true,true);
  droneController.setTerrain(state.terrain);
  applyTerrainLook();
  if(rebuildForest){clearTestForest();buildTestForest();}
  updateTerrainResetControl();
  refreshEditorAssetList();
  setEditorStatus('Восстановлен исходный рельеф текущей трассы.');
}
function slugAssetName(value){
  return String(value||'asset').replace(/\\.[^.]+$/,'').replace(/[^A-Za-z0-9_.-]+/g,'_').replace(/^_+|_+$/g,'')||'asset';
}
function collectLiveSceneAssets(){
  const assets=[];
  if(!state.root)return assets;
  let meshIndex=0;
  state.root.traverse(object=>{
    if(!object.isMesh||!object.material)return;
    captureEditorNodeVisibilityDefaults(object);
    const objectName=object.name||('Mesh '+(meshIndex+1));
    const id='scene:'+state.slope+':'+meshIndex+':'+objectName;
    const defaults={
      id,name:objectName,
      category:/terrain|ground/i.test(objectName)?'terrain':(/slope|piste/i.test(objectName)?'slope':'infrastructure'),
      phase:'always',
      collision:/terrain|ground/i.test(objectName),
      forestBlocker:/terrain|ground|slope|road|lift/i.test(objectName),
      sourceFile:state.slope+'.gltf'
    };
    const meta=object.userData.resortAsset||defaults;
    meta.id=id;meta.name=objectName;
    object.userData.resortAsset=meta;
    assets.push({id,name:'SCENE · '+objectName,root:object,meta,sourceType:'scene'});
    meshIndex++;
  });
  return assets;
}
function getAllEditorAssets(){
  return [
    ...state.importedAssets.map(asset=>{
      asset.sourceType='imported';
      return asset;
    }),
    ...collectLiveSceneAssets()
  ];
}
function clearEditorSelectionHelper(){
  if(!editorSelectionHelper)return;
  scene.remove(editorSelectionHelper);
  editorSelectionHelper.geometry?.dispose();
  if(Array.isArray(editorSelectionHelper.material))editorSelectionHelper.material.forEach(m=>m.dispose());
  else editorSelectionHelper.material?.dispose();
  editorSelectionHelper=null;
}
function updateEditorSelectionHelper(asset){
  clearEditorSelectionHelper();
  if(!asset?.root)return;
  editorSelectionHelper=new THREE.BoxHelper(asset.root,0x53d69a);
  editorSelectionHelper.material.depthTest=false;
  editorSelectionHelper.material.transparent=true;
  editorSelectionHelper.material.opacity=0.95;
  editorSelectionHelper.renderOrder=1000;
  editorSelectionHelper.visible=appRoot.classList.contains('editor-open');
  scene.add(editorSelectionHelper);
}
function editorNodeKey(owner,node){
  return owner.id+'::node::'+node.uuid;
}
function editorMaterialKey(owner,node,index){
  return owner.id+'::material::'+node.uuid+'::'+index;
}
function editorNodeIsInside(root,node){
  let current=node;
  while(current){if(current===root)return true;current=current.parent;}
  return false;
}
function editorSelectionKey(){
  if(!editorSelectedAsset||!editorSelectedNode)return '';
  return editorSelectedMaterialKey||editorNodeKey(editorSelectedAsset,editorSelectedNode);
}
function editorNodeLabel(node){
  return node.name||((node.isMesh?'Mesh':node.type)||'Object');
}
function editorNodeMaterialList(node){
  if(!node?.isMesh||!node.material)return [];
  return Array.isArray(node.material)?node.material:[node.material];
}
function editorNodeSearchSelfMatches(owner,node,query){
  if(!query)return true;
  const metadata=node.userData?.gradeOptimizerMetadata||{};
  const metadataText=[metadata.role||'',...(Array.isArray(metadata.tags)?metadata.tags:[])].join(' ');
  const text=[editorNodeLabel(node),node.type,owner.name,owner.meta?.category||'',metadataText].join(' ').toLowerCase();
  if(text.includes(query))return true;
  return editorNodeMaterialList(node).some(material=>(material?.name||'Material').toLowerCase().includes(query));
}
function editorNodeHasSearchMatch(owner,node,query){
  if(editorNodeSearchSelfMatches(owner,node,query))return true;
  return (node.children||[]).some(child=>editorNodeHasSearchMatch(owner,child,query));
}
function collectSharedMaterialUseCounts(assets){
  const counts=new Map();
  assets.forEach(asset=>asset.root.traverse(node=>{
    editorNodeMaterialList(node).forEach(material=>{
      if(material)counts.set(material.uuid,(counts.get(material.uuid)||0)+1);
    });
  }));
  return counts;
}
function collectEditorMaterialLibrary(assets=getAllEditorAssets()){
  const library=new Map();
  assets.forEach(owner=>owner.root.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.material)return;
    editorNodeMaterialList(mesh).forEach((material,index)=>{
      if(!material)return;
      let entry=library.get(material.uuid);
      if(!entry){
        entry={id:material.uuid,material,targets:[],firstOwner:owner,firstMesh:mesh};
        library.set(material.uuid,entry);
      }
      entry.targets.push({owner,mesh,index});
    });
  }));
  return [...library.values()].sort((a,b)=>(a.material.name||'Material').localeCompare(b.material.name||'Material'));
}
function updateEditorMaterialLibraryControls(){
  const target=selectedEditorMaterial();
  const librarySelect=document.getElementById('editorMaterialLibrarySelect');
  const assignButton=document.getElementById('assignEditorMaterial');
  const uniqueButton=document.getElementById('makeEditorMaterialUnique');
  const selectedId=librarySelect?.value||'';
  const libraryItem=collectEditorMaterialLibrary().find(item=>item.id===selectedId);
  if(assignButton)assignButton.disabled=!target||!libraryItem;
  if(uniqueButton)uniqueButton.disabled=!target?.material;
}
function refreshEditorMaterialLibrary(preferredId=''){
  const select=document.getElementById('editorMaterialLibrarySelect');
  if(!select)return;
  const previousId=preferredId||select.value||selectedEditorMaterial()?.material?.uuid||'';
  const items=collectEditorMaterialLibrary();
  select.innerHTML='';
  if(!items.length){
    const option=document.createElement('option');
    option.value='';option.textContent='В сцене пока нет материалов';
    select.appendChild(option);
    select.disabled=true;
    updateEditorMaterialLibraryControls();
    return;
  }
  items.forEach(item=>{
    const materialName=item.material.name||'Material';
    const uses=item.targets.length;
    const context=item.firstOwner?.name||'Scene';
    const option=document.createElement('option');
    option.value=item.id;
    option.textContent=materialName+' · '+uses+' slot(s) · '+context;
    select.appendChild(option);
  });
  select.disabled=false;
  const fallback=selectedEditorMaterial()?.material?.uuid||items[0].id;
  select.value=items.some(item=>item.id===previousId)?previousId:fallback;
  updateEditorMaterialLibraryControls();
}
function updateEditorMaterialLinkStatus(){
  const status=document.getElementById('editorMaterialLinkStatus');
  if(!status)return;
  const target=selectedEditorMaterial();
  if(!target?.material){status.textContent='Выбери material slot для редактирования.';return;}
  const uses=collectSharedMaterialUseCounts(getAllEditorAssets()).get(target.material.uuid)||1;
  status.textContent=uses>1
    ?'SHARED ×'+uses+' — изменения применяются ко всем слотам с этим экземпляром материала.'
    :'UNIQUE INSTANCE — изменения затрагивают только этот экземпляр материала.';
}
function markEditorMaterialOwnersDirty(material){
  if(!material)return [];
  const affected=[];
  state.importedAssets.forEach(asset=>{
    let usesMaterial=false;
    asset.root.traverse(node=>{
      if(!usesMaterial&&editorNodeMaterialList(node).includes(material))usesMaterial=true;
    });
    if(usesMaterial){
      asset.meta.modelDirty=true;
      affected.push(asset);
    }
  });
  return affected;
}
function replaceEditorMaterialTarget(target,material){
  if(!target?.mesh||!material)return false;
  const current=target.mesh.material;
  if(Array.isArray(current)){
    const next=current.slice();
    next[target.index]=material;
    target.mesh.material=next;
  }else{
    if(target.index!==0)return false;
    target.mesh.material=material;
  }
  return true;
}
function assignEditorLibraryMaterial(){
  const target=selectedEditorMaterial();
  const libraryId=document.getElementById('editorMaterialLibrarySelect')?.value||'';
  const libraryItem=collectEditorMaterialLibrary().find(item=>item.id===libraryId);
  if(!target||!libraryItem)return;
  if(target.material===libraryItem.material){
    setEditorStatus('Этот слот уже использует выбранный материал.');
    return;
  }
  if(!replaceEditorMaterialTarget(target,libraryItem.material))return;
  const affected=markEditorMaterialOwnersDirty(libraryItem.material);
  if(target.owner?.sourceType==='imported'&&!affected.includes(target.owner)){
    target.owner.meta.modelDirty=true;
    affected.push(target.owner);
  }
  const selectedIndex=Number(editorMaterialSelect.value)||0;
  editorSelectedMaterialKey=editorMaterialKey(target.owner,target.mesh,target.index);
  refreshEditorMaterialList(selectedIndex);
  refreshEditorMaterialLibrary(libraryItem.id);
  renderEditorTree(getAllEditorAssets(),editorSelectionKey());
  affected.forEach(asset=>persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить назначение общего материала:',error)));
  setEditorStatus('Материал «'+(libraryItem.material.name||'Material')+'» назначен слоту «'+(target.mesh.name||'Mesh')+'». Теперь он связан как минимум с '+(libraryItem.targets.length+1)+' слотами.');
}
function makeEditorMaterialUnique(){
  const target=selectedEditorMaterial();
  if(!target?.material)return;
  const source=target.material;
  const clone=source.clone();
  clone.name=(source.name||'Material')+' (Unique)';
  clone.userData={...(source.userData||{}),gradeOptimizerClonedFrom:source.uuid};
  const textureProperties=[
    'map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','bumpMap',
    'displacementMap','alphaMap','lightMap','envMap','specularMap','clearcoatMap',
    'clearcoatNormalMap','clearcoatRoughnessMap','transmissionMap','thicknessMap',
    'sheenColorMap','sheenRoughnessMap','iridescenceMap','iridescenceThicknessMap','anisotropyMap'
  ];
  textureProperties.forEach(key=>{
    if(source[key]?.isTexture)clone[key]=source[key].clone();
  });
  if(!replaceEditorMaterialTarget(target,clone)){clone.dispose();return;}
  const affected=target.owner?.sourceType==='imported'?[target.owner]:[];
  affected.forEach(asset=>{asset.meta.modelDirty=true;});
  const selectedIndex=Number(editorMaterialSelect.value)||0;
  editorSelectedMaterialKey=editorMaterialKey(target.owner,target.mesh,target.index);
  refreshEditorMaterialList(selectedIndex);
  refreshEditorMaterialLibrary(clone.uuid);
  renderEditorTree(getAllEditorAssets(),editorSelectionKey());
  affected.forEach(asset=>persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить уникальный материал:',error)));
  setEditorStatus('Создан независимый материал «'+clone.name+'». Изменения этого слота больше не затронут остальные назначения исходного материала.');
}
function renderEditorTree(assets,selectedKey=editorSelectionKey()){
  if(!editorTreeList)return;
  editorTreeList.innerHTML='';
  const query=(editorTreeSearch?.value||'').trim().toLowerCase();
  const groups=[
    {label:'RESORT SCENE',key:'scene',items:assets.filter(asset=>asset.sourceType==='scene')},
    {label:'IMPORTED MODELS',key:'imported',items:assets.filter(asset=>asset.sourceType!=='scene')}
  ];
  const materialUseCounts=collectSharedMaterialUseCounts(assets);
  let visibleCount=0;

  function appendMaterialRow(owner,node,material,index,depth){
    const key=editorMaterialKey(owner,node,index);
    const row=document.createElement('div');
    row.className='editor-tree-row editor-tree-material-row';
    const spacer=document.createElement('span');
    spacer.className='editor-tree-expander editor-tree-expander-empty';
    spacer.textContent='·';
    const button=document.createElement('button');
    button.type='button';
    button.className='editor-tree-item editor-tree-material'+(key===selectedKey?' selected':'');
    button.style.setProperty('--tree-depth',String(depth));
    button.title=(material?.name||'Material '+(index+1))+' · '+editorNodeLabel(node);
    const icon=document.createElement('span');
    icon.className='tree-icon';icon.textContent='◉';
    const label=document.createElement('span');
    label.className='tree-name';label.textContent=material?.name||'Material '+(index+1);
    const tag=document.createElement('span');
    tag.className='tree-tag';
    const uses=material?materialUseCounts.get(material.uuid)||1:1;
    tag.textContent=uses>1?'SHARED ×'+uses:'MAT';
    button.append(icon,label,tag);
    button.addEventListener('click',()=>selectEditorNode(owner,node,index));
    row.append(spacer,button);
    editorTreeList.appendChild(row);
    visibleCount++;
  }

  function appendNode(owner,node,depth,isAssetRoot=false){
    if(query&&!editorNodeHasSearchMatch(owner,node,query))return;
    const key=editorNodeKey(owner,node);
    if(isAssetRoot&&!editorTreeInitialized.has(key)){
      editorTreeInitialized.add(key);editorTreeExpanded.add(key);
    }
    const children=node.children||[];
    const materials=editorNodeMaterialList(node);
    const hasChildren=children.length>0||materials.length>0;
    const expanded=query?true:editorTreeExpanded.has(key);
    const row=document.createElement('div');row.className='editor-tree-row';
    const expander=document.createElement('button');
    expander.type='button';
    expander.className='editor-tree-expander'+(hasChildren?'':' editor-tree-expander-empty');
    expander.textContent=hasChildren?(expanded?'▾':'▸'):'·';
    expander.disabled=!hasChildren;
    expander.setAttribute('aria-label',expanded?'Свернуть':'Развернуть');
    expander.setAttribute('aria-expanded',String(expanded));
    if(hasChildren)expander.addEventListener('click',()=>{
      if(editorTreeExpanded.has(key))editorTreeExpanded.delete(key);
      else editorTreeExpanded.add(key);
      renderEditorTree(assets,selectedKey);
    });
    const button=document.createElement('button');
    button.type='button';
    button.className='editor-tree-item'+(key===selectedKey?' selected':'');
    button.style.setProperty('--tree-depth',String(depth));
    button.title=editorNodeLabel(node)+' · '+node.type;
    const icon=document.createElement('span');
    icon.className='tree-icon';
    icon.textContent=node.isMesh?'▧':(node.type==='Group'||node.type==='Scene'?'▰':'◇');
    const label=document.createElement('span');
    label.className='tree-name';label.textContent=editorNodeLabel(node);
    const tag=document.createElement('span');
    tag.className='tree-tag';
    const nodeRole=node.userData?.gradeOptimizerMetadata?.role||'';
    tag.textContent=isAssetRoot?(owner.sourceType==='scene'?'SCENE':(/\.fbx$/i.test(owner.meta?.sourceFile||owner.sourcePath||'')?'FBX':'GLB')):(nodeRole?String(nodeRole).toUpperCase():(node.isMesh?'MESH':node.type.toUpperCase()));
    button.append(icon,label,tag);
    button.addEventListener('click',()=>{
      if(editorObjectSelect)editorObjectSelect.value=owner.id;
      selectEditorNode(owner,node);
    });
    row.append(expander,button);
    editorTreeList.appendChild(row);
    visibleCount++;
    if(!expanded)return;
    const childNodes=query?children.filter(child=>editorNodeHasSearchMatch(owner,child,query)):children;
    childNodes.forEach(child=>appendNode(owner,child,depth+1,false));
    materials.forEach((material,index)=>{
      if(!query||(material?.name||'').toLowerCase().includes(query))appendMaterialRow(owner,node,material,index,depth+1);
    });
  }

  groups.forEach(group=>{
    const items=group.items.filter(asset=>!query||
      editorNodeHasSearchMatch(asset,asset.root,query)||asset.name.toLowerCase().includes(query));
    if(!items.length)return;
    const heading=document.createElement('div');
    heading.className='tree-group-title';
    heading.textContent=group.label+' · '+items.length;
    editorTreeList.appendChild(heading);
    items.forEach(asset=>appendNode(asset,asset.root,0,true));
  });
  if(!visibleCount){
    const empty=document.createElement('div');
    empty.className='tree-empty';
    empty.textContent=query?'Ничего не найдено':'Рельеф загружается…';
    editorTreeList.appendChild(empty);
  }
}
function expandEditorTree(expand){
  const assets=getAllEditorAssets();
  if(!expand)editorTreeExpanded.clear();
  else assets.forEach(asset=>asset.root.traverse(node=>editorTreeExpanded.add(editorNodeKey(asset,node))));
  renderEditorTree(assets);
}


function refreshEditorAssetList(selectId=null){
  const assets=getAllEditorAssets();
  const assetCount=document.getElementById('editorAssetCount');
  if(assetCount)assetCount.textContent=assets.length+' ROOTS';
  const previousId=selectId||editorSelectedAsset?.id||'';
  const previousNode=editorSelectedNode;
  editorObjectSelect.innerHTML='';
  if(!assets.length){
    const option=document.createElement('option');option.value='';option.textContent='Сцена ещё загружается…';
    editorObjectSelect.appendChild(option);
    editorSelectedAsset=null;editorSelectedNode=null;editorSelectedMaterialKey='';
    renderEditorTree([], '');
    const nameLabel=document.getElementById('editorSelectedName');
    if(nameLabel)nameLabel.textContent='Нет выбранного объекта';
    clearEditorSelectionHelper();refreshEditorMaterialList();refreshEditorMaterialLibrary();return;
  }
  assets.forEach(asset=>{
    const option=document.createElement('option');option.value=asset.id;option.textContent=asset.name;
    editorObjectSelect.appendChild(option);
  });
  const chosen=assets.find(asset=>asset.id===previousId)||assets[0];
  const nodeToKeep=chosen.id===editorSelectedAsset?.id&&previousNode&&editorNodeIsInside(chosen.root,previousNode)?previousNode:chosen.root;
  editorObjectSelect.value=chosen.id;
  selectEditorNode(chosen,nodeToKeep);
  refreshEditorMaterialLibrary();
}


function collectEditorMaterials(asset,root=asset?.root){
  const targets=[];
  if(!asset||!root)return targets;
  root.traverse(object=>{
    if(!object.isMesh||!object.material)return;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    materials.forEach((material,index)=>{
      targets.push({
        owner:asset,mesh:object,material,index,
        label:(object.name||object.type||'Mesh')+' · '+(material.name||('Material '+(index+1)))
      });
    });
  });
  return targets;
}
function refreshEditorMaterialList(preferredIndex=0){
  editorMaterialTargets=collectEditorMaterials(editorSelectedAsset,editorSelectedNode||editorSelectedAsset?.root);
  const materialCount=document.getElementById('editorMaterialCount');
  if(materialCount)materialCount.textContent=editorMaterialTargets.length+' SLOTS';
  editorMaterialSelect.innerHTML='';
  if(!editorMaterialTargets.length){
    const option=document.createElement('option');
    option.value='';option.textContent='Нет PBR-материалов';
    editorMaterialSelect.appendChild(option);
    setMaterialControlsEnabled(false);
    updateEditorMaterialLinkStatus();
    updateEditorMaterialLibraryControls();
    return;
  }
  editorMaterialTargets.forEach((target,index)=>{
    const option=document.createElement('option');
    option.value=String(index);option.textContent=target.label;
    editorMaterialSelect.appendChild(option);
  });
  const safeIndex=Math.max(0,Math.min(preferredIndex,editorMaterialTargets.length-1));
  editorMaterialSelect.value=String(safeIndex);
  loadEditorMaterial(safeIndex);
  updateEditorMaterialLinkStatus();
  updateEditorMaterialLibraryControls();
}
function setMaterialControlsEnabled(enabled){
  const ids=['editorBaseColor','editorEmissiveColor','editorRoughness','editorMetalness','editorNormalScale',
    'editorAo','editorEmissive','editorTiling','editorOpacity','editorDoubleSide','editorWireframe',
    'editorPresetSelect','applyEditorPreset','editorTextureType','importEditorTexture','clearEditorTexture','exportSelectedGlb'];
  ids.forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=!enabled;});
}
function colorHex(color,fallback){
  return color&&color.isColor?'#'+color.getHexString():fallback;
}
function loadEditorMaterial(targetIndex){
  const target=editorMaterialTargets[Number(targetIndex)];
  if(!target){setMaterialControlsEnabled(false);return;}
  const material=target.material;
  setMaterialControlsEnabled(true);
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.value=String(value);};
  set('editorBaseColor',colorHex(material.color,'#ffffff'));
  set('editorEmissiveColor',colorHex(material.emissive,'#000000'));
  set('editorRoughness',material.roughness??0.85);
  set('editorMetalness',material.metalness??0);
  set('editorNormalScale',material.normalScale?.x??1);
  set('editorAo',material.aoMapIntensity??1);
  set('editorEmissive',material.emissiveIntensity??0);
  const maps=[material.map,material.normalMap,material.roughnessMap,material.metalnessMap,material.aoMap,material.emissiveMap,material.bumpMap,material.displacementMap].filter(Boolean);
  set('editorTiling',maps[0]?.repeat?.x??1);
  set('editorOpacity',material.opacity??1);
  document.getElementById('editorDoubleSide').checked=material.side===THREE.DoubleSide;
  document.getElementById('editorWireframe').checked=!!material.wireframe;
  updateEditorMaterialReadouts();
}
function updateEditorMaterialReadouts(){
  const pairs=[
    ['editorRoughness','editorRoughnessValue',2],
    ['editorMetalness','editorMetalnessValue',2],
    ['editorNormalScale','editorNormalScaleValue',2],
    ['editorAo','editorAoValue',2],
    ['editorEmissive','editorEmissiveValue',2],
    ['editorTiling','editorTilingValue',2],
    ['editorOpacity','editorOpacityValue',2]
  ];
  pairs.forEach(([input,output,precision])=>{
    document.getElementById(output).textContent=Number(document.getElementById(input).value).toFixed(precision);
  });
}
function selectedEditorMaterial(){
  const index=Number(editorMaterialSelect.value);
  return editorMaterialTargets[index]||null;
}
function applyEditorMaterial(){
  const target=selectedEditorMaterial();
  if(!target)return;
  const material=target.material;
  const numeric=id=>Number(document.getElementById(id).value);
  if(material.color)material.color.set(document.getElementById('editorBaseColor').value);
  if(material.emissive)material.emissive.set(document.getElementById('editorEmissiveColor').value);
  if('roughness' in material)material.roughness=numeric('editorRoughness');
  if('metalness' in material)material.metalness=numeric('editorMetalness');
  if(material.normalScale)material.normalScale.set(numeric('editorNormalScale'),numeric('editorNormalScale'));
  if('aoMapIntensity' in material)material.aoMapIntensity=numeric('editorAo');
  if('emissiveIntensity' in material)material.emissiveIntensity=numeric('editorEmissive');
  const tile=numeric('editorTiling');
  const maps=[material.map,material.normalMap,material.roughnessMap,material.metalnessMap,material.aoMap,material.emissiveMap,material.bumpMap,material.displacementMap].filter(Boolean);
  maps.forEach(map=>{
    map.wrapS=THREE.RepeatWrapping;map.wrapT=THREE.RepeatWrapping;
    map.repeat.set(tile,tile);map.needsUpdate=true;
  });
  material.opacity=numeric('editorOpacity');
  material.transparent=material.opacity<0.999;
  material.depthWrite=material.opacity>=0.999;
  material.side=document.getElementById('editorDoubleSide').checked?THREE.DoubleSide:THREE.FrontSide;
  material.wireframe=document.getElementById('editorWireframe').checked;
  material.needsUpdate=true;
  markEditorMaterialOwnersDirty(material);
  updateEditorMaterialReadouts();
}
function editorObjectPath(owner,node){
  const names=[];let current=node;
  while(current){names.unshift(editorNodeLabel(current));if(current===owner.root)break;current=current.parent;}
  return names.join(' / ');
}
function populateEditorAssetControls(asset,node=asset?.root){
  const root=node;if(!root||!asset)return;
  const isRoot=root===asset.root,meta=asset.meta||{};
  document.getElementById('editorPosX').value=root.position.x.toFixed(3);
  document.getElementById('editorPosY').value=root.position.y.toFixed(3);
  document.getElementById('editorPosZ').value=root.position.z.toFixed(3);
  document.getElementById('editorRotX').value=THREE.MathUtils.radToDeg(root.rotation.x).toFixed(1);
  document.getElementById('editorRotY').value=THREE.MathUtils.radToDeg(root.rotation.y).toFixed(1);
  document.getElementById('editorRotZ').value=THREE.MathUtils.radToDeg(root.rotation.z).toFixed(1);
  document.getElementById('editorScaleX').value=root.scale.x.toFixed(3);
  document.getElementById('editorScaleY').value=root.scale.y.toFixed(3);
  document.getElementById('editorScaleZ').value=root.scale.z.toFixed(3);
  document.getElementById('editorCategory').value=meta.category||'model';
  document.getElementById('editorPhase').value=meta.phase||'always';
  document.getElementById('editorVisible').checked=root.visible;
  document.getElementById('editorCollision').checked=!!meta.collision;
  document.getElementById('editorForestBlocker').checked=!!meta.forestBlocker;
  const nodeMetadata=root.userData?.gradeOptimizerMetadata||{};
  document.getElementById('editorNodeRole').value=String(nodeMetadata.role||'');
  document.getElementById('editorNodeTags').value=Array.isArray(nodeMetadata.tags)?nodeMetadata.tags.join(', '):String(nodeMetadata.tags||'');
  document.getElementById('editorNodeCollision').checked=!!nodeMetadata.collision;
  document.getElementById('editorNodeForestBlocker').checked=!!nodeMetadata.forestBlocker;
  ['editorCategory','editorPhase','editorCollision','editorForestBlocker','activateSelectedTerrain'].forEach(id=>{
    const control=document.getElementById(id);if(control)control.disabled=!isRoot||asset.sourceType==='scene';
  });
  ['editorNodeRole','editorNodeTags','editorNodeCollision','editorNodeForestBlocker'].forEach(id=>{
    const control=document.getElementById(id);if(control)control.disabled=false;
  });
  const selectedName=document.getElementById('editorSelectedName');
  if(selectedName)selectedName.textContent=asset.name+(isRoot?'':' / '+editorObjectPath(asset,root));
  const removeButton=document.getElementById('removeImportedAsset');
  removeButton.disabled=asset.sourceType==='scene'&&isRoot;
  removeButton.textContent=isRoot?'УДАЛИТЬ ВЫБРАННУЮ МОДЕЛЬ':'УДАЛИТЬ ВЫБРАННЫЙ КОМПОНЕНТ';
  const terrainButton=document.getElementById('activateSelectedTerrain');
  terrainButton.disabled=asset.sourceType==='scene'||!isRoot||asset.id===state.activeTerrainAssetId;
  terrainButton.textContent=asset.id===state.activeTerrainAssetId?'АКТИВЕН КАК РЕЛЬЕФ':'СДЕЛАТЬ ОСНОВНЫМ РЕЛЬЕФОМ';
  document.getElementById('focusSelectedAsset').disabled=false;
}
function selectEditorNode(owner,node,materialIndex=-1){
  if(!owner||!node)return;
  editorSelectedAsset=owner;editorSelectedNode=node;
  editorSelectedMaterialKey=materialIndex>=0?editorMaterialKey(owner,node,materialIndex):'';
  let ancestor=node.parent;
  while(ancestor){editorTreeExpanded.add(editorNodeKey(owner,ancestor));if(ancestor===owner.root)break;ancestor=ancestor.parent;}
  populateEditorAssetControls(owner,node);
  refreshEditorMaterialList(Math.max(0,materialIndex));
  updateEditorSelectionHelper({root:node});
  renderEditorTree(getAllEditorAssets(),editorSelectionKey());
  if(appRoot.classList.contains('editor-open')){
    const label=owner.name+(node===owner.root?'':' / '+editorObjectPath(owner,node));
    setEditorStatus((owner.sourceType==='scene'?'Выбран компонент основной сцены: ':'Выбран компонент модели: ')+label+'. Material slots доступны ниже.');
  }
}
function selectEditorAsset(id){
  const owner=getAllEditorAssets().find(asset=>asset.id===id)||null;
  if(!owner){editorSelectedAsset=null;editorSelectedNode=null;editorSelectedMaterialKey='';clearEditorSelectionHelper();refreshEditorMaterialList();return;}
  selectEditorNode(owner,owner.root);
}
function saveSelectedNodeMetadata(){
  const owner=editorSelectedAsset,node=editorSelectedNode;
  if(!owner||!node)return;
  const role=String(document.getElementById('editorNodeRole').value||'').trim();
  const tags=String(document.getElementById('editorNodeTags').value||'')
    .split(',').map(tag=>tag.trim()).filter(Boolean).slice(0,32);
  const metadata={
    role,tags,
    collision:document.getElementById('editorNodeCollision').checked,
    forestBlocker:document.getElementById('editorNodeForestBlocker').checked
  };
  if(!role&&!tags.length&&!metadata.collision&&!metadata.forestBlocker){
    if(node.userData)delete node.userData.gradeOptimizerMetadata;
  }else{
    node.userData=node.userData||{};
    node.userData.gradeOptimizerMetadata=metadata;
  }
  if(owner.sourceType==='imported'){
    owner.meta.modelDirty=true;
    persistImportedEditorAsset(owner).catch(error=>console.warn('Не удалось сохранить метаданные узла:',error));
  }
  renderEditorTree(getAllEditorAssets(),editorSelectionKey());
  setEditorStatus('Метаданные сохранены для узла: '+editorObjectPath(owner,node)+'.');
}


function applyEditorTransform(){
  const asset=editorSelectedAsset,root=editorSelectedNode;
  if(!root)return;
  const number=(id,fallback=0)=>{const value=Number(document.getElementById(id).value);return Number.isFinite(value)?value:fallback;};
  root.position.set(number('editorPosX'),number('editorPosY'),number('editorPosZ'));
  root.rotation.set(
    THREE.MathUtils.degToRad(number('editorRotX')),
    THREE.MathUtils.degToRad(number('editorRotY')),
    THREE.MathUtils.degToRad(number('editorRotZ'))
  );
  root.scale.set(
    Math.max(0.001,number('editorScaleX',1)),
    Math.max(0.001,number('editorScaleY',1)),
    Math.max(0.001,number('editorScaleZ',1))
  );
  if(asset&&root===asset.root)syncActiveTerrainTransform(asset,false);
  if(asset&&asset.sourceType==='imported')asset.meta.modelDirty=true;
}
async function importGlbFiles(files){
  const valid=Array.from(files||[]);
  if(!valid.length)return;
  const categoryInput=document.getElementById('importAssetCategory');
  const category=categoryInput?.value||'model';
  for(const file of valid){
    const extension=file.name.split('.').pop().toLowerCase();
    if(!['glb','fbx'].includes(extension)){
      setEditorStatus('Поддерживаются бинарные GLB и FBX. Для FBX включи Embed Media при экспорте из Maya.',true);
      continue;
    }
    setEditorStatus('Импорт модели: '+file.name+' …');
    try{
      const buffer=await file.arrayBuffer();
      const gltf=await parseSceneModel(buffer,file.name);
      const root=gltf.scene||gltf.scenes?.[0];
      if(!root)throw new Error('В GLB не найдена сцена.');
      captureEditorNodeVisibilityDefaults(root);
      let meshCount=0;
      root.traverse(object=>{
        if(object.isMesh){
          meshCount++;
          object.castShadow=true;
          object.receiveShadow=true;
        }
      });
      if(!meshCount)throw new Error('GLB не содержит полигональной геометрии.');
      const baseId=slugAssetName(file.name);
      const id=baseId+'_'+Date.now().toString(36)+'_'+(state.importedAssets.length+1);
      root.name=file.name.replace(/\.(glb|fbx)$/i,'');
      root.userData.resortAssetId=id;
      const meta={
        id,name:root.name,category,phase:'stage_1',visible:true,
        collision:category==='terrain',
        forestBlocker:['terrain','slope','infrastructure','building','lift'].includes(category),
        activeTerrain:false,modelDirty:true,sourceFile:file.name
      };
      root.userData.resortAsset={...meta};
      const asset={
        id,name:root.name,root,meta,sourceType:'imported',sourceBuffer:buffer.slice(0),
        sourcePath:currentClientSlug?'models/'+id+'.'+extension:null
      };
      scene.add(root);
      state.importedAssets.push(asset);
      if(category==='slope')applyImportedSlopeDepthBias(root,-1,-1);
      if(category==='terrain')activateImportedTerrain(asset,{rebuildForest:true,refreshList:false,persist:!currentClientSlug});
      refreshEditorAssetList(id);
      focusSceneObject(root);
      let persistenceNote='Черновик в сцене. Нажми PUBLISH CLIENT SCENE, чтобы передать его на сайт клиента.';
      if(!currentClientSlug){
        try{await saveSceneAssetLocally(asset);persistenceNote='Сохранено в этом браузере.';}
        catch(storageError){console.warn('Модель загружена, но локальное сохранение не удалось:',storageError);persistenceNote='Не удалось сохранить после перезагрузки.';}
      }
      setEditorStatus(
        'Импортировано: '+file.name+' · '+meshCount+' mesh · '+editorMaterialTargets.length+
        ' material slot(s). '+persistenceNote
      );
    }catch(error){
      console.error(error);
      setEditorStatus('Не удалось импортировать '+file.name+': '+(error?.message||String(error)),true);
    }
  }
  glbFileInput.value='';
}

function normalizeClientId(value){
  const slug=String(value||'').trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)?slug:'';
}
function setClientWorkspaceStatus(message,isError=false){
  const el=document.getElementById('clientWorkspaceStatus');
  if(el){el.textContent=message;el.classList.toggle('error',isError);}
}
function clearImportedClientAssets(){
  if(state.activeTerrainAssetId)resetImportedTerrain({rebuildForest:false,persist:false});
  state.importedAssets.forEach(asset=>{scene.remove(asset.root);disposeObjectTree(asset.root);});
  state.importedAssets=[];
  state.activeTerrainAssetId=null;
  state.terrain=state.baseTerrain;
  state.terrainMats=state.baseTerrainMats.slice();
  if(state.baseTerrain)state.baseTerrain.visible=true;
  droneController.setTerrain(state.terrain);
  clearTestForest();
}
function applyClientAssetTransform(root,transform){
  if(Array.isArray(transform?.position)&&transform.position.length===3)root.position.fromArray(transform.position);
  if(Array.isArray(transform?.rotation)&&transform.rotation.length===3)root.rotation.set(transform.rotation[0],transform.rotation[1],transform.rotation[2]);
  if(Array.isArray(transform?.scale)&&transform.scale.length===3)root.scale.fromArray(transform.scale);
}
function captureEditorNodeVisibilityDefaults(root){
  root?.traverse(node=>{
    if(!editorOriginalVisibility.has(node))editorOriginalVisibility.set(node,!!node.visible);
  });
}
function collectEditorNodeVisibility(root){
  const states=[];
  if(!root)return states;
  captureEditorNodeVisibilityDefaults(root);
  function visit(node,path){
    const defaultVisible=editorOriginalVisibility.has(node)?editorOriginalVisibility.get(node):true;
    if(node.visible!==defaultVisible){
      states.push({path:path.slice(),name:node.name||'',visible:!!node.visible});
    }
    (node.children||[]).forEach((child,index)=>visit(child,path.concat(index)));
  }
  (root.children||[]).forEach((child,index)=>visit(child,[index]));
  return states;
}
function applyEditorNodeVisibility(root,states){
  if(!root)return;
  captureEditorNodeVisibilityDefaults(root);
  root.traverse(node=>{
    if(node===root)return;
    node.visible=editorOriginalVisibility.get(node)!==false;
  });
  (states||[]).forEach(state=>{
    if(!Array.isArray(state.path)||!state.path.length||typeof state.visible!=='boolean')return;
    let node=root;
    for(const index of state.path){
      if(!node?.children||!node.children[index]){node=null;break;}
      node=node.children[index];
    }
    if(node)node.visible=state.visible;
  });
}
function collectEditorNodeMetadata(root){
  const records=[];
  function visit(node,path){
    const metadata=node.userData?.gradeOptimizerMetadata||{};
    const role=String(metadata.role||'').trim();
    const tags=Array.isArray(metadata.tags)
      ?metadata.tags.map(tag=>String(tag).trim()).filter(Boolean)
      :String(metadata.tags||'').split(',').map(tag=>tag.trim()).filter(Boolean);
    const collision=!!metadata.collision;
    const forestBlocker=!!metadata.forestBlocker;
    if(role||tags.length||collision||forestBlocker){
      records.push({
        path:path.slice(),name:node.name||'',type:node.type||'Object3D',
        role,tags,collision,forestBlocker
      });
    }
    (node.children||[]).forEach((child,index)=>visit(child,path.concat(index)));
  }
  if(root)visit(root,[]);
  return records;
}
function findEditorNodeByNamePath(root,namePath){
  if(!root||!Array.isArray(namePath)||!namePath.length)return null;
  const names=namePath.map(name=>String(name));
  if(root.name===names[0])names.shift();
  let candidates=[root];
  for(const name of names){
    candidates=candidates.flatMap(parent=>(parent.children||[]).filter(child=>child.name===name));
    if(!candidates.length)return null;
  }
  return candidates.length===1?candidates[0]:null;
}
function applyEditorNodeMetadata(root,records){
  (records||[]).forEach(record=>{
    let node=null;
    if(Array.isArray(record.path)){
      node=root;
      for(const index of record.path){
        if(!node?.children||!node.children[index]){node=null;break;}
        node=node.children[index];
      }
    }else if(Array.isArray(record.namePath)){
      node=findEditorNodeByNamePath(root,record.namePath);
    }
    if(!node)return;
    node.userData=node.userData||{};
    node.userData.gradeOptimizerMetadata={
      role:String(record.role||''),
      tags:Array.isArray(record.tags)?record.tags.map(tag=>String(tag).trim()).filter(Boolean):[],
      collision:!!record.collision,
      forestBlocker:!!record.forestBlocker
    };
  });
}
function disposeEditorComponent(root){
  const liveMaterials=new Set(),liveTextures=new Set(),liveGeometries=new Set();
  const collectLive=sceneRoot=>sceneRoot?.traverse(object=>{
    if(object.geometry)liveGeometries.add(object.geometry);
    const list=Array.isArray(object.material)?object.material:(object.material?[object.material]:[]);
    list.forEach(material=>{
      if(!material)return;
      liveMaterials.add(material);
      Object.values(material).forEach(value=>{if(value?.isTexture)liveTextures.add(value);});
    });
  });
  collectLive(state.root);
  state.importedAssets.forEach(asset=>collectLive(asset.root));
  const removedMaterials=new Set(),removedTextures=new Set(),removedGeometries=new Set();
  root?.traverse(object=>{
    if(object.geometry&&!liveGeometries.has(object.geometry))removedGeometries.add(object.geometry);
    const list=Array.isArray(object.material)?object.material:(object.material?[object.material]:[]);
    list.forEach(material=>{
      if(!material||liveMaterials.has(material)||removedMaterials.has(material))return;
      removedMaterials.add(material);
      Object.values(material).forEach(value=>{if(value?.isTexture&&!liveTextures.has(value))removedTextures.add(value);});
    });
  });
  removedTextures.forEach(texture=>texture.dispose());
  removedMaterials.forEach(material=>material.dispose());
  removedGeometries.forEach(geometry=>geometry.dispose());
}
async function openClientWorkspace(value,{updateUrl=true}={}){
  const slug=normalizeClientId(value);
  if(!slug){setClientWorkspaceStatus('Client ID: латиница, цифры и дефис; 1–40 символов.',true);return false;}
  currentClientSlug=slug;
  clientWorkspaceReady=false;
  const input=document.getElementById('clientWorkspaceId');
  if(input)input.value=slug;
  setClientWorkspaceStatus('Загружаю общую сцену клиента '+slug+' …');
  clearImportedClientAssets();
  try{
    const response=await fetch('./clients/'+slug+'/scene.json?t='+Date.now(),{cache:'no-store'});
    if(response.status===404){
      clientWorkspaceReady=true;
      if(updateUrl)window.history.replaceState({},'','?client='+encodeURIComponent(slug));
      refreshEditorAssetList();
      updateTerrainResetControl();
      if(state.terrain)buildTestForest();
      setClientWorkspaceStatus('Новая сцена клиента '+slug+'. Добавь модели и нажми PUBLISH CLIENT SCENE.');
      return true;
    }
    if(!response.ok)throw new Error('HTTP '+response.status+' при загрузке scene.json');
    const manifest=await response.json();
    if(manifest.schemaVersion!=='1.0'||manifest.clientId!==slug||!Array.isArray(manifest.assets)){
      throw new Error('Неверный формат clients/'+slug+'/scene.json');
    }
    let activeTerrain=null,loaded=0;
    for(const item of manifest.assets){
      if(typeof item.file!=='string'||!/^models\/[A-Za-z0-9_.-]+\.(glb|fbx)$/i.test(item.file)){
        console.warn('Пропущен файл модели с некорректным путём:',item.file);continue;
      }
      const response=await fetch('./clients/'+slug+'/'+item.file+'?t='+Date.now(),{cache:'no-store'});
      if(!response.ok)throw new Error('Не удалось загрузить модель '+item.name+' ('+response.status+').');
      const buffer=await response.arrayBuffer();
      const gltf=await parseSceneModel(buffer,item.file,'./clients/'+slug+'/models/');
      const root=gltf.scene||gltf.scenes?.[0];
      if(!root)throw new Error('Модель без сцены: '+item.name);
      captureEditorNodeVisibilityDefaults(root);
      root.name=item.name||root.name||'Client model';
      applyClientAssetTransform(root,item.transform||{});
      applyEditorNodeVisibility(root,item.nodeVisibility||[]);
      applyEditorNodeMetadata(root,item.nodeMetadata||[]);
      const meta={
        id:item.id,name:root.name,category:item.category||'prop',phase:item.phase||'always',
        visible:item.visible!==false,collision:!!item.collision,forestBlocker:!!item.forestBlocker,
        activeTerrain:!!item.activeTerrain,modelDirty:false,sourceFile:item.sourceFile||item.file
      };
      root.visible=meta.visible;
      root.userData.resortAssetId=item.id;
      root.userData.resortAsset={...meta};
      root.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}});
      scene.add(root);
      const asset={id:item.id,name:root.name,root,meta,sourceType:'imported',sourceBuffer:null,sourcePath:item.file};
      state.importedAssets.push(asset);
      if(meta.category==='slope')applyImportedSlopeDepthBias(root,-1,-1);
      if(meta.category==='terrain'&&meta.activeTerrain)activeTerrain=asset;
      loaded++;
    }
    if(activeTerrain)activateImportedTerrain(activeTerrain,{rebuildForest:false,refreshList:false,persist:false});
    else{
      state.terrain=state.baseTerrain;
      state.terrainMats=state.baseTerrainMats.slice();
      if(state.baseTerrain)state.baseTerrain.visible=true;
      droneController.setTerrain(state.terrain);
    }
    if(Array.isArray(manifest.editorSettings?.assets)&&manifest.editorSettings.assets.length){
      await applySceneEditorConfig(manifest.editorSettings,{quiet:true});
    }
    clearTestForest();
    if(state.terrain)buildTestForest();
    refreshEditorAssetList();
    updateTerrainResetControl();
    clientWorkspaceReady=true;
    if(updateUrl)window.history.replaceState({},'','?client='+encodeURIComponent(slug));
    const focus=activeTerrain?.root||state.importedAssets[0]?.root||state.root;
    if(focus)focusSceneObject(focus);
    setClientWorkspaceStatus('Сцена '+slug+' загружена: '+loaded+' моделей. Изменения публикуются отдельно.');
    return true;
  }catch(error){
    console.error(error);
    clientWorkspaceReady=false;
    setClientWorkspaceStatus('Ошибка сцены '+slug+': '+(error?.message||String(error)),true);
    return false;
  }
}
async function githubPublisherRequest(path,options={}){
  if(!githubAdminToken)throw new Error('Сначала подключи GitHub publisher.');
  const response=await fetch('https://api.github.com/repos/'+CLIENT_REPO_OWNER+'/'+CLIENT_REPO_NAME+path,{
    ...options,
    headers:{
      Accept:'application/vnd.github+json',
      Authorization:'Bearer '+githubAdminToken,
      'X-GitHub-Api-Version':'2022-11-28',
      'Content-Type':'application/json',
      ...(options.headers||{})
    }
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.message||('GitHub API HTTP '+response.status));
  return payload;
}
function arrayBufferBase64(buffer){
  const bytes=new Uint8Array(buffer);
  let binary='';
  const chunkSize=0x8000;
  for(let offset=0;offset<bytes.length;offset+=chunkSize){
    binary+=String.fromCharCode(...bytes.subarray(offset,Math.min(offset+chunkSize,bytes.length)));
  }
  return btoa(binary);
}
async function editorTextureToDataUrl(texture){
  if(!texture?.userData?.editorOwnedTexture)return null;
  if(texture.userData.editorTextureDataUrl)return texture.userData.editorTextureDataUrl;
  if(texture.userData.editorTextureDataUrlPromise){
    const value=await texture.userData.editorTextureDataUrlPromise;
    if(value){texture.userData.editorTextureDataUrl=value;return value;}
  }
  const image=texture.image;
  const width=image?.naturalWidth||image?.videoWidth||image?.width||0;
  const height=image?.naturalHeight||image?.videoHeight||image?.height||0;
  if(!image||!width||!height)throw new Error('Не удалось сохранить изображение пользовательской текстуры.');
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Canvas недоступен для сохранения пользовательской текстуры.');
  context.drawImage(image,0,0,width,height);
  const dataUrl=canvas.toDataURL('image/png');
  texture.userData.editorTextureDataUrl=dataUrl;
  return dataUrl;
}

async function collectEditorAssetConfig(asset,textureCache=new Map(),materialIds=new Map()){
  const root=asset.root;
  const materials=[];
  for(const target of collectEditorMaterials(asset)){
    const material=target.material;
    const textures={};
    for(const property of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap']){
      const texture=material[property];
      if(!texture?.userData?.editorOwnedTexture)continue;
      const key=texture.uuid||property;
      if(!textureCache.has(key))textureCache.set(key,await editorTextureToDataUrl(texture));
      textures[property]=textureCache.get(key);
    }
    if(!materialIds.has(material))materialIds.set(material,'scene-material-'+(materialIds.size+1));
    materials.push({
      materialId:materialIds.get(material),
      nodeName:target.mesh.name||target.mesh.type,
      materialName:material.name||'',
      baseColor:material.color?.getHexString?('#'+material.color.getHexString()):null,
      roughness:material.roughness??null,metalness:material.metalness??null,
      normalScale:material.normalScale?.x??null,aoMapIntensity:material.aoMapIntensity??null,
      emissive:material.emissive?.getHexString?('#'+material.emissive.getHexString()):null,
      emissiveIntensity:material.emissiveIntensity??null,opacity:material.opacity??1,
      textureRepeat:material.map?.repeat?.x??1,transparent:!!material.transparent,
      maps:{
        baseColor:!!material.map,normal:!!material.normalMap,roughness:!!material.roughnessMap,
        metalness:!!material.metalnessMap,ao:!!material.aoMap,emissive:!!material.emissiveMap
      },
      textures,
      doubleSided:material.side===THREE.DoubleSide,wireframe:!!material.wireframe
    });
  }
  return {
    id:asset.id,name:asset.name,sourceFile:asset.meta.sourceFile||null,sourceType:asset.sourceType,
    category:asset.meta.category,phase:asset.meta.phase,visible:root.visible,
    collision:!!asset.meta.collision,forestBlocker:!!asset.meta.forestBlocker,
    transform:{position:root.position.toArray(),rotation:[root.rotation.x,root.rotation.y,root.rotation.z],scale:root.scale.toArray()},
    nodeVisibility:collectEditorNodeVisibility(root),
    nodeMetadata:collectEditorNodeMetadata(root),
    materials
  };
}

async function collectProjectEditorSettings(){
  const textureCache=new Map(),materialIds=new Map();
  const assets=[];
  for(const asset of getAllEditorAssets().filter(item=>item.sourceType==='scene')){
    assets.push(await collectEditorAssetConfig(asset,textureCache,materialIds));
  }
  return {schemaVersion:'1.0',savedAt:new Date().toISOString(),units:'meters',assets};
}

async function collectClientManifest(slug){
  const assets=state.importedAssets.map(asset=>{
    if(!asset.sourcePath){
      if(!asset.sourceBuffer)throw new Error('У модели '+asset.name+' нет исходного GLB-файла для публикации.');
      asset.sourcePath='models/'+asset.id+'.glb';
    }
    if(!/^models\/[A-Za-z0-9_.-]+\.(glb|fbx)$/i.test(asset.sourcePath))throw new Error('Некорректный путь модели у '+asset.name);
    const root=asset.root;
    return {
      id:asset.id,name:asset.name,file:asset.sourcePath,
      category:asset.meta.category||'prop',phase:asset.meta.phase||'always',
      visible:root.visible,collision:!!asset.meta.collision,forestBlocker:!!asset.meta.forestBlocker,
      activeTerrain:asset.id===state.activeTerrainAssetId,
      transform:{position:root.position.toArray(),rotation:[root.rotation.x,root.rotation.y,root.rotation.z],scale:root.scale.toArray()},
      nodeVisibility:collectEditorNodeVisibility(root),
      nodeMetadata:collectEditorNodeMetadata(root)
    };
  });
  const editorSettings=await collectProjectEditorSettings();
  return {schemaVersion:'1.0',clientId:slug,updatedAt:new Date().toISOString(),assets,editorSettings};
}

async function exportAssetForClientPublish(asset){
  const exportRoot=asset.root.clone(true);
  exportRoot.position.set(0,0,0);
  exportRoot.rotation.set(0,0,0);
  exportRoot.scale.set(1,1,1);
  exportRoot.updateMatrixWorld(true);
  const exporter=new GLTFExporter();
  const result=await new Promise((resolve,reject)=>{
    exporter.parse(exportRoot,resolve,reject,{binary:true,trs:true,onlyVisible:false});
  });
  if(!(result instanceof ArrayBuffer))throw new Error('GLTFExporter не вернул бинарный GLB для '+asset.name);
  return result;
}
async function publishClientWorkspace(){
  const slug=normalizeClientId(currentClientSlug||document.getElementById('clientWorkspaceId').value);
  if(!slug){setClientWorkspaceStatus('Сначала укажи и открой Client ID.',true);return;}
  if(!clientWorkspaceReady){setClientWorkspaceStatus('Сначала загрузи рабочую сцену клиента.',true);return;}
  if(!githubAdminToken){setClientWorkspaceStatus('Сначала подключи GitHub publisher. Токен не сохраняется в браузере.',true);return;}
  const button=document.getElementById('publishClientWorkspaceButton');
  button.disabled=true;
  try{
    const manifest=await collectClientManifest(slug);
    if(!manifest.assets.length&&!manifest.editorSettings?.assets?.length)throw new Error('В проекте пока нет настроек или моделей для публикации.');
    setClientWorkspaceStatus('Публикую '+manifest.assets.length+' моделей в GitHub …');
    const ref=await githubPublisherRequest('/git/ref/heads/main');
    const parentSha=ref.object?.sha;
    if(!parentSha)throw new Error('Не удалось получить текущий main branch.');
    const parent=await githubPublisherRequest('/git/commits/'+parentSha);
    const treeEntries=[];
    for(const asset of state.importedAssets){
      if(!asset.meta.modelDirty)continue;
      const buffer=await exportAssetForClientPublish(asset);
      if(buffer.byteLength>90*1024*1024)throw new Error(asset.name+' превышает лимит 90 MiB. Для очень больших моделей понадобится объектное хранилище.');
      if(/\.fbx$/i.test(asset.sourcePath||'')){
        asset.sourcePath='models/'+asset.id+'.glb';
        const manifestAsset=manifest.assets.find(item=>item.id===asset.id);
        if(manifestAsset)manifestAsset.file=asset.sourcePath;
      }
      const path='clients/'+slug+'/'+asset.sourcePath;
      setClientWorkspaceStatus('Упаковываю и загружаю '+asset.name+' …');
      const blob=await githubPublisherRequest('/git/blobs',{
        method:'POST',body:JSON.stringify({content:arrayBufferBase64(buffer),encoding:'base64'})
      });
      treeEntries.push({path,mode:'100644',type:'blob',sha:blob.sha});
    }
    const manifestBlob=await githubPublisherRequest('/git/blobs',{
      method:'POST',body:JSON.stringify({content:JSON.stringify(manifest,null,2),encoding:'utf-8'})
    });
    treeEntries.push({path:'clients/'+slug+'/scene.json',mode:'100644',type:'blob',sha:manifestBlob.sha});
    const tree=await githubPublisherRequest('/git/trees',{
      method:'POST',body:JSON.stringify({base_tree:parent.tree.sha,tree:treeEntries})
    });
    const commit=await githubPublisherRequest('/git/commits',{
      method:'POST',body:JSON.stringify({message:'Publish Grade Optimizer client scene: '+slug,tree:tree.sha,parents:[parentSha]})
    });
    await githubPublisherRequest('/git/refs/heads/main',{method:'PATCH',body:JSON.stringify({sha:commit.sha,force:false})});
    state.importedAssets.forEach(asset=>{asset.sourceBuffer=null;asset.meta.modelDirty=false;});
    setClientWorkspaceStatus('Опубликовано для '+slug+'. Commit '+commit.sha.slice(0,8)+'. GitHub Pages обновит клиентскую ссылку после Deploy.');
    setEditorStatus('Сцена клиента '+slug+' опубликована. Клиент получит обновлённые модели после завершения Deploy.');
  }catch(error){
    console.error(error);
    setClientWorkspaceStatus('Публикация не выполнена: '+(error?.message||String(error)),true);
  }finally{button.disabled=false;}
}
async function connectGitHubPublisher(){
  const input=document.getElementById('githubPublisherToken');
  const candidate=input.value.trim();input.value='';
  if(!candidate){setClientWorkspaceStatus('Вставь Fine-grained GitHub token.',true);return;}
  try{
    const response=await fetch('https://api.github.com/user',{headers:{
      Accept:'application/vnd.github+json',Authorization:'Bearer '+candidate,'X-GitHub-Api-Version':'2022-11-28'
    }});
    const user=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(user.message||('GitHub HTTP '+response.status));
    githubAdminToken=candidate;
    setClientWorkspaceStatus('Publisher подключён: '+(user.login||'GitHub account')+'. Токен хранится только в памяти этой вкладки.');
  }catch(error){
    githubAdminToken='';
    setClientWorkspaceStatus('Не удалось подключить publisher: '+(error?.message||String(error)),true);
  }
}
function shareClientWorkspace(){
  const slug=normalizeClientId(currentClientSlug||document.getElementById('clientWorkspaceId').value);
  if(!slug){setClientWorkspaceStatus('Сначала укажи Client ID.',true);return;}
  const url=window.location.origin+window.location.pathname+'?client='+encodeURIComponent(slug);
  const output=document.getElementById('clientShareLink');
  output.value=url;output.select();
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(url).then(
    ()=>setClientWorkspaceStatus('Ссылка клиента скопирована.'),
    ()=>setClientWorkspaceStatus('Ссылка готова — скопируй её из поля ниже.')
  );
  else setClientWorkspaceStatus('Ссылка готова — скопируй её из поля ниже.');
}

async function exportSceneEditorConfig(){
  try{
    const textureCache=new Map(),materialIds=new Map(),assets=[];
    for(const asset of getAllEditorAssets())assets.push(await collectEditorAssetConfig(asset,textureCache,materialIds));
    const payload={schemaVersion:'1.0',savedAt:new Date().toISOString(),units:'meters',assets};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=url;
    anchor.download='resort-scene-config.json';anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    setEditorStatus('Резервная копия настроек экспортирована: resort-scene-config.json');
  }catch(error){
    console.error(error);
    setEditorStatus('Не удалось собрать настройки сцены: '+(error?.message||String(error)),true);
  }
}

const EDITOR_MATERIAL_PRESETS = {
  snow_groomed: {label:'Snow · Groomed',color:'#e9f1f7',roughness:0.96,metalness:0,emissive:'#000000',emissiveIntensity:0,opacity:1,doubleSide:false},
  snow_fresh: {label:'Snow · Fresh',color:'#f8fbff',roughness:0.99,metalness:0,emissive:'#000000',emissiveIntensity:0,opacity:1,doubleSide:false},
  pine_needles: {label:'Pine · Needles',color:'#527b59',roughness:0.94,metalness:0,emissive:'#000000',emissiveIntensity:0,opacity:1,doubleSide:true},
  bark_wood: {label:'Wood · Bark',color:'#76583f',roughness:0.88,metalness:0,emissive:'#000000',emissiveIntensity:0,opacity:1,doubleSide:false},
  concrete: {label:'Concrete',color:'#9b9da0',roughness:0.92,metalness:0,emissive:'#000000',emissiveIntensity:0,opacity:1,doubleSide:false},
  asphalt: {label:'Asphalt',color:'#363b40',roughness:0.9,metalness:0,emissive:'#000000',emissiveIntensity:0,opacity:1,doubleSide:false},
  painted_metal: {label:'Metal · Painted',color:'#aab5bf',roughness:0.42,metalness:0.62,emissive:'#000000',emissiveIntensity:0,opacity:1,doubleSide:false},
  glass: {label:'Glass · Simple',color:'#d8edf5',roughness:0.08,metalness:0,emissive:'#000000',emissiveIntensity:0,opacity:0.32,doubleSide:true}
};

const EDITOR_TEXTURE_MAPS = {
  map:{label:'Base Color',property:'map',colorSpace:THREE.SRGBColorSpace},
  normalMap:{label:'Normal',property:'normalMap',colorSpace:THREE.NoColorSpace},
  roughnessMap:{label:'Roughness',property:'roughnessMap',colorSpace:THREE.NoColorSpace},
  metalnessMap:{label:'Metalness',property:'metalnessMap',colorSpace:THREE.NoColorSpace},
  aoMap:{label:'Ambient Occlusion',property:'aoMap',colorSpace:THREE.NoColorSpace},
  emissiveMap:{label:'Emissive',property:'emissiveMap',colorSpace:THREE.SRGBColorSpace}
};

function applyEditorMaterialPreset(){
  const target=selectedEditorMaterial();
  const preset=EDITOR_MATERIAL_PRESETS[document.getElementById('editorPresetSelect').value];
  if(!target||!preset){setEditorStatus('Сначала выберите материал и пресет.',true);return;}
  document.getElementById('editorBaseColor').value=preset.color;
  document.getElementById('editorEmissiveColor').value=preset.emissive;
  document.getElementById('editorRoughness').value=String(preset.roughness);
  document.getElementById('editorMetalness').value=String(preset.metalness);
  document.getElementById('editorEmissive').value=String(preset.emissiveIntensity);
  document.getElementById('editorOpacity').value=String(preset.opacity);
  document.getElementById('editorDoubleSide').checked=!!preset.doubleSide;
  document.getElementById('editorWireframe').checked=false;
  applyEditorMaterial();
  const affected=markEditorMaterialOwnersDirty(target.material);
  affected.forEach(asset=>persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить материал после применения пресета:',error)));
  setEditorStatus('Применён профиль: '+preset.label+'. Карты текстур сохранены.');
}

function ensureEditorAoUv(mesh){
  const geometry=mesh?.geometry;
  if(geometry?.attributes?.uv&&!geometry.attributes.uv2){
    geometry.setAttribute('uv2',geometry.attributes.uv.clone());
  }
}

function importEditorTextureFile(file){
  const target=selectedEditorMaterial();
  if(!target){setEditorStatus('Сначала выберите mesh / material slot.',true);return;}
  const type=document.getElementById('editorTextureType').value;
  const spec=EDITOR_TEXTURE_MAPS[type];
  if(!spec){setEditorStatus('Неизвестный тип карты текстуры.',true);return;}
  if(!file||!file.type.startsWith('image/')){setEditorStatus('Выберите файл изображения.',true);return;}
  const url=URL.createObjectURL(file);
  const material=target.material;
  setEditorStatus('Загрузка '+spec.label+': '+file.name+' …');
  new THREE.TextureLoader().load(url,texture=>{
    texture.colorSpace=spec.colorSpace;
    texture.flipY=false;
    texture.wrapS=THREE.RepeatWrapping;
    texture.wrapT=THREE.RepeatWrapping;
    const tile=Math.max(0.1,Number(document.getElementById('editorTiling').value)||1);
    texture.repeat.set(tile,tile);
    texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate=true;

    const previous=material[spec.property];
    if(previous?.userData?.editorObjectUrl)URL.revokeObjectURL(previous.userData.editorObjectUrl);
    if(previous?.userData?.editorOwnedTexture)previous.dispose();
    texture.userData.editorOwnedTexture=true;
    texture.userData.editorObjectUrl=url;
    texture.userData.editorTextureDataUrlPromise=new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||""));
      reader.onerror=()=>reject(reader.error||new Error("Не удалось прочитать файл текстуры."));
      reader.readAsDataURL(file);
    });
    material[spec.property]=texture;

    if(spec.property==='aoMap')ensureEditorAoUv(target.mesh);
    if(spec.property==='emissiveMap'&&material.emissive&&material.emissive.getHex()===0){
      material.emissive.set(0xffffff);
      material.emissiveIntensity=Math.max(1,material.emissiveIntensity||0);
    }
    material.needsUpdate=true;
    const affected=markEditorMaterialOwnersDirty(material);
    affected.forEach(asset=>persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить общую текстуру:',error)));
    refreshEditorMaterialLibrary(material.uuid);
    loadEditorMaterial(Number(editorMaterialSelect.value));
    updateEditorMaterialLinkStatus();
    setEditorStatus(spec.label+' подключена к '+(material.name||target.mesh.name||'материалу')+'. Общий материал обновлён во всех связанных слотах.');
  },undefined,error=>{
    URL.revokeObjectURL(url);
    console.error(error);
    setEditorStatus('Не удалось загрузить текстуру: '+(error?.message||String(error)),true);
  });
}

function clearEditorTextureMap(){
  const target=selectedEditorMaterial();
  if(!target){setEditorStatus('Сначала выберите материал.',true);return;}
  const spec=EDITOR_TEXTURE_MAPS[document.getElementById('editorTextureType').value];
  if(!spec)return;
  const material=target.material;
  const texture=material[spec.property];
  if(!texture){setEditorStatus('У выбранного материала нет карты '+spec.label+'.');return;}
  if(texture.userData?.editorObjectUrl)URL.revokeObjectURL(texture.userData.editorObjectUrl);
  if(texture.userData?.editorOwnedTexture)texture.dispose();
  material[spec.property]=null;
  material.needsUpdate=true;
  const affected=markEditorMaterialOwnersDirty(material);
  affected.forEach(asset=>persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить удаление общей текстуры:',error)));
  setEditorStatus('Карта '+spec.label+' удалена во всех слотах, использующих этот материал.');
}

async function loadEditorTextureDataUrl(dataUrl,property,repeat){
  return new Promise((resolve,reject)=>{
    const spec=EDITOR_TEXTURE_MAPS[property];
    const loader=new THREE.TextureLoader();
    loader.load(dataUrl,texture=>{
      texture.colorSpace=spec?.colorSpace||THREE.NoColorSpace;
      texture.flipY=false;
      texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.RepeatWrapping;
      texture.repeat.set(repeat,repeat);
      texture.userData.editorOwnedTexture=true;
      texture.userData.editorTextureDataUrl=dataUrl;
      resolve(texture);
    },undefined,reject);
  });
}

async function applySceneEditorConfig(payload,{quiet=false}={}){
  if(!payload||!Array.isArray(payload.assets))throw new Error('JSON не содержит массива assets.');
  let matchedAssets=0,matchedMaterials=0,skippedAssets=0;
  const sharedEditorMaterials=new Map(),editorMaterialSavedIds=new WeakMap();
  for(const savedAsset of payload.assets){
    const asset=getAllEditorAssets().find(item=>
      item.id===savedAsset.id||
      (savedAsset.sourceType===item.sourceType&&item.name.replace(/^SCENE · /,'')===savedAsset.name.replace(/^SCENE · /,''))||
      (savedAsset.sourceFile&&item.meta.sourceFile===savedAsset.sourceFile&&item.name===savedAsset.name)
    );
    if(!asset){skippedAssets++;continue;}
    matchedAssets++;
    const root=asset.root;
    const tr=savedAsset.transform||{};
    if(Array.isArray(tr.position)&&tr.position.length===3)root.position.fromArray(tr.position);
    if(Array.isArray(tr.rotation)&&tr.rotation.length===3)root.rotation.set(tr.rotation[0],tr.rotation[1],tr.rotation[2]);
    if(Array.isArray(tr.scale)&&tr.scale.length===3)root.scale.fromArray(tr.scale);
    if(savedAsset.visible!==undefined)root.visible=!!savedAsset.visible;
    if(Array.isArray(savedAsset.nodeVisibility))applyEditorNodeVisibility(root,savedAsset.nodeVisibility);

    asset.meta.category=savedAsset.category||asset.meta.category||'prop';
    asset.meta.phase=savedAsset.phase||asset.meta.phase||'stage_1';
    asset.meta.collision=!!savedAsset.collision;
    asset.meta.forestBlocker=!!savedAsset.forestBlocker;
    root.userData.resortAsset={...(root.userData.resortAsset||{}),id:asset.id,name:asset.name,...asset.meta};
    root.traverse(node=>{if(node.userData)delete node.userData.gradeOptimizerMetadata;});
    applyEditorNodeMetadata(root,savedAsset.nodeMetadata||[]);

    const targets=collectEditorMaterials(asset);
    const used=new Set();
    for(const savedMaterial of (savedAsset.materials||[])){
      let index=targets.findIndex((target,i)=>!used.has(i)&&
        target.mesh.name===(savedMaterial.nodeName||'')&&
        target.material.name===(savedMaterial.materialName||''));
      if(index<0)index=targets.findIndex((target,i)=>!used.has(i)&&target.mesh.name===(savedMaterial.nodeName||''));
      if(index<0)continue;
      used.add(index);
      const target=targets[index];
      let material=target.material;
      if(savedMaterial.materialId){
        if(sharedEditorMaterials.has(savedMaterial.materialId)){
          material=sharedEditorMaterials.get(savedMaterial.materialId);
          if(target.material!==material)replaceEditorMaterialTarget(target,material);
        }else{
          if(editorMaterialSavedIds.has(material)&&editorMaterialSavedIds.get(material)!==savedMaterial.materialId){
            const clone=material.clone();
            const textureProperties=['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','bumpMap',
              'displacementMap','alphaMap','lightMap','envMap','specularMap','clearcoatMap','clearcoatNormalMap',
              'clearcoatRoughnessMap','transmissionMap','thicknessMap','sheenColorMap','sheenRoughnessMap',
              'iridescenceMap','iridescenceThicknessMap','anisotropyMap'];
            textureProperties.forEach(property=>{if(material[property]?.isTexture)clone[property]=material[property].clone();});
            material=clone;
            replaceEditorMaterialTarget(target,material);
          }
          sharedEditorMaterials.set(savedMaterial.materialId,material);
          editorMaterialSavedIds.set(material,savedMaterial.materialId);
        }
      }
      if(savedMaterial.baseColor&&material.color)material.color.set(savedMaterial.baseColor);
      if(Number.isFinite(savedMaterial.roughness)&&'roughness' in material)material.roughness=savedMaterial.roughness;
      if(Number.isFinite(savedMaterial.metalness)&&'metalness' in material)material.metalness=savedMaterial.metalness;
      if(Number.isFinite(savedMaterial.normalScale)&&material.normalScale)material.normalScale.set(savedMaterial.normalScale,savedMaterial.normalScale);
      if(Number.isFinite(savedMaterial.aoMapIntensity)&&'aoMapIntensity' in material)material.aoMapIntensity=savedMaterial.aoMapIntensity;
      if(savedMaterial.emissive&&material.emissive)material.emissive.set(savedMaterial.emissive);
      if(Number.isFinite(savedMaterial.emissiveIntensity)&&'emissiveIntensity' in material)material.emissiveIntensity=savedMaterial.emissiveIntensity;
      if(Number.isFinite(savedMaterial.opacity))material.opacity=savedMaterial.opacity;
      material.transparent=!!savedMaterial.transparent;
      material.depthWrite=!material.transparent;
      material.side=savedMaterial.doubleSided?THREE.DoubleSide:THREE.FrontSide;
      material.wireframe=!!savedMaterial.wireframe;
      const repeat=Number.isFinite(savedMaterial.textureRepeat)?savedMaterial.textureRepeat:1;
      const textureProps=['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'];
      for(const property of textureProps){
        const dataUrl=savedMaterial.textures?.[property];
        const mapsKey=property==='map'?'baseColor':property==='normalMap'?'normal':property==='roughnessMap'?'roughness':property==='metalnessMap'?'metalness':property==='aoMap'?'ao':'emissive';
        if(dataUrl){
          const nextTexture=await loadEditorTextureDataUrl(dataUrl,property,repeat);
          const previous=material[property];
          if(previous?.userData?.editorOwnedTexture)previous.dispose();
          material[property]=nextTexture;
        }else if(savedMaterial.maps&&savedMaterial.maps[mapsKey]===false){
          const previous=material[property];
          if(previous?.userData?.editorOwnedTexture)previous.dispose();
          material[property]=null;
        }else if(material[property]){
          material[property].wrapS=THREE.RepeatWrapping;
          material[property].wrapT=THREE.RepeatWrapping;
          material[property].repeat.set(repeat,repeat);
        }
      }
      material.needsUpdate=true;
      matchedMaterials++;
    }
  }
  if(editorSelectedAsset)populateEditorAssetControls(editorSelectedAsset,editorSelectedNode||editorSelectedAsset.root);
  refreshEditorMaterialList(Number(editorMaterialSelect.value)||0);
  if(!quiet)setEditorStatus('Конфигурация загружена: объектов '+matchedAssets+', материалов '+matchedMaterials+', не найдены объекты '+skippedAssets+'.');
  return {matchedAssets,matchedMaterials,skippedAssets};
}

async function loadSceneEditorConfigFile(file){
  if(!file)return;
  if(!state.importedAssets.length){
    setEditorStatus('Сначала импортируйте соответствующие GLB-модели, затем загрузите JSON.',true);
    return;
  }
  try{
    const payload=JSON.parse(await file.text());
    await applySceneEditorConfig(payload);
  }catch(error){
    console.error(error);
    setEditorStatus('Ошибка загрузки конфигурации: '+(error?.message||String(error)),true);
  }
}

async function exportSelectedAssetGlb(){
  if(!editorSelectedAsset||!editorSelectedNode){setEditorStatus('Сначала выбери объект в иерархии.',true);return;}
  setEditorStatus('Экспорт GLB: '+editorNodeLabel(editorSelectedNode)+' …');
  try{
    const exporter=new GLTFExporter();
    const result=await new Promise((resolve,reject)=>{
      exporter.parse(editorSelectedNode,resolve,reject,{binary:true,trs:true,onlyVisible:false});
    });
    if(!(result instanceof ArrayBuffer))throw new Error('Экспортёр не вернул бинарный GLB.');
    const blob=new Blob([result],{type:'model/gltf-binary'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=slugAssetName(editorNodeLabel(editorSelectedNode))+'_edited.glb';
    anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    setEditorStatus('GLB экспортирован: '+anchor.download+'. Материалы и загруженные карты запечены в файл.');
  }catch(error){
    console.error(error);
    setEditorStatus('Не удалось экспортировать GLB: '+(error?.message||String(error)),true);
  }
}

editorToggleButton.addEventListener('click',()=>{
  const open=!appRoot.classList.contains('editor-open');
  if(open&&state.optimizeMode)setOptimizerOpen(false);
  appRoot.classList.toggle('editor-open',open);
  editorToggleButton.classList.toggle('active',open);
  editorToggleButton.setAttribute('aria-expanded',String(open));
  if(open){
    if(editorSelectionHelper)editorSelectionHelper.visible=true;
    setEditorStatus(getAllEditorAssets().length+' корневых моделей доступны. Раскрывай группы до mesh и material slots.');
  }else if(editorSelectionHelper){editorSelectionHelper.visible=false;}
  resizeSceneAfterModeChange();
});
document.getElementById('closeEditor').addEventListener('click',()=>{
  if(editorSelectionHelper)editorSelectionHelper.visible=false;
  appRoot.classList.remove('editor-open');
  editorToggleButton.classList.remove('active');
  editorToggleButton.setAttribute('aria-expanded','false');
});
document.getElementById('importGlbButton').addEventListener('click',()=>glbFileInput.click());
document.getElementById('openClientWorkspaceButton').addEventListener('click',()=>{
  openClientWorkspace(document.getElementById('clientWorkspaceId').value);
});
document.getElementById('connectGitHubPublisherButton').addEventListener('click',connectGitHubPublisher);
document.getElementById('publishClientWorkspaceButton').addEventListener('click',publishClientWorkspace);
document.getElementById('shareClientWorkspaceButton').addEventListener('click',shareClientWorkspace);

glbFileInput.addEventListener('change',event=>importGlbFiles(event.target.files));

[editorPanel,sceneHierarchyPanel].forEach(dropTarget=>{
  dropTarget.addEventListener('dragover',event=>{
    const hasFiles=Array.from(event.dataTransfer?.items||[]).some(item=>item.kind==='file');
    if(!hasFiles)return;
    event.preventDefault();dropTarget.classList.add('drag-over');
  });
  dropTarget.addEventListener('dragleave',event=>{
    if(!dropTarget.contains(event.relatedTarget))dropTarget.classList.remove('drag-over');
  });
  dropTarget.addEventListener('drop',event=>{
    event.preventDefault();dropTarget.classList.remove('drag-over');
    const files=Array.from(event.dataTransfer?.files||[]);
    const modelFiles=files.filter(file=>/\.(glb|fbx)$/i.test(file.name));
    if(modelFiles.length)importGlbFiles(modelFiles);
    else if(files.length)setEditorStatus('Перетащите сюда бинарную модель .glb или .fbx. Тип модели задаётся в списке SCENE.',true);
  });
});

editorObjectSelect.addEventListener('change',event=>selectEditorAsset(event.target.value));
document.getElementById('editorTreeExpandAll').addEventListener('click',()=>expandEditorTree(true));
document.getElementById('editorTreeCollapseAll').addEventListener('click',()=>expandEditorTree(false));
editorTreeSearch.addEventListener('input',()=>renderEditorTree(getAllEditorAssets(),editorSelectionKey()));
editorMaterialSelect.addEventListener('change',event=>{
  loadEditorMaterial(event.target.value);
  const target=editorMaterialTargets[Number(event.target.value)];
  if(editorSelectedAsset&&target){
    editorSelectedMaterialKey=editorMaterialKey(editorSelectedAsset,target.mesh,target.index);
    renderEditorTree(getAllEditorAssets(),editorSelectionKey());
  }
  updateEditorMaterialLinkStatus();
  updateEditorMaterialLibraryControls();
});
document.getElementById('editorMaterialLibrarySelect').addEventListener('change',updateEditorMaterialLibraryControls);
document.getElementById('assignEditorMaterial').addEventListener('click',assignEditorLibraryMaterial);
document.getElementById('makeEditorMaterialUnique').addEventListener('click',makeEditorMaterialUnique);

['editorPosX','editorPosY','editorPosZ','editorRotX','editorRotY','editorRotZ','editorScaleX','editorScaleY','editorScaleZ'].forEach(id=>{
  const field=document.getElementById(id);
  field.addEventListener('input',applyEditorTransform);
  field.addEventListener('change',()=>{
    if(editorSelectedAsset&&editorSelectedNode===editorSelectedAsset.root)syncActiveTerrainTransform(editorSelectedAsset,true);
    persistImportedEditorAsset(editorSelectedAsset).catch(error=>console.warn('Не удалось сохранить трансформацию модели:',error));
  });
});
document.getElementById('focusSelectedAsset').addEventListener('click',()=>{
  if(editorSelectedNode)focusSceneObject(editorSelectedNode);
});
document.getElementById('activateSelectedTerrain').addEventListener('click',()=>{
  if(editorSelectedAsset?.sourceType==='imported'&&editorSelectedNode===editorSelectedAsset.root){
    activateImportedTerrain(editorSelectedAsset);
    focusSceneObject(editorSelectedNode);
    setEditorStatus('Модель назначена активным рельефом. Лыжник, дрон и лес теперь используют её геометрию.');
  }
});
document.getElementById('resetTerrainButton').addEventListener('click',()=>resetImportedTerrain());
document.getElementById('editorCategory').addEventListener('change',event=>{
  const asset=editorSelectedAsset;
  if(!asset||editorSelectedNode!==asset.root)return;
  const next=event.target.value;
  asset.meta.category=next;
  asset.root.userData.resortAsset.category=next;
  if(asset.sourceType==='imported'){
    if(next==='terrain')activateImportedTerrain(asset);
    else if(asset.id===state.activeTerrainAssetId){
      resetImportedTerrain();
      asset.root.visible=true;
      asset.meta.visible=true;
    }
    persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить категорию модели:',error));
  }
});
document.getElementById('editorPhase').addEventListener('change',event=>{
  if(editorSelectedAsset&&editorSelectedNode===editorSelectedAsset.root){
    editorSelectedAsset.meta.phase=event.target.value;
    editorSelectedAsset.root.userData.resortAsset.phase=event.target.value;
    persistImportedEditorAsset(editorSelectedAsset).catch(error=>console.warn('Не удалось сохранить очередь объекта:',error));
  }
});
document.getElementById('editorVisible').addEventListener('change',event=>{
  if(editorSelectedAsset&&editorSelectedNode){
    editorSelectedNode.visible=event.target.checked;
    if(editorSelectedNode===editorSelectedAsset.root){
      editorSelectedAsset.meta.visible=event.target.checked;
      if(editorSelectedAsset.id===state.activeTerrainAssetId)state.terrainVisible=event.target.checked;
    }
    if(editorSelectedAsset.sourceType==='imported')editorSelectedAsset.meta.modelDirty=true;
    persistImportedEditorAsset(editorSelectedAsset).catch(error=>console.warn('Не удалось сохранить видимость модели:',error));
  }
});
document.getElementById('editorCollision').addEventListener('change',event=>{
  if(editorSelectedAsset&&editorSelectedNode===editorSelectedAsset.root){
    editorSelectedAsset.meta.collision=event.target.checked;
    editorSelectedAsset.root.userData.resortAsset.collision=event.target.checked;
    persistImportedEditorAsset(editorSelectedAsset).catch(error=>console.warn('Не удалось сохранить флаг коллизии:',error));
  }
});
document.getElementById('editorForestBlocker').addEventListener('change',event=>{
  if(editorSelectedAsset&&editorSelectedNode===editorSelectedAsset.root){
    editorSelectedAsset.meta.forestBlocker=event.target.checked;
    editorSelectedAsset.root.userData.resortAsset.forestBlocker=event.target.checked;
    persistImportedEditorAsset(editorSelectedAsset).catch(error=>console.warn('Не удалось сохранить блокировку леса:',error));
  }
});
['editorNodeRole','editorNodeTags','editorNodeCollision','editorNodeForestBlocker'].forEach(id=>{
  document.getElementById(id).addEventListener('change',saveSelectedNodeMetadata);
});
['editorBaseColor','editorEmissiveColor','editorRoughness','editorMetalness','editorNormalScale','editorAo',
 'editorEmissive','editorTiling','editorOpacity','editorDoubleSide','editorWireframe'].forEach(id=>{
  document.getElementById(id).addEventListener('input',applyEditorMaterial);
  document.getElementById(id).addEventListener('change',()=>{
    const target=selectedEditorMaterial();
    applyEditorMaterial();
    const affected=target?markEditorMaterialOwnersDirty(target.material):[];
    if(!affected.length&&editorSelectedAsset?.sourceType==='imported')affected.push(editorSelectedAsset);
    [...new Set(affected)].forEach(asset=>persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить материал:',error)));
  });
});
document.getElementById('removeImportedAsset').addEventListener('click',()=>{
  if(!editorSelectedAsset||!editorSelectedNode)return;
  const owner=editorSelectedAsset,node=editorSelectedNode;
  if(owner.sourceType==='scene'&&node===owner.root)return;
  if(node!==owner.root){
    if(node.parent)node.parent.remove(node);
    disposeEditorComponent(node);
    owner.meta.modelDirty=true;
    persistImportedEditorAsset(owner).catch(error=>console.warn('Не удалось сохранить удаление компонента:',error));
    refreshEditorAssetList(owner.id);
    setEditorStatus('Удалён компонент: '+editorNodeLabel(node));
    return;
  }
  if(owner.sourceType==='scene')return;
  if(owner.id===state.activeTerrainAssetId)resetImportedTerrain({rebuildForest:false});
  scene.remove(owner.root);disposeObjectTree(owner.root);
  state.importedAssets=state.importedAssets.filter(asset=>asset!==owner);
  deleteSceneAssetLocally(owner.id).catch(error=>console.warn('Не удалось удалить модель из локального хранилища:',error));
  refreshEditorAssetList();setEditorStatus('Удалена модель: '+owner.name);
});
document.getElementById('saveSceneConfig').addEventListener('click',exportSceneEditorConfig);
document.getElementById('applyEditorPreset').addEventListener('click',applyEditorMaterialPreset);
document.getElementById('importEditorTexture').addEventListener('click',()=>document.getElementById('editorTextureFileInput').click());
document.getElementById('editorTextureFileInput').addEventListener('change',event=>{
  const file=event.target.files?.[0];if(file)importEditorTextureFile(file);event.target.value='';
});
document.getElementById('clearEditorTexture').addEventListener('click',clearEditorTextureMap);
document.getElementById('exportSelectedGlb').addEventListener('click',exportSelectedAssetGlb);
const sceneConfigFileInput=document.getElementById('sceneConfigFileInput');
document.getElementById('loadSceneConfig').addEventListener('click',()=>sceneConfigFileInput.click());
sceneConfigFileInput.addEventListener('change',event=>{
  const file=event.target.files?.[0];if(file)loadSceneEditorConfigFile(file);event.target.value='';
});
const editorPickRaycaster=new THREE.Raycaster();
const editorPickNdc=new THREE.Vector2();
renderer.domElement.addEventListener('click',event=>{
  if(!appRoot.classList.contains('editor-open')||state.mode!=='overview'||event.button!==0)return;
  const rect=renderer.domElement.getBoundingClientRect();
  if(!rect.width||!rect.height)return;
  editorPickNdc.x=((event.clientX-rect.left)/rect.width)*2-1;
  editorPickNdc.y=-((event.clientY-rect.top)/rect.height)*2+1;
  editorPickRaycaster.setFromCamera(editorPickNdc,camera);
  const roots=[state.root,...state.importedAssets.map(asset=>asset.root)].filter(Boolean);
  const hit=editorPickRaycaster.intersectObjects(roots,true).find(entry=>entry.object.isMesh);
  if(!hit){
    setEditorStatus('Объект не найден под курсором. Кликни по видимой поверхности или выбери объект из списка.',true);
    return;
  }
  let picked=null;
  const imported=state.importedAssets.find(asset=>asset.root===hit.object||asset.root.getObjectById(hit.object.id));
  if(imported)picked=getAllEditorAssets().find(asset=>asset.id===imported.id);
  if(!picked){
    let node=hit.object;
    while(node&&node!==state.root&&!node.isMesh)node=node.parent;
    if(node?.isMesh)picked=getAllEditorAssets().find(asset=>asset.sourceType==='scene'&&asset.root===node);
  }
  if(picked){
    editorObjectSelect.value=picked.id;
    if(imported)selectEditorNode(picked,hit.object);
    else selectEditorAsset(picked.id);
  }
});
refreshEditorAssetList();

const skierModeButton = document.getElementById('skierMode');
const modeSwitchIcon=skierModeButton.querySelector('.mode-switch-icon');
const droneModeButton=document.getElementById('droneModeButton');
const speedValueEl = document.getElementById('speedValue');
const slopeValueEl = document.getElementById('slopeValue');
const accelerationValueEl = document.getElementById('accelerationValue');
const snowFrictionInput = document.getElementById('snowFriction');
const snowFrictionValueEl = document.getElementById('snowFrictionValue');
const groundStateEl = document.getElementById('groundState');
const skierViewStatusEl = document.getElementById('skierViewStatus');
const skierLockHintEl = document.getElementById('skierLockHint');
const droneLockHintEl=document.getElementById('droneLockHint'),droneSpeedValueEl=document.getElementById('droneSpeedValue');
let overviewSnapshot = null;
let modeTransition = null;

const skierController = new SkierController({
  camera,
  domElement: renderer.domElement,
  scene,
  onHud: ({speed,slope,grounded,acceleration=0,snowMu=0.045,pushing=false,tuck=false,cameraView='first'}) => {
    appRoot.classList.toggle('tuck-mode',tuck);
    const windIntensity=Math.max(0.18,Math.min(0.92,0.18+speed/48));
    appRoot.style.setProperty('--ski-wind-opacity',String(tuck?windIntensity:0));
    appRoot.style.setProperty('--ski-wind-duration',Math.max(0.34,1.05-speed*0.018)+'s');
    skierViewStatusEl.textContent=cameraView==='third'?'3-Е ЛИЦО':'1-Е ЛИЦО';
    speedValueEl.textContent = String(Math.round(speed*3.6));
    slopeValueEl.textContent = Number(slope).toFixed(1);
    accelerationValueEl.textContent = Number(acceleration).toFixed(2);
    snowFrictionValueEl.textContent = Number(snowMu).toFixed(3);
    groundStateEl.textContent = pushing?'ТОЛЧОК':(grounded?(tuck?'Скоростная стойка':'Обычная езда'):'НЕТ КОНТАКТА');
    groundStateEl.style.color = pushing?'#f3cf79':(grounded?(tuck?'#a8d8ff':'#82d6a6'):'#f3cf79');
  },
  onPointerLock: locked => {
    skierLockHintEl.textContent = locked
      ? 'Мышь захвачена · ESC освобождает курсор'
      : 'Кликни по сцене, чтобы снова захватить мышь';
  }
});
const droneController=new DroneController({
  camera,domElement:renderer.domElement,terrainProvider:()=>state.terrain,
  onPointerLock:locked=>{droneLockHintEl.textContent=locked?'Мышь захвачена · ESC освобождает курсор':'Кликни по сцене, чтобы снова захватить мышь';},
  onHud:({speed})=>{droneSpeedValueEl.textContent=String(Math.round(speed*3.6));}
});

const SKIER_SKI_DB_NAME='grade-optimizer-local-assets';
function openSkierSkiDatabase(){
  if(!window.indexedDB)return Promise.reject(new Error('Локальное хранилище браузера недоступно.'));
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(SKIER_SKI_DB_NAME,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains('models'))db.createObjectStore('models');
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('Не удалось открыть локальное хранилище.'));
  });
}
async function saveSkierSkiLocally(buffer,name){
  const db=await openSkierSkiDatabase();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('models','readwrite');
      tx.objectStore('models').put({buffer:buffer.slice(0),name},'skier-ski');
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error('Не удалось сохранить модель лыжи.'));
      tx.onabort=()=>reject(tx.error||new Error('Сохранение модели лыжи отменено.'));
    });
  }finally{db.close();}
}
async function loadSavedSkierSki(){
  const db=await openSkierSkiDatabase();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('models','readonly');
      const request=tx.objectStore('models').get('skier-ski');
      request.onsuccess=()=>resolve(request.result||null);
      request.onerror=()=>reject(request.error||new Error('Не удалось прочитать сохранённую лыжу.'));
      tx.onabort=()=>reject(tx.error||new Error('Чтение модели лыжи отменено.'));
    });
  }finally{db.close();}
}
async function saveSceneAssetLocally(asset){
  if(!asset?.sourceBuffer)return;
  const db=await openSkierSkiDatabase();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('models','readwrite');
      const record={
        buffer:asset.sourceBuffer.slice(0),
        name:asset.name,
        meta:{...asset.meta},
        sourcePath:asset.sourcePath||null,
        nodeVisibility:collectEditorNodeVisibility(asset.root),
        nodeMetadata:collectEditorNodeMetadata(asset.root),
        visible:asset.root.visible,
        transform:{
          position:asset.root.position.toArray(),
          rotation:[asset.root.rotation.x,asset.root.rotation.y,asset.root.rotation.z],
          scale:asset.root.scale.toArray()
        }
      };
      tx.objectStore('models').put(record,'scene-asset:'+asset.id);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error('Не удалось сохранить GLB-модель.'));
      tx.onabort=()=>reject(tx.error||new Error('Сохранение GLB-модели отменено.'));
    });
  }finally{db.close();}
}
async function persistImportedEditorAsset(asset){
  if(currentClientSlug||!asset||asset.sourceType==='scene'||!asset.sourceBuffer)return;
  if(asset.meta?.modelDirty){
    asset.sourceBuffer=await exportAssetForClientPublish(asset);
    asset.meta.sourceFile=slugAssetName(asset.name)+'.glb';
    asset.meta.modelDirty=false;
  }
  await saveSceneAssetLocally(asset);
}
async function deleteSceneAssetLocally(id){
  const db=await openSkierSkiDatabase();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('models','readwrite');
      tx.objectStore('models').delete('scene-asset:'+id);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error('Не удалось удалить GLB-модель.'));
      tx.onabort=()=>reject(tx.error||new Error('Удаление GLB-модели отменено.'));
    });
  }finally{db.close();}
}
async function restoreSceneAssetsLocally(){
  const db=await openSkierSkiDatabase();
  let records=[];
  try{
    records=await new Promise((resolve,reject)=>{
      const tx=db.transaction('models','readonly');
      const request=tx.objectStore('models').openCursor();
      const found=[];
      request.onsuccess=()=>{
        const cursor=request.result;
        if(!cursor){resolve(found);return;}
        if(String(cursor.key).startsWith('scene-asset:'))found.push({key:String(cursor.key),record:cursor.value});
        cursor.continue();
      };
      request.onerror=()=>reject(request.error||new Error('Не удалось прочитать локальные модели.'));
      tx.onabort=()=>reject(tx.error||new Error('Чтение локальных моделей отменено.'));
    });
  }finally{db.close();}
  let restored=0;
  for(const entry of records){
    const record=entry.record;
    if(!record?.buffer)continue;
    try{
      const buffer=record.buffer.slice(0);
      const model=await parseSceneModel(buffer,record.meta?.sourceFile||'model.glb');
      const root=model.scene||model.scenes?.[0];
      if(!root)throw new Error('Модель не содержит сцены.');
      captureEditorNodeVisibilityDefaults(root);
      const id=entry.key.slice('scene-asset:'.length);
      const meta={...(record.meta||{}),id,name:record.name||root.name||id};
      if(record.transform?.position)root.position.fromArray(record.transform.position);
      if(record.transform?.rotation)root.rotation.set(...record.transform.rotation);
      if(record.transform?.scale)root.scale.fromArray(record.transform.scale);
      root.visible=record.visible!==false;
      applyEditorNodeVisibility(root,record.nodeVisibility||[]);
      applyEditorNodeMetadata(root,record.nodeMetadata||[]);
      root.name=meta.name;
      root.userData.resortAssetId=id;
      root.userData.resortAsset={...meta};
      root.traverse(object=>{
        if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}
      });
      scene.add(root);
      state.importedAssets.push({id,name:meta.name,root,meta,sourceType:'imported',sourceBuffer:buffer,sourcePath:record.sourcePath||null});
      restored++;
    }catch(error){
      console.warn('Не удалось восстановить '+(record.name||entry.key)+':',error);
    }
  }
  refreshEditorAssetList();
  updateTerrainResetControl();
  if(restored)setEditorStatus('Восстановлено из этого браузера: '+restored+' GLB-моделей.');
  return restored;
}
async function removeSavedSkierSki(){
  const db=await openSkierSkiDatabase();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('models','readwrite');
      tx.objectStore('models').delete('skier-ski');
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error('Не удалось удалить сохранённую лыжу.'));
      tx.onabort=()=>reject(tx.error||new Error('Удаление модели лыжи отменено.'));
    });
  }finally{db.close();}
}

const skierSkiFileInput=document.getElementById('skierSkiFileInput');
const importSkierSkiButton=document.getElementById('importSkierSkiButton');
const resetSkierSkiButton=document.getElementById('resetSkierSkiButton');
const skierSkiModelStatus=document.getElementById('skierSkiModelStatus');
importSkierSkiButton.addEventListener('click',()=>skierSkiFileInput.click());
skierSkiFileInput.addEventListener('change',async event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  if(!file.name.toLowerCase().endsWith('.glb')){
    skierSkiModelStatus.textContent='Нужен один бинарный файл GLB.';
    skierSkiModelStatus.classList.add('error');
    skierSkiFileInput.value='';
    return;
  }
  try{
    skierSkiModelStatus.classList.remove('error');
    skierSkiModelStatus.textContent='Загружаю и подгоняю модель лыжи…';
    const buffer=await file.arrayBuffer();
    const gltf=await new Promise((resolve,reject)=>loader.parse(buffer,'',resolve,reject));
    const model=gltf.scene||gltf.scenes?.[0];
    if(!model)throw new Error('В GLB не найдена сцена.');
    let meshCount=0;
    model.traverse(object=>{if(object.isMesh&&object.geometry?.attributes?.position)meshCount++;});
    if(!meshCount)throw new Error('GLB не содержит полигональной модели лыжи.');
    skierController.setSkiModel(model);
    let savedLocally=false;
    try{await saveSkierSkiLocally(buffer,file.name);savedLocally=true;}catch(storageError){console.warn('Лыжа загружена, но локальное сохранение не удалось:',storageError);}
    skierSkiModelStatus.textContent=savedLocally
      ?'Установлена и сохранена в этом браузере пара лыж из '+file.name+'.'
      :'Пара лыж из '+file.name+' установлена, но браузер не смог сохранить её после перезагрузки.';
  }catch(error){
    console.error(error);
    skierSkiModelStatus.textContent='Не удалось заменить лыжи: '+(error?.message||String(error));
    skierSkiModelStatus.classList.add('error');
  }finally{
    skierSkiFileInput.value='';
  }
});
resetSkierSkiButton.addEventListener('click',async()=>{
  skierController.setSkiModel(null);
  try{await removeSavedSkierSki();}catch(error){console.warn('Не удалось удалить локальную модель лыжи:',error);}
  skierSkiModelStatus.textContent='Используются стандартные лыжи.';
  skierSkiModelStatus.classList.remove('error');
});
(async()=>{
  try{
    const saved=await loadSavedSkierSki();
    if(!saved?.buffer)return;
    const gltf=await new Promise((resolve,reject)=>loader.parse(saved.buffer,'',resolve,reject));
    const model=gltf.scene||gltf.scenes?.[0];
    if(!model)throw new Error('В сохранённом GLB не найдена сцена.');
    let meshCount=0;
    model.traverse(object=>{if(object.isMesh&&object.geometry?.attributes?.position)meshCount++;});
    if(!meshCount)throw new Error('Сохранённый GLB не содержит геометрию лыжи.');
    skierController.setSkiModel(model);
    skierSkiModelStatus.textContent='Автоматически восстановлена пара лыж из '+(saved.name||'локального GLB')+'.';
  }catch(error){
    console.warn('Не удалось восстановить пользовательские лыжи:',error);
    skierSkiModelStatus.textContent='Не удалось восстановить сохранённую модель лыжи. Загрузи GLB повторно.';
    skierSkiModelStatus.classList.add('error');
  }
})();

const modeHudElements={
  skier:document.getElementById('skierHud'),
  drone:document.getElementById('droneHud')
};
let modeHudFitFrame=0;
function fitModeHudToViewport(){
  const hud=modeHudElements[state.mode];
  if(!hud||!view.clientHeight||hud.offsetParent===null)return;
  hud.style.transform='none';
  const naturalHeight=hud.offsetHeight;
  if(!naturalHeight)return;
  const compactViewport=window.matchMedia('(max-width:720px)').matches;
  const bottomOffset=compactViewport?8:16;
  const availableHeight=Math.max(1,view.clientHeight-bottomOffset-12);
  const scale=Math.min(1,availableHeight/naturalHeight);
  hud.style.transformOrigin='bottom left';
  hud.style.transform=scale<0.999?'scale('+scale.toFixed(4)+')':'none';
}
function scheduleModeHudFit(){
  if(modeHudFitFrame)cancelAnimationFrame(modeHudFitFrame);
  modeHudFitFrame=requestAnimationFrame(()=>{
    modeHudFitFrame=0;
    fitModeHudToViewport();
  });
}
if(typeof ResizeObserver!=='undefined'){
  const modeHudResizeObserver=new ResizeObserver(scheduleModeHudFit);
  modeHudResizeObserver.observe(view);
  Object.values(modeHudElements).forEach(hud=>modeHudResizeObserver.observe(hud));
}
window.addEventListener('resize',scheduleModeHudFit,{passive:true});
snowFrictionInput.addEventListener('input',e=>{
  skierController.setSnowFriction(parseFloat(e.target.value));
});

function resizeSceneAfterModeChange() {
  scheduleViewportResize();
  requestAnimationFrame(() => {
    scheduleViewportResize();
    scheduleModeHudFit();
  });
}

function captureOverviewSnapshot(){
  if(overviewSnapshot)return;
  overviewSnapshot={
    position:camera.position.clone(),quaternion:camera.quaternion.clone(),target:controls.target.clone(),
    terrainVisible:state.terrain?.visible??true,
    materials:state.terrainMats.map(m=>[m,m.opacity,m.transparent]),
    groups:[state.designGroup,state.labelsGroup,state.terrainLabelsGroup,measureGroup].filter(Boolean).map(g=>[g,g.visible])
  };
}
function restoreOverviewPresentation(){
  if(!overviewSnapshot)return;
  if(state.terrain)state.terrain.visible=overviewSnapshot.terrainVisible;
  (overviewSnapshot.materials||[]).forEach(([m,opacity,transparent])=>{m.opacity=opacity;m.transparent=transparent;});
  (overviewSnapshot.groups||[]).forEach(([group,visible])=>{group.visible=visible;});
}
function applySkierPresentation(){
  captureOverviewSnapshot();
  (overviewSnapshot.groups||[]).forEach(([group])=>{group.visible=false;});
  if(state.terrain)state.terrain.visible=true;
  (overviewSnapshot.materials||[]).forEach(([m])=>{m.opacity=1;m.transparent=false;});
}
function updateModeSwitcher(){
  const isDrone=state.mode==='drone';
  modeSwitchIcon.innerHTML=isDrone?'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10h8l2 4H6l2-4Z"/><path d="M12 10V6M9 6h6M6 8 3 6M18 8l3-2M6 15l-2 2M18 15l2 2"/><circle cx="3" cy="5" r="1.8"/><circle cx="21" cy="5" r="1.8"/><circle cx="4" cy="18" r="1.8"/><circle cx="20" cy="18" r="1.8"/></svg>':'⛷';
  skierModeButton.setAttribute('aria-label',isDrone?'Переключиться на режим лыжника':'Переключиться на режим дрона');
  skierModeButton.title=isDrone?'Переключить на лыжника':'Переключить на дрон';
  skierModeButton.classList.toggle('active',state.mode==='skier');
  droneModeButton.classList.toggle('active',state.mode==='drone');
  overviewModeButton.classList.toggle('active',state.mode==='overview');
}
function setSceneMode(mode){
  if(modeTransition||!['overview','skier','drone'].includes(mode)||mode===state.mode)return;
  const previousMode=state.mode;
  const animateModeTransition=(previousMode==='skier'||previousMode==='drone')&&(mode==='skier'||mode==='drone');
  const transitionFromPose=animateModeTransition?{
    position:camera.position.clone(),quaternion:camera.quaternion.clone(),fov:camera.fov
  }:null;
  const transitionPose=previousMode==='drone'?{position:camera.position.clone(),yaw:camera.rotation.y,pitch:camera.rotation.x}:null;
  if(mode!=='overview'){
    if(appRoot.classList.contains('editor-open')){
      appRoot.classList.remove('editor-open');editorToggleButton.classList.remove('active');
      editorToggleButton.setAttribute('aria-expanded','false');if(editorSelectionHelper)editorSelectionHelper.visible=false;
    }
    appRoot.classList.remove('optimizer-open');optimizerToggleButton.classList.remove('active');state.optimizeMode=false;
    captureOverviewSnapshot();
  }
  if(previousMode==='skier'){
    if(mode==='drone')skierController.showForDrone();
    skierController.stop({keepSceneModel:mode==='drone'});
  }
  if(previousMode==='drone'){
    droneController.stop();
    if(mode==='overview')skierController.hideForOverview();
  }

  if(mode==='skier'){
    if(!state.terrain){
      dbg('ЛЫЖНИК: сначала дождитесь загрузки рельефа.');
      if(previousMode==='drone')droneController.start();
      else if(overviewSnapshot){camera.position.copy(overviewSnapshot.position);camera.quaternion.copy(overviewSnapshot.quaternion);controls.target.copy(overviewSnapshot.target);restoreOverviewPresentation();overviewSnapshot=null;}
      state.mode=previousMode==='drone'?'drone':'overview';controls.enabled=state.mode==='overview';updateModeSwitcher();return;
    }
    applySkierPresentation();
    if(!skierController.start(state.terrain,previousMode==='drone'?transitionPose:null,{deferInput:animateModeTransition})){
      restoreOverviewPresentation();dbg('ЛЫЖНИК: рядом с дроном не удалось найти поверхность склона.');
      if(previousMode==='drone'&&transitionPose){
        camera.position.copy(transitionPose.position);
        camera.rotation.order='YXZ';camera.rotation.set(transitionPose.pitch,transitionPose.yaw,0,'YXZ');
        droneController.start();controls.enabled=false;labelRenderer.domElement.style.display='';
        appRoot.classList.add('drone-mode');appRoot.classList.remove('skier-mode');
        state.mode='drone';updateModeSwitcher();resizeSceneAfterModeChange();return;
      }
      camera.position.copy(overviewSnapshot.position);camera.quaternion.copy(overviewSnapshot.quaternion);controls.target.copy(overviewSnapshot.target);
      overviewSnapshot=null;state.mode='overview';controls.enabled=true;labelRenderer.domElement.style.display='';
      appRoot.classList.remove('skier-mode','drone-mode');updateModeSwitcher();resizeSceneAfterModeChange();return;
    }
    controls.enabled=false;labelRenderer.domElement.style.display='none';
    appRoot.classList.add('skier-mode');appRoot.classList.remove('drone-mode');
  }else if(mode==='drone'){
    if(previousMode==='skier'){
      restoreOverviewPresentation();
      camera.position.y+=3;
    }
    droneController.start({deferInput:animateModeTransition});controls.enabled=false;labelRenderer.domElement.style.display='';
    appRoot.classList.add('drone-mode');appRoot.classList.remove('skier-mode');
  }else{
    if(overviewSnapshot){
      restoreOverviewPresentation();
      camera.position.copy(overviewSnapshot.position);camera.quaternion.copy(overviewSnapshot.quaternion);
      controls.target.copy(overviewSnapshot.target);overviewSnapshot=null;
    }
    controls.enabled=true;labelRenderer.domElement.style.display='';
    appRoot.classList.remove('skier-mode','drone-mode');controls.update();
  }
  state.mode=mode;updateModeSwitcher();resizeSceneAfterModeChange();
  if(animateModeTransition&&transitionFromPose){
    const fromPosition=transitionFromPose.position.clone(),toPosition=camera.position.clone();
    const fromQuaternion=transitionFromPose.quaternion.clone(),toQuaternion=camera.quaternion.clone();
    const horizontalDistance=Math.hypot(toPosition.x-fromPosition.x,toPosition.z-fromPosition.z);
    const arcHeight=THREE.MathUtils.clamp(5.5+horizontalDistance*0.15+Math.abs(toPosition.y-fromPosition.y)*0.035,5.5,38);
    const controlA=fromPosition.clone().lerp(toPosition,0.28);controlA.y+=arcHeight;
    const controlB=fromPosition.clone().lerp(toPosition,0.72);controlB.y+=arcHeight;
    const lateral=new THREE.Vector3(1,0,0).applyQuaternion(fromQuaternion);lateral.y=0;
    if(lateral.lengthSq()<1e-5)lateral.set(1,0,0);else lateral.normalize();
    modeTransition={
      elapsed:0,duration:1.32,targetMode:mode,fromPosition,toPosition,fromQuaternion,toQuaternion,
      controlA,controlB,lateral,lateralArc:Math.min(1.25,0.28+horizontalDistance*0.018),
      baseFov:transitionFromPose.fov
    };
    camera.position.copy(fromPosition);camera.quaternion.copy(fromQuaternion);
    camera.fov=transitionFromPose.fov;camera.updateProjectionMatrix();
  }
}
overviewModeButton.addEventListener('click',()=>{
  if(state.optimizeMode)setOptimizerOpen(false);
  setSceneMode('overview');
});
skierModeButton.addEventListener('click',()=>setSceneMode('skier'));
droneModeButton.addEventListener('click',()=>setSceneMode('drone'));
document.getElementById('exitSkier').addEventListener('click',()=>setSceneMode('overview'));
document.getElementById('exitDrone').addEventListener('click',()=>setSceneMode('overview'));
document.getElementById('skierSwitchDrone').addEventListener('click',()=>setSceneMode('drone'));
document.getElementById('droneSwitchSkier').addEventListener('click',()=>setSceneMode('skier'));

const tutorialPanels={
  skier:{content:document.getElementById('skierTutorialContent'),button:document.getElementById('toggleSkierTutorial')},
  drone:{content:document.getElementById('droneTutorialContent'),button:document.getElementById('toggleDroneTutorial')}
};
function setTutorialVisible(mode,visible){
  const panel=tutorialPanels[mode];
  if(!panel||!panel.content||!panel.button)return;
  panel.content.hidden=!visible;
  panel.content.style.setProperty('display',visible?'grid':'none','important');
  panel.button.setAttribute('aria-expanded',String(visible));
  const label=panel.button.querySelector('.tutorial-toggle-label');
  if(label)label.textContent=visible?'Скрыть':'Показать';
  panel.button.title=(visible?'Скрыть':'Показать')+' туториал · H';
  scheduleModeHudFit();
}
for(const mode of ['skier','drone']){
  const panel=tutorialPanels[mode];
  panel.button.addEventListener('click',()=>setTutorialVisible(mode,panel.content.hidden));
}
document.addEventListener('keydown',e=>{
  if(e.code==='KeyH'&&(state.mode==='skier'||state.mode==='drone')){
    e.preventDefault();e.stopPropagation();
    if(!e.repeat)setTutorialVisible(state.mode,tutorialPanels[state.mode].content.hidden);
    return;
  }
  if(e.code==='KeyV'&&(state.mode==='skier'||state.mode==='drone')){
    e.preventDefault();e.stopPropagation();
    if(!e.repeat)setSceneMode(state.mode==='skier'?'drone':'skier');
    return;
  }
  if(state.mode==='overview')return;
  if(e.code==='KeyQ'||(e.key||'').toLowerCase()==='q'){e.preventDefault();e.stopPropagation();setSceneMode('overview');}
},true);
updateModeSwitcher();

loadSlopeList().then(async first=>{
  if(!currentClientSlug){
    try{await restoreSceneAssetsLocally();}
    catch(error){console.warn('Не удалось восстановить модели из локального хранилища:',error);}
  }else{
    const clientInput=document.getElementById('clientWorkspaceId');
    if(clientInput)clientInput.value=currentClientSlug;
  }
  await loadSlope(first);
  if(currentClientSlug)await openClientWorkspace(currentClientSlug,{updateUrl:false});
});
let previousFrameTime = performance.now();
(function loop(){
  requestAnimationFrame(loop);
  const now = performance.now();
  if(document.hidden){
    previousFrameTime=now;
    if(state.mode==='skier')skierController.keys.clear();
    if(state.mode==='drone')droneController.keys.clear();
    return;
  }
  const dt = Math.min(Math.max((now-previousFrameTime)/1000,0),0.04);
  previousFrameTime = now;
  if(state.autoTime){
    state.dayTime += dt*0.16;
    if(state.dayTime > 22) state.dayTime = 5;
    timeSlider.value = String(state.dayTime);
    timeValue.textContent = formatClock(state.dayTime);
    const compactTimeValue=document.getElementById('timeCompactValue');if(compactTimeValue)compactTimeValue.textContent=formatClock(state.dayTime);
    updateDaylight(state.dayTime);
  }
  if(modeTransition){
    const transition=modeTransition;
    transition.elapsed=Math.min(transition.duration,transition.elapsed+dt);
    const raw=transition.elapsed/transition.duration;
    const eased=raw*raw*(3-2*raw),inv=1-eased;
    camera.position.copy(transition.fromPosition).multiplyScalar(inv*inv*inv)
      .addScaledVector(transition.controlA,3*inv*inv*eased)
      .addScaledVector(transition.controlB,3*inv*eased*eased)
      .addScaledVector(transition.toPosition,eased*eased*eased);
    camera.position.addScaledVector(transition.lateral,Math.sin(Math.PI*eased)*transition.lateralArc);
    const pathGround=terrainY(camera.position.x,camera.position.z);
    if(pathGround!==null)camera.position.y=Math.max(camera.position.y,pathGround+1.55);
    camera.quaternion.copy(transition.fromQuaternion).slerp(transition.toQuaternion,eased);
    camera.fov=transition.baseFov+Math.sin(Math.PI*eased)*4.5;
    camera.updateProjectionMatrix();
    if(raw>=1){
      camera.position.copy(transition.toPosition);camera.quaternion.copy(transition.toQuaternion);
      camera.fov=transition.baseFov;camera.updateProjectionMatrix();modeTransition=null;
      if(transition.targetMode==='skier')skierController.enableInput();
      if(transition.targetMode==='drone')droneController.enableInput();
    }
  }else{
    if(state.mode === 'skier') skierController.update(dt);
    if(state.mode === 'drone') droneController.update(dt);
  }
  if(state.mode === 'overview' && targetDist!==null){
    const dir=new THREE.Vector3().subVectors(camera.position,controls.target);
    const cur=dir.length();
    const nd=THREE.MathUtils.lerp(cur,targetDist,0.15);
    if(Math.abs(nd-targetDist)<0.5)targetDist=null;
    camera.position.copy(controls.target).addScaledVector(dir.normalize(),nd);
  }
  if(controls.enabled) controls.update();
  if(editorSelectionHelper&&editorSelectionHelper.visible)editorSelectionHelper.update();
  skyDome.position.copy(camera.position);
  updateForestBillboards();
  renderer.render(scene,camera);
  if(labelRenderer.domElement.style.display !== 'none') labelRenderer.render(scene,camera);
})();
