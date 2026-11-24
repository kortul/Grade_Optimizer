import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { attribute, color, cos, mod, sin, uniform, vec3 } from 'three/tsl';

const stage = document.getElementById('stage');
const statusText = document.getElementById('backendStatus');
const statusDot = document.getElementById('statusDot');
const errorBox = document.getElementById('error');
const fpsEl = document.getElementById('fps');
const countEl = document.getElementById('particleCount');
const densityInput = document.getElementById('density');
const densityValue = document.getElementById('densityValue');
const windInput = document.getElementById('wind');
const windValue = document.getElementById('windValue');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9eb9ce);
scene.fog = new THREE.Fog(0x9eb9ce, 150, 520);
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 900);
camera.position.set(115, 92, 170);
const hemi = new THREE.HemisphereLight(0xe5f4ff, 0x465566, 2.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d7, 3.0);
sun.position.set(-90, 180, 70);
scene.add(sun);

let renderer;
let snowPoints;
let snowMaterial;
let snowGeometry;
let snowPositions;
let particleCount = Number(densityInput.value);
const timeUniform = uniform(0);
const windUniform = uniform(Number(windInput.value));
const worldHeight = 180;
const clock = new THREE.Clock();
let frameCounter = 0;
let fpsStart = performance.now();

function terrainHeight(x, z) {
  const peakA = 54 * Math.exp(-(((x - 52) ** 2) / 1800 + ((z + 35) ** 2) / 7200));
  const peakB = 43 * Math.exp(-(((x + 72) ** 2) / 2600 + ((z + 5) ** 2) / 4800));
  const peakC = 27 * Math.exp(-(((x - 4) ** 2) / 4200 + ((z - 78) ** 2) / 2500));
  const ridge = 9 * Math.sin(x * 0.025 + z * 0.012) + 5 * Math.cos(z * 0.035);
  return Math.max(-2, peakA + peakB + peakC + ridge - 7);
}

function createTerrain() {
  const divisions = 150;
  const size = 360;
  const positions = [];
  const colors = [];
  const indices = [];
  for (let iz = 0; iz <= divisions; iz++) {
    const z = (iz / divisions - 0.5) * size;
    for (let ix = 0; ix <= divisions; ix++) {
      const x = (ix / divisions - 0.5) * size;
      const y = terrainHeight(x, z);
      positions.push(x, y, z);
      const snowLine = THREE.MathUtils.clamp((y + 1) / 60, 0, 1);
      const shade = 0.72 + snowLine * 0.26;
      colors.push(0.66 * shade, 0.76 * shade, 0.84 * shade);
      if (ix < divisions && iz < divisions) {
        const a = iz * (divisions + 1) + ix;
        const b = a + divisions + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, metalness: 0
  }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200),
    new THREE.MeshStandardMaterial({ color: 0xcbd9e4, roughness: 1 })
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = -9;
  scene.add(base);
}

function createTrees() {
  const trunkGeometry = new THREE.CylinderGeometry(0.35, 0.65, 5, 5);
  const crownGeometry = new THREE.ConeGeometry(3.1, 13, 7);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x665748, roughness: 1 });
  const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x294c4a, roughness: 1 });
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, 260);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, 260);
  const dummy = new THREE.Object3D();
  let placed = 0;
  for (let i = 0; i < 900 && placed < 260; i++) {
    const x = (Math.sin(i * 127.1) * 43758.5453 % 1) * 150;
    const z = (Math.sin(i * 311.7 + 9) * 24634.6345 % 1) * 150;
    if (Math.abs(x) < 34 && Math.abs(z) < 36) continue;
    const y = terrainHeight(x, z);
    if (y > 30) continue;
    dummy.position.set(x, y + 2.5, z);
    dummy.rotation.y = i * 1.7;
    dummy.scale.setScalar(0.7 + (i % 7) * 0.07);
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    dummy.position.y = y + 10;
    dummy.scale.setScalar(0.7 + (i % 7) * 0.07);
    dummy.updateMatrix();
    crowns.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  trunks.count = placed;
  crowns.count = placed;
  scene.add(trunks, crowns);
}

function makeSnow(count) {
  if (snowPoints) {
    scene.remove(snowPoints);
    snowGeometry.dispose();
    snowMaterial.dispose();
  }
  particleCount = count;
  snowPositions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const k = i * 3;
    snowPositions[k] = (Math.random() - 0.5) * 250;
    snowPositions[k + 1] = (Math.random() - 0.5) * worldHeight;
    snowPositions[k + 2] = (Math.random() - 0.5) * 250;
  }
  snowGeometry = new THREE.BufferGeometry();
  snowGeometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
  snowMaterial = new THREE.PointsNodeMaterial();
  snowMaterial.colorNode = color(0xeaf6ff);
  snowMaterial.size = 2.2;
  snowMaterial.sizeAttenuation = true;
  const base = attribute('position');
  const t = timeUniform;
  snowMaterial.positionNode = vec3(
    base.x.add(sin(t.add(base.z.mul(0.035)).mul(0.9)).mul(windUniform).mul(2.2)),
    mod(base.y.add(worldHeight * 0.5).sub(t.mul(24)).add(worldHeight), worldHeight).sub(worldHeight * 0.5),
    base.z.add(cos(t.add(base.x.mul(0.025)).mul(0.7)).mul(windUniform).mul(0.9))
  );
  snowPoints = new THREE.Points(snowGeometry, snowMaterial);
  snowPoints.frustumCulled = false;
  scene.add(snowPoints);
  countEl.textContent = count.toLocaleString('ru-RU');
  densityValue.textContent = count.toLocaleString('ru-RU');
}

async function start() {
  createTerrain();
  createTrees();
  const controls = new OrbitControls(camera, stage);
  controls.enableDamping = true;
  controls.target.set(0, 12, 0);
  controls.minDistance = 45;
  controls.maxDistance = 360;
  controls.maxPolarAngle = Math.PI * 0.49;

  renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(stage.clientWidth, stage.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  stage.appendChild(renderer.domElement);
  await renderer.init();

  const hasWebGPU = Boolean(navigator.gpu);
  statusText.textContent = hasWebGPU
    ? 'WebGPU API обнаружен · WebGPURenderer инициализирован'
    : 'WebGPU API не найден · используется WebGL 2 fallback';
  if (hasWebGPU) statusDot.classList.add('ok');
  makeSnow(particleCount);

  densityInput.addEventListener('input', () => makeSnow(Number(densityInput.value)));
  windInput.addEventListener('input', () => {
    windUniform.value = Number(windInput.value);
    windValue.textContent = Number(windInput.value).toFixed(1) + '×';
  });
  window.addEventListener('resize', () => {
    camera.aspect = stage.clientWidth / Math.max(1, stage.clientHeight);
    camera.updateProjectionMatrix();
    renderer.setSize(stage.clientWidth, stage.clientHeight);
  });

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    timeUniform.value += dt;
    controls.update();
    renderer.render(scene, camera);
    frameCounter++;
    const now = performance.now();
    if (now - fpsStart >= 1000) {
      fpsEl.textContent = String(Math.round(frameCounter * 1000 / (now - fpsStart)));
      frameCounter = 0;
      fpsStart = now;
    }
  });
}

start().catch((error) => {
  statusText.textContent = 'Не удалось запустить WebGPU renderer';
  statusDot.classList.add('bad');
  errorBox.style.display = 'block';
  errorBox.textContent = error?.stack || String(error);
  console.error('[Grade Optimizer WebGPU Lab]', error);
});
