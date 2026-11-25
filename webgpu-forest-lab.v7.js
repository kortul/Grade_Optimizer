import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { shareStageOneMaterialsByKind } from './stage-one-materials.v1.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightNode } from 'three/addons/lights/SunLightNode.js';
import { calculateSolarCycle, advanceSolarClock, createSolarDisc, updateSolarDisc } from './solar-cycle.v1.js';
import { createForestAtmosphere } from './webgpu-forest-atmosphere.v1.js';
import {
  float, uniform, vec3, normalWorld, positionLocal, sin, cos, time, dot, max
} from 'three/tsl';

const stage = document.getElementById('stage');
const loading = document.getElementById('loading');
const statusText = document.getElementById('backendStatus');
const statusDot = document.getElementById('statusDot');
const errorBox = document.getElementById('error');
const fpsEl = document.getElementById('fps');
const frameMsEl = document.getElementById('frameMs');
const terrainInfoEl = document.getElementById('terrainInfo');
const ui = {
  time: document.getElementById('timeOfDay'), timeValue: document.getElementById('timeValue'),
  sunIntensity: document.getElementById('sunIntensity'), sunIntensityValue: document.getElementById('sunIntensityValue'),
  dayCycle: document.getElementById('dayCycleToggle'), dayLength: document.getElementById('dayCycleLength'), dayLengthValue: document.getElementById('dayCycleLengthValue'),
  turbidity: document.getElementById('turbidity'), turbidityValue: document.getElementById('turbidityValue'),
  rayleigh: document.getElementById('rayleigh'), rayleighValue: document.getElementById('rayleighValue'),
  cloudCoverage: document.getElementById('cloudCoverage'), cloudCoverageValue: document.getElementById('cloudCoverageValue'),
  cloudDensity: document.getElementById('cloudDensity'), cloudDensityValue: document.getElementById('cloudDensityValue'),
  cloudElevation: document.getElementById('cloudElevation'), cloudElevationValue: document.getElementById('cloudElevationValue'),
  fogStrength: document.getElementById('fogStrength'), fogStrengthValue: document.getElementById('fogStrengthValue'),
  quality: document.getElementById('quality'),
  forestDensity: document.getElementById('forestDensity'), forestDensityValue: document.getElementById('forestDensityValue'),
  wind: document.getElementById('windSpeed'), windValue: document.getElementById('windSpeedValue'),
  leafTranslucency: document.getElementById('leafTranslucency'), leafTranslucencyValue: document.getElementById('leafTranslucencyValue')
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 1000000);
const hemisphere = new THREE.HemisphereLight(0xb6d6f2, 0x27332f, 0.22);
scene.add(hemisphere);
// SunLight uses WebGPU's cascaded shadow implementation; registered in start() below.
const sunLight = new SunLight(0xfff8ef, 1.0);
sunLight.castShadow = true;
scene.add(sunLight);
const moonLight = new THREE.DirectionalLight(0x9eb6dc, 0.16);
moonLight.castShadow = false;
scene.add(moonLight, moonLight.target);
const sunDisc=createSolarDisc(THREE);
scene.add(sunDisc);
const sunDirection = new THREE.Vector3();
const foliageSunDirection = uniform(new THREE.Vector3(0,1,0));
const foliageDaylight = uniform(1);
const foliageBacklight = uniform(0.82);
const foliageWind = uniform(1);
const slopeMarginNoise = new ImprovedNoise();
let renderer, controls, groundLevel = 0, elapsed = 0;
let previousTime = performance.now(), fpsFrames = 0, fpsStart = performance.now(), terrainMeshCount = 0;
let terrainRoot=null, stageOneRoot=null, forestSystem=null, terrainBounds=null, terrainHeightLookup=null;
let snowPbrMaterial=null;
let atmosphere=null,dayCyclePlaying=false;
let solarState=null;

const daylightSunColor = new THREE.Color(0xfff8f1);
const lowSunColor = new THREE.Color(0xffc18e);
const liveSunColor = new THREE.Color();



