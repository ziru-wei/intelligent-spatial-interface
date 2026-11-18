// Spatial UI cues (modos-system-design.md 4.4): UI that belongs to the room, attached to a thing's own geometry or to the floor, not a
// panel. Each cue is built for one target ({center, size, yaw} of a thing, or a room's floor polygon) as seen from where the question was
// asked; which face, edge or surround it uses follows from the thing's size and which side faces the user. Bright cyan, breathing.
//   point to a thing   breathingBox · footprintRing · beacon · cornerBrackets
//   point to a place   floorArea · doorwayGlow
//   direction          arrowAhead · floorPath
//   values / controls  haloDial · edgeBar · powerPuck · edgeTabs
//   progress / status  progressRail · cardStack · pinnedTags · statusPulse
//   link               textArrow (text → the thing it is about; not a direction)
//   adjust (sent)      edgeBar (Slider: sent when let go) · edgeTabs · iconButton · text button: the change goes to the thing
//   explore (local)    datePicker · playback: moves through information; nothing is sent
//   action             tetherSend
import * as THREE from 'three';
import {label,wrapLines} from './kit.mjs';

export const CYAN=0x3ff0ff,AMBER=0xffc857,RED=0xff6b5e;
const glow=(color=CYAN,opacity=1)=>new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthTest:false,depthWrite:false,toneMapped:false});
const lit=(color=CYAN,emissive=.45)=>new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:emissive,roughness:.35,metalness:.1});
const breathe=(now,period=1600,lo=.45,hi=1)=>lo+(hi-lo)*(.5-.5*Math.cos(now/period*2*Math.PI));

/** A thing's frame as seen by the user: centre, up, the face toward the user (n), the user's right (r), and extents along them. */
export function frameOf(box,eye){
  const c=new THREE.Vector3(...box.center),yaw=THREE.MathUtils.degToRad(box.yaw||0),ax=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw)),az=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw));
  const to=eye.clone().sub(c);to.y=0;to.normalize();
  const cands=[[ax,box.size[0],box.size[2]],[ax.clone().negate(),box.size[0],box.size[2]],[az,box.size[2],box.size[0]],[az.clone().negate(),box.size[2],box.size[0]]];
  const [n,depthAlong,widthAcross]=cands.sort((a,b)=>b[0].dot(to)-a[0].dot(to))[0];
  const r=new THREE.Vector3().crossVectors(n.clone().negate(),new THREE.Vector3(0,1,0)).normalize();   // the user's right, looking at it
  return {c,up:new THREE.Vector3(0,1,0),n,r,w:widthAcross,d:depthAlong,h:box.size[1],yaw:Math.atan2(n.x,n.z)};
}
const at=(f,{x=0,y=0,z=0})=>f.c.clone().addScaledVector(f.r,x).addScaledVector(f.up,y).addScaledVector(f.n,z);
const facing=(obj,f)=>{obj.rotation.set(0,f.yaw,0);return obj;};
// Labels read at the same size whatever the distance (setScale: the cue's distance / arm's length).
let K=1;export const setScale=k=>{K=k;};
const tag=(text,opts={})=>{const l=label(text,{size:.03,weight:650,...opts,size:(opts.size||.03)*K,maxWidth:(opts.maxWidth||.4)*K});l.geometry.translate(-l.userData.width/2,0,0);return l;};
// Every clickable is a capsule: a rounded slab whose ends are half circles.
export function capsule(w,h,d=.01){
  const r=Math.min(h,w)/2,x=w/2-r,sh=new THREE.Shape();sh.moveTo(-x,-r);sh.lineTo(x,-r);sh.absarc(x,0,r,-Math.PI/2,Math.PI/2,false);sh.lineTo(-x,r);sh.absarc(-x,0,r,Math.PI/2,Math.PI*1.5,false);
  const g=new THREE.ExtrudeGeometry(sh,{depth:d,bevelEnabled:false,curveSegments:16});g.translate(0,0,-d/2);return g;
}
// A visible line in WebGL (1 px lines are too thin): a thin tube between each pair of points.
function tubes(pairs,radius=.006,material=glow(CYAN,.95)){
  const g=new THREE.Group();
  for(let i=0;i<pairs.length;i+=2){const a=pairs[i],b=pairs[i+1],len=a.distanceTo(b),m=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,len,10),material);
    m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize());g.add(m);}
  return g;
}

