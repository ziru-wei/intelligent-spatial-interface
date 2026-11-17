// Where a panel goes beside a thing (src/action-cues.mjs: a message column): to the user's right of it, else its left, else in front of
// it toward the user; the first spot where the whole panel is in view from where the question was asked. Upright, turned to the user.
import * as THREE from 'three';

export function besidePlacement(camera,thing,{width,height}){
  camera.updateMatrixWorld(true);
  const eye=camera.position.clone(),c=new THREE.Vector3(...thing.center),to=eye.clone().sub(c);to.y=0;const dist=to.length();to.normalize();
  const right=new THREE.Vector3(to.z,0,-to.x),half=Math.max(thing.size[0],thing.size[2])/2,side=half+width/2+.06;
  const y=Math.max(c.y+thing.size[1]/2-height/2+.05,c.y);
  const near=Math.min(.45,Math.max(.15,dist*.35));
  const spots=[c.clone().addScaledVector(right,side),c.clone().addScaledVector(right,-side),
    c.clone().addScaledVector(to,near).addScaledVector(right,width*.35),c.clone().addScaledVector(to,near).addScaledVector(right,-width*.35)].map(p=>{p.y=y;return p;});
  const fits=p=>{const turn=Math.atan2(eye.x-p.x,eye.z-p.z),r=new THREE.Vector3(Math.cos(turn),0,-Math.sin(turn));
    return [[-1,-1],[1,-1],[-1,1],[1,1]].every(([sx,sy])=>{const q=p.clone().addScaledVector(r,sx*width/2);q.y+=sy*height/2;const n=q.project(camera);return n.z<1&&Math.abs(n.x)<.96&&Math.abs(n.y)<.96;});};
  let at=spots.find(fits),fallback=false;
  if(!at){fallback=true;const f=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);f.y=0;f.normalize();at=eye.clone().addScaledVector(f,.75).addScaledVector(new THREE.Vector3(-f.z,0,f.x),.18);at.y=eye.y-.18;}
  return {position:at,yaw:Math.atan2(eye.x-at.x,eye.z-at.z),fallback};   // fallback: in front of the user, at arm's length
}
