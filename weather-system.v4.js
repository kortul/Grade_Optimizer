/*
 * Grade Optimizer — sky, AI cloud atlas and volumetric weather.
 * Volumetric cloud and fog layers use density shaders; non-volume mode keeps a lightweight fallback.
 */

const CLOUD_VOLUME_VERTEX_SHADER = \`
varying vec3 vWorldPosition;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}\`;
const CLOUD_VOLUME_FRAGMENT_SHADER = \`
uniform float uTime;
uniform float uCoverage;
uniform float uWind;
uniform float uDaylight;
uniform float uTwilight;
uniform float uRayStrength;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uCameraPosition;
varying vec3 vWorldPosition;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise2(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float a=hash21(i), b=hash21(i+vec2(1.0,0.0));
  float c=hash21(i+vec2(0.0,1.0)), d=hash21(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float fbm2(vec2 p) {
  float sum=0.0, amp=0.52;
  for(int i=0;i<4;i++){sum+=noise2(p)*amp;p=p*2.03+vec2(17.1,9.2);amp*=0.48;}
  return sum/0.91;
}
void main() {
  vec2 drift=vec2(uTime*(0.014+uWind*0.00020),uTime*(0.006+uWind*0.00010));
  vec2 p=vWorldPosition.xz*0.00034-drift;
  float broad=fbm2(p), detail=fbm2(p*2.72+vec2(11.7,-4.1));
  float threshold=0.72-uCoverage*0.43;
  float field=smoothstep(threshold,threshold+0.19,broad+(detail-0.5)*0.22);
  float baseVariation=noise2(p*0.34+vec2(3.4,8.1));
  float topVariation=noise2(p*0.47+vec2(-7.3,4.8));
  float baseHeight=0.12+baseVariation*0.12;
  float topHeight=0.76+topVariation*0.20;
  float integratedDensity=0.0;
  for(int i=0;i<12;i++){
    float h=(float(i)+0.5)/12.0;
    float lowerShape=smoothstep(baseHeight,baseHeight+0.17,h);
    float upperShape=1.0-smoothstep(topHeight-0.16,topHeight,h);
    float billow=0.82+detail*0.36+(1.0-abs(h-0.52))*0.12;
    integratedDensity+=field*lowerShape*upperShape*billow/12.0;
  }
  if(integratedDensity<0.002) discard;
  float shadowOpticalDepth=0.0;
  for(int i=1;i<=4;i++){
    vec2 lightSample=p+uSunDirection.xz*(float(i)*0.23);
    float lightDensity=fbm2(lightSample);
    shadowOpticalDepth+=smoothstep(threshold,threshold+0.15,lightDensity)*0.22;
  }
  float sunlightTransmittance=exp(-shadowOpticalDepth*1.58);
  float alpha=(1.0-exp(-integratedDensity*12.0))*(0.24+uCoverage*0.43);
  alpha=clamp(alpha,0.0,0.72);
  if(alpha<0.012) discard;
  vec3 viewDirection=normalize(uCameraPosition-vWorldPosition);
  float forwardScatter=pow(max(dot(viewDirection,normalize(uSunDirection)),0.0),7.0);
  vec3 coolUnderside=mix(vec3(0.075,0.105,0.16),vec3(0.34,0.42,0.51),uDaylight);
  vec3 sunlitCloud=uSunColor*(0.36+sunlightTransmittance*0.68);
  vec3 cloudColor=mix(coolUnderside,sunlitCloud,clamp(0.24+uDaylight*0.58,0.0,0.92));
  cloudColor*=0.76+sunlightTransmittance*0.34;
  cloudColor+=uSunColor*forwardScatter*uRayStrength*1.65;
  cloudColor=mix(cloudColor,vec3(1.0,0.48,0.42),uTwilight*(0.08+field*0.12));
  gl_FragColor=vec4(cloudColor,alpha);
}\`;
const GROUND_FOG_VERTEX_SHADER = CLOUD_VOLUME_VERTEX_SHADER;
const GROUND_FOG_FRAGMENT_SHADER = \`
uniform float uTime;
uniform float uDensity;
uniform float uWind;
uniform float uDaylight;
uniform float uTwilight;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uCameraPosition;
varying vec3 vWorldPosition;
float fogHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float fogNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  float a=fogHash(i),b=fogHash(i+vec2(1.0,0.0));
  float c=fogHash(i+vec2(0.0,1.0)),d=fogHash(i+vec2(1.0,1.0));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float fogFbm(vec2 p){
  float sum=0.0,amp=0.55;
  for(int i=0;i<4;i++){sum+=fogNoise(p)*amp;p=p*2.08+vec2(9.3,-5.7);amp*=0.47;}
  return sum/0.91;
}
void main(){
  vec2 drift=vec2(uTime*(0.020+uWind*0.00026),uTime*(0.009+uWind*0.00012));
  vec2 p=vWorldPosition.xz*0.00105-drift;
  float broad=fogFbm(p*0.82),detail=fogFbm(p*3.2+vec2(7.4,2.2));
  float patches=smoothstep(0.28,0.68,broad+(detail-0.5)*0.17);
  float integratedDensity=0.0;
  for(int i=0;i<14;i++){
    float h=(float(i)+0.5)/14.0;
    float verticalFalloff=exp(-h*3.15)*smoothstep(0.015,0.12,h);
    float rolling=0.84+0.16*fogNoise(p*5.1+vec2(h*2.8,-h*4.2));
    integratedDensity+=patches*verticalFalloff*rolling/14.0;
  }
  if(integratedDensity<0.0015) discard;
  float alpha=(1.0-exp(-integratedDensity*15.0))*uDensity;
  alpha=clamp(alpha,0.0,0.50);
  if(alpha<0.008) discard;
  float viewSun=pow(max(dot(normalize(uCameraPosition-vWorldPosition),normalize(uSunDirection)),0.0),2.0);
  vec3 nightFog=vec3(0.14,0.19,0.28),dayFog=vec3(0.72,0.81,0.86);
  vec3 fogColor=mix(nightFog,dayFog,uDaylight);
  fogColor=mix(fogColor,uSunColor*0.88,uTwilight*0.24+viewSun*0.08);
  gl_FragColor=vec4(fogColor,alpha);
}\`;

export class WeatherSystem {
  static PRESETS = {
    clear:    { label: 'Ясно', clouds: 0.00, snowfall: 0,    wind: 2,  visibility: 1.00 },
    light:    { label: 'Ясно · лёгкие облака', clouds: 0.18, snowfall: 0,    wind: 3,  visibility: 0.99 },
    partly:   { label: 'Переменная облачность', clouds: 0.34, snowfall: 0,    wind: 5,  visibility: 0.96 },
    cloudy:   { label: 'Облачно', clouds: 0.66, snowfall: 0,    wind: 9,  visibility: 0.86 },
    overcast: { label: 'Пасмурно', clouds: 0.96, snowfall: 0,    wind: 13, visibility: 0.73 },
    snow:     { label: 'Снегопад', clouds: 0.76, snowfall: 0.62, wind: 18, visibility: 0.55 },
    blizzard: { label: 'Метель', clouds: 1.00, snowfall: 0.96, wind: 46, visibility: 0.25 }
  };

  constructor({ THREE, scene, camera, hemisphere, sun, fogNear = 1800, fogFar = 9000 }) {
    this.THREE = THREE;
    this.scene = scene;
    this.camera = camera;
    this.hemisphere = hemisphere;
    this.sun = sun;
    this.baseFogNear = fogNear;
    this.baseFogFar = fogFar;
    this.sunDirection = new THREE.Vector3(0, 1, 0);
    this.cameraPosition = new THREE.Vector3();
    // Snow is camera-space geometry, but the camera itself is not part of the
    // scene graph. A separate scene-root rig follows the camera transform so
    // the renderer always traverses and draws the snowfall / wind streaks.
    this.cameraWeatherRig = new THREE.Group();
    this.cameraWeatherRig.name = 'GO_CameraWeatherRig';
    this.scene.add(this.cameraWeatherRig);
    this.cameraWeatherRig.position.copy(camera.position);
    this.cameraWeatherRig.quaternion.copy(camera.quaternion);
    this.elapsed = 0;
    this.params = { ...WeatherSystem.PRESETS.light, preset: 'light', groundFog: false, volumetrics: true };
    this.lastSkyColors = null;
    this.nightCloudColor = new THREE.Color(0x536477);
    this.dayCloudColor = new THREE.Color(0xf2f5f7);
    this.mutedCloudColor = new THREE.Color(0xc4d0d9);

    this.skyCanvas = document.createElement('canvas');
    this.skyCanvas.width = 2048;
    this.skyCanvas.height = 1024;
    this.skyContext = this.skyCanvas.getContext('2d', { alpha: false });
    // Use the equirectangular canvas directly as the scene background.
    // There is deliberately no sky-dome mesh or enclosing sphere geometry.
    this.skyTexture = new THREE.CanvasTexture(this.skyCanvas);
    this.skyTexture.colorSpace = THREE.SRGBColorSpace;
    this.skyTexture.mapping = THREE.EquirectangularReflectionMapping;
    this.skyTexture.minFilter = THREE.LinearFilter;
    this.skyTexture.magFilter = THREE.LinearFilter;
    this.previousSceneBackground = this.scene.background;
    this.scene.background = this.skyTexture;

    this.sunTexture = this.makeSunTexture();
    this.sunMaterial = new THREE.SpriteMaterial({
      map: this.sunTexture,
      color: 0xfff0d1,
      transparent: true,
      opacity: 0.62,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false
    });
    this.sunGlow = new THREE.Sprite(this.sunMaterial);
    this.sunGlow.name = 'GO_SunGlow';
    this.sunGlow.scale.set(880, 880, 1);
    this.sunGlow.renderOrder = -950;
    this.scene.add(this.sunGlow);

    this.cloudFallbackTexture = this.makeCloudTexture();
    this.cloudMaterials = Array.from({ length: 9 }, () => new THREE.SpriteMaterial({
      map: this.cloudFallbackTexture, color: 0xffffff, transparent: true,
      opacity: 0.68, alphaTest: 0.012, depthWrite: false, depthTest: true,
      fog: false, toneMapped: false
    }));
    this.cloudAtlasTexture = new THREE.TextureLoader().load(
      new URL('./assets/cloud-atlas.v1.png', import.meta.url).href,
      texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        this.cloudMaterials.forEach((material,index) => {
          const map = texture.clone();
          const column = index % 3, row = Math.floor(index / 3);
          map.wrapS = THREE.ClampToEdgeWrapping;
          map.wrapT = THREE.ClampToEdgeWrapping;
          map.repeat.set(1/3,1/3);
          map.offset.set(column/3,1-(row+1)/3);
          map.colorSpace = THREE.SRGBColorSpace;
          map.minFilter = THREE.LinearMipmapLinearFilter;
          map.magFilter = THREE.LinearFilter;
          map.generateMipmaps = true;
          map.needsUpdate = true;
          material.map = map;
          material.needsUpdate = true;
        });
      },
      undefined,
      error => console.warn('AI cloud atlas load failed; keeping procedural fallback.',error)
    );
    this.clouds = [];
    let seed = 0x5a17c9;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const goldenAngle = Math.PI * (3-Math.sqrt(5));
    for(let i=0;i<48;i++){
      const azimuth=i*goldenAngle+random()*0.28;
      const elevation=0.055+random()*0.33;
      const radius=8300+random()*1500;
      const horizontal=Math.cos(elevation)*radius;
      const offset=new THREE.Vector3(Math.cos(azimuth)*horizontal,Math.sin(elevation)*radius,Math.sin(azimuth)*horizontal);
      const cloudType=Math.floor(random()*this.cloudMaterials.length);
      const sprite=new THREE.Sprite(this.cloudMaterials[cloudType]);
      sprite.name='GO_Cloud_'+String(i+1).padStart(2,'0');
      const width=1050+random()*1650;
      const height=width*(0.54+random()*0.12);
      sprite.scale.set(width,height,1);
      sprite.renderOrder=-890;
      sprite.visible=false;
      this.scene.add(sprite);
      this.clouds.push({sprite,offset,baseX:offset.x,baseZ:offset.z,phase:random()*Math.PI*2,cloudType});
    }

    this.cloudVolumeGeometry=new THREE.PlaneGeometry(24000,24000);
    this.cloudVolumeMaterial=new THREE.ShaderMaterial({
      uniforms:{
        uTime:{value:0},uCoverage:{value:this.params.clouds},uWind:{value:this.params.wind},
        uDaylight:{value:1},uTwilight:{value:0},uRayStrength:{value:0},
        uSunDirection:{value:this.sunDirection.clone()},uSunColor:{value:new THREE.Color(0xfff0d1)},
        uCameraPosition:{value:camera.position.clone()}
      },
      vertexShader:CLOUD_VOLUME_VERTEX_SHADER,fragmentShader:CLOUD_VOLUME_FRAGMENT_SHADER,
      transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,toneMapped:false
    });
    this.cloudVolume=new THREE.Mesh(this.cloudVolumeGeometry,this.cloudVolumeMaterial);
    this.cloudVolume.name='GO_VolumetricCloudLayer';
    this.cloudVolume.rotation.x=-Math.PI/2;
    this.cloudVolume.position.y=2700;
    this.cloudVolume.frustumCulled=false;
    this.cloudVolume.renderOrder=-900;
    this.scene.add(this.cloudVolume);
    // Optional low-altitude mist.    // Optional low-altitude mist. The group starts hidden and follows the scene focus.
    this.groundFogTexture = this.makeGroundFogTexture();
    this.groundFogMaterial = new THREE.SpriteMaterial({
      map: this.groundFogTexture, color: 0xd6e4eb, transparent: true,
      opacity: 0.16, depthWrite: false, depthTest: true,
      fog: false, toneMapped: true
    });
    this.groundFogGroup = new THREE.Group();
    this.groundFogGroup.name = 'GO_GroundFog';
    this.groundFogGroup.visible = false;
    this.scene.add(this.groundFogGroup);
    this.groundFogSprites = [];
    this.groundFogAnchor = new THREE.Vector3();
    for (let i = 0; i < 12; i++) {
      const angle = i * goldenAngle + random() * 0.45;
      const radius = 280 + random() * 1850;
      const offset = new THREE.Vector3(
        Math.cos(angle) * radius, 7 + random() * 26, Math.sin(angle) * radius
      );
      const sprite = new THREE.Sprite(this.groundFogMaterial);
      sprite.name = 'GO_GroundFog_' + String(i + 1).padStart(2, '0');
      sprite.scale.set(850 + random() * 1150, 150 + random() * 170, 1);
      sprite.renderOrder = 2;
      sprite.visible = false;
      this.groundFogGroup.add(sprite);
      this.groundFogSprites.push({ sprite, offset, drift: 0.08 + random() * 0.14 });
    }

    this.groundFogVolumeGeometry=new THREE.PlaneGeometry(9000,9000);
    this.groundFogVolumeMaterial=new THREE.ShaderMaterial({
      uniforms:{
        uTime:{value:0},uDensity:{value:0.46},uWind:{value:this.params.wind},
        uDaylight:{value:1},uTwilight:{value:0},
        uSunDirection:{value:this.sunDirection.clone()},uSunColor:{value:new THREE.Color(0xfff0d1)},
        uCameraPosition:{value:camera.position.clone()}
      },
      vertexShader:GROUND_FOG_VERTEX_SHADER,fragmentShader:GROUND_FOG_FRAGMENT_SHADER,
      transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,toneMapped:false
    });
    this.groundFogVolume=new THREE.Mesh(this.groundFogVolumeGeometry,this.groundFogVolumeMaterial);
    this.groundFogVolume.name='GO_VolumetricGroundFog';
    this.groundFogVolume.rotation.x=-Math.PI/2;
    this.groundFogVolume.position.y=55;
    this.groundFogVolume.frustumCulled=false;
    this.groundFogVolume.renderOrder=3;
    this.groundFogVolume.visible=false;
    this.scene.add(this.groundFogVolume);
    this.createNightSky();

    this.snowTexture = this.makeSnowTexture();
    // Particles live in camera space and are seeded inside the visible frustum.
    // This keeps snowfall visible from every camera angle without a large world-space volume.
    this.snowCount = 2200;
    this.snowPositions = new Float32Array(this.snowCount * 3);
    this.snowVelocity = new Float32Array(this.snowCount * 2);
    const snowTanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    for (let i = 0; i < this.snowCount; i++) {
      const j = i * 3;
      const depth = 8 + random() * 62;
      const halfHeight = depth * snowTanHalfFov * 0.92;
      const halfWidth = halfHeight * (camera.aspect || 1) * 0.92;
      this.snowPositions[j] = (random() * 2 - 1) * halfWidth;
      this.snowPositions[j + 1] = (random() * 2 - 1) * halfHeight;
      this.snowPositions[j + 2] = -depth;
      this.snowVelocity[i * 2] = 0.55 + random() * 0.8;
      this.snowVelocity[i * 2 + 1] = (random() - 0.5) * 0.45;
    }
    // Instanced textured quads avoid the missing-UV issue with PointsMaterial
    // and keep all flakes in one draw call.
    this.snowGeometry = new THREE.PlaneGeometry(1, 1);
    this.snowMaterial = new THREE.MeshBasicMaterial({
      color: 0xf7fbff,
      map: this.snowTexture,
      transparent: true,
      opacity: 0.92,
      alphaTest: 0.015,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false
    });
    this.snow = new THREE.InstancedMesh(this.snowGeometry, this.snowMaterial, this.snowCount);
    this.snow.name = 'GO_Snowfall';
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 1000;
    this.snow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.snowDummy = new THREE.Object3D();
    this.snowSize = new Float32Array(this.snowCount);
    for (let i = 0; i < this.snowCount; i++) {
      const j = i * 3;
      this.snowSize[i] = 0.65 + random() * 0.9;
      this.snowDummy.position.set(this.snowPositions[j], this.snowPositions[j + 1], this.snowPositions[j + 2]);
      const size = -this.snowPositions[j + 2] * 0.0050 * this.snowSize[i];
      this.snowDummy.scale.set(size, size, 1);
      this.snowDummy.updateMatrix();
      this.snow.setMatrixAt(i, this.snowDummy.matrix);
    }
    this.snow.instanceMatrix.needsUpdate = true;
    this.activeSnowflakes = 0;
    this.snow.count = 0;
    this.snow.visible = false;
    this.cameraWeatherRig.add(this.snow);

    this.streakCount = 240;
    this.streakPositions = new Float32Array(this.streakCount * 6);
    for (let i = 0; i < this.streakCount; i++) {
      const j = i * 6;
      const depth = 9 + random() * 60;
      const halfHeight = depth * snowTanHalfFov * 0.90;
      const halfWidth = halfHeight * (camera.aspect || 1) * 0.90;
      const x = (random() * 2 - 1) * halfWidth;
      const y = (random() * 2 - 1) * halfHeight;
      const z = -depth;
      this.streakPositions[j] = x;
      this.streakPositions[j + 1] = y;
      this.streakPositions[j + 2] = z;
      this.streakPositions[j + 3] = x + 0.12;
      this.streakPositions[j + 4] = y + 0.55;
      this.streakPositions[j + 5] = z;
    }
    this.streakGeometry = new THREE.BufferGeometry();
    this.streakGeometry.setAttribute('position', new THREE.BufferAttribute(this.streakPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.streakMaterial = new THREE.LineBasicMaterial({
      color: 0xf4f9ff, transparent: true, opacity: 0.28,
      depthWrite: false, depthTest: true, fog: false
    });
    this.streaks = new THREE.LineSegments(this.streakGeometry, this.streakMaterial);
    this.streaks.name = 'GO_WindDrivenSnowStreaks';
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 1001;
    this.streakGeometry.setDrawRange(0, 0);
    this.cameraWeatherRig.add(this.streaks);

    this.applyWeather(this.params);
    this.drawSky({
      top: new THREE.Color(0x4b83b8),
      horizon: new THREE.Color(0xd6e5ef),
      bottom: new THREE.Color(0x94a9b8),
      sunColor: new THREE.Color(0xfff2d9),
      sunStrength: 1
    });
  }

  createNightSky() {
    const THREE=this.THREE;
    let seed=0x72a19d;
    const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    const count=1650,positions=new Float32Array(count*3),sizes=new Float32Array(count),phases=new Float32Array(count);
    for(let i=0;i<count;i++){
      const y=0.035+random()*0.965,angle=random()*Math.PI*2,horizontal=Math.sqrt(Math.max(0,1-y*y)),radius=9300;
      positions[i*3]=Math.cos(angle)*horizontal*radius;
      positions[i*3+1]=y*radius;
      positions[i*3+2]=Math.sin(angle)*horizontal*radius;
      sizes[i]=0.55+Math.pow(random(),2.4)*1.9;
      phases[i]=random()*Math.PI*2;
    }
    this.starsGeometry=new THREE.BufferGeometry();
    this.starsGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    this.starsGeometry.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));
    this.starsGeometry.setAttribute('aPhase',new THREE.BufferAttribute(phases,1));
    this.starsMaterial=new THREE.ShaderMaterial({
      uniforms:{uNight:{value:0},uTime:{value:0}},
      vertexShader:\`
        attribute float aSize; attribute float aPhase; uniform float uTime; varying float vAlpha;
        void main(){
          vec4 mvPosition=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mvPosition;
          float twinkle=0.82+0.18*sin(uTime*(0.7+aSize*0.18)+aPhase);
          vAlpha=twinkle*(0.50+aSize*0.25);
          gl_PointSize=clamp(aSize*(1.2+420.0/max(1.0,-mvPosition.z)),1.0,3.4);
        }\`,
      fragmentShader:\`
        uniform float uNight; varying float vAlpha;
        void main(){
          float d=length(gl_PointCoord-vec2(0.5));
          float core=1.0-smoothstep(0.08,0.34,d),halo=1.0-smoothstep(0.12,0.50,d);
          float alpha=(core*0.78+halo*0.20)*vAlpha*uNight;
          if(alpha<0.008)discard;
          gl_FragColor=vec4(vec3(0.78,0.86,1.0),alpha);
        }\`,
      transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,toneMapped:false
    });
    this.stars=new THREE.Points(this.starsGeometry,this.starsMaterial);
    this.stars.name='GO_StarField';this.stars.frustumCulled=false;this.stars.renderOrder=-1000;
    this.scene.add(this.stars);

    this.moonTexture=this.makeMoonTexture();
    this.moonGlowTexture=this.makeMoonGlowTexture();
    this.moonGlowMaterial=new THREE.SpriteMaterial({
      map:this.moonGlowTexture,color:0x91a9d2,transparent:true,opacity:0,
      depthWrite:false,depthTest:true,fog:false,toneMapped:false
    });
    this.moonGlow=new THREE.Sprite(this.moonGlowMaterial);
    this.moonGlow.name='GO_MoonGlow';this.moonGlow.scale.set(780,780,1);
    this.moonGlow.renderOrder=-956;this.moonGlow.visible=false;this.scene.add(this.moonGlow);
    this.moonMaterial=new THREE.SpriteMaterial({
      map:this.moonTexture,color:0xdde4ef,transparent:true,opacity:0,
      depthWrite:false,depthTest:true,fog:false,toneMapped:false
    });
    this.moon=new THREE.Sprite(this.moonMaterial);
    this.moon.name='GO_Moon';this.moon.scale.set(245,245,1);
    this.moon.renderOrder=-954;this.moon.visible=false;this.scene.add(this.moon);
    this.moonDirection=new THREE.Vector3(0,1,0);
  }

  makeMoonTexture() {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,256,256);
    ctx.save();ctx.beginPath();ctx.arc(128,128,113,0,Math.PI*2);ctx.clip();
    const face=ctx.createRadialGradient(88,76,8,128,128,126);
    face.addColorStop(0,'#f0f2ed');face.addColorStop(0.52,'#ccd3dc');face.addColorStop(1,'#8e9bad');
    ctx.fillStyle=face;ctx.fillRect(0,0,256,256);
    let seed=0x4f1bb5;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<58;i++){
      const x=18+random()*220,y=18+random()*220,r=2.5+random()*12,shade=Math.round(108+random()*48);
      ctx.fillStyle='rgba('+shade+','+(shade+8)+','+(shade+20)+','+(0.08+random()*0.16)+')';
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,0.12)';ctx.lineWidth=1.2;ctx.stroke();
    }
    ctx.restore();
    const texture=new this.THREE.CanvasTexture(canvas);texture.colorSpace=this.THREE.SRGBColorSpace;return texture;
  }

  makeMoonGlowTexture() {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d');
    const glow=ctx.createRadialGradient(128,128,4,128,128,126);
    glow.addColorStop(0,'rgba(190,211,255,0.38)');
    glow.addColorStop(0.18,'rgba(160,190,242,0.16)');
    glow.addColorStop(0.55,'rgba(130,164,220,0.045)');
    glow.addColorStop(1,'rgba(130,164,220,0)');
    ctx.fillStyle=glow;ctx.fillRect(0,0,256,256);
    const texture=new this.THREE.CanvasTexture(canvas);texture.colorSpace=this.THREE.SRGBColorSpace;return texture;
  }

  colorCss(color) {
    return color.getStyle(this.THREE.SRGBColorSpace);
  }

  makeSunTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 2, 128, 128, 126);
    g.addColorStop(0, 'rgba(255,255,246,1)');
    g.addColorStop(0.12, 'rgba(255,244,218,0.95)');
    g.addColorStop(0.30, 'rgba(255,219,161,0.36)');
    g.addColorStop(0.62, 'rgba(255,194,128,0.08)');
    g.addColorStop(1, 'rgba(255,190,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.colorSpace = this.THREE.SRGBColorSpace;
    return texture;
  }

  makeCloudTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    let seed = 0x5f31a7;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

    // Connected cumulus banks with cool shaded undersides and bright upper lobes.
    for (let bank = 0; bank < 7; bank++) {
      const cx = 70 + random() * 884;
      const cy = 170 + random() * 165;
      const spreadX = 95 + random() * 105;
      const spreadY = 34 + random() * 28;
      const puffs = 7 + Math.floor(random() * 8);
      const base = ctx.createLinearGradient(0, cy - 45, 0, cy + 125);
      base.addColorStop(0, 'rgba(255,255,255,0)');
      base.addColorStop(0.28, 'rgba(242,248,252,0.22)');
      base.addColorStop(0.72, 'rgba(160,181,199,0.24)');
      base.addColorStop(1, 'rgba(160,181,199,0)');
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 34, spreadX * 1.35, spreadY * 1.25, 0, 0, Math.PI * 2);
      ctx.fill();

      for (let puff = 0; puff < puffs; puff++) {
        const x = cx + (random() - 0.5) * spreadX * 2.15;
        const y = cy + (random() - 0.5) * spreadY * 1.35;
        const rx = 24 + random() * (36 + spreadX * 0.34);
        const ry = 20 + random() * (24 + spreadY * 0.55);
        const shade = ctx.createRadialGradient(x + rx * 0.12, y + ry * 0.5, 1, x, y + ry * 0.28, Math.max(rx, ry) * 1.22);
        shade.addColorStop(0, 'rgba(108,132,153,0.28)');
        shade.addColorStop(0.58, 'rgba(151,171,189,0.16)');
        shade.addColorStop(1, 'rgba(170,190,207,0)');
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.ellipse(x, y + ry * 0.2, rx * 1.1, ry * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();

        const light = ctx.createRadialGradient(x - rx * 0.24, y - ry * 0.38, 1, x, y, Math.max(rx, ry) * 1.18);
        light.addColorStop(0, 'rgba(255,255,255,0.86)');
        light.addColorStop(0.36, 'rgba(252,254,255,0.78)');
        light.addColorStop(0.68, 'rgba(229,239,247,0.42)');
        light.addColorStop(1, 'rgba(215,229,239,0)');
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.ellipse(x, y - ry * 0.12, rx, ry, (random() - 0.5) * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.colorSpace = this.THREE.SRGBColorSpace;
    texture.minFilter = this.THREE.LinearMipmapLinearFilter;
    texture.magFilter = this.THREE.LinearFilter;
    texture.generateMipmaps = true;
    return texture;
  }

  makeGodRayTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 768;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 768, 768);
    ctx.globalCompositeOperation = 'lighter';
    const rays = [
      { x: 35, width: 28, alpha: 0.13 }, { x: 115, width: 36, alpha: 0.17 },
      { x: 205, width: 26, alpha: 0.12 }, { x: 315, width: 42, alpha: 0.18 },
      { x: 455, width: 30, alpha: 0.13 }, { x: 570, width: 38, alpha: 0.16 },
      { x: 720, width: 25, alpha: 0.12 }
    ];
    for (const ray of rays) {
      const g = ctx.createLinearGradient(384, 384, ray.x, 748);
      g.addColorStop(0, 'rgba(255,245,220,0)');
      g.addColorStop(0.16, 'rgba(255,242,211,' + (ray.alpha * 0.78) + ')');
      g.addColorStop(0.62, 'rgba(255,235,199,' + (ray.alpha * 0.52) + ')');
      g.addColorStop(1, 'rgba(255,230,190,0)');
      ctx.fillStyle = g;
      ctx.shadowBlur = 24;
      ctx.shadowColor = 'rgba(255,236,199,0.12)';
      ctx.beginPath();
      ctx.moveTo(384, 384);
      ctx.lineTo(ray.x - ray.width, 748);
      ctx.lineTo(ray.x + ray.width, 748);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    const halo = ctx.createRadialGradient(384, 384, 4, 384, 384, 290);
    halo.addColorStop(0, 'rgba(255,244,220,0.22)');
    halo.addColorStop(0.34, 'rgba(255,238,207,0.08)');
    halo.addColorStop(1, 'rgba(255,235,205,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, 768, 768);
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.colorSpace = this.THREE.SRGBColorSpace;
    texture.minFilter = this.THREE.LinearFilter;
    texture.magFilter = this.THREE.LinearFilter;
    return texture;
  }

  makeGroundFogTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let seed = 0x31d9a7;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 26; i++) {
      const x = 25 + random() * 974;
      const y = 68 + random() * 132;
      const rx = 65 + random() * 135;
      const ry = 9 + random() * 28;
      const g = ctx.createRadialGradient(x, y, 1, x, y, Math.max(rx, ry));
      g.addColorStop(0, 'rgba(220,233,239,0.24)');
      g.addColorStop(0.42, 'rgba(209,226,235,0.15)');
      g.addColorStop(0.78, 'rgba(190,212,225,0.055)');
      g.addColorStop(1, 'rgba(190,212,225,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, (random() - 0.5) * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.colorSpace = this.THREE.SRGBColorSpace;
    texture.minFilter = this.THREE.LinearMipmapLinearFilter;
    texture.magFilter = this.THREE.LinearFilter;
    texture.generateMipmaps = true;
    return texture;
  }

  makeSnowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.88)');
    g.addColorStop(0.72, 'rgba(225,240,250,0.28)');
    g.addColorStop(1, 'rgba(225,240,250,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    const texture = new this.THREE.CanvasTexture(canvas);
    texture.colorSpace = this.THREE.SRGBColorSpace;
    return texture;
  }

  drawSky({top,horizon,bottom,sunColor,sunStrength=1,sunDirection,sunVisible=true,twilight=0}) {
    const ctx=this.skyContext;if(!ctx)return;
    const last=this.lastSkyColors;
    const skyColorChanged=!last||Math.max(
      Math.abs(top.r-last.top.r),Math.abs(top.g-last.top.g),Math.abs(top.b-last.top.b),
      Math.abs(horizon.r-last.horizon.r),Math.abs(horizon.g-last.horizon.g),Math.abs(horizon.b-last.horizon.b),
      Math.abs(bottom.r-last.bottom.r),Math.abs(bottom.g-last.bottom.g),Math.abs(bottom.b-last.bottom.b)
    )>0.0012||Math.abs((last?.twilight??-1)-twilight)>0.006;
    if(skyColorChanged){
      const zenith=top.clone().multiplyScalar(0.80);
      const upperMid=top.clone().lerp(horizon,0.30),middle=top.clone().lerp(horizon,0.60);
      const rose=horizon.clone().lerp(new this.THREE.Color(0xd97891),twilight*0.62);
      const coral=horizon.clone().lerp(new this.THREE.Color(0xff875f),twilight*0.88);
      const warmHaze=new this.THREE.Color(0xffc18b);
      const horizonBand=horizon.clone().lerp(warmHaze,twilight*0.34);
      const lower=horizon.clone().lerp(bottom,0.46),deepLower=bottom.clone().multiplyScalar(0.92);
      const gradient=ctx.createLinearGradient(0,0,0,this.skyCanvas.height);
      gradient.addColorStop(0.00,this.colorCss(zenith));
      gradient.addColorStop(0.17,this.colorCss(top));
      gradient.addColorStop(0.33,this.colorCss(upperMid));
      gradient.addColorStop(0.415,this.colorCss(middle));
      gradient.addColorStop(0.465,this.colorCss(rose));
      gradient.addColorStop(0.505,this.colorCss(coral));
      gradient.addColorStop(0.545,this.colorCss(horizonBand));
      gradient.addColorStop(0.605,this.colorCss(horizon));
      gradient.addColorStop(0.76,this.colorCss(bottom));
      gradient.addColorStop(1.00,this.colorCss(deepLower));
      ctx.fillStyle=gradient;ctx.fillRect(0,0,this.skyCanvas.width,this.skyCanvas.height);
      const haze=ctx.createLinearGradient(0,this.skyCanvas.height*0.43,0,this.skyCanvas.height*0.61);
      haze.addColorStop(0,'rgba(255,255,255,0)');
      haze.addColorStop(0.48,'rgba(255,226,211,'+(0.045+twilight*0.12)+')');
      haze.addColorStop(1,'rgba(255,255,255,0)');
      ctx.fillStyle=haze;ctx.fillRect(0,this.skyCanvas.height*0.42,this.skyCanvas.width,this.skyCanvas.height*0.20);
      this.skyTexture.needsUpdate=true;
      this.lastSkyColors={top:top.clone(),horizon:horizon.clone(),bottom:bottom.clone(),twilight};
    }
    this.sunMaterial.color.copy(sunColor);
    this.sunMaterial.opacity=this.THREE.MathUtils.clamp(sunStrength*(1-this.params.clouds*0.54)*(0.64+twilight*0.18),0,0.68);
    const nightStrength=sunDirection?1-this.THREE.MathUtils.smoothstep(sunDirection.y,-0.10,0.18):0;
    const cloudDayMix=this.THREE.MathUtils.clamp(sunStrength*1.35+0.06,0.06,1);
    const cloudTint=this.nightCloudColor.clone().lerp(this.dayCloudColor,cloudDayMix);
    cloudTint.lerp(new this.THREE.Color(0xff9b83),twilight*0.30);
    cloudTint.lerp(horizon,0.05+this.params.clouds*0.10);
    this.cloudMaterials.forEach(material=>material.color.copy(cloudTint));
    this.starsMaterial.uniforms.uNight.value=nightStrength;
    if(sunDirection){
      this.sunDirection.copy(sunDirection).normalize();
      this.moonDirection.copy(this.sunDirection).negate();
      this.sunGlow.visible=!!sunVisible&&sunStrength>0.025;
      this.sunGlow.position.copy(this.camera.position).addScaledVector(this.sunDirection,10600);
      const cover=this.params.clouds;
      const cloudGate=this.THREE.MathUtils.smoothstep(cover,0.07,0.34)*(1-this.THREE.MathUtils.smoothstep(cover,0.76,0.96));
      this.volumetricRayStrength=this.THREE.MathUtils.clamp(cloudGate*sunStrength*(0.42+twilight*0.55),0,0.82);
      const cu=this.cloudVolumeMaterial.uniforms;
      cu.uSunDirection.value.copy(this.sunDirection);cu.uSunColor.value.copy(sunColor);
      cu.uDaylight.value=sunStrength;cu.uTwilight.value=twilight;
      cu.uRayStrength.value=this.params.volumetrics?this.volumetricRayStrength:0;
      cu.uCoverage.value=this.params.clouds;
      const fu=this.groundFogVolumeMaterial.uniforms;
      fu.uSunDirection.value.copy(this.sunDirection);fu.uSunColor.value.copy(sunColor);
      fu.uDaylight.value=sunStrength;fu.uTwilight.value=twilight;
    }else{
      this.sunGlow.visible=false;this.volumetricRayStrength=0;
      this.cloudVolumeMaterial.uniforms.uRayStrength.value=0;
    }
    this.moon.visible=nightStrength>0.04&&this.moonDirection.y>-0.02;
    this.moonGlow.visible=this.moon.visible;
    const moonFade=this.THREE.MathUtils.smoothstep(this.moonDirection.y,-0.02,0.16);
    this.moonMaterial.opacity=nightStrength*moonFade*0.95;
    this.moonGlowMaterial.opacity=nightStrength*moonFade*0.62;
    this.cloudVolume.visible=this.params.volumetrics&&this.params.clouds>0.015;
  }

  getLighting() {
    return {
      direct: this.THREE.MathUtils.clamp(1 - this.params.clouds * 0.56 - this.params.snowfall * 0.12, 0.28, 1),
      ambient: 1 + this.params.clouds * 0.17 + this.params.snowfall * 0.06,
      sky: 1 - this.params.clouds * 0.22 - this.params.snowfall * 0.08
    };
  }

  getSettings() {
    return {
      preset:this.params.preset,clouds:this.params.clouds,snowfall:this.params.snowfall,
      wind:this.params.wind,groundFog:!!this.params.groundFog,volumetrics:this.params.volumetrics!==false
    };
  }

  applyWeather(next) {
    this.params={
      ...this.params,...next,
      clouds:this.THREE.MathUtils.clamp(Number(next.clouds??this.params.clouds),0,1),
      snowfall:this.THREE.MathUtils.clamp(Number(next.snowfall??this.params.snowfall),0,1),
      wind:this.THREE.MathUtils.clamp(Number(next.wind??this.params.wind),0,60),
      visibility:this.THREE.MathUtils.clamp(Number(next.visibility??this.params.visibility??1),0.15,1),
      groundFog:!!(next.groundFog??this.params.groundFog),
      volumetrics:next.volumetrics===undefined?this.params.volumetrics!==false:!!next.volumetrics
    };
    const coverage=this.params.clouds,volumetrics=this.params.volumetrics;
    const active=Math.round(coverage*this.clouds.length);
    this.clouds.forEach((cloud,index)=>{cloud.sprite.visible=!volumetrics&&index<active;});
    this.cloudMaterials.forEach(material=>{material.opacity=volumetrics?0.18+coverage*0.13:0.50+coverage*0.30;});
    this.cloudVolume.visible=volumetrics&&coverage>0.015;
    this.cloudVolumeMaterial.uniforms.uCoverage.value=coverage;
    this.cloudVolumeMaterial.uniforms.uWind.value=this.params.wind;

    const flakes=Math.round(this.snowCount*this.params.snowfall);
    this.activeSnowflakes=flakes;this.snow.count=flakes;this.snow.visible=flakes>0;
    this.snowMaterial.opacity=0.84+this.params.snowfall*0.12;
    const streakFactor=this.THREE.MathUtils.clamp((this.params.wind-12)/42,0,1);
    this.activeStreaks=Math.round(this.streakCount*this.params.snowfall*streakFactor);
    this.streaks.visible=this.activeStreaks>0;
    this.streakGeometry.setDrawRange(0,this.activeStreaks*2);
    this.streakMaterial.opacity=0.14+streakFactor*0.24;

    this.groundFogGroup.visible=this.params.groundFog&&!volumetrics;
    this.groundFogSprites.forEach(({sprite})=>{sprite.visible=this.params.groundFog&&!volumetrics;});
    this.groundFogVolume.visible=this.params.groundFog&&volumetrics;
    this.groundFogVolumeMaterial.uniforms.uDensity.value=0.38+coverage*0.16;
    this.groundFogVolumeMaterial.uniforms.uWind.value=this.params.wind;
    const fog=this.scene.fog;
    if(fog&&fog.isFog){
      const visibility=this.params.visibility*(1-coverage*0.12)*(1-this.params.snowfall*0.42);
      fog.near=this.baseFogNear*(0.72+visibility*0.28);
      fog.far=this.baseFogFar*(0.34+visibility*0.66);
    }
  }

  setPreset(name) {
    const preset = WeatherSystem.PRESETS[name];
    if (!preset) return false;
    this.applyWeather({ ...preset, preset: name });
    return true;
  }

  setGroundFog(enabled) {
    this.applyWeather({ groundFog: !!enabled });
    return this.params.groundFog;
  }

  setVolumetrics(enabled) {
    this.applyWeather({ volumetrics: !!enabled });
    return this.params.volumetrics;
  }

  setCustom(values) {
    const clouds = this.THREE.MathUtils.clamp(Number(values.clouds ?? this.params.clouds), 0, 1);
    const snowfall = this.THREE.MathUtils.clamp(Number(values.snowfall ?? this.params.snowfall), 0, 1);
    const wind = this.THREE.MathUtils.clamp(Number(values.wind ?? this.params.wind), 0, 60);
    const visibility = Math.max(0.2, 1 - clouds * 0.14 - snowfall * 0.48 - Math.max(0, wind - 8) * 0.003);
    this.applyWeather({ ...values, clouds, snowfall, wind, visibility, preset: 'custom' });
  }

  update(deltaSeconds, cameraPosition, groundReference) {
    const dt = Math.min(Math.max(deltaSeconds || 0, 0), 0.05);
    this.elapsed += dt;
    if (cameraPosition) this.cameraPosition.copy(cameraPosition);
    else this.camera.getWorldPosition(this.cameraPosition);
    this.camera.getWorldQuaternion(this.cameraWeatherRig.quaternion);
    this.cameraWeatherRig.position.copy(this.cameraPosition);
    this.cameraWeatherRig.updateMatrixWorld(true);
    this.sunGlow.position.copy(this.cameraPosition).addScaledVector(this.sunDirection,10600);
    this.stars.position.copy(this.cameraPosition);
    this.moonGlow.position.copy(this.cameraPosition).addScaledVector(this.moonDirection,9200);
    this.moon.position.copy(this.cameraPosition).addScaledVector(this.moonDirection,9180);
    this.starsMaterial.uniforms.uTime.value=this.elapsed;
    this.cloudVolume.position.set(this.cameraPosition.x,Math.max(this.cameraPosition.y+1900,2450),this.cameraPosition.z);
    const cloudUniforms=this.cloudVolumeMaterial.uniforms;
    cloudUniforms.uTime.value=this.elapsed;
    cloudUniforms.uWind.value=this.params.wind;
    cloudUniforms.uCoverage.value=this.params.clouds;
    cloudUniforms.uCameraPosition.value.copy(this.cameraPosition);
    if(this.params.groundFog){
      const reference=groundReference||this.cameraPosition;
      this.groundFogAnchor.copy(reference);
      if(reference===cameraPosition)this.groundFogAnchor.y-=18;
      this.groundFogVolume.position.set(this.groundFogAnchor.x,this.groundFogAnchor.y+58,this.groundFogAnchor.z);
      const fogUniforms=this.groundFogVolumeMaterial.uniforms;
      fogUniforms.uTime.value=this.elapsed;
      fogUniforms.uWind.value=this.params.wind;
      fogUniforms.uCameraPosition.value.copy(this.cameraPosition);
      if(!this.params.volumetrics){
        for(const layer of this.groundFogSprites){
          layer.offset.x+=dt*(1.2+this.params.wind*0.20)*layer.drift;
          layer.offset.z+=dt*(0.35+this.params.wind*0.08)*layer.drift;
          if(layer.offset.x>2400)layer.offset.x-=4800;
          if(layer.offset.x< -2400)layer.offset.x+=4800;
          if(layer.offset.z>2400)layer.offset.z-=4800;
          if(layer.offset.z< -2400)layer.offset.z+=4800;
          layer.sprite.position.copy(this.groundFogAnchor).add(layer.offset);
        }
      }
    }

    const wind = this.params.wind;
    const drift = wind * dt * 1.7;
    const breeze = wind * dt * 0.34;
    for (const cloud of this.clouds) {
      cloud.offset.x += drift;
      cloud.offset.z += breeze;
      if (cloud.offset.x > 10400) cloud.offset.x -= 20800;
      if (cloud.offset.x < -10400) cloud.offset.x += 20800;
      if (cloud.offset.z > 10400) cloud.offset.z -= 20800;
      if (cloud.offset.z < -10400) cloud.offset.z += 20800;
      if (cloud.sprite.visible) cloud.sprite.position.copy(this.cameraPosition).add(cloud.offset);
    }

    // Snow is a camera-space layer: every active flake starts in front of the lens
    // and remains inside the view frustum. This avoids invisible particles behind
    // the camera and keeps the effect stable while skiing or flying.
    if (this.activeSnowflakes > 0) {
      this.snow.quaternion.identity();
      this.streaks.quaternion.identity();
      const fall = (10 + this.params.snowfall * 17 + wind * 0.12) * dt;
      const lateral = (wind * 0.035 + 0.012) * dt;
      const tanHalfFov = Math.tan(this.THREE.MathUtils.degToRad(this.camera.fov * 0.5));
      const aspect = this.camera.aspect || 1;
      for (let i = 0; i < this.activeSnowflakes; i++) {
        const j = i * 3;
        const depth = Math.max(8, -this.snowPositions[j + 2]);
        const halfHeight = depth * tanHalfFov * 0.92;
        const halfWidth = halfHeight * aspect * 0.92;
        this.snowPositions[j] += lateral * this.snowVelocity[i * 2];
        this.snowPositions[j + 1] -= fall;
        if (this.snowPositions[j + 1] < -halfHeight) {
          this.snowPositions[j + 1] = halfHeight;
          this.snowPositions[j] = (Math.random() * 2 - 1) * halfWidth;
        }
        if (this.snowPositions[j] > halfWidth) this.snowPositions[j] -= halfWidth * 2;
        if (this.snowPositions[j] < -halfWidth) this.snowPositions[j] += halfWidth * 2;
        this.snowDummy.position.set(
          this.snowPositions[j],
          this.snowPositions[j + 1],
          this.snowPositions[j + 2]
        );
        const flakeSize = depth * 0.0050 * this.snowSize[i] * (0.82 + this.params.snowfall * 0.35);
        this.snowDummy.scale.set(flakeSize, flakeSize, 1);
        this.snowDummy.updateMatrix();
        this.snow.setMatrixAt(i, this.snowDummy.matrix);
      }
      this.snow.instanceMatrix.needsUpdate = true;

      if (this.activeStreaks > 0) {
        const streakFall = fall * 1.55;
        for (let i = 0; i < this.activeStreaks; i++) {
          const j = i * 6;
          const depth = Math.max(9, -this.streakPositions[j + 2]);
          const halfHeight = depth * tanHalfFov * 0.90;
          const halfWidth = halfHeight * aspect * 0.90;
          this.streakPositions[j] += lateral * 1.6;
          this.streakPositions[j + 1] -= streakFall;
          if (this.streakPositions[j + 1] < -halfHeight) {
            this.streakPositions[j + 1] = halfHeight;
            this.streakPositions[j] = (Math.random() * 2 - 1) * halfWidth;
          }
          if (this.streakPositions[j] > halfWidth) this.streakPositions[j] -= halfWidth * 2;
          if (this.streakPositions[j] < -halfWidth) this.streakPositions[j] += halfWidth * 2;
          const streakLength = 0.7 + wind * 0.018;
          this.streakPositions[j + 3] = this.streakPositions[j] + 0.10 + wind * 0.002;
          this.streakPositions[j + 4] = this.streakPositions[j + 1] + streakLength;
          this.streakPositions[j + 5] = this.streakPositions[j + 2];
        }
        this.streakGeometry.attributes.position.needsUpdate = true;
      }
    }
  }

  dispose() {
    this.scene.remove(this.sunGlow);
    this.scene.remove(this.groundFogGroup);
    this.scene.remove(this.cloudVolume);
    this.scene.remove(this.groundFogVolume);
    this.scene.remove(this.stars);
    this.scene.remove(this.moon);
    this.scene.remove(this.moonGlow);
    this.clouds.forEach(({sprite})=>this.scene.remove(sprite));
    this.scene.remove(this.cameraWeatherRig);
    if(this.scene.background===this.skyTexture)this.scene.background=this.previousSceneBackground??null;
    this.skyTexture.dispose();this.sunMaterial.dispose();this.sunTexture.dispose();
    this.cloudMaterials.forEach(material=>{
      if(material.map&&material.map!==this.cloudFallbackTexture)material.map.dispose();
      material.dispose();
    });
    this.cloudAtlasTexture.dispose();this.cloudFallbackTexture.dispose();
    this.cloudVolumeGeometry.dispose();this.cloudVolumeMaterial.dispose();
    this.groundFogVolumeGeometry.dispose();this.groundFogVolumeMaterial.dispose();
    this.groundFogMaterial.dispose();this.groundFogTexture.dispose();
    this.starsGeometry.dispose();this.starsMaterial.dispose();
    this.moonTexture.dispose();this.moonGlowTexture.dispose();
    this.moonMaterial.dispose();this.moonGlowMaterial.dispose();
    this.snowGeometry.dispose();this.snowMaterial.dispose();this.snowTexture.dispose();
    this.streakGeometry.dispose();this.streakMaterial.dispose();
  }

}
