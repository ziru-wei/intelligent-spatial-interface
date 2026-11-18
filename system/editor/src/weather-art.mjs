import * as THREE from 'three';
const noise=`float hash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}`;
export function celestialBody(night,radius,phase=0){
 const group=new THREE.Group();group.name=night?'moon':'sun';
 const material=new THREE.ShaderMaterial({toneMapped:false,uniforms:{time:{value:0},night:{value:+night},light:{value:new THREE.Vector3(-.85+Math.sin(phase*.7)*.25,.15,.35).normalize()}},
 vertexShader:'varying vec3 p,n;void main(){p=position;n=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
 fragmentShader:`varying vec3 p,n;uniform float time,night;uniform vec3 light;${noise}
 void main(){vec3 N=normalize(n);float grain=noise(normalize(p)*23.)*.55+noise(normalize(p)*47.)*.25+noise(normalize(p)*8.)*.2;
 float lit=smoothstep(-.055,.09,dot(N,light));vec3 moon=mix(vec3(.025,.041,.07),mix(vec3(.49,.58,.70),vec3(.91,.94,.96),grain),lit);moon*=.4+.6*max(0.,dot(N,light));
 float convection=noise(normalize(p)*12.+vec3(time*.035));vec3 sun=mix(vec3(1.,.30,.045),vec3(1.,.89,.42),pow(max(0.,N.z),.35));sun*=.9+.1*convection;
 gl_FragColor=vec4(mix(sun,moon,night),1.);
 #include <colorspace_fragment>
 }`});
 const sphere=new THREE.Mesh(new THREE.SphereGeometry(radius,64,48),material);sphere.renderOrder=6;group.add(sphere);
 const halo=new THREE.Mesh(new THREE.SphereGeometry(radius*1.6,40,24),new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.BackSide,toneMapped:false,uniforms:{tint:{value:new THREE.Color(night?0xb3d0f1:0xffbe63)},strength:{value:night?.11:.25}},
 vertexShader:'varying vec3 N,V;void main(){vec4 p=modelViewMatrix*vec4(position,1.);N=normalMatrix*normal;V=-p.xyz;gl_Position=projectionMatrix*p;}',fragmentShader:'varying vec3 N,V;uniform vec3 tint;uniform float strength;void main(){float f=abs(dot(normalize(N),normalize(V)));gl_FragColor=vec4(tint,pow(f,3.)*strength);\n#include <colorspace_fragment>\n}'}));halo.renderOrder=5;group.add(halo);group.userData.animate=t=>material.uniforms.time.value=t;return group;
}
// Shared receiver query for light patches and precipitation: vertical world-space collision.
export function lightReceiver(target,x,y,collide,contains=()=>true){
 if(!contains(x,y))return null;
 const receiver=target.origin.clone().addScaledVector(target.right,x).addScaledVector(target.up,y);
 const start=receiver.clone().add(new THREE.Vector3(0,.55,0));
 const hit=collide(start,new THREE.Vector3(0,-1,0));
 return hit&&hit.normal.y>.45?{...hit,start:hit.start||start}:null;
}
export function receiverGeometry(root,target,collide,contains=()=>true){
 root.updateMatrixWorld(true);const inv=root.matrixWorld.clone().invert(),grid=24,points=[],positions=[],uv=[];
 for(let j=0;j<=grid;j++)for(let i=0;i<=grid;i++){
  const hit=lightReceiver(target,(i/grid-.5)*target.width,(j/grid-.5)*target.height,collide,contains);
  points.push(hit?{...hit,uv:[i/grid,j/grid]}:null);
 }
 const add=(a,b,c)=>{if(!a||!b||!c)return;
  if(Math.max(a.point.y,b.point.y,c.point.y)-Math.min(a.point.y,b.point.y,c.point.y)>.08)return;
  for(const p of [a,b,c]){positions.push(...p.point.clone().addScaledVector(p.normal,.006).applyMatrix4(inv).toArray());uv.push(...p.uv);}
 };
 for(let j=0;j<grid;j++)for(let i=0;i<grid;i++){const k=j*(grid+1)+i;add(points[k],points[k+1],points[k+grid+1]);add(points[k+1],points[k+grid+2],points[k+grid+1]);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.userData.receiver='collision';return g;
}
export function createSunlight(root,target,collide,volumeMaterial,contains=()=>true){
 root.updateMatrixWorld(true);const inv=root.matrixWorld.clone().invert(),invQ=root.quaternion.clone().invert(),horizontal=target.kind==='horizontal',direction=horizontal?new THREE.Vector3(.25,-1,.2).normalize():target.n.clone().multiplyScalar(.85).add(new THREE.Vector3(0,-.7,0)).normalize();
 const grid=12,points=[],positions=[],uv=[],world=[];
 for(let j=0;j<=grid;j++)for(let i=0;i<=grid;i++){
  const x=(i/grid-.5)*target.width*.90,y=(j/grid-.5)*target.height*.86,receiver=target.origin.clone().addScaledVector(target.right,x).addScaledVector(target.up,y);
  const start=receiver.clone().addScaledVector(target.n,horizontal?.065:.22).addScaledVector(direction,horizontal?-1.35:0);
  const hit=horizontal?lightReceiver(target,x,y,collide,contains):collide(start,direction);
  points.push(hit&&hit.normal.y>.45?{...hit,start:hit.start||start}:null);
 }
 const add=(a,b,c)=>{if(!a||!b||!c||Math.max(a.point.distanceTo(b.point),a.point.distanceTo(c.point))>.8||Math.max(a.point.y,b.point.y,c.point.y)-Math.min(a.point.y,b.point.y,c.point.y)>.08)return;for(const v of [a,b,c]){const p=v.point.clone().addScaledVector(v.normal, .006);world.push(...p.toArray());positions.push(...p.applyMatrix4(inv).toArray());uv.push(...v.uv);}};
 points.forEach((p,k)=>{if(p)p.uv=[k%(grid+1)/grid,Math.floor(k/(grid+1))/grid];});
 for(let j=0;j<grid;j++)for(let i=0;i<grid;i++){const k=j*(grid+1)+i;add(points[k],points[k+1],points[k+grid+1]);add(points[k+1],points[k+grid+2],points[k+grid+1]);}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setAttribute('receiverWorld',new THREE.Float32BufferAttribute(world,3));
 // Restore the dapple pattern approved before the leaf-stamp/noise rewrites.
 // Its scale, thresholds, warm colour and edge feather are unchanged; only the
 // phase moves gently so the same pattern sways instead of being regenerated.
 const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,toneMapped:false,uniforms:{time:{value:0}},
 vertexShader:'attribute vec3 receiverWorld;varying vec3 world;varying vec2 vUv;void main(){world=receiverWorld;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
 fragmentShader:`varying vec3 world;varying vec2 vUv;uniform float time;${noise}
 void main(){float edge=smoothstep(0.,.08,min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y)));vec3 p=world*9.+vec3(sin(time*.55)*.42,0.,cos(time*.43)*.35);float leaves=noise(p)*.65+noise(p*2.5)*.35;float light=smoothstep(.36,.62,leaves);gl_FragColor=vec4(vec3(1.,.76,.36),edge*(.06+.36*light));
 #include <colorspace_fragment>
 }`});
 const patch=new THREE.Mesh(geometry,material);patch.userData.receiver='collision';patch.name='dappled-sunlight';patch.renderOrder=6;root.add(patch);const beams=[];
 // Restore the original individual shafts along the sampled sunlight rays.
 for(let k=0;k<points.length;k+=19){const h=points[k];if(!h)continue;const length=h.start.distanceTo(h.point);if(length<.2)continue;const m=volumeMaterial(0xffe2a1,.22);m.uniforms.beam.value=1;const beam=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),m);beam.name='sunlight-scatter';beam.position.copy(h.start).lerp(h.point,.5).applyMatrix4(inv);beam.quaternion.copy(invQ).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),h.point.clone().sub(h.start).normalize()));beam.scale.set(.035,length/2,.035);beam.renderOrder=6;root.add(beam);beams.push(beam);}
 return {animate(t){material.uniforms.time.value=t;for(const b of beams)b.material.uniforms.time.value=t;}};
}

