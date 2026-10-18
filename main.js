import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const state = {
  slope:'slope1', off:0, cr:0, fillN:1.428, cutN:1.428, cut:3, prof:0,
  root:null, terrain:null, curves:null, designGroup:null, labelsGroup:null
};

const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(view.clientWidth, view.clientHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141418);
const camera = new THREE.PerspectiveCamera(55, view.clientWidth/view.clientHeight, 0.5, 20000);
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

const dbgEl = document.getElementById('debug');
function dbg(msg){ dbgEl.textContent += msg + "\n"; }
const bust = () => '?t=' + Date.now();
const loader = new GLTFLoader();
const loadGLTF = url => new Promise((res, rej) => loader.load(url, res, undefined, rej));
const loadJSON = url => fetch(url).then(r => { if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });

function alignDir(ref, pts){
  const d1=ref[0].distanceTo(pts[0])+ref[ref.length-1].distanceTo(pts[pts.length-1]);
  const d2=ref[0].distanceTo(pts[pts.length-1])+ref[ref.length-1].distanceTo(pts[0]);
  return d2<d1 ? pts.slice().reverse() : pts;
}
function smoothVals(vals, level){
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

function clearGroup(g){ if(g){ scene.remove(g); g.traverse(o=>{ if(o.geometry) o.geometry.dispose(); }); } return null; }

function rebuild(){
  if(!state.terrain||!state.curves) return;
  state.designGroup = clearGroup(state.designGroup);
  state.labelsGroup = clearGroup(state.labelsGroup);
  const g = new THREE.Group(); state.designGroup = g; scene.add(g);
  const lg = new THREE.Group(); state.labelsGroup = lg; scene.add(lg);

  const cv = state.curves;
  const C = cv.centre.map(p=>new THREE.Vector3(...p));
  const L = alignDir(C, cv.left.map(p=>new THREE.Vector3(...p)));
  const R = alignDir(C, cv.right.map(p=>new THREE.Vector3(...p)));
  const N = C.length;
  const M = 9;

  // профиль земли по центру + сглаживание
  let ground = C.map(p => { const h = terrainY(p.x,p.z); return h===null ? p.y : h; });
  let prof = smoothVals(ground, state.prof);

  // проектная поверхность
  const pos=[], cols=[], idx=[];
  const zoneOf = d => d > 0.02 ? [0.16,0.82,0.2] : (d < -0.02 ? [0.9,0.25,0.2] : [0.55,0.55,0.6]);
  let cutV=0, fillV=0;
  const G=[], TG=[];
  for(let i=0;i<N;i++){
    const c=C[i], l=L[i], r=R[i];
    const across=new THREE.Vector3().subVectors(r,l).setY(0);
    const halfW=across.length()/2;
    const an=across.clone().normalize();
    const sh=an.clone().multiplyScalar(state.off);
    const cc=c.clone().add(sh), ll=l.clone().add(sh), rr=r.clone().add(sh);
    let zc=prof[i]+state.off;
    const row=[], trow=[];
    for(let j=0;j<M;j++){
      const t=j/(M-1);
      const q=new THREE.Vector3().lerpVectors(ll,rr,t);
      const th=terrainY(q.x,q.z); const tg=(th===null?zc:th);
      let z=zc - state.cr/100*(t*2-1)*halfW;
      const floor=tg-state.cut;
      if(z<floor) z=floor;
      row.push(q.clone().setY(z)); trow.push(tg);
    }
    G.push(row); TG.push(trow);
  }
  // объёмы ядра + триангуляция
  for(let i=0;i<N-1;i++) for(let j=0;j<M-1;j++){
    const a=G[i][j], b=G[i][j+1], c=G[i+1][j+1], e=G[i+1][j];
    const ta=TG[i][j], tb=TG[i][j+1], tc=TG[i+1][j+1], te=TG[i+1][j];
    const d=((a.y-ta)+(b.y-tb)+(c.y-tc)+(e.y-te))/4;
    // площадь ячейки в плане
    const s = Math.abs((b.x-a.x)*(e.z-a.z)-(e.x-a.x)*(b.z-a.z))/2
            + Math.abs((c.x-a.x)*(e.z-a.z)-(e.x-a.x)*(c.z-a.z))/2;
    const v=d*s;
    if(v>=0) fillV+=v; else cutV-=v;
    for(const [p,t] of [[a,ta],[b,tb],[c,tc],[e,te]]){
      pos.push(p.x,p.y,p.z);
      cols.push(...zoneOf(p.y-t));
    }
    idx.push(pos.length/3-4, pos.length/3-2, pos.length/3-1);
    idx.push(pos.length/3-4, pos.length/3-1, pos.length/3-3);
  }
  // откосы: маршируем от края до рельефа с уклоном 1:n
  const skirt=(i, edge, tgY, dir, n_slope, isFill)=>{
    const zEdge=edge.y;
    let prev=edge.clone();
    for(let d=1; d<=80; d+=0.5){
      const q=edge.clone().addScaledVector(dir,d);
      const th=terrainY(q.x,q.z);
      if(th===null) break;
      const z = isFill ? zEdge - d/n_slope : zEdge + d/n_slope;
      const p=q.clone().setY(z);
      // треугольник между prev и p
      pos.push(prev.x,prev.y,prev.z, p.x,p.y,p.z, q.x,th,q.z);
      const zi = isFill ? fillV : cutV;
      const v = Math.abs(((p.y-th)+(prev.y-tgY))/2)*0.5; // грубая площадь
      if(isFill) fillV+=Math.abs((p.y-th))*0.5*0.5; else cutV+=Math.abs((prev.y-tgY))*0.5*0.5;
      const base=pos.length/3-3;
      cols.push(...zoneOf(prev.y-tgY), ...zoneOf(p.y-th), ...zoneOf(0));
      idx.push(base, base+1, base+2);
      if((isFill && z<=th) || (!isFill && z>=th)){
        return {end:new THREE.Vector3(q.x,th,q.z), dist:d};
      }
      prev=p;
    }
    return {end:prev, dist:80};
  };
  for(let i=0;i<N;i++){
    const across=new THREE.Vector3().subVectors(R[i],L[i]).setY(0).normalize();
    // левый край
    const isFillL = G[i][0].y >= TG[i][0];
    skirt(i, G[i][0], TG[i][0], across.clone().multiplyScalar(-1), isFillL?state.fillN:state.cutN, isFillL);
    // правый край
    const isFillR = G[i][M-1].y >= TG[i][M-1];
    skirt(i, G[i][M-1], TG[i][M-1], across.clone(), isFillR?state.fillN:state.cutN, isFillR);
  }

  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols,3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo, new THREE.MeshStandardMaterial({vertexColors:true, side:THREE.DoubleSide, roughness:.9,
    polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1}));
  g.add(mesh);

  // подписи: каждые ~20 м — уклон по центру и высоты по трём кривым
  const stepM=20;
  let acc=0; const rows=[];
  for(let i=1;i<N;i++){
    acc+=C[i].distanceTo(C[i-1]);
    if(acc>=stepM || i===N-1){
      acc=0;
      const h=Math.max(0.1, C[i].distanceTo(C[i-1]));
      const slope=Math.degrees(Math.atan((G[i][4].y-G[i-1][4].y)/h));
      rows.push({i, slope, c:G[i][4].y, l:G[i][0].y, r:G[i][M-1].y, p:C[i]});
    }
  }
  const labelDiv=document.getElementById('labels');
  labelDiv.innerHTML = rows.map(r=>
    `<div>Ст. ${r.i}: уклон <b>${r.slope.toFixed(1)}°</b> | H: ${r.c.toFixed(1)} / ${r.l.toFixed(1)} / ${r.r.toFixed(1)} м</div>`
  ).join('') || '-';
  // 3D-подписи: маленькие спрайты с текстом
  const makeSprite=(text, p, color)=>{
    const cnv=document.createElement('canvas'); cnv.width=256; cnv.height=64;
    const ctx=cnv.getContext('2d');
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,256,64);
    ctx.fillStyle=color; ctx.font='bold 28px sans-serif'; ctx.textAlign='center';
    ctx.fillText(text,128,42);
    const tex=new THREE.CanvasTexture(cnv);
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex, depthTest:false}));
    sp.scale.set(12,3,1); sp.position.copy(p);
    return sp;
  };
  rows.forEach(r=>{
    lg.add(makeSprite(r.slope.toFixed(1)+'°', new THREE.Vector3(r.p.x, r.c+6, r.p.z), '#ffd24a'));
    lg.add(makeSprite(r.c.toFixed(1), new THREE.Vector3(r.p.x, r.c+3, r.p.z), '#ffffff'));
  });

  const usable=cutV*0.9;
  const imp=Math.max(0,fillV-usable), exp=Math.max(0,usable-fillV), bal=usable-fillV;
  const f=v=>Math.round(v).toLocaleString('ru-RU');
  document.getElementById('stats').innerHTML=
    `Срезано: <b>${f(cutV)}</b> м³<br>`+
    `Пригодно к использованию: <b>${f(usable)}</b> м³ (90%)<br>`+
    `Насыпано: <b>${f(fillV)}</b> м³<br>`+
    `Требуется привезти: <b>${f(imp)}</b> м³<br>`+
    `Останется вывезти: <b>${f(exp)}</b> м³<br>`+
    `Баланс: <b>${bal>=0?'+':''}${f(bal)}</b> м³<br>`+
    `<span style="color:#89f">Предварительная оценка. Точный расчёт — в Maya по пресету.</span>`;
}

