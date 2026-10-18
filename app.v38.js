import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

let saved=null;
try{ saved=JSON.parse(localStorage.getItem('ssgo_default_preset')||'null'); }catch(e){}

const state = {
  slope:(saved&&saved.slope)||'A1',
  ang:(saved&&saved.slope_angle)||35,
  prof:(saved&&saved.profile_level)!==undefined&&(saved&&saved.profile_level)!==null?(saved.profile_level):0,
  cut:(saved&&saved.max_cut_depth)||3,
  off:0, cross:0,
  terrainVisible:true, terrainOpacity:1, designVisible:true, gridVisible:true,
  labelsVisible:true, terrainLabelsVisible:true, terrainSlopesVisible:false,
  root:null, terrain:null, terrainMats:[], curves:null,
  designGroup:null, labelsGroup:null, terrainLabelsGroup:null,
  homePos:null, homeTarget:null
};

const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(view.clientWidth, view.clientHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(view.clientWidth, view.clientHeight);
labelRenderer.domElement.style.position='absolute';
labelRenderer.domElement.style.top='0';
labelRenderer.domElement.style.left='0';
labelRenderer.domElement.style.pointerEvents='none';
view.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141418);
const camera = new THREE.PerspectiveCamera(55, view.clientWidth/view.clientHeight, 0.5, 20000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.enableZoom = false;
controls.rotateSpeed = 0.8;
controls.minDistance = 30;
controls.maxDistance = 4000;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a3a2f, 0.9));
const sun = new THREE.DirectionalLight(0xfff4e0, 3.0);
sun.position.set(300, 600, 200);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 3000;
sun.shadow.camera.left = -1200; sun.shadow.camera.right = 1200;
sun.shadow.camera.top = 1200; sun.shadow.camera.bottom = -1200;
sun.shadow.bias = -0.0005;
scene.add(sun);

let targetDist = null;
renderer.domElement.addEventListener('wheel', ev=>{
  ev.preventDefault();
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  let d = dir.length();
  const factor = Math.exp(ev.deltaY * 0.0012);
  d = THREE.MathUtils.clamp(d * factor, 30, 4000);
  targetDist = d;
}, { passive:false });

window.addEventListener('resize', () => {
  camera.aspect = view.clientWidth/view.clientHeight; camera.updateProjectionMatrix();
  renderer.setSize(view.clientWidth, view.clientHeight);
  labelRenderer.setSize(view.clientWidth, view.clientHeight);
});

const dbgEl = document.getElementById('debug');
function dbg(msg){ dbgEl.textContent += msg + "\n"; }
const bust = () => '?t=' + Date.now();
const loader = new GLTFLoader();
const loadGLTF = url => new Promise((res, rej) => loader.load(url, res, undefined, rej));
const loadJSON = url => fetch(url).then(r => { if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); });

function alignDir(ref, pts){
  const d1=Math.hypot(ref[0][0]-pts[0][0],ref[0][2]-pts[0][2])+Math.hypot(ref[ref.length-1][0]-pts[pts.length-1][0],ref[ref.length-1][2]-pts[pts.length-1][2]);
  const d2=Math.hypot(ref[0][0]-pts[pts.length-1][0],ref[0][2]-pts[pts.length-1][2])+Math.hypot(ref[ref.length-1][0]-pts[0][0],ref[ref.length-1][2]-pts[0][2]);
  return d2<d1 ? pts.slice().reverse() : pts;
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
    m.opacity=state.terrainOpacity;
    m.transparent=state.terrainOpacity<1;
  });
  if(state.terrain) state.terrain.visible=state.terrainVisible;
  if(state.terrainLabelsGroup) state.terrainLabelsGroup.visible=state.terrainLabelsVisible;
}
function applyDesignLook(){
  if(state.designGroup) state.designGroup.visible=state.designVisible;
  if(state.labelsGroup) state.labelsGroup.visible=state.labelsVisible;
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
  camera.position.copy(p).addScaledVector(dir,Math.min(dist,200));
  controls.update(); targetDist=null;
});

function goHome(){
  if(state.homePos&&state.homeTarget){
    camera.position.copy(state.homePos);
    controls.target.copy(state.homeTarget);
    controls.update(); targetDist=null;
  }
}
document.getElementById('homeBtn').addEventListener('click',goHome);

