import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Как в Maya "Основные настройки": угол откоса, сглаживание, макс. глубина срезки
const state = {
  slope:'slope1', ang:35, prof:0, cut:3,
  terrainVisible:true, terrainOpacity:1,
  root:null, terrain:null, terrainMats:[], curves:null, designGroup:null, labelsGroup:null
};

const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(view.clientWidth, view.clientHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141418);
const camera = new THREE.PerspectiveCamera(55, view.clientWidth/view.clientHeight, 0.5, 20000);
// Sketchfab-подобное управление: ЛКМ вращение, колесо зум, ПКМ панорама
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN
};
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN
};

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
const deg = r => r * 180 / Math.PI;

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

function applyTerrainLook(){
  state.terrainMats.forEach(m=>{
    m.opacity = state.terrainOpacity;
    m.transparent = state.terrainOpacity < 1;
    m.visible = state.terrainVisible;
  });
  if(state.terrain) state.terrain.visible = state.terrainVisible;
}

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

  let ground = C.map(p => { const h = terrainY(p.x,p.z); return h===null ? p.y : h; });
  let prof = smoothVals(ground, state.prof);

  // как в Maya: уклоны откосов 1:n из угла
  const fillN = 1.0 / Math.tan(THREE.MathUtils.degToRad(state.ang));
  const cutN = fillN;

  const pos=[], cols=[], idx=[];
  const zoneOf = d => d > 0.02 ? [0.42,0.72,0.38] : (d < -0.02 ? [0.82,0.48,0.36] : [0.76,0.74,0.70]);
  let cutV=0, fillV=0;
  const G=[], TG=[];
  for(let i=0;i<N;i++){
    const c=C[i], l=L[i], r=R[i];
    const across=new THREE.Vector3().subVectors(r,l).setY(0);
    const halfW=across.length()/2;
    const an=across.clone().normalize();
    const cc=c.clone(), ll=l.clone(), rr=r.clone();
    let zc=prof[i];
    const row=[], trow=[];
    for(let j=0;j<M;j++){
      const t=j/(M-1);
      const q=new THREE.Vector3().lerpVectors(ll,rr,t);
      const th=terrainY(q.x,q.z); const tg=(th===null?zc:th);
      let z=zc;
      const floor=tg-state.cut;
      if(z<floor) z=floor;
      row.push(q.clone().setY(z)); trow.push(tg);
    }
    G.push(row); TG.push(trow);
  }
  for(let i=0;i<N-1;i++) for(let j=0;j<M-1;j++){
    const a=G[i][j], b=G[i][j+1], c=G[i+1][j+1], e=G[i+1][j];
    const ta=TG[i][j], tb=TG[i][j+1], tc=TG[i+1][j+1], te=TG[i+1][j];
    const d=((a.y-ta)+(b.y-tb)+(c.y-tc)+(e.y-te))/4;
    const s = Math.abs((b.x-a.x)*(e.z-a.z)-(e.x-a.x)*(b.z-a.z))/2
            + Math.abs((c.x-a.x)*(e.z-a.z)-(e.x-a.x)*(c.z-a.z))/2;
    const v=d*s;
    if(v>=0) fillV+=v; else cutV-=v;
    const col=zoneOf(d);
    for(const p of [a,b,c,e]){
      pos.push(p.x,p.y,p.z);
      cols.push(...col);
    }
    idx.push(pos.length/3-4, pos.length/3-2, pos.length/3-1);
    idx.push(pos.length/3-4, pos.length/3-1, pos.length/3-3);
  }
  const skirt=(edge, tgY, dir, n_slope, isFill)=>{
    const zEdge=edge.y;
    let prev=edge.clone();
    for(let d=0.5; d<=200; d+=0.5){
      const q=edge.clone().addScaledVector(dir,d);
      const th=terrainY(q.x,q.z);
      if(th===null) break;
      const z = isFill ? zEdge - d/n_slope : zEdge + d/n_slope;
      const p=q.clone().setY(z);
      pos.push(prev.x,prev.y,prev.z, p.x,p.y,p.z, q.x,th,q.z);
      const dzPrev=prev.y-tgY, dzCur=p.y-th;
      const v=Math.abs((dzPrev+dzCur)/2)*0.5;
      if(isFill) fillV+=v; else cutV+=v;
      const base=pos.length/3-3;
      const col=zoneOf((dzPrev+dzCur)/2);
      cols.push(...col, ...col, ...col);
      idx.push(base, base+1, base+2);
      if((isFill && z<=th) || (!isFill && z>=th)) return;
      prev=p;
    }
  };
  for(let i=0;i<N;i++){
    const across=new THREE.Vector3().subVectors(R[i],L[i]).setY(0).normalize();
    const isFillL = G[i][0].y >= TG[i][0];
    skirt(G[i][0], TG[i][0], across.clone().multiplyScalar(-1), isFillL?fillN:cutN, isFillL);
    const isFillR = G[i][M-1].y >= TG[i][M-1];
    skirt(G[i][M-1], TG[i][M-1], across.clone(), isFillR?fillN:cutN, isFillR);
  }

  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols,3));
  geo.setIndex(idx); geo.computeVertexNormals();
  // Непрозрачный материал с освещением — как шейдинг в Maya
  const mesh=new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors:true, side:THREE.DoubleSide, roughness:0.95, metalness:0,
    transparent:false, opacity:1,
    polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1
  }));
  g.add(mesh);

  // подписи веба: каждые ~20 м
  const stepM=20;
  let acc=0; const rows=[];
  for(let i=1;i<N;i++){
    acc+=C[i].distanceTo(C[i-1]);
    if(acc>=stepM || i===N-1){
      acc=0;
      const h=Math.max(0.1, C[i].distanceTo(C[i-1]));
      const slope=deg(Math.atan((G[i][4].y-G[i-1][4].y)/h));
      rows.push({i, slope, c:G[i][4].y, l:G[i][0].y, r:G[i][M-1].y, p:C[i], pl:G[i][0], pr:G[i][M-1]});
    }
  }
  const labelDiv=document.getElementById('labels');
  labelDiv.innerHTML = rows.map(r=>
    `<div>Ст. ${r.i}: уклон <b>${r.slope.toFixed(1)}°</b> | H: ${r.c.toFixed(1)} / ${r.l.toFixed(1)} / ${r.r.toFixed(1)} м</div>`
  ).join('') || '-';
  const makeSprite=(text, p, color)=>{
    const cnv=document.createElement('canvas'); cnv.width=256; cnv.height=64;
    const ctx=cnv.getContext('2d');
    ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillRect(0,0,256,64);
    ctx.fillStyle=color; ctx.font='bold 30px sans-serif'; ctx.textAlign='center';
    ctx.fillText(text,128,44);
    const tex=new THREE.CanvasTexture(cnv);
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex, depthTest:false}));
    sp.scale.set(10,2.5,1); sp.position.copy(p);
    return sp;
  };
  rows.forEach(r=>{
    lg.add(makeSprite(r.slope.toFixed(1)+'°', new THREE.Vector3(r.p.x, r.c+7, r.p.z), '#ffd24a'));
    lg.add(makeSprite(r.c.toFixed(1), new THREE.Vector3(r.p.x, r.c+3.5, r.p.z), '#ffffff'));
    lg.add(makeSprite(r.l.toFixed(1), new THREE.Vector3(r.pl.x, r.l+3.5, r.pl.z), '#7fd4ff'));
    lg.add(makeSprite(r.r.toFixed(1), new THREE.Vector3(r.pr.x, r.r+3.5, r.pr.z), '#ffb0a0'));
  });

  const usable=cutV*0.9;
  const imp=Math.max(0,fillV-usable), exp=Math.max(0,usable-fillV), bal=usable-fillV;
  const f=v=>Math.round(v).toLocaleString('ru-RU');
  document.getElementById('stats').innerHTML=
    `Угол откоса: <b>${state.ang}°</b> (1:${fillN.toFixed(2)})<br>`+
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
  state.terrain=null; state.curves=null; state.terrainMats=[];
  state.designGroup=clearGroup(state.designGroup);
  state.labelsGroup=clearGroup(state.labelsGroup);
  dbgEl.textContent='';
  document.getElementById('stats').textContent='Загрузка…';
  document.getElementById('mayaLabels').textContent='Загрузка…';
  try{
    const gltf=await loadGLTF(`./assets/${id}.gltf${bust()}`);
    const root=gltf.scene; scene.add(root); state.root=root;
    root.traverse(o=>{
      if((o.name||'').toLowerCase().includes('terrain')){
        state.terrain=o;
        o.traverse(c=>{
          if(c.isMesh){
            const m=new THREE.MeshStandardMaterial({color:0x8a8470,roughness:1,side:THREE.DoubleSide});
            c.material=m; state.terrainMats.push(m);
          }
        });
      }
    });
    applyTerrainLook();
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
    try{
      const ml=await loadJSON(`./assets/${id}_labels.json${bust()}`);
      document.getElementById('mayaLabels').innerHTML = ml.labels.map(r=>
        `<div>Ст. ${r.station}: уклон <b>${r.slope_deg===null?'—':r.slope_deg.toFixed(1)+'°'}</b> | H: ${r.h_center.toFixed(1)} / ${r.h_left.toFixed(1)} / ${r.h_right.toFixed(1)} м</div>`
      ).join('');
      dbg('Подписи Maya загружены: '+ml.labels.length+' станций.');
    }catch(e){
      document.getElementById('mayaLabels').textContent='Нет (нужен ЗАПУСК + экспорт в Maya): '+e.message;
    }
  }catch(err){
    const msg=err&&(err.message||err.description)?(err.message||err.description):String(err);
    document.getElementById('stats').textContent='Ошибка загрузки: '+msg;
    dbg('ОШИБКА: '+msg);
    console.error(err);
  }
}

