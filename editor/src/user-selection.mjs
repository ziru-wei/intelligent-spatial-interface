import * as THREE from 'three';

// User selection of a thing carrying info (furniture, a door or window, a persistent object: scripts/info_context.py; zones are judged by
// src/app.mjs, the user standing in one) at a frame of the recording, from
// three cues, each 0-1:
//   gaze   the fovea zone: two circles about the view's centre (the glasses have no eye tracking; the head points the gaze). Inside the
//          inner one 1, falling to 0 at the outer one, by the angle from the view's centre to the nearest part of the box.
//   point  an extended index finger aimed at the box, judged in the image (MediaPipe's 2D joints 0, 5 → 8 are accurate there; a thin
//          finger's LiDAR depth is not): the finger's line from knuckle to tip against the box as projected (fingertip over it: 1).
//          Without 2D joints, the 3D finger (src/hand-perception/spatial.mjs).
//   touch  a hand at the box's surface.
// They add up as independent evidence: score = 1 - (1 - .75 gaze)(1 - .85 point)(1 - .95 touch). Looking at a box inside the inner
// circle alone selects it (.75); at the edge of the zone it needs a hand too. The best box at or above SELECT_MIN is the selection.
export const FOVEA={inner:8,outer:20};   // degrees from the view's centre
export const POINT={inner:6,outer:18},TOUCH={inner:.05,outer:.15};   // degrees off the finger's ray; metres from the box's surface
export const WEIGHT={gaze:.75,point:.85,touch:.95},SELECT_MIN=.5;
const JOINT={wrist:0,indexBase:5,indexTip:8};

const ramp=(v,inner,outer)=>v<=inner?1:v>=outer?0:(outer-v)/(outer-inner);
export const gazeScore=(deg,fovea=FOVEA)=>ramp(deg,fovea.inner,fovea.outer);

// A box's own frame: centre, yaw about +y (degrees, as three.js rotation.y), size.
function frame(box){const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(box.yaw||0));return {c:new THREE.Vector3(...box.center),q,inv:q.clone().invert(),h:new THREE.Vector3(...box.size).multiplyScalar(.5)};}
/** Whether a ray (origin, unit direction; world) passes through the box, in front of its origin. */
export function rayHitsBox(origin,dir,box){
  const f=frame(box),o=origin.clone().sub(f.c).applyQuaternion(f.inv),d=dir.clone().applyQuaternion(f.inv);let lo=0,hi=Infinity;
  for(const a of ['x','y','z']){
    if(Math.abs(d[a])<1e-9){if(Math.abs(o[a])>f.h[a])return false;continue;}
    let t1=(-f.h[a]-o[a])/d[a],t2=(f.h[a]-o[a])/d[a];if(t1>t2)[t1,t2]=[t2,t1];lo=Math.max(lo,t1);hi=Math.min(hi,t2);if(lo>hi)return false;
  }
  return true;
}
/** Points over the box (its centre, face centres, edge midpoints and corners): what the angles are measured to. */
export function boxPoints(box){const f=frame(box),out=[];
  for(const x of [-1,0,1])for(const y of [-1,0,1])for(const z of [-1,0,1])out.push(new THREE.Vector3(x*f.h.x,y*f.h.y,z*f.h.z).applyQuaternion(f.q).add(f.c));
  return out;}
/** Smallest angle (degrees) between a ray and the directions from its origin to the box: 0 when the ray goes through it. points: those of
 *  boxPoints that count (e.g. not hidden); null when none is in front. */
export function angleToBox(origin,dir,box,points=boxPoints(box)){
  if(rayHitsBox(origin,dir,box))return 0;
  let best=null;for(const p of points){const v=p.clone().sub(origin);if(v.dot(dir)<=0)continue;const a=THREE.MathUtils.radToDeg(v.angleTo(dir));if(best==null||a<best)best=a;}
  return best;
}
/** Distance (m) from a point to the box's surface (0 inside). */
export function pointBoxDistance(p,box){const f=frame(box),l=new THREE.Vector3(...p).sub(f.c).applyQuaternion(f.inv);
  return Math.hypot(Math.max(0,Math.abs(l.x)-f.h.x),Math.max(0,Math.abs(l.y)-f.h.y),Math.max(0,Math.abs(l.z)-f.h.z));}

/** Pointing rays of located hands ({hands:[{points:[{joint, position}]}]}): from the index tip along base → tip, for a finger straight
 *  and out from the palm (tip farther from the wrist than the base, by 30%, and at least 4 cm from the base). */
export function pointingRays(spatial){
  if(spatial?.status!=='ready')return [];
  return spatial.hands.flatMap(h=>{const at=j=>{const p=h.points.find(x=>x.joint===j);return p&&new THREE.Vector3(...p.position);};
    const base=at(JOINT.indexBase),tip=at(JOINT.indexTip),wrist=at(JOINT.wrist);if(!base||!tip)return [];
    const along=tip.clone().sub(base);if(along.length()<.04)return [];
    if(wrist&&tip.distanceTo(wrist)<base.distanceTo(wrist)*1.3)return [];
    return [{origin:tip,dir:along.normalize()}];});
}

/** Scores of every thing carrying info at a frame and the selection (boxes: [{id, center, size, yaw}], keyOf(box) → its key).
 *  view: {position, forward} of the recorded camera (world); boxes: layout boxes ({id, label, kind, center, size, yaw}); hands: located
 *  hands (or null); visible(point) → false for a point hidden behind something the recording's depth saw, or outside the view (optional);
 *  keyOf(box) → its info key. Returns {selected: {box_id, key, score, cues} | null, selectedAll: [every one at or above SELECT_MIN],
 *  candidates: [...best first, at most 3], scores: [every thing carrying info, best first]}. */