async function loadSlope(id){
  if(state.root){ scene.remove(state.root); state.root=null; }
  state.terrain=null; state.curves=null;
  state.designGroup=clearGroup(state.designGroup);
  state.labelsGroup=clearGroup(state.labelsGroup);
  dbgEl.textContent='';
  document.getElementById('stats').textContent='Загрузка…';
  try{
    const gltf=await loadGLTF(`./assets/${id}.gltf${bust()}`);
    const root=gltf.scene; scene.add(root); state.root=root;
    root.traverse(o=>{
      if((o.name||'').toLowerCase().includes('terrain')){
        state.terrain=o;
        o.traverse(c=>{ if(c.isMesh) c.material=new THREE.MeshStandardMaterial({color:0x8a8470,roughness:1,side:THREE.DoubleSide}); });
      }
    });
    root.updateMatrixWorld(true);
    dbg('Terrain загружен.');
    const cv=await loadJSON(`./assets/${id}.curves.json${bust()}`);
    state.curves=cv;
    dbg('Кривые загружены: centre '+(cv.centre||[]).length+', left '+(cv.left||[]).length+', right '+(cv.right||[]).length);
    const box=new THREE.Box3().setFromObject(root);
    const ctr=box.getCenter(new THREE.Vector3()), sz=box.getSize(new THREE.Vector3()).length();
    camera.position.set(ctr.x+sz*.5, ctr.y+sz*.5, ctr.z+sz*.7);
    controls.target.copy(ctr); controls.update();
    rebuild();
  }catch(err){
    const msg=err&&(err.message||err.description)?(err.message||err.description):String(err);
    document.getElementById('stats').textContent='Ошибка загрузки: '+msg;
    dbg('ОШИБКА: '+msg);
    console.error(err);
  }
}

