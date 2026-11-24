import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { SkierController } from './skier-controller.v98.js';
import { DroneController } from './drone-controller.v76.js';
import { WeatherSystem } from './weather-system.v7.js';
import { CameraOptics } from './camera-optics.v2.js';
import { ResortMultiplayer } from './multiplayer.v10.js';
import { MULTIPLAYER_SERVER_URL } from './multiplayer-config.v1.js';

let saved=null;
try{ saved=JSON.parse(localStorage.getItem('ssgo_default_preset')||'null'); }catch(e){}
const SLOPE_ANALYSIS_LAYER_SETTINGS_KEY='go_slope_analysis_layer_settings_v2';
let savedSlopeLayerSettings=null;
try{
  savedSlopeLayerSettings=JSON.parse(localStorage.getItem(SLOPE_ANALYSIS_LAYER_SETTINGS_KEY)||'null');
  if(!savedSlopeLayerSettings){
    const legacySettings=JSON.parse(localStorage.getItem('go_slope_analysis_layer_settings_v1')||'null');
    if(legacySettings&&typeof legacySettings==='object'){
      savedSlopeLayerSettings={...legacySettings,opacity:{...(legacySettings.opacity||{}),names:0.65}};
    }
  }
}catch(e){}
const clampSlopeOpacity=(value,fallback=1)=>{
  const number=Number(value);
  return Number.isFinite(number)?Math.max(0,Math.min(1,number)):fallback;
};
const clampSlopeDistance=(value,fallback=900)=>{
  const number=Number(value);
  return Number.isFinite(number)?Math.max(0,Math.min(1500,number)):fallback;
};

const state = {
  slope:(saved&&saved.slope)||'A1',
  ang:(saved&&saved.slope_angle)||35,
  prof:(saved&&saved.profile_level)!==undefined&&(saved&&saved.profile_level)!==null?(saved.profile_level):0,
  cut:(saved&&saved.max_cut_depth)||5,
  off:-0.75, cross:0.264, optimize:false,
usable:90, earthwork_w:0.03, max_fill:0, off_range:3, cross_max:3, labelOpacity:1,
  terrainVisible:true, terrainOpacity:1, designVisible:true, gridVisible:true,
  labelsVisible:true, terrainLabelsVisible:true, terrainSlopesVisible:false,
  root:null, terrain:null, terrainMats:[], curves:null,
  designGroup:null, labelsGroup:null, terrainLabelsGroup:null,
  homePos:null, homeTarget:null, savedOverviewCameras:{}, mode:'overview', dayTime:13.5, autoTime:false, optimizeMode:false,
  forestGroup:null, billboardMesh:null, billboardMeshes:[], billboardTrees:[],
  importedAssets:[], baseTerrain:null, baseTerrainMats:[], activeTerrainAssetId:null,
  treeAreas:[],treeAreaGroup:null,
  skierSpawns:{},selectedSkierSpawnSlot:'1',skierSpawnGroup:null,
  slopeAnalysisData:null,slopeCurvesData:null,slopeAnalysisGroup:null,
  slopeAnalysisLineMaterials:[],
  slopeAnalysisQueues:{
    queue1:savedSlopeLayerSettings?.queues?.queue1!==false,
    queue2:savedSlopeLayerSettings?.queues?.queue2===true
  },
  slopeAnalysisAngleMaxDistanceMeters:clampSlopeDistance(savedSlopeLayerSettings?.angleDistanceMeters,900),
  slopeAnalysisLayers:{
    angles:savedSlopeLayerSettings?.visible?.angles!==false,
    difficulty:savedSlopeLayerSettings?.visible?.difficulty!==false,
    names:savedSlopeLayerSettings?.visible?.names!==false
  },
  slopeAnalysisOpacity:{
    angles:clampSlopeOpacity(savedSlopeLayerSettings?.opacity?.angles,1),
    difficulty:clampSlopeOpacity(savedSlopeLayerSettings?.opacity?.difficulty,1),
    names:clampSlopeOpacity(savedSlopeLayerSettings?.opacity?.names,0.65)
  }
};

function showModeSwitchFeedback(message){
  let notice=document.getElementById('modeSwitchFeedback');
  if(!notice){
    notice=document.createElement('div');
    notice.id='modeSwitchFeedback';
    notice.setAttribute('role','status');
    notice.style.cssText='position:absolute;z-index:30;top:76px;left:50%;transform:translateX(-50%);max-width:min(620px,calc(100% - 28px));padding:10px 14px;border:1px solid rgba(255,190,120,.4);border-radius:10px;background:rgba(48,28,19,.94);color:#ffe1c7;font:12px/1.45 system-ui,sans-serif;box-shadow:0 8px 26px rgba(0,0,0,.35);pointer-events:none';
    (document.getElementById('view')||document.body).appendChild(notice);
  }
  notice.textContent=message;
  notice.hidden=false;
  notice.style.display='block';
}
function clearModeSwitchFeedback(){
  const notice=document.getElementById('modeSwitchFeedback');
  if(notice){notice.hidden=true;notice.style.display='none';}
}
let treeLightingMaterials = [];
let forestEmissiveIntensity = 0.275;
const CLIENT_REPO_OWNER='kortul',CLIENT_REPO_NAME='Grade_Optimizer';
// The primary admin workspace opens automatically. ?project= selects another project;
// ?client= remains supported for previously shared viewer links.
const WORKSPACE_QUERY=new URLSearchParams(window.location.search);
const REQUESTED_PROJECT_ID=WORKSPACE_QUERY.get('project')||WORKSPACE_QUERY.get('client')||'';
const FORCE_REMOTE_PROJECT=WORKSPACE_QUERY.get('remote')==='1';
// Diagnostic only: append &shadows=off to isolate shadow-map artifacts on the large source terrain.
const DISABLE_SHADOW_MAP_FOR_DIAGNOSTICS=WORKSPACE_QUERY.get('shadows')==='off';
const RESTORE_LOCAL_PROJECT_DRAFT=!REQUESTED_PROJECT_ID;
const CLIENT_ID_FROM_URL=REQUESTED_PROJECT_ID||'alpine-resort';
let currentClientSlug=CLIENT_ID_FROM_URL;
let clientWorkspaceReady=false;
let clientProjectDirty=false;
let projectAutosaveTimer=null;
let projectAutosavePromise=null;
let projectAutosavePending=false;
let projectChangeRevision=0;
let projectBackupBaseUpdatedAt='';
let projectDeployedManifestUpdatedAt='';
let projectLastBrowserBackupAt='';
let savedProjectFolderHandle=null;
let projectFolderHandle=null;
let projectFolderPermissionState='missing';
let projectFolderSyncError='';
const projectFolderWrittenModels=new Map();


const view = document.getElementById('view');
// The source terrain spans several kilometres. A conventional perspective
// depth buffer loses precision at this scale and can produce z-fighting
// where imported piste surfaces closely follow the original ground.
const renderer = new THREE.WebGLRenderer({
  antialias:true,
  logarithmicDepthBuffer:true
});
renderer.setSize(view.clientWidth, view.clientHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
const BASE_TONE_MAPPING_EXPOSURE = 1.12;
renderer.shadowMap.enabled = !DISABLE_SHADOW_MAP_FOR_DIAGNOSTICS;
if(DISABLE_SHADOW_MAP_FOR_DIAGNOSTICS)console.info('[Grade Optimizer] Shadow diagnostic enabled: shadow map disabled by ?shadows=off.');
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
scene.background = null;
scene.fog = new THREE.Fog(0x9bb4c8, 1800, 9000);

// ---------------------------------------------------------------------------
// Maya slope-analysis overlays. Geometry is serialized as points in metres;
// the viewer renders lightweight lines and CSS2D labels (never overlay meshes).
// ---------------------------------------------------------------------------
const SLOPE_ANALYSIS_PALETTE = {
  green: 0x0b733a,
  blue: 0x286bd6,
  red: 0xe54848,
  black: 0x2a2e34
};
const SLOPE_ANALYSIS_CSS_COLORS = {
  green: '#128342',
  blue: '#3988ff',
  red: '#ff5353',
  black: '#000000'
};

function disposeSlopeAnalysisOverlays(){
  if(!state.slopeAnalysisGroup){state.slopeAnalysisLineMaterials=[];return;}
  state.slopeAnalysisGroup.traverse(object=>{
    if(object.geometry)object.geometry.dispose();
    if(object.material){
      const materials=Array.isArray(object.material)?object.material:[object.material];
      materials.forEach(material=>material.dispose());
    }
    if(object.isCSS2DObject&&object.element?.parentNode)object.element.parentNode.removeChild(object.element);
  });
  state.slopeAnalysisGroup.parent?.remove(state.slopeAnalysisGroup);
  state.slopeAnalysisGroup=null;
  state.slopeAnalysisLineMaterials=[];
}

function createSlopeAnalysisLabel(text, difficulty, kind){
  const element=document.createElement('div');
  element.className='slope-analysis-label slope-analysis-'+kind+' slope-difficulty-'+
    (SLOPE_ANALYSIS_CSS_COLORS[difficulty]?difficulty:'black');
  element.textContent=String(text??'');
  element.setAttribute('aria-label',String(text??''));
  const labelColor=SLOPE_ANALYSIS_CSS_COLORS[difficulty]||SLOPE_ANALYSIS_CSS_COLORS.black;
  element.style.setProperty('--slope-analysis-color',labelColor);
  if(kind==='angle')element.style.setProperty('color',labelColor,'important');
  return new CSS2DObject(element);
}

function persistSlopeAnalysisLayerSettings(){
  try{
    localStorage.setItem(SLOPE_ANALYSIS_LAYER_SETTINGS_KEY,JSON.stringify({
      visible:state.slopeAnalysisLayers,
      opacity:state.slopeAnalysisOpacity,
      queues:state.slopeAnalysisQueues,
      angleDistanceMeters:state.slopeAnalysisAngleMaxDistanceMeters
    }));
  }catch(error){console.warn('[Grade Optimizer] Could not save slope layer settings:',error);}
}

function applySlopeAnalysisLayerVisibility(){
  const overview=state.mode==='overview';
  const root=state.slopeAnalysisGroup;
  const queue1Visible=state.slopeAnalysisQueues.queue1!==false;
  const queue2Visible=state.slopeAnalysisQueues.queue2===true;
  const layerConfig={
    angles:{group:'SlopeAnalysis_Angles',visible:state.slopeAnalysisLayers.angles!==false},
    difficulty:{group:'SlopeAnalysis_Difficulty',visible:state.slopeAnalysisLayers.difficulty!==false},
    names:{group:'SlopeAnalysis_Names',visible:state.slopeAnalysisLayers.names!==false}
  };
  if(root){
    root.visible=overview;
    const queue1=root.getObjectByName('SlopeAnalysis_Queue_1');
    const queue2=root.getObjectByName('SlopeAnalysis_Queue_2');
    if(queue1)queue1.visible=overview&&queue1Visible;
    if(queue2)queue2.visible=overview&&queue2Visible;
    Object.entries(layerConfig).forEach(([key,config])=>{
      const group=root.getObjectByName(config.group);
      if(!group)return;
      const layerVisible=overview&&queue1Visible&&config.visible;
      group.visible=layerVisible;
      if(key==='angles'||key==='names'){
        group.traverse(object=>{
          if(object.isCSS2DObject&&object.element){
            object.element.style.opacity=String(state.slopeAnalysisOpacity[key]);
            object.element.style.display=layerVisible?'':'none';
          }
        });
      }
    });
  }
  state.slopeAnalysisLineMaterials.forEach(material=>{
    material.opacity=state.slopeAnalysisOpacity.difficulty;
    material.needsUpdate=true;
  });
  const panel=document.getElementById('slopeLayersPanel');
  const toggle=document.getElementById('slopeLayersToggle');
  if(panel&&!overview){
    panel.hidden=true;
    appRoot.classList.remove('slope-layers-open');
    toggle?.classList.remove('active');
    toggle?.setAttribute('aria-expanded','false');
  }
  if(toggle)toggle.hidden=!overview;
  ['angles','difficulty','names'].forEach(key=>{
    const checkbox=document.getElementById('slopeLayer_'+key);
    if(checkbox)checkbox.checked=state.slopeAnalysisLayers[key]!==false;
    const slider=document.getElementById('slopeLayerOpacity_'+key);
    const value=document.getElementById('slopeLayerOpacityValue_'+key);
    const percent=Math.round(state.slopeAnalysisOpacity[key]*100);
    if(slider&&document.activeElement!==slider)slider.value=String(percent);
    if(value)value.textContent=percent+'%';
    const queueCheckbox=document.getElementById('layerQueue1_'+key);
    if(queueCheckbox)queueCheckbox.checked=state.slopeAnalysisLayers[key]!==false;
  });
  const queueVisibilityCheckbox=document.getElementById('layerQueue1Visible');
  if(queueVisibilityCheckbox)queueVisibilityCheckbox.checked=queue1Visible;
  const distanceSlider=document.getElementById('slopeLayerAngleDistance');
  const distanceValue=document.getElementById('slopeLayerAngleDistanceValue');
  const distance=Math.round(state.slopeAnalysisAngleMaxDistanceMeters);
  if(distanceSlider){
    distanceSlider.min='0';
    distanceSlider.max='1500';
    distanceSlider.step='10';
    if(document.activeElement!==distanceSlider)distanceSlider.value=String(distance);
  }
  if(distanceValue)distanceValue.textContent=distance+' м';
  const status=document.getElementById('slopeLayersStatus');
  if(status){
    const count=Array.isArray(state.slopeAnalysisData?.curves)?state.slopeAnalysisData.curves.length:0;
    const enabled=Object.values(state.slopeAnalysisLayers).filter(Boolean).length;
    status.textContent=count
      ?count+' центральных линий · шаг углов 20 м · '+enabled+'/3 слоя включено'
      :'Анализ ещё не экспортирован из Maya.';
  }
}


// ---------------------------------------------------------------------------
// Browser-side slope analysis. Maya exports only dense NURBS centerline points
// in project metres. This port mirrors CurvePathAnalyzer.analyze() from the
// supplied Terrain Analysis Pro script and caches each curve by sourceDigest.
// ---------------------------------------------------------------------------
const SLOPE_ANALYSIS_INTERVAL_METERS = 20.0;

const SLOPE_ANALYSIS_LINE_WIDTH_PX = 4.125;
const SLOPE_ANALYSIS_CACHE_VERSION = 'curve-analysis-v2';
const SLOPE_ANALYSIS_ANGLE_LIMITS = {
  green: Math.atan(0.15) * 180 / Math.PI,
  blue: Math.atan(0.25) * 180 / Math.PI,
  red: Math.atan(0.40) * 180 / Math.PI
};
const slopeAnalysisMemoryCache = new Map();
let slopeAnalysisCacheDbPromise = null;

function openSlopeAnalysisCacheDb(){
  if(!('indexedDB' in window))return Promise.resolve(null);
  if(slopeAnalysisCacheDbPromise)return slopeAnalysisCacheDbPromise;
  slopeAnalysisCacheDbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open('grade-optimizer-slope-analysis',1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains('curves'))db.createObjectStore('curves',{keyPath:'key'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('Не удалось открыть кэш анализа склонов'));
  }).catch(error=>{
    console.warn('[Grade Optimizer] Slope analysis IndexedDB unavailable:',error);
    return null;
  });
  return slopeAnalysisCacheDbPromise;
}

function slopeCurveCacheKey(curve){
  const config=[
    SLOPE_ANALYSIS_CACHE_VERSION,
    SLOPE_ANALYSIS_INTERVAL_METERS,
    SLOPE_ANALYSIS_ANGLE_LIMITS.green,
    SLOPE_ANALYSIS_ANGLE_LIMITS.blue,
    SLOPE_ANALYSIS_ANGLE_LIMITS.red,
    20.0
  ].join('|');
  if(curve?.sourceDigest)return config+'|'+String(curve.sourceDigest);
  const source=JSON.stringify(curve?.points||[]);
  let hash=2166136261;
  for(let index=0;index<source.length;index++){
    hash^=source.charCodeAt(index);
    hash=Math.imul(hash,16777619);
  }
  return config+'|fallback-'+(hash>>>0).toString(16);
}

async function getCachedSlopeCurveAnalysis(key){
  if(slopeAnalysisMemoryCache.has(key))return slopeAnalysisMemoryCache.get(key);
  const db=await openSlopeAnalysisCacheDb();
  if(!db)return null;
  return new Promise(resolve=>{
    try{
      const request=db.transaction('curves','readonly').objectStore('curves').get(key);
      request.onsuccess=()=>{
        const value=request.result?.analysis||null;
        if(value)slopeAnalysisMemoryCache.set(key,value);
        resolve(value);
      };
      request.onerror=()=>resolve(null);
    }catch(error){resolve(null);}
  });
}

async function cacheSlopeCurveAnalysis(key,analysis){
  slopeAnalysisMemoryCache.set(key,analysis);
  const db=await openSlopeAnalysisCacheDb();
  if(!db)return;
  await new Promise(resolve=>{
    try{
      const transaction=db.transaction('curves','readwrite');
      transaction.objectStore('curves').put({key,analysis,savedAt:Date.now()});
      transaction.oncomplete=()=>resolve();
      transaction.onerror=()=>resolve();
      transaction.onabort=()=>resolve();
    }catch(error){resolve();}
  });
}

function slopePointAtDistance(points,cumulative,distance){
  if(distance<=0)return {point:points[0].slice(),segment:0,fraction:0};
  const total=cumulative[cumulative.length-1];
  if(distance>=total)return {point:points[points.length-1].slice(),segment:points.length-2,fraction:1};
  let low=0,high=cumulative.length;
  while(low<high){
    const middle=(low+high)>>1;
    if(cumulative[middle]<=distance)low=middle+1;
    else high=middle;
  }
  const segment=Math.max(0,Math.min(points.length-2,low-1));
  const length=cumulative[segment+1]-cumulative[segment];
  const fraction=length<=1e-12?0:(distance-cumulative[segment])/length;
  const a=points[segment],b=points[segment+1];
  return {
    point:[
      a[0]+(b[0]-a[0])*fraction,
      a[1]+(b[1]-a[1])*fraction,
      a[2]+(b[2]-a[2])*fraction
    ],
    segment,
    fraction
  };
}

function slopeHorizontalDistance(points,startSample,endSample){
  const startSegment=startSample.segment,endSegment=endSample.segment;
  if(endSegment<startSegment)return 0;
  const horizontal=(a,b)=>Math.hypot(b[0]-a[0],b[2]-a[2]);
  if(startSegment===endSegment){
    return horizontal(points[startSegment],points[startSegment+1])*
      Math.max(0,endSample.fraction-startSample.fraction);
  }
  let total=horizontal(startSample.point,points[startSegment+1]);
  for(let index=startSegment+1;index<endSegment;index++){
    total+=horizontal(points[index],points[index+1]);
  }
  total+=horizontal(points[endSegment],endSample.point);
  return total;
}

function slopeSectionPolyline(points,cumulative,startDistance,endDistance,startSample,endSample){
  const sectionPoints=[startSample.point];
  for(let index=startSample.segment+1;index<=endSample.segment;index++){
    if(index<points.length-1&&cumulative[index]<endDistance-1e-9){
      sectionPoints.push(points[index]);
    }
  }
  const last=sectionPoints[sectionPoints.length-1];
  if(!last||Math.hypot(
    last[0]-endSample.point[0],
    last[1]-endSample.point[1],
    last[2]-endSample.point[2]
  )>1e-9)sectionPoints.push(endSample.point);
  return sectionPoints;
}

function classifySlopeAnalysisAngle(angle){
  if(angle<=SLOPE_ANALYSIS_ANGLE_LIMITS.green)return 'green';
  if(angle<=SLOPE_ANALYSIS_ANGLE_LIMITS.blue)return 'blue';
  if(angle<=SLOPE_ANALYSIS_ANGLE_LIMITS.red)return 'red';
  return 'black';
}

function classifySlopeAnalysisRoute(shares){
  const categories=['green','blue','red','black'];
  for(let index=0;index<categories.length-1;index++){
    const harder=categories.slice(index+1);
    const maximum=Math.max(0,...harder.map(category=>Number(shares[category]||0)));
    if(maximum<=20.0+1e-9)return categories[index];
  }
  return 'black';
}

function analyzeSlopeCenterline(curve){
  const points=(Array.isArray(curve?.points)?curve.points:[])
    .filter(point=>Array.isArray(point)&&point.length>=3&&point.slice(0,3).every(value=>Number.isFinite(Number(value))))
    .map(point=>[Number(point[0]),Number(point[1]),Number(point[2])]);
  if(points.length<2)return null;

  const cumulative=[0];
  for(let index=1;index<points.length;index++){
    const a=points[index-1],b=points[index];
    cumulative.push(cumulative[index-1]+Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]));
  }
  const totalLength=cumulative[cumulative.length-1];
  if(totalLength<=1e-12)return null;

  const lengths={green:0,blue:0,red:0,black:0};
  const sections=[];
  for(let sectionStart=0;sectionStart<totalLength-1e-8;){
    const sectionEnd=Math.min(totalLength,sectionStart+SLOPE_ANALYSIS_INTERVAL_METERS);
    const startSample=slopePointAtDistance(points,cumulative,sectionStart);
    const endSample=slopePointAtDistance(points,cumulative,sectionEnd);
    const horizontal=slopeHorizontalDistance(points,startSample,endSample);
    const vertical=Math.abs(endSample.point[1]-startSample.point[1]);
    const angle=horizontal<=1e-8?(vertical>1e-8?90:0):Math.atan2(vertical,horizontal)*180/Math.PI;
    const difficulty=classifySlopeAnalysisAngle(angle);
    const sectionLength=sectionEnd-sectionStart;
    lengths[difficulty]+=sectionLength;
    const midpoint=slopePointAtDistance(points,cumulative,(sectionStart+sectionEnd)*0.5);
    sections.push({
      startMeters:sectionStart,
      endMeters:sectionEnd,
      angleDegrees:angle,
      difficulty,
      labelPosition:midpoint.point,
      points:slopeSectionPolyline(points,cumulative,sectionStart,sectionEnd,startSample,endSample)
    });
    sectionStart=sectionEnd;
  }

  const shares={};
  for(const category of ['green','blue','red','black']){
    shares[category]=lengths[category]/totalLength*100;
  }
  const categories=['green','blue','red','black'];
  const dominantDifficulty=categories.reduce((best,category)=>{
    if(shares[category]>shares[best]+1e-12)return category;
    if(Math.abs(shares[category]-shares[best])<=1e-12&&categories.indexOf(category)>categories.indexOf(best))return category;
    return best;
  },'green');
  const routeDifficulty=classifySlopeAnalysisRoute(shares);
  return {
    id:String(curve.id||curve.name||'slope'),
    name:String(curve.name||curve.id||'Slope'),
    sourceDigest:String(curve.sourceDigest||''),
    routeDifficulty,
    dominantDifficulty,
    difficultyShares:shares,
    totalLengthMeters:totalLength,
    intervalMeters:SLOPE_ANALYSIS_INTERVAL_METERS,
    namePosition:(()=>{const midpoint=slopePointAtDistance(points,cumulative,totalLength*0.5).point;return [midpoint[0]+20.0,midpoint[1],midpoint[2]];})(),
    sections
  };
}

async function buildSlopeAnalysisFromManifest(manifest){
  const payload=manifest?.slopeCurves;
  const rawCurves=Array.isArray(payload?.curves)?payload.curves:[];
  if(!rawCurves.length){
    state.slopeCurvesData=null;
    renderSlopeAnalysisOverlays(manifest?.slopeAnalysis||null);
    return;
  }
  state.slopeCurvesData=payload;
  const analyses=await Promise.all(rawCurves.map(async curve=>{
    const key=slopeCurveCacheKey(curve);
    let analysis=await getCachedSlopeCurveAnalysis(key);
    if(!analysis){
      analysis=analyzeSlopeCenterline(curve);
      if(analysis)await cacheSlopeCurveAnalysis(key,analysis);
    }
    if(!analysis)return null;
    // Names and IDs are metadata, not part of the geometry cache key.
    return {...analysis,id:String(curve.id||analysis.id),name:String(curve.name||analysis.name)};
  }));
  const curves=analyses.filter(Boolean);
  renderSlopeAnalysisOverlays({
    schemaVersion:'1.0',
    source:'browser-analysis',
    intervalMeters:SLOPE_ANALYSIS_INTERVAL_METERS,
    curves
  });
}

function renderSlopeAnalysisOverlays(data){
  disposeSlopeAnalysisOverlays();
  state.slopeAnalysisData=data&&Array.isArray(data.curves)?data:null;
  const validCurves=(state.slopeAnalysisData?.curves||[]).filter(curve=>
    curve&&Array.isArray(curve.sections)&&curve.sections.length
  );
  if(!validCurves.length){
    applySlopeAnalysisLayerVisibility();
    return;
  }

  const root=new THREE.Group();
  root.name='GradeOptimizer_SlopeAnalysis';
  root.userData.isSlopeAnalysisOverlay=true;
  const anglesGroup=new THREE.Group();anglesGroup.name='SlopeAnalysis_Angles';
  const difficultyGroup=new THREE.Group();difficultyGroup.name='SlopeAnalysis_Difficulty';
  const namesGroup=new THREE.Group();namesGroup.name='SlopeAnalysis_Names';
  const queue1Group=new THREE.Group();queue1Group.name='SlopeAnalysis_Queue_1';
  const queue2Group=new THREE.Group();queue2Group.name='SlopeAnalysis_Queue_2';
  queue1Group.add(anglesGroup,difficultyGroup,namesGroup);
  root.add(queue1Group,queue2Group);

  for(const curve of validCurves){
    const sections=curve.sections.filter(section=>
      section&&Array.isArray(section.points)&&section.points.length>=2
    );
    const curvePositions=[],curveColors=[];
    const routeDifficulty=String(curve.routeDifficulty||curve.dominantDifficulty||'black').toLowerCase();
    const routeColor=new THREE.Color(SLOPE_ANALYSIS_PALETTE[routeDifficulty]??SLOPE_ANALYSIS_PALETTE.black);
    for(const section of sections){
      const difficulty=String(section.difficulty||curve.routeDifficulty||'black').toLowerCase();
      const points=section.points;
      for(const point of points){
        if(!Array.isArray(point)||point.length<3)continue;
        curvePositions.push(Number(point[0]),Number(point[1])+0.22,Number(point[2]));
        curveColors.push(routeColor.r,routeColor.g,routeColor.b);
      }

      // Angle labels are placed only at the midpoint of complete 20 m sections.
      // The final short remainder stays colour-coded but does not create an irregular label gap.
      const sectionLength=Number(section.endMeters)-Number(section.startMeters);
      const isFullInterval=Math.abs(sectionLength-SLOPE_ANALYSIS_INTERVAL_METERS)<=1e-5;
      const isShortCurve=Number(curve.totalLengthMeters)<SLOPE_ANALYSIS_INTERVAL_METERS;
      const labelPosition=section.labelPosition;
      if((isFullInterval||isShortCurve)&&Array.isArray(labelPosition)&&labelPosition.length>=3&&Number.isFinite(Number(section.angleDegrees))){
        const marker=createSlopeAnalysisLabel(
          Number(section.angleDegrees).toFixed(1)+'°',difficulty,'angle'
        );
        marker.position.set(
          Number(labelPosition[0]),
          Number(labelPosition[1])+1.15,
          Number(labelPosition[2])
        );
        anglesGroup.add(marker);
      }
    }

    // LineBasicMaterial is effectively limited to 1 px in WebGL. Line2 gives
    // the difficulty overlay a reliable, screen-space 5.5 px stroke.
    if(curvePositions.length>=6){
      const geometry=new LineGeometry();
      geometry.setPositions(curvePositions);
      geometry.setColors(curveColors);
      const material=new LineMaterial({
        vertexColors:true,
        linewidth:SLOPE_ANALYSIS_LINE_WIDTH_PX,
        transparent:true,
        opacity:state.slopeAnalysisOpacity.difficulty,
        depthTest:false,
        toneMapped:false
      });
      material.resolution.set(Math.max(1,view.clientWidth),Math.max(1,view.clientHeight));
      state.slopeAnalysisLineMaterials.push(material);
      const lines=new Line2(geometry,material);
      lines.computeLineDistances();
      lines.name='SlopeAnalysis_ColoredCenterline_'+String(curve.id||curve.name||'slope');
      lines.frustumCulled=false;
      lines.renderOrder=1000;
      difficultyGroup.add(lines);
    }

    const namePosition=curve.namePosition;
    if(Array.isArray(namePosition)&&namePosition.length>=3){
      const nameText=String(curve.name||curve.id||'Slope')+'\n'+
        Math.round(Math.max(0,Number(curve.totalLengthMeters)||0))+' m';
      const label=createSlopeAnalysisLabel(
        nameText,
        curve.routeDifficulty||curve.dominantDifficulty||'black',
        'name'
      );
      label.position.set(
        Number(namePosition[0]),
        Number(namePosition[1])+3.0,
        Number(namePosition[2])
      );
      namesGroup.add(label);
    }
  }

  state.slopeAnalysisGroup=root;
  scene.add(root);
  applySlopeAnalysisLayerVisibility();
}

const slopeAnalysisCameraPosition=new THREE.Vector3();
const slopeAnalysisMarkerPosition=new THREE.Vector3();
function updateSlopeAnalysisAngleLabelVisibility(){
  const group=state.slopeAnalysisGroup?.getObjectByName('SlopeAnalysis_Angles');
  if(!group)return;
  camera.getWorldPosition(slopeAnalysisCameraPosition);
  const maxDistance=Math.max(0,Math.min(1500,Number(state.slopeAnalysisAngleMaxDistanceMeters)||0));
  const maxDistanceSquared=maxDistance*maxDistance;
  const queue1Visible=state.slopeAnalysisQueues.queue1!==false;
  for(const marker of group.children){
    marker.getWorldPosition(slopeAnalysisMarkerPosition);
    marker.visible=state.mode==='overview'&&queue1Visible&&state.slopeAnalysisLayers.angles!==false&&
      slopeAnalysisCameraPosition.distanceToSquared(slopeAnalysisMarkerPosition)<=maxDistanceSquared;
  }
}

function setSlopeLayersPanelOpen(open){
  const panel=document.getElementById('slopeLayersPanel');
  const toggle=document.getElementById('slopeLayersToggle');
  if(!panel||!toggle)return;
  const visible=!!open&&state.mode==='overview';
  panel.hidden=!visible;
  appRoot.classList.toggle('slope-layers-open',visible);
  toggle.classList.toggle('active',visible);
  toggle.setAttribute('aria-expanded',String(visible));
  if(visible)applySlopeAnalysisLayerVisibility();
}

function bindSlopeAnalysisLayerControls(){
  const toggle=document.getElementById('slopeLayersToggle');
  const panel=document.getElementById('slopeLayersPanel');
  const distanceControl=document.getElementById('slopeLayerAngleDistance');
  if(distanceControl){distanceControl.min='0';distanceControl.max='1500';distanceControl.step='10';}
  toggle?.addEventListener('click',()=>setSlopeLayersPanelOpen(
    !appRoot.classList.contains('slope-layers-open')
  ));
  document.getElementById('slopeLayersClose')?.addEventListener('click',()=>setSlopeLayersPanelOpen(false));
  if(panel&&!panel.dataset.slopeControlsBound){
    panel.dataset.slopeControlsBound='true';
    panel.addEventListener('change',event=>{
      const target=event.target;
      const match=/^slopeLayer_(angles|difficulty|names)$/.exec(target?.id||'');
      if(!match||target.type!=='checkbox')return;
      state.slopeAnalysisLayers[match[1]]=!!target.checked;
      persistSlopeAnalysisLayerSettings();
      applySlopeAnalysisLayerVisibility();
    });
    panel.addEventListener('input',event=>{
      const target=event.target;
      if(target?.id==='slopeLayerAngleDistance'&&target.type==='range'){
        target.min='0';
        target.max='1500';
        target.step='10';
        state.slopeAnalysisAngleMaxDistanceMeters=clampSlopeDistance(target.value,900);
        target.value=String(state.slopeAnalysisAngleMaxDistanceMeters);
        const value=document.getElementById('slopeLayerAngleDistanceValue');
        if(value)value.textContent=Math.round(state.slopeAnalysisAngleMaxDistanceMeters)+' м';
        persistSlopeAnalysisLayerSettings();
        updateSlopeAnalysisAngleLabelVisibility();
        return;
      }
      const match=/^slopeLayerOpacity_(angles|difficulty|names)$/.exec(target?.id||'');
      if(!match||target.type!=='range')return;
      const key=match[1];
      state.slopeAnalysisOpacity[key]=Math.max(0,Math.min(1,Number(target.value)/100));
      const value=document.getElementById('slopeLayerOpacityValue_'+key);
      if(value)value.textContent=Math.round(state.slopeAnalysisOpacity[key]*100)+'%';
      persistSlopeAnalysisLayerSettings();
      applySlopeAnalysisLayerVisibility();
    });
  }
  const queueEditor=document.getElementById('sceneLookPanel-layers');
  if(queueEditor&&!queueEditor.dataset.queueControlsBound){
    queueEditor.dataset.queueControlsBound='true';
    queueEditor.addEventListener('change',event=>{
      const target=event.target;
      if(target?.id==='layerQueue1Visible'){
        state.slopeAnalysisQueues.queue1=!!target.checked;
      }else{
        const match=/^layerQueue1_(angles|difficulty|names)$/.exec(target?.id||'');
        if(!match||target.type!=='checkbox')return;
        state.slopeAnalysisLayers[match[1]]=!!target.checked;
      }
      persistSlopeAnalysisLayerSettings();
      applySlopeAnalysisLayerVisibility();
    });
  }
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&appRoot.classList.contains('slope-layers-open'))setSlopeLayersPanelOpen(false);
  });
  applySlopeAnalysisLayerVisibility();
}

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

const hemisphere = new THREE.HemisphereLight(0xbfd4ff, 0x3a3a2f, 0.9);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xfff3df, 3.0);
sun.position.set(300, 600, 200);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 3000;
sun.shadow.camera.left = -1200; sun.shadow.camera.right = 1200;
sun.shadow.camera.top = 1200; sun.shadow.camera.bottom = -1200;
sun.shadow.bias = -0.0005;
scene.add(sun);
scene.add(sun.target);

// Procedural sky uses bounded volumetric density shaders with a lightweight fallback.
// Shader cost is deliberately capped so weather cannot stall terrain initialization.
const weatherSystem = new WeatherSystem({
  THREE, scene, camera, hemisphere, sun,
  fogNear: 1800, fogFar: 9000
});
const cameraOptics = new CameraOptics({
  renderer, scene, camera,
  width: view.clientWidth, height: view.clientHeight
});
const opticsFocusPoint = new THREE.Vector3();
const opticsFocusDirection = new THREE.Vector3();

const lightingCenter = new THREE.Vector3();
let sunAzimuthOffset = 0;
let sunIntensityScale = 1;
let sunEnabled = true;
let ambientFillScale = 1;
const moonLight = new THREE.DirectionalLight(0x9aafd7,0);
scene.add(moonLight);
scene.add(moonLight.target);
const daylightColors = {
  nightTop:new THREE.Color(0x050d1b),nightHorizon:new THREE.Color(0x1b223b),nightBottom:new THREE.Color(0x0b1425),
  dayTop:new THREE.Color(0x2d78bd),dayHorizon:new THREE.Color(0xa7cce3),dayBottom:new THREE.Color(0x82abc6),
  warmTop:new THREE.Color(0x9a6486),warmHorizon:new THREE.Color(0xff956d),warmBottom:new THREE.Color(0x795b79),
  nightGround:new THREE.Color(0x111a27),dayGround:new THREE.Color(0x4c594f),
  nightHemisphere:new THREE.Color(0x384863),dayHemisphere:new THREE.Color(0xc7dfff),
  warmSun:new THREE.Color(0xffad70),daySun:new THREE.Color(0xfff2d9)
};
const smooth01 = (a,b,x) => { const t=THREE.MathUtils.clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
function updateDaylight(hours = state.dayTime) {
  const phase=(hours-6)/12*Math.PI;
  const altitude=Math.sin(phase)*1.25;
  const azimuth=phase-Math.PI/2+THREE.MathUtils.degToRad(sunAzimuthOffset);
  const sunDir=new THREE.Vector3(Math.cos(altitude)*Math.cos(azimuth),Math.sin(altitude),Math.cos(altitude)*Math.sin(azimuth)).normalize();
  const daylight=smooth01(-0.08,0.22,sunDir.y);
  const sunrise=Math.exp(-Math.pow((hours-6.85)/1.45,2));
  const sunset=Math.exp(-Math.pow((hours-18.10)/1.55,2));
  const warm=THREE.MathUtils.clamp(Math.max(sunrise,sunset),0,1);
  const nightStrength=1-smooth01(-0.10,0.18,sunDir.y);
  const twilight=THREE.MathUtils.clamp(warm*(0.58+(1-daylight)*0.42),0,1);
  const top=daylightColors.nightTop.clone().lerp(daylightColors.dayTop,daylight).lerp(daylightColors.warmTop,warm*0.56);
  const horizon=daylightColors.nightHorizon.clone().lerp(daylightColors.dayHorizon,daylight).lerp(daylightColors.warmHorizon,warm*0.92);
  const bottom=daylightColors.nightBottom.clone().lerp(daylightColors.dayBottom,daylight).lerp(daylightColors.warmBottom,warm*0.56);
  const sunColor=daylightColors.warmSun.clone().lerp(daylightColors.daySun,1-warm*0.82);
  const weatherLighting=weatherSystem.getLighting();
  weatherSystem.drawSky({top,horizon,bottom,sunColor,sunDirection:sunDir,sunStrength:daylight,sunVisible:sunEnabled,twilight});
  sun.position.copy(lightingCenter).addScaledVector(sunDir,1400);
  sun.target.position.copy(lightingCenter);
  sun.intensity=sunEnabled?daylight*sunIntensityScale*weatherLighting.direct:0;
  sun.visible=sunEnabled&&daylight>0.01;
  sun.castShadow=sunEnabled&&daylight>0.08;
  const moonDirection=sunDir.clone().negate();
  moonLight.position.copy(lightingCenter).addScaledVector(moonDirection,1400);
  moonLight.target.position.copy(lightingCenter);
  moonLight.intensity=nightStrength*0.34*ambientFillScale;
  moonLight.visible=nightStrength>0.02;
  hemisphere.color.copy(daylightColors.nightHemisphere).lerp(daylightColors.dayHemisphere,daylight);
  hemisphere.groundColor.copy(daylightColors.nightGround).lerp(daylightColors.dayGround,daylight);
  hemisphere.intensity=(0.10+daylight*0.72)*weatherLighting.ambient*ambientFillScale;
  scene.fog.color.copy(horizon);
}
function formatClock(hours) {
  const total = Math.round(hours*60);
  return String(Math.floor(total/60)).padStart(2,'0')+':'+String(total%60).padStart(2,'0');
}
const timeSlider = document.getElementById('timeOfDay');
const timeValue = document.getElementById('timeValue');
const autoDayButton = document.getElementById('autoDay');
const dayCyclePanel=document.getElementById('dayCycle');
const timeToggleButton=document.getElementById('timeToggle');
timeToggleButton.addEventListener('click',()=>{
  const expanded=dayCyclePanel.classList.toggle('expanded');
  timeToggleButton.setAttribute('aria-expanded',String(expanded));
  timeToggleButton.title=expanded?'Свернуть управление временем':'Показать управление временем';
});
function setTimeOfDay(value) {
  state.dayTime = THREE.MathUtils.clamp(value, 0, 24);
  timeSlider.value = String(state.dayTime);
  timeValue.textContent = formatClock(state.dayTime);
  const compactTimeValue=document.getElementById('timeCompactValue');if(compactTimeValue)compactTimeValue.textContent=formatClock(state.dayTime);
  updateDaylight(state.dayTime);
}
timeSlider.addEventListener('input', e => {
  state.autoTime = false;
  autoDayButton.classList.remove('active');
  autoDayButton.textContent = '▶';
  setTimeOfDay(parseFloat(e.target.value));
});
autoDayButton.addEventListener('click', () => {
  state.autoTime = !state.autoTime;
  autoDayButton.classList.toggle('active', state.autoTime);
  autoDayButton.textContent = state.autoTime ? 'Ⅱ' : '▶';
});
setTimeOfDay(state.dayTime);

// Weather controls are deliberately stored separately from client scene.json.
// Environment preferences belong to this browser, not to imported client assets.
const WEATHER_STORAGE_KEY = 'grade_optimizer_weather_v4';
const LEGACY_WEATHER_STORAGE_KEYS = ['grade_optimizer_weather_v3','grade_optimizer_weather_v2','grade_optimizer_weather_v1'];
const weatherPanel = document.getElementById('weatherPanel');
const weatherToggle = document.getElementById('weatherToggle');
const weatherClose = document.getElementById('weatherClose');
const weatherCloudsInput = document.getElementById('weatherClouds');
const weatherSnowInput = document.getElementById('weatherSnow');
const weatherWindInput = document.getElementById('weatherWind');
const weatherGroundFogInput = document.getElementById('weatherGroundFog');
const weatherVolumetricsInput = document.getElementById('weatherVolumetrics');
const weatherCloudsValue = document.getElementById('weatherCloudsValue');
const weatherSnowValue = document.getElementById('weatherSnowValue');
const weatherWindValue = document.getElementById('weatherWindValue');
const weatherStatus = document.getElementById('weatherStatus');
const weatherPresetButtons = [...document.querySelectorAll('[data-weather-preset]')];

function updateWeatherControls() {
  const settings = weatherSystem.getSettings();
  weatherCloudsInput.value = String(Math.round(settings.clouds * 100));
  weatherSnowInput.value = String(Math.round(settings.snowfall * 100));
  weatherWindInput.value = String(Math.round(settings.wind));
  weatherCloudsValue.textContent = weatherCloudsInput.value + '%';
  weatherSnowValue.textContent = weatherSnowInput.value + '%';
  weatherWindValue.textContent = weatherWindInput.value + ' км/ч';
  if(weatherGroundFogInput)weatherGroundFogInput.checked=!!settings.groundFog;
  if(weatherVolumetricsInput)weatherVolumetricsInput.checked=settings.volumetrics!==false;
  const sceneGroundFog=document.getElementById('sceneGroundFog');
  if(sceneGroundFog)sceneGroundFog.checked=!!settings.groundFog;
  const sceneVolumetrics=document.getElementById('sceneVolumetrics');
  if(sceneVolumetrics)sceneVolumetrics.checked=settings.volumetrics!==false;
  const sceneClouds=document.getElementById('sceneClouds');
  const sceneSnow=document.getElementById('sceneSnow');
  const sceneWind=document.getElementById('sceneWind');
  if(sceneClouds)sceneClouds.value=String(Math.round(settings.clouds*100));
  if(sceneSnow)sceneSnow.value=String(Math.round(settings.snowfall*100));
  if(sceneWind)sceneWind.value=String(Math.round(settings.wind));
  const sceneCloudsValue=document.getElementById('sceneCloudsValue');
  const sceneSnowValue=document.getElementById('sceneSnowValue');
  const sceneWindValue=document.getElementById('sceneWindValue');
  if(sceneCloudsValue)sceneCloudsValue.textContent=Math.round(settings.clouds*100)+'%';
  if(sceneSnowValue)sceneSnowValue.textContent=Math.round(settings.snowfall*100)+'%';
  if(sceneWindValue)sceneWindValue.textContent=Math.round(settings.wind)+' km/h';
  weatherPresetButtons.forEach(button => {
    const active = button.dataset.weatherPreset === settings.preset;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (weatherStatus) {
    const preset = WeatherSystem.PRESETS[settings.preset];
    weatherStatus.textContent = settings.preset === 'custom'
      ? 'Пользовательская погода'
      : (preset?.label || 'Ясно');
  }
}

function persistWeatherSettings() {
  try {
    localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify(weatherSystem.getSettings()));
  } catch (error) {
    console.warn('Не удалось сохранить настройки погоды в браузере:', error);
  }
}

function applyWeatherPreset(name) {
  if (!weatherSystem.setPreset(name)) return;
  updateDaylight(state.dayTime);
  updateWeatherControls();
  persistWeatherSettings();
  markClientProjectDirty('погодные настройки');
}

function applyCustomWeather() {
  const clouds = Number(weatherCloudsInput.value) / 100;
  const snowfall = Number(weatherSnowInput.value) / 100;
  const wind = Number(weatherWindInput.value);
  weatherSystem.setCustom({ clouds, snowfall, wind });
  updateDaylight(state.dayTime);
  updateWeatherControls();
  persistWeatherSettings();
  markClientProjectDirty('погодные настройки');
}
function applyGroundFogToggle(event) {
  weatherSystem.setGroundFog(!!event.target.checked);
  updateWeatherControls();
  persistWeatherSettings();
  markClientProjectDirty('настройки наземного тумана');
}
if(weatherGroundFogInput)weatherGroundFogInput.addEventListener('change',applyGroundFogToggle);
const sceneGroundFogInput=document.getElementById('sceneGroundFog');
if(sceneGroundFogInput)sceneGroundFogInput.addEventListener('change',applyGroundFogToggle);
function applyVolumetricsToggle(event){weatherSystem.setVolumetrics(!!event.target.checked);updateWeatherControls();persistWeatherSettings();markClientProjectDirty('настройки volumetric effects');}
if(weatherVolumetricsInput)weatherVolumetricsInput.addEventListener('change',applyVolumetricsToggle);
const sceneVolumetricsInput=document.getElementById('sceneVolumetrics');
if(sceneVolumetricsInput)sceneVolumetricsInput.addEventListener('change',applyVolumetricsToggle);

function applyWeatherSettingsFromProject(saved) {
  if(!saved||typeof saved!=='object')return;
  if(saved.preset==='custom')weatherSystem.setCustom(saved);
  else if(WeatherSystem.PRESETS[saved.preset])weatherSystem.setPreset(saved.preset);
  else weatherSystem.setPreset('light');
  if(typeof saved.groundFog==='boolean')weatherSystem.setGroundFog(saved.groundFog);
  if(typeof saved.volumetrics==='boolean')weatherSystem.setVolumetrics(saved.volumetrics);
  updateDaylight(state.dayTime);
  updateWeatherControls();
  persistWeatherSettings();
}
function applySceneWeatherControls() {
  const clouds=Number(document.getElementById('sceneClouds').value)/100;
  const snowfall=Number(document.getElementById('sceneSnow').value)/100;
  const wind=Number(document.getElementById('sceneWind').value);
  weatherSystem.setCustom({clouds,snowfall,wind});
  updateDaylight(state.dayTime);
  updateWeatherControls();
  persistWeatherSettings();
  markClientProjectDirty('погодные настройки Scene Editor');
}
['sceneClouds','sceneSnow','sceneWind'].forEach(id=>{
  const input=document.getElementById(id);
  if(input)input.addEventListener('input',applySceneWeatherControls);
});

weatherPresetButtons.forEach(button => {
  button.addEventListener('click', () => applyWeatherPreset(button.dataset.weatherPreset));
});
weatherCloudsInput.addEventListener('input', applyCustomWeather);
weatherSnowInput.addEventListener('input', applyCustomWeather);
weatherWindInput.addEventListener('input', applyCustomWeather);

const OPTICS_STORAGE_KEY = 'grade_optimizer_optics_v3';
const LEGACY_OPTICS_STORAGE_KEYS = ['grade_optimizer_optics_v2','grade_optimizer_optics_v1'];
const opticsSettings = {
  enabled:true, bloom:58, bloomThreshold:0.78,
  flare:true, flareStrength:70, dirt:38, bokeh:false, focusDistance:48, aperture:4,
  vignette:24, chromatic:18, grain:4, sharpness:14, distortion:6,
  shadowLift:12, highlightCompression:18, focusMode:'target',
  temperature:6500, tint:0, contrast:104, saturation:104, exposure:0,
  cameraFov:55, toneMapping:'aces', quality:'balanced',
  sunIntensity:100, sunRotation:0, ambientFill:100, sunEnabled:true, shadowQuality:1
};
try {
  const currentOptics=localStorage.getItem(OPTICS_STORAGE_KEY);
  const legacyOptics=LEGACY_OPTICS_STORAGE_KEYS.map(key=>localStorage.getItem(key)).find(Boolean)||null;
  const savedOptics=JSON.parse(currentOptics||legacyOptics||'null');
  if(savedOptics&&typeof savedOptics==='object'){
    const numericKeys={
      bloom:[0,100],bloomThreshold:[0.1,2],flareStrength:[0,100],dirt:[0,100],
      focusDistance:[5,500],aperture:[1.4,16],vignette:[0,100],chromatic:[0,100],
      grain:[0,100],sharpness:[0,100],distortion:[0,100],shadowLift:[0,100],
      highlightCompression:[0,100],temperature:[3200,9000],tint:[-100,100],
      contrast:[60,160],saturation:[0,160],exposure:[-2,2],cameraFov:[30,90],
      sunIntensity:[0,300],sunRotation:[0,360],ambientFill:[0,200],shadowQuality:[0,2]
    };
    Object.entries(numericKeys).forEach(([key,[min,max]])=>{
      if(Number.isFinite(Number(savedOptics[key])))opticsSettings[key]=THREE.MathUtils.clamp(Number(savedOptics[key]),min,max);
    });
    // Migrate prior camera preferences, but ignore their old Bokeh toggle.
    // Only an explicit v3 preference is allowed to restore DOF as enabled.
    const booleanKeys=currentOptics?['enabled','flare','bokeh','sunEnabled']:['enabled','flare','sunEnabled'];
    booleanKeys.forEach(key=>{
      if(typeof savedOptics[key]==='boolean')opticsSettings[key]=savedOptics[key];
    });
    if(['aces','agx','reinhard','linear'].includes(savedOptics.toneMapping))opticsSettings.toneMapping=savedOptics.toneMapping;
    if(['target','manual'].includes(savedOptics.focusMode))opticsSettings.focusMode=savedOptics.focusMode;
    if(['performance','balanced','high','cinematic'].includes(savedOptics.quality))opticsSettings.quality=savedOptics.quality;
    if(!currentOptics&&Number(savedOptics.bloom)===34)opticsSettings.bloom=58;
  }
} catch (error) {
  console.warn('Не удалось восстановить настройки камеры; используются стандартные.', error);
}
function persistOpticsSettings() {
  try { localStorage.setItem(OPTICS_STORAGE_KEY, JSON.stringify(opticsSettings)); }
  catch (error) { console.warn('Не удалось сохранить настройки камеры:', error); }
}
function updateSceneLookRangeFill(){
  document.querySelectorAll('#sceneEditorPanel .scene-look-panel input[type="range"]').forEach(input=>{
    const min=Number.isFinite(Number(input.min))?Number(input.min):0;
    const max=Number.isFinite(Number(input.max))?Number(input.max):100;
    const value=Number(input.value);
    const ratio=max>min?THREE.MathUtils.clamp((value-min)/(max-min),0,1):0;
    input.style.setProperty('--range-fill',(ratio*100).toFixed(2)+'%');
  });
}
function syncSceneLookControls() {
  const setValue=(id,value)=>{const el=document.getElementById(id);if(el)el.value=String(value);};
  const setChecked=(id,value)=>{const el=document.getElementById(id);if(el)el.checked=!!value;};
  setValue('sceneCameraFov',opticsSettings.cameraFov);
  setValue('sceneExposure',opticsSettings.exposure);
  setValue('sceneWhiteBalance',opticsSettings.temperature);
  setValue('sceneTint',opticsSettings.tint);
  setValue('sceneContrast',opticsSettings.contrast);
  setValue('sceneSaturation',opticsSettings.saturation);
  setValue('sceneBloom',opticsSettings.bloom);
  setValue('sceneBloomThreshold',opticsSettings.bloomThreshold);
  setValue('sceneFlare',opticsSettings.flareStrength);
  setValue('sceneDirt',opticsSettings.dirt);
  setValue('sceneVignette',opticsSettings.vignette);
  setValue('sceneChromatic',opticsSettings.chromatic);
  setValue('sceneGrain',opticsSettings.grain);
  setValue('sceneSharpness',opticsSettings.sharpness);
  setValue('sceneDistortion',opticsSettings.distortion);
  setValue('sceneShadowLift',opticsSettings.shadowLift);
  setValue('sceneHighlightCompression',opticsSettings.highlightCompression);
  setValue('sceneFocusMode',opticsSettings.focusMode);
  setValue('sceneFocusDistance',opticsSettings.focusDistance);
  setValue('sceneAperture',opticsSettings.aperture);
  setValue('sceneQuality',opticsSettings.quality);
  setValue('sceneToneMapping',opticsSettings.toneMapping);
  setValue('sceneSunIntensity',opticsSettings.sunIntensity);
  setValue('sceneSunRotation',opticsSettings.sunRotation);
  setValue('sceneAmbientFill',opticsSettings.ambientFill);
  setValue('sceneShadowQuality',opticsSettings.shadowQuality);
  setChecked('sceneOpticsEnabled',opticsSettings.enabled);
  setChecked('sceneFlareEnabled',opticsSettings.flare);
  setChecked('sceneBokeh',opticsSettings.bokeh);
  setChecked('sceneSunEnabled',opticsSettings.sunEnabled);
  setChecked('pLightOn',opticsSettings.sunEnabled);
  setValue('pLight',opticsSettings.sunIntensity/100);
  setValue('pSunRot',opticsSettings.sunRotation);
  setValue('pShadow',opticsSettings.shadowQuality);
  const values={
    sceneCameraFovValue:Math.round(opticsSettings.cameraFov)+'°',
    sceneExposureValue:(Number(opticsSettings.exposure)>=0?'+':'')+Number(opticsSettings.exposure).toFixed(2)+' EV',
    sceneWhiteBalanceValue:Math.round(opticsSettings.temperature)+' K',
    sceneTintValue:Number(opticsSettings.tint).toFixed(0),
    sceneContrastValue:(Number(opticsSettings.contrast)/100).toFixed(2),
    sceneSaturationValue:(Number(opticsSettings.saturation)/100).toFixed(2),
    sceneBloomValue:Math.round(opticsSettings.bloom)+'%',
    sceneBloomThresholdValue:Number(opticsSettings.bloomThreshold).toFixed(2),
    sceneFlareValue:Math.round(opticsSettings.flareStrength)+'%',
    sceneDirtValue:Math.round(opticsSettings.dirt)+'%',
    sceneVignetteValue:Math.round(opticsSettings.vignette)+'%',
    sceneChromaticValue:Math.round(opticsSettings.chromatic)+'%',
    sceneGrainValue:Math.round(opticsSettings.grain)+'%',
    sceneSharpnessValue:Math.round(opticsSettings.sharpness)+'%',
    sceneDistortionValue:Math.round(opticsSettings.distortion)+'%',
    sceneShadowLiftValue:Math.round(opticsSettings.shadowLift)+'%',
    sceneHighlightCompressionValue:Math.round(opticsSettings.highlightCompression)+'%',
    sceneFocusDistanceValue:Math.round(opticsSettings.focusDistance)+' m',
    sceneApertureValue:'f/'+Number(opticsSettings.aperture).toFixed(1),
    sceneSunIntensityValue:Math.round(opticsSettings.sunIntensity)+'%',
    sceneSunRotationValue:Math.round(opticsSettings.sunRotation)+'°',
    sceneAmbientFillValue:Math.round(opticsSettings.ambientFill)+'%'
  };
  Object.entries(values).forEach(([id,value])=>{const el=document.getElementById(id);if(el)el.textContent=value;});
   const fxStatus=document.getElementById('sceneLookFxStatus');
   if(fxStatus){
     const live=!!opticsSettings.enabled;
     fxStatus.textContent=live?(opticsSettings.bokeh?'FX LIVE · DOF':'FX LIVE'):'FX BYPASSED';
     fxStatus.classList.toggle('is-off',!live);
     fxStatus.classList.toggle('has-dof',live&&!!opticsSettings.bokeh);
   }
   updateSceneLookRangeFill();
}
function updateOpticsControls() {
  camera.fov=opticsSettings.cameraFov;
  camera.updateProjectionMatrix();
  renderer.toneMapping={
    aces:THREE.ACESFilmicToneMapping,
    agx:THREE.AgXToneMapping,
    reinhard:THREE.ReinhardToneMapping,
    linear:THREE.LinearToneMapping
  }[opticsSettings.toneMapping]??THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=BASE_TONE_MAPPING_EXPOSURE*Math.pow(2,opticsSettings.exposure);
  sunIntensityScale=opticsSettings.sunIntensity/100;
  sunAzimuthOffset=opticsSettings.sunRotation;
  ambientFillScale=opticsSettings.ambientFill/100;
  sunEnabled=opticsSettings.sunEnabled;
  const shadowSizes=[1024,2048,4096];
  const shadowSize=shadowSizes[opticsSettings.shadowQuality]||2048;
  if(sun.shadow.mapSize.x!==shadowSize||sun.shadow.mapSize.y!==shadowSize){
    if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}
    sun.shadow.mapSize.set(shadowSize,shadowSize);
  }
  cameraOptics.setOptions({
    enabled:opticsSettings.enabled,
    bloom:opticsSettings.bloom/100,
    bloomThreshold:opticsSettings.bloomThreshold,
    flare:opticsSettings.flare,
    flareStrength:opticsSettings.flareStrength/100,
    dirt:opticsSettings.dirt/100,
    bokeh:opticsSettings.bokeh,
    focusDistance:opticsSettings.focusDistance,
    aperture:opticsSettings.aperture,
    vignette:opticsSettings.vignette/100,
    chromatic:opticsSettings.chromatic/100,
    grain:opticsSettings.grain/100,
    sharpness:opticsSettings.sharpness/100,
    distortion:opticsSettings.distortion/100,
    shadowLift:opticsSettings.shadowLift/100,
    highlightCompression:opticsSettings.highlightCompression/100,
    focusMode:opticsSettings.focusMode,
    temperature:opticsSettings.temperature,
    tint:opticsSettings.tint/100,
    contrast:opticsSettings.contrast/100,
    saturation:opticsSettings.saturation/100,
    quality:opticsSettings.quality
  });
  syncSceneLookControls();
  updateDaylight(state.dayTime);
}
function applyOpticsSettings({persist=true,markDirty=true}={}) {
  updateOpticsControls();
  if(persist)persistOpticsSettings();
  if(markDirty)markClientProjectDirty('настройки камеры и рендеринга');
}
let activeSceneLookTab='camera';
let treeAreaDrawing=false,treeAreaDraftPoints=[];
function bindSceneHierarchyTabs(){const tabs=[...document.querySelectorAll("#sceneHierarchyPanel [data-hierarchy-tab]")],panels=[...document.querySelectorAll("#sceneHierarchyPanel [data-hierarchy-panel]")];if(!tabs.length||!panels.length)return;function activate(name){tabs.forEach(t=>{const active=t.dataset.hierarchyTab===name;t.classList.toggle("active",active);t.setAttribute("aria-selected",String(active));});panels.forEach(p=>{p.hidden=p.dataset.hierarchyPanel!==name;});}tabs.forEach(t=>t.addEventListener("click",()=>activate(t.dataset.hierarchyTab)));activate("project");}
function bindSceneLookTabs(){
  const tabs=[...document.querySelectorAll('#sceneEditorPanel [data-look-tab]')];
  const panels=[...document.querySelectorAll('#sceneEditorPanel [data-look-panel]')];
  if(!tabs.length||!panels.length)return;
  const activate=(name,{focus=false}={})=>{
    if(!tabs.some(tab=>tab.dataset.lookTab===name))name='camera';
    const previousTab=activeSceneLookTab;
    activeSceneLookTab=name;
    tabs.forEach(tab=>{
      const selected=tab.dataset.lookTab===name;
      tab.classList.toggle('active',selected);
      tab.setAttribute('aria-selected',String(selected));
      tab.tabIndex=selected?0:-1;
      if(selected&&focus)tab.focus();
    });
    panels.forEach(panel=>{
      const selected=panel.dataset.lookPanel===name;
      panel.hidden=!selected;
      panel.classList.toggle('active',selected);
    });
    const title=document.getElementById('sceneLookPanelTitle');
    const subtitle=document.getElementById('sceneLookPanelSubtitle');
    const labels={
      general:['GENERAL · OBJECT SETTINGS','TRANSFORM · METADATA · PROJECT TOOLS'],
      materials:['MATERIALS & PBR','MATERIAL SLOTS · MAPS · PRESETS'],
      environment:['ENVIRONMENT & LIGHTING','WEATHER · SUN · SHADOWS'],
      camera:['CAMERA · LENS & OPTICS','FRAMING · EXPOSURE · FOCUS · IMAGE CHARACTER · POST-PROCESSING'],
      color:['COLOR GRADING','TONAL RESPONSE & COLOR'],
      render:['RENDER PIPELINE','OUTPUT TRANSFORM & GPU QUALITY'],
      layers:['РЕДАКТОР СЛОЁВ','ОЧЕРЕДЬ 1 · ОЧЕРЕДЬ 2 · СЛОИ АНАЛИЗА'],
      trees:['TREE PLACEMENT AREAS','FOREST DISTRIBUTION · WORLD X/Z'],
      spawn:['SKIER SPAWN POINTS','10 START SLOTS · POSITION & DIRECTION']
    };
    const copy=labels[name]||['SCENE EDITOR','OBJECTS · MATERIALS · VISUAL SETTINGS'];
    if(title)title.textContent=copy[0];
    if(subtitle)subtitle.textContent=copy[1];
    const resetButton=document.getElementById('sceneLookReset');
    if(resetButton)resetButton.hidden=name==='general'||name==='materials'||name==='trees'||name==='spawn'||name==='layers';
    if(name==='trees')updateTreeAreaPanel();
    if(previousTab==='spawn'&&name!=='spawn'&&skierSpawnPlacementStep)cancelSkierSpawnPlacement();
    updateTreeAreaOverlayVisibility();
  };
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>activate(tab.dataset.lookTab));
    tab.addEventListener('keydown',event=>{
      const key=event.key;
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(key))return;
      event.preventDefault();
      let next=index;
      if(key==='ArrowRight')next=(index+1)%tabs.length;
      if(key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;
      if(key==='Home')next=0;
      if(key==='End')next=tabs.length-1;
      activate(tabs[next].dataset.lookTab,{focus:true});
    });
  });
  activate(activeSceneLookTab);
}
function bindSceneLookControls() {
  const numeric={
    sceneCameraFov:'cameraFov',sceneExposure:'exposure',sceneWhiteBalance:'temperature',
    sceneTint:'tint',sceneContrast:'contrast',sceneSaturation:'saturation',
    sceneBloom:'bloom',sceneBloomThreshold:'bloomThreshold',sceneFlare:'flareStrength',
    sceneDirt:'dirt',sceneVignette:'vignette',sceneChromatic:'chromatic',
    sceneGrain:'grain',sceneSharpness:'sharpness',sceneDistortion:'distortion',
    sceneShadowLift:'shadowLift',sceneHighlightCompression:'highlightCompression',
    sceneFocusDistance:'focusDistance',sceneAperture:'aperture',
    sceneSunIntensity:'sunIntensity',sceneSunRotation:'sunRotation',
    sceneAmbientFill:'ambientFill',sceneShadowQuality:'shadowQuality'
  };
  Object.entries(numeric).forEach(([id,key])=>{
    const input=document.getElementById(id);
    if(!input)return;
    input.addEventListener('input',()=>{
      opticsSettings[key]=Number(input.value);
      applyOpticsSettings();
    });
    input.addEventListener('change',()=>{
      opticsSettings[key]=Number(input.value);
      applyOpticsSettings();
    });
  });
  [['sceneToneMapping','toneMapping'],['sceneQuality','quality'],['sceneFocusMode','focusMode']].forEach(([id,key])=>{
    const input=document.getElementById(id);
    if(input)input.addEventListener('change',()=>{opticsSettings[key]=input.value;applyOpticsSettings();});
  });
  [['sceneOpticsEnabled','enabled'],['sceneFlareEnabled','flare'],['sceneBokeh','bokeh'],['sceneSunEnabled','sunEnabled']].forEach(([id,key])=>{
    const input=document.getElementById(id);
    if(input)input.addEventListener('change',()=>{opticsSettings[key]=input.checked;applyOpticsSettings();});
  });
}
function applyOpticsSettingsFromProject(saved) {
  if(!saved||typeof saved!=='object')return;
  const numericKeys={
    bloom:[0,100],bloomThreshold:[0.1,2],flareStrength:[0,100],dirt:[0,100],
    focusDistance:[5,500],aperture:[1.4,16],vignette:[0,100],chromatic:[0,100],
    grain:[0,100],sharpness:[0,100],distortion:[0,100],shadowLift:[0,100],
    highlightCompression:[0,100],temperature:[3200,9000],tint:[-100,100],
    contrast:[60,160],saturation:[0,160],exposure:[-2,2],cameraFov:[30,90],
    sunIntensity:[0,300],sunRotation:[0,360],ambientFill:[0,200],shadowQuality:[0,2]
  };
  Object.entries(numericKeys).forEach(([key,[min,max]])=>{
    if(Number.isFinite(Number(saved[key])))opticsSettings[key]=THREE.MathUtils.clamp(Number(saved[key]),min,max);
  });
  ['enabled','flare','bokeh','sunEnabled'].forEach(key=>{if(typeof saved[key]==='boolean')opticsSettings[key]=saved[key];});
  if(['aces','agx','reinhard','linear'].includes(saved.toneMapping))opticsSettings.toneMapping=saved.toneMapping;
  if(['target','manual'].includes(saved.focusMode))opticsSettings.focusMode=saved.focusMode;
  if(['performance','balanced','high','cinematic'].includes(saved.quality))opticsSettings.quality=saved.quality;
  applyOpticsSettings({persist:true,markDirty:false});
}
bindSceneHierarchyTabs();
bindSceneLookTabs();
document.querySelectorAll('#sceneEditorPanel .scene-look-panel input[type="range"]').forEach(input=>{
  input.addEventListener('input',updateSceneLookRangeFill);
  input.addEventListener('change',updateSceneLookRangeFill);
});
bindSceneLookControls();
document.getElementById('sceneLookReset').addEventListener('click',()=>{
  Object.assign(opticsSettings,{
    enabled:true,bloom:58,bloomThreshold:0.78,flare:true,flareStrength:70,dirt:38,
    bokeh:false,focusDistance:48,focusMode:'target',aperture:4,vignette:24,chromatic:18,grain:4,sharpness:14,
    distortion:6,shadowLift:12,highlightCompression:18,
    temperature:6500,tint:0,contrast:104,saturation:104,exposure:0,cameraFov:55,
    toneMapping:'aces',quality:'balanced',sunIntensity:100,sunRotation:0,
    ambientFill:100,sunEnabled:true,shadowQuality:1
  });
  applyOpticsSettings();
  weatherSystem.setPreset('light');
  weatherSystem.setGroundFog(false);
  weatherSystem.setVolumetrics(true);
  updateWeatherControls();
  persistWeatherSettings();
  markClientProjectDirty('сброс Scene Look');
});
function setWeatherPanelOpen(open) {
  const app = document.getElementById('app');
  app.classList.toggle('weather-open', !!open);
  weatherToggle.classList.toggle('active', !!open);
  weatherToggle.setAttribute('aria-expanded', String(!!open));
}
weatherToggle.addEventListener('click', () => setWeatherPanelOpen(!document.getElementById('app').classList.contains('weather-open')));
weatherClose.addEventListener('click', () => setWeatherPanelOpen(false));

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (document.getElementById('app').classList.contains('weather-open')) setWeatherPanelOpen(false);
  }
});
updateOpticsControls();
try {
  const savedWeather = JSON.parse(localStorage.getItem(WEATHER_STORAGE_KEY) || 'null');
  let legacyWeather=null;
  if(!savedWeather){
    for(const legacyKey of LEGACY_WEATHER_STORAGE_KEYS){
      const stored=JSON.parse(localStorage.getItem(legacyKey)||'null');
      if(stored){legacyWeather=stored;break;}
    }
  }
  const weatherToRestore=savedWeather||legacyWeather;
  if(!weatherToRestore){weatherSystem.setPreset('light');persistWeatherSettings();}
  if(weatherToRestore){
    if(legacyWeather){
      const legacyPreset=WeatherSystem.PRESETS[legacyWeather.preset]||{};
      const legacySnowfall=Number(legacyWeather.snowfall??legacyPreset.snowfall??0);
      const wasOldDefaultClear=legacyWeather.preset==='clear'&&Number(legacyWeather.clouds??0)<=0.01;
      if(wasOldDefaultClear){
        weatherSystem.setPreset('light');
      }else if(legacySnowfall>0){
        weatherSystem.setCustom({...legacyWeather,snowfall:0,preset:'custom'});
      }else if(legacyWeather.preset==='custom'){
        weatherSystem.setCustom(legacyWeather);
      }else if(WeatherSystem.PRESETS[legacyWeather.preset]){
        weatherSystem.setPreset(legacyWeather.preset);
      }
      persistWeatherSettings();
    }else if(savedWeather.preset==='custom'){
      weatherSystem.setCustom(savedWeather);
    }else if(WeatherSystem.PRESETS[savedWeather.preset]){
      weatherSystem.setPreset(savedWeather.preset);
    }
    if(typeof weatherToRestore.groundFog==='boolean'){
      weatherSystem.setGroundFog(weatherToRestore.groundFog);
      if(legacyWeather)persistWeatherSettings();
    }
    if(typeof weatherToRestore.volumetrics==='boolean'){
      weatherSystem.setVolumetrics(weatherToRestore.volumetrics);
      if(legacyWeather)persistWeatherSettings();
    }
  }
} catch (error) {
  console.warn('Не удалось восстановить настройки погоды; используется лёгкая облачность.', error);
}
updateDaylight(state.dayTime);
updateWeatherControls();

let sceneViewMaxDistance = 4000;
let targetDist = null;
renderer.domElement.addEventListener('wheel', ev=>{
  if(state.mode !== 'overview') return;
  ev.preventDefault();
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  let d = dir.length();
  const factor = Math.exp(ev.deltaY * 0.0012);
  d = THREE.MathUtils.clamp(d * factor, 30, sceneViewMaxDistance);
  targetDist = d;
}, { passive:false });

let resizeRaf = 0;
let lastViewWidth = 0, lastViewHeight = 0;
function syncViewportSize() {
  const rect = view.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  if (width === lastViewWidth && height === lastViewHeight) return;
  lastViewWidth = width; lastViewHeight = height;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  cameraOptics.setSize(width, height);
  labelRenderer.setSize(width, height);
  state.slopeAnalysisLineMaterials.forEach(material=>material.resolution.set(width,height));
}
function scheduleViewportResize() {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    syncViewportSize();
  });
}
window.addEventListener('resize', scheduleViewportResize, { passive:true });
window.visualViewport?.addEventListener('resize', scheduleViewportResize, { passive:true });
window.addEventListener('orientationchange', scheduleViewportResize, { passive:true });
if (typeof ResizeObserver !== 'undefined') {
  const viewResizeObserver = new ResizeObserver(scheduleViewportResize);
  viewResizeObserver.observe(view);
}
scheduleViewportResize();

const dbgEl = document.getElementById('debug');
function dbg(msg){ dbgEl.textContent += msg + "\n"; }
const bust = () => '?t=' + Date.now();
const assetManager = new THREE.LoadingManager();
let assetToken = Date.now();
assetManager.setURLModifier(url => {
  if (/\.bin(\?|$)/i.test(url)) return url + (url.includes('?') ? '&' : '?') + 't=' + assetToken;
  return url;
});
const loader = new GLTFLoader(assetManager);
const fbxLoader = new FBXLoader(assetManager);
function prepareFbxMaterials(root,{preserveSlopeAlbedo=false}={}){
  const converted=new Map();
  const canonicalBySourceName=new Map();
  const sourceNameKey=source=>{
    const name=String(source?.name||'').split('::').pop().trim().toLowerCase();
    return name||'';
  };
  const convert=source=>{
    if(!source)return source;
    if(converted.has(source))return converted.get(source);
    const sourceName=sourceNameKey(source);
    // FBX material IDs may be duplicated by Maya per mesh while retaining the
    // same shader name. Within one FBX, that name represents one shared slot.
    if(sourceName&&canonicalBySourceName.has(sourceName)){
      const canonical=canonicalBySourceName.get(sourceName);
      converted.set(source,canonical);
      return canonical;
    }
    if(source.isMeshStandardMaterial){
      source.userData={
        ...(source.userData||{}),
        ...(source.name?{gradeOptimizerFbxSourceMaterialName:source.name}:{})
      };
      converted.set(source,source);
      if(sourceName)canonicalBySourceName.set(sourceName,source);
      return source;
    }
    const shininess=Number(source.shininess);
    const roughness=Number.isFinite(shininess)&&shininess>0
      ?THREE.MathUtils.clamp(Math.sqrt(2/(shininess+2)),0.08,1)
      :0.85;
    const color=source.color?.clone?.()||new THREE.Color(0xffffff);
    const emissive=source.emissive?.clone?.()||new THREE.Color(0x000000);
    let map=source.map||null;
    let emissiveMap=source.emissiveMap||null;
    let albedoRecovery='';
    if(preserveSlopeAlbedo&&Math.max(color.r,color.g,color.b)<0.025){
      if(map){
        color.set(0xffffff);
        albedoRecovery='white-base-for-diffuse-map';
      }else if(emissiveMap){
        map=emissiveMap.clone();
        map.colorSpace=THREE.SRGBColorSpace;
        map.needsUpdate=true;
        emissiveMap=null;
        color.set(0xffffff);
        albedoRecovery='emissive-map-recovered-as-base-color-map';
      }else if(Math.max(emissive.r,emissive.g,emissive.b)>0.025){
        color.copy(emissive);
        emissive.setRGB(0,0,0);
        albedoRecovery='emissive-color-recovered-as-base-color';
      }
    }
    const material=new THREE.MeshStandardMaterial({
      color,map,normalMap:source.normalMap||null,bumpMap:source.bumpMap||null,
      alphaMap:source.alphaMap||null,displacementMap:source.displacementMap||null,
      emissive,emissiveMap,
      opacity:Number.isFinite(source.opacity)?source.opacity:1,
      transparent:!!source.transparent,side:source.side??THREE.FrontSide,
      wireframe:!!source.wireframe,vertexColors:!!source.vertexColors,roughness,metalness:0
    });
    material.name=source.name||'Material';
    material.userData={
      ...(source.userData||{}),
      fbxSourceMaterialType:source.type||'unknown',
      ...(source.name?{gradeOptimizerFbxSourceMaterialName:source.name}:{}),
      ...(albedoRecovery?{gradeOptimizerAlbedoRecovery:albedoRecovery}:{})
    };
    if(source.bumpScale!==undefined)material.bumpScale=source.bumpScale;
    if(source.displacementScale!==undefined)material.displacementScale=source.displacementScale;
    if(source.displacementBias!==undefined)material.displacementBias=source.displacementBias;
    converted.set(source,material);
    if(sourceName)canonicalBySourceName.set(sourceName,material);
    return material;
  };
  root.traverse(object=>{
    if(!object.isMesh||!object.material)return;
    object.material=Array.isArray(object.material)?object.material.map(convert):convert(object.material);
  });
  return {sourceMaterials:converted.size,sharedNames:canonicalBySourceName.size};
}

function isMayaStageOneFbx(root,fileName=''){
  const source=String(fileName||'').toLowerCase();
  if(/(?:slopes[_ -]?)?stage[_ -]?1(?:[^0-9]|$)/i.test(source))return true;
  let hasStageOneGroup=false,hasLandscapeMaterial=false,hasAngledMaterial=false;
  root?.traverse?.(node=>{
    const name=String(node.name||'').toLowerCase();
    if(/slopes[_ -]*stage[_ -]*1/.test(name))hasStageOneGroup=true;
    if(/zzmainlandscape[_ -]*slopes|mainlandscape[_ -]*slopes/.test(name))hasLandscapeMaterial=true;
    if(/zzshapka[_ -]*angled|shapka[_ -]*angled/.test(name))hasAngledMaterial=true;
    const materials=node.isMesh?(Array.isArray(node.material)?node.material:[node.material]):[];
    materials.forEach(material=>{
      const materialName=String(material?.name||'').toLowerCase();
      if(/zzmainlandscape[_ -]*slopes|mainlandscape[_ -]*slopes/.test(materialName))hasLandscapeMaterial=true;
      if(/zzshapka[_ -]*angled|shapka[_ -]*angled/.test(materialName))hasAngledMaterial=true;
    });
  });
  return hasStageOneGroup||(hasLandscapeMaterial&&hasAngledMaterial);
}

function applyStageOneSurfaceMaterials(root){
  if(!root||typeof root.traverse!=='function')return {slopes:0,angled:0,materialCount:0};
  const counts={slopes:0,angled:0};
  let meshCount=0,materialSlots=0;
  const canonicalMaterials=new Map();
  const classify=name=>{
    const value=String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'_');
    if(/(^|_)angled?(_|$)/.test(value))return 'angled';
    if(/(^|_)slopes?(_|$)/.test(value))return 'slopes';
    return '';
  };
  const canonicalFor=(source,kind)=>{
    if(!source||!source.color)return source;
    let material=canonicalMaterials.get(kind);
    if(!material){
      material=source.clone();
      material.name=kind==='slopes'?'Slopes':'Angled';
      // The Stage 1 FBX intentionally has two surface classes. Duplicate
      // Maya aliases (including pasted__ materials and converted OpenPBR
      // slots inherited from the Slopes_Stage1 group) share one material.
      material.color.set(kind==='slopes'?0xffffff:0x383838);
      material.map=null;
      material.emissiveMap=null;
      material.emissive?.setRGB?.(0,0,0);
      if('emissiveIntensity' in material)material.emissiveIntensity=0;
      material.vertexColors=false;
      material.userData={
        ...(material.userData||{}),
        gradeOptimizerStageOneSurfaceKind:kind
      };
      material.needsUpdate=true;
      canonicalMaterials.set(kind,material);
    }
    counts[kind]++;
    return material;
  };
  const visit=(object,inheritedKind='')=>{
    const objectKind=classify(object.name)||inheritedKind;
    if(object.isMesh&&object.material){
      meshCount++;
      const materials=Array.isArray(object.material)?object.material:[object.material];
      materialSlots+=materials.length;
      const next=materials.map(material=>{
        const materialName=String(material?.name||'');
        const kind=classify(materialName)||objectKind||(/openpbr/i.test(materialName)?'slopes':'');
        return kind?canonicalFor(material,kind):material;
      });
      object.material=Array.isArray(object.material)?next:next[0];
    }
    object.children?.forEach(child=>visit(child,objectKind));
  };
  visit(root);
  const summary={
    ...counts,
    meshCount,materialSlots,
    materialCount:canonicalMaterials.size,
    materialNames:[...canonicalMaterials.values()].map(material=>material.name)
  };
  root.userData=root.userData||{};
  root.userData.gradeOptimizerStageOneMaterials=summary;
  console.info('[Grade Optimizer] Consolidated Stage 1 materials:',summary);
  return summary;
}

function normalizeStageOneMayaHierarchy(root){
  if(!root||typeof root.getObjectByName!=='function')return null;
  const sketchfabGroup=root.getObjectByName('ToSketchfab');
  if(!sketchfabGroup)return null;

  const removedOffset=sketchfabGroup.position.toArray();
  const normalizedNodes=[];
  root.traverse(node=>{
    if(node===root)return;
    const previous=node.scale.toArray();
    if(previous.some(value=>Math.abs(value-1)>1e-4)){
      normalizedNodes.push({name:node.name||'(unnamed)',scale:previous});
      node.scale.set(1,1,1);
    }
  });
  sketchfabGroup.position.set(0,0,0);
  root.updateMatrixWorld(true,true);
  const result={
    strategy:'normalize-ToSketchfab-CADScale-hierarchy',
    removedGroup:'ToSketchfab',
    removedOffset,
    normalizedScaleNodeCount:normalizedNodes.length,
    normalizedScaleNodes:normalizedNodes
  };
  root.userData=root.userData||{};
  root.userData.gradeOptimizerFbxNormalization=result;
  console.info('[Grade Optimizer] Normalized Maya Stage1 FBX hierarchy:',result);
  return result;
}

function disableMaterialEmissionByDefault(root){
  if(!root||typeof root.traverse!=='function')return 0;
  let affected=0;
  root.traverse(object=>{
    if(!object.isMesh||!object.material)return;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    materials.forEach(material=>{
      if(!material||!('emissiveIntensity' in material))return;
      const userData=material.userData||{};
      const savedStrength=Number.isFinite(userData.gradeOptimizerEmissiveStrength)
        ?Math.max(0,userData.gradeOptimizerEmissiveStrength)
        :Math.max(0,Number(material.emissiveIntensity)||1);
      const enabled=userData.gradeOptimizerEmissiveEnabled===true;
      material.userData={
        ...userData,
        gradeOptimizerEmissiveEnabled:enabled,
        gradeOptimizerEmissiveStrength:savedStrength
      };
      material.emissiveIntensity=enabled?savedStrength:0;
      affected++;
    });
  });
  return affected;
}
async function parseSceneModel(buffer,fileName,resourcePath=''){
  if(/\.fbx$/i.test(String(fileName||''))){
    const root=fbxLoader.parse(buffer,resourcePath||'');
    if(!root)throw new Error('FBX не содержит сцены.');
    const isStageOneSlopes=isMayaStageOneFbx(root,fileName);
    if(isStageOneSlopes)normalizeStageOneMayaHierarchy(root);
    prepareFbxMaterials(root,{preserveSlopeAlbedo:isStageOneSlopes});
    if(isStageOneSlopes)applyStageOneSurfaceMaterials(root);
    disableMaterialEmissionByDefault(root);
    mergeEquivalentEditorMaterials(root);
    return {scene:root};
  }
  return await new Promise((resolve,reject)=>loader.parse(buffer,'',gltf=>{
    const sceneRoot=gltf.scene||gltf.scenes?.[0];
    if(isMayaStageOneFbx(sceneRoot,fileName))applyStageOneSurfaceMaterials(sceneRoot);
    disableMaterialEmissionByDefault(sceneRoot);
    mergeEquivalentEditorMaterials(sceneRoot);
    resolve(gltf);
  },reject));
}
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

// ---------- Snow surface + lightweight test forest ----------
let snowTextures = null;
let treeBillboardMaterial = null;
function updateForestDaylight(daylight) {
  // A restrained albedo-matched emissive lift keeps the atlas readable in
  // daytime without bringing back the old permanently bright night forest.
  forestEmissiveIntensity = 0.035 + THREE.MathUtils.clamp(daylight,0,1) * 0.24;
  treeLightingMaterials.forEach(material => {
    material.emissiveIntensity = forestEmissiveIntensity;
  });
}

const AI_PINE_VARIANTS=[
  'spruce_dense','spruce_slim','spruce_broad','spruce_windswept',
  'fir_compact','fir_layered','fir_irregular','spruce_mountain'
];
let aiPineTextures=null,aiPineTexturesPromise=null;
let forestPlacementCache=null;
function getVisibleSlopeAssets(){
  return state.importedAssets.filter(asset=>
    asset?.meta?.category==='slope'&&asset.root?.visible!==false&&asset.meta?.visible!==false
  );
}
function slopeAssetsSignature(assets){
  return assets.map(asset=>{
    asset.root.updateWorldMatrix(true,true);
    const bounds=new THREE.Box3().setFromObject(asset.root);
    return [asset.id,asset.root.uuid,...bounds.min.toArray(),...bounds.max.toArray()].join(':');
  }).join('|');
}
function buildSlopeFootprintLookup(baseBounds,assets){
  if(!assets.length)return null;
  const size=baseBounds.getSize(new THREE.Vector3());
  const cellSize=Math.max(12,Math.min(32,Math.max(size.x,size.z)/300));
  const cols=Math.max(1,Math.ceil(size.x/cellSize)),rows=Math.max(1,Math.ceil(size.z/cellSize));
  const cells=new Map(),large=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  const insert=(ax,az,bx,bz,cx,cz)=>{
    const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
    if(Math.abs(den)<1e-10)return;
    const triangle={ax,az,bx,bz,cx,cz,den};
    const ix0=Math.max(0,Math.floor((Math.min(ax,bx,cx)-baseBounds.min.x)/cellSize));
    const ix1=Math.min(cols-1,Math.floor((Math.max(ax,bx,cx)-baseBounds.min.x)/cellSize));
    const iz0=Math.max(0,Math.floor((Math.min(az,bz,cz)-baseBounds.min.z)/cellSize));
    const iz1=Math.min(rows-1,Math.floor((Math.max(az,bz,cz)-baseBounds.min.z)/cellSize));
    if(ix1<ix0||iz1<iz0)return;
    if((ix1-ix0+1)*(iz1-iz0+1)>256){large.push(triangle);return;}
    for(let iz=iz0;iz<=iz1;iz++)for(let ix=ix0;ix<=ix1;ix++){
      const key=iz*cols+ix;
      let bucket=cells.get(key);
      if(!bucket){bucket=[];cells.set(key,bucket);}
      bucket.push(triangle);
    }
  };
  for(const asset of assets){
    asset.root.updateWorldMatrix(true,true);
    asset.root.traverseVisible(object=>{
      if(!object.isMesh||!object.geometry?.attributes?.position)return;
      object.updateWorldMatrix(true,false);
      const geometry=object.geometry,positions=geometry.attributes.position,index=geometry.index;
      const count=index?index.count:positions.count;
      for(let offset=0;offset+2<count;offset+=3){
        const ia=index?index.getX(offset):offset;
        const ib=index?index.getX(offset+1):offset+1;
        const ic=index?index.getX(offset+2):offset+2;
        a.fromBufferAttribute(positions,ia).applyMatrix4(object.matrixWorld);
        b.fromBufferAttribute(positions,ib).applyMatrix4(object.matrixWorld);
        c.fromBufferAttribute(positions,ic).applyMatrix4(object.matrixWorld);
        insert(a.x,a.z,b.x,b.z,c.x,c.z);
      }
    });
  }
  return {originX:baseBounds.min.x,originZ:baseBounds.min.z,cellSize,cols,rows,cells,large};
}
function pointInSlopeTriangle(x,z,t){
  const wa=((t.bz-t.cz)*(x-t.cx)+(t.cx-t.bx)*(z-t.cz))/t.den;
  const wb=((t.cz-t.az)*(x-t.cx)+(t.ax-t.cx)*(z-t.cz))/t.den;
  return wa>=-1e-5&&wb>=-1e-5&&1-wa-wb>=-1e-5;
}
function isTreePointOnSlope(x,z,lookup){
  if(!lookup)return false;
  const ix=Math.floor((x-lookup.originX)/lookup.cellSize);
  const iz=Math.floor((z-lookup.originZ)/lookup.cellSize);
  if(ix>=0&&iz>=0&&ix<lookup.cols&&iz<lookup.rows){
    const bucket=lookup.cells.get(iz*lookup.cols+ix);
    if(bucket&&bucket.some(t=>pointInSlopeTriangle(x,z,t)))return true;
  }
  return lookup.large.some(t=>pointInSlopeTriangle(x,z,t));
}
function loadAiPineTextures(){
  if(!aiPineTexturesPromise){
    aiPineTexturesPromise=(async()=>{
      const atlas=await new THREE.TextureLoader().loadAsync('./assets/trees/snowy_conifer_atlas.webp');
      const image=atlas.image;
      const cellWidth=Math.floor(image.width/4);
      const cellHeight=Math.floor(image.height/2);
      if(image.width!==1632||image.height!==1200){
        throw new Error('Unexpected OpenAI tree atlas dimensions: '+image.width+'x'+image.height);
      }

      // Crop each tree into its own canvas before mipmap generation.
      // This prevents mip levels from blending pixels from neighbouring atlas cells.
      aiPineTextures=AI_PINE_VARIANTS.map((name,index)=>{
        const column=index%4;
        const row=Math.floor(index/4);
        const canvas=document.createElement('canvas');
        canvas.width=cellWidth;
        canvas.height=cellHeight;
        const context=canvas.getContext('2d');
        if(!context)throw new Error('Cannot create canvas for '+name);
        context.clearRect(0,0,cellWidth,cellHeight);
        context.drawImage(
          image,
          column*cellWidth,row*cellHeight,cellWidth,cellHeight,
          0,0,cellWidth,cellHeight
        );
        const texture=new THREE.CanvasTexture(canvas);
        texture.colorSpace=THREE.SRGBColorSpace;
        texture.wrapS=THREE.ClampToEdgeWrapping;
        texture.wrapT=THREE.ClampToEdgeWrapping;
        texture.generateMipmaps=true;
        texture.minFilter=THREE.LinearMipmapLinearFilter;
        texture.magFilter=THREE.LinearFilter;
        texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
        texture.name='OpenAI_Generated_'+name;
        return texture;
      });
      atlas.dispose();
      return aiPineTextures;
    })().catch(error=>{
      console.warn('OpenAI snowy-tree atlas did not load; procedural forest fallback remains active.',error);
      aiPineTexturesPromise=null;
      return null;
    });
  }
  return aiPineTexturesPromise;
}
const TERRAIN_SNOW_TILE_METERS=120;

function makeSnowTextures() {
  if (snowTextures) return snowTextures;
  const size=512;
  const colorCanvas=document.createElement('canvas');
  colorCanvas.width=colorCanvas.height=size;
  const colorCtx=colorCanvas.getContext('2d');
  const colorImage=colorCtx.createImageData(size,size);

  // Smooth, tileable, low-frequency snow variation. The old per-pixel random
  // grain and high-frequency bump map shimmered across the kilometre-scale
  // source terrain when the camera moved or the surface was minified.
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4;
    const u=x/size,v=y/size;
    const waveA=Math.sin(2*Math.PI*(2*u+v))*1.65;
    const waveB=Math.sin(2*Math.PI*(u-3*v))*1.15;
    const waveC=Math.cos(2*Math.PI*(4*u+2*v))*0.55;
    const shade=waveA+waveB+waveC;
    colorImage.data[i]=Math.max(0,Math.min(255,232+shade));
    colorImage.data[i+1]=Math.max(0,Math.min(255,240+shade));
    colorImage.data[i+2]=Math.max(0,Math.min(255,247+shade));
    colorImage.data[i+3]=255;
  }
  colorCtx.putImageData(colorImage,0,0);

  const map=new THREE.CanvasTexture(colorCanvas);
  map.name='GO_Terrain_Snow_LowFrequency_Albedo';
  map.colorSpace=THREE.SRGBColorSpace;
  map.wrapS=map.wrapT=THREE.RepeatWrapping;
  map.generateMipmaps=true;
  map.minFilter=THREE.LinearMipmapLinearFilter;
  map.magFilter=THREE.LinearFilter;
  map.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());

  // No bump map: the previous high-frequency stochastic bump was the main
  // source of distance-dependent surface sparkle / temporal aliasing.
  snowTextures={map,bump:null};
  return snowTextures;
}

function setTerrainSnowMaterial(mesh, metersPerLocalUnit = 1) {
  const geometry=mesh.geometry;
  const position=geometry&&geometry.attributes&&geometry.attributes.position;
  if(!position)return;
  const uv=new Float32Array(position.count*2);
  // One subtle, seamless snow-variation tile spans 120 metres.
  for(let i=0;i<position.count;i++){
    uv[i*2]=position.getX(i)*metersPerLocalUnit/TERRAIN_SNOW_TILE_METERS;
    uv[i*2+1]=position.getZ(i)*metersPerLocalUnit/TERRAIN_SNOW_TILE_METERS;
  }
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  const tex=makeSnowTextures();
  const material=new THREE.MeshStandardMaterial({
    color:0xffffff,
    map:tex.map,
    roughness:1,
    metalness:0,
    side:THREE.DoubleSide,
    emissive:0x000000,
    emissiveIntensity:0
  });
  material.userData={
    gradeOptimizerEmissiveEnabled:false,
    gradeOptimizerEmissiveStrength:1,
    gradeOptimizerTerrainTexture:'low-frequency-albedo-no-bump'
  };
  mesh.material=material;
  mesh.receiveShadow=true;
  state.terrainMats.push(material);
}

function makePineTextures() {
  const width=256, height=512;
  const canvas=document.createElement('canvas');
  canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext('2d');
  const cx=128;

  // Trunk and layered conifer silhouette, with small snowy branch highlights.
  const trunk=ctx.createLinearGradient(115,0,143,0);
  trunk.addColorStop(0,'#382f2a'); trunk.addColorStop(0.45,'#765b43'); trunk.addColorStop(1,'#302b29');
  ctx.fillStyle=trunk;
  ctx.beginPath(); ctx.moveTo(119,490); ctx.lineTo(121,275); ctx.lineTo(136,275); ctx.lineTo(140,490); ctx.closePath(); ctx.fill();

  const greens=['#477d58','#538b63','#60996d','#3e724f','#6b9d70'];
  for (let layer=0;layer<5;layer++) {
    const top=24+layer*63;
    const base=105+layer*58;
    const half=31+layer*18;
    const grad=ctx.createLinearGradient(0,top,0,base);
    grad.addColorStop(0,greens[layer]);
    grad.addColorStop(1,layer%2?'#315b40':'#356448');
    ctx.fillStyle=grad;
    ctx.beginPath();
    ctx.moveTo(cx,top);
    ctx.lineTo(cx-half*0.55,top+27);
    ctx.lineTo(cx-half*0.37,top+26);
    ctx.lineTo(cx-half,base-8);
    ctx.lineTo(cx-half*0.56,base-2);
    ctx.lineTo(cx-half*0.72,base+8);
    ctx.lineTo(cx,base-4);
    ctx.lineTo(cx+half*0.72,base+8);
    ctx.lineTo(cx+half*0.56,base-2);
    ctx.lineTo(cx+half,base-8);
    ctx.lineTo(cx+half*0.37,top+26);
    ctx.lineTo(cx+half*0.55,top+27);
    ctx.closePath(); ctx.fill();

    ctx.strokeStyle='rgba(218,238,229,0.42)';
    ctx.lineWidth=3.2;
    ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(cx-half*0.80,base-10);
    ctx.lineTo(cx-half*0.43,top+34);
    ctx.lineTo(cx-half*0.14,top+7);
    ctx.stroke();
    for (let k=0;k<12;k++) {
      const yy=top+18+Math.random()*Math.max(8,base-top-26);
      const side=Math.random()<0.5?-1:1;
      const xx=cx+side*(8+Math.random()*half*0.72);
      ctx.strokeStyle='rgba(8,28,25,0.22)';
      ctx.lineWidth=1.2;
      ctx.beginPath(); ctx.moveTo(xx,yy); ctx.lineTo(xx+side*7,yy+4); ctx.stroke();
    }
  }

  const map=new THREE.CanvasTexture(canvas);
  map.colorSpace=THREE.SRGBColorSpace;
  map.minFilter=THREE.LinearMipmapLinearFilter;
  map.magFilter=THREE.LinearFilter;
  map.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());

  // Approximate tangent-space normal map from the cutout silhouette.
  // The alpha gradient gives the card subtle edge lighting rather than a flat plane look.
  const src=ctx.getImageData(0,0,width,height).data;
  const normalCanvas=document.createElement('canvas');
  normalCanvas.width=width; normalCanvas.height=height;
  const nctx=normalCanvas.getContext('2d');
  const nimg=nctx.createImageData(width,height);
  const alpha=(x,y)=> {
    if(x<0||x>=width||y<0||y>=height)return 0;
    return src[(y*width+x)*4+3];
  };
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=(y*width+x)*4;
    const dx=(alpha(x+1,y)-alpha(x-1,y))/255;
    const dy=(alpha(x,y+1)-alpha(x,y-1))/255;
    nimg.data[i]=Math.max(0,Math.min(255,128-dx*42));
    nimg.data[i+1]=Math.max(0,Math.min(255,128+dy*42));
    nimg.data[i+2]=245;
    nimg.data[i+3]=255;
  }
  nctx.putImageData(nimg,0,0);
  const normalMap=new THREE.CanvasTexture(normalCanvas);
  normalMap.minFilter=THREE.LinearMipmapLinearFilter;
  normalMap.magFilter=THREE.LinearFilter;
  treeBillboardMaterial=new THREE.MeshStandardMaterial({
    map, normalMap, normalScale:new THREE.Vector2(0.32,0.32),
    color:0xffffff, emissive:0xffffff, emissiveMap:map, emissiveIntensity:forestEmissiveIntensity,
    roughness:1, metalness:0, side:THREE.DoubleSide,
    alphaTest:0.12, transparent:false
  });
  treeLightingMaterials.push(treeBillboardMaterial);
  return treeBillboardMaterial;
}

function clearTestForest() {
  if(state.forestGroup){
    scene.remove(state.forestGroup);
    disposeObjectTree(state.forestGroup);
  }
  if(treeBillboardMaterial) {
    treeBillboardMaterial.map?.dispose();
    treeBillboardMaterial.normalMap?.dispose();
    treeBillboardMaterial.dispose();
    treeBillboardMaterial=null;
  }
  treeLightingMaterials=[];
  state.forestGroup=null;
  state.billboardMesh=null;
  state.billboardMeshes=[];
  state.billboardTrees=[];
  lastBillboardCameraX=NaN;lastBillboardCameraZ=NaN;
}

function buildTestForest({reusePlacements=false}={}) {
  clearTestForest();
  const forestTerrain=state.baseTerrain;
  if(!forestTerrain)return;
  forestTerrain.updateWorldMatrix(true,true);
  const bounds=new THREE.Box3().setFromObject(forestTerrain);
  const spanX=bounds.max.x-bounds.min.x;
  const spanZ=bounds.max.z-bounds.min.z;
  const laneZ=bounds.min.z+spanZ*0.187;
  let seed=0x51A1;
  const rnd=()=>{ seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; };
  const desiredCount=380,minSpacing=11.5;
  const xMin=bounds.min.x+spanX*0.025,xMax=bounds.max.x-spanX*0.025;
  const zMin=bounds.min.z+spanZ*0.025,zMax=bounds.max.z-spanZ*0.025;
  const boundsKey=[bounds.min.x,bounds.min.y,bounds.min.z,bounds.max.x,bounds.max.y,bounds.max.z].join('|');
  const hasTreeAreas=state.treeAreas.length>0;
  const areasKey=JSON.stringify(state.treeAreas.map(area=>({id:area.id,points:area.points})));
  const slopeAssets=getVisibleSlopeAssets();
  const slopeKey=slopeAssetsSignature(slopeAssets);
  let trees=null;
  if(reusePlacements&&forestPlacementCache?.terrain===forestTerrain&&forestPlacementCache.boundsKey===boundsKey&&
     forestPlacementCache.areasKey===areasKey&&forestPlacementCache.slopeKey===slopeKey){
    trees=forestPlacementCache.trees.map(tree=>({...tree}));
  }else{
    const meshes=[];
    forestTerrain.traverse(object=>{if(object.isMesh&&object.geometry?.attributes?.position)meshes.push(object);});
    const totalVertices=meshes.reduce((sum,mesh)=>sum+mesh.geometry.attributes.position.count,0);
    if(!totalVertices)return;
    const stride=Math.max(1,Math.ceil(totalVertices/24000));
    const candidates=[],vertex=new THREE.Vector3();
    for(const mesh of meshes){
      mesh.updateWorldMatrix(true,false);
      const positions=mesh.geometry.attributes.position;
      for(let i=0;i<positions.count;i+=stride){
        vertex.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);
        if(vertex.x>=xMin&&vertex.x<=xMax&&vertex.z>=zMin&&vertex.z<=zMax)candidates.push({x:vertex.x,y:vertex.y,z:vertex.z});
      }
    }
    // Tree Area polygons are world-space X/Z; visible piste geometry is excluded.
    const slopeFootprint=buildSlopeFootprintLookup(bounds,slopeAssets);
    for(let i=candidates.length-1;i>0;i--){
      const j=Math.floor(rnd()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];
    }
    trees=[];
    const occupied=new Map();
    for(const candidate of candidates){
      if(hasTreeAreas&&!state.treeAreas.some(area=>pointInPoly(candidate.x,candidate.z,area.points)))continue;
      if(isTreePointOnSlope(candidate.x,candidate.z,slopeFootprint))continue;
      if(!hasTreeAreas&&Math.abs(candidate.z-laneZ)<27+rnd()*8)continue;
      const cx=Math.floor(candidate.x/minSpacing),cz=Math.floor(candidate.z/minSpacing);
      let tooClose=false;
      for(let dz=-1;dz<=1&&!tooClose;dz++)for(let dx=-1;dx<=1;dx++){
        const bucket=occupied.get((cx+dx)+':'+(cz+dz));
        if(bucket&&bucket.some(tree=>Math.hypot(tree.x-candidate.x,tree.z-candidate.z)<minSpacing)){tooClose=true;break;}
      }
      if(tooClose)continue;
      const height=6+rnd()*5.6;
      const tree={...candidate,height,width:height*(0.44+rnd()*0.10)};
      trees.push(tree);
      const key=cx+':'+cz;let bucket=occupied.get(key);
      if(!bucket){bucket=[];occupied.set(key,bucket);}
      bucket.push(tree);
      if(trees.length>=desiredCount)break;
    }
    forestPlacementCache={terrain:forestTerrain,boundsKey,areasKey,slopeKey,trees:trees.map(tree=>({...tree}))};
  }
  if(!trees.length)return;
  const forest=new THREE.Group();
  forest.name='TestForest_Billboards_LOD';
  state.forestGroup=forest;
  scene.add(forest);

  // A single camera-facing card per tree: no intersecting planes, so no z-fighting.
  if(aiPineTextures&&aiPineTextures.length===AI_PINE_VARIANTS.length){
    const byVariant=AI_PINE_VARIANTS.map(()=>[]);
    trees.forEach(t=>{
      t.variant=Math.floor(rnd()*AI_PINE_VARIANTS.length);
      byVariant[t.variant].push(t);
    });
    const sets=[];
    const dummy=new THREE.Object3D();
    const geometry=new THREE.PlaneGeometry(1,1);
    byVariant.forEach((variantTrees,variantIndex)=>{
      if(!variantTrees.length)return;
      const treeTexture=aiPineTextures[variantIndex].clone();
      const material=new THREE.MeshStandardMaterial({
        map:treeTexture,
        color:0xffffff,
        emissive:0xffffff,
        emissiveMap:treeTexture,
        emissiveIntensity:forestEmissiveIntensity,
        roughness:0.98,
        metalness:0,
        side:THREE.DoubleSide,
        alphaTest:0.10,
        alphaToCoverage:true,
        fog:true,
        depthWrite:true
      });
      treeLightingMaterials.push(material);
      const mesh=new THREE.InstancedMesh(geometry,material,variantTrees.length);
      mesh.name='OpenAI_'+AI_PINE_VARIANTS[variantIndex]+'_CameraFacing';
      mesh.frustumCulled=false;
      mesh.castShadow=false;
      mesh.receiveShadow=false;
      variantTrees.forEach((t,i)=>{
        const scale=t.height*(.92+rnd()*.16);
        t.billboardHeight=scale;
        t.billboardWidth=scale*.64;
        dummy.position.set(t.x,t.y+scale*.5,t.z);
        dummy.rotation.set(0,Math.atan2(camera.position.x-t.x,camera.position.z-t.z),0);
        dummy.scale.set(t.billboardWidth,scale,1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i,dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate=true;
      forest.add(mesh);
      sets.push({mesh,trees:variantTrees,offset:0});
    });
    state.billboardMesh=sets.length?sets[0].mesh:null;
    state.billboardMeshes=sets;
    state.billboardTrees=trees.map(t=>({
      x:t.x,y:t.y,z:t.z,
      height:t.billboardHeight||t.height,
      width:t.billboardWidth||t.width
    }));
    dbg('OpenAI AI-лес: '+trees.length+' деревьев на исходном рельефе'+(hasTreeAreas?' · '+state.treeAreas.length+' Tree Areas':'')+' · '+AI_PINE_VARIANTS.length+' вариантов · single camera-facing card');
    return;
  }
  // Procedural fallback while the generated texture is loading.
  const closeTrees=trees.filter((t,i)=>Math.abs(t.z-laneZ)<105 && i%4===0).slice(0,42);
  if(closeTrees.length) {
    const trunkGeo=new THREE.CylinderGeometry(0.08,0.13,1,5);
    const coneGeo=new THREE.ConeGeometry(1,2,6,1);
    const trunkMat=new THREE.MeshStandardMaterial({color:0x8b7055,roughness:1});
    const foliageMat=new THREE.MeshStandardMaterial({
      color:0x4d875c, emissive:0x4d875c, emissiveIntensity:forestEmissiveIntensity, roughness:0.96
    });
    treeLightingMaterials.push(foliageMat);
    const trunkMesh=new THREE.InstancedMesh(trunkGeo,trunkMat,closeTrees.length);
    const lowerMesh=new THREE.InstancedMesh(coneGeo,foliageMat,closeTrees.length);
    const middleMesh=new THREE.InstancedMesh(coneGeo,foliageMat,closeTrees.length);
    const topMesh=new THREE.InstancedMesh(coneGeo,foliageMat,closeTrees.length);
    const dummy=new THREE.Object3D();
    closeTrees.forEach((t,i)=>{
      const h=t.height*1.04;
      dummy.rotation.set(0,rnd()*Math.PI*2,0);
      dummy.position.set(t.x,t.y+h*0.15,t.z);
      dummy.scale.set(0.82,h*0.19,0.82);
      dummy.updateMatrix(); trunkMesh.setMatrixAt(i,dummy.matrix);

      const tiers=[[0.46,0.40,0.43],[0.68,0.33,0.34],[0.86,0.23,0.26]];
      for(const [index,mesh] of [lowerMesh,middleMesh,topMesh].entries()) {
        const tier=tiers[index];
        dummy.position.set(t.x,t.y+h*tier[0],t.z);
        dummy.scale.set(h*tier[1],h*tier[2],h*tier[1]);
        dummy.updateMatrix(); mesh.setMatrixAt(i,dummy.matrix);
      }
      const tint=new THREE.Color().setHSL(0.36+rnd()*0.035,0.28+rnd()*0.10,0.43+rnd()*0.09);
      lowerMesh.setColorAt(i,tint);
      middleMesh.setColorAt(i,tint.clone().offsetHSL(0,0,0.035));
      topMesh.setColorAt(i,tint.clone().offsetHSL(0,0,0.07));
    });
    [trunkMesh,lowerMesh,middleMesh,topMesh].forEach(m=>{
      m.castShadow=false; m.receiveShadow=true; m.frustumCulled=false; forest.add(m);
    });
  }

  const billboardTrees=trees.filter(t=>!closeTrees.includes(t));
  if(billboardTrees.length) {
    const material=makePineTextures();
    const geometry=new THREE.PlaneGeometry(1,1);
    const mesh=new THREE.InstancedMesh(geometry,material,billboardTrees.length);
    mesh.name='Pine_Billboard_Impostors';
    mesh.frustumCulled=false;
    mesh.castShadow=false;
    mesh.receiveShadow=false;
    const dummy=new THREE.Object3D();
    billboardTrees.forEach((t,i)=>{
      dummy.position.set(t.x,t.y+t.height*0.5,t.z);
      dummy.rotation.set(0,rnd()*Math.PI*2,0);
      dummy.scale.set(t.width,t.height,1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i,dummy.matrix);
      // Keep billboard albedo untinted: setColorAt here multiplied an already dark map.
    });
    mesh.instanceMatrix.needsUpdate=true;
    forest.add(mesh);
    state.billboardMesh=mesh;
    state.billboardTrees=billboardTrees.map(t=>({x:t.x,y:t.y,z:t.z,height:t.height,width:t.width}));
  }
  dbg('Лес исходного рельефа: '+trees.length+' деревьев'+(hasTreeAreas?' в '+state.treeAreas.length+' Tree Areas':'')+' · 3D '+closeTrees.length+' · billboard '+billboardTrees.length);
}

const forestUp=new THREE.Vector3(0,1,0);
const forestPosition=new THREE.Vector3();
const forestScale=new THREE.Vector3();
const forestQuaternion=new THREE.Quaternion();
const forestMatrix=new THREE.Matrix4();
let lastBillboardCameraX=NaN,lastBillboardCameraZ=NaN,lastForestBillboardUpdateAt=0;
function updateForestBillboards() {
  const now=performance.now();
  if(state.mode==='skier'&&now-lastForestBillboardUpdateAt<100)return;
  const cameraX=camera.position.x,cameraZ=camera.position.z;
  if(Number.isFinite(lastBillboardCameraX)&&
     (cameraX-lastBillboardCameraX)**2+(cameraZ-lastBillboardCameraZ)**2<0.0001)return;
  if(state.billboardMeshes?.length){
    state.billboardMeshes.forEach(set=>{
      const trees=set.trees||state.billboardTrees;
      trees.forEach((t,i)=>{
        const height=t.billboardHeight||t.height;
        const width=t.billboardWidth||t.width*1.08;
        const yaw=Math.atan2(camera.position.x-t.x,camera.position.z-t.z)+set.offset;
        forestQuaternion.setFromAxisAngle(forestUp,yaw);
        forestPosition.set(t.x,t.y+height*.5,t.z);
        forestScale.set(width,height,1);
        forestMatrix.compose(forestPosition,forestQuaternion,forestScale);
        set.mesh.setMatrixAt(i,forestMatrix);
      });
      set.mesh.instanceMatrix.needsUpdate=true;
    });
    lastBillboardCameraX=cameraX;lastBillboardCameraZ=cameraZ;lastForestBillboardUpdateAt=now;
    return;
  }
  if(!state.billboardMesh||!state.billboardTrees.length)return;
  state.billboardTrees.forEach((t,i)=>{
    const yaw=Math.atan2(camera.position.x-t.x,camera.position.z-t.z);
    forestQuaternion.setFromAxisAngle(forestUp,yaw);
    forestPosition.set(t.x,t.y+t.height*.5,t.z);
    forestScale.set(t.width,t.height,1);
    forestMatrix.compose(forestPosition,forestQuaternion,forestScale);
    state.billboardMesh.setMatrixAt(i,forestMatrix);
  });
  state.billboardMesh.instanceMatrix.needsUpdate=true;
  lastBillboardCameraX=cameraX;lastBillboardCameraZ=cameraZ;lastForestBillboardUpdateAt=now;
}


function disposeObjectTree(root){
  if(!root)return;
  const geometries=new Set(),materials=new Set(),textures=new Set();
  root.traverse(object=>{
    if(object.geometry)geometries.add(object.geometry);
    const list=Array.isArray(object.material)?object.material:(object.material?[object.material]:[]);
    list.forEach(material=>{
      if(!material)return;
      materials.add(material);
      Object.values(material).forEach(value=>{if(value&&value.isTexture)textures.add(value);});
    });
  });
  textures.forEach(texture=>{
    if(texture.userData?.editorObjectUrl)URL.revokeObjectURL(texture.userData.editorObjectUrl);
    texture.dispose();
  });
  materials.forEach(material=>material.dispose());
  geometries.forEach(geometry=>geometry.dispose());
}
function clearGroup(g){
  if(g){scene.remove(g);disposeObjectTree(g);}
  return null;
}

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

function collectVisibleOverviewMeshes(root,targets,seen){
  if(!root||!root.visible||typeof root.traverseVisible!=='function')return;
  root.traverseVisible(object=>{
    if((object.isMesh||object.isLine||object.isPoints)&&object.geometry&&!seen.has(object)){
      seen.add(object);targets.push(object);
    }
  });
}
function getOverviewGeometryTargets(){
  const targets=[],seen=new Set();
  const roots=[state.root];
  if(state.terrain&&state.terrainVisible)roots.push(state.terrain);
  if(state.designGroup&&state.designVisible)roots.push(state.designGroup);
  state.importedAssets.forEach(asset=>{if(asset?.root)roots.push(asset.root);});
  roots.forEach(root=>collectVisibleOverviewMeshes(root,targets,seen));
  return targets;
}
function focusOverviewGeometryAt(clientX,clientY,{touch=false}={}){
  if(state.mode!=='overview'||!controls.enabled)return false;
  const rect=renderer.domElement.getBoundingClientRect();
  if(!rect.width||!rect.height)return false;
  ndc.x=((clientX-rect.left)/rect.width)*2-1;
  ndc.y=-((clientY-rect.top)/rect.height)*2+1;
  clickRay.setFromCamera(ndc,camera);
  const hits=clickRay.intersectObjects(getOverviewGeometryTargets(),false);
  if(!hits.length)return false;

  const currentDistance=camera.position.distanceTo(controls.target);
  // Ignore distant back-faces / stray geometry beyond the current viewing area.
  const maxHitDistance=touch
    ? THREE.MathUtils.clamp(currentDistance*1.35,180,900)
    : THREE.MathUtils.clamp(currentDistance*2.0,250,1800);
  const hit=hits.find(item=>Number.isFinite(item.distance)&&item.distance<=maxHitDistance);
  if(!hit)return false;

  const point=hit.point.clone();
  const direction=camera.position.clone().sub(point);
  if(direction.lengthSq()<1e-8)return false;
  direction.normalize();
  // Re-aim at the selected point without changing the current zoom / camera radius.
  const nextDistance=Math.max(1,currentDistance);
  controls.target.copy(point);
  camera.position.copy(point).addScaledVector(direction,nextDistance);
  camera.lookAt(point);
  camera.updateMatrixWorld(true);
  controls.update();
  targetDist=null;
  return true;
}

// Mouse double-click and touch double-tap share the same geometry picking / focus path.
let lastTouchFocusAt=0;
renderer.domElement.addEventListener('dblclick',event=>{
  // Spawn-placement clicks must never trigger the overview geometry focus picker.
  if(performance.now()-lastSkierSpawnPlacementPointerAt<700)return;
  // Some mobile browsers synthesize dblclick after the two pointer taps.
  if(performance.now()-lastTouchFocusAt<700)return;
  // Place the flag before moving the camera, so both actions use the same clicked point.
  placeSharedFlagFromOverviewClick(event);
  focusOverviewGeometryAt(event.clientX,event.clientY);
});

let overviewTouchStart=null;
let lastOverviewTouchTap=null;
renderer.domElement.addEventListener('pointerdown',event=>{
  if(event.pointerType!=='touch')return;
  if(state.mode!=='overview'||event.isPrimary===false){
    overviewTouchStart=null;lastOverviewTouchTap=null;return;
  }
  overviewTouchStart={
    pointerId:event.pointerId,
    x:event.clientX,
    y:event.clientY,
    maxMove:0,
    time:performance.now()
  };
},{passive:true});
renderer.domElement.addEventListener('pointermove',event=>{
  if(event.pointerType!=='touch'||!overviewTouchStart||event.pointerId!==overviewTouchStart.pointerId)return;
  overviewTouchStart.maxMove=Math.max(
    overviewTouchStart.maxMove,
    Math.hypot(event.clientX-overviewTouchStart.x,event.clientY-overviewTouchStart.y)
  );
},{passive:true});
renderer.domElement.addEventListener('pointerup',event=>{
  if(event.pointerType!=='touch'||!overviewTouchStart||event.pointerId!==overviewTouchStart.pointerId)return;
  const start=overviewTouchStart;
  overviewTouchStart=null;
  const now=performance.now();
  const moved=Math.max(start.maxMove,Math.hypot(event.clientX-start.x,event.clientY-start.y));
  if(state.mode!=='overview'||now-start.time>260||moved>8){
    lastOverviewTouchTap=null;return;
  }
  const previous=lastOverviewTouchTap;
  if(previous&&now-previous.time<=360&&Math.hypot(event.clientX-previous.x,event.clientY-previous.y)<=36){
    lastOverviewTouchTap=null;
    // Touch double-tap performs the same two actions as mouse double-click.
    placeSharedFlagFromOverviewClick(event);
    focusOverviewGeometryAt(event.clientX,event.clientY,{touch:true});
    lastTouchFocusAt=performance.now();
  }else{
    lastOverviewTouchTap={x:event.clientX,y:event.clientY,time:now};
  }
},{passive:true});
renderer.domElement.addEventListener('pointercancel',event=>{
  if(overviewTouchStart?.pointerId===event.pointerId)overviewTouchStart=null;
  lastOverviewTouchTap=null;
});

// ===== Прозрачность лейблов =====
function applyLabelOpacity(){
  const v=(state.labelOpacity===undefined)?1:state.labelOpacity;
  const hide=v<=0.1;
  [state.labelsGroup,state.terrainLabelsGroup,measureGroup].forEach(g=>{
    if(!g)return;
    g.traverse(o=>{
      if(o.isSprite&&o.material){
        o.material.opacity=v;
        o.material.transparent=true;
        o.material.depthWrite=false;
        o.visible=!hide;
      }
    });
  });
}

// ===== 3D-линейка =====
let measureMode=false,measurePts=[],measureGroup=null,measureComplete=false,activeSharedMeasureId='';
const measureBtn=document.getElementById('measureBtn');
const ELEV_OFF=21.21;
function clearMeasure(){
  if(activeSharedMeasureId){
    multiplayerClient?.clearMeasurement(activeSharedMeasureId);
    activeSharedMeasureId='';
  }
  if(measureGroup){
    scene.remove(measureGroup);
    disposeObjectTree(measureGroup);
    measureGroup=null;
  }
  measurePts=[];
  measureComplete=false;
}
function measureLabel(text,p,small){
  const cnv=document.createElement('canvas');cnv.width=small?300:640;cnv.height=96;
  const ctx=cnv.getContext('2d');
  ctx.fillStyle='rgba(0,0,0,0.3)';ctx.fillRect(0,0,cnv.width,96);
  ctx.fillStyle='#ffd54a';ctx.font=(small?'bold 40px':'bold 38px')+' sans-serif';ctx.textAlign='center';
  ctx.fillText(text,cnv.width/2,62);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cnv),depthTest:false,transparent:true,opacity:state.labelOpacity}));
  sp.scale.set(small?11:28,small?3.5:4.2,1);sp.position.copy(p);sp.renderOrder=11;
  return sp;
}
measureBtn.addEventListener('click',()=>{
  measureMode=!measureMode;
  measureBtn.classList.toggle('active',measureMode);
  measureBtn.title=measureMode?'Выключить линейку':'Включить линейку';
  if(!measureMode)clearMeasure();
});
let measureDown=null;
renderer.domElement.addEventListener('pointerdown',e=>{measureDown=[e.clientX,e.clientY];});
renderer.domElement.addEventListener('pointerup',e=>{
  if(state.mode !== 'overview'||!measureMode||!measureDown)return;
  if(Math.hypot(e.clientX-measureDown[0],e.clientY-measureDown[1])>5){measureDown=null;return;}
  measureDown=null;
  const rect=renderer.domElement.getBoundingClientRect();
  ndc.x=((e.clientX-rect.left)/rect.width)*2-1;
  ndc.y=-((e.clientY-rect.top)/rect.height)*2+1;
  clickRay.setFromCamera(ndc,camera);
  const targets=[];
  if(state.designGroup&&state.designVisible)targets.push(state.designGroup);
  if(state.terrain&&state.terrainVisible)targets.push(state.terrain);
  const hits=clickRay.intersectObjects(targets,true);
  if(!hits.length)return;
  const p=hits[0].point.clone();
  if(measureComplete){clearMeasure();}
  if(!measureGroup){measureGroup=new THREE.Group();scene.add(measureGroup);}
  if(!activeSharedMeasureId)activeSharedMeasureId=crypto.randomUUID().toLowerCase();
  measurePts.push(p);
  const sharedPoints=measurePts.map(point=>point.toArray());
  const mk=new THREE.Mesh(new THREE.SphereGeometry(1.1,12,12),new THREE.MeshBasicMaterial({color:0xffd54a}));
  mk.position.copy(p);measureGroup.add(mk);
  measureGroup.add(measureLabel('H '+(p.y+ELEV_OFF).toFixed(1),new THREE.Vector3(p.x,p.y+5,p.z),true));
  if(measurePts.length===2){
    const a=measurePts[0],b=measurePts[1];
    const g=new THREE.BufferGeometry().setFromPoints([a,b]);
    const ln=new THREE.Line(g,new THREE.LineDashedMaterial({color:0xffd54a,dashSize:4,gapSize:2.5}));
    ln.computeLineDistances();
    measureGroup.add(ln);
    const d3=a.distanceTo(b),dh=Math.hypot(b.x-a.x,b.z-a.z),dzv=b.y-a.y;
    const ang=Math.atan2(Math.abs(dzv),Math.max(dh,1e-6))*180/Math.PI;
    const mid=new THREE.Vector3().addVectors(a,b).multiplyScalar(0.5);
    mid.y+=7;
    measureGroup.add(measureLabel(
      d3.toFixed(1)+' м · '+ang.toFixed(1)+'° (Δh '+(dzv>=0?'+':'')+dzv.toFixed(1)+')',mid,false));
    applyLabelOpacity();
    measurePts=[];
    measureComplete=true;
  }
  multiplayerClient.publishMeasurement(sharedPoints,activeSharedMeasureId);
});

function normalizeOverviewCameraMap(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const normalized={};
  Object.entries(value).forEach(([rawSlope,pose])=>{
    const slope=String(rawSlope||'').trim();
    if(!slope||['__proto__','prototype','constructor'].includes(slope)||!pose||typeof pose!=='object')return;
    const position=Array.isArray(pose.position)?pose.position.map(Number):null;
    const target=Array.isArray(pose.target)?pose.target.map(Number):null;
    if(!position||position.length!==3||!target||target.length!==3||
       !position.every(Number.isFinite)||!target.every(Number.isFinite))return;
    if(Math.hypot(position[0]-target[0],position[1]-target[1],position[2]-target[2])<0.5)return;
    normalized[slope]={position,target};
  });
  return normalized;
}
function normalizeTreeAreas(value){
  if(!Array.isArray(value))return [];
  const result=[],seen=new Set();
  for(const item of value.slice(0,80)){
    if(!item||typeof item!=='object')continue;
    const id=String(item.id||'').trim();
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(id)||seen.has(id))continue;
    const points=[];
    for(const p of (Array.isArray(item.points)?item.points.slice(0,256):[])){
      if(!Array.isArray(p)||p.length<2)continue;
      const x=Number(p[0]),z=Number(p[1]);
      if(!Number.isFinite(x)||!Number.isFinite(z)||Math.abs(x)>1e7||Math.abs(z)>1e7)continue;
      const last=points[points.length-1];
      if(!last||Math.hypot(last[0]-x,last[1]-z)>0.05)points.push([x,z]);
    }
    if(points.length>2&&Math.hypot(points[0][0]-points[points.length-1][0],points[0][1]-points[points.length-1][1])<0.05)points.pop();
    if(points.length<3)continue;
    let area=0;
    for(let i=0;i<points.length;i++){const next=points[(i+1)%points.length];area+=points[i][0]*next[1]-next[0]*points[i][1];}
    if(Math.abs(area)<1)continue;
    seen.add(id);
    result.push({id,name:String(item.name||('Tree Area '+(result.length+1))).trim().slice(0,80)||('Tree Area '+(result.length+1)),points});
  }
  return result;
}
const SKIER_SPAWN_KEYS=['1','2','3','4','5','6','7','8','9','0'];
let skierSpawnPlacementStep=0;
let lastSkierSpawnPlacementPointerAt=0;
let skierSpawnDraft=null;
let skierSpawnPreviewMarker=null;
const skierSpawnRaycaster=new THREE.Raycaster();
const skierSpawnNdc=new THREE.Vector2();

function normalizeSkierSpawnMap(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const normalized={};
  for(const slot of SKIER_SPAWN_KEYS){
    const item=value[slot];
    if(!item||typeof item!=='object')continue;
    const position=Array.isArray(item.position)?item.position.map(Number):null;
    const headingYaw=Number(item.headingYaw);
    if(!position||position.length!==3||!position.every(Number.isFinite)||
       position.some(component=>Math.abs(component)>1e7)||!Number.isFinite(headingYaw))continue;
    normalized[slot]={
      position:position.map(component=>Number(component.toFixed(3))),
      headingYaw:Math.atan2(Math.sin(headingYaw),Math.cos(headingYaw))
    };
  }
  return normalized;
}
function setSkierSpawnStatus(message,isError=false){
  const status=document.getElementById('skierSpawnStatus');
  if(status){status.textContent=message;status.classList.toggle('error',isError);}
}
function disposeSkierSpawnGroup(group){
  if(!group)return;
  group.traverse(object=>{
    object.geometry?.dispose?.();
    const materials=Array.isArray(object.material)?object.material:(object.material?[object.material]:[]);
    materials.forEach(material=>{
      material.map?.dispose?.();
      material.dispose?.();
    });
  });
  scene.remove(group);
}
function createSkierSpawnMarker(slot,position,headingYaw,{preview=false,selected=false}={}){
  const group=new THREE.Group();
  group.name='GradeOptimizer_Skier_Spawn_'+slot+(preview?'_Preview':'');
  const color=preview?0xffd36b:(selected?0x7de0b3:0x78c8f4);
  const pad=new THREE.Mesh(
    new THREE.CylinderGeometry(0.72,0.86,0.14,24),
    new THREE.MeshBasicMaterial({color,transparent:true,opacity:preview?0.72:0.92,depthWrite:false,toneMapped:false})
  );
  pad.position.y=0.11;pad.renderOrder=28;group.add(pad);
  const ring=new THREE.Mesh(
    new THREE.TorusGeometry(1.0,0.055,8,28),
    new THREE.MeshBasicMaterial({color,transparent:true,opacity:preview?0.82:1,depthTest:false,toneMapped:false})
  );
  ring.rotation.x=Math.PI/2;ring.position.y=0.19;ring.renderOrder=29;group.add(ring);
  const arrow=new THREE.ArrowHelper(
    new THREE.Vector3(-Math.sin(headingYaw),0,-Math.cos(headingYaw)),
    new THREE.Vector3(0,0.3,0),3.8,color,1.15,0.62
  );
  arrow.line.material.depthTest=false;arrow.cone.material.depthTest=false;
  arrow.line.material.toneMapped=false;arrow.cone.material.toneMapped=false;
  arrow.renderOrder=30;group.add(arrow);
  group.userData.directionArrow=arrow;
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
  const context=canvas.getContext('2d');
  if(context){
    context.clearRect(0,0,128,128);
    context.beginPath();context.arc(64,64,52,0,Math.PI*2);
    context.fillStyle='rgba(12,22,32,.94)';context.fill();
    context.lineWidth=7;context.strokeStyle='#'+color.toString(16).padStart(6,'0');context.stroke();
    context.fillStyle='#f5fbff';context.font='700 62px system-ui,sans-serif';
    context.textAlign='center';context.textBaseline='middle';context.fillText(slot,64,67);
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const badge=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));
  badge.position.set(0,2.25,0);badge.scale.set(2.3,2.3,1);badge.renderOrder=32;group.add(badge);
  group.position.fromArray(position);group.position.y+=0.12;
  group.userData.slot=slot;
  return group;
}
function setSkierSpawnMarkerHeading(marker,headingYaw){
  const arrow=marker?.userData?.directionArrow;
  if(!arrow||!Number.isFinite(headingYaw))return;
  arrow.setDirection(new THREE.Vector3(-Math.sin(headingYaw),0,-Math.cos(headingYaw)));
}
function updateSkierSpawnOverlayVisibility(){
  if(state.skierSpawnGroup){
    state.skierSpawnGroup.visible=state.mode==='overview'&&appRoot.classList.contains('editor-open');
  }
}
function renderSkierSpawnOverlays(){
  disposeSkierSpawnGroup(state.skierSpawnGroup);
  state.skierSpawnGroup=new THREE.Group();
  state.skierSpawnGroup.name='GradeOptimizer_Skier_Spawn_Overlays';
  SKIER_SPAWN_KEYS.forEach(slot=>{
    const spawn=state.skierSpawns?.[slot];
    if(!spawn)return;
    const marker=createSkierSpawnMarker(slot,spawn.position,spawn.headingYaw,{
      selected:slot===state.selectedSkierSpawnSlot
    });
    state.skierSpawnGroup.add(marker);
  });
  skierSpawnPreviewMarker=null;
  if(skierSpawnDraft){
    skierSpawnPreviewMarker=createSkierSpawnMarker(
      state.selectedSkierSpawnSlot,skierSpawnDraft.position,skierSpawnDraft.headingYaw,
      {preview:true,selected:true}
    );
    state.skierSpawnGroup.add(skierSpawnPreviewMarker);
  }
  scene.add(state.skierSpawnGroup);
  updateSkierSpawnOverlayVisibility();
}
function updateSkierSpawnPanel(){
  const slots=document.getElementById('skierSpawnSlots');
  if(!slots)return;
  const spawns=normalizeSkierSpawnMap(state.skierSpawns);
  state.skierSpawns=spawns;
  let count=0;
  slots.querySelectorAll('[data-skier-spawn-slot]').forEach(button=>{
    const slot=button.dataset.skierSpawnSlot;
    const assigned=!!spawns[slot];
    if(assigned)count++;
    button.classList.toggle('active',slot===state.selectedSkierSpawnSlot);
    button.classList.toggle('assigned',assigned);
    button.setAttribute('aria-pressed',String(slot===state.selectedSkierSpawnSlot));
    const status=button.querySelector('span');
    if(status)status.textContent=assigned?'SET':'EMPTY';
  });
  const countEl=document.getElementById('skierSpawnCount');
  if(countEl)countEl.textContent=count+' / 10 SET';
  const selected=state.selectedSkierSpawnSlot;
  const selectionLabel=document.getElementById('skierSpawnSelectionLabel');
  if(selectionLabel)selectionLabel.textContent='SLOT '+selected+' · '+(spawns[selected]?'POSITION SAVED':'EMPTY');
  const place=document.getElementById('placeSkierSpawnButton');
  const remove=document.getElementById('deleteSkierSpawnButton');
  const cancel=document.getElementById('cancelSkierSpawnPlacementButton');
  if(place){
    place.disabled=state.mode!=='overview'||!clientWorkspaceReady||!resolveSkierTerrain()||!!skierSpawnPlacementStep;
    place.textContent=spawns[selected]?'↻ UPDATE SPAWN':'＋ PLACE SPAWN';
    place.classList.toggle('active',!!skierSpawnPlacementStep);
  }
  if(remove)remove.disabled=!spawns[selected]||!!skierSpawnPlacementStep;
  if(cancel)cancel.hidden=!skierSpawnPlacementStep;
}
function pickSkierSpawnSurface(event){
  const surface=resolveSkierTerrain();
  if(!surface)return null;
  const rect=renderer.domElement.getBoundingClientRect();
  if(!rect.width||!rect.height)return null;
  skierSpawnNdc.x=((event.clientX-rect.left)/rect.width)*2-1;
  skierSpawnNdc.y=-((event.clientY-rect.top)/rect.height)*2+1;
  skierSpawnRaycaster.setFromCamera(skierSpawnNdc,camera);
  surface.updateWorldMatrix(true,true);
  const hits=skierSpawnRaycaster.intersectObject(surface,true);
  const hit=hits.find(entry=>{
    if(!entry.object?.isMesh)return false;
    let node=entry.object;
    while(node){
      if(node.visible===false)return false;
      node=node.parent;
    }
    return true;
  });
  return hit?.point?.clone()||null;
}
function beginSkierSpawnPlacement(){
  if(state.mode!=='overview'||!clientWorkspaceReady){
    setSkierSpawnStatus('Открой проект в режиме «Обзор», чтобы размещать spawn-точки.',true);
    return;
  }
  if(!resolveSkierTerrain()){
    setSkierSpawnStatus('Не найдена поверхность Slopes_Stage1 / активный рельеф для лыжника.',true);
    return;
  }
  if(treeAreaDrawing)stopTreeAreaDrawing();
  skierSpawnPlacementStep=1;
  skierSpawnDraft=null;
  renderer.domElement.style.cursor='crosshair';
  document.body.classList.add('skier-spawn-placement');
  updateSkierSpawnPanel();
  setSkierSpawnStatus('Шаг 1/2 · кликни по поверхности трассы, чтобы поставить лыжника.');
}
function finishSkierSpawnPlacement(message){
  skierSpawnPlacementStep=0;
  skierSpawnDraft=null;
  renderer.domElement.style.cursor='';
  document.body.classList.remove('skier-spawn-placement');
  renderSkierSpawnOverlays();
  updateSkierSpawnPanel();
  if(message)setSkierSpawnStatus(message);
}
function cancelSkierSpawnPlacement(){
  if(!skierSpawnPlacementStep&&!skierSpawnDraft)return;
  finishSkierSpawnPlacement('Размещение отменено. Сохранённые точки не изменены.');
}
function onSkierSpawnPlacementPointerDown(event){
  if(!skierSpawnPlacementStep||state.mode!=='overview'||event.target!==renderer.domElement||event.button!==0)return;
  lastSkierSpawnPlacementPointerAt=performance.now();
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
  const point=pickSkierSpawnSurface(event);
  if(!point){
    setSkierSpawnStatus('Под курсором не найдена поверхность лыжника. Попробуй ещё раз.',true);
    return;
  }
  if(skierSpawnPlacementStep===1){
    const existing=state.skierSpawns?.[state.selectedSkierSpawnSlot];
    skierSpawnDraft={
      position:point.toArray().map(value=>Number(value.toFixed(3))),
      headingYaw:Number.isFinite(existing?.headingYaw)?existing.headingYaw:0
    };
    skierSpawnPlacementStep=2;
    renderSkierSpawnOverlays();
    setSkierSpawnStatus('Шаг 2/2 · наведи курсор в сторону, куда должен смотреть лыжник, и кликни ещё раз.');
    updateSkierSpawnPanel();
    return;
  }
  const dx=point.x-skierSpawnDraft.position[0];
  const dz=point.z-skierSpawnDraft.position[2];
  if(Math.hypot(dx,dz)<1.25){
    setSkierSpawnStatus('Точка направления слишком близко. Кликни дальше от spawn-точки.',true);
    return;
  }
  const headingYaw=Math.atan2(-dx,-dz);
  const slot=state.selectedSkierSpawnSlot;
  state.skierSpawns=normalizeSkierSpawnMap(state.skierSpawns);
  state.skierSpawns[slot]={
    position:skierSpawnDraft.position.slice(),
    headingYaw
  };
  markClientProjectDirty('spawn-точка лыжника '+slot);
  finishSkierSpawnPlacement('Слот '+slot+' сохранён. В режиме лыжника нажми '+slot+' для телепорта.');
}
function onSkierSpawnPlacementPointerMove(event){
  if(skierSpawnPlacementStep!==2||!skierSpawnDraft||event.target!==renderer.domElement)return;
  const point=pickSkierSpawnSurface(event);
  if(!point)return;
  const dx=point.x-skierSpawnDraft.position[0];
  const dz=point.z-skierSpawnDraft.position[2];
  if(Math.hypot(dx,dz)<0.5)return;
  skierSpawnDraft.headingYaw=Math.atan2(-dx,-dz);
  setSkierSpawnMarkerHeading(skierSpawnPreviewMarker,skierSpawnDraft.headingYaw);
}
function deleteSelectedSkierSpawn(){
  const slot=state.selectedSkierSpawnSlot;
  if(!state.skierSpawns?.[slot])return;
  const next={...state.skierSpawns};delete next[slot];
  state.skierSpawns=normalizeSkierSpawnMap(next);
  markClientProjectDirty('удаление spawn-точки лыжника '+slot);
  renderSkierSpawnOverlays();
  updateSkierSpawnPanel();
  setSkierSpawnStatus('Слот '+slot+' очищен.');
}
const skierSpawnSlotsEl=document.getElementById('skierSpawnSlots');
skierSpawnSlotsEl?.addEventListener('click',event=>{
  const button=event.target?.closest?.('[data-skier-spawn-slot]');
  if(!button||skierSpawnPlacementStep)return;
  state.selectedSkierSpawnSlot=button.dataset.skierSpawnSlot;
  renderSkierSpawnOverlays();
  updateSkierSpawnPanel();
  const spawn=state.skierSpawns?.[state.selectedSkierSpawnSlot];
  setSkierSpawnStatus(spawn
    ?'Слот '+state.selectedSkierSpawnSlot+' готов. Нажми UPDATE SPAWN, чтобы заменить точку и направление.'
    :'Слот '+state.selectedSkierSpawnSlot+' пуст. Нажми PLACE SPAWN для установки.');
});
document.getElementById('placeSkierSpawnButton')?.addEventListener('click',beginSkierSpawnPlacement);
document.getElementById('deleteSkierSpawnButton')?.addEventListener('click',deleteSelectedSkierSpawn);
document.getElementById('cancelSkierSpawnPlacementButton')?.addEventListener('click',cancelSkierSpawnPlacement);
document.addEventListener('pointerdown',onSkierSpawnPlacementPointerDown,true);
renderer.domElement.addEventListener('pointermove',onSkierSpawnPlacementPointerMove);

function applyOverviewCameraPose(pose){
  const safe=normalizeOverviewCameraMap({current:pose}).current;
  if(!safe)return false;
  camera.position.fromArray(safe.position);
  controls.target.fromArray(safe.target);
  controls.update();
  camera.updateMatrixWorld(true);
  targetDist=null;
  state.homePos=camera.position.clone();
  state.homeTarget=controls.target.clone();
  return true;
}
function restoreSavedOverviewCameraForCurrentSlope(){
  const pose=state.savedOverviewCameras?.[String(state.slope)];
  return pose?applyOverviewCameraPose(pose):false;
}
function saveOverviewCamera(){
  if(state.mode!=='overview'){
    setEditorStatus('Сохранять стартовый ракурс можно только в режиме «Обзор».',true);
    return;
  }
  if(!state.root||!clientWorkspaceReady){
    setEditorStatus('Дождись загрузки сцены и проекта, затем сохрани стартовый ракурс.',true);
    return;
  }
  const position=camera.position.toArray();
  const target=controls.target.toArray();
  if(!position.every(Number.isFinite)||!target.every(Number.isFinite)||
     Math.hypot(position[0]-target[0],position[1]-target[1],position[2]-target[2])<0.5){
    setEditorStatus('Не удалось сохранить ракурс: проверь положение камеры и фокусную точку.',true);
    return;
  }
  const slope=String(state.slope||'A1');
  state.savedOverviewCameras=normalizeOverviewCameraMap(state.savedOverviewCameras);
  state.savedOverviewCameras[slope]={position,target};
  state.homePos=camera.position.clone();
  state.homeTarget=controls.target.clone();
  const button=document.getElementById('saveOverviewCamera');
  if(button)button.classList.add('saved');
  setEditorStatus('Стартовый ракурс обзора сохранён для '+slope+'. Кнопка «Домой» вернёт к нему; ракурс записывается в проект.');
  markClientProjectDirty('стартовый ракурс обзорной камеры');
  updateModeSwitcher();
}
document.getElementById('saveOverviewCamera')?.addEventListener('click',saveOverviewCamera);

const treeAreaDrawRaycaster=new THREE.Raycaster();
const treeAreaProjectionRaycaster=new THREE.Raycaster();
const treeAreaDown=new THREE.Vector3(0,-1,0);
const treeAreaRayOrigin=new THREE.Vector3();
function treeAreaProjectionBounds(){
  if(!state.baseTerrain)return null;
  state.baseTerrain.updateWorldMatrix(true,true);
  const bounds=new THREE.Box3().setFromObject(state.baseTerrain);
  return bounds.isEmpty()?null:bounds;
}
function treeAreaSurfaceY(x,z,bounds){
  if(!state.baseTerrain||!bounds)return null;
  const size=bounds.getSize(new THREE.Vector3()),top=bounds.max.y+Math.max(100,size.y*0.1);
  treeAreaRayOrigin.set(x,top,z);
  treeAreaProjectionRaycaster.set(treeAreaRayOrigin,treeAreaDown);
  treeAreaProjectionRaycaster.near=0;
  treeAreaProjectionRaycaster.far=Math.max(200,top-bounds.min.y+100);
  const hit=treeAreaProjectionRaycaster.intersectObject(state.baseTerrain,true).find(item=>item.object?.isMesh);
  return hit?.point?.y??null;
}
function addTreeAreaOverlay(group,area,index,{draft=false}={}){
  const points=area.points||[];
  if(points.length<3||!state.baseTerrain)return;
  const bounds=treeAreaProjectionBounds();
  if(!bounds)return;
  const color=[0x5bc99a,0x63a9df,0xd7ad58,0xb38be1,0x67c5cf,0xd27e86][index%6];
  const shape=new THREE.Shape();
  shape.moveTo(points[0][0],points[0][1]);
  for(let i=1;i<points.length;i++)shape.lineTo(points[i][0],points[i][1]);
  shape.closePath();
  const geometry=new THREE.ShapeGeometry(shape);
  geometry.rotateX(Math.PI*0.5);
  const positions=geometry.attributes.position;
  for(let i=0;i<positions.count;i++){
    const y=treeAreaSurfaceY(positions.getX(i),positions.getZ(i),bounds);
    positions.setY(i,(y??bounds.max.y)+0.45);
  }
  positions.needsUpdate=true;
  geometry.computeVertexNormals();
  const fill=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({
    color,transparent:true,opacity:draft?0.12:0.18,side:THREE.DoubleSide,depthWrite:false,
    polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,toneMapped:false
  }));
  fill.name='TreeArea_'+area.id+'_Fill';
  fill.renderOrder=18;fill.frustumCulled=false;group.add(fill);
  const borderPoints=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    const steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/10));
    for(let j=0;j<steps;j++){
      const t=j/steps,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
      const y=treeAreaSurfaceY(x,z,bounds);
      borderPoints.push(new THREE.Vector3(x,(y??bounds.max.y)+1,z));
    }
  }
  if(borderPoints.length){
    borderPoints.push(borderPoints[0].clone());
    const border=new THREE.Line(new THREE.BufferGeometry().setFromPoints(borderPoints),new THREE.LineBasicMaterial({color,depthTest:false,toneMapped:false}));
    border.name='TreeArea_'+area.id+'_Border';border.renderOrder=25;group.add(border);
  }
  const markerGeometry=new THREE.SphereGeometry(1.15,8,6);
  const markerMaterial=new THREE.MeshBasicMaterial({color,depthTest:false,toneMapped:false});
  points.forEach(point=>{
    const y=treeAreaSurfaceY(point[0],point[1],bounds);
    const marker=new THREE.Mesh(markerGeometry,markerMaterial);
    marker.position.set(point[0],(y??bounds.max.y)+1.6,point[1]);marker.renderOrder=26;group.add(marker);
  });
}
function updateTreeAreaOverlayVisibility(){
  if(!state.treeAreaGroup)return;
  state.treeAreaGroup.visible=treeAreaDrawing||
    (state.mode==='overview'&&appRoot.classList.contains('editor-open')&&activeSceneLookTab==='trees');
}
function renderTreeAreaOverlays(){
  if(state.treeAreaGroup){
    scene.remove(state.treeAreaGroup);disposeObjectTree(state.treeAreaGroup);state.treeAreaGroup=null;
  }
  const group=new THREE.Group();
  group.name='GradeOptimizer_Tree_Area_Overlays';
  state.treeAreaGroup=group;scene.add(group);
  state.treeAreas.forEach((area,index)=>addTreeAreaOverlay(group,area,index));
  if(treeAreaDraftPoints.length>=3)addTreeAreaOverlay(group,{id:'draft',points:treeAreaDraftPoints},state.treeAreas.length,{draft:true});
  else if(treeAreaDraftPoints.length){
    const bounds=treeAreaProjectionBounds();
    if(bounds){
      const points=treeAreaDraftPoints.map(point=>new THREE.Vector3(point[0],(treeAreaSurfaceY(point[0],point[1],bounds)??bounds.max.y)+1.5,point[1]));
      const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x75e2ae,depthTest:false,toneMapped:false}));
      line.renderOrder=26;group.add(line);
      const markerGeometry=new THREE.SphereGeometry(1.2,8,6);
      const markerMaterial=new THREE.MeshBasicMaterial({color:0x75e2ae,depthTest:false,toneMapped:false});
      points.forEach(point=>{const marker=new THREE.Mesh(markerGeometry,markerMaterial);marker.position.copy(point);group.add(marker);});
    }
  }
  updateTreeAreaOverlayVisibility();
}
function updateTreeAreaPanel(){
  const count=document.getElementById('treeAreaCount'),list=document.getElementById('treeAreaList');
  const draw=document.getElementById('treeAreaDrawButton'),finish=document.getElementById('treeAreaFinishButton');
  const cancel=document.getElementById('treeAreaCancelButton'),clear=document.getElementById('treeAreaClearButton');
  const status=document.getElementById('treeAreaStatus'),name=document.getElementById('treeAreaName');
  if(count)count.textContent=state.treeAreas.length+' AREAS';
  if(draw)draw.disabled=treeAreaDrawing||state.mode!=='overview'||!state.baseTerrain||!clientWorkspaceReady;
  if(finish)finish.disabled=!treeAreaDrawing||treeAreaDraftPoints.length<3;
  if(cancel)cancel.disabled=!treeAreaDrawing;
  if(clear)clear.disabled=!state.treeAreas.length||treeAreaDrawing;
  if(name)name.disabled=!treeAreaDrawing;
  if(status)status.textContent=treeAreaDrawing
    ?'Рисование зоны: кликай по исходному рельефу, добавляя вершины ('+treeAreaDraftPoints.length+'). Нужны минимум 3 точки, затем FINISH AREA.'
    :state.treeAreas.length
      ?'Деревья размещаются только внутри '+state.treeAreas.length+' сохранённых зон, на исходном рельефе. Координаты зон — world X/Z.'
      :'Зон пока нет. Лес размещается на исходном рельефе автоматически. После первой зоны посадка ограничится объединением областей.';
  if(list){
    list.innerHTML='';
    if(!state.treeAreas.length){
      const empty=document.createElement('div');empty.className='tree-area-empty';
      empty.textContent='Нет зон посадки. Нажми DRAW AREA, чтобы создать первую.';
      list.appendChild(empty);
    }else{
      state.treeAreas.forEach(area=>{
        const row=document.createElement('div');row.className='tree-area-row';
        const label=document.createElement('div');label.className='tree-area-row-label';
        const title=document.createElement('strong');title.textContent=area.name;
        const meta=document.createElement('small');meta.textContent=area.points.length+' точек · world X/Z';
        label.append(title,meta);
        const remove=document.createElement('button');remove.type='button';remove.className='tree-area-remove secondary';
        remove.textContent='УДАЛИТЬ';remove.addEventListener('click',()=>removeTreeArea(area.id));
        row.append(label,remove);list.appendChild(row);
      });
    }
  }
}
function beginTreeAreaDrawing(){
  if(state.mode!=='overview'||!state.baseTerrain||!clientWorkspaceReady){
    const status=document.getElementById('treeAreaStatus');
    if(status)status.textContent='Открой проект и перейди в режим «Обзор», чтобы рисовать зоны на исходном рельефе.';
    return;
  }
  if(treeAreaDrawing)return;
  const input=document.getElementById('treeAreaName');
  if(input&&!input.value.trim())input.value='Tree Area '+String(state.treeAreas.length+1).padStart(2,'0');
  treeAreaDraftPoints=[];treeAreaDrawing=true;
  renderer.domElement.style.cursor='crosshair';document.body.classList.add('tree-area-drawing');
  updateTreeAreaPanel();renderTreeAreaOverlays();
  setEditorStatus('Tree Area: кликай по исходному рельефу, затем нажми FINISH AREA.');
}
function stopTreeAreaDrawing(){
  treeAreaDrawing=false;treeAreaDraftPoints=[];renderer.domElement.style.cursor='';
  document.body.classList.remove('tree-area-drawing');updateTreeAreaPanel();renderTreeAreaOverlays();
}
function onTreeAreaPointerDown(event){
  if(!treeAreaDrawing||state.mode!=='overview'||event.target!==renderer.domElement||event.button!==0)return;
  event.preventDefault();event.stopPropagation();
  const rect=renderer.domElement.getBoundingClientRect();if(!rect.width||!rect.height)return;
  ndc.x=((event.clientX-rect.left)/rect.width)*2-1;
  ndc.y=-((event.clientY-rect.top)/rect.height)*2+1;
  treeAreaDrawRaycaster.setFromCamera(ndc,camera);
  const hit=treeAreaDrawRaycaster.intersectObject(state.baseTerrain,true).find(item=>item.object?.isMesh);
  if(!hit){const status=document.getElementById('treeAreaStatus');if(status)status.textContent='Под курсором не найден исходный рельеф. Точка не добавлена.';return;}
  const point=[Number(hit.point.x.toFixed(3)),Number(hit.point.z.toFixed(3))];
  const last=treeAreaDraftPoints[treeAreaDraftPoints.length-1];
  if(last&&Math.hypot(last[0]-point[0],last[1]-point[1])<2)return;
  treeAreaDraftPoints.push(point);updateTreeAreaPanel();renderTreeAreaOverlays();
}
document.addEventListener('pointerdown',onTreeAreaPointerDown,true);
function finishTreeAreaDrawing(){
  if(!treeAreaDrawing||treeAreaDraftPoints.length<3)return;
  const input=document.getElementById('treeAreaName');
  const name=input?.value.trim()||('Tree Area '+String(state.treeAreas.length+1).padStart(2,'0'));
  const id='tree-area-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
  const next=normalizeTreeAreas([...state.treeAreas,{id,name,points:treeAreaDraftPoints}]);
  if(next.length!==state.treeAreas.length+1){const status=document.getElementById('treeAreaStatus');if(status)status.textContent='Не удалось создать зону: проверь размер и форму полигона.';return;}
  state.treeAreas=next;stopTreeAreaDrawing();forestPlacementCache=null;
  buildTestForest();markClientProjectDirty('Tree Area: '+name);
  setEditorStatus('Сохранена зона «'+name+'». Лес перестроен с учётом всех Tree Areas.');
}
function removeTreeArea(id){
  state.treeAreas=state.treeAreas.filter(area=>area.id!==id);forestPlacementCache=null;
  renderTreeAreaOverlays();updateTreeAreaPanel();buildTestForest();markClientProjectDirty('удаление Tree Area');
}
function clearTreeAreas(){
  if(!state.treeAreas.length)return;
  state.treeAreas=[];forestPlacementCache=null;renderTreeAreaOverlays();updateTreeAreaPanel();buildTestForest();markClientProjectDirty('очистка Tree Areas');
}
document.getElementById('treeAreaDrawButton')?.addEventListener('click',beginTreeAreaDrawing);
document.getElementById('treeAreaFinishButton')?.addEventListener('click',finishTreeAreaDrawing);
document.getElementById('treeAreaCancelButton')?.addEventListener('click',stopTreeAreaDrawing);
document.getElementById('treeAreaClearButton')?.addEventListener('click',clearTreeAreas);
function goHome(){
  if(restoreSavedOverviewCameraForCurrentSlope())return;
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
    this._cache=new Map();
    this.S=(x,z)=>{
      const key=Math.round(x*100)+'_'+Math.round(z*100);
      let v=this._cache.get(key);
      if(v===undefined){
        v=terrainY(x,z);
        this._cache.set(key,v);
      }
      if(v===null){this._rcMiss++;return null;}
      this._rcHit++;
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
    dbg('Центральные станции: raycast='+this._rcHit+', не найдено='+missCount+' (единый метод сэмплинга — raycast).');
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
    let prof=gc.slice();
    for(let k=0;k<P.profile_passes;k++){
      const old=prof.slice();
      for(let i=1;i<n-1;i++){
        const a=Math.max(0,i-2),b=Math.min(n,i+3);
        let s=0;for(let j=a;j<b;j++)s+=old[j];
        prof[i]=s/(b-a);
      }
    }
    dbg('Профиль оси: из высот рельефа по оси (как в Maya; сглажено '+P.profile_passes+' проходов).');
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
    const n=this.n,m=this.m;let cut=0,fill=0,coreCut=0,coreFill=0;
    for(let i=0;i<n-1;i++)for(let j=0;j<m-1;j++){
      const df=0.25*((Z[i][j]-this.TG[i][j])+(Z[i+1][j]-this.TG[i+1][j])+(Z[i][j+1]-this.TG[i][j+1])+(Z[i+1][j+1]-this.TG[i+1][j+1]));
      const v=df*this.cellArea[i][j];
      if(v>=0){fill+=v;coreFill+=v;}else{cut-=v;coreCut+=v;}
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
    return {cut,fill,coreCut,coreFill};
  }
  evaluate(off,cross,fillN,cutN){
    const P=this.P;
    const {zc,Z,zl}=this.design(off,cross);
    const {d,zout,mode,forced}=this.solveRays(zl,fillN,cutN);
    const {cut,fill,coreCut,coreFill}=this.volumes(Z,zl,d,zout);
    const usable=cut*P.usable,bal=usable-fill;
    const nforced=forced.reduce((s,f)=>s+(f===1?1:0),0);
    let score=Math.abs(bal)+P.earthwork_w*(cut+fill)+200*nforced;
    if(P.max_fill>0&&fill>P.max_fill)score+=1000*(fill-P.max_fill)/P.max_fill;
    return {off,cross,fillN,cutN,cut,fill,usable,bal,nforced,score,coreCut,coreFill};
  }
  optimize(progress){
    const P=this.P,fill0=P.fill_n,cut0=P.cut_n;
    if(!P.optimize)return this.evaluate(P.offset,P.crossfall/100,fill0,cut0);
    const Roff=P.off_range,cmax=P.cross_max/100;
    const offs=Array.from({length:13},(_,i)=>-Roff+2*Roff*i/12);
    const crs=cmax>0?Array.from({length:9},(_,i)=>-cmax+2*cmax*i/8):[0];
    let best=null,tot=offs.length*crs.length,k=0;
    for(const o of offs)for(const c of crs){
      const r=this.evaluate(o,c,fill0,cut0);
      if(!best||r.score<best.score)best=r;
      k++;
      if(progress&&k%10===0)progress(60*k/tot,'Coarse '+k+'/'+tot);
    }
    let so=2*Roff/12*0.5,sc=cmax>0?2*cmax/8*0.5:0,it=0;
    while(it<60){
      it++;let improved=false;const cands=[];
      for(const sgn of [-1,1]){
        cands.push([best.off+sgn*so,best.cross,fill0,cut0]);
        if(cmax>0)cands.push([best.off,best.cross+sgn*sc,fill0,cut0]);
      }
      for(const [o,c,f,cu] of cands){
        o=Math.max(-Roff*1.5,Math.min(Roff*1.5,o));
        c=Math.max(-cmax,Math.min(cmax,c));
        const r=this.evaluate(o,c,f,cu);
        if(r.score<best.score-1e-6){best=r;improved=true;}
      }
      if(!improved){so*=0.5;sc*=0.5;if(so<0.005&&sc<0.00005)break;}
      if(progress)progress(60+35*it/60,'Refining '+it);
    }
    return best;
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
  clearMeasure();
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
    slope_angle:state.ang,max_cut_depth:state.cut,usable:state.usable/100,
    earthwork_w:state.earthwork_w,max_fill:state.max_fill,
    off_range:state.off_range,cross_max:state.cross_max,
    offset:state.off,crossfall:state.cross,
    optimize:state.optimize===true,opt_slopes:false,
    fill_n:1/Math.tan(THREE.MathUtils.degToRad(state.ang)),
    cut_n:1/Math.tan(THREE.MathUtils.degToRad(state.ang))
  };
  const eng=new Engine(verts,tris,sampler,P);
  let C=cv.centre.map(p=>[p[0],p[1],p[2]]);
  let L=alignDir(C,cv.left.map(p=>[p[0],p[1],p[2]]));
  let R=alignDir(C,cv.right.map(p=>[p[0],p[1],p[2]]));
  // Maya-style: 3D длина + ресемплинг; точные Maya-станции имеют приоритет
  const spacing=P.spacing;
  const dist3=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  function polyLen3(pts){let s=0;for(let i=1;i<pts.length;i++)s+=dist3(pts[i],pts[i-1]);return s;}
  function densifyCatmullRom(pts,per=20){
    if(pts.length<3)return pts.slice();
    const out=[];const get=i=>pts[Math.max(0,Math.min(pts.length-1,i))];
    for(let i=0;i<pts.length-1;i++){
      const p0=get(i-1),p1=get(i),p2p=get(i+1),p3=get(i+2);
      for(let k=0;k<per;k++){
        const t=k/per,t2=t*t,t3=t2*t;
        out.push([
          0.5*((2*p1[0])+(-p0[0]+p2p[0])*t+(2*p0[0]-5*p1[0]+4*p2p[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2p[0]+p3[0])*t3),
          0.5*((2*p1[1])+(-p0[1]+p2p[1])*t+(2*p0[1]-5*p1[1]+4*p2p[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2p[1]+p3[1])*t3),
          0.5*((2*p1[2])+(-p0[2]+p2p[2])*t+(2*p0[2]-5*p1[2]+4*p2p[2]-p3[2])*t2+(-p0[2]+3*p1[2]-3*p2p[2]+p3[2])*t3)
        ]);
      }
    }
    out.push(pts[pts.length-1].slice());
    return out;
  }
  function resampleByLength3(pts,count){
    if(pts.length<2||count<2)return pts.slice();
    const segs=[];let total=0;
    for(let i=1;i<pts.length;i++){const d=dist3(pts[i],pts[i-1]);segs.push(d);total+=d;}
    const out=[];
    for(let k=0;k<count;k++){
      const target=total*k/(count-1);
      let acc=0,i=0;
      while(i<segs.length-1&&acc+segs[i]<target){acc+=segs[i];i++;}
      const t=segs[i]>0?(target-acc)/segs[i]:0;
      const a=pts[i],b=pts[i+1];
      out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]);
    }
    return out;
  }
  if(cv.centre_stations&&cv.left_stations&&cv.right_stations&&cv.centre_stations.length===cv.left_stations.length&&cv.centre_stations.length===cv.right_stations.length){
    C=cv.centre_stations.map(p=>[p[0],p[1],p[2]]);
    L=cv.left_stations.map(p=>[p[0],p[1],p[2]]);
    R=cv.right_stations.map(p=>[p[0],p[1],p[2]]);
    dbg('Коридор: '+C.length+' станций — использованы ТОЧНЫЕ станции, экспортированные из Maya.');
  } else {
    const Cd=densifyCatmullRom(C,20),Ld=densifyCatmullRom(L,20),Rd=densifyCatmullRom(R,20);
    const centreLen3=polyLen3(Cd),centreLen2=(()=>{let s=0;for(let i=1;i<Cd.length;i++)s+=hyp(p2(Cd[i]),p2(Cd[i-1]));return s;})();
    const ns=Math.max(3,Math.ceil(centreLen3/Math.max(0.5,spacing))+1);
    C=resampleByLength3(Cd,ns);L=resampleByLength3(Ld,ns);R=resampleByLength3(Rd,ns);
    dbg('Коридор: '+C.length+' станций (3D длина '+centreLen3.toFixed(1)+' м; 2D проекция '+centreLen2.toFixed(1)+' м; spacing '+spacing+' м).');
  }
  const widths=C.map((c,i)=>hyp(p2(L[i]),p2(R[i])));
  dbg('Ширина коридора: min '+Math.min(...widths).toFixed(1)+' / mean '+(widths.reduce((a,b)=>a+b,0)/widths.length).toFixed(1)+' / max '+Math.max(...widths).toFixed(1)+' м.');
  eng.prepare(C,L,R);
  const limitPoly=(cv.limit&&cv.limit.length)?cv.limit.map(p=>[p[0],p[2]]):null;
  eng.makeRays(limitPoly);
  dbg('Лучей: '+eng.rays.length);
  const best=state.optimize===true?eng.optimize():eng.evaluate(state.off,state.cross/100,P.fill_n,P.cut_n);
  const {Z,zl}=eng.design(state.off,state.cross/100);
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
      const za0=eng.S(a[0],a[2]),zb0=eng.S(b[0],b[2]),zc0=eng.S(c[0],c[2]),ze0=eng.S(e[0],e[2]);
      const za=(za0===null?a[1]:za0),zb=(zb0===null?b[1]:zb0);
      const zc2=(zc0===null?c[1]:zc0),ze2=(ze0===null?e[1]:ze0);
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
      const i=r.station;
      if(i===undefined||i<0||i>=n-1)continue;
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
  const ELEV_OFF=21.21;
  const makeSprite=(text, p, color, small)=>{
    const cnv=document.createElement('canvas'); cnv.width=384; cnv.height=96;
    const ctx=cnv.getContext('2d');
    ctx.fillStyle='rgba(0,0,0,0.3)'; ctx.fillRect(0,0,384,96);
    ctx.fillStyle=color; ctx.font=(small?'33px':'bold 45px')+' sans-serif'; ctx.textAlign='center';
    ctx.fillText(text,192,small?60:66);
    const tex=new THREE.CanvasTexture(cnv);
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex, depthTest:false, transparent:true, opacity:state.labelOpacity}));
    sp.scale.set(small?10.5:15, small?2.6:3.75, 1);
    sp.position.copy(p);
    sp.renderOrder=10;
    return sp;
  };
  const slopeColor=s=>s<0?'#ff9a3c':(s<10?'#5cff7a':(s<15?'#6aa8ff':(s<25?'#ff5c5c':'#ffffff')));
  rows.forEach(r=>{
    const i=r.station;
    if(i===undefined||i<0)return;
    const cp=new THREE.Vector3(r.centerPoint[0],r.centerPoint[1],r.centerPoint[2]);
    const pl=new THREE.Vector3(r.leftPoint[0],r.leftPoint[1],r.leftPoint[2]);
    const pr=new THREE.Vector3(r.rightPoint[0],r.rightPoint[1],r.rightPoint[2]);
    const slope=(r.slope===null||r.slope===undefined)?0:r.slope;
    const across=new THREE.Vector3().subVectors(pr,pl).setY(0).normalize();
    const inward=across.clone();
    const smpL=pl.clone().addScaledVector(inward,1.5);
    const smpR=pr.clone().addScaledVector(inward,-1.5);
    const tgl=terrainY(smpL.x,smpL.z),tgr=terrainY(smpR.x,smpR.z);
    lg.add(makeSprite((r.slope===null?'—':slope.toFixed(1))+'°',new THREE.Vector3(cp.x,cp.y+10,cp.z),slopeColor(slope)));
    lg.add(makeSprite((r.centerHeight+ELEV_OFF).toFixed(1),new THREE.Vector3(cp.x,cp.y+5,cp.z),'#ffffff'));
    lg.add(makeSprite((r.leftHeight+ELEV_OFF).toFixed(1),new THREE.Vector3(pl.x,pl.y+5,pl.z),'#7fd4ff'));
    lg.add(makeSprite((r.rightHeight+ELEV_OFF).toFixed(1),new THREE.Vector3(pr.x,pr.y+5,pr.z),'#ffb0a0'));
    tg.add(makeSprite('орг.: '+(eng.groundC[i]+ELEV_OFF).toFixed(1),new THREE.Vector3(cp.x,cp.y-2.8,cp.z),'#cfe3cf',true));
    tg.add(makeSprite('орг.: '+(tgl!==null?(tgl+ELEV_OFF).toFixed(1):'-'),new THREE.Vector3(pl.x,pl.y-2.8,pl.z),'#cfe3cf',true));
    tg.add(makeSprite('орг.: '+(tgr!==null?(tgr+ELEV_OFF).toFixed(1):'-'),new THREE.Vector3(pr.x,pr.y-2.8,pr.z),'#cfe3cf',true));
    if(state.terrainSlopesVisible&&r.slope!==null){
      lg.add(makeSprite('орг. уклон: '+slope.toFixed(1)+'°',new THREE.Vector3(cp.x,eng.groundC[i]+6.5,cp.z),'#7fd4ff',true));
    }
  });
  applyLabelOpacity();

  dbg('3D-подписей создано: проект '+lg.children.length+', рельеф '+tg.children.length+'.');

  const f=v=>Math.round(v).toLocaleString('ru-RU');
  document.getElementById('stats').innerHTML=
    'Угол откоса: <b>'+state.ang+'°</b> (1:'+best.fillN.toFixed(2)+')<br>'+
    'Срезано: <b>'+f(best.cut)+'</b> м³ (core '+f(best.coreCut)+')<br>'+
    'Пригодно к использованию: <b>'+f(best.usable)+'</b> м³ (90%)<br>'+
    'Насыпано: <b>'+f(best.fill)+'</b> м³ (core '+f(best.coreFill)+')<br>'+
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
const sceneLoadingEl=document.getElementById('sceneLoading');
async function loadOptimizerData(id,isCurrent=()=>true){
    const cv=await loadJSON('./assets/'+id+'.curves.json'+bust());
    if(!isCurrent())return;
    state.curves=cv;
    dbg('Кривые загружены: centre '+(cv.centre||[]).length+', left '+(cv.left||[]).length+', right '+(cv.right||[]).length);
    const mayaEl=document.getElementById('mayaLabels');
    mayaEl.textContent='Загрузка подписей Maya…';
    let mayaLoaded=false;
    try{
      const m=await loadJSON('./assets/'+id+'_labels.json'+bust());
      if(!isCurrent())return;
      const rows=(m&&Array.isArray(m.labels))?m.labels:[];
      if(rows.length){
        mayaEl.textContent=rows.map(r=>{
          const s=(r.slope_deg===null||r.slope_deg===undefined)?'—':Number(r.slope_deg).toFixed(1);
          return 'Ст. '+r.station+': уклон '+s+'° | H: '+Number(r.h_center).toFixed(1)+' / '+Number(r.h_left).toFixed(1)+' / '+Number(r.h_right).toFixed(1)+' м';
        }).join('\n');
        mayaLoaded=true;
        dbg('Подписи Maya загружены: '+rows.length+' станций');
      }
    }catch(e){
      if(!isCurrent())return;
    }
    if(!isCurrent())return;
    if(!mayaLoaded){mayaEl.textContent='Нет данных — файл '+id+'_labels.json не найден в assets/ (сначала ЗАПУСК в Maya).';}
}


// Depth-buffer priority for imported piste overlays; this never changes world-space Y.
function applyImportedSlopeDepthBias(target, factor = -1, units = -1) {
  target.traverse(object => {
    if (!object.isMesh || object.userData.renderDepthBiasApplied) return;
    const apply = material => {
      const copy = material.clone();
      copy.polygonOffset = true;
      copy.polygonOffsetFactor = factor;
      copy.polygonOffsetUnits = units;
      copy.needsUpdate = true;
      return copy;
    };
    object.material = Array.isArray(object.material) ? object.material.map(apply) : apply(object.material);
    object.userData.renderDepthBiasApplied = true;
  });
}

const MAYA_LINEAR_UNIT_TO_METERS = Object.freeze({
  mm:0.001,
  cm:0.01,
  m:1,
  in:0.0254,
  ft:0.3048,
  yd:0.9144
});

// Maya 0.8.8 stores FBX vertices with the CAD Bridge ancestor removed.
// The published terrain may still be in the original working-world frame.
// Restore any such FBX to that frame before applying its cm -> metre scale.
function restoreCadBridgeWorkingCoordinates(root,mayaExport,assetLabel='Maya asset'){
  const bridge=mayaExport?.cadBridge;
  if(bridge?.inverseApplied!==true)return null;

  const groups=Array.isArray(bridge.workingGroups)?bridge.workingGroups:[];
  const record=groups.find(item=>
    Array.isArray(item?.originalOffset)&&item.originalOffset.length===3&&
    Number.isFinite(Number(item?.originalScale))&&Number(item.originalScale)>0
  );
  if(!record){
    throw new Error(assetLabel+': CAD Bridge отмечен как inverseApplied, но исходные offset / scale отсутствуют.');
  }
  const offset=record.originalOffset.map(Number);
  const scale=Number(record.originalScale);
  if(!offset.every(Number.isFinite)){
    throw new Error(assetLabel+': CAD Bridge содержит некорректный originalOffset.');
  }

  const geometries=new Set();
  let meshCount=0,vertexCount=0;
  const transformAttribute=(attribute,{relative=false}={})=>{
    if(!attribute)return;
    for(let index=0;index<attribute.count;index++){
      const x=attribute.getX(index),y=attribute.getY(index),z=attribute.getZ(index);
      attribute.setXYZ(
        index,
        relative?x*scale:(x-offset[0])*scale,
        relative?y*scale:(y-offset[1])*scale,
        relative?z*scale:(z-offset[2])*scale
      );
    }
    attribute.needsUpdate=true;
    vertexCount+=attribute.count;
  };

  root.traverse(object=>{
    if(!object.isMesh||!object.geometry||geometries.has(object.geometry))return;
    const geometry=object.geometry;
    const position=geometry.attributes?.position;
    if(!position||position.count<3)return;
    geometries.add(geometry);
    transformAttribute(position);
    for(const morphPosition of geometry.morphAttributes?.position||[]){
      transformAttribute(morphPosition,{relative:geometry.morphTargetsRelative===true});
    }
    geometry.boundingBox=null;
    geometry.boundingSphere=null;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    meshCount++;
  });

  if(!meshCount){
    throw new Error(assetLabel+': CAD Bridge correction requested, but no polygon mesh positions were found.');
  }
  root.updateMatrixWorld(true,true);
  const result={strategy:'restore-original-cad-working-world',offset,scale,meshCount,vertexCount};
  root.userData=root.userData||{};
  root.userData.gradeOptimizerCadBridgeRestoration=result;
  console.info('[Grade Optimizer] Restored CAD Bridge working-world coordinates:',{asset:assetLabel,...result});
  return result;
}

async function loadCanonicalTerrainFbx(isCurrentLoad=()=>true){
  const manifest=await loadJSON('./assets/real-terrain.json'+bust());
  if(!isCurrentLoad())return null;
  if(manifest?.assetId!=='real-terrain'||manifest?.category!=='terrain'){
    throw new Error('real-terrain.json не описывает активный terrain asset.');
  }
  const linearUnit=String(manifest?.mayaExport?.linearUnit||'').trim().toLowerCase();
  const metersPerUnit=MAYA_LINEAR_UNIT_TO_METERS[linearUnit];
  if(!Number.isFinite(metersPerUnit)||metersPerUnit<=0){
    throw new Error('Неизвестная единица Maya в real-terrain.json: '+(linearUnit||'не указана'));
  }

  const root=await new Promise((resolve,reject)=>{
    fbxLoader.load('./assets/real-terrain.fbx'+bust(),resolve,undefined,reject);
  });
  if(!isCurrentLoad())return null;
  const cadBridgeRestoration=restoreCadBridgeWorkingCoordinates(root,manifest?.mayaExport,'canonical terrain');

  const meshes=[];
  root.traverse(object=>{
    if(object.isMesh&&object.geometry?.attributes?.position?.count>=3)meshes.push(object);
  });
  const component=(manifest?.mayaExport?.components||[]).find(item=>item?.name||item?.shape);
  const expectedNames=[component?.name,component?.shape].filter(Boolean).map(value=>String(value).toLowerCase());
  const namedTerrain=meshes.find(mesh=>{
    const names=[mesh.name,mesh.userData?.originalName].filter(Boolean).map(value=>String(value).toLowerCase());
    return expectedNames.some(expected=>names.some(name=>name===expected));
  });
  const terrainMesh=namedTerrain||(meshes.length===1?meshes[0]:null);
  if(!terrainMesh){
    throw new Error('В real-terrain.fbx не найден mesh terrainShape. Найдено mesh: '+meshes.length);
  }

  // Three.js FBXLoader exposes unitScaleFactor as metadata; it does not convert
  // Maya centimetre coordinates into the metre-based world used by this app.
  root.scale.multiplyScalar(metersPerUnit);
  root.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(terrainMesh);
  const size=bounds.getSize(new THREE.Vector3());
  if(bounds.isEmpty()||!Number.isFinite(size.x)||!Number.isFinite(size.z)||size.x<=0||size.z<=0){
    throw new Error('FBX terrainShape не имеет корректных world bounds.');
  }
  return {root,terrainMesh,metersPerUnit,linearUnit,bounds,size,component,cadBridgeRestoration};
}

function adaptSceneScaleToBounds(bounds){
  const size=bounds.getSize(new THREE.Vector3());
  const horizontalDiagonal=Math.hypot(size.x,size.z);
  const diagonal=size.length();
  if(!Number.isFinite(diagonal)||diagonal<=0)return;

  // Keep the Maya world origin and dimensions. Only adapt scene-wide viewing ranges.
  sceneViewMaxDistance=Math.max(4000,diagonal*1.8);
  controls.maxDistance=sceneViewMaxDistance;

  camera.far=Math.max(20000,diagonal*4);
  camera.updateProjectionMatrix();

  scene.fog.near=Math.max(1800,diagonal*0.3);
  scene.fog.far=Math.max(9000,diagonal*1.5);

  // The old 2.4 km shadow frustum clipped most of this 4.5 km terrain.
  const shadowHalfSpan=Math.max(1200,horizontalDiagonal*0.55);
  const shadowCamera=sun.shadow.camera;
  shadowCamera.left=-shadowHalfSpan;
  shadowCamera.right=shadowHalfSpan;
  shadowCamera.top=shadowHalfSpan;
  shadowCamera.bottom=-shadowHalfSpan;
  shadowCamera.near=1;
  shadowCamera.far=Math.max(3000,diagonal*1.5);
  shadowCamera.updateProjectionMatrix();
  sun.shadow.needsUpdate=true;

  return {size,diagonal,shadowHalfSpan,maxDistance:sceneViewMaxDistance};
}

let slopeLoadSequence=0;
async function loadSlope(id){
  const loadSequence=++slopeLoadSequence;
  const isCurrentLoad=()=>loadSequence===slopeLoadSequence;
  weatherSystem.setSceneReady(false);
  if(state.mode!=='overview')setSceneMode('overview');
  clearEditorSelectionHelper();
  clearTestForest();
  if(state.root){scene.remove(state.root);state.root=null;}
  state.terrain=null;state.baseTerrain=null;state.baseTerrainMats=[];state.activeTerrainAssetId=null;state.curves=null;state.terrainMats=[];
  state.designGroup=clearGroup(state.designGroup);
  state.labelsGroup=clearGroup(state.labelsGroup);
  state.terrainLabelsGroup=clearGroup(state.terrainLabelsGroup);
  dbgEl.textContent='';
  clearMeasure();
  assetToken=Date.now();
  document.getElementById('stats').textContent='Загрузка рельефа…';
  sceneLoadingEl.style.display='flex';
  const loadTitle=sceneLoadingEl.querySelector('.load-title');
  const loadSub=sceneLoadingEl.querySelector('.load-sub');
  if(loadTitle)loadTitle.textContent='Подготавливаем склон';
  if(loadSub)loadSub.textContent='Загружаем рельеф и собираем 3D-сцену';
  try{
    let root=null;
    let canonicalTerrain=null;
    if(id==='A1'){
      try{
        canonicalTerrain=await loadCanonicalTerrainFbx(isCurrentLoad);
      }catch(realTerrainError){
        if(!isCurrentLoad())return;
        dbg('Maya terrainShape недоступен — использую резервный A1.gltf: '+(realTerrainError?.message||realTerrainError));
      }
    }
    if(!isCurrentLoad())return;
    if(canonicalTerrain){
      root=canonicalTerrain.root;
    }else{
      const gltf=await loadGLTF('./assets/'+id+'.gltf'+bust());
      if(!isCurrentLoad())return;
      root=gltf.scene;
    }
    disableMaterialEmissionByDefault(root);
    scene.add(root);state.root=root;
    root.updateMatrixWorld(true);
    if(loadSub)loadSub.textContent='Рельеф загружен · формируем зимний лес';
    if(canonicalTerrain){
      state.terrain=canonicalTerrain.terrainMesh;
      setTerrainSnowMaterial(canonicalTerrain.terrainMesh,canonicalTerrain.metersPerUnit);
      const size=canonicalTerrain.size;
      dbg(
        'Maya terrainShape загружен · '+canonicalTerrain.linearUnit+' → metres ×'+canonicalTerrain.metersPerUnit+
        ' · '+Math.round(size.x)+' × '+Math.round(size.z)+' m · '+Math.round(size.y)+' m высота.'
      );
    }else{
      root.traverse(o=>{
        const objectName=(o.name||'').toLowerCase();
        if(objectName.includes('slope')) applyImportedSlopeDepthBias(o,-1,-1);
        if(objectName.includes('terrain')){
          state.terrain=o;
          o.traverse(c=>{
            if(c.isMesh){
              setTerrainSnowMaterial(c);
            }
          });
        }
      });
    }
    state.baseTerrain=state.terrain;
    state.baseTerrainMats=state.terrainMats.slice();
    renderTreeAreaOverlays();
    renderTreeAreaOverlays();
    const savedTerrainAsset=state.importedAssets.find(asset=>asset.meta?.category==='terrain'&&asset.meta?.activeTerrain);
    if(savedTerrainAsset)activateImportedTerrain(savedTerrainAsset,{rebuildForest:false,refreshList:false});
    applyTerrainLook();
    root.updateMatrixWorld(true);
    refreshEditorAssetList();
    buildTestForest();
    const loadedRoot=state.root;
    loadAiPineTextures().then(textures=>{
      if(!textures||state.root!==loadedRoot)return;
      const upgradeForest=()=>{
        if(state.root===loadedRoot){
          buildTestForest({reusePlacements:true});
          dbg('OpenAI-текстуры зимних елей активированы: '+AI_PINE_VARIANTS.length+' вариантов.');
        }
      };
      if(typeof window.requestIdleCallback==='function')window.requestIdleCallback(upgradeForest,{timeout:1600});
      else setTimeout(upgradeForest,900);
    });
    dbg('Terrain загружен.');
    if(loadSub)loadSub.textContent=state.optimizeMode?'Подготавливаем параметры оптимизации':'Настраиваем освещение и камеру';
    if(state.optimizeMode){
      await loadOptimizerData(id,isCurrentLoad);
      if(!isCurrentLoad())return;
    }else{
      state.curves=null;
      document.getElementById('stats').textContent='Презентационный режим. Откройте «Оптимизация», чтобы загрузить инструменты выравнивания.';
      document.getElementById('mayaLabels').textContent='Инструменты оптимизации не загружены.';
    }
    const viewTarget=state.terrain||root;
    const box=new THREE.Box3().setFromObject(viewTarget);
    const ctr=box.getCenter(new THREE.Vector3()),sz=box.getSize(new THREE.Vector3()).length();
    const scaleFit=adaptSceneScaleToBounds(box);
    if(scaleFit){
      dbg('Scene scale: '+Math.round(scaleFit.size.x)+' × '+Math.round(scaleFit.size.z)+' m · camera max '+Math.round(scaleFit.maxDistance)+' m · shadow coverage ±'+Math.round(scaleFit.shadowHalfSpan)+' m.');
    }
    lightingCenter.copy(ctr); updateDaylight(state.dayTime);
    camera.position.set(ctr.x+sz*.5,ctr.y+sz*.5,ctr.z+sz*.7);
    controls.target.copy(ctr);controls.update();
    state.homePos=camera.position.clone();
    state.homeTarget=controls.target.clone();
    restoreSavedOverviewCameraForCurrentSlope();
    updateModeSwitcher();
    if(state.optimizeMode){
      await new Promise(r=>setTimeout(r,50));
      if(!isCurrentLoad())return;
      try{ rebuild(); }
      catch(e){
        dbg('ОШИБКА РАСЧЁТА: '+(e&&e.message?e.message:String(e)));
        console.error(e);
        document.getElementById('stats').textContent='Ошибка расчёта: '+(e&&e.message?e.message:String(e));
      }
    }else{
      document.getElementById('stats').textContent='Рельеф загружен. Режим презентации готов.';
    }
  }catch(err){
    if(!isCurrentLoad())return;
    const msg=err&&(err.message||err.description)?(err.message||err.description):String(err);
    document.getElementById('stats').textContent='Ошибка загрузки склона "'+id+'": '+msg;
    dbg('ОШИБКА: '+msg);
    console.error(err);
  }finally{
    if(isCurrentLoad()){
      weatherSystem.setSceneReady(!!state.root);
      let resumePendingSkier=false;
      if(pendingSceneMode==='skier'){
        pendingSceneMode=null;
        const terrain=resolveSkierTerrain();
        if(terrain)resumePendingSkier=true;
        else{
          const rootInfo=state.root?'root существует, но mesh не найден':'корень сцены не создан';
          const message='ЛЫЖНИК: загрузка завершилась без доступного рельефа ('+rootInfo+').';
          dbg(message);skierLockHintEl.textContent=message;showModeSwitchFeedback(message);
        }
      }
      await new Promise(resolve=>requestAnimationFrame(resolve));
      await new Promise(resolve=>requestAnimationFrame(resolve));
      if(isCurrentLoad()){
        if(state.mode==='overview'){controls.enabled=true;controls.update();}
        sceneLoadingEl.style.display='none';
        if(resumePendingSkier)requestAnimationFrame(()=>setSceneMode('skier'));
      }
    }
  }
}


const map=[['pAng','ang','vAng',v=>v+'°'],['pProf','prof','vProf',v=>v],['pCut','cut','vCut',v=>v.toFixed(1)],['pOff','off','vOff',v=>v],['pCross','cross','vCross',v=>v],['pUsable','usable','vUsable',v=>v],['pEarth','earthwork_w','vEarth',v=>v],['pMaxFill','max_fill','vMaxFill',v=>v],['pOffR','off_range','vOffR',v=>v],['pCrossMax','cross_max','vCrossMax',v=>v]];
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
  opticsSettings.sunIntensity=THREE.MathUtils.clamp(parseFloat(e.target.value)*100,0,300);
  applyOpticsSettings();
});
document.getElementById('pSunRot').addEventListener('input',e=>{
  opticsSettings.sunRotation=THREE.MathUtils.clamp(parseFloat(e.target.value),0,360);
  applyOpticsSettings();
});
document.getElementById('pShadow').addEventListener('input',e=>{
  opticsSettings.shadowQuality=THREE.MathUtils.clamp(parseInt(e.target.value,10),0,2);
  applyOpticsSettings();
});
document.getElementById('pLabelOp').addEventListener('input',e=>{
  state.labelOpacity=parseFloat(e.target.value)/100;
  document.getElementById('vLabelOp').textContent=e.target.value+'%';
  applyLabelOpacity();
});
document.getElementById('pLightOn').addEventListener('change',e=>{
  opticsSettings.sunEnabled=e.target.checked;
  applyOpticsSettings();
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
  const d={pAng:35,pProf:0,pCut:5,pOff:-0.75,pCross:0.264,pUsable:90,pEarth:0.03,pMaxFill:0,pOffR:3,pCrossMax:3};
  for(const k in d){const e=document.getElementById(k);if(e){e.value=d[k];e.dispatchEvent(new Event('input'));}}
});


const appRoot = document.getElementById('app');
bindSlopeAnalysisLayerControls();
const optimizerToggleButton = document.getElementById('optimizerToggle');
const overviewModeButton = document.getElementById('overviewMode');
async function setOptimizerOpen(open) {
  if(open){
    // Slope optimization uses OrbitControls. Never leave a skier/drone
    // Pointer Lock active behind the optimizer panel.
    if(state.mode!=='overview')setSceneMode('overview');
    if(document.pointerLockElement===renderer.domElement)document.exitPointerLock?.();
    skierController.stop();
    droneController.stop();
    if(appRoot.classList.contains('editor-open')){
      appRoot.classList.remove('editor-open');
      editorToggleButton.classList.remove('active');
      editorToggleButton.setAttribute('aria-expanded','false');
      if(editorSelectionHelper)editorSelectionHelper.visible=false;
    }
  }
  state.optimizeMode = open;
  appRoot.classList.toggle('optimizer-open',open);
  optimizerToggleButton.classList.toggle('active',open);
  optimizerToggleButton.textContent = open ? 'ЗАКРЫТЬ ОПТИМИЗАЦИЮ' : 'ОПТИМИЗАЦИЯ СКЛОНОВ';
  if(!open || !state.terrain || state.curves) return;
  loadingEl.style.display='flex';
  try {
    await loadOptimizerData(state.slope);
    await new Promise(resolve=>setTimeout(resolve,40));
    rebuild();
  } catch(e) {
    dbg('ОШИБКА ЗАГРУЗКИ ИНСТРУМЕНТОВ: '+(e?.message||String(e)));
    document.getElementById('stats').textContent='Ошибка загрузки инструментов: '+(e?.message||String(e));
  } finally {
    loadingEl.style.display='none';
  }
}
optimizerToggleButton.addEventListener('click',()=>setOptimizerOpen(!state.optimizeMode));

/* ---------- Scene Editor / GLB import / PBR material inspector · v132 ---------- */
const editorToggleButton=document.getElementById('editorToggle');
const editorPanel=document.getElementById('sceneEditorPanel');
const sceneHierarchyPanel=document.getElementById('sceneHierarchyPanel');
const editorTreeList=document.getElementById('editorTreeList');
const editorTreeSearch=document.getElementById('editorTreeSearch');
const glbFileInput=document.getElementById('glbFileInput');
const editorStatus=document.getElementById('editorStatus');
const editorObjectSelect=document.getElementById('editorObjectSelect');
const editorMaterialSelect=document.getElementById('editorMaterialSelect');
let editorSelectedAsset=null;
let editorSelectedNode=null;
let editorSelectedMaterialKey='';
const editorOriginalVisibility=new WeakMap();
let editorTreeExpanded=new Set();
let editorTreeInitialized=new Set();
let editorMaterialTargets=[];
let editorSelectionHelper=null;
const editorSelectionPulses=[];

function setEditorStatus(message,isError=false){
  editorStatus.textContent=message;
  editorStatus.classList.toggle('error',isError);
}
function updateTerrainResetControl(){
  const button=document.getElementById('resetTerrainButton');
  if(button)button.disabled=!state.activeTerrainAssetId;
}
function focusSceneObject(target){
  if(!target)return;
  target.updateWorldMatrix(true,true);
  const box=new THREE.Box3().setFromObject(target);
  if(box.isEmpty())return;
  const center=box.getCenter(new THREE.Vector3());
  const size=box.getSize(new THREE.Vector3());
  const radius=Math.max(size.length()*0.5,3);
  const distance=radius/Math.max(0.1,Math.sin(THREE.MathUtils.degToRad(camera.fov*0.5)))*1.18;
  const direction=new THREE.Vector3(1,0.68,1).normalize();
  camera.position.copy(center).addScaledVector(direction,distance);
  camera.near=0.5;
  camera.far=Math.max(10000,distance+radius*20);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
  lightingCenter.copy(center);
  updateDaylight(state.dayTime);
  state.homePos=camera.position.clone();
  state.homeTarget=controls.target.clone();
}
function collectTerrainMaterials(root){
  const materials=[];
  root?.traverse(object=>{
    if(!object.isMesh||!object.material)return;
    (Array.isArray(object.material)?object.material:[object.material]).forEach(material=>{
      if(material)materials.push(material);
    });
  });
  return materials;
}
function syncActiveTerrainTransform(asset,rebuildForest=false){
  if(!asset||asset.id!==state.activeTerrainAssetId)return;
  asset.root.updateWorldMatrix(true,true);
  state.terrain=asset.root;
  droneController.setTerrain(asset.root);
  if(rebuildForest){clearTestForest();buildTestForest();}
}
function activateImportedTerrain(asset,{rebuildForest=true,refreshList=true,persist=true}={}){
  if(!asset?.root||asset.sourceType==='scene')return false;
  state.importedAssets.forEach(other=>{
    if(other!==asset&&other.meta?.category==='terrain'){
      other.meta.activeTerrain=false;
      other.meta.visible=false;
      other.root.visible=false;
      persistImportedEditorAsset(other).catch(error=>console.warn('Не удалось сохранить переключение рельефа:',error));
    }
  });
  if(state.baseTerrain)state.baseTerrain.visible=false;
  asset.meta.category='terrain';
  asset.meta.activeTerrain=true;
  asset.meta.visible=true;
  asset.meta.collision=true;
  asset.root.visible=true;
  state.activeTerrainAssetId=asset.id;
  state.terrain=asset.root;
  state.terrainVisible=true;
  state.terrainMats=collectTerrainMaterials(asset.root);
  asset.root.updateWorldMatrix(true,true);
  droneController.setTerrain(asset.root);
  applyTerrainLook();
  if(rebuildForest){clearTestForest();buildTestForest();}
  updateTerrainResetControl();
  if(refreshList)refreshEditorAssetList(asset.id);
  if(persist)persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить настройки рельефа:',error));
  return true;
}
function resetImportedTerrain({rebuildForest=true,persist=true}={}){
  const active=state.importedAssets.find(asset=>asset.id===state.activeTerrainAssetId);
  if(active){
    active.meta.activeTerrain=false;
    active.meta.visible=false;
    active.root.visible=false;
    if(persist)persistImportedEditorAsset(active).catch(error=>console.warn('Не удалось сохранить настройки модели:',error));
  }
  state.activeTerrainAssetId=null;
  state.terrain=state.baseTerrain;
  state.terrainMats=state.baseTerrainMats.slice();
  state.terrainVisible=true;
  if(state.baseTerrain)state.baseTerrain.visible=true;
  if(state.terrain)state.terrain.updateWorldMatrix(true,true);
  droneController.setTerrain(state.terrain);
  applyTerrainLook();
  if(rebuildForest){clearTestForest();buildTestForest();}
  updateTerrainResetControl();
  refreshEditorAssetList();
  setEditorStatus('Восстановлен исходный рельеф текущей трассы.');
}
function slugAssetName(value){
  return String(value||'asset').replace(/\\.[^.]+$/,'').replace(/[^A-Za-z0-9_.-]+/g,'_').replace(/^_+|_+$/g,'')||'asset';
}
function collectLiveSceneAssets(){
  const assets=[];
  if(!state.root)return assets;
  let meshIndex=0;
  state.root.traverse(object=>{
    if(!object.isMesh||!object.material)return;
    captureEditorNodeVisibilityDefaults(object);
    const objectName=object.name||('Mesh '+(meshIndex+1));
    const id='scene:'+state.slope+':'+meshIndex+':'+objectName;
    const defaults={
      id,name:objectName,
      category:/terrain|ground/i.test(objectName)?'terrain':(/slope|piste/i.test(objectName)?'slope':'infrastructure'),
      phase:'always',
      collision:/terrain|ground/i.test(objectName),
      forestBlocker:/terrain|ground|slope|road|lift/i.test(objectName),
      sourceFile:state.slope+'.gltf'
    };
    const meta=object.userData.resortAsset||defaults;
    meta.id=id;meta.name=objectName;
    object.userData.resortAsset=meta;
    assets.push({id,name:'SCENE · '+objectName,root:object,meta,sourceType:'scene'});
    meshIndex++;
  });
  return assets;
}
function getAllEditorAssets(){
  return [
    ...state.importedAssets.map(asset=>{
      asset.sourceType='imported';
      return asset;
    }),
    ...collectLiveSceneAssets()
  ];
}
function clearEditorSelectionHelper(){
  if(!editorSelectionHelper)return;
  scene.remove(editorSelectionHelper);
  editorSelectionHelper.geometry?.dispose();
  if(Array.isArray(editorSelectionHelper.material))editorSelectionHelper.material.forEach(m=>m.dispose());
  else editorSelectionHelper.material?.dispose();
  editorSelectionHelper=null;
}
function updateEditorSelectionHelper(asset){
  clearEditorSelectionHelper();
  if(!asset?.root)return;
  editorSelectionHelper=new THREE.BoxHelper(asset.root,0x53d69a);
  editorSelectionHelper.material.depthTest=false;
  editorSelectionHelper.material.transparent=true;
  editorSelectionHelper.material.opacity=0.95;
  editorSelectionHelper.renderOrder=1000;
  editorSelectionHelper.visible=appRoot.classList.contains('editor-open');
  scene.add(editorSelectionHelper);
}
// Imported FBX files may duplicate one material slot across several mesh groups.
function editorTexturesEquivalent(a,b){
  if(a===b)return true;
  if(!a||!b)return false;
  const source=texture=>{
    const image=texture.image||texture.source?.data||{};
    return {
      name:String(texture.name||'').trim(),
      image:String(image.currentSrc||image.src||image.name||'')
    };
  };
  const sourceA=source(a),sourceB=source(b);
  if(sourceA.name!==sourceB.name||sourceA.image!==sourceB.image)return false;
  if(!sourceA.name&&!sourceA.image&&a.image!==b.image&&a.source?.data!==b.source?.data)return false;
  const scalarFields=['mapping','channel','wrapS','wrapT','magFilter','minFilter','anisotropy',
    'format','type','colorSpace','flipY','generateMipmaps','premultiplyAlpha','unpackAlignment',
    'rotation','matrixAutoUpdate'];
  for(const key of scalarFields)if(a[key]!==b[key])return false;
  for(const key of ['offset','repeat','center']){
    const av=a[key],bv=b[key];
    if(!!av!==!!bv)return false;
    if(av&&(Math.abs(av.x-bv.x)>1e-6||Math.abs(av.y-bv.y)>1e-6))return false;
  }
  const matrixA=a.matrix?.elements,matrixB=b.matrix?.elements;
  if(!!matrixA!==!!matrixB)return false;
  if(matrixA&&matrixA.some((value,index)=>Math.abs(value-matrixB[index])>1e-6))return false;
  return true;
}
function editorMaterialsEquivalent(a,b){
  if(a===b)return true;
  if(!a||!b||a.type!==b.type)return false;
  const nameA=String(a.name||'').trim().toLowerCase();
  const nameB=String(b.name||'').trim().toLowerCase();
  if(!nameA||nameA!==nameB)return false;
  const colorKeys=['color','emissive','specular','sheenColor','attenuationColor'];
  for(const key of colorKeys){
    const av=a[key],bv=b[key];
    if(!!av!==!!bv)return false;
    if(av&&av.getHexString?.()!==bv.getHexString?.())return false;
  }
  const scalarKeys=['opacity','transparent','alphaTest','side','depthTest','depthWrite','wireframe',
    'wireframeLinewidth','vertexColors','fog','lights','flatShading','toneMapped','roughness',
    'metalness','emissiveIntensity','aoMapIntensity','bumpScale','displacementScale',
    'displacementBias','envMapIntensity','reflectivity','refractionRatio','shininess',
    'specularIntensity','clearcoat','clearcoatRoughness','ior','transmission','thickness',
    'attenuationDistance','sheen','sheenRoughness','iridescence','iridescenceIOR','anisotropy',
    'polygonOffset','polygonOffsetFactor','polygonOffsetUnits'];
  for(const key of scalarKeys){
    const av=a[key],bv=b[key];
    if(typeof av==='number'&&typeof bv==='number'){
      if(Math.abs(av-bv)>1e-6)return false;
    }else if(av!==bv)return false;
  }
  for(const key of ['normalScale','clearcoatNormalScale']){
    const av=a[key],bv=b[key];
    if(!!av!==!!bv)return false;
    if(av&&(Math.abs(av.x-bv.x)>1e-6||Math.abs(av.y-bv.y)>1e-6))return false;
  }
  const textureKeys=new Set([
    ...Object.keys(a).filter(key=>a[key]?.isTexture),
    ...Object.keys(b).filter(key=>b[key]?.isTexture)
  ]);
  for(const key of textureKeys)if(!editorTexturesEquivalent(a[key],b[key]))return false;
  return true;
}
function mergeEquivalentEditorMaterials(root){
  const canonicalMaterials=[];
  let materialSlots=0,mergedSlots=0;
  root?.traverse(object=>{
    if(!object.isMesh||!object.material)return;
    const source=Array.isArray(object.material)?object.material:[object.material];
    const normalized=source.map(material=>{
      if(!material)return material;
      materialSlots++;
      const canonical=canonicalMaterials.find(candidate=>editorMaterialsEquivalent(candidate,material));
      if(canonical){
        if(canonical!==material)mergedSlots++;
        return canonical;
      }
      canonicalMaterials.push(material);
      return material;
    });
    object.material=Array.isArray(object.material)?normalized:normalized[0];
  });
  return {materialCount:canonicalMaterials.length,materialSlots,mergedSlots};
}
function editorGeometryForMaterial(object,materialFilter,ownedGeometries){
  const geometry=object.geometry;
  if(!materialFilter)return geometry;
  const groups=Array.isArray(geometry.groups)?geometry.groups:[];
  if(!groups.length){
    const assigned=Array.isArray(object.material)?object.material[0]:object.material;
    return editorMaterialsEquivalent(assigned,materialFilter)?geometry:null;
  }
  const matchingGroups=groups.filter(group=>{
    const assigned=Array.isArray(object.material)?object.material[group.materialIndex]:object.material;
    return editorMaterialsEquivalent(assigned,materialFilter);
  });
  if(!matchingGroups.length)return null;
  const filtered=geometry.clone();
  filtered.clearGroups();
  matchingGroups.forEach(group=>filtered.addGroup(group.start,group.count,0));
  ownedGeometries.push(filtered);
  return filtered;
}
function disposeEditorSelectionPulse(effect){
  if(!effect)return;
  scene.remove(effect.overlayRoot);
  effect.materials.forEach(material=>material.dispose());
  effect.geometries?.forEach(geometry=>geometry.dispose());
  effect.overlayRoot.clear();
}
function clearEditorSelectionPulses(){
  editorSelectionPulses.splice(0).forEach(disposeEditorSelectionPulse);
}
function pulseEditorSelection(target,materialFilter=null){
  if(!target||!appRoot.classList.contains('editor-open')||state.mode!=='overview')return;
  // A new click replaces the previous pulse. Object and material selections
  // use the same one-second fade instead of leaving a persistent yellow overlay.
  clearEditorSelectionPulses();
  target.updateWorldMatrix(true,true);
  const overlayRoot=new THREE.Group();
  overlayRoot.name=materialFilter?'GradeOptimizer_MaterialSelection':'GradeOptimizer_SelectionPulse';
  scene.add(overlayRoot);
  const materials=[],geometries=[],items=[];
  target.traverseVisible(object=>{
    if(!object.isMesh||!object.geometry)return;
    const geometry=editorGeometryForMaterial(object,materialFilter,geometries);
    if(!geometry)return;
    const overlayMaterial=new THREE.MeshBasicMaterial({
      color:0xffd52f,
      transparent:true,
      opacity:0.001,
      depthTest:true,
      depthWrite:false,
      side:THREE.DoubleSide,
      blending:THREE.AdditiveBlending,
      polygonOffset:true,
      polygonOffsetFactor:-1,
      polygonOffsetUnits:-1,
      toneMapped:false
    });
    const overlay=new THREE.Mesh(geometry,overlayMaterial);
    overlay.name='GradeOptimizer_SelectionPulseMesh';
    overlay.matrixAutoUpdate=false;
    overlay.matrix.copy(object.matrixWorld);
    overlay.matrixWorldNeedsUpdate=true;
    overlay.frustumCulled=false;
    overlay.renderOrder=900;
    overlayRoot.add(overlay);
    materials.push(overlayMaterial);
    items.push({source:object,overlay});
  });
  if(!items.length){
    scene.remove(overlayRoot);
    geometries.forEach(geometry=>geometry.dispose());
    return;
  }
  const effect={
    target,overlayRoot,materials,geometries,items,
    started:performance.now(),duration:1000
  };
  editorSelectionPulses.push(effect);
}
function updateEditorSelectionPulses(now=performance.now()){
  if(!appRoot.classList.contains('editor-open')||state.mode!=='overview'){
    clearEditorSelectionPulses();
    return;
  }
  for(let index=editorSelectionPulses.length-1;index>=0;index--){
    const effect=editorSelectionPulses[index];
    if(effect.target!==state.root&&!effect.target.parent){
      disposeEditorSelectionPulse(effect);
      editorSelectionPulses.splice(index,1);
      continue;
    }
    const progress=(now-effect.started)/effect.duration;
    if(progress>=1){
      disposeEditorSelectionPulse(effect);
      editorSelectionPulses.splice(index,1);
      continue;
    }
    const opacity=0.66*Math.pow(Math.max(0,Math.sin(Math.PI*Math.max(0,progress))),0.78);
    effect.items.forEach(({source,overlay})=>{
      if(source.parent)source.updateWorldMatrix(true,false);
      overlay.matrix.copy(source.matrixWorld);
      overlay.matrixWorldNeedsUpdate=true;
      overlay.material.opacity=opacity;
    });
  }
}

function editorNodeKey(owner,node){
  return owner.id+'::node::'+node.uuid;
}
function editorMaterialKey(owner,node,index){
  return owner.id+'::material::'+node.uuid+'::'+index;
}
function editorNodeIsInside(root,node){
  let current=node;
  while(current){if(current===root)return true;current=current.parent;}
  return false;
}
function editorSelectionKey(){
  if(!editorSelectedAsset||!editorSelectedNode)return '';
  return editorSelectedMaterialKey||editorNodeKey(editorSelectedAsset,editorSelectedNode);
}
function editorNodeLabel(node){
  return node.name||((node.isMesh?'Mesh':node.type)||'Object');
}
function editorNodeMaterialList(node){
  if(!node?.isMesh||!node.material)return [];
  return Array.isArray(node.material)?node.material:[node.material];
}
function editorNodeSearchSelfMatches(owner,node,query){
  if(!query)return true;
  const metadata=node.userData?.gradeOptimizerMetadata||{};
  const metadataText=[metadata.role||'',...(Array.isArray(metadata.tags)?metadata.tags:[])].join(' ');
  const text=[editorNodeLabel(node),node.type,owner.name,owner.meta?.category||'',metadataText].join(' ').toLowerCase();
  if(text.includes(query))return true;
  return editorNodeMaterialList(node).some(material=>(material?.name||'Material').toLowerCase().includes(query));
}
function editorNodeHasSearchMatch(owner,node,query){
  if(editorNodeSearchSelfMatches(owner,node,query))return true;
  return (node.children||[]).some(child=>editorNodeHasSearchMatch(owner,child,query));
}
function collectSharedMaterialUseCounts(assets){
  const counts=new Map();
  assets.forEach(asset=>asset.root.traverse(node=>{
    editorNodeMaterialList(node).forEach(material=>{
      if(material)counts.set(material.uuid,(counts.get(material.uuid)||0)+1);
    });
  }));
  return counts;
}
function collectEditorMaterialLibrary(assets=getAllEditorAssets()){
  const library=new Map();
  assets.forEach(owner=>owner.root.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.material)return;
    editorNodeMaterialList(mesh).forEach((material,index)=>{
      if(!material)return;
      let entry=library.get(material.uuid);
      if(!entry){
        entry={id:material.uuid,material,targets:[],firstOwner:owner,firstMesh:mesh};
        library.set(material.uuid,entry);
      }
      entry.targets.push({owner,mesh,index});
    });
  }));
  return [...library.values()].sort((a,b)=>(a.material.name||'Material').localeCompare(b.material.name||'Material'));
}

function editorTexturePreviewSource(texture){
  if(!texture)return '';
  return texture.userData?.editorObjectUrl
    ||texture.userData?.editorTextureDataUrl
    ||texture.image?.currentSrc
    ||texture.image?.src
    ||'';
}
function refreshEditorTexturePreviews(material=selectedEditorMaterial()?.material){
  Object.entries(EDITOR_TEXTURE_MAPS).forEach(([type,spec])=>{
    const texture=material?.[spec.property]||null;
    const image=document.getElementById('editorTexturePreview-'+type);
    const empty=document.getElementById('editorTexturePreviewEmpty-'+type);
    const filename=document.getElementById('editorTextureFileName-'+type);
    const remove=document.querySelector('[data-texture-remove="'+type+'"]');
    const source=editorTexturePreviewSource(texture);
    if(image){
      if(source){image.src=source;image.hidden=false;}
      else{image.removeAttribute('src');image.hidden=true;}
    }
    if(empty)empty.hidden=!!source;
    if(filename)filename.textContent=texture?(texture.name||'Карта подключена'):'Карта не назначена';
    if(remove)remove.disabled=!texture;
  });
}
function updateMaterialLibraryWindowControls(){
  const select=document.getElementById('editorMaterialLibrarySelect');
  const selectedId=select?.value||'';
  const items=collectEditorMaterialLibrary();
  const selected=items.find(item=>item.id===selectedId);
  const assign=document.getElementById('materialLibraryAssign');
  const unique=document.getElementById('materialLibraryUnique');
  const status=document.getElementById('materialLibrarySelectionStatus');
  if(assign)assign.disabled=!selected||!selectedEditorMaterial();
  if(unique)unique.disabled=!selectedEditorMaterial()?.material;
  if(status){
    if(selected)status.textContent='Выбран: '+(selected.material.name||'Material')+' · '+selected.targets.length+' связанных slot(s). Для назначения выбери целевой slot во вкладке Materials.';
    else status.textContent='Выбери материал в библиотеке. Целевой material slot выбирается во вкладке Materials.';
  }
}
function renderMaterialLibraryWindow(){
  const grid=document.getElementById('materialLibraryGrid');
  if(!grid)return;
  const items=collectEditorMaterialLibrary();
  const filter=(document.getElementById('materialLibrarySearch')?.value||'').trim().toLowerCase();
  const selectedId=document.getElementById('editorMaterialLibrarySelect')?.value||'';
  const visible=items.filter(item=>{
    const name=item.material.name||'Material';
    const owner=item.firstOwner?.name||'Scene';
    return !filter||(name+' '+owner).toLowerCase().includes(filter);
  });
  const count=document.getElementById('materialLibraryCount');
  if(count)count.textContent=items.length+' MATERIAL'+(items.length===1?'':'S');
  grid.textContent='';
  if(!visible.length){
    const empty=document.createElement('div');
    empty.className='hypershade-empty';
    empty.textContent=items.length?'Нет материалов по этому запросу':'В сцене пока нет материалов';
    grid.appendChild(empty);
  }
  visible.forEach(item=>{
    const material=item.material;
    const card=document.createElement('button');
    card.type='button';
    card.className='hypershade-material-card'+(item.id===selectedId?' active':'');
    const swatch=document.createElement('span');
    swatch.className='hypershade-swatch';
    swatch.style.backgroundColor=material.color?.getStyle?.()||'#8798a7';
    const source=editorTexturePreviewSource(material.map);
    if(source){
      const image=document.createElement('img');
      image.alt='';
      image.src=source;
      swatch.classList.add('has-texture');
      swatch.appendChild(image);
    }
    const name=document.createElement('span');
    name.className='hypershade-material-name';
    name.textContent=material.name||'Material';
    const meta=document.createElement('span');
    meta.className='hypershade-material-meta';
    meta.textContent=item.targets.length+' slot(s) · '+(item.firstOwner?.name||'Scene');
    card.append(swatch,name,meta);
    card.addEventListener('click',()=>{
      const select=document.getElementById('editorMaterialLibrarySelect');
      if(select)select.value=item.id;
      grid.querySelectorAll('.hypershade-material-card').forEach(node=>node.classList.toggle('active',node===card));
      updateEditorMaterialLibraryControls();
      updateMaterialLibraryWindowControls();
    });
    grid.appendChild(card);
  });
  updateMaterialLibraryWindowControls();
}

function updateEditorMaterialLibraryControls(){
  const target=selectedEditorMaterial();
  const librarySelect=document.getElementById('editorMaterialLibrarySelect');
  const assignButton=document.getElementById('assignEditorMaterial');
  const uniqueButton=document.getElementById('makeEditorMaterialUnique');
  const selectedId=librarySelect?.value||'';
  const libraryItem=collectEditorMaterialLibrary().find(item=>item.id===selectedId);
  if(assignButton)assignButton.disabled=!target||!libraryItem;
  if(uniqueButton)uniqueButton.disabled=!target?.material;
}
function refreshEditorMaterialLibrary(preferredId=''){
  const select=document.getElementById('editorMaterialLibrarySelect');
  if(!select)return;
  const previousId=preferredId||select.value||selectedEditorMaterial()?.material?.uuid||'';
  const items=collectEditorMaterialLibrary();
  select.innerHTML='';
  if(!items.length){
    const option=document.createElement('option');
    option.value='';option.textContent='В сцене пока нет материалов';
    select.appendChild(option);
    select.disabled=true;
    updateEditorMaterialLibraryControls();
    renderMaterialLibraryWindow();
    return;
  }
  items.forEach(item=>{
    const materialName=item.material.name||'Material';
    const uses=item.targets.length;
    const context=item.firstOwner?.name||'Scene';
    const option=document.createElement('option');
    option.value=item.id;
    option.textContent=materialName+' · '+uses+' slot(s) · '+context;
    select.appendChild(option);
  });
  select.disabled=false;
  const fallback=selectedEditorMaterial()?.material?.uuid||items[0].id;
  select.value=items.some(item=>item.id===previousId)?previousId:fallback;
  updateEditorMaterialLibraryControls();
  renderMaterialLibraryWindow();
}
function updateEditorMaterialLinkStatus(){
  const status=document.getElementById('editorMaterialLinkStatus');
  if(!status)return;
  const target=selectedEditorMaterial();
  if(!target?.material){status.textContent='Выбери material slot для редактирования.';return;}
  const uses=collectSharedMaterialUseCounts(getAllEditorAssets()).get(target.material.uuid)||1;
  status.textContent=uses>1
    ?'SHARED ×'+uses+' — изменения применяются ко всем слотам с этим экземпляром материала.'
    :'UNIQUE INSTANCE — изменения затрагивают только этот экземпляр материала.';
}
function markEditorMaterialOwnersDirty(material){
  if(!material)return [];
  const affected=[];
  state.importedAssets.forEach(asset=>{
    let usesMaterial=false;
    asset.root.traverse(node=>{
      if(!usesMaterial&&editorNodeMaterialList(node).includes(material))usesMaterial=true;
    });
    if(usesMaterial){
      asset.meta.modelDirty=true;
      affected.push(asset);
    }
  });
  return affected;
}
function replaceEditorMaterialTarget(target,material){
  if(!target||!material)return false;
  const bindings=target.bindings?.length?target.bindings:[target];
  let replaced=0;
  bindings.forEach(binding=>{
    if(!binding?.mesh)return;
    const current=binding.mesh.material;
    if(Array.isArray(current)){
      if(binding.index<0||binding.index>=current.length)return;
      const next=current.slice();
      next[binding.index]=material;
      binding.mesh.material=next;
      replaced++;
    }else if(binding.index===0){
      binding.mesh.material=material;
      replaced++;
    }
  });
  return replaced>0;
}
function assignEditorLibraryMaterial(){
  const target=selectedEditorMaterial();
  const libraryId=document.getElementById('editorMaterialLibrarySelect')?.value||'';
  const libraryItem=collectEditorMaterialLibrary().find(item=>item.id===libraryId);
  if(!target||!libraryItem)return;
  if(target.material===libraryItem.material){
    setEditorStatus('Этот слот уже использует выбранный материал.');
    return;
  }
  if(!replaceEditorMaterialTarget(target,libraryItem.material))return;
  const affected=markEditorMaterialOwnersDirty(libraryItem.material);
  if(target.owner?.sourceType==='imported'&&!affected.includes(target.owner)){
    target.owner.meta.modelDirty=true;
    affected.push(target.owner);
  }
  markClientProjectDirty('назначение общего материала');
  const selectedIndex=Number(editorMaterialSelect.value)||0;
  editorSelectedMaterialKey=editorMaterialKey(target.owner,target.mesh,target.index);
  refreshEditorMaterialList(selectedIndex);
  refreshEditorMaterialLibrary(libraryItem.id);
  renderEditorTree(getAllEditorAssets(),editorSelectionKey());
  affected.forEach(asset=>persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить назначение общего материала:',error)));
  setEditorStatus('Материал «'+(libraryItem.material.name||'Material')+'» назначен слоту «'+(target.mesh.name||'Mesh')+'». Теперь он связан как минимум с '+(libraryItem.targets.length+target.bindings.length)+' слотами.');
}
function makeEditorMaterialUnique(){
  const target=selectedEditorMaterial();
  if(!target?.material)return;
  const source=target.material;
  const clone=source.clone();
  clone.name=(source.name||'Material')+' (Unique)';
  clone.userData={...(source.userData||{}),gradeOptimizerClonedFrom:source.uuid};
  const textureProperties=[
    'map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','bumpMap',
    'displacementMap','alphaMap','lightMap','envMap','specularMap','clearcoatMap',
    'clearcoatNormalMap','clearcoatRoughnessMap','transmissionMap','thicknessMap',
    'sheenColorMap','sheenRoughnessMap','iridescenceMap','iridescenceThicknessMap','anisotropyMap'
  ];
  textureProperties.forEach(key=>{
    if(source[key]?.isTexture)clone[key]=source[key].clone();
  });
  if(!replaceEditorMaterialTarget(target,clone)){clone.dispose();return;}
  const affected=target.owner?.sourceType==='imported'?[target.owner]:[];
  affected.forEach(asset=>{asset.meta.modelDirty=true;});
  markClientProjectDirty('создание уникального материала');
  const selectedIndex=Number(editorMaterialSelect.value)||0;
  editorSelectedMaterialKey=editorMaterialKey(target.owner,target.mesh,target.index);
  refreshEditorMaterialList(selectedIndex);
  refreshEditorMaterialLibrary(clone.uuid);
  renderEditorTree(getAllEditorAssets(),editorSelectionKey());
  affected.forEach(asset=>persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить уникальный материал:',error)));
  setEditorStatus('Создан независимый материал «'+clone.name+'». Изменения этого слота больше не затронут остальные назначения исходного материала.');
}
function renderEditorTree(assets,selectedKey=editorSelectionKey()){
  if(!editorTreeList)return;
  editorTreeList.innerHTML='';
  const query=(editorTreeSearch?.value||'').trim().toLowerCase();
  const groups=[
    {label:'RESORT SCENE',key:'scene',items:assets.filter(asset=>asset.sourceType==='scene')},
    {label:'IMPORTED MODELS',key:'imported',items:assets.filter(asset=>asset.sourceType!=='scene')}
  ];
  const materialUseCounts=collectSharedMaterialUseCounts(assets);
  let visibleCount=0;

  function appendMaterialRow(owner,node,material,index,depth){
    const key=editorMaterialKey(owner,node,index);
    const row=document.createElement('div');
    row.className='editor-tree-row editor-tree-material-row';
    const spacer=document.createElement('span');
    spacer.className='editor-tree-expander editor-tree-expander-empty';
    spacer.textContent='·';
    const button=document.createElement('button');
    button.type='button';
    button.className='editor-tree-item editor-tree-material'+(key===selectedKey?' selected':'');
    button.style.setProperty('--tree-depth',String(depth));
    button.title=(material?.name||'Material '+(index+1))+' · '+editorNodeLabel(node);
    const icon=document.createElement('span');
    icon.className='tree-icon';icon.textContent='◉';
    const label=document.createElement('span');
    label.className='tree-name';label.textContent=material?.name||'Material '+(index+1);
    const tag=document.createElement('span');
    tag.className='tree-tag';
    const uses=material?materialUseCounts.get(material.uuid)||1:1;
    tag.textContent=uses>1?'SHARED ×'+uses:'MAT';
    button.append(icon,label,tag);
    button.addEventListener('click',()=>{
      selectEditorNode(owner,owner.root,-1,material);
      pulseEditorSelection(owner.root,material);
    });
    row.append(spacer,button);
    editorTreeList.appendChild(row);
    visibleCount++;
  }

  function appendNode(owner,node,depth,isAssetRoot=false){
    if(query&&!editorNodeHasSearchMatch(owner,node,query))return;
    const key=editorNodeKey(owner,node);
    if(isAssetRoot&&!editorTreeInitialized.has(key)){
      editorTreeInitialized.add(key);editorTreeExpanded.add(key);
    }
    const children=node.children||[];
    const materials=editorNodeMaterialList(node);
    const hasChildren=children.length>0||materials.length>0;
    const expanded=query?true:editorTreeExpanded.has(key);
    const row=document.createElement('div');row.className='editor-tree-row';
    const expander=document.createElement('button');
    expander.type='button';
    expander.className='editor-tree-expander'+(hasChildren?'':' editor-tree-expander-empty');
    expander.textContent=hasChildren?(expanded?'▾':'▸'):'·';
    expander.disabled=!hasChildren;
    expander.setAttribute('aria-label',expanded?'Свернуть':'Развернуть');
    expander.setAttribute('aria-expanded',String(expanded));
    if(hasChildren)expander.addEventListener('click',()=>{
      if(editorTreeExpanded.has(key))editorTreeExpanded.delete(key);
      else editorTreeExpanded.add(key);
      renderEditorTree(assets,selectedKey);
    });
    const button=document.createElement('button');
    button.type='button';
    button.className='editor-tree-item'+(key===selectedKey?' selected':'');
    button.style.setProperty('--tree-depth',String(depth));
    button.title=editorNodeLabel(node)+' · '+node.type;
    const icon=document.createElement('span');
    icon.className='tree-icon';
    icon.textContent=node.isMesh?'▧':(node.type==='Group'||node.type==='Scene'?'▰':'◇');
    const label=document.createElement('span');
    label.className='tree-name';label.textContent=editorNodeLabel(node);
    const tag=document.createElement('span');
    tag.className='tree-tag';
    const nodeRole=node.userData?.gradeOptimizerMetadata?.role||'';
    tag.textContent=isAssetRoot?(owner.sourceType==='scene'?'SCENE':(/\.fbx$/i.test(owner.meta?.sourceFile||owner.sourcePath||'')?'FBX':'GLB')):(nodeRole?String(nodeRole).toUpperCase():(node.isMesh?'MESH':node.type.toUpperCase()));
    button.append(icon,label,tag);
    button.addEventListener('click',()=>{
      if(editorObjectSelect)editorObjectSelect.value=owner.id;
      pulseEditorSelection(node);
      selectEditorNode(owner,node);
    });
    row.append(expander,button);
    editorTreeList.appendChild(row);
    visibleCount++;
    if(!expanded)return;
    const childNodes=query?children.filter(child=>editorNodeHasSearchMatch(owner,child,query)):children;
    childNodes.forEach(child=>appendNode(owner,child,depth+1,false));
    materials.forEach((material,index)=>{
      if(!query||(material?.name||'').toLowerCase().includes(query))appendMaterialRow(owner,node,material,index,depth+1);
    });
  }

  groups.forEach(group=>{
    const items=group.items.filter(asset=>!query||
      editorNodeHasSearchMatch(asset,asset.root,query)||asset.name.toLowerCase().includes(query));
    if(!items.length)return;
    const heading=document.createElement('div');
    heading.className='tree-group-title';
    heading.textContent=group.label+' · '+items.length;
    editorTreeList.appendChild(heading);
    items.forEach(asset=>appendNode(asset,asset.root,0,true));
  });
  if(!visibleCount){
    const empty=document.createElement('div');
    empty.className='tree-empty';
    empty.textContent=query?'Ничего не найдено':'Рельеф загружается…';
    editorTreeList.appendChild(empty);
  }
}
function expandEditorTree(expand){
  const assets=getAllEditorAssets();
  if(!expand)editorTreeExpanded.clear();
  else assets.forEach(asset=>asset.root.traverse(node=>editorTreeExpanded.add(editorNodeKey(asset,node))));
  renderEditorTree(assets);
}


function refreshEditorAssetList(selectId=null){
  const assets=getAllEditorAssets();
  const assetCount=document.getElementById('editorAssetCount');
  if(assetCount)assetCount.textContent=assets.length+' ROOTS';
  const previousId=selectId||editorSelectedAsset?.id||'';
  const previousNode=editorSelectedNode;
  editorObjectSelect.innerHTML='';
  if(!assets.length){
    const option=document.createElement('option');option.value='';option.textContent='Сцена ещё загружается…';
    editorObjectSelect.appendChild(option);
    editorSelectedAsset=null;editorSelectedNode=null;editorSelectedMaterialKey='';
    renderEditorTree([], '');
    const nameLabel=document.getElementById('editorSelectedName');
    if(nameLabel)nameLabel.textContent='Нет выбранного объекта';
    clearEditorSelectionHelper();refreshEditorMaterialList();refreshEditorMaterialLibrary();return;
  }
  assets.forEach(asset=>{
    const option=document.createElement('option');option.value=asset.id;option.textContent=asset.name;
    editorObjectSelect.appendChild(option);
  });
  const chosen=assets.find(asset=>asset.id===previousId)||assets[0];
  const nodeToKeep=chosen.id===editorSelectedAsset?.id&&previousNode&&editorNodeIsInside(chosen.root,previousNode)?previousNode:chosen.root;
  editorObjectSelect.value=chosen.id;
  selectEditorNode(chosen,nodeToKeep);
  refreshEditorMaterialLibrary();
}


function collectEditorMaterials(asset,root=asset?.root){
  const byMaterial=new Map();
  if(!asset||!root)return [];
  root.traverse(object=>{
    if(!object.isMesh||!object.material)return;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    materials.forEach((material,index)=>{
      if(!material)return;
      const id=material.uuid||material;
      let target=byMaterial.get(id);
      if(!target){
        target={owner:asset,mesh:object,material,index,bindings:[],meshes:new Set()};
        byMaterial.set(id,target);
      }
      target.bindings.push({owner:asset,mesh:object,material,index});
      target.meshes.add(object);
    });
  });
  return [...byMaterial.values()].map(target=>{
    const materialName=target.material.name||'Material';
    const meshCount=target.meshes.size;
    const slotCount=target.bindings.length;
    target.meshCount=meshCount;
    target.slotCount=slotCount;
    target.label=materialName+(meshCount>1?' · '+meshCount+' meshes':(slotCount>1?' · '+slotCount+' slots':''));
    return target;
  });
}
function refreshEditorMaterialList(preferredIndex=0,preferredMaterial=null){
  // The Materials inspector is asset-wide: selecting a mesh must not create a per-mesh material list.
  editorMaterialTargets=collectEditorMaterials(editorSelectedAsset,editorSelectedAsset?.root);
  const materialCount=document.getElementById('editorMaterialCount');
  if(materialCount)materialCount.textContent=editorMaterialTargets.length+' MATERIALS';
  editorMaterialSelect.innerHTML='';
  if(!editorMaterialTargets.length){
    const option=document.createElement('option');
    option.value='';option.textContent='Нет PBR-материалов';
    editorMaterialSelect.appendChild(option);
    setMaterialControlsEnabled(false);
    updateEditorMaterialLinkStatus();
    updateEditorMaterialLibraryControls();
    return;
  }
  editorMaterialTargets.forEach((target,index)=>{
    const option=document.createElement('option');
    option.value=String(index);option.textContent=target.label;
    editorMaterialSelect.appendChild(option);
  });
  let safeIndex=Math.max(0,Math.min(preferredIndex,editorMaterialTargets.length-1));
  if(preferredMaterial){
    const matchingIndex=editorMaterialTargets.findIndex(target=>editorMaterialsEquivalent(target.material,preferredMaterial));
    if(matchingIndex>=0)safeIndex=matchingIndex;
  }
  editorMaterialSelect.value=String(safeIndex);
  loadEditorMaterial(safeIndex);
  updateEditorMaterialLinkStatus();
  updateEditorMaterialLibraryControls();
}
function updateEditorEmissiveControls(materialAvailable=true){
  const toggle=document.getElementById('editorEmissiveEnabled');
  if(toggle)toggle.disabled=!materialAvailable;
  const emissionEnabled=materialAvailable&&!!toggle?.checked;
  ['editorEmissiveColor','editorEmissive'].forEach(id=>{
    const control=document.getElementById(id);
    if(control)control.disabled=!emissionEnabled;
  });
}
function setMaterialControlsEnabled(enabled){
  const ids=['editorBaseColor','editorEmissiveColor','editorRoughness','editorMetalness','editorNormalScale',
    'editorAo','editorEmissive','editorEmissiveEnabled','editorTiling','editorOpacity','editorDoubleSide','editorWireframe',
    'editorPresetSelect','applyEditorPreset','editorTextureType','importEditorTexture','clearEditorTexture','exportSelectedGlb'];
  ids.forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=!enabled;});
  updateEditorEmissiveControls(enabled);
  document.querySelectorAll('[data-texture-import]').forEach(button=>{button.disabled=!enabled;});
  if(!enabled)document.querySelectorAll('[data-texture-remove]').forEach(button=>{button.disabled=true;});
}
function colorHex(color,fallback){
  return color&&color.isColor?'#'+color.getHexString():fallback;
}
function loadEditorMaterial(targetIndex){
  const target=editorMaterialTargets[Number(targetIndex)];
  if(!target){setMaterialControlsEnabled(false);return;}
  const material=target.material;
  setMaterialControlsEnabled(true);
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.value=String(value);};
  set('editorBaseColor',colorHex(material.color,'#ffffff'));
  set('editorEmissiveColor',colorHex(material.emissive,'#000000'));
  set('editorRoughness',material.roughness??0.85);
  set('editorMetalness',material.metalness??0);
  set('editorNormalScale',material.normalScale?.x??1);
  set('editorAo',material.aoMapIntensity??1);
  const savedEmissiveStrength=material.userData?.gradeOptimizerEmissiveStrength;
  const emissiveStrength=Number.isFinite(savedEmissiveStrength)
    ? savedEmissiveStrength
    : ((material.emissiveIntensity??0)>0?(material.emissiveIntensity??0):1);
  set('editorEmissive',emissiveStrength);
  const savedEmissiveEnabled=material.userData?.gradeOptimizerEmissiveEnabled;
  document.getElementById('editorEmissiveEnabled').checked=typeof savedEmissiveEnabled==='boolean'
    ? savedEmissiveEnabled
    : (material.emissiveIntensity??0)>0.0001;
  updateEditorEmissiveControls(true);
  const maps=[material.map,material.normalMap,material.roughnessMap,material.metalnessMap,material.aoMap,material.emissiveMap,material.bumpMap,material.displacementMap].filter(Boolean);
  set('editorTiling',maps[0]?.repeat?.x??1);
  set('editorOpacity',material.opacity??1);
  document.getElementById('editorDoubleSide').checked=material.side===THREE.DoubleSide;
  document.getElementById('editorWireframe').checked=!!material.wireframe;
  updateEditorMaterialReadouts();
  refreshEditorTexturePreviews(material);
  updateMaterialLibraryWindowControls();
}
function updateEditorMaterialReadouts(){
  const pairs=[
    ['editorRoughness','editorRoughnessValue',2],
    ['editorMetalness','editorMetalnessValue',2],
    ['editorNormalScale','editorNormalScaleValue',2],
    ['editorAo','editorAoValue',2],
    ['editorEmissive','editorEmissiveValue',2],
    ['editorTiling','editorTilingValue',2],
    ['editorOpacity','editorOpacityValue',2]
  ];
  pairs.forEach(([input,output,precision])=>{
    document.getElementById(output).textContent=Number(document.getElementById(input).value).toFixed(precision);
  });
}
function selectedEditorMaterial(){
  const index=Number(editorMaterialSelect.value);
  return editorMaterialTargets[index]||null;
}
function applyEditorMaterial(){
  const target=selectedEditorMaterial();
  if(!target)return;
  const material=target.material;
  const numeric=id=>Number(document.getElementById(id).value);
  if(material.color)material.color.set(document.getElementById('editorBaseColor').value);
  if(material.emissive)material.emissive.set(document.getElementById('editorEmissiveColor').value);
  if('roughness' in material)material.roughness=numeric('editorRoughness');
  if('metalness' in material)material.metalness=numeric('editorMetalness');
  if(material.normalScale)material.normalScale.set(numeric('editorNormalScale'),numeric('editorNormalScale'));
  if('aoMapIntensity' in material)material.aoMapIntensity=numeric('editorAo');
  const emissiveEnabled=document.getElementById('editorEmissiveEnabled').checked;
  const emissiveStrength=Math.max(0,numeric('editorEmissive'));
  material.userData={...(material.userData||{}),
    gradeOptimizerEmissiveEnabled:emissiveEnabled,
    gradeOptimizerEmissiveStrength:emissiveStrength
  };
  if('emissiveIntensity' in material)material.emissiveIntensity=emissiveEnabled?emissiveStrength:0;
  updateEditorEmissiveControls(true);
  const tile=numeric('editorTiling');
  const maps=[material.map,material.normalMap,material.roughnessMap,material.metalnessMap,material.aoMap,material.emissiveMap,material.bumpMap,material.displacementMap].filter(Boolean);
  maps.forEach(map=>{
    map.wrapS=THREE.RepeatWrapping;map.wrapT=THREE.RepeatWrapping;
    map.repeat.set(tile,tile);map.needsUpdate=true;
  });
  material.opacity=numeric('editorOpacity');
  material.transparent=material.opacity<0.999;
  material.depthWrite=material.opacity>=0.999;
  material.side=document.getElementById('editorDoubleSide').checked?THREE.DoubleSide:THREE.FrontSide;
  material.wireframe=document.getElementById('editorWireframe').checked;
  material.needsUpdate=true;
  renderMaterialLibraryWindow();
  markEditorMaterialOwnersDirty(material);
  markClientProjectDirty('параметры и назначения материалов');
  updateEditorMaterialReadouts();
}
function editorObjectPath(owner,node){
  const names=[];let current=node;
  while(current){names.unshift(editorNodeLabel(current));if(current===owner.root)break;current=current.parent;}
  return names.join(' / ');
}
function populateEditorAssetControls(asset,node=asset?.root){
  const root=node;if(!root||!asset)return;
  const isRoot=root===asset.root,meta=asset.meta||{};
  document.getElementById('editorPosX').value=root.position.x.toFixed(3);
  document.getElementById('editorPosY').value=root.position.y.toFixed(3);
  document.getElementById('editorPosZ').value=root.position.z.toFixed(3);
  document.getElementById('editorRotX').value=THREE.MathUtils.radToDeg(root.rotation.x).toFixed(1);
  document.getElementById('editorRotY').value=THREE.MathUtils.radToDeg(root.rotation.y).toFixed(1);
  document.getElementById('editorRotZ').value=THREE.MathUtils.radToDeg(root.rotation.z).toFixed(1);
  document.getElementById('editorScaleX').value=root.scale.x.toFixed(3);
  document.getElementById('editorScaleY').value=root.scale.y.toFixed(3);
  document.getElementById('editorScaleZ').value=root.scale.z.toFixed(3);
  document.getElementById('editorCategory').value=meta.category||'model';
  document.getElementById('editorPhase').value=meta.phase||'always';
  document.getElementById('editorVisible').checked=root.visible;
  document.getElementById('editorCollision').checked=!!meta.collision;
  document.getElementById('editorForestBlocker').checked=!!meta.forestBlocker;
  const nodeMetadata=root.userData?.gradeOptimizerMetadata||{};
  document.getElementById('editorNodeRole').value=String(nodeMetadata.role||'');
  document.getElementById('editorNodeTags').value=Array.isArray(nodeMetadata.tags)?nodeMetadata.tags.join(', '):String(nodeMetadata.tags||'');
  document.getElementById('editorNodeCollision').checked=!!nodeMetadata.collision;
  document.getElementById('editorNodeForestBlocker').checked=!!nodeMetadata.forestBlocker;
  ['editorCategory','editorPhase','editorCollision','editorForestBlocker','activateSelectedTerrain'].forEach(id=>{
    const control=document.getElementById(id);if(control)control.disabled=!isRoot||asset.sourceType==='scene';
  });
  ['editorNodeRole','editorNodeTags','editorNodeCollision','editorNodeForestBlocker'].forEach(id=>{
    const control=document.getElementById(id);if(control)control.disabled=false;
  });
  const selectedName=document.getElementById('editorSelectedName');
  if(selectedName)selectedName.textContent=asset.name+(isRoot?'':' / '+editorObjectPath(asset,root));
  const removeButton=document.getElementById('removeImportedAsset');
  removeButton.disabled=asset.sourceType==='scene';
  removeButton.textContent=asset.sourceType==='scene'
    ?'УДАЛЕНИЕ НЕДОСТУПНО'
    :(isRoot?'УДАЛИТЬ ВЫБРАННУЮ МОДЕЛЬ':'УДАЛИТЬ ВЫБРАННЫЙ КОМПОНЕНТ');
  removeButton.title=asset.sourceType==='scene'
    ?'Встроенные компоненты нельзя удалять без изменения исходной модели. Используй Visibility, чтобы скрыть компонент.'
    :'Удалить выбранную модель или компонент.';
  const terrainButton=document.getElementById('activateSelectedTerrain');
  terrainButton.disabled=asset.sourceType==='scene'||!isRoot||asset.id===state.activeTerrainAssetId;
  terrainButton.textContent=asset.id===state.activeTerrainAssetId?'АКТИВЕН КАК РЕЛЬЕФ':'СДЕЛАТЬ ОСНОВНЫМ РЕЛЬЕФОМ';
  document.getElementById('focusSelectedAsset').disabled=false;
}
function selectEditorNode(owner,node,materialIndex=-1,preferredMaterial=null){
  if(!owner||!node)return;
  editorSelectedAsset=owner;editorSelectedNode=node;
  editorSelectedMaterialKey=materialIndex>=0?editorMaterialKey(owner,node,materialIndex):'';
  let ancestor=node.parent;
  while(ancestor){editorTreeExpanded.add(editorNodeKey(owner,ancestor));if(ancestor===owner.root)break;ancestor=ancestor.parent;}
  populateEditorAssetControls(owner,node);
  refreshEditorMaterialList(Math.max(0,materialIndex),preferredMaterial);
  if(preferredMaterial){
    const selectedTarget=editorMaterialTargets[Number(editorMaterialSelect.value)];
    if(selectedTarget)editorSelectedMaterialKey=editorMaterialKey(owner,selectedTarget.mesh,selectedTarget.index);
  }
  updateEditorSelectionHelper({root:node});
  renderEditorTree(getAllEditorAssets(),editorSelectionKey());
  if(appRoot.classList.contains('editor-open')){
    const label=owner.name+(node===owner.root?'':' / '+editorObjectPath(owner,node));
    setEditorStatus((owner.sourceType==='scene'?'Выбран компонент основной сцены: ':'Выбран компонент модели: ')+label+'. Material slots доступны ниже.');
  }
}
function selectEditorAsset(id){
  const owner=getAllEditorAssets().find(asset=>asset.id===id)||null;
  if(!owner){editorSelectedAsset=null;editorSelectedNode=null;editorSelectedMaterialKey='';clearEditorSelectionHelper();refreshEditorMaterialList();return;}
  selectEditorNode(owner,owner.root);
}
function saveSelectedNodeMetadata(){
  const owner=editorSelectedAsset,node=editorSelectedNode;
  if(!owner||!node)return;
  const role=String(document.getElementById('editorNodeRole').value||'').trim();
  const tags=String(document.getElementById('editorNodeTags').value||'')
    .split(',').map(tag=>tag.trim()).filter(Boolean).slice(0,32);
  const metadata={
    role,tags,
    collision:document.getElementById('editorNodeCollision').checked,
    forestBlocker:document.getElementById('editorNodeForestBlocker').checked
  };
  if(!role&&!tags.length&&!metadata.collision&&!metadata.forestBlocker){
    if(node.userData)delete node.userData.gradeOptimizerMetadata;
  }else{
    node.userData=node.userData||{};
    node.userData.gradeOptimizerMetadata=metadata;
  }
  if(owner.sourceType==='imported'){
    owner.meta.modelDirty=true;
    persistImportedEditorAsset(owner).catch(error=>console.warn('Не удалось сохранить метаданные узла:',error));
  }
  renderEditorTree(getAllEditorAssets(),editorSelectionKey());
  if(currentClientSlug){
    markClientProjectDirty('метки и флаги узла');
    setEditorStatus('Настройки узла изменены: '+editorObjectPath(owner,node)+'. Изменения будут сохранены автоматически.');
  }else{
    setEditorStatus('Метаданные изменены для узла: '+editorObjectPath(owner,node)+'.');
  }
}


function applyEditorTransform(){
  const asset=editorSelectedAsset,root=editorSelectedNode;
  if(!root)return;
  const number=(id,fallback=0)=>{const value=Number(document.getElementById(id).value);return Number.isFinite(value)?value:fallback;};
  root.position.set(number('editorPosX'),number('editorPosY'),number('editorPosZ'));
  root.rotation.set(
    THREE.MathUtils.degToRad(number('editorRotX')),
    THREE.MathUtils.degToRad(number('editorRotY')),
    THREE.MathUtils.degToRad(number('editorRotZ'))
  );
  root.scale.set(
    Math.max(0.001,number('editorScaleX',1)),
    Math.max(0.001,number('editorScaleY',1)),
    Math.max(0.001,number('editorScaleZ',1))
  );
  if(asset&&root===asset.root)syncActiveTerrainTransform(asset,false);
  if(asset&&asset.sourceType==='imported')asset.meta.modelDirty=true;
  markClientProjectDirty('трансформации и масштаб объектов');
}
async function importGlbFiles(files){
  const valid=Array.from(files||[]);
  if(!valid.length)return;
  const categoryInput=document.getElementById('importAssetCategory');
  const category=categoryInput?.value||'model';
  for(const file of valid){
    const extension=file.name.split('.').pop().toLowerCase();
    if(!['glb','fbx'].includes(extension)){
      setEditorStatus('Поддерживаются бинарные GLB и FBX. Для FBX включи Embed Media при экспорте из Maya.',true);
      continue;
    }
    setEditorStatus('Импорт модели: '+file.name+' …');
    try{
      const buffer=await file.arrayBuffer();
      const gltf=await parseSceneModel(buffer,file.name);
      const root=gltf.scene||gltf.scenes?.[0];
      if(!root)throw new Error('В GLB не найдена сцена.');
      captureEditorNodeVisibilityDefaults(root);
      let meshCount=0;
      root.traverse(object=>{
        if(object.isMesh){
          meshCount++;
          object.castShadow=true;
          object.receiveShadow=true;
        }
      });
      if(!meshCount)throw new Error('GLB не содержит полигональной геометрии.');
      const baseId=slugAssetName(file.name);
      const id=baseId+'_'+Date.now().toString(36)+'_'+(state.importedAssets.length+1);
      root.name=file.name.replace(/\.(glb|fbx)$/i,'');
      root.userData.resortAssetId=id;
      const meta={
        id,name:root.name,category,phase:'stage_1',visible:true,
        collision:category==='terrain',
        forestBlocker:['terrain','slope','infrastructure','building','lift'].includes(category),
        activeTerrain:false,modelDirty:true,sourceFile:file.name
      };
      root.userData.resortAsset={...meta};
      const asset={
        id,name:root.name,root,meta,sourceType:'imported',sourceBuffer:buffer.slice(0),
        sourcePath:currentClientSlug?'models/'+id+'.'+extension:null
      };
      scene.add(root);
      state.importedAssets.push(asset);
      markClientProjectDirty('импорт новой модели');
      if(category==='slope'){applyImportedSlopeDepthBias(root,-1,-1);forestPlacementCache=null;buildTestForest();}
      if(category==='terrain')activateImportedTerrain(asset,{rebuildForest:true,refreshList:false,persist:!currentClientSlug});
      refreshEditorAssetList(id);
      focusSceneObject(root);
      let persistenceNote='Черновик проекта. Автосохранение в этом браузере включено.';
      if(!currentClientSlug){
        try{await saveSceneAssetLocally(asset);persistenceNote='Сохранено в этом браузере.';}
        catch(storageError){console.warn('Модель загружена, но локальное сохранение не удалось:',storageError);persistenceNote='Не удалось сохранить после перезагрузки.';}
      }else{
        scheduleProjectBrowserAutosave();
      }
      setEditorStatus(
        'Импортировано: '+file.name+' · '+meshCount+' mesh · '+editorMaterialTargets.length+
        ' unique material(s) across the FBX. '+persistenceNote
      );
    }catch(error){
      console.error(error);
      setEditorStatus('Не удалось импортировать '+file.name+': '+(error?.message||String(error)),true);
    }
  }
  glbFileInput.value='';
}

function normalizeClientId(value){
  const slug=String(value||'').trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug)?slug:'';
}
function setClientWorkspaceStatus(message,isError=false){
  const el=document.getElementById('clientWorkspaceStatus');
  if(el){el.textContent=message;el.classList.toggle('error',isError);}
}
function scheduleProjectBrowserAutosave(){
  if(!currentClientSlug||!clientWorkspaceReady)return;
  projectAutosavePending=true;
  if(projectAutosaveTimer)clearTimeout(projectAutosaveTimer);
  projectAutosaveTimer=setTimeout(()=>{
    projectAutosaveTimer=null;
    autosaveProjectToBrowser().catch(error=>{
      console.error('Browser project autosave failed:',error);
      setClientWorkspaceStatus('Ошибка автосохранения в браузер: '+(error?.message||String(error))+'. Проверь подключение локальной папки и дождись статуса автосохранения.',true);
    });
  },1200);
}
function markClientProjectDirty(reason='изменения Scene Editor'){
  if(!currentClientSlug||!clientWorkspaceReady)return;
  clientProjectDirty=true;
  projectChangeRevision++;
  setClientWorkspaceStatus('Изменения проекта '+currentClientSlug+'. Автосохранение в этом браузере…');
  scheduleProjectBrowserAutosave();
}
window.addEventListener('beforeunload',event=>{
  if(clientWorkspaceReady&&(projectAutosavePending||projectAutosaveTimer||projectAutosavePromise)){
    event.preventDefault();
    event.returnValue='';
  }
});
function clearImportedClientAssets(){
  if(state.activeTerrainAssetId)resetImportedTerrain({rebuildForest:false,persist:false});
  state.importedAssets.forEach(asset=>{scene.remove(asset.root);disposeObjectTree(asset.root);});
  state.importedAssets=[];
  state.activeTerrainAssetId=null;
  state.terrain=state.baseTerrain;
  state.terrainMats=state.baseTerrainMats.slice();
  if(state.baseTerrain)state.baseTerrain.visible=true;
  droneController.setTerrain(state.terrain);
  clearTestForest();
}
function applyClientAssetTransform(root,transform){
  if(Array.isArray(transform?.position)&&transform.position.length===3)root.position.fromArray(transform.position);
  if(Array.isArray(transform?.rotation)&&transform.rotation.length===3)root.rotation.set(transform.rotation[0],transform.rotation[1],transform.rotation[2]);
  if(Array.isArray(transform?.scale)&&transform.scale.length===3)root.scale.fromArray(transform.scale);
}
function captureEditorNodeVisibilityDefaults(root){
  root?.traverse(node=>{
    if(!editorOriginalVisibility.has(node))editorOriginalVisibility.set(node,!!node.visible);
  });
}
function collectEditorNodeVisibility(root){
  const states=[];
  if(!root)return states;
  captureEditorNodeVisibilityDefaults(root);
  function visit(node,path){
    const defaultVisible=editorOriginalVisibility.has(node)?editorOriginalVisibility.get(node):true;
    if(node.visible!==defaultVisible){
      states.push({path:path.slice(),name:node.name||'',visible:!!node.visible});
    }
    (node.children||[]).forEach((child,index)=>visit(child,path.concat(index)));
  }
  (root.children||[]).forEach((child,index)=>visit(child,[index]));
  return states;
}
function applyEditorNodeVisibility(root,states){
  if(!root)return;
  captureEditorNodeVisibilityDefaults(root);
  root.traverse(node=>{
    if(node===root)return;
    node.visible=editorOriginalVisibility.get(node)!==false;
  });
  (states||[]).forEach(state=>{
    if(!Array.isArray(state.path)||!state.path.length||typeof state.visible!=='boolean')return;
    let node=root;
    for(const index of state.path){
      if(!node?.children||!node.children[index]){node=null;break;}
      node=node.children[index];
    }
    if(node)node.visible=state.visible;
  });
}
function collectEditorNodeMetadata(root){
  const records=[];
  function visit(node,path){
    const metadata=node.userData?.gradeOptimizerMetadata||{};
    const role=String(metadata.role||'').trim();
    const tags=Array.isArray(metadata.tags)
      ?metadata.tags.map(tag=>String(tag).trim()).filter(Boolean)
      :String(metadata.tags||'').split(',').map(tag=>tag.trim()).filter(Boolean);
    const collision=!!metadata.collision;
    const forestBlocker=!!metadata.forestBlocker;
    if(role||tags.length||collision||forestBlocker){
      records.push({
        path:path.slice(),name:node.name||'',type:node.type||'Object3D',
        role,tags,collision,forestBlocker
      });
    }
    (node.children||[]).forEach((child,index)=>visit(child,path.concat(index)));
  }
  if(root)visit(root,[]);
  return records;
}
function findEditorNodeByNamePath(root,namePath){
  if(!root||!Array.isArray(namePath)||!namePath.length)return null;
  const names=namePath.map(name=>String(name));
  if(root.name===names[0])names.shift();
  let candidates=[root];
  for(const name of names){
    candidates=candidates.flatMap(parent=>(parent.children||[]).filter(child=>child.name===name));
    if(!candidates.length)return null;
  }
  return candidates.length===1?candidates[0]:null;
}
function applyEditorNodeMetadata(root,records){
  (records||[]).forEach(record=>{
    let node=null;
    if(Array.isArray(record.path)){
      node=root;
      for(const index of record.path){
        if(!node?.children||!node.children[index]){node=null;break;}
        node=node.children[index];
      }
    }else if(Array.isArray(record.namePath)){
      node=findEditorNodeByNamePath(root,record.namePath);
    }
    if(!node)return;
    node.userData=node.userData||{};
    node.userData.gradeOptimizerMetadata={
      role:String(record.role||''),
      tags:Array.isArray(record.tags)?record.tags.map(tag=>String(tag).trim()).filter(Boolean):[],
      collision:!!record.collision,
      forestBlocker:!!record.forestBlocker
    };
  });
}
function disposeEditorComponent(root){
  const liveMaterials=new Set(),liveTextures=new Set(),liveGeometries=new Set();
  const collectLive=sceneRoot=>sceneRoot?.traverse(object=>{
    if(object.geometry)liveGeometries.add(object.geometry);
    const list=Array.isArray(object.material)?object.material:(object.material?[object.material]:[]);
    list.forEach(material=>{
      if(!material)return;
      liveMaterials.add(material);
      Object.values(material).forEach(value=>{if(value?.isTexture)liveTextures.add(value);});
    });
  });
  collectLive(state.root);
  state.importedAssets.forEach(asset=>collectLive(asset.root));
  const removedMaterials=new Set(),removedTextures=new Set(),removedGeometries=new Set();
  root?.traverse(object=>{
    if(object.geometry&&!liveGeometries.has(object.geometry))removedGeometries.add(object.geometry);
    const list=Array.isArray(object.material)?object.material:(object.material?[object.material]:[]);
    list.forEach(material=>{
      if(!material||liveMaterials.has(material)||removedMaterials.has(material))return;
      removedMaterials.add(material);
      Object.values(material).forEach(value=>{if(value?.isTexture&&!liveTextures.has(value))removedTextures.add(value);});
    });
  });
  removedTextures.forEach(texture=>texture.dispose());
  removedMaterials.forEach(material=>material.dispose());
  removedGeometries.forEach(geometry=>geometry.dispose());
}
const PROJECT_BACKUP_KEY_PREFIX='project-backup:';
const PROJECT_BACKUP_MODEL_PREFIX='project-backup-model:';
function projectBackupKey(slug){return PROJECT_BACKUP_KEY_PREFIX+slug;}
function projectBackupModelKey(slug,id){return PROJECT_BACKUP_MODEL_PREFIX+slug+':'+id;}
async function readProjectBrowserBackup(slug){
  const db=await openLocalAssetDatabase();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction('models','readonly');
      const store=tx.objectStore('models');
      const request=store.get(projectBackupKey(slug));
      let backup=null;
      request.onsuccess=()=>{
        const record=request.result;
        if(!record?.manifest)return;
        backup={...record,assetBuffers:new Map(),complete:true};
        const assets=Array.isArray(record.manifest.assets)?record.manifest.assets:[];
        for(const item of assets){
          const modelRequest=store.get(projectBackupModelKey(slug,item.id));
          modelRequest.onsuccess=()=>{
            if(modelRequest.result?.buffer)backup.assetBuffers.set(item.id,modelRequest.result);
            else backup.complete=false;
          };
          modelRequest.onerror=()=>{backup.complete=false;};
        }
      };
      request.onerror=()=>reject(request.error||new Error('Не удалось прочитать браузерный бэкап.'));
      tx.oncomplete=()=>resolve(backup);
      tx.onerror=()=>reject(tx.error||new Error('Ошибка чтения браузерного бэкапа.'));
      tx.onabort=()=>reject(tx.error||new Error('Чтение браузерного бэкапа отменено.'));
    });
  }finally{db.close();}
}
async function writeProjectBrowserBackup(slug,manifest,{unsynced=false,baseUpdatedAt=''}={}){
  const db=await openLocalAssetDatabase();
  const expectedKeys=new Set(state.importedAssets.map(asset=>projectBackupModelKey(slug,asset.id)));
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('models','readwrite');
      const store=tx.objectStore('models');
      store.put({
        schemaVersion:1,manifest,savedAt:new Date().toISOString(),
        unsynced:!!unsynced,baseUpdatedAt:String(baseUpdatedAt||'')
      },projectBackupKey(slug));
      state.importedAssets.forEach(asset=>{
        if(!asset.sourceBuffer)throw new Error('Нет бинарных данных модели '+asset.name+' для браузерного бэкапа.');
        store.put({
          buffer:asset.sourceBuffer.slice(0),name:asset.name,
          sourcePath:asset.sourcePath||null
        },projectBackupModelKey(slug,asset.id));
      });
      const cursorRequest=store.openCursor();
      cursorRequest.onsuccess=()=>{
        const cursor=cursorRequest.result;
        if(!cursor)return;
        const key=String(cursor.key);
        if(key.startsWith(PROJECT_BACKUP_MODEL_PREFIX+slug+':')&&!expectedKeys.has(key))cursor.delete();
        cursor.continue();
      };
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error('Не удалось сохранить браузерный бэкап проекта.'));
      tx.onabort=()=>reject(tx.error||new Error('Автосохранение проекта отменено.'));
    });
  }finally{db.close();}
  return {manifest,savedAt:new Date().toISOString(),unsynced:!!unsynced,baseUpdatedAt:String(baseUpdatedAt||'')};
}
async function autosaveProjectToBrowser({force=false,silent=false}={}){
  if(!currentClientSlug||!clientWorkspaceReady)return null;
  if(projectAutosaveTimer&&force){clearTimeout(projectAutosaveTimer);projectAutosaveTimer=null;}
  if(projectAutosavePromise){
    await projectAutosavePromise;
    if(projectAutosavePending)return autosaveProjectToBrowser({force:false,silent});
    return null;
  }
  const revisionAtStart=projectChangeRevision;
  const operation=(async()=>{
    for(const asset of state.importedAssets){
      if(asset.meta?.modelDirty){
        const buffer=await exportAssetForClientPublish(asset);
        asset.sourceBuffer=buffer;
        if(!asset.sourcePath||/\.fbx$/i.test(asset.sourcePath))asset.sourcePath='models/'+asset.id+'.glb';
        asset.meta.modelDirty=false;
      }
      if(!asset.sourcePath)asset.sourcePath='models/'+asset.id+'.glb';
    }
    const manifest=await collectClientManifest(currentClientSlug);
    if(!clientProjectDirty&&projectDeployedManifestUpdatedAt)manifest.updatedAt=projectDeployedManifestUpdatedAt;
    await writeProjectBrowserBackup(currentClientSlug,manifest,{unsynced:clientProjectDirty,baseUpdatedAt:projectBackupBaseUpdatedAt});
    projectLastBrowserBackupAt=new Date().toISOString();
    let folderWritten=false;projectFolderSyncError='';
    if(projectFolderHandle){
      try{folderWritten=await writeProjectSnapshotToFolder(currentClientSlug,manifest);}
      catch(folderError){
        projectFolderSyncError=folderError?.message||String(folderError);
        console.error('Local repository folder write failed:',folderError);
        projectFolderHandle=null;projectFolderPermissionState='prompt';
      }
    }
    if(revisionAtStart===projectChangeRevision)projectAutosavePending=false;
    else projectAutosavePending=true;
    if(!silent){
      if(folderWritten)setClientWorkspaceStatus('Автосохранено в браузере и папке '+(savedProjectFolderHandle?.name||'Grade_Optimizer')+' · clients/'+currentClientSlug+'/. GitHub Desktop увидит изменённые файлы.');
      else if(projectFolderSyncError)setClientWorkspaceStatus('Браузерный бэкап сохранён, но запись в локальную папку не удалась: '+projectFolderSyncError+'. Нажми CONNECT LOCAL PROJECT FOLDER для восстановления доступа.',true);
      else if(savedProjectFolderHandle)setClientWorkspaceStatus('Автосохранено в браузере. Папка '+(savedProjectFolderHandle.name||'репозитория')+' привязана, но Chrome просит повторное разрешение. Нажми CONNECT LOCAL PROJECT FOLDER.');
      else setClientWorkspaceStatus('Автосохранено в браузере. Подключи папку репозитория кнопкой CONNECT LOCAL PROJECT FOLDER, чтобы писать прямо в GitHub Desktop.');
    }
    return {manifest,savedAt:projectLastBrowserBackupAt,folderWritten};
  })();
  projectAutosavePromise=operation;
  try{return await operation;}
  catch(error){projectAutosavePending=true;throw error;}
  finally{
    projectAutosavePromise=null;
    if(projectAutosavePending&&!projectAutosaveTimer){
      projectAutosaveTimer=setTimeout(()=>{
        projectAutosaveTimer=null;
        autosaveProjectToBrowser().catch(error=>{
          console.error('Browser project autosave retry failed:',error);
          setClientWorkspaceStatus('Не удалось завершить автосохранение: '+(error?.message||String(error)),true);
        });
      },1200);
    }
  }
}
async function openClientWorkspace(value,{updateUrl=true}={}){
  const slug=normalizeClientId(value);
  if(!slug){setClientWorkspaceStatus('Project ID: латиница, цифры и дефис; 1–40 символов.',true);return false;}
  const previousSlug=currentClientSlug;
  if(clientWorkspaceReady&&clientProjectDirty){
    const confirmed=window.confirm('В проекте '+(previousSlug||'')+' есть изменения, сохранённые в браузере, но ещё не опубликованные на сайте. Перейти к другому проекту? Локальная копия останется в этом браузере.');
    if(!confirmed)return false;
  }
  if(clientWorkspaceReady&&previousSlug&&previousSlug!==slug){
    state.savedOverviewCameras={};
    clearImportedClientAssets();
    await loadSlope(state.slope);
    if(!state.root){
      setClientWorkspaceStatus('Не удалось перезагрузить базовую сцену перед открытием проекта '+slug+'.',true);
      return false;
    }
  }
  if(previousSlug!==slug){state.treeAreas=[];forestPlacementCache=null;renderTreeAreaOverlays();updateTreeAreaPanel();}
  if(previousSlug!==slug){state.treeAreas=[];forestPlacementCache=null;renderTreeAreaOverlays();}
  state.slopeCurvesData=null;
  renderSlopeAnalysisOverlays(null);
  currentClientSlug=slug;
  state.savedOverviewCameras={};
  clientWorkspaceReady=false;
  updateModeSwitcher();
  clientProjectDirty=false;
  projectAutosavePending=false;
  if(projectAutosaveTimer){clearTimeout(projectAutosaveTimer);projectAutosaveTimer=null;}
  const input=document.getElementById('clientWorkspaceId');
  if(input)input.value=slug;
  setClientWorkspaceStatus('Проверяю опубликованный проект и локальную браузерную копию '+slug+' …');
  try{
    await restoreProjectFolderHandle();
    let localBackup=null;
    if(!FORCE_REMOTE_PROJECT){
      try{localBackup=await readProjectBrowserBackup(slug);}
      catch(storageError){console.warn('Local browser backup could not be read:',storageError);}
    }
    const response=await fetch('./clients/'+slug+'/scene.json?t='+Date.now(),{cache:'no-store'});
    let remoteManifest=null;
    if(response.ok){
      remoteManifest=await response.json();
      if(remoteManifest.schemaVersion!=='1.0'||remoteManifest.clientId!==slug||!Array.isArray(remoteManifest.assets)){
        throw new Error('Неверный формат clients/'+slug+'/scene.json');
      }
    }else if(response.status!==404){
      throw new Error('HTTP '+response.status+' при загрузке scene.json');
    }
    const backupUsable=!!(localBackup?.complete&&localBackup.manifest&&
      localBackup.manifest.schemaVersion==='1.0'&&localBackup.manifest.clientId===slug&&
      Array.isArray(localBackup.manifest.assets));
    let useBrowserBackup=false;
    if(!remoteManifest&&backupUsable){
      useBrowserBackup=true;
    }else if(remoteManifest&&backupUsable&&localBackup.unsynced&&
      Date.parse(localBackup.manifest.updatedAt||'')>Date.parse(remoteManifest.updatedAt||'')){
      useBrowserBackup=true;
    }

    if(!remoteManifest&&!useBrowserBackup){
      clientWorkspaceReady=true;
      updateModeSwitcher();
      state.treeAreas=[];forestPlacementCache=null;renderTreeAreaOverlays();
      state.treeAreas=[];forestPlacementCache=null;renderTreeAreaOverlays();updateTreeAreaPanel();
      projectBackupBaseUpdatedAt='';
      projectDeployedManifestUpdatedAt='';
      if(updateUrl)window.history.replaceState({},'','?project='+encodeURIComponent(slug));
      refreshEditorAssetList();
      updateTerrainResetControl();
      if(state.terrain)buildTestForest();
      const localDraftCount=state.importedAssets.length;
      clientProjectDirty=localDraftCount>0;
      if(localDraftCount)state.importedAssets.forEach(asset=>{asset.meta.modelDirty=true;});
      setClientWorkspaceStatus(localDraftCount
        ? 'В GitHub пока нет опубликованной сцены '+slug+'. Найдено '+localDraftCount+' старых локальных моделей; включено автосохранение в браузер. Когда закончишь, подключи локальную папку репозитория.'
        : 'Проект '+slug+' пока не опубликован. Изменения будут автоматически сохраняться в этом браузере. Когда закончишь, подключи локальную папку репозитория.');
      try{await autosaveProjectToBrowser({force:true,silent:true});}
      catch(storageError){setClientWorkspaceStatus('Проект открыт, но браузерный бэкап не удалось создать: '+(storageError?.message||String(storageError)),true);}
      return true;
    }

    const manifest=useBrowserBackup?localBackup.manifest:remoteManifest;
    const backupBuffers=useBrowserBackup?localBackup.assetBuffers:null;
    await buildSlopeAnalysisFromManifest(manifest);
    state.treeAreas=normalizeTreeAreas(manifest.treeAreas);
    state.skierSpawns=normalizeSkierSpawnMap(manifest.skierSpawns);
    renderSkierSpawnOverlays();
    updateSkierSpawnPanel();
    forestPlacementCache=null;
    renderTreeAreaOverlays();
    updateTreeAreaPanel();
    state.treeAreas=normalizeTreeAreas(manifest.treeAreas);
    forestPlacementCache=null;
    renderTreeAreaOverlays();
    clearImportedClientAssets();
    let activeTerrain=null,loaded=0,totalMeshCount=0,totalVisibleMeshCount=0,totalVertexCount=0;
    for(const item of manifest.assets){
      if(typeof item.file!=='string'||!/^models\/[A-Za-z0-9_.-]+\.(glb|fbx)$/i.test(item.file)){
        console.warn('Пропущен файл модели с некорректным путём:',item.file);continue;
      }
      let buffer;
      if(useBrowserBackup){
        const stored=backupBuffers.get(item.id);
        if(!stored?.buffer)throw new Error('В локальном бэкапе отсутствует бинарный файл модели '+item.name+'.');
        buffer=stored.buffer.slice(0);
      }else{
        const modelResponse=await fetch('./clients/'+slug+'/'+item.file+'?t='+Date.now(),{cache:'no-store'});
        if(!modelResponse.ok)throw new Error('Не удалось загрузить модель '+item.name+' ('+modelResponse.status+').');
        buffer=await modelResponse.arrayBuffer();
      }
      const gltf=await parseSceneModel(buffer,item.file,'./clients/'+slug+'/models/');
      const root=gltf.scene||gltf.scenes?.[0];
      if(!root)throw new Error('Модель без сцены: '+item.name);
      if(/\.fbx$/i.test(item.file))restoreCadBridgeWorkingCoordinates(root,item.mayaExport,item.name||item.id);
      captureEditorNodeVisibilityDefaults(root);
      root.name=item.name||root.name||'Project model';
      applyClientAssetTransform(root,item.transform||{});
      applyEditorNodeVisibility(root,item.nodeVisibility||[]);
      applyEditorNodeMetadata(root,item.nodeMetadata||[]);
      const meta={
        id:item.id,name:root.name,category:item.category||'prop',phase:item.phase||'always',
        visible:item.visible!==false,collision:!!item.collision,forestBlocker:!!item.forestBlocker,
        activeTerrain:!!item.activeTerrain,modelDirty:false,sourceFile:item.sourceFile||item.file,
        mayaExport:item.mayaExport||null
      };
      root.visible=meta.visible;

      // Validate the parsed FBX itself, not merely the manifest entry / HTTP response.
      // This catches empty files and meshes whose Maya visibility flags hide every surface.
      let meshCount=0,vertexCount=0,visibleMeshCount=0;
      root.traverse(object=>{
        if(!object.isMesh||!object.geometry?.attributes?.position)return;
        const positions=object.geometry.attributes.position;
        if(positions.count<3)return;
        meshCount++;
        vertexCount+=positions.count;
        let node=object,visible=true;
        while(node){
          if(node.visible===false)visible=false;
          if(node===root)break;
          node=node.parent;
        }
        if(visible)visibleMeshCount++;
      });
      root.updateWorldMatrix(true,true);
      const geometryBounds=new THREE.Box3().setFromObject(root);
      if(!meshCount||!vertexCount||geometryBounds.isEmpty()){
        throw new Error('FBX '+item.name+' загружен, но не содержит пригодной 3D-геометрии.');
      }
      if(!visibleMeshCount){
        throw new Error('FBX '+item.name+' содержит '+meshCount+' mesh, но все они скрыты флагами visibility из Maya / scene.json.');
      }
      const geometrySize=geometryBounds.getSize(new THREE.Vector3());
      const geometryCenter=geometryBounds.getCenter(new THREE.Vector3());
      totalMeshCount+=meshCount;
      totalVisibleMeshCount+=visibleMeshCount;
      totalVertexCount+=vertexCount;
      console.info('[Grade Optimizer] Imported asset geometry:',{
        id:item.id,file:item.file,meshCount,vertexCount,visibleMeshCount,
        bounds:{min:geometryBounds.min.toArray(),max:geometryBounds.max.toArray()},
        size:geometrySize.toArray(),center:geometryCenter.toArray(),
        normalization:{
          hierarchy:root.userData.gradeOptimizerFbxNormalization||null,
          cadBridge:root.userData.gradeOptimizerCadBridgeRestoration||null
        }
      });

      root.userData.resortAssetId=item.id;
      root.userData.resortAsset={...meta};
      root.traverse(object=>{if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}});
      const asset={id:item.id,name:root.name,root,meta,sourceType:'imported',sourceBuffer:buffer.slice(0),sourcePath:item.file};
      scene.add(root);
      state.importedAssets.push(asset);
      if(meta.category==='slope')applyImportedSlopeDepthBias(root,-1,-1);
      if(meta.category==='terrain'&&meta.activeTerrain)activeTerrain=asset;
      loaded++;
    }
    if(activeTerrain)activateImportedTerrain(activeTerrain,{rebuildForest:false,refreshList:false,persist:false});
    else{
      state.terrain=state.baseTerrain;
      state.terrainMats=state.baseTerrainMats.slice();
      if(state.baseTerrain)state.baseTerrain.visible=true;
      droneController.setTerrain(state.terrain);
    }
    if(manifest.editorSettings&&(
      (Array.isArray(manifest.editorSettings.assets)&&manifest.editorSettings.assets.length)||
      manifest.editorSettings.visualSettings||manifest.editorSettings.weatherSettings
    )){
      await applySceneEditorConfig(manifest.editorSettings,{quiet:true});
    }
    clearTestForest();
    renderTreeAreaOverlays();
    if(state.baseTerrain)buildTestForest();
    refreshEditorAssetList();
    updateTerrainResetControl();
    clientWorkspaceReady=true;
    state.savedOverviewCameras=normalizeOverviewCameraMap(manifest.overviewCameras);
    if(updateUrl)window.history.replaceState({},'','?project='+encodeURIComponent(slug));
    const focus=activeTerrain?.root||state.importedAssets[0]?.root||state.root;
    // Restore the saved overview first; a forced remote verification must then
    // frame the freshly published model instead of leaving the camera on an old pose.
    const restoredSavedCamera=restoreSavedOverviewCameraForCurrentSlope();
    if(focus&&(!restoredSavedCamera||FORCE_REMOTE_PROJECT))focusSceneObject(focus);
    updateModeSwitcher();
    projectBackupBaseUpdatedAt=String(useBrowserBackup?localBackup.baseUpdatedAt||'':remoteManifest.updatedAt||'');
    projectDeployedManifestUpdatedAt=String(remoteManifest?.updatedAt||'');
    clientProjectDirty=useBrowserBackup?!!localBackup.unsynced:false;
    if(!FORCE_REMOTE_PROJECT){
      try{await autosaveProjectToBrowser({force:true,silent:true});}
      catch(storageError){setClientWorkspaceStatus('Проект открыт, но браузерный бэкап не удался: '+(storageError?.message||String(storageError)),true);}
    }
    if(FORCE_REMOTE_PROJECT){
      setClientWorkspaceStatus('Загружена опубликованная версия GitHub ('+loaded+' моделей; '+totalVisibleMeshCount+'/'+totalMeshCount+' видимых mesh; '+totalVertexCount.toLocaleString('ru-RU')+' вершин). Камера наведена на модель. Локальный черновик браузера оставлен без изменений.');
    }else if(useBrowserBackup&&clientProjectDirty){
      setClientWorkspaceStatus('Восстановлен более свежий черновик из браузера ('+loaded+' моделей). Автосохранение включено.');
    }else{
      const folderNote=projectFolderHandle
        ? ' Папка '+(savedProjectFolderHandle?.name||'Grade_Optimizer')+' подключена; изменения также записываются прямо в неё.'
        : savedProjectFolderHandle
          ? ' Папка '+(savedProjectFolderHandle.name||'репозитория')+' сохранена; Chrome просит повторно разрешить запись кнопкой CONNECT LOCAL PROJECT FOLDER.'
          : ' Для прямой записи в GitHub Desktop подключи корень репозитория кнопкой CONNECT LOCAL PROJECT FOLDER.';
      setClientWorkspaceStatus('Проект '+slug+' готов ('+loaded+' моделей). Автосохранение в браузере включено.'+folderNote);
    }
    return true;
  }catch(error){
    console.error(error);
    clientWorkspaceReady=false;
    setClientWorkspaceStatus('Ошибка загрузки проекта '+slug+': '+(error?.message||String(error)),true);
    return false;
  }
}
async function editorTextureToDataUrl(texture){
  if(!texture?.userData?.editorOwnedTexture)return null;
  if(texture.userData.editorTextureDataUrl)return texture.userData.editorTextureDataUrl;
  if(texture.userData.editorTextureDataUrlPromise){
    const pending=texture.userData.editorTextureDataUrlPromise;
    const value=await pending;
    delete texture.userData.editorTextureDataUrlPromise;
    if(value){texture.userData.editorTextureDataUrl=value;return value;}
  }
  const image=texture.image;
  const width=image?.naturalWidth||image?.videoWidth||image?.width||0;
  const height=image?.naturalHeight||image?.videoHeight||image?.height||0;
  if(!image||!width||!height)throw new Error('Не удалось сохранить изображение пользовательской текстуры.');
  const canvas=document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Canvas недоступен для сохранения пользовательской текстуры.');
  context.drawImage(image,0,0,width,height);
  const dataUrl=canvas.toDataURL('image/png');
  texture.userData.editorTextureDataUrl=dataUrl;
  return dataUrl;
}

async function collectEditorAssetConfig(asset,textureCache=new Map(),materialIds=new Map()){
  const root=asset.root;
  const materials=[];
  for(const target of collectEditorMaterials(asset)){
    const material=target.material;
    const textures={};
    for(const property of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap']){
      const texture=material[property];
      if(!texture?.userData?.editorOwnedTexture)continue;
      const key=texture.uuid||property;
      if(!textureCache.has(key))textureCache.set(key,await editorTextureToDataUrl(texture));
      textures[property]=textureCache.get(key);
    }
    if(!materialIds.has(material))materialIds.set(material,'scene-material-'+(materialIds.size+1));
    materials.push({
      materialId:materialIds.get(material),
      nodeName:target.mesh.name||target.mesh.type,
      materialName:material.name||'',
      baseColor:material.color?.getHexString?('#'+material.color.getHexString()):null,
      roughness:material.roughness??null,metalness:material.metalness??null,
      normalScale:material.normalScale?.x??null,aoMapIntensity:material.aoMapIntensity??null,
      emissive:material.emissive?.getHexString?('#'+material.emissive.getHexString()):null,
      emissiveIntensity:material.emissiveIntensity??null,
      emissiveEnabled:typeof material.userData?.gradeOptimizerEmissiveEnabled==='boolean'
        ? material.userData.gradeOptimizerEmissiveEnabled : (material.emissiveIntensity??0)>0.0001,
      emissiveStrength:Number.isFinite(material.userData?.gradeOptimizerEmissiveStrength)
        ? material.userData.gradeOptimizerEmissiveStrength : (material.emissiveIntensity??0),
      opacity:material.opacity??1,
      textureRepeat:material.map?.repeat?.x??1,transparent:!!material.transparent,
      maps:{
        baseColor:!!material.map,normal:!!material.normalMap,roughness:!!material.roughnessMap,
        metalness:!!material.metalnessMap,ao:!!material.aoMap,emissive:!!material.emissiveMap
      },
      textures,
      doubleSided:material.side===THREE.DoubleSide,wireframe:!!material.wireframe
    });
  }
  return {
    id:asset.id,name:asset.name,sourceFile:asset.meta.sourceFile||null,sourceType:asset.sourceType,
    category:asset.meta.category,phase:asset.meta.phase,visible:root.visible,
    collision:!!asset.meta.collision,forestBlocker:!!asset.meta.forestBlocker,
    transform:{position:root.position.toArray(),rotation:[root.rotation.x,root.rotation.y,root.rotation.z],scale:root.scale.toArray()},
    nodeVisibility:collectEditorNodeVisibility(root),
    nodeMetadata:collectEditorNodeMetadata(root),
    materials
  };
}

async function collectProjectEditorSettings(){
  const textureCache=new Map(),materialIds=new Map();
  const assets=[];
  for(const asset of getAllEditorAssets().filter(item=>item.sourceType==='scene')){
    assets.push(await collectEditorAssetConfig(asset,textureCache,materialIds));
  }
  return {
    schemaVersion:'1.0',savedAt:new Date().toISOString(),units:'meters',assets,
    visualSettings:{...opticsSettings},
    weatherSettings:weatherSystem.getSettings()
  };
}

async function collectClientManifest(slug){
  const assets=state.importedAssets.map(asset=>{
    if(!asset.sourcePath){
      if(!asset.sourceBuffer)throw new Error('У модели '+asset.name+' нет исходного GLB-файла для публикации.');
      asset.sourcePath='models/'+asset.id+'.glb';
    }
    if(!/^models\/[A-Za-z0-9_.-]+\.(glb|fbx)$/i.test(asset.sourcePath))throw new Error('Некорректный путь модели у '+asset.name);
    const root=asset.root;
    return {
      id:asset.id,name:asset.name,file:asset.sourcePath,
      category:asset.meta.category||'prop',phase:asset.meta.phase||'always',
      visible:root.visible,collision:!!asset.meta.collision,forestBlocker:!!asset.meta.forestBlocker,
      activeTerrain:asset.id===state.activeTerrainAssetId,
      mayaExport:asset.meta.mayaExport||undefined,
      transform:{position:root.position.toArray(),rotation:[root.rotation.x,root.rotation.y,root.rotation.z],scale:root.scale.toArray()},
      nodeVisibility:collectEditorNodeVisibility(root),
      nodeMetadata:collectEditorNodeMetadata(root)
    };
  });
  const editorSettings=await collectProjectEditorSettings();
  return {schemaVersion:'1.0',clientId:slug,updatedAt:new Date().toISOString(),assets,editorSettings,overviewCameras:normalizeOverviewCameraMap(state.savedOverviewCameras),treeAreas:normalizeTreeAreas(state.treeAreas),skierSpawns:normalizeSkierSpawnMap(state.skierSpawns),slopeAnalysis:state.slopeAnalysisData||undefined,slopeCurves:state.slopeCurvesData||undefined};
}

async function exportAssetForClientPublish(asset){
  const exportRoot=asset.root.clone(true);
  exportRoot.position.set(0,0,0);
  exportRoot.rotation.set(0,0,0);
  exportRoot.scale.set(1,1,1);
  exportRoot.updateMatrixWorld(true);
  const exporter=new GLTFExporter();
  const result=await new Promise((resolve,reject)=>{
    exporter.parse(exportRoot,resolve,reject,{binary:true,trs:true,onlyVisible:false});
  });
  if(!(result instanceof ArrayBuffer))throw new Error('GLTFExporter не вернул бинарный GLB для '+asset.name);
  return result;
}
const PROJECT_FOLDER_HANDLE_KEY='project-folder-root';
async function readSavedProjectFolderHandle(){
  const db=await openLocalAssetDatabase();
  try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('models','readonly');
    const request=tx.objectStore('models').get(PROJECT_FOLDER_HANDLE_KEY);
    request.onsuccess=()=>resolve(request.result?.handle||null);
    request.onerror=()=>reject(request.error||new Error('Не удалось прочитать привязку локальной папки.'));
    tx.onerror=()=>reject(tx.error||new Error('Ошибка чтения привязки локальной папки.'));
  });}finally{db.close();}
}
async function saveProjectFolderHandle(handle){
  const db=await openLocalAssetDatabase();
  try{await new Promise((resolve,reject)=>{
    const tx=db.transaction('models','readwrite');
    tx.objectStore('models').put({handle,name:handle.name||'Grade_Optimizer',savedAt:new Date().toISOString()},PROJECT_FOLDER_HANDLE_KEY);
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error||new Error('Не удалось сохранить привязку папки.'));
    tx.onabort=()=>reject(tx.error||new Error('Сохранение привязки папки отменено.'));
  });}finally{db.close();}
}
async function restoreProjectFolderHandle(){
  projectFolderHandle=null;savedProjectFolderHandle=null;projectFolderPermissionState='missing';projectFolderSyncError='';
  projectFolderWrittenModels.clear();
  try{
    const handle=await readSavedProjectFolderHandle();
    if(!handle)return;
    savedProjectFolderHandle=handle;
    projectFolderPermissionState=await handle.queryPermission({mode:'readwrite'});
    if(projectFolderPermissionState==='granted')projectFolderHandle=handle;
  }catch(error){console.warn('Saved local project folder is unavailable:',error);projectFolderPermissionState='prompt';}
}
async function verifyProjectRepositoryFolder(handle){
  if(!handle||handle.kind!=='directory')throw new Error('Выбери корень репозитория Grade_Optimizer.');
  await handle.getFileHandle('index.html');
  const readmeHandle=await handle.getFileHandle('README.md');
  await handle.getDirectoryHandle('maya');
  const readmeText=await (await readmeHandle.getFile()).text();
  if(!readmeText.includes('Grade Optimizer'))throw new Error('В выбранной папке не найден README проекта Grade Optimizer.');
}
async function requestProjectFolderWritePermission(handle){
  const state=await handle.queryPermission({mode:'readwrite'});
  return state==='granted'?state:await handle.requestPermission({mode:'readwrite'});
}
async function connectProjectFolder(){
  if(typeof window.showDirectoryPicker!=='function'){
    setClientWorkspaceStatus('Прямая запись в папку поддерживается в Chrome / Edge. Открой Grade Optimizer по HTTPS в Chrome.',true);return;
  }
  const button=document.getElementById('connectProjectFolderButton');
  if(button)button.disabled=true;
  try{
    let handle=null;
    if(savedProjectFolderHandle&&projectFolderPermissionState!=='denied'){
      const permission=await requestProjectFolderWritePermission(savedProjectFolderHandle);
      if(permission==='granted')handle=savedProjectFolderHandle;
      else{
        projectFolderPermissionState='denied';
        setClientWorkspaceStatus('Chrome не разрешил запись в ранее выбранную папку. Нажми кнопку ещё раз, чтобы выбрать папку репозитория заново.',true);return;
      }
    }else{
      handle=await window.showDirectoryPicker({id:'grade-optimizer-repository',mode:'readwrite'});
      await verifyProjectRepositoryFolder(handle);
      const permission=await requestProjectFolderWritePermission(handle);
      if(permission!=='granted')throw new Error('Chrome не выдал разрешение на запись в выбранную папку.');
      await saveProjectFolderHandle(handle);
    }
    await verifyProjectRepositoryFolder(handle);
    savedProjectFolderHandle=handle;projectFolderHandle=handle;projectFolderPermissionState='granted';projectFolderSyncError='';
    projectFolderWrittenModels.clear();
    if(button)button.textContent='LOCAL FOLDER CONNECTED · '+(handle.name||'REPOSITORY');
    if(clientWorkspaceReady){
      await autosaveProjectToBrowser({force:true,silent:true});
      setClientWorkspaceStatus('Репозиторий '+(handle.name||'Grade_Optimizer')+' подключён. Проект записывается напрямую в clients/'+currentClientSlug+'/. GitHub Desktop увидит изменённые файлы.');
    }else setClientWorkspaceStatus('Папка '+(handle.name||'Grade_Optimizer')+' подключена. Открой проект — автосохранение будет записывать файлы прямо в неё.');
  }catch(error){
    if(error?.name==='AbortError')setClientWorkspaceStatus('Выбор папки отменён.');
    else{console.error(error);setClientWorkspaceStatus('Не удалось подключить папку проекта: '+(error?.message||String(error)),true);}
  }finally{if(button)button.disabled=false;}
}
async function writeProjectFileToFolder(rootHandle,relativePath,data){
  const parts=String(relativePath||'').split('/');
  if(!parts.length||parts.some(part=>!part||part==='.'||part==='..'||! /^[A-Za-z0-9_.-]+$/.test(part)))throw new Error('Недопустимый относительный путь: '+relativePath);
  const fileName=parts.pop();let directory=rootHandle;
  for(const part of parts)directory=await directory.getDirectoryHandle(part,{create:true});
  const fileHandle=await directory.getFileHandle(fileName,{create:true});
  const writable=await fileHandle.createWritable();
  try{await writable.write(data);await writable.close();}
  catch(error){try{await writable.abort();}catch(abortError){}throw error;}
}
async function removeProjectFileFromFolder(rootHandle,relativePath){
  const parts=String(relativePath||'').split('/');
  if(!parts.length||parts.some(part=>!part||part==='.'||part==='..'||! /^[A-Za-z0-9_.-]+$/.test(part)))return;
  const fileName=parts.pop();let directory=rootHandle;
  try{for(const part of parts)directory=await directory.getDirectoryHandle(part);await directory.removeEntry(fileName);}
  catch(error){if(error?.name!=='NotFoundError')throw error;}
}
async function writeProjectSnapshotToFolder(slug,manifest){
  if(!projectFolderHandle)return false;
  const permission=await projectFolderHandle.queryPermission({mode:'readwrite'});
  if(permission!=='granted')throw new Error('Доступ к локальной папке нужно подтвердить кнопкой CONNECT LOCAL PROJECT FOLDER.');
  const byId=new Map(state.importedAssets.map(asset=>[asset.id,asset]));
  const currentFiles=new Set();
  for(const item of manifest.assets){
    if(!/^models\/[A-Za-z0-9_.-]+\.(glb|fbx)$/i.test(item.file||''))throw new Error('Некорректный путь модели: '+item.file);
    const asset=byId.get(item.id);
    if(!asset?.sourceBuffer)throw new Error('Нет бинарных данных модели '+item.name+'.');
    currentFiles.add(item.file);
    const previous=projectFolderWrittenModels.get(item.id);
    if(previous&&previous.path===item.file&&previous.buffer===asset.sourceBuffer)continue;
    if(asset.sourceBuffer.byteLength>90*1024*1024)throw new Error(asset.name+' больше 90 MiB. GitHub не примет такой файл обычным Git push без Git LFS.');
    await writeProjectFileToFolder(projectFolderHandle,'clients/'+slug+'/'+item.file,asset.sourceBuffer);
    projectFolderWrittenModels.set(item.id,{path:item.file,buffer:asset.sourceBuffer});
  }
  try{
    const oldManifestHandle=await projectFolderHandle.getDirectoryHandle('clients')
      .then(dir=>dir.getDirectoryHandle(slug)).then(dir=>dir.getFileHandle('scene.json'));
    const oldManifest=JSON.parse(await (await oldManifestHandle.getFile()).text());
    const currentIds=new Set(manifest.assets.map(item=>item.id));
    for(const oldAsset of oldManifest.assets||[]){
      if(oldAsset?.file&&/^models\/[A-Za-z0-9_.-]+\.(glb|fbx)$/i.test(oldAsset.file)&&
        !currentIds.has(oldAsset.id)&&!currentFiles.has(oldAsset.file)){
        await removeProjectFileFromFolder(projectFolderHandle,'clients/'+slug+'/'+oldAsset.file);
      }
    }
  }catch(error){if(error?.name!=='NotFoundError')console.warn('Could not prune old project model files:',error);}
  await writeProjectFileToFolder(projectFolderHandle,'clients/'+slug+'/scene.json',JSON.stringify(manifest,null,2));
  return true;
}
function shareClientWorkspace(){
  const slug=normalizeClientId(currentClientSlug||document.getElementById('clientWorkspaceId').value);
  if(!slug){setClientWorkspaceStatus('Сначала укажи Project ID.',true);return;}
  // Public viewer links must load the published GitHub snapshot, not an unsynced local editor draft.
  const url=window.location.origin+window.location.pathname+'?project='+encodeURIComponent(slug)+'&remote=1';
  const output=document.getElementById('clientShareLink');
  output.value=url;output.select();
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(url).then(
    ()=>setClientWorkspaceStatus('Ссылка для просмотра проекта скопирована.'),
    ()=>setClientWorkspaceStatus('Ссылка для просмотра готова — скопируй её из поля ниже.')
  );
  else setClientWorkspaceStatus('Ссылка для просмотра готова — скопируй её из поля ниже.');
}

async function exportSceneEditorConfig(){
  try{
    const textureCache=new Map(),materialIds=new Map(),assets=[];
    for(const asset of getAllEditorAssets())assets.push(await collectEditorAssetConfig(asset,textureCache,materialIds));
    const payload={
      schemaVersion:'1.0',savedAt:new Date().toISOString(),units:'meters',assets,
      visualSettings:{...opticsSettings},weatherSettings:weatherSystem.getSettings()
    };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');anchor.href=url;
    anchor.download='resort-scene-config.json';anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    setEditorStatus('Резервная копия настроек экспортирована: resort-scene-config.json');
  }catch(error){
    console.error(error);
    setEditorStatus('Не удалось собрать настройки сцены: '+(error?.message||String(error)),true);
  }
}

const EDITOR_MATERIAL_PRESETS = {
  snow_groomed: {label:'Snow · Groomed',color:'#e9f1f7',roughness:0.96,metalness:0,emissive:'#000000',emissiveIntensity:0,opacity:1,doubleSide:false},
  snow_fresh: {label:'Snow · Fresh',color:'#f8fbff',roughness:0.99,metalness:0,emissive:'#000000',emissiveIntensity:0,opacity:1,doubleSide:false},
  pine_needles: {label:'Pine · Needles',color:'#527b59',roughness:0.94,metalness:0,emissive:'#000000',emissiveIntensity:0,opacity:1,doubleSide:true},
  bark_wood: {label:'Wood · Bark',color:'#76583f',roughness:0.88,metalness:0,emissive:'#000000',emissiveIntensity:0,opacity:1,doubleSide:false},
  concrete: {label:'Concrete',color:'#9b9da0',roughness:0.92,metalness:0,emissive:'#000000',emissiveIntensity:0,opacity:1,doubleSide:false},
  asphalt: {label:'Asphalt',color:'#363b40',roughness:0.9,metalness:0,emissive:'#000000',emissiveIntensity:0,opacity:1,doubleSide:false},
  painted_metal: {label:'Metal · Painted',color:'#aab5bf',roughness:0.42,metalness:0.62,emissive:'#000000',emissiveIntensity:0,opacity:1,doubleSide:false},
  glass: {label:'Glass · Simple',color:'#d8edf5',roughness:0.08,metalness:0,emissive:'#000000',emissiveIntensity:0,opacity:0.32,doubleSide:true}
};

const EDITOR_TEXTURE_MAPS = {
  map:{label:'Base Color',property:'map',colorSpace:THREE.SRGBColorSpace},
  normalMap:{label:'Normal',property:'normalMap',colorSpace:THREE.NoColorSpace},
  roughnessMap:{label:'Roughness',property:'roughnessMap',colorSpace:THREE.NoColorSpace},
  metalnessMap:{label:'Metalness',property:'metalnessMap',colorSpace:THREE.NoColorSpace},
  aoMap:{label:'Ambient Occlusion',property:'aoMap',colorSpace:THREE.NoColorSpace},
  emissiveMap:{label:'Emissive',property:'emissiveMap',colorSpace:THREE.SRGBColorSpace}
};

function applyEditorMaterialPreset(){
  const target=selectedEditorMaterial();
  const preset=EDITOR_MATERIAL_PRESETS[document.getElementById('editorPresetSelect').value];
  if(!target||!preset){setEditorStatus('Сначала выберите материал и пресет.',true);return;}
  document.getElementById('editorBaseColor').value=preset.color;
  document.getElementById('editorEmissiveColor').value=preset.emissive;
  document.getElementById('editorRoughness').value=String(preset.roughness);
  document.getElementById('editorMetalness').value=String(preset.metalness);
  document.getElementById('editorEmissive').value=String(preset.emissiveIntensity);
  document.getElementById('editorEmissiveEnabled').checked=Number(preset.emissiveIntensity)>0;
  updateEditorEmissiveControls(true);
  document.getElementById('editorOpacity').value=String(preset.opacity);
  document.getElementById('editorDoubleSide').checked=!!preset.doubleSide;
  document.getElementById('editorWireframe').checked=false;
  applyEditorMaterial();
  const affected=markEditorMaterialOwnersDirty(target.material);
  affected.forEach(asset=>persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить материал после применения пресета:',error)));
  setEditorStatus('Применён профиль: '+preset.label+'. Карты текстур сохранены.');
}

function ensureEditorAoUv(mesh){
  const geometry=mesh?.geometry;
  if(geometry?.attributes?.uv&&!geometry.attributes.uv2){
    geometry.setAttribute('uv2',geometry.attributes.uv.clone());
  }
}

function importEditorTextureFile(file){
  const target=selectedEditorMaterial();
  if(!target){setEditorStatus('Сначала выберите mesh / material slot.',true);return;}
  const type=document.getElementById('editorTextureType').value;
  const spec=EDITOR_TEXTURE_MAPS[type];
  if(!spec){setEditorStatus('Неизвестный тип карты текстуры.',true);return;}
  if(!file||!file.type.startsWith('image/')){setEditorStatus('Выберите файл изображения.',true);return;}
  const url=URL.createObjectURL(file);
  const material=target.material;
  setEditorStatus('Загрузка '+spec.label+': '+file.name+' …');
  new THREE.TextureLoader().load(url,texture=>{
    texture.colorSpace=spec.colorSpace;
    texture.flipY=false;
    texture.wrapS=THREE.RepeatWrapping;
    texture.wrapT=THREE.RepeatWrapping;
    const tile=Math.max(0.1,Number(document.getElementById('editorTiling').value)||1);
    texture.repeat.set(tile,tile);
    texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate=true;

    const previous=material[spec.property];
    if(previous?.userData?.editorObjectUrl)URL.revokeObjectURL(previous.userData.editorObjectUrl);
    if(previous?.userData?.editorOwnedTexture)previous.dispose();
    texture.userData.editorOwnedTexture=true;
    texture.name=file.name;
    texture.userData.editorObjectUrl=url;
    const textureDataUrlPromise=new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result||""));
      reader.onerror=()=>reject(reader.error||new Error("Не удалось прочитать файл текстуры."));
      reader.readAsDataURL(file);
    });
    textureDataUrlPromise.catch(()=>{});
    texture.userData.editorTextureDataUrlPromise=textureDataUrlPromise;
    material[spec.property]=texture;

    if(spec.property==='aoMap')ensureEditorAoUv(target.mesh);
    if(spec.property==='emissiveMap'&&material.emissive&&material.emissive.getHex()===0){
      material.emissive.set(0xffffff);
      material.emissiveIntensity=Math.max(1,material.emissiveIntensity||0);
      document.getElementById('editorEmissiveEnabled').checked=true;
      material.userData={...(material.userData||{}),gradeOptimizerEmissiveEnabled:true,gradeOptimizerEmissiveStrength:material.emissiveIntensity};
    }
    material.needsUpdate=true;
    const affected=markEditorMaterialOwnersDirty(material);
    markClientProjectDirty('пользовательская текстура');
    affected.forEach(asset=>persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить общую текстуру:',error)));
    refreshEditorMaterialLibrary(material.uuid);
    loadEditorMaterial(Number(editorMaterialSelect.value));
    updateEditorMaterialLinkStatus();
    setEditorStatus(spec.label+' подключена к '+(material.name||target.mesh.name||'материалу')+'. Общий материал обновлён во всех связанных слотах.');
  },undefined,error=>{
    URL.revokeObjectURL(url);
    console.error(error);
    setEditorStatus('Не удалось загрузить текстуру: '+(error?.message||String(error)),true);
  });
}

function clearEditorTextureMap(){
  const target=selectedEditorMaterial();
  if(!target){setEditorStatus('Сначала выберите материал.',true);return;}
  const spec=EDITOR_TEXTURE_MAPS[document.getElementById('editorTextureType').value];
  if(!spec)return;
  const material=target.material;
  const texture=material[spec.property];
  if(!texture){setEditorStatus('У выбранного материала нет карты '+spec.label+'.');return;}
  if(texture.userData?.editorObjectUrl)URL.revokeObjectURL(texture.userData.editorObjectUrl);
  if(texture.userData?.editorOwnedTexture)texture.dispose();
  material[spec.property]=null;
  material.needsUpdate=true;
  const affected=markEditorMaterialOwnersDirty(material);
  markClientProjectDirty('удаление карты текстуры');
  affected.forEach(asset=>persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить удаление общей текстуры:',error)));
  refreshEditorTexturePreviews(material);
  renderMaterialLibraryWindow();
  setEditorStatus('Карта '+spec.label+' удалена во всех слотах, использующих этот материал.');
}

async function loadEditorTextureDataUrl(dataUrl,property,repeat){
  return new Promise((resolve,reject)=>{
    const spec=EDITOR_TEXTURE_MAPS[property];
    const loader=new THREE.TextureLoader();
    loader.load(dataUrl,texture=>{
      texture.colorSpace=spec?.colorSpace||THREE.NoColorSpace;
      texture.flipY=false;
      texture.wrapS=THREE.RepeatWrapping;texture.wrapT=THREE.RepeatWrapping;
      texture.repeat.set(repeat,repeat);
      texture.userData.editorOwnedTexture=true;
      texture.userData.editorTextureDataUrl=dataUrl;
      resolve(texture);
    },undefined,reject);
  });
}

async function applySceneEditorConfig(payload,{quiet=false}={}){
  if(!payload||!Array.isArray(payload.assets))throw new Error('JSON не содержит массива assets.');
  let matchedAssets=0,matchedMaterials=0,skippedAssets=0;
  const sharedEditorMaterials=new Map(),editorMaterialSavedIds=new WeakMap();
  for(const savedAsset of payload.assets){
    const asset=getAllEditorAssets().find(item=>
      item.id===savedAsset.id||
      (savedAsset.sourceType===item.sourceType&&item.name.replace(/^SCENE · /,'')===savedAsset.name.replace(/^SCENE · /,''))||
      (savedAsset.sourceFile&&item.meta.sourceFile===savedAsset.sourceFile&&item.name===savedAsset.name)
    );
    if(!asset){skippedAssets++;continue;}
    matchedAssets++;
    const root=asset.root;
    const tr=savedAsset.transform||{};
    if(Array.isArray(tr.position)&&tr.position.length===3)root.position.fromArray(tr.position);
    if(Array.isArray(tr.rotation)&&tr.rotation.length===3)root.rotation.set(tr.rotation[0],tr.rotation[1],tr.rotation[2]);
    if(Array.isArray(tr.scale)&&tr.scale.length===3)root.scale.fromArray(tr.scale);
    if(savedAsset.visible!==undefined)root.visible=!!savedAsset.visible;
    if(Array.isArray(savedAsset.nodeVisibility))applyEditorNodeVisibility(root,savedAsset.nodeVisibility);

    asset.meta.category=savedAsset.category||asset.meta.category||'prop';
    asset.meta.phase=savedAsset.phase||asset.meta.phase||'stage_1';
    asset.meta.collision=!!savedAsset.collision;
    asset.meta.forestBlocker=!!savedAsset.forestBlocker;
    root.userData.resortAsset={...(root.userData.resortAsset||{}),id:asset.id,name:asset.name,...asset.meta};
    root.traverse(node=>{if(node.userData)delete node.userData.gradeOptimizerMetadata;});
    applyEditorNodeMetadata(root,savedAsset.nodeMetadata||[]);

    const targets=collectEditorMaterials(asset);
    const used=new Set();
    for(const savedMaterial of (savedAsset.materials||[])){
      let index=targets.findIndex((target,i)=>!used.has(i)&&
        target.mesh.name===(savedMaterial.nodeName||'')&&
        target.material.name===(savedMaterial.materialName||''));
      if(index<0)index=targets.findIndex((target,i)=>!used.has(i)&&target.mesh.name===(savedMaterial.nodeName||''));
      if(index<0)continue;
      used.add(index);
      const target=targets[index];
      let material=target.material;
      if(savedMaterial.materialId){
        if(sharedEditorMaterials.has(savedMaterial.materialId)){
          material=sharedEditorMaterials.get(savedMaterial.materialId);
          if(target.material!==material)replaceEditorMaterialTarget(target,material);
        }else{
          if(editorMaterialSavedIds.has(material)&&editorMaterialSavedIds.get(material)!==savedMaterial.materialId){
            const clone=material.clone();
            const textureProperties=['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','bumpMap',
              'displacementMap','alphaMap','lightMap','envMap','specularMap','clearcoatMap','clearcoatNormalMap',
              'clearcoatRoughnessMap','transmissionMap','thicknessMap','sheenColorMap','sheenRoughnessMap',
              'iridescenceMap','iridescenceThicknessMap','anisotropyMap'];
            textureProperties.forEach(property=>{if(material[property]?.isTexture)clone[property]=material[property].clone();});
            material=clone;
            replaceEditorMaterialTarget(target,material);
          }
          sharedEditorMaterials.set(savedMaterial.materialId,material);
          editorMaterialSavedIds.set(material,savedMaterial.materialId);
        }
      }
      if(savedMaterial.baseColor&&material.color)material.color.set(savedMaterial.baseColor);
      if(Number.isFinite(savedMaterial.roughness)&&'roughness' in material)material.roughness=savedMaterial.roughness;
      if(Number.isFinite(savedMaterial.metalness)&&'metalness' in material)material.metalness=savedMaterial.metalness;
      if(Number.isFinite(savedMaterial.normalScale)&&material.normalScale)material.normalScale.set(savedMaterial.normalScale,savedMaterial.normalScale);
      if(Number.isFinite(savedMaterial.aoMapIntensity)&&'aoMapIntensity' in material)material.aoMapIntensity=savedMaterial.aoMapIntensity;
      if(savedMaterial.emissive&&material.emissive)material.emissive.set(savedMaterial.emissive);
      if(typeof savedMaterial.emissiveEnabled==='boolean'){
        const emissiveStrength=Number.isFinite(savedMaterial.emissiveStrength)
          ? savedMaterial.emissiveStrength
          : (Number.isFinite(savedMaterial.emissiveIntensity)?savedMaterial.emissiveIntensity:(material.emissiveIntensity??1));
        material.userData={...(material.userData||{}),
          gradeOptimizerEmissiveEnabled:savedMaterial.emissiveEnabled,
          gradeOptimizerEmissiveStrength:emissiveStrength
        };
        if('emissiveIntensity' in material)material.emissiveIntensity=savedMaterial.emissiveEnabled?emissiveStrength:0;
      }else{
        const emissiveStrength=Number.isFinite(savedMaterial.emissiveStrength)
          ?Math.max(0,savedMaterial.emissiveStrength)
          :(Number.isFinite(savedMaterial.emissiveIntensity)
            ?Math.max(0,savedMaterial.emissiveIntensity)
            :Math.max(0,material.emissiveIntensity??1));
        material.userData={...(material.userData||{}),
          gradeOptimizerEmissiveEnabled:false,
          gradeOptimizerEmissiveStrength:emissiveStrength
        };
        if('emissiveIntensity' in material)material.emissiveIntensity=0;
      }
      if(Number.isFinite(savedMaterial.opacity))material.opacity=savedMaterial.opacity;
      material.transparent=!!savedMaterial.transparent;
      material.depthWrite=!material.transparent;
      material.side=savedMaterial.doubleSided?THREE.DoubleSide:THREE.FrontSide;
      material.wireframe=!!savedMaterial.wireframe;
      const repeat=Number.isFinite(savedMaterial.textureRepeat)?savedMaterial.textureRepeat:1;
      const textureProps=['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'];
      for(const property of textureProps){
        const dataUrl=savedMaterial.textures?.[property];
        const mapsKey=property==='map'?'baseColor':property==='normalMap'?'normal':property==='roughnessMap'?'roughness':property==='metalnessMap'?'metalness':property==='aoMap'?'ao':'emissive';
        if(dataUrl){
          const nextTexture=await loadEditorTextureDataUrl(dataUrl,property,repeat);
          const previous=material[property];
          if(previous?.userData?.editorOwnedTexture)previous.dispose();
          material[property]=nextTexture;
        }else if(savedMaterial.maps&&savedMaterial.maps[mapsKey]===false){
          const previous=material[property];
          if(previous?.userData?.editorOwnedTexture)previous.dispose();
          material[property]=null;
        }else if(material[property]){
          material[property].wrapS=THREE.RepeatWrapping;
          material[property].wrapT=THREE.RepeatWrapping;
          material[property].repeat.set(repeat,repeat);
        }
      }
      material.needsUpdate=true;
      matchedMaterials++;
    }
    if(asset.sourceType==='imported'){
      asset.meta.modelDirty=true;
      persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить импортированную JSON-конфигурацию модели:',error));
    }
  }
  if(payload.visualSettings)applyOpticsSettingsFromProject(payload.visualSettings);
  if(payload.weatherSettings)applyWeatherSettingsFromProject(payload.weatherSettings);
  if(editorSelectedAsset)populateEditorAssetControls(editorSelectedAsset,editorSelectedNode||editorSelectedAsset.root);
  refreshEditorMaterialList(Number(editorMaterialSelect.value)||0);
  if(!quiet){
    setEditorStatus('Конфигурация загружена: объектов '+matchedAssets+', материалов '+matchedMaterials+', не найдены объекты '+skippedAssets+'.');
    if(matchedAssets||matchedMaterials||payload.visualSettings||payload.weatherSettings)markClientProjectDirty('импорт JSON-конфигурации');
  }
  return {matchedAssets,matchedMaterials,skippedAssets};
}

async function loadSceneEditorConfigFile(file){
  if(!file)return;
  if(!getAllEditorAssets().length){
    setEditorStatus('Сначала дождись загрузки сцены, затем загрузи JSON.',true);
    return;
  }
  try{
    const payload=JSON.parse(await file.text());
    await applySceneEditorConfig(payload);
  }catch(error){
    console.error(error);
    setEditorStatus('Ошибка загрузки конфигурации: '+(error?.message||String(error)),true);
  }
}

async function exportSelectedAssetGlb(){
  if(!editorSelectedAsset||!editorSelectedNode){setEditorStatus('Сначала выбери объект в иерархии.',true);return;}
  setEditorStatus('Экспорт GLB: '+editorNodeLabel(editorSelectedNode)+' …');
  try{
    const exporter=new GLTFExporter();
    const result=await new Promise((resolve,reject)=>{
      exporter.parse(editorSelectedNode,resolve,reject,{binary:true,trs:true,onlyVisible:false});
    });
    if(!(result instanceof ArrayBuffer))throw new Error('Экспортёр не вернул бинарный GLB.');
    const blob=new Blob([result],{type:'model/gltf-binary'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;
    anchor.download=slugAssetName(editorNodeLabel(editorSelectedNode))+'_edited.glb';
    anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    setEditorStatus('GLB экспортирован: '+anchor.download+'. Материалы и загруженные карты запечены в файл.');
  }catch(error){
    console.error(error);
    setEditorStatus('Не удалось экспортировать GLB: '+(error?.message||String(error)),true);
  }
}

editorToggleButton.addEventListener('click',()=>{
  const open=!appRoot.classList.contains('editor-open');
  if(open&&state.mode!=='overview'){
    if(document.pointerLockElement===renderer.domElement)document.exitPointerLock?.();
    setSceneMode('overview');
  }
  if(open&&state.optimizeMode)setOptimizerOpen(false);
  appRoot.classList.toggle('editor-open',open);
  if(!open)materialLibraryWindow.classList.remove('open');
  editorToggleButton.classList.toggle('active',open);
  editorToggleButton.setAttribute('aria-expanded',String(open));
  if(open){
    if(editorSelectionHelper)editorSelectionHelper.visible=true;
    setEditorStatus(getAllEditorAssets().length+' корневых моделей доступны. Раскрывай группы до mesh и material slots.');
  }else if(editorSelectionHelper){editorSelectionHelper.visible=false;}
  if(!open&&treeAreaDrawing)stopTreeAreaDrawing();
  updateTreeAreaOverlayVisibility();
  updateSkierSpawnOverlayVisibility();
  updateSkierSpawnPanel();
  resizeSceneAfterModeChange();
});
document.getElementById('closeEditor').addEventListener('click',()=>{
  if(treeAreaDrawing)stopTreeAreaDrawing();
  if(skierSpawnPlacementStep)cancelSkierSpawnPlacement();
  materialLibraryWindow.classList.remove('open');
  if(editorSelectionHelper)editorSelectionHelper.visible=false;
  appRoot.classList.remove('editor-open');
  editorToggleButton.classList.remove('active');
  editorToggleButton.setAttribute('aria-expanded','false');
  updateSkierSpawnOverlayVisibility();
});
document.getElementById('importGlbButton').addEventListener('click',()=>glbFileInput.click());
document.getElementById('openClientWorkspaceButton').addEventListener('click',()=>{
  openClientWorkspace(document.getElementById('clientWorkspaceId').value);
});
document.getElementById('connectProjectFolderButton').addEventListener('click',connectProjectFolder);
document.getElementById('shareClientWorkspaceButton').addEventListener('click',shareClientWorkspace);

glbFileInput.addEventListener('change',event=>importGlbFiles(event.target.files));

[editorPanel,sceneHierarchyPanel].forEach(dropTarget=>{
  dropTarget.addEventListener('dragover',event=>{
    const hasFiles=Array.from(event.dataTransfer?.items||[]).some(item=>item.kind==='file');
    if(!hasFiles)return;
    event.preventDefault();dropTarget.classList.add('drag-over');
  });
  dropTarget.addEventListener('dragleave',event=>{
    if(!dropTarget.contains(event.relatedTarget))dropTarget.classList.remove('drag-over');
  });
  dropTarget.addEventListener('drop',event=>{
    event.preventDefault();dropTarget.classList.remove('drag-over');
    const files=Array.from(event.dataTransfer?.files||[]);
    const modelFiles=files.filter(file=>/\.(glb|fbx)$/i.test(file.name));
    if(modelFiles.length)importGlbFiles(modelFiles);
    else if(files.length)setEditorStatus('Перетащите сюда бинарную модель .glb или .fbx. Тип модели задаётся в списке SCENE.',true);
  });
});

editorObjectSelect.addEventListener('change',event=>{
  const asset=getAllEditorAssets().find(item=>item.id===event.target.value);
  if(asset)pulseEditorSelection(asset.root);
  selectEditorAsset(event.target.value);
});
document.getElementById('editorTreeExpandAll').addEventListener('click',()=>expandEditorTree(true));
document.getElementById('editorTreeCollapseAll').addEventListener('click',()=>expandEditorTree(false));
editorTreeSearch.addEventListener('input',()=>renderEditorTree(getAllEditorAssets(),editorSelectionKey()));
editorMaterialSelect.addEventListener('change',event=>{
  loadEditorMaterial(event.target.value);
  const target=editorMaterialTargets[Number(event.target.value)];
  if(target){
    if(editorSelectedAsset){
      editorSelectedMaterialKey=editorMaterialKey(editorSelectedAsset,target.mesh,target.index);
      renderEditorTree(getAllEditorAssets(),editorSelectionKey());
    }
    pulseEditorSelection(editorSelectedAsset?.root||target.mesh,target.material);
  }
  updateEditorMaterialLinkStatus();
  updateEditorMaterialLibraryControls();
});
document.getElementById('editorMaterialLibrarySelect').addEventListener('change',updateEditorMaterialLibraryControls);
document.getElementById('assignEditorMaterial').addEventListener('click',assignEditorLibraryMaterial);
document.getElementById('makeEditorMaterialUnique').addEventListener('click',makeEditorMaterialUnique);

const materialLibraryWindow=document.getElementById('materialLibraryWindow');
document.getElementById('openMaterialLibrary').addEventListener('click',()=>{
  materialLibraryWindow.classList.add('open');
  renderMaterialLibraryWindow();
});
document.getElementById('closeMaterialLibrary').addEventListener('click',()=>materialLibraryWindow.classList.remove('open'));
document.getElementById('materialLibrarySearch').addEventListener('input',renderMaterialLibraryWindow);
document.getElementById('materialLibraryAssign').addEventListener('click',assignEditorLibraryMaterial);
document.getElementById('materialLibraryUnique').addEventListener('click',makeEditorMaterialUnique);


['editorPosX','editorPosY','editorPosZ','editorRotX','editorRotY','editorRotZ','editorScaleX','editorScaleY','editorScaleZ'].forEach(id=>{
  const field=document.getElementById(id);
  field.addEventListener('input',applyEditorTransform);
  field.addEventListener('change',()=>{
    if(editorSelectedAsset&&editorSelectedNode===editorSelectedAsset.root)syncActiveTerrainTransform(editorSelectedAsset,true);
    persistImportedEditorAsset(editorSelectedAsset).catch(error=>console.warn('Не удалось сохранить трансформацию модели:',error));
  });
});
document.getElementById('focusSelectedAsset').addEventListener('click',()=>{
  if(editorSelectedNode)focusSceneObject(editorSelectedNode);
});
document.getElementById('activateSelectedTerrain').addEventListener('click',()=>{
  if(editorSelectedAsset?.sourceType==='imported'&&editorSelectedNode===editorSelectedAsset.root){
    if(activateImportedTerrain(editorSelectedAsset)){
      markClientProjectDirty('смена активного рельефа');
      focusSceneObject(editorSelectedNode);
      setEditorStatus('Модель назначена активным рельефом. Лыжник, дрон и лес теперь используют её геометрию.');
    }
  }
});
document.getElementById('resetTerrainButton').addEventListener('click',()=>{
  const hadActiveTerrain=!!state.activeTerrainAssetId;
  resetImportedTerrain();
  if(hadActiveTerrain)markClientProjectDirty('возврат исходного рельефа');
});
document.getElementById('editorCategory').addEventListener('change',event=>{
  const asset=editorSelectedAsset;
  if(!asset||editorSelectedNode!==asset.root)return;
  const previousCategory=asset.meta.category;
  const next=event.target.value;
  asset.meta.category=next;
  asset.root.userData.resortAsset.category=next;
  markClientProjectDirty('категория объекта');
  if(asset.sourceType==='imported'){
    if(next==='terrain')activateImportedTerrain(asset);
    else if(asset.id===state.activeTerrainAssetId){
      resetImportedTerrain();
      asset.root.visible=true;
      asset.meta.visible=true;
    }
    persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить категорию модели:',error));
  }
  if(asset.sourceType==='imported'&&(previousCategory==='slope'||next==='slope')){forestPlacementCache=null;buildTestForest();}
});
document.getElementById('editorPhase').addEventListener('change',event=>{
  if(editorSelectedAsset&&editorSelectedNode===editorSelectedAsset.root){
    editorSelectedAsset.meta.phase=event.target.value;
    editorSelectedAsset.root.userData.resortAsset.phase=event.target.value;
    markClientProjectDirty('фаза объекта');
    persistImportedEditorAsset(editorSelectedAsset).catch(error=>console.warn('Не удалось сохранить очередь объекта:',error));
  }
});
document.getElementById('editorVisible').addEventListener('change',event=>{
  if(editorSelectedAsset&&editorSelectedNode){
    editorSelectedNode.visible=event.target.checked;
    if(editorSelectedNode===editorSelectedAsset.root){
      editorSelectedAsset.meta.visible=event.target.checked;
      if(editorSelectedAsset.id===state.activeTerrainAssetId)state.terrainVisible=event.target.checked;
    }
    markClientProjectDirty('видимость объекта или узла');
    if(editorSelectedAsset.sourceType==='imported')editorSelectedAsset.meta.modelDirty=true;
    persistImportedEditorAsset(editorSelectedAsset).catch(error=>console.warn('Не удалось сохранить видимость модели:',error));
    if(editorSelectedAsset.sourceType==='imported'&&editorSelectedAsset.meta.category==='slope'){forestPlacementCache=null;buildTestForest();}
  }
});
document.getElementById('editorCollision').addEventListener('change',event=>{
  if(editorSelectedAsset&&editorSelectedNode===editorSelectedAsset.root){
    editorSelectedAsset.meta.collision=event.target.checked;
    editorSelectedAsset.root.userData.resortAsset.collision=event.target.checked;
    markClientProjectDirty('Collision модели');
    persistImportedEditorAsset(editorSelectedAsset).catch(error=>console.warn('Не удалось сохранить флаг коллизии:',error));
  }
});
document.getElementById('editorForestBlocker').addEventListener('change',event=>{
  if(editorSelectedAsset&&editorSelectedNode===editorSelectedAsset.root){
    editorSelectedAsset.meta.forestBlocker=event.target.checked;
    editorSelectedAsset.root.userData.resortAsset.forestBlocker=event.target.checked;
    markClientProjectDirty('Forest blocker модели');
    persistImportedEditorAsset(editorSelectedAsset).catch(error=>console.warn('Не удалось сохранить блокировку леса:',error));
  }
});
['editorNodeRole','editorNodeTags','editorNodeCollision','editorNodeForestBlocker'].forEach(id=>{
  document.getElementById(id).addEventListener('change',saveSelectedNodeMetadata);
});
['editorBaseColor','editorEmissiveColor','editorRoughness','editorMetalness','editorNormalScale','editorAo',
 'editorEmissive','editorEmissiveEnabled','editorTiling','editorOpacity','editorDoubleSide','editorWireframe'].forEach(id=>{
  document.getElementById(id).addEventListener('input',applyEditorMaterial);
  document.getElementById(id).addEventListener('change',()=>{
    const target=selectedEditorMaterial();
    applyEditorMaterial();
    const affected=target?markEditorMaterialOwnersDirty(target.material):[];
    if(!affected.length&&editorSelectedAsset?.sourceType==='imported')affected.push(editorSelectedAsset);
    [...new Set(affected)].forEach(asset=>persistImportedEditorAsset(asset).catch(error=>console.warn('Не удалось сохранить материал:',error)));
  });
});
document.getElementById('removeImportedAsset').addEventListener('click',()=>{
  if(!editorSelectedAsset||!editorSelectedNode)return;
  const owner=editorSelectedAsset,node=editorSelectedNode;
  if(owner.sourceType==='scene'&&node===owner.root)return;
  if(node!==owner.root){
    if(owner.sourceType==='scene'){
      setEditorStatus('Встроенный компонент нельзя удалить отдельно: скрой его через Visibility или измени исходную модель.',true);
      return;
    }
    if(node.parent)node.parent.remove(node);
    disposeEditorComponent(node);
    owner.meta.modelDirty=true;
    markClientProjectDirty('удаление компонента модели');
    persistImportedEditorAsset(owner).catch(error=>console.warn('Не удалось сохранить удаление компонента:',error));
    refreshEditorAssetList(owner.id);
    setEditorStatus('Удалён компонент: '+editorNodeLabel(node));
    return;
  }
  if(owner.sourceType==='scene')return;
  if(owner.id===state.activeTerrainAssetId)resetImportedTerrain({rebuildForest:false});
  scene.remove(owner.root);disposeObjectTree(owner.root);
  state.importedAssets=state.importedAssets.filter(asset=>asset!==owner);
  markClientProjectDirty('удаление модели');
  deleteSceneAssetLocally(owner.id).catch(error=>console.warn('Не удалось удалить модель из локального хранилища:',error));
  refreshEditorAssetList();setEditorStatus('Удалена модель: '+owner.name);
});
document.getElementById('saveSceneConfig').addEventListener('click',exportSceneEditorConfig);
document.getElementById('applyEditorPreset').addEventListener('click',applyEditorMaterialPreset);
document.getElementById('importEditorTexture').addEventListener('click',()=>document.getElementById('editorTextureFileInput').click());
document.getElementById('editorTextureFileInput').addEventListener('change',event=>{
  const file=event.target.files?.[0];if(file)importEditorTextureFile(file);event.target.value='';
});
document.getElementById('clearEditorTexture').addEventListener('click',clearEditorTextureMap);
document.querySelectorAll('[data-texture-import]').forEach(button=>{
  button.addEventListener('click',()=>{
    document.getElementById('editorTextureType').value=button.dataset.textureImport;
    document.getElementById('editorTextureFileInput').click();
  });
});
document.querySelectorAll('[data-texture-remove]').forEach(button=>{
  button.addEventListener('click',()=>{
    document.getElementById('editorTextureType').value=button.dataset.textureRemove;
    clearEditorTextureMap();
  });
});
document.getElementById('exportSelectedGlb').addEventListener('click',exportSelectedAssetGlb);
const sceneConfigFileInput=document.getElementById('sceneConfigFileInput');
document.getElementById('loadSceneConfig').addEventListener('click',()=>sceneConfigFileInput.click());
sceneConfigFileInput.addEventListener('change',event=>{
  const file=event.target.files?.[0];if(file)loadSceneEditorConfigFile(file);event.target.value='';
});
const editorPickRaycaster=new THREE.Raycaster();
const editorPickNdc=new THREE.Vector2();
renderer.domElement.addEventListener('click',event=>{
  // The follow-up click event is for the spawn tool, not an Inspector pick.
  if(performance.now()-lastSkierSpawnPlacementPointerAt<700){
    lastSkierSpawnPlacementPointerAt=0;
    return;
  }
  if(!appRoot.classList.contains('editor-open')||state.mode!=='overview'||event.button!==0)return;
  const rect=renderer.domElement.getBoundingClientRect();
  if(!rect.width||!rect.height)return;
  editorPickNdc.x=((event.clientX-rect.left)/rect.width)*2-1;
  editorPickNdc.y=-((event.clientY-rect.top)/rect.height)*2+1;
  editorPickRaycaster.setFromCamera(editorPickNdc,camera);
  const roots=[state.root,...state.importedAssets.map(asset=>asset.root)].filter(Boolean);
  const hit=editorPickRaycaster.intersectObjects(roots,true).find(entry=>entry.object.isMesh);
  if(!hit){
    setEditorStatus('Объект не найден под курсором. Кликни по видимой поверхности или выбери объект из списка.',true);
    return;
  }
  const hitMaterials=editorNodeMaterialList(hit.object);
  const hitMaterialIndex=Number.isInteger(hit.face?.materialIndex)?hit.face.materialIndex:0;
  const hitMaterial=hitMaterials[hitMaterialIndex]||hitMaterials[0]||null;
  let picked=null;
  const imported=state.importedAssets.find(asset=>asset.root===hit.object||asset.root.getObjectById(hit.object.id));
  if(imported)picked=getAllEditorAssets().find(asset=>asset.id===imported.id);
  if(!picked){
    let node=hit.object;
    while(node&&node!==state.root&&!node.isMesh)node=node.parent;
    if(node?.isMesh)picked=getAllEditorAssets().find(asset=>asset.sourceType==='scene'&&asset.root===node);
  }
  if(picked){
    editorObjectSelect.value=picked.id;
    if(hitMaterial){
      // Select the whole asset as the editing context, then isolate the hit material's faces.
      selectEditorNode(picked,picked.root,-1,hitMaterial);
      pulseEditorSelection(picked.root,hitMaterial);
    }else if(imported){
      selectEditorNode(picked,hit.object);
      pulseEditorSelection(hit.object);
    }else{
      selectEditorAsset(picked.id);
      pulseEditorSelection(picked.root);
    }
  }
});
refreshEditorAssetList();

const skierModeButton = document.getElementById('skierMode');
const modeSwitchIcon=skierModeButton.querySelector('.mode-switch-icon');
const droneModeButton=document.getElementById('droneModeButton');
const speedValueEl = document.getElementById('speedValue');
const slopeValueEl = document.getElementById('slopeValue');
const accelerationValueEl = document.getElementById('accelerationValue');
const snowFrictionInput = document.getElementById('snowFriction');
const snowFrictionValueEl = document.getElementById('snowFrictionValue');
const groundStateEl = document.getElementById('groundState');
const skierViewStatusEl = document.getElementById('skierViewStatus');
const outsideSkiLoadValueEl=document.getElementById('outsideSkiLoadValue');
const insideSkiLoadValueEl=document.getElementById('insideSkiLoadValue');
const outsideSkiLoadBarEl=document.getElementById('outsideSkiLoadBar');
const totalSkiLoadValueEl=document.getElementById('totalSkiLoadValue');
const skierLockHintEl = document.getElementById('skierLockHint');
const droneLockHintEl=document.getElementById('droneLockHint'),droneSpeedValueEl=document.getElementById('droneSpeedValue');
let overviewSnapshot = null;
let skierPhysicsSurfaceCache={key:'',root:null};
let skierPerformanceRestore=null;
let pendingSceneMode = null;
let skierModePreparing = false;
let modeCameraTransition = null;
const runtimePerformance={
  fps:0,frameMs:0,skierUpdateMs:0,renderMs:0,
  frameCount:0,fpsWindowStarted:performance.now(),fpsWindowFrames:0
};

function beginModeCameraTransition(fromPosition,fromQuaternion){
  if(!fromPosition||!fromQuaternion)return;
  const destinationPosition=camera.position.clone();
  const destinationQuaternion=camera.quaternion.clone();
  const distance=fromPosition.distanceTo(destinationPosition);
  const angle=fromQuaternion.angleTo(destinationQuaternion);
  if(distance<0.08&&angle<0.012){modeCameraTransition=null;return;}
  modeCameraTransition={
    fromPosition:fromPosition.clone(),
    fromQuaternion:fromQuaternion.clone(),
    targetPosition:destinationPosition,
    targetQuaternion:destinationQuaternion,
    elapsed:0,
    duration:THREE.MathUtils.clamp(0.48+Math.sqrt(distance)*0.095,0.48,1.08)
  };
}

function prepareModeCameraTransitionFrame(){
  const transition=modeCameraTransition;
  if(!transition)return;
  // Let the active controller update from its unblended camera state.
  camera.position.copy(transition.targetPosition);
  camera.quaternion.copy(transition.targetQuaternion);
  camera.updateMatrixWorld(true);
}

function advanceModeCameraTransition(dt){
  const transition=modeCameraTransition;
  if(!transition)return;
  // Track the live camera produced by the destination controller this frame.
  transition.targetPosition.copy(camera.position);
  transition.targetQuaternion.copy(camera.quaternion);
  transition.elapsed+=dt;
  const linear=THREE.MathUtils.clamp(transition.elapsed/transition.duration,0,1);
  const eased=linear*linear*(3-2*linear);
  camera.position.lerpVectors(transition.fromPosition,transition.targetPosition,eased);
  camera.quaternion.copy(transition.fromQuaternion).slerp(transition.targetQuaternion,eased);
  camera.updateMatrixWorld(true);
  if(linear>=1){
    camera.position.copy(transition.targetPosition);
    camera.quaternion.copy(transition.targetQuaternion);
    camera.updateMatrixWorld(true);
    modeCameraTransition=null;
  }
}

const skierController = new SkierController({
  camera,
  domElement: renderer.domElement,
  scene,
  onHud: ({speed,slope,grounded,airborne=false,acceleration=0,snowMu=0.045,pushing=false,tuck=false,cameraView='first',outsideSkiLoadN=0,insideSkiLoadN=0,totalSkiLoadN=0,outsideLoadShare=0.5,massKg=75}) => {
    appRoot.classList.toggle('tuck-mode',tuck);
    const windIntensity=Math.max(0.18,Math.min(0.92,0.18+speed/48));
    appRoot.style.setProperty('--ski-wind-opacity',String(tuck?windIntensity:0));
    appRoot.style.setProperty('--ski-wind-duration',Math.max(0.34,1.05-speed*0.018)+'s');
    skierViewStatusEl.textContent=cameraView==='third'?'3-Е ЛИЦО':'1-Е ЛИЦО';
    speedValueEl.textContent = String(Math.round(speed*3.6));
    const mobileSpeed=document.getElementById('mobileSpeedValue');if(mobileSpeed)mobileSpeed.textContent=String(Math.round(speed*3.6));
    slopeValueEl.textContent = Number(slope).toFixed(1);
    accelerationValueEl.textContent = Number(acceleration).toFixed(2);
    snowFrictionValueEl.textContent = Number(snowMu).toFixed(3);
    const outsideShare=Math.max(0,Math.min(1,Number(outsideLoadShare)||0.5));
    const insideShare=1-outsideShare;
    outsideSkiLoadValueEl.textContent='Внешняя '+Math.round(outsideShare*100)+'% · '+Math.round(outsideSkiLoadN)+' N';
    insideSkiLoadValueEl.textContent='Внутренняя '+Math.round(insideShare*100)+'% · '+Math.round(insideSkiLoadN)+' N';
    outsideSkiLoadBarEl.style.width=(outsideShare*100).toFixed(1)+'%';
    totalSkiLoadValueEl.textContent='Суммарная нагрузка '+Math.round(totalSkiLoadN)+' N · масса '+Number(massKg).toFixed(0)+' кг';
    groundStateEl.textContent = airborne?'ПРЫЖОК':(pushing?'ТОЛЧОК':(grounded?(tuck?'Скоростная стойка':'Обычная езда'):'НЕТ КОНТАКТА'));
    groundStateEl.style.color = airborne?'#a8d8ff':(pushing?'#f3cf79':(grounded?(tuck?'#a8d8ff':'#82d6a6'):'#f3cf79'));
  },
  onPointerLock: locked => {
    skierLockHintEl.textContent = locked
      ? 'Мышь захвачена · ESC освобождает курсор'
      : 'Кликни по сцене, чтобы снова захватить мышь';
  }
});
const droneController=new DroneController({
  camera,domElement:renderer.domElement,terrainProvider:()=>state.terrain,
  onPointerLock:locked=>{droneLockHintEl.textContent=locked?'Мышь захвачена · ESC освобождает курсор':'Кликни по сцене, чтобы снова захватить мышь';},
  onHud:({speed})=>{droneSpeedValueEl.textContent=String(Math.round(speed*3.6));const mobileSpeed=document.getElementById('mobileSpeedValue');if(mobileSpeed)mobileSpeed.textContent=String(Math.round(speed*3.6));}
});

const multiplayerStatusElement=document.getElementById('multiplayerStatus');
const multiplayerStatusTextElement=document.getElementById('multiplayerStatusText');
function getMultiplayerName(){
  const key='gradeOptimizerMultiplayerName';
  try{
    const saved=String(localStorage.getItem(key)||'').trim();
    if(saved){
      const clean=Array.from(saved.replace(/[\u0000-\u001f\u007f<>&"']/g,'')).slice(0,20).join('');
      return clean||'Лыжник';
    }
    const generated='Лыжник '+String(Math.floor(1000+Math.random()*9000));
    localStorage.setItem(key,generated);
    return generated;
  }catch(error){return 'Лыжник';}
}
let multiplayerPoseCacheRoot=null,multiplayerPoseNodes=[];
const REMOTE_SKIER_POSE_NODES=[
  'Skier_Pelvis_Pivot','Skier_Upper_Body',
  'Skier_Leg_Left','Skier_Knee_Left','Skier_Leg_Right','Skier_Knee_Right',
  'Skier_Arm_Left','Skier_Elbow_Left','Ski_Pole_Left',
  'Skier_Arm_Right','Skier_Elbow_Right','Ski_Pole_Right'
];
function buildMultiplayerState(){
  let mode='overview',position=camera.position,quaternion=camera.quaternion;
  let velocity=new THREE.Vector3(),pose=[];
  if(state.mode==='skier'&&skierController.active&&skierController.skiRig){
    mode='skier';
    position=skierController.skiRig.position;
    quaternion=skierController.skiRig.quaternion;
    velocity=skierController.velocity.clone();
    if(skierController.airborneWorldY!==null)velocity.y=skierController.airborneVelocityY;
    const avatar=skierController.skierAvatar;
    if(multiplayerPoseCacheRoot!==avatar){
      multiplayerPoseCacheRoot=avatar;
      multiplayerPoseNodes=REMOTE_SKIER_POSE_NODES.map(name=>avatar?.getObjectByName(name)||null);
    }
    for(const node of multiplayerPoseNodes){
      if(node)pose.push(node.position.x,node.position.y,node.position.z,node.rotation.x,node.rotation.y,node.rotation.z);
      else pose.push(0,0,0,0,0,0);
    }
  }else if(state.mode==='drone'&&droneController.active){
    mode='drone';
    position=camera.position;
    quaternion=camera.quaternion;
    velocity=droneController.velocity;
  }
  return {mode,p:position.toArray(),q:quaternion.toArray(),v:velocity.toArray(),pose};
}
const multiplayerClient=new ResortMultiplayer({
  scene,endpoint:MULTIPLAYER_SERVER_URL,name:getMultiplayerName(),
  statusElement:multiplayerStatusElement,statusTextElement:multiplayerStatusTextElement,
  templateProvider:()=>({skierAvatar:skierController.skierAvatar,skiRig:skierController.skiRig}),
  poseNodeNames:REMOTE_SKIER_POSE_NODES
});
multiplayerClient.connect();
multiplayerStatusElement.title='В обзоре: двойной клик по земле ставит пронумерованный флажок; двойной клик по своему флажку удаляет его. Номер отображается над флажком. Линейка синхронизируется со всеми участниками.';
const sharedFlagRaycaster=new THREE.Raycaster();
const sharedFlagPointer=new THREE.Vector2();
const sharedFlagNormalMatrix=new THREE.Matrix3();
function placeSharedFlagFromOverviewClick(event){
  if(state.mode!=='overview'||event.button!==0||event.target!==renderer.domElement)return;
  if(appRoot.classList.contains('editor-open')||appRoot.classList.contains('optimizer-open'))return;
  if(document.getElementById('measureBtn')?.classList.contains('active'))return;
  const rect=renderer.domElement.getBoundingClientRect();
  if(rect.width<2||rect.height<2)return;
  sharedFlagPointer.set(
    ((event.clientX-rect.left)/rect.width)*2-1,
    -((event.clientY-rect.top)/rect.height)*2+1
  );
  camera.updateMatrixWorld(true);
  sharedFlagRaycaster.setFromCamera(sharedFlagPointer,camera);
  // Double-clicking a shared flag removes it instead of planting another flag underneath.
  const markerEntries=[...multiplayerClient.markers.entries()];
  const markerTargets=markerEntries.map(([,marker])=>marker.group);
  const markerHit=sharedFlagRaycaster.intersectObjects(markerTargets,true)[0];
  if(markerHit){
    let markerRoot=markerHit.object;
    while(markerRoot&&!markerRoot.userData?.gradeOptimizerSharedMarkerId)markerRoot=markerRoot.parent;
    const markerId=String(markerRoot?.userData?.gradeOptimizerSharedMarkerId||'');
    if(markerId&&multiplayerClient.ownedMarkers.has(markerId))multiplayerClient.removeOwnedMarker(markerId);
    return;
  }
  // Use the same complete visible geometry set as Overview focus and the measuring tool.
  const pickTargets=getOverviewGeometryTargets();
  if(!pickTargets.length)return;
  const hits=sharedFlagRaycaster.intersectObjects(pickTargets,false);
  const hit=hits.find(item=>item.object?.isMesh&&item.face&&item.distance>0.2&&item.distance<1800);
  if(!hit)return;
  const normal=hit.face.normal.clone().applyMatrix3(
    sharedFlagNormalMatrix.getNormalMatrix(hit.object.matrixWorld)
  ).normalize();
  const point=hit.point.clone().addScaledVector(normal,0.12);
  multiplayerClient.addMarker(point);
}
// Flag placement is handled by the existing overview double-click / double-tap focus handlers.
// Keep network state publication independent from the render loop: heavy scene
// rendering must not throttle the other players' position updates.
const clearMyFlagsButton=document.getElementById('clearMyFlags');
if(clearMyFlagsButton){
  const updateClearMyFlagsButton=()=>{clearMyFlagsButton.disabled=multiplayerClient.ownedMarkers.size===0;};
  clearMyFlagsButton.addEventListener('click',()=>multiplayerClient.clearOwnedMarkers());
  multiplayerClient.onMarkersChanged=updateClearMyFlagsButton;
  updateClearMyFlagsButton();
}
const multiplayerPublishTimer=window.setInterval(()=>multiplayerClient.publish(buildMultiplayerState()),33);
window.addEventListener('pagehide',()=>{
  window.clearInterval(multiplayerPublishTimer);
  multiplayerClient.dispose();
},{once:true});

const mobileControlsLayer=document.getElementById('mobileControls');
const mobileModeHint=document.getElementById('mobileModeHint');
const mobileSpeedBox=document.getElementById('mobileSpeedBox');
const mobileMoveStick=document.getElementById('mobileMoveStick');
const mobileLookStick=document.getElementById('mobileLookStick');
const mobileTouchQuery=window.matchMedia('(pointer: coarse) and (max-width: 900px), (pointer: coarse) and (max-height: 520px)');
const mobileTouch={enabled:false,moveX:0,moveY:0,lookX:0,lookY:0};
const mobileHeldKeys=new Set();

function setMobileControllerKey(key,pressed){
  const controller=state.mode==='skier'?skierController:state.mode==='drone'?droneController:null;
  if(!controller)return;
  if(pressed)controller.keys.add(key);else controller.keys.delete(key);
  if(pressed)mobileHeldKeys.add(key);else mobileHeldKeys.delete(key);
}
function clearMobileTouchInput(){
  [...mobileHeldKeys].forEach(key=>{skierController.keys.delete(key);droneController.keys.delete(key);});
  mobileHeldKeys.clear();
  mobileTouch.moveX=mobileTouch.moveY=mobileTouch.lookX=mobileTouch.lookY=0;
  [mobileMoveStick,mobileLookStick].forEach(stick=>{
    if(stick){stick.style.setProperty('--stick-x','0px');stick.style.setProperty('--stick-y','0px');}
  });
  mobileControlsLayer?.querySelectorAll('.mobile-actions button.is-pressed').forEach(button=>button.classList.remove('is-pressed'));
}
function updateMobileMoveKeys(x,y){
  mobileTouch.moveX=x;mobileTouch.moveY=y;
  const desired={a:x<-.22,d:x>.22,w:y<-.22,s:y>.22};
  Object.entries(desired).forEach(([key,pressed])=>{
    const previous=mobileHeldKeys.has(key);
    if(pressed&&!previous)setMobileControllerKey(key,true);
    else if(!pressed&&previous)setMobileControllerKey(key,false);
  });
}
function bindMobileStick(element,kind){
  if(!element)return;
  let pointerId=null;
  const reset=()=>{
    pointerId=null;
    element.style.setProperty('--stick-x','0px');element.style.setProperty('--stick-y','0px');
    if(kind==='move')updateMobileMoveKeys(0,0);
    else{mobileTouch.lookX=0;mobileTouch.lookY=0;}
  };
  const update=event=>{
    const rect=element.getBoundingClientRect();
    const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
    const radius=Math.max(22,rect.width*0.29);
    let dx=(event.clientX-cx)/radius,dy=(event.clientY-cy)/radius;
    const length=Math.hypot(dx,dy);
    if(length>1){dx/=length;dy/=length;}
    element.style.setProperty('--stick-x',(dx*radius).toFixed(1)+'px');
    element.style.setProperty('--stick-y',(dy*radius).toFixed(1)+'px');
    if(kind==='move')updateMobileMoveKeys(dx,dy);
    else{mobileTouch.lookX=dx;mobileTouch.lookY=dy;}
  };
  element.addEventListener('pointerdown',event=>{
    if(!mobileTouch.enabled||pointerId!==null)return;
    event.preventDefault();pointerId=event.pointerId;
    try{element.setPointerCapture(pointerId);}catch(error){}
    update(event);
  });
  element.addEventListener('pointermove',event=>{
    if(event.pointerId!==pointerId)return;
    event.preventDefault();update(event);
  });
  const finish=event=>{
    if(event.pointerId!==pointerId)return;
    event.preventDefault();reset();
  };
  element.addEventListener('pointerup',finish);
  element.addEventListener('pointercancel',finish);
  element.addEventListener('lostpointercapture',()=>{if(pointerId!==null)reset();});
}
bindMobileStick(mobileMoveStick,'move');
bindMobileStick(mobileLookStick,'look');

mobileControlsLayer?.querySelectorAll('[data-mobile-key],[data-mobile-action]').forEach(button=>{
  let pointerId=null;
  const finish=event=>{
    if(pointerId===null||(event&&event.pointerId!==undefined&&event.pointerId!==pointerId))return;
    const key=button.dataset.mobileKey;
    if(key!==undefined&&mobileHeldKeys.has(key))setMobileControllerKey(key,false);
    button.classList.remove('is-pressed');pointerId=null;
  };
  button.addEventListener('pointerdown',event=>{
    if(!mobileTouch.enabled||pointerId!==null)return;
    event.preventDefault();event.stopPropagation();pointerId=event.pointerId;
    try{button.setPointerCapture(pointerId);}catch(error){}
    button.classList.add('is-pressed');
    if(button.dataset.mobileKey!==undefined)setMobileControllerKey(button.dataset.mobileKey,true);
    const action=button.dataset.mobileAction;
    if(action==='jump'&&state.mode==='skier'&&skierController.active)skierController._tryManualJump();
    if(action==='camera'&&state.mode==='skier'&&skierController.active)skierController.toggleCameraView();
  });
  button.addEventListener('pointerup',finish);
  button.addEventListener('pointercancel',finish);
  button.addEventListener('lostpointercapture',()=>finish());
});

function updateMobileDeviceMode(){
  const enabled=mobileTouchQuery.matches;
  if(mobileTouch.enabled!==enabled)clearMobileTouchInput();
  mobileTouch.enabled=enabled;
  appRoot.classList.toggle('mobile-mode',enabled);
  skierController.touchMode=enabled;droneController.touchMode=enabled;
  controls.enableZoom=enabled;controls.enablePan=true;
  controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
  if(enabled){
    controls.zoomSpeed=0.85;renderer.domElement.style.touchAction='none';
    skierLockHintEl.textContent='Управляй стиками на экране · справа — поворот камеры';
    droneLockHintEl.textContent='Левый стик — полёт · правый — направление камеры';
  }else{
    renderer.domElement.style.touchAction='';controls.zoomSpeed=1;
  }
}
function updateMobileModeHint(){
  if(!mobileModeHint)return;
  const labels={
    overview:'ОБЗОР · 1 палец — вращение · 2 пальца — масштаб',
    skier:'ЛЕВЫЙ СТИК — поворот / стойка · ПРАВЫЙ — камера',
    drone:'ЛЕВЫЙ СТИК — полёт · ПРАВЫЙ — камера'
  };
  mobileModeHint.textContent=labels[state.mode]||labels.overview;
  if(mobileSpeedBox)mobileSpeedBox.hidden=state.mode==='overview';
}
updateMobileDeviceMode();
window.addEventListener('resize',updateMobileDeviceMode,{passive:true});
window.addEventListener('orientationchange',()=>requestAnimationFrame(updateMobileDeviceMode),{passive:true});
mobileTouchQuery.addEventListener?.('change',updateMobileDeviceMode);


const LOCAL_ASSET_DB_NAME='grade-optimizer-local-assets';
function openLocalAssetDatabase(){
  if(!window.indexedDB)return Promise.reject(new Error('Локальное хранилище браузера недоступно.'));
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(LOCAL_ASSET_DB_NAME,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains('models'))db.createObjectStore('models');
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||new Error('Не удалось открыть локальное хранилище.'));
  });
}
async function saveSceneAssetLocally(asset){
  if(!asset?.sourceBuffer)return;
  const db=await openLocalAssetDatabase();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('models','readwrite');
      const record={
        buffer:asset.sourceBuffer.slice(0),
        name:asset.name,
        meta:{...asset.meta},
        sourcePath:asset.sourcePath||null,
        nodeVisibility:collectEditorNodeVisibility(asset.root),
        nodeMetadata:collectEditorNodeMetadata(asset.root),
        visible:asset.root.visible,
        transform:{
          position:asset.root.position.toArray(),
          rotation:[asset.root.rotation.x,asset.root.rotation.y,asset.root.rotation.z],
          scale:asset.root.scale.toArray()
        }
      };
      tx.objectStore('models').put(record,'scene-asset:'+asset.id);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error('Не удалось сохранить GLB-модель.'));
      tx.onabort=()=>reject(tx.error||new Error('Сохранение GLB-модели отменено.'));
    });
  }finally{db.close();}
}
async function persistImportedEditorAsset(asset){
  if(!asset||asset.sourceType==='scene'||!asset.sourceBuffer)return;
  if(currentClientSlug&&clientWorkspaceReady){
    markClientProjectDirty('изменения импортированной модели');
    return;
  }
  if(asset.meta?.modelDirty){
    asset.sourceBuffer=await exportAssetForClientPublish(asset);
    asset.meta.sourceFile=slugAssetName(asset.name)+'.glb';
    asset.meta.modelDirty=false;
  }
  await saveSceneAssetLocally(asset);
}
async function deleteSceneAssetLocally(id){
  const db=await openLocalAssetDatabase();
  try{
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('models','readwrite');
      tx.objectStore('models').delete('scene-asset:'+id);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error||new Error('Не удалось удалить GLB-модель.'));
      tx.onabort=()=>reject(tx.error||new Error('Удаление GLB-модели отменено.'));
    });
  }finally{db.close();}
}
async function restoreSceneAssetsLocally(){
  const db=await openLocalAssetDatabase();
  let records=[];
  try{
    records=await new Promise((resolve,reject)=>{
      const tx=db.transaction('models','readonly');
      const request=tx.objectStore('models').openCursor();
      const found=[];
      request.onsuccess=()=>{
        const cursor=request.result;
        if(!cursor){resolve(found);return;}
        if(String(cursor.key).startsWith('scene-asset:'))found.push({key:String(cursor.key),record:cursor.value});
        cursor.continue();
      };
      request.onerror=()=>reject(request.error||new Error('Не удалось прочитать локальные модели.'));
      tx.onabort=()=>reject(tx.error||new Error('Чтение локальных моделей отменено.'));
    });
  }finally{db.close();}
  let restored=0;
  for(const entry of records){
    const record=entry.record;
    if(!record?.buffer)continue;
    try{
      const buffer=record.buffer.slice(0);
      const model=await parseSceneModel(buffer,record.meta?.sourceFile||'model.glb');
      const root=model.scene||model.scenes?.[0];
      if(!root)throw new Error('Модель не содержит сцены.');
      captureEditorNodeVisibilityDefaults(root);
      const id=entry.key.slice('scene-asset:'.length);
      const meta={...(record.meta||{}),id,name:record.name||root.name||id};
      if(record.transform?.position)root.position.fromArray(record.transform.position);
      if(record.transform?.rotation)root.rotation.set(...record.transform.rotation);
      if(record.transform?.scale)root.scale.fromArray(record.transform.scale);
      root.visible=record.visible!==false;
      applyEditorNodeVisibility(root,record.nodeVisibility||[]);
      applyEditorNodeMetadata(root,record.nodeMetadata||[]);
      root.name=meta.name;
      root.userData.resortAssetId=id;
      root.userData.resortAsset={...meta};
      root.traverse(object=>{
        if(object.isMesh){object.castShadow=true;object.receiveShadow=true;}
      });
      scene.add(root);
      state.importedAssets.push({id,name:meta.name,root,meta,sourceType:'imported',sourceBuffer:buffer,sourcePath:record.sourcePath||null});
      restored++;
    }catch(error){
      console.warn('Не удалось восстановить '+(record.name||entry.key)+':',error);
    }
  }
  refreshEditorAssetList();
  updateTerrainResetControl();
  if(restored)setEditorStatus('Восстановлено из этого браузера: '+restored+' GLB-моделей.');
  return restored;
}
const modeHudElements={
  skier:document.getElementById('skierHud'),
  drone:document.getElementById('droneHud')
};
let modeHudFitFrame=0;
function fitModeHudToViewport(){
  const hud=modeHudElements[state.mode];
  if(!hud||!view.clientHeight||hud.offsetParent===null)return;
  hud.style.transform='none';
  const naturalHeight=hud.offsetHeight;
  if(!naturalHeight)return;
  const compactViewport=window.matchMedia('(max-width:720px)').matches;
  const bottomOffset=compactViewport?8:16;
  const availableHeight=Math.max(1,view.clientHeight-bottomOffset-12);
  const scale=Math.min(1,availableHeight/naturalHeight);
  hud.style.transformOrigin='bottom left';
  hud.style.transform=scale<0.999?'scale('+scale.toFixed(4)+')':'none';
}
function scheduleModeHudFit(){
  if(modeHudFitFrame)cancelAnimationFrame(modeHudFitFrame);
  modeHudFitFrame=requestAnimationFrame(()=>{
    modeHudFitFrame=0;
    fitModeHudToViewport();
  });
}
if(typeof ResizeObserver!=='undefined'){
  const modeHudResizeObserver=new ResizeObserver(scheduleModeHudFit);
  modeHudResizeObserver.observe(view);
  Object.values(modeHudElements).forEach(hud=>modeHudResizeObserver.observe(hud));
}
window.addEventListener('resize',scheduleModeHudFit,{passive:true});
snowFrictionInput.addEventListener('input',e=>{
  skierController.setSnowFriction(parseFloat(e.target.value));
});

function resizeSceneAfterModeChange() {
  scheduleViewportResize();
  requestAnimationFrame(() => {
    scheduleViewportResize();
    scheduleModeHudFit();
  });
}

function captureOverviewSnapshot(){
  if(overviewSnapshot)return;
  overviewSnapshot={
    position:camera.position.clone(),quaternion:camera.quaternion.clone(),target:controls.target.clone(),
    terrainVisible:state.terrain?.visible??true,
    materials:state.terrainMats.map(m=>[m,m.opacity,m.transparent]),
    groups:[state.designGroup,state.labelsGroup,state.terrainLabelsGroup,measureGroup].filter(Boolean).map(g=>[g,g.visible])
  };
}
function applySkierPerformanceProfile(){
  if(skierPerformanceRestore)return;
  skierPerformanceRestore={
    cameraOpticsEnabled:cameraOptics.enabled,
    shadowMapEnabled:renderer.shadowMap.enabled,
    pixelRatio:renderer.getPixelRatio()
  };
  cameraOptics.setOptions({enabled:false});
  renderer.shadowMap.enabled=false;
  const performanceRatio=Math.min(skierPerformanceRestore.pixelRatio,Math.min(window.devicePixelRatio||1,0.9));
  if(Math.abs(performanceRatio-skierPerformanceRestore.pixelRatio)>0.001){
    renderer.setPixelRatio(performanceRatio);
    renderer.setSize(view.clientWidth,view.clientHeight,false);
  }
}
function restoreSkierPerformanceProfile(){
  if(!skierPerformanceRestore)return;
  cameraOptics.setOptions({enabled:skierPerformanceRestore.cameraOpticsEnabled});
  renderer.shadowMap.enabled=skierPerformanceRestore.shadowMapEnabled;
  renderer.setPixelRatio(skierPerformanceRestore.pixelRatio);
  renderer.setSize(view.clientWidth,view.clientHeight,false);
  skierPerformanceRestore=null;
}
function restoreOverviewPresentation(){
  restoreSkierPerformanceProfile();
  if(!overviewSnapshot)return;
  if(state.terrain)state.terrain.visible=overviewSnapshot.terrainVisible;
  (overviewSnapshot.materials||[]).forEach(([m,opacity,transparent])=>{m.opacity=opacity;m.transparent=transparent;});
  (overviewSnapshot.groups||[]).forEach(([group,visible])=>{group.visible=visible;});
}
function applySkierPresentation(){
  captureOverviewSnapshot();
  (overviewSnapshot.groups||[]).forEach(([group])=>{group.visible=false;});
  if(state.terrain)state.terrain.visible=true;
  (overviewSnapshot.materials||[]).forEach(([m])=>{m.opacity=1;m.transparent=false;});
  applySkierPerformanceProfile();
}
function updateModeSwitcher(){
  const isDrone=state.mode==='drone';
  modeSwitchIcon.innerHTML=isDrone?'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10h8l2 4H6l2-4Z"/><path d="M12 10V6M9 6h6M6 8 3 6M18 8l3-2M6 15l-2 2M18 15l2 2"/><circle cx="3" cy="5" r="1.8"/><circle cx="21" cy="5" r="1.8"/><circle cx="4" cy="18" r="1.8"/><circle cx="20" cy="18" r="1.8"/></svg>':'⛷';
  skierModeButton.setAttribute('aria-label',isDrone?'Переключиться на режим лыжника':'Переключиться на режим дрона');
  skierModeButton.title=isDrone?'Переключить на лыжника':'Переключить на дрон';
  skierModeButton.classList.toggle('active',state.mode==='skier');
  droneModeButton.classList.toggle('active',state.mode==='drone');
  overviewModeButton.classList.toggle('active',state.mode==='overview');
  const cameraSaveButton=document.getElementById('saveOverviewCamera');
  if(cameraSaveButton){
    const canSave=state.mode==='overview'&&!!state.root&&clientWorkspaceReady;
    cameraSaveButton.disabled=!canSave;
    cameraSaveButton.classList.toggle('saved',!!state.savedOverviewCameras?.[String(state.slope)]);
    cameraSaveButton.title=canSave?'Сохранить стартовый ракурс обзора':'Доступно после загрузки сцены и проекта в режиме «Обзор»';
  }
  updateMobileModeHint();
  applySlopeAnalysisLayerVisibility();
  updateSkierSpawnOverlayVisibility();
  updateSkierSpawnPanel();
}
function applyModeWeatherDefault(mode){const light=WeatherSystem.PRESETS.light;weatherSystem.setCustom({clouds:light.clouds,snowfall:mode==='overview'?0:0.16,wind:mode==='overview'?light.wind:5});updateDaylight(state.dayTime);updateWeatherControls();persistWeatherSettings();}
function isPreferredStageOneSkierSlopeAsset(asset){
  if(!asset?.root||asset.root.visible===false||asset.meta?.visible===false)return false;
  const names=[asset.name,asset.root.name,asset.meta?.name,asset.meta?.sourceFile];
  return names.some(value=>{
    const normalized=String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'_');
    return normalized.includes('slopes_stage1')||normalized.includes('slopes_stage_1');
  });
}
function createSkierPhysicsSurface(roots){
  const unique=[...new Set(roots.filter(Boolean))];
  if(!unique.length)return null;
  unique.forEach(root=>root.updateWorldMatrix(true,true));
  if(unique.length===1)return unique[0];
  const key=unique.map(root=>root.uuid+'|'+root.matrixWorld.elements.map(value=>Number(value.toFixed(5))).join(',')).join(';');
  if(skierPhysicsSurfaceCache.key===key&&skierPhysicsSurfaceCache.root)return skierPhysicsSurfaceCache.root;
  const composite=new THREE.Group();
  composite.name='GO_SkierPhysicsTerrainComposite';
  composite.userData.isSkierPhysicsComposite=true;
  for(const source of unique){
    const copy=source.clone(true);
    copy.matrixAutoUpdate=false;
    copy.matrix.copy(source.matrixWorld);
    copy.matrixWorldNeedsUpdate=true;
    composite.add(copy);
  }
  composite.updateMatrixWorld(true);
  skierPhysicsSurfaceCache={key,root:composite};
  return composite;
}
function resolveSkierTerrain(){
  const hasGeometry=root=>{
    if(!root||typeof root.traverse!=='function')return false;
    let found=false;
    root.traverse(object=>{
      if(object.isMesh&&object.geometry?.attributes?.position)found=true;
    });
    if(!found)return false;
    root.updateWorldMatrix(true,true);
    return !new THREE.Box3().setFromObject(root).isEmpty();
  };

  const roots=[];
  const preferredSlope=state.importedAssets.find(asset=>
    isPreferredStageOneSkierSlopeAsset(asset)&&hasGeometry(asset.root)
  );
  if(preferredSlope)roots.push(preferredSlope.root);
  if(hasGeometry(state.terrain))roots.push(state.terrain);
  if(hasGeometry(state.baseTerrain))roots.push(state.baseTerrain);

  if(!roots.length&&state.root){
    state.root.updateWorldMatrix(true,true);
    const named=[],meshes=[];
    state.root.traverse(object=>{
      if(!object.isMesh||!object.geometry?.attributes?.position)return;
      const name=(object.name||'').toLowerCase();
      if(name.includes('terrain'))named.push(object);
      else meshes.push(object);
    });
    const terrain=[...named,...meshes].find(hasGeometry)||null;
    if(terrain){
      state.terrain=terrain;
      if(!state.baseTerrain)state.baseTerrain=terrain;
      droneController.setTerrain(terrain);
      roots.push(terrain);
    }
  }

  const activeAsset=state.importedAssets.find(asset=>asset.id===state.activeTerrainAssetId);
  if(!roots.length&&activeAsset&&hasGeometry(activeAsset.root)){
    state.terrain=activeAsset.root;
    droneController.setTerrain(activeAsset.root);
    roots.push(activeAsset.root);
  }
  return createSkierPhysicsSurface(roots);
}

const droneSpawnSurfaceRaycaster=new THREE.Raycaster();
const droneSpawnSurfaceDown=new THREE.Vector3(0,-1,0);
const droneSpawnSurfaceOrigin=new THREE.Vector3();
function hasTerrainSurfaceAtWorldXZ(terrain,position){
  if(!terrain||!position)return false;
  terrain.updateWorldMatrix(true,true);
  const bounds=new THREE.Box3().setFromObject(terrain);
  if(bounds.isEmpty())return false;
  const x=Number(position.x),z=Number(position.z);
  if(!Number.isFinite(x)||!Number.isFinite(z)||
     x<bounds.min.x||x>bounds.max.x||z<bounds.min.z||z>bounds.max.z)return false;
  const size=bounds.getSize(new THREE.Vector3());
  const rayTop=Math.max(bounds.max.y+Math.max(100,size.y*0.1),Number(position.y||0)+10);
  droneSpawnSurfaceOrigin.set(x,rayTop,z);
  droneSpawnSurfaceRaycaster.set(droneSpawnSurfaceOrigin,droneSpawnSurfaceDown);
  droneSpawnSurfaceRaycaster.near=0;
  droneSpawnSurfaceRaycaster.far=Math.max(1000,rayTop-bounds.min.y+100);
  return droneSpawnSurfaceRaycaster.intersectObject(terrain,true).some(hit=>hit.object?.isMesh);
}
function resolveSkierTerrainForDroneSpawn(position){
  const preferred=resolveSkierTerrain();
  if(!preferred)return null;
  if(hasTerrainSurfaceAtWorldXZ(preferred,position))return preferred;
  const originalTerrain=state.baseTerrain;
  if(originalTerrain&&originalTerrain!==preferred&&hasTerrainSurfaceAtWorldXZ(originalTerrain,position)){
    dbg('ЛЫЖНИК: вне Slopes_Stage1 — использую исходный Terrain под дроном.');
    return originalTerrain;
  }
  return preferred;
}
async function setSceneMode(mode){
  if(!['overview','skier','drone'].includes(mode)||state.mode==='loading'||skierModePreparing)return;
  if(mode!=='overview'&&treeAreaDrawing)stopTreeAreaDrawing();
  if(mode!=='overview'&&skierSpawnPlacementStep)cancelSkierSpawnPlacement();
  clearMobileTouchInput();
  if(mode===state.mode&&(mode==='overview'||(mode==='skier'&&skierController.active)||(mode==='drone'&&droneController.active)))return;
  const previousMode=state.mode;
  const handoffCameraPose=(previousMode!==mode&&['skier','drone'].includes(previousMode)&&['skier','drone'].includes(mode))
    ?{position:camera.position.clone(),quaternion:camera.quaternion.clone()}
    :null;
  const dronePose=previousMode==='drone'?{
    position:camera.position.clone(),yaw:camera.rotation.y,pitch:camera.rotation.x,
    velocity:droneController.velocity.clone()
  }:null;
  const requestedTerrain=mode==='skier'
    ?(dronePose?resolveSkierTerrainForDroneSpawn(dronePose.position):resolveSkierTerrain())
    :null;
  if(mode==='skier'&&!requestedTerrain){
    if(sceneLoadingEl.getClientRects().length>0){
      pendingSceneMode='skier';
      dbg('ЛЫЖНИК: сцена ещё загружается — запрос сохранён до появления mesh.');
    }else{
      const rootInfo=state.root?'{root loaded, but no valid terrain mesh}':'{scene root not loaded}';
      const message='ЛЫЖНИК: не найден mesh рельефа '+rootInfo+'.';
      dbg(message);skierLockHintEl.textContent=message;showModeSwitchFeedback(message);
    }
    return;
  }
  if(mode!=='overview'){
    if(appRoot.classList.contains('editor-open')){
      appRoot.classList.remove('editor-open');editorToggleButton.classList.remove('active');
      editorToggleButton.setAttribute('aria-expanded','false');if(editorSelectionHelper)editorSelectionHelper.visible=false;
    }
    appRoot.classList.remove('optimizer-open');optimizerToggleButton.classList.remove('active');state.optimizeMode=false;
    captureOverviewSnapshot();
  }

  if(previousMode==='skier'){
    if(mode==='drone')skierController.showForDrone();
    restoreSkierPerformanceProfile();
    skierController.stop({keepSceneModel:mode==='drone'});
  }
  if(previousMode==='drone'){
    droneController.stop();
    if(mode==='overview')skierController.hideForOverview();
  }

  if(mode==='skier'){
    const terrain=requestedTerrain;
    if(!terrain){
      const message='ЛЫЖНИК: рельеф ещё не загружен.';
      dbg(message);skierLockHintEl.textContent=message;
      if(previousMode==='drone'&&dronePose){
        camera.position.copy(dronePose.position);camera.rotation.order='YXZ';
        camera.rotation.set(dronePose.pitch,dronePose.yaw,0,'YXZ');
        droneController.start();controls.enabled=false;labelRenderer.domElement.style.display='';
        appRoot.classList.add('drone-mode');appRoot.classList.remove('skier-mode');
        state.mode='drone';updateModeSwitcher();resizeSceneAfterModeChange();return;
      }
      if(overviewSnapshot){
        restoreOverviewPresentation();
        camera.position.copy(overviewSnapshot.position);camera.quaternion.copy(overviewSnapshot.quaternion);
        controls.target.copy(overviewSnapshot.target);overviewSnapshot=null;
      }
      state.mode='overview';controls.enabled=true;labelRenderer.domElement.style.display='';
      appRoot.classList.remove('skier-mode','drone-mode');updateModeSwitcher();resizeSceneAfterModeChange();return;
    }

    if(!state.terrain&&!terrain.userData?.isSkierPhysicsComposite)state.terrain=terrain;
    applySkierPresentation();
    skierModePreparing=true;
    let skierStarted=false;
    try{
      // Wait briefly for the server-assigned slot. This avoids spawning several
      // visitors into slot 0 while their WebSocket welcome packet is in flight.
      const receivedSlot=dronePose?null:await multiplayerClient.waitForSlot(1800);
      const multiplayerSlot=Number.isInteger(receivedSlot)?receivedSlot:multiplayerClient.getSpawnSlot();
      const spawnHint=dronePose?{
        position:dronePose.position,yaw:dronePose.yaw,velocity:dronePose.velocity,fromDrone:true,multiplayerSlot
      }:{multiplayerSlot};
      // Keep the current scene interactive while the terrain index is prepared.
      // Mouse look is captured by the existing canvas click handler once ready.
      skierStarted=await skierController.start(terrain,spawnHint,{requestPointerLock:false});
    }catch(error){
      console.error('Не удалось запустить физику лыжника:',error);
      skierController.lastStartError='START_EXCEPTION';
      skierController.lastStartDiagnostics={message:error?.message||String(error),stack:error?.stack||''};
      const message='ЛЫЖНИК: ошибка запуска — '+(error?.message||String(error));
      dbg(message);showModeSwitchFeedback(message);
    }finally{
      skierModePreparing=false;
    }

    if(!skierStarted){
      skierController.stop();
      restoreOverviewPresentation();
      const reason=skierController.lastStartError||'UNKNOWN';
      const detail=skierController.lastStartDiagnostics?JSON.stringify(skierController.lastStartDiagnostics):'нет данных';
      const message='ЛЫЖНИК: запуск отклонён ('+reason+'). Диагностика: '+detail;
      dbg(message);skierLockHintEl.textContent=message;showModeSwitchFeedback(message);
      if(previousMode==='drone'&&dronePose){
        camera.position.copy(dronePose.position);camera.rotation.order='YXZ';
        camera.rotation.set(dronePose.pitch,dronePose.yaw,0,'YXZ');
        droneController.start();controls.enabled=false;labelRenderer.domElement.style.display='';
        appRoot.classList.add('drone-mode');appRoot.classList.remove('skier-mode');
        state.mode='drone';updateModeSwitcher();resizeSceneAfterModeChange();return;
      }
      if(overviewSnapshot){
        camera.position.copy(overviewSnapshot.position);camera.quaternion.copy(overviewSnapshot.quaternion);
        controls.target.copy(overviewSnapshot.target);overviewSnapshot=null;
      }
      state.mode='overview';controls.enabled=true;labelRenderer.domElement.style.display='';
      appRoot.classList.remove('skier-mode','drone-mode');updateModeSwitcher();resizeSceneAfterModeChange();return;
    }

    controls.enabled=false;labelRenderer.domElement.style.display='none';
    appRoot.classList.add('skier-mode');appRoot.classList.remove('drone-mode');
  }else if(mode==='drone'){
    if(previousMode==='skier'){
      restoreOverviewPresentation();
      camera.position.y+=3;
    }
    droneController.start();controls.enabled=false;labelRenderer.domElement.style.display='';
    appRoot.classList.add('drone-mode');appRoot.classList.remove('skier-mode');
  }else{
    if(overviewSnapshot){
      restoreOverviewPresentation();
      camera.position.copy(overviewSnapshot.position);camera.quaternion.copy(overviewSnapshot.quaternion);
      controls.target.copy(overviewSnapshot.target);overviewSnapshot=null;
    }
    controls.enabled=true;labelRenderer.domElement.style.display='';
    appRoot.classList.remove('skier-mode','drone-mode');controls.update();
  }

  state.mode=mode;
  if(handoffCameraPose)beginModeCameraTransition(handoffCameraPose.position,handoffCameraPose.quaternion);
  applyModeWeatherDefault(mode);updateModeSwitcher();resizeSceneAfterModeChange();clearModeSwitchFeedback();
  updateTreeAreaOverlayVisibility();
}
function respawnSkierAtSpawnSlot(slot){
  if(state.mode!=='skier'||!skierController.active||skierModePreparing)return false;
  const spawn=state.skierSpawns?.[String(slot)];
  if(!spawn)return false;
  const spawned=skierController.respawnAtCustomSpawn({...spawn,slot:String(slot)});
  if(!spawned){
    const message='СПАУН '+slot+': точка не подходит для старта — проверь уклон и свободный участок вниз по склону.';
    skierLockHintEl.textContent=message;showModeSwitchFeedback(message);
    return false;
  }
  const message='Слот '+slot+' · spawn установлен · клавиша '+slot;
  skierLockHintEl.textContent=message;
  dbg('ЛЫЖНИК: spawn slot '+slot+' · '+JSON.stringify(skierController.lastSpawnInfo?.position||[]));
  clearModeSwitchFeedback();
  return true;
}

async function respawnSkierAtStageOneSummit(){
  if(state.mode!=='skier'||!skierController.active||skierModePreparing)return false;
  const terrain=resolveSkierTerrain();
  if(!terrain||terrain!==skierController.terrain){
    const message='СПАУН: Slopes_Stage1 не является текущей поверхностью лыжника.';
    dbg(message);skierLockHintEl.textContent=message;showModeSwitchFeedback(message);
    return false;
  }
  const spawned=skierController.respawnAtTop();
  if(!spawned){
    const message='СПАУН: не удалось найти пригодную стартовую точку на вершине Slopes_Stage1.';
    dbg(message);skierLockHintEl.textContent=message;showModeSwitchFeedback(message);
    return false;
  }
  skierLockHintEl.textContent='Slopes_Stage1 · спаун на вершине выполнен · клавиша 1';
  dbg('ЛЫЖНИК: спаун на вершине Slopes_Stage1 · '+JSON.stringify(skierController.lastSpawnInfo?.position||[]));
  return true;
}

window.__GRADE_OPTIMIZER_MODE_API=Object.freeze({
  set(mode){
    setSceneMode(mode);
    if(pendingSceneMode===mode)return 'pending';
    if(state.mode!==mode){
      const reason=skierController.lastStartError||(!state.root?'SCENE_ROOT_MISSING':'TERRAIN_NOT_RESOLVED');
      const detail=skierController.lastStartDiagnostics?JSON.stringify(skierController.lastStartDiagnostics):'';
      return 'failed:'+state.mode+':'+reason+(detail?':'+detail:'');
    }
    return state.mode;
  },
  get(){return state.mode;},
  toggle(){const current=state.mode;return this.set(current==='drone'?'skier':current==='skier'?'drone':'skier');},
  respawnTop(){return respawnSkierAtStageOneSummit();},
  respawnSpawn(slot){return respawnSkierAtSpawnSlot(String(slot));},
  diagnostics(){return {mode:state.mode,terrain:!!state.terrain,baseTerrain:!!state.baseTerrain,treeAreaCount:state.treeAreas.length,treeAreas:normalizeTreeAreas(state.treeAreas),treeAreaDrawing,skierSpawns:normalizeSkierSpawnMap(state.skierSpawns),skierSpawnDrawing:skierSpawnPlacementStep,root:!!state.root,skierTerrainName:skierController.terrain?.name||null,skierSpawn:skierController.lastSpawnInfo,startError:skierController.lastStartError,start:skierController.lastStartDiagnostics,skierModePreparing,controlsEnabled:controls.enabled,sceneLoadingVisible:sceneLoadingEl.getClientRects().length>0,terrainPerformance:skierController.getTerrainPerformanceDiagnostics(),skierInput:skierController.diagnostics(),multiplayer:multiplayerClient.diagnostics(),runtimePerformance:{...runtimePerformance}};}
});
overviewModeButton.addEventListener('click',()=>{
  if(state.optimizeMode)setOptimizerOpen(false);
  setSceneMode('overview');
});
document.getElementById('exitSkier').addEventListener('click',()=>setSceneMode('overview'));
document.getElementById('exitDrone').addEventListener('click',()=>setSceneMode('overview'));
document.getElementById('skierSwitchDrone').addEventListener('click',()=>setSceneMode('drone'));
document.getElementById('droneSwitchSkier').addEventListener('click',()=>setSceneMode('skier'));

const tutorialPanels={
  skier:{content:document.getElementById('skierTutorialContent'),button:document.getElementById('toggleSkierTutorial')},
  drone:{content:document.getElementById('droneTutorialContent'),button:document.getElementById('toggleDroneTutorial')}
};
function setTutorialVisible(mode,visible){
  const panel=tutorialPanels[mode];
  if(!panel||!panel.content||!panel.button)return;
  panel.content.hidden=!visible;
  panel.content.style.setProperty('display',visible?'grid':'none','important');
  panel.button.setAttribute('aria-expanded',String(visible));
  const label=panel.button.querySelector('.tutorial-toggle-label');
  if(label)label.textContent=visible?'Скрыть':'Показать';
  panel.button.title=(visible?'Скрыть':'Показать')+' туториал · H';
  scheduleModeHudFit();
}
for(const mode of ['skier','drone']){
  const panel=tutorialPanels[mode];
  panel.button.addEventListener('click',()=>setTutorialVisible(mode,panel.content.hidden));
}
function getSkierSpawnKeyFromEvent(event){
  const code=String(event?.code||'');
  if(/^Digit[0-9]$/.test(code)||/^Numpad[0-9]$/.test(code))return code.slice(-1);
  const key=String(event?.key||'');
  return /^[0-9]$/.test(key)?key:'';
}
document.addEventListener('keydown',e=>{
  if(e.code==='KeyH'&&(state.mode==='skier'||state.mode==='drone')){
    e.preventDefault();e.stopPropagation();
    if(!e.repeat)setTutorialVisible(state.mode,tutorialPanels[state.mode].content.hidden);
    return;
  }
  if(skierSpawnPlacementStep&&e.code==='Escape'){
    e.preventDefault();e.stopPropagation();
    cancelSkierSpawnPlacement();
    return;
  }
  if(state.mode==='overview')return;
  if(state.mode==='loading')return;
  const eventTarget=e.target;
  const editingText=!!(eventTarget?.isContentEditable||/^(INPUT|TEXTAREA)$/.test(eventTarget?.tagName||''));
  if(!editingText&&state.mode==='skier'){
    const spawnKey=getSkierSpawnKeyFromEvent(e);
    if(spawnKey&&state.skierSpawns?.[spawnKey]){
      e.preventDefault();e.stopPropagation();
      if(!e.repeat)respawnSkierAtSpawnSlot(spawnKey);
      return;
    }
    if(spawnKey==='1'){
      e.preventDefault();e.stopPropagation();
      if(!e.repeat)respawnSkierAtStageOneSummit();
      return;
    }
  }
  if(e.code==='KeyQ'||(e.key||'').toLowerCase()==='q'){e.preventDefault();e.stopPropagation();setSceneMode('overview');}
},true);
updateModeSwitcher();
updateTreeAreaPanel();
renderTreeAreaOverlays();
updateSkierSpawnPanel();
renderSkierSpawnOverlays();

loadSlopeList().then(async first=>{
  const clientInput=document.getElementById('clientWorkspaceId');
  if(clientInput)clientInput.value=currentClientSlug;
  if(RESTORE_LOCAL_PROJECT_DRAFT){
    try{await restoreSceneAssetsLocally();}
    catch(error){console.warn('Не удалось проверить локальные черновики моделей для переноса в GitHub:',error);}
  }
  await loadSlope(first);
  if(currentClientSlug)await openClientWorkspace(currentClientSlug,{updateUrl:false});
});
let previousFrameTime = performance.now();
(function loop(){
  requestAnimationFrame(loop);
  const now = performance.now();
  if(document.hidden){
    previousFrameTime=now;
    if(state.mode==='skier')skierController.keys.clear();
    if(state.mode==='drone')droneController.keys.clear();
    return;
  }
  const dt = Math.min(Math.max((now-previousFrameTime)/1000,0),0.04);
  previousFrameTime = now;
  if(state.autoTime){
    state.dayTime += dt*0.16;
    if(state.dayTime >= 24) state.dayTime = 0;
    timeSlider.value = String(state.dayTime);
    timeValue.textContent = formatClock(state.dayTime);
    const compactTimeValue=document.getElementById('timeCompactValue');if(compactTimeValue)compactTimeValue.textContent=formatClock(state.dayTime);
    updateDaylight(state.dayTime);
  }
  if(modeCameraTransition)prepareModeCameraTransitionFrame();
  if(mobileTouch.enabled&&state.mode==='skier'&&skierController.active){
    skierController.lookYaw=THREE.MathUtils.clamp(skierController.lookYaw-mobileTouch.lookX*1.65*dt,-1.5,1.5);
    skierController.lookPitch=THREE.MathUtils.clamp(skierController.lookPitch-mobileTouch.lookY*1.25*dt,-0.58,0.45);
  }
  if(mobileTouch.enabled&&state.mode==='drone'&&droneController.active){
    droneController.yaw-=mobileTouch.lookX*1.05*dt;
    droneController.pitch=THREE.MathUtils.clamp(droneController.pitch-mobileTouch.lookY*0.88*dt,-1.25,1.25);
  }
  if(state.mode==='skier'){
    const skierUpdateStarted=performance.now();
    skierController.update(dt);
    runtimePerformance.skierUpdateMs=performance.now()-skierUpdateStarted;
  }else runtimePerformance.skierUpdateMs=0;
  if(state.mode==='drone')droneController.update(dt);
  if(modeCameraTransition)advanceModeCameraTransition(dt);
  if(state.mode === 'overview' && targetDist!==null){
    const dir=new THREE.Vector3().subVectors(camera.position,controls.target);
    const cur=dir.length();
    const nd=THREE.MathUtils.lerp(cur,targetDist,0.15);
    if(Math.abs(nd-targetDist)<0.5)targetDist=null;
    camera.position.copy(controls.target).addScaledVector(dir.normalize(),nd);
  }
  if(controls.enabled) controls.update();
  if(editorSelectionHelper&&editorSelectionHelper.visible)editorSelectionHelper.update();
  updateEditorSelectionPulses(now);
  multiplayerClient.update(dt,state.mode);
  weatherSystem.update(dt,camera.position,state.mode==='overview'?controls.target:camera.position);
  updateForestBillboards();
  let opticsFocusTarget = controls.target;
  if (state.mode !== 'overview') {
    camera.getWorldDirection(opticsFocusDirection);
    opticsFocusPoint.copy(camera.position).addScaledVector(opticsFocusDirection, state.mode === 'skier' ? 32 : 85);
    opticsFocusTarget = opticsFocusPoint;
  }
  const renderStarted=performance.now();
  cameraOptics.render(dt, weatherSystem.sunGlow, opticsFocusTarget);
  updateSlopeAnalysisAngleLabelVisibility();
  if(labelRenderer.domElement.style.display !== 'none') labelRenderer.render(scene,camera);
  runtimePerformance.renderMs=performance.now()-renderStarted;
  runtimePerformance.frameMs=performance.now()-now;
  runtimePerformance.frameCount++;
  runtimePerformance.fpsWindowFrames++;
  const fpsElapsed=now-runtimePerformance.fpsWindowStarted;
  if(fpsElapsed>=1000){
    runtimePerformance.fps=runtimePerformance.fpsWindowFrames*1000/fpsElapsed;
    runtimePerformance.fpsWindowFrames=0;
    runtimePerformance.fpsWindowStarted=now;
  }
})();

const materialLibraryTitlebar=document.getElementById('materialLibraryTitlebar');
materialLibraryTitlebar.addEventListener('pointerdown',event=>{
  if(event.target.closest('button'))return;
  const rect=materialLibraryWindow.getBoundingClientRect();
  const startX=event.clientX,startY=event.clientY;
  const move=moveEvent=>{
    const left=Math.max(8,Math.min(window.innerWidth-100,rect.left+moveEvent.clientX-startX));
    const top=Math.max(8,Math.min(window.innerHeight-90,rect.top+moveEvent.clientY-startY));
    materialLibraryWindow.style.left=left+'px';
    materialLibraryWindow.style.top=top+'px';
    materialLibraryWindow.style.right='auto';
  };
  const stop=()=>{
    document.removeEventListener('pointermove',move);
    document.removeEventListener('pointerup',stop);
  };
  document.addEventListener('pointermove',move);
  document.addEventListener('pointerup',stop,{once:true});
});
