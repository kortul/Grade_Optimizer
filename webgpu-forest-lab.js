import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { calculateSolarCycle, advanceSolarClock, createSolarDisc, updateSolarDisc } from './solar-cycle.v1.js';
import {
  exp, float, Fn, fwidth, getViewPosition, interleavedGradientNoise,
  isBackgroundDepth, Loop, pass, rtt, screenCoordinate, screenUV, smoothstep,
  texture3D, uniform, vec2, vec3, vec4, positionLocal, sin, cos, time
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
  forestDensity: document.getElementById('forestDensity'), forestDensityValue: document.getElementById('forestDensityValue')
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 1000000);
const hemisphere = new THREE.HemisphereLight(0xc8e2ff, 0x4c5149, 0.8);
scene.add(hemisphere);
const sunLight = new THREE.DirectionalLight(0xfff0df, 1.8);
sunLight.castShadow = false;
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
let renderer, renderPipeline, controls, groundLevel = 0, elapsed = 0;
let previousTime = performance.now(), fpsFrames = 0, fpsStart = performance.now(), terrainMeshCount = 0;
let terrainRoot=null, stageOneRoot=null, forestSystem=null, terrainBounds=null, terrainHeightLookup=null,pineAtlasTextures=null;
let fogPipeline,dayCyclePlaying=false;
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
const fogColor = uniform(new THREE.Color(0xc7d9e5));
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
function updateSkyLabels() {
  ui.turbidityValue.textContent = Number(ui.turbidity.value).toFixed(1);
  ui.rayleighValue.textContent = Number(ui.rayleigh.value).toFixed(2);
  ui.cloudCoverageValue.textContent = Math.round(Number(ui.cloudCoverage.value) * 100) + '%';
  ui.cloudDensityValue.textContent = Math.round(Number(ui.cloudDensity.value) * 100) + '%';
  ui.cloudElevationValue.textContent = Math.round(Number(ui.cloudElevation.value) * 100) + '%';
  ui.sunIntensityValue.textContent = Math.round(Number(ui.sunIntensity.value)*100)+'%';
  ui.dayCycleLengthValue.textContent = Math.round(Number(ui.dayLength.value))+' мин';
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
function updateSky() {
  const hours = Number(ui.time.value);
  const solar = calculateSolarCycle(THREE,hours);
  solarState=solar;
  sunDirection.copy(solar.sunDirection);
  sky.sunPosition.value.copy(sunDirection);
  sky.turbidity.value = Number(ui.turbidity.value);
  sky.rayleigh.value = Number(ui.rayleigh.value);
  sky.mieCoefficient.value = 0.0038;
  sky.mieDirectionalG.value = 0.78;
  sky.mieColor.value.setRGB(1,0.99,0.96);
  sky.mieAlbedo.value.setRGB(1,1,1);
  sky.sunSize.value = 0.88;
  sky.cloudCoverage.value = Number(ui.cloudCoverage.value);
  sky.cloudDensity.value = Number(ui.cloudDensity.value);
  sky.cloudElevation.value = Number(ui.cloudElevation.value);
  sky.showSunDisc.value = false;

  const directPower=THREE.MathUtils.clamp(Number(ui.sunIntensity.value),0,1.5);
  updateSolarDisc(THREE,sunDisc,camera,solar,directPower);
  hemisphere.intensity = 0.18 + solar.daylight * 0.62 + solar.nightStrength*0.025;
  sunLight.intensity = solar.daylight * 3.0 * directPower;
  sunLight.color.copy(solar.sunColor);
  moonLight.intensity=solar.nightStrength*0.16;
  sunLight.position.copy(controls.target).addScaledVector(sunDirection,1800);
  sunLight.target.position.copy(controls.target);
  moonLight.position.copy(controls.target).addScaledVector(sunDirection,-1800);
  moonLight.target.position.copy(controls.target);

  const nightSky=new THREE.Color(0x28364b);
  const daySky=new THREE.Color(0xc7d9e7);
  const warmHorizon=new THREE.Color(0xd8b39a);
  fogColor.value.copy(nightSky).lerp(daySky,solar.daylight)
    .lerp(warmHorizon,solar.twilight*0.28);
  hemisphere.color.setRGB(
    0.34+solar.daylight*0.44,
    0.43+solar.daylight*0.43,
    0.58+solar.daylight*0.34
  );
  hemisphere.groundColor.setRGB(
    0.13+solar.daylight*0.28,
    0.16+solar.daylight*0.30,
    0.20+solar.daylight*0.26
  );
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

async function loadRealTerrain() {
  setLoadingMessage('Загружаем базовый рельеф…');
  await nextAnimationFrame();
  const responses = await Promise.all([
    fetch('./assets/real-terrain.json', { cache: 'no-cache' }).then(response => {
      if (!response.ok) throw new Error('Не удалось загрузить real-terrain.json (' + response.status + ')');
      return response.json();
    }),
    new FBXLoader().loadAsync('./assets/real-terrain.fbx')
  ]);
  const manifest = responses[0], root = responses[1];
  const metersPerUnit = Number(manifest && manifest.mayaExport && manifest.mayaExport.metersPerUnit || 0.01);
  if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0 || metersPerUnit > 1) throw new Error('Некорректный metersPerUnit в real-terrain.json');
  root.scale.multiplyScalar(metersPerUnit);
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || size.x < 10 || size.z < 10) throw new Error('FBX рельеф не содержит корректную геометрию.');
  const material = new THREE.MeshStandardMaterial({ color: 0xe7eff4, roughness: 0.96, metalness: 0 });
  root.traverse(object => {
    if (!object.isMesh || !object.geometry || !object.geometry.attributes.position) return;
    terrainMeshCount++;
    object.material = material;
    object.castShadow = false;
    object.receiveShadow = false;
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
  terrainInfoEl.textContent = terrainMeshCount + ' mesh';
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
    const rangeT = surfaceDistance.sub(rangeFogNear).div(rangeFogFar.sub(rangeFogNear).max(0.001)).clamp(0, 1);
    const rangeFog = rangeT.mul(rangeT); // Ease into distance haze instead of fogging the whole frame at mid-range.
    const amount = volumeFog.max(rangeFog).mul(fogStrength).clamp(0, 1);
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
  const shaftColour=vec3(1.0,0.86,0.67);
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
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const keyPoint = p => Math.round(p.x * 4) + ',' + Math.round(p.z * 4);
  const addEdge = (p0, p1) => {
    const k0 = keyPoint(p0), k1 = keyPoint(p1);
    if (k0 === k1) return;
    const key = k0 < k1 ? k0 + '|' + k1 : k1 + '|' + k0;
    const existing = edgeMap.get(key);
    if (existing) existing.count++;
    else edgeMap.set(key, {ax:p0.x,az:p0.z,bx:p1.x,bz:p1.z,count:1});
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
  const cellKey = (x,z) => Math.floor(x/cellSize)+':'+Math.floor(z/cellSize);
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
    const ix=Math.floor(x/cellSize),iz=Math.floor(z/cellSize);
    const bucket=cells.get(ix+':'+iz)||[];
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
  return {triangles,edges,contains};
}

function restoreStageOneCoordinates(root, item) {
  // Mirror the production FBX import order: normalize the Maya ToSketchfab
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
  if(!terrainRoot||!terrainBounds||!terrainHeightLookup)return [];
  const occupied=new Map();
  const trees=[];
  const rows=[
    {min:7,max:21,keep:0.94,spacing:7.2},
    {min:22,max:68,keep:0.72,spacing:9.0},
    {min:70,max:132,keep:0.38,spacing:11.5}
  ];
  const sampleStep=9.5;
  const spacingCell=12;
  const randCache=new Map();
  const randomAt=(x,z,salt)=>{
    const key=Math.round(x*2)+':'+Math.round(z*2)+':'+salt;
    if(randCache.has(key))return randCache.get(key);
    const value=seededRandom(x,z,salt)();
    randCache.set(key,value);
    return value;
  };
  const findGround=(x,z)=>{
    const surface=sampleTerrainSurface(x,z,terrainHeightLookup);
    if(!surface||surface.normalY<0.48)return null;
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
  const baseBounds=terrainBounds;
  let attempt=0;
  for(const edge of footprint.edges){
    const dx=edge.bx-edge.ax,dz=edge.bz-edge.az;
    const length=Math.hypot(dx,dz);
    if(length<4||length>180)continue;
    const steps=Math.max(1,Math.ceil(length/sampleStep));
    const nx=-dz/length,nz=dx/length;
    const tx=dx/length,tz=dz/length;
    for(let step=0;step<steps;step++){
      const u=(step+0.5)/steps;
      const jitter=(randomAt(edge.ax+u*dx,edge.az+u*dz,7)-0.5)*sampleStep*0.46;
      const mx=edge.ax+dx*u+tx*jitter;
      const mz=edge.az+dz*u+tz*jitter;
      const sideA=footprint.contains(mx+nx*2.2,mz+nz*2.2);
      const sideB=footprint.contains(mx-nx*2.2,mz-nz*2.2);
      if(sideA&&sideB)continue;
      const sign=sideA?-1:sideB?1:(randomAt(mx,mz,9)<0.5?-1:1);
      for(let row=0;row<rows.length;row++){
        const band=rows[row];
        const rng=randomAt(mx,mz,13+row);
        if(rng>density*band.keep)continue;
        const offset=band.min+(band.max-band.min)*randomAt(mx,mz,21+row);
        const x=mx+nx*sign*offset+(randomAt(mx,mz,31+row)-0.5)*3.5;
        const z=mz+nz*sign*offset+(randomAt(mx,mz,41+row)-0.5)*3.5;
        if(x<baseBounds.min.x+2||x>baseBounds.max.x-2||z<baseBounds.min.z+2||z>baseBounds.max.z-2)continue;
        if(footprint.contains(x,z))continue;
        const spacing=band.spacing;
        if(!canPlace(x,z,spacing))continue;
        const ground=findGround(x,z);
        if(!ground)continue;
        const rr=seededRandom(x,z,53);
        const height=6.0+rr()*5.6;
        const variant=Math.floor(rr()*3);
        const hue=(rr()-0.5)*0.045;
        const tint=new THREE.Color().setHSL(0.31+hue,0.28+rr()*0.12,0.39+rr()*0.08);
        trees.push({
          x,y:ground.y+0.05,z,height,width:height*(0.52+rr()*0.12),
          rotation:rr()*Math.PI*2,variant,tint,band:row
        });
        attempt++;
        if(trees.length>=2600)return trees;
      }
    }
  }
  console.info('[Grade Optimizer WebGPU] Slope-edge forest:',{boundaryEdges:footprint.edges.length,triangles:footprint.triangles.length,placements:trees.length,attempts:attempt});
  return trees;
}

function createSplinePineGeometry(lod, variant) {
  const positions=[],normals=[],colors=[],indices=[];
  const height=10;
  const high=lod==='near';
  const levels=high?8:5;
  const branchCount=high?7:5;
  const branchSegments=high?5:3;
  const twigLayers=high?3:1;
  const sides=high?5:4;
  const greenA=new THREE.Color(0x142d22);
  const greenB=new THREE.Color(0x315a3b);
  const snow=new THREE.Color(0xe4edf2);
  const trunkColor=new THREE.Color(0x493f35);
  const addBlade=(base,direction,length,width,shade=0)=>{
    const dir=direction.clone().normalize();
    const side=new THREE.Vector3(-dir.z,0,dir.x).normalize();
    const root=base.clone();
    const left=root.clone().addScaledVector(side,-width*0.5);
    const right=root.clone().addScaledVector(side,width*0.5);
    const tip=root.clone().addScaledVector(dir,length);
    tip.y+=length*0.11;
    const centre=root.clone().addScaledVector(dir,length*0.35).add(new THREE.Vector3(0,width*0.10,0));
    const first=positions.length/3;
    const points=[left,centre,tip,right];
    const normal=side.clone().cross(dir).normalize();
    const baseColour=greenA.clone().lerp(greenB,0.34+shade*0.16);
    const snowFactor=THREE.MathUtils.clamp(0.08+dir.y*0.34+shade*0.28,0,0.56);
    const colour=baseColour.lerp(snow,snowFactor);
    for(let i=0;i<points.length;i++){
      const p=points[i];
      positions.push(p.x,p.y,p.z);
      normals.push(normal.x,normal.y,normal.z);
      const variation=i===2?1.10:i===1?1.04:0.92;
      colors.push(colour.r*variation,colour.g*variation,colour.b*variation);
    }
    indices.push(first,first+1,first+2,first+1,first+3,first+2);
  };
  const addTube=(curve,radius,segments,ringSides,isTrunk=false)=>{
    const startIndex=positions.length/3;
    const curvePoints=curve.getPoints(segments);
    for(let i=0;i<=segments;i++){
      const t=i/segments;
      const centre=curvePoints[i];
      const tangent=curve.getTangent(t).normalize();
      const reference=Math.abs(tangent.y)<0.92?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);
      const axisA=reference.clone().cross(tangent).normalize();
      const axisB=tangent.clone().cross(axisA).normalize();
      const r=radius*Math.pow(1-t,1.25)+0.0035;
      for(let j=0;j<ringSides;j++){
        const angle=j/ringSides*Math.PI*2;
        const normal=axisA.clone().multiplyScalar(Math.cos(angle)).addScaledVector(axisB,Math.sin(angle)).normalize();
        const point=centre.clone().addScaledVector(normal,r);
        positions.push(point.x,point.y,point.z);
        normals.push(normal.x,normal.y,normal.z);
        let colour;
        if(isTrunk)colour=trunkColor;
        else{
          const variation=0.5+0.5*Math.sin(angle*2.0+variant*1.9+t*7.0);
          colour=greenA.clone().lerp(greenB,0.25+variation*0.40);
          const snowFactor=THREE.MathUtils.clamp((normal.y*0.40)+(point.y/height-0.28)*0.44-0.05,0,0.68);
          colour.lerp(snow,snowFactor);
        }
        colors.push(colour.r,colour.g,colour.b);
      }
    }
    for(let i=0;i<segments;i++){
      for(let j=0;j<ringSides;j++){
        const a=startIndex+i*ringSides+j;
        const b=startIndex+i*ringSides+(j+1)%ringSides;
        const c=startIndex+(i+1)*ringSides+(j+1)%ringSides;
        const d=startIndex+(i+1)*ringSides+j;
        indices.push(a,b,d,b,c,d);
      }
    }
  };
  const trunkCurve=new THREE.CatmullRomCurve3([
    new THREE.Vector3(0,0,0),new THREE.Vector3(0.02,height*0.36,0),
    new THREE.Vector3(-0.015,height*0.72,0),new THREE.Vector3(0,height,0)
  ]);
  addTube(trunkCurve,0.11,6,6,true);
  const variantLength=[1.06,0.82,0.96][variant]||1;
  const variantLean=[0.0,-0.015,0.035][variant]||0;
  for(let level=0;level<levels;level++){
    const t=0.13+(level/(levels-1))*0.82;
    const y=height*t;
    const baseLength=(height*(0.42*Math.pow(1-t,0.83)+0.045))*variantLength;
    const count=branchCount+(level%2===variant%2?1:0);
    const phase=variant*0.77+level*0.31;
    for(let branch=0;branch<count;branch++){
      const angle=phase+branch/ count*Math.PI*2;
      const length=baseLength*(0.84+0.16*Math.sin(branch*4.1+level*1.9+variant));
      const start=new THREE.Vector3(variantLean*t,y,0);
      const radial=new THREE.Vector3(Math.cos(angle),0,Math.sin(angle));
      const controlA=start.clone().addScaledVector(radial,length*0.36);controlA.y-=length*0.10;
      const controlB=start.clone().addScaledVector(radial,length*0.76);controlB.y-=length*0.29;
      const end=start.clone().addScaledVector(radial,length);end.y-=length*0.22;
      const curve=new THREE.CatmullRomCurve3([start,controlA,controlB,end]);
      addTube(curve,0.060*(1-t*0.42),branchSegments,sides,false);
      // Dense, tapered needle sprays sit on each curved branch. Near LOD gets
      // four clusters per branch; mid LOD keeps two broader silhouette clusters.
      const sprayPositions=high?[0.28,0.48,0.68,0.86]:[0.38,0.72];
      for(let spray=0;spray<sprayPositions.length;spray++){
        const u=sprayPositions[spray];
        const origin=curve.getPoint(u);
        const tangent=curve.getTangent(u).normalize();
        const fan=radial.clone().multiplyScalar(0.56).addScaledVector(tangent,0.34).add(new THREE.Vector3(0,0.34,0)).normalize();
        const fanSide=new THREE.Vector3(-fan.z,0,fan.x).normalize();
        const baseLength=length*(high?0.19:0.16)*(1-u*0.22);
        const baseWidth=high?0.16:0.19;
        for(const spread of [-1,0,1]){
          const direction=fan.clone().addScaledVector(fanSide,spread*0.52).add(new THREE.Vector3(0,spread===0?0.08:0.02,0)).normalize();
          addBlade(origin,direction,baseLength*(spread===0?1.08:0.88),baseWidth*(spread===0?1.0:0.82),0.2+0.6*u);
        }
      }
      for(let twig=0;twig<twigLayers;twig++){
        const tt=0.34+twig*(high?0.24:0.31);
        const p=curve.getPoint(tt);
        const twigSign=(twig+branch+level)%2===0?1:-1;
        const twigAngle=angle+twigSign*(0.52+variant*0.06);
        const twigDirection=new THREE.Vector3(Math.cos(twigAngle),0,Math.sin(twigAngle));
        const twigLength=length*(high?0.25:0.19)*(1-tt*0.18);
        const twigStart=p.clone();
        const twigA=p.clone().addScaledVector(twigDirection,twigLength*0.48);twigA.y+=twigLength*0.035;
        const twigB=p.clone().addScaledVector(twigDirection,twigLength);twigB.y-=twigLength*0.09;
        const twigCurve=new THREE.CatmullRomCurve3([twigStart,twigA,twigB]);
        addTube(twigCurve,0.024*(1-t*0.28),high?3:2,4,false);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createSplinePineMaterial() {
  const material=new THREE.MeshStandardNodeMaterial({roughness:0.97,metalness:0,vertexColors:true,side:THREE.DoubleSide});
  const swayX=sin(time.mul(0.72).add(positionLocal.y.mul(0.52)).add(positionLocal.x.mul(0.14)))
    .mul(positionLocal.y.mul(0.0028));
  const swayZ=cos(time.mul(0.61).add(positionLocal.y.mul(0.46)).add(positionLocal.z.mul(0.17)))
    .mul(positionLocal.y.mul(0.0022));
  material.positionNode=positionLocal.add(vec3(swayX,0,swayZ));
  return material;
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

function createTreeInstanceBatch(trees, lod, variant, parent) {
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
      dummy.scale.set(scale*0.64,scale,1);
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
  mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;
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
  const near=[],mid=[],far=[];
  for(const tree of forestSystem.trees){
    const distance=camera.position.distanceTo(new THREE.Vector3(tree.x,tree.y+tree.height*0.5,tree.z));
    if(distance<520)near.push(tree);
    else if(distance<1900)mid.push(tree);
    else far.push(tree);
  }
  for(let variant=0;variant<3;variant++){
    createTreeInstanceBatch(near.filter(tree=>tree.variant===variant),'near',variant,forestSystem.group);
    createTreeInstanceBatch(mid.filter(tree=>tree.variant===variant),'mid',variant,forestSystem.group);
  }
  for(let variant=0;variant<8;variant++){
    createTreeInstanceBatch(far.filter(tree=>tree.atlasVariant===variant),'far',variant,forestSystem.group);
  }
  terrainInfoEl.textContent=forestSystem.trees.length.toLocaleString('ru-RU');
  forestSystem.lastLod={near:near.length,mid:mid.length,far:far.length};
}

async function loadStageOneAndForest() {
  setLoadingMessage('Загружаем FBX Slopes_Stage1…');
  await nextAnimationFrame();
  const response=await fetch('./clients/alpine-resort/scene.json',{cache:'no-cache'});
  if(!response.ok)throw new Error('Не удалось загрузить scene.json ('+response.status+').');
  const manifest=await response.json();
  const item=(manifest.assets||[]).find(asset=>asset.id==='slopes_stage1'&&asset.category==='slope');
  if(!item)throw new Error('В scene.json не найден Slopes_Stage1.');
  const root=await new FBXLoader().loadAsync('./clients/alpine-resort/'+item.file);
  restoreStageOneCoordinates(root,item);
  const slopeMaterial=new THREE.MeshStandardMaterial({color:0xcbd8e4,roughness:0.94,metalness:0});
  let slopeMeshCount=0;
  root.traverse(object=>{
    if(!object.isMesh||!object.geometry?.attributes?.position)return;
    object.material=slopeMaterial;
    object.castShadow=false;object.receiveShadow=true;
    slopeMeshCount++;
  });
  if(!slopeMeshCount)throw new Error('Slopes_Stage1 не содержит polygon meshes.');
  root.name='GO_WebGPU_Slopes_Stage1';
  scene.add(root);
  stageOneRoot=root;
  setLoadingMessage('Строим границы трассы и размещаем лес…');
  await nextAnimationFrame();
  const footprint=buildSlopeFootprint(root);
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
  const billboardMaterials=pineAtlasTextures.map(texture=>new THREE.MeshStandardMaterial({
    map:texture,color:0xffffff,roughness:0.98,metalness:0,side:THREE.DoubleSide,alphaTest:0.12
  }));
  forestSystem={
    trees,footprint,geometries,billboardMaterials,
    billboardGeometry:new THREE.PlaneGeometry(1,1),
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
    updateSky();
  });
  [ui.sunIntensity,ui.turbidity,ui.rayleigh,ui.cloudCoverage,ui.cloudDensity,ui.cloudElevation].forEach(input=>{
    input.addEventListener('input',()=>{updateSkyLabels();updateSky();});
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
  ui.quality.addEventListener('change', () => applyQualityProfile(ui.quality.value));
  updateSkyLabels();
  syncDayCycleButton();
}
async function start() {
  renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.3));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
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
  await loadRealTerrain();
  await loadStageOneAndForest();
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