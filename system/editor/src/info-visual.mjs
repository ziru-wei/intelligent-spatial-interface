import * as THREE from 'three';
import {createCueSet} from './spatial-ui/cue-set.mjs';
import * as cues from './spatial-ui/cues.mjs';
import {partsToDraw} from '../modos/ui-rules.mjs';
import {currentText} from './current-mods.mjs';

// What an info answer (response.info, src/placement.mjs) draws besides its text, as its MOD now declares in its text slot (`text_ui`,
// src/current-mods.mjs), with
// the library's parts:
//   Mark        on the thing it is about: Corner Brackets when the thing has content (a poster, a screen: info.has_content, from the
//               twin's content trait), else Breathing Box (modos/mods/worldinfo.json);
//   Text Arrow  once the answer is fixed in the room (settled on a surface or floating by the box) and its text stands apart from the
//               thing: drawn by src/app.mjs (drawInfoArrows) along arrowBetween, a short straight line on the line from the text's
//               centre to the centre of the box's face, ending at the box's outline; its ends follow the room's anchors every frame;
//               none when they overlap on screen or it would leave the view.
// The marks are drawn over the room, like every cue of the library (src/cue-host.mjs). No colours of their own: the library's.
const APPEAR=.6;

/** The box's face toward the eye: {center, normal, a, b, ha, hb} (a, b: in-plane unit axes, ha, hb: half sizes along them). */
export function faceToward(box,eye){
  const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(box.yaw||0)),c=new THREE.Vector3(...box.center),h=new THREE.Vector3(...box.size).multiplyScalar(.5);
  const toEye=eye.clone().sub(c).applyQuaternion(q.clone().invert()).normalize(),axes=['x','y','z'];
  let best=null;for(const k of axes)for(const s of [1,-1]){const d=s*toEye[k];if(!best||d>best.d)best={k,s,d};}
  const [ka,kb]=axes.filter(k=>k!==best.k),unit=k=>new THREE.Vector3(k==='x'?1:0,k==='y'?1:0,k==='z'?1:0).applyQuaternion(q);
  const normal=unit(best.k).multiplyScalar(best.s);
  return {center:c.clone().addScaledVector(normal,h[best.k]),normal,a:unit(ka),b:unit(kb),ha:h[ka],hb:h[kb]};
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

/** The facts an info answer's declared parts are chosen by (modos/ui-rules.mjs). */
export const infoFacts=(response,apart=false)=>({'target.has_content':!!response.info?.has_content,'text.apart':apart});

export function createInfoVisual({onAnimate=()=>{}}={}){
  const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));
  // each answer's Mark, kept by answer while its mark and box are the same (src/spatial-ui/cue-set.mjs); when it first showed, for the
  // Text Arrow's fade-in
  const set=createCueSet(scene),started=new Map();
  /** answers: [{id, box, response, panel: {center, right, up, width, height} (world: the text's ink), fixed}] for the info answers shown
   *  now; eye: the viewer. Draws each one's declared Mark; returns the Text Arrows' anchors for the answers fixed in the room:
   *  [{id, text, box (world corners), aim, opacity}]. Others are removed. */
  function update(answers,eye){
    const now=performance.now(),specs=[];let animating=false;const arrows=[];
    for(const id of [...started.keys()])if(!answers.some(a=>a.id===id))started.delete(id);
    for(const a of answers){
      const parts=partsToDraw(currentText(a.response).text_ui||{},infoFacts(a.response)),mark=['cornerBrackets','breathingBox'].find(c=>parts.includes(c))||null;
      if(mark)specs.push({key:`${a.id}`,props:{mark,box:[a.box.center,a.box.size,a.box.yaw]},make:p=>cues[p.mark](a.box)});
      if(!started.has(a.id))started.set(a.id,now);
      const k=Math.min(1,(now-started.get(a.id))/1000/APPEAR),ease=k*k*(3-2*k);if(k<1)animating=true;
      if(a.fixed){const p=a.panel,corner=(sx,sy)=>p.center.clone().addScaledVector(p.right,sx*p.width/2).addScaledVector(p.up,sy*p.height/2);
        const f=faceToward(a.box,eye),fc=(sa,sb)=>f.center.clone().addScaledVector(f.a,sa*f.ha).addScaledVector(f.b,sb*f.hb);
        arrows.push({id:a.id,text:[corner(-1,-1),corner(1,-1),corner(1,1),corner(-1,1)],box:[fc(-1,-1),fc(1,-1),fc(1,1),fc(-1,1)],aim:f.center.clone(),opacity:ease});}
    }
    set.update(specs);
    if(animating)onAnimate();
    return arrows;
  }
  function render(renderer,camera,now=performance.now()){
    const parts=set.parts;if(!parts.length)return;for(const m of parts)m.update(now,camera);
    const auto=renderer.autoClear;renderer.autoClear=false;try{renderer.clearDepth();renderer.render(scene,camera);}finally{renderer.autoClear=auto;}
  }
  return {update,render,root:scene,get active(){return set.parts.length>0;},get count(){return started.size;}};
}