const map=[['pOff','off','vOff',v=>v.toFixed(1)],['pCr','cr','vCr',v=>v.toFixed(1)],
           ['pFillN','fillN','vFillN',v=>v.toFixed(2)],['pCutN','cutN','vCutN',v=>v.toFixed(2)],
           ['pCut','cut','vCut',v=>v.toFixed(1)],['pProf','prof','vProf',v=>v]];
let timer=null;
map.forEach(([id,key,vid,fm])=>{
  const el=document.getElementById(id);
  el.addEventListener('input',()=>{
    state[key]=parseFloat(el.value);
    document.getElementById(vid).textContent=fm(state[key]);
    clearTimeout(timer); timer=setTimeout(rebuild,150);
  });
});

document.querySelectorAll('.slope-btn').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.slope-btn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); state.slope=b.dataset.slope; loadSlope(state.slope);
}));

document.getElementById('save').addEventListener('click',()=>{
  const preset={
    version:'web-preset-1',
    slope:state.slope,
    offset:state.off,
    crossfall_percent:state.cr,
    fill_n:state.fillN,
    cut_n:state.cutN,
    max_cut_depth:state.cut,
    profile_level:state.prof,
    saved_at:new Date().toISOString()
  };
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(preset,null,2)],{type:'application/json'}));
  a.download=`ssgo_preset_${state.slope}_${Date.now()}.json`;
  a.click();
});

document.getElementById('reset').addEventListener('click',()=>{
  const d={pOff:0,pCr:0,pFillN:1.43,pCutN:1.43,pCut:3,pProf:0};
  for(const k in d){ const e=document.getElementById(k); e.value=d[k]; e.dispatchEvent(new Event('input')); }
});

loadSlope(state.slope);
(function loop(){ requestAnimationFrame(loop); controls.update(); renderer.render(scene,camera); })();
