import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const state = { slope:'slope1', ang:35, prof:0, cut:3, use:90, off:0, cr:0,
  root:null, terrain:null, centre:null, left:null, right:null, limit:null, ribbon:null };

const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(view.clientWidth, view.clientHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141418);
const camera = new THREE.PerspectiveCamera(55, view.clientWidth/view.clientHeight, 0.5, 20000);
camera.position.set(0, 300, 500);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a3a2f, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(300, 500, 200);
scene.add(sun);

window.addEventListener('resize', () => {
  camera.aspect = view.clientWidth/view.clientHeight; camera.updateProjectionMatrix();
  renderer.setSize(view.clientWidth, view.clientHeight);
});

// кривые из Maya приходят как одно-фасетные полигоны: вершины идут по порядку вдоль кривой
function curvePoints(obj){
  const pts=[]; obj.updateWorldMatrix(true,true);
  obj.traverse(c=>{
    if(pts.length) return;
    if(c.geometry && c.geometry.attributes && c.geometry.attributes.position){
      const p=c.geometry.attributes.position;
      for(let i=0;i<p.count;i++) pts.push(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(c.matrixWorld));
    }
  });
  return pts;
}

function resample(pts,n){
  if(pts.length<2) return pts;
  const seg=[],cum=[0]; let tot=0;
  for(let i=1;i<pts.length;i++){ const d=pts[i].distanceTo(pts[i-1]); seg.push(d); tot+=d; cum.push(tot); }
  const out=[]; let j=0;
  for(let i=0;i<n;i++){
    const t=tot*i/(n-1);
    while(j<seg.length-1 && cum[j+1]<t) j++;
    const u=(t-cum[j])/Math.max(seg[j],1e-9);
    out.push(pts[j].clone().lerp(pts[j+1],Math.min(1,Math.max(0,u))));
  }
  return out;
}

function alignDir(ref, pts){
  const d1=ref[0].distanceTo(pts[0])+ref[ref.length-1].distanceTo(pts[pts.length-1]);
  const d2=ref[0].distanceTo(pts[pts.length-1])+ref[ref.length-1].distanceTo(pts[0]);
  return d2<d1 ? pts.slice().reverse() : pts;
}

function smooth(vals, level){
  let cur=vals.slice();
  for(let k=0;k<level*2;k++){
    const nx=cur.slice();
    for(let i=1;i<cur.length-1;i++) nx[i]=(cur[i-1]+2*cur[i]+cur[i+1])/4;
    cur=nx;
  }
  return cur;
}

const ray=new THREE.Raycaster();
const down=new THREE.Vector3(0,-1,0);
function terrainY(x,z){
  ray.set(new THREE.Vector3(x,1e5,z), down);
  const h=ray.intersectObject(state.terrain,true);
  return h.length? h[0].point.y : null;
}