// ——— point to a thing ———
export function breathingBox(box,{strength=1}={}){
  const g=new THREE.Group(),fill=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),glow(CYAN,.16)),edge=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),glow(CYAN,.95));
  g.add(fill,edge);g.position.fromArray(box.center);g.scale.fromArray(box.size).multiplyScalar(1.03);g.rotation.y=THREE.MathUtils.degToRad(box.yaw||0);
  return {group:g,update(now){const k=breathe(now);fill.material.opacity=(.08+.14*k)*strength;edge.material.opacity=(.45+.5*k)*strength;}};
}
export function footprintRing(box){
  // the thing's own footprint (its box seen from above, corners rounded), a little larger, on the surface it stands on
  const g=new THREE.Group(),w=box.size[0]+.06,d=box.size[2]+.06,r=Math.min(.05,w/2,d/2),sh=new THREE.Shape();
  sh.moveTo(-w/2+r,-d/2);sh.lineTo(w/2-r,-d/2);sh.absarc(w/2-r,-d/2+r,r,-Math.PI/2,0);sh.lineTo(w/2,d/2-r);sh.absarc(w/2-r,d/2-r,r,0,Math.PI/2);
  sh.lineTo(-w/2+r,d/2);sh.absarc(-w/2+r,d/2-r,r,Math.PI/2,Math.PI);sh.lineTo(-w/2,-d/2+r);sh.absarc(-w/2+r,-d/2+r,r,Math.PI,Math.PI*1.5);
  const pts=sh.getPoints(12).map(p=>new THREE.Vector3(p.x,0,p.y)),em=glow(CYAN,.95),edge=tubes(pts.flatMap((p,i)=>[p,pts[(i+1)%pts.length]]),.005,em);
  const disc=new THREE.Mesh(new THREE.ShapeGeometry(sh),glow(CYAN,.18));disc.rotation.x=Math.PI/2;g.add(disc,edge);
  g.position.set(box.center[0],box.center[1]-box.size[1]/2+.004,box.center[2]);g.rotation.y=THREE.MathUtils.degToRad(box.yaw||0);
  return {group:g,update(now){const k=breathe(now);em.opacity=.5+.45*k;disc.material.opacity=.08+.14*k;}};
}
export function beacon(box){
  const g=new THREE.Group(),hgt=1.4,col=new THREE.Mesh(new THREE.CylinderGeometry(.035,.06,hgt,24,1,true),glow(CYAN,.35));
  col.position.y=hgt/2;g.add(col);const cap=new THREE.Mesh(new THREE.SphereGeometry(.03,20,14),lit());cap.position.y=hgt;g.add(cap);
  g.position.set(box.center[0],box.center[1]+box.size[1]/2,box.center[2]);
  return {group:g,update(now){const k=breathe(now,1200);col.material.opacity=.15+.3*k;cap.position.y=hgt+.03*k;}};
}
export function cornerBrackets(box){
  const g=new THREE.Group(),[sx,sy,sz]=box.size.map(v=>v/2*1.04),l=Math.min(sx,sy,sz,.12)*1.2,m=glow(CYAN,.95);
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){const p=new THREE.Vector3(x*sx,y*sy,z*sz),pts=[];
    for(const axis of [[1,0,0],[0,1,0],[0,0,1]]){const q=p.clone().add(new THREE.Vector3(...axis).multiply(new THREE.Vector3(-x,-y,-z)).multiplyScalar(l));pts.push(p.clone(),q);}
    g.add(tubes(pts,.008,m));}
  g.position.fromArray(box.center);g.rotation.y=THREE.MathUtils.degToRad(box.yaw||0);
  return {group:g,update(now){m.opacity=.5+.45*breathe(now);g.scale.setScalar(1+.015*breathe(now));}};
}

// ——— point to a place ———
export function floorArea(room){
  const ring=room.ring,shape=new THREE.Shape(ring.map(([x,z])=>new THREE.Vector2(x,-z))),g=new THREE.Group();
  const fill=new THREE.Mesh(new THREE.ShapeGeometry(shape),glow(CYAN,.16));fill.rotation.x=-Math.PI/2;
  const em=glow(CYAN,.95),pts=ring.map(([x,z])=>new THREE.Vector3(x,0,z)),pairs=pts.flatMap((p,i)=>[p,pts[(i+1)%pts.length]]);
  const edge={material:em};g.add(fill,tubes(pairs,.012,em));g.position.y=room.floorY+.012;
  return {group:g,update(now){const k=breathe(now,2000);fill.material.opacity=.06+.14*k;edge.material.opacity=.5+.45*k;}};
}
export function doorwayGlow(door,name,eye){
  const f=frameOf(door,eye),g=new THREE.Group(),m=glow(CYAN,.95),w=f.w/2,h=f.h/2;
  const pts=[[-w,-h],[-w,h],[w,h],[w,-h]].map(([x,y])=>at(f,{x,y,z:f.d/2+.01}));g.add(tubes([pts[0],pts[1],pts[1],pts[2],pts[2],pts[3]],.012,m));
  const sheen=new THREE.Mesh(new THREE.PlaneGeometry(f.w,f.h),glow(CYAN,.1));sheen.position.copy(at(f,{z:f.d/2+.012}));facing(sheen,f);g.add(sheen);
  const sign=new THREE.Group(),t=tag(name,{size:.06,weight:700}),plate=new THREE.Mesh(new THREE.BoxGeometry(t.userData.width+.08,.1,.015),lit(0x14161a,0));
  t.position.z=.01;sign.add(plate,t);sign.position.copy(at(f,{y:h+.12,z:f.d/2+.02}));facing(sign,f);g.add(sign);
  return {group:g,update(now){const k=breathe(now);m.opacity=.5+.45*k;sheen.material.opacity=.04+.1*k;}};
}

