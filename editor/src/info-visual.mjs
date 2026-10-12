import * as THREE from 'three';

// What an info answer (response.info, src/placement.mjs) draws besides its text. The corners and the arrow each get their own colour,
// picked like the text's (src/legibility.mjs pickStyle) against what the recorded camera shows behind them (colorAt, src/app.mjs);
// the text's colour until a frame is sampled:
//   corners  glowing right angles at the four corners of its box's face toward the viewer, a little inside them (CORNER.inset of the
//            face's shorter side), slightly thick, with a soft halo (light around dark text, the text's own colour around light text),
//            fading and growing in when the answer appears;
//   arrow    once the answer is fixed in the room (settled on a surface or floating by the box): drawn flat over the recorded
//            camera's view (src/app.mjs, arrowBetween): a short straight line on the line from the text's centre to the centre of the
//            box's face, ending at the box's outline, with an open head; one path with one soft border (Behavior: arrow thickness, arrow halo). Its ends follow the room's anchors
//            (the text's ink rectangle, the box's face) every frame; no arrow when they overlap on screen or it would leave the view.
// The corners are in the scene: real surfaces (the scan, the recording's depth) hide them like any placed object; they sit a little
// toward the viewer so the surface they are on does not.
const CORNER={arm:.3,min:.025,max:.09,width:.007,glow:4,inset:.12,lift:.02},APPEAR=.6;

/** The box's face toward the eye: {center, normal, a, b, ha, hb} (a, b: in-plane unit axes, ha, hb: half sizes along them). */
export function faceToward(box,eye){
  const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(box.yaw||0)),c=new THREE.Vector3(...box.center),h=new THREE.Vector3(...box.size).multiplyScalar(.5);
  const toEye=eye.clone().sub(c).applyQuaternion(q.clone().invert()).normalize(),axes=['x','y','z'];
  let best=null;for(const k of axes)for(const s of [1,-1]){const d=s*toEye[k];if(!best||d>best.d)best={k,s,d};}
  const [ka,kb]=axes.filter(k=>k!==best.k),unit=k=>new THREE.Vector3(k==='x'?1:0,k==='y'?1:0,k==='z'?1:0).applyQuaternion(q);
  const normal=unit(best.k).multiplyScalar(best.s);
  return {center:c.clone().addScaledVector(normal,h[best.k]),normal,a:unit(ka),b:unit(kb),ha:h[ka],hb:h[kb]};
}
/** The corner marks of a face: [{at, arms: [dir, dir]}] (arms point along the face's edges, inward), and the arm length. */
export function cornerMarks(face){
  const arm=THREE.MathUtils.clamp(Math.min(face.ha,face.hb)*2*CORNER.arm,CORNER.min,CORNER.max),marks=[];
  for(const sa of [-1,1])for(const sb of [-1,1]){
    const inset=THREE.MathUtils.clamp(Math.min(face.ha,face.hb)*2*CORNER.inset,.004,.03);
    const at=face.center.clone().addScaledVector(face.a,sa*(face.ha-inset)).addScaledVector(face.b,sb*(face.hb-inset));
    marks.push({at,arms:[face.a.clone().multiplyScalar(-sa),face.b.clone().multiplyScalar(-sb)]});
  }
  return {marks,arm};
}
const V2=(x,y)=>new THREE.Vector2(x,y);
// Screen geometry (pixels) for the arrow.
function segClosest(a,b,c,d){   // closest points between segments ab and cd
  const best={d:Infinity};const consider=(p,q)=>{const dd=p.distanceTo(q);if(dd<best.d)Object.assign(best,{d:dd,p:p.clone(),q:q.clone()});};
  const onSeg=(p,a,b)=>{const ab=b.clone().sub(a),t=THREE.MathUtils.clamp(p.clone().sub(a).dot(ab)/Math.max(1e-9,ab.lengthSq()),0,1);return a.clone().addScaledVector(ab,t);};
  consider(a,onSeg(a,c,d));consider(b,onSeg(b,c,d));consider(onSeg(c,a,b),c);consider(onSeg(d,a,b),d);return best;
}
const insidePoly=(p,poly)=>{let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;};
const segsCross=(a,b,c,d)=>{const o=(p,q,r)=>Math.sign((q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x));return o(a,b,c)*o(a,b,d)<0&&o(c,d,a)*o(c,d,b)<0;};
/** A straight, short arrow on the screen along the line from the text's centre to the centre of the box's face (aim, pixels): it ends
 *  gap px before the box's outline and starts gap px outside the text's, at most maxLength px back from its end (a long way between
 *  them: only the last stretch, by the box). An open head along the line. {d: one SVG path (line, head), start, end, barbs, length},
 *  or null when they overlap or it would be too short. */
