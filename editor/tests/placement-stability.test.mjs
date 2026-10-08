import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {chooseStablePlacement,viewFixedPose} from '../src/placement-stability.mjs';
const pose=(x,z=-2)=>({position:new THREE.Vector3(x,0,z),quaternion:new THREE.Quaternion(),width:.8,height:.4});
const camera=x=>{const c=new THREE.PerspectiveCamera(55,1,.01,100);c.position.x=x;c.updateMatrixWorld(true);return c;};
test('zero stability follows the freshly fitted candidate',()=>assert.equal(chooseStablePlacement({current:pose(0),candidate:pose(.25),camera:camera(.25),stability:0}).hold,false));
test('high stability retains an off-centre but readable world anchor',()=>assert.equal(chooseStablePlacement({current:pose(0),candidate:pose(.25),camera:camera(.25),stability:1}).hold,true));
test('visibility loss releases a stable anchor; stability is not a permanent lock',()=>{
 for(const options of [{camera:camera(2)}, {camera:camera(.1),occlusion:0}])assert.equal(chooseStablePlacement({current:pose(0),candidate:pose(options.camera.position.x),stability:1,...options}).hold,false);
});
test('weather can keep a large surface filling the view',()=>{
 const current={...pose(0),width:5,height:3,id:'wall'},candidate={...current,position:new THREE.Vector3(.2,0,-2)};
 assert.equal(chooseStablePlacement({current,candidate,camera:camera(.2),kind:'weather',stability:1}).hold,true);
});
test('a higher movement penalty reduces travel along a recording without losing visibility',()=>{
 const simulate=stability=>{let current=pose(0),travel=0;for(let i=1;i<=30;i++){const x=i*.08,candidate=pose(x),c=camera(x),decision=chooseStablePlacement({current,candidate,camera:c,stability});if(!decision.hold){travel+=current.position.distanceTo(candidate.position);current=candidate;}assert.ok(chooseStablePlacement({current,candidate:current,camera:c,stability}).current.coverage>.6);}return travel;};
 assert.ok(simulate(1)<simulate(0)*.85);
});

test('fixed text retains screen position and size when the user moves and turns',()=>{
 const c=camera(0);let reference;
 for(let i=0;i<8;i++){c.position.set(i*.3,.1*i,.05*i);c.rotation.set(.06*i,.12*i,0);c.updateMatrixWorld(true);const pose=viewFixedPose(c,.55),center=pose.position.clone().project(c),edge=pose.position.clone().add(new THREE.Vector3(pose.width/2,0,0).applyQuaternion(pose.quaternion)).project(c);const footprint=[center.x,center.y,edge.x-center.x];if(!reference)reference=footprint;else footprint.forEach((v,k)=>assert.ok(Math.abs(v-reference[k])<1e-6));assert.ok(pose.height>0);}
});

test('high stability releases an upside-down text pose',()=>{
 const c=camera(0);c.rotation.z=Math.PI;c.updateMatrixWorld(true);const current=pose(0),candidate={...pose(0),quaternion:c.quaternion.clone()};
 assert.equal(chooseStablePlacement({current,candidate,camera:c,stability:1}).hold,false);
});
test('a larger control footer does not shrink fixed response text',()=>{
 const c=camera(0),original=viewFixedPose(c,.6),expanded=viewFixedPose(c,.6+160/1024,0,.6);
 assert.equal(expanded.width,original.width);assert.ok(expanded.height>original.height);
});
