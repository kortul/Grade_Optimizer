import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { WeatherSystem } from './weather-system.v9.js';
import { calculateSolarCycle, advanceSolarClock } from './solar-cycle.v1.js';

const stage = document.getElementById('stage');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loadingText');
const backendStatus = document.getElementById('backendStatus');
const statusDot = document.getElementById('statusDot');
const errorBox = document.getElementById('error');
const fpsEl = document.getElementById('fps');
const frameMsEl = document.getElementById('frameMs');
const treeCountEl = document.getElementById('treeCount');
const ui = {
  time: document.getElementById('timeOfDay'),
  timeValue: document.getElementById('timeValue'),
  dayCycle: document.getElementById('dayCycleToggle'),
  dayLength: document.getElementById('dayCycleLength'),
  dayLengthValue: document.getElementById('dayCycleLengthValue'),
  sunIntensity: document.getElementById('sunIntensity'),
  sunIntensityValue: document.getElementById('sunIntensityValue'),
  clouds: document.getElementById('cloudCoverage'),
  cloudsValue: document.getElementById('cloudCoverageValue'),
  wind: document.getElementById('windSpeed'),
  windValue: document.getElementById('windSpeedValue'),
  groundFog: document.getElementById('groundFog'),
  forestDensity: document.getElementById('forestDensity'),
  forestDensityValue: document.getElementById('forestDensityValue'),
  quality: document.getElementById('quality')
};

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbfcdd6, 2600, 11200);
const camera = new THREE.PerspectiveCamera(52, 1, 0.5, 70000);
const hemisphere = new THREE.HemisphereLight(0xc7dcf0, 0x4e5148, 1.1);
scene.add(hemisphere);

const sun = new THREE.DirectionalLight(0xfff0df, 2.4);
sun.position.set(1800, 2600, 1200);
sun.target.position.set(0, 0, 0);
sun.castShadow = false;
scene.add(sun, sun.target);

const moonLight = new THREE.DirectionalLight(0x9eb6dc, 0.12);
moonLight.castShadow = false;
scene.add(moonLight, moonLight.target);

let renderer = null;
let controls = null;
camera.position.set(1200, 920, 1750);

const weather = new WeatherSystem({
  THREE,
  scene,
  camera,
  hemisphere,
  sun,
  fogNear: 2600,
  fogFar: 11200
});
weather.setVolumetrics(true);
weather.setSceneReady(false);
weather.setCustom({
  clouds: Number(ui.clouds.value),
  snowfall: 0,
  wind: Number(ui.wind.value),
  visibility: 0.92,
  groundFog: false,
  volumetrics: true
});

let terrainRoot = null;
let terrainBounds = null;
let terrainHeightLookup = null;
let forestSystem = null;
let solarState = null;
let dayCyclePlaying = false;
let elapsed = 0;
let previousTime = performance.now();
let fpsFrames = 0;
let fpsStart = performance.now();
let failedTerrainLoad = false;