// ——— direction ———
export function arrowAhead(target,camera){
  const g=new THREE.Group(),m=lit();const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.009,.009,.07,20),m);shaft.rotation.z=Math.PI/2;shaft.position.x=-.02;
  const head=new THREE.Mesh(new THREE.ConeGeometry(.024,.05,24),m);head.rotation.z=-Math.PI/2;head.position.x=.035;g.add(shaft,head);
  return {group:g,update(now){camera.updateMatrixWorld(true);const f=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion),up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion),side=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
    const local=new THREE.Vector3(...target.center).applyMatrix4(camera.matrixWorldInverse),dir=new THREE.Vector2(local.x,local.y).normalize();
    g.position.copy(camera.position).addScaledVector(f,.55).addScaledVector(side,dir.x*.12).addScaledVector(up,dir.y*.08-.06+Math.sin(now/260)*.006);
    g.quaternion.copy(camera.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.atan2(dir.y,dir.x)));}};
}
export function floorPath(points){
  // flat chevrons lying on the floor along a walking route (src/floor-route.mjs: through rooms and doors), lighting up one after another
  // toward the target; points: [[x,z,floorY,yaw], …] spaced along the route
  const g=new THREE.Group(),dots=[];
  const sh=new THREE.Shape();sh.moveTo(0,.09);sh.lineTo(.09,-.02);sh.lineTo(.05,-.05);sh.lineTo(0,.02);sh.lineTo(-.05,-.05);sh.lineTo(-.09,-.02);sh.closePath();
  for(const [x,z,y,yaw] of points){const m=new THREE.Mesh(new THREE.ShapeGeometry(sh),glow(CYAN,.8));m.geometry.rotateX(-Math.PI/2);m.rotation.y=yaw+Math.PI;m.position.set(x,y+.012,z);g.add(m);dots.push(m);}
  return {group:g,update(now){dots.forEach((d,i)=>{d.material.opacity=.2+.75*Math.max(0,Math.sin(now/240-i*.45));});}};
}

// Text Arrow: links a piece of text to the thing it is about, when the text stands apart from it (Floating or Embedded Text beside a
// poster, a bowl). Not a direction: Arrow Ahead and Floor Path lead the user somewhere; this only says "this text is about that".
// A bright cyan polyline, a shaft and an open head, flat and turned to the viewer, in the glow style of the other cues.
// start, end: world points (the text's edge, just short of the thing's outline).
export function textArrow(start,end,{opacity=1,width=1}={}){   // width: the UI library's Text Arrow thickness (×)
  const g=new THREE.Group(),a=new THREE.Vector3(...(start.toArray?start.toArray():start)),b=new THREE.Vector3(...(end.toArray?end.toArray():end)),L=a.distanceTo(b);
  const w=Math.min(.01,Math.max(.004,L*.05))*width,head=Math.min(.05,Math.max(.022,L*.3)),ang=THREE.MathUtils.degToRad(30);
  const core=glow(CYAN,.95*opacity),soft=glow(CYAN,.22*opacity);
  // strips in the arrow's own plane: x along the arrow (0 at the tip), y across it
  const strip=(x0,y0,x1,y1,width,mat)=>{const len=Math.hypot(x1-x0,y1-y0)+width,m=new THREE.Mesh(new THREE.PlaneGeometry(len,width),mat);
    m.position.set((x0+x1)/2,(y0+y1)/2,0);m.rotation.z=Math.atan2(y1-y0,x1-x0);return m;};
  for(const [width,mat] of [[w*3,soft],[w,core]]){
    g.add(strip(-L,0,0,0,width,mat),strip(0,0,-head*Math.cos(ang),head*Math.sin(ang),width,mat),strip(0,0,-head*Math.cos(ang),-head*Math.sin(ang),width,mat));}
  g.position.copy(b);const x=b.clone().sub(a).normalize();
  return {group:g,update(now,camera){if(!camera)return;const toEye=camera.position.clone().sub(b),z=toEye.addScaledVector(x,-toEye.dot(x)).normalize(),y=z.clone().cross(x);
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));}};
}

