import * as THREE from 'three';
export class DroneController {
  constructor({camera,domElement,onPointerLock=()=>{},onHud=()=>{}}){
    this.camera=camera;this.domElement=domElement;this.onPointerLock=onPointerLock;this.onHud=onHud;
    this.active=false;this.keys=new Set();this.velocity=new THREE.Vector3();this.yaw=0;this.pitch=0;
    this.speed=32;this.boostSpeed=75;
    this.key=e=>e.code==='Space'?' ':(e.key||'').toLowerCase();
    this.down=e=>{if(!this.active)return;const k=this.key(e);if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' ','shift','control'].includes(k)){e.preventDefault();this.keys.add(k);}};
    this.up=e=>this.keys.delete(this.key(e));
    this.blur=()=>this.keys.clear();
    this.mouse=e=>{if(!this.active||document.pointerLockElement!==this.domElement)return;this.yaw-=e.movementX*.0021;this.pitch=THREE.MathUtils.clamp(this.pitch-e.movementY*.0017,-1.35,1.35);this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');};
    this.lock=()=>this.onPointerLock(document.pointerLockElement===this.domElement);
    this.click=()=>{if(this.active&&document.pointerLockElement!==this.domElement){const r=this.domElement.requestPointerLock?.();if(r&&typeof r.catch==='function')r.catch(()=>{});}};
    window.addEventListener('keydown',this.down,{passive:false});window.addEventListener('keyup',this.up);window.addEventListener('blur',this.blur);
    document.addEventListener('mousemove',this.mouse);document.addEventListener('pointerlockchange',this.lock);this.domElement.addEventListener('click',this.click);
  }
  start(){if(this.active)return true;this.active=true;this.keys.clear();this.velocity.set(0,0,0);this.camera.rotation.order='YXZ';this.yaw=this.camera.rotation.y;this.pitch=this.camera.rotation.x;this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');this.domElement.style.cursor='crosshair';const r=this.domElement.requestPointerLock?.();if(r&&typeof r.catch==='function')r.catch(()=>{});this.onHud({speed:0});return true;}
  stop(){this.active=false;this.keys.clear();this.velocity.set(0,0,0);this.domElement.style.cursor='';if(document.pointerLockElement===this.domElement)document.exitPointerLock?.();}
  update(dt){
    if(!this.active)return;dt=THREE.MathUtils.clamp(dt,0,.04);
    const f=(this.keys.has('w')||this.keys.has('arrowup')?1:0)-(this.keys.has('s')||this.keys.has('arrowdown')?1:0);
    const x=(this.keys.has('d')||this.keys.has('arrowright')?1:0)-(this.keys.has('a')||this.keys.has('arrowleft')?1:0);
    const y=(this.keys.has(' ')?1:0)-(this.keys.has('shift')?1:0);
    const d=new THREE.Vector3(-Math.sin(this.yaw),0,-Math.cos(this.yaw)).multiplyScalar(f);
    d.add(new THREE.Vector3(Math.cos(this.yaw),0,-Math.sin(this.yaw)).multiplyScalar(x));d.y=y;
    if(d.lengthSq()>1)d.normalize();this.velocity.lerp(d.multiplyScalar(this.keys.has('control')?this.boostSpeed:this.speed),1-Math.exp(-dt*5.5));
    this.camera.position.addScaledVector(this.velocity,dt);this.camera.rotation.set(this.pitch,this.yaw,0,'YXZ');this.onHud({speed:this.velocity.length()});
  }
  dispose(){this.stop();window.removeEventListener('keydown',this.down);window.removeEventListener('keyup',this.up);window.removeEventListener('blur',this.blur);document.removeEventListener('mousemove',this.mouse);document.removeEventListener('pointerlockchange',this.lock);this.domElement.removeEventListener('click',this.click);}
}
