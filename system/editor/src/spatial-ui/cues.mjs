// Spatial UI cues (modos-system-design.md 4.4): UI that belongs to the room, attached to a thing's own geometry or to the floor, not a
// panel. Each cue is built for one target ({center, size, yaw} of a thing, or a room's floor polygon) as seen from where the question was
// asked; which face, edge or surround it uses follows from the thing's size and which side faces the user. Bright cyan, breathing.
//   mark            breathingBox · cornerBrackets · footprintRing · floorArea · doorwayGlow
//   guidance        arrowAhead · floorPath · textArrow (text → the thing it is about)
//   visualization   haloDial (Gauge) · progressRail · pinnedTags · statusPulse · cardStack
//   controls        edgeBar (Slider) · choice · iconButton (and its text-only form) · textInput · arPhoto · datePicker · playback
//                   When a control's value is sent is how a MOD uses it, not the control: on change (a device), on Send (a message), never
//                   (moving through information).
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
// opts.scale: the scale the cue was built at (a label made later, e.g. while a slider is dragged, keeps its cue's size)
const tag=(text,opts={})=>{const k=opts.scale??K,l=label(text,{size:.03,weight:650,...opts,size:(opts.size||.03)*k,maxWidth:(opts.maxWidth||.4)*k});l.geometry.translate(-l.userData.width/2,0,0);return l;};
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
  // each arm as long as the thing allows: a flat thing (a poster, a screen) keeps full arms across its face, short ones through its depth
  const g=new THREE.Group(),half=box.size.map(v=>v/2*1.04),[sx,sy,sz]=half,l=Math.min([...half].sort((a,b)=>a-b)[1],.12)*1.2,m=glow(CYAN,.95);
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){const p=new THREE.Vector3(x*sx,y*sy,z*sz),pts=[];
    for(const [i,axis] of [[1,0,0],[0,1,0],[0,0,1]].entries()){const arm=Math.min(l,half[i]*2);if(arm<.01)continue;const q=p.clone().add(new THREE.Vector3(...axis).multiply(new THREE.Vector3(-x,-y,-z)).multiplyScalar(arm));pts.push(p.clone(),q);}
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
export function arrowAhead(target,camera,{name=''}={}){
  // the arrow turns toward the target; what it points at is named at its tip, upright (the name does not turn with the arrow)
  const g=new THREE.Group(),arrow=new THREE.Group(),m=lit();const shaft=new THREE.Mesh(new THREE.CylinderGeometry(.009,.009,.07,20),m);shaft.rotation.z=Math.PI/2;shaft.position.x=-.02;
  const head=new THREE.Mesh(new THREE.ConeGeometry(.024,.05,24),m);head.rotation.z=-Math.PI/2;head.position.x=.035;arrow.add(shaft,head);g.add(arrow);
  const label=name?tag(name,{size:.016,weight:650}):null;if(label)g.add(label);
  return {group:g,update(now){camera.updateMatrixWorld(true);const f=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion),up=new THREE.Vector3(0,1,0).applyQuaternion(camera.quaternion),side=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
    const local=new THREE.Vector3(...target.center).applyMatrix4(camera.matrixWorldInverse),dir=new THREE.Vector2(local.x,local.y).normalize();
    arrow.position.copy(camera.position).addScaledVector(f,.55).addScaledVector(side,dir.x*.12).addScaledVector(up,dir.y*.08-.06+Math.sin(now/260)*.006);
    arrow.quaternion.copy(camera.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.atan2(dir.y,dir.x)));
    if(label){const w=label.userData.width||.06;label.quaternion.copy(camera.quaternion);
      // just past the tip, along the arrow; pointing sideways the name sits beyond the tip, pointing up or down above or below it
      label.position.copy(arrow.position).addScaledVector(side,dir.x*.075).addScaledVector(up,dir.y*.075);
      if(Math.abs(dir.x)>.4)label.position.addScaledVector(side,Math.sign(dir.x)*(w/2+.008));else label.position.addScaledVector(up,Math.sign(dir.y||1)*.016);}}};
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
  let t=null,shown=null;const S=K;const set=v=>{const k=Math.min(1,Math.max(0,kOf(v)));fill.scale.y=Math.max(.001,len*k);fill.position.y=-len/2+len*k/2;knob.position.y=-len/2+len*k;
    const txt=`${name} ${Math.round(v)}${unit}`;if(txt!==shown){shown=txt;if(t)g.remove(t);t=tag(txt,{size:.03,scale:S});t.position.set(0,len/2+.04,0);g.add(t);}};
  set(from??value);g.position.copy(at(f,{x:f.w/2+.06,z:f.d/2}));facing(g,f);
  const range=JSON.stringify([min,max,name,unit]);
  return {group:g,update(now){if(live!==null)return set(live);if(from===null||!changeAt)return set(value);const u=Math.min(1,Math.max(0,(now-changeAt)/700)),e=u*u*(3-2*u);set(from+(value-from)*e);},
    // a new value in place (the device's state after a change, a revision): the same bar; changeAt>0 eases to it (what an answer changed)
    set(p){if(JSON.stringify([p.min??0,p.max??100,p.name??'volume',p.unit??''])!==range)return false;from=p.from??null;changeAt=p.changeAt||0;value=p.value;live=null;return true;}};
}
// An icon button: the icon and what pressing it does, side by side (toggles and commands: power, cancel, pause, send).
// icon: a preset's icon (modos/buttons.json); null for a text-only button the system wrote when no preset fits.
/** Choice: when one of several options is picked (a TV's input, who a message goes to), to pick it where it acts. A few short options
 *  (up to INLINE_MAX, INLINE_CHARS letters in all) stand in a row of capsules, the chosen one lit: one press. More, or longer, collapse into
 *  a dropdown: a capsule with the chosen option and ▾; pressed, the options open below it, pressed again (or one picked) it closes.
 *  An option is a string or {value, label, initials} (initials: a person's, shown in a small disc). With a box, the choice stands along
 *  the thing's lower edge, turned to the user; without one it is built at the origin, facing +z, for the caller to place. */