// A world-space falloff evaluated at actual scene-depth receivers. Reconstructing
// each receiver avoids hard triangle seams in coarse scans around the window frame.
export function createNightfall(root,target){
 const material=new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,toneMapped:false,
 uniforms:{ambientDepth:{value:null},viewport:{value:new THREE.Vector2()},inverseViewProjection:{value:new THREE.Matrix4()},worldToSurface:{value:new THREE.Matrix4()},halfSize:{value:new THREE.Vector2(target.width/2,target.height/2)}},
 vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
 fragmentShader:`uniform sampler2D ambientDepth;uniform vec2 viewport,halfSize;uniform mat4 inverseViewProjection,worldToSurface;
 void main(){vec2 uv=gl_FragCoord.xy/viewport;float depth=texture2D(ambientDepth,uv).x;if(depth>=.99999)discard;
 vec4 world=inverseViewProjection*vec4(uv*2.-1.,depth*2.-1.,1.);world/=world.w;
 vec3 p=(worldToSurface*world).xyz;vec2 outside=max(abs(p.xy)-halfSize,0.);
 float distanceToPortal=length(vec3(outside,p.z*.75));float falloff=1.-smoothstep(.03,1.05,distanceToPortal);
 gl_FragColor=vec4(.008,.013,.027,falloff*.22);
 #include <colorspace_fragment>
 }`});
 const halo=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);halo.name='night-ambient-halo';halo.frustumCulled=false;halo.renderOrder=3;root.add(halo);
 halo.onBeforeRender=(_r,_s,c)=>{root.updateWorldMatrix(true,false);material.uniforms.worldToSurface.value.copy(root.matrixWorld).invert();material.uniforms.inverseViewProjection.value.multiplyMatrices(c.matrixWorld,c.projectionMatrixInverse);};
}
