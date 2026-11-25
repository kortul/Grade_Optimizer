import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { calculateSolarCycle, advanceSolarClock, createSolarDisc, updateSolarDisc } from './solar-cycle.v1.js';
import {
  exp, float, Fn, fwidth, getViewPosition, interleavedGradientNoise,
  isBackgroundDepth, Loop, pass, rtt, screenCoordinate, screenUV,
  texture3D, uniform, vec2, vec3, vec4
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
  quality: document.getElementById('quality')
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
let dayCyclePlaying=false;
let solarState=null;
let fogPipeline;

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
  ui.dayLengthValue.textContent = Math.round(Number(ui.dayLength.value))+' мин';
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
function createFallbackTerrain() {
  const segments=180, width=4600, depth=4400;
  const geometry=new THREE.PlaneGeometry(width,depth,segments,segments);
  geometry.rotateX(-Math.PI/2);
  const positions=geometry.attributes.position;
  const noise=new ImprovedNoise();
  const colors=[];
  const color=new THREE.Color();
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),z=positions.getZ(i);
    const broad=noise.noise(x*0.00085,0,z*0.00085);
    const ridge=1-Math.abs(noise.noise(x*0.0022,2.7,z*0.0022));
    const detail=noise.noise(x*0.008,7.1,z*0.008);
    const height=28+broad*34+Math.pow(Math.max(0,ridge),2.2)*72+detail*5;
    positions.setY(i,height);
    const h=THREE.MathUtils.clamp((height-8)/150,0,1);
    color.setRGB(0.20+h*0.22,0.27+h*0.20,0.19+h*0.16);
    colors.push(color.r,color.g,color.b);
  }
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.98,metalness:0});
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name='GO_Atmosphere_FallbackTerrain';
  mesh.receiveShadow=false;
  mesh.castShadow=false;
  const group=new THREE.Group();
  group.name='GO_WebGPU_ProceduralTerrainFallback';
  group.add(mesh);
  return group;
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
  return new FBXLoader().parse(buffer, './assets/');
}
async function loadRealTerrain() {
  const manifest = await fetch('./assets/real-terrain.json', { cache: 'no-cache' }).then(response => {
    if (!response.ok) throw new Error('Не удалось загрузить real-terrain.json (' + response.status + ')');
    return response.json();
  });
  let root, sourceError=null;
  try {
    root=await loadFBXTerrain('./assets/real-terrain.fbx');
  } catch(error) {
    sourceError=error;
    root=createFallbackTerrain();
    const reason=error && error.message ? error.message : String(error);
    statusText.textContent='Резервный процедурный рельеф · FBX недоступен';
    statusText.title=reason;
    statusDot.classList.add('bad');
    console.warn('[Atmosphere Lab] '+reason+' Используется процедурный рельеф.');
  }
  const metersPerUnit = Number(manifest && manifest.mayaExport && manifest.mayaExport.metersPerUnit || 0.01);
  if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0 || metersPerUnit > 1) throw new Error('Некорректный metersPerUnit в real-terrain.json');
  if(!sourceError)root.scale.multiplyScalar(metersPerUnit);
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || size.x < 10 || size.z < 10) { if(!sourceError)throw new Error('FBX рельеф не содержит корректную геометрию.'); }
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
  renderPipeline.outputNode = sceneColor.rgb.mix(fogColor, fogResult);
  renderPipeline.needsUpdate = true;
  return {
    setResolution(value) { resolutionScale.value = value; lowResFog.setResolutionScale(value); },
    setSteps(value) { marchSteps.value = value; },
    setTime(value) { time.value = value; },
    updateCamera() {
      cameraWorld.value.copy(camera.matrixWorld);
      projectionInverse.value.copy(camera.projectionMatrixInverse);
      cameraPosition.value.copy(camera.position);
    }
  };
}
function applyQualityProfile(name) {
  const profiles = {
    performance: { pixelRatio: 1.0, fogResolution: 0.30, steps: 10 },
    balanced: { pixelRatio: 1.3, fogResolution: 0.42, steps: 18 },
    cinematic: { pixelRatio: 1.6, fogResolution: 0.55, steps: 28 }
  };
  const profile = profiles[name] || profiles.balanced;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile.pixelRatio));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  fogPipeline.setResolution(profile.fogResolution);
  fogPipeline.setSteps(profile.steps);
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
  renderer.toneMappingExposure = 0.55;
  stage.appendChild(renderer.domElement);
  await renderer.init();
  camera.aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
  camera.updateProjectionMatrix();
  const isWebGPU = renderer.backend && renderer.backend.isWebGPUBackend === true;
  statusText.textContent = isWebGPU ? 'WebGPU backend активен · TSL + RenderPipeline' : 'WebGL 2 fallback активен · тот же TSL pipeline';
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
  updateSkyLabels();
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
    fogPipeline.updateCamera();
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
  statusText.textContent = 'Не удалось запустить WebGPU atmosphere lab';
  statusDot.classList.add('bad');
  errorBox.style.display = 'block';
  errorBox.textContent = error && error.stack || String(error);
  loading.style.display = 'none';
  console.error('[Grade Optimizer WebGPU Atmosphere Lab]', error);
});