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
    uFlareStrength: { value: 0.12 },
    uDirtStrength: { value: 0.045 },
    uVignetteStrength: { value: 0.10 },
    uChromaticStrength: { value: 0.00045 },
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
    uniform float uAspect;
    varying vec2 vUv;

    float softGhost(vec2 uv, vec2 center, vec2 radius) {
      vec2 d = (uv - center) / radius;
      return exp(-dot(d, d) * 1.7);
    }

    void main() {
      vec2 uv = vUv;
      vec2 radial = (uv - 0.5) * vec2(uAspect, 1.0);
      vec2 aberration = radial * uChromaticStrength;

      vec3 color;
      color.r = texture2D(tDiffuse, uv + aberration).r;
      color.g = texture2D(tDiffuse, uv).g;
      color.b = texture2D(tDiffuse, uv - aberration).b;

      float edge = smoothstep(0.26, 1.05, length(radial));
      color *= 1.0 - edge * uVignetteStrength;

      if (uSunStrength > 0.001) {
        vec2 axis = vec2(0.5) - uSunUv;
        vec2 ghostA = uSunUv + axis * 0.56;
        vec2 ghostB = uSunUv + axis * 1.08;
        vec2 ghostC = uSunUv - axis * 0.28;

        float ghosts =
          softGhost(uv, ghostA, vec2(0.052, 0.085)) * 0.52 +
          softGhost(uv, ghostB, vec2(0.026, 0.043)) * 0.30 +
          softGhost(uv, ghostC, vec2(0.075, 0.035)) * 0.22;

        vec2 sunDelta = uv - uSunUv;
        float horizontalStreak =
          exp(-abs(sunDelta.y) * 430.0) *
          exp(-abs(sunDelta.x) * 7.0) * 0.11;

        color += vec3(0.72, 0.82, 1.0) * ghosts * uSunStrength * uFlareStrength;
        color += vec3(1.0, 0.91, 0.76) * horizontalStreak * uSunStrength * uFlareStrength;
      }

      float luminance = dot(max(color, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
      float highlightMask = smoothstep(0.42, 1.08, luminance);
      float dirt = texture2D(uDirtMap, uv).r;
      color += vec3(1.0, 0.97, 0.91) * dirt * highlightMask * uDirtStrength;

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
    this.bloomAmount = 0.34;
    this.intensity = 0.58;
    this.sunWorld = new THREE.Vector3();
    this.sunClip = new THREE.Vector3();
    this.focusView = new THREE.Vector3();

    this.dirtTexture = this.makeDirtTexture();
    this.composer = new EffectComposer(renderer);
    // The post stack renders at a restrained internal resolution to protect FPS.
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    this.composer.setSize(this.width, this.height);

    this.renderPass = new RenderPass(scene, camera);
    this.bokehPass = new BokehPass(scene, camera, {
      focus: 70,
      aperture: 0.000055,
      maxblur: 0.006,
      width: this.width,
      height: this.height
    });
    this.bokehPass.enabled = false;

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      0.17,
      0.32,
      0.88
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

    // Fine dust and a few soft smudges, visible only over strong highlights.
    for (let i = 0; i < 210; i++) {
      const x = random() * 512;
      const y = random() * 512;
      const radius = 0.45 + random() * 2.1;
      const alpha = 0.10 + random() * 0.34;
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 13; i++) {
      const x = random() * 512;
      const y = random() * 512;
      const rx = 9 + random() * 24;
      const ry = 5 + random() * 15;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
      gradient.addColorStop(0, 'rgba(255,255,255,0.075)');
      gradient.addColorStop(0.62, 'rgba(255,255,255,0.026)');
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
    if (Number.isFinite(Number(options.intensity))) this.intensity = THREE.MathUtils.clamp(Number(options.intensity), 0, 1);

    this.bloomPass.enabled = this.enabled && this.bloomAmount > 0.01;
    this.bloomPass.strength = this.bloomAmount * 0.52;
    this.bokehPass.enabled = this.enabled && this.bokehEnabled;
    this.lensPass.enabled = this.enabled;

    const u = this.lensPass.uniforms;
    u.uFlareStrength.value = this.flareEnabled ? 0.19 * this.intensity : 0;
    u.uDirtStrength.value = this.flareEnabled ? 0.075 * this.intensity : 0;
    u.uVignetteStrength.value = 0.16 * this.intensity;
    u.uChromaticStrength.value = 0.00072 * this.intensity;
  }

  setFocusTarget(target) {
    if (!target || !this.bokehPass?.uniforms?.focus) return;
    this.camera.updateMatrixWorld();
    this.focusView.copy(target).applyMatrix4(this.camera.matrixWorldInverse);
    const focus = Math.max(this.camera.near + 0.1, -this.focusView.z);
    this.bokehPass.uniforms.focus.value = focus;
  }

  setSize(width, height) {
    this.width = Math.max(1, Math.round(width || 1));
    this.height = Math.max(1, Math.round(height || 1));
    this.composer?.setSize(this.width, this.height);
    if (this.lensPass) {
      this.lensPass.uniforms.uAspect.value = this.width / this.height;
    }
  }

  render(deltaTime, sunSprite, focusTarget) {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.camera.updateMatrixWorld();
    if (sunSprite?.visible) {
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

    if (focusTarget) this.setFocusTarget(focusTarget);
    this.composer.render(deltaTime);
  }

  dispose() {
    this.composer?.dispose();
    this.dirtTexture?.dispose();
  }
}