function formatTime(hours) {
  const total = Math.round((hours % 24) * 60);
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}
function updateSkyLabels() {
  ui.turbidityValue.textContent = Number(ui.turbidity.value).toFixed(1);
  ui.rayleighValue.textContent = Number(ui.rayleigh.value).toFixed(2);
  ui.cloudCoverageValue.textContent = Math.round(Number(ui.cloudCoverage.value) * 100) + '%';
  ui.cloudDensityValue.textContent = Math.round(Number(ui.cloudDensity.value) * 100) + '%';
  ui.cloudElevationValue.textContent = (2.1 + Number(ui.cloudElevation.value) * 1.2).toFixed(1) + ' км';
  ui.sunIntensityValue.textContent = Math.round(Number(ui.sunIntensity.value)*100)+'%';
  ui.dayLengthValue.textContent = Math.round(Number(ui.dayLength.value))+' мин';
  ui.windValue.textContent=Math.round(Number(ui.wind.value))+' м/с';
  ui.leafTranslucencyValue.textContent=Math.round(Number(ui.leafTranslucency.value)*100)+'%';
}
function syncDayCycleButton(){
  ui.dayCycle.textContent=dayCyclePlaying?'Ⅱ Пауза':'▶ Запустить цикл';
  ui.dayCycle.setAttribute('aria-pressed',String(dayCyclePlaying));
}
function advanceDayCycleFrame(deltaSeconds){
  if(!dayCyclePlaying)return;
  ui.time.value=String(advanceSolarClock(Number(ui.time.value),deltaSeconds,ui.dayLength.value));
  updateSky();
}
function updateSky(forceEnvironment=false) {
  const hours = Number(ui.time.value);
  const solar = calculateSolarCycle(THREE,hours);
  solarState=solar;
  sunDirection.copy(solar.sunDirection);
  foliageSunDirection.value.copy(sunDirection).normalize();
  foliageDaylight.value=solar.daylight;
  sunLight.castShadow=solar.daylight>0.035;
  const directPower=THREE.MathUtils.clamp(Number(ui.sunIntensity.value),0,1.5);
  updateSolarDisc(THREE,sunDisc,camera,solar,directPower);
  const warmKey = THREE.MathUtils.clamp(solar.twilight * 0.52, 0, 0.58);
  liveSunColor.copy(daylightSunColor).lerp(lowSunColor,warmKey);
  sunLight.intensity = Math.min(3.8, solar.daylight * (2.4 + solar.daylight * 1.0) * Math.min(directPower, 1.15));
  sunLight.color.copy(liveSunColor);
  moonLight.intensity=solar.nightStrength*0.16;
  sunLight.position.copy(sunDirection).multiplyScalar(1800);
  moonLight.position.copy(controls.target).addScaledVector(sunDirection,-1800);
  moonLight.target.position.copy(controls.target);
  atmosphere?.setAtmosphere({
    solar,
    turbidity:Number(ui.turbidity.value),
    rayleigh:Number(ui.rayleigh.value),
    cloudCoverage:Number(ui.cloudCoverage.value),
    cloudDensity:Number(ui.cloudDensity.value),
    cloudElevation:Number(ui.cloudElevation.value),
    wind:Number(ui.wind.value),
    sunIntensity:directPower
  },forceEnvironment);
  ui.timeValue.textContent = formatTime(hours);
}
function setLoadingMessage(message){
  if(loading)loading.textContent=message;
}
function nextAnimationFrame(){
  return new Promise(resolve=>requestAnimationFrame(()=>resolve()));
}
function updateFogControls() {
  const strength=Number(ui.fogStrength.value);
  atmosphere?.setFog({strength});
  ui.fogStrengthValue.textContent=Math.round(strength*100)+'%';
}
async function buildTerrainHeightLookup(root,bounds,cellSize=40){
  const size=bounds.getSize(new THREE.Vector3());
  const cols=Math.max(1,Math.ceil(size.x/cellSize));
  const rows=Math.max(1,Math.ceil(size.z/cellSize));
  const cells=new Map(),large=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const meshes=[];
  let totalTriangles=0;
  root.traverseVisible(mesh=>{
    if(!mesh.isMesh||!mesh.geometry?.attributes?.position)return;
    meshes.push(mesh);
    const index=mesh.geometry.index,positions=mesh.geometry.attributes.position;
    totalTriangles+=Math.floor((index?index.count:positions.count)/3);
  });
  let processed=0;
  const insert=(ax,ay,az,bx,by,bz,cx,cy,cz)=>{
    const denominator=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
    if(Math.abs(denominator)<1e-10)return;
    const abx=bx-ax,aby=by-ay,abz=bz-az;
    const acx=cx-ax,acy=cy-ay,acz=cz-az;
    let nx=aby*acz-abz*acy;
    let ny=abz*acx-abx*acz;
    let nz=abx*acy-aby*acx;
    if(ny<0){nx=-nx;ny=-ny;nz=-nz;}
    const normalLength=Math.hypot(nx,ny,nz)||1;
    const triangle={ax,ay,az,bx,by,bz,cx,cy,cz,denominator,normalY:ny/normalLength};
    const ix0=Math.max(0,Math.floor((Math.min(ax,bx,cx)-bounds.min.x)/cellSize));
    const ix1=Math.min(cols-1,Math.floor((Math.max(ax,bx,cx)-bounds.min.x)/cellSize));
    const iz0=Math.max(0,Math.floor((Math.min(az,bz,cz)-bounds.min.z)/cellSize));
    const iz1=Math.min(rows-1,Math.floor((Math.max(az,bz,cz)-bounds.min.z)/cellSize));
    if(ix1<ix0||iz1<iz0)return;
    const count=(ix1-ix0+1)*(iz1-iz0+1);
    if(count>256){large.push(triangle);return;}
    for(let iz=iz0;iz<=iz1;iz++)for(let ix=ix0;ix<=ix1;ix++){
      const key=iz*cols+ix;
      let bucket=cells.get(key);
      if(!bucket){bucket=[];cells.set(key,bucket);}
      bucket.push(triangle);
    }
  };
  root.updateWorldMatrix(true,true);
  setLoadingMessage('Строим spatial height lookup для рельефа…');
  for(const mesh of meshes){
    mesh.updateWorldMatrix(true,false);
    const geometry=mesh.geometry,positions=geometry.attributes.position,index=geometry.index;
    const count=index?index.count:positions.count;
    for(let offset=0;offset+2<count;offset+=3){
      const ia=index?index.getX(offset):offset;
      const ib=index?index.getX(offset+1):offset+1;
      const ic=index?index.getX(offset+2):offset+2;
      a.fromBufferAttribute(positions,ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(positions,ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(positions,ic).applyMatrix4(mesh.matrixWorld);
      insert(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);
      processed++;
      if(processed%60000===0){
        setLoadingMessage('Spatial lookup рельефа · '+Math.round(processed/Math.max(1,totalTriangles)*100)+'%');
        await nextAnimationFrame();
      }
    }
  }
  const lookup={originX:bounds.min.x,originZ:bounds.min.z,cellSize,cols,rows,cells,large,triangleCount:processed};
  console.info('[Grade Optimizer WebGPU] Terrain height lookup:',{
    triangles:processed,cells:cells.size,largeTriangles:large.length,cellSize
  });
  return lookup;
}
function sampleTerrainSurface(x,z,lookup){
  if(!lookup)return null;
  const ix=Math.floor((x-lookup.originX)/lookup.cellSize);
  const iz=Math.floor((z-lookup.originZ)/lookup.cellSize);
  if(ix<0||iz<0||ix>=lookup.cols||iz>=lookup.rows)return null;
  const bucket=lookup.cells.get(iz*lookup.cols+ix)||[];
  let best=null;
  const test=triangle=>{
    const t=triangle;
    const wa=((t.bz-t.cz)*(x-t.cx)+(t.cx-t.bx)*(z-t.cz))/t.denominator;
    const wb=((t.cz-t.az)*(x-t.cx)+(t.ax-t.cx)*(z-t.cz))/t.denominator;
    const wc=1-wa-wb;
    if(wa<-1e-5||wb<-1e-5||wc<-1e-5)return;
    const y=wa*t.ay+wb*t.by+wc*t.cy;
    if(!best||y>best.y)best={y,normalY:t.normalY};
  };
  for(const triangle of bucket)test(triangle);
  for(const triangle of lookup.large)test(triangle);
  return best;
}

async function loadFBXTerrain(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error('FBX HTTP ' + response.status + ' при загрузке ' + path);
  const buffer = await response.arrayBuffer();
  const headerBytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 32));
  const header = new TextDecoder().decode(headerBytes);
  const isBinaryFBX = header.startsWith('Kaydara FBX Binary  \0\x1a\0');
  const isAsciiFBX = /^\s*;\s*FBX\s+\d+\.\d+/i.test(header.replace(/^\uFEFF/, ''));
  if (!isBinaryFBX && !isAsciiFBX) {
    const preview = header.replace(/[^\x20-\x7E]/g, '.').slice(0, 32).trim() || 'пустой ответ';
    throw new Error('Сервер вернул не FBX (первые байты: ' + preview + ').');
  }
  const basePath = path.slice(0, path.lastIndexOf('/') + 1);
  return new FBXLoader().parse(buffer, basePath);
}
function createFallbackTerrain(manifest, metersPerUnit) {
  const worldBounds = manifest?.mayaExport?.worldBounds;
  const validBounds = Array.isArray(worldBounds) && worldBounds.length >= 6 && worldBounds.slice(0, 6).every(value => Number.isFinite(Number(value)));
  const minX = validBounds ? Number(worldBounds[0]) * metersPerUnit : -2300;
  const minY = validBounds ? Number(worldBounds[1]) * metersPerUnit : 0;
  const minZ = validBounds ? Number(worldBounds[2]) * metersPerUnit : -2200;
  const maxX = validBounds ? Number(worldBounds[3]) * metersPerUnit : 2300;
  const maxZ = validBounds ? Number(worldBounds[5]) * metersPerUnit : 2200;
  const width = Math.max(100, maxX - minX), depth = Math.max(100, maxZ - minZ);
  const centerX = (minX + maxX) * 0.5, centerZ = (minZ + maxZ) * 0.5;
  const geometry = new THREE.PlaneGeometry(width, depth, 180, 180);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const noise = new ImprovedNoise();
  const colors = [], color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) + centerX, z = positions.getZ(i) + centerZ;
    const broad = noise.noise(x * 0.00085, 0, z * 0.00085);
    const ridge = 1 - Math.abs(noise.noise(x * 0.0022, 2.7, z * 0.0022));
    const detail = noise.noise(x * 0.008, 7.1, z * 0.008);
    const height = 35 + broad * 26 + Math.pow(Math.max(0, ridge), 2.2) * 50 + detail * 4;
    positions.setY(i, height);
    const h = THREE.MathUtils.clamp(height / 145, 0, 1);
    color.setRGB(0.20 + h * 0.22, 0.27 + h * 0.20, 0.19 + h * 0.16);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98, metalness: 0 }));
  mesh.name = 'GO_Forest_FallbackTerrainMesh';
  const group = new THREE.Group();
  group.name = 'GO_Forest_ProceduralTerrainFallback';
  mesh.position.set(centerX, minY, centerZ);
  group.add(mesh);
  return group;
}