function setLoading(message) {
  loadingText.textContent = message;
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

function seededRandom(x, z, salt = 0) {
  let seed = (
    Math.imul(Math.floor(x * 16) | 0, 374761393) ^
    Math.imul(Math.floor(z * 16) | 0, 668265263) ^
    Math.imul((salt + 1) | 0, 1442695041)
  ) >>> 0;
  return () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function formatTime(hours) {
  const total = Math.round((((hours % 24) + 24) % 24) * 60);
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' +
    String(total % 60).padStart(2, '0');
}

function updateLabels() {
  ui.timeValue.textContent = formatTime(Number(ui.time.value));
  ui.dayLengthValue.textContent = Math.round(Number(ui.dayLength.value)) + ' мин';
  ui.sunIntensityValue.textContent = Math.round(Number(ui.sunIntensity.value) * 100) + '%';
  ui.cloudsValue.textContent = Math.round(Number(ui.clouds.value) * 100) + '%';
  ui.windValue.textContent = Math.round(Number(ui.wind.value)) + ' м/с';
  ui.forestDensityValue.textContent = Math.round(Number(ui.forestDensity.value) * 100) + '%';
}

function syncDayCycleButton() {
  ui.dayCycle.textContent = dayCyclePlaying ? 'Ⅱ Пауза' : '▶ Запустить цикл';
  ui.dayCycle.setAttribute('aria-pressed', String(dayCyclePlaying));
}

function updateSky() {
  const solar = calculateSolarCycle(THREE, Number(ui.time.value));
  solarState = solar;

  const directPower = THREE.MathUtils.clamp(Number(ui.sunIntensity.value), 0, 1.5);
  sun.position.copy(controls.target).addScaledVector(solar.sunDirection, 2200);
  sun.target.position.copy(controls.target);
  sun.color.copy(solar.sunColor);
  sun.intensity = solar.daylight * 3.0 * directPower;

  moonLight.position.copy(controls.target).addScaledVector(solar.sunDirection, -1800);
  moonLight.target.position.copy(controls.target);
  moonLight.intensity = solar.nightStrength * 0.18;
  hemisphere.intensity = 0.30 + solar.daylight * 0.95 + solar.nightStrength * 0.06;

  const top = new THREE.Color(0x4b83b8).lerp(new THREE.Color(0x111d33), 1 - solar.daylight);
  const horizon = new THREE.Color(0xd6e5ef)
    .lerp(new THREE.Color(0x35445b), 1 - solar.daylight)
    .lerp(new THREE.Color(0xf19a76), solar.twilight * 0.52);
  const bottom = new THREE.Color(0x94a9b8).lerp(new THREE.Color(0x192638), 1 - solar.daylight);
  weather.drawSky({
    top,
    horizon,
    bottom,
    sunColor: solar.sunColor,
    sunStrength: solar.daylight,
    sunDirection: solar.sunDirection,
    sunVisible: solar.sunDirection.y > -0.055,
    twilight: solar.twilight
  });

  hemisphere.color.copy(top).lerp(new THREE.Color(0xe5edf3), 0.25);
  hemisphere.groundColor.copy(bottom).lerp(new THREE.Color(0x303c35), 0.48);
}

function applyWeatherControls() {
  weather.setCustom({
    clouds: Number(ui.clouds.value),
    snowfall: 0,
    wind: Number(ui.wind.value),
    visibility: 1 - Number(ui.clouds.value) * 0.18,
    groundFog: ui.groundFog.checked,
    volumetrics: true
  });
  updateSky();
}

function addTerrainColors(root, bounds) {
  const verticalRange = Math.max(1, bounds.max.y - bounds.min.y);
  const forestLow = new THREE.Color(0x48654a);
  const alpineMeadow = new THREE.Color(0x82906c);
  const rock = new THREE.Color(0x777b76);
  const snow = new THREE.Color(0xdce4e8);
  const world = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const color = new THREE.Color();

  root.updateWorldMatrix(true, true);
  root.traverse(object => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    const geometry = object.geometry;
    if (!geometry.attributes.normal) geometry.computeVertexNormals();

    const positions = geometry.attributes.position;
    const normals = geometry.attributes.normal;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
    const colors = new Float32Array(positions.count * 3);

    for (let index = 0; index < positions.count; index++) {
      world.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld);
      normal.fromBufferAttribute(normals, index).applyMatrix3(normalMatrix).normalize();

      const height = THREE.MathUtils.clamp((world.y - bounds.min.y) / verticalRange, 0, 1);
      const meadowMix = THREE.MathUtils.smoothstep(height, 0.08, 0.60);
      const rockMix = THREE.MathUtils.smoothstep(height, 0.48, 0.80);
      const snowMix = THREE.MathUtils.smoothstep(height, 0.78, 0.98);

      color.copy(forestLow).lerp(alpineMeadow, meadowMix);
      color.lerp(rock, rockMix * 0.88);
      color.lerp(snow, snowMix * 0.96);

      const steepness = 1 - THREE.MathUtils.clamp(normal.y, 0, 1);
      color.lerp(rock, THREE.MathUtils.clamp(steepness * 0.72, 0, 0.68));

      const variation = 0.965 + 0.035 * Math.sin(world.x * 0.017 + world.z * 0.013);
      color.multiplyScalar(variation);

      const offset = index * 3;
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    object.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.96,
      metalness: 0
    });
    object.castShadow = false;
    object.receiveShadow = false;
  });
}