const INLINE_MAX=4,INLINE_CHARS=24;
// open / onToggle: the dropdown's open state kept by the caller (when the caller rebuilds on every change); without them it is kept here.
// multiple: several may be chosen (the value is a list; a press adds or removes one; the dropdown stays open while picking), as when
// what it shows is a pick-many selection (Send's recipients). onPick gets the new value: one option's, or the list.
export function choice(box,eye,{options=[],value=null,onPick=null,y=null,open=false,onToggle=null,multiple=false}={}){
  const opts=options.map(o=>typeof o==='string'?{value:o,label:o}:{label:o.value,...o}),g=new THREE.Group(),H=.05,GAP=.012;
  const chosen=new Set(multiple?(value||[]):[value]),isOn=o=>chosen.has(o.value);
  const pick=o=>{if(!onPick)return;if(!multiple)return onPick(o.value);const next=new Set(chosen);next.has(o.value)?next.delete(o.value):next.add(o.value);onPick(opts.filter(x=>next.has(x.value)).map(x=>x.value));};
  const pill=(o,on,{chevron=false}={})=>{const cell=new THREE.Group(),ink=on?'#062a2e':'#ffffff',t=tag(o.label+(chevron?'  ▾':''),{size:.024,weight:on?700:500,color:ink,stroke:false});
    const lead=o.initials?.044:.024,w=lead+t.userData.width+.026,p=new THREE.Mesh(capsule(w,H,.012),lit(on?CYAN:0x2b2e34,on?.45:0));cell.add(p);
    if(o.initials){const av=new THREE.Mesh(new THREE.CircleGeometry(.016,32),new THREE.MeshBasicMaterial({color:on?0x062a2e:CYAN,toneMapped:false}));av.position.set(-w/2+.026,0,.007);
      const ini=tag(o.initials,{size:.013,weight:800,color:on?'#9ff8ff':'#062a2e',stroke:false});ini.position.set(-w/2+.026,0,.008);cell.add(av,ini);}
    t.position.set(-w/2+lead+t.userData.width/2,0,.008);cell.add(t);cell.userData.width=w;return {cell,pad:p};};
  const inline=opts.length<=INLINE_MAX&&opts.reduce((n,o)=>n+String(o.label).length,0)<=INLINE_CHARS;
  if(inline){const cells=opts.map(o=>pill(o,isOn(o))),total=cells.reduce((a,c)=>a+c.cell.userData.width,0)+GAP*(cells.length-1);let x=-total/2;
    cells.forEach((c,i)=>{c.cell.position.x=x+c.cell.userData.width/2;x+=c.cell.userData.width+GAP;c.pad.userData.onHit=()=>pick(opts[i]);g.add(c.cell);});}
  else{const on=opts.filter(isOn),first=on[0]||opts[0];
    // the head: the chosen option (several: the first and how many more; none yet: an empty pick)
    const head=pill({...first,label:on.length>1?`${first.label} +${on.length-1}`:on.length?first.label:'Choose…',initials:on.length?first.initials:null},!!on.length,{chevron:true}),list=new THREE.Group();
    list.visible=!!open;g.add(head.cell,list);
    opts.forEach((o,i)=>{const c=pill(o,isOn(o));c.cell.position.set(-head.cell.userData.width/2+c.cell.userData.width/2,-(i+1)*(H+GAP),.004);
      // a closed list catches no presses (what lies under it stays pressable)
      c.pad.raycast=(r,hits)=>{if(list.visible)THREE.Mesh.prototype.raycast.call(c.pad,r,hits);};
      c.pad.userData.onHit=()=>{if(!multiple){list.visible=false;onToggle?.(false);}pick(o);};list.add(c.cell);});
    // an open list lies over what is below it (the draft, the button): drawn above it
    // (in the transparent pass, which comes after every opaque one; capsule, then disc, then words)
    list.traverse(o=>{if(!o.material)return;o.material=o.material.clone();Object.assign(o.material,{transparent:true,depthTest:false,depthWrite:false});
      o.renderOrder=40+(o.position.z>=.008?2:o.position.z>=.007?1:0);});
    head.pad.userData.onHit=()=>{if(onToggle)onToggle(!list.visible);else list.visible=!list.visible;};}
  if(box){const f=frameOf(box,eye);g.position.copy(at(f,{y:y??-f.h/2+.05,z:f.d/2+.03}));facing(g,f);}
  return {group:g,height:H,update(){}};
}
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