/** Fingers pointing in the image: from MediaPipe landmarks ([[{x, y}] per hand], 0-1 image coordinates) and the image size (px), the
 *  rays {tip, dir} (px) of index fingers straight and out from the palm (tip farther from the wrist than the knuckle by 15%, and at
 *  least 2.5% of the image's width from it). mask ({mask, width, height}: the hand's segmentation, as src/hand-perception gives it): the
 *  fingertip is the hand pixel farthest from the wrist, not landmark 8 (MediaPipe often folds a finger pointed toward the camera, while
 *  the mask still covers it). */
export function pointingRays2D(landmarks,width,height,mask=null){
  // The mask's pixels farthest from each wrist (sampled every few pixels).
  const farthest=wrist=>{if(!mask?.mask)return null;const {mask:m,width:mw,height:mh}=mask,step=Math.max(1,Math.round(mw/160));let best=null,bd=-1;
    for(let y=0;y<mh;y+=step)for(let x=0;x<mw;x+=step)if(m[y*mw+x]>127){const p=new THREE.Vector2((x+.5)/mw*width,(y+.5)/mh*height),d=p.distanceTo(wrist);if(d>bd){bd=d;best=p;}}
    return best;};
  return (landmarks||[]).flatMap(h=>{const P=j=>h[j]&&new THREE.Vector2(h[j].x*width,h[j].y*height),wrist=P(0),base=P(5);let tip=P(8);if(!base||!tip)return [];
    const far=wrist&&farthest(wrist);if(far&&far.distanceTo(wrist)>tip.distanceTo(wrist))tip=far;
    const along=tip.clone().sub(base);if(along.length()<.025*width)return [];if(wrist&&tip.distanceTo(wrist)<base.distanceTo(wrist)*1.15)return [];
    return [{tip,dir:along.normalize()}];});
}
/** How much a 2D ray points at points (px): 1 when the tip is over their outline (convex hull) or the ray passes within inner°, 0 beyond outer°. */
export function pointScore2D(ray,pts,inner=POINT.inner,outer=POINT.outer){
  if(!pts.length)return 0;
  // Convex hull (monotone chain), then: tip inside → 1; else the smallest angle from the ray to a hull point, or 0° if the ray crosses it.
  const s=[...pts].sort((a,b)=>a.x-b.x||a.y-b.y),cr=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x),lo=[],hi=[];
  for(const p of s){while(lo.length>1&&cr(lo.at(-2),lo.at(-1),p)<=0)lo.pop();lo.push(p);}for(const p of [...s].reverse()){while(hi.length>1&&cr(hi.at(-2),hi.at(-1),p)<=0)hi.pop();hi.push(p);}
  const hull=[...lo.slice(0,-1),...hi.slice(0,-1)];
  const inside=hull.length>2&&hull.every((a,i)=>cr(a,hull[(i+1)%hull.length],ray.tip)>=0);if(inside)return 1;
  const ang=p=>{const v=p.clone().sub(ray.tip);return v.dot(ray.dir)<=0?180:THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(v.normalize().dot(ray.dir),-1,1)));};
  // The ray (forward from the tip only) crossing an edge of the hull.
  for(let i=0;i<hull.length;i++){const a=hull[i],e=hull[(i+1)%hull.length].clone().sub(a),den=ray.dir.x*e.y-ray.dir.y*e.x;if(Math.abs(den)<1e-12)continue;
    const w=a.clone().sub(ray.tip),u=(w.x*e.y-w.y*e.x)/den,v=(w.x*ray.dir.y-w.y*ray.dir.x)/den;if(u>0&&v>=0&&v<=1)return 1;}
  return ramp(Math.min(...hull.map(ang)),inner,outer);
}
// image: {landmarks, width, height, project(world) → {x, y} px or null}: pointing judged in 2D (see above).
export function selectInfoBox({view,boxes,hands=null,image=null,visible=()=>true,keyOf,fovea=FOVEA}){
  const eye=new THREE.Vector3(...view.position),forward=new THREE.Vector3(...view.forward).normalize(),touching=hands?.status==='ready';
  const rays2=image?pointingRays2D(image.landmarks,image.width,image.height,image.mask):[],rays=image?.landmarks?.length?[]:pointingRays(hands);
  const scored=boxes.filter(b=>keyOf(b)).map(b=>{
    const seen=boxPoints(b).filter(p=>visible(p));
    const gaze=seen.length?gazeScore(angleToBox(eye,forward,b,seen)??Infinity,fovea):0;
    const proj=rays2.length?boxPoints(b).map(p=>image.project(p)).filter(Boolean):[];
    const point=Math.max(0,...rays2.map(r=>pointScore2D(r,proj)),...rays.map(r=>{const a=angleToBox(r.origin,r.dir,b);return a==null?0:ramp(a,POINT.inner,POINT.outer);}));
    const touch=touching?Math.max(0,...hands.hands.flatMap(h=>h.points.map(p=>ramp(pointBoxDistance(p.position,b),TOUCH.inner,TOUCH.outer)))):0;
    const score=1-(1-WEIGHT.gaze*gaze)*(1-WEIGHT.point*point)*(1-WEIGHT.touch*touch);
    const round=v=>Math.round(v*1000)/1000;
    return {box_id:b.id,key:keyOf(b),score:round(score),cues:{gaze:round(gaze),point:round(point),touch:round(touch)}};
  }).sort((a,b)=>b.score-a.score);
  // Several boxes may be selected (each at or above SELECT_MIN): the question goes with the best one; all of them are shown.
  return {selected:scored[0]?.score>=SELECT_MIN?scored[0]:null,selectedAll:scored.filter(x=>x.score>=SELECT_MIN),candidates:scored.slice(0,3),scores:scored};
}
