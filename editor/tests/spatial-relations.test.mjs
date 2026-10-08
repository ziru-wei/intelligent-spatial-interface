import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {buildTextTargets} from '../src/layout-surfaces.mjs';
import {relationsAt,pickRelation,createRelationTracker,firstHit} from '../src/spatial-relations.mjs';

// A room 6 × 4 m: the front wall along x at z = 0 (10 cm thick) with a window at x = 1.5, a desk against it, a lamp, a fridge, a floor.
const wall=(id,cx,len,holes=[])=>{const pts=[[cx-len/2,0,0],[cx+len/2,0,0],[cx+len/2,2.5,0],[cx-len/2,2.5,0]];return {id,center:[cx,1.25,0],size:[len,2.5,.1],yaw:0,outline:pts,region:[[pts,...holes]]};};
const SEM={
  walls:[wall('Wall_0',0,6,[[[1.1,1,0],[1.9,1,0],[1.9,2,0],[1.1,2,0]]])],
  openings:[{id:'Window_0',label:'window',category:'window',center:[1.5,1.5,0],size:[.8,1,.1],yaw:0}],
  objects:[{id:'desk_0',label:'table',center:[0,.7,.4],size:[1.2,.1,.6],yaw:0},
    {id:'lamp_0',label:'lamp',center:[-1.5,1,1.2],size:[.3,.3,.3],yaw:0},
    {id:'stick_0',label:'umbrella',center:[-2.5,1,1.2],size:[.06,.3,.06],yaw:0},
    {id:'fridge_0',label:'refrigerator',center:[2.6,.9,1.5],size:[.7,1.8,.7],yaw:90}],
  rooms:[{id:'r',polygon:[[[[-3,0],[3,0],[3,4],[-3,4]]]],floorY:0}]
};
const T=buildTextTargets(SEM),D=Math.PI/180;
const view=(eye,yawDeg,pitchDeg)=>({eye:new THREE.Vector3(...eye),dir:new THREE.Vector3(Math.sin(yawDeg*D)*Math.cos(pitchDeg*D),Math.sin(pitchDeg*D),-Math.cos(yawDeg*D)*Math.cos(pitchDeg*D))});
const rel=(v,opts)=>{const all=relationsAt(v,T,opts);return pickRelation(all,Math.asin(v.dir.y)/D);};

test('A: looking down at a near desk, even with the wall right behind it',()=>{
  const r=rel(view([0,1.3,1.2],0,-40));assert.equal(r?.relation,'A');assert.equal(r.surfaceId,'desk_0:top');
  assert.equal(relationsAt(view([0,1.3,1.2],0,-40),T).B?.relation,'B');   // B holds too; looking down decides
});
test('B: level gaze at the wall behind the desk',()=>{
  const r=rel(view([0,1.5,1.2],10,-10));assert.equal(r?.relation,'B');assert.equal(r.wallId,'Wall_0');assert.ok(Math.abs(r.distance-1.15)<1e-6);
});
test('B needs to be close and square on',()=>{
  assert.equal(rel(view([0,1.5,3.5],0,0)),null);              // 3.45 m away
  assert.equal(rel(view([0,1.5,1.2],-50,0)),null);             // 50° off square (the other way is the window)
});
test('B: a large box side counts; looking through a window does not face the wall',()=>{
  const fr=rel(view([1.4,1.5,1.5],90,0));assert.equal(fr?.relation,'B');assert.equal(fr.objectId,'fridge_0');
  const w=rel(view([1.5,1.5,2.5],0,0));assert.equal(w?.relation,'D');assert.equal(w.kind,'window');
});
test('D floor: looking down at the floor a few metres ahead',()=>{
  const r=rel(view([0,1.5,3.8],0,-50));assert.equal(r?.relation,'D');assert.equal(r.kind,'floor');
});
test('D object: near and foveal only',()=>{
  const eye=[-1.5,1.4,2.0],to=new THREE.Vector3(-1.5,1,1.35).sub(new THREE.Vector3(...eye)).normalize();
  const r=pickRelation(relationsAt({eye:new THREE.Vector3(...eye),dir:to},T),Math.asin(to.y)/D);assert.equal(r?.kind,'object');assert.equal(r.objectId,'lamp_0');
  // 6 cm wide at the same distance: 5° rays miss it.
  const eye2=[-2.5,1.4,2.0],to2=new THREE.Vector3(-2.5,1,1.23).sub(new THREE.Vector3(...eye2)).normalize();
  assert.equal(firstHit(T,new THREE.Vector3(...eye2),to2)?.target.objectId,'stick_0');
  assert.equal(pickRelation(relationsAt({eye:new THREE.Vector3(...eye2),dir:to2},T),Math.asin(to2.y)/D),null);
});
test('depth vetoes a surface something stands in front of; things on the desk are clutter',()=>{
  assert.equal(rel(view([0,1.5,1.2],10,-10),{depth:()=>.5})?.relation,undefined);   // a person 0.5 m ahead
  assert.equal(rel(view([0,1.3,1.2],0,-40),{depth:()=>.75})?.cluttered,true);
});
test('tracker: stays while relaxed thresholds hold, leaves after the hold, a seek starts over',()=>{
  const tr=createRelationTracker();
  assert.equal(tr.update(0,view([0,1.5,1.4],0,0),T)?.relation,'B');
  assert.equal(tr.update(.1,view([0,1.5,1.65],0,0),T)?.relation,'B');      // 1.6 m: out of B, within the relaxed 1.8 m
  assert.equal(tr.update(.2,view([0,1.5,2.0],0,0),T)?.relation,'B');       // 1.95 m: gone, but not for 0.5 s yet
  assert.equal(tr.update(.8,view([0,1.5,2.0],0,0),T),null);
  assert.equal(tr.update(5,view([0,1.5,1.4],0,0),T)?.relation,'B');        // seek: immediate
});

test('placement: the relation decides between the desk and the wall behind it',async()=>{
  const {place}=await import('../src/placement.mjs');
  const camera=new THREE.PerspectiveCamera(60,1,.01,100);camera.position.set(0,1.45,1.3);camera.rotation.set(-28*D,0,0);camera.updateMatrixWorld(true);
  const base={frames:[{t:0}],getStaticSurfaces:()=>T,frameCamera:()=>camera,viewport:()=>({width:600,height:600}),visible:async(_,pts)=>pts.map(()=>true)};
  const at=relation=>place({frame:0,aspect:.4,textMetrics:{xHeightRatio:.04}},{...base,relationAt:()=>relation});
  const a=await at({relation:'A',surfaceId:'desk_0:top',distance:.9});assert.equal(a.surfaceId,'desk_0:top');assert.equal(a.relation,'A');
  const b=await at({relation:'B',surfaceId:'Wall_0:0:a',wallId:'Wall_0',distance:1.25});assert.equal(b.surfaceId,'Wall_0:0:a');assert.equal(b.relation,'B');
  assert.ok(Math.abs(b.surfaceAnchor.y-1.35)<.35,`near eye level: ${b.surfaceAnchor.y}`);
  assert.equal((await at(null)).unreadable,true);   // no relation: no surface
});