// ================== ПОРТ ДВИЖКА MAYA ==================
const p2=p=>[p[0],p[2]];
const hyp=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function signedArea(poly){
  let a=0,n=poly.length;
  for(let i=0;i<n;i++){a+=poly[i][0]*poly[(i+1)%n][1]-poly[(i+1)%n][0]*poly[i][1];}
  return 0.5*a;
}
function pointInPoly(x,z,poly){
  let inside=false,n=poly.length,j=n-1;
  for(let i=0;i<n;i++){
    const xi=poly[i][0],zi=poly[i][1],xj=poly[j][0],zj=poly[j][1];
    if((zi>z)!==(zj>z)){ if(x<(xj-xi)*(z-zi)/(zj-zi)+xi) inside=!inside; }
    j=i;
  }
  return inside;
}
const _orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function segsCross(a,b,c,d){
  const o1=_orient(a,b,c),o2=_orient(a,b,d),o3=_orient(c,d,a),o4=_orient(c,d,b);
  return (o1*o2<0)&&(o3*o4<0);
}
function pointInTri(q,a,b,c){
  const d1=_orient(a,b,q),d2=_orient(b,c,q),d3=_orient(c,a,q);
  return !(((d1<0)||(d2<0)||(d3<0))&&((d1>0)||(d2>0)||(d3>0)));
}
const unit=v=>{const l=Math.hypot(v[0],v[1]);return l<1e-12?[0,0]:[v[0]/l,v[1]/l];};
class TriSampler{
  constructor(verts,tris){
    const xs=verts.map(v=>v[0]),zs=verts.map(v=>v[2]);
    this.minx=Math.min(...xs);this.minz=Math.min(...zs);
    let tot=0,cnt=0;
    for(const t of tris.slice(0,3000)){
      const A=verts[t[0]],B=verts[t[1]],C=verts[t[2]];
      tot+=hyp(p2(A),p2(B))+hyp(p2(B),p2(C))+hyp(p2(C),p2(A));cnt+=3;
    }
    this.cell=Math.max(1e-3,2*(tot/Math.max(1,cnt)));
    this.grid={};this.tri=[];
    tris.forEach((t,ti)=>{
      const A=verts[t[0]],B=verts[t[1]],C=verts[t[2]];
      const den=(B[2]-C[2])*(A[0]-C[0])+(C[0]-B[0])*(A[2]-C[2]);
      const inv=Math.abs(den)<1e-12?0:1/den;
      this.tri.push([A[0],A[2],B[0],B[2],C[0],C[2],A[1],B[1],C[1],inv]);
      if(inv===0)return;
      const x0=Math.min(A[0],B[0],C[0]),x1=Math.max(A[0],B[0],C[0]);
      const z0=Math.min(A[2],B[2],C[2]),z1=Math.max(A[2],B[2],C[2]);
      for(let ix=Math.floor((x0-this.minx)/this.cell);ix<=Math.floor((x1-this.minx)/this.cell);ix++)
        for(let iz=Math.floor((z0-this.minz)/this.cell);iz<=Math.floor((z1-this.minz)/this.cell);iz++){
          const k=ix+','+iz;(this.grid[k]=this.grid[k]||[]).push(ti);
        }
    });
  }
  call(x,z){
    const key=Math.floor((x-this.minx)/this.cell)+','+Math.floor((z-this.minz)/this.cell);
    let best=null;
    for(const ti of (this.grid[key]||[])){
      const t=this.tri[ti];if(t[9]===0)continue;
      const l1=((t[3]-t[5])*(x-t[4])+(t[2]-t[4])*(z-t[5]))*t[9];
      const l2=((t[5]-t[1])*(x-t[4])+(t[0]-t[4])*(z-t[5]))*t[9];
      const l3=1-l1-l2;
      if(l1>=-1e-9&&l2>=-1e-9&&l3>=-1e-9){
        const y=l1*t[6]+l2*t[7]+l3*t[8];
        if(best===null||y>best)best=y;
      }
    }
    return best;
  }
}
class Engine{
  constructor(verts,tris,sampler,P){
    this.V=verts;this.T=tris;this.sampler=sampler;
    this._rcHit=0;this._rcMiss=0;this._triHit=0;
    this.S=(x,z)=>{
      let v=sampler.call(x,z);
      if(v===null){
        const ry=terrainY(x,z);
        if(ry!==null){this._rcHit++;return ry;}
        this._rcMiss++;
        return null;
      }
      this._triHit++;
      return v;
    };
    this.P=P;this.nV=verts.length;
    this.step=P.march_step;
    let pos=0,neg=0;this.edgeFaces={};
    tris.forEach((t,f)=>{
      const A=verts[t[0]],B=verts[t[1]],C=verts[t[2]];
      const cy=(B[2]-A[2])*(C[0]-A[0])-(B[0]-A[0])*(C[2]-A[2]);
      if(cy>0)pos++;else if(cy<0)neg++;
      for(const e of [[t[0],t[1]],[t[1],t[2]],[t[2],t[0]]]){
        const key=e[0]<e[1]?e[0]+','+e[1]:e[1]+','+e[0];
        (this.edgeFaces[key]=this.edgeFaces[key]||[]).push(f);
      }
    });
    this.up=pos>=neg?1:-1;
    let area=0;
    tris.forEach(t=>{
      const A=verts[t[0]],B=verts[t[1]],C=verts[t[2]];
      area+=Math.abs((B[2]-A[2])*(C[0]-A[0])-(B[0]-A[0])*(C[2]-A[2]))*0.5;
    });
    this.area0=area;
  }
  prepare(centre,left,right){
    const P=this.P,n=centre.length;
    const fix=(line,name)=>{
      const fwd=hyp(p2(centre[0]),p2(line[0]))+hyp(p2(centre[n-1]),p2(line[n-1]));
      const rev=hyp(p2(centre[0]),p2(line[n-1]))+hyp(p2(centre[n-1]),p2(line[0]));
      if(rev<fwd){line=line.slice().reverse();dbg(name+' развернута.');}
      return line;
    };
    left=fix(left,'Left');right=fix(right,'Right');
    this.n=n;this.m=P.core_cols;
    this.A=left.map(p2);this.B=right.map(p2);this.C=centre.map(p2);
    const tb=new THREE.Box3().setFromObject(state.terrain);
    const tmin=tb.min,tmax=tb.max;
    dbg('--- ДИАГНОСТИКА ---');
    dbg('Terrain bbox: X['+tmin.x.toFixed(1)+'..'+tmax.x.toFixed(1)+'] Y['+tmin.y.toFixed(1)+'..'+tmax.y.toFixed(1)+'] Z['+tmin.z.toFixed(1)+'..'+tmax.z.toFixed(1)+']');
    let cminx=1e9,cmaxx=-1e9,cminz=1e9,cmaxz=-1e9,cminy=1e9,cmaxy=-1e9;
    centre.forEach(p=>{cminx=Math.min(cminx,p[0]);cmaxx=Math.max(cmaxx,p[0]);cminz=Math.min(cminz,p[2]);cmaxz=Math.max(cmaxz,p[2]);cminy=Math.min(cminy,p[1]);cmaxy=Math.max(cmaxy,p[1]);});
    dbg('Centre bbox: X['+cminx.toFixed(1)+'..'+cmaxx.toFixed(1)+'] Y(Z кривой)['+cminy.toFixed(1)+'..'+cmaxy.toFixed(1)+'] Z['+cminz.toFixed(1)+'..'+cmaxz.toFixed(1)+']');
    const gc=[];
    let missCount=0;
    for(let i=0;i<n;i++){
      const v=this.S(this.C[i][0],this.C[i][1]);
      if(v===null){gc.push(null);missCount++;}
      else gc.push(v);
    }
    dbg('Центральные станции: TriSampler='+this._triHit+', raycast='+this._rcHit+', не найдено='+missCount);
    let diffSum=0,diffCnt=0;
    for(let i=0;i<n;i++){
      if(gc[i]!==null){
        const dz=gc[i]-centre[i][1];
        diffSum+=dz;diffCnt++;
      }
    }
    if(diffCnt)dbg('Средняя разница (terrainY - Z кривой): '+(diffSum/diffCnt).toFixed(2)+' м по '+diffCnt+' станциям.');
    const valid=gc.map((v,i)=>v!==null?i:-1).filter(i=>i>=0);
    if(valid.length){
      for(let i=0;i<n;i++){
        if(gc[i]!==null)continue;
        let prev=-1,next=-1;
        for(const vi of valid){if(vi<i)prev=vi;if(vi>i){next=vi;break;}}
        if(prev<0&&next>=0)gc[i]=gc[next];
        else if(next<0&&prev>=0)gc[i]=gc[prev];
        else if(prev>=0&&next>=0){
          const t=(i-prev)/(next-prev);
          gc[i]=gc[prev]+(gc[next]-gc[prev])*t;
        }
      }
    }
    for(let i=0;i<n;i++)if(gc[i]===null)gc[i]=centre[i][1];
    let gmin=1e9,gmax=-1e9;
    gc.forEach(v=>{gmin=Math.min(gmin,v);gmax=Math.max(gmax,v);});
    dbg('Высоты рельефа по оси: min='+gmin.toFixed(1)+', max='+gmax.toFixed(1)+' м.');
    let prof=centre.map(p=>p[1]);
    for(let k=0;k<P.profile_passes;k++){
      const old=prof.slice();
      for(let i=1;i<n-1;i++){
        const a=Math.max(0,i-2),b=Math.min(n,i+3);
        let s=0;for(let j=a;j<b;j++)s+=old[j];
        prof[i]=s/(b-a);
      }
    }
    dbg('Профиль оси: из Z кривой (сглажено '+P.profile_passes+' проходов).');
    this.groundC=gc;this.prof=prof;
    this.G=[];this.TG=[];this.u=[];
    for(let i=0;i<n;i++){
      const e=unit([this.B[i][0]-this.A[i][0],this.B[i][1]-this.A[i][1]]);
      const row=[],trow=[],urow=[];
      for(let j=0;j<this.m;j++){
        const t=j/(this.m-1);
        const q=[this.A[i][0]+(this.B[i][0]-this.A[i][0])*t,this.A[i][1]+(this.B[i][1]-this.A[i][1])*t];
        let z=this.S(q[0],q[1]);if(z===null)z=prof[i];
        row.push(q);trow.push(z);
        urow.push((q[0]-this.C[i][0])*e[0]+(q[1]-this.C[i][1])*e[1]);
      }
      this.G.push(row);this.TG.push(trow);this.u.push(urow);
    }
    this.cellArea=[];
    for(let i=0;i<n-1;i++){
      const row=[];
      for(let j=0;j<this.m-1;j++)row.push(Math.abs(signedArea([this.G[i][j],this.G[i][j+1],this.G[i+1][j+1],this.G[i+1][j]])));
      this.cellArea.push(row);
    }
    let steep=[];
    for(let i=1;i<n;i++){
      const h=hyp(this.C[i],this.C[i-1]);
      if(h>0.1){
        const s=Math.atan2(prof[i]-prof[i-1],h)*180/Math.PI;
        if(Math.abs(s)>25)steep.push(i+':'+s.toFixed(0)+'°');
      }
    }
    dbg('Станции с уклоном профиля >25°: '+(steep.length?steep.slice(0,15).join(', ')+(steep.length>15?' …':''):'нет'));
    dbg('--- КОНЕЦ ДИАГНОСТИКИ ---');
  }
  makeRays(limitPoly){
    const P=this.P,n=this.n,m=this.m;
    const loop=[];
    for(let i=0;i<n;i++)loop.push([i,0]);
    for(let j=1;j<m;j++)loop.push([n-1,j]);
    for(let i=n-2;i>=0;i--)loop.push([i,m-1]);
    for(let j=m-2;j>0;j--)loop.push([0,j]);
    this.loop=loop;
    const q=loop.map(ij=>this.G[ij[0]][ij[1]]);
    const area=signedArea(q),sgn=area>0?1:-1;
    const outn=e=>[sgn*e[1],-sgn*e[0]];
    const theta=[],ds=[],rays=[];
    for(let k=0;k<q.length;k++){
      const qp=q[(k-1+q.length)%q.length],qc=q[k],qn=q[(k+1)%q.length];
      const ep=unit([qc[0]-qp[0],qc[1]-qp[1]]),en=unit([qn[0]-qc[0],qn[1]-qc[1]]);
      const cr=ep[0]*en[1]-ep[1]*en[0],dt=ep[0]*en[0]+ep[1]*en[1];
      theta.push(sgn*Math.atan2(cr,dt));
      ds.push(0.5*(hyp(qp,qc)+hyp(qc,qn)));
      const np_=outn(ep),nn=outn(en);
      const ang=Math.abs(Math.atan2(np_[0]*nn[1]-np_[1]*nn[0],np_[0]*nn[0]+np_[1]*nn[1]))*180/Math.PI;
      if(ang>P.corner_deg){
        const F=Math.max(1,Math.ceil(ang/P.fan_deg));
        const a0=Math.atan2(np_[1],np_[0]);
        const dl=Math.atan2(np_[0]*nn[1]-np_[1]*nn[0],np_[0]*nn[0]+np_[1]*nn[1]);
        for(let f=0;f<=F;f++){
          const aa=a0+dl*f/F;
          rays.push({k,p:qc,n:[Math.cos(aa),Math.sin(aa)],corner:true});
        }
      } else rays.push({k,p:qc,n:unit([np_[0]+nn[0],np_[1]+nn[1]]),corner:false});
    }
    this.rays=rays;
    const w=3,clamp=new Array(q.length).fill(1e9);
    for(let k=0;k<q.length;k++){
      let st=0,sd=0;
      for(let o=-w;o<=w;o++){st+=theta[(k+o+q.length)%q.length];sd+=ds[(k+o+q.length)%q.length];}
      const kap=st/Math.max(sd,1e-9);
      if(kap<-1e-6)clamp[k]=P.curv_factor/Math.abs(kap);
    }
    const kmax=Math.floor(P.max_skirt/this.step);
    for(const ray of rays){
      const px=ray.p[0],pz=ray.p[1],nx=ray.n[0],nz=ray.n[1];
      let T=[];
      for(let kk=0;kk<=kmax;kk++){
        const s=kk*this.step,x=px+nx*s,z=pz+nz*s;
        if(limitPoly&&!pointInPoly(x,z,limitPoly))break;
        const h=this.S(x,z);
        if(h===null)break;
        T.push(h);
      }
      if(!T.length)T=[this.TG[loop[ray.k][0]][loop[ray.k][1]]];
      ray.T=T;
      let dcl=(T.length-1)*this.step;
      if(clamp[ray.k]<dcl)dcl=clamp[ray.k];
      ray.dclamp=dcl;
    }
  }
  design(off,cross){
    const n=this.n,m=this.m;
    const zc=this.prof.map(v=>v+off);
    const Z=[];
    for(let i=0;i<n;i++){
      const row=[];
      for(let j=0;j<m;j++)row.push(zc[i]-cross*this.u[i][j]);
      Z.push(row);
    }
    const mc=this.P.max_cut_depth;
    if(mc>0){
      for(let i=0;i<n;i++){
        const floorI=Math.min(...this.TG[i])-mc;
        if(zc[i]<floorI)zc[i]=floorI;
        for(let j=0;j<m;j++){
          const floor=this.TG[i][j]-mc;
          if(Z[i][j]<floor)Z[i][j]=floor;
        }
      }
    }
    const zl=this.loop.map(ij=>Z[ij[0]][ij[1]]);
    return {zc,Z,zl};
  }
  static tget(T,step,s){
    if(s<=0)return T[0];
    const f=s/step,k=Math.floor(f);
    if(k>=T.length-1)return T[T.length-1];
    return T[k]+(T[k+1]-T[k])*(f-k);
  }
  solveRays(zl,fillN,cutN){
    const P=this.P,step=this.step,R=this.rays.length;
    const d=new Array(R).fill(0),mode=new Array(R).fill(1),forced=new Array(R).fill(0);
    this.rays.forEach((ray,r)=>{
      const T=ray.T,K=T.length,ze=zl[ray.k];
      const diff0=ze-T[0];
      let slope,mm;
      if(diff0>=0){slope=-1/fillN;mm=1;}else{slope=1/cutN;mm=-1;}
      let prev=diff0,found=null;
      for(let k=1;k<K;k++){
        const dk=ze+slope*k*step-T[k];
        if((mm===1&&dk<=0)||(mm===-1&&dk>=0)){
          const t=prev!==dk?prev/(prev-dk):1;
          found=(k-1+t)*step;break;
        }
        prev=dk;
      }
      let dd;
      if(found===null){dd=ray.dclamp;forced[r]=1;}
      else if(found>ray.dclamp){dd=ray.dclamp;forced[r]=1;}
      else dd=found;
      d[r]=dd;mode[r]=mm;
    });
    for(let p=0;p<P.smooth_passes;p++){
      const old=d.slice();
      for(let r=0;r<R;r++)d[r]=(old[(r-1+R)%R]+2*old[r]+old[(r+1)%R])*0.25;
    }
    const dmin=P.min_skirt,zout=new Array(R).fill(0);
    this.rays.forEach((ray,r)=>{
      if(d[r]>ray.dclamp)d[r]=ray.dclamp;
      if(d[r]<dmin){d[r]=dmin;if(forced[r]===0)forced[r]=2;}
      zout[r]=Engine.tget(ray.T,step,d[r]);
    });
    return {d,zout,mode,forced};
  }
  volumes(Z,zl,d,zout){
    const n=this.n,m=this.m;let cut=0,fill=0;
    for(let i=0;i<n-1;i++)for(let j=0;j<m-1;j++){
      const df=0.25*((Z[i][j]-this.TG[i][j])+(Z[i+1][j]-this.TG[i+1][j])+(Z[i][j+1]-this.TG[i][j+1])+(Z[i+1][j+1]-this.TG[i+1][j+1]));
      const v=df*this.cellArea[i][j];
      if(v>=0)fill+=v;else cut-=v;
    }
    const step=this.step;
    this.rays.forEach((ray,r)=>{
      const T=ray.T,K=T.length,D=d[r],ze=zl[ray.k],zo=zout[r];
      let k=0;
      while(k*step<D){
        const sa=k*step,sb=Math.min((k+1)*step,D);
        const za=ze+(zo-ze)*sa/D,zb=ze+(zo-ze)*sb/D;
        const ta=T[Math.min(k,K-1)],tb=Engine.tget(T,step,sb);
        const v=0.5*((za-ta)+(zb-tb))*step*(sb-sa);
        if(v>=0)fill+=v;else cut-=v;
        k++;
      }
    });
    return {cut,fill};
  }
  evaluate(off,cross,fillN,cutN){
    const P=this.P;
    const {zc,Z,zl}=this.design(off,cross);
    const {d,zout}=this.solveRays(zl,fillN,cutN);
    const {cut,fill}=this.volumes(Z,zl,d,zout);
    const usable=cut*P.usable,bal=usable-fill;
    return {off,cross,fillN,cutN,cut,fill,usable,bal};
  }
  labelRows(best){
    const n=this.n,m=this.m;
    const {Z}=this.design(best.off,best.cross);
    const mid=Math.floor(m/2);
    const step=Math.max(1,Math.round(20/Math.max(0.5,this.P.spacing)));
    const idxs=[];for(let i=0;i<n;i+=step)idxs.push(i);
    if(idxs[idxs.length-1]!==n-1)idxs.push(n-1);
    const rows=[];let prev=null;
    for(const i of idxs){
      const cp=[this.C[i][0],Z[i][mid],this.C[i][1]];
      const lp=[this.A[i][0],Z[i][0],this.A[i][1]];
      const rp=[this.B[i][0],Z[i][m-1],this.B[i][1]];
      let slope=null;
      if(prev){
        const h=hyp([cp[0],cp[2]],[prev[0],prev[2]]);
        slope=h<=0.1?0:Math.atan2(cp[1]-prev[1],h)*180/Math.PI;
      }
      rows.push({station:i,centerPoint:cp,leftPoint:lp,rightPoint:rp,slope,centerHeight:cp[1],leftHeight:lp[1],rightHeight:rp[1]});
      prev=cp;
    }
    return rows;
  }
}
// ================== КОНЕЦ ДВИЖКА ==================

