import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {viewSizedWidth,textViewMetrics} from '../src/text-view.mjs';

test('body size scales the answer in the room and keeps it counted as readable',()=>{
  const cam=new THREE.PerspectiveCamera(60,1.5,.02,50);cam.position.set(0,1.5,0);cam.lookAt(0,1.5,-2);cam.updateMatrixWorld(true);
  const at=new THREE.Vector3(0,1.5,-2),q=new THREE.Quaternion(),view={width:1200,height:800},m={xHeightRatio:24/1024};
  const w1=viewSizedWidth(at,q,cam,view,m),w2=viewSizedWidth(at,q,cam,view,{...m,scale:2});
  assert.ok(Math.abs(w2/w1-2)<1e-6);
  const pose=w=>({position:at,quaternion:q,width:w,height:w*.4});
  assert.ok(Math.abs(textViewMetrics(pose(w2),cam,view,{...m,scale:2}).minPx-textViewMetrics(pose(w1),cam,view,m).minPx)<1e-6);
});
