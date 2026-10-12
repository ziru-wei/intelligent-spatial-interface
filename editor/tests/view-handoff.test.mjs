import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {handoffOrbit} from '../src/view-handoff.mjs';

test('follow to orbit keeps position, view direction and projection, but levels the roll',()=>{
 const src=new THREE.PerspectiveCamera(73,1.4,.02,100);src.position.set(3,7,16);src.rotation.set(.35,-.8,.2,'YXZ');
 const dst=new THREE.PerspectiveCamera(),target=new THREE.Vector3();handoffOrbit(src,dst,target);
 const forward=v=>new THREE.Vector3(0,0,-1).applyQuaternion(v.quaternion);
 assert.ok(dst.position.distanceTo(src.position)<1e-12);
 assert.ok(forward(dst).distanceTo(forward(src))<1e-7);
 assert.ok(dst.projectionMatrix.equals(src.projectionMatrix));
 assert.deepEqual(dst.up.toArray(),[0,1,0]);
 // Level: the camera's right axis stays horizontal, so OrbitControls (lookAt with +y up) keeps exactly this orientation.
 assert.ok(Math.abs(new THREE.Vector3(1,0,0).applyQuaternion(dst.quaternion).y)<1e-9);
 const before=dst.quaternion.clone();dst.lookAt(target);assert.ok(dst.quaternion.angleTo(before)<1e-7);
 assert.ok(target.distanceTo(src.position.clone().addScaledVector(forward(src),2))<1e-9);
});
