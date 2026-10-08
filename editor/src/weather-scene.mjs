import * as THREE from 'three';
import {chooseStablePlacement,posePoints} from './placement-stability.mjs';
import {createWeatherPlayback} from './weather-preview.mjs';
import {celestialBody,createSunlight,createNightfall,receiverGeometry} from './weather-art.mjs';

// World-space storybook weather. The source forecast is validated by the server.
// Only the target selection uses the recorded camera; every effect is a real scene mesh.
const UP=new THREE.Vector3(0,1,0),V=a=>new THREE.Vector3(...a);
const fract=x=>x-Math.floor(x),random=i=>fract(Math.sin(i*127.1+311.7)*43758.5453);
export const PERIOD_SECONDS=8;
export function forecastAt(forecast,seconds){return forecast[Math.floor(Math.max(0,seconds)/PERIOD_SECONDS)%forecast.length];}
function basis(normal){
 const n=normal.clone().normalize(),right=Math.abs(n.y)>.85?new THREE.Vector3(1,0,0):UP.clone().cross(n).normalize(),up=n.clone().cross(right).normalize();
 return {n,right,up,q:new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,up,n))};
}
export const SURFACE_LIFT=.065,GLASS_INSET=.015;
// All effect anchors come from layout geometry; scans only provide occlusion and particle contacts.
export function polygonTarget(id,kind,points,normal,room,holes=[]){
 const origin=points.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).divideScalar(points.length),b=basis(normal);
 const project=p=>{const d=p.clone().sub(origin);return new THREE.Vector2(d.dot(b.right),d.dot(b.up));};
 const local=points.map(project),rings=holes.map(r=>r.map(project));
 const box=new THREE.Box2().setFromPoints(local),center=box.getCenter(new THREE.Vector2());origin.addScaledVector(b.right,center.x).addScaledVector(b.up,center.y);[local,...rings].forEach(r=>r.forEach(p=>p.sub(center)));
 const vertices=[...local,...rings.flat()],triangles=THREE.ShapeUtils.triangulateShape(local,rings).flatMap(t=>t.map(i=>vertices[i].clone())),positions=[];
 for(const p of triangles)positions.push(...origin.clone().addScaledVector(b.right,p.x).addScaledVector(b.up,p.y).toArray());
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
 const pickMesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));pickMesh.updateMatrixWorld();
 return {id,kind,room,zones:[room],origin,...b,width:box.max.x-box.min.x,height:box.max.y-box.min.y,geometry,pickMesh,triangles,source:'parametric-layout'};
}
function planeGeometry(t){
 if(!t.geometry)return new THREE.PlaneGeometry(t.width,t.height,32,32);
 const g=t.geometry.clone(),inv=new THREE.Matrix4().compose(t.origin,t.q,new THREE.Vector3(1,1,1)).invert();g.applyMatrix4(inv);
 const a=g.attributes.position,uv=[];for(let i=0;i<a.count;i++)uv.push(a.getX(i)/t.width+.5,a.getY(i)/t.height+.5);
 g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));return g;
}
export function buildWeatherTargets(sem={}){
 const targets=[];
 for(const c of sem.ceilings||[]){if(!c.outline||c.outline.length<3)continue;const points=c.outline.map(V);let n=c.normal?V(c.normal):new THREE.Vector3();
  if(!n.lengthSq())points.forEach((p,i)=>{const q=points[(i+1)%points.length];n.x+=(p.y-q.y)*(p.z+q.z);n.y+=(p.z-q.z)*(p.x+q.x);n.z+=(p.x-q.x)*(p.y+q.y);});if(n.y>0)n.negate();
  targets.push(polygonTarget(c.id,'ceiling',points,n.normalize(),c.room||c.rooms?.[0]));
 }
 const windows=[...(sem.openings||[]),...(sem.objects||[])].filter(o=>/window/i.test(o.category||o.label));
 for(const o of windows){if(windows.some(child=>child.parent===o.id&&/glass/i.test(child.label)))continue;
  const b=basis(new THREE.Vector3(0,0,1).applyAxisAngle(UP,THREE.MathUtils.degToRad(o.yaw||0))),center=V(o.center),w=Math.max(.05,o.size[0]-GLASS_INSET*2),h=Math.max(.05,o.size[1]-GLASS_INSET*2);
  const points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>center.clone().addScaledVector(b.right,x*w/2).addScaledVector(b.up,y*h/2));
  const t=polygonTarget(o.id,'window',points,b.n,o.room);t.parent=o.parent;t.wall=o.wall||`${o.room}:${Math.round((o.yaw||0)%180)}`;targets.push(t);
 }
 // Wall regions already contain door/window cut-outs; preserve these holes when fitting effects.
 for(const w of sem.walls||[]){const n=new THREE.Vector3(0,0,1).applyAxisAngle(UP,THREE.MathUtils.degToRad(w.yaw||0));
  for(const [i,[outer,...holes]] of (w.region||[[w.outline||[]]]).entries())if(outer.length>=3){const t=polygonTarget(`${w.id}:${i}`,'vertical',outer.map(V),n,w.rooms?.[0],holes.map(r=>r.map(V)));t.surface='wall';targets.push(t);}
 }
 for(const o of [...(sem.objects||[]),...(sem.openings||[])]){if(windows.includes(o)||!o.center||!o.size)continue;
  const yaw=new THREE.Quaternion().setFromAxisAngle(UP,THREE.MathUtils.degToRad(o.yaw||0)),center=V(o.center);
  for(const [name,axis,sign] of [['right',0,1],['left',0,-1],['top',1,1],['bottom',1,-1],['front',2,1],['back',2,-1]]){
   const normal=new THREE.Vector3().setComponent(axis,sign),b=basis(normal),half=o.size[axis]/2;
   const extent=v=>v.toArray().reduce((sum,n,i)=>sum+Math.abs(n)*o.size[i],0),width=extent(b.right),height=extent(b.up);
   const points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>normal.clone().multiplyScalar(half).addScaledVector(b.right,x*width/2).addScaledVector(b.up,y*height/2).applyQuaternion(yaw).add(center));
   const t=polygonTarget(`${o.id}:${name}`,axis===1?'horizontal':'vertical',points,normal.applyQuaternion(yaw),o.room);t.surface='box';t.objectId=o.id;targets.push(t);
  }
 }
 for(const room of sem.rooms||[])for(const [i,[outer,...holes]] of (room.polygon||room.triangles?.map(t=>[t])||[]).entries()){
  const points=r=>r.map(([x,z])=>new THREE.Vector3(x,room.floorY||0,z));if(outer.length<3)continue;
  const t=polygonTarget(`${room.id}:floor:${i}`,'horizontal',points(outer),UP,room.id,holes.map(points));t.surface='floor';targets.push(t);
 }
 return targets;
}
function contains(t,x,y){
 if(t.partial&&(Math.abs(x)>t.width/2||Math.abs(y)>t.height/2))return false;
 if(!t.triangles)return Math.abs(x)<t.width*.44&&Math.abs(y)<t.height*.44;
 const p=new THREE.Vector2(x,y),pts=t.triangles;
 for(let i=0;i<pts.length;i+=3){const a=pts[i],b=pts[i+1],c=pts[i+2];
  const ab=(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x),bc=(c.x-b.x)*(p.y-b.y)-(c.y-b.y)*(p.x-b.x),ca=(a.x-c.x)*(p.y-c.y)-(a.y-c.y)*(p.x-c.x);
  if(Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))>1e-9&&((ab>=0&&bc>=0&&ca>=0)||(ab<=0&&bc<=0&&ca<=0)))return true;
 }return false;
}
function faceViewer(t,eye){
 if(t.n.dot(eye.clone().sub(t.origin))>=0)return t;
 const b=basis(t.n.clone().negate());return {...t,...b,triangles:t.triangles?.map(p=>{const v=t.right.clone().multiplyScalar(p.x).addScaledVector(t.up,p.y);return new THREE.Vector2(v.dot(b.right),v.dot(b.up));})};
}
export function selectWeatherTarget(camera,targets){
 const eye=camera.getWorldPosition(new THREE.Vector3()),dir=camera.getWorldDirection(new THREE.Vector3());let best=null;
 const ray=new THREE.Raycaster(eye,dir,.1,20);ray.firstHitOnly=true;
 for(const t of targets){
  if(t.kind==='ceiling'&&dir.y<.06)continue;
  const hit=ray.intersectObject(t.pickMesh)[0];if(hit&&(!best||hit.distance<best.distance))best={target:t,...hit};
 }
 // Look across a useful area of the view, not just a pin-point on the glass/ceiling.
 // Each probe still checks nearer layout faces, so furniture cannot attract a window through it.
 let preferred=null;const meshes=targets.map(t=>t.pickMesh),byMesh=new Map(targets.map(t=>[t.pickMesh,t]));
 for(const y of [.65,.4,.15,0,-.25])for(const x of [-.45,-.22,0,.22,.45]){
  ray.setFromCamera(new THREE.Vector2(x,y),camera);const hits=ray.intersectObjects(meshes,false);if(!hits.length)continue;
  const first=hits[0].distance;
  for(const hit of hits){if(hit.distance>first+.08)break;const t=byMesh.get(hit.object);
   if(t.kind!=='window'&&!(t.kind==='ceiling'&&dir.y>.06&&y>=0))continue;
   if(t.kind==='window'&&(dir.y<-.4||Math.abs(x)>.45||y>.45))continue;
   const score=x*x+y*y*.65+(t.kind==='ceiling'?(dir.y>.22?-.22:.07):-.10);
   if(!preferred||score<preferred.score)preferred={target:t,...hit,score};
  }
 }
 if(preferred&&(!best||best.target.kind!=='window'||preferred.target.kind==='ceiling'&&dir.y>.35))best=preferred;
 if(!best)return null;
 let t=faceViewer(best.target,eye);
 if(t.kind==='horizontal'||t.kind==='vertical'){
  const width=Math.min(t.kind==='horizontal'?1.1:1.2,t.width*.94),height=Math.min(t.kind==='horizontal'?.85:1.45,t.height*.94),d=best.point.clone().sub(t.origin);
  const x=THREE.MathUtils.clamp(d.dot(t.right),-(t.width-width)/2,(t.width-width)/2),y=THREE.MathUtils.clamp(d.dot(t.up),-(t.height-height)/2,(t.height-height)/2);
  t={...t,partial:true,origin:t.origin.clone().addScaledVector(t.right,x).addScaledVector(t.up,y),width,height,triangles:t.triangles.map(p=>p.clone().sub(new THREE.Vector2(x,y)))};
 }
 return t;
}
function patchBoundary(target){
 const segments=[];if(!target.partial)return segments;
 // Keep only exterior triangle edges, including door/window holes, in the patch plane.
 const a=target.geometry.attributes.position,edges=new Map(),local=i=>{const d=new THREE.Vector3().fromBufferAttribute(a,i).sub(target.origin);return new THREE.Vector2(d.dot(target.right),d.dot(target.up));};
 for(let i=0;i<a.count;i+=3)for(const [u,v] of [[i,i+1],[i+1,i+2],[i+2,i]]){const p=local(u),q=local(v),key=[p.toArray().map(n=>n.toFixed(4)).join(','),q.toArray().map(n=>n.toFixed(4)).join(',')].sort().join('|');const old=edges.get(key);edges.set(key,{p,q,count:(old?.count||0)+1});}
 for(const {p,q,count} of edges.values())if(count===1&&Math.min(p.x,q.x)<target.width/2+.2&&Math.max(p.x,q.x)>-target.width/2-.2&&Math.min(p.y,q.y)<target.height/2+.2&&Math.max(p.y,q.y)>-target.height/2-.2)segments.push(new THREE.Vector4(p.x,p.y,q.x,q.y));
 return segments.slice(0,64);
}
function groundMaterial(entry,target){
 const horizontal=target.kind==='horizontal',night=entry.night,wet=['rain','storm'].includes(entry.condition),snow=entry.condition==='snow',fog=entry.condition==='fog',refined=!!target.geometry&&!target.partial;
 const palette=night?['#040a1c','#102746']:horizontal&&['clear','partly_cloudy'].includes(entry.condition)?['#d7a950','#fff0bb']:snow?['#a8bbc9','#d8e4eb']:wet?['#718eaa','#ccd9df']:['#8fbecf','#f1dfbd'];
 const boundary=patchBoundary(target),edgeCount=boundary.length;while(boundary.length<64)boundary.push(new THREE.Vector4());
 const uniforms={edgeCount:{value:edgeCount},boundary:{value:boundary},patchSize:{value:new THREE.Vector2(target.width,target.height)},time:{value:0},low:{value:new THREE.Color(palette[0])},high:{value:new THREE.Color(palette[1])},horizontal:{value:+horizontal},full:{value:+refined},wet:{value:+wet},snow:{value:+snow},night:{value:+night},sunny:{value:+['clear','partly_cloudy'].includes(entry.condition)},projection:{value:new THREE.Vector3()},depthBias:{value:0},opacity:{value:fog||horizontal&&!night&&['clear','partly_cloudy'].includes(entry.condition)?0:refined?(night?.94:.48):horizontal?(night?.88:.56):(night?.96:.78)},ceiling:{value:+(target.kind==='ceiling')}};
 return new THREE.ShaderMaterial({uniforms,transparent:true,depthWrite:false,depthTest:true,stencilWrite:target.kind==='ceiling',stencilRef:1,stencilFunc:THREE.NotEqualStencilFunc,stencilZPass:THREE.ReplaceStencilOp,side:THREE.DoubleSide,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-4,
 vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
 fragmentShader:`varying vec2 vUv;uniform float time,horizontal,full,wet,snow,night,sunny,opacity,ceiling;uniform vec3 low,high;uniform vec3 projection;uniform float depthBias;uniform int edgeCount;uniform vec4 boundary[64];uniform vec2 patchSize;
 void main(){vec2 p=vUv*2.-1.;float edge=mix(1.-smoothstep(.3,1.,pow(abs(p.x),3.)+pow(abs(p.y),3.)),1.-smoothstep(.15,1.,length(p)),horizontal);float border=min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y));edge=mix(edge,mix(smoothstep(0.,.015,border),1.,ceiling),full);
 if(edgeCount>0){vec2 at=(vUv-.5)*patchSize;float gap=100.;for(int i=0;i<64;i++){if(i>=edgeCount)break;vec2 a=boundary[i].xy,b=boundary[i].zw,ab=b-a;float t=clamp(dot(at-a,ab)/max(dot(ab,ab),.00001),0.,1.);gap=min(gap,length(at-a-t*ab));}edge*=smoothstep(0.,min(.14,min(patchSize.x,patchSize.y)*.18),gap);}
 float gradient=smoothstep(0.,1.,vUv.y);vec3 c=mix(high,low,mix(gradient*.8,.6,ceiling));float glow=exp(-length(p-vec2(-.3,.5))*3.)*(1.-night)*sunny;c+=vec3(.10,.065,.025)*glow;
 // Horizontal patches read as a sky-reflecting pool: midnight blue with rippled moonlight,
 // or a bright warm pool of daylight. The cues remain visible even without falling particles.
 if(horizontal>.5){vec2 q=(vUv-vec2(.48,.55))*patchSize;float ripple=sin(length(q)*65.-time*1.5)*.006;
  vec2 moon=q+vec2(ripple,0.);float disc=1.-smoothstep(.075,.091,length(moon));float shade=1.-smoothstep(.072,.087,length(moon-vec2(.035,.016)));
  float reflection=disc*(1.-shade*.9);float shimmer=pow(max(0.,sin(q.y*100.+time*1.1)),10.)*exp(-abs(q.x)*18.-abs(q.y)*5.);
  c=mix(c,c+vec3(.42,.52,.70)*reflection+vec3(.04,.07,.12)*shimmer,night);
  c+=vec3(.15,.09,.025)*(1.-night)*sunny*exp(-length(q)*3.);
 }
 if(horizontal<.5&&night<.5&&sunny>.5){vec2 corner=(vUv-vec2(.12,.88))*vec2(patchSize.x/patchSize.y,1.);float bloom=exp(-dot(corner,corner)*15.);c=mix(c,vec3(1.8,1.58,1.28),bloom*.95);}
 float cameraDepth=projection.y/(gl_FragCoord.z*2.-1.+projection.x);gl_FragDepth=projection.z>.5?(-projection.x+projection.y/max(.01,cameraDepth-depthBias))*.5+.5:gl_FragCoord.z+projection.x*depthBias*.5;float cornerLight=(1.-horizontal)*(1.-night)*sunny*exp(-dot((vUv-vec2(.12,.88))*vec2(patchSize.x/patchSize.y,1.),(vUv-vec2(.12,.88))*vec2(patchSize.x/patchSize.y,1.))*15.);gl_FragColor=vec4(c,edge*mix(opacity,.94,cornerLight));
 #include <colorspace_fragment>
 }`});
}
// A ray-marched density field inside a 3D box, with soft self-shadowing. No visible sphere seams.
function volumeMaterial(color,opacity){
 return new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.BackSide,toneMapped:false,uniforms:{time:{value:0},tint:{value:new THREE.Color(color)},density:{value:opacity},extent:{value:new THREE.Vector3(1,1,1)},beam:{value:0},cloudShape:{value:0},cloudSeed:{value:0},sceneDepth:{value:null},viewport:{value:new THREE.Vector2(1,1)},volumeMVP:{value:new THREE.Matrix4()}},
 vertexShader:`varying vec3 localPosition,localEye;void main(){localPosition=position;localEye=(inverse(modelMatrix)*vec4(cameraPosition,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
 fragmentShader:`varying vec3 localPosition,localEye;uniform float time,density,beam,cloudShape,cloudSeed;uniform vec3 tint,extent;uniform sampler2D sceneDepth;uniform vec2 viewport;uniform mat4 volumeMVP;
 float hash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
 float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
 float lobe(vec3 p,vec3 center,vec3 size){return length((p-center)/size)-1.;}
 float mergeCloud(float a,float b){float h=max(.15-abs(a-b),0.)/.15;return min(a,b)-h*h*.0375;}
 float field(vec3 p){
  if(beam>.5){float spread=mix(.4,1.,(p.y+1.)*.5);return (1.-smoothstep(0.,spread,length(p.xz)))*(1.-smoothstep(.55,1.,abs(p.y)));}
  vec3 q=p*extent*10.+vec3(time*.045,cloudSeed*7.,time*.025);
  float n=noise(q)*.65+noise(q*2.1)*.25+noise(q*4.3)*.1;
  if(cloudShape>.5){
   // A connected asymmetric density envelope, with one broad base and unequal
   // billows. Individual lobes never become separately rendered white balls.
   vec3 c=p;c.x*=mix(-1.,1.,step(.5,hash(vec3(cloudSeed,2.,5.))));
   c+=vec3(noise(p*2.7+cloudSeed)-.5,noise(p*3.1+cloudSeed+8.)-.5,0.)*.13;
   float peak=mix(.02,.24,hash(vec3(cloudSeed,4.,1.)));
   float body=lobe(c,vec3(-.49,-.11,-.03),vec3(.30,.42,.47));
   body=mergeCloud(body,lobe(c,vec3(-.14,peak,.02),vec3(.35,.61,.57)));
   body=mergeCloud(body,lobe(c,vec3(.24,.02,-.01),vec3(.31,.48,.53)));
   body=mergeCloud(body,lobe(c,vec3(.52,-.16,0.),vec3(.26,.29,.39)));
   body=mergeCloud(body,lobe(c,vec3(0.,-.24,.02),vec3(.77,.25,.45)));
   float envelope=1.-smoothstep(.88,1.,max(abs(p.x),max(abs(p.y),abs(p.z))));
   return (1.-smoothstep(-.18,.10,body+(n-.5)*.30))*smoothstep(.22,.68,n)*envelope;
  }
  float shape=1.-smoothstep(.48,1.,length(p*vec3(1.,1.25,1.15)));return shape*smoothstep(.22,.68,n);
 }
 void main(){vec3 rd=normalize(localPosition-localEye),inv=1./rd;vec3 a=(-vec3(1.)-localEye)*inv,b=(vec3(1.)-localEye)*inv;vec3 lo=min(a,b),hi=max(a,b);float start=max(0.,max(lo.x,max(lo.y,lo.z))),end=min(hi.x,min(hi.y,hi.z));if(end<=start)discard;
 float sceneZ=texture2D(sceneDepth,gl_FragCoord.xy/viewport).r;vec4 front=volumeMVP*vec4(localEye+rd*(start+.001),1.);gl_FragDepth=front.z/front.w*.5+.5;float stepSize=(end-start)/28.;vec4 sum=vec4(0.);for(int i=0;i<28;i++){vec3 p=localEye+rd*(start+(float(i)+.5)*stepSize);vec4 clip=volumeMVP*vec4(p,1.);if(clip.z/clip.w*.5+.5>sceneZ+.00001)break;float d=field(p),shade=clamp(.85+field(p)-field(p+vec3(-.18,.3,.15)),.6,1.15);float alpha=1.-exp(-d*density*stepSize);sum.rgb+=(1.-sum.a)*alpha*tint*shade;sum.a+=(1.-sum.a)*alpha;if(sum.a>.97)break;}if(sum.a<.002)discard;gl_FragColor=vec4(sum.rgb/max(sum.a,.001),sum.a);
 #include <colorspace_fragment>
 }`});
}
function mesh(geometry,color){const m=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,toneMapped:false,transparent:true,opacity:.95,depthWrite:false}));m.renderOrder=5;return m;}
// Ballistic world-gravity particles. Each spawn column is raycast against the physical
// environment once; particle position and contact effects are then deterministic in time.
function createPrecipitation(root,target,entry,seed,collide){
 const snow=entry.condition==='snow',ceiling=target.kind.startsWith('ceiling'),horizontal=target.kind==='horizontal',count=Math.round((ceiling?55:45)+entry.intensity*55);
 root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),inverseQ=root.quaternion.clone().invert(),dummy=new THREE.Object3D();
 const make=(name,geometry,color,n,opacity=1)=>{const m=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,toneMapped:false}),n);m.name=name;m.frustumCulled=false;m.renderOrder=6;root.add(m);return m;};
 const drops=make(snow?'snowflakes':'rain',snow?new THREE.SphereGeometry(1,8,6):new THREE.CylinderGeometry(.0012,.0005,.055,5),snow?0xfff7e4:0xb8e9ff,count,snow?.92:.68);
 const contact=make(snow?'snow-accumulation':'impact-ripples',snow?new THREE.SphereGeometry(1,10,7):new THREE.TorusGeometry(1,.025,5,36),snow?0xe5eeff:0xa1e2ed,count,.7);
 const splashes=snow?null:make('splash-droplets',new THREE.IcosahedronGeometry(1,0),0xc5edff,count*3,.7),columns=[];
 for(let i=0;i<count;i++){
  let x=0,y=0;for(let k=0;k<100;k++){x=(random(i*7+k*199+seed)-.5)*target.width*.78;y=(random(i*11+k*997+seed)-.5)*target.height*.78;if(contains(target,x,y))break;}
  const start=new THREE.Vector3(x,y,ceiling?.06:horizontal?.55:.14+random(i+7)*.15);
  if(!horizontal&&!ceiling)start.y=target.height*(.27+.08*random(i+5));
  start.applyMatrix4(root.matrixWorld);const hit=collide?.(start),distance=hit?.distance??3;
  const velocity=snow?.16:1.15,gravity=snow?.055:3.8,flight=(Math.sqrt(velocity*velocity+2*gravity*distance)-velocity)/gravity;
  const normal=hit?.normal||UP,rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
  columns.push({start,hit,flight,velocity,gravity,cycle:flight+(snow?2.6:.65),phase:random(i*29+seed),size:random(i+31)*.6+.65,rotation:inverseQ.clone().multiply(rotation)});
 }
 drops.userData.collisionCount=columns.filter(c=>c.hit).length;drops.userData.gravity='world -Y';
 const write=(m,i,position,quaternion,scale)=>{dummy.position.copy(position).applyMatrix4(inverse);dummy.quaternion.copy(quaternion);dummy.scale.copy(scale);dummy.updateMatrix();m.setMatrixAt(i,dummy.matrix);};
 const dropRotation=inverseQ.clone(),scale=new THREE.Vector3();
 function animate(t){for(let i=0;i<columns.length;i++){
  const c=columns[i],age=(t+c.phase*c.cycle)%c.cycle,fall=Math.min(age,c.flight),pos=c.start.clone();pos.y-=c.velocity*fall+.5*c.gravity*fall*fall;
  if(snow)pos.x+=Math.sin(fall*2+i)*.035*Math.sin(Math.PI*fall/c.flight);
  const airborne=age<c.flight;scale.setScalar(airborne?(snow?.0045*c.size:c.size):0);write(drops,i,pos,dropRotation,scale);
  const impactAge=age-c.flight,visible=!!c.hit&&impactAge>=0,hit=c.hit?.point||pos,n=c.hit?.normal||UP;
  const p=hit.clone().addScaledVector(n,.014);
  if(snow){const size=visible?.010*c.size*Math.min(1,impactAge*4+.2):0;scale.set(size,size,size*.23);}
  else{const life=Math.min(1,impactAge/.65),radius=visible?(.008+life*.085)*(1-life):0;scale.set(radius,radius,radius);}
  write(contact,i,p,c.rotation,scale);
  if(splashes)for(let j=0;j<3;j++){
   const a=i*2.4+j*2.094,u=Math.max(0,impactAge),splash=hit.clone().add(new THREE.Vector3(Math.cos(a)*u*.16,Math.max(0,.42*u-1.8*u*u),Math.sin(a)*u*.16));
   scale.setScalar(visible&&u<.22?.006*(1-u/.22):0);write(splashes,i*3+j,splash,dropRotation,scale);
  }
 }
 drops.instanceMatrix.needsUpdate=true;contact.instanceMatrix.needsUpdate=true;if(splashes)splashes.instanceMatrix.needsUpdate=true;
 }
 return {animate};
}
// Overlapping soft 3D volumes, rather than a screen tint. They spread out from the
// receiving surface and drift through room air; ordinary depth testing clips furniture.
function createFog(root,target,collide,night=false){
 root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),from=target.origin.clone().addScaledVector(target.n,.12),floor=collide?.(from)?.point;
 const center=(floor||from).clone(),radius=target.kind.startsWith('ceiling')?2:target.kind==='horizontal'?1.05:1.6,wisps=[];
 const geometry=new THREE.BoxGeometry(2,2,2);
 for(let i=0;i<9;i++){
  const material=volumeMaterial(night?(i%2?0x52617d:0x3e6575):(i%2?0xd5d9ef:0xc3e3e8),night?.55:.4);
  const w=new THREE.Mesh(geometry.clone(),material);w.name='drifting-fog';w.renderOrder=7;root.add(w);wisps.push({w,x:(random(i+44)-.5)*radius*2,z:(random(i+64)-.5)*radius*2,y:.1+random(i+84)*.6,size:.55+random(i+14)*.6});
 }
 geometry.dispose();
 function animate(t){const spread=.35+.65*(1-Math.exp(-t/4));
  wisps.forEach((p,i)=>{const world=center.clone().add(new THREE.Vector3(p.x*spread+.17*Math.sin(t*.12+i),p.y+.06*Math.sin(t*.25+i),p.z*spread+.15*Math.cos(t*.15+i)));
   p.w.position.copy(world).applyMatrix4(inverse);p.w.quaternion.copy(root.quaternion).invert();p.w.scale.set(p.size*(.8+spread*.7),.18+p.size*.22,p.size*(.8+spread*.6));p.w.material.uniforms.time.value=t;});
 }return {animate};
}
function buildPatch(target,entry,seed=1,collide,viewer){
 const root=new THREE.Group();root.name=`weather-${target.kind}-${target.id}`;root.position.copy(target.origin).addScaledVector(target.n,target.geometry?SURFACE_LIFT:.018);root.quaternion.copy(target.q);
 const mat=groundMaterial(entry,target),base=new THREE.Mesh(target.kind==='horizontal'?receiverGeometry(root,target,collide,(x,y)=>contains(target,x,y)):planeGeometry(target),mat);base.name='weather-surface';base.onBeforeRender=(_r,_s,c)=>mat.uniforms.projection.value.set(c.projectionMatrix.elements[10],c.projectionMatrix.elements[14],c.isPerspectiveCamera?1:0);base.renderOrder=4;root.add(base);
 const horizontal=target.kind==='horizontal',ceiling=target.kind.startsWith('ceiling'),small=Math.min(target.width,target.height),depth=Math.min(.55,small*.5),night=entry.night;
 const wet=['rain','storm'].includes(entry.condition),snow=entry.condition==='snow',cloudy=['cloudy','partly_cloudy','rain','snow','storm'].includes(entry.condition);
 const particles=[],decor=[],dummy=new THREE.Object3D();
 function field(name,count,geometry,color,scale,animate){
  const m=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial({color,toneMapped:false,transparent:true,opacity:name==='rain'?.68:.95,depthWrite:false}),count);m.name=name;m.frustumCulled=false;m.renderOrder=5;root.add(m);
  const seeds=[];for(let i=0;i<count;i++){let x=0,y=0;for(let k=0;k<100;k++){x=(random(seed+i*7+k*199)-.5)*target.width*(ceiling?.93:.73);y=(random(seed+i*11+k*997+2)-.5)*target.height*(ceiling?.93:.73);if(contains(target,x,y))break;}seeds.push({x,y,z:random(i+22)*depth,phase:random(i+77),size:scale*(.5+random(i+99))});}
  particles.push({m,seeds,animate});
 }
 if(night&&entry.condition!=='fog'){field('stars',Math.min(160,Math.max(26,Math.round(target.width*target.height*12))),new THREE.SphereGeometry(1,8,6),0xffe8ca,Math.min(.005,small*.002),(p,t,i)=>({x:p.x,y:p.y,z:.045+p.z*.2,s:p.size*(.65+.35*Math.sin(t*1.3+i))}));}
 const precipitation=(wet||snow)?createPrecipitation(root,target,entry,seed,collide):null;
 const fog=entry.condition==='fog'&&seed===1?createFog(root,target,collide,night):null;
 if(!horizontal){
  if(entry.condition!=='fog'&&seed===1&&small>.4&&night){const orb=celestialBody(night,THREE.MathUtils.clamp(small*.10,.045,.13),entry.day_offset||0);orb.position.set(-target.width*.18,target.height*.20,.18);root.add(orb);decor.push({o:orb,y:orb.position.y});}
  // Sparse, unequal cloud banks at metre scale; no rows of identical puffs.
  if(cloudy&&small>.4){const count=Math.min(4,Math.max(1,Math.floor(target.width*target.height/3.5)));
   for(let i=0;i<count;i++){const key=seed*31+i*17,radius=Math.min(.43,small*.38)*(.78+random(key+3)*.22),material=volumeMaterial(night?0x889bb8:0xeff4f6,3.6),cloud=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),material);cloud.name='weather-cloud';
    material.uniforms.cloudShape.value=1;material.uniforms.cloudSeed.value=key;
    const x=(random(key+9)-.5)*Math.max(0,target.width-radius*2.2),y=(random(key+17)-.15)*Math.max(0,target.height-radius*1.3)*.55;
    cloud.scale.set(radius,radius*(.48+random(key+4)*.14),radius*(.42+random(key+5)*.13));cloud.position.set(x,y,radius*.68);cloud.quaternion.copy(root.quaternion).invert().multiply(new THREE.Quaternion().setFromAxisAngle(UP,Math.atan2(viewer.x-target.origin.x,viewer.z-target.origin.z)+(random(key+6)-.5)*.35));
    root.add(cloud);decor.push({o:cloud,x,y});
   }
  }


 }else if(!night&&['clear','partly_cloudy'].includes(entry.condition)){
  field('sun-motes',54,new THREE.SphereGeometry(1,8,6),0xffe6a8,.0045,(p,t,i)=>({x:p.x+.015*Math.sin(t*.3+i),y:p.y,z:.02+fract(t*.06+p.phase)*.35,s:p.size*(.5+.5*Math.sin(t+i)**2)}));
 }

 if(night)createNightfall(root,target,collide);
 const sunlight=!night&&['clear','partly_cloudy'].includes(entry.condition)?createSunlight(root,target,collide,volumeMaterial,(x,y)=>contains(target,x,y)):null;
 root.userData.forecast={id:entry.id,label:entry.label,summary:entry.summary,temp_c:entry.temp_c};
 function animate(t){mat.uniforms.time.value=t;precipitation?.animate(t);fog?.animate(t);sunlight?.animate(t);
  for(const f of particles){f.seeds.forEach((p,i)=>{const a=f.animate(p,t,i);dummy.position.set(a.x,a.y,a.z);dummy.rotation.set(a.rx||0,0,t*.08);dummy.scale.setScalar(a.s);dummy.updateMatrix();f.m.setMatrixAt(i,dummy.matrix);});f.m.instanceMatrix.needsUpdate=true;}
  for(const d of decor){if(d.ripple){const k=fract(t*.4+d.phase);d.o.scale.setScalar(.15+k*1.1);d.o.material.opacity=(1-k)*.7;}else if(d.petal)d.o.material.opacity=.65+.15*Math.sin(t+d.phase);else{d.o.userData.animate?.(t);if(d.o.material?.uniforms?.time)d.o.material.uniforms.time.value=t;d.o.position.y=d.y+small*.012*Math.sin(t*.55+(d.x||0)*3);if(d.x!==undefined)d.o.position.x=d.x+small*.024*Math.sin(t*.2+d.x);}}
 }
 // Stencil only prevents overlapping ceiling polygons from darkening twice. Text never masks weather.
 root.traverse(o=>{if(o.material)o.material.stencilWrite=false;});
 if(ceiling)Object.assign(mat,{stencilWrite:true,stencilRef:1,stencilFunc:THREE.NotEqualStencilFunc,stencilFuncMask:1,stencilWriteMask:1,stencilZPass:THREE.ReplaceStencilOp});
 animate(0);return {root,animate};
}
export function createWeatherScene({scene,getCamera,getRoom,getOccluders=()=>[getRoom()],getObjects=()=>[],getDepthOccluder=()=>null,getStability=()=>0,onAnimate,onLabel}){
 const playback=createWeatherPlayback();
 const group=new THREE.Group();group.name='weather-environment';scene.add(group);let enabled=false,surfaceTargets=[],patches=[],response=null,signature='',target=null,lastPose='',lastStability=-1,started=0,raf=0,lastPaint=0;

 const depthScene=new THREE.Scene(),overlayScene=new THREE.Scene(),depthMaterial=new THREE.MeshBasicMaterial({colorWrite:false,side:THREE.DoubleSide}),depthCopies=new Map(),depthTargets=new WeakMap(),allDepthTargets=new Set();
 let frameDepth=null;
 function render(renderer,camera){
  if(!enabled||!patches.length)return;
  const depthSource=getDepthOccluder(camera);
  if(depthSource&&!frameDepth){frameDepth=new THREE.Mesh(depthSource.geometry,depthSource.material.clone());frameDepth.material.uniforms=depthSource.material.uniforms;frameDepth.material.depthFunc=THREE.LessEqualDepth;frameDepth.frustumCulled=false;frameDepth.renderOrder=-2;depthScene.add(frameDepth);}
  if(frameDepth)frameDepth.visible=!!depthSource;group.userData.frameDepth=!!depthSource;
  const sources=[];for(const root of [...getOccluders(),...getObjects()].filter(Boolean)){root.updateMatrixWorld(true);root.traverse(o=>{if(o.isMesh)sources.push(o);});}
  group.userData.occlusionRoots=getOccluders().filter(Boolean).map(o=>o.name);
  for(const [source,copy] of depthCopies)if(!sources.includes(source)){copy.removeFromParent();depthCopies.delete(source);}
  for(const source of sources){let copy=depthCopies.get(source);if(!copy){copy=new THREE.Mesh(source.geometry,depthMaterial);copy.matrixAutoUpdate=false;depthCopies.set(source,copy);depthScene.add(copy);}copy.matrix.copy(source.matrixWorld);}
  const size=renderer.getDrawingBufferSize(new THREE.Vector2());let rt=depthTargets.get(renderer);
  if(!rt){rt=new THREE.WebGLRenderTarget(size.x,size.y,{depthTexture:new THREE.DepthTexture(size.x,size.y,THREE.UnsignedIntType)});depthTargets.set(renderer,rt);allDepthTargets.add(rt);}if(rt.width!==size.x||rt.height!==size.y)rt.setSize(size.x,size.y);
  const previous=renderer.getRenderTarget(),auto=renderer.autoClear,parent=group.parent;
  try{
   renderer.autoClear=true;renderer.setRenderTarget(rt);renderer.render(depthScene,camera);
   group.traverse(o=>{if(o.material?.uniforms?.ambientDepth){o.material.uniforms.ambientDepth.value=rt.depthTexture;o.material.uniforms.viewport.value.copy(size);}if(o.material?.uniforms?.volumeMVP){o.updateWorldMatrix(true,false);const u=o.material.uniforms;u.extent.value.copy(o.scale);u.sceneDepth.value=rt.depthTexture;u.viewport.value.copy(size);u.volumeMVP.value.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(o.matrixWorld);}});
   renderer.setRenderTarget(previous);renderer.autoClear=false;renderer.clearDepth();renderer.clearStencil();renderer.render(depthScene,camera);
   overlayScene.add(group);group.visible=true;renderer.render(overlayScene,camera);
  }finally{parent?.add(group);renderer.setRenderTarget(previous);renderer.autoClear=auto;}
 }
 function clear(){for(const p of patches){group.remove(p.root);p.root.traverse(o=>{o.geometry?.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}o.dispose?.();});}patches=[];signature='';target=null;onLabel?.(null);}
 function setLayout(sem){clear();for(const t of surfaceTargets){t.geometry.dispose();t.pickMesh.material.dispose();}surfaceTargets=buildWeatherTargets(sem);lastPose='';}
 function collision(origin,direction=new THREE.Vector3(0,-1,0)){
  const ray=new THREE.Raycaster(origin,direction,.015,12);ray.firstHitOnly=true;
  const objects=[...getOccluders(),...getObjects()].filter(Boolean);objects.forEach(o=>o.updateMatrixWorld(true));const hit=ray.intersectObjects(objects,true)[0];
  let best=hit?{point:hit.point,normal:hit.face.normal.clone().transformDirection(hit.object.matrixWorld),distance:hit.distance}:null;
  for(const t of surfaceTargets){if(t.kind!=='horizontal')continue;const den=ray.ray.direction.dot(t.n);if(Math.abs(den)<.01)continue;
   const distance=t.origin.clone().sub(origin).dot(t.n)/den;if(distance<.015||distance>8||best&&distance>=best.distance)continue;
   const point=ray.ray.at(distance,new THREE.Vector3()),local=point.clone().sub(t.origin);if(contains(t,local.dot(t.right),local.dot(t.up)))best={point,normal:t.n.clone(),distance};
  }
  if(best&&best.normal.y<0)best.normal.negate();return best;
 }
 function visibleFraction(t,camera){
  if(!t)return 0;const eye=camera.getWorldPosition(new THREE.Vector3()),objects=[...getOccluders(),...getObjects()].filter(Boolean),ray=new THREE.Raycaster();ray.firstHitOnly=true;objects.forEach(o=>o.updateMatrixWorld(true));let tested=0,visible=0;
  for(const point of posePoints(t)){const ndc=point.clone().project(camera);if(Math.abs(ndc.x)>1||Math.abs(ndc.y)>1||ndc.z< -1||ndc.z>1)continue;tested++;
   const direction=point.clone().sub(eye),distance=direction.length();ray.set(eye,direction.normalize());ray.near=.03;ray.far=Math.max(.03,distance-.20);if(!ray.intersectObjects(objects,true).length)visible++;
  }
  return tested?visible/tested:1;
 }
 function refresh(){
  if(!enabled||!response?.weather?.forecast?.length){if(patches.length)clear();group.visible=false;return;}
  group.visible=true;const camera=getCamera();camera.updateMatrixWorld(true);const pose=[...camera.position.toArray(),...camera.quaternion.toArray()].map(v=>v.toFixed(3)).join();
  const stability=getStability();
  if(pose!==lastPose||stability!==lastStability||!target){
   const next=selectWeatherTarget(camera,surfaceTargets),decision=chooseStablePlacement({current:target,candidate:next,camera,stability,kind:'weather',occlusion:stability>0?visibleFraction(target,camera):1});lastPose=pose;lastStability=stability;group.userData.placementDecision=decision;
   if(!decision.hold){
   if(next&&(!target||next.id!==target.id||next.origin.distanceTo(target.origin)>.18||next.n.dot(target.n)<.98))target=next;
   else if(!next)target=null;
   }
  }
  const elapsed=(performance.now()-started)/1000,state=playback.tick(performance.now()),entry=state.entry;
  const key=target?`${response.id}:${entry.id}:${target.id}:${target.origin.toArray().map(x=>x.toFixed(2))}`:'';
  if(key!==signature){const chosen=target;clear();target=chosen;signature=key;
   if(target){const whole=target.kind==='ceiling'?surfaceTargets.filter(t=>t.kind==='ceiling'&&(target.room?t.zones.includes(target.room):t.id===target.id)):target.kind==='window'?surfaceTargets.filter(t=>t.kind==='window'&&(target.wall?t.wall===target.wall:t.id===target.id)&&t.origin.distanceTo(target.origin)<2.5):[target];
    whole.sort((a,b)=>(Math.min(b.width,b.height)>.4)-(Math.min(a.width,a.height)>.4)||(b.id===target.id)-(a.id===target.id));patches=whole.map((t,i)=>buildPatch(faceViewer(t,camera.position),entry,i+1,collision,camera.position));patches.forEach(p=>group.add(p.root));}
  }
  onLabel?.({entry,playback:state,target:target?.kind||null,index:state.index+1,total:state.total});
  for(const p of patches)p.animate(elapsed);
 }
 function loop(now){raf=0;if(!enabled||!response)return;if(now-lastPaint>32){lastPaint=now;refresh();onAnimate?.();}raf=requestAnimationFrame(loop);}
 return {group,render,playback,setLayout,get surfaceTargets(){return surfaceTargets;},refresh,get target(){return target;},get active(){return response;},
  setEnabled(on){enabled=on;if(!on){cancelAnimationFrame(raf);raf=0;clear();group.visible=false;}else{refresh();if(response&&!raf)raf=requestAnimationFrame(loop);}},
  setResponse(r){if(response===r)return;if(response&&r&&response.weather_identity!=null&&response.weather_identity===r.weather_identity){response=r;return;}response=r;playback.load(r?.weather);started=performance.now();lastPose='';clear();refresh();if(!response){cancelAnimationFrame(raf);raf=0;}else if(enabled&&!raf)raf=requestAnimationFrame(loop);},
  dispose(){cancelAnimationFrame(raf);setLayout({});for(const t of allDepthTargets)t.dispose();depthMaterial.dispose();frameDepth?.material.dispose();depthScene.clear();group.removeFromParent();}};
}