function rebuild(){
  if(!state.terrain||!state.curves) return;
  state.designGroup=clearGroup(state.designGroup);
  state.labelsGroup=clearGroup(state.labelsGroup);
  state.terrainLabelsGroup=clearGroup(state.terrainLabelsGroup);
  const g=new THREE.Group();state.designGroup=g;scene.add(g);
  const lg=new THREE.Group();state.labelsGroup=lg;scene.add(lg);
  const tg=new THREE.Group();state.terrainLabelsGroup=tg;scene.add(tg);
  applyDesignLook();applyTerrainLook();

  const verts=[],tris=[];
  state.terrain.updateMatrixWorld(true);
  state.terrain.traverse(o=>{
    if(o.isMesh&&o.geometry){
      const geo=o.geometry,pos=geo.attributes.position,vBase=verts.length,v=new THREE.Vector3();
      for(let i=0;i<pos.count;i++){
        v.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld);
        verts.push([v.x,v.y,v.z]);
      }
      const index=geo.index;
      if(index){
        for(let i=0;i<index.count;i+=3)tris.push([vBase+index.getX(i),vBase+index.getX(i+1),vBase+index.getX(i+2)]);
      } else {
        for(let i=0;i<pos.count;i+=3)tris.push([vBase+i,vBase+i+1,vBase+i+2]);
      }
    }
  });
  dbg('Terrain: '+verts.length+' вершин, '+tris.length+' треугольников.');
  const sampler=new TriSampler(verts,tris);
  const cv=state.curves;
  const P={
    spacing:5,core_cols:9,skirt_rings:6,march_step:1.0,min_skirt:2.0,max_skirt:60.0,
    smooth_passes:3,profile_passes:state.prof*2,corner_deg:25,fan_deg:20,curv_factor:0.85,
    slope_angle:state.ang,max_cut_depth:state.cut,usable:0.9,
    fill_n:1/Math.tan(THREE.MathUtils.degToRad(state.ang)),
    cut_n:1/Math.tan(THREE.MathUtils.degToRad(state.ang))
  };
  const eng=new Engine(verts,tris,sampler,P);
  let C=cv.centre.map(p=>[p[0],p[1],p[2]]);
  let L=alignDir(C,cv.left.map(p=>[p[0],p[1],p[2]]));
  let R=alignDir(C,cv.right.map(p=>[p[0],p[1],p[2]]));
  // Прореживание до шага spacing (как в Maya: 94 станции из 200 точек)
  const spacing=P.spacing;
  const keep=[0];let acc=0;
  for(let i=1;i<C.length;i++){
    acc+=hyp(p2(C[i]),p2(C[keep[keep.length-1]]));
    if(acc>=spacing){keep.push(i);acc=0;}
  }
  if(keep[keep.length-1]!==C.length-1)keep.push(C.length-1);
  C=keep.map(i=>C[i]);L=keep.map(i=>L[i]);R=keep.map(i=>R[i]);
  dbg('Коридор: '+C.length+' станций (прорежено до '+spacing+' м).');
  eng.prepare(C,L,R);
  const limitPoly=(cv.limit&&cv.limit.length)?cv.limit.map(p=>[p[0],p[2]]):null;
  eng.makeRays(limitPoly);
  dbg('Лучей: '+eng.rays.length);
  const best=eng.evaluate(state.off,state.cross,P.fill_n,P.cut_n);
  const {Z,zl}=eng.design(state.off,state.cross);
  const {d,zout}=eng.solveRays(zl,P.fill_n,P.cut_n);
  const n=eng.n,m=eng.m,S=P.skirt_rings;

  const pos=[],cols=[],idx=[];
  const zoneOf=dz=>dz>0.02?[0.35,0.55,0.85]:(dz<-0.02?[0.82,0.48,0.36]:[0.76,0.74,0.70]);
  function addTri(a,b,c,col){
    const ar=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
    if(Math.abs(ar)<1e-9)return;
    if(ar*eng.up<0){const t=b;b=c;c=t;}
    const base=pos.length/3;
    for(const p of [a,b,c]){pos.push(p[0],p[1],p[2]);cols.push(...col);}
    idx.push(base,base+1,base+2);
  }
  function addQuad(a,b,c,dd,col){addTri(a,b,c,col);addTri(a,c,dd,col);}
  const IDc=[];
  for(let i=0;i<n;i++){
    const row=[];
    for(let j=0;j<m;j++)row.push([eng.G[i][j][0],Z[i][j],eng.G[i][j][1]]);
    IDc.push(row);
  }
  for(let i=0;i<n-1;i++)for(let j=0;j<m-1;j++){
    const a=IDc[i][j],b=IDc[i][j+1],c=IDc[i+1][j+1],e=IDc[i+1][j];
    const dz=0.25*((a[1]-eng.TG[i][j])+(b[1]-eng.TG[i][j+1])+(c[1]-eng.TG[i+1][j+1])+(e[1]-eng.TG[i+1][j]));
    addQuad(a,b,c,e,zoneOf(dz));
  }
  const rid=[],zex=[];
  eng.rays.forEach((ray,r)=>{
    const i=eng.loop[ray.k][0],j=eng.loop[ray.k][1];
    const ze=zl[ray.k],px=ray.p[0],pz=ray.p[1],nx=ray.n[0],nz=ray.n[1];
    const ox=px+nx*d[r],oz=pz+nz*d[r];
    let zo=eng.S(ox,oz);if(zo===null)zo=zout[r];
    zex.push(zo);
    const col=[IDc[i][j]];
    for(let k=1;k<=S;k++){
      const s=d[r]*k/S,zz=ze+(zo-ze)*k/S;
      col.push([px+nx*s,zz,pz+nz*s]);
    }
    rid.push(col);
  });
  for(let r=0;r<eng.rays.length;r++){
    const r2=(r+1)%eng.rays.length;
    for(let k=0;k<S;k++){
      const a=rid[r][k],b=rid[r2][k],c=rid[r2][k+1],e=rid[r][k+1];
      const za=eng.S(a[0],a[2])||a[1],zb=eng.S(b[0],b[2])||b[1];
      const zc2=eng.S(c[0],c[2])||c[1],ze2=eng.S(e[0],e[2])||e[1];
      const dz=0.25*((a[1]-za)+(b[1]-zb)+(c[1]-zc2)+(e[1]-ze2));
      addQuad(a,b,c,e,zoneOf(dz));
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));
  geo.setIndex(idx);geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:0.95,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  mesh.castShadow=true;mesh.receiveShadow=true;
  g.add(mesh);

  if(state.gridVisible){
    const rows=eng.labelRows(best);
    const linePos=[];
    for(const r of rows){
      const i=eng.C.findIndex(c=>c[0]===r.centerPoint[0]&&c[2]===r.centerPoint[2]);
      if(i<0||i>=n-1)continue;
      for(let j=0;j<m-1;j++){
        const a=IDc[i][j],b=IDc[i][j+1];
        linePos.push(a[0],a[1]+0.2,a[2],b[0],b[1]+0.2,b[2]);
      }
    }
    const lgeo=new THREE.BufferGeometry();
    lgeo.setAttribute('position',new THREE.Float32BufferAttribute(linePos,3));
    const lines=new THREE.LineSegments(lgeo,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:0.85}));
    lines.renderOrder=1;g.add(lines);
  }

  const rows=eng.labelRows(best);
  const labelDiv=document.getElementById('labels');
  labelDiv.innerHTML=rows.map(r=>{
    const s=r.slope===null?'—':r.slope.toFixed(1);
    return '<div>Ст. '+r.station+': уклон <b>'+s+'°</b> | H: '+r.centerHeight.toFixed(1)+' / '+r.leftHeight.toFixed(1)+' / '+r.rightHeight.toFixed(1)+' м</div>';
  }).join('')||'-';
  const makeLabel=(text,p,color,small)=>{
    const div=document.createElement('div');
    div.className='lbl'+(small?' lbl-small':'');
    div.textContent=text;
    div.style.color=color;
    const obj=new CSS2DObject(div);
    obj.position.copy(p);
    return obj;
  };
  const slopeColor=s=>s<0?'#ff9a3c':(s<10?'#5cff7a':(s<15?'#6aa8ff':(s<25?'#ff5c5c':'#ffffff')));
  rows.forEach(r=>{
    const i=eng.C.findIndex(c=>c[0]===r.centerPoint[0]&&c[2]===r.centerPoint[2]);
    if(i<0)return;
    const c=IDc[i][Math.floor(m/2)],l=IDc[i][0],rr=IDc[i][m-1];
    const tg=eng.groundC[i];
    lg.add(makeLabel((r.slope===null?'—':r.slope.toFixed(1))+'°',new THREE.Vector3(c[0],c[1]+16,c[2]),slopeColor(r.slope===null?0:r.slope)));
    lg.add(makeLabel('H '+r.centerHeight.toFixed(1),new THREE.Vector3(c[0],c[1]+8,c[2]),'#ffffff'));
    lg.add(makeLabel(r.leftHeight.toFixed(1),new THREE.Vector3(l[0],l[1]+8,l[2]),'#7fd4ff'));
    lg.add(makeLabel(r.rightHeight.toFixed(1),new THREE.Vector3(rr[0],rr[1]+8,rr[2]),'#ffb0a0'));
    tg.add(makeLabel('орг. '+eng.groundC[i].toFixed(1),new THREE.Vector3(c[0],eng.groundC[i]-5,c[2]),'#cfe3cf',true));
    const tgl=terrainY(l[0],l[2]),tgr=terrainY(rr[0],rr[2]);
    tg.add(makeLabel('орг. '+(tgl!==null?tgl.toFixed(1):'-'),new THREE.Vector3(l[0],l[1]-5,l[2]),'#cfe3cf',true));
    tg.add(makeLabel('орг. '+(tgr!==null?tgr.toFixed(1):'-'),new THREE.Vector3(rr[0],rr[1]-5,rr[2]),'#cfe3cf',true));
    if(state.terrainSlopesVisible&&r.slope!==null){
      lg.add(makeLabel('орг. уклон '+r.slope.toFixed(1)+'°',new THREE.Vector3(c[0],eng.groundC[i]+11,c[2]),'#7fd4ff',true));
    }
  });

  const f=v=>Math.round(v).toLocaleString('ru-RU');
  document.getElementById('stats').innerHTML=
    'Угол откоса: <b>'+state.ang+'°</b> (1:'+best.fillN.toFixed(2)+')<br>'+
    'Срезано: <b>'+f(best.cut)+'</b> м³<br>'+
    'Пригодно к использованию: <b>'+f(best.usable)+'</b> м³ (90%)<br>'+
    'Насыпано: <b>'+f(best.fill)+'</b> м³<br>'+
    'Требуется привезти: <b>'+f(Math.max(0,best.fill-best.usable))+'</b> м³<br>'+
    'Останется вывезти: <b>'+f(Math.max(0,best.usable-best.fill))+'</b> м³<br>'+
    'Баланс: <b>'+(best.bal>=0?'+':'')+f(best.bal)+'</b> м³';
}

