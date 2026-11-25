// Shared TSL cloud-volume layer for the isolated WebGPU look-development labs.
// Visual model adapted from the project's existing WeatherSystem v9 cloud field:
// broad / medium / fine noise, erosion, six vertical integration slices and solar rim light.
// This is a vertically integrated cloud sheet, not a full ray-marched Hillaire atmosphere.

import {
  Fn, exp, float, floor, fract, max, mix, sin, smoothstep,
  vec2, vec3, vec4, positionWorld, uniform
} from 'three/tsl';

export function createCloudLayer(THREE, scene, { center = new THREE.Vector3() } = {}) {
  const state = {
    time: uniform(0),
    coverage: uniform(0.42),
    density: uniform(0.45),
    wind: uniform(9),
    daylight: uniform(1),
    twilight: uniform(0),
    rayStrength: uniform(0.28),
    sunDirection: uniform(new THREE.Vector3(0, 1, 0)),
    sunColor: uniform(new THREE.Color(0xfff0e5)),
    cameraPosition: uniform(new THREE.Vector3())
  };

  const hash21 = Fn(([point]) => {
    const q = fract(vec3(point.x, point.y, point.x).mul(0.1031));
    const seeded = q.add(q.dot(q.yzx.add(33.33)));
    return fract(seeded.x.add(seeded.y).mul(seeded.z));
  });

  const noise2 = Fn(([point]) => {
    const cell = floor(point);
    const local = fract(point);
    const blend = local.mul(local).mul(float(3).sub(local.mul(2)));
    const a = hash21(cell);
    const b = hash21(cell.add(vec2(1, 0)));
    const c = hash21(cell.add(vec2(0, 1)));
    const d = hash21(cell.add(vec2(1, 1)));
    return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
  });

  const cloudFbm = Fn(([point]) => {
    const broad = noise2(point);
    const medium = noise2(point.mul(2.03).add(vec2(17.1, 9.2)));
    const fine = noise2(point.mul(4.13).add(vec2(-8.4, 13.7)));
    return broad.mul(0.54).add(medium.mul(0.30)).add(fine.mul(0.16));
  });

  const output = Fn(() => {
    const drift = vec2(
      state.time.mul(float(0.014).add(state.wind.mul(0.00020))),
      state.time.mul(float(0.006).add(state.wind.mul(0.00010)))
    );
    const p = positionWorld.xz.mul(0.00029).sub(drift);
    const broad = cloudFbm(p);
    const detail = noise2(p.mul(3.25).add(vec2(11.7, -4.1)));
    const erosion = noise2(p.mul(7.1).sub(drift.mul(1.45)).add(vec2(4.8, 16.2)));
    const threshold = float(0.72).sub(state.coverage.mul(0.43));
    const carvedField = broad
      .add(detail.sub(0.5).mul(0.19))
      .sub(erosion.sub(0.5).mul(0.10));
    const field = smoothstep(threshold, threshold.add(0.21), carvedField);
    const wisps = float(1).sub(smoothstep(0.24, 0.52, broad))
      .mul(smoothstep(0.60, 0.91, detail))
      .mul(smoothstep(0.035, 0.30, state.coverage));

    const baseHeight = float(0.11).add(noise2(p.mul(0.34).add(vec2(3.4, 8.1))).mul(0.13));
    const topHeight = float(0.75).add(noise2(p.mul(0.47).add(vec2(-7.3, 4.8))).mul(0.21));
    const integratedDensity = float(0).toVar();
    const upperLit = float(0).toVar();

    // Integrate the cloud's vertical profile in six deterministic slices,
    // matching the authored WeatherSystem v9 visual rather than a flat sprite.
    for (let index = 0; index < 6; index++) {
      const h = float((index + 0.5) / 6);
      const lowerShape = smoothstep(baseHeight, baseHeight.add(0.16), h);
      const upperShape = float(1).sub(smoothstep(topHeight.sub(0.15), topHeight, h));
      const verticalShape = lowerShape.mul(upperShape);
      const billow = float(0.80).add(detail.mul(0.30))
        .add(float(1).sub(h.sub(0.52).abs()).mul(0.12));
      const mainLayer = field.mul(verticalShape).mul(billow);
      const cirrusLayer = wisps.mul(smoothstep(0.56, 0.82, h))
        .mul(float(1).sub(smoothstep(0.91, 0.99, h))).mul(0.16);
      const sampleDensity = mainLayer.add(cirrusLayer);
      integratedDensity.addAssign(sampleDensity.div(6));
      upperLit.addAssign(sampleDensity.mul(smoothstep(0.42, 0.88, h)).div(6));
    }

    const shadowA = noise2(p.add(state.sunDirection.xz.mul(0.20)));
    const shadowB = noise2(p.mul(1.34).add(state.sunDirection.xz.mul(0.43)));
    const shadowDensity = smoothstep(threshold, threshold.add(0.16), shadowA)
      .add(smoothstep(threshold, threshold.add(0.16), shadowB).mul(0.55));
    const sunlightTransmittance = exp(shadowDensity.mul(-0.24));
    const density = integratedDensity.mul(state.density);
    const alpha = float(1).sub(exp(density.mul(-13.5)))
      .mul(float(0.23).add(state.coverage.mul(0.46))).clamp(0, 0.72);

    const viewDirection = state.cameraPosition.sub(positionWorld).normalize();
    const lightDirection = state.sunDirection.negate().normalize();
    const forwardScatter = max(viewDirection.dot(lightDirection), 0).pow(7);
    const topLighting = upperLit.div(integratedDensity.max(0.001)).clamp(0, 1);
    const cloudEdge = smoothstep(0.015, 0.20, field)
      .mul(float(1).sub(smoothstep(0.60, 0.98, field)));
    const rimLight = cloudEdge.mul(float(0.18).add(forwardScatter.mul(0.82)))
      .mul(float(0.20).add(state.daylight.mul(0.80)));

    const coolUnderside = mix(
      vec3(0.055, 0.080, 0.135),
      vec3(0.27, 0.34, 0.43),
      state.daylight
    );
    const sunlitCloud = state.sunColor.mul(float(0.40).add(sunlightTransmittance.mul(0.66)));
    const lightingMix = float(0.16).add(state.daylight.mul(0.48))
      .add(topLighting.mul(0.28)).clamp(0, 0.94);
    let cloudColor = mix(coolUnderside, sunlitCloud, lightingMix);
    cloudColor = cloudColor.mul(float(0.72).add(sunlightTransmittance.mul(0.38)));
    cloudColor = cloudColor.add(state.sunColor.mul(
      rimLight.mul(0.32).add(forwardScatter.mul(state.rayStrength).mul(1.45))
    ));
    cloudColor = mix(
      cloudColor,
      vec3(1.0, 0.48, 0.42),
      state.twilight.mul(float(0.08).add(field.mul(0.14)))
    );
    return vec4(cloudColor, alpha);
  })();

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = output.rgb;
  material.opacityNode = output.a;
  material.transparent = true;
  material.alphaTest = 0.008;
  material.depthTest = true;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.toneMapped = false;
  material.fog = false;

  const geometry = new THREE.PlaneGeometry(24000, 24000);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'GO_TSL_VolumetricCloudLayer';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(center.x, 2760, center.z);
  mesh.frustumCulled = false;
  mesh.renderOrder = -900;
  scene.add(mesh);

  function setAtmosphere({
    coverage = 0.42,
    density = 0.45,
    elevation = 0.55,
    wind = 9,
    daylight = 1,
    twilight = 0,
    rayStrength = 0.28,
    sunDirection,
    sunColor
  } = {}) {
    state.coverage.value = THREE.MathUtils.clamp(Number(coverage), 0, 1);
    state.density.value = THREE.MathUtils.clamp(Number(density), 0, 1);
    state.wind.value = THREE.MathUtils.clamp(Number(wind), 0, 60);
    state.daylight.value = THREE.MathUtils.clamp(Number(daylight), 0, 1);
    state.twilight.value = THREE.MathUtils.clamp(Number(twilight), 0, 1);
    state.rayStrength.value = THREE.MathUtils.clamp(Number(rayStrength), 0, 1.5);
    if (sunDirection) state.sunDirection.value.copy(sunDirection).normalize();
    if (sunColor) state.sunColor.value.copy(sunColor);
    mesh.position.y = 2100 + THREE.MathUtils.clamp(Number(elevation), 0, 1) * 1200;
    mesh.visible = state.coverage.value > 0.015 && state.density.value > 0.002;
    mesh.updateMatrixWorld(true);
  }

  return {
    mesh,
    setAtmosphere,
    setTime(seconds) { state.time.value = Number(seconds) || 0; },
    updateCamera(position) { state.cameraPosition.value.copy(position); },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    }
  };
}
