import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {locateHands,handBoxDistance} from '../src/hand-perception/spatial.mjs';
import {createApproachRemoval} from '../src/findmy-approach.mjs';
const fixture=()=>({perception:{key:'frame1',status:'ready',width:20,height:20,mask:new Uint8Array(400).fill(255),landmarks:[Array.from({length:21},()=>({x:.5,y:.5}))]},depth:{width:20,height:20,data:new Float32Array(400).fill(2)},camera:new THREE.PerspectiveCamera(),intrinsics:{width:100,height:100,fx:50,fy:50,cx:50,cy:50}});
test('hand positions use recording depth and scene camera transform, not hand-relative world landmarks',()=>{
 const input=fixture();input.camera.position.set(4,1,3);input.camera.rotation.y=Math.PI/2;
 input.perception.worldLandmarks=[[{x:99,y:99,z:99}]];
 const data=locateHands(input),p=data.hands[0].points[0].position;
 assert.equal(data.status,'ready');assert.ok(Math.abs(p[0]-2)<1e-6);assert.ok(Math.abs(p[1]-1)<1e-6);assert.ok(Math.abs(p[2]-3)<1e-6);
 assert.equal(handBoxDistance(data,{center:[2,1,3],size:[.5,.5,.5],yaw:50}),0);
});
test('invalid depth or background pixels cannot trigger a hand approach',()=>{
 const input=fixture();input.depth.data.fill(0);assert.equal(locateHands(input).status,'no-valid-depth');
 input.depth.data.fill(2);input.perception.mask.fill(0);assert.equal(locateHands(input).hands.length,0);
 input.depth=null;assert.equal(locateHands(input).status,'no-depth');assert.equal(handBoxDistance(locateHands(input),{}),null);
});
test('distance accounts for a rotated box and its faces rather than its center',()=>{
 const data={status:'ready',hands:[{points:[{position:[0,0,1.2]}]}]};
 assert.ok(Math.abs(handBoxDistance(data,{center:[0,0,0],size:[2,1,.5],yaw:90})-.2)<1e-6);
});
test('approach removal responds to one paused-frame measurement, stays removed and replays from contact',()=>{
 const gate=createApproachRemoval(),at=(frame,t,distance,key='q1',enabled=true)=>gate.update({key,frame,t,distance,enabled});
 assert.equal(at(0,0,.4),false);assert.equal(at(1,.1,null),false);
 // Actual reported case: 0.17 m, without a second recording frame.
 assert.equal(at(1,.1,.17),true);assert.equal(at(2,.2,1),true);
 assert.equal(at(0,0,1),false);assert.equal(at(1,.1,1),true);
 assert.equal(at(2,.2,.26,'q2'),false);assert.equal(at(3,.3,null,'q2'),false);assert.equal(at(4,.4,.25,'q2'),true);
 assert.equal(at(6,1.1,null,'q2'),true);
 assert.equal(at(2,.2,1,'q1',false),false);assert.equal(at(2,.2,1),false);
});

test('distance tolerance is adjustable but missing or invalid depth cannot remove the effect',()=>{
 const gate=createApproachRemoval();
 for(const distance of [null,undefined,NaN,Infinity,-.1])assert.equal(gate.update({key:'book',frame:0,enabled:true,distance}),false);
 assert.equal(gate.update({key:'book',frame:0,enabled:true,distance:.17,distanceM:.1}),false);
 assert.equal(gate.update({key:'book',frame:0,enabled:true,distance:.17,distanceM:.3}),true);
 gate.reset();assert.equal(gate.update({key:'book',frame:0,enabled:true,distance:1}),false);
});
