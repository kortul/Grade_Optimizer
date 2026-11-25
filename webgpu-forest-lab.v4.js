import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { shareStageOneMaterialsByKind } from './stage-one-materials.v1.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { calculateSolarCycle, advanceSolarClock, createSolarDisc, updateSolarDisc } from './solar-cycle.v1.js';
import { createCloudLayer } from './webgpu-cloud-layer.v3.js';
import {
  exp, float, Fn, fwidth, getViewPosition, interleavedGradientNoise,
  isBackgroundDepth, Loop, pass, rtt, screenCoordinate, screenUV, smoothstep,
  texture3D, uniform, vec2, vec3, vec4, normalWorld, positionLocal, sin, cos, time, dot, max
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
  fogDensity: document.getElementById('fogDensity'), fogDensityValue: document.getElementById('fogDensityValue'),
  fogHeight: document.getElementById('fogHeight'), fogHeightValue: document.getElementById('fogHeightValue'),
  fogRange: document.getElementById('fogRange'), fogRangeValue: document.getElementById('fogRangeValue'),
  quality: document.getElementById('quality'),
  godRays: document.getElementById('godRays'), godRaysValue: document.getElementById('godRaysValue'),
  forestDensity: document.getElementById('forestDensity'), forestDensityValue: document.getElementById('forestDensityValue'),
  wind: document.getElementById('windSpeed'), windValue: document.getElementById('windSpeedValue'),
  leafTranslucency: document.getElementById('leafTranslucency'), leafTranslucencyValue: document.getElementById('leafTranslucencyValue')
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 1000000);
const hemisphere = new THREE.HemisphereLight(0xb6d6f2, 0x27332f, 0.28);
scene.add(hemisphere);
const sunLight = new THREE.DirectionalLight(0xfff8ef, 3.0);
sunLight.castShadow = true;
scene.add(sunLight, sunLight.target);
const moonLight = new THREE.DirectionalLight(0x9eb6dc, 0.16);
moonLight.castShadow = false;
scene.add(moonLight, moonLight.target);
const sky = new SkyMesh();
sky.scale.setScalar(450000);
sky.renderOrder = -1000;
sky.frustumCulled = false;
if (sky.material) {
  sky.material.depthWrite = false;
  sky.material.depthTest = false;
}
scene.add(sky);
const sunDisc=createSolarDisc(THREE);
scene.add(sunDisc);
const sunDirection = new THREE.Vector3();
const foliageSunDirection = uniform(new THREE.Vector3(0,1,0));
const foliageDaylight = uniform(1);
const foliageBacklight = uniform(0.82);
const foliageWind = uniform(1);
const slopeMarginNoise = new ImprovedNoise();
let renderer, renderPipeline, controls, groundLevel = 0, elapsed = 0;
let previousTime = performance.now(), fpsFrames = 0, fpsStart = performance.now(), terrainMeshCount = 0;
let terrainRoot=null, stageOneRoot=null, forestSystem=null, terrainBounds=null, terrainHeightLookup=null,pineAtlasTextures=null;
let fogPipeline,cloudLayer=null,dayCyclePlaying=false;
let solarState=null;

const noiseTexture = createNoiseTexture3D(64);
const fogDensity = uniform(Number(ui.fogDensity.value));
const fogHeight = uniform(Number(ui.fogHeight.value));
const fogStrength = uniform(Number(ui.fogStrength.value));
const windTime = uniform(0);
const cloudScale = uniform(0.0027);
const cloudThreshold = uniform(0.48);
const heightFalloff = uniform(1.65);
const maxRayDistance = uniform(4200);
const rangeFogNear = uniform(2200);
const rangeFogFar = uniform(9000);
const resolutionScale = uniform(0.42);
const marchSteps = uniform(18);
const spatialSigma = uniform(1.15);
const depthSensitivity = uniform(22);
const fogColor = uniform(new THREE.Color(0xc6dced));
let skyEnvironmentTexture=null;
let skyEnvironmentLastUpdate=0;
const skyEnvHorizon=new THREE.Color(0xc7d9e5);
const skyEnvZenith=new THREE.Color(0x4b79a6);
const skyEnvLower=new THREE.Color(0x53616b);
const skyEnvPixel=new THREE.Color();
const skyEnvDirection=new THREE.Vector3();
const skyEnvSunColor=new THREE.Color();
const daylightSunColor = new THREE.Color(0xfff8f1);
const lowSunColor = new THREE.Color(0xffc18e);
const liveSunColor = new THREE.Color();
const rayStrength=uniform(Number(ui.godRays.value));
const raySteps=uniform(12);
const rayResolutionScale=uniform(0.42);
const sunScreenUV=uniform(new THREE.Vector2(0.78,0.16));



