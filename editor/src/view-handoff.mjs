import * as THREE from 'three';

// Releasing follow (or walk) into orbit: same position, looking the same way at a point `distance` ahead, but level. The orbit keeps
// world up (+y), so the floor never tilts or turns over however the recorded head was rolled; only the roll is dropped.
export function handoffOrbit(source, destination, target, distance=2){
  const forward=new THREE.Vector3(0,0,-1).applyQuaternion(source.quaternion);
  destination.position.copy(source.position);
  destination.up.set(0,1,0);
  for(const key of ['fov','aspect','near','far','zoom'])destination[key]=source[key];
  destination.updateProjectionMatrix();
  target.copy(source.position).addScaledVector(forward,distance);
  destination.lookAt(target);
}
