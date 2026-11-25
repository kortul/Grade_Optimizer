// Independently authored atmospheric system for Grade Optimizer Forest Lab.
// The system follows Ponlai's separation of sky radiance, cloud transport, aerial perspective
// and environment lighting. It deliberately does not copy Ponlai source or creative assets.

import {
  Fn, float, fract, floor, mix, min, max, exp, smoothstep, vec2, vec3, vec4,
  positionWorld, uniform, pass, rtt, screenUV, screenCoordinate,
  getViewPosition, interleavedGradientNoise, isBackgroundDepth, fwidth,
  Loop, mrt, normalView, packNormalToRGB, sample, unpackRGBToNormal, builtinAOContext
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';

export function createForestAtmosphere(THREE, scene, camera, renderer, hemisphere, {
  center = new THREE.Vector3(),
  groundLevel = 0
} = {}) {
  const state = {
    time: uniform(0),
    cameraPosition: uniform(new THREE.Vector3()),
    sunDirection: uniform(new THREE.Vector3(0, 1, 0)),
    sunColor: uniform(new THREE.Color(0xfff2df)),
    daylight: uniform(1),
    twilight: uniform(0),
    night: uniform(0),
    turbidity: uniform(2.2),
    rayleigh: uniform(1.35),
    cloudCoverage: uniform(0.42),
    cloudDensity: uniform(0.45),
    cloudElevation: uniform(0.55),
    wind: uniform(9),
    fogDensity: uniform(0.0015),
    fogHeight: uniform(220),
    fogStrength: uniform(0.40),
    fogNear: uniform(3200),
    fogFar: uniform(10200),
    godRays: uniform(0.12)
  };

  const skyRadiance = Fn(([direction]) => {
    const dir = direction.normalize();
    const up = dir.y.max(0).clamp(0, 1);
    const vertical = smoothstep(float(0.0), float(0.78), up).pow(0.62);
    const horizonDay = vec3(0.50, 0.68, 0.86).mul(state.rayleigh.mul(0.50).add(0.55));
    const zenithDay = vec3(0.075, 0.22, 0.52).mul(state.rayleigh.mul(0.44).add(0.48));
    const horizonNight = vec3(0.012, 0.025, 0.060);
    const zenithNight = vec3(0.0018, 0.0045, 0.016);
    const dayBase = mix(horizonDay, zenithDay, vertical);
    const nightBase = mix(horizonNight, zenithNight, vertical);
    const base = mix(nightBase, dayBase, state.daylight);

    const sunCos = max(dir.dot(state.sunDirection), float(0));
    const rayleighPhase = float(0.72).add(sunCos.mul(sunCos).mul(0.28));
    const mieHalo = sunCos.pow(9).mul(0.10).add(sunCos.pow(34).mul(0.24));
    const horizonGlow = float(1).sub(up).pow(1.7);
    const warmScatter = state.sunColor.mul(mieHalo.mul(state.daylight.mul(0.62).add(state.twilight.mul(0.28))));
    const blueScatter = vec3(0.075, 0.18, 0.38).mul(rayleighPhase)
      .mul(state.daylight).mul(state.rayleigh.mul(0.20).add(0.35));
    const sunsetBand = vec3(0.92, 0.34, 0.16)
      .mul(horizonGlow).mul(state.twilight).mul(0.22);
    const nightAir = vec3(0.006, 0.014, 0.034).mul(horizonGlow).mul(state.night);
    return base.add(blueScatter).add(warmScatter).add(sunsetBand).add(nightAir).clamp(0, 1.7);
  });

  // The sky is a camera-following inward-facing dome, not a background quad or plane.
  const skyGeometry = new THREE.SphereGeometry(120000, 96, 64);
  const skyMaterial = new THREE.MeshBasicNodeMaterial();
  skyMaterial.colorNode = skyRadiance(positionWorld.sub(state.cameraPosition));
  skyMaterial.side = THREE.BackSide;
  skyMaterial.depthTest = false;
  skyMaterial.depthWrite = false;
  skyMaterial.fog = false;
  skyMaterial.toneMapped = false;
  const skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
  skyDome.name = 'ForestLab_AtmosphereSkyDome';
  skyDome.frustumCulled = false;
  skyDome.renderOrder = -1000;
  scene.add(skyDome);

  const hash21 = Fn(([p]) => {
    const q = fract(vec3(p.x, p.y, p.x).mul(0.1031));
    const seeded = q.add(q.dot(q.yzx.add(33.33)));
    return fract(seeded.x.add(seeded.y).mul(seeded.z));
  });
  const noise2 = Fn(([p]) => {
    const cell = floor(p);
    const local = fract(p);
    const blend = local.mul(local).mul(float(3).sub(local.mul(2)));
    const a = hash21(cell);
    const b = hash21(cell.add(vec2(1, 0)));
    const c = hash21(cell.add(vec2(0, 1)));
    const d = hash21(cell.add(vec2(1, 1)));
    return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
  });
  const cloudFbm = Fn(([p]) => {
    const n0 = noise2(p);
    const n1 = noise2(p.mul(2.03).add(vec2(17.1, 9.2)));
    const n2 = noise2(p.mul(4.13).add(vec2(-8.4, 13.7)));
    return n0.mul(0.56).add(n1.mul(0.29)).add(n2.mul(0.15));
  });

  const lowerCloudNode = Fn(() => {
    const drift = vec2(
      state.time.mul(0.0035).mul(float(0.4).add(state.wind.mul(0.08))),
      state.time.mul(0.0014).mul(float(0.4).add(state.wind.mul(0.08)))
    );
    const p = vec2(
      positionWorld.x.add(positionWorld.y.mul(0.045)),
      positionWorld.z.sub(positionWorld.y.mul(0.028))
    ).mul(0.00031).sub(drift);
    const broad = cloudFbm(p);
    const detail = noise2(p.mul(3.1).add(vec2(11.7, -4.1)));
    const erosion = noise2(p.mul(7.3).sub(drift.mul(1.35)));
    const threshold = float(0.78).sub(state.cloudCoverage.mul(0.43));
    const carved = broad.add(detail.sub(0.5).mul(0.18)).sub(erosion.sub(0.5).mul(0.10));
    const body = smoothstep(threshold, threshold.add(0.18), carved);
    const brokenEdge = smoothstep(0.015, 0.30, body);
    const cloudColumn = body.mul(brokenEdge);
    const sunView = max(state.cameraPosition.sub(positionWorld).normalize().dot(state.sunDirection), float(0));
    const forward = sunView.pow(8);
    const topLight = float(0.22).add(state.sunDirection.y.max(0).mul(0.56))
      .add(forward.mul(0.20)).clamp(0, 1);
    const underside = mix(vec3(0.060, 0.083, 0.125), vec3(0.26, 0.32, 0.40), state.daylight);
    const upper = state.sunColor.mul(float(0.72).add(topLight.mul(0.48)));
    const cloudColour = mix(underside, upper, topLight.mul(0.86));
    const silverEdge = state.sunColor.mul(forward.mul(0.16).add(float(0.025)));
    const alpha = cloudColumn.mul(state.cloudDensity)
      .mul(float(0.12).add(state.cloudCoverage.mul(0.58)))
      .mul(float(0.28).add(state.daylight.mul(0.72)))
      .clamp(0, 0.78);
    return vec4(cloudColour.add(silverEdge), alpha);
  });

  const cirrusNode = Fn(() => {
    const drift = vec2(state.time.mul(0.0019), state.time.mul(0.00065));
    const p = vec2(
      positionWorld.x.mul(0.00012).add(positionWorld.z.mul(0.000035)),
      positionWorld.z.mul(0.000025).sub(positionWorld.x.mul(0.000095))
    ).sub(drift);
    const broad = cloudFbm(p);
    const filaments = noise2(p.mul(vec2(0.75, 7.0)).add(vec2(20.4, -6.8)));
    const strand = float(1).sub(smoothstep(0.035, 0.20, filaments.sub(0.5).abs()));
    const veil = smoothstep(0.57, 0.79, broad).mul(0.12);
    const streaks = smoothstep(0.62, 0.82, broad).mul(strand);
    const alpha = streaks.mul(0.22).add(veil)
      .mul(state.cloudCoverage).mul(state.cloudDensity)
      .mul(float(0.22).add(state.daylight.mul(0.22)))
      .clamp(0, 0.18);
    const forward = max(state.cameraPosition.sub(positionWorld).normalize().dot(state.sunDirection), float(0)).pow(7);
    const base = mix(vec3(0.15, 0.19, 0.29), vec3(0.52, 0.62, 0.75), state.daylight);
    const lit = state.sunColor.mul(float(0.35).add(forward.mul(0.55)));
    return vec4(mix(base, lit, state.daylight.mul(0.58).add(forward.mul(0.12))), alpha);
  });

  function makeCloudMaterial(node, name) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = node.rgb;
    material.opacityNode = node.a;
    material.transparent = true;
    material.alphaTest = 0.004;
    material.depthTest = true;
    material.depthWrite = false;
    material.side = THREE.BackSide;
    material.fog = false;
    material.toneMapped = false;
    material.name = name;
    return material;
  }

  const lowerRadius = 62000;
  const upperRadius = 92000;
  const lowerGeometry = new THREE.SphereGeometry(lowerRadius, 144, 72, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const upperGeometry = new THREE.SphereGeometry(upperRadius, 128, 64, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const lowerMaterial = makeCloudMaterial(lowerCloudNode(), 'ForestLab_LowerCloudMaterial');
  const upperMaterial = makeCloudMaterial(cirrusNode(), 'ForestLab_CirrusMaterial');
  const lowerClouds = new THREE.Mesh(lowerGeometry, lowerMaterial);
  const upperClouds = new THREE.Mesh(upperGeometry, upperMaterial);
  lowerClouds.name = 'ForestLab_LowerCumulusShell';
  upperClouds.name = 'ForestLab_HighCirrusShell';
  lowerClouds.frustumCulled = upperClouds.frustumCulled = false;
  lowerClouds.renderOrder = -990;
  upperClouds.renderOrder = -980;
  scene.add(lowerClouds, upperClouds);

  // The scene-linear sky radiance also supplies the distant in-scattering colour.
  const fogDensity = state.fogDensity;
  const fogHeight = state.fogHeight;
  const fogStrength = state.fogStrength;
  const fogNear = state.fogNear;
  const fogFar = state.fogFar;
  const godRays = state.godRays;
  let requestedGodRays = 0.12;
  const groundY = uniform(Number(groundLevel) || 0);
  const fogResolution = uniform(0.42);
  const marchSteps = uniform(14);
  const raySteps = uniform(10);
  const rayResolution = uniform(0.42);
  const spatialSigma = uniform(1.15);
  const depthSensitivity = uniform(22);
  const sunScreenUV = uniform(new THREE.Vector2(0.78, 0.16));

  const prePass = pass(scene, camera);
  prePass.setMRT(mrt({ output: packNormalToRGB(normalView) }));
  const preNormal = sample(uv => unpackRGBToNormal(prePass.getTextureNode().sample(uv)));
  const preDepth = prePass.getTextureNode('depth');
  const aoPass = ao(preDepth, preNormal, camera);
  aoPass.resolutionScale = 0.50;
  aoPass.samples.value = 16;
  aoPass.radius.value = 2.2;
  aoPass.thickness.value = 1.0;
  aoPass.scale.value = 1.10;
  aoPass.useTemporalFiltering = false;

  const scenePass = pass(scene, camera);
  scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
  const sceneColour = scenePass.getTextureNode('output');
  const sceneDepth = scenePass.getTextureNode('depth');
  const cameraWorld = uniform(camera.matrixWorld.clone());
  const projectionInverse = uniform(camera.projectionMatrixInverse.clone());
  const cameraPosition = state.cameraPosition;

  const hazeColourAt = Fn(([direction]) => {
    const dir = direction.normalize();
    return skyRadiance(dir).add(
      state.sunColor.mul(max(dir.dot(state.sunDirection), float(0)).pow(12).mul(godRays).mul(0.035))
    );
  });

  const hazeNode = Fn(() => {
    const depth = sceneDepth.sample(screenUV).r;
    const viewPosition = getViewPosition(screenUV, depth, projectionInverse);
    const worldPosition = cameraWorld.mul(vec4(viewPosition, 1)).xyz;
    const rayVector = worldPosition.sub(cameraPosition);
    const distance = rayVector.length();
    const direction = rayVector.normalize();

    const safeY = direction.y.greaterThanEqual(0)
      .select(direction.y.max(0.00001), direction.y.min(-0.00001));
    const t0 = groundY.sub(cameraPosition.y).div(safeY);
    const t1 = groundY.add(fogHeight).sub(cameraPosition.y).div(safeY);
    const start = t0.min(t1).max(0);
    const end = t0.max(t1).min(distance).min(start.add(4200));
    const segment = end.sub(start).max(0);
    const stepSize = segment.div(marchSteps);
    const stepVector = direction.mul(stepSize);
    const rayPoint = cameraPosition.add(direction.mul(start))
      .add(stepVector.mul(interleavedGradientNoise(screenCoordinate.xy))).toVar();
    const opticalDepth = float(0).toVar();
    Loop(marchSteps, () => {
      const altitude = rayPoint.y.sub(groundY).max(0);
      const density = exp(altitude.negate().div(fogHeight.mul(2.6).add(180)));
      opticalDepth.addAssign(density.mul(stepSize).mul(fogDensity));
      rayPoint.addAssign(stepVector);
    });
    const localFog = float(1).sub(opticalDepth.negate().exp());

    const beyond = distance.sub(fogNear).max(0);
    const horizonPath = float(1).sub(direction.y.abs()).pow(1.35);
    const pathScale = float(0.38).add(horizonPath.mul(0.88));
    const meanAltitude = cameraPosition.y.sub(groundY).max(0)
      .add(worldPosition.y.sub(groundY).max(0)).mul(0.5);
    const altitudeScale = exp(meanAltitude.negate().div(fogHeight.mul(3.2).add(420))).clamp(0.10, 1);
    const rangeOD = beyond.mul(pathScale).mul(altitudeScale)
      .mul(fogDensity.mul(0.014).add(0.0000035));
    const rangeFog = float(1).sub(rangeOD.negate().exp())
      .mul(smoothstep(fogNear, fogFar, distance));
    const amount = float(1).sub(float(1).sub(localFog).mul(float(1).sub(rangeFog)))
      .mul(fogStrength).clamp(0, 0.96);
    return isBackgroundDepth(depth).select(float(0), amount);
  });

  const lowFog = rtt(hazeNode(), null, null, {
    type: THREE.UnsignedByteType,
    format: THREE.RedFormat,
    resolutionScale: fogResolution.value
  }).setName('ForestLab_HeightIntegratedHaze');

  const upsample = Fn(([source, depthTexture]) => {
    const uv = screenUV;
    const centreDepth = getViewPosition(uv, depthTexture.sample(uv).r, projectionInverse).z.negate().max(0.1);
    const texel = fwidth(uv).div(fogResolution);
    const spatialFactor = float(-0.5).div(spatialSigma.mul(spatialSigma).max(0.01));
    const depthFactor = depthSensitivity.mul(depthSensitivity).mul(-0.5);
    const total = float(0).toVar();
    const weightTotal = float(0).toVar();
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const offset = vec2(float(x), float(y));
      const sampleUV = uv.add(offset.mul(texel));
      const spatialWeight = exp(offset.dot(offset).mul(spatialFactor));
      const sampleFog = source.sample(sampleUV);
      const sampleDepth = getViewPosition(sampleUV, depthTexture.sample(sampleUV).r, projectionInverse).z.negate().max(0.1);
      const delta = sampleDepth.sub(centreDepth).div(centreDepth.max(0.1));
      const weight = spatialWeight.mul(exp(delta.mul(delta).mul(depthFactor)));
      total.addAssign(sampleFog.mul(weight));
      weightTotal.addAssign(weight);
    }
    return total.div(weightTotal.max(0.0001));
  });
  const hazeAmount = upsample(lowFog, sceneDepth);

  const rayNode = Fn(() => {
    const uv = screenUV;
    const step = sunScreenUV.sub(uv).div(raySteps.max(1));
    const sampleUV = uv.add(step.mul(0.5))
      .add(interleavedGradientNoise(screenCoordinate.xy).mul(step)).toVar();
    const accumulation = float(0).toVar();
    const weight = float(1).toVar();
    Loop(raySteps, () => {
      const sampleDepth = sceneDepth.sample(sampleUV).r;
      const sampleColour = sceneColour.sample(sampleUV).rgb;
      const luminance = sampleColour.dot(vec3(0.2126, 0.7152, 0.0722));
      const bright = smoothstep(float(0.55), float(1.65), luminance);
      const skyVisibility = isBackgroundDepth(sampleDepth).select(float(1), float(0.035));
      accumulation.addAssign(bright.mul(skyVisibility).mul(weight));
      weight.mulAssign(0.982);
      sampleUV.addAssign(step);
    });
    return accumulation.div(raySteps.max(1)).mul(godRays);
  });
  const lowRays = rtt(rayNode(), null, null, {
    type: THREE.UnsignedByteType,
    format: THREE.RedFormat,
    resolutionScale: rayResolution.value
  }).setName('ForestLab_SolarInscatter');
  const upsampleRays = Fn(([source, depthTexture]) => {
    const uv = screenUV;
    const centreDepth = getViewPosition(uv, depthTexture.sample(uv).r, projectionInverse).z.negate().max(0.1);
    const texel = fwidth(uv).div(rayResolution);
    const spatialFactor = float(-0.5).div(spatialSigma.mul(spatialSigma).max(0.01));
    const depthFactor = depthSensitivity.mul(depthSensitivity).mul(-0.5);
    const total = float(0).toVar();
    const weightTotal = float(0).toVar();
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const offset = vec2(float(x), float(y));
      const sampleUV = uv.add(offset.mul(texel));
      const spatialWeight = exp(offset.dot(offset).mul(spatialFactor));
      const sampleRay = source.sample(sampleUV);
      const sampleDepth = getViewPosition(sampleUV, depthTexture.sample(sampleUV).r, projectionInverse).z.negate().max(0.1);
      const delta = sampleDepth.sub(centreDepth).div(centreDepth.max(0.1));
      const weight = spatialWeight.mul(exp(delta.mul(delta).mul(depthFactor)));
      total.addAssign(sampleRay.mul(weight));
      weightTotal.addAssign(weight);
    }
    return total.div(weightTotal.max(0.0001));
  });
  const rayAmount = upsampleRays(lowRays, sceneDepth);
  const hazeInscatter = Fn(() => {
    const depth = sceneDepth.sample(screenUV).r;
    const viewPosition = getViewPosition(screenUV, depth, projectionInverse);
    const worldPosition = cameraWorld.mul(vec4(viewPosition, 1)).xyz;
    const direction = worldPosition.sub(cameraPosition).normalize();
    return hazeColourAt(direction);
  });
  const composited = sceneColour.rgb.mix(hazeInscatter(), hazeAmount);
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputNode = composited.add(
    state.sunColor.mul(rayAmount.mul(float(0.12).add(hazeAmount.mul(0.48))))
  );
  pipeline.needsUpdate = true;

  // PMREM of the same clear-sky radiance used by the visible dome; no neutral grey fallback.
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const environmentScene = new THREE.Scene();
  let environmentTarget = null;
  let lastEnvironmentBake = 0;
  const skyZenith = new THREE.Color();
  const groundBounce = new THREE.Color();
  const nightSky = new THREE.Color(0x18253c);
  const daySky = new THREE.Color(0x6f9bc9);
  const nightGround = new THREE.Color(0x111b23);
  const dayGround = new THREE.Color(0x344638);
  const liveSun = new THREE.Color(0xfff4e5);

  function bakeEnvironment(force = false) {
    const now = performance.now();
    if (!force && now - lastEnvironmentBake < 2200) return;
    if (lastEnvironmentBake > 0 && now - lastEnvironmentBake < 700) return;
    lastEnvironmentBake = now;
    const savedPosition = skyDome.position.clone();
    const savedCamera = state.cameraPosition.value.clone();
    try {
      skyDome.position.set(0, 0, 0);
      state.cameraPosition.value.set(0, 0, 0);
      environmentScene.add(skyDome);
      const next = pmremGenerator.fromScene(environmentScene, 0.035);
      if (!next?.texture) throw new Error('Atmosphere PMREM bake returned no texture.');
      const previous = environmentTarget;
      environmentTarget = next;
      scene.environment = next.texture;
      scene.environmentIntensity = 0.78;
      previous?.dispose();
    } finally {
      scene.add(skyDome);
      skyDome.position.copy(savedPosition);
      state.cameraPosition.value.copy(savedCamera);
    }
  }

  function setAtmosphere({
    solar,
    turbidity = 2.2,
    rayleigh = 1.35,
    cloudCoverage = 0.42,
    cloudDensity = 0.45,
    cloudElevation = 0.55,
    wind = 9,
    sunIntensity = 0.85
  } = {}, forceEnvironment = false) {
    if (!solar) return;
    state.sunDirection.value.copy(solar.sunDirection).normalize();
    state.sunColor.value.copy(solar.sunColor);
    state.daylight.value = THREE.MathUtils.clamp(solar.daylight, 0, 1);
    state.twilight.value = THREE.MathUtils.clamp(solar.twilight, 0, 1);
    state.night.value = THREE.MathUtils.clamp(solar.nightStrength, 0, 1);
    state.turbidity.value = THREE.MathUtils.clamp(Number(turbidity), 1, 8);
    state.rayleigh.value = THREE.MathUtils.clamp(Number(rayleigh), 0.5, 2.5);
    state.cloudCoverage.value = THREE.MathUtils.clamp(Number(cloudCoverage), 0, 1);
    state.cloudDensity.value = THREE.MathUtils.clamp(Number(cloudDensity), 0, 1);
    state.cloudElevation.value = THREE.MathUtils.clamp(Number(cloudElevation), 0, 1);
    state.wind.value = THREE.MathUtils.clamp(Number(wind), 0, 60);

    liveSun.copy(solar.sunColor).lerp(new THREE.Color(0xfff2e5), state.daylight.value * 0.35);
    const fill = state.daylight.value;
    skyZenith.copy(nightSky).lerp(daySky, fill);
    groundBounce.copy(nightGround).lerp(dayGround, fill);
    hemisphere.color.copy(skyZenith);
    hemisphere.groundColor.copy(groundBounce);
    hemisphere.intensity = 0.46 + fill * 0.30 + state.night.value * 0.08;

    lowerClouds.position.set(center.x, groundLevel + 2450 + state.cloudElevation.value * 1100 - lowerRadius, center.z);
    upperClouds.position.set(center.x, groundLevel + 6100 + state.cloudElevation.value * 1400 - upperRadius, center.z);
    lowerClouds.visible = state.cloudCoverage.value > 0.012 && state.cloudDensity.value > 0.01;
    upperClouds.visible = lowerClouds.visible;
    skyDome.position.copy(camera.position);
    bakeEnvironment(forceEnvironment);
  }

  function setFog({ density, height, strength, range, rays } = {}) {
    if (density !== undefined) state.fogDensity.value = THREE.MathUtils.clamp(Number(density), 0, 0.02);
    if (height !== undefined) state.fogHeight.value = THREE.MathUtils.clamp(Number(height), 80, 600);
    if (strength !== undefined) state.fogStrength.value = THREE.MathUtils.clamp(Number(strength), 0, 1.5);
    if (range !== undefined) {
      const v = THREE.MathUtils.clamp(Number(range), 0, 1);
      state.fogNear.value = THREE.MathUtils.lerp(1500, 4200, v);
      state.fogFar.value = THREE.MathUtils.lerp(6500, 12500, v);
    }
    if (rays !== undefined) { requestedGodRays = THREE.MathUtils.clamp(Number(rays), 0, 1.5); state.godRays.value = requestedGodRays; }
  }

  function setQuality(name) {
    const profiles = {
      performance: { pixelRatio: 1.0, fog: 0.30, fogSteps: 9, rays: 0.28, raySteps: 6, ao: 0.34 },
      balanced: { pixelRatio: 1.3, fog: 0.42, fogSteps: 14, rays: 0.42, raySteps: 10, ao: 0.50 },
      cinematic: { pixelRatio: 1.6, fog: 0.58, fogSteps: 22, rays: 0.58, raySteps: 14, ao: 0.65 }
    };
    const p = profiles[name] || profiles.balanced;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatio));
    renderer.setSize(renderer.domElement.parentElement.clientWidth, renderer.domElement.parentElement.clientHeight);
    fogResolution.value = p.fog;
    marchSteps.value = p.fogSteps;
    rayResolution.value = p.rays;
    raySteps.value = p.raySteps;
    lowFog.setResolutionScale(p.fog);
    lowRays.setResolutionScale(p.rays);
    aoPass.resolutionScale = p.ao;
  }

  return {
    setAtmosphere,
    setFog,
    setQuality,
    setTime(seconds) { state.time.value = Number(seconds) || 0; },
    updateCamera() {
      state.cameraPosition.value.copy(camera.position);
      skyDome.position.copy(camera.position);
      cameraWorld.value.copy(camera.matrixWorld);
      projectionInverse.value.copy(camera.projectionMatrixInverse);
      lowerClouds.updateMatrixWorld(true);
      upperClouds.updateMatrixWorld(true);
      const sunPoint = camera.position.clone().addScaledVector(state.sunDirection.value, 100000);
      const projected = sunPoint.project(camera);
      const visible = projected.z > -1 && projected.z < 1
        && Math.abs(projected.x) < 1.35 && Math.abs(projected.y) < 1.35;
      sunScreenUV.value.set(projected.x * 0.5 + 0.5, 0.5 - projected.y * 0.5);
      state.godRays.value = visible ? requestedGodRays : 0;
    },
    render() { pipeline.render(); },
    dispose() {
      scene.remove(skyDome, lowerClouds, upperClouds);
      skyGeometry.dispose();
      skyMaterial.dispose();
      lowerGeometry.dispose();
      upperGeometry.dispose();
      lowerMaterial.dispose();
      upperMaterial.dispose();
      environmentTarget?.dispose();
      pmremGenerator.dispose();
    }
  };
}
