/*
 * Grade Optimizer — procedural sky and weather.
 * Uses ordinary Three.js materials and canvas textures; intentionally contains
 * no custom GLSL so a shader compile failure cannot turn the sky into a black dome.
 */
export class WeatherSystem {
  static PRESETS = {
    clear:    { label: 'Ясно', clouds: 0.00, snowfall: 0,    wind: 2,  visibility: 1.00 },
    partly:   { label: 'Переменная облачность', clouds: 0.34, snowfall: 0,    wind: 5,  visibility: 0.96 },
    cloudy:   { label: 'Облачно', clouds: 0.66, snowfall: 0,    wind: 9,  visibility: 0.86 },
    overcast: { label: 'Пасмурно', clouds: 0.96, snowfall: 0,    wind: 13, visibility: 0.73 },
    snow:     { label: 'Снегопад', clouds: 0.76, snowfall: 0.38, wind: 18, visibility: 0.55 },
    blizzard: { label: 'Метель', clouds: 1.00, snowfall: 1.00, wind: 46, visibility: 0.25 }
  };

  constructor({ THREE, scene, camera, hemisphere, sun, fogNear = 1800, fogFar = 9000 }) {
    this.THREE = THREE;
    this.scene = scene;
    this.camera = camera;
    this.hemisphere = hemisphere;
    this.sun = sun;
    this.baseFogNear = fogNear;
    this.baseFogFar = fogFar;
    this.sunDirection = new THREE.Vector3(0, 1, 0);
    this.cameraPosition = new THREE.Vector3();
    this.elapsed = 0;
    this.params = { ...WeatherSystem.PRESETS.clear, preset: 'clear' };
    this.lastSkyColors = null;
    this.nightCloudColor = new THREE.Color(0x536477);
    this.dayCloudColor = new THREE.Color(0xf2f5f7);
    this.mutedCloudColor = new THREE.Color(0xc4d0d9);

    this.skyCanvas = document.createElement('canvas');
    this.skyCanvas.width = 1024;
    this.skyCanvas.height = 512;
    this.skyContext = this.skyCanvas.getContext('2d', { alpha: false });
    // Use the equirectangular canvas directly as the scene background.
    // There is deliberately no sky-dome mesh or enclosing sphere geometry.
    this.skyTexture = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTexture.colorSpace = THREE.SRGBColorSpace;
    this.skyTexture.mapping = THREE.EquirectangularReflectionMapping;
    this.skyTexture.minFilter = THREE.LinearFilter;
    this.skyTexture.magFilter = THREE.LinearFilter;
    this.previousSceneBackground = this.scene.background;
    this.scene.background = this.skyTexture;

    this.sunTexture = this.makeSunTexture();
    this.sunMaterial = new THREE.SpriteMaterial({
      map: this.sunTexture,
      color: 0xfff0d1,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false
    });
    this.sunGlow = new THREE.Sprite(this.sunMaterial);
    this.sunGlow.name = 'GO_SunGlow';
    this.sunGlow.scale.set(1450, 1450, 1);
    this.sunGlow.renderOrder = -950;
    this.scene.add(this.sunGlow);

    this.cloudTexture = this.makeCloudTexture();
    this.cloudMaterial = new THREE.SpriteMaterial({
      map: this.cloudTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false
    });
    this.clouds = [];
    let seed = 0x5a17c9;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < 48; i++) {
      const azimuth = i * goldenAngle + random() * 0.28;
      const elevation = 0.055 + random() * 0.33;
      const radius = 8300 + random() * 1500;
      const horizontal = Math.cos(elevation) * radius;
      const offset = new THREE.Vector3(
        Math.cos(azimuth) * horizontal,
        Math.sin(elevation) * radius,
        Math.sin(azimuth) * horizontal
      );
      const sprite = new THREE.Sprite(this.cloudMaterial);
      sprite.name = 'GO_Cloud_' + String(i + 1).padStart(2, '0');
      const width = 1150 + random() * 1850;
      const height = width * (0.28 + random() * 0.16);
      sprite.scale.set(width, height, 1);
      sprite.renderOrder = -900;
      sprite.visible = false;
      this.scene.add(sprite);
      this.clouds.push({ sprite, offset, baseX: offset.x, baseZ: offset.z, phase: random() * Math.PI * 2 });
    }

