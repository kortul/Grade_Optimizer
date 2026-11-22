import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const LENS_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uDirtMap: { value: null },
    uSunUv: { value: new THREE.Vector2(-2, -2) },
    uSunStrength: { value: 0 },
    uFlareStrength: { value: 0.48 },
    uDirtStrength: { value: 0.12 },
    uVignetteStrength: { value: 0.12 },
    uChromaticStrength: { value: 0.0008 },
    uGrainStrength: { value: 0.0015 },
    uSharpness: { value: 0.08 },
    uTemperature: { value: 6500 },
    uTint: { value: 0 },
    uContrast: { value: 1.04 },
    uSaturation: { value: 1.04 },
    uShadowLift: { value: 0.12 },
    uHighlightCompression: { value: 0.18 },
    uDistortion: { value: 0.00008 },
    uTexelSize: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uAspect: { value: 1 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform sampler2D uDirtMap;
    uniform vec2 uSunUv;
    uniform float uSunStrength;
    uniform float uFlareStrength;
    uniform float uDirtStrength;
    uniform float uVignetteStrength;
    uniform float uChromaticStrength;
    uniform float uGrainStrength;
    uniform float uSharpness;
    uniform float uTemperature;
    uniform float uTint;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uShadowLift;
    uniform float uHighlightCompression;
    uniform float uDistortion;
    uniform vec2 uTexelSize;
    uniform float uAspect;
    varying vec2 vUv;

    float softGhost(vec2 uv, vec2 center, vec2 radius) {
      vec2 d = (uv - center) / radius;
      return exp(-dot(d, d) * 1.65);
    }

    float hashNoise(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = vUv;
      vec2 radial = (uv - 0.5) * vec2(uAspect, 1.0);
      vec2 lensUv = uv + (uv - 0.5) * dot(radial, radial) * uDistortion;
      vec2 aberration = radial * uChromaticStrength;
      vec3 color;
      color.r = texture2D(tDiffuse, lensUv + aberration).r;
      color.g = texture2D(tDiffuse, lensUv).g;
      color.b = texture2D(tDiffuse, lensUv - aberration).b;

      // Restrained micro-sharpening restores fine terrain detail after bloom.
      if (uSharpness > 0.001) {
        vec3 neighbours =
          texture2D(tDiffuse, lensUv + vec2(uTexelSize.x, 0.0)).rgb +
          texture2D(tDiffuse, lensUv - vec2(uTexelSize.x, 0.0)).rgb +
          texture2D(tDiffuse, lensUv + vec2(0.0, uTexelSize.y)).rgb +
          texture2D(tDiffuse, lensUv - vec2(0.0, uTexelSize.y)).rgb;
        color += (color - neighbours * 0.25) * uSharpness;
      }

      // White balance and tint are camera-level controls, not material edits.
      float temperatureShift = clamp((uTemperature - 6500.0) / 3500.0, -1.0, 1.0);
      color.r *= 1.0 + temperatureShift * 0.13;
      color.g *= 1.0 - abs(temperatureShift) * 0.018 + uTint * 0.045;
      color.b *= 1.0 - temperatureShift * 0.16;

      float luminance = dot(max(color, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luminance), color, uSaturation);
      color = (color - vec3(0.18)) * uContrast + vec3(0.18);

      float shadowMask = 1.0 - smoothstep(0.045, 0.48, luminance);
      color += vec3(1.0, 0.98, 0.94) * shadowMask * uShadowLift * 0.16;
      float highlightMask = smoothstep(0.42, 0.96, luminance);
      color *= 1.0 - highlightMask * uHighlightCompression * 0.12;

      float edge = smoothstep(0.22, 1.08, length(radial));
      color *= 1.0 - edge * uVignetteStrength;

      if (uSunStrength > 0.001 && uFlareStrength > 0.001) {
        vec2 axis = vec2(0.5) - uSunUv;
        vec2 ghostA = uSunUv + axis * 0.38;
        vec2 ghostB = uSunUv + axis * 0.72;
        vec2 ghostC = uSunUv + axis * 1.10;
        vec2 ghostD = uSunUv - axis * 0.22;
        float ghosts =
          softGhost(uv, ghostA, vec2(0.046, 0.072)) * 0.62 +
          softGhost(uv, ghostB, vec2(0.024, 0.038)) * 0.48 +
          softGhost(uv, ghostC, vec2(0.060, 0.090)) * 0.34 +
          softGhost(uv, ghostD, vec2(0.082, 0.032)) * 0.28;

        vec2 sunDelta = uv - uSunUv;
        float anamorphicStreak =
          exp(-abs(sunDelta.y) * 270.0) *
          exp(-abs(sunDelta.x) * 3.9) * 0.19;
        float coreGlow = exp(-dot(sunDelta * vec2(1.0, 1.35), sunDelta * vec2(1.0, 1.35)) * 950.0);

        color += vec3(0.68, 0.80, 1.0) * ghosts * uSunStrength * uFlareStrength;
        color += vec3(1.0, 0.91, 0.78) * anamorphicStreak * uSunStrength * uFlareStrength;
        color += vec3(1.0, 0.94, 0.82) * coreGlow * uSunStrength * uFlareStrength * 0.42;
      }

      float dirtHighlightMask = smoothstep(0.34, 0.98, luminance);
      float dirt = texture2D(uDirtMap, uv).r;
      color += vec3(1.0, 0.97, 0.91) * dirt * dirtHighlightMask * uDirtStrength;

      if (uGrainStrength > 0.00001) {
        float noise = hashNoise(gl_FragCoord.xy) - 0.5;
        color += noise * uGrainStrength;
      }

      gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
    }
  `
};

export class CameraOptics {
  constructor({ renderer, scene, camera, width = 1, height = 1 }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.enabled = true;
    this.flareEnabled = true;
    this.bokehEnabled = false;
    this.bloomAmount = 0.58;
    this.bloomThreshold = 0.78;
    this.flareStrength = 0.68;
    this.dirtStrength = 0.38;
    this.vignetteStrength = 0.24;
    this.chromaticStrength = 0.18;
    this.grainStrength = 0.04;
    this.sharpness = 0.12;
    this.temperature = 6500;
    this.tint = 0;
    this.contrast = 1.04;
    this.saturation = 1.04;
    this.shadowLift = 0.12;
    this.highlightCompression = 0.18;
    this.distortion = 0.06;
    this.focusDistance = 48;
    this.focusMode = 'target';
    this.apertureFStop = 4;
    this.quality = 'balanced';
    this.composerFailed = false;
    this.composerFailureReason = '';
    this._composerRendering = false;
    this._composerPixelRatio = renderer.getPixelRatio();
    this._composerWidth = this.width;
    this._composerHeight = this.height;
    this._previousShaderErrorHandler = renderer.debug?.onShaderError ?? null;
    this._shaderErrorHandler = (gl, program, vertexShader, fragmentShader) => {
      let fragmentSource = '';
      try { fragmentSource = gl.getShaderSource(fragmentShader) || ''; } catch (error) {}
      if (this._composerRendering && (fragmentSource.includes('uDirtMap') || fragmentSource.includes('uSunUv'))) {
        this._markComposerFailed('Camera optics shader compilation/link failed.');
      }
      if (typeof this._previousShaderErrorHandler === 'function') {
        this._previousShaderErrorHandler(gl, program, vertexShader, fragmentShader);
      }
    };
    if (renderer.debug) renderer.debug.onShaderError = this._shaderErrorHandler;
    this.sunWorld = new THREE.Vector3();
    this.sunClip = new THREE.Vector3();
    this.focusView = new THREE.Vector3();

    this.dirtTexture = this.makeDirtTexture();
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.bokehPass = new BokehPass(scene, camera, {
      focus: this.focusDistance,
      aperture: this.apertureValue(),
      maxblur: 0.006,
      width: this.width,
      height: this.height
    });
    this.bokehPass.enabled = false;

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      0.48,
      0.48,
      this.bloomThreshold
    );
    this.lensPass = new ShaderPass(LENS_SHADER);
    this.lensPass.uniforms.uDirtMap.value = this.dirtTexture;
    this.outputPass = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bokehPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.lensPass);
    this.composer.addPass(this.outputPass);

    this.setOptions({});
    this.setSize(this.width, this.height);
  }

  apertureValue() {
    return 0.00022 / THREE.MathUtils.clamp(this.apertureFStop, 1.4, 16);
  }

  qualityPixelRatio() {
    const values = { performance: 0.85, balanced: 1.10, high: 1.25, cinematic: 1.5 };
    return Math.min(window.devicePixelRatio || 1, values[this.quality] || values.balanced, 1.75);
  }

  makeDirtTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 512, 512);

    let seed = 0x7135ac;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < 260; i++) {
      const x = random() * 512;
      const y = random() * 512;
      const radius = 0.55 + random() * 2.6;
      const alpha = 0.12 + random() * 0.48;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 22; i++) {
      const x = random() * 512;
      const y = random() * 512;
      const rx = 7 + random() * 34;
      const ry = 4 + random() * 19;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      gradient.addColorStop(0, `rgba(255,255,255,${0.07 + random() * 0.13})`);
      gradient.addColorStop(0.58, 'rgba(255,255,255,0.04)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  setOptions(options = {}) {
    if (typeof options.enabled === 'boolean') this.enabled = options.enabled;
    if (typeof options.flare === 'boolean') this.flareEnabled = options.flare;
    if (typeof options.bokeh === 'boolean') this.bokehEnabled = options.bokeh;
    if (Number.isFinite(Number(options.bloom))) this.bloomAmount = THREE.MathUtils.clamp(Number(options.bloom), 0, 1);
    if (Number.isFinite(Number(options.bloomThreshold))) this.bloomThreshold = THREE.MathUtils.clamp(Number(options.bloomThreshold), 0.1, 2);
    if (Number.isFinite(Number(options.flareStrength))) this.flareStrength = THREE.MathUtils.clamp(Number(options.flareStrength), 0, 1);
    if (Number.isFinite(Number(options.dirt))) this.dirtStrength = THREE.MathUtils.clamp(Number(options.dirt), 0, 1);
    if (Number.isFinite(Number(options.vignette))) this.vignetteStrength = THREE.MathUtils.clamp(Number(options.vignette), 0, 1);
    if (Number.isFinite(Number(options.chromatic))) this.chromaticStrength = THREE.MathUtils.clamp(Number(options.chromatic), 0, 1);
    if (Number.isFinite(Number(options.grain))) this.grainStrength = THREE.MathUtils.clamp(Number(options.grain), 0, 1);
    if (Number.isFinite(Number(options.sharpness))) this.sharpness = THREE.MathUtils.clamp(Number(options.sharpness), 0, 1);
    if (Number.isFinite(Number(options.temperature))) this.temperature = THREE.MathUtils.clamp(Number(options.temperature), 3200, 9000);
    if (Number.isFinite(Number(options.tint))) this.tint = THREE.MathUtils.clamp(Number(options.tint), -1, 1);
    if (Number.isFinite(Number(options.contrast))) this.contrast = THREE.MathUtils.clamp(Number(options.contrast), 0.6, 1.6);
    if (Number.isFinite(Number(options.saturation))) this.saturation = THREE.MathUtils.clamp(Number(options.saturation), 0, 1.6);
    if (Number.isFinite(Number(options.shadowLift))) this.shadowLift = THREE.MathUtils.clamp(Number(options.shadowLift), 0, 1);
    if (Number.isFinite(Number(options.highlightCompression))) this.highlightCompression = THREE.MathUtils.clamp(Number(options.highlightCompression), 0, 1);
    if (Number.isFinite(Number(options.distortion))) this.distortion = THREE.MathUtils.clamp(Number(options.distortion), 0, 1);
    if (Number.isFinite(Number(options.focusDistance))) this.focusDistance = THREE.MathUtils.clamp(Number(options.focusDistance), 5, 500);
    if (options.focusMode === 'manual' || options.focusMode === 'target') this.focusMode = options.focusMode;
    if (Number.isFinite(Number(options.aperture))) this.apertureFStop = THREE.MathUtils.clamp(Number(options.aperture), 1.4, 16);
    if (typeof options.quality === 'string' && ['performance', 'balanced', 'high', 'cinematic'].includes(options.quality)) this.quality = options.quality;

    this.bloomPass.enabled = this.enabled && this.bloomAmount > 0.001;
    this.bloomPass.strength = this.bloomAmount * 0.88;
    this.bloomPass.threshold = this.bloomThreshold;
    this.bloomPass.radius = 0.52;
    this.bokehPass.enabled = this.enabled && this.bokehEnabled;
    this.bokehPass.uniforms.focus.value = this.focusDistance;
    this.bokehPass.uniforms.aperture.value = this.apertureValue();
    this.lensPass.enabled = this.enabled;

    const u = this.lensPass.uniforms;
    u.uFlareStrength.value = this.flareEnabled ? 0.78 * this.flareStrength : 0;
    u.uDirtStrength.value = this.dirtStrength * 0.34;
    u.uVignetteStrength.value = this.vignetteStrength * 0.48;
    u.uChromaticStrength.value = this.chromaticStrength * 0.0034;
    u.uGrainStrength.value = this.grainStrength * 0.032;
    u.uSharpness.value = this.sharpness * 0.48;
    u.uTemperature.value = this.temperature;
    u.uTint.value = this.tint;
    u.uContrast.value = this.contrast;
    u.uSaturation.value = this.saturation;
    u.uShadowLift.value = this.shadowLift;
    u.uHighlightCompression.value = this.highlightCompression;
    u.uDistortion.value = this.distortion * 0.0014;

    this.syncComposerSize();
  }

  setFocusTarget(target) {
    if (!target || !this.bokehPass?.uniforms?.focus) return;
    this.camera.updateMatrixWorld();
    this.focusView.copy(target).applyMatrix4(this.camera.matrixWorldInverse);
    const focus = Math.max(this.camera.near + 0.1, -this.focusView.z);
    this.bokehPass.uniforms.focus.value = focus;
  }

  syncComposerSize() {
    if (!this.composer) return;
    const ratio = this.qualityPixelRatio();
    const ratioChanged = Math.abs(ratio - this._composerPixelRatio) > 0.0001;
    const sizeChanged = this.width !== this._composerWidth || this.height !== this._composerHeight;

    // EffectComposer.setPixelRatio() already resizes its internal targets.
    // Avoid recreating both buffers on every optics slider input.
    if (ratioChanged) this.composer.setPixelRatio(ratio);
    if (sizeChanged) this.composer.setSize(this.width, this.height);

    this._composerPixelRatio = ratio;
    this._composerWidth = this.width;
    this._composerHeight = this.height;
    if (this.lensPass) {
      this.lensPass.uniforms.uAspect.value = this.width / this.height;
      this.lensPass.uniforms.uTexelSize.value.set(
        1 / Math.max(1, this.width * ratio),
        1 / Math.max(1, this.height * ratio)
      );
    }
  }

  _markComposerFailed(reason, error) {
    if (this.composerFailed) return;
    this.composerFailed = true;
    this.composerFailureReason = reason;
    if (error) console.error('[CameraOptics] ' + reason + ' Falling back to direct rendering.', error);
    else console.error('[CameraOptics] ' + reason + ' Falling back to direct rendering.');
  }

  setSize(width, height) {
    this.width = Math.max(1, Math.round(width || 1));
    this.height = Math.max(1, Math.round(height || 1));
    this.syncComposerSize();
  }

  render(deltaTime, sunSprite, focusTarget) {
    if (!this.enabled || this.composerFailed) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.camera.updateMatrixWorld();
    if (this.flareEnabled && sunSprite?.visible) {
      sunSprite.getWorldPosition(this.sunWorld);
      this.sunClip.copy(this.sunWorld).project(this.camera);
      const onScreen =
        this.sunClip.z > -1 && this.sunClip.z < 1 &&
        Math.abs(this.sunClip.x) < 1.18 && Math.abs(this.sunClip.y) < 1.18;
      this.lensPass.uniforms.uSunUv.value.set(
        this.sunClip.x * 0.5 + 0.5,
        this.sunClip.y * 0.5 + 0.5
      );
      this.lensPass.uniforms.uSunStrength.value = onScreen
        ? THREE.MathUtils.clamp(sunSprite.material.opacity, 0, 1)
        : 0;
    } else {
      this.lensPass.uniforms.uSunStrength.value = 0;
    }

    if (this.bokehPass.enabled && this.focusMode === 'target' && focusTarget) this.setFocusTarget(focusTarget);
    else if (this.bokehPass.enabled) this.bokehPass.uniforms.focus.value = this.focusDistance;
    this._composerRendering = true;
    try {
      this.composer.render(deltaTime);
    } catch (error) {
      this._markComposerFailed('Post-processing render failed.', error);
    } finally {
      this._composerRendering = false;
    }

    // Shader-link failures are reported through renderer.debug.onShaderError.
    // Prefer a visible scene over repeatedly submitting a broken compositor.
    if (this.composerFailed) this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.composer?.dispose();
    this.dirtTexture?.dispose();
    if (this.renderer.debug && this.renderer.debug.onShaderError === this._shaderErrorHandler) {
      this.renderer.debug.onShaderError = this._previousShaderErrorHandler;
    }
  }
}