// ——— values and controls on the thing ———
export function haloDial(box,eye,{value=60,min=0,max=100,unit='%',name='brightness'}={}){
  const f=frameOf(box,eye),g=new THREE.Group(),rad=Math.max(f.w,f.d)/2+.07,k=(value-min)/(max-min);
  const track=new THREE.Mesh(new THREE.TorusGeometry(rad,.004,8,96),lit(0x3a3e46,0));const fill=new THREE.Mesh(new THREE.TorusGeometry(rad,.0065,10,96,Math.PI*2*k),lit());
  for(const m of [track,fill]){m.rotation.x=Math.PI/2;g.add(m);}fill.rotation.z=f.yaw-Math.PI/2;
  const knob=new THREE.Mesh(new THREE.SphereGeometry(.014,20,14),lit(0xffffff,.2));const ang=f.yaw-Math.PI/2+Math.PI*2*k;knob.position.set(Math.cos(ang)*rad,0,-Math.sin(ang)*rad);g.add(knob);
  const t=tag(`${name} ${Math.round(value)}${unit}`,{size:.025});t.position.set(f.n.x*rad,.03,f.n.z*rad);facing(t,f);g.add(t);
  g.position.copy(at(f,{y:f.h/2-.02}));
  return {group:g,update(now){fill.material.emissiveIntensity=.3+.3*breathe(now);}};
}
export function edgeBar(box,eye,{value=20,min=0,max=100,name='volume',unit='',from=null,changeAt=0,onSet=null}={}){
  const f=frameOf(box,eye),g=new THREE.Group(),len=Math.max(.18,f.h*.8),kOf=v=>(v-min)/(max-min||1);
  const track=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,len,16),lit(0x3a3e46,0));const fill=new THREE.Mesh(new THREE.CylinderGeometry(.0085,.0085,1,16),lit());
  const knob=new THREE.Mesh(new THREE.SphereGeometry(.016,20,14),lit(0xffffff,.2));g.add(track,fill,knob);
  // a wider invisible grip, so the bar is easy to drag
  const grip=new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,len,8),new THREE.MeshBasicMaterial({visible:false}));g.add(grip);
  // Adjust: dragging shows the value on the bar; the change is sent once, when the user lets go (onSet)
  let live=null;const valueAt=point=>{const y=g.worldToLocal(point.clone()).y,k=Math.min(1,Math.max(0,(y+len/2)/len));return min+k*(max-min);};
  if(onSet){grip.userData.onDrag=point=>{live=valueAt(point);};grip.userData.onRelease=()=>{if(live!==null)onSet(live);};}
  let t=null,shown=null;const set=v=>{const k=Math.min(1,Math.max(0,kOf(v)));fill.scale.y=Math.max(.001,len*k);fill.position.y=-len/2+len*k/2;knob.position.y=-len/2+len*k;
    const txt=`${name} ${Math.round(v)}${unit}`;if(txt!==shown){shown=txt;if(t)g.remove(t);t=tag(txt,{size:.03});t.position.set(0,len/2+.04,0);g.add(t);}};
  set(from??value);g.position.copy(at(f,{x:f.w/2+.06,z:f.d/2}));facing(g,f);
  return {group:g,update(now){if(live!==null)return set(live);if(from===null||!changeAt)return set(value);const u=Math.min(1,Math.max(0,(now-changeAt)/700)),e=u*u*(3-2*u);set(from+(value-from)*e);}};
}
// An icon button: the icon and what pressing it does, side by side (toggles and commands: power, cancel, pause, send).
// icon: a preset's icon (modos/buttons.json); null for a text-only button the system wrote when no preset fits.
export function iconButton(box,eye,{icon='⏻',text='Turn off',on=true,onPress=null}={}){
  const f=frameOf(box,eye),g=new THREE.Group(),ink=on?'#062a2e':'#e6e8ec',words=tag(text,{size:.026,weight:650,color:ink,stroke:!on}),lead=icon?.06:.03,w=lead+words.userData.width+.03;
  const pill=new THREE.Mesh(capsule(w,.05),lit(on?CYAN:0x2b2e34,on?.45:0));if(onPress)pill.userData.onHit=onPress;g.add(pill);
  if(icon){const glyph=tag(icon,{size:.03,weight:700,color:ink,stroke:!on});glyph.position.set(-w/2+.03,0,.007);g.add(glyph);}
  words.position.set(-w/2+lead+words.userData.width/2,0,.007);g.add(words);
  g.position.copy(at(f,{x:0,y:f.h/2+.06,z:f.d/2}));   // centred above the thing, turned to the user
  g.position.y+=0;g.rotation.set(0,Math.atan2(eye.x-g.position.x,eye.z-g.position.z),0);
  return {group:g,update(now){if(on)pill.material.emissiveIntensity=.3+.25*breathe(now);}};
}
export const powerPuck=iconButton;
export function edgeTabs(box,eye,{options=['HDMI 1','HDMI 2','HDMI 3'],value='HDMI 2',onPick=null}={}){
  const f=frameOf(box,eye),g=new THREE.Group(),span=Math.max(f.w*.8,.3),w=span/options.length;
  options.forEach((o,i)=>{const on=o===value,p=new THREE.Mesh(capsule(w-.012,.045,.012),lit(on?CYAN:0x2b2e34,on?.45:0));if(onPick)p.userData.onHit=()=>onPick(o);
    const t=tag(o,{size:.024,color:on?'#062a2e':'#ffffff',stroke:false});t.position.z=.008;const cell=new THREE.Group();cell.add(p,t);cell.position.x=-span/2+w/2+i*w;cell.position.z=on?.012:0;g.add(cell);});
  const row=new THREE.Group();row.add(g);row.position.copy(at(f,{y:-f.h/2+.05,z:f.d/2+.03}));facing(row,f);
  return {group:row,update(){}};
}