let alpineTerrainMaps=null;
function createAlpineTerrainMaps(){
  if(alpineTerrainMaps)return alpineTerrainMaps;
  const size=512;
  const albedoData=new Uint8Array(size*size*4);
  const roughnessData=new Uint8Array(size*size*4);
  const heightData=new Uint8Array(size*size*4);
  const hash=(x,y)=>{
    let n=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263))|0;
    n=Math.imul(n^(n>>>13),1274126177);
    n^=n>>>16;
    return (n>>>0)/4294967295;
  };
  const smooth=t=>t*t*(3-2*t);
  const valueNoise=(u,v,grid)=>{
    const x=u*grid,y=v*grid;
    const x0=Math.floor(x),y0=Math.floor(y);
    const tx=smooth(x-x0),ty=smooth(y-y0);
    const ix=((x0%grid)+grid)%grid,iy=((y0%grid)+grid)%grid;
    const ix1=(ix+1)%grid,iy1=(iy+1)%grid;
    const a=THREE.MathUtils.lerp(hash(ix,iy),hash(ix1,iy),tx);
    const b=THREE.MathUtils.lerp(hash(ix,iy1),hash(ix1,iy1),tx);
    return THREE.MathUtils.lerp(a,b,ty);
  };
  const ramp=(a,b,t)=>THREE.MathUtils.lerp(a,b,THREE.MathUtils.clamp(t,0,1));
  const powder=[232,239,245];
  const compact=[211,224,235];
  const blueIce=[190,207,222];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/size,v=y/size;
    const macro=valueNoise(u,v,5)*0.68+valueNoise(u,v,13)*0.32;
    const structure=valueNoise(u,v,9)*0.58+valueNoise(u,v,29)*0.42;
    const detail=valueNoise(u,v,67);
    const grain=valueNoise(u,v,181);
    const packed=THREE.MathUtils.smoothstep(macro,0.42,0.73);
    const ice=THREE.MathUtils.smoothstep(structure,0.64,0.84)*0.42;
    const fine=(detail-0.5)*5+(grain-0.5)*5;
    const offset=(y*size+x)*4;
    for(let channel=0;channel<3;channel++){
      const snow=ramp(powder[channel],compact[channel],packed);
      const colour=ramp(snow,blueIce[channel],ice)+fine;
      albedoData[offset+channel]=Math.round(THREE.MathUtils.clamp(colour,0,255));
    }
    albedoData[offset+3]=255;
    const rough=Math.round(229+detail*18+grain*8);
    roughnessData[offset]=roughnessData[offset+1]=roughnessData[offset+2]=rough;
    roughnessData[offset+3]=255;
    const height=Math.round(116+detail*52+grain*34);
    heightData[offset]=heightData[offset+1]=heightData[offset+2]=height;
    heightData[offset+3]=255;
  }
  const makeTexture=(data,name,colorSpace)=>{
    const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat,THREE.UnsignedByteType);
    texture.name=name;
    texture.colorSpace=colorSpace;
    texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
    texture.minFilter=THREE.LinearMipmapLinearFilter;
    texture.magFilter=THREE.LinearFilter;
    texture.generateMipmaps=true;
    texture.anisotropy=Math.min(8,renderer?.getMaxAnisotropy?.()||1);
    texture.needsUpdate=true;
    return texture;
  };
  alpineTerrainMaps={
    albedo:makeTexture(albedoData,'GO_AlpineSnow_ProceduralAlbedo',THREE.SRGBColorSpace),
    roughness:makeTexture(roughnessData,'GO_AlpineSnow_Roughness',THREE.NoColorSpace),
    height:makeTexture(heightData,'GO_AlpineSnow_MicroHeight',THREE.NoColorSpace)
  };
  return alpineTerrainMaps;
}