function createNoiseTexture3D(size) {
  const data = new Uint8Array(size * size * size);
  const perlin = new ImprovedNoise();
  const v = new THREE.Vector3();
  let i = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    v.set(x, y, z).subScalar(size * 0.5).divideScalar(size);
    const edge = THREE.MathUtils.clamp(1 - v.length() * 0.30, 0.52, 1);
    const a = perlin.noise(x * 0.045, y * 0.045, z * 0.045);
    const b = perlin.noise(x * 0.091 + 17.2, y * 0.091 + 4.3, z * 0.091 - 8.1) * 0.34;
    data[i++] = Math.round(THREE.MathUtils.clamp((0.53 + a * 0.31 + b * 0.16) * edge, 0, 1) * 255);
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RedFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}
function formatTime(hours) {
  const total = Math.round((hours % 24) * 60);
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}
function updateSkyEnvironment(solar,force=false){
  if(!renderer||!solar)return;
  const now=performance.now();
  if(!force&&now-skyEnvironmentLastUpdate<2500)return;
  skyEnvironmentLastUpdate=now;
  const width=512,height=256;
  const count=width*height;
  if(!skyEnvironmentTexture){
    const data=new Uint16Array(count*4);
    skyEnvironmentTexture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat,THREE.HalfFloatType);
    skyEnvironmentTexture.name='GO_ForestLab_DynamicSkyIBL';
    skyEnvironmentTexture.mapping=THREE.EquirectangularReflectionMapping;
    skyEnvironmentTexture.colorSpace=THREE.LinearSRGBColorSpace;
    skyEnvironmentTexture.minFilter=THREE.LinearFilter;
    skyEnvironmentTexture.magFilter=THREE.LinearFilter;
    skyEnvironmentTexture.generateMipmaps=false;
    skyEnvironmentTexture.flipY=false;
  }
  const data=skyEnvironmentTexture.image.data;
  const sun=solar.sunDirection;
  skyEnvSunColor.copy(liveSunColor);
  for(let y=0;y<height;y++){
    const v=y/(height-1);
    // DataTexture row 0 is the bottom row: equirectangular +Y (zenith) must be at v=1.
    const elevation=(v-0.5)*Math.PI;
    const cosElevation=Math.cos(elevation);
    const skyBlend=THREE.MathUtils.smoothstep(Math.sin(elevation),-0.025,0.92);
    const groundBlend=THREE.MathUtils.smoothstep(Math.sin(elevation),-0.09,0.012);
    for(let x=0;x<width;x++){
      const azimuth=(x/width-0.5)*Math.PI*2;
      skyEnvDirection.set(cosElevation*Math.cos(azimuth),Math.sin(elevation),cosElevation*Math.sin(azimuth)).normalize();
      skyEnvPixel.copy(skyEnvHorizon).lerp(skyEnvZenith,skyBlend*0.93);
      skyEnvPixel.lerp(skyEnvLower,1-groundBlend);
      const sunDot=THREE.MathUtils.clamp(skyEnvDirection.dot(sun),-1,1);
      const angle=Math.acos(sunDot);
      const halo=Math.exp(-(angle*angle)/(2*0.105*0.105))*solar.daylight*0.20;
      const disc=solar.daylight>0.02?1-THREE.MathUtils.smoothstep(angle,0.0032,0.0068):0;
      const sunEnergy=disc*34*solar.daylight+halo*1.4;
      skyEnvPixel.r+=skyEnvSunColor.r*sunEnergy;
      skyEnvPixel.g+=skyEnvSunColor.g*sunEnergy;
      skyEnvPixel.b+=skyEnvSunColor.b*sunEnergy;
      const offset=(y*width+x)*4;
      data[offset]=THREE.DataUtils.toHalfFloat(Math.max(0,skyEnvPixel.r));
      data[offset+1]=THREE.DataUtils.toHalfFloat(Math.max(0,skyEnvPixel.g));
      data[offset+2]=THREE.DataUtils.toHalfFloat(Math.max(0,skyEnvPixel.b));
      data[offset+3]=THREE.DataUtils.toHalfFloat(1);
    }
  }
  skyEnvironmentTexture.needsUpdate=true;
  scene.environment=skyEnvironmentTexture;
  scene.environmentIntensity=0.72;
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
  sky.sunPosition.value.copy(sunDirection);
  sky.turbidity.value = Number(ui.turbidity.value);
  sky.rayleigh.value = Number(ui.rayleigh.value);
  sky.mieCoefficient.value = 0.0038;
  sky.mieDirectionalG.value = 0.78;
  // SkyMesh's built-in cloud sheet is disabled; the shared WeatherSystem v9 field is rendered in TSL.
  sky.cloudCoverage.value = 0;
  sky.cloudDensity.value = 0;
  sky.cloudElevation.value = 0;
  sky.showSunDisc.value = false;

  const directPower=THREE.MathUtils.clamp(Number(ui.sunIntensity.value),0,1.5);
  updateSolarDisc(THREE,sunDisc,camera,solar,directPower);
  // Keep the daytime key close to neutral; let it warm gradually only as the sun approaches the horizon.
  const warmKey = THREE.MathUtils.clamp(solar.twilight * 0.52, 0, 0.58);
  liveSunColor.copy(daylightSunColor).lerp(lowSunColor,warmKey);
  hemisphere.intensity = 0.025 + solar.daylight * 0.24 + solar.nightStrength*0.012;
  sunLight.intensity = solar.daylight * 3.5 * directPower;
  sunLight.color.copy(liveSunColor);
  moonLight.intensity=solar.nightStrength*0.16;
  sunLight.position.copy(controls.target).addScaledVector(sunDirection,1800);
  sunLight.target.position.copy(controls.target);
  moonLight.position.copy(controls.target).addScaledVector(sunDirection,-1800);
  moonLight.target.position.copy(controls.target);

  const nightSky=new THREE.Color(0x28364b);
  const daySky=new THREE.Color(0xc6dced);
  const warmHorizon=new THREE.Color(0xd8bba8);
  fogColor.value.copy(nightSky).lerp(daySky,solar.daylight)
    .lerp(warmHorizon,solar.twilight*0.18);
  // A cool sky fill and a darker, blue-green ground bounce keep shaded needles from going muddy.
  hemisphere.color.setRGB(
    0.30+solar.daylight*0.42,
    0.40+solar.daylight*0.43,
    0.56+solar.daylight*0.37
  );
  hemisphere.groundColor.setRGB(
    0.10+solar.daylight*0.12,
    0.13+solar.daylight*0.15,
    0.19+solar.daylight*0.20
  );
  cloudLayer?.setAtmosphere({
    coverage:Number(ui.cloudCoverage.value),density:Number(ui.cloudDensity.value),
    elevation:Number(ui.cloudElevation.value),wind:Number(ui.wind.value),daylight:solar.daylight,
    twilight:solar.twilight,rayStrength:Number(ui.godRays.value),sunDirection,sunColor:liveSunColor
  });
  updateSkyEnvironment(solar,forceEnvironment);
  ui.timeValue.textContent = formatTime(hours);
}
function setLoadingMessage(message){
  if(loading)loading.textContent=message;
}
function nextAnimationFrame(){
  return new Promise(resolve=>requestAnimationFrame(()=>resolve()));
}
function updateFogControls() {
  fogDensity.value = Number(ui.fogDensity.value);
  fogHeight.value = Number(ui.fogHeight.value);
  fogStrength.value = Number(ui.fogStrength.value);
  const range = Number(ui.fogRange.value);
  rangeFogNear.value = THREE.MathUtils.lerp(1500, 4200, range);
  rangeFogFar.value = THREE.MathUtils.lerp(6500, 12500, range);
  ui.fogDensityValue.textContent = fogDensity.value.toFixed(4);
  ui.fogHeightValue.textContent = Math.round(fogHeight.value) + ' м';
  ui.fogStrengthValue.textContent = Math.round(fogStrength.value * 100) + '%';
  ui.fogRangeValue.textContent = (rangeFogNear.value / 1000).toFixed(1) + '–' + (rangeFogFar.value / 1000).toFixed(1) + ' км';
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
  const material = new THREE.MeshStandardMaterial({ color: 0xe7eff4, vertexColors: usingFallback, roughness: 0.96, metalness: 0 });
  root.traverse(object => {
    if (!object.isMesh || !object.geometry || !object.geometry.attributes.position) return;
    terrainMeshCount++;
    object.material = material;
    object.castShadow = false;
    object.receiveShadow = true;
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
function buildFogPipeline() {
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  const sceneDepth = scenePass.getTextureNode('depth');
  const cameraWorld = uniform(camera.matrixWorld.clone());
  const projectionInverse = uniform(camera.projectionMatrixInverse.clone());
  const cameraPosition = uniform(camera.position.clone());
  const groundY = uniform(groundLevel);
  const time = uniform(0);
  const densityAt = Fn(([worldPosition]) => {
    const p = vec3(worldPosition.mul(cloudScale));
    const driftA = vec3(time.mul(0.0016), time.mul(0.00025), time.mul(0.0009));
    const driftB = vec3(time.mul(-0.00065), time.mul(0.00040), time.mul(0.00030));
    const n1 = texture3D(noiseTexture, p.add(driftA)).r;
    const n2 = texture3D(noiseTexture, p.mul(2.15).add(vec3(1.7, 0.9, 2.5)).add(driftB).add(n1.mul(0.32))).r;
    const noise = n1.mul(0.72).add(n2.mul(0.28));
    const relativeHeight = worldPosition.y.sub(groundY).div(fogHeight.max(0.01));
    const profile = float(1).sub(relativeHeight).clamp(0, 1).pow(heightFalloff);
    const turbulent = noise.sub(cloudThreshold).max(0).mul(1.4).add(0.08);
    return turbulent.mul(profile);
  });
  const fogNode = Fn(() => {
    const depth = sceneDepth.sample(screenUV).r;
    const viewPosition = getViewPosition(screenUV, depth, projectionInverse);
    const worldPosition = cameraWorld.mul(vec4(viewPosition, 1)).xyz;
    const rayVector = worldPosition.sub(cameraPosition);
    const surfaceDistance = rayVector.length();
    const rayDirection = rayVector.normalize();
    const safeY = rayDirection.y.greaterThanEqual(0).select(rayDirection.y.max(0.00001), rayDirection.y.min(-0.00001));
    const t0 = groundY.sub(cameraPosition.y).div(safeY);
    const t1 = groundY.add(fogHeight).sub(cameraPosition.y).div(safeY);
    const tStart = t0.min(t1).max(0);
    const tEnd = t0.max(t1).min(surfaceDistance).min(tStart.add(maxRayDistance));
    const segment = tEnd.sub(tStart).max(0);
    const stepSize = segment.div(marchSteps);
    const stepVector = rayDirection.mul(stepSize);
    const rayPoint = cameraPosition.add(rayDirection.mul(tStart)).add(stepVector.mul(interleavedGradientNoise(screenCoordinate.xy))).toVar();
    const opticalDepth = float(0).toVar();
    Loop(marchSteps, () => {
      opticalDepth.addAssign(densityAt(rayPoint).mul(stepSize).mul(fogDensity));
      rayPoint.addAssign(stepVector);
    });
    const volumeFog = float(1).sub(opticalDepth.negate().exp());
    // Beer-Lambert aerial perspective: low viewing rays cross more clean, neutral aerosol than steep rays.
    // Keep this independent of the sun-coloured god-ray pass so daylight haze never turns the forest brown.
    const distanceBeyond = surfaceDistance.sub(rangeFogNear).max(0);
    const rangeGate = smoothstep(rangeFogNear,rangeFogFar,surfaceDistance);
    const horizonPath = float(1).sub(rayDirection.y.abs()).pow(1.35);
    const pathScale = float(0.40).add(horizonPath.mul(0.80));
    const cameraAltitude = cameraPosition.y.sub(groundY).max(0);
    const surfaceAltitude = worldPosition.y.sub(groundY).max(0);
    const meanAltitude = cameraAltitude.add(surfaceAltitude).mul(0.5);
    const aerosolScaleHeight = fogHeight.mul(3.5).add(350);
    const altitudeDensity = exp(meanAltitude.negate().div(aerosolScaleHeight)).clamp(0.14,1);
    const extinction = fogDensity.mul(0.016).add(0.000004);
    const rangeOpticalDepth = distanceBeyond.mul(pathScale).mul(altitudeDensity).mul(extinction);
    const rangeFog = float(1).sub(rangeOpticalDepth.negate().exp()).mul(rangeGate);
    // Combine ground fog and distance haze as transmittances, not as competing max values.
    const amount = float(1).sub(float(1).sub(volumeFog).mul(float(1).sub(rangeFog)))
      .mul(fogStrength).clamp(0,1);
    return isBackgroundDepth(depth).select(float(0), amount);
  });
  const lowResFog = rtt(fogNode(), null, null, {
    type: THREE.UnsignedByteType,
    format: THREE.RedFormat,
    resolutionScale: resolutionScale.value
  }).setName('GO_LowResolutionVolumetricFog');
  const upsample = Fn(([fogTexture, depthTexture]) => {
    const uv = screenUV;
    const centreDepth = getViewPosition(uv, depthTexture.sample(uv).r, projectionInverse).z.negate().max(0.1);
    const texel = fwidth(uv).div(resolutionScale);
    const spatialFactor = float(-0.5).div(spatialSigma.mul(spatialSigma).max(0.01));
    const depthFactor = depthSensitivity.mul(depthSensitivity).mul(-0.5);
    const total = float(0).toVar(), weightTotal = float(0).toVar();
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const offset = vec2(float(x), float(y));
      const sampleUv = uv.add(offset.mul(texel));
      const spatialWeight = exp(offset.dot(offset).mul(spatialFactor));
      const sampleFog = fogTexture.sample(sampleUv);
      const sampleDepth = getViewPosition(sampleUv, depthTexture.sample(sampleUv).r, projectionInverse).z.negate().max(0.1);
      const depthDelta = sampleDepth.sub(centreDepth).div(centreDepth.max(0.1));
      const w = spatialWeight.mul(exp(depthDelta.mul(depthDelta).mul(depthFactor)));
      total.addAssign(sampleFog.mul(w));
      weightTotal.addAssign(w);
    }
    return total.div(weightTotal.max(0.0001));
  });
  const fogResult = upsample(lowResFog, sceneDepth);
  renderPipeline = new THREE.RenderPipeline(renderer);
  const rayNode=Fn(()=>{
    const uv=screenUV;
    const step=sunScreenUV.sub(uv).div(raySteps.max(1));
    const sampleUv=uv.add(step.mul(0.5)).add(interleavedGradientNoise(screenCoordinate.xy).mul(step)).toVar();
    const accumulation=float(0).toVar();
    const weight=float(1).toVar();
    Loop(raySteps,()=>{
      const sampleDepth=sceneDepth.sample(sampleUv).r;
      const sampleColor=sceneColor.sample(sampleUv).rgb;
      const luminance=sampleColor.dot(vec3(0.2126,0.7152,0.0722));
      const bright=smoothstep(float(0.48),float(1.55),luminance);
      const skyVisibility=isBackgroundDepth(sampleDepth).select(float(1),float(0.045));
      accumulation.addAssign(bright.mul(skyVisibility).mul(weight));
      weight.mulAssign(0.985);
      sampleUv.addAssign(step);
    });
    return accumulation.div(raySteps.max(1)).mul(rayStrength);
  });
  const lowResRays=rtt(rayNode(),null,null,{
    type:THREE.UnsignedByteType,
    format:THREE.RedFormat,
    resolutionScale:rayResolutionScale.value
  }).setName('GO_LowResolutionGodRays');
  const upsampleRays=Fn(([rayTexture,depthTexture])=>{
    const uv=screenUV;
    const centreDepth=getViewPosition(uv,depthTexture.sample(uv).r,projectionInverse).z.negate().max(0.1);
    const texel=fwidth(uv).div(rayResolutionScale);
    const spatialFactor=float(-0.5).div(spatialSigma.mul(spatialSigma).max(0.01));
    const depthFactor=depthSensitivity.mul(depthSensitivity).mul(-0.5);
    const total=float(0).toVar(),weightTotal=float(0).toVar();
    for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
      const offset=vec2(float(x),float(y));
      const sampleUv=uv.add(offset.mul(texel));
      const spatialWeight=exp(offset.dot(offset).mul(spatialFactor));
      const sampleRay=rayTexture.sample(sampleUv).r;
      const sampleDepth=getViewPosition(sampleUv,depthTexture.sample(sampleUv).r,projectionInverse).z.negate().max(0.1);
      const depthDelta=sampleDepth.sub(centreDepth).div(centreDepth.max(0.1));
      const w=spatialWeight.mul(exp(depthDelta.mul(depthDelta).mul(depthFactor)));
      total.addAssign(sampleRay.mul(w));
      weightTotal.addAssign(w);
    }
    return total.div(weightTotal.max(0.0001));
  });
  const raysResult=upsampleRays(lowResRays,sceneDepth);
  const foggedScene=sceneColor.rgb.mix(fogColor,fogResult);
  const shaftColour=vec3(0.92,0.96,1.0);
  renderPipeline.outputNode=foggedScene.add(shaftColour.mul(raysResult.mul(float(0.22).add(fogResult.mul(0.78)))));
  renderPipeline.needsUpdate = true;
  return {
    setResolution(value) { resolutionScale.value = value; lowResFog.setResolutionScale(value); },
    setSteps(value) { marchSteps.value = value; },
    setRaySteps(value) { raySteps.value = value; },
    setRayResolution(value) { rayResolutionScale.value=value; lowResRays.setResolutionScale(value); },
    setRayStrength(value) { rayStrength.value=value; },
    setTime(value) { time.value = value; },
    updateCamera(sunPosition) {
      cameraWorld.value.copy(camera.matrixWorld);
      projectionInverse.value.copy(camera.projectionMatrixInverse);
      cameraPosition.value.copy(camera.position);
      if(sunPosition){
        const projectedPoint=camera.position.clone().addScaledVector(sunPosition,100000);
        const projected=projectedPoint.project(camera);
        const visible=projected.z>-1&&projected.z<1&&Math.abs(projected.x)<1.35&&Math.abs(projected.y)<1.35;
        sunScreenUV.value.set(projected.x*0.5+0.5,0.5-projected.y*0.5);
        rayStrength.value=visible?Number(ui.godRays.value):0;
      }
    }
  };
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
  const colors=new Float32Array(positions.count*3);
  const low=new THREE.Color(0x203b2c),meadow=new THREE.Color(0x496444);
  const rock=new THREE.Color(0x777a72),snow=new THREE.Color(0xcbd5da),color=new THREE.Color();
  const verticalRange=Math.max(90,source.max.y-source.min.y+42);
  for(let i=0;i<positions.count;i++){
    const x=centerX+positions.getX(i),z=centerZ+positions.getZ(i);
    const sample=sampleSlopeMarginSurface(x,z,footprint,620);
    const y=sample?sample.y:source.min.y-34;
    positions.setY(i,y);
    const elevation=THREE.MathUtils.clamp((y-source.min.y+26)/verticalRange,0,1);
    color.copy(low).lerp(meadow,THREE.MathUtils.smoothstep(elevation,0.04,0.52));
    color.lerp(rock,THREE.MathUtils.smoothstep(elevation,0.40,0.83)*0.84);
    color.lerp(snow,THREE.MathUtils.smoothstep(elevation,0.80,1.0)*0.72);
    const k=i*3;colors[k]=color.r;colors[k+1]=color.g;colors[k+2]=color.b;
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.97,metalness:0});
  const ground=new THREE.Mesh(geometry,material);
  ground.name='GO_WebGPU_SlopeMargin_Terrain';
  ground.position.set(centerX,0,centerZ);
  ground.castShadow=false;ground.receiveShadow=true;
  terrainRoot=ground;terrainBounds=new THREE.Box3().setFromObject(ground);
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
  // Instanced spruce: curved woody skeleton, whorled branches and small 3D needle clumps.
  const positions=[],normals=[],colors=[],indices=[];
  const height=10,high=lod==='near';
  const levels=high?9:6,branchCount=high?7:5,branchSegments=high?5:3;
  const branchSides=high?5:4,needleSides=high?7:5;
  const profiles=high?[0.10,0.62,1.0,0.68,0.035]:[0.12,0.88,0.045];
  const dark=new THREE.Color(0x10271d),mid=new THREE.Color(0x244b30);
  const bright=new THREE.Color(0x3d7045),snow=new THREE.Color(0xe4edf2);
  const bark=new THREE.Color(0x493f35);
  const variantLength=[1.07,0.87,0.98][variant]||1;
  const lean=[0,-0.026,0.038][variant]||0;
  const jitter=(x,y=0)=>0.5+0.5*Math.sin(x*12.9898+y*78.233+variant*37.719);

  const addTube=(curve,radius,segments,sides,isTrunk=false)=>{
    const first=positions.length/3,points=curve.getPoints(segments);
    for(let i=0;i<=segments;i++){
      const t=i/segments,centre=points[i],tangent=curve.getTangent(t).normalize();
      const ref=Math.abs(tangent.y)<0.92?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);
      const u=ref.clone().cross(tangent).normalize(),v=tangent.clone().cross(u).normalize();
      const r=radius*Math.pow(1-t,1.18)+0.0025;
      for(let j=0;j<sides;j++){
        const angle=j/sides*Math.PI*2;
        const n=u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v,Math.sin(angle)).normalize();
        const p=centre.clone().addScaledVector(n,r);
        positions.push(p.x,p.y,p.z);normals.push(n.x,n.y,n.z);
        const k=isTrunk?0:THREE.MathUtils.clamp(t*1.25,0,0.72);
        colors.push(THREE.MathUtils.lerp(bark.r,dark.r,k),
          THREE.MathUtils.lerp(bark.g,dark.g,k),THREE.MathUtils.lerp(bark.b,dark.b,k));
      }
    }
    for(let i=0;i<segments;i++)for(let j=0;j<sides;j++){
      const q=first+i*sides+j,r=first+i*sides+(j+1)%sides;
      const s=first+(i+1)*sides+(j+1)%sides,t=first+(i+1)*sides+j;
      indices.push(q,r,t,r,s,t);
    }
  };

  const addClump=(origin,direction,length,width,seed,snowShare=0.16)=>{
    const axis=direction.clone().normalize();
    const ref=Math.abs(axis.y)<0.88?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);
    const sideA=ref.clone().cross(axis).normalize(),sideB=axis.clone().cross(sideA).normalize();
    const first=positions.length/3;
    for(let ring=0;ring<profiles.length;ring++){
      const t=ring/(profiles.length-1),centre=origin.clone().addScaledVector(axis,length*t);
      centre.y+=Math.sin(t*Math.PI)*length*0.045;
      for(let j=0;j<needleSides;j++){
        const angle=j/needleSides*Math.PI*2;
        const radial=sideA.clone().multiplyScalar(Math.cos(angle)).addScaledVector(sideB,Math.sin(angle)).normalize();
        const irregular=1+0.075*Math.sin(seed*2.7+angle*3+ring*1.8);
        const p=centre.clone().addScaledVector(radial,width*profiles[ring]*irregular);
        positions.push(p.x,p.y,p.z);
        const n=radial.clone().addScaledVector(axis,0.14-t*0.10).normalize();
        normals.push(n.x,n.y,n.z);
        const v=THREE.MathUtils.clamp(0.30+t*0.34+Math.max(0,radial.y)*0.20+(jitter(seed,j)-0.5)*0.12,0,1);
        let cr=THREE.MathUtils.lerp(dark.r,mid.r,v),cg=THREE.MathUtils.lerp(dark.g,mid.g,v),cb=THREE.MathUtils.lerp(dark.b,mid.b,v);
        const lift=THREE.MathUtils.clamp((radial.y+0.12)*0.24,0,0.22);
        cr=THREE.MathUtils.lerp(cr,bright.r,lift);cg=THREE.MathUtils.lerp(cg,bright.g,lift);cb=THREE.MathUtils.lerp(cb,bright.b,lift);
        const snowPatch=THREE.MathUtils.clamp((radial.y-0.43)*snowShare*(0.32+0.68*jitter(seed,ring*9+j)),0,0.19);
        colors.push(THREE.MathUtils.lerp(cr,snow.r,snowPatch),
          THREE.MathUtils.lerp(cg,snow.g,snowPatch),THREE.MathUtils.lerp(cb,snow.b,snowPatch));
      }
    }
    for(let ring=0;ring<profiles.length-1;ring++)for(let j=0;j<needleSides;j++){
      const q=first+ring*needleSides+j,r=first+ring*needleSides+(j+1)%needleSides;
      const s=first+(ring+1)*needleSides+(j+1)%needleSides,t=first+(ring+1)*needleSides+j;
      indices.push(q,r,t,r,s,t);
    }
    // Fine terminal sprays give each soft clump a broken, needle-like silhouette.
    const sprays=high?4:2;
    for(let k=0;k<sprays;k++){
      const angle=k/sprays*Math.PI*2+seed*0.71;
      const radial=sideA.clone().multiplyScalar(Math.cos(angle)).addScaledVector(sideB,Math.sin(angle));
      const p0=origin.clone().addScaledVector(axis,length*0.48).addScaledVector(radial,width*0.30);
      const p1=origin.clone().addScaledVector(axis,length*0.80).addScaledVector(radial,width*0.57);
      const p2=origin.clone().addScaledVector(axis,length*1.10).addScaledVector(radial,width*0.63);
      p2.y+=length*0.025;
      const direction=p2.clone().sub(p0).normalize();
      let lateral=direction.clone().cross(radial).normalize();
      if(lateral.lengthSq()<0.001)lateral=direction.clone().cross(ref).normalize();
      const w=width*(high?0.105:0.12),base=positions.length/3;
      const pts=[p0.clone().addScaledVector(lateral,-w),p1.clone().addScaledVector(lateral,-w*0.58),
        p2,p1.clone().addScaledVector(lateral,w*0.58),p0.clone().addScaledVector(lateral,w)];
      const n=lateral.clone().cross(direction).normalize(),mix=0.68+0.12*jitter(seed,k);
      for(const p of pts){
        positions.push(p.x,p.y,p.z);normals.push(n.x,n.y,n.z);
        colors.push(THREE.MathUtils.lerp(mid.r,bright.r,mix),
          THREE.MathUtils.lerp(mid.g,bright.g,mix),THREE.MathUtils.lerp(mid.b,bright.b,mix));
      }
      indices.push(base,base+1,base+2,base,base+2,base+3,base+3,base+2,base+4);
    }
  };

  const trunk=new THREE.CatmullRomCurve3([
    new THREE.Vector3(0,0,0),new THREE.Vector3(lean*0.35,height*0.30,0.012),
    new THREE.Vector3(lean*0.72,height*0.68,-0.012),new THREE.Vector3(lean,height,0)
  ]);
  addTube(trunk,0.135,10,7,true);

  for(let level=0;level<levels;level++){
    const t=high?0.105+(level/(levels-1))*0.845:0.145+(level/(levels-1))*0.79;
    const y=height*t,baseLength=height*(0.53*Math.pow(1-t,0.86)+0.045)*variantLength;
    const count=branchCount+((level+variant)%3===0?1:0);
    const phase=variant*0.73+level*0.47+Math.sin(level*1.8+variant)*0.11;
    for(let branch=0;branch<count;branch++){
      const angle=phase+branch/count*Math.PI*2;
      const radial=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
      const side=new THREE.Vector3(-radial.z,0,radial.x);
      const length=baseLength*(0.88+0.15*jitter(level,branch));
      const start=new THREE.Vector3(lean*t,y,0);
      const p1=start.clone().addScaledVector(radial,length*0.32);p1.y+=length*0.095;
      const p2=start.clone().addScaledVector(radial,length*0.70);p2.y-=length*0.025;
      const end=start.clone().addScaledVector(radial,length);end.y-=length*(0.13+(1-t)*0.06);
      const branchCurve=new THREE.CatmullRomCurve3([start,p1,p2,end]);
      addTube(branchCurve,0.067*(1-t*0.46),branchSegments,branchSides,false);

      const clusterU=high?[0.28,0.53,0.78]:[0.40,0.76];
      for(let c=0;c<clusterU.length;c++){
        const u=clusterU[c],point=branchCurve.getPoint(u);
        const axis=radial.clone().multiplyScalar(0.76).add(new THREE.Vector3(0,0.55,0)).normalize();
        addClump(point,axis,length*(high?0.235:0.25)*(1-u*0.12),
          length*(high?0.105:0.12)*(1-u*0.10),level*31+branch*7+c*3+variant,0.19);
      }

      const twigU=high?[0.37,0.67]:[0.52];
      for(let twig=0;twig<twigU.length;twig++){
        const u=twigU[twig],point=branchCurve.getPoint(u);
        const sign=((twig+branch+level+variant)%2===0)?1:-1;
        const direction=radial.clone().multiplyScalar(0.61)
          .addScaledVector(side,sign*0.46).add(new THREE.Vector3(0,0.56,0)).normalize();
        const twigLength=length*(high?0.24:0.21)*(1-u*0.20);
        const midPoint=point.clone().addScaledVector(direction,twigLength*0.52);midPoint.y+=twigLength*0.07;
        const tip=point.clone().addScaledVector(direction,twigLength);tip.y+=twigLength*0.025;
        const twigCurve=new THREE.CatmullRomCurve3([point,midPoint,tip]);
        addTube(twigCurve,0.027*(1-t*0.35),high?3:2,4,false);
        const leafAxis=direction.clone().add(new THREE.Vector3(0,0.18,0)).normalize();
        addClump(point.clone().lerp(tip,0.54),leafAxis,twigLength*0.70,twigLength*0.25,
          900+level*17+branch*5+twig+variant,0.16);
        addClump(tip,leafAxis,twigLength*0.48,twigLength*0.19,
          1300+level*13+branch*3+twig+variant,0.20);
      }
    }
  }
  const leaderStart=new THREE.Vector3(lean*0.9,height*0.82,0);
  const leaderEnd=new THREE.Vector3(lean,height*1.015,0.01);
  const leader=new THREE.CatmullRomCurve3([
    leaderStart,leaderStart.clone().lerp(leaderEnd,0.48).add(new THREE.Vector3(0,0.025,0)),leaderEnd
  ]);
  addTube(leader,0.035,4,5,false);
  addClump(leaderEnd,new THREE.Vector3(lean*0.05,1,0),height*0.13,height*0.055,1700+variant,0.12);

  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);geometry.computeBoundingBox();geometry.computeBoundingSphere();
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
  const material=new THREE.MeshStandardNodeMaterial({roughness:0.69,metalness:0,vertexColors:true,side:THREE.DoubleSide});
  const phase=positionLocal.x.mul(0.17).add(positionLocal.z.mul(0.13));
  const swayX=sin(time.mul(0.72).add(positionLocal.y.mul(0.52)).add(phase))
    .mul(positionLocal.y.mul(0.0075)).mul(foliageWind);
  const swayZ=cos(time.mul(0.61).add(positionLocal.y.mul(0.46)).add(phase.mul(1.31)))
    .mul(positionLocal.y.mul(0.0055)).mul(foliageWind);
  material.positionNode=positionLocal.add(vec3(swayX,0,swayZ));
  material.emissiveNode=createPineBacklightNode();
  return material;
}
function createPineAtlasMaterial(texture){
  const material=new THREE.MeshStandardNodeMaterial({map:texture,color:0xffffff,roughness:0.82,metalness:0,side:THREE.DoubleSide,alphaTest:0.12});
  material.emissiveNode=createPineBacklightNode();
  return material;
}