const map=[['pAng','ang','vAng',v=>v+'°'],['pProf','prof','vProf',v=>v],['pCut','cut','vCut',v=>v.toFixed(1)]];
let timer=null;
map.forEach(([id,key,vid,fm])=>{
  const el=document.getElementById(id);
  el.addEventListener('input',()=>{
    state[key]=parseFloat(el.value);
    document.getElementById(vid).textContent=fm(state[key]);
    clearTimeout(timer); timer=setTimeout(rebuild,150);
  });
});

document.getElementById('pTerrain').addEventListener('change',e=>{
  state.terrainVisible=e.target.checked; applyTerrainLook();
});
document.getElementById('pTerrOp').addEventListener('input',e=>{
  state.terrainOpacity=parseFloat(e.target.value)/100;
  document.getElementById('vTerrOp').textContent=e.target.value+'%';
  applyTerrainLook();
});

document.querySelectorAll('.slope-btn').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.slope-btn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); state.slope=b.dataset.slope; loadSlope(state.slope);
}));

document.getElementById('save').addEventListener('click',()=>{
  const fillN = 1.0/Math.tan(THREE.MathUtils.degToRad(state.ang));
  const preset={
    version:'web-preset-2',
    slope:state.slope,
    slope_angle:state.ang,
    profile_level:state.prof,
    max_cut_depth:state.cut,
    offset:0,
    crossfall_percent:0,
    fill_n:parseFloat(fillN.toFixed(4)),
    cut_n:parseFloat(fillN.toFixed(4)),
    saved_at:new Date().toISOString()
  };
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(preset,null,2)],{type:'application/json'}));
  a.download=`ssgo_preset_${state.slope}_${Date.now()}.json`;
  a.click();
});

document.getElementById('reset').addEventListener('click',()=>{
  const d={pAng:35,pProf:0,pCut:3};
  for(const k in d){ const e=document.getElementById(k); e.value=d[k]; e.dispatchEvent(new Event('input')); }
});

loadSlope(state.slope);
(function loop(){ requestAnimationFrame(loop); controls.update(); renderer.render(scene,camera); })();