function createFallbackTerrain(manifest, metersPerUnit) {
  const worldBounds = manifest?.mayaExport?.worldBounds;
  const valid = Array.isArray(worldBounds) && worldBounds.length >= 6 &&
    worldBounds.slice(0, 6).every(value => Number.isFinite(Number(value)));
  const minX = valid ? Number(worldBounds[0]) * metersPerUnit : -2200;
  const minY = valid ? Number(worldBounds[1]) * metersPerUnit : 0;
  const minZ = valid ? Number(worldBounds[2]) * metersPerUnit : -2200;
  const maxX = valid ? Number(worldBounds[3]) * metersPerUnit : 2200;
  const maxZ = valid ? Number(worldBounds[5]) * metersPerUnit : 2200;
  const width = Math.max(100, maxX - minX);
  const depth = Math.max(100, maxZ - minZ);
  const centerX = (minX + maxX) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;

  const geometry = new THREE.PlaneGeometry(width, depth, 180, 180);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const noise = new ImprovedNoise();

  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index) + centerX;
    const z = positions.getZ(index) + centerZ;
    const broad = noise.noise(x * 0.00085, 0, z * 0.00085);
    const ridge = 1 - Math.abs(noise.noise(x * 0.0022, 2.7, z * 0.0022));
    const detail = noise.noise(x * 0.008, 7.1, z * 0.008);
    const height = 32 + broad * 26 + Math.pow(Math.max(0, ridge), 2.2) * 54 + detail * 4;
    positions.setY(index, height);
  }

  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.position.set(centerX, minY, centerZ);
  mesh.name = 'GO_AlpineLab_FallbackTerrain';

  const group = new THREE.Group();
  group.name = 'GO_AlpineLab_ProceduralTerrain';
  group.add(mesh);
  return group;
}

async function loadFBX(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error('FBX HTTP ' + response.status + ': ' + path);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 32) throw new Error('Пустой FBX: ' + path);

  const header = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(32, buffer.byteLength)));
  const binary = header.startsWith('Kaydara FBX Binary  \0\x1a\0');
  const ascii = /^\s*;\s*FBX\s+\d+\.\d+/i.test(header.replace(/^\uFEFF/, ''));
  if (!binary && !ascii) {
    const preview = header.replace(/[^\x20-\x7E]/g, '.').slice(0, 32);
    throw new Error('Сервер вернул не FBX (первые байты: ' + preview + ')');
  }
  return new FBXLoader().parse(buffer, path.slice(0, path.lastIndexOf('/') + 1));
}

async function loadTerrain() {
  setLoading('Загружаем карту высот и реальный рельеф…');
  const response = await fetch('./assets/real-terrain.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('real-terrain.json HTTP ' + response.status);
  const manifest = await response.json();
  const metersPerUnit = Number(manifest?.mayaExport?.metersPerUnit || 0.01);
  if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0 || metersPerUnit > 1) {
    throw new Error('Некорректный metersPerUnit в real-terrain.json');
  }

  let root;
  try {
    root = await loadFBX('./assets/real-terrain.fbx');
    root.scale.multiplyScalar(metersPerUnit);
  } catch (error) {
    failedTerrainLoad = true;
    root = createFallbackTerrain(manifest, metersPerUnit);
    console.warn('[Alpine Lab] FBX unavailable; using procedural fallback:', error);
  }

  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || size.x < 100 || size.z < 100) {
    throw new Error('Рельеф не содержит корректной геометрии: ' + size.x.toFixed(1) + ' × ' + size.z.toFixed(1));
  }

  let meshes = 0;
  root.traverse(object => {
    if (object.isMesh && object.geometry?.attributes?.position) meshes++;
  });
  if (!meshes) throw new Error('В рельефе нет polygon meshes');

  addTerrainColors(root, bounds);
  root.name = 'GO_AlpineLab_RealTerrain';
  scene.add(root);
  terrainRoot = root;
  terrainBounds = bounds.clone();

  const center = bounds.getCenter(new THREE.Vector3());
  const terrainSize = bounds.getSize(new THREE.Vector3());
  const targetY = THREE.MathUtils.clamp(center.y, bounds.min.y + 12, bounds.max.y - 8);
  controls.target.set(center.x, targetY, center.z);
  camera.position.set(
    center.x + Math.max(950, terrainSize.x * 0.28),
    center.y + Math.max(480, terrainSize.y * 5.4 + 260),
    center.z + Math.max(1250, terrainSize.z * 0.38)
  );
  camera.lookAt(controls.target);
  controls.update();
  camera.updateProjectionMatrix();

  backendStatus.textContent = failedTerrainLoad
    ? 'Резервный рельеф · лес и атмосфера активны'
    : 'Реальный рельеф · WebGL 2 · WeatherSystem v9';
  if (failedTerrainLoad) statusDot.classList.add('warning');
  return { bounds, meshCount: meshes };
}

