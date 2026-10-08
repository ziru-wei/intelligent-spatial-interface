import * as THREE from 'three';
import {frontOnly} from './layout-surfaces.mjs';

// How the person stands to the room at a frame, from the recorded camera (Record3D: the phone, held where the person looks) and the
// layout's text surfaces (src/layout-surfaces.mjs, depth-corrected). One relation at a time, in this order:
//
//   A  a horizontal surface near the centre of view: the gaze ray first meets a box top (not the floor) under 1 m away, 0.2-0.9 m
//      below the eye, looking down (pitch under -15°): a desk, a counter.
//   B  facing a vertical surface nearby: the body's facing direction (the gaze, levelled, from the eye) first meets a wall face or a
//      box's side of at least 0.4 × 0.4 m, under 1.5 m away (perpendicular), within 30° of square on, with the eye in front of it.
//      When A and B both hold (a desk against a wall), looking down picks A (pitch under -25°), else B.
//   D  neither: the surface the gaze is on, if it is close and central enough:
//        floor          under 2.5 m, pitch under -35°, within 10° of the centre of view
//        window, door   under 3 m, within 15°
//        object         (any other box face) under 1 m and foveal: at least 4 of 5 rays within 5° of the centre on that object
//
// The A/B/D surface is what placement prefers (src/text-surfaces.mjs). Recorded depth, where given, vetoes a surface something else
// stands in front of (a person, a bag; and for A, things on the desk are reported as `cluttered`).
const DEG=Math.PI/180,UP=new THREE.Vector3(0,1,0);
export const RELATION={
  A:{maxDistance:1,below:[.2,.9],maxPitch:-15},
  B:{maxDistance:1.5,maxAngle:30,minFace:.4,beside:.3,lookDown:-25},
  D:{floor:{maxDistance:2.5,maxEcc:10,maxPitch:-35},opening:{maxDistance:3,maxEcc:15},object:{maxDistance:1,cone:5,minHits:4}},
  // Leaving a relation is easier than entering it: distances × 1.2, angles + 5°. A new state must hold this long (s) to replace the old.
  relax:{distance:1.2,angle:5},hold:.5,objectHold:.8,blocked:.25,clutter:.05
};

const isOpening=t=>t.kind==='window'||!!t.opening;
const isHorizontalBoxTop=t=>t.surface==='box'&&t.n.y>.9;
const isVertical=t=>Math.abs(t.n.y)<.3;
const big=(t,min)=>t.width>=min&&t.height>=min;

function inside(t,p){const d=p.clone().sub(t.origin),x=d.dot(t.right),y=d.dot(t.up);
  if(Math.abs(x)>t.width/2+1e-6||Math.abs(y)>t.height/2+1e-6)return false;if(!t.triangles)return true;
  for(let i=0;i<t.triangles.length;i+=3){const a=t.triangles[i],b=t.triangles[i+1],c=t.triangles[i+2];
    const d1=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x),d2=(c.x-b.x)*(y-b.y)-(c.y-b.y)*(x-b.x),d3=(a.x-c.x)*(y-c.y)-(a.y-c.y)*(x-c.x);
    if((d1>=-1e-9&&d2>=-1e-9&&d3>=-1e-9)||(d1<=1e-9&&d2<=1e-9&&d3<=1e-9))return true;}
  return false;}
/** The first target a ray meets (from its front, for one-sided targets): {target, distance, point} or null. */
export function firstHit(targets,origin,dir,filter=null){
  let best=null;
  for(const t of targets){if(filter&&!filter(t))continue;const den=dir.dot(t.n);if(Math.abs(den)<1e-6||frontOnly(t)&&den>=0)continue;
    const distance=t.origin.clone().sub(origin).dot(t.n)/den;if(distance<=.02||best&&distance>=best.distance)continue;
    const point=origin.clone().addScaledVector(dir,distance);if(inside(t,point))best={target:t,distance,point};}
  return best;
}
const pitchOf=dir=>Math.asin(THREE.MathUtils.clamp(dir.y,-1,1))/DEG;

/** Every relation that holds at this view ({eye, dir}: unit gaze direction), with thresholds relaxed when `relaxed`. depth(dir) →
 *  metres along that ray to what the recording's depth saw (optional). Returns {A, B, D} (each null or {surfaceId, ...}). */
