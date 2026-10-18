import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const state = {
  slope:'A1', ang:35, prof:0, cut:5,
  terrainVisible:true, terrainOpacity:1, designVisible:true, gridVisible:true,
  labelsVisible:true, terrainLabelsVisible:true, terrainSlopesVisible:false,
  root:null, terrain:null, terrainMats:[], curves:null,
  designGroup:null, labelsGroup:null, terrainLabelsGroup:null
};

const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(view.clientWidth, view.clientHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141418);
const camera = new THREE.PerspectiveCamera(55, view.clientWidth/view.clientHeight, 0.5, 20000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a3a2f, 0.9));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
sun.position.set(300, 600, 200);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 3000;
sun.shadow.camera.left = -1200; sun.shadow.camera.right = 1200;
sun.shadow.camera.top = 1200; sun.shadow.camera.bottom = -1200;
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

const raycaster=new THREE.Raycaster();
const down=new THREE.Vector3(0,-1,0);
function terrainY(x,z){
  raycaster.set(new THREE.Vector3(x,1e5,z), down);
  const h=raycaster.intersectObject(state.terrain,true);
  return h.length? h[0].point.y : null;
}

function clearGroup(g){ if(g){ scene.remove(g); g.traverse(o=>{ if(o.geometry) o.geometry.dispose(); }); } return null; }

function applyTerrainLook(){
  state.terrainMats.forEach(m=>{
    m.opacity = state.terrainOpacity;
    m.transparent = state.terrainOpacity < 1;
  });
  if(state.terrain) state.terrain.visible = state.terrainVisible;
  if(state.terrainLabelsGroup) state.terrainLabelsGroup.visible = state.terrainLabelsVisible && state.terrainVisible;
}
function applyDesignLook(){
  if(state.designGroup) state.designGroup.visible = state.designVisible;
  if(state.labelsGroup) state.labelsGroup.visible = state.labelsVisible;
}

const clickRay=new THREE.Raycaster();
const ndc=new THREE.Vector2();
renderer.domElement.addEventListener('dblclick', ev=>{
  const rect=renderer.domElement.getBoundingClientRect();
  ndc.x=((ev.clientX-rect.left)/rect.width)*2-1;
  ndc.y=-((ev.clientY-rect.top)/rect.height)*2+1;
  clickRay.setFromCamera(ndc,camera);
  const targets=[];
  if(state.designGroup&&state.designVisible) targets.push(state.designGroup);
  if(state.terrain&&state.terrainVisible) targets.push(state.terrain);
  const hits=clickRay.intersectObjects(targets,true);
  if(!hits.length) return;
  const p=hits[0].point;
  const dist=camera.position.distanceTo(controls.target);
  controls.target.copy(p);
  const dir=new THREE.Vector3().subVectors(camera.position,controls.target).normalize();
  camera.position.copy(p).addScaledVector(dir, Math.min(dist, 200));
  controls.update();
});