// ——— time: a calendar and a playback, shared by every MOD with dated or timed data (Weather, Agenda, a print queue's schedule) ———
// Both stand in front of the thing they belong to, turned to the user. Each clickable carries userData.action for the platform's pointer.
const MONTHS=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],WEEKDAYS=['SUN','MON','TUE','WED','THU','FRI','SAT'];
const toUser=(g,eye)=>{g.rotation.set(0,Math.atan2(eye.x-g.position.x,eye.z-g.position.z),0);return g;};
/** Date Picker: when data is dated and the user can move between days, to pick one. The month once above; each day a capsule (weekday, day). */
// An invisible pad around a small control, carrying its action: easier to hit with a pointer or a hand ray than the control itself.
const hitPad=(w,h,action)=>{const p=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({visible:false}));p.position.z=.014;p.userData.action=action;return p;};
export function datePicker(box,eye,{dates=[],value=null,y=null}={}){
  const f=frameOf(box,eye),g=new THREE.Group(),cw=.15,ch=.085,gap=.016,span=dates.length*cw+(dates.length-1)*gap;
  dates.forEach((iso,i)=>{const d=new Date(iso+'T12:00:00'),on=iso===value,ink=on?'#062a2e':'#ffffff';
    const chip=new THREE.Mesh(capsule(cw,ch,.012),lit(on?CYAN:0x454b55,on?.45:0));chip.userData.action={kind:'date',value:iso};
    const wd=tag(WEEKDAYS[d.getDay()],{size:.016,weight:650,color:on?'#0b3a3f':'#9fe9ef',stroke:false}),day=tag(String(d.getDate()),{size:.027,weight:700,color:ink,stroke:false});
    wd.position.set(0,.021,.008);day.position.set(0,-.013,.008);const cell=new THREE.Group();cell.add(chip,wd,day,hitPad(cw+gap,ch+.03,{kind:'date',value:iso}));cell.position.x=-span/2+cw/2+i*(cw+gap);cell.position.z=on?.01:0;g.add(cell);});
  const months=[...new Set(dates.map(iso=>MONTHS[Number(iso.slice(5,7))-1]))].join(' – '),m=tag(months,{size:.02,weight:700,color:'#9fe9ef'});m.position.set(0,ch/2+.03,0);g.add(m);
  g.position.copy(at(f,{y:y??f.h/2+.1,z:f.d/2+.03}));toUser(g,eye);
  return {group:g,update(){}};
}
/** Playback: when data runs through time (hours of a forecast, steps of a recording), to play it and scrub to a moment.
 *  A Play/Pause Icon Button, a rail with a stop per entry, the thumb, and the current time riding above the thumb. */
