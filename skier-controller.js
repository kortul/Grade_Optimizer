import * as THREE from 'three';

/**
 * Lightweight terrain-following ski controller.
 * Uses the existing terrain mesh as a ground surface and boundary collider.
 * This is a first playable prototype, not a rigid-body ski simulator.
 */
export class SkierController {
  constructor({ camera, domElement, onHud = () => {}, onPointerLock = () => {} }) {
    this.camera = camera;
    this.domElement = domElement;
    this.onHud = onHud;
    this.onPointerLock = onPointerLock;
    this.terrain = null;
    this.active = false;
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this.down = new THREE.Vector3(0, -1, 0);
    this.normalMatrix = new THREE.Matrix3();
    this.gravity = new THREE.Vector3(0, -9.81, 0);
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.bounds = new THREE.Box3();
    this.headingYaw = 0;
    this.lookYaw = 0;
    this.pitch = -0.04;
    this.eyeHeight = 1.65;
    this.speedLimit = 31;
    this.groundY = 0;
    this.slopeDeg = 0;
    this.lastGroundNormal = new THREE.Vector3(0, 1, 0);

    const physicalKeys = {
      KeyW:'w', KeyA:'a', KeyS:'s', KeyD:'d',
      ArrowUp:'arrowup', ArrowDown:'arrowdown',
      ArrowLeft:'arrowleft', ArrowRight:'arrowright', Space:' '
    };
    const readKey = (e) => physicalKeys[e.code] || (e.key||'').toLowerCase();
    this._onKeyDown = (e) => {
      if (!this.active) return;
      const key = readKey(e);
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' '].includes(key)) e.preventDefault();
      this.keys.add(key);
    };
    this._onKeyUp = (e) => this.keys.delete(readKey(e));
    this._onMouseMove = (e) => {
      if (!this.active || document.pointerLockElement !== this.domElement) return;
      this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - e.movementX * 0.0018, -1.35, 1.35);
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0015, -0.62, 0.48);
    };
    this._onPointerLock = () => this.onPointerLock(document.pointerLockElement === this.domElement);
    this._onCanvasClick = () => {
      if (this.active && document.pointerLockElement !== this.domElement) {
        const result = this.domElement.requestPointerLock?.();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      }
    };
    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLock);
    this.domElement.addEventListener('click', this._onCanvasClick);
  }

  _groundAt(x, z) {
    if (!this.terrain) return null;
    this.raycaster.set(
      new THREE.Vector3(x, this.bounds.max.y + 250, z),
      this.down
    );
    this.raycaster.near = 0;
    this.raycaster.far = Math.max(500, this.bounds.max.y - this.bounds.min.y + 600);
    const hits = this.raycaster.intersectObject(this.terrain, true);
    if (!hits.length) return null;
    const hit = hits[0];
    const normal = new THREE.Vector3(0, 1, 0);
    if (hit.face?.normal) {
      this.normalMatrix.getNormalMatrix(hit.object.matrixWorld);
      normal.copy(hit.face.normal).applyMatrix3(this.normalMatrix).normalize();
      if (normal.y < 0) normal.negate();
    }
    return { point: hit.point, normal };
  }

  _downhill(normal) {
    const n = normal.clone().normalize();
    const tangentGravity = this.gravity.clone().addScaledVector(n, -this.gravity.dot(n));
    tangentGravity.y = 0;
    return tangentGravity;
  }

  _syncCamera(steer = 0) {
    this.camera.position.set(this.position.x, this.groundY + this.eyeHeight, this.position.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.headingYaw + this.lookYaw, -steer * 0.035);
  }

  _findSpawn() {
    this.terrain.updateWorldMatrix(true, true);
    this.bounds.setFromObject(this.terrain);
    const center = this.bounds.getCenter(new THREE.Vector3());
    const geometry = this.terrain.geometry;
    const attr = geometry?.attributes?.position;
    if (!attr) return null;

    // Seed tuned for the currently included A1 test piste; use generic search if it fails.
    const seed = this._groundAt(
      THREE.MathUtils.lerp(this.bounds.min.x, this.bounds.max.x, 0.334),
      THREE.MathUtils.lerp(this.bounds.min.z, this.bounds.max.z, 0.187)
    );
    if (seed) {
      const slope = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(seed.normal.y, -1, 1)));
      if (slope >= 4 && slope <= 50) return this._setSpawn(seed, center);
    }

    const candidates = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(this.terrain.matrixWorld);
      candidates.push({ x: v.x, y: v.y, z: v.z });
    }
    candidates.sort((a, b) => b.y - a.y);

    const mx = (this.bounds.max.x - this.bounds.min.x) * 0.055;
    const mz = (this.bounds.max.z - this.bounds.min.z) * 0.055;
    let best = null, bestScore = -Infinity;
    const starts = [];
    for (const c of candidates.slice(0, Math.min(300, candidates.length))) {
      for (const inset of [0.04, 0.10]) {
        const x = THREE.MathUtils.lerp(c.x, center.x, inset);
        const z = THREE.MathUtils.lerp(c.z, center.z, inset);
        if (x < this.bounds.min.x + mx || x > this.bounds.max.x - mx ||
            z < this.bounds.min.z + mz || z > this.bounds.max.z - mz) continue;
        const hit = this._groundAt(x, z);
        if (!hit) continue;
        const slope = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(hit.normal.y, -1, 1)));
        if (slope < 4 || slope > 58 || starts.some(s => Math.hypot(s.x-x, s.z-z) < 9)) continue;
        starts.push({ x, z, hit, slope });
      }
      if (starts.length >= 90) break;
    }
    starts.sort((a, b) => b.hit.point.y - a.hit.point.y);
    for (const c of starts.slice(0, 55)) {
      const d = this._downhill(c.hit.normal).normalize();
      let clearance = 0;
      for (const distance of [10,20,30,40,50,60,70,80]) {
        if (!this._groundAt(c.x + d.x*distance, c.z + d.z*distance)) break;
        clearance = distance;
      }
      const score = c.hit.point.y + clearance*0.1 + Math.min(c.slope,25)*0.06;
      if (score > bestScore) { bestScore = score; best = c.hit; }
    }
    if (!best) {
      for (let ix=1; ix<10; ix++) for (let iz=1; iz<10; iz++) {
        const hit = this._groundAt(
          THREE.MathUtils.lerp(this.bounds.min.x,this.bounds.max.x,ix/10),
          THREE.MathUtils.lerp(this.bounds.min.z,this.bounds.max.z,iz/10)
        );
        if (hit && (!best || hit.point.y > best.point.y)) best = hit;
      }
    }
    return best ? this._setSpawn(best, center) : null;
  }

  _setSpawn(hit, center) {
    this.position.copy(hit.point);
    this.groundY = hit.point.y;
    this.lastGroundNormal.copy(hit.normal);
    this.slopeDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(hit.normal.y,-1,1)));
    const downhill = this._downhill(hit.normal);
    if (downhill.lengthSq() < 1e-5) downhill.set(center.x-hit.point.x,0,center.z-hit.point.z);
    downhill.normalize();
    this.headingYaw = Math.atan2(-downhill.x,-downhill.z);
    this.lookYaw = 0;
    this.pitch = -0.04;
    this.velocity.set(0,0,0);
    this._syncCamera(0);
    return hit;
  }

  start(terrain) {
    if (!terrain) return false;
    this.terrain = terrain;
    if (!this._findSpawn()) { this.terrain = null; return false; }
    this.active = true;
    this.keys.clear();
    this.domElement.style.cursor = 'crosshair';
    const result = this.domElement.requestPointerLock?.();
    if (result && typeof result.catch === 'function') result.catch(() => {});
    this.onHud({ speed: 0, slope: this.slopeDeg, grounded: true });
    return true;
  }

  stop() {
    this.active = false;
    this.keys.clear();
    this.domElement.style.cursor = '';
    if (document.pointerLockElement === this.domElement) document.exitPointerLock?.();
    this.terrain = null;
  }

  update(dt) {
    if (!this.active || !this.terrain) return;
    dt = THREE.MathUtils.clamp(dt, 0, 0.04);
    const left = this.keys.has('a') || this.keys.has('arrowleft');
    const right = this.keys.has('d') || this.keys.has('arrowright');
    const tuck = this.keys.has('w') || this.keys.has('arrowup');
    const brake = this.keys.has('s') || this.keys.has('arrowdown') || this.keys.has(' ');
    const steer = (right ? 1 : 0) - (left ? 1 : 0);

    const downhill = this._downhill(this.lastGroundNormal);
    this.velocity.addScaledVector(downhill,dt);
    const speedBeforeTurn = Math.hypot(this.velocity.x,this.velocity.z);
    if(steer !== 0 && speedBeforeTurn > 0.35) {
      // Rotate the velocity vector itself; changing the camera heading alone does not carve.
      const turnRate = 0.62 + Math.min(speedBeforeTurn/28,0.82);
      this.velocity.applyAxisAngle(new THREE.Vector3(0,1,0),-steer*turnRate*dt);
    }
    const speedAfterTurn = Math.hypot(this.velocity.x,this.velocity.z);
    if(speedAfterTurn > 0.25) {
      this.headingYaw = Math.atan2(-this.velocity.x,-this.velocity.z);
    }
    this.velocity.multiplyScalar(Math.exp(-(tuck?0.075:0.36)*dt + (steer?0.08:0)));
    if (brake) this.velocity.multiplyScalar(Math.exp(-3.8*dt));
    const currentSpeed = Math.hypot(this.velocity.x,this.velocity.z);
    if (currentSpeed > this.speedLimit) this.velocity.multiplyScalar(this.speedLimit/currentSpeed);

    const oldX=this.position.x, oldZ=this.position.z;
    this.position.x += this.velocity.x*dt;
    this.position.z += this.velocity.z*dt;
    const hit = this._groundAt(this.position.x,this.position.z);
    const grounded = !!hit;
    if (hit) {
      this.groundY=hit.point.y;
      this.lastGroundNormal.copy(hit.normal);
      this.slopeDeg=THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(hit.normal.y,-1,1)));
    } else {
      this.position.x=oldX; this.position.z=oldZ;
      this.velocity.multiplyScalar(0.12);
    }
    this._syncCamera(steer);
    this.onHud({ speed: Math.hypot(this.velocity.x,this.velocity.z), slope: this.slopeDeg, grounded });
  }

  dispose() {
    this.stop();
    window.removeEventListener('keydown',this._onKeyDown);
    window.removeEventListener('keyup',this._onKeyUp);
    document.removeEventListener('mousemove',this._onMouseMove);
    document.removeEventListener('pointerlockchange',this._onPointerLock);
    this.domElement.removeEventListener('click',this._onCanvasClick);
  }
}