// ——— progress, queue, readings, status ———
export function progressRail(box,eye,{title='Ana\'s CHI poster',owner='',done=7,total=12,unit='pages'}={}){
  // a task's progress as the device reports it: done of total (no time estimate)
  const f=frameOf(box,eye),g=new THREE.Group(),len=Math.max(f.w,.3),k=Math.min(1,Math.max(0,(done||0)/(total||1)));
  const track=new THREE.Mesh(new THREE.CylinderGeometry(.005,.005,len,16),lit(0x3a3e46,0));track.rotation.z=Math.PI/2;
  const fill=new THREE.Mesh(new THREE.CylinderGeometry(.0068,.0068,Math.max(.001,len*k),16),lit());fill.rotation.z=Math.PI/2;fill.position.x=-len/2+len*k/2;
  const token=new THREE.Mesh(new THREE.BoxGeometry(.016,.022,.003),lit(0xffffff,.1));token.position.set(-len/2+len*k,.014,0);g.add(track,fill,token);
  const name=tag(owner&&!title.toLowerCase().includes(owner.split(' ')[0].toLowerCase())?`${title} · ${owner}`:title,{size:.026,weight:700});name.position.y=.045;g.add(name);
  const info=tag(`${done} of ${total} ${unit}`.trim(),{size:.022,weight:500,color:'#d6f9fc'});info.position.y=-.03;g.add(info);
  const row=new THREE.Group();row.add(g);row.position.copy(at(f,{y:f.h/2+.03,z:f.d/2}));facing(row,f);
  return {group:row,update(){}};
}
export function cardStack(box,eye,{items=['Lab meeting slides · 3 pages','Consent forms · 8 pages']}={}){
  const f=frameOf(box,eye),g=new THREE.Group();
  items.slice(0,3).forEach((it,i)=>{const card=new THREE.Mesh(new THREE.BoxGeometry(.16,.11,.003),lit(i?0x2b2e34:0x343840,0));card.position.set(i*.012,i*.012,-i*.012);g.add(card);
    if(!i){const t=tag(it,{size:.016,maxWidth:.15});t.position.set(0,0,.004);g.add(t);const n=tag('next',{size:.013,color:'#7ff6ff'});n.position.set(0,.035,.004);g.add(n);}});
  const holder=new THREE.Group();holder.add(g);holder.position.copy(at(f,{x:-f.w/2-.1,y:f.h/2+.06,z:f.d/2}));facing(holder,f);
  return {group:holder,update(){}};
}
export function pinnedTags(box,eye,{tags=[['paper','60 sheets'],['toner','35 %']]}={}){
  // all leaders share one point on the thing's right side (a dot there), run out to a hub, then fan to the readings stacked on the right
  const f=frameOf(box,eye),g=new THREE.Group(),anchor=at(f,{x:f.w/2,y:f.h*.1,z:f.d/2}),hub=anchor.clone().addScaledVector(f.r,.06*K);
  const dot=new THREE.Mesh(new THREE.SphereGeometry(.008,14,10),lit());dot.position.copy(anchor);g.add(dot);
  const m=glow(CYAN,.85),step=.045*K,top=(tags.length-1)*step/2,segs=[anchor,hub];
  tags.forEach(([k,v],i)=>{const tip=hub.clone().addScaledVector(f.r,.07*K).addScaledVector(f.up,top-i*step);segs.push(hub,tip);
    const t=label(`${k} ${v}`,{size:.026*K,weight:650});t.position.copy(tip).addScaledVector(f.r,.012);facing(t,f);g.add(t);});
  g.add(tubes(segs,.0025*K,m));
  return {group:g,update(){}};
}
export function statusPulse(box,{level='attention',message='Paper low'}={}){
  const g=new THREE.Group(),color=level==='warning'?RED:level==='attention'?AMBER:CYAN,dot=new THREE.Mesh(new THREE.SphereGeometry(.018,20,14),lit(color,.6));
  const ripple=new THREE.Mesh(new THREE.RingGeometry(.025,.03,40),glow(color,.8));g.add(dot,ripple);
  if(message){const t=label(message,{size:.022,weight:650});t.position.set(.03,0,0);g.add(t);}   // no state in the data: the dot alone
  g.position.set(box.center[0],box.center[1]+box.size[1]/2+.1,box.center[2]);
  return {group:g,update(now,camera){const k=(now%1400)/1400;ripple.scale.setScalar(1+k*2.2);ripple.material.opacity=.8*(1-k);if(camera){g.quaternion.copy(camera.quaternion);}}};
}

