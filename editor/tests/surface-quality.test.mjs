import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {surfaceQuality} from '../src/surface-quality.mjs';
import {readableSurfaceBasis} from '../src/placement.mjs';
test('printed clutter costs more than the adjacent blank area',()=>{
 const camera=new THREE.PerspectiveCamera(60,1,.01,100);camera.updateMatrixWorld(true);
 const image={width:192,height:192,data:new Uint8ClampedArray(192*192*4)};
 for(let y=0;y<192;y++)for(let x=0;x<192;x++){const i=4*(y*192+x),value=x<96?(y%4<2?40:230):230;image.data.set([value,value,value,255],i);}
 const pose=x=>({position:new THREE.Vector3(x,0,-2),quaternion:new THREE.Quaternion(),width:.7});
 const book=surfaceQuality(pose(-.5),.6,camera,image),blank=surfaceQuality(pose(.5),.6,camera,image);
 assert.ok(book.cost>blank.cost+1);assert.equal(blank.clutter,0);
});
test('vertical surfaces keep text upright whatever the camera pitch and roll',()=>{
 for(const normal of [new THREE.Vector3(0,0,1),new THREE.Vector3(.4,.12,1).normalize(),new THREE.Vector3(-1,0,0)]){
  const camera=new THREE.PerspectiveCamera(60,1,.01,100);camera.position.set(0,2,3);camera.lookAt(0,0,0);camera.rotateZ(.35);camera.updateMatrixWorld(true);
  const b=readableSurfaceBasis(normal,camera.quaternion,new THREE.Vector3(.4,0,0),camera.position,camera);
  assert.ok(Math.abs(b.right.y)<1e-8,'baseline level in the world');assert.ok(b.up.y>.9);assert.ok(Math.abs(b.right.dot(normal))<1e-8);assert.ok(Math.abs(b.up.dot(normal))<1e-8);
  assert.ok(b.right.clone().cross(b.up).dot(normal)>.99,'reads from the front');
 }
});
test('horizontal surface baselines project horizontally, including camera roll',()=>{
 for(const normal of [new THREE.Vector3(0,1,0),new THREE.Vector3(.1,1,.2).normalize()]){
  const camera=new THREE.PerspectiveCamera(60,1,.01,100);camera.position.set(0,2,3);camera.lookAt(0,0,0);camera.rotateZ(.35);camera.updateMatrixWorld(true);
  const p=new THREE.Vector3(.4,0,0),b=readableSurfaceBasis(normal,camera.quaternion,p,camera.position),left=p.clone().addScaledVector(b.right,-.2).project(camera),right=p.clone().addScaledVector(b.right,.2).project(camera);
  assert.ok(Math.abs(left.y-right.y)<1e-8);assert.ok(right.x>left.x);assert.ok(Math.abs(b.right.dot(normal))<1e-8);assert.ok(Math.abs(b.up.dot(normal))<1e-8);
 }
});
test('placement prefers blank space on the right over a cluttered centre',async()=>{
 const {staticTextPlacement}=await import('../src/text-surfaces.mjs');
 const camera=new THREE.PerspectiveCamera(60,1,.01,100);camera.updateMatrixWorld(true);
 const target={id:'desktop',origin:new THREE.Vector3(0,0,-2),n:new THREE.Vector3(0,0,1),right:new THREE.Vector3(1,0,0),up:new THREE.Vector3(0,1,0),width:3,height:2};
 const ctx={getStaticSurfaces:()=>[target],frameCamera:()=>camera,viewport:()=>({width:600,height:600}),getSurfaceQuality:async()=>pose=>({cost:pose.position.x>.25?0:4}),visible:async(_,pts)=>pts.map(()=>true)};
 const pose=await staticTextPlacement({frame:0,aspect:.4,textMetrics:{xHeightRatio:.04}},ctx,readableSurfaceBasis);
 assert.ok(pose.position.x>.25);assert.equal(pose.surfaceId,'desktop');
});
test('exact orientation follows a moving calibrated camera without moving the world anchor',async()=>{
 const {projectedSurfaceBasis}=await import('../src/placement.mjs'),{projection}=await import('../src/math.mjs');
 const camera=new THREE.PerspectiveCamera(),p=new THREE.Vector3(.3,1,-2),normal=new THREE.Vector3(.25,.1,1).normalize();
 camera.projectionMatrix.copy(projection({width:1000,height:800,fx:830,fy:850,cx:470,cy:390}));camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
 for(let i=0;i<10;i++){
  camera.position.set(i*.03,1+.01*i,.1);camera.rotation.set(.01*i,.015*i,.04*i);camera.updateMatrixWorld(true);
  const b=projectedSurfaceBasis(normal,p,camera),a=p.clone().addScaledVector(b.right,-.3).project(camera),z=p.clone().addScaledVector(b.right,.3).project(camera);
  assert.ok(Math.abs(z.y-a.y)<1e-9);assert.ok(z.x>a.x);assert.ok(Math.abs(b.up.dot(normal))<1e-9);
 }
});
test('a smooth low-texture object above a desk still incurs an occupancy cost',()=>{
 const camera=new THREE.PerspectiveCamera(60,1,.01,100);camera.updateMatrixWorld(true);
 const image={width:32,height:32,data:new Uint8ClampedArray(32*32*4).fill(240)},pose={position:new THREE.Vector3(0,0,-2),quaternion:new THREE.Quaternion(),width:.5};
 const clear=surfaceQuality(pose,.5,camera,image,{width:32,height:32,data:new Float32Array(1024).fill(2)});
 const occupied=surfaceQuality(pose,.5,camera,image,{width:32,height:32,data:new Float32Array(1024).fill(1.9)});
 assert.equal(clear.occupied,0);assert.ok(occupied.occupied>.9);assert.ok(occupied.cost>clear.cost+3);
});
