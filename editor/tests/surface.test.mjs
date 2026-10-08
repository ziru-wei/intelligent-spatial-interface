import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';import {projectedSurfaceBasis} from '../src/placement.mjs';

test('ceiling and floor text project upright across camera pitch, yaw and roll',()=>{
 for(const ceiling of [true,false])for(const pitch of [.65,1.15,1.56])for(const yaw of [-2,0,1.8])for(const roll of [-.3,.2]){
  const camera=new THREE.PerspectiveCamera(60,1,.01,100);camera.position.set(0,1.5,0);camera.quaternion.setFromEuler(new THREE.Euler(ceiling?pitch:-pitch,yaw,roll,'YXZ'));camera.updateMatrixWorld(true);
  const forward=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion),distance=(ceiling?1:-1)/forward.y,point=camera.position.clone().addScaledVector(forward,distance),normal=new THREE.Vector3(0,ceiling?-1:1,0);
  const {up}=projectedSurfaceBasis(normal,point,camera),top=point.clone().addScaledVector(up,.05).project(camera),bottom=point.clone().addScaledVector(up,-.05).project(camera);
  assert.ok(top.y>bottom.y,`upside down: ceiling=${ceiling}, pitch=${pitch}, yaw=${yaw}, roll=${roll}`);
 }
});