// ——— action ———
export function tetherSend(box,eye,{to='Alice Chen',initials='AC',sent=false,toPoint=null}={}){
  // a line from what is sent to whom it goes; a pulse runs along it until it is sent. `end` is where the recipient stands (the draft and
  // the Send button go under it).
  const f=frameOf(box,eye),g=new THREE.Group(),from=at(f,{x:f.w/2,y:f.h/4,z:f.d/2+.01}),badgeAt=toPoint?toPoint.clone():at(f,{x:f.w/2+.32*K,y:f.h/2+.05,z:f.d/2+.12});
  const curve=new THREE.QuadraticBezierCurve3(from,from.clone().lerp(badgeAt,.5).add(new THREE.Vector3(0,.12,0)),badgeAt),pts=curve.getPoints(40);
  const segs=[];for(let i=0;i<pts.length-1;i++)segs.push(pts[i],pts[i+1]);g.add(tubes(segs,.004,glow(CYAN,.9)));
  const pulse=new THREE.Mesh(new THREE.SphereGeometry(.01,12,8),lit(0xffffff,.3));pulse.visible=!sent;g.add(pulse);
  const badge=new THREE.Group(),disc=new THREE.Mesh(new THREE.CylinderGeometry(.04*K,.04*K,.01,32),lit(CYAN,.4));disc.rotation.x=Math.PI/2;
  const ini=tag(initials,{size:.03,weight:800,color:'#062a2e',stroke:false});ini.position.z=.007;const nm=tag(to,{size:.024});nm.position.y=-.065*K;badge.add(disc,ini,nm);
  badge.position.copy(badgeAt);badge.rotation.set(0,Math.atan2(eye.x-badgeAt.x,eye.z-badgeAt.z),0);if(!toPoint)g.add(badge);   // with toPoint, a Contact Chip stands there
  return {group:g,end:badgeAt.clone().add(new THREE.Vector3(0,-.1*K,0)),update(now){if(!sent)pulse.position.copy(curve.getPoint((now/1400)%1));}};
}

// ——— time: a calendar and a playback, shared by every MOD with dated or timed data (Weather, Agenda, a print queue's schedule) ———
// Both stand in front of the thing they belong to, turned to the user. Each clickable carries userData.action for the platform's pointer.
const MONTHS=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],WEEKDAYS=['SUN','MON','TUE','WED','THU','FRI','SAT'];
const toUser=(g,eye)=>{g.rotation.set(0,Math.atan2(eye.x-g.position.x,eye.z-g.position.z),0);return g;};
/** Date Picker: when data is dated and the user can move between days, to pick one. The month once above; each day a capsule (weekday, day). */
export function datePicker(box,eye,{dates=[],value=null,y=null}={}){
  const f=frameOf(box,eye),g=new THREE.Group(),cw=.15,ch=.085,gap=.016,span=dates.length*cw+(dates.length-1)*gap;
  dates.forEach((iso,i)=>{const d=new Date(iso+'T12:00:00'),on=iso===value,ink=on?'#062a2e':'#ffffff';
    const chip=new THREE.Mesh(capsule(cw,ch,.012),lit(on?CYAN:0x454b55,on?.45:0));chip.userData.action={kind:'date',value:iso};
    const wd=tag(WEEKDAYS[d.getDay()],{size:.016,weight:650,color:on?'#0b3a3f':'#9fe9ef',stroke:false}),day=tag(String(d.getDate()),{size:.027,weight:700,color:ink,stroke:false});
    wd.position.set(0,.021,.008);day.position.set(0,-.013,.008);const cell=new THREE.Group();cell.add(chip,wd,day);cell.position.x=-span/2+cw/2+i*(cw+gap);cell.position.z=on?.01:0;g.add(cell);});
  const months=[...new Set(dates.map(iso=>MONTHS[Number(iso.slice(5,7))-1]))].join(' – '),m=tag(months,{size:.02,weight:700,color:'#9fe9ef'});m.position.set(0,ch/2+.03,0);g.add(m);
  g.position.copy(at(f,{y:y??f.h/2+.1,z:f.d/2+.03}));toUser(g,eye);
  return {group:g,update(){}};
}
/** Playback: when data runs through time (hours of a forecast, steps of a recording), to play it and scrub to a moment.
 *  A Play/Pause Icon Button, a rail with a stop per entry, the thumb, and the current time riding above the thumb. */
