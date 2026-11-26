// Forest Lab atmosphere baseline.
// Uses Three.js' native SkyMesh for physically based sky scattering and clouds.
// The visible sky and PMREM environment are generated from the same shader.
// Heavy screen-space haze, raymarch and AO passes are intentionally excluded from this baseline.

import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { vec4 } from 'three/tsl';

const SKY_RADIANCE_SCALE = 0.096; // 0.05 reference sky exposure / 0.52 scene exposure

export function createForestAtmosphere(THREE, scene, camera, renderer, hemisphere) {
  const skyDome = new SkyMesh();
  skyDome.name = 'ForestLab_PhysicalSky';
  skyDome.scale.setScalar(450000);
  skyDome.renderOrder = -1000;
  skyDome.frustumCulled = false;
  skyDome.material.depthWrite = false;
  skyDome.material.toneMapped = true;
  skyDome.showSunDisc.value = false;

  // The reference SkyMesh uses a much lower exposure than this PBR scene.
  // Scale only sky radiance, not the scene exposure, so snow/direct lighting keep contrast.
  const physicalSkyColour = skyDome.material.colorNode;
  skyDome.material.colorNode = vec4(
    physicalSkyColour.rgb.mul(SKY_RADIANCE_SCALE),
    physicalSkyColour.a
  );
  scene.add(skyDome);

  const nightSky = new THREE.Color(0x18253c);
  const daySky = new THREE.Color(0x6f9bc9);
  const nightGround = new THREE.Color(0x111b23);
  const dayGround = new THREE.Color(0x344638);
  const hazeDay = new THREE.Color(0xb8cfe0);
  const hazeNight = new THREE.Color(0x18253c);
  const hazeTwilight = new THREE.Color(0xcaa58b);
  const liveHaze = new THREE.Color();

  // A light, native scene fog is used instead of multiple full-screen render targets.
  // It is cheap, deterministic and affects the terrain without tinting the sky dome.
  const sceneFog = new THREE.FogExp2(hazeDay, 0);
  scene.fog = sceneFog;

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const environmentScene = new THREE.Scene();
  let environmentTarget = null;
  let lastEnvironmentBake = 0;

  function bakeEnvironment(force = false) {
    const now = performance.now();
    if (lastEnvironmentBake > 0 && now - lastEnvironmentBake < 850) return;
    if (!force && now - lastEnvironmentBake < 5000) return;
    lastEnvironmentBake = now;

    const savedPosition = skyDome.position.clone();
    try {
      skyDome.position.set(0, 0, 0);
      environmentScene.add(skyDome);
      const next = pmremGenerator.fromScene(environmentScene, 0.035);
      if (!next?.texture) throw new Error('Physical sky PMREM bake returned no texture.');

      const previous = environmentTarget;
      environmentTarget = next;
      scene.environment = next.texture;

      // Sky radiance was scaled by 0.096 for display. Compensate the IBL intensity
      // so PBR reflections/fill stay in the same energy range as the visible sky.
      scene.environmentIntensity = 3.8;
      previous?.dispose();
    } finally {
      scene.add(skyDome);
      skyDome.position.copy(savedPosition);
    }
  }

  function setAtmosphere({
    solar,
    turbidity = 2.2,
    rayleigh = 1.35,
    cloudCoverage = 0.42,
    cloudDensity = 0.45,
    cloudElevation = 0.55,
    wind = 9
  } = {}, forceEnvironment = false) {
    if (!solar) return;

    skyDome.sunPosition.value.copy(solar.sunDirection).normalize();
    skyDome.turbidity.value = THREE.MathUtils.clamp(Number(turbidity), 1, 8);
    skyDome.rayleigh.value = THREE.MathUtils.clamp(Number(rayleigh), 0.5, 2.5);
    skyDome.mieCoefficient.value = 0.0038;
    skyDome.mieDirectionalG.value = 0.78;

    // Clouds are part of the same atmospheric shader: no separately lit cloud planes/shells.
    skyDome.cloudCoverage.value = THREE.MathUtils.clamp(Number(cloudCoverage), 0, 1);
    skyDome.cloudDensity.value = THREE.MathUtils.clamp(Number(cloudDensity), 0, 1);
    skyDome.cloudElevation.value = THREE.MathUtils.clamp(Number(cloudElevation), 0, 1);
    skyDome.cloudSpeed.value = THREE.MathUtils.clamp(Number(wind), 0, 24) * 0.0000022;

    const daylight = THREE.MathUtils.clamp(solar.daylight, 0, 1);
    const twilight = THREE.MathUtils.clamp(solar.twilight, 0, 1);
    const night = THREE.MathUtils.clamp(solar.nightStrength, 0, 1);

    const skyFill = nightSky.clone().lerp(daySky, daylight);
    const groundFill = nightGround.clone().lerp(dayGround, daylight);
    liveHaze.copy(hazeNight).lerp(hazeDay, daylight).lerp(hazeTwilight, twilight * 0.30);

    hemisphere.color.copy(skyFill);
    hemisphere.groundColor.copy(groundFill);
    hemisphere.intensity = 0.12 + daylight * 0.11 + night * 0.025;

    sceneFog.color.copy(liveHaze);
    bakeEnvironment(forceEnvironment);
  }

  function setFog({ strength = 0.40 } = {}) {
    const value = THREE.MathUtils.clamp(Number(strength), 0, 1.5);
    sceneFog.density = value * 0.00010;
  }

  const qualityProfiles = { performance:0.65, balanced:0.85, cinematic:1.0 };
  let qualityScale=qualityProfiles.balanced;
  let dynamicResolutionScale=1;
  function applyResolution(){
    const ratio=Math.min(window.devicePixelRatio||1,qualityScale*dynamicResolutionScale);
    renderer.setPixelRatio(ratio);
    const parent=renderer.domElement.parentElement;
    if(parent)renderer.setSize(parent.clientWidth,parent.clientHeight);
  }
  function setQuality(name){
    qualityScale=qualityProfiles[name]||qualityProfiles.balanced;
    applyResolution();
  }
  function setResolutionScale(scale){
    dynamicResolutionScale=THREE.MathUtils.clamp(Number(scale)||1,0.70,1);
    applyResolution();
  }

  return {
    setAtmosphere,
    setFog,
    setQuality,
    setResolutionScale,
    updateCamera() {
      skyDome.position.copy(camera.position);
    },
    render() {
      renderer.render(scene, camera);
    },
    dispose() {
      scene.remove(skyDome);
      scene.environment = null;
      scene.fog = null;
      environmentTarget?.dispose();
      pmremGenerator.dispose();
      skyDome.geometry.dispose();
      skyDome.material.dispose();
    }
  };
}
