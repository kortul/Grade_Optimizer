import * as THREE from 'three';

/**
 * Terrain-following alpine skier point-mass model.
 *
 * Forces:
 *  - gravity projected onto the local terrain tangent plane
 *  - ski/snow kinetic friction: mu * normal load
 *  - quadratic aerodynamic drag: 0.5 * rho * CdA * v_rel^2 / mass
 *  - static-friction hold at very low speeds
 *  - steering rotates the velocity around the terrain normal (no energy gain);
 *    turn rate is limited by available edge-force / normal load.
 *
 * It is a useful engineering approximation, not a validated full-body ski
 * biomechanics model. Ski flex, edge penetration, snow cutting and balance
 * control are represented by simplified effective parameters.
 */
export class SkierController {
  constructor({ camera, domElement, scene, onHud = () => {}, onPointerLock = () => {} }) {
    this.camera = camera;
    this.domElement = domElement;
    this.scene = scene || null;
    this.onHud = onHud;
    this.onPointerLock = onPointerLock;

    this.terrain = null;
    this.active = false;
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this.down = new THREE.Vector3(0, -1, 0);
    this.normalMatrix = new THREE.Matrix3();
    this.gravity = new THREE.Vector3(0, -9.81, 0);
    this.windVelocity = new THREE.Vector3(0, 0, 0);

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.bounds = new THREE.Box3();
    this.lastGroundNormal = new THREE.Vector3(0, 1, 0);

    // Reference skier / environment parameters.
    this.massKg = 80;
    this.airDensity = 1.0;        // kg/m^3; proxy for an alpine-altitude atmosphere
    this.cdaUpright = 0.53;       // m^2, effective drag area
    this.cdaTuck = 0.34;          // m^2, reduced frontal area in a tuck
    this.snowMu = 0.045;          // groomed mid-winter baseline
    this.staticMu = 0.053;
    this.brakeMu = 0.16;          // additional effective snow-machining resistance
    this.turnScrubMu = 0.008;     // small extra loss while edging / turning
    this.maxEdgeG = 0.80;         // lateral edge-force limit as a fraction of normal load
    this.maxTurnRate = 0.65;      // rad/s low-speed steering limit
    this.maxSafeSpeed = 60;       // m/s numerical guard only, not a gameplay speed cap

    this.eyeHeight = 1.80; // eye point, measured vertically from the snow surface in metres
    this.headingYaw = 0;
    this.lookYaw = 0;
    this.lookPitch = -0.035;
    this.slopeDeg = 0;
    this.lastLongitudinalAccel = 0;

    this.skiRig = this._createSkiRig();
    if (this.scene && this.skiRig) this.scene.add(this.skiRig);

    this._onKeyDown = (e) => {
      if (!this.active) return;
      const key = this._readKey(e);
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' '].includes(key)) {
        e.preventDefault();
        this.keys.add(key);
      }
    };
    this._onKeyUp = (e) => this.keys.delete(this._readKey(e));
    this._onBlur = () => this.keys.clear();
    this._onMouseMove = (e) => {
      if (!this.active || document.pointerLockElement !== this.domElement) return;
      this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - e.movementX * 0.0018, -1.5, 1.5);
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - e.movementY * 0.0015, -0.58, 0.45);
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
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLock);
    this.domElement.addEventListener('click', this._onCanvasClick);
  }


  _createSkiRig() {
    const rig = new THREE.Group();
    rig.name = 'Skier_FirstPerson_Skis';
    const outline = new THREE.Shape();
    outline.moveTo(-0.047,-0.92);
    outline.quadraticCurveTo(-0.052,-0.58,-0.050,0.60);
    outline.quadraticCurveTo(-0.048,0.96,0,1.035);
    outline.quadraticCurveTo(0.048,0.96,0.050,0.60);
    outline.quadraticCurveTo(0.052,-0.58,0.047,-0.92);
    outline.closePath();
    const boardGeometry = new THREE.ExtrudeGeometry(outline,{
      depth:0.035,bevelEnabled:true,bevelSegments:2,steps:1,
      bevelSize:0.006,bevelThickness:0.006,curveSegments:8
    });
    boardGeometry.rotateX(-Math.PI/2);
    boardGeometry.translate(0,-0.0175,0);
    boardGeometry.computeVertexNormals();
    const boardMaterial=new THREE.MeshStandardMaterial({color:0x273b50,metalness:0.28,roughness:0.42});
    const topMaterial=new THREE.MeshStandardMaterial({color:0xd8e3eb,metalness:0.18,roughness:0.5});
    const bindingMaterial=new THREE.MeshStandardMaterial({color:0x171d24,metalness:0.42,roughness:0.38});
    const metalMaterial=new THREE.MeshStandardMaterial({color:0x9aa9b5,metalness:0.72,roughness:0.28});
    for(const side of [-1,1]){
      const ski=new THREE.Group();
      ski.position.x=side*0.18;
      const board=new THREE.Mesh(boardGeometry,boardMaterial);
      board.castShadow=false;board.receiveShadow=false;ski.add(board);
      const stripe=new THREE.Mesh(new THREE.BoxGeometry(0.009,0.004,1.20),topMaterial);
      stripe.position.set(0,0.022,0.02);ski.add(stripe);
      const plate=new THREE.Mesh(new THREE.BoxGeometry(0.105,0.025,0.31),bindingMaterial);
      plate.position.set(0,0.043,0.015);ski.add(plate);
      const toe=new THREE.Mesh(new THREE.BoxGeometry(0.112,0.075,0.085),bindingMaterial);
      toe.position.set(0,0.090,-0.105);ski.add(toe);
      const heel=new THREE.Mesh(new THREE.BoxGeometry(0.108,0.066,0.075),bindingMaterial);
      heel.position.set(0,0.084,0.145);ski.add(heel);
      const rail=new THREE.Mesh(new THREE.BoxGeometry(0.116,0.012,0.018),metalMaterial);
      rail.position.set(0,0.128,-0.105);ski.add(rail);
      rig.add(ski);
    }
    rig.visible=false;
    rig.frustumCulled=false;
    return rig;
  }

  _updateSkiRig() {
    if(!this.skiRig)return;
    const normal=this.lastGroundNormal.clone().normalize();
    let forward=this.velocity.clone().projectOnPlane(normal);
    if(forward.lengthSq()<1e-4){
      forward.set(-Math.sin(this.headingYaw),0,-Math.cos(this.headingYaw)).projectOnPlane(normal);
    }
    if(forward.lengthSq()<1e-4)forward.set(0,0,-1);
    forward.normalize();
    const right=new THREE.Vector3().crossVectors(forward,normal).normalize();
    const back=forward.clone().negate();
    this.skiRig.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,normal,back));
    // Keep the ski rig at boot level on the actual snow surface, ahead of the skier.
    const skiCenter=this.position.clone().addScaledVector(forward,0.95);
    const skiGround=this._groundAt(skiCenter.x,skiCenter.z);
    if(skiGround){
      this.skiRig.position.copy(skiGround.point).addScaledVector(skiGround.normal,0.055);
    }else{
      this.skiRig.position.copy(this.position).addScaledVector(normal,0.055);
    }
  }

  _readKey(e) {
    const physical = {
      KeyW:'w', KeyA:'a', KeyS:'s', KeyD:'d',
      ArrowUp:'arrowup', ArrowDown:'arrowdown',
      ArrowLeft:'arrowleft', ArrowRight:'arrowright', Space:' '
    };
    return physical[e.code] || (e.key || '').toLowerCase();
  }

  setSnowFriction(value) {
    this.snowMu = THREE.MathUtils.clamp(Number(value) || 0.045, 0.02, 0.14);
    this.staticMu = Math.min(0.16, this.snowMu + 0.008);
    this.onHud({
      speed: this.velocity.length(),
      slope: this.slopeDeg,
      grounded: !!this.terrain,
      acceleration: this.lastLongitudinalAccel,
      snowMu: this.snowMu
    });
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
    const geometry = hit.object.geometry;
    const normalAttr = geometry?.attributes?.normal;
    const face = hit.face;

    // Interpolate the smooth vertex normals across the triangle. This avoids
    // abrupt velocity/camera changes when crossing the mesh's triangle edges.
    let gotSmoothNormal = false;
    if (normalAttr && face) {
      const positionAttr = geometry.attributes.position;
      const localPoint = hit.object.worldToLocal(hit.point.clone());
      const a = new THREE.Vector3().fromBufferAttribute(positionAttr, face.a);
      const b = new THREE.Vector3().fromBufferAttribute(positionAttr, face.b);
      const c = new THREE.Vector3().fromBufferAttribute(positionAttr, face.c);
      const v0 = new THREE.Vector3().subVectors(b, a);
      const v1 = new THREE.Vector3().subVectors(c, a);
      const v2 = new THREE.Vector3().subVectors(localPoint, a);
      const d00 = v0.dot(v0), d01 = v0.dot(v1), d11 = v1.dot(v1);
      const d20 = v2.dot(v0), d21 = v2.dot(v1);
      const denom = d00*d11 - d01*d01;
      if (Math.abs(denom) > 1e-12) {
        const wb = (d11*d20 - d01*d21) / denom;
        const wc = (d00*d21 - d01*d20) / denom;
        const wa = 1 - wb - wc;
        if ([wa,wb,wc].every(Number.isFinite)) {
          const na = new THREE.Vector3().fromBufferAttribute(normalAttr, face.a);
          const nb = new THREE.Vector3().fromBufferAttribute(normalAttr, face.b);
          const nc = new THREE.Vector3().fromBufferAttribute(normalAttr, face.c);
          normal.set(0,0,0)
            .addScaledVector(na,wa)
            .addScaledVector(nb,wb)
            .addScaledVector(nc,wc);
          gotSmoothNormal = normal.lengthSq() > 1e-10;
        }
      }
    }
    if (!gotSmoothNormal && face?.normal) normal.copy(face.normal);
    this.normalMatrix.getNormalMatrix(hit.object.matrixWorld);
    normal.applyMatrix3(this.normalMatrix).normalize();
    if (normal.y < 0) normal.negate();
    return { point: hit.point, normal };
  }

  _gravityAlongSurface(normal) {
    return this.gravity.clone().addScaledVector(normal, -this.gravity.dot(normal));
  }

  _findSpawn() {
    this.terrain.updateWorldMatrix(true, true);
    this.bounds.setFromObject(this.terrain);
    const center = this.bounds.getCenter(new THREE.Vector3());
    const geometry = this.terrain.geometry;
    const attr = geometry?.attributes?.position;
    if (!attr) return null;

    // Preferred spawn for the current A1 test piste.
    const seed = this._groundAt(
      THREE.MathUtils.lerp(this.bounds.min.x, this.bounds.max.x, 0.334),
      THREE.MathUtils.lerp(this.bounds.min.z, this.bounds.max.z, 0.187)
    );
    if (seed) {
      const slope = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(seed.normal.y,-1,1)));
      if (slope >= 4 && slope <= 50) return this._setSpawn(seed, center);
    }

    const candidates = [];
    const v = new THREE.Vector3();
    for (let i=0; i<attr.count; i++) {
      v.fromBufferAttribute(attr,i).applyMatrix4(this.terrain.matrixWorld);
      candidates.push({x:v.x,y:v.y,z:v.z});
    }
    candidates.sort((a,b)=>b.y-a.y);

    const mx=(this.bounds.max.x-this.bounds.min.x)*0.055;
    const mz=(this.bounds.max.z-this.bounds.min.z)*0.055;
    const starts=[];
    for (const p of candidates.slice(0,Math.min(300,candidates.length))) {
      for (const inset of [0.04,0.10]) {
        const x=THREE.MathUtils.lerp(p.x,center.x,inset);
        const z=THREE.MathUtils.lerp(p.z,center.z,inset);
        if(x<this.bounds.min.x+mx || x>this.bounds.max.x-mx ||
           z<this.bounds.min.z+mz || z>this.bounds.max.z-mz) continue;
        const hit=this._groundAt(x,z);
        if(!hit) continue;
        const slope=THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(hit.normal.y,-1,1)));
        if(slope<4 || slope>58 || starts.some(s=>Math.hypot(s.x-x,s.z-z)<9)) continue;
        starts.push({x,z,hit,slope});
      }
      if(starts.length>=90) break;
    }

    starts.sort((a,b)=>b.hit.point.y-a.hit.point.y);
    let best=null,bestScore=-Infinity;
    for(const candidate of starts.slice(0,55)) {
      const downhill=this._gravityAlongSurface(candidate.hit.normal);
      downhill.y=0;
      if(downhill.lengthSq()<1e-8) continue;
      downhill.normalize();
      let clearance=0;
      for(const distance of [10,20,30,40,50,60,70,80]) {
        if(!this._groundAt(candidate.x+downhill.x*distance,candidate.z+downhill.z*distance)) break;
        clearance=distance;
      }
      const score=candidate.hit.point.y+clearance*0.1+Math.min(candidate.slope,25)*0.06;
      if(score>bestScore){bestScore=score;best=candidate.hit;}
    }
    if(!best) {
      for(let ix=1;ix<10;ix++) for(let iz=1;iz<10;iz++) {
        const hit=this._groundAt(
          THREE.MathUtils.lerp(this.bounds.min.x,this.bounds.max.x,ix/10),
          THREE.MathUtils.lerp(this.bounds.min.z,this.bounds.max.z,iz/10)
        );
        if(hit && (!best || hit.point.y>best.point.y)) best=hit;
      }
    }
    return best ? this._setSpawn(best,center) : null;
  }

  _setSpawn(hit, center) {
    this.position.copy(hit.point);
    this.lastGroundNormal.copy(hit.normal);
    this.slopeDeg=THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(hit.normal.y,-1,1)));
    const downhill=this._gravityAlongSurface(hit.normal);
    if(downhill.lengthSq()<1e-8) downhill.set(center.x-hit.point.x,0,center.z-hit.point.z);
    this.headingYaw=Math.atan2(-downhill.x,-downhill.z);
    this.velocity.set(0,0,0);
    this.lookYaw=0;
    this.lookPitch=-0.035;
    this.lastLongitudinalAccel=0;
    this._syncCamera(0);
    this._updateSkiRig();
    return hit;
  }

  _syncCamera(steer=0) {
    // GLTF world coordinates are metres. Measure the eye point vertically in world space,
    // not along the terrain normal (which loses vertical height on steep pistes).
    this.camera.position.set(this.position.x,this.position.y+this.eyeHeight,this.position.z);
    this.camera.rotation.order='YXZ';
    const horizontalSpeed=Math.hypot(this.velocity.x,this.velocity.z);
    if(this.velocity.length()>0.15 && horizontalSpeed>0.03) {
      this.headingYaw=Math.atan2(-this.velocity.x,-this.velocity.z);
    }
    const travelPitch=this.velocity.length()>0.15
      ? Math.atan2(this.velocity.y,Math.max(horizontalSpeed,0.03))
      : 0;
    this.camera.rotation.set(
      THREE.MathUtils.clamp(travelPitch+this.lookPitch,-0.85,0.55),
      this.headingYaw+this.lookYaw,
      -steer*0.055
    );
  }

  start(terrain) {
    if(!terrain) return false;
    this.terrain=terrain;
    if(!this._findSpawn()){this.terrain=null;return false;}
    this.active=true;
    this.keys.clear();
    if(this.skiRig)this.skiRig.visible=true;
    this._updateSkiRig();
    this.domElement.style.cursor='crosshair';
    const result=this.domElement.requestPointerLock?.();
    if(result && typeof result.catch==='function') result.catch(()=>{});
    this.onHud({
      speed:0,slope:this.slopeDeg,grounded:true,
      acceleration:0,snowMu:this.snowMu
    });
    return true;
  }

  stop() {
    this.active=false;
    this.keys.clear();
    if(this.skiRig)this.skiRig.visible=false;
    this.domElement.style.cursor='';
    if(document.pointerLockElement===this.domElement) document.exitPointerLock?.();
    this.terrain=null;
  }

  update(dt) {
    if(!this.active || !this.terrain) return;
    dt=THREE.MathUtils.clamp(dt,0,0.04);

    // Refresh the local terrain frame before applying forces.
    const currentHit=this._groundAt(this.position.x,this.position.z);
    if(!currentHit) {
      this.velocity.set(0,0,0);
      this.onHud({speed:0,slope:this.slopeDeg,grounded:false,acceleration:0,snowMu:this.snowMu});
      return;
    }
    this.position.copy(currentHit.point);
    this.lastGroundNormal.copy(currentHit.normal);
    const normal=this.lastGroundNormal;
    this.velocity.addScaledVector(normal,-this.velocity.dot(normal));

    const left=this.keys.has('a')||this.keys.has('arrowleft');
    const right=this.keys.has('d')||this.keys.has('arrowright');
    const tuck=this.keys.has('w')||this.keys.has('arrowup');
    const brake=this.keys.has('s')||this.keys.has('arrowdown')||this.keys.has(' ');
    const steer=(right?1:0)-(left?1:0);

    const gravityTangent=this._gravityAlongSurface(normal);
    const normalLoad=Math.max(0.05,-this.gravity.dot(normal));
    const speedBefore=this.velocity.length();
    const muEffective=this.snowMu+(brake?this.brakeMu:0)+(Math.abs(steer)>0?this.turnScrubMu*Math.abs(steer):0);
    const cda=tuck?this.cdaTuck:this.cdaUpright;
    let acceleration=new THREE.Vector3(0,0,0);
    let travelDirection=new THREE.Vector3(0,0,0);

    if(speedBefore>0.06) {
      travelDirection.copy(this.velocity).divideScalar(speedBefore);
      const airRelative=this.velocity.clone().sub(this.windVelocity);
      const relativeAirSpeed=airRelative.length();
      const dragCoefficient=0.5*this.airDensity*cda/this.massKg;
      acceleration.copy(gravityTangent)
        .addScaledVector(airRelative,-dragCoefficient*relativeAirSpeed)
        .addScaledVector(travelDirection,-muEffective*normalLoad);

      const longitudinalAcceleration=acceleration.dot(travelDirection);
      this.lastLongitudinalAccel=longitudinalAcceleration;

      // Prevent numerical force integration from carrying the skier through zero
      // and magically reversing an uphill run in one frame.
      if(longitudinalAcceleration<0 && speedBefore+longitudinalAcceleration*dt<=0) {
        this.velocity.set(0,0,0);
      } else {
        this.velocity.addScaledVector(acceleration,dt);
      }
    } else {
      const gravityAlong=gravityTangent.length();
      const staticResistance=(this.staticMu+(brake?this.brakeMu:0))*normalLoad;
      if(gravityAlong<=staticResistance) {
        this.velocity.set(0,0,0);
        this.lastLongitudinalAccel=0;
      } else {
        const downhillDirection=gravityTangent.clone().normalize();
        acceleration.copy(gravityTangent)
          .addScaledVector(downhillDirection,-muEffective*normalLoad);
        this.velocity.addScaledVector(acceleration,dt);
        this.lastLongitudinalAccel=acceleration.length();
      }
    }

    // Steering is a lateral snow reaction, not an engine: it changes direction
    // but cannot create speed. The achievable turn rate is limited by edge grip.
    this.velocity.projectOnPlane(normal);
    const speedBeforeTurn=this.velocity.length();
    if(steer!==0 && speedBeforeTurn>0.20) {
      const maxLateralAcceleration=this.maxEdgeG*normalLoad;
      const turnRate=Math.min(this.maxTurnRate,maxLateralAcceleration/speedBeforeTurn)*steer;
      const speedToPreserve=speedBeforeTurn;
      this.velocity.applyAxisAngle(normal,-turnRate*dt);
      const afterTurnSpeed=this.velocity.length();
      if(afterTurnSpeed>1e-9) this.velocity.multiplyScalar(speedToPreserve/afterTurnSpeed);
    }

    const currentSpeed=this.velocity.length();
    if(currentSpeed>this.maxSafeSpeed) this.velocity.multiplyScalar(this.maxSafeSpeed/currentSpeed);

    // Move in 3D, then constrain the contact point to the actual terrain surface.
    const nextX=this.position.x+this.velocity.x*dt;
    const nextZ=this.position.z+this.velocity.z*dt;
    const nextHit=this._groundAt(nextX,nextZ);
    let grounded=!!nextHit;
    if(nextHit) {
      this.position.copy(nextHit.point);
      this.lastGroundNormal.copy(nextHit.normal);
      this.velocity.addScaledVector(this.lastGroundNormal,-this.velocity.dot(this.lastGroundNormal));
      this.slopeDeg=THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(this.lastGroundNormal.y,-1,1)));
    } else {
      // Edge of the supplied mesh: stop cleanly rather than extrapolating terrain.
      this.velocity.multiplyScalar(0.015);
      grounded=false;
    }

    this._syncCamera(steer);
    this._updateSkiRig();
    this.onHud({
      speed:this.velocity.length(),
      slope:this.slopeDeg,
      grounded,
      acceleration:this.lastLongitudinalAccel,
      snowMu:this.snowMu
    });
  }

  dispose() {
    this.stop();
    window.removeEventListener('keydown',this._onKeyDown);
    window.removeEventListener('keyup',this._onKeyUp);
    window.removeEventListener('blur',this._onBlur);
    document.removeEventListener('mousemove',this._onMouseMove);
    document.removeEventListener('pointerlockchange',this._onPointerLock);
    this.domElement.removeEventListener('click',this._onCanvasClick);
    if(this.scene&&this.skiRig)this.scene.remove(this.skiRig);
    const geometries=new Set(),materials=new Set();
    this.skiRig?.traverse(object=>{
      if(object.geometry)geometries.add(object.geometry);
      if(object.material)(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>materials.add(m));
    });
    geometries.forEach(g=>g.dispose());
    materials.forEach(m=>m.dispose());
  }
}