export function playback(box,eye,{stops=[],index=0,playing=true,y=null}={}){
  const f=frameOf(box,eye),g=new THREE.Group(),railW=.42,x0=-railW/2+.07,x1=railW/2+.07;
  const btn=new THREE.Group(),pill=new THREE.Mesh(capsule(.11,.05),lit(CYAN,.45)),glyph=tag(playing?'⏸':'▶',{size:.024,weight:700,color:'#062a2e',stroke:false}),word=tag(playing?'Pause':'Play',{size:.022,weight:650,color:'#062a2e',stroke:false});
  const bw=.03+.03+word.userData.width+.03;pill.geometry.dispose();pill.geometry=capsule(bw,.05);
  glyph.position.set(-bw/2+.03,0,.007);word.position.set(-bw/2+.055+word.userData.width/2,0,.007);btn.add(pill,glyph,word);btn.position.x=x0-.03-bw/2;pill.userData.action={kind:playing?'pause':'play'};g.add(btn);
  const rail=new THREE.Mesh(capsule(x1-x0+.016,.016,.008),lit(0x454b55,0));rail.position.x=(x0+x1)/2;rail.userData.action={kind:'scrub'};g.add(rail);
  // a taller invisible grip over the rail, so it is easy to press and drag; the rail's ends and stops say which entry a point is
  const grip=new THREE.Mesh(new THREE.PlaneGeometry(x1-x0+.06,.09),new THREE.MeshBasicMaterial({visible:false}));grip.position.set((x0+x1)/2,0,.012);grip.userData.action={kind:'scrub'};g.add(grip);
  g.userData.rail={x0,x1,n:stops.length};
  const n=Math.max(1,stops.length-1),xs=stops.map((_,i)=>x0+(x1-x0)*i/n);
  xs.forEach((x,i)=>{if(i>index)return;const seg=new THREE.Mesh(new THREE.CircleGeometry(.004,12),glow(0x062a2e,.7));seg.position.set(x,0,.006);g.add(seg);});
  const done=new THREE.Mesh(capsule(Math.max(.016,xs[index]-x0+.016),.016,.009),lit(CYAN,.45));done.position.x=x0+(xs[index]-x0)/2;g.add(done);
  const thumb=new THREE.Mesh(capsule(.018,.05,.016),lit(0xffffff,.2));thumb.position.set(xs[index],0,.008);thumb.userData.action={kind:'scrub'};g.add(thumb);
  const t=tag(stops[index]??'',{size:.024,weight:700});t.position.set(xs[index],.045,.008);g.add(t);
  g.position.copy(at(f,{y:y??f.h/2+.03,z:f.d/2+.03}));toUser(g,eye);
  return {group:g,update(now){thumb.material.emissiveIntensity=playing?.15+.2*breathe(now,900):.2;}};
}

// ——— message: who, what is said, what is shown — shared by every MOD that reaches people (Delegate today; a reminder for someone,
// a reply). They are laid out by the caller (a column beside the thing); each is built at the origin, facing +z. ———
/** Contact Chip: when an action reaches a person, to show who (avatar initials and name); with several candidates each is a chip to pick. */
export function contactChip({name='Alice Chen',sub='',initials='AC',selected=true,onPick=null}={}){
  const g=new THREE.Group(),ink=selected?'#062a2e':'#ffffff',nm=tag(name,{size:.024,weight:650,color:ink,stroke:false}),w=.05+nm.userData.width+.035,h=.05;
  const pill=new THREE.Mesh(capsule(w,h),lit(selected?CYAN:0x2b2e34,selected?.4:0));if(onPick)pill.userData.onHit=onPick;g.add(pill);
  const av=new THREE.Mesh(new THREE.CircleGeometry(.019,32),new THREE.MeshBasicMaterial({color:selected?0x062a2e:CYAN,toneMapped:false}));av.position.set(-w/2+.026,0,.006);g.add(av);
  const ini=tag(initials,{size:.015,weight:800,color:selected?'#9ff8ff':'#062a2e',stroke:false});ini.position.set(-w/2+.026,0,.007);g.add(ini);
  nm.position.set(-w/2+.05+nm.userData.width/2,0,.007);g.add(nm);
  if(sub){const s=tag(sub,{size:.015,weight:500,color:'#c9d6d8'});s.position.set(0,-h/2-.016,0);g.add(s);}
  return {group:g,width:w,height:h+(sub?.03:0),update(){}};
}
/** Text Input: when the user may change what will be said (a drafted message, a note), to show the text in a field they can edit.
 *  A rounded field (clickable, so its corners are round), the text wrapped inside, a caret while editing. */
