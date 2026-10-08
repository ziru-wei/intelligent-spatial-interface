import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {buildTextTargets,estimateOffset,calibrate,applyOffsets,frontOnly} from '../src/layout-surfaces.mjs';
import {setPose} from '../src/math.mjs';

// A 4 m wall along x at z = 0, 10 cm thick, and a table top 0.75 m high.
const SEM={walls:[{id:'Wall_0',center:[0,1.25,0],size:[4,2.5,.1],yaw:0,outline:[[-2,0,0],[2,0,0],[2,2.5,0],[-2,2.5,0]]}],
  objects:[{id:'table_0',label:'table',center:[0,.7,1.5],size:[1.2,.1,.6],yaw:0}]};

test('a wall becomes its two one-sided faces, half its thickness out',()=>{
  const faces=buildTextTargets(SEM).filter(t=>t.wall==='Wall_0');
  assert.equal(faces.length,2);
  for(const f of faces){assert.ok(f.oneSided&&frontOnly(f));assert.ok(Math.abs(Math.abs(f.origin.z)-.05)<1e-9);assert.ok(f.n.z*Math.sign(f.origin.z)>.99);}
});

test('offset: the deepest well-supported layer, not clutter nearer the room',()=>{
  const wall=Array.from({length:400},(_,i)=>-.03+(i%7-3)*.002),poster=Array.from({length:100},()=>-.02),books=Array.from({length:300},(_,i)=>.06+(i%5)*.004);
  assert.ok(Math.abs(estimateOffset([...wall,...poster,...books])+.03)<.006);
  assert.equal(estimateOffset([.01,.02]),null);   // too few samples: keep the layout's plane
});

test('calibration from depth: a wall 3 cm behind the layout face, a table 2 cm higher',async()=>{
  const intrinsics={fx:200,fy:200,cx:128,cy:96,width:256,height:192};
  // Camera 1.5 m from the wall, looking at it and slightly down (sees the wall and the table top).
  const frame={position:[0,1.4,2.6],quaternion:new THREE.Quaternion().setFromEuler(new THREE.Euler(-.45,0,0)).toArray()};
  const camera=()=>{const c=new THREE.PerspectiveCamera();setPose(c,frame,intrinsics);c.updateMatrixWorld(true);return c;};
  // Ray-cast depth against the real scene: the wall's face at z = 0.05 - 0.03, the table top at y = 0.75 + 0.02.
  const real=[{n:new THREE.Vector3(0,0,1),d:.02},{n:new THREE.Vector3(0,1,0),d:.77,box:p=>Math.abs(p.x)<.6&&Math.abs(p.z-1.5)<.3}];
  const readDepth=()=>{const w=128,h=96,data=new Float32Array(w*h),c=camera();
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const ndc=new THREE.Vector3(((x+.5)/w)*2-1,1-((y+.5)/h)*2,.5).unproject(c),dir=ndc.sub(c.position).normalize();
      let best=Infinity;for(const s of real){const den=dir.dot(s.n);if(Math.abs(den)<1e-6)continue;const t=(s.d-c.position.dot(s.n))/den;if(t<=0||t>=best)continue;const p=c.position.clone().addScaledVector(dir,t);if(s.box&&!s.box(p))continue;best=t;}
      if(best<Infinity)data[y*w+x]=best*dir.dot(new THREE.Vector3(0,0,-1).applyQuaternion(c.quaternion));}
    return {data,width:w,height:h};};
  const targets=buildTextTargets(SEM),offsets=await calibrate(targets,{frames:[0],readDepth,camera,intrinsics});
  const front=targets.find(t=>t.wall==='Wall_0'&&t.n.z>0),top=targets.find(t=>t.id==='table_0:top');
  assert.ok(Math.abs(offsets.get(front.id).offset+.03)<.006,`wall ${offsets.get(front.id)?.offset}`);
  assert.ok(Math.abs(offsets.get(top.id).offset-.02)<.006,`table ${offsets.get(top.id)?.offset}`);
  const moved=applyOffsets(targets,offsets).find(t=>t.id===front.id);
  assert.ok(Math.abs(moved.origin.z-.02)<.006);assert.equal(targets.find(t=>t.id===front.id).origin.z,.05);   // the layout's own targets are unchanged
});