function rebuild(){
  if(!state.terrain||!state.curves) return;
  state.designGroup = clearGroup(state.designGroup);
  state.labelsGroup = clearGroup(state.labelsGroup);
  state.terrainLabelsGroup = clearGroup(state.terrainLabelsGroup);
  const g = new THREE.Group(); state.designGroup = g; scene.add(g);
  const lg = new THREE.Group(); state.labelsGroup = lg; scene.add(lg);
  const tg = new THREE.Group(); state.terrainLabelsGroup = tg; scene.add(tg);
  applyDesignLook(); applyTerrainLook();

  const cv = state.curves;
  const C = cv.centre.map(p=>new THREE.Vector3(...p));
  const L = alignDir(C, cv.left.map(p=>new THREE.Vector3(...p)));
  const R = alignDir(C, cv.right.map(p=>new THREE.Vector3(...p)));
  const N = C.length;
  const M = 9;

  let ground = C.map(p => { const h = terrainY(p.x,p.z); return h===null ? p.y : h; });
  let prof = smoothVals(ground, state.prof);

  const fillN = 1.0 / Math.tan(THREE.MathUtils.degToRad(state.ang));
  const cutN = fillN;

  const pos=[], cols=[], idx=[];
  const zoneOf = d => d > 0.02 ? [0.35,0.55,0.85] : (d < -0.02 ? [0.82,0.48,0.36] : [0.76,0.74,0.70]);
  let cutV=0, fillV=0;
  const G=[], TG=[];
  for(let i=0;i<N;i++){
    const c=C[i], l=L[i], r=R[i];
    const across=new THREE.Vector3().subVectors(r,l).setY(0);
    const an=across.clone().normalize();
    const cc=c.clone(), ll=l.clone(), rr=r.clone();
    let zc=prof[i];
    const row=[], trow=[];
    for(let j=0;j<M;j++){
      const t=j/(M-1);
      const q=new THREE.Vector3().lerpVectors(ll,rr,t);
      const th=terrainY(q.x,q.z); const tgv=(th===null?zc:th);
      let z=zc;
      const floor=tgv-state.cut;
      if(z<floor) z=floor;
      row.push(q.clone().setY(z)); trow.push(tgv);
    }
    G.push(row); TG.push(trow);
  }
  function addTri(a,b,c,col){
    const ar=(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
    if(ar<0){ const t=b; b=c; c=t; }
    const base=pos.length/3;
    for(const p of [a,b,c]){ pos.push(p.x,p.y,p.z); cols.push(...col); }
    idx.push(base,base+1,base+2);
  }
  function addQuad(a,b,c,d,col){
    addTri(a,b,c,col); addTri(a,c,d,col);
  }
  for(let i=0;i<N-1;i++) for(let j=0;j<M-1;j++){
    const a=G[i][j], b=G[i][j+1], c=G[i+1][j+1], e=G[i+1][j];
    const ta=TG[i][j], tb=TG[i][j+1], tc=TG[i+1][j+1], te=TG[i+1][j];
    const d=((a.y-ta)+(b.y-tb)+(c.y-tc)+(e.y-te))/4;
    const s = Math.abs((b.x-a.x)*(e.z-a.z)-(e.x-a.x)*(b.z-a.z))/2
            + Math.abs((c.x-a.x)*(e.z-a.z)-(e.x-a.x)*(c.z-a.z))/2;
    const v=d*s;
    if(v>=0) fillV+=v; else cutV-=v;
    addQuad(a,b,c,e,zoneOf(d));
  }
  function skirtRibbon(edges, tgs, dirs, nSlope, isFill){
    const profiles = edges.map((edge,i)=>{
      const zEdge=edge.y, tg=tgs[i];
      const pts=[{p:edge.clone(), th:tg}];
      for(let d=0.5; d<=200; d+=0.5){
        const q=edge.clone().addScaledVector(dirs[i],d);
        const th=terrainY(q.x,q.z);
        if(th===null) break;
        const z = isFill ? zEdge - d/nSlope : zEdge + d/nSlope;
        const p=q.clone().setY(z);
        pts.push({p, th});
        if((isFill && z<=th) || (!isFill && z>=th)){
          pts.push({p:new THREE.Vector3(q.x,th,q.z), th});
          break;
        }
      }
      return pts;
    });
    for(let i=0;i<profiles.length-1;i++){
      const A=profiles[i], B=profiles[i+1];
      const K=Math.min(A.length,B.length);
      for(let k=0;k<K-1;k++){
        const dz=((A[k].p.y-A[k].th)+(A[k+1].p.y-A[k+1].th)+(B[k].p.y-B[k].th)+(B[k+1].p.y-B[k+1].th))/4;
        addQuad(A[k].p, A[k+1].p, B[k+1].p, B[k].p, zoneOf(dz));
        const s=Math.abs((A[k+1].p.x-A[k].p.x)*(B[k].p.z-A[k].p.z)-(B[k].p.x-A[k].p.x)*(A[k+1].p.z-A[k].p.z))/2;
        const v=((A[k].p.y-A[k].th)+(A[k+1].p.y-A[k+1].th))/2*s;
        if(v>=0) fillV+=v; else cutV-=v;
      }
    }
  }
  const dirsL=[], dirsR=[];
  for(let i=0;i<N;i++){
    const across=new THREE.Vector3().subVectors(R[i],L[i]).setY(0).normalize();
    dirsL.push(across.clone().multiplyScalar(-1));
    dirsR.push(across.clone());
  }
  const isFillL = G[0][0].y >= TG[0][0];
  skirtRibbon(G.map(r=>r[0]), TG.map(r=>r[0]), dirsL, isFillL?fillN:cutN, isFillL);
  const isFillR = G[0][M-1].y >= TG[0][M-1];
  skirtRibbon(G.map(r=>r[M-1]), TG.map(r=>r[M-1]), dirsR, isFillR?fillN:cutN, isFillR);

  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols,3));
  geo.setIndex(idx); geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors:true, side:THREE.DoubleSide, roughness:0.95, metalness:0,
    transparent:false, opacity:1, flatShading:false,
    polygonOffset:true, polygonOffsetFactor:-1, polygonOffsetUnits:-1
  }));
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);

  // Сетка сегментов: поперечные линии каждые 200 м
  if(state.gridVisible){
    const linePos=[];
    let acc=0; let next=200;
    for(let i=1;i<N;i++){
      acc+=C[i].distanceTo(C[i-1]);
      if(acc>=next){
        next+=200;
        for(let j=0;j<M-1;j++){
          const a=G[i][j], b=G[i][j+1];
          linePos.push(a.x,a.y+0.15,a.z, b.x,b.y+0.15,b.z);
        }
      }
    }
    const lgeo=new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos,3));
    const lines=new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({color:0xffffff, transparent:true, opacity:0.5}));
    g.add(lines);
  }

  const stepM=20;
  let acc=0; const rows=[];
  for(let i=1;i<N;i++){
    acc+=C[i].distanceTo(C[i-1]);
    if(acc>=stepM || i===N-1){
      acc=0;
      const h=Math.max(0.1, C[i].distanceTo(C[i-1]));
      const slope=deg(Math.atan((G[i][4].y-G[i-1][4].y)/h));
      const terrSlope=deg(Math.atan((ground[i]-ground[i-1])/h));
      rows.push({i, slope, terrSlope, c:G[i][4].y, l:G[i][0].y, r:G[i][M-1].y, p:C[i], pl:G[i][0], pr:G[i][M-1], tg:ground[i]});
    }
  }
  const labelDiv=document.getElementById('labels');
  labelDiv.innerHTML = rows.map(r=>
    `<div>Ст. ${r.i}: уклон <b>${r.slope.toFixed(1)}°</b> | H: ${r.c.toFixed(1)} / ${r.l.toFixed(1)} / ${r.r.toFixed(1)} м</div>`
  ).join('') || '-';
  const makeSprite=(text, p, color, small)=>{
    const cnv=document.createElement('canvas'); cnv.width=256; cnv.height=64;
    const ctx=cnv.getContext('2d');
    ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillRect(0,0,256,64);
    ctx.fillStyle=color; ctx.font=(small?'22px':'bold 30px')+' sans-serif'; ctx.textAlign='center';
    ctx.fillText(text,128,small?40:44);
    const tex=new THREE.CanvasTexture(cnv);
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex, depthTest:false}));
    sp.scale.set(small?7:10, small?1.75:2.5, 1); sp.position.copy(p);
    return sp;
  };
  const slopeColor = s => s < 0 ? '#ff8000' : (s < 10 ? '#00ff00' : (s < 15 ? '#0000ff' : (s < 25 ? '#ff0000' : '#000000')));
  rows.forEach(r=>{
    lg.add(makeSprite(r.slope.toFixed(1)+'°', new THREE.Vector3(r.p.x, r.c+7, r.p.z), slopeColor(r.slope)));
    lg.add(makeSprite(r.c.toFixed(1), new THREE.Vector3(r.p.x, r.c+3.5, r.p.z), '#ffffff'));
    lg.add(makeSprite(r.l.toFixed(1), new THREE.Vector3(r.pl.x, r.l+3.5, r.pl.z), '#7fd4ff'));
    lg.add(makeSprite(r.r.toFixed(1), new THREE.Vector3(r.pr.x, r.r+3.5, r.pr.z), '#ffb0a0'));
    const tgl=terrainY(r.pl.x,r.pl.z), tgr=terrainY(r.pr.x,r.pr.z);
    tg.add(makeSprite('орг.: '+r.tg.toFixed(1), new THREE.Vector3(r.p.x, r.tg+0.6, r.p.z), '#cfe3cf', true));
    if(tgl!==null) tg.add(makeSprite('орг.: '+tgl.toFixed(1), new THREE.Vector3(r.pl.x, tgl+0.6, r.pl.z), '#cfe3cf', true));
    if(tgr!==null) tg.add(makeSprite('орг.: '+tgr.toFixed(1), new THREE.Vector3(r.pr.x, tgr+0.6, r.pr.z), '#cfe3cf', true));
    if(state.terrainSlopesVisible){
      lg.add(makeSprite('орг. уклон: '+r.terrSlope.toFixed(1)+'°', new THREE.Vector3(r.p.x, r.tg+4.5, r.p.z), '#7fd4ff', true));
    }
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
    `Баланс: <b>${bal>=0?'+':''}${f(bal)}</b> м³`;
}

async function loadSlopeList(){
  let names=['A1'];
  try{
    const m=await loadJSON('./assets/slopes.json'+bust());
    if(Array.isArray(m) && m.length) names=m.map(String);
  }catch(e){ dbg('slopes.json не найден — использую A1'); }
  const list=document.getElementById('slopeList');
  list.innerHTML='';
  names.forEach((n,i)=>{
    const b=document.createElement('button');
    b.className='slope-btn'+(i===0?' active':'');
    b.dataset.slope=n; b.textContent=n;
    b.addEventListener('click',()=>{
      document.querySelectorAll('.slope-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active'); state.slope=n; loadSlope(n);
    });
    list.appendChild(b);
  });
  return names[0];
}

const loadingEl=document.getElementById('loading');
async function loadSlope(id){
  if(state.root){ scene.remove(state.root); state.root=null; }
  state.terrain=null; state.curves=null; state.terrainMats=[];
  state.designGroup=clearGroup(state.designGroup);
  state.labelsGroup=clearGroup(state.labelsGroup);
  state.terrainLabelsGroup=clearGroup(state.terrainLabelsGroup);
  dbgEl.textContent='';
  document.getElementById('stats').textContent='Загрузка…';
  document.getElementById('mayaLabels').textContent='Загрузка…';
  loadingEl.style.display='flex';
  try{
    const gltf=await loadGLTF(`./assets/${id}.gltf${bust()}`);
    const root=gltf.scene; scene.add(root); state.root=root;
    root.traverse(o=>{
      if((o.name||'').toLowerCase().includes('terrain')){
        state.terrain=o;
        o.traverse(c=>{
          if(c.isMesh){
            const m=new THREE.MeshStandardMaterial({color:0x2f4a2f,roughness:1,side:THREE.DoubleSide});
            c.material=m; m.receiveShadow=true; state.terrainMats.push(m);
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
    await new Promise(r=>setTimeout(r,50));
    rebuild();
  }catch(err){
    const msg=err&&(err.message||err.description)?(err.message||err.description):String(err);
    document.getElementById('stats').textContent='Ошибка загрузки склона "'+id+'": '+msg;
    dbg('ОШИБКА: '+msg);
    console.error(err);
  }finally{
    loadingEl.style.display='none';
  }
}

const map=[['pAng','ang','vAng',v=>v+'°'],['pProf','prof','vProf',v=>v],['pCut','cut','vCut',v=>v.toFixed(1)]];
let timer=null;
map.forEach(([id,key,vid,fm])=>{
  const el=document.getElementById(id);
  el.addEventListener('input',()=>{
    state[key]=parseFloat(el.value);
    document.getElementById(vid).textContent=fm(state[key]);
    clearTimeout(timer);
    timer=setTimeout(()=>{
      loadingEl.style.display='flex';
      setTimeout(()=>{ rebuild(); loadingEl.style.display='none'; },30);
    },150);
  });
});

document.getElementById('apply').addEventListener('click',()=>{
  loadingEl.style.display='flex';
  setTimeout(()=>{ rebuild(); loadingEl.style.display='none'; },30);
});

document.getElementById('pTerrain').addEventListener('change',e=>{
  state.terrainVisible=e.target.checked; applyTerrainLook();
});
document.getElementById('pTerrOp').addEventListener('input',e=>{
  state.terrainOpacity=parseFloat(e.target.value)/100;
  document.getElementById('vTerrOp').textContent=e.target.value+'%';
  applyTerrainLook();
});
document.getElementById('pDesign').addEventListener('change',e=>{
  state.designVisible=e.target.checked; applyDesignLook();
});
document.getElementById('pGrid').addEventListener('change',e=>{
  state.gridVisible=e.target.checked; rebuild();
});
document.getElementById('pLabels').addEventListener('change',e=>{
  state.labelsVisible=e.target.checked; applyDesignLook();
});
document.getElementById('pTerrainLabels').addEventListener('change',e=>{
  state.terrainLabelsVisible=e.target.checked; applyTerrainLook();
});
document.getElementById('pTerrainSlopes').addEventListener('change',e=>{
  state.terrainSlopesVisible=e.target.checked; rebuild();
});
document.getElementById('pLight').addEventListener('input',e=>{
  sun.intensity=parseFloat(e.target.value);
});
document.getElementById('pLightOn').addEventListener('change',e=>{
  sun.visible=e.target.checked;
});

document.querySelectorAll('.slope-btn').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.slope-btn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); state.slope=b.dataset.slope; loadSlope(b.dataset.slope);
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
  localStorage.setItem('ssgo_last_preset', JSON.stringify(preset));
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(preset,null,2)],{type:'application/json'}));
  a.download=`ssgo_preset_${state.slope}_${Date.now()}.json`;
  a.click();
  document.getElementById('stats').innerHTML+='<br><span style="color:#7f7">Параметры сохранены локально и скачаны.</span>';
});

document.getElementById('reset').addEventListener('click',()=>{
  const d={pAng:35,pProf:0,pCut:5};
  for(const k in d){ const e=document.getElementById(k); e.value=d[k]; e.dispatchEvent(new Event('input')); }
});

loadSlopeList().then(first=>loadSlope(first));
(function loop(){ requestAnimationFrame(loop); controls.update(); renderer.render(scene,camera); })();