async function loadSlopeList(){
  let names=['A1'];
  try{
    const m=await loadJSON('./assets/slopes.json'+bust());
    if(Array.isArray(m)&&m.length)names=m.map(String);
  }catch(e){dbg('slopes.json не найден — использую A1');}
  const list=document.getElementById('slopeList');
  list.innerHTML='';
  names.forEach(n=>{
    const b=document.createElement('button');
    b.className='slope-btn'+(n===state.slope?' active':'');
    b.dataset.slope=n;b.textContent=n;
    b.addEventListener('click',()=>{
      document.querySelectorAll('.slope-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');state.slope=n;loadSlope(n);
    });
    list.appendChild(b);
  });
  return state.slope;
}

const loadingEl=document.getElementById('loading');
async function loadSlope(id){
  if(state.root){scene.remove(state.root);state.root=null;}
  state.terrain=null;state.curves=null;state.terrainMats=[];
  state.designGroup=clearGroup(state.designGroup);
  state.labelsGroup=clearGroup(state.labelsGroup);
  state.terrainLabelsGroup=clearGroup(state.terrainLabelsGroup);
  dbgEl.textContent='';
  document.getElementById('stats').textContent='Загрузка…';
  loadingEl.style.display='flex';
  try{
    const gltf=await loadGLTF('./assets/'+id+'.gltf'+bust());
    const root=gltf.scene;scene.add(root);state.root=root;
    root.traverse(o=>{
      if((o.name||'').toLowerCase().includes('terrain')){
        state.terrain=o;
        o.traverse(c=>{
          if(c.isMesh){
            const m=new THREE.MeshStandardMaterial({color:0x2f4a2f,roughness:1,side:THREE.DoubleSide});
            c.material=m;m.receiveShadow=true;state.terrainMats.push(m);
          }
        });
      }
    });
    applyTerrainLook();
    root.updateMatrixWorld(true);
    dbg('Terrain загружен.');
    const cv=await loadJSON('./assets/'+id+'.curves.json'+bust());
    state.curves=cv;
    dbg('Кривые загружены: centre '+(cv.centre||[]).length+', left '+(cv.left||[]).length+', right '+(cv.right||[]).length);
    const mayaEl=document.getElementById('mayaLabels');
    mayaEl.textContent='Загрузка подписей Maya…';
    let mayaLoaded=false;
    try{
      const m=await loadJSON('./assets/'+id+'_labels.json'+bust());
      const rows=(m&&Array.isArray(m.labels))?m.labels:[];
      if(rows.length){
        mayaEl.textContent=rows.map(r=>{
          const s=(r.slope_deg===null||r.slope_deg===undefined)?'—':Number(r.slope_deg).toFixed(1);
          return 'Ст. '+r.station+': уклон '+s+'° | H: '+Number(r.h_center).toFixed(1)+' / '+Number(r.h_left).toFixed(1)+' / '+Number(r.h_right).toFixed(1)+' м';
        }).join('\n');
        mayaLoaded=true;
        dbg('Подписи Maya загружены: '+rows.length+' станций');
      }
    }catch(e){}
    if(!mayaLoaded){mayaEl.textContent='Нет данных — файл '+id+'_labels.json не найден в assets/ (сначала ЗАПУСК в Maya).';}
    const box=new THREE.Box3().setFromObject(root);
    const ctr=box.getCenter(new THREE.Vector3()),sz=box.getSize(new THREE.Vector3()).length();
    camera.position.set(ctr.x+sz*.5,ctr.y+sz*.5,ctr.z+sz*.7);
    controls.target.copy(ctr);controls.update();
    state.homePos=camera.position.clone();
    state.homeTarget=controls.target.clone();
    await new Promise(r=>setTimeout(r,50));
    try{
      rebuild();
    }catch(e){
      dbg('ОШИБКА РАСЧЁТА: '+(e&&e.message?e.message:String(e)));
      console.error(e);
      document.getElementById('stats').textContent='Ошибка расчёта: '+(e&&e.message?e.message:String(e));
    }
  }catch(err){
    const msg=err&&(err.message||err.description)?(err.message||err.description):String(err);
    document.getElementById('stats').textContent='Ошибка загрузки склона "'+id+'": '+msg;
    dbg('ОШИБКА: '+msg);
    console.error(err);
  }finally{
    loadingEl.style.display='none';
  }
}