async function buildTerrainHeightLookup(root, bounds, cellSize = 48) {
  const size = bounds.getSize(new THREE.Vector3());
  const cols = Math.max(1, Math.ceil(size.x / cellSize));
  const rows = Math.max(1, Math.ceil(size.z / cellSize));
  const cells = new Map();
  const large = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const meshes = [];
  let totalTriangles = 0;

  root.traverseVisible(mesh => {
    if (!mesh.isMesh || !mesh.geometry?.attributes?.position) return;
    meshes.push(mesh);
    const index = mesh.geometry.index;
    const positions = mesh.geometry.attributes.position;
    totalTriangles += Math.floor((index ? index.count : positions.count) / 3);
  });

  const insert = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(denominator) < 1e-10) return;

    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const normalLength = Math.hypot(nx, ny, nz) || 1;
    const triangle = { ax, ay, az, bx, by, bz, cx, cy, cz, denominator, normalY: ny / normalLength };

    const ix0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - bounds.min.x) / cellSize));
    const ix1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx, cx) - bounds.min.x) / cellSize));
    const iz0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - bounds.min.z) / cellSize));
    const iz1 = Math.min(rows - 1, Math.floor((Math.max(az, bz, cz) - bounds.min.z) / cellSize));
    if (ix1 < ix0 || iz1 < iz0) return;

    const coveredCells = (ix1 - ix0 + 1) * (iz1 - iz0 + 1);
    if (coveredCells > 256) {
      large.push(triangle);
      return;
    }

    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const key = iz * cols + ix;
        let bucket = cells.get(key);
        if (!bucket) { bucket = []; cells.set(key, bucket); }
        bucket.push(triangle);
      }
    }
  };

  root.updateWorldMatrix(true, true);
  let processed = 0;
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry;
    const positions = geometry.attributes.position;
    const index = geometry.index;
    const count = index ? index.count : positions.count;

    for (let offset = 0; offset + 2 < count; offset += 3) {
      const ia = index ? index.getX(offset) : offset;
      const ib = index ? index.getX(offset + 1) : offset + 1;
      const ic = index ? index.getX(offset + 2) : offset + 2;
      a.fromBufferAttribute(positions, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(positions, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(positions, ic).applyMatrix4(mesh.matrixWorld);
      insert(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      processed++;

      if (processed % 90000 === 0) {
        setLoading('Готовим карту рельефа для леса · ' +
          Math.round(processed / Math.max(1, totalTriangles) * 100) + '%');
        await nextFrame();
      }
    }
  }

  console.info('[Alpine Lab] terrain lookup:', {
    triangles: processed, cells: cells.size, largeTriangles: large.length, cellSize
  });
  return {
    originX: bounds.min.x,
    originZ: bounds.min.z,
    cellSize,
    cols,
    rows,
    cells,
    large,
    triangleCount: processed
  };
}

function sampleTerrainSurface(x, z, lookup) {
  if (!lookup) return null;
  const ix = Math.floor((x - lookup.originX) / lookup.cellSize);
  const iz = Math.floor((z - lookup.originZ) / lookup.cellSize);
  if (ix < 0 || iz < 0 || ix >= lookup.cols || iz >= lookup.rows) return null;

  const bucket = lookup.cells.get(iz * lookup.cols + ix) || [];
  let best = null;
  const test = triangle => {
    const t = triangle;
    const wa = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / t.denominator;
    const wb = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / t.denominator;
    const wc = 1 - wa - wb;
    if (wa < -1e-5 || wb < -1e-5 || wc < -1e-5) return;

    const y = wa * t.ay + wb * t.by + wc * t.cy;
    if (!best || y > best.y) best = { y, normalY: t.normalY };
  };

  for (const triangle of bucket) test(triangle);
  for (const triangle of lookup.large) test(triangle);
  return best;
}

function buildTreePlacements(lookup, density) {
  const trees = [];
  const grid = 25;
  const probability = THREE.MathUtils.clamp(0.08 + density * 0.15, 0.10, 0.34);
  const verticalRange = Math.max(1, terrainBounds.max.y - terrainBounds.min.y);
  const firstX = Math.floor(terrainBounds.min.x / grid);
  const lastX = Math.ceil(terrainBounds.max.x / grid);
  const firstZ = Math.floor(terrainBounds.min.z / grid);
  const lastZ = Math.ceil(terrainBounds.max.z / grid);

  for (let iz = firstZ; iz <= lastZ && trees.length < 7200; iz++) {
    for (let ix = firstX; ix <= lastX && trees.length < 7200; ix++) {
      const random = seededRandom(ix, iz, 71);
      if (random() > probability) continue;

      const x = (ix + 0.5 + (random() - 0.5) * 0.72) * grid;
      const z = (iz + 0.5 + (random() - 0.5) * 0.72) * grid;
      const ground = sampleTerrainSurface(x, z, lookup);
      if (!ground || ground.normalY < 0.58) continue;

      const elevation = THREE.MathUtils.clamp((ground.y - terrainBounds.min.y) / verticalRange, 0, 1);
      if (elevation > 0.88) continue;
      const treeLine = 1 - THREE.MathUtils.smoothstep(elevation, 0.64, 0.91);
      if (random() > treeLine) continue;

      const scale = 0.78 + random() * 0.66;
      trees.push({
        x,
        y: ground.y + 0.06,
        z,
        scale,
        rotation: random() * Math.PI * 2,
        tint: new THREE.Color().setHSL(0.30 + (random() - 0.5) * 0.035, 0.34 + random() * 0.14, 0.24 + random() * 0.10)
      });
    }
    if ((iz - firstZ) % 12 === 0) {
      setLoading('Распределяем лес по рельефу · ' + trees.length.toLocaleString('ru-RU') + ' деревьев');
      await nextFrame();
    }
  }
  return trees;
}

function createSpruceGeometry() {
  const trunk = new THREE.CylinderGeometry(0.13, 0.22, 7.3, 6, 1);
  trunk.translate(0, 3.65, 0);

  const lower = new THREE.ConeGeometry(2.55, 5.7, 7, 1);
  lower.translate(0, 3.25, 0);
  const middle = new THREE.ConeGeometry(1.95, 4.7, 7, 1);
  middle.translate(0, 5.95, 0);
  const upper = new THREE.ConeGeometry(1.35, 3.6, 7, 1);
  upper.translate(0, 8.35, 0);

  return { trunk, foliage: [lower, middle, upper] };
}

function createForestMeshes(trees) {
  const geometry = createSpruceGeometry();
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x73553e, roughness: 1, metalness: 0 });
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
  const trunk = new THREE.InstancedMesh(geometry.trunk, trunkMaterial, trees.length);
  trunk.name = 'GO_AlpineForest_Trunks';
  trunk.frustumCulled = false;
  trunk.castShadow = false;
  trunk.receiveShadow = false;

  const foliage = geometry.foliage.map((shape, index) => {
    const mesh = new THREE.InstancedMesh(shape, foliageMaterial.clone(), trees.length);
    mesh.name = 'GO_AlpineForest_Foliage_' + index;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  });

  const dummy = new THREE.Object3D();
  const bark = new THREE.Color(0x795c43);
  trees.forEach((tree, index) => {
    dummy.position.set(tree.x, tree.y, tree.z);
    dummy.rotation.set(0, tree.rotation, 0);
    dummy.scale.setScalar(tree.scale);
    dummy.updateMatrix();

    trunk.setMatrixAt(index, dummy.matrix);
    trunk.setColorAt(index, bark);
    foliage.forEach((mesh, tier) => {
      mesh.setMatrixAt(index, dummy.matrix);
      const tint = tree.tint.clone().multiplyScalar(1 + tier * 0.035);
      mesh.setColorAt(index, tint);
    });
  });

  trunk.instanceMatrix.needsUpdate = true;
  if (trunk.instanceColor) trunk.instanceColor.needsUpdate = true;
  foliage.forEach(mesh => {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  const group = new THREE.Group();
  group.name = 'GO_AlpineForest_Instances';
  group.add(trunk, ...foliage);
  scene.add(group);
  return { group, trees, trunk, foliage, geometry };
}

async function buildForest() {
  if (!terrainHeightLookup) {
    setLoading('Строим карту поверхности…');
    terrainHeightLookup = await buildTerrainHeightLookup(terrainRoot, terrainBounds, 48);
  }

  setLoading('Распределяем деревья по всему рельефу…');
  const trees = await buildTreePlacements(terrainHeightLookup, Number(ui.forestDensity.value));
  if (!trees.length) throw new Error('Не удалось разместить деревья на поверхности. Проверьте высоты и геометрию рельефа.');

  forestSystem = createForestMeshes(trees);
  treeCountEl.textContent = trees.length.toLocaleString('ru-RU');
  console.info('[Alpine Lab] forest created:', {
    trees: trees.length,
    terrainTriangles: terrainHeightLookup.triangleCount,
    bounds: terrainBounds
  });
}

function applyQuality(name) {
  const profile = {
    performance: 0.85,
    balanced: 1.15,
    cinematic: 1.5
  }[name] || 1.15;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, profile));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
}

