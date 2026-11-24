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
    this.touchMode = false;
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this.down = new THREE.Vector3(0, -1, 0);
    this.normalMatrix = new THREE.Matrix3();
    this.gravity = new THREE.Vector3(0, -9.81, 0);
    this.windVelocity = new THREE.Vector3(0, 0, 0);

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.bounds = new THREE.Box3();
    this.terrainLookup = null;
    this.terrainBuildToken = 0;
    this.terrainPerformance = {
      queryCount:0,lookupHits:0,lookupMisses:0,
      raycastFallbacks:0,raycastHits:0,raycastMisses:0,
      totalQueryMs:0,maxQueryMs:0,buildMs:0,
      triangleCount:0,meshCount:0,occupiedCells:0,
      cellReferences:0,maxBucketSize:0,averageTrianglesPerCell:0
    };
    this.lastStartError = null;
    this.lastStartDiagnostics = null;
    this.lastSpawnInfo = null;
    this.lastGroundNormal = new THREE.Vector3(0, 1, 0);

    // Reference skier / environment parameters.
    this.massKg = 75;
    this.airDensity = 1.0;        // kg/m^3; proxy for an alpine-altitude atmosphere
    this.cdaUpright = 0.53;       // m^2, effective drag area
    this.cdaTuck = 0.34;          // m^2, reduced frontal area in a tuck
    this.snowMu = 0.045;          // groomed mid-winter baseline
    this.staticMu = 0.053;
    this.brakeMu = 0.16;          // additional effective snow-machining resistance
    this.turnScrubMu = 0.008;     // small extra loss while edging / turning
    this.maxEdgeG = 1.25;
    this.maxTurnRate = 0.88;
    this.maxSafeSpeed = 60;
    this.pushImpulseNs = 60; // N·s; ~0.8 m/s at 75 kg
    this.pushInterval = 0.42;
    this.pushCooldown = 0;
    this.skiSteerAngle = 0;
    this.skiSlots = [];
    this.customSkiSource = null;
    this.airborneHeight = 0;
    this.airborneVelocityY = 0;
    this.airborneWorldY = null;
    this.manualJumpImpulseNs = 195; // N·s; 2.6 m/s take-off at 75 kg
    this.bumpJumpImpulseNs = 202.5; // N·s; 2.7 m/s at 75 kg
    this.jumpCooldown = 0;
    this.normalForceN = this.massKg * 9.81;
    this.lateralForceN = 0;
    this.totalSkiLoadN = this.normalForceN;
    this.outsideSkiLoadN = this.totalSkiLoadN * 0.5;
    this.insideSkiLoadN = this.totalSkiLoadN * 0.5;
    this.outsideLoadShare = 0.5;
    this.lateralAcceleration = 0;
    this.jumpTakeoffPulse = 0;
    this.landingPulse = 0;

    this.eyeHeight = 2.05; // calibrated eye point above the ski plane, in metres
    this.headingYaw = 0;
    this.lookYaw = 0;
    this.lookPitch = -0.035;
    this.airborneCameraPitch = 0;
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
    this.stanceCameraBlend = 0;
    this.avatarLegs = [];
    this.avatarArms = [];
    this.avatarAnimationTime = 0;
    this.avatarPushPulse = 0;
    this.avatarTorsoBaseY = 0.87;
    this.avatarPose = Object.create(null);
    this.firstPersonPosition = new THREE.Vector3();
    this.firstPersonQuaternion = new THREE.Quaternion();
    this.cameraEuler = new THREE.Euler(0,0,0,'YXZ');

    this.skiRig = this._createSkiRig();
    this.skierAvatar = this._createSkierAvatar();
    if (this.scene && this.skiRig) this.scene.add(this.skiRig);
    if (this.scene && this.skierAvatar) this.scene.add(this.skierAvatar);

    this._onKeyDown = (e) => {
      if (!this.active) return;
      if (e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat && this.inputEnabled) this._tryManualJump();
        return;
      }
      if (!this.inputEnabled) return;
      if (e.code === 'KeyC') {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) this.toggleCameraView();
        return;
      }
      const key = this._readKey(e);
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','shift'].includes(key)) {
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
    this._onPointerLock = () => {
      const locked=document.pointerLockElement===this.domElement;
      if(!locked)this.keys.clear();
      this.onPointerLock(locked);
    };
    this._onCanvasClick = () => {
      if (this.active && !this.touchMode && document.pointerLockElement !== this.domElement) {
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

    // All character parts share a small set of materials. The rig fades as a
    // single character when switching between first- and third-person views.
    const material = (color,roughness=0.72,metalness=0.02) => {
      const result = new THREE.MeshStandardMaterial({
        color,roughness,metalness,transparent:true,opacity:0,depthWrite:false
      });
      this.avatarFadeMaterials.push(result);
      return result;
    };
    const jacket = material(0x12647b,0.82);
    const jacketDark = material(0x0a4056,0.88);
    const jacketTrim = material(0xe2edf0,0.58);
    const orange = material(0xf08a36,0.62);
    const pants = material(0x202b38,0.9);
    const kneeFabric = material(0x344351,0.82);
    const boots = material(0x151c25,0.5,0.12);
    const bootAccent = material(0xd45b35,0.5,0.08);
    const helmet = material(0xf0f3f1,0.32,0.08);
    const helmetDark = material(0x26313b,0.42,0.16);
    const visor = material(0x27788b,0.18,0.42);
    const face = material(0x9a7664,0.92);
    const gloves = material(0x171f27,0.62,0.08);
    const poleMetal = material(0x8799a6,0.28,0.72);
    const poleGrip = material(0x202b34,0.66,0.12);
    const poleBasket = material(0xe87532,0.58,0.04);
    const metal = material(0x9cabb4,0.26,0.76);

    const sphere = (parent,radius,position,mat,scale=new THREE.Vector3(1,1,1),segments=18) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius,segments,Math.max(10,Math.floor(segments*0.72))),
        mat
      );
      mesh.position.copy(position);
      mesh.scale.copy(scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const box = (parent,size,position,mat,name='') => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x,size.y,size.z),mat);
      mesh.position.copy(position);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const cylinder = (parent,radiusTop,radiusBottom,height,position,mat,radialSegments=12) => {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radiusTop,radiusBottom,height,radialSegments),
        mat
      );
      mesh.position.copy(position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // Lower body: separate hip and knee pivots let the skier absorb terrain
    // changes and move into a genuine flexed racing stance.
    this.avatarPelvis = new THREE.Group();
    this.avatarPelvis.name = 'Skier_Pelvis_Pivot';
    this.avatarPelvis.position.y = 0.78;
    this.avatarPelvisBaseY = 0.78;
    avatar.add(this.avatarPelvis);
    sphere(this.avatarPelvis,0.205,new THREE.Vector3(0,0.01,0.015),pants,new THREE.Vector3(1.12,0.84,0.88),18);
    this.avatarLegs = [];
    for (const side of [-1,1]) {
      const leg = new THREE.Group();
      leg.name = side<0?'Skier_Leg_Left':'Skier_Leg_Right';
      leg.position.set(side*0.13,0,0.012);
      this.avatarPelvis.add(leg);

      const kneePoint = new THREE.Vector3(side*0.025,-0.285,-0.035);
      this._makeAvatarCapsule(leg,new THREE.Vector3(0,0,0),kneePoint,0.108,pants,12);
      sphere(leg,0.102,kneePoint,kneeFabric,new THREE.Vector3(0.98,0.92,0.9),14);

      const lowerLeg = new THREE.Group();
      lowerLeg.name = side<0?'Skier_Knee_Left':'Skier_Knee_Right';
      lowerLeg.position.copy(kneePoint);
      leg.add(lowerLeg);
      const ankle = new THREE.Vector3(side*0.012,-0.35,0.065);
      this._makeAvatarCapsule(lowerLeg,new THREE.Vector3(0,0,0),ankle,0.079,pants,11);
      sphere(lowerLeg,0.064,ankle,pants,new THREE.Vector3(1,1,1),12);

      // Realistic ski boot silhouette: high cuff, reinforced toe and visible
      // buckles rather than a single featureless block.
      box(lowerLeg,new THREE.Vector3(0.178,0.155,0.31),new THREE.Vector3(side*0.012,-0.36,-0.042),boots,'Ski_Boot');
      box(lowerLeg,new THREE.Vector3(0.182,0.035,0.325),new THREE.Vector3(side*0.012,-0.444,-0.042),helmetDark,'Boot_Sole');
      box(lowerLeg,new THREE.Vector3(0.155,0.09,0.085),new THREE.Vector3(side*0.012,-0.292,-0.125),bootAccent,'Boot_Toe');
      for (let buckle=0;buckle<3;buckle++) {
        const y=-0.285-buckle*0.047;
        box(lowerLeg,new THREE.Vector3(0.018,0.018,0.082),new THREE.Vector3(side*0.105,y,-0.035),metal,'Boot_Buckle');
      }
      box(lowerLeg,new THREE.Vector3(0.012,0.105,0.02),new THREE.Vector3(side*0.105,-0.335,-0.045),bootAccent,'Boot_Accent');
      box(lowerLeg,new THREE.Vector3(0.19,0.032,0.21),new THREE.Vector3(side*0.012,-0.255,0.025),jacketDark,'Boot_Cuff');
      box(lowerLeg,new THREE.Vector3(0.185,0.018,0.24),new THREE.Vector3(side*0.012,-0.458,-0.042),metal,'Boot_Welt');
      box(lowerLeg,new THREE.Vector3(0.185,0.028,0.22),new THREE.Vector3(side*0.012,-0.31,0.075),jacketTrim,'Boot_Gaiter_Seam');
      // Layered kneepad and stitched seams stay attached to the moving lower leg.
      sphere(lowerLeg,0.073,new THREE.Vector3(0,0.018,-0.073),kneeFabric,new THREE.Vector3(1.22,0.94,0.48),16);
      box(lowerLeg,new THREE.Vector3(0.112,0.018,0.018),new THREE.Vector3(0,0.074,-0.092),jacketDark,'Kneepad_Upper_Strap');
      box(lowerLeg,new THREE.Vector3(0.104,0.014,0.016),new THREE.Vector3(0,-0.045,-0.091),metal,'Kneepad_Lower_Stitch');
      box(lowerLeg,new THREE.Vector3(0.024,0.20,0.012),new THREE.Vector3(side*0.061,-0.17,-0.075),bootAccent,'Shin_Reflective_Piping');
      box(leg,new THREE.Vector3(0.14,0.085,0.025),new THREE.Vector3(0,-0.18,-0.092),kneeFabric,'Knee_Reinforcement');
      box(leg,new THREE.Vector3(0.018,0.27,0.018),new THREE.Vector3(side*0.085,-0.31,0.004),jacketDark,'Trouser_Seam');
      this.avatarLegs.push({hip:leg,knee:lowerLeg,side});
    }

    // Core and jacket. Overlapping tailored volumes give the torso a shoulder,
    // chest and waist profile instead of one long primitive capsule.
    this.avatarTorso = new THREE.Group();
    this.avatarTorso.position.y = 0.87;
    this.avatarTorsoBaseY = 0.87;
    this.avatarTorso.name = 'Skier_Upper_Body';
    avatar.add(this.avatarTorso);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.218,0.49,7,16),jacket);
    torso.position.set(0,0.29,0);
    torso.castShadow = true;
    torso.receiveShadow = true;
    this.avatarTorso.add(torso);
    sphere(this.avatarTorso,0.205,new THREE.Vector3(0,0.12,0.006),jacketDark,new THREE.Vector3(1.08,0.56,0.88),16);
    sphere(this.avatarTorso,0.225,new THREE.Vector3(0,0.47,0),jacket,new THREE.Vector3(1.18,0.62,0.88),18);

    // Collar, hood and neck form a clean transition into the helmet.
    cylinder(this.avatarTorso,0.115,0.13,0.16,new THREE.Vector3(0,0.59,0.012),jacketDark,18);
    sphere(this.avatarTorso,0.12,new THREE.Vector3(0,0.69,-0.006),face,new THREE.Vector3(0.92,1.08,0.84),16);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.145,0.038,9,24),jacketTrim);
    collar.rotation.x=Math.PI/2;
    collar.position.set(0,0.585,0.005);
    collar.castShadow=true;
    this.avatarTorso.add(collar);

    // Jacket paneling, front zip, chest pockets, reflective piping and cuffs.
    box(this.avatarTorso,new THREE.Vector3(0.014,0.43,0.014),new THREE.Vector3(0,0.31,-0.218),jacketDark,'Jacket_Front_Zip');
    box(this.avatarTorso,new THREE.Vector3(0.025,0.30,0.012),new THREE.Vector3(0.018,0.32,-0.228),metal,'Zip_Pull');
    for (const side of [-1,1]) {
      box(this.avatarTorso,new THREE.Vector3(0.094,0.13,0.018),new THREE.Vector3(side*0.116,0.24,-0.207),jacketDark,'Jacket_Pocket');
      box(this.avatarTorso,new THREE.Vector3(0.074,0.012,0.012),new THREE.Vector3(side*0.116,0.295,-0.219),orange,'Pocket_Trim');
      box(this.avatarTorso,new THREE.Vector3(0.018,0.29,0.012),new THREE.Vector3(side*0.195,0.36,-0.12),jacketTrim,'Reflective_Seam');
      box(this.avatarTorso,new THREE.Vector3(0.10,0.025,0.012),new THREE.Vector3(side*0.11,0.49,-0.18),orange,'Shoulder_Piping');
    }
    box(this.avatarTorso,new THREE.Vector3(0.39,0.035,0.03),new THREE.Vector3(0,0.065,-0.012),jacketDark,'Jacket_Hem');
    box(this.avatarTorso,new THREE.Vector3(0.38,0.025,0.018),new THREE.Vector3(0,0.075,-0.185),jacketTrim,'Waist_Reflector');
    box(this.avatarTorso,new THREE.Vector3(0.045,0.12,0.018),new THREE.Vector3(0,0.40,-0.232),orange,'Chest_Brand_Tab');
    for(const side of [-1,1]){
      box(this.avatarTorso,new THREE.Vector3(0.07,0.018,0.012),new THREE.Vector3(side*0.12,0.17,-0.218),metal,'Pocket_Zip');
      box(this.avatarTorso,new THREE.Vector3(0.018,0.18,0.025),new THREE.Vector3(side*0.208,0.34,-0.085),jacketDark,'Sleeve_Seam');
    }

    // Helmet shell is a domed open-bottom cap, with a raised crown, vents,
    // goggle strap and a curved, reflective lens.
    const helmetShell = new THREE.Mesh(
      new THREE.SphereGeometry(0.168,24,16,0,Math.PI*2,0,Math.PI*0.64),
      helmet
    );
    helmetShell.name='Helmet_Shell';
    helmetShell.position.set(0,0.845,0.004);
    helmetShell.scale.set(1.04,1.02,1.08);
    helmetShell.castShadow=true;
    helmetShell.receiveShadow=true;
    this.avatarTorso.add(helmetShell);
    box(this.avatarTorso,new THREE.Vector3(0.225,0.026,0.19),new THREE.Vector3(0,0.79,0.018),helmetDark,'Helmet_Edge');
    box(this.avatarTorso,new THREE.Vector3(0.095,0.026,0.10),new THREE.Vector3(0,0.99,0.01),helmet,'Helmet_Crown_Ridge');
    for (const side of [-1,1]) {
      box(this.avatarTorso,new THREE.Vector3(0.058,0.012,0.025),new THREE.Vector3(side*0.058,0.955,-0.018),helmetDark,'Helmet_Vent');
    }
    const goggleFrame = box(
      this.avatarTorso,new THREE.Vector3(0.285,0.078,0.052),
      new THREE.Vector3(0,0.775,-0.137),helmetDark,'Goggle_Frame'
    );
    goggleFrame.scale.set(1,1,0.82);
    const goggleLens = sphere(
      this.avatarTorso,0.112,new THREE.Vector3(0,0.78,-0.166),
      visor,new THREE.Vector3(1.18,0.40,0.23),24
    );
    goggleLens.name='Goggle_Lens';
    for (const side of [-1,1]) {
      box(this.avatarTorso,new THREE.Vector3(0.075,0.028,0.025),new THREE.Vector3(side*0.17,0.775,-0.095),helmetDark,'Goggle_Strap');
      box(this.avatarTorso,new THREE.Vector3(0.018,0.105,0.018),new THREE.Vector3(side*0.095,0.685,-0.105),helmetDark,'Helmet_Chin_Strap');
    }
    sphere(this.avatarTorso,0.019,new THREE.Vector3(0,0.71,-0.105),face,new THREE.Vector3(0.8,1,0.7),10);

    // Compact back protector / pack with shoulder and waist straps.
    const backpack = box(avatar,new THREE.Vector3(0.30,0.39,0.145),new THREE.Vector3(0,1.19,0.205),pants,'Back_Protector');
    backpack.castShadow=true;
    box(avatar,new THREE.Vector3(0.25,0.055,0.03),new THREE.Vector3(0,1.02,0.285),jacketTrim,'Pack_Lower_Stripe');
    for (const side of [-1,1]) {
      box(this.avatarTorso,new THREE.Vector3(0.035,0.55,0.035),new THREE.Vector3(side*0.15,0.29,0.17),jacketDark,'Pack_Shoulder_Strap');
      box(this.avatarTorso,new THREE.Vector3(0.09,0.035,0.035),new THREE.Vector3(side*0.13,0.06,0.12),orange,'Waist_Buckle');
    }

    // Individually articulated arms. Pole rigs are children of the hands, so
    // they follow the shoulder and elbow rather than floating beside the body.
    this.avatarArms = [];
    for (const side of [-1,1]) {
      const armRoot = new THREE.Group();
      armRoot.name=side<0?'Skier_Arm_Left':'Skier_Arm_Right';
      armRoot.position.set(side*0.222,0.475,0.005);
      this.avatarTorso.add(armRoot);

      const elbowPoint = new THREE.Vector3(side*0.105,-0.205,-0.008);
      this._makeAvatarCapsule(armRoot,new THREE.Vector3(0,0,0),elbowPoint,0.085,jacket,11);
      sphere(armRoot,0.078,elbowPoint,jacket,new THREE.Vector3(1,0.96,0.98),12);

      const elbowPivot = new THREE.Group();
      elbowPivot.name=side<0?'Skier_Elbow_Left':'Skier_Elbow_Right';
      elbowPivot.position.copy(elbowPoint);
      armRoot.add(elbowPivot);
      const handPoint = new THREE.Vector3(side*0.055,-0.16,-0.17);
      this._makeAvatarCapsule(elbowPivot,new THREE.Vector3(0,0,0),handPoint,0.065,jacketTrim,10);
      sphere(elbowPivot,0.067,handPoint,gloves,new THREE.Vector3(1.08,0.9,1.0),12);
      box(elbowPivot,new THREE.Vector3(0.13,0.055,0.09),handPoint.clone().add(new THREE.Vector3(0,-0.015,0.015)),jacketDark,'Glove_Cuff');
      this._makeAvatarCapsule(
        elbowPivot,
        handPoint.clone().add(new THREE.Vector3(0,0.012,-0.005)),
        handPoint.clone().add(new THREE.Vector3(side*0.055,-0.018,-0.025)),
        0.027,gloves,8
      );

      const poleRoot = new THREE.Group();
      poleRoot.name=side<0?'Ski_Pole_Left':'Ski_Pole_Right';
      poleRoot.position.copy(handPoint);
      elbowPivot.add(poleRoot);
      const poleTip = new THREE.Vector3(side*0.12,-0.98,0.62);
      this._makeAvatarCapsule(poleRoot,new THREE.Vector3(0,0,0),poleTip,0.009,poleMetal,7);
      cylinder(poleRoot,0.013,0.012,0.12,new THREE.Vector3(0,-0.045,0),poleGrip,10);
      cylinder(poleRoot,0.018,0.016,0.025,new THREE.Vector3(0,-0.115,0),metal,10);
      cylinder(poleRoot,0.052,0.052,0.014,new THREE.Vector3(poleTip.x,poleTip.y+0.12,poleTip.z),poleBasket,14);
      this._makeAvatarCapsule(
        poleRoot,
        poleTip.clone().add(new THREE.Vector3(0,0.04,0)),
        poleTip.clone().add(new THREE.Vector3(0,-0.065,0)),
        0.006,metal,6
      );
      this.avatarArms.push({shoulder:armRoot,elbow:elbowPivot,pole:poleRoot,side});
    }

    avatar.traverse(object=>{
      if(object.isMesh){
        object.frustumCulled=false;
        object.castShadow=true;
        object.receiveShadow=true;
        // Tiny trim pieces add shape but do not need individual shadow maps.
        if(/Zip|Vent|Reflect|Trim|Buckle|Strap|Ridge|Seam/.test(object.name))object.castShadow=false;
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
      grounded:this.active&&this.airborneWorldY===null,
      acceleration:this.lastLongitudinalAccel,
      snowMu:this.snowMu,
      cameraView:this.viewBlendTarget > 0.5 ? 'third' : 'first'
    });
  }

  _updateSkierAvatar(forceVisible=false,dt=1/60,motion={}) {
    if(!this.skierAvatar||!this.skiRig)return;
    const thirdPersonRequested=this.viewBlendTarget>0.5;
    const showAvatar=forceVisible||thirdPersonRequested;
    const blend=forceVisible?1:(thirdPersonRequested
      ?THREE.MathUtils.clamp((this.viewBlend-0.035)/0.65,0,1)
      :0);
    if(!forceVisible&&!thirdPersonRequested&&this.viewBlend<=0.001){
      this.skierAvatar.visible=false;
      if(!this.avatarHiddenForFirstPerson){
        for(const mat of this.avatarFadeMaterials||[])mat.opacity=0;
        this.avatarHiddenForFirstPerson=true;
      }
      return;
    }
    this.avatarHiddenForFirstPerson=false;
    this.skierAvatar.visible=showAvatar;
    const fullyVisible=blend>=0.995;
    for(const mat of this.avatarFadeMaterials||[]){
      const transparent=!fullyVisible;
      if(mat.transparent!==transparent||mat.depthWrite!==fullyVisible){
        mat.transparent=transparent;
        mat.depthWrite=fullyVisible;
        mat.needsUpdate=true;
      }
      mat.opacity=fullyVisible?1:blend;
    }
    this.skierAvatar.position.copy(this.skiRig.position);
    this.skierAvatar.quaternion.copy(this.skiRig.quaternion);

    // Damped, frame-rate-independent pose response. A second smoothed turn
    // signal gives the body and knees momentum rather than mirroring key states.
    dt=THREE.MathUtils.clamp(Number(dt)||0,0,0.05);
    const smooth=(key,target,rate=8)=>{
      const current=Number(this.avatarPose[key])||0;
      const next=current+(target-current)*(1-Math.exp(-rate*dt));
      this.avatarPose[key]=next;
      return next;
    };
    this.avatarAnimationTime=(this.avatarAnimationTime||0)+dt;
    this.avatarPushPulse=Math.max(0,(this.avatarPushPulse||0)-dt*2.9);
    const time=this.avatarAnimationTime;
    const speed=this.velocity.length();
    const speedBlend=THREE.MathUtils.clamp(speed/32,0,1);
    const turnSpeedBlend=THREE.MathUtils.clamp((speed-1.5)/17.5,0,1);
    const tuck=motion.tuck===undefined?this.stanceCameraBlend:(motion.tuck?1:0);
    const brake=motion.brake?1:0;
    const airborne=motion.airborne?1:0;
    const steer=THREE.MathUtils.clamp(motion.steer===undefined?this.skiSteerAngle/0.46:motion.steer,-1,1);
    const lateralG=THREE.MathUtils.clamp(Number(motion.lateralG)||0,0,this.maxEdgeG);
    const loadShift=THREE.MathUtils.clamp(((Number(motion.outsideLoadShare)||0.5)-0.5)/0.1,0,1);
    this.jumpTakeoffPulse=Math.max(0,(this.jumpTakeoffPulse||0)-dt*4.8);
    this.landingPulse=Math.max(0,(this.landingPulse||0)-dt*3.6);
    const jumpTakeoff=this.jumpTakeoffPulse;
    const landing=this.landingPulse;
    const carve=smooth('carveWeight',Math.max(Math.abs(steer),lateralG/Math.max(0.1,this.maxEdgeG))*turnSpeedBlend,4.6);
    const turnSide=smooth('turnDirection',steer,4.2);
    const turnLean=turnSide*carve*THREE.MathUtils.clamp(lateralG/0.75,0,1);
    const breathing=Math.sin(time*1.8)*0.0045;
    const suspension=Math.sin(time*(4.4+speedBlend*2.2))*0.006*(0.2+speedBlend*0.8);
    const push=this.avatarPushPulse;

    if(this.avatarTorso){
      const turnCompression=smooth('torsoCompression',carve*(0.014+speedBlend*0.014),5.2);
      this.avatarTorso.position.y=this.avatarTorsoBaseY+breathing+suspension-turnCompression+airborne*0.018-landing*0.028-jumpTakeoff*0.012;
      this.avatarTorso.rotation.x=smooth('torsoPitch',-0.055-speedBlend*0.10-0.43*tuck+0.12*brake+0.14*airborne-0.045*carve-0.10*jumpTakeoff+0.10*landing,6.8);
      this.avatarTorso.rotation.z=smooth('torsoRoll',-turnLean*(0.045+speedBlend*0.22),5.4);
      this.avatarTorso.rotation.y=smooth('torsoYaw',-turnLean*(0.035+speedBlend*0.13)+Math.sin(time*1.1)*0.008,5.8);
    }
    if(this.avatarPelvis){
      const pelvisCompression=smooth('pelvisCompression',carve*(0.026+speedBlend*0.025),5.5);
      this.avatarPelvis.position.y=this.avatarPelvisBaseY-pelvisCompression;
      this.avatarPelvis.rotation.x=smooth('pelvisPitch',0.035+0.10*tuck-0.055*brake-0.12*airborne-0.075*carve,6.8);
      this.avatarPelvis.rotation.z=smooth('pelvisRoll',turnLean*(0.02+speedBlend*0.11),5.5);
      this.avatarPelvis.rotation.y=smooth('pelvisYaw',turnLean*(0.065+speedBlend*0.10),5.8);
    }

    this.avatarLegs.forEach((leg,index)=>{
      const side=leg.side;
      const outsideLoad=Math.max(0,side*turnSide)*carve*(0.85+0.15*loadShift);
      const insideLoad=Math.max(0,-side*turnSide)*carve*(1-0.12*loadShift);
      const alternating=Math.sin(time*4.1+index*Math.PI)*0.009*speedBlend;

      // Alpine stance: both knees absorb the turn; the inside knee folds
      // deeper while the outside leg stays longer and carries more pressure.
      const sharedKneeFlex=0.17*carve;
      const insideKneeFlex=0.27*insideLoad;
      const outsideSupport=-0.025*outsideLoad;
      const kneeTurnFlex=sharedKneeFlex+insideKneeFlex+outsideSupport;
      const hipTurnFlex=0.085*carve+0.045*insideLoad;

      leg.hip.rotation.x=smooth(
        'hipX'+index,
        -0.055-0.19*tuck-0.10*brake+0.14*airborne+alternating-hipTurnFlex-0.07*jumpTakeoff+0.06*landing,
        7.2
      );
      leg.hip.rotation.z=smooth(
        'hipZ'+index,
        turnLean*(0.055+speedBlend*0.035)+side*0.018*tuck+outsideLoad*0.025-insideLoad*0.018,
        6.8
      );
      leg.knee.rotation.x=smooth(
        'kneeX'+index,
        -0.12-0.40*tuck-0.17*brake+0.30*airborne+Math.max(0,alternating)*0.4-kneeTurnFlex-0.20*jumpTakeoff-0.24*landing,
        6.2
      );
      const kneeLateralLean=turnLean*(0.085+speedBlend*0.035)+(insideLoad-outsideLoad)*0.015;
      leg.knee.rotation.z=smooth(
        'kneeZ'+index,
        kneeLateralLean,
        6.5
      );
    });

    this.avatarArms.forEach((arm,index)=>{
      const side=arm.side;
      const outsideLoad=Math.max(0,side*turnSide)*carve;
      const insideLoad=Math.max(0,-side*turnSide)*carve;
      arm.shoulder.rotation.x=smooth('shoulderX'+index,-0.045-0.12*tuck-0.08*brake+0.22*push+0.11*airborne+outsideLoad*0.055,7.2);
      arm.shoulder.rotation.z=smooth('shoulderZ'+index,side*(0.10+0.075*tuck)+turnLean*(0.035+speedBlend*0.045)+outsideLoad*0.10-insideLoad*0.035,6.8);
      arm.elbow.rotation.x=smooth('elbowX'+index,-0.14-0.10*tuck+0.58*push+0.15*airborne-insideLoad*0.12,7.2);
      arm.elbow.rotation.z=smooth('elbowZ'+index,side*(0.03-turnLean*0.06)+outsideLoad*0.055,6.8);
      arm.pole.rotation.x=smooth('poleX'+index,-0.025+0.72*push+0.09*airborne+outsideLoad*0.11,6.6);
      arm.pole.rotation.z=smooth('poleZ'+index,-side*turnLean*(0.03+speedBlend*0.045)+outsideLoad*0.06,6.6);
    });

    // Ski edge follows the same eased turn momentum as the athlete's joints.
    this.skiSlots.forEach((slot,index)=>{
      const side=slot.group.position.x<0?-1:1;
      const edgeTarget=-side*(turnLean*(0.045+speedBlend*0.065)+brake*0.016);
      slot.group.rotation.z=smooth('skiEdge'+index,edgeTarget,7.8);
      const outsideLoad=Math.max(0,side*turnSide)*carve*(0.85+0.15*loadShift);
      slot.group.rotation.x=smooth('skiFlex'+index,Math.sin(time*5.1+index*Math.PI)*0.0025+airborne*0.012-0.004*outsideLoad+0.008*landing,8.2);
    });
  }

  showForDrone(){
    if(!this.skierAvatar||!this.skiRig)return;
    this.skiRig.visible=true;
    this._updateSkierAvatar(true);
  }

  hideForOverview(){
    if(this.skierAvatar)this.skierAvatar.visible=false;
    if(this.skiRig)this.skiRig.visible=false;
    for(const material of this.avatarFadeMaterials||[])material.opacity=0;
  }

  _createSkiRig() {
    const rig = new THREE.Group();
    rig.name = 'Skier_FirstPerson_Skis';
    const outline = new THREE.Shape();
    // Keep bindings and tails fixed; extend the front overhang to 1.5x its original length.
    outline.moveTo(-0.047,-0.92);
    outline.quadraticCurveTo(-0.052,-0.58,-0.050,0.60);
    outline.lineTo(-0.050,0.8475);
    outline.quadraticCurveTo(-0.048,1.7475,0,1.9125);
    outline.quadraticCurveTo(0.048,1.7475,0.050,0.8475);
    outline.lineTo(0.050,0.60);
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
      const stripe=new THREE.Mesh(new THREE.BoxGeometry(0.009,0.004,1.7875),topMaterial);
      stripe.position.set(0,0.022,-0.13375);ski.add(stripe);
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

  _disposeSkiSourceResources(root) {
    if(!root)return;
    const geometries=new Set(),materials=new Set(),textures=new Set();
    root.traverse(object=>{
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

  setSkiModel(source) {
    const previousSource=this.customSkiSource;

    if(!source){
      for(const slot of this.skiSlots){
        while(slot.customMount.children.length){
          slot.customMount.remove(slot.customMount.children[0]);
        }
        slot.board.visible=true;
        slot.stripe.visible=true;
      }
      this.customSkiSource=null;
      if(previousSource)this._disposeSkiSourceResources(previousSource);
      return false;
    }

    // Prepare and validate the next model completely before removing the
    // current pair. An empty / malformed GLB must never destroy working skis.
    let preparedModels=[];
    try{
      source.updateWorldMatrix(true,true);
      const model=source.clone(true);
      model.updateWorldMatrix(true,true);
      const sizeBox=new THREE.Box3().setFromObject(model);
      if(sizeBox.isEmpty())throw new Error('В GLB не найдена геометрия лыжи.');
      const size=sizeBox.getSize(new THREE.Vector3());
      const longestAxis=size.x>=size.y&&size.x>=size.z?'x':(size.y>=size.z?'y':'z');

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
      preparedModels=this.skiSlots.map(()=>fitted.clone(true));
      preparedModels.forEach(item=>item.updateMatrixWorld(true));
    }catch(error){
      if(source!==previousSource)this._disposeSkiSourceResources(source);
      throw error;
    }

    for(let index=0;index<this.skiSlots.length;index++){
      const slot=this.skiSlots[index];
      while(slot.customMount.children.length){
        slot.customMount.remove(slot.customMount.children[0]);
      }
      slot.board.visible=false;
      slot.stripe.visible=false;
      slot.customMount.add(preparedModels[index]);
    }
    this.customSkiSource=source;
    if(previousSource&&previousSource!==source)this._disposeSkiSourceResources(previousSource);
    return true;
  }

  _updateSkiRig() {
    if(!this.skiRig)return;
    const normal=this.lastGroundNormal.clone().normalize();
    let forward=this.velocity.clone().projectOnPlane(normal);
    if(forward.lengthSq()<1e-4){
      const idleYaw=this.headingYaw; // Camera orbit must never steer the skis.
      forward.set(-Math.sin(idleYaw),0,-Math.cos(idleYaw)).projectOnPlane(normal);
    }
    if(forward.lengthSq()<1e-4)forward.set(0,0,-1);
    forward.normalize();
    if(Math.abs(this.skiSteerAngle)>1e-4)forward.applyAxisAngle(normal,-this.skiSteerAngle).normalize();
    const right=new THREE.Vector3().crossVectors(forward,normal).normalize();
    const back=forward.clone().negate();
    this.skiRig.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,normal,back));
    // Keep the ski rig at boot level on the actual snow surface, ahead of the skier.
    this.skiRig.position.copy(this.position)
      .addScaledVector(forward,0.95)
      .addScaledVector(normal,0.055);
    this.skiRig.position.y+=this.airborneHeight;
  }

  _readKey(e) {
    const physical = {
      KeyW:'w', KeyA:'a', KeyS:'s', KeyD:'d',
      ArrowUp:'arrowup', ArrowDown:'arrowdown',
      ArrowLeft:'arrowleft', ArrowRight:'arrowright'
    };
    return physical[e.code] || (e.key || '').toLowerCase();
  }

  setSnowFriction(value) {
    this.snowMu = THREE.MathUtils.clamp(Number(value) || 0.045, 0.02, 0.14);
    this.staticMu = Math.min(0.16, this.snowMu + 0.008);
    this.onHud({
      speed: this.velocity.length(),
      slope: this.slopeDeg,
      grounded: this.active&&this.airborneWorldY===null,
      acceleration: this.lastLongitudinalAccel,
      snowMu: this.snowMu,
      tuck: this.keys.has('w') || this.keys.has('arrowup')
    });
  }

  async _buildTerrainLookup(onProgress=()=>{},isCurrent=()=>true) {
    const buildStarted=performance.now();
    const stats=this.terrainPerformance;
    Object.assign(stats,{
      queryCount:0,lookupHits:0,lookupMisses:0,
      raycastFallbacks:0,raycastHits:0,raycastMisses:0,
      totalQueryMs:0,maxQueryMs:0,buildMs:0,spawnSearchMs:0,startupMs:0,
      triangleCount:0,meshCount:0,occupiedCells:0,
      cellReferences:0,maxBucketSize:0,averageTrianglesPerCell:0
    });
    this.terrainLookup=null;
    if(!this.terrain)return false;
    this.terrain.updateWorldMatrix(true,true);
    this.bounds.setFromObject(this.terrain);
    if(this.bounds.isEmpty())return false;

    const cols=192,rows=192;
    const minX=this.bounds.min.x,minZ=this.bounds.min.z;
    const rangeX=Math.max(1e-6,this.bounds.max.x-minX);
    const rangeZ=Math.max(1e-6,this.bounds.max.z-minZ);
    const maxX=minX+rangeX,maxZ=minZ+rangeZ;
    const cellSizeX=rangeX/cols,cellSizeZ=rangeZ/rows;
    const cells=new Array(cols*rows);
    const meshes=[];
    this.terrain.traverse(object=>{
      if(object.isMesh&&object.geometry?.attributes?.position)meshes.push(object);
    });
    const totalTriangles=meshes.reduce((sum,mesh)=>{
      const geometry=mesh.geometry;
      const count=geometry.index?geometry.index.count:geometry.attributes.position.count;
      return sum+Math.floor(count/3);
    },0);
    let triangleCount=0,processedTriangles=0,occupiedCells=0;
    let lastYield=performance.now();
    const normalMatrix=new THREE.Matrix3();
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
    const na=new THREE.Vector3(),nb=new THREE.Vector3(),nc=new THREE.Vector3();
    const edge1=new THREE.Vector3(),edge2=new THREE.Vector3(),faceNormal=new THREE.Vector3();

    for(const mesh of meshes){
      mesh.updateWorldMatrix(true,false);
      const geometry=mesh.geometry;
      const positions=geometry.attributes.position;
      const normals=geometry.attributes.normal;
      const index=geometry.index;
      const elementCount=index?index.count:positions.count;
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      for(let offset=0;offset+2<elementCount;offset+=3){
        const ia=index?index.getX(offset):offset;
        const ib=index?index.getX(offset+1):offset+1;
        const ic=index?index.getX(offset+2):offset+2;
        a.fromBufferAttribute(positions,ia).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(positions,ib).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(positions,ic).applyMatrix4(mesh.matrixWorld);
        const den=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
        processedTriangles++;
        if(Math.abs(den)>=1e-10){
          let nax,nay,naz,nbx,nby,nbz,ncx,ncy,ncz;
          if(normals){
            na.fromBufferAttribute(normals,ia).applyMatrix3(normalMatrix).normalize();
            nb.fromBufferAttribute(normals,ib).applyMatrix3(normalMatrix).normalize();
            nc.fromBufferAttribute(normals,ic).applyMatrix3(normalMatrix).normalize();
            nax=na.x;nay=na.y;naz=na.z;
            nbx=nb.x;nby=nb.y;nbz=nb.z;
            ncx=nc.x;ncy=nc.y;ncz=nc.z;
          }else{
            edge1.subVectors(b,a);edge2.subVectors(c,a);
            faceNormal.crossVectors(edge1,edge2).normalize();
            nax=nbx=ncx=faceNormal.x;
            nay=nby=ncy=faceNormal.y;
            naz=nbz=ncz=faceNormal.z;
          }
          if(nay+nby+ncy<0){
            nax=-nax;nay=-nay;naz=-naz;
            nbx=-nbx;nby=-nby;nbz=-nbz;
            ncx=-ncx;ncy=-ncy;ncz=-ncz;
          }
          const triangle={
            ax:a.x,ay:a.y,az:a.z,
            bx:b.x,by:b.y,bz:b.z,
            cx:c.x,cy:c.y,cz:c.z,
            nay,nax,naz,nbx,nby,nbz,ncx,ncy,ncz,den
          };
          const ix0=Math.max(0,Math.floor((Math.min(a.x,b.x,c.x)-minX)/cellSizeX));
          const ix1=Math.min(cols-1,Math.floor((Math.max(a.x,b.x,c.x)-minX)/cellSizeX));
          const iz0=Math.max(0,Math.floor((Math.min(a.z,b.z,c.z)-minZ)/cellSizeZ));
          const iz1=Math.min(rows-1,Math.floor((Math.max(a.z,b.z,c.z)-minZ)/cellSizeZ));
          for(let iz=iz0;iz<=iz1;iz++)for(let ix=ix0;ix<=ix1;ix++){
            const key=iz*cols+ix;
            let bucket=cells[key];
            if(!bucket){bucket=[];cells[key]=bucket;occupiedCells++;}
            bucket.push(triangle);
            stats.cellReferences++;
            if(bucket.length>stats.maxBucketSize)stats.maxBucketSize=bucket.length;
          }
          triangleCount++;
        }
        if(performance.now()-lastYield>=7){
          onProgress({
            phase:'index',processed:processedTriangles,total:totalTriangles,
            progress:totalTriangles?processedTriangles/totalTriangles:1
          });
          await new Promise(resolve=>requestAnimationFrame(resolve));
          if(!isCurrent()){
            this.terrainLookup=null;
            return false;
          }
          lastYield=performance.now();
        }
      }
    }
    stats.buildMs=performance.now()-buildStarted;
    stats.triangleCount=triangleCount;
    stats.meshCount=meshes.length;
    stats.occupiedCells=occupiedCells;
    stats.averageTrianglesPerCell=occupiedCells?stats.cellReferences/occupiedCells:0;
    this.terrainLookup={
      cols,rows,minX,minZ,maxX,maxZ,cellSizeX,cellSizeZ,
      cells,triangleCount,meshCount:meshes.length,occupiedCells
    };
    onProgress({phase:'index',processed:totalTriangles,total:totalTriangles,progress:1});
    return triangleCount>0;
  }

  _groundFromLookup(x,z) {
    const grid=this.terrainLookup;
    if(!grid)return null;
    const maxX=grid.maxX??(grid.minX+grid.cellSizeX*grid.cols);
    const maxZ=grid.maxZ??(grid.minZ+grid.cellSizeZ*grid.rows);
    const edgeTolerance=1e-5;
    if(x<grid.minX-edgeTolerance||z<grid.minZ-edgeTolerance||x>maxX+edgeTolerance||z>maxZ+edgeTolerance)return null;
    const ix=THREE.MathUtils.clamp(Math.floor((x-grid.minX)/grid.cellSizeX),0,grid.cols-1);
    const iz=THREE.MathUtils.clamp(Math.floor((z-grid.minZ)/grid.cellSizeZ),0,grid.rows-1);
    const bucket=grid.cells[iz*grid.cols+ix];
    if(!bucket)return null;

    let best=null,bestY=-Infinity;
    for(const t of bucket){
      const wa=((t.bz-t.cz)*(x-t.cx)+(t.cx-t.bx)*(z-t.cz))/t.den;
      const wb=((t.cz-t.az)*(x-t.cx)+(t.ax-t.cx)*(z-t.cz))/t.den;
      const wc=1-wa-wb;
      if(wa < -1e-6||wb < -1e-6||wc < -1e-6)continue;
      const y=wa*t.ay+wb*t.by+wc*t.cy;
      if(y<=bestY)continue;
      const normal=new THREE.Vector3(
        wa*t.nax+wb*t.nbx+wc*t.ncx,
        wa*t.nay+wb*t.nby+wc*t.ncy,
        wa*t.naz+wb*t.nbz+wc*t.ncz
      );
      if(normal.lengthSq()<1e-10)normal.set(0,1,0);
      else normal.normalize();
      if(normal.y<0)normal.negate();
      bestY=y;
      best={point:new THREE.Vector3(x,y,z),normal};
    }
    return best;
  }

  _finishTerrainQuery(queryStarted) {
    const elapsed=performance.now()-queryStarted;
    const stats=this.terrainPerformance;
    stats.totalQueryMs+=elapsed;
    if(elapsed>stats.maxQueryMs)stats.maxQueryMs=elapsed;
  }

  getTerrainPerformanceDiagnostics() {
    const stats=this.terrainPerformance;
    const queryCount=stats.queryCount||0;
    return {
      ...stats,
      averageQueryMs:queryCount?stats.totalQueryMs/queryCount:0,
      lookupHitRate:queryCount?stats.lookupHits/queryCount:0,
      raycastFallbackRate:queryCount?stats.raycastFallbacks/queryCount:0
    };
  }

  _groundAt(x, z) {
    if (!this.terrain) return null;
    const queryStarted=performance.now();
    const stats=this.terrainPerformance;
    stats.queryCount++;
    const lookupHit=this._groundFromLookup(x,z);
    if(lookupHit){
      stats.lookupHits++;
      this._finishTerrainQuery(queryStarted);
      return lookupHit;
    }
    stats.lookupMisses++;
    stats.raycastFallbacks++;
    this.raycaster.set(
      new THREE.Vector3(x, this.bounds.max.y + 250, z),
      this.down
    );
    this.raycaster.near = 0;
    this.raycaster.far = Math.max(500, this.bounds.max.y - this.bounds.min.y + 600);
    const hits = this.raycaster.intersectObject(this.terrain, true);
    if (!hits.length) {
      stats.raycastMisses++;
      this._finishTerrainQuery(queryStarted);
      return null;
    }
    stats.raycastHits++;

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
    this._finishTerrainQuery(queryStarted);
    return { point: hit.point, normal };
  }

  _gravityAlongSurface(normal) {
    return this.gravity.clone().addScaledVector(normal, -this.gravity.dot(normal));
  }

  _findSpawn() {
    this.terrain.updateWorldMatrix(true,true);
    this.bounds.setFromObject(this.terrain);
    const center=this.bounds.getCenter(new THREE.Vector3());
    const meshes=[];
    this.terrain.traverse(object=>{
      if(object.isMesh&&object.geometry?.attributes?.position)meshes.push(object);
    });
    if(!meshes.length)return null;

    const totalVertices=meshes.reduce((total,mesh)=>total+mesh.geometry.attributes.position.count,0);
    if(!totalVertices)return null;
    const sampleStride=Math.max(1,Math.ceil(totalVertices/3500));
    const candidates=[];
    const vertex=new THREE.Vector3();
    for(const mesh of meshes){
      const attr=mesh.geometry.attributes.position;
      for(let i=0;i<attr.count;i+=sampleStride){
        vertex.fromBufferAttribute(attr,i).applyMatrix4(mesh.matrixWorld);
        candidates.push({x:vertex.x,y:vertex.y,z:vertex.z});
      }
    }
    // Search from the highest world-space vertices first. This works for a
    // collection of separate piste meshes and does not assume a fixed A1 layout.
    candidates.sort((a,b)=>b.y-a.y);

    const starts=[];
    const tested=new Set();
    let probes=0;
    const evaluateHit=hit=>{
      if(!hit?.point||!hit?.normal)return {hit:null,usable:false};
      const slope=THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(hit.normal.y,-1,1)));
      if(slope<4||slope>58)return {hit,slope,usable:false};
      const downhill=this._gravityAlongSurface(hit.normal);
      downhill.y=0;
      if(downhill.lengthSq()<1e-8)return {hit,slope,downhill,usable:false};
      downhill.normalize();
      const clearance=this._downhillClearance(hit.point.x,hit.point.z,hit.normal,[6,12,18,26]);
      if(clearance<12)return {hit,slope,downhill,clearance,usable:false};
      const candidate={hit,slope,clearance};
      starts.push(candidate);
      return {...candidate,downhill,usable:true};
    };
    const evaluatePosition=(x,z)=>{
      if(probes>=280)return null;
      const key=Math.round(x/1.5)+':'+Math.round(z/1.5);
      if(tested.has(key))return null;
      tested.add(key);
      probes++;
      return evaluateHit(this._groundAt(x,z));
    };

    const topSamples=candidates.slice(0,Math.min(180,candidates.length));
    let flatProbeBudget=6;
    for(const point of topSamples){
      const direct=evaluatePosition(point.x,point.z);
      if(direct?.usable||!direct?.hit)continue;

      // At an almost-flat summit, inspect a small ring around the crest to find
      // the nearest real fall line. Do not walk toward the mesh bounding-box
      // centre: parallel pistes often make that point unrelated to the slope.
      if(direct.slope!==undefined&&direct.slope<4&&flatProbeBudget>0){
        flatProbeBudget--;
        for(const radius of [2,4]){
          let found=false;
          for(let spoke=0;spoke<8;spoke++){
            const angle=spoke*Math.PI/4;
            const candidate=evaluatePosition(
              direct.hit.point.x+Math.cos(angle)*radius,
              direct.hit.point.z+Math.sin(angle)*radius
            );
            if(candidate?.usable)found=true;
          }
          if(found)break;
        }
        continue;
      }

      const downhill=direct.downhill||this._gravityAlongSurface(direct.hit.normal);
      downhill.y=0;
      if(downhill.lengthSq()<1e-8)continue;
      downhill.normalize();
      // If the highest vertex itself lies on an edge/over-steep patch, move a
      // few metres down its actual fall line and keep the start near the summit.
      for(const offset of [2,4,7]){
        const candidate=evaluatePosition(
          direct.hit.point.x+downhill.x*offset,
          direct.hit.point.z+downhill.z*offset
        );
        if(candidate?.usable)break;
      }
    }

    starts.sort((a,b)=>
      b.hit.point.y-a.hit.point.y ||
      b.clearance-a.clearance
    );
    if(starts.length)return this._setSpawn(starts[0].hit,center);

    // Bounded fallback grid for irregular / heavily triangulated piste meshes.
    let best=null,bestScore=-Infinity;
    for(let ix=1;ix<12;ix++)for(let iz=1;iz<12;iz++){
      const x=THREE.MathUtils.lerp(this.bounds.min.x,this.bounds.max.x,ix/12);
      const z=THREE.MathUtils.lerp(this.bounds.min.z,this.bounds.max.z,iz/12);
      const hit=this._groundAt(x,z);
      if(!hit||!this._isUsableSkiStart(hit,6))continue;
      const slope=THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(hit.normal.y,-1,1)));
      const clearance=this._downhillClearance(hit.point.x,hit.point.z,hit.normal,[6,12,18,26]);
      const score=hit.point.y+clearance*0.10-Math.abs(slope-16)*0.04;
      if(score>bestScore){bestScore=score;best=hit;}
    }
    if(best)return this._setSpawn(best,center);

    // Last-resort adaptive scan: preserve a valid start on unusual meshes even
    // when the top-first surface search could not find a long clear run.
    const fallbackCandidates=[];
    const fallbackDivisions=12;
    for(let ix=1;ix<fallbackDivisions;ix++){
      const x=THREE.MathUtils.lerp(this.bounds.min.x,this.bounds.max.x,ix/fallbackDivisions);
      for(let iz=1;iz<fallbackDivisions;iz++){
        const z=THREE.MathUtils.lerp(this.bounds.min.z,this.bounds.max.z,iz/fallbackDivisions);
        const hit=this._groundAt(x,z);
        if(!hit)continue;
        const slope=THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(hit.normal.y,-1,1)));
        if(slope<0||slope>85)continue;
        const angleQuality=18-Math.abs(slope-18)*0.38;
        const elevationQuality=(hit.point.y-center.y)*0.004;
        fallbackCandidates.push({hit,slope,baseScore:angleQuality+elevationQuality});
      }
    }
    fallbackCandidates.sort((a,b)=>b.baseScore-a.baseScore);
    let fallback=null,fallbackScore=-Infinity;
    for(const candidate of fallbackCandidates.slice(0,16)){
      const clearance=this._downhillClearance(
        candidate.hit.point.x,candidate.hit.point.z,candidate.hit.normal,[6,12,18,24]
      );
      const score=candidate.baseScore+clearance*0.9;
      if(score>fallbackScore){fallbackScore=score;fallback=candidate;}
    }
    if(!fallback&&fallbackCandidates.length)fallback=fallbackCandidates[0];
    return fallback?this._setSpawn(fallback.hit,center):null;
  }

  _setSpawn(hit, center) {
    this.viewBlend=0;
    this.viewBlendTarget=0;
    this.viewMode='first-person';
    this.thirdPersonCameraInitialized=false;
    this.stanceCameraBlend=0;
    this.skiSteerAngle=0;
    this.avatarPushPulse=0;
    this.avatarPose=Object.create(null);
    if(this.avatarPelvis)this.avatarPelvis.position.y=this.avatarPelvisBaseY;
    if(this.avatarTorso)this.avatarTorso.position.y=this.avatarTorsoBaseY;
    this.position.copy(hit.point);
    this.lastGroundNormal.copy(hit.normal);
    this.lastSpawnInfo={
      terrainName:this.terrain?.name||this.terrain?.type||'terrain',
      position:hit.point.toArray().map(value=>Number(value.toFixed(2))),
      slopeDeg:Number(THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(hit.normal.y,-1,1))).toFixed(2))
    };
    this.slopeDeg=THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(hit.normal.y,-1,1)));
    const downhill=this._gravityAlongSurface(hit.normal);
    if(downhill.lengthSq()<1e-8) downhill.set(center.x-hit.point.x,0,center.z-hit.point.z);
    this.headingYaw=Math.atan2(-downhill.x,-downhill.z);
    this.velocity.set(0,0,0);
    this.lookYaw=0;
    this.lookPitch=-0.035;
    this.airborneCameraPitch=0;
    this.lastLongitudinalAccel=0;
    this.airborneHeight=0;
    this.airborneVelocityY=0;
    this.jumpCooldown=0;
    this._syncCamera(0);
    this._updateSkiRig();
    return hit;
  }

  _syncCamera(steer=0,dt=1/60) {
    const tuck=this.keys.has('w')||this.keys.has('arrowup');
    const stanceTarget=tuck?1:0;
    this.stanceCameraBlend+=(stanceTarget-this.stanceCameraBlend)*(1-Math.exp(-dt*7.5));
    if(Math.abs(stanceTarget-this.stanceCameraBlend)<0.001)this.stanceCameraBlend=stanceTarget;

    // Keep the first-person eye point vertical in world space.
    const horizontalSpeed=Math.hypot(this.velocity.x,this.velocity.z);
    const verticalTravelVelocity=this.airborneWorldY!==null?this.airborneVelocityY:this.velocity.y;
    const totalTravelSpeed=Math.hypot(horizontalSpeed,verticalTravelVelocity);
    if(totalTravelSpeed>0.15 && horizontalSpeed>0.03) {
      this.headingYaw=Math.atan2(-this.velocity.x,-this.velocity.z);
    }
    // Keep first-person gaze stable through take-off and landing. A tiny,
    // damped flight cue preserves a sense of lift without pitching the horizon
    // directly with the rapidly changing vertical velocity.
    const flightPitchTarget=this.airborneWorldY!==null
      ?THREE.MathUtils.clamp(
        Math.atan2(verticalTravelVelocity,Math.max(horizontalSpeed,2.5))*0.08,
        -0.035,0.035
      )
      :0;
    this.airborneCameraPitch+=(flightPitchTarget-this.airborneCameraPitch)*(1-Math.exp(-dt*5.5));
    this.cameraEuler.set(
      THREE.MathUtils.clamp(this.airborneCameraPitch+this.lookPitch-0.085*this.stanceCameraBlend,-0.85,0.55),
      this.headingYaw+this.lookYaw,
      -THREE.MathUtils.clamp(this.skiSteerAngle/0.46,-1,1)*0.055,
      'YXZ'
    );
    this.firstPersonPosition.set(
      this.position.x,
      this.position.y+this.eyeHeight+this.airborneHeight-0.26*this.stanceCameraBlend,
      this.position.z
    );
    this.firstPersonQuaternion.setFromEuler(this.cameraEuler);

    // Orbit behind the skier, looking at the upper body. Mouse movement rotates
    // the orbit while the skier's physical heading continues to follow velocity.
    const viewYaw=this.headingYaw+this.lookYaw;
    const elevation=THREE.MathUtils.clamp(0.28-this.lookPitch,0.08,0.78);
    const distance=6.45-0.48*this.stanceCameraBlend;
    const horizontal=distance*Math.cos(elevation);
    this.thirdPersonLookTarget.set(
      this.position.x,
      this.position.y+this.airborneHeight+1.18-0.16*this.stanceCameraBlend,
      this.position.z
    );
    this.thirdPersonDesiredPosition.set(
      this.thirdPersonLookTarget.x+Math.sin(viewYaw)*horizontal,
      this.thirdPersonLookTarget.y+distance*Math.sin(elevation),
      this.thirdPersonLookTarget.z+Math.cos(viewYaw)*horizontal
    );
    const needsThirdPerson=this.viewBlendTarget>0.001||this.viewBlend>0.001;
    if(needsThirdPerson){
      const cameraGround=this._groundAt(this.thirdPersonDesiredPosition.x,this.thirdPersonDesiredPosition.z);
      if(cameraGround){
        this.thirdPersonDesiredPosition.y=Math.max(
          this.thirdPersonDesiredPosition.y,
          cameraGround.point.y+1.35
        );
      }
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
    this.camera.updateMatrixWorld(true);
    if(this.viewBlend<=0.001&&this.viewBlendTarget<=0.001){
      this.thirdPersonCameraInitialized=false;
    }
  }

  _downhillClearance(x,z,normal,distances=[6,12,18,26]) {
    const downhill=this._gravityAlongSurface(normal);
    downhill.y=0;
    if(downhill.lengthSq()<1e-8)return 0;
    downhill.normalize();
    let clearance=0;
    for(const distance of distances){
      if(!this._groundAt(x+downhill.x*distance,z+downhill.z*distance))break;
      clearance=distance;
    }
    return clearance;
  }

  _isUsableSkiStart(hit,minClearance=8) {
    if(!hit?.point||!hit?.normal)return false;
    const slope=THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(hit.normal.y,-1,1)));
    if(slope<4||slope>55)return false;
    return this._downhillClearance(hit.point.x,hit.point.z,hit.normal)>=(minClearance-1e-4);
  }

  _findGroundNear(x,z) {
    if(!this.terrain)return null;
    this.terrain.updateWorldMatrix(true,true);
    this.bounds.setFromObject(this.terrain);
    if(this.bounds.isEmpty())return null;

    const insideBounds=x>=this.bounds.min.x&&x<=this.bounds.max.x&&
      z>=this.bounds.min.z&&z<=this.bounds.max.z;
    const direct=insideBounds?this._groundAt(x,z):null;
    if(direct&&this._isUsableSkiStart(direct,12))return direct;

    // Keep the drone's actual world location as the search origin. Never clamp
    // an off-piste drone back to a distant mesh edge: let start() use its
    // validated summit fallback when no run is close enough.
    const radii=[3,6,10,15,22,30,40,50];
    const spokes=16;
    for(const radius of radii){
      let best=null,bestScore=Infinity;
      for(let i=0;i<spokes;i++){
        const angle=(i/spokes)*Math.PI*2;
        const px=x+Math.cos(angle)*radius;
        const pz=z+Math.sin(angle)*radius;
        if(px<this.bounds.min.x+0.75||px>this.bounds.max.x-0.75||
           pz<this.bounds.min.z+0.75||pz>this.bounds.max.z-0.75)continue;
        const hit=this._groundAt(px,pz);
        if(!hit)continue;
        const slope=THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(hit.normal.y,-1,1)));
        if(slope<4||slope>55)continue;
        const clearance=this._downhillClearance(hit.point.x,hit.point.z,hit.normal,[6,12,18,26]);
        if(clearance<12)continue;
        const score=radius+Math.abs(slope-16)*0.18-Math.min(clearance,26)*0.12;
        if(score<bestScore){bestScore=score;best=hit;}
      }
      if(best)return best;
    }
    return direct;
  }

  async start(terrain,spawnHint=null,{deferInput=false,onProgress=()=>{},isCurrent=()=>true,requestPointerLock=true}={}) {
    const startupStarted=performance.now();
    const buildToken=++this.terrainBuildToken;
    this.active=false;
    this.inputEnabled=false;
    if(!terrain||typeof terrain.traverse!=='function'){
      this.lastStartError='INVALID_TERRAIN';
      this.lastStartDiagnostics={receivedTerrain:!!terrain,hasTraverse:typeof terrain?.traverse==='function'};
      return false;
    }
    this.terrain=terrain;
    this.lastStartError=null;
    this.lastStartDiagnostics=null;
    this.lastSpawnInfo=null;
    this.terrain.updateWorldMatrix(true,true);
    this.bounds.setFromObject(this.terrain);
    if(this.bounds.isEmpty()){
      this.terrain=null;this.lastStartError='EMPTY_TERRAIN';
      this.lastStartDiagnostics={terrainType:terrain.type||'unknown'};
      return false;
    }
    const lookupReady=await this._buildTerrainLookup(
      progress=>onProgress(progress),
      ()=>buildToken===this.terrainBuildToken&&isCurrent()
    );
    if(buildToken!==this.terrainBuildToken||!isCurrent())return false;
    onProgress({phase:'spawn',progress:0});
    const spawnStarted=performance.now();
    let spawnFound=false;
    if(spawnHint?.position&&!spawnHint.startAtTop){
      // Drone handoff keeps its validated nearby search; authored Scene Editor
      // positions are exact world-space points and must not be silently moved.
      const hit=spawnHint.fromDrone
        ?this._findGroundNear(spawnHint.position.x,spawnHint.position.z)
        :this._groundAt(spawnHint.position.x,spawnHint.position.z);
      const minClearance=spawnHint.fromDrone?12:6;
      if(hit&&this._isUsableSkiStart(hit,minClearance)){
        const center=this.bounds.getCenter(new THREE.Vector3());
        this._setSpawn(hit,center);
        if(Number.isFinite(spawnHint.headingYaw)){
          this.headingYaw=spawnHint.headingYaw;
          this._syncCamera(0);
          this._updateSkiRig();
        }
        if(!spawnHint.fromDrone){
          this.lastSpawnInfo={...this.lastSpawnInfo,spawnType:'scene-editor',slot:String(spawnHint.slot||'')};
        }
        spawnFound=true;
      }
    }
    // If the drone is over a gap, flat apron or unusable patch, start from a
    // validated run on the active piste instead of leaving skier mode inert.
    if(!spawnFound)spawnFound=!!this._findSpawn();
    this.terrainPerformance.spawnSearchMs=performance.now()-spawnStarted;
    if(buildToken!==this.terrainBuildToken||!isCurrent())return false;
    onProgress({phase:'spawn',progress:1});
    if(!spawnFound){
      this.lastStartError='NO_USABLE_SLOPE';
      this.lastStartDiagnostics={
        bounds:{min:this.bounds.min.toArray(),max:this.bounds.max.toArray()},
        lookupReady:!!lookupReady,
        meshCount:this.terrainLookup?.meshCount||0,
        triangleCount:this.terrainLookup?.triangleCount||0,
        occupiedCells:this.terrainLookup?.occupiedCells||0
      };
      return false;
    }

    if(spawnHint?.fromDrone){
      const downhill=this._gravityAlongSurface(this.lastGroundNormal);
      downhill.y=0;
      if(downhill.lengthSq()>1e-8){
        downhill.normalize();
        this.headingYaw=Math.atan2(-downhill.x,-downhill.z);
        const droneVelocity=spawnHint.velocity?.clone?.()||new THREE.Vector3();
        droneVelocity.projectOnPlane(this.lastGroundNormal);
        const downhillCarry=Math.max(0,droneVelocity.dot(downhill));
        const initialSpeed=THREE.MathUtils.clamp(1.25+downhillCarry*0.35,1.25,6);
        this.velocity.copy(downhill).multiplyScalar(initialSpeed);
      }
      // Keep the skier moving with the downhill component of the drone's
      // velocity, but do not inherit the drone camera's viewing direction.
      // First-person view starts aligned with the skier's physical ski heading.
      this.lookYaw=0;
      this.lookPitch=-0.035;
    }

    this.active=true;
    this.inputEnabled=!deferInput;
    this.airborneWorldY=null;this.airborneHeight=0;this.airborneVelocityY=0;
    this.keys.clear();
    this.pushCooldown=0;
    this.avatarPushPulse=0;
    this.skiSteerAngle=0;
    if(this.skiRig)this.skiRig.visible=true;
    this._syncCamera(0);
    this._updateSkiRig();
    this._updateSkierAvatar();
    this.domElement.style.cursor=this.touchMode?'':'crosshair';
    this.lastPointerLockError=null;
    if(requestPointerLock&&!this.touchMode){
      try{
        const result=this.domElement.requestPointerLock?.();
        if(result&&typeof result.catch==='function'){
          result.catch(error=>{
            this.lastPointerLockError=error?.message||String(error);
            this.onPointerLock(false);
          });
        }
      }catch(error){
        this.lastPointerLockError=error?.message||String(error);
        this.onPointerLock(false);
      }
    }else{
      this.onPointerLock(false);
    }
    this.terrainPerformance.startupMs=performance.now()-startupStarted;
    this.onHud({
      speed:this.velocity.length(),slope:this.slopeDeg,grounded:true,
      acceleration:this.lastLongitudinalAccel,snowMu:this.snowMu,tuck:false,
      cameraView:this.viewBlendTarget>0.5?'third':'first',massKg:this.massKg
    });
    return true;
  }

  respawnAtCustomSpawn(spawn){
    if(!this.active||!this.terrain||!this.terrainLookup||!spawn)return false;
    const rawPosition=spawn.position;
    const x=Number(Array.isArray(rawPosition)?rawPosition[0]:rawPosition?.x);
    const z=Number(Array.isArray(rawPosition)?rawPosition[2]:rawPosition?.z);
    const headingYaw=Number(spawn.headingYaw);
    if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(headingYaw))return false;
    const hit=this._groundAt(x,z);
    if(!hit||!this._isUsableSkiStart(hit,6))return false;
    const center=this.bounds.getCenter(new THREE.Vector3());
    this.airborneWorldY=null;
    this.airborneHeight=0;
    this.airborneVelocityY=0;
    this.keys.clear();
    this.pushCooldown=0;
    this.avatarPushPulse=0;
    this.skiSteerAngle=0;
    this.jumpCooldown=0;
    this.jumpTakeoffPulse=0;
    this.landingPulse=0;
    this.normalForceN=0;
    this.lateralForceN=0;
    this.totalSkiLoadN=0;
    this.outsideSkiLoadN=0;
    this.insideSkiLoadN=0;
    this.outsideLoadShare=0.5;
    this.lateralAcceleration=0;
    this.active=true;
    this.inputEnabled=true;
    if(this.skiRig)this.skiRig.visible=true;
    if(this.skierAvatar)this.skierAvatar.visible=true;
    this._setSpawn(hit,center);
    this.headingYaw=headingYaw;
    this._syncCamera(0);
    this._updateSkiRig();
    this.lastSpawnInfo={...this.lastSpawnInfo,spawnType:'scene-editor',slot:String(spawn.slot||'')};
    this._updateSkierAvatar();
    this.onHud({
      speed:0,slope:this.slopeDeg,grounded:true,
      acceleration:0,snowMu:this.snowMu,tuck:false,
      cameraView:this.viewBlendTarget>0.5?'third':'first',massKg:this.massKg
    });
    this.lastStartError=null;
    this.lastStartDiagnostics=null;
    return true;
  }

  respawnAtTop(){
    if(!this.active||!this.terrain||!this.terrainLookup)return false;
    this.terrain.updateWorldMatrix(true,true);
    this.bounds.setFromObject(this.terrain);
    if(this.bounds.isEmpty())return false;
    const center=this.bounds.getCenter(new THREE.Vector3());
    const hit=this._findSpawn();
    if(!hit){
      this.lastStartError='NO_USABLE_SLOPE';
      return false;
    }
    this.airborneWorldY=null;
    this.airborneHeight=0;
    this.airborneVelocityY=0;
    this.keys.clear();
    this.pushCooldown=0;
    this.avatarPushPulse=0;
    this.skiSteerAngle=0;
    this.jumpCooldown=0;
    this.jumpTakeoffPulse=0;
    this.landingPulse=0;
    this.normalForceN=0;
    this.lateralForceN=0;
    this.totalSkiLoadN=0;
    this.outsideSkiLoadN=0;
    this.insideSkiLoadN=0;
    this.outsideLoadShare=0.5;
    this.lateralAcceleration=0;
    this.active=true;
    this.inputEnabled=true;
    if(this.skiRig)this.skiRig.visible=true;
    if(this.skierAvatar)this.skierAvatar.visible=true;
    this._setSpawn(hit,center);
    this.lastSpawnInfo={...this.lastSpawnInfo,spawnType:'stage1-summit'};
    this._updateSkierAvatar();
    this.onHud({
      speed:0,slope:this.slopeDeg,grounded:true,
      acceleration:0,snowMu:this.snowMu,tuck:false,
      cameraView:this.viewBlendTarget>0.5?'third':'first',massKg:this.massKg
    });
    this.lastStartError=null;
    this.lastStartDiagnostics=null;
    return true;
  }

  enableInput(){
    this.inputEnabled=true;
    this.keys.clear();
  }

  stop({keepSceneModel=false}={}) {
    this.terrainBuildToken++;
    this.active=false;
    this.inputEnabled=false;
    this.keys.clear();
    this.pushCooldown=0;
    this.avatarPushPulse=0;
    this.skiSteerAngle=0;
    this.airborneCameraPitch=0;
    this.airborneHeight=0;
    this.airborneVelocityY=0;
    this.airborneWorldY=null;
    this.jumpTakeoffPulse=0;
    this.landingPulse=0;
    this.normalForceN=0;
    this.lateralForceN=0;
    this.totalSkiLoadN=0;
    this.outsideSkiLoadN=0;
    this.insideSkiLoadN=0;
    this.outsideLoadShare=0.5;
    this.lateralAcceleration=0;
    if(this.skiRig)this.skiRig.visible=keepSceneModel;
    if(this.skierAvatar)this.skierAvatar.visible=keepSceneModel;
    if(!keepSceneModel)for(const material of this.avatarFadeMaterials||[])material.opacity=0;
    this.domElement.style.cursor='';
    if(document.pointerLockElement===this.domElement) document.exitPointerLock?.();
    this.terrain=null;
  }

  _tryManualJump() {
    if(!this.active||!this.inputEnabled||!this.terrain)return false;
    if(this.airborneWorldY!==null||this.airborneHeight>0.02||this.jumpCooldown>0)return false;
    // Take-off impulse acts on the skier + equipment mass. Flight is tracked in world height.
    const contact=this._groundAt(this.position.x,this.position.z);
    if(!contact)return false;
    this.position.copy(contact.point);
    this.lastGroundNormal.copy(contact.normal);
    this.airborneWorldY=contact.point.y+0.055;
    this.airborneHeight=0;
    this.airborneVelocityY=this.velocity.y+this.manualJumpImpulseNs/this.massKg;
    this.velocity.y=0;
    this.jumpCooldown=0.68;
    this.jumpTakeoffPulse=1;
    this.avatarPushPulse=Math.max(this.avatarPushPulse,0.35);
    return true;
  }

  _tryBumpJump(speed) {
    if(this.airborneWorldY!==null||this.airborneHeight>0.01||this.airborneVelocityY>0.01||this.jumpCooldown>0)return false;
    if(speed<14.5||this.lastLongitudinalAccel<2.8)return false;
    const direction=new THREE.Vector3(this.velocity.x,0,this.velocity.z);
    if(direction.lengthSq()<1e-6)return false;
    direction.normalize();
    const near=this._groundAt(this.position.x+direction.x*2.1,this.position.z+direction.z*2.1);
    const far=this._groundAt(this.position.x+direction.x*4.7,this.position.z+direction.z*4.7);
    if(!near||!far)return false;

    const rise=near.point.y-this.position.y;
    const drop=near.point.y-far.point.y;
    const crestHeight=near.point.y-(this.position.y+far.point.y)*0.5;
    if(rise<0.12||drop<0.10||crestHeight<0.26)return false;

    this.airborneWorldY=this.position.y+0.055;
    this.airborneHeight=0;
    this.airborneVelocityY=this.velocity.y+this.bumpJumpImpulseNs/this.massKg;
    this.velocity.y=0;
    this.jumpCooldown=1.2;
    return true;
  }


  update(dt) {
    if(!this.active || !this.inputEnabled || !this.terrain) return;
    dt=THREE.MathUtils.clamp(dt,0,0.04);

    const currentHit=this._groundAt(this.position.x,this.position.z);
    if(!currentHit) {
      this.velocity.set(0,0,0);
      this.normalForceN=0;this.lateralForceN=0;this.totalSkiLoadN=0;
      this.outsideSkiLoadN=0;this.insideSkiLoadN=0;
      this.onHud({speed:0,slope:this.slopeDeg,grounded:false,acceleration:0,snowMu:this.snowMu,tuck:false,massKg:this.massKg});
      return;
    }

    this.position.copy(currentHit.point);
    this.lastGroundNormal.copy(currentHit.normal);
    const normal=this.lastGroundNormal;
    const airborneAtStart=this.airborneWorldY!==null;
    if(!airborneAtStart)this.velocity.addScaledVector(normal,-this.velocity.dot(normal));

    const left=this.keys.has('a')||this.keys.has('arrowleft');
    const right=this.keys.has('d')||this.keys.has('arrowright');
    const tuck=this.keys.has('w')||this.keys.has('arrowup');
    const brake=this.keys.has('s')||this.keys.has('arrowdown');
    const push=this.keys.has('shift');
    const steer=(right?1:0)-(left?1:0);
    this.skiSteerAngle+=(steer*0.46-this.skiSteerAngle)*(1-Math.exp(-dt*13));

    const gravityTangent=this._gravityAlongSurface(normal);
    const normalAcceleration=Math.max(0.05,-this.gravity.dot(normal));
    const normalForceN=airborneAtStart?0:this.massKg*normalAcceleration;
    const speedBefore=this.velocity.length();
    const cda=tuck?this.cdaTuck:this.cdaUpright;
    let acceleration=new THREE.Vector3(0,0,0);
    let lateralAcceleration=0;

    if(airborneAtStart) {
      // Flight uses true 3D velocity; slope-tangent vertical speed is folded in at take-off.
      const flightVelocity=new THREE.Vector3(this.velocity.x,this.airborneVelocityY,this.velocity.z);
      const airRelative=flightVelocity.clone().sub(this.windVelocity);
      const relativeAirSpeed=airRelative.length();
      const dragCoefficient=0.5*this.airDensity*cda/this.massKg;
      acceleration.copy(airRelative).multiplyScalar(-dragCoefficient*relativeAirSpeed);
      const flightSpeed=flightVelocity.length();
      if(flightSpeed>0.06)this.lastLongitudinalAccel=acceleration.dot(flightVelocity.divideScalar(flightSpeed));
      else this.lastLongitudinalAccel=0;
      this.velocity.x+=acceleration.x*dt;
      this.velocity.z+=acceleration.z*dt;
      this.airborneVelocityY+=acceleration.y*dt;
      this.normalForceN=0;this.lateralForceN=0;this.totalSkiLoadN=0;
      this.outsideSkiLoadN=0;this.insideSkiLoadN=0;
      this.outsideLoadShare=0.5;this.lateralAcceleration=0;
    } else {
      const muEffective=this.snowMu+(brake?this.brakeMu:0)+(Math.abs(steer)>0?this.turnScrubMu*Math.abs(steer):0);
      if(speedBefore>0.06) {
        const travelDirection=this.velocity.clone().divideScalar(speedBefore);
        const airRelative=this.velocity.clone().sub(this.windVelocity);
        const relativeAirSpeed=airRelative.length();
        const dragCoefficient=0.5*this.airDensity*cda/this.massKg;
        const snowFrictionForceN=muEffective*normalForceN;
        acceleration.copy(gravityTangent)
          .addScaledVector(airRelative,-dragCoefficient*relativeAirSpeed)
          .addScaledVector(travelDirection,-snowFrictionForceN/this.massKg);
        const longitudinalAcceleration=acceleration.dot(travelDirection);
        this.lastLongitudinalAccel=longitudinalAcceleration;
        if(longitudinalAcceleration<0&&speedBefore+longitudinalAcceleration*dt<=0)this.velocity.set(0,0,0);
        else this.velocity.addScaledVector(acceleration,dt);
      } else {
        const gravityAlong=gravityTangent.length();
        const staticResistanceN=(this.staticMu+(brake?this.brakeMu:0))*normalForceN;
        if(this.massKg*gravityAlong<=staticResistanceN) {
          this.velocity.set(0,0,0);this.lastLongitudinalAccel=0;
        } else {
          const downhillDirection=gravityTangent.clone().normalize();
          acceleration.copy(gravityTangent).addScaledVector(downhillDirection,-muEffective*normalForceN/this.massKg);
          this.velocity.addScaledVector(acceleration,dt);
          this.lastLongitudinalAccel=acceleration.length();
        }
      }

      // Poles are impulses in N·s, so acceleration response scales with mass.
      this.pushCooldown=Math.max(0,this.pushCooldown-dt);
      if(push&&this.pushCooldown<=0) {
        const yaw=this.headingYaw;
        const pushDirection=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)).projectOnPlane(normal);
        if(pushDirection.lengthSq()>1e-5) {
          pushDirection.normalize();
          const pushDeltaV=this.pushImpulseNs/this.massKg;
          this.velocity.addScaledVector(pushDirection,pushDeltaV);
          this.lastLongitudinalAccel=pushDeltaV/this.pushInterval;
          this.pushCooldown=this.pushInterval;
          this.avatarPushPulse=1;
        }
      }

      this.velocity.projectOnPlane(normal);
      const speedBeforeTurn=this.velocity.length();
      let maxLateralForceN=0;
      if(steer!==0&&speedBeforeTurn>0.20) {
        maxLateralForceN=this.maxEdgeG*normalForceN;
        const maxLateralAcceleration=maxLateralForceN/this.massKg;
        const turnRate=Math.min(this.maxTurnRate,maxLateralAcceleration/speedBeforeTurn)*steer;
        lateralAcceleration=speedBeforeTurn*Math.abs(turnRate);
        const speedToPreserve=speedBeforeTurn;
        this.velocity.applyAxisAngle(normal,-turnRate*dt);
        const afterTurnSpeed=this.velocity.length();
        if(afterTurnSpeed>1e-9)this.velocity.multiplyScalar(speedToPreserve/afterTurnSpeed);
      }

      // Ground reaction combines support normal force and lateral edge reaction.
      this.normalForceN=normalForceN;
      this.lateralForceN=this.massKg*lateralAcceleration;
      this.totalSkiLoadN=Math.hypot(this.normalForceN,this.lateralForceN);
      const edgeDemand=maxLateralForceN>0?THREE.MathUtils.clamp(this.lateralForceN/maxLateralForceN,0,1):0;
      this.outsideLoadShare=steer!==0?0.5+0.1*edgeDemand:0.5;
      this.outsideSkiLoadN=this.totalSkiLoadN*this.outsideLoadShare;
      this.insideSkiLoadN=this.totalSkiLoadN-this.outsideSkiLoadN;
      this.lateralAcceleration=lateralAcceleration;
    }

    this.jumpCooldown=Math.max(0,this.jumpCooldown-dt);
    if(!airborneAtStart)this._tryBumpJump(this.velocity.length());

    const inFlight=this.airborneWorldY!==null;
    const currentSpeed=inFlight?Math.hypot(this.velocity.x,this.velocity.z,this.airborneVelocityY):this.velocity.length();
    if(currentSpeed>this.maxSafeSpeed) {
      const speedScale=this.maxSafeSpeed/currentSpeed;
      this.velocity.x*=speedScale;this.velocity.z*=speedScale;
      if(inFlight)this.airborneVelocityY*=speedScale;
      else this.velocity.y*=speedScale;
    }
    if(inFlight) {
      this.airborneVelocityY-=9.81*dt;
      this.airborneWorldY+=this.airborneVelocityY*dt;
    }

    const nextX=this.position.x+this.velocity.x*dt;
    const nextZ=this.position.z+this.velocity.z*dt;
    const nextHit=this._groundAt(nextX,nextZ);
    if(nextHit) {
      this.position.copy(nextHit.point);
      this.lastGroundNormal.copy(nextHit.normal);
      const nextNormal=this.lastGroundNormal;
      if(inFlight) {
        const clearance=this.airborneWorldY-nextHit.point.y-0.055;
        if(clearance<=0&&this.airborneVelocityY<=0) {
          const impactSpeed=Math.abs(this.airborneVelocityY);
          this.airborneWorldY=null;
          this.airborneHeight=0;
          this.airborneVelocityY=0;
          this.landingPulse=THREE.MathUtils.clamp(impactSpeed/3.5,0,1);
          this.velocity.addScaledVector(nextNormal,-this.velocity.dot(nextNormal));
        } else this.airborneHeight=Math.max(0,clearance);
      } else {
        this.airborneHeight=0;this.airborneVelocityY=0;
        this.velocity.addScaledVector(nextNormal,-this.velocity.dot(nextNormal));
      }
      this.slopeDeg=THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(nextNormal.y,-1,1)));
    } else {
      this.velocity.multiplyScalar(0.015);
      this.normalForceN=0;this.lateralForceN=0;this.totalSkiLoadN=0;
      this.outsideSkiLoadN=0;this.insideSkiLoadN=0;
    }

    const airborne=this.airborneWorldY!==null;
    const grounded=!!nextHit&&!airborne;
    this._syncCamera(steer,dt);
    this._updateSkiRig();
    this._updateSkierAvatar(false,dt,{
      steer:this.skiSteerAngle/0.46,tuck,brake,airborne,
      lateralG:normalAcceleration>0?this.lateralAcceleration/normalAcceleration:0,
      outsideLoadShare:this.outsideLoadShare
    });
    const hudSpeed=airborne?Math.hypot(this.velocity.x,this.velocity.z,this.airborneVelocityY):this.velocity.length();
    this.onHud({
      speed:hudSpeed,slope:this.slopeDeg,grounded,acceleration:this.lastLongitudinalAccel,
      snowMu:this.snowMu,pushing:push&&!airborne,airborne,tuck,massKg:this.massKg,
      normalForceN:this.normalForceN,lateralForceN:this.lateralForceN,totalSkiLoadN:this.totalSkiLoadN,
      outsideSkiLoadN:this.outsideSkiLoadN,insideSkiLoadN:this.insideSkiLoadN,
      outsideLoadShare:this.outsideLoadShare,lateralAcceleration:this.lateralAcceleration,
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