const map=[['pAng','ang','vAng',v=>v+'°'],['pProf','prof','vProf',v=>v],['pCut','cut','vCut',v=>v.toFixed(1)],['pOff','off','vOff',v=>v],['pCross','cross','vCross',v=>v]];
let timer=null;
function scheduleRebuild(delay=150){
  clearTimeout(timer);
  timer=setTimeout(()=>{
    loadingEl.style.display='flex';
    setTimeout(()=>{
      try{rebuild();}catch(e){dbg('ОШИБКА РАСЧЁТА: '+(e&&e.message?e.message:String(e)));console.error(e);}
      loadingEl.style.display='none';
    },30);
  },delay);
}
map.forEach(([id,key,vid,fm])=>{
  const el=document.getElementById(id);
  const vEl=document.getElementById(vid);
  if(!el||!vEl){console.warn('Нет элемента',id,vid);return;}
  el.value=state[key];
  vEl.textContent=fm(state[key]);
  el.addEventListener('input',()=>{
    state[key]=parseFloat(el.value);
    vEl.textContent=fm(state[key]);
    scheduleRebuild();
  });
});

document.getElementById('apply').addEventListener('click',()=>{
  loadingEl.style.display='flex';
  setTimeout(()=>{
    try{rebuild();}catch(e){dbg('ОШИБКА РАСЧЁТА: '+(e&&e.message?e.message:String(e)));console.error(e);}
    loadingEl.style.display='none';
  },30);
});