const rayExit=(from,dir,poly)=>{let t=Infinity;for(let i=0;i<poly.length;i++){const a=poly[i],e=poly[(i+1)%poly.length].clone().sub(a),den=dir.x*e.y-dir.y*e.x;if(Math.abs(den)<1e-9)continue;
  const w=a.clone().sub(from),u=(w.x*e.y-w.y*e.x)/den,v=(w.x*dir.y-w.y*dir.x)/den;if(u>0&&v>=0&&v<=1)t=Math.min(t,u);}return t;};
export function arrowBetween(textPoly,boxPoly,{aim=null,gap=6,head=.3,minLength=14,maxLength=60}={}){
  const edges=poly=>poly.map((p,i)=>[p,poly[(i+1)%poly.length]]),mid=poly=>poly.reduce((s,p)=>s.add(p),V2(0,0)).divideScalar(poly.length);
  if(textPoly.some(p=>insidePoly(p,boxPoly))||boxPoly.some(p=>insidePoly(p,textPoly))||edges(textPoly).some(([a,b])=>edges(boxPoly).some(([c,d])=>segsCross(a,b,c,d))))return null;
  aim||=mid(boxPoly);const from=mid(textPoly),dir=aim.clone().sub(from);if(dir.lengthSq()<1e-9)return null;dir.normalize();
  const out=rayExit(from,dir,textPoly),into=rayExit(from,dir,boxPoly);if(!Number.isFinite(out)||!Number.isFinite(into))return null;
  const e=from.clone().addScaledVector(dir,into-gap);let s=from.clone().addScaledVector(dir,out+gap);
  if(s.distanceTo(e)>maxLength)s=e.clone().addScaledVector(dir,-maxLength);
  const L=e.clone().sub(s).dot(dir);if(L<minLength)return null;
  const h=THREE.MathUtils.clamp(head*L,8,14),barb=deg=>dir.clone().negate().rotateAround(V2(0,0),THREE.MathUtils.degToRad(deg)).multiplyScalar(h).add(e);
  const f=v=>`${v.x.toFixed(1)},${v.y.toFixed(1)}`,b1=barb(28),b2=barb(-28);
  return {d:`M${f(s)}L${f(e)}M${f(b1)}L${f(e)}L${f(b2)}`,start:s,end:e,barbs:[b1,b2],length:L};
}

