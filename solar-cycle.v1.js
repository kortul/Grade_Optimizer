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