function createCrossBillboardGeometry(){
  const source=new THREE.PlaneGeometry(1,1),positions=[],normals=[],uvs=[],indices=[];
  for(let plane=0;plane<3;plane++){
    const g=source.clone();g.applyMatrix4(new THREE.Matrix4().makeRotationY(plane*Math.PI/3));
    const p=g.getAttribute('position'),n=g.getAttribute('normal'),uv=g.getAttribute('uv');
    const offset=positions.length/3;
    for(let i=0;i<p.count;i++){
      positions.push(p.getX(i),p.getY(i),p.getZ(i));
      normals.push(n.getX(i),n.getY(i),n.getZ(i));
      uvs.push(uv.getX(i),uv.getY(i));
    }
    const ix=g.getIndex();for(let i=0;i<ix.count;i++)indices.push(ix.getX(i)+offset);
    g.dispose();
  }
  source.dispose();
  const merged=new THREE.BufferGeometry();
  merged.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  merged.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  merged.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  merged.setIndex(indices);merged.computeBoundingSphere();
  return merged;
}

async function loadPineAtlas() {
  const atlas=await new THREE.TextureLoader().loadAsync('./assets/trees/snowy_conifer_atlas.webp');
  if(atlas.image.width!==1632||atlas.image.height!==1200){
    atlas.dispose();
    throw new Error('Unexpected spruce atlas dimensions.');
  }
  const cellWidth=Math.floor(atlas.image.width/4),cellHeight=Math.floor(atlas.image.height/2);
  const textures=[];
  for(let index=0;index<8;index++){
    const canvas=document.createElement('canvas');
    canvas.width=cellWidth;canvas.height=cellHeight;
    const context=canvas.getContext('2d');
    if(!context)throw new Error('Cannot create pine atlas canvas.');
    context.drawImage(atlas.image,(index%4)*cellWidth,Math.floor(index/4)*cellHeight,cellWidth,cellHeight,0,0,cellWidth,cellHeight);
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;
    texture.generateMipmaps=true;
    texture.minFilter=THREE.LinearMipmapLinearFilter;
    texture.magFilter=THREE.LinearFilter;
    const maxAnisotropy=typeof renderer.getMaxAnisotropy==='function'?renderer.getMaxAnisotropy():1;
    texture.anisotropy=Math.min(8,Math.max(1,maxAnisotropy));
    textures.push(texture);
  }
  atlas.dispose();
  return textures;
}