export function createInfoVisual({scene,onAnimate=()=>{}}){
  const root=new THREE.Group();root.name='info-answer-visuals';scene.add(root);
  const items=new Map();   // response id → {group, key, started}
  const material=opacity=>new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
  // The halo fades across the strip and toward its ends (a soft glow, not a lighter block).
  const haloMap=(()=>{const c=document.createElement('canvas');c.width=64;c.height=32;const x=c.getContext('2d'),img=x.createImageData(64,32);
    for(let j=0;j<32;j++)for(let i=0;i<64;i++){const v=(j+.5)/32-.5,u=(i+.5)/64,a=Math.exp(-v*v/.02)*Math.min(1,u/.25,(1-u)/.25);img.data.set([255,255,255,Math.round(255*a)],(j*64+i)*4);}
    x.putImageData(img,0,0);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;})();
  const glowMaterial=()=>Object.assign(material(.45),{map:haloMap});
  function dispose(id){const it=items.get(id);root.remove(it.group);it.group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});items.delete(id);}   // haloMap is shared: kept
  // An arm: a flat strip in the face's plane from p along dir, and a wider faint strip around it for the glow.
  // Its geometry starts at the corner, so growing it (scale.x) grows it from there.
  function strip(p,dir,len,normal,width,mat){const g=new THREE.PlaneGeometry(len,width).translate(len/2-width/2,0,0),m=new THREE.Mesh(g,mat),x=dir.clone().normalize(),z=normal.clone(),y=z.clone().cross(x);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));m.position.copy(p);return m;}
  function build(id,face){
    const g=new THREE.Group(),core=material(1),glow=glowMaterial(),{marks,arm}=cornerMarks(face);
    const corners=new THREE.Group();corners.renderOrder=4;
    // The halo strip starts a little before the corner so the glow wraps round it.
    for(const m of marks)for(const dir of m.arms){corners.add(strip(m.at.clone().addScaledVector(dir,-CORNER.width*1.2),dir,arm+CORNER.width*1.2,face.normal,CORNER.width*CORNER.glow,glow));corners.add(strip(m.at,dir,arm,face.normal,CORNER.width,core));}
    g.add(corners);
    g.userData.cornerPoints=marks.flatMap(m=>[m.at,...m.arms.map(d=>m.at.clone().addScaledVector(d,arm))]);
    Object.assign(g.userData,{corners,core,glow,face});root.add(g);return g;
  }
  /** answers: [{id, box, panel: {center, right, up, width, height} (world: the text's ink), fixed, locked, color: THREE.Color (the text's)}]
   *  for the info answers shown now; colorAt(points, kind) → {color, halo?} (THREE.Color) for marks over those world points against the
   *  camera view (kind 'corners': like text; 'arrow': a vivid accent and its border), or null; frame: sampled again when it changes.
   *  Returns the arrows to draw over the view (src/app.mjs, arrowBetween): [{id, text, box (world corners), color, border, opacity}]
   *  for the answers fixed in the room;
   *  eye: the viewer. Others are removed. */
  function update(answers,eye,{colorAt=()=>null,frame=null}={}){
    const now=performance.now(),ids=new Set(answers.map(a=>a.id));
    for(const id of [...items.keys()])if(!ids.has(id))dispose(id);
    let animating=false;const arrows=[];
    for(const a of answers){
      const face=faceToward(a.box,eye);face.center.addScaledVector(face.normal,CORNER.lift);
      // The arrow's anchors: the text's ink rectangle and the box's face, as world corners (laid out on the screen by src/app.mjs).
      let arrow=null;
      if(a.fixed){const p=a.panel,corner=(sx,sy)=>p.center.clone().addScaledVector(p.right,sx*p.width/2).addScaledVector(p.up,sy*p.height/2);
        const f=faceToward(a.box,eye),fc=(sa,sb)=>f.center.clone().addScaledVector(f.a,sa*f.ha).addScaledVector(f.b,sb*f.hb);
        arrow={id:a.id,text:[corner(-1,-1),corner(1,-1),corner(1,1),corner(-1,1)],box:[fc(-1,-1),fc(1,-1),fc(1,1),fc(-1,1)],aim:f.center.clone()};}
      const key=JSON.stringify([face.center.toArray().map(v=>v.toFixed(3)),face.normal.toArray().map(v=>v.toFixed(2))]);
      let it=items.get(a.id);
      if(!it||it.key!==key){const started=it?.started??now;if(it)dispose(a.id);it={group:build(a.id,face),key,started,frame:null};items.set(a.id,it);}
      // Each mark's colour against its own background in the camera view, eased toward a new sample so it does not flicker.
      // Locked (a.locked): the colours sampled until then stay.
      if(it.frame!==frame&&!(a.locked&&it.cornerColor&&(!arrow||it.arrowColor))){it.frame=frame;const ud=it.group.userData;it.cornerColor=colorAt(ud.cornerPoints,'corners')?.color||it.cornerColor;
        if(arrow){const mid=arrow.text[0].clone().add(arrow.text[2]).multiplyScalar(.5).lerp(arrow.box[0].clone().add(arrow.box[2]).multiplyScalar(.5),.5);
          const c=colorAt([mid,...arrow.box.map(b=>b.clone().lerp(mid,.5))],'arrow');if(c){it.arrowColor=c.color;it.arrowBorder=c.halo;}}}
      // Appearing: the corners fade in and their arms grow from the corners.
      const k=Math.min(1,(now-it.started)/1000/APPEAR),ease=k*k*(3-2*k);if(k<1)animating=true;
      const {core,glow,corners}=it.group.userData,ease2=(c,target)=>target?c.lerp(target,it.seen?.35:1):c.copy(a.color);
      ease2(core.color,it.cornerColor);it.ink||=a.color.clone();it.border||=new THREE.Color(1,1,1);
      if(it.arrowColor)it.ink.lerp(it.arrowColor,it.seen?.35:1);if(it.arrowBorder)it.border.lerp(it.arrowBorder,it.seen?.35:1);it.seen=true;
      if(arrow)arrows.push({...arrow,color:it.ink.clone(),border:it.border.clone(),opacity:ease});
      const dark=core.color.r*.2126+core.color.g*.7152+core.color.b*.0722<.5;glow.color.copy(dark?new THREE.Color(1,1,1):core.color);
      core.opacity=ease;glow.opacity=(dark?.55:.45)*ease;
      for(const m of corners.children)m.scale.x=.35+.65*ease;
    }
    if(animating)onAnimate();
    return arrows;
  }
  return {update,get group(){return root;},get count(){return items.size;}};
}
