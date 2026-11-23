import * as THREE from 'three';

export class DroneController {
  constructor({camera,domElement,terrainProvider=()=>null,onPointerLock=()=>{},onHud=()=>{}}){
    this.camera=camera;
    this.domElement=domElement;
    this.onPointerLock=onPointerLock;
    this.onHud=onHud;
    this.terrainProvider=terrainProvider;
    this.terrain=null;
    this.terrainBounds=new THREE.Box3();
    this.raycaster=new THREE.Raycaster();
    this.rayOrigin=new THREE.Vector3();
    this.groundDown=new THREE.Vector3(0,-1,0);
    this.minimumTerrainClearance=2.5;
    this.terrainBoundsMargin=100;
    this.active=false;
    this.inputEnabled=true;
    this.keys=new Set();
    this.velocity=new THREE.Vector3();
    this.yaw=0;
    this.pitch=0;
    this.speed=17;
    this.boostSpeed=120/3.6;
    this.lookSensitivityX=0.00105;
    this.lookSensitivityY=0.00085;
    this.lookEase=15;
    this.accelerationEase=3.4;

    // Use physical key positions so W/S also work with a Russian keyboard layout.
    this.key=e=>{
      const byCode={
        KeyW:'w',KeyA:'a',KeyS:'s',KeyD:'d',
        ArrowUp:'arrowup',ArrowDown:'arrowdown',
        ArrowLeft:'arrowleft',ArrowRight:'arrowright',
        Space:' ',ShiftLeft:'shift',ShiftRight:'shift',
        ControlLeft:'control',ControlRight:'control'
      };
      return byCode[e.code]||(e.key||'').toLowerCase();
    };
    this.down=e=>{
      if(!this.active||!this.inputEnabled)return;
      const k=this.key(e);
      if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' ','shift','control'].includes(k)){
        e.preventDefault();
        this.keys.add(k);
      }
    };
    this.up=e=>this.keys.delete(this.key(e));
    this.blur=()=>this.keys.clear();
    this.mouse=e=>{
      if(!this.active||!this.inputEnabled||document.pointerLockElement!==this.domElement)return;
      this.yaw-=e.movementX*this.lookSensitivityX;
      this.pitch=THREE.MathUtils.clamp(this.pitch-e.movementY*this.lookSensitivityY,-1.25,1.25);
      this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');
    };
    this.lock=()=>this.onPointerLock(document.pointerLockElement===this.domElement);
    this.click=()=>{
      if(this.active&&document.pointerLockElement!==this.domElement){
        const r=this.domElement.requestPointerLock?.();
        if(r&&typeof r.catch==='function')r.catch(()=>{});
      }
    };

    window.addEventListener('keydown',this.down,{passive:false,capture:true});
    window.addEventListener('keyup',this.up,true);
    window.addEventListener('blur',this.blur);
    document.addEventListener('mousemove',this.mouse);
    document.addEventListener('pointerlockchange',this.lock);
    this.domElement.addEventListener('click',this.click);
  }

  setTerrain(terrain){
    if(this.terrain===terrain)return;
    this.terrain=terrain||null;
    this.terrainBounds.makeEmpty();
    if(this.terrain){
      this.terrain.updateMatrixWorld(true);
      this.terrainBounds.setFromObject(this.terrain);
    }
  }

  refreshTerrain(){
    let terrain=null;
    try{terrain=this.terrainProvider?.()||null;}catch(e){}
    this.setTerrain(terrain);
  }

  getTerrainHeight(x,z){
    if(!this.terrain||this.terrainBounds.isEmpty())return null;
    const size=this.terrainBounds.getSize(new THREE.Vector3());
    const originY=Math.max(this.terrainBounds.max.y+Math.max(10,size.y*0.02),this.camera.position.y+10);
    this.rayOrigin.set(x,originY,z);
    this.raycaster.set(this.rayOrigin,this.groundDown);
    this.raycaster.near=0;
    this.raycaster.far=Math.max(10000,originY-this.terrainBounds.min.y+100);
    const hits=this.raycaster.intersectObject(this.terrain,true);
    for(const hit of hits){
      if(hit.object?.isMesh&&Number.isFinite(hit.point?.y))return hit.point.y;
    }
    return null;
  }

  enforceTerrainClearance(position){
    const groundY=this.getTerrainHeight(position.x,position.z);
    if(groundY===null)return false;
    const safeY=groundY+this.minimumTerrainClearance;
    if(position.y<safeY){
      position.y=safeY;
      if(this.velocity.y<0)this.velocity.y=0;
      return true;
    }
    return false;
  }

  clampToTerrainBounds(position){
    if(!this.terrain||this.terrainBounds.isEmpty())return false;
    const margin=this.terrainBoundsMargin;
    let changed=false;
    for(const axis of ['x','y','z']){
      const min=this.terrainBounds.min[axis]-margin;
      const max=this.terrainBounds.max[axis]+margin;
      const value=position[axis];
      if(value<min||value>max){
        position[axis]=THREE.MathUtils.clamp(value,min,max);
        if((value<min&&this.velocity[axis]<0)||(value>max&&this.velocity[axis]>0)){
          this.velocity[axis]=0;
        }
        changed=true;
      }
    }
    return changed;
  }

  start({deferInput=false}={}){
    if(this.active)return true;
    this.active=true;
    this.inputEnabled=!deferInput;
    this.keys.clear();
    this.velocity.set(0,0,0);
    this.camera.rotation.order='YXZ';
    this.yaw=this.camera.rotation.y;
    this.pitch=this.camera.rotation.x;
    this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');
    this.refreshTerrain();
    // Snap an overview camera that starts far outside the terrain to the nearest safe boundary.
    this.clampToTerrainBounds(this.camera.position);
    this.enforceTerrainClearance(this.camera.position);
    this.clampToTerrainBounds(this.camera.position);
    this.domElement.style.cursor='crosshair';
    try{
      const r=this.domElement.requestPointerLock?.();
      if(r&&typeof r.catch==='function')r.catch(()=>this.onPointerLock(false));
    }catch(error){
      this.onPointerLock(false);
    }
    this.onHud({speed:0});
    return true;
  }

  enableInput(){
    this.inputEnabled=true;
    this.keys.clear();
  }

  stop(){
    this.active=false;
    this.inputEnabled=false;
    this.keys.clear();
    this.velocity.set(0,0,0);
    this.domElement.style.cursor='';
    if(document.pointerLockElement===this.domElement)document.exitPointerLock?.();
  }

  update(dt){
    if(!this.active||!this.inputEnabled)return;
    dt=THREE.MathUtils.clamp(dt,0,0.04);

    const forwardInput=(this.keys.has('w')||this.keys.has('arrowup')?1:0)
      -(this.keys.has('s')||this.keys.has('arrowdown')?1:0);
    const sideInput=(this.keys.has('d')||this.keys.has('arrowright')?1:0)
      -(this.keys.has('a')||this.keys.has('arrowleft')?1:0);
    const verticalInput=(this.keys.has(' ')?1:0)-(this.keys.has('control')?1:0);

    const forward=new THREE.Vector3(0,0,-1).applyEuler(
      new THREE.Euler(this.pitch,this.yaw,0,'YXZ')
    );
    const right=new THREE.Vector3(Math.cos(this.yaw),0,-Math.sin(this.yaw));
    const desired=new THREE.Vector3()
      .addScaledVector(forward,forwardInput)
      .addScaledVector(right,sideInput)
      .add(new THREE.Vector3(0,verticalInput,0));

    if(desired.lengthSq()>1)desired.normalize();
    const maxSpeed=this.keys.has('shift')?this.boostSpeed:this.speed;
    desired.multiplyScalar(maxSpeed);

    // Softer ramp-up and braking prevent the camera from snapping into motion.
    this.velocity.lerp(desired,1-Math.exp(-dt*this.accelerationEase));
    const nextPosition=this.camera.position.clone().addScaledVector(this.velocity,dt);
    // The camera is the drone collision point. Cast down against the loaded
    // terrain mesh so neither forward flight nor descent can pass through it.
    this.clampToTerrainBounds(nextPosition);
    this.enforceTerrainClearance(nextPosition);
    this.clampToTerrainBounds(nextPosition);
    this.camera.position.copy(nextPosition);
    this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');
    this.onHud({speed:this.velocity.length()});
  }

  dispose(){
    this.stop();
    window.removeEventListener('keydown',this.down,true);
    window.removeEventListener('keyup',this.up,true);
    window.removeEventListener('blur',this.blur);
    document.removeEventListener('mousemove',this.mouse);
    document.removeEventListener('pointerlockchange',this.lock);
    this.domElement.removeEventListener('click',this.click);
  }
}