function createTreeInstanceBatch(trees, lod, variant, parent, castShadow=false) {
  if(!trees.length)return;
  const dummy=new THREE.Object3D();
  if(lod==='far'){
    const geometry=forestSystem.billboardGeometry;
    const material=forestSystem.billboardMaterials[variant%forestSystem.billboardMaterials.length];
    const mesh=new THREE.InstancedMesh(geometry,material,trees.length);
    mesh.name='Forest_Far_Billboards_'+variant;
    trees.forEach((tree,index)=>{
      const scale=tree.height*(0.92+0.12*Math.sin(tree.x*0.017+tree.z*0.011));
      dummy.position.set(tree.x,tree.y+scale*0.5,tree.z);
      dummy.rotation.set(0,Math.atan2(camera.position.x-tree.x,camera.position.z-tree.z),0);
      dummy.scale.set(scale*0.72,scale,scale*0.72);
      dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate=true;
    mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=false;
    parent.add(mesh);
    return;
  }
  const geometry=forestSystem.geometries[lod][variant];
  const material=forestSystem.splineMaterial;
  const mesh=new THREE.InstancedMesh(geometry,material,trees.length);
  mesh.name='Forest_'+lod+'_SplinePines_'+variant;
  trees.forEach((tree,index)=>{
    dummy.position.set(tree.x,tree.y,tree.z);
    dummy.rotation.set(0,tree.rotation,0);
    dummy.scale.setScalar(tree.height/10);
    dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);
    mesh.setColorAt(index,tree.tint);
  });
  mesh.instanceMatrix.needsUpdate=true;
  if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  mesh.frustumCulled=false;mesh.castShadow=!!castShadow&&lod==='near';mesh.receiveShadow=true;
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
  const near=[[],[],[]],nearShadow=[[],[],[]],mid=[[],[],[]],far=Array.from({length:8},()=>[]);
  const shadowLimitSq=650*650,nearLimitSq=850*850,midLimitSq=3300*3300;
  for(const tree of forestSystem.trees){
    const dx=camera.position.x-tree.x;
    const dy=camera.position.y-(tree.y+tree.height*0.5);
    const dz=camera.position.z-tree.z;
    const distanceSq=dx*dx+dy*dy+dz*dz;
    if(distanceSq<shadowLimitSq)nearShadow[tree.variant].push(tree);
    else if(distanceSq<nearLimitSq)near[tree.variant].push(tree);
    else if(distanceSq<midLimitSq)mid[tree.variant].push(tree);
    else far[tree.atlasVariant].push(tree);
  }
  for(let variant=0;variant<3;variant++){
    createTreeInstanceBatch(nearShadow[variant],'near',variant,forestSystem.group,true);
    createTreeInstanceBatch(near[variant],'near',variant,forestSystem.group,false);
    createTreeInstanceBatch(mid[variant],'mid',variant,forestSystem.group,false);
  }
  for(let variant=0;variant<8;variant++){
    createTreeInstanceBatch(far[variant],'far',variant,forestSystem.group);
  }
  terrainInfoEl.textContent=forestSystem.trees.length.toLocaleString('ru-RU');
  forestSystem.lastLod={
    shadow:nearShadow.reduce((sum,items)=>sum+items.length,0),
    near:near.reduce((sum,items)=>sum+items.length,0),
    mid:mid.reduce((sum,items)=>sum+items.length,0),
    far:far.reduce((sum,items)=>sum+items.length,0)
  };
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
  restoreStageOneCoordinates(root,item);
  // Keep the authored Slopes / AngledSlopes material groups from Maya; never replace the asset with a flat grey override.
  const semanticMaterials=shareStageOneMaterialsByKind(root,{defaultKind:'slopes'});
  const pbrMaterials=new Map();
  const makeStageOnePbrMaterial=(source)=>{
    if(!source)return source;
    if(pbrMaterials.has(source))return pbrMaterials.get(source);
    const kind=String(source.userData?.gradeOptimizerStageOneSurfaceKind||source.name||'slopes').toLowerCase();
    const angled=kind.includes('angled');
    const sourceRoughness=Number(source.roughness);
    const phongShininess=Number(source.shininess);
    const phongRoughness=Number.isFinite(sourceRoughness)
      ?THREE.MathUtils.clamp(sourceRoughness,0.38,0.92)
      :Number.isFinite(phongShininess)&&phongShininess>0
        ?THREE.MathUtils.clamp(Math.sqrt(2/(phongShininess+2)),0.48,0.88)
        :(angled?0.48:0.70);
    const material=new THREE.MeshPhysicalMaterial({
      name:source.name|| (angled?'AngledSlopes':'Slopes'),
      color:source.color?.clone?.()||new THREE.Color(0xffffff),
      map:source.map||null,
      alphaMap:source.alphaMap||null,
      aoMap:source.aoMap||null,
      lightMap:source.lightMap||null,
      emissive:source.emissive?.clone?.()||new THREE.Color(0x000000),
      emissiveMap:source.emissiveMap||null,
      normalMap:source.normalMap||null,
      normalScale:source.normalScale?.clone?.()||new THREE.Vector2(1,1),
      bumpMap:source.bumpMap||null,
      bumpScale:Number.isFinite(source.bumpScale)?source.bumpScale:1,
      displacementMap:source.displacementMap||null,
      displacementScale:Number.isFinite(source.displacementScale)?source.displacementScale:1,
      displacementBias:Number.isFinite(source.displacementBias)?source.displacementBias:0,
      roughnessMap:source.roughnessMap||null,
      metalnessMap:source.metalnessMap||null,
      roughness:source.roughnessMap?1:phongRoughness,
      metalness:0,
      clearcoat:angled?0.20:0.10,
      clearcoatRoughness:angled?0.30:0.42,
      vertexColors:!!source.vertexColors,
      side:source.side??THREE.FrontSide,
      transparent:!!source.transparent,
      opacity:Number.isFinite(source.opacity)?source.opacity:1,
      alphaTest:Number.isFinite(source.alphaTest)?source.alphaTest:0,
      depthWrite:source.depthWrite!==false,
      flatShading:!!source.flatShading,
      fog:true
    });
    material.userData={...(source.userData||{}),gradeOptimizerPbrSourceMaterial:source.name||source.type||'Material'};
    if(source.emissiveIntensity!==undefined)material.emissiveIntensity=source.emissiveIntensity;
    if(source.aoMapIntensity!==undefined)material.aoMapIntensity=source.aoMapIntensity;
    if(source.lightMapIntensity!==undefined)material.lightMapIntensity=source.lightMapIntensity;
    pbrMaterials.set(source,material);
    return material;
  };
  let slopeMeshCount=0;
  root.traverse(object=>{
    if(!object.isMesh||!object.geometry?.attributes?.position)return;
    object.material=Array.isArray(object.material)
      ?object.material.map(makeStageOnePbrMaterial)
      :makeStageOnePbrMaterial(object.material);
    object.castShadow=true;
    object.receiveShadow=true;
    slopeMeshCount++;
  });
  console.info('[Grade Optimizer WebGPU Forest] Preserved Stage 1 material identities:',semanticMaterials);
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
  setLoadingMessage('Загружаем atlas елей…');
  await nextAnimationFrame();
  pineAtlasTextures=await loadPineAtlas();
  setLoadingMessage('Распределяем деревья по рельефу…');
  await nextAnimationFrame();
  const trees=buildTreePlacements(footprint,Number(ui.forestDensity.value));
  trees.forEach(tree=>{tree.atlasVariant=Math.floor(seededRandom(tree.x,tree.z,83)()*8);});
  const geometries={near:[],mid:[]};
  for(let variant=0;variant<3;variant++){
    geometries.near.push(createSplinePineGeometry('near',variant));
    geometries.mid.push(createSplinePineGeometry('mid',variant));
  }
  const billboardMaterials=pineAtlasTextures.map(texture=>createPineAtlasMaterial(texture));
  forestSystem={
    trees,footprint,geometries,billboardMaterials,
    billboardGeometry:createCrossBillboardGeometry(),
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
  console.info('[Grade Optimizer WebGPU] Alpine procedural forest:',{
    slopeMeshes:slopeMeshCount,projectedTriangles:footprint.triangles.length,
    boundaryEdges:footprint.edges.length,trees:trees.length,forestLOD:forestSystem.lastLod
  });
  return {slopeMeshCount,treeCount:trees.length};
}

function rebuildForestDensity() {
  if(!stageOneRoot)return;
  const footprint=forestSystem?.footprint||buildSlopeFootprint(stageOneRoot);
  const trees=buildTreePlacements(footprint,Number(ui.forestDensity.value));
  trees.forEach(tree=>{tree.atlasVariant=Math.floor(seededRandom(tree.x,tree.z,83)()*8);});
  if(forestSystem){
    forestSystem.group.clear();
    forestSystem.trees=trees;
    forestSystem.lastCamera.set(Infinity,Infinity,Infinity);
    rebuildForestLod(true);
  }
}

function applyQualityProfile(name) {
  const profiles = {
    performance: { pixelRatio: 1.0, fogResolution: 0.30, steps: 10, rayResolution:0.28, raySteps:7 },
    balanced: { pixelRatio: 1.3, fogResolution: 0.42, steps: 18, rayResolution:0.42, raySteps:12 },
    cinematic: { pixelRatio: 1.6, fogResolution: 0.55, steps: 28, rayResolution:0.58, raySteps:18 }
  };
  const profile = profiles[name] || profiles.balanced;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatio));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  fogPipeline.setResolution(profile.fogResolution);
  fogPipeline.setSteps(profile.steps);
  fogPipeline.setRayResolution(profile.rayResolution);
  fogPipeline.setRaySteps(profile.raySteps);
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
  [ui.fogStrength, ui.fogDensity, ui.fogHeight, ui.fogRange].forEach(input => input.addEventListener('input', updateFogControls));
  ui.godRays.addEventListener('input',()=>{
    ui.godRaysValue.textContent=Math.round(Number(ui.godRays.value)*100)+'%';
    if(fogPipeline)fogPipeline.setRayStrength(Number(ui.godRays.value));
  });
  ui.forestDensity.addEventListener('input',()=>ui.forestDensityValue.textContent=Math.round(Number(ui.forestDensity.value)*100)+'%');
  ui.forestDensity.addEventListener('change',rebuildForestDensity);
  ui.wind.addEventListener('input',()=>{updateSkyLabels();foliageWind.value=Number(ui.wind.value)/9;updateSky();});
  ui.leafTranslucency.addEventListener('input',()=>{updateSkyLabels();foliageBacklight.value=Number(ui.leafTranslucency.value);});
  ui.quality.addEventListener('change', () => applyQualityProfile(ui.quality.value));
  updateSkyLabels();
  syncDayCycleButton();
}
async function start() {
  renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  sunLight.shadow.mapSize.set(4096,4096);
  sunLight.shadow.camera.left=-1450;sunLight.shadow.camera.right=1450;
  sunLight.shadow.camera.top=1450;sunLight.shadow.camera.bottom=-1450;
  sunLight.shadow.camera.near=1;sunLight.shadow.camera.far=6500;
  sunLight.shadow.bias=-0.00006;sunLight.shadow.normalBias=0.018;sunLight.shadow.radius=2;
  sunLight.shadow.autoUpdate=true;
  sunLight.shadow.camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.3));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.86;
  stage.appendChild(renderer.domElement);
  await renderer.init();
  camera.aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
  camera.updateProjectionMatrix();
  const isWebGPU = renderer.backend && renderer.backend.isWebGPUBackend === true;
  statusText.textContent = isWebGPU ? 'WebGPU backend активен · TSL · forest LOD · god rays' : 'WebGL 2 fallback активен · TSL pipeline';
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
  cloudLayer=createCloudLayer(THREE,scene,{center:terrainBounds.getCenter(new THREE.Vector3())});
  updateSkyLabels();
  ui.godRaysValue.textContent=Math.round(Number(ui.godRays.value)*100)+'%';
  ui.forestDensityValue.textContent=Math.round(Number(ui.forestDensity.value)*100)+'%';
  updateSky();
  updateFogControls();
  fogPipeline = buildFogPipeline();
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
    sky.position.copy(camera.position);
    fogPipeline.setTime(elapsed);
    cloudLayer?.setTime(elapsed);
    cloudLayer?.updateCamera(camera.position);
    fogPipeline.updateCamera(sunDirection);
    rebuildForestLod(false);
    renderPipeline.render();
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