function rebuild(){
  if(!state.terrain||!state.centre||!state.left||!state.right) return;
  if(state.ribbon){ scene.remove(state.ribbon); state.ribbon.geometry.dispose(); state.ribbon=null; }

  const N=140;
  const C0=resample(curvePoints(state.centre),N);
  const L0=alignDir(C0,resample(curvePoints(state.left),N));
  const R0=alignDir(C0,resample(curvePoints(state.right),N));

  const tanA=Math.tan(THREE.MathUtils.degToRad(state.ang));
  let zc=smooth(C0.map(p=>p.y), state.prof);
  const pos=[], idx=[];
  let cutV=0, fillV=0;
  const COLS=5;
  let prevStep=0;

  for(let i=0;i<N;i++){
    const c=C0[i].clone(), l=L0[i].clone(), r=R0[i].clone();
    const across=new THREE.Vector3().subVectors(r,l).setY(0);
    const halfW=across.length()/2;
    const across_n=across.clone().normalize();
    const sh=across_n.clone().multiplyScalar(state.off);
    c.add(sh); l.add(sh); r.add(sh);

    let y=zc[i];
    const th0=terrainY(c.x,c.z);
    if(th0!==null && state.cut>0) y=Math.max(y, th0-state.cut);

    const cross=state.cr/100*halfW;
    const yl=y+cross, yr=y-cross;

    const skirt=(edge,yEdge,dir)=>{
      let last=edge.clone().setY(yEdge);
      for(let d=1; d<=60; d+=1){
        const q=edge.clone().addScaledVector(dir,d);
        const th=terrainY(q.x,q.z);
        if(th===null) break;
        const dz = yEdge - th;
        const slopeDrop = d*tanA;
        const yy = dz>0 ? yEdge - slopeDrop : yEdge + slopeDrop;
        if((dz>0 && yy<=th) || (dz<=0 && yy>=th)) return new THREE.Vector3(q.x,th,q.z);
        last=new THREE.Vector3(q.x,yy,q.z);
      }
      return last;
    };
    const sL=skirt(l,yl,across_n.clone().multiplyScalar(-1));
    const sR=skirt(r,yr,across_n.clone());

    const row=[sL, new THREE.Vector3(l.x,yl,l.z), new THREE.Vector3(c.x,y,c.z), new THREE.Vector3(r.x,yr,r.z), sR];
    row.forEach(p=>pos.push(p.x,p.y,p.z));

    const th=terrainY(c.x,c.z);
    if(th!==null){
      const step = i<N-1 ? C0[i].distanceTo(C0[i+1]) : prevStep;
      prevStep=step;
      const w=halfW*2, d=y-th;
      if(d>0) fillV+=d*w*step; else cutV+=-d*w*step;
    }
  }
  for(let i=0;i<N-1;i++) for(let j=0;j<COLS-1;j++){
    const a=i*COLS+j,b=a+1,c=(i+1)*COLS+j,d=c+1;
    idx.push(a,c,b,b,c,d);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setIndex(idx); g.computeVertexNormals();
  state.ribbon=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x4a9fe0,side:THREE.DoubleSide,roughness:.85,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  scene.add(state.ribbon);

  const usable=cutV*state.use/100;
  const imp=Math.max(0,fillV-usable), exp=Math.max(0,usable-fillV), bal=usable-fillV;
  const f=v=>Math.round(v).toLocaleString('ru-RU');
  document.getElementById('stats').innerHTML=
    `Срезано: <b>${f(cutV)}</b> м³<br>`+
    `Пригодно к использованию: <b>${f(usable)}</b> м³ (${state.use}%)<br>`+
    `Насыпано: <b>${f(fillV)}</b> м³<br>`+
    `Использовано из выемки: <b>${f(Math.min(usable,fillV))}</b> м³<br>`+
    `Требуется привезти: <b>${f(imp)}</b> м³<br>`+
    `Останется вывезти: <b>${f(exp)}</b> м³<br>`+
    `Баланс: <b>${bal>=0?'+':''}${f(bal)}</b> м³`;
}

const loader=new GLTFLoader();
function loadSlope(id){
  if(state.root){ scene.remove(state.root); state.root=null; }
  if(state.ribbon){ scene.remove(state.ribbon); state.ribbon=null; }
  Object.assign(state,{terrain:null,centre:null,left:null,right:null,limit:null});
  document.getElementById('stats').textContent='Загрузка…';
  loader.load(`./assets/${id}.gltf`, gltf=>{
    const root=gltf.scene; scene.add(root); state.root=root;
    root.traverse(o=>{
      const n=(o.name||'').toLowerCase();
      if(n.includes('terrain')) state.terrain=o;
      else if(n.includes('centre')||n.includes('center')) state.centre=o;
      else if(n.includes('left')) state.left=o;
      else if(n.includes('right')) state.right=o;
      else if(n.includes('limit')) state.limit=o;
    });
    if(state.terrain) state.terrain.traverse(c=>{ if(c.isMesh){ c.material=new THREE.MeshStandardMaterial({color:0x8a8470,roughness:1,side:THREE.DoubleSide}); }});
    // линии-кривые делаем прозрачными (они служат только данными)
    for(const k of ['centre','left','right','limit']){
      const o=state[k];
      if(o) o.traverse(c=>{ if(c.isMesh){ c.material=new THREE.MeshBasicMaterial({visible:false}); c.visible=false; }});
    }
    root.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(root);
    const ctr=box.getCenter(new THREE.Vector3()), sz=box.getSize(new THREE.Vector3()).length();
    camera.position.set(ctr.x+sz*.5, ctr.y+sz*.5, ctr.z+sz*.7);
    controls.target.copy(ctr); controls.update();
    const miss=['terrain','centre','left','right'].filter(k=>!state[k]);
    if(miss.length){ document.getElementById('stats').textContent='В GLTF не найдены объекты: '+miss.join(', '); return; }
    rebuild();
  }, undefined, err=>{
    document.getElementById('stats').textContent='Не удалось загрузить assets/'+id+'.gltf (проверь, что .bin рядом)';
  });
}

const map=[['pAng','ang','vAng',v=>v+'°'],['pProf','prof','vProf',v=>v],['pCut','cut','vCut',v=>v.toFixed(1)],
           ['pUse','use','vUse',v=>v+'%'],['pOff','off','vOff',v=>v.toFixed(1)],['pCr','cr','vCr',v=>v.toFixed(1)]];
let timer=null;
map.forEach(([id,key,vid,fm])=>{
  const el=document.getElementById(id);
  el.addEventListener('input',()=>{
    state[key]=parseFloat(el.value);
    document.getElementById(vid).textContent=fm(state[key]);
    clearTimeout(timer); timer=setTimeout(rebuild,120);
  });
});

document.querySelectorAll('.slope-btn').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.slope-btn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); state.slope=b.dataset.slope; loadSlope(state.slope);
}));

document.getElementById('save').addEventListener('click',()=>{
  const preset={version:'web-0.2',slope:state.slope,slope_angle:state.ang,profile_level:state.prof,
    max_cut_depth:state.cut,usable_percent:state.use,offset:state.off,crossfall_percent:state.cr,
    saved_at:new Date().toISOString()};
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(preset,null,2)],{type:'application/json'}));
  a.download=`ssgo_preset_${state.slope}_${Date.now()}.json`; a.click();
});

document.getElementById('reset').addEventListener('click',()=>{
  const d={pAng:35,pProf:0,pCut:3,pUse:90,pOff:0,pCr:0};
  for(const k in d){ const e=document.getElementById(k); e.value=d[k]; e.dispatchEvent(new Event('input')); }
});

loadSlope(state.slope);
(function loop(){ requestAnimationFrame(loop); controls.update(); renderer.render(scene,camera); })();