function bindUI() {
  ui.time.addEventListener('input', () => {
    dayCyclePlaying = false;
    syncDayCycleButton();
    updateLabels();
    updateSky();
  });

  ui.dayCycle.addEventListener('click', () => {
    dayCyclePlaying = !dayCyclePlaying;
    syncDayCycleButton();
  });

  ui.dayLength.addEventListener('input', updateLabels);
  ui.sunIntensity.addEventListener('input', () => {
    updateLabels();
    updateSky();
  });

  [ui.clouds, ui.wind].forEach(input => input.addEventListener('input', () => {
    updateLabels();
    applyWeatherControls();
  }));

  ui.groundFog.addEventListener('change', applyWeatherControls);
  ui.forestDensity.addEventListener('input', updateLabels);
  ui.forestDensity.addEventListener('change', async () => {
    try {
      if (forestSystem) {
        scene.remove(forestSystem.group);
        forestSystem.trunk.geometry.dispose();
        forestSystem.trunk.material.dispose();
        forestSystem.foliage.forEach(mesh => {
          mesh.geometry.dispose();
          mesh.material.dispose();
        });
      }
      await buildForest();
    } catch (error) {
      showError(error);
    }
  });

  ui.quality.addEventListener('change', () => applyQuality(ui.quality.value));
  updateLabels();
  syncDayCycleButton();
}