function getSnowPbrMaterial(){
  if(snowPbrMaterial)return snowPbrMaterial;
  const maps=createAlpineTerrainMaps();
  snowPbrMaterial=new THREE.MeshPhysicalMaterial({
    name:'ForestLab_NeutralSnow_PBR',
    color:0xffffff,
    map:maps.albedo,
    roughnessMap:maps.roughness,
    bumpMap:maps.height,
    bumpScale:0.035,
    roughness:0.94,
    metalness:0,
    clearcoat:0,
    specularIntensity:0.20,
    vertexColors:false,
    side:THREE.DoubleSide,
    transparent:false,
    opacity:1,
    depthWrite:true,
    fog:true
  });
  snowPbrMaterial.userData.gradeOptimizerSnowSurface=true;
  return snowPbrMaterial;
}
function ensureWorldTerrainUV(mesh,force=false){
  const geometry=mesh.geometry;
  if(!geometry?.attributes?.position||(!force&&geometry.attributes.uv))return;
  const positions=geometry.attributes.position;
  const uvs=new Float32Array(positions.count*2);
  const point=new THREE.Vector3();
  mesh.updateWorldMatrix(true,false);
  for(let i=0;i<positions.count;i++){
    point.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
    uvs[i*2]=point.x/48;
    uvs[i*2+1]=point.z/48;
  }
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
}
async function loadRealTerrain() {
  setLoadingMessage('Загружаем базовый рельеф…');
  await nextAnimationFrame();
  const response = await fetch('./assets/real-terrain.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Не удалось загрузить real-terrain.json (' + response.status + ')');
  const manifest = await response.json();
  const metersPerUnit = Number(manifest && manifest.mayaExport && manifest.mayaExport.metersPerUnit || 0.01);
  if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0 || metersPerUnit > 1) throw new Error('Некорректный metersPerUnit в real-terrain.json');
  let root, usingFallback = false;
  try {
    root = await loadFBXTerrain('./assets/real-terrain.fbx');
  } catch (error) {
    usingFallback = true;
    root = createFallbackTerrain(manifest, metersPerUnit);
    const reason = error && error.message ? error.message : String(error);
    statusText.textContent = 'Резервный процедурный рельеф · FBX недоступен';
    statusText.title = reason;
    statusDot.classList.add('bad');
    console.warn('[Forest Lab] ' + reason + ' Используется процедурный рельеф.');
  }
  if (!usingFallback) root.scale.multiplyScalar(metersPerUnit);
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || size.x < 10 || size.z < 10) { if (!usingFallback) throw new Error('FBX рельеф не содержит корректную геометрию.'); }
  // This isolated winter look-dev lab intentionally gives all base-terrain meshes one neutral snow PBR.
  const snowMaterial=getSnowPbrMaterial();
  const terrainMaterialReport=[];
  root.updateMatrixWorld(true);
  root.traverse(object => {
    if (!object.isMesh || !object.geometry || !object.geometry.attributes.position) return;
    terrainMeshCount++;
    const original=Array.isArray(object.material)?object.material:[object.material];
    ensureWorldTerrainUV(object,true);
    object.material=Array.isArray(object.material)
      ?object.material.map(()=>snowMaterial)
      :snowMaterial;
    if(!object.geometry.attributes.normal)object.geometry.computeVertexNormals();
    object.castShadow=true;
    object.receiveShadow=true;
    original.forEach(source=>{
      if(source)terrainMaterialReport.push({
        source:source.name||source.type,
        color:source.color?.getHexString?.()||'n/a',
        hadMap:!!source.map
      });
    });
  });
  console.info('[Grade Optimizer Forest Lab] Real terrain PBR materials:',{
    meshCount:terrainMeshCount,
    materials:terrainMaterialReport,
    snowMaterial:true
  });
  if (!terrainMeshCount) throw new Error('В FBX не найдено ни одного polygon mesh.');
  root.name = 'GO_WebGPU_RealTerrain';
  scene.add(root);
  terrainRoot=root;
  terrainBounds=bounds.clone();
  terrainHeightLookup=await buildTerrainHeightLookup(terrainRoot,terrainBounds,40);
  const center = bounds.getCenter(new THREE.Vector3());
  const terrainSize = bounds.getSize(new THREE.Vector3());
  groundLevel = bounds.min.y + 4;
  controls.target.set(center.x, Math.max(bounds.min.y + 28, bounds.max.y * 0.30), center.z);
  camera.position.set(
    center.x + Math.max(2200, terrainSize.x * 0.52),
    center.y + Math.max(1050, terrainSize.y * 2.5 + 400),
    center.z + Math.max(2600, terrainSize.z * 0.68)
  );
  controls.update();
  terrainInfoEl.textContent = terrainMeshCount + ' mesh' + (usingFallback ? ' · procedural' : '');
}
function seededRandom(x, z, salt = 0) {
  let state = (Math.imul(Math.floor(x * 2), 374761393) ^
    Math.imul(Math.floor(z * 2), 668265263) ^ Math.imul(salt + 71, 1274126177) ^ 0x51a1) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSlopeFootprint(root) {
  const triangles = [];
  const edgeMap = new Map();
  const bounds = new THREE.Box3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const keyPoint = p => Math.round(p.x * 4) + ',' + Math.round(p.z * 4);
  const addEdge = (p0, p1) => {
    const k0 = keyPoint(p0), k1 = keyPoint(p1);
    if (k0 === k1) return;
    const key = k0 < k1 ? k0 + '|' + k1 : k1 + '|' + k0;
    const existing = edgeMap.get(key);
    if (existing) existing.count++;
    else edgeMap.set(key, {ax:p0.x,ay:p0.y,az:p0.z,bx:p1.x,by:p1.y,bz:p1.z,count:1});
  };
  root.updateMatrixWorld(true);
  root.traverse(object => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    const position = object.geometry.attributes.position;
    const index = object.geometry.index;
    const triCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
    for (let triIndex = 0; triIndex < triCount; triIndex++) {
      const ia = index ? index.getX(triIndex * 3) : triIndex * 3;
      const ib = index ? index.getX(triIndex * 3 + 1) : triIndex * 3 + 1;
      const ic = index ? index.getX(triIndex * 3 + 2) : triIndex * 3 + 2;
      a.fromBufferAttribute(position, ia).applyMatrix4(object.matrixWorld);
      b.fromBufferAttribute(position, ib).applyMatrix4(object.matrixWorld);
      c.fromBufferAttribute(position, ic).applyMatrix4(object.matrixWorld);
      const area = (b.x-a.x)*(c.z-a.z) - (c.x-a.x)*(b.z-a.z);
      if (Math.abs(area) < 0.035) continue;
      bounds.expandByPoint(a);
      bounds.expandByPoint(b);
      bounds.expandByPoint(c);
      const tri = {
        ax:a.x,az:a.z,bx:b.x,bz:b.z,cx:c.x,cz:c.z,
        minX:Math.min(a.x,b.x,c.x),maxX:Math.max(a.x,b.x,c.x),
        minZ:Math.min(a.z,b.z,c.z),maxZ:Math.max(a.z,b.z,c.z),
        den:(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z)
      };
      triangles.push(tri);
      addEdge(a,b); addEdge(b,c); addEdge(c,a);
    }
  });
  const cellSize = 24;
  const cells = new Map(), large = [];
  for (const tri of triangles) {
    const ix0=Math.floor(tri.minX/cellSize),ix1=Math.floor(tri.maxX/cellSize);
    const iz0=Math.floor(tri.minZ/cellSize),iz1=Math.floor(tri.maxZ/cellSize);
    const cellCount=(ix1-ix0+1)*(iz1-iz0+1);
    if (cellCount > 64) { large.push(tri); continue; }
    for(let iz=iz0;iz<=iz1;iz++) for(let ix=ix0;ix<=ix1;ix++) {
      const key=ix+':'+iz;
      let bucket=cells.get(key);
      if(!bucket){bucket=[];cells.set(key,bucket);}
      bucket.push(tri);
    }
  }
  const contains = (x,z) => {
    const bucket=cells.get(Math.floor(x/cellSize)+':'+Math.floor(z/cellSize))||[];
    const test = tri => {
      if(x<tri.minX-0.01||x>tri.maxX+0.01||z<tri.minZ-0.01||z>tri.maxZ+0.01)return false;
      const wa=((tri.bz-tri.cz)*(x-tri.cx)+(tri.cx-tri.bx)*(z-tri.cz))/tri.den;
      const wb=((tri.cz-tri.az)*(x-tri.cx)+(tri.ax-tri.cx)*(z-tri.cz))/tri.den;
      return wa>=-1e-5&&wb>=-1e-5&&1-wa-wb>=-1e-5;
    };
    for(const tri of bucket)if(test(tri))return true;
    for(const tri of large)if(test(tri))return true;
    return false;
  };
  const edges=[...edgeMap.values()].filter(edge=>edge.count===1);
  if(!edges.length&&!bounds.isEmpty()){
    const y=bounds.min.y;
    edges.push(
      {ax:bounds.min.x,ay:y,az:bounds.min.z,bx:bounds.max.x,by:y,bz:bounds.min.z,count:1},
      {ax:bounds.max.x,ay:y,az:bounds.min.z,bx:bounds.max.x,by:y,bz:bounds.max.z,count:1},
      {ax:bounds.max.x,ay:y,az:bounds.max.z,bx:bounds.min.x,by:y,bz:bounds.max.z,count:1},
      {ax:bounds.min.x,ay:y,az:bounds.max.z,bx:bounds.min.x,by:y,bz:bounds.min.z,count:1}
    );
  }
  const edgeCellSize=120,edgeCells=new Map(),longEdges=[];
  for(const edge of edges){
    const ix0=Math.floor(Math.min(edge.ax,edge.bx)/edgeCellSize),ix1=Math.floor(Math.max(edge.ax,edge.bx)/edgeCellSize);
    const iz0=Math.floor(Math.min(edge.az,edge.bz)/edgeCellSize),iz1=Math.floor(Math.max(edge.az,edge.bz)/edgeCellSize);
    if((ix1-ix0+1)*(iz1-iz0+1)>64){longEdges.push(edge);continue;}
    for(let iz=iz0;iz<=iz1;iz++)for(let ix=ix0;ix<=ix1;ix++){
      const key=ix+':'+iz;let bucket=edgeCells.get(key);if(!bucket){bucket=[];edgeCells.set(key,bucket);}bucket.push(edge);
    }
  }
  return {triangles,edges,contains,bounds,edgeLookup:{cellSize:edgeCellSize,cells:edgeCells,large:longEdges}};
}
function sampleSlopeMarginSurface(x,z,footprint,maxDistance=560){
  const lookup=footprint?.edgeLookup;
  if(!lookup)return null;
  const cellSize=lookup.cellSize,cx=Math.floor(x/cellSize),cz=Math.floor(z/cellSize);
  const radius=Math.ceil(maxDistance/cellSize);
  let best=null,bestDistanceSq=maxDistance*maxDistance;
  const test=edge=>{
    const dx=edge.bx-edge.ax,dz=edge.bz-edge.az;
    const lengthSq=dx*dx+dz*dz;
    const t=lengthSq>1e-8?THREE.MathUtils.clamp(((x-edge.ax)*dx+(z-edge.az)*dz)/lengthSq,0,1):0;
    const px=edge.ax+dx*t,pz=edge.az+dz*t;
    const ex=x-px,ez=z-pz,distanceSq=ex*ex+ez*ez;
    if(distanceSq<bestDistanceSq){bestDistanceSq=distanceSq;best={edge,t,distance:Math.sqrt(distanceSq)};}
  };
  for(let ring=0;ring<=radius;ring++){
    for(let dz=-ring;dz<=ring;dz++)for(let dx=-ring;dx<=ring;dx++){
      if(ring>0&&Math.abs(dx)!==ring&&Math.abs(dz)!==ring)continue;
      const bucket=lookup.cells.get((cx+dx)+':'+(cz+dz));
      if(bucket)for(const edge of bucket)test(edge);
    }
    if(best&&best.distance<=Math.max(0,ring-1)*cellSize)break;
  }
  for(const edge of lookup.large)test(edge);
  if(!best)return null;
  const edgeY=best.edge.ay+(best.edge.by-best.edge.ay)*best.t;
  const relief=Math.min(15,best.distance*0.035);
  const micro=slopeMarginNoise.noise(x*0.00135,4.7,z*0.00135)*2.2+
    slopeMarginNoise.noise(x*0.0042,17.1,z*0.0042)*0.65;
  return {y:edgeY-6-relief+micro,normalY:0.86,distance:best.distance};
}
function createSlopeMarginTerrain(footprint){
  if(!footprint||footprint.bounds.isEmpty())return null;
  const source=footprint.bounds,margin=440;
  const minX=source.min.x-margin,maxX=source.max.x+margin;
  const minZ=source.min.z-margin,maxZ=source.max.z+margin;
  const width=Math.max(100,maxX-minX),depth=Math.max(100,maxZ-minZ);
  const centerX=(minX+maxX)*0.5,centerZ=(minZ+maxZ)*0.5;
  const segmentsX=THREE.MathUtils.clamp(Math.ceil(width/38),64,148);
  const segmentsZ=THREE.MathUtils.clamp(Math.ceil(depth/38),64,148);
  const geometry=new THREE.PlaneGeometry(width,depth,segmentsX,segmentsZ);
  geometry.rotateX(-Math.PI/2);
  const positions=geometry.attributes.position;
  for(let i=0;i<positions.count;i++){
    const x=centerX+positions.getX(i),z=centerZ+positions.getZ(i);
    const sample=sampleSlopeMarginSurface(x,z,footprint,620);
    positions.setY(i,sample?sample.y:source.min.y-34);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const ground=new THREE.Mesh(geometry,getSnowPbrMaterial());
  ground.name='GO_WebGPU_SlopeMargin_SnowTerrain';
  ground.position.set(centerX,0,centerZ);
  ensureWorldTerrainUV(ground,true);
  ground.castShadow=false;
  ground.receiveShadow=true;
  terrainRoot=ground;
  terrainBounds=new THREE.Box3().setFromObject(ground);
  groundLevel=terrainBounds.min.y;
  scene.add(ground);
  return ground;
}

function restoreStageOneCoordinates(root, item) {
  // Normalize the imported Maya ToSketchfab
  // wrapper / child scales before restoring the CAD Bridge world coordinates.
  const sketchfabGroup=root.getObjectByName?.('ToSketchfab');
  if(sketchfabGroup){
    root.traverse(node=>{
      if(node===root)return;
      if(node.scale.toArray().some(value=>Math.abs(value-1)>1e-4))node.scale.set(1,1,1);
    });
    sketchfabGroup.position.set(0,0,0);
    root.updateMatrixWorld(true);
  }
  const groups=item?.mayaExport?.cadBridge?.workingGroups||[];
  const record=groups.find(entry=>Array.isArray(entry.originalOffset)&&Number.isFinite(Number(entry.originalScale)));
  if(item?.mayaExport?.cadBridge?.inverseApplied) {
    if(!record)throw new Error('Stage 1: CAD Bridge metadata не содержит originalOffset / originalScale.');
    const offset=record.originalOffset.map(Number);
    const scale=Number(record.originalScale);
    const geometries=new Set();
    root.traverse(object=>{
      if(!object.isMesh||!object.geometry||geometries.has(object.geometry))return;
      geometries.add(object.geometry);
      const geometry=object.geometry;
      const position=geometry.attributes?.position;
      if(!position)return;
      for(let i=0;i<position.count;i++){
        const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
        position.setXYZ(i,(x-offset[0])*scale,(y-offset[1])*scale,(z-offset[2])*scale);
      }
      position.needsUpdate=true;
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    });
  }
  const transform=item.transform||{};
  const p=transform.position||[0,0,0],r=transform.rotation||[0,0,0],s=transform.scale||[1,1,1];
  root.position.fromArray(p);
  root.rotation.set(r[0],r[1],r[2]);
  root.scale.fromArray(s);
  root.updateMatrixWorld(true);
}

function buildTreePlacements(footprint, density) {
  if(!stageOneRoot)return [];
  const occupied=new Map();
  const trees=[];
  const densityScale=THREE.MathUtils.clamp(Number(density)||0.85,0.25,1.35);
  const rows=[
    {min:7,max:21,keep:0.94,spacing:7.2},
    {min:22,max:68,keep:0.72,spacing:9.0},
    {min:70,max:132,keep:0.38,spacing:11.5}
  ];
  const sampleStep=9.5;
  const spacingCell=20;
  const randCache=new Map();
  const randomAt=(x,z,salt)=>{
    const key=Math.round(x*2)+':'+Math.round(z*2)+':'+salt;
    if(randCache.has(key))return randCache.get(key);
    const value=seededRandom(x,z,salt)();
    randCache.set(key,value);
    return value;
  };
  const findGround=(x,z)=>{
    const surface=terrainHeightLookup?sampleTerrainSurface(x,z,terrainHeightLookup):sampleSlopeMarginSurface(x,z,footprint,180);
    if(!surface||surface.normalY<0.46)return null;
    return {y:surface.y,normalY:surface.normalY};
  };
  const canPlace=(x,z,spacing)=>{
    const cx=Math.floor(x/spacingCell),cz=Math.floor(z/spacingCell);
    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      const bucket=occupied.get((cx+dx)+':'+(cz+dz));
      if(bucket&&bucket.some(point=>Math.hypot(point.x-x,point.z-z)<spacing))return false;
    }
    const key=cx+':'+cz;
    let bucket=occupied.get(key);
    if(!bucket){bucket=[];occupied.set(key,bucket);}
    bucket.push({x,z});
    return true;
  };
  const addTree=(x,z,ground,rr,band)=>{
    const height=8.5+rr()*8.5;
    const hue=(rr()-0.5)*0.025;
    // Geometry already carries the needle albedo; instance colour is only a subtle tree-to-tree variation.
    const tint=new THREE.Color().setHSL(0.325+hue,0.12+rr()*0.08,0.90+rr()*0.05);
    trees.push({
      x,y:ground.y+0.08,z,height,width:height*(0.52+rr()*0.12),
      rotation:rr()*Math.PI*2,variant:Math.floor(rr()*3),tint,band
    });
  };

  const baseBounds=terrainBounds||footprint.bounds.clone().expandByScalar(440);
  let edgeAttempts=0;
  for(const edge of footprint.edges){
    if(trees.length>=3200)break;
    const dx=edge.bx-edge.ax,dz=edge.bz-edge.az;
    const length=Math.hypot(dx,dz);
    if(length<4||length>180)continue;
    const steps=Math.max(1,Math.ceil(length/sampleStep));
    const nx=-dz/length,nz=dx/length;
    const tx=dx/length,tz=dz/length;
    for(let step=0;step<steps;step++){
      if(trees.length>=3200)break;
      const u=(step+0.5)/steps;
      const jitter=(randomAt(edge.ax+u*dx,edge.az+u*dz,7)-0.5)*sampleStep*0.46;
      const mx=edge.ax+dx*u+tx*jitter;
      const mz=edge.az+dz*u+tz*jitter;
      const sideA=footprint.contains(mx+nx*2.2,mz+nz*2.2);
      const sideB=footprint.contains(mx-nx*2.2,mz-nz*2.2);
      if(sideA&&sideB)continue;
      const sign=sideA?-1:sideB?1:(randomAt(mx,mz,9)<0.5?-1:1);
      for(let row=0;row<rows.length;row++){
        if(trees.length>=3200)break;
        const band=rows[row];
        if(randomAt(mx,mz,13+row)>densityScale*band.keep)continue;
        const offset=band.min+(band.max-band.min)*randomAt(mx,mz,21+row);
        const x=mx+nx*sign*offset+(randomAt(mx,mz,31+row)-0.5)*3.5;
        const z=mz+nz*sign*offset+(randomAt(mx,mz,41+row)-0.5)*3.5;
        if(x<baseBounds.min.x+2||x>baseBounds.max.x-2||z<baseBounds.min.z+2||z>baseBounds.max.z-2)continue;
        if(footprint.contains(x,z))continue;
        const ground=findGround(x,z);
        if(!ground)continue;
        if(!canPlace(x,z,band.spacing))continue;
        const rr=seededRandom(x,z,53);
        addTree(x,z,ground,rr,row);
        edgeAttempts++;
      }
    }
  }

  // A disconnected or non-manifold Stage 1 FBX can have no usable outer edges.
  // In that case, fill a deterministic forest belt around the piste bounds instead
  // of silently returning an empty forest. Keep a clear buffer around the ski surface.
  const usedFallback=trees.length<700&&!footprint.bounds.isEmpty();
  if(usedFallback){
    const belt=footprint.bounds;
    const margin=320;
    const minX=Math.max(baseBounds.min.x+12,belt.min.x-margin);
    const maxX=Math.min(baseBounds.max.x-12,belt.max.x+margin);
    const minZ=Math.max(baseBounds.min.z+12,belt.min.z-margin);
    const maxZ=Math.min(baseBounds.max.z-12,belt.max.z+margin);
    const grid=18;
    const keep=THREE.MathUtils.clamp(0.38+densityScale*0.34,0.42,0.84);
    const firstX=Math.floor(minX/grid),lastX=Math.ceil(maxX/grid);
    const firstZ=Math.floor(minZ/grid),lastZ=Math.ceil(maxZ/grid);
    for(let iz=firstZ;iz<=lastZ&&trees.length<3200;iz++){
      for(let ix=firstX;ix<=lastX&&trees.length<3200;ix++){
        const rr=seededRandom(ix*grid,iz*grid,907);
        if(rr()>keep)continue;
        const x=(ix+0.5+(rr()-0.5)*0.62)*grid;
        const z=(iz+0.5+(rr()-0.5)*0.62)*grid;
        if(x<minX||x>maxX||z<minZ||z>maxZ)continue;
        if(footprint.contains(x,z))continue;
        const clearance=9;
        if(
          footprint.contains(x+clearance,z)||footprint.contains(x-clearance,z)||
          footprint.contains(x,z+clearance)||footprint.contains(x,z-clearance)||
          footprint.contains(x+clearance*0.7,z+clearance*0.7)||
          footprint.contains(x-clearance*0.7,z-clearance*0.7)||
          footprint.contains(x+clearance*0.7,z-clearance*0.7)||
          footprint.contains(x-clearance*0.7,z+clearance*0.7)
        )continue;
        const ground=findGround(x,z);
        if(!ground)continue;
        const spacing=13.5+rr()*3.5;
        if(!canPlace(x,z,spacing))continue;
        addTree(x,z,ground,rr,3);
      }
    }
  }
  console.info('[Grade Optimizer WebGPU] Slope-edge forest:',{
    boundaryEdges:footprint.edges.length,triangles:footprint.triangles.length,
    edgePlacements:edgeAttempts,fallbackGrid:usedFallback,placements:trees.length
  });
  return trees;
}
function createSplinePineGeometry(lod, variant) {
  // V7: true alpine spruce boughs — broad descending whorls, flat needle fans and snow on top.
  const positions=[],normals=[],colors=[],indices=[];
  const high=lod==='near',mid=lod==='mid';
  const height=10,levels=high?14:mid?10:7;
  const branches=high?7:mid?6:5;
  const dark=new THREE.Color(0x0e2a20),green=new THREE.Color(0x183d2b);
  const lit=new THREE.Color(0x315a3e),snow=new THREE.Color(0xeaf1f5);
  const bark=new THREE.Color(0x4a4034);
  const width=[1.04,0.94,1.0][variant]||1;
  const lean=[0,-0.025,0.032][variant]||0;
  const hash=(a,b)=>{const n=Math.sin(a*127.1+b*311.7+variant*74.7)*43758.5453;return n-Math.floor(n);};
  const up=new THREE.Vector3(0,1,0);

  const addVertex=(p,n,c)=>{
    positions.push(p.x,p.y,p.z);
    normals.push(n.x,n.y,n.z);
    colors.push(c.r,c.g,c.b);
  };
  const addTriangle=(a,b,c,color)=>{
    let p1=b,p2=c;
    const normal=p1.clone().sub(a).cross(p2.clone().sub(a));
    if(normal.y<0){p1=c;p2=b;normal.negate();}
    normal.normalize();
    const first=positions.length/3;
    addVertex(a,normal,color);addVertex(p1,normal,color);addVertex(p2,normal,color);
    indices.push(first,first+1,first+2);
  };
  const addQuad=(a,b,c,d,color)=>{
    addTriangle(a,b,c,color);addTriangle(a,c,d,color);
  };
  const addTube=(a,b,r0,r1,steps=4,sides=5,colorA=green,colorB=dark)=>{
    const axis=b.clone().sub(a),length=axis.length();if(length<1e-5)return;
    axis.normalize();
    const ref=Math.abs(axis.y)<0.92?up:new THREE.Vector3(1,0,0);
    const u=ref.clone().cross(axis).normalize(),v=axis.clone().cross(u).normalize();
    const base=positions.length/3;
    for(let i=0;i<=steps;i++){
      const t=i/steps,center=a.clone().lerp(b,t),radius=THREE.MathUtils.lerp(r0,r1,t);
      for(let j=0;j<sides;j++){
        const angle=j/sides*Math.PI*2;
        const normal=u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v,Math.sin(angle)).normalize();
        const point=center.clone().addScaledVector(normal,radius);
        const mix=THREE.MathUtils.lerp(0.12,0.82,t);
        const colour=colorA.clone().lerp(colorB,mix);
        colour.offsetHSL(0,(hash(i,j)-0.5)*0.025,(hash(j,i)-0.5)*0.035);
        addVertex(point,normal,colour);
      }
    }
    for(let i=0;i<steps;i++)for(let j=0;j<sides;j++){
      const a0=base+i*sides+j,b0=base+i*sides+(j+1)%sides;
      const c0=base+(i+1)*sides+j,d0=base+(i+1)*sides+(j+1)%sides;
      indices.push(a0,b0,c0,b0,d0,c0);
    }
  };

  // A tapered, flat needle blade. Several blades overlap into a recognizable spruce spray;
  // unlike the previous clump model, there are no ellipsoids or round foliage blobs.
  const addBlade=(start,tip,side,halfWidth,color,seed=0)=>{
    const direction=tip.clone().sub(start);
    if(direction.lengthSq()<1e-8)return;
    direction.normalize();
    const lateral=side.clone().addScaledVector(direction,-side.dot(direction)).normalize();
    if(lateral.lengthSq()<1e-8)return;
    const shoulder=start.clone().lerp(tip,0.58);
    shoulder.y+=Math.max(0.012,halfWidth*0.16)+hash(seed,3)*0.012;
    const left=shoulder.clone().addScaledVector(lateral,halfWidth);
    const right=shoulder.clone().addScaledVector(lateral,-halfWidth);
    addTriangle(start,left,tip,color);
    addTriangle(start,tip,right,color);
  };

  // Thin broken powder caps rest on the upper face of each bough, never as round snow balls.
  const addSnowPatch=(start,end,side,halfWidth,seed)=>{
    const a=start.clone(),b=end.clone();
    a.y+=0.075+hash(seed,0)*0.018;
    b.y+=0.052+hash(seed,1)*0.018;
    const lateral=side.clone().normalize();
    const aL=a.clone().addScaledVector(lateral,halfWidth),aR=a.clone().addScaledVector(lateral,-halfWidth);
    const bL=b.clone().addScaledVector(lateral,halfWidth*0.62),bR=b.clone().addScaledVector(lateral,-halfWidth*0.62);
    addQuad(aL,bL,bR,aR,snow);
  };

  const trunkTop=new THREE.Vector3(lean,height,0);
  addTube(new THREE.Vector3(0,0,0),trunkTop,0.145,0.009,16,7,bark,dark);

  for(let level=0;level<levels;level++){
    const t=level/(levels-1);
    const y=0.48+9.08*t;
    const envelope=Math.pow(1-t,0.82);
    const crownRadius=(0.20+3.72*Math.pow(1-t,0.92))*width;
    const phase=level*2.399+variant*0.79;
    for(let branch=0;branch<branches;branch++){
      const angle=phase+branch/branches*Math.PI*2;
      const radial=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
      const tangent=new THREE.Vector3(-radial.z,0,radial.x);
      const start=new THREE.Vector3(lean*t,y,0);
      const length=crownRadius*(0.90+hash(level,branch)*0.10);
      const end=start.clone().addScaledVector(radial,length);
      end.y-=0.12+0.30*envelope;
      const branchColour=hash(level,branch)>0.55?lit:green;
      addTube(start,end,0.045*envelope+0.007,0.006,4,4,bark,green);

      // Wide, flattened bough: a six-section triangular fan with a gently drooping outer edge.
      const sections=high?7:mid?5:4;
      const rows=[];
      for(let section=0;section<=sections;section++){
        const u=section/sections;
        const center=start.clone().lerp(end,u);
        center.y-=0.10*Math.sin(u*Math.PI)+0.035*u;
        const fanWidth=length*(0.018+0.135*Math.pow(Math.sin(u*Math.PI),0.78));
        const left=center.clone().addScaledVector(tangent,fanWidth);
        const right=center.clone().addScaledVector(tangent,-fanWidth);
        const ridge=center.clone();ridge.y+=0.035+0.02*Math.sin(u*Math.PI);
        rows.push({left,right,ridge,center});
      }
      for(let section=0;section<sections;section++){
        const a=rows[section],b=rows[section+1];
        const tint=branchColour.clone();
        tint.offsetHSL(0,(hash(level,section)-0.5)*0.018,(hash(branch,section)-0.5)*0.055);
        addQuad(a.left,b.left,b.ridge,a.ridge,tint);
        addQuad(a.ridge,b.ridge,b.right,a.right,dark.clone().lerp(tint,0.72));
      }

      // Four pairs of outward/downward sprays break the edge into fine spruce needles.
      const stations=high?4:mid?3:2;
      for(let station=0;station<stations;station++){
        const u=0.25+station/(Math.max(1,stations-1))*0.53;
        const root=start.clone().lerp(end,u);
        root.y-=0.10*Math.sin(u*Math.PI);
        const sprayLength=length*(0.17+0.025*hash(level,station+branch));
        for(const sign of [-1,1]){
          const direction=radial.clone().multiplyScalar(0.80)
            .addScaledVector(tangent,sign*0.50).add(new THREE.Vector3(0,-0.20,0)).normalize();
          const tip=root.clone().addScaledVector(direction,sprayLength);
          tip.y-=sprayLength*0.10;
          addBlade(root,tip,tangent,sprayLength*0.17,branchColour,level*31+branch*7+station);
          const forkRoot=root.clone().lerp(tip,0.52);
          const forkDirection=radial.clone().multiplyScalar(0.68)
            .addScaledVector(tangent,sign*0.72).add(new THREE.Vector3(0,-0.24,0)).normalize();
          const forkTip=forkRoot.clone().addScaledVector(forkDirection,sprayLength*0.46);
          addBlade(forkRoot,forkTip,tangent,sprayLength*0.095,dark.clone().lerp(lit,0.38),level*17+station*5+branch);
        }
      }

      // Snow rests in three short, separated strips so the dark green branch structure remains clear.
      for(let patch=0;patch<3;patch++){
        const u0=0.27+patch*0.22,u1=u0+0.16;
        const a=start.clone().lerp(end,u0),b=start.clone().lerp(end,u1);
        a.y-=0.10*Math.sin(u0*Math.PI);b.y-=0.10*Math.sin(u1*Math.PI);
        addSnowPatch(a,b,tangent,0.045*envelope+0.009,level*19+branch*3+patch);
      }
      if(level%2===0||high){
        const capA=end.clone();capA.y+=0.055;
        const capB=end.clone().addScaledVector(radial,0.13*envelope);capB.y+=0.03;
        addSnowPatch(capA,capB,tangent,0.052*envelope+0.008,level*29+branch);
      }
    }
  }

  // A narrow leader stays visible above the uppermost whorl; the treetop is a spruce tip, not a pin.
  const leaderA=new THREE.Vector3(lean*0.9,9.15,0);
  const leaderB=trunkTop.clone().add(new THREE.Vector3(0,0.24,0));
  addTube(leaderA,leaderB,0.026,0.0025,5,5,green,dark);
  const topNeedle=new THREE.Vector3(lean,10.48,0);
  addBlade(leaderB,topNeedle,new THREE.Vector3(1,0,0),0.018,lit,991+variant);

  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
