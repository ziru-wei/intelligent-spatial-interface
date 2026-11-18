// The view stack (modos-system-design.md 4.5): what stands fixed in the user's view, bottom to top, centred and never overlapping:
// the question's caption, Floating Text, then UI that is not on a real thing in view: UI of no physical thing (Weather's Date Picker
// and Playback: the weather is not a thing in the room), and the controls of a thing that was out of view when the question was asked
// (they stay in view for that answer). Heights are in the view's -1..1 range; each part follows the camera every frame.
import * as THREE from 'three';

export const STACK={gap:.03,base:-.9,distance:.7};

/** Where a part of the stack stands: its bottom edge's centre at view height `bottom`, STACK.distance along the view, flat and facing
 *  the user. Returns {point (world), quaternion, up (world), top(heightWorld): the view height of its top edge}. */
export function viewAnchor(camera,bottom,distance=STACK.distance){
  camera.updateMatrixWorld(true);
  const quaternion=camera.getWorldQuaternion(new THREE.Quaternion()),forward=new THREE.Vector3(0,0,-1).applyQuaternion(quaternion),up=new THREE.Vector3(0,1,0).applyQuaternion(quaternion);
  const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(0,bottom),camera);
  const point=camera.position.clone().addScaledVector(ray.ray.direction,distance/Math.max(.1,ray.ray.direction.dot(forward)));
  return {point,quaternion,up,top:h=>point.clone().addScaledVector(up,h).project(camera).y};
}

/** The rectangle (NDC) a world object covers on screen, or null when behind the eye. */
export function screenRect(camera,object){
  const b=new THREE.Box3().setFromObject(object);if(b.isEmpty())return null;const r={x0:1e9,x1:-1e9,y0:1e9,y1:-1e9};
  for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const p=new THREE.Vector3(x,y,z).project(camera);if(p.z>1)return null;
    r.x0=Math.min(r.x0,p.x);r.x1=Math.max(r.x1,p.x);r.y0=Math.min(r.y0,p.y);r.y1=Math.max(r.y1,p.y);}
  return r;
}
