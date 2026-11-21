import * as THREE from 'three';

export class DroneController {
  constructor({camera,domElement,onPointerLock=()=>{},onHud=()=>{}}){
    this.camera=camera;
    this.domElement=domElement;
    this.onPointerLock=onPointerLock;
    this.onHud=onHud;
    this.active=false;
    this.keys=new Set();
    this.velocity=new THREE.Vector3();
    this.yaw=0;
    this.pitch=0;
    this.speed=17;
    this.boostSpeed=30;
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
      if(!this.active)return;
      const k=this.key(e);
      if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' ','shift','control'].includes(k)){
        e.preventDefault();
        this.keys.add(k);
      }
    };
    this.up=e=>this.keys.delete(this.key(e));
    this.blur=()=>this.keys.clear();
    this.mouse=e=>{
      if(!this.active||document.pointerLockElement!==this.domElement)return;
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

  start(){
    if(this.active)return true;
    this.active=true;
    this.keys.clear();
    this.velocity.set(0,0,0);
    this.camera.rotation.order='YXZ';
    this.yaw=this.camera.rotation.y;
    this.pitch=this.camera.rotation.x;
    this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');
    this.domElement.style.cursor='crosshair';
    const r=this.domElement.requestPointerLock?.();
    if(r&&typeof r.catch==='function')r.catch(()=>{});
    this.onHud({speed:0});
    return true;
  }

  stop(){
    this.active=false;
    this.keys.clear();
    this.velocity.set(0,0,0);
    this.domElement.style.cursor='';
    if(document.pointerLockElement===this.domElement)document.exitPointerLock?.();
  }

  update(dt){
    if(!this.active)return;
    dt=THREE.MathUtils.clamp(dt,0,0.04);

    const forwardInput=(this.keys.has('w')||this.keys.has('arrowup')?1:0)
      -(this.keys.has('s')||this.keys.has('arrowdown')?1:0);
    const sideInput=(this.keys.has('d')||this.keys.has('arrowright')?1:0)
      -(this.keys.has('a')||this.keys.has('arrowleft')?1:0);
    const verticalInput=(this.keys.has(' ')?1:0)-(this.keys.has('shift')?1:0);

    const forward=new THREE.Vector3(0,0,-1).applyEuler(
      new THREE.Euler(this.pitch,this.yaw,0,'YXZ')
    );
    const right=new THREE.Vector3(Math.cos(this.yaw),0,-Math.sin(this.yaw));
    const desired=new THREE.Vector3()
      .addScaledVector(forward,forwardInput)
      .addScaledVector(right,sideInput)
      .add(new THREE.Vector3(0,verticalInput,0));

    if(desired.lengthSq()>1)desired.normalize();
    const maxSpeed=this.keys.has('control')?this.boostSpeed:this.speed;
    desired.multiplyScalar(maxSpeed);

    // Softer ramp-up and braking prevent the camera from snapping into motion.
    this.velocity.lerp(desired,1-Math.exp(-dt*this.accelerationEase));
    this.camera.position.addScaledVector(this.velocity,dt);
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