function createPineBacklightNode(){
  const sunFacing=dot(normalWorld,foliageSunDirection);
  const backFace=max(sunFacing.negate().add(0.08),float(0)).div(1.08).clamp(0,1).pow(1.35);
  const grazing=max(sunFacing.negate().add(0.36),float(0)).div(1.36).clamp(0,1).pow(2.0);
  const transmission=backFace.mul(0.76).add(grazing.mul(0.24));
  // Restrained green backscatter: the actual needle hue remains in the surface albedo.
  return vec3(0.045,0.075,0.032).mul(transmission).mul(foliageBacklight).mul(foliageDaylight);
}
function createSplinePineMaterial() {
  const material=new THREE.MeshPhysicalNodeMaterial({
    roughness:0.88,metalness:0,vertexColors:true,side:THREE.DoubleSide,
    clearcoat:0.0,clearcoatRoughness:1,specularIntensity:0.18
  });
  // Keep the trunk and crown still. Only outer branch fans get a restrained, low-frequency flex.
  const phase=positionLocal.x.mul(0.82).add(positionLocal.z.mul(0.67)).add(positionLocal.y.mul(0.10));
  const outerReach=positionLocal.x.abs().add(positionLocal.z.abs());
  const flex=outerReach.mul(0.012).add(positionLocal.y.mul(0.0006)).mul(foliageWind);
  const gust=time.mul(0.82).add(phase);
  const swayX=sin(gust).mul(flex);
  const swayZ=cos(gust.mul(0.91).add(1.4)).mul(flex).mul(0.52);
  material.positionNode=positionLocal.add(vec3(swayX,0,swayZ));
  material.emissiveNode=createPineBacklightNode();
  return material;
}
function createTreeInstanceBatch(trees, lod, variant, parent, castShadow=false) {
  if(!trees.length)return;
  const dummy=new THREE.Object3D();
  const geometry=forestSystem.geometries[lod][variant];
  const material=forestSystem.splineMaterial;
  const mesh=new THREE.InstancedMesh(geometry,material,trees.length);
  mesh.name='Forest_'+lod+'_SnowSpruce_'+variant;
  trees.forEach((tree,index)=>{
    dummy.position.set(tree.x,tree.y,tree.z);
    dummy.rotation.set(0,tree.rotation,0);
    const uniformScale=tree.height/10;
    const widthScale=THREE.MathUtils.clamp(tree.width/(tree.height*0.58),0.88,1.12);
    dummy.scale.set(uniformScale*widthScale,uniformScale,uniformScale*widthScale);
    dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);
    mesh.setColorAt(index,tree.tint);
  });
  mesh.instanceMatrix.needsUpdate=true;
  if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  mesh.frustumCulled=false;mesh.castShadow=!!castShadow;mesh.receiveShadow=true;
  parent.add(mesh);
}
function rebuildForestLod(force=false) {
  if(!forestSystem)return;
  camera.getWorldDirection(forestSystem.cameraForward);
  const cameraMoved=forestSystem.lastCamera.distanceToSquared(camera.position)>=6400;
  const cameraTurned=forestSystem.lastForward.dot(forestSystem.cameraForward)<0.94;
  if(!force&&!cameraMoved&&!cameraTurned)return;
  forestSystem.lastCamera.copy(camera.position);
  forestSystem.lastForward.copy(forestSystem.cameraForward);
  forestSystem.group.clear();
  const nearShadow=[[],[],[]],mid=[[],[],[]],far=[[],[],[]];
  const nearLimitSq=750*750,midLimitSq=3000*3000;
  for(const tree of forestSystem.trees){
    const dx=camera.position.x-tree.x;
    const dy=camera.position.y-(tree.y+tree.height*0.5);
    const dz=camera.position.z-tree.z;
    const distanceSq=dx*dx+dy*dy+dz*dz;
    if(distanceSq<nearLimitSq)nearShadow[tree.variant].push(tree);
    else if(distanceSq<midLimitSq)mid[tree.variant].push(tree);
    else far[tree.variant].push(tree);
  }
  for(let variant=0;variant<3;variant++){
    createTreeInstanceBatch(nearShadow[variant],'near',variant,forestSystem.group,true);
    createTreeInstanceBatch(mid[variant],'mid',variant,forestSystem.group,false);
    createTreeInstanceBatch(far[variant],'far',variant,forestSystem.group,false);
  }
  terrainInfoEl.textContent=forestSystem.trees.length.toLocaleString('ru-RU');
  forestSystem.lastLod={
    shadow:nearShadow.reduce((sum,items)=>sum+items.length,0),
    near:nearShadow.reduce((sum,items)=>sum+items.length,0),
    mid:mid.reduce((sum,items)=>sum+items.length,0),
    far:far.reduce((sum,items)=>sum+items.length,0)
  };
}