document.getElementById('pTerrain').addEventListener('change',e=>{
  state.terrainVisible=e.target.checked;applyTerrainLook();
});
document.getElementById('pTerrOp').addEventListener('input',e=>{
  state.terrainOpacity=parseFloat(e.target.value)/100;
  document.getElementById('vTerrOp').textContent=e.target.value+'%';
  applyTerrainLook();
});
document.getElementById('pDesign').addEventListener('change',e=>{
  state.designVisible=e.target.checked;applyDesignLook();
});
document.getElementById('pGrid').addEventListener('change',e=>{
  state.gridVisible=e.target.checked;scheduleRebuild(50);
});
document.getElementById('pLabels').addEventListener('change',e=>{
  state.labelsVisible=e.target.checked;applyDesignLook();
});
document.getElementById('pTerrainLabels').addEventListener('change',e=>{
  state.terrainLabelsVisible=e.target.checked;applyTerrainLook();
});
document.getElementById('pTerrainSlopes').addEventListener('change',e=>{
  state.terrainSlopesVisible=e.target.checked;scheduleRebuild(50);
});
document.getElementById('pLight').addEventListener('input',e=>{
  sun.intensity=parseFloat(e.target.value);
});
document.getElementById('pSunRot').addEventListener('input',e=>{
  const a=THREE.MathUtils.degToRad(parseFloat(e.target.value));
  const r=700;
  sun.position.set(Math.cos(a)*r,600,Math.sin(a)*r);
});
const shadowSizes=[1024,2048,4096,8192];
document.getElementById('pShadow').addEventListener('input',e=>{
  const s=shadowSizes[parseInt(e.target.value)];
  if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}
  sun.shadow.mapSize.set(s,s);
});
document.getElementById('pLightOn').addEventListener('change',e=>{
  sun.visible=e.target.checked;
});