export function textInput({title='',body='',width=.36,editing=false,placeholder='Write a message…',onEdit=null}={}){
  const g=new THREE.Group(),size=.019,pad=.018,lines=[...(title?[[title,700]]:[]),...wrapLines(body||placeholder,size,width-2*pad).map(l=>[l,450])].slice(0,9);
  const lh=size*1.5,h=Math.max(.06,lines.length*lh+2*pad),r=.022,sh=new THREE.Shape();
  sh.moveTo(-width/2+r,-h/2);sh.lineTo(width/2-r,-h/2);sh.absarc(width/2-r,-h/2+r,r,-Math.PI/2,0);sh.lineTo(width/2,h/2-r);sh.absarc(width/2-r,h/2-r,r,0,Math.PI/2);
  sh.lineTo(-width/2+r,h/2);sh.absarc(-width/2+r,h/2-r,r,Math.PI/2,Math.PI);sh.lineTo(-width/2,-h/2+r);sh.absarc(-width/2+r,-h/2+r,r,Math.PI,Math.PI*1.5);
  const field=new THREE.Mesh(new THREE.ExtrudeGeometry(sh,{depth:.006,bevelEnabled:false,curveSegments:10}),new THREE.MeshBasicMaterial({color:0x14171c,transparent:true,opacity:.82,toneMapped:false}));
  if(onEdit)field.userData.onHit=onEdit;g.add(field);
  const pts=sh.getPoints(8).map(p=>new THREE.Vector3(p.x,p.y,.007)),border=tubes(pts.flatMap((p,i)=>[p,pts[(i+1)%pts.length]]),editing?.0022:.0012,glow(CYAN,editing?.95:.45));g.add(border);
  let y=h/2-pad-size*.6,last=null;
  for(const [text,weight] of lines){const t=label(text,{size,weight,color:body||title?'#ffffff':'#8b949e',maxWidth:width});t.position.set(-width/2+pad,y,.008);g.add(t);last=t;y-=lh;}
  const caret=new THREE.Mesh(new THREE.PlaneGeometry(.0025,size*1.2),glow(CYAN,1));caret.visible=editing;
  if(last)caret.position.set(-width/2+pad+last.userData.width+.004,last.position.y,.009);g.add(caret);
  return {group:g,width,height:h,update(now){caret.material.opacity=editing&&Math.floor(now/530)%2===0?1:0;}};
}
/** Photo Capture: when what is sent is a photo of the thing, to show the photo being taken there — its corners framed, a shutter flash. */
export function photoCapture(box,{flashAt=performance.now()}={}){
  const frame=cornerBrackets(box),g=frame.group,c=new THREE.Vector3(...box.center);
  const flash=new THREE.Mesh(new THREE.BoxGeometry(...box.size.map(v=>v*1.04)),glow(0xffffff,0));flash.position.copy(c);flash.rotation.y=THREE.MathUtils.degToRad(box.yaw||0);
  const scene=new THREE.Group();scene.add(g,flash);
  return {group:scene,update(now){frame.update(now);const u=(now-flashAt)/450;flash.material.opacity=u>=0&&u<1?.8*(1-u):0;}};
}
/** The photo as a card (the camera frame cropped to the thing), for the message it goes with. */
export function photoCard(canvas,{width=.16,label:text=''}={}){
  const g=new THREE.Group(),aspect=canvas?canvas.height/canvas.width:.75,h=width*aspect;
  // not clickable: a plain white border, like a printed photo
  const back=new THREE.Mesh(new THREE.PlaneGeometry(width+.012,h+.012),new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false}));g.add(back);
  const tex=canvas?new THREE.CanvasTexture(canvas):null;if(tex)tex.colorSpace=THREE.SRGBColorSpace;
  const img=new THREE.Mesh(new THREE.PlaneGeometry(width,h),new THREE.MeshBasicMaterial({map:tex,color:tex?0xffffff:0x2b2e34,toneMapped:false}));img.position.z=.002;g.add(img);
  if(text){const t=tag(text,{size:.014,weight:600});t.position.set(0,-h/2-.02,0);g.add(t);}
  return {group:g,width:width+.012,height:h+.012+(text?.03:0),update(){}};
}