function removeLegacyTreeAssets(root) {
  const tokens=/(^|[^a-z0-9])(tree|trees|pine|spruce|fir|conifer|foliage|vegetation|leaves|needles)([^a-z0-9]|$)/i;
  const matches=[];
  root.traverse(object=>{
    if(object===root)return;
    const name=String(object.name||'');
    if(tokens.test(name))matches.push(object);
  });
  let removed=0;
  for(const object of matches){
    let ancestor=object.parent,nested=false;
    while(ancestor&&ancestor!==root){
      if(matches.includes(ancestor)){nested=true;break;}
      ancestor=ancestor.parent;
    }
    if(!nested&&object.parent){object.removeFromParent();removed++;}
  }
  return removed;
}

async function loadStageOneAndForest() {
  setLoadingMessage('Загружаем FBX Slopes_Stage1…');
  await nextAnimationFrame();
  const response=await fetch('./clients/alpine-resort/scene.json',{cache:'no-cache'});
  if(!response.ok)throw new Error('Не удалось загрузить scene.json ('+response.status+').');
  const manifest=await response.json();
  const item=(manifest.assets||[]).find(asset=>asset.id==='slopes_stage1'&&asset.category==='slope');
  if(!item)throw new Error('В scene.json не найден Slopes_Stage1.');
  const stageOneUrl='./clients/alpine-resort/'+item.file;
  const extension=String(item.file||'').split('.').pop().toLowerCase();
  let root;
  if(extension==='glb'||extension==='gltf'){
    const gltf=await new GLTFLoader().loadAsync(stageOneUrl);
    root=gltf.scene||gltf.scenes?.[0];
    if(!root)throw new Error('GLTF Slopes_Stage1 не содержит scene.');
  }else if(extension==='fbx'){
    root=await loadFBXTerrain(stageOneUrl);
  }else{
    throw new Error('Неподдерживаемый формат Slopes_Stage1: '+extension);
  }
  const removedLegacyTrees=removeLegacyTreeAssets(root);
  if(removedLegacyTrees)console.info('[Forest Lab V7] Removed legacy vegetation meshes:',removedLegacyTrees);
  restoreStageOneCoordinates(root,item);
  // Keep only slope geometry from the imported Stage 1 asset; V7 creates every tree procedurally.
  const semanticMaterials=shareStageOneMaterialsByKind(root,{defaultKind:'slopes'});
  const snowMaterial=getSnowPbrMaterial();
  let slopeMeshCount=0;
  root.traverse(object=>{
    if(!object.isMesh||!object.geometry?.attributes?.position)return;
    ensureWorldTerrainUV(object,true);
    object.material=Array.isArray(object.material)
      ?object.material.map(()=>snowMaterial)
      :snowMaterial;
    object.castShadow=true;
    object.receiveShadow=true;
    slopeMeshCount++;
  });
  console.info('[Grade Optimizer WebGPU Forest V7] Stage 1 snow material:',{semanticMaterials,material:snowMaterial.name,removedLegacyTrees});
  if(!slopeMeshCount)throw new Error('Slopes_Stage1 не содержит polygon meshes.');
  root.name='GO_WebGPU_Slopes_Stage1';
  scene.add(root);
  stageOneRoot=root;
  setLoadingMessage('Строим границы трассы и размещаем лес…');
  await nextAnimationFrame();
  const footprint=buildSlopeFootprint(root);
  const focusBounds=footprint.bounds.isEmpty()?new THREE.Box3().setFromObject(root):footprint.bounds;
  if(!terrainRoot||!terrainBounds||!terrainHeightLookup){
    setLoadingMessage('Строим процедурное основание леса вокруг Slopes_Stage1…');
    await nextAnimationFrame();
    createSlopeMarginTerrain(footprint);
    statusText.textContent='WebGPU · Slopes_Stage1 · procedural forest apron';
    statusDot.classList.remove('ok');statusDot.classList.add('warning');
  }
  if(!focusBounds.isEmpty()){
    const focus=focusBounds.getCenter(new THREE.Vector3());
    const extent=focusBounds.getSize(new THREE.Vector3());
    const span=Math.max(extent.x,extent.z,250);
    const distance=THREE.MathUtils.clamp(span*0.72,720,1650);
    controls.target.set(focus.x,focus.y+Math.max(18,extent.y*0.12),focus.z);
    camera.position.set(focus.x+distance*0.72,focus.y+distance*0.52,focus.z+distance*0.92);
    controls.update();
    camera.updateMatrixWorld(true);
  }
  setLoadingMessage('Распределяем деревья по рельефу…');
  await nextAnimationFrame();
  const trees=buildTreePlacements(footprint,Number(ui.forestDensity.value));
  
  const geometries={near:[],mid:[],far:[]};
  for(let variant=0;variant<3;variant++){
    geometries.near.push(createSplinePineGeometry('near',variant));
    geometries.mid.push(createSplinePineGeometry('mid',variant));
    geometries.far.push(createSplinePineGeometry('far',variant));
  }
  forestSystem={
    trees,footprint,geometries,
    splineMaterial:createSplinePineMaterial(),
    group:new THREE.Group(),
    lastCamera:new THREE.Vector3(Infinity,Infinity,Infinity),
    lastForward:new THREE.Vector3(0,0,-1),
    cameraForward:new THREE.Vector3(),
    lastLod:{near:0,mid:0,far:0}
  };
  forestSystem.group.name='GO_Procedural_SkiForest';
  scene.add(forestSystem.group);
  rebuildForestLod(true);
  console.info('[Grade Optimizer WebGPU V7] Alpine spruce forest:',{
    slopeMeshes:slopeMeshCount,projectedTriangles:footprint.triangles.length,
    boundaryEdges:footprint.edges.length,trees:trees.length,forestLOD:forestSystem.lastLod
  });
  return {slopeMeshCount,treeCount:trees.length};
}

