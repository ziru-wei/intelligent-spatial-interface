// Placement of a MOD's generic UI cluster (modos-system-design.md 4.5, rule 2) with the `user-reach` anchor: controls the user works
// with their hand (Weather's Date Picker and Playback). Candidates are tried in order and the first that fits wins:
//   the whole cluster in view → not over what it must not cover (screen rectangles: the answer text, a target with content) →
//   a comfortable distance (0.55–0.75 m) → low in the view, toward the hands.
// Upright and turned to the user; sized to keep its angle in the view (width = WIDTH_PER_M × distance). Placed once, then locked in the
// world (rule 5): `stays()` says whether a placed cluster may stay (still partly in view, or out of view only briefly).
import * as THREE from 'three';

export const WIDTH_PER_M=.4;   // about 23° of the view wide
const SPOTS=[[0,-.42],[.22,-.42],[-.22,-.42],[0,-.6],[.35,-.6],[-.35,-.6],[0,-.72],[.45,-.3],[-.45,-.3],[.5,0],[-.5,0],[0,-.2]],DIST=[.65,.55,.75];

/** The rectangle (NDC) a world box covers on screen, or null when behind the eye. */
export function screenRect(camera,object){
  const b=new THREE.Box3().setFromObject(object);if(b.isEmpty())return null;const r={x0:1e9,x1:-1e9,y0:1e9,y1:-1e9};
  for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const p=new THREE.Vector3(x,y,z).project(camera);if(p.z>1)return null;
    r.x0=Math.min(r.x0,p.x);r.x1=Math.max(r.x1,p.x);r.y0=Math.min(r.y0,p.y);r.y1=Math.max(r.y1,p.y);}
  return r;
}
const overlap=(a,b)=>Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));

/** {position, quaternion, scale, fallback}: where a cluster of natural size {w, h} (metres at scale 1) goes. avoid: NDC rectangles. */
export function userReachPlacement(camera,natural,{avoid=[]}={}){
  camera.updateMatrixWorld(true);const eye=camera.position.clone(),ray=new THREE.Raycaster();
  const at=(nx,ny,d)=>{ray.setFromCamera(new THREE.Vector2(nx,ny),camera);const p=eye.clone().addScaledVector(ray.ray.direction,d);
    const yaw=Math.atan2(eye.x-p.x,eye.z-p.z),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),scale=WIDTH_PER_M*eye.distanceTo(p)/natural.w;
    const r=new THREE.Vector3(1,0,0).applyQuaternion(q),w=natural.w*scale/2,h=natural.h*scale/2,rect={x0:1e9,x1:-1e9,y0:1e9,y1:-1e9};let inView=true;
    for(const [sx,sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]){const c=p.clone().addScaledVector(r,sx*w);c.y+=sy*h;const n=c.project(camera);
      if(n.z>1||Math.abs(n.x)>.96||Math.abs(n.y)>.96)inView=false;rect.x0=Math.min(rect.x0,n.x);rect.x1=Math.max(rect.x1,n.x);rect.y0=Math.min(rect.y0,n.y);rect.y1=Math.max(rect.y1,n.y);}
    return {position:p,quaternion:q,scale,rect,inView};};
  let least=null;
  for(const d of DIST)for(const [nx,ny] of SPOTS){const c=at(nx,ny,d);if(!c.inView)continue;const cover=avoid.reduce((t,a)=>t+(a?overlap(a,c.rect):0),0);
    if(!cover)return {...c,fallback:false};if(!least||cover<least.cover)least={...c,cover};}
  // nothing clear: the in-view spot covering the least of what it should not; none in view: in front, low in the view
  return least?{...least,fallback:true}:{...at(0,-.42,DIST[0]),fallback:true};
}

/** Whether a locked cluster stays: in view now, or out of view for less than `grace` ms (then it is placed again). */
export function createStay(grace=1500){
  let away=null;
  return {reset(){away=null;},stays(camera,position,now=performance.now()){const n=position.clone().project(camera),seen=n.z<1&&Math.abs(n.x)<1.1&&Math.abs(n.y)<1.1;
    if(seen){away=null;return true;}away??=now;return now-away<grace;}};
}
