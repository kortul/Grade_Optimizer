import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { shareStageOneMaterialsByKind } from './stage-one-materials.v1.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightNode } from 'three/addons/lights/SunLightNode.js';
import { calculateSolarCycle, advanceSolarClock, createSolarDisc, updateSolarDisc } from './solar-cycle.v1.js';
import { createForestAtmosphere } from './webgpu-forest-atmosphere.v4.js';
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
    const variant=Math.floor(rr()*3);
    const sizeClass=rr();
    const height=sizeClass<0.38?6.5+rr()*5.5:sizeClass<0.84?11+rr()*6:17+rr()*6;
    const hue=(rr()-0.5)*0.035;
    const baseHue=[0.325,0.315,0.337][variant];
    const tint=new THREE.Color().setHSL(baseHue+hue,0.16+rr()*0.08,0.86+rr()*0.06);
    trees.push({
      x,y:ground.y+0.08,z,height,width:height*(0.52+rr()*0.14),
      rotation:rr()*Math.PI*2,variant,tint,band,sizeClass:sizeClass<0.38?'small':sizeClass<0.84?'medium':'large'
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
const SPRUCE_ATLAS_SIZE=1024;
const SPRUCE_SAFE_UV=6/SPRUCE_ATLAS_SIZE;
let cachedSpruceFoliageAtlas=null;

function createSpruceFoliageAtlas(){
  if(cachedSpruceFoliageAtlas)return cachedSpruceFoliageAtlas;
  const size=SPRUCE_ATLAS_SIZE;
  const colourCanvas=document.createElement('canvas'),alphaCanvas=document.createElement('canvas');
  colourCanvas.width=colourCanvas.height=alphaCanvas.width=alphaCanvas.height=size;
  const colour=colourCanvas.getContext('2d',{alpha:false}),alpha=alphaCanvas.getContext('2d',{alpha:false});
  colour.fillStyle='#334b39';colour.fillRect(0,0,size,size);alpha.fillStyle='#000';alpha.fillRect(0,0,size,size);
  const palettes=[['#10271b','#183d27','#285b35','#56804b','#789568'],['#0d2830','#174247','#24645b','#4f8877','#8cae9a'],['#12291d','#20472b','#32683a','#638a4c','#91a66a'],['#18271d','#293f29','#3c5b35','#6d8550','#9baa73']];
  let state=0x6d2b79f5;
  const rng=()=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
  const blade=(ctx,x,y,dx,dy,width,fill)=>{
    const length=Math.hypot(dx,dy)||1,nx=-dy/length,ny=dx/length;
    ctx.fillStyle=fill;ctx.beginPath();ctx.moveTo(x-nx*width*0.30,y-ny*width*0.30);
    ctx.quadraticCurveTo(x+dx*0.34-nx*width*0.56,y+dy*0.34-ny*width*0.56,x+dx,y+dy);
    ctx.quadraticCurveTo(x+dx*0.42+nx*width*0.34,y+dy*0.42+ny*width*0.34,x+nx*width*0.30,y+ny*width*0.30);
    ctx.closePath();ctx.fill();
  };
  const bothBlade=(x,y,dx,dy,width,fill)=>{blade(colour,x,y,dx,dy,width,fill);blade(alpha,x,y,dx,dy,width,'#fff');};
  const twig=(ctx,x0,y0,x1,y1,width,stroke)=>{
    ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';
    ctx.beginPath();ctx.moveTo(x0,y0);ctx.quadraticCurveTo((x0+x1)*0.52+1,(y0+y1)*0.48-1,x1,y1);ctx.stroke();
  };
  const bothTwig=(x0,y0,x1,y1,width,stroke)=>{twig(colour,x0,y0,x1,y1,width,stroke);twig(alpha,x0,y0,x1,y1,width,'#fff');};
  // One full-resolution shoot per texture: no 2x2 atlas tiles collapsing into one another in distant mip levels.
  const sx=size*0.12,sy=size*0.88,ex=size*0.88,ey=size*0.12;
  const length=Math.hypot(ex-sx,ey-sy),ax=(ex-sx)/length,ay=(ey-sy)/length,nx=-ay,ny=ax;
  const palette=palettes[Math.floor(rng()*palettes.length)];
  bothTwig(sx,sy,ex,ey,size*0.009,palette[0]);
  const stations=52;
  for(let i=0;i<stations;i++){
    const t=0.045+(i+rng()*0.55)/stations*0.91,px=sx+(ex-sx)*t+(rng()-0.5)*size*0.006,py=sy+(ey-sy)*t+(rng()-0.5)*size*0.006;
    const taper=0.42+Math.sin(Math.PI*t)*0.72;
    for(const sign of [-1,1]){
      const l=size*(0.060+rng()*0.048)*taper,forward=0.08+rng()*0.20,side=sign*(0.78+rng()*0.30);
      const dx=(ax*forward+nx*side)*l,dy=(ay*forward+ny*side)*l;
      bothBlade(px,py,dx,dy,size*(0.006+rng()*0.004),palette[1+Math.floor(rng()*4)]);
      if(rng()<0.72){
        const l2=l*(0.48+rng()*0.32),s2=sign*(0.42+rng()*0.42),dx2=(ax*0.18+nx*s2)*l2,dy2=(ay*0.18+ny*s2)*l2;
        bothBlade(px+ax*size*0.008,py+ay*size*0.008,dx2,dy2,size*(0.0035+rng()*0.0025),palette[2+Math.floor(rng()*3)]);
      }
    }
  }
  for(let i=0;i<13;i++){
    const t=0.13+rng()*0.72,px=sx+(ex-sx)*t,py=sy+(ey-sy)*t,sign=rng()<0.5?-1:1,fl=size*(0.12+rng()*0.055);
    const fx=ax*0.20+nx*sign*0.72,fy=ay*0.20+ny*sign*0.72;
    bothTwig(px,py,px+fx*fl,py+fy*fl,size*0.0035,palette[0]);
    for(let k=0;k<7;k++){
      const u=k/7,rx=px+fx*fl*u,ry=py+fy*fl*u,sgn=k%2?1:-1,ll=size*(0.035+rng()*0.025)*(1-u*0.35);
      const dx=(fx*0.22+nx*sgn*0.75)*ll,dy=(fy*0.22+ny*sgn*0.75)*ll;
      bothBlade(rx,ry,dx,dy,size*(0.003+rng()*0.0018),palette[2+Math.floor(rng()*3)]);
    }
  }
  const map=new THREE.CanvasTexture(colourCanvas);
  map.name='GO_SpruceNeedleShoot_V19';map.colorSpace=THREE.SRGBColorSpace;
  map.minFilter=THREE.LinearMipmapLinearFilter;map.magFilter=THREE.LinearFilter;map.anisotropy=8;
  const alphaMap=createCoverageAlphaTexture(alphaCanvas,size,0.22);
  alphaMap.name='GO_SpruceNeedleShootCoverage_V19';
  cachedSpruceFoliageAtlas={map,alphaMap};return cachedSpruceFoliageAtlas;
}
function filteredSprayCoverage(values,width,cutoff){
  const steps=Math.max(1,Math.ceil(64/width)),n=width*steps;
  const at=(x,y)=>values[Math.min(width-1,Math.max(0,y))*width+Math.min(width-1,Math.max(0,x))];
  let covered=0;
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
    const u=(i+0.5)/steps-0.5,v=(j+0.5)/steps-0.5;
    const x=Math.floor(u),y=Math.floor(v),fx=u-x,fy=v-y;
    const top=at(x,y)+(at(x+1,y)-at(x,y))*fx;
    const bottom=at(x,y+1)+(at(x+1,y+1)-at(x,y+1))*fx;
    if(top+(bottom-top)*fy>cutoff)covered++;
  }
  return covered/(n*n);
}
function createCoverageAlphaTexture(canvas,size,cutoff=0.28){
  const raw=canvas.getContext('2d').getImageData(0,0,size,size).data;
  let level=new Float32Array(size*size);
  for(let i=0;i<level.length;i++)level[i]=raw[i*4+1]/255;
  let covered=0;for(const a of level)if(a>cutoff)covered++;
  const coverage=covered/level.length,mipmaps=[];
  for(let width=size;;width>>=1){
    let remapped=level;
    if(width<size){
      let peak=0;for(const a of level)peak=Math.max(peak,a);
      const ramp=(1-cutoff)/(0.1*Math.max(peak,1e-4));
      const remap=threshold=>level.map(a=>Math.min(1,Math.max(0,cutoff+(a-threshold)*ramp)));
      let lo=0,hi=peak*0.9;
      for(let i=0;i<18;i++){
        const mid=(lo+hi)*0.5;
        if(filteredSprayCoverage(remap(mid),width,cutoff)>coverage)lo=mid;else hi=mid;
      }
      remapped=remap((lo+hi)*0.5);
    }
    const mip=document.createElement('canvas');mip.width=mip.height=width;
    const ctx=mip.getContext('2d'),image=ctx.createImageData(width,width);
    for(let i=0;i<remapped.length;i++){
      const v=Math.round(remapped[i]*255),k=i*4;
      image.data[k]=image.data[k+1]=image.data[k+2]=v;image.data[k+3]=255;
    }
    ctx.putImageData(image,0,0);mipmaps.push(mip);
    if(width===1)break;
    const half=width>>1,next=new Float32Array(half*half);
    for(let y=0;y<half;y++)for(let x=0;x<half;x++){
      const i=2*y*width+2*x;
      next[y*half+x]=(level[i]+level[i+1]+level[i+width]+level[i+width+1])*0.25;
    }
    level=next;
  }
  const texture=new THREE.CanvasTexture(mipmaps[0]);
  texture.mipmaps=mipmaps;texture.generateMipmaps=false;
  texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;
  texture.colorSpace=THREE.NoColorSpace;texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
  texture.anisotropy=8;return texture;
}

function createSplinePineGeometry(lod,variant){
  // V17: opaque branch scaffold and independently alpha-cut foliage cards; separate material groups keep mipmaps from clipping the wood.
  const positions=[],normals=[],colors=[],uvs=[],woodIndices=[],foliageIndices=[];
  const high=lod==='near',mid=lod==='mid';
  const shapes=[
    {name:'Norway',levels:28,branches:8,width:1.02,profile:1.02,twigScale:1.00,needleScale:0.34,droop:0.35},
    {name:'Alpine',levels:30,branches:7,width:0.86,profile:1.22,twigScale:0.94,needleScale:0.33,droop:0.32},
    {name:'Broad',levels:26,branches:8,width:1.16,profile:0.90,twigScale:1.10,needleScale:0.37,droop:0.39}
  ];
  const shape=shapes[variant]||shapes[0];
  const levels=high?shape.levels:mid?Math.max(15,Math.round(shape.levels*0.68)):Math.max(8,Math.round(shape.levels*0.38));
  const baseBranches=high?shape.branches:mid?Math.max(4,shape.branches-2):Math.max(3,shape.branches-3);
  // V17: denser branch whorls and layered sprays, with the same instanced prototype architecture.
  const twigStations=high?5:mid?3:2;
  const twigClusters=high?2:mid?2:1;
  const darkColours=[0x0b281d,0x0a2630,0x0c291e];
  const greenColours=[0x153c29,0x1a3e42,0x1c432a];
  const litColours=[0x315d40,0x3b6868,0x416b43];
  const dark=new THREE.Color(darkColours[variant]||darkColours[0]);
  const green=new THREE.Color(greenColours[variant]||greenColours[0]);
  const lit=new THREE.Color(litColours[variant]||litColours[0]);
  const snow=new THREE.Color(0xeaf1f5),bark=new THREE.Color(0x4a4034);
  const lean=[0,-0.035,0.025][variant]||0;
  const up=new THREE.Vector3(0,1,0),axisX=new THREE.Vector3(1,0,0);
  const TAU=Math.PI*2;
  const makeRng=(x,z,salt=0)=>seededRandom(x*13.37+salt*0.173,z*7.91+variant*29.7,salt+variant*101);
  const addVertex=(p,n,c,uv=[SPRUCE_SAFE_UV,SPRUCE_SAFE_UV])=>{positions.push(p.x,p.y,p.z);normals.push(n.x,n.y,n.z);colors.push(c.r,c.g,c.b);uvs.push(uv[0],uv[1]);};
  const addTube=(a,b,r0,r1,steps=2,sides=3,colorA=green,colorB=dark)=>{
    const axis=b.clone().sub(a),length=axis.length();if(length<1e-5)return;axis.normalize();
    const ref=Math.abs(axis.y)<0.92?up:axisX;
    const u=ref.clone().cross(axis).normalize(),v=axis.clone().cross(u).normalize(),base=positions.length/3;
    for(let i=0;i<=steps;i++){const t=i/steps,center=a.clone().lerp(b,t),radius=THREE.MathUtils.lerp(r0,r1,t);
      for(let j=0;j<sides;j++){const angle=j/sides*TAU;
        const normal=u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v,Math.sin(angle)).normalize();
        addVertex(center.clone().addScaledVector(normal,radius),normal,colorA.clone().lerp(colorB,t*0.72));}}
    for(let i=0;i<steps;i++)for(let j=0;j<sides;j++){const a0=base+i*sides+j,b0=base+i*sides+(j+1)%sides,c0=base+(i+1)*sides+j,d0=base+(i+1)*sides+(j+1)%sides;
      woodIndices.push(a0,b0,c0,b0,d0,c0);}
  };
  // Curved tubes use a transported frame, so branch rings follow the curve instead of a single straight axis.
  const addTubeCurve=(curve,r0,r1,steps=5,sides=5,colorA=green,colorB=dark)=>{
    const base=positions.length/3;
    let previousTangent=null,frameNormal=new THREE.Vector3(),binormal=new THREE.Vector3();
    for(let i=0;i<=steps;i++){
      const t=i/steps,center=curve.getPointAt(t),tangent=curve.getTangentAt(t).normalize();
      if(!previousTangent){
        const ref=Math.abs(tangent.y)<0.92?up:axisX;
        frameNormal.crossVectors(ref,tangent).normalize();
        if(frameNormal.lengthSq()<1e-6)frameNormal.set(1,0,0);
      }else{
        const turnAxis=new THREE.Vector3().crossVectors(previousTangent,tangent);
        const turn= Math.atan2(turnAxis.length(),THREE.MathUtils.clamp(previousTangent.dot(tangent),-1,1));
        if(turn>1e-6)frameNormal.applyAxisAngle(turnAxis.normalize(),turn);
        frameNormal.addScaledVector(tangent,-frameNormal.dot(tangent)).normalize();
      }
      binormal.crossVectors(tangent,frameNormal).normalize();
      const radius=THREE.MathUtils.lerp(r0,r1,t);
      const ringColour=colorA.clone().lerp(colorB,t*0.72);
      for(let j=0;j<sides;j++){
        const angle=j/sides*TAU;
        const normal=frameNormal.clone().multiplyScalar(Math.cos(angle)).addScaledVector(binormal,Math.sin(angle)).normalize();
        addVertex(center.clone().addScaledVector(normal,radius),normal,ringColour);
      }
      previousTangent=tangent.clone();
    }
    for(let i=0;i<steps;i++)for(let j=0;j<sides;j++){
      const a0=base+i*sides+j,b0=base+i*sides+(j+1)%sides,c0=base+(i+1)*sides+j,d0=base+(i+1)*sides+(j+1)%sides;
      woodIndices.push(a0,b0,c0,b0,d0,c0);
    }
  };
  // Shell-biased clump placement, with outward-bent textured cards instead of individual needle triangles.
  const addNeedleClump=(center,axis,seed,size,baseColour)=>{
    const rng=makeRng(seed,Math.floor(size*10000),1709),forward=axis.clone().normalize();
    // The atlas itself contains fine needles occupying only a small share of each card.
    // V17 sized the card as if it were a single needle, making foliage look like loose specks.
    const clumpSize=size*(high?2.55:mid?2.65:2.8);
    let side=new THREE.Vector3().crossVectors(forward,up);
    if(side.lengthSq()<1e-5)side.crossVectors(forward,axisX);
    side.normalize();
    const lift=new THREE.Vector3().crossVectors(side,forward).normalize();
    const radiusSide=clumpSize*0.30,radiusUp=clumpSize*0.26,radiusAlong=clumpSize*0.18;
    const cardCount=high?3:mid?2:1;
    for(let card=0;card<cardCount;card++){
      let x=0,y=0,z=0,r2=2;
      while(r2>1){x=rng()*2-1;y=rng()*2-1;z=rng()*2-1;r2=x*x+y*y+z*z;}
      const shell=0.56+0.44*Math.sqrt(r2);
      const root=center.clone().addScaledVector(side,x*radiusSide*shell)
        .addScaledVector(lift,y*radiusUp*shell).addScaledVector(forward,z*radiusAlong*shell);
      const radial=side.clone().multiplyScalar(x).addScaledVector(lift,y);
      if(radial.lengthSq()<1e-5)radial.copy(side);
      radial.normalize();
      const direction=forward.clone().multiplyScalar(0.42+rng()*0.24)
        .addScaledVector(radial,0.58+0.28*rng()).addScaledVector(up,(rng()-0.48)*0.28).normalize();
      const cardCentre=root.clone().addScaledVector(direction,clumpSize*(0.07+rng()*0.12)),cardLong=direction.clone();
      let face=radial.clone().addScaledVector(lift,(rng()-0.5)*0.38).addScaledVector(up,0.08+rng()*0.20);
      face.addScaledVector(cardLong,-face.dot(cardLong));
      if(face.lengthSq()<1e-5)face.copy(side);
      face.normalize();
      if(card>0)face.applyAxisAngle(cardLong,card*(Math.PI/3)+(rng()-0.5)*0.26).normalize();
      const cardWidth=new THREE.Vector3().crossVectors(face,cardLong).normalize();
      face.crossVectors(cardLong,cardWidth).normalize();
      const halfHeight=clumpSize*(1.04+rng()*0.12),halfWidth=clumpSize*(0.80+rng()*0.14);
      const tint=baseColour.clone().lerp(new THREE.Color(0xffffff),0.72);
      tint.offsetHSL((rng()-0.5)*0.018,(rng()-0.5)*0.075,(rng()-0.5)*0.13);
      const inset=SPRUCE_SAFE_UV;
      const u0=inset,u1=1-inset;
      const v0=inset,v1=1-inset;
      const p0=cardCentre.clone().addScaledVector(cardWidth,-halfWidth).addScaledVector(cardLong,-halfHeight);
      const p1=cardCentre.clone().addScaledVector(cardWidth,halfWidth).addScaledVector(cardLong,-halfHeight);
      const p2=cardCentre.clone().addScaledVector(cardWidth,halfWidth).addScaledVector(cardLong,halfHeight);
      const p3=cardCentre.clone().addScaledVector(cardWidth,-halfWidth).addScaledVector(cardLong,halfHeight);
      const first=positions.length/3;
      addVertex(p0,face,tint,[u0,v0]);addVertex(p1,face,tint,[u1,v0]);
      addVertex(p2,face,tint,[u1,v1]);addVertex(p3,face,tint,[u0,v1]);
      foliageIndices.push(first,first+1,first+2,first,first+2,first+3);
    }
  };
  const addSnowCap=(a,b,side,halfWidth,seed)=>{
    const rng=makeRng(seed,variant,1811);
    const aa=a.clone(),bb=b.clone();aa.y+=0.025+rng()*0.012;bb.y+=0.018+rng()*0.012;
    const lateral=side.clone().normalize(),aL=aa.clone().addScaledVector(lateral,halfWidth),aR=aa.clone().addScaledVector(lateral,-halfWidth);
    const bL=bb.clone().addScaledVector(lateral,halfWidth*0.52),bR=bb.clone().addScaledVector(lateral,-halfWidth*0.52);
    const base=positions.length/3,n=up.clone();addVertex(aL,n,snow);addVertex(bL,n,snow);addVertex(bR,n,snow);addVertex(aR,n,snow);
    woodIndices.push(base,base+1,base+2,base,base+2,base+3);
  };

  // V19: hierarchical spruce with a single-tile foliage shoot and fuller distant LOD inspired by published Weber–Penn work.
  // Build the woody scaffold first; foliage is attached to terminal shoots, never to abstract crown blobs.
  const treeHeight=10;
  const trunkTop=new THREE.Vector3(lean,treeHeight,0);
  addTube(new THREE.Vector3(0,0,0),trunkTop,0.15,0.003,20,7,bark,dark);

  const tierCount=high?22:mid?16:10;
  const goldenAngle=Math.PI*(3-Math.sqrt(5));
  const primaryBranches=high?8:mid?7:6;
  const branchCurves=[];
  const addSpraysAlong=(curve,count,seedBase,scale,colourBase)=>{
    for(let i=0;i<count;i++){
      const rr=makeRng(seedBase+i*19,variant,1901);
      const u=0.12+((i+rr()*0.56)/count)*0.78;
      const centre=curve.getPointAt(THREE.MathUtils.clamp(u,0.08,0.98));
      const axis=curve.getTangentAt(u).normalize();
      const colour=rr()<0.13?lit:colourBase;
      addNeedleClump(centre,axis,seedBase+i*31,scale*(0.82+rr()*0.34),colour);
    }
  };

  // Level 1: irregular whorls around a single excurrent leader. The lower
  // scaffolds are long and pendulous; the upper ones shorten into a sharp cone.
  for(let tier=0;tier<tierCount;tier++){
    const tierRng=makeRng(tier,variant,2201);
    const t=THREE.MathUtils.clamp(0.075+(tier/(tierCount-1))*0.875+(tierRng()-0.5)*0.018,0.04,0.965);
    const y=treeHeight*t;
    const crownProfile=Math.pow(Math.max(0.015,1-t),shape.profile*0.88);
    const envelope=(0.10+3.72*crownProfile)*shape.width;
    const whorlPhase=tier*goldenAngle*0.19+tierRng()*0.18;
    const count=primaryBranches+(tierRng()<0.25?-1:tierRng()>0.78?1:0);
    const start=new THREE.Vector3(lean*t,y,0);
    for(let b=0;b<count;b++){
      const rng=makeRng(tier*37+b,variant,2309);
      if(rng()<0.045&&tier>2)continue;
      const az=whorlPhase+(b/count)*Math.PI*2+(rng()-0.5)*0.28;
      const radial=new THREE.Vector3(Math.cos(az),0,Math.sin(az));
      const side=new THREE.Vector3(-radial.z,0,radial.x);
      const branchLength=envelope*(0.76+rng()*0.27)*shape.twigScale;
      const branchStart=start.clone().add(new THREE.Vector3((rng()-0.5)*0.035, (rng()-0.5)*0.09, (rng()-0.5)*0.035));
      const branchEnd=branchStart.clone().addScaledVector(radial,branchLength);
      const lowerDroop=(1-t)*shape.droop;
      branchEnd.y-=branchLength*(0.018+lowerDroop*(0.13+rng()*0.11));
      const control=branchStart.clone().addScaledVector(radial,branchLength*(0.43+rng()*0.10))
        .addScaledVector(side,(rng()-0.5)*branchLength*0.11);
      control.y+=branchLength*(0.045+rng()*0.045)-lowerDroop*branchLength*0.08;
      const primary=new THREE.QuadraticBezierCurve3(branchStart,control,branchEnd);
      branchCurves.push(primary);
      const branchRadius=0.036*Math.pow(Math.max(0.08,1-t),0.72)+0.002;
      addTubeCurve(primary,branchRadius,0.0018,high?7:mid?4:2,high?5:3,bark,green);

      // Snow rests on selected upper-facing branch segments, not on every tier.
      if(rng()<0.12){
        const a=primary.getPointAt(0.34),bb=primary.getPointAt(0.61);
        addSnowCap(a,bb,side,0.0075*(1-t)+0.001,tier*101+b*7);
      }

      // Level 2: branchlets emerge along the upper and lateral sides of each
      // scaffold, with variable spacing and lengths. This is the key spruce silhouette.
      const secondaryCount=high?7:mid?4:3;
      for(let s=0;s<secondaryCount;s++){
        const sr=makeRng(tier*503+b*41+s,variant,2503);
        const u=0.10+((s+sr()*0.82)/secondaryCount)*0.84;
        const root=primary.getPointAt(u);
        const axis=primary.getTangentAt(u).normalize();
        const lateral=new THREE.Vector3().crossVectors(axis,up).normalize();
        if(lateral.lengthSq()<1e-5)lateral.copy(side);
        const sideSign=sr()<0.5?-1:1;
        const fan=0.28+sr()*0.48;
        const dir=axis.clone().multiplyScalar(0.30+sr()*0.20)
          .addScaledVector(radial,0.18+sr()*0.24)
          .addScaledVector(lateral,sideSign*fan)
          .addScaledVector(up,-(0.12+sr()*0.26)*(0.55+lowerDroop)).normalize();
        const twigLength=branchLength*(0.19+sr()*0.16)*(0.86+0.22*(1-t));
        const tip=root.clone().addScaledVector(dir,twigLength);
        tip.y-=twigLength*(0.045+sr()*0.12);
        const c=root.clone().lerp(tip,0.48+sr()*0.12)
          .addScaledVector(up,twigLength*(0.015+sr()*0.045))
          .addScaledVector(lateral,(sr()-0.5)*twigLength*0.22);
        const secondary=new THREE.QuadraticBezierCurve3(root,c,tip);
        addTubeCurve(secondary,0.0095*Math.pow(Math.max(0.1,1-t),0.35)+0.0008,0.00035,high?4:2,3,green,dark);

        // Dense needle sprays sit on the branchlet itself, with a heavier terminal tuft.
        const sprayCount=high?3:mid?2:2;
        addSpraysAlong(secondary,sprayCount,tier*10007+b*211+s*31,twigLength*shape.needleScale*0.46,green);
        addNeedleClump(tip,dir,tier*13001+b*307+s*47,
          twigLength*shape.needleScale*(0.54+sr()*0.10),sr()<0.22?lit:green);

        // Level 3: short asymmetric terminal shoots split off selected branchlets.
        if(high&&sr()<0.58){
          const forkCount=sr()<0.24?2:1;
          for(let f=0;f<forkCount;f++){
            const fr=makeRng(tier*17011+b*401+s*61+f,variant,2707);
            const forkU=0.34+fr()*0.40;
            const forkRoot=secondary.getPointAt(forkU);
            const forkAxis=secondary.getTangentAt(forkU).normalize();
            const forkSide=new THREE.Vector3().crossVectors(forkAxis,up).normalize();
            const forkDir=forkAxis.clone().multiplyScalar(0.36+fr()*0.18)
              .addScaledVector(forkSide,(f===0?-1:1)*(0.34+fr()*0.30))
              .addScaledVector(up,-(0.08+fr()*0.24)).normalize();
            const forkLength=twigLength*(0.24+fr()*0.19);
            const forkTip=forkRoot.clone().addScaledVector(forkDir,forkLength);
            forkTip.y-=forkLength*(0.04+fr()*0.10);
            const forkControl=forkRoot.clone().lerp(forkTip,0.52).addScaledVector(up,forkLength*0.025);
            const tertiary=new THREE.QuadraticBezierCurve3(forkRoot,forkControl,forkTip);
            addTubeCurve(tertiary,0.0035,0.00018,2,3,green,dark);
            addSpraysAlong(tertiary,2,tier*19001+b*503+s*71+f*11,forkLength*shape.needleScale*0.58,green);
            addNeedleClump(forkTip,forkDir,tier*23003+b*601+s*83+f*13,
              forkLength*shape.needleScale*0.55,fr()<0.20?lit:green);
          }
        }
      }
      // A restrained spray on the primary branch fills the inner bough without
      // turning the entire crown into disconnected spherical clumps.
      if(high)addSpraysAlong(primary,3,tier*29009+b*701,branchLength*shape.needleScale*0.23,green);
      else if(mid)addSpraysAlong(primary,2,tier*29009+b*701,branchLength*shape.needleScale*0.24,green);
      else addSpraysAlong(primary,2,tier*29009+b*701,branchLength*shape.needleScale*0.27,green);
    }
  }

  // The leader continues visibly through the crown. Sparse upward sprays at
  // its terminal section prevent a blunt or flat apex.
  const leaderA=new THREE.Vector3(lean*0.92,8.95,0),leaderB=trunkTop.clone().add(new THREE.Vector3(0,0.22,0));
  addTube(leaderA,leaderB,0.022,0.001,6,5,green,dark);
  const apexRng=makeRng(variant,73,2903);
  for(let i=0;i<(high?12:mid?7:3);i++){
    const az=apexRng()*Math.PI*2;
    const radial=new THREE.Vector3(Math.cos(az),0,Math.sin(az));
    const centre=new THREE.Vector3(lean,9.28+apexRng()*0.58,0).addScaledVector(radial,0.07+apexRng()*0.10);
    const axis=radial.multiplyScalar(0.35+apexRng()*0.22).addScaledVector(up,0.55+apexRng()*0.25).normalize();
    addNeedleClump(centre,axis,variant*31001+i*37,0.10+apexRng()*0.08,i%4===0?lit:green);
  }

  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setIndex([...woodIndices,...foliageIndices]);
  geometry.addGroup(0,woodIndices.length,0);
  geometry.addGroup(woodIndices.length,foliageIndices.length,1);
  geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
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
  const foliageAtlas=createSpruceFoliageAtlas();
  // Wood and foliage cannot share the alpha-tested material: distant alpha mip levels would
  // discard the tiny opaque UV patch used by branches, leaving only disconnected foliage cards.
  const wood=new THREE.MeshPhysicalNodeMaterial({
    roughness:0.94,metalness:0,vertexColors:true,side:THREE.DoubleSide,
    clearcoat:0.0,clearcoatRoughness:1,specularIntensity:0.06
  });
  wood.positionNode=positionLocal;
  const foliage=new THREE.MeshPhysicalNodeMaterial({
    map:foliageAtlas.map,alphaMap:foliageAtlas.alphaMap,alphaTest:0.22,alphaToCoverage:true,
    roughness:0.88,metalness:0,vertexColors:true,side:THREE.DoubleSide,
    clearcoat:0.0,clearcoatRoughness:1,specularIntensity:0.10
  });
  foliage.positionNode=positionLocal;
  foliage.emissiveNode=createPineBacklightNode();
  return [wood,foliage];
}