export function relationsAt(view,targets,{relaxed=false,depth=null}={}){
  const {eye,dir}=view,k=relaxed?RELATION.relax.distance:1,da=relaxed?RELATION.relax.angle:0,pitch=pitchOf(dir),out={A:null,B:null,D:null};
  const blocked=hit=>{if(!depth||!hit)return false;const d=depth(hit.dir||dir);return d>0&&d<hit.distance-RELATION.blocked;};
  const gaze=firstHit(targets,eye,dir);
  // A: the gaze lands on a near box top below the eye.
  if(gaze&&isHorizontalBoxTop(gaze.target)&&pitch<RELATION.A.maxPitch+da&&gaze.distance<RELATION.A.maxDistance*k){
    const below=eye.y-gaze.point.y,[lo,hi]=RELATION.A.below;
    if(below>=lo/k&&below<=hi*k&&!blocked(gaze)){const d=depth?.(dir);
      out.A={relation:'A',surfaceId:gaze.target.id,objectId:gaze.target.objectId,distance:gaze.distance,point:gaze.point,cluttered:!!(d>0&&d<gaze.distance-RELATION.clutter)};}}
  // B: what the body faces at eye height.
  const level=new THREE.Vector3(dir.x,0,dir.z);
  if(level.lengthSq()>1e-6){level.normalize();
    // The first vertical thing ahead (a small box or a window in between means the person does not face the wall behind it).
    const face=firstHit(targets,eye,level,isVertical);
    if(face&&(face.target.surface==='wall'||face.target.surface==='box'&&!face.target.opening&&big(face.target,RELATION.B.minFace))){const t=face.target,n=new THREE.Vector3(t.n.x,0,t.n.z).normalize(),angle=Math.acos(THREE.MathUtils.clamp(-level.dot(n),-1,1))/DEG;
      const perpendicular=eye.clone().sub(t.origin).dot(t.n),along=Math.abs(eye.clone().sub(t.origin).dot(t.right));
      if(angle<=RELATION.B.maxAngle+da&&perpendicular>0&&perpendicular<RELATION.B.maxDistance*k&&along<=t.width/2+RELATION.B.beside&&!blocked({...face,dir:level}))
        out.B={relation:'B',surfaceId:t.id,objectId:t.objectId,wallId:t.wall,distance:perpendicular,angle,point:face.point};}}
  // D: the surface under the gaze, strictly.
  const D=RELATION.D,probe=(maxEcc,accept)=>{   // the centre first, then rings out to maxEcc degrees
    for(const ecc of [0,maxEcc/2,maxEcc])for(let a=0;a<(ecc?8:1);a++){const r=rotateAround(dir,ecc,a*45);const h=firstHit(targets,eye,r);
      if(h&&accept(h.target)&&!blocked({...h,dir:r}))return {...h,ecc};}
    return null;};
  const floor=pitch<D.floor.maxPitch+da&&probe(D.floor.maxEcc+da,t=>t.surface==='floor');
  if(floor&&floor.distance<D.floor.maxDistance*k)out.D={relation:'D',kind:'floor',surfaceId:floor.target.id,distance:floor.distance,ecc:floor.ecc,point:floor.point};
  if(!out.D){const o=probe(D.opening.maxEcc+da,isOpening);
    if(o&&o.distance<D.opening.maxDistance*k)out.D={relation:'D',kind:o.target.kind==='window'?'window':'door',surfaceId:o.target.id,objectId:o.target.objectId,distance:o.distance,ecc:o.ecc,point:o.point};}
  if(!out.D&&gaze&&gaze.target.surface==='box'&&!gaze.target.opening&&gaze.distance<D.object.maxDistance*k&&!blocked(gaze)){
    const id=gaze.target.objectId;let hits=0;
    for(let a=0;a<5;a++){const h=firstHit(targets,eye,a?rotateAround(dir,D.object.cone,a*90):dir);if(h?.target.objectId===id)hits++;}
    if(hits>=D.object.minHits)out.D={relation:'D',kind:'object',surfaceId:gaze.target.id,objectId:id,distance:gaze.distance,ecc:0,point:gaze.point};}
  return out;
}
// dir turned by ecc degrees away from itself, toward the direction at angle `around` degrees about it.
function rotateAround(dir,ecc,around){
  if(!ecc)return dir.clone();const side=Math.abs(dir.y)>.95?new THREE.Vector3(1,0,0):UP;const a=new THREE.Vector3().crossVectors(dir,side).normalize(),b=new THREE.Vector3().crossVectors(a,dir);
  const axis=a.multiplyScalar(Math.cos(around*DEG)).addScaledVector(b,Math.sin(around*DEG)).normalize();
  return dir.clone().applyAxisAngle(axis,ecc*DEG);
}
/** The one relation at this view (A, B or D, or null), by the rules above. */
export function pickRelation(all,pitch){
  if(all.A&&all.B)return pitch<RELATION.B.lookDown?all.A:all.B;
  return all.A||all.B||all.D||null;
}
export const viewOf=camera=>({eye:camera.getWorldPosition(new THREE.Vector3()),dir:camera.getWorldDirection(new THREE.Vector3())});
export const sameRelation=(a,b)=>(a?.relation||null)===(b?.relation||null)&&(a?.surfaceId||null)===(b?.surfaceId||null);

/** Hysteresis over time. update(t, view, targets, opts) → the relation now: it changes only after the new state has held for `hold`
 *  seconds (0.8 s for objects), and the current one stays while it holds under relaxed thresholds. A jump back in time or of more than
 *  a second (a seek) starts over. */
export function createRelationTracker(){
  let current=null,pending=null,since=0,last=null;
  return {
    update(t,view,targets,opts={}){
      const all=relationsAt(view,targets,opts),now=pickRelation(all,pitchOf(view.dir));
      if(last==null||t<last||t-last>1){current=now;pending=null;last=t;return current;}
      last=t;
      if(sameRelation(now,current)){pending=null;current=now;return current;}
      // The current one still holds when relaxed: only a different relation may take over (after its hold), not nothing.
      const keep=current&&(()=>{const r=relationsAt(view,targets,{...opts,relaxed:true})[current.relation];return r&&r.surfaceId===current.surfaceId?r:null;})();
      if(keep&&!now){pending=null;current=keep;return current;}
      if(!sameRelation(now,pending)){pending=now;since=t;}
      const hold=(now||current)?.kind==='object'?RELATION.objectHold:RELATION.hold;
      if(t-since>=hold){current=now;pending=null;}
      else if(keep)current=keep;
      return current;
    },
    reset(){current=pending=last=null;},
    get current(){return current;}
  };
}