function showError(error) {
  const message = error?.stack || error?.message || String(error);
  backendStatus.textContent = 'Ошибка запуска Alpine Lab';
  statusDot.classList.add('bad');
  errorBox.hidden = false;
  errorBox.style.display = 'block';
  errorBox.textContent = message;
  console.error('[Alpine Lab]', error);
}

async function start() {
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4));
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = false;
    stage.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.screenSpacePanning = true;
    controls.minDistance = 35;
    controls.maxDistance = 18000;
    controls.maxPolarAngle = Math.PI * 0.492;
    controls.target.set(0, 60, 0);
    controls.update();

    camera.aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
    camera.updateProjectionMatrix();

    const terrain = await loadTerrain();
    await buildForest();

    weather.setSceneReady(true);
    updateLabels();
    updateSky();
    applyWeatherControls();
    bindUI();
    applyQuality(ui.quality.value);

    if (failedTerrainLoad) {
      backendStatus.title = 'Не удалось загрузить real-terrain.fbx; используется процедурный рельеф из bounds манифеста.';
    } else {
      backendStatus.textContent = 'Реальный рельеф · ' + terrain.meshCount + ' mesh · WeatherSystem v9';
    }
    statusDot.classList.add('ok');
    loading.classList.add('is-hidden');

    window.addEventListener('resize', () => {
      camera.aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(stage.clientWidth, stage.clientHeight);
    }, { passive: true });

    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const delta = Math.min((now - previousTime) / 1000, 0.05);
      previousTime = now;
      elapsed += delta;

      controls.update();
      if (dayCyclePlaying) {
        ui.time.value = String(advanceSolarClock(Number(ui.time.value), delta, ui.dayLength.value));
        updateLabels();
        updateSky();
      }
      weather.update(delta, camera.position, controls.target);

      renderer.render(scene, camera);

      fpsFrames++;
      if (now - fpsStart >= 1000) {
        const fps = fpsFrames * 1000 / (now - fpsStart);
        fpsEl.textContent = String(Math.round(fps));
        frameMsEl.textContent = (1000 / Math.max(1, fps)).toFixed(1);
        fpsFrames = 0;
        fpsStart = now;
      }
    });
  } catch (error) {
    loading.classList.add('is-hidden');
    showError(error);
  }
}

start();