export function playback(box,eye,{stops=[],index=0,playing=true,y=null}={}){
  const f=frameOf(box,eye),g=new THREE.Group(),railW=.42,x0=-railW/2+.07,x1=railW/2+.07;
  // Play/Pause: the icon alone, in a round button
  const bw=.05,btn=new THREE.Group(),pill=new THREE.Mesh(capsule(bw,bw),lit(CYAN,.45)),glyph=tag(playing?'⏸':'▶',{size:.024,weight:700,color:'#062a2e',stroke:false});
  glyph.position.set(0,0,.007);btn.add(pill,glyph,hitPad(bw+.04,.09,{kind:playing?'pause':'play'}));btn.position.x=x0-.03-bw/2;pill.userData.action={kind:playing?'pause':'play'};g.add(btn);
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

// ——— message: who, what is said, what is shown — shared by every MOD that reaches people (Send today; a reminder for someone,
// a reply). They are laid out by the caller (a column beside the thing); each is built at the origin, facing +z. ———
/** Text Input: when the user may change what will be said (a drafted message, a note), to show the text in a field they can edit.
 *  A rounded field (clickable, so its corners are round), the text wrapped inside, a caret while editing. */
export function textInput({title='',body='',width=.36,rows=6,editing=false,placeholder='Write a message…',onEdit=null}={}){
  // Takes new text in place (set): the words it has in common with what it shows stay, the rest is written in (WRITE characters a
  // second), so a message redrafted while the user speaks on changes where it changed. Its height is fixed (rows lines), whatever its
  // text: what is around it never moves as the text changes. A longer text shows its end while it is written or edited, else its
  // beginning, ending in …
  const g=new THREE.Group(),size=.019,pad=.018,lh=size*1.5,r=.022,WRITE=90;
  let target={title,body,editing},shown=body.length,writing=null,last=null,caret=null,drawnKey='';const part={group:g,width,height:.06};
  function draw(){
    const text=target.body.slice(0,Math.floor(shown)),key=JSON.stringify([target.title,text,target.editing,!!writing]);if(key===drawnKey)return;drawnKey=key;
    for(const c of [...g.children]){g.remove(c);c.geometry?.dispose();c.material?.map?.dispose?.();c.material?.dispose?.();}
    let lines=[...(target.title?[[target.title,700]]:[]),...wrapLines(text||(target.body?'':placeholder),size,width-2*pad).map(l=>[l,450])];
    if(lines.length>rows)lines=target.editing||writing||shown<target.body.length?lines.slice(-rows):[...lines.slice(0,rows-1),[lines[rows-1][0].replace(/\s*\S{0,3}$/,'')+'…',lines[rows-1][1]]];
    const h=rows*lh+2*pad,sh=new THREE.Shape();part.height=h;
    sh.moveTo(-width/2+r,-h/2);sh.lineTo(width/2-r,-h/2);sh.absarc(width/2-r,-h/2+r,r,-Math.PI/2,0);sh.lineTo(width/2,h/2-r);sh.absarc(width/2-r,h/2-r,r,0,Math.PI/2);
    sh.lineTo(-width/2+r,h/2);sh.absarc(-width/2+r,h/2-r,r,Math.PI/2,Math.PI);sh.lineTo(-width/2,-h/2+r);sh.absarc(-width/2+r,-h/2+r,r,Math.PI,Math.PI*1.5);
    const field=new THREE.Mesh(new THREE.ExtrudeGeometry(sh,{depth:.006,bevelEnabled:false,curveSegments:10}),new THREE.MeshBasicMaterial({color:0x14171c,transparent:true,opacity:.82,toneMapped:false}));
    if(onEdit)field.userData.onHit=onEdit;g.add(field);
    const pts=sh.getPoints(8).map(p=>new THREE.Vector3(p.x,p.y,.007));g.add(tubes(pts.flatMap((p,i)=>[p,pts[(i+1)%pts.length]]),target.editing?.0022:.0012,glow(CYAN,target.editing?.95:.45)));
    let y=h/2-pad-size*.6;last=null;
    for(const [t,weight] of lines){const m=label(t,{size,weight,color:text||target.title?'#ffffff':'#8b949e',maxWidth:width});m.position.set(-width/2+pad,y,.008);g.add(m);last=m;y-=lh;}
    caret=new THREE.Mesh(new THREE.PlaneGeometry(.0025,size*1.2),glow(CYAN,1));if(last)caret.position.set(-width/2+pad+last.userData.width+.004,last.position.y,.009);g.add(caret);
  }
  draw();
  part.set=({title:t='',body:b='',editing:e=false}={})=>{
    let common=0;while(common<Math.min(b.length,target.body.length)&&b[common]===target.body[common])common++;
    target={title:t,body:b,editing:e};shown=e?b.length:Math.min(shown,common);writing=shown<b.length?{at:performance.now(),from:shown}:null;draw();return true;};   // the user's own typing shows at once
  part.update=now=>{
    if(writing){shown=Math.min(target.body.length,writing.from+(now-writing.at)/1000*WRITE);if(shown>=target.body.length)writing=null;draw();}
    if(caret)caret.material.opacity=(target.editing||writing)&&Math.floor(now/530)%2===0?1:0;};
  return part;
}
/** AR Photo: when what is sent is a photo of the thing, to show the photo about to be sent (the camera frame cropped to the thing). */
export function arPhoto(canvas,{width=.16,label:text=''}={}){
  // drawn above everything around it (the column's field and buttons, the marks): no depth test, last in order
  const g=new THREE.Group(),aspect=canvas?canvas.height/canvas.width:.75,h=width*aspect,top=o=>{o.renderOrder=30;o.material.depthTest=false;o.material.depthWrite=false;return o;};
  // not clickable: a plain white border, like a printed photo
  const back=top(new THREE.Mesh(new THREE.PlaneGeometry(width+.012,h+.012),new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false})));g.add(back);
  const tex=canvas?new THREE.CanvasTexture(canvas):null;if(tex)tex.colorSpace=THREE.SRGBColorSpace;
  const img=top(new THREE.Mesh(new THREE.PlaneGeometry(width,h),new THREE.MeshBasicMaterial({map:tex,color:tex?0xffffff:0x2b2e34,toneMapped:false})));img.renderOrder=31;img.position.z=.002;g.add(img);
  if(text){const t=top(tag(text,{size:.014,weight:600}));t.renderOrder=32;t.position.set(0,-h/2-.02,0);g.add(t);}
  return {group:g,width:width+.012,height:h+.012+(text?.03:0),update(){}};
}