function rebuildForestDensity() {
  if(!stageOneRoot)return;
  const footprint=forestSystem?.footprint||buildSlopeFootprint(stageOneRoot);
  const trees=buildTreePlacements(footprint,Number(ui.forestDensity.value));
  if(forestSystem){
    forestSystem.group.clear();
    forestSystem.trees=trees;
    forestSystem.lastCamera.set(Infinity,Infinity,Infinity);
    rebuildForestLod(true);
  }
}

function applyQualityProfile(name) {
  atmosphere?.setQuality(name);
}
function bindUI() {
  ui.time.addEventListener('input',()=>{
    dayCyclePlaying=false;
    syncDayCycleButton();
    updateSkyLabels();
    updateSky(true);
  });
  [ui.sunIntensity,ui.turbidity,ui.rayleigh,ui.cloudCoverage,ui.cloudDensity,ui.cloudElevation].forEach(input=>{
    input.addEventListener('input',()=>{updateSkyLabels();updateSky(true);});
  });
  ui.dayCycle.addEventListener('click',()=>{
    dayCyclePlaying=!dayCyclePlaying;
    syncDayCycleButton();
  });
  ui.dayLength.addEventListener('input',updateSkyLabels);
  ui.fogStrength.addEventListener('input',updateFogControls);
  ui.forestDensity.addEventListener('input',()=>ui.forestDensityValue.textContent=Math.round(Number(ui.forestDensity.value)*100)+'%');
  ui.forestDensity.addEventListener('change',rebuildForestDensity);
  foliageWind.value=Number(ui.wind.value)/9;
  ui.wind.addEventListener('input',()=>{updateSkyLabels();foliageWind.value=Number(ui.wind.value)/9;updateSky();});
  ui.leafTranslucency.addEventListener('input',()=>{updateSkyLabels();foliageBacklight.value=Number(ui.leafTranslucency.value);});
  ui.quality.addEventListener('change', () => applyQualityProfile(ui.quality.value));
  updateSkyLabels();
  syncDayCycleButton();
}
async function start() {
  renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
  SunLight.registerNode(SunLightNode);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.3));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.52;
  stage.appendChild(renderer.domElement);
  await renderer.init();
  // Configure WebGPU shadows after renderer initialisation, as in the r187 SunLight example.
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFShadowMap;
  sunLight.shadow.mapSize.setScalar(1024);
  sunLight.shadow.camera.far=4500;
  sunLight.shadow.normalBias=0.035;
  sunLight.shadow.autoUpdate=true;
  camera.aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
  camera.updateProjectionMatrix();
  const isWebGPU = renderer.backend && renderer.backend.isWebGPUBackend === true;
  statusText.textContent = isWebGPU ? 'WebGPU · physical SkyMesh · snow PBR · near-tree shadows' : 'WebGL fallback · physical SkyMesh · snow PBR';
  statusDot.classList.add('ok');
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.screenSpacePanning = true;
  controls.minDistance = 250;
  controls.maxDistance = 14000;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.target.set(0, 0, 0);
  try{
    await loadRealTerrain();
  }catch(error){
    console.warn('[Grade Optimizer WebGPU Forest] Optional real-terrain assets unavailable; using a Stage 1-derived ground apron.',error);
    statusText.textContent='WebGPU · подготовка рельефа Slopes_Stage1';
    statusDot.classList.remove('ok');statusDot.classList.add('warning');
  }
  await loadStageOneAndForest();
  atmosphere=createForestAtmosphere(THREE,scene,camera,renderer,hemisphere,{
    center:terrainBounds.getCenter(new THREE.Vector3()),
    groundLevel
  });
  updateSkyLabels();
  ui.forestDensityValue.textContent=Math.round(Number(ui.forestDensity.value)*100)+'%';
  updateSky(true);
  updateFogControls();
  bindUI();
  applyQualityProfile(ui.quality.value);
  loading.style.display = 'none';
  window.addEventListener('resize', () => {
    camera.aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
    camera.updateProjectionMatrix();
    renderer.setSize(stage.clientWidth, stage.clientHeight);
  }, { passive: true });
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - previousTime) / 1000, 0.05);
    previousTime = now;
    elapsed += dt;
    controls.update();
    advanceDayCycleFrame(dt);
    camera.updateMatrixWorld();
    if(solarState)updateSolarDisc(THREE,sunDisc,camera,solarState,Number(ui.sunIntensity.value));
    atmosphere.updateCamera();
    rebuildForestLod(false);
    atmosphere.render();
    fpsFrames++;
    if (now - fpsStart >= 1000) {
      fpsEl.textContent = String(Math.round(fpsFrames * 1000 / (now - fpsStart)));
      frameMsEl.textContent = (1000 / Math.max(1, fpsFrames * 1000 / (now - fpsStart))).toFixed(1);
      fpsFrames = 0;
      fpsStart = now;
    }
  });
}
start().catch(error => {
  statusText.textContent = 'Не удалось запустить WebGPU Forest Lab';
  statusDot.classList.add('bad');
  errorBox.style.display = 'block';
  errorBox.textContent = error && error.stack || String(error);
  loading.style.display = 'none';
  console.error('[Grade Optimizer WebGPU Forest Lab]', error);
});