    this.snowTexture = this.makeSnowTexture();
    // Particles live in camera space and are seeded inside the visible frustum.
    // This keeps snowfall visible from every camera angle without a large world-space volume.
    this.snowCount = 1500;
    this.snowPositions = new Float32Array(this.snowCount * 3);
    this.snowVelocity = new Float32Array(this.snowCount * 2);
    const snowTanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    for (let i = 0; i < this.snowCount; i++) {
      const j = i * 3;
      const depth = 8 + random() * 62;
      const halfHeight = depth * snowTanHalfFov * 0.92;
      const halfWidth = halfHeight * (camera.aspect || 1) * 0.92;
      this.snowPositions[j] = (random() * 2 - 1) * halfWidth;
      this.snowPositions[j + 1] = (random() * 2 - 1) * halfHeight;
      this.snowPositions[j + 2] = -depth;
      this.snowVelocity[i * 2] = 0.55 + random() * 0.8;
      this.snowVelocity[i * 2 + 1] = (random() - 0.5) * 0.45;
    }
    // Instanced textured quads avoid the missing-UV issue with PointsMaterial
    // and keep all flakes in one draw call.
    this.snowGeometry = new THREE.PlaneGeometry(1, 1);
    this.snowMaterial = new THREE.MeshBasicMaterial({
      color: 0xf7fbff,
      map: this.snowTexture,
      transparent: true,
      opacity: 0.76,
      alphaTest: 0.025,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false
    });
    this.snow = new THREE.InstancedMesh(this.snowGeometry, this.snowMaterial, this.snowCount);
    this.snow.name = 'GO_Snowfall';
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 1000;
    this.snow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.snowDummy = new THREE.Object3D();
    this.snowSize = new Float32Array(this.snowCount);
    for (let i = 0; i < this.snowCount; i++) {
      const j = i * 3;
      this.snowSize[i] = 0.65 + random() * 0.9;
      this.snowDummy.position.set(this.snowPositions[j], this.snowPositions[j + 1], this.snowPositions[j + 2]);
      const size = -this.snowPositions[j + 2] * 0.0032 * this.snowSize[i];
      this.snowDummy.scale.set(size, size, 1);
      this.snowDummy.updateMatrix();
      this.snow.setMatrixAt(i, this.snowDummy.matrix);
    }
    this.snow.instanceMatrix.needsUpdate = true;
    this.activeSnowflakes = 0;
    this.snow.count = 0;
    this.snow.visible = false;
    this.camera.add(this.snow);

    this.streakCount = 240;
    this.streakPositions = new Float32Array(this.streakCount * 6);
    for (let i = 0; i < this.streakCount; i++) {
      const j = i * 6;
      const depth = 9 + random() * 60;
      const halfHeight = depth * snowTanHalfFov * 0.90;
      const halfWidth = halfHeight * (camera.aspect || 1) * 0.90;
      const x = (random() * 2 - 1) * halfWidth;
      const y = (random() * 2 - 1) * halfHeight;
      const z = -depth;
      this.streakPositions[j] = x;
      this.streakPositions[j + 1] = y;
      this.streakPositions[j + 2] = z;
      this.streakPositions[j + 3] = x + 0.12;
      this.streakPositions[j + 4] = y + 0.55;
      this.streakPositions[j + 5] = z;
    }
    this.streakGeometry = new THREE.BufferGeometry();
    this.streakGeometry.setAttribute('position', new THREE.BufferAttribute(this.streakPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.streakMaterial = new THREE.LineBasicMaterial({
      color: 0xf4f9ff, transparent: true, opacity: 0.28,
      depthWrite: false, depthTest: true, fog: false
    });
    this.streaks = new THREE.LineSegments(this.streakGeometry, this.streakMaterial);
    this.streaks.name = 'GO_WindDrivenSnowStreaks';
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 1001;
    this.streakGeometry.setDrawRange(0, 0);
    this.camera.add(this.streaks);

    this.applyWeather(this.params);
    this.drawSky({
      top: new THREE.Color(0x4b83b8),
      horizon: new THREE.Color(0xd6e5ef),
      bottom: new THREE.Color(0x94a9b8),
      sunColor: new THREE.Color(0xfff2d9),
      sunStrength: 1
    });
  }

  colorCss(color) {
    return color.getStyle(this.THREE.SRGBColorSpace);
  }

  makeSunTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 2, 128, 128, 126);
    g.addColorStop(0, 'rgba(255,255,246,1)');
    g.addColorStop(0.12, 'rgba(255,244,218,0.95)');
    g.addColorStop(0.30, 'rgba(255,219,161,0.36)');
    g.addColorStop(0.62, 'rgba(255,194,128,0.08)');
    g.addColorStop(1, 'rgba(255,190,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.colorSpace = this.THREE.SRGBColorSpace;
    return texture;
  }

  makeCloudTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 384;
    const ctx = canvas.getContext('2d');
    // Broad soft cloud body.
    const body = ctx.createLinearGradient(0, 70, 0, 360);
    body.addColorStop(0, 'rgba(255,255,255,0)');
    body.addColorStop(0.28, 'rgba(255,255,255,0.22)');
    body.addColorStop(0.58, 'rgba(242,248,252,0.42)');
    body.addColorStop(0.83, 'rgba(190,207,220,0.17)');
    body.addColorStop(1, 'rgba(190,207,220,0)');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(384, 215, 340, 104, 0, 0, Math.PI * 2);
    ctx.fill();

    let seed = 0x2185;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 38; i++) {
      const x = 55 + random() * 658;
      const y = 105 + random() * 175;
      const rx = 32 + random() * 76;
      const ry = 22 + random() * 47;
      const gradient = ctx.createRadialGradient(x - rx * 0.16, y - ry * 0.25, 1, x, y, Math.max(rx, ry));
      gradient.addColorStop(0, 'rgba(255,255,255,0.60)');
      gradient.addColorStop(0.45, 'rgba(250,253,255,0.38)');
      gradient.addColorStop(0.78, 'rgba(228,238,246,0.15)');
      gradient.addColorStop(1, 'rgba(218,230,239,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, (random() - 0.5) * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.colorSpace = this.THREE.SRGBColorSpace;
    texture.minFilter = this.THREE.LinearMipmapLinearFilter;
    texture.magFilter = this.THREE.LinearFilter;
    texture.generateMipmaps = true;
    return texture;
  }

  makeSnowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.88)');
    g.addColorStop(0.72, 'rgba(225,240,250,0.28)');
    g.addColorStop(1, 'rgba(225,240,250,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.colorSpace = this.THREE.SRGBColorSpace;
    return texture;
  }

  drawSky({ top, horizon, bottom, sunColor, sunStrength, sunDirection, sunVisible = true }) {
    const ctx = this.skyContext;
    if (!ctx) return;
    const last = this.lastSkyColors;
    const skyColorChanged = !last || Math.max(
      Math.abs(top.r - last.top.r), Math.abs(top.g - last.top.g), Math.abs(top.b - last.top.b),
      Math.abs(horizon.r - last.horizon.r), Math.abs(horizon.g - last.horizon.g), Math.abs(horizon.b - last.horizon.b),
      Math.abs(bottom.r - last.bottom.r), Math.abs(bottom.g - last.bottom.g), Math.abs(bottom.b - last.bottom.b)
    ) > 0.0018;
    if (skyColorChanged) {
      const gradient = ctx.createLinearGradient(0, 0, 0, this.skyCanvas.height);
      gradient.addColorStop(0, this.colorCss(top));
      gradient.addColorStop(0.47, this.colorCss(horizon));
      gradient.addColorStop(0.72, this.colorCss(bottom));
      gradient.addColorStop(1, this.colorCss(bottom));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.skyCanvas.width, this.skyCanvas.height);
      this.skyTexture.needsUpdate = true;
      this.lastSkyColors = {
        top: top.clone(),
        horizon: horizon.clone(),
        bottom: bottom.clone()
      };
    }
    this.sunMaterial.color.copy(sunColor);
    this.sunMaterial.opacity = this.THREE.MathUtils.clamp(sunStrength * (1 - this.params.clouds * 0.46), 0, 0.9);
    this.cloudMaterial.color.copy(this.nightCloudColor).lerp(
      this.dayCloudColor,
      this.THREE.MathUtils.clamp(sunStrength * 1.4 + 0.08, 0.08, 1)
    );
    this.cloudMaterial.color.lerp(horizon, 0.12 + this.params.clouds * 0.22);
    this.sunGlow.visible = !!sunDirection && sunVisible && sunStrength > 0.025;
    if (sunDirection) {
      this.sunDirection.copy(sunDirection).normalize();
      this.sunGlow.position.copy(this.camera.position).addScaledVector(this.sunDirection, 10600);
    }
  }

  getLighting() {
    return {
      direct: this.THREE.MathUtils.clamp(1 - this.params.clouds * 0.56 - this.params.snowfall * 0.12, 0.28, 1),
      ambient: 1 + this.params.clouds * 0.17 + this.params.snowfall * 0.06,
      sky: 1 - this.params.clouds * 0.22 - this.params.snowfall * 0.08
    };
  }

  getSettings() {
    return { preset: this.params.preset, clouds: this.params.clouds, snowfall: this.params.snowfall, wind: this.params.wind };
  }

  applyWeather(next) {
    this.params = {
      ...this.params,
      ...next,
      clouds: this.THREE.MathUtils.clamp(Number(next.clouds ?? this.params.clouds), 0, 1),
      snowfall: this.THREE.MathUtils.clamp(Number(next.snowfall ?? this.params.snowfall), 0, 1),
      wind: this.THREE.MathUtils.clamp(Number(next.wind ?? this.params.wind), 0, 60),
      visibility: this.THREE.MathUtils.clamp(Number(next.visibility ?? this.params.visibility ?? 1), 0.15, 1)
    };
    const coverage = this.params.clouds;
    const active = Math.round(coverage * this.clouds.length);
    this.clouds.forEach((cloud, index) => {
      cloud.sprite.visible = index < active;
    });
    this.cloudMaterial.opacity = 0.12 + coverage * 0.43;
    this.cloudMaterial.color.set(0xffffff).lerp(this.mutedCloudColor, coverage * 0.42);

    const flakes = Math.round(this.snowCount * this.params.snowfall);
    this.activeSnowflakes = flakes;
    this.snow.count = flakes;
    this.snow.visible = flakes > 0;
    this.snowMaterial.opacity = 0.58 + this.params.snowfall * 0.28;
    const streakFactor = this.THREE.MathUtils.clamp((this.params.wind - 12) / 42, 0, 1);
    this.activeStreaks = Math.round(this.streakCount * this.params.snowfall * streakFactor);
    this.streaks.visible = this.activeStreaks > 0;
    this.streakGeometry.setDrawRange(0, this.activeStreaks * 2);
    this.streakMaterial.opacity = 0.14 + streakFactor * 0.24;
    const fog = this.scene.fog;
    if (fog && fog.isFog) {
      const visibility = this.params.visibility * (1 - coverage * 0.12) * (1 - this.params.snowfall * 0.42);
      fog.near = this.baseFogNear * (0.72 + visibility * 0.28);
      fog.far = this.baseFogFar * (0.34 + visibility * 0.66);
    }
  }

  setPreset(name) {
    const preset = WeatherSystem.PRESETS[name];
    if (!preset) return false;
    this.applyWeather({ ...preset, preset: name });
    return true;
  }

  setCustom(values) {
    const clouds = this.THREE.MathUtils.clamp(Number(values.clouds ?? this.params.clouds), 0, 1);
    const snowfall = this.THREE.MathUtils.clamp(Number(values.snowfall ?? this.params.snowfall), 0, 1);
    const wind = this.THREE.MathUtils.clamp(Number(values.wind ?? this.params.wind), 0, 60);
    const visibility = Math.max(0.2, 1 - clouds * 0.14 - snowfall * 0.48 - Math.max(0, wind - 8) * 0.003);
    this.applyWeather({ ...values, clouds, snowfall, wind, visibility, preset: 'custom' });
  }

  update(deltaSeconds, cameraPosition) {
    const dt = Math.min(Math.max(deltaSeconds || 0, 0), 0.05);
    this.elapsed += dt;
    if (cameraPosition) this.cameraPosition.copy(cameraPosition);
    this.sunGlow.position.copy(this.cameraPosition).addScaledVector(this.sunDirection, 10600);

    const wind = this.params.wind;
    const drift = wind * dt * 1.7;
    const breeze = wind * dt * 0.34;
    for (const cloud of this.clouds) {
      cloud.offset.x += drift;
      cloud.offset.z += breeze;
      if (cloud.offset.x > 10400) cloud.offset.x -= 20800;
      if (cloud.offset.x < -10400) cloud.offset.x += 20800;
      if (cloud.offset.z > 10400) cloud.offset.z -= 20800;
      if (cloud.offset.z < -10400) cloud.offset.z += 20800;
      if (cloud.sprite.visible) cloud.sprite.position.copy(this.cameraPosition).add(cloud.offset);
    }

    // Snow is a camera-space layer: every active flake starts in front of the lens
    // and remains inside the view frustum. This avoids invisible particles behind
    // the camera and keeps the effect stable while skiing or flying.
    if (this.activeSnowflakes > 0) {
      this.snow.quaternion.identity();
      this.streaks.quaternion.identity();
      const fall = (10 + this.params.snowfall * 17 + wind * 0.12) * dt;
      const lateral = (wind * 0.035 + 0.012) * dt;
      const tanHalfFov = Math.tan(this.THREE.MathUtils.degToRad(this.camera.fov * 0.5));
      const aspect = this.camera.aspect || 1;
      for (let i = 0; i < this.activeSnowflakes; i++) {
        const j = i * 3;
        const depth = Math.max(8, -this.snowPositions[j + 2]);
        const halfHeight = depth * tanHalfFov * 0.92;
        const halfWidth = halfHeight * aspect * 0.92;
        this.snowPositions[j] += lateral * this.snowVelocity[i * 2];
        this.snowPositions[j + 1] -= fall;
        if (this.snowPositions[j + 1] < -halfHeight) {
          this.snowPositions[j + 1] = halfHeight;
          this.snowPositions[j] = (Math.random() * 2 - 1) * halfWidth;
        }
        if (this.snowPositions[j] > halfWidth) this.snowPositions[j] -= halfWidth * 2;
        if (this.snowPositions[j] < -halfWidth) this.snowPositions[j] += halfWidth * 2;
        this.snowDummy.position.set(
          this.snowPositions[j],
          this.snowPositions[j + 1],
          this.snowPositions[j + 2]
        );
        const flakeSize = depth * 0.0032 * this.snowSize[i] * (0.78 + this.params.snowfall * 0.42);
        this.snowDummy.scale.set(flakeSize, flakeSize, 1);
        this.snowDummy.updateMatrix();
        this.snow.setMatrixAt(i, this.snowDummy.matrix);
      }
      this.snow.instanceMatrix.needsUpdate = true;

      if (this.activeStreaks > 0) {
        const streakFall = fall * 1.55;
        for (let i = 0; i < this.activeStreaks; i++) {
          const j = i * 6;
          const depth = Math.max(9, -this.streakPositions[j + 2]);
          const halfHeight = depth * tanHalfFov * 0.90;
          const halfWidth = halfHeight * aspect * 0.90;
          this.streakPositions[j] += lateral * 1.6;
          this.streakPositions[j + 1] -= streakFall;
          if (this.streakPositions[j + 1] < -halfHeight) {
            this.streakPositions[j + 1] = halfHeight;
            this.streakPositions[j] = (Math.random() * 2 - 1) * halfWidth;
          }
          if (this.streakPositions[j] > halfWidth) this.streakPositions[j] -= halfWidth * 2;
          if (this.streakPositions[j] < -halfWidth) this.streakPositions[j] += halfWidth * 2;
          const streakLength = 0.7 + wind * 0.018;
          this.streakPositions[j + 3] = this.streakPositions[j] + 0.10 + wind * 0.002;
          this.streakPositions[j + 4] = this.streakPositions[j + 1] + streakLength;
          this.streakPositions[j + 5] = this.streakPositions[j + 2];
        }
        this.streakGeometry.attributes.position.needsUpdate = true;
      }
    }
  }

  dispose() {
    this.scene.remove(this.sunGlow);
    this.clouds.forEach(({ sprite }) => this.scene.remove(sprite));
    this.camera.remove(this.snow, this.streaks);
    if (this.scene.background === this.skyTexture) {
      this.scene.background = this.previousSceneBackground ?? null;
    }
    this.skyTexture.dispose();
    this.sunMaterial.dispose();
    this.sunTexture.dispose();
    this.cloudMaterial.dispose();
    this.cloudTexture.dispose();
    this.snowGeometry.dispose();
    this.snowMaterial.dispose();
    this.snowTexture.dispose();
    this.streakGeometry.dispose();
    this.streakMaterial.dispose();
  }
}