function createTreeInstanceBatch(trees,lod,variant,parent,castShadow=false,cellKey=''){
  if(!trees.length)return;
  const dummy=new THREE.Object3D(),geometry=forestSystem.geometries[lod][variant],material=forestSystem.splineMaterial;
  const mesh=new THREE.InstancedMesh(geometry,material,trees.length);
  mesh.name='Forest_'+lod+'_SnowSpruce_'+variant+(cellKey?'_'+cellKey:'');
  trees.forEach((tree,index)=>{
    dummy.position.set(tree.x,tree.y,tree.z);dummy.rotation.set(0,tree.rotation,0);
    const scale=tree.height/10,widthScale=THREE.MathUtils.clamp(tree.width/(tree.height*0.58),0.88,1.12);
    dummy.scale.set(scale*widthScale,scale,scale*widthScale);dummy.updateMatrix();
    mesh.setMatrixAt(index,dummy.matrix);mesh.setColorAt(index,tree.tint);
  });
  mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  mesh.castShadow=!!castShadow;mesh.receiveShadow=lod==='near';
  mesh.computeBoundingSphere();mesh.frustumCulled=true;
  parent.add(mesh);
}
function selectTreeLod(distance,current){
  // Hysteresis bands stop near/mid/far trees from swapping on camera micro-movements.
  if(!current){
    if(distance<85)return 'shadow';
    if(distance<165)return 'near';
    if(distance<620)return 'mid';
    return 'far';
  }
  if(current==='shadow'&&distance<105)return 'shadow';
  if(current==='near'&&distance>=70&&distance<205)return 'near';
  if(current==='mid'&&distance>=145&&distance<690)return 'mid';
  if(current==='far'&&distance>=570)return 'far';
  if(distance<70)return 'shadow';
  if(distance<145)return 'near';
  if(distance<570)return 'mid';
  return 'far';
}
function rebuildForestLod(force=false){
  if(!forestSystem)return;
  const cameraMoved=forestSystem.lastCamera.distanceToSquared(camera.position)>=625; // 25 m
  if(!force&&!cameraMoved)return;
  forestSystem.lastCamera.copy(camera.position);
  const cellSize=520,cells=new Map(),totals={shadow:0,near:0,mid:0,far:0};
  let lodChanges=0;
  for(const tree of forestSystem.trees){
    const dx=camera.position.x-tree.x,dy=camera.position.y-(tree.y+tree.height*0.5),dz=camera.position.z-tree.z;
    const distance=Math.sqrt(dx*dx+dy*dy+dz*dz);
    const previous=tree._forestLod||null;
    const lodKey=selectTreeLod(distance,previous);
    if(lodKey!==previous){lodChanges++;tree._forestLod=lodKey;}
    if(lodKey==='shadow'){totals.shadow++;totals.near++;}
    else if(lodKey==='near')totals.near++;
    else if(lodKey==='mid')totals.mid++;
    else totals.far++;
    const cx=Math.floor(tree.x/cellSize),cz=Math.floor(tree.z/cellSize),cellKey=cx+'_'+cz;
    let cell=cells.get(cellKey);
    if(!cell){cell={shadow:[[],[],[]],near:[[],[],[]],mid:[[],[],[]],far:[[],[],[]]};cells.set(cellKey,cell);}
    cell[lodKey][tree.variant].push(tree);
  }
  // Camera rotation alone never changes vegetation LOD. Avoid rebuilding every instance batch
  // while orbiting; only swap batches when a distance band is actually crossed.
  if(!force&&lodChanges===0)return;
  const nextGroup=new THREE.Group();
  nextGroup.name='GO_Procedural_SkiForest_V19';
  for(const [cellKey,cell] of cells)for(let variant=0;variant<3;variant++){
    createTreeInstanceBatch(cell.shadow[variant],'near',variant,nextGroup,true,cellKey);
    createTreeInstanceBatch(cell.near[variant],'near',variant,nextGroup,false,cellKey);
    createTreeInstanceBatch(cell.mid[variant],'mid',variant,nextGroup,false,cellKey);
    createTreeInstanceBatch(cell.far[variant],'far',variant,nextGroup,false,cellKey);
  }
  // Build off-scene, then swap in one operation so no blank-frame flash is exposed.
  const previousGroup=forestSystem.group;
  scene.add(nextGroup);
  if(previousGroup){
    for(const oldBatch of previousGroup.children)oldBatch.dispose?.();
    scene.remove(previousGroup);previousGroup.clear();
  }
  forestSystem.group=nextGroup;
  terrainInfoEl.textContent=forestSystem.trees.length.toLocaleString('ru-RU');
  forestSystem.lastLod={...totals,cells:cells.size,batches:nextGroup.children.length,lodChanges};
  const vertexCount={near:forestSystem.geometries.near.map(g=>g.attributes.position.count),
    mid:forestSystem.geometries.mid.map(g=>g.attributes.position.count),
    far:forestSystem.geometries.far.map(g=>g.attributes.position.count)};
  console.info('[Forest V19] Spatial LOD batches:',{placements:forestSystem.trees.length,counts:forestSystem.lastLod,verticesPerTree:vertexCount,cellSize,lodChanges});
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
  console.info('[Grade Optimizer WebGPU Forest V17] Stage 1 snow material:',{semanticMaterials,material:snowMaterial.name,removedLegacyTrees});
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.0));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.52;
  stage.appendChild(renderer.domElement);
  await renderer.init();
  // Configure WebGPU shadows after renderer initialisation, as in the r187 SunLight example.
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFShadowMap;
  sunLight.shadow.mapSize.setScalar(512);
  sunLight.shadow.camera.far=2200;
  sunLight.shadow.normalBias=0.035;
  sunLight.shadow.autoUpdate=true;
  camera.aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
  camera.updateProjectionMatrix();
  const isWebGPU = renderer.backend && renderer.backend.isWebGPUBackend === true;
  const backendLabel=isWebGPU?'WebGPU':'WebGL fallback';
  statusText.textContent = backendLabel+' · 1080p output · textured spruce cards · adaptive resolution';
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
  let dynamicResolutionScale=1;
  let frameTimeEMA=28;
  let lastResolutionDecision=performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const rawFrameMs=Math.min(now-previousTime,100);
    frameTimeEMA+=(rawFrameMs-frameTimeEMA)*0.12;
    const dt = Math.min(rawFrameMs / 1000, 0.05);
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
    // Wide hysteresis and a slower cadence keep internal resolution from oscillating,
    // which otherwise makes alpha-cut needle edges appear to shimmer.
    if(now-lastResolutionDecision>=1800){
      let nextScale=dynamicResolutionScale;
      if(frameTimeEMA>40)nextScale=Math.max(0.55,dynamicResolutionScale-(frameTimeEMA>55?0.08:0.045));
      else if(frameTimeEMA<21)nextScale=Math.min(1,dynamicResolutionScale+0.015);
      if(Math.abs(nextScale-dynamicResolutionScale)>0.001){
        dynamicResolutionScale=nextScale;
        atmosphere.setResolutionScale(dynamicResolutionScale);
        statusText.textContent=backendLabel+' · 1080p output · render '+Math.round(dynamicResolutionScale*100)+'% · stable foliage sampling';
      }
      lastResolutionDecision=now;
    }
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