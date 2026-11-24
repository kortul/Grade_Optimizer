// Shared solar clock for the standalone Atmosphere and Forest labs.
// A single equinox-style sun path drives the sky, key light, twilight and night fill.
// The hour angle rotates the sun across the sky; it is not a fixed-azimuth vertical arc.
export function calculateSolarCycle(THREE,hours,azimuthOffsetDegrees=0){
  const hour=((Number(hours)%24)+24)%24;
  const phase=(hour-6)/12*Math.PI;
  const altitude=Math.sin(phase)*1.25;
  const azimuth=phase-Math.PI/2+THREE.MathUtils.degToRad(azimuthOffsetDegrees);
  const horizontal=Math.cos(altitude);
  const sunDirection=new THREE.Vector3(
    horizontal*Math.cos(azimuth),
    Math.sin(altitude),
    horizontal*Math.sin(azimuth)
  ).normalize();
  const daylight=THREE.MathUtils.smoothstep(sunDirection.y,-0.08,0.22);
  const sunrise=Math.exp(-Math.pow((hour-6.85)/1.45,2));
  const sunset=Math.exp(-Math.pow((hour-18.10)/1.55,2));
  const warm=THREE.MathUtils.clamp(Math.max(sunrise,sunset),0,1);
  const nightStrength=1-THREE.MathUtils.smoothstep(sunDirection.y,-0.10,0.18);
  const twilight=THREE.MathUtils.clamp(warm*(0.58+(1-daylight)*0.42),0,1);
  const sunColor=new THREE.Color(0xffa775).lerp(
    new THREE.Color(0xfff4e5),
    1-warm*0.78
  );
  return {hour,phase,altitude,azimuth,sunDirection,daylight,nightStrength,warm,twilight,sunColor};
}

export function advanceSolarClock(hours,deltaSeconds,dayLengthMinutes){
  const durationSeconds=Math.max(60,Number(dayLengthMinutes)*60||600);
  const deltaHours=Math.max(0,Number(deltaSeconds)||0)*24/durationSeconds;
  return (((Number(hours)||0)+deltaHours)%24+24)%24;
}

export function createSolarDisc(THREE){
  const canvas=document.createElement('canvas');
  canvas.width=128;
  canvas.height=128;
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Cannot create the solar disc texture.');
  const gradient=context.createRadialGradient(64,64,0,64,64,62);
  gradient.addColorStop(0,'rgba(255,255,250,1)');
  gradient.addColorStop(0.66,'rgba(255,247,225,1)');
  gradient.addColorStop(0.86,'rgba(255,226,190,0.96)');
  gradient.addColorStop(1,'rgba(255,206,160,0)');
  context.fillStyle=gradient;
  context.fillRect(0,0,128,128);
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.magFilter=THREE.LinearFilter;
  texture.generateMipmaps=true;
  const material=new THREE.SpriteMaterial({
    map:texture,
    color:0xffffff,
    transparent:true,
    opacity:0,
    depthTest:false,
    depthWrite:false,
    blending:THREE.NormalBlending,
    toneMapped:true
  });
  const sprite=new THREE.Sprite(material);
  sprite.name='GO_TunableSolarDisc';
  sprite.scale.setScalar(240);
  sprite.renderOrder=-950;
  sprite.frustumCulled=false;
  sprite.visible=false;
  return sprite;
}

export function updateSolarDisc(THREE,sprite,camera,cycle,intensity){
  if(!sprite||!cycle||!camera)return;
  const visibility=THREE.MathUtils.smoothstep(cycle.sunDirection.y,-0.055,0.035);
  const power=THREE.MathUtils.clamp(Number(intensity)||0,0,1.5);
  const opacity=THREE.MathUtils.clamp(power/1.15,0,0.88)*visibility;
  sprite.visible=opacity>0.002;
  sprite.material.opacity=opacity;
  sprite.material.color.copy(cycle.sunColor);
  sprite.position.copy(camera.position).addScaledVector(cycle.sunDirection,30000);
  sprite.scale.setScalar(240+cycle.twilight*24);
}
