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
    this.inputEnabled = true;
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
    this.maxEdgeG = 0.92;
    this.maxTurnRate = 0.88;
    this.maxSafeSpeed = 60;
    this.pushImpulse = 1.35;
    this.pushInterval = 0.34;
    this.pushCooldown = 0;
    this.skiSteerAngle = 0;
    this.skiSlots = [];
    this.customSkiSource = null;
    this.airborneHeight = 0;
    this.airborneVelocityY = 0;
    this.jumpCooldown = 0;

    this.eyeHeight = 1.80; // eye point, measured vertically from the snow surface in metres
    this.headingYaw = 0;
    this.lookYaw = 0;
    this.lookPitch = -0.035;
    this.slopeDeg = 0;
    this.lastLongitudinalAccel = 0;

    this.viewMode = 'first-person';
    this.viewBlend = 0;
    this.viewBlendTarget = 0;
    this.thirdPersonCameraInitialized = false;
    this.thirdPersonCameraPosition = new THREE.Vector3();
    this.thirdPersonCameraQuaternion = new THREE.Quaternion();
    this.thirdPersonDesiredPosition = new THREE.Vector3();
    this.thirdPersonDesiredQuaternion = new THREE.Quaternion();
    this.thirdPersonLookTarget = new THREE.Vector3();
    this.firstPersonPosition = new THREE.Vector3();
    this.firstPersonQuaternion = new THREE.Quaternion();
    this.cameraEuler = new THREE.Euler(0,0,0,'YXZ');

    this.skiRig = this._createSkiRig();
    this.skierAvatar = this._createSkierAvatar();
    if (this.scene && this.skiRig) this.scene.add(this.skiRig);
    if (this.scene && this.skierAvatar) this.scene.add(this.skierAvatar);

    this._onKeyDown = (e) => {
      if (!this.active || !this.inputEnabled) return;
      if (e.code === 'KeyC') {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) this.toggleCameraView();
        return;
      }
      const key = this._readKey(e);
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' ','shift'].includes(key)) {
        e.preventDefault();
        this.keys.add(key);
      }
    };
    this._onKeyUp = (e) => this.keys.delete(this._readKey(e));
    this._onBlur = () => this.keys.clear();
    this._onMouseMove = (e) => {
      if (!this.active || !this.inputEnabled || document.pointerLockElement !== this.domElement) return;
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


  _makeAvatarCapsule(parent, start, end, radius, material, radialSegments=9) {
    const direction = new THREE.Vector3().subVectors(end,start);
    const totalLength = direction.length();
    const geometry = new THREE.CapsuleGeometry(
      radius,
      Math.max(0.025,totalLength-radius*2),
      4,
      radialSegments
    );
    const mesh = new THREE.Mesh(geometry,material);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  _createSkierAvatar() {
    const avatar = new THREE.Group();
    avatar.name = 'Third_Person_Skier_Avatar';
    avatar.visible = false;
    avatar.frustumCulled = false;
    this.avatarFadeMaterials = [];

    const material = (color,roughness=0.72,metalness=0.02) => {
      const result = new THREE.MeshStandardMaterial({
        color,roughness,metalness,transparent:true,opacity:0,depthWrite:false
      });
      this.avatarFadeMaterials.push(result);
      return result;
    };
    const jacket = material(0x176b86,0.82);
    const jacketTrim = material(0xd6e9ef,0.56);
    const pants = material(0x1c2938,0.88);
    const boots = material(0x111c27,0.52,0.12);
    const helmet = material(0xf0f4f5,0.36,0.05);
    const visor = material(0x193342,0.24,0.2);
    const gloves = material(0x202b34,0.72);
    const poleMetal = material(0xb8c4cc,0.32,0.68);
    const poleBasket = material(0xf0a84b,0.56);

    const sphere = (parent,radius,position,mat,scale=new THREE.Vector3(1,1,1),segments=14) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius,segments,Math.max(8,Math.floor(segments*0.72))),mat);
      mesh.position.copy(position);
      mesh.scale.copy(scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const box = (parent,size,position,mat) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x,size.y,size.z),mat);
      mesh.position.copy(position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Lower body: slightly bent ski stance with boots centered on the bindings.
    sphere(avatar,0.205,new THREE.Vector3(0,0.82,0.025),pants,new THREE.Vector3(1.1,0.82,0.82),12);
    for (const side of [-1,1]) {
      this._makeAvatarCapsule(
        avatar,
        new THREE.Vector3(side*0.13,0.79,0.015),
        new THREE.Vector3(side*0.17,0.48,-0.015),
        0.105,pants
      );
      this._makeAvatarCapsule(
        avatar,
        new THREE.Vector3(side*0.17,0.48,-0.015),
        new THREE.Vector3(side*0.18,0.16,0.035),
        0.082,pants
      );
      box(avatar,new THREE.Vector3(0.17,0.13,0.31),new THREE.Vector3(side*0.18,0.12,-0.035),boots);
    }

    this.avatarTorso = new THREE.Group();
    this.avatarTorso.position.y = 0.88;
    avatar.add(this.avatarTorso);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.225,0.49,6,12),jacket);
    torso.position.set(0,0.30,0);
    torso.castShadow = true;
    torso.receiveShadow = true;
    this.avatarTorso.add(torso);
    sphere(this.avatarTorso,0.105,new THREE.Vector3(0,0.68,0.005),jacket,new THREE.Vector3(0.9,0.9,0.88),12);
    sphere(this.avatarTorso,0.145,new THREE.Vector3(0,0.81,-0.012),helmet,new THREE.Vector3(1,1.04,1.02),16);
    box(this.avatarTorso,new THREE.Vector3(0.245,0.062,0.042),new THREE.Vector3(0,0.80,-0.139),visor);
    box(this.avatarTorso,new THREE.Vector3(0.30,0.045,0.22),new THREE.Vector3(0,0.53,0.003),jacketTrim);
    box(this.avatarTorso,new THREE.Vector3(0.105,0.22,0.018),new THREE.Vector3(0,0.25,-0.222),jacketTrim);

    for (const side of [-1,1]) {
      const shoulder = new THREE.Vector3(side*0.225,0.45,0);
      const elbow = new THREE.Vector3(side*0.34,0.19,0.035);
      const hand = new THREE.Vector3(side*0.43,0.015,0.12);
      this._makeAvatarCapsule(this.avatarTorso,shoulder,elbow,0.082,jacket,8);
      this._makeAvatarCapsule(this.avatarTorso,elbow,hand,0.066,jacketTrim,8);
      sphere(this.avatarTorso,0.073,hand,gloves,new THREE.Vector3(1,0.88,1),10);

      // A slim pole on each side, carried behind the skier.
      const poleTip = new THREE.Vector3(side*0.57,-0.76,0.62);
      this._makeAvatarCapsule(this.avatarTorso,hand,poleTip,0.014,poleMetal,7);
      sphere(this.avatarTorso,0.055,new THREE.Vector3(side*0.54,-0.66,0.56),poleBasket,new THREE.Vector3(1,0.22,1),10);
      box(this.avatarTorso,new THREE.Vector3(0.055,0.06,0.055),new THREE.Vector3(side*0.43,0.08,0.12),gloves);
    }

    const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.31,0.40,0.14),pants);
    backpack.position.set(0,1.18,0.20);
    backpack.castShadow=true;
    backpack.receiveShadow=true;
    avatar.add(backpack);

    avatar.traverse(object=>{
      if(object.isMesh){
        object.frustumCulled=false;
        object.castShadow=true;
        object.receiveShadow=true;
      }
    });
    return avatar;
  }

  toggleCameraView() {
    this.viewBlendTarget = this.viewBlendTarget < 0.5 ? 1 : 0;
    this.viewMode = this.viewBlendTarget > 0.5 ? 'third-person' : 'first-person';
    this.thirdPersonCameraInitialized = false;
    this.onHud({
      speed:this.velocity.length(),
      slope:this.slopeDeg,
      grounded:!!this.terrain,
      acceleration:this.lastLongitudinalAccel,
      snowMu:this.snowMu,
      cameraView:this.viewBlendTarget > 0.5 ? 'third' : 'first'
    });
  }

  _updateSkierAvatar() {
    if(!this.skierAvatar||!this.skiRig)return;
    const blend = THREE.MathUtils.clamp((this.viewBlend-0.035)/0.65,0,1);
    this.skierAvatar.visible = this.viewBlend>0.015 || this.viewBlendTarget>0.015;
    for(const mat of this.avatarFadeMaterials||[]) mat.opacity=blend;
    this.skierAvatar.position.copy(this.skiRig.position);
    this.skierAvatar.quaternion.copy(this.skiRig.quaternion);
    if(this.avatarTorso){
      const tuck=this.keys.has('w')||this.keys.has('arrowup');
      const speed=THREE.MathUtils.clamp(this.velocity.length()/38,0,1);
      this.avatarTorso.rotation.x=-0.10-speed*0.16-(tuck?0.13:0);
      this.avatarTorso.rotation.z=-this.skiSteerAngle*0.34;
      this.avatarTorso.rotation.y=Math.sin(this.pushCooldown*8)*0.025;
    }
    if(this.viewBlend<=0.015&&this.viewBlendTarget<=0.015){
      this.skierAvatar.visible=false;
      for(const mat of this.avatarFadeMaterials||[])mat.opacity=0;
    }
  }

  _createSkiRig() {
    const rig = new THREE.Group();
    rig.name = 'Skier_FirstPerson_Skis';
    const outline = new THREE.Shape();
    outline.moveTo(-0.047,-0.92);
    outline.quadraticCurveTo(-0.052,-0.58,-0.050,0.60);
    outline.quadraticCurveTo(-0.048,1.20,0,1.31);
    outline.quadraticCurveTo(0.048,1.20,0.050,0.60);
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
      const stripe=new THREE.Mesh(new THREE.BoxGeometry(0.009,0.004,1.48),topMaterial);
      stripe.position.set(0,0.022,0.02);ski.add(stripe);
      const customMount=new THREE.Group();
      customMount.name='Custom_Ski_Model_Mount';
      ski.add(customMount);
      this.skiSlots.push({group:ski,board,stripe,customMount});
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

  setSkiModel(source) {
    // Remove mounted clones before releasing the previous GLB's shared resources.
    for(const slot of this.skiSlots){
      while(slot.customMount.children.length){
        slot.customMount.remove(slot.customMount.children[0]);
      }
    }
    if(this.customSkiSource){
      const geometries=new Set(),materials=new Set(),textures=new Set();
      this.customSkiSource.traverse(object=>{
        if(object.geometry)geometries.add(object.geometry);
        const list=Array.isArray(object.material)?object.material:(object.material?[object.material]:[]);
        list.forEach(material=>{
          materials.add(material);
          for(const value of Object.values(material)){
            if(value&&value.isTexture)textures.add(value);
          }
        });
      });
      geometries.forEach(item=>item.dispose());
      materials.forEach(item=>item.dispose());
      textures.forEach(item=>item.dispose());
    }
    this.customSkiSource=source||null;

    for(const slot of this.skiSlots){
      slot.board.visible=!source;
      slot.stripe.visible=!source;
      if(!source)continue;

      const model=source.clone(true);
      model.updateMatrixWorld(true);
      const sizeBox=new THREE.Box3().setFromObject(model);
      if(sizeBox.isEmpty())throw new Error('В GLB не найдена геометрия лыжи.');
      const size=sizeBox.getSize(new THREE.Vector3());
      const longestAxis=size.x>=size.y&&size.x>=size.z?'x':(size.y>=size.z?'y':'z');

      // The longest model axis becomes the ski length (local -Z).
      const fitted=new THREE.Group();
      fitted.name='Fitted_Custom_Ski';
      fitted.add(model);
      if(longestAxis==='x')fitted.rotation.y=Math.PI/2;
      else if(longestAxis==='y')fitted.rotation.x=-Math.PI/2;
      fitted.updateMatrixWorld(true);

      const rotatedBox=new THREE.Box3().setFromObject(fitted);
      const rotatedSize=rotatedBox.getSize(new THREE.Vector3());
      const length=rotatedSize.z;
      if(!Number.isFinite(length)||length<0.05)throw new Error('Не удалось определить длину лыжи в GLB.');
      fitted.scale.setScalar(2.22/length);
      fitted.updateMatrixWorld(true);
      const finalBox=new THREE.Box3().setFromObject(fitted);
      const center=finalBox.getCenter(new THREE.Vector3());
      fitted.position.set(-center.x,-0.02-finalBox.min.y,-center.z);
      fitted.updateMatrixWorld(true);

      fitted.traverse(object=>{
        if(object.isMesh){
          object.castShadow=false;
          object.receiveShadow=false;
          object.frustumCulled=false;
        }
      });
      slot.customMount.add(fitted);
    }
    return !!source;
  }

  _updateSkiRig() {
    if(!this.skiRig)return;
    const normal=this.lastGroundNormal.clone().normalize();
    let forward=this.velocity.clone().projectOnPlane(normal);
    if(forward.lengthSq()<1e-4){
      const idleYaw=this.headingYaw+this.lookYaw;
      forward.set(-Math.sin(idleYaw),0,-Math.cos(idleYaw)).projectOnPlane(normal);
    }
    if(forward.lengthSq()<1e-4)forward.set(0,0,-1);
    forward.normalize();
    if(Math.abs(this.skiSteerAngle)>1e-4)forward.applyAxisAngle(normal,-this.skiSteerAngle).normalize();
    const right=new THREE.Vector3().crossVectors(forward,normal).normalize();
    const back=forward.clone().negate();
    this.skiRig.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,normal,back));
    // Keep the ski rig at boot level on the actual snow surface, ahead of the skier.
    const skiCenter=this.position.clone().addScaledVector(forward,0.95);
    const skiGround=this._groundAt(skiCenter.x,skiCenter.z);
    if(skiGround){
      this.skiRig.position.copy(skiGround.point).addScaledVector(skiGround.normal,0.055);
      this.skiRig.position.y+=this.airborneHeight;
    }else{
      this.skiRig.position.copy(this.position).addScaledVector(normal,0.055);
      this.skiRig.position.y+=this.airborneHeight;
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
      snowMu: this.snowMu,
      tuck: this.keys.has('w') || this.keys.has('arrowup')
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
    this.airborneHeight=0;
    this.airborneVelocityY=0;
    this.jumpCooldown=0;
    this._syncCamera(0);
    this._updateSkiRig();
    return hit;
  }

  _syncCamera(steer=0,dt=1/60) {
    // Keep the first-person eye point vertical in world space.
    const horizontalSpeed=Math.hypot(this.velocity.x,this.velocity.z);
    if(this.velocity.length()>0.15 && horizontalSpeed>0.03) {
      this.headingYaw=Math.atan2(-this.velocity.x,-this.velocity.z);
    }
    const travelPitch=this.velocity.length()>0.15
      ? Math.atan2(this.velocity.y,Math.max(horizontalSpeed,0.03))
      : 0;
    this.cameraEuler.set(
      THREE.MathUtils.clamp(travelPitch+this.lookPitch,-0.85,0.55),
      this.headingYaw+this.lookYaw,
      -steer*0.055,
      'YXZ'
    );
    this.firstPersonPosition.set(
      this.position.x,
      this.position.y+this.eyeHeight+this.airborneHeight,
      this.position.z
    );
    this.firstPersonQuaternion.setFromEuler(this.cameraEuler);

    // Orbit behind the skier, looking at the upper body. Mouse movement rotates
    // the orbit while the skier's physical heading continues to follow velocity.
    const viewYaw=this.headingYaw+this.lookYaw;
    const elevation=THREE.MathUtils.clamp(0.28-this.lookPitch,0.08,0.78);
    const distance=6.45;
    const horizontal=distance*Math.cos(elevation);
    this.thirdPersonLookTarget.set(
      this.position.x,
      this.position.y+this.airborneHeight+1.18,
      this.position.z
    );
    this.thirdPersonDesiredPosition.set(
      this.thirdPersonLookTarget.x+Math.sin(viewYaw)*horizontal,
      this.thirdPersonLookTarget.y+distance*Math.sin(elevation),
      this.thirdPersonLookTarget.z+Math.cos(viewYaw)*horizontal
    );
    const cameraGround=this._groundAt(this.thirdPersonDesiredPosition.x,this.thirdPersonDesiredPosition.z);
    if(cameraGround){
      this.thirdPersonDesiredPosition.y=Math.max(
        this.thirdPersonDesiredPosition.y,
        cameraGround.point.y+1.35
      );
    }

    let needsThirdPerson=this.viewBlendTarget>0.001||this.viewBlend>0.001;
    if(needsThirdPerson){
      if(!this.thirdPersonCameraInitialized){
        this.thirdPersonCameraPosition.copy(this.camera.position);
        this.thirdPersonCameraQuaternion.copy(this.camera.quaternion);
        this.thirdPersonCameraInitialized=true;
      }
      const follow=1-Math.exp(-dt*8.5);
      this.thirdPersonCameraPosition.lerp(this.thirdPersonDesiredPosition,follow);
      this.camera.position.copy(this.thirdPersonCameraPosition);
      this.camera.lookAt(this.thirdPersonLookTarget);
      this.thirdPersonCameraQuaternion.copy(this.camera.quaternion);
    }

    const blendFollow=1-Math.exp(-dt*4.2);
    this.viewBlend+=(this.viewBlendTarget-this.viewBlend)*blendFollow;
    if(Math.abs(this.viewBlendTarget-this.viewBlend)<0.001)this.viewBlend=this.viewBlendTarget;
    this.camera.position.copy(this.firstPersonPosition).lerp(
      needsThirdPerson?this.thirdPersonCameraPosition:this.firstPersonPosition,
      this.viewBlend
    );
    this.camera.quaternion.copy(this.firstPersonQuaternion);
    if(needsThirdPerson)this.camera.quaternion.slerp(this.thirdPersonCameraQuaternion,this.viewBlend);
    this.camera.rotation.order='YXZ';
    if(this.viewBlend<=0.001&&this.viewBlendTarget<=0.001){
      this.thirdPersonCameraInitialized=false;
    }
  }

  _findGroundNear(x,z) {
    if(!this.terrain) return null;
    this.terrain.updateWorldMatrix(true,true);
    this.bounds.setFromObject(this.terrain);

    const clampedX=THREE.MathUtils.clamp(x,this.bounds.min.x,this.bounds.max.x);
    const clampedZ=THREE.MathUtils.clamp(z,this.bounds.min.z,this.bounds.max.z);
    const direct=this._groundAt(clampedX,clampedZ);
    if(direct) return direct;

    // If the drone is over a gap, use the nearest actual terrain vertex in XZ.
    const meshes=[];
    this.terrain.traverse(object=>{
      if(object.isMesh&&object.geometry?.attributes?.position)meshes.push(object);
    });
    let best=null,bestDistance=Infinity;
    const vertex=new THREE.Vector3();
    for(const mesh of meshes){
      const attr=mesh.geometry.attributes.position;
      for(let i=0;i<attr.count;i++){
        vertex.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld);
        const dx=vertex.x-clampedX,dz=vertex.z-clampedZ;
        const distance=dx*dx+dz*dz;
        if(distance<bestDistance){
          bestDistance=distance;
          best={x:vertex.x,z:vertex.z};
        }
      }
    }
    return best?this._groundAt(best.x,best.z):null;
  }

  start(terrain, spawnHint=null, {deferInput=false}={}) {
    if(!terrain) return false;
    this.terrain=terrain;
    let spawnFound=false;
    if(spawnHint&&spawnHint.position){
      this.terrain.updateWorldMatrix(true,true);
      this.bounds.setFromObject(this.terrain);
      const hit=this._findGroundNear(spawnHint.position.x,spawnHint.position.z);
      if(hit){
        const center=this.bounds.getCenter(new THREE.Vector3());
        this._setSpawn(hit,center);
        if(Number.isFinite(spawnHint.yaw))this.headingYaw=spawnHint.yaw;
        this.lookYaw=0;
        if(Number.isFinite(spawnHint.pitch))this.lookPitch=THREE.MathUtils.clamp(spawnHint.pitch,-0.58,0.45);
        this._syncCamera(0);
        spawnFound=true;
      }
    }else{
      spawnFound=!!this._findSpawn();
    }
    if(!spawnFound){this.terrain=null;return false;}
    this.active=true;
    this.inputEnabled=!deferInput;
    this.keys.clear();
    this.pushCooldown=0;
    this.skiSteerAngle=0;
    if(this.skiRig)this.skiRig.visible=true;
    this._updateSkiRig();
    this.domElement.style.cursor='crosshair';
    const result=this.domElement.requestPointerLock?.();
    if(result && typeof result.catch==='function') result.catch(()=>{});
    this.onHud({
      speed:0,slope:this.slopeDeg,grounded:true,
      acceleration:0,snowMu:this.snowMu,tuck:false,
      cameraView:this.viewBlendTarget>0.5?'third':'first'
    });
    return true;
  }

  enableInput(){
    this.inputEnabled=true;
    this.keys.clear();
  }

  stop() {
    this.active=false;
    this.inputEnabled=false;
    this.keys.clear();
    this.pushCooldown=0;
    this.skiSteerAngle=0;
    this.airborneHeight=0;
    this.airborneVelocityY=0;
    if(this.skiRig)this.skiRig.visible=false;
    this.domElement.style.cursor='';
    if(document.pointerLockElement===this.domElement) document.exitPointerLock?.();
    this.terrain=null;
  }

  _tryBumpJump(speed) {
    if(this.airborneHeight>0.01||this.airborneVelocityY>0.01||this.jumpCooldown>0)return false;
    // A small hop requires both strong acceleration and already-high speed.
    if(speed<14.5||this.lastLongitudinalAccel<2.8)return false;
    const direction=new THREE.Vector3(this.velocity.x,0,this.velocity.z);
    if(direction.lengthSq()<1e-6)return false;
    direction.normalize();
    const near=this._groundAt(this.position.x+direction.x*2.1,this.position.z+direction.z*2.1);
    const far=this._groundAt(this.position.x+direction.x*4.7,this.position.z+direction.z*4.7);
    if(!near||!far)return false;

    // Detect a raised crest with a downhill side, not an ordinary continuous slope.
    const rise=near.point.y-this.position.y;
    const drop=near.point.y-far.point.y;
    const crestHeight=near.point.y-(this.position.y+far.point.y)*0.5;
    if(rise<0.12||drop<0.10||crestHeight<0.26)return false;

    this.airborneVelocityY=2.7;
    this.jumpCooldown=1.35;
    return true;
  }

  update(dt) {
    if(!this.active || !this.inputEnabled || !this.terrain) return;
    dt=THREE.MathUtils.clamp(dt,0,0.04);

    // Refresh the local terrain frame before applying forces.
    const currentHit=this._groundAt(this.position.x,this.position.z);
    if(!currentHit) {
      this.velocity.set(0,0,0);
      this.onHud({speed:0,slope:this.slopeDeg,grounded:false,acceleration:0,snowMu:this.snowMu,tuck:false});
      return;
    }
    this.position.copy(currentHit.point);
    this.lastGroundNormal.copy(currentHit.normal);
    const normal=this.lastGroundNormal;
    this.velocity.addScaledVector(normal,-this.velocity.dot(normal));

    const left=this.keys.has('a')||this.keys.has('arrowleft');
    const right=this.keys.has('d')||this.keys.has('arrowright');
    const tuck=this.keys.has('w')||this.keys.has('arrowup');
    const brake=this.keys.has('s')||this.keys.has('arrowdown');
    const push=this.keys.has('shift')||this.keys.has(' ');
    const steer=(right?1:0)-(left?1:0);
    this.skiSteerAngle+=(steer*0.46-this.skiSteerAngle)*(1-Math.exp(-dt*13));

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

    // Rhythmic pole pushes add momentum in the ski direction, including uphill.
    this.pushCooldown=Math.max(0,this.pushCooldown-dt);
    if(push && this.pushCooldown<=0) {
      const yaw=this.headingYaw+this.lookYaw;
      const pushDirection=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)).projectOnPlane(normal);
      if(pushDirection.lengthSq()>1e-5) {
        pushDirection.normalize();
        this.velocity.addScaledVector(pushDirection,this.pushImpulse);
        this.lastLongitudinalAccel=this.pushImpulse/this.pushInterval;
        this.pushCooldown=this.pushInterval;
      }
    }
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

    this.jumpCooldown=Math.max(0,this.jumpCooldown-dt);
    this._tryBumpJump(this.velocity.length());
    if(this.airborneVelocityY>0||this.airborneHeight>0){
      this.airborneVelocityY-=9.81*dt;
      this.airborneHeight=Math.max(0,this.airborneHeight+this.airborneVelocityY*dt);
      if(this.airborneHeight===0)this.airborneVelocityY=0;
    }

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

    this._syncCamera(steer,dt);
    this._updateSkiRig();
    this._updateSkierAvatar();
    this.onHud({
      speed:this.velocity.length(),
      slope:this.slopeDeg,
      grounded,
      acceleration:this.lastLongitudinalAccel,
      snowMu:this.snowMu,
      pushing:push,
      tuck,
      cameraView:this.viewBlendTarget>0.5?'third':'first'
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
    if(this.scene&&this.skierAvatar)this.scene.remove(this.skierAvatar);
    const geometries=new Set(),materials=new Set();
    const disposeRoots=[this.skiRig,this.skierAvatar];
    disposeRoots.forEach(root=>root?.traverse(object=>{
      if(object.geometry)geometries.add(object.geometry);
      if(object.material)(Array.isArray(object.material)?object.material:[object.material]).forEach(m=>materials.add(m));
    }));
    geometries.forEach(g=>g.dispose());
    materials.forEach(m=>m.dispose());
  }
}