document.querySelectorAll('.slope-btn').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.slope-btn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');state.slope=b.dataset.slope;loadSlope(b.dataset.slope);
}));

document.getElementById('save').addEventListener('click',()=>{
  const fillN=1/Math.tan(THREE.MathUtils.degToRad(state.ang));
  const preset={
    version:'web-preset-2',slope:state.slope,slope_angle:state.ang,
    profile_level:state.prof,max_cut_depth:state.cut,offset:state.off,
    crossfall_percent:state.cross,fill_n:parseFloat(fillN.toFixed(4)),
    cut_n:parseFloat(fillN.toFixed(4)),saved_at:new Date().toISOString()
  };
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(preset,null,2)],{type:'application/json'}));
  a.download='ssgo_preset_'+state.slope+'_'+Date.now()+'.json';
  a.click();
});

document.getElementById('reset').addEventListener('click',()=>{
  localStorage.removeItem('ssgo_default_preset');
  const d={pAng:35,pProf:0,pCut:3,pOff:0,pCross:0};
  for(const k in d){const e=document.getElementById(k);if(e){e.value=d[k];e.dispatchEvent(new Event('input'));}}
});

loadSlopeList().then(first=>loadSlope(first));
(function loop(){
  requestAnimationFrame(loop);
  if(targetDist!==null){
    const dir=new THREE.Vector3().subVectors(camera.position,controls.target);
    const cur=dir.length();
    const nd=THREE.MathUtils.lerp(cur,targetDist,0.15);
    if(Math.abs(nd-targetDist)<0.5)targetDist=null;
    camera.position.copy(controls.target).addScaledVector(dir.normalize(),nd);
  }
  controls.update();
  renderer.render(scene,camera);
  labelRenderer.render(scene,camera);
})();
