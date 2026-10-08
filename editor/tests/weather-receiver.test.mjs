import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {lightReceiver,receiverGeometry,createSunlight} from '../src/weather-art.mjs';
import {stepsAt} from '../src/agent.mjs';
const target={kind:'horizontal',origin:new THREE.Vector3(0,0,0),right:new THREE.Vector3(1,0,0),up:new THREE.Vector3(0,0,1),n:new THREE.Vector3(0,1,0),width:1,height:1};
const collide=(start,direction)=>{assert.equal(direction.y,-1);return {point:new THREE.Vector3(start.x,.2,start.z),normal:new THREE.Vector3(0,1,0),distance:start.y-.2};};
test('sun and moon receivers follow collision heights, not layout heights',()=>{
 const root=new THREE.Group();root.position.set(.1,.065,0);root.updateMatrixWorld(true);
 assert.equal(lightReceiver(target,0,0,collide).point.y,.2);
 const geometry=receiverGeometry(root,target,collide);assert.ok(geometry.attributes.position.count>0);
 const p=new THREE.Vector3();for(let i=0;i<geometry.attributes.position.count;i++){p.fromBufferAttribute(geometry.attributes.position,i).applyMatrix4(root.matrixWorld);assert.ok(Math.abs(p.y-.206)<1e-6);}
 const volume=()=>new THREE.ShaderMaterial({uniforms:{time:{value:0},beam:{value:0}}});
 createSunlight(root,target,collide,volume);const sun=root.getObjectByName('dappled-sunlight');assert.ok(sun.geometry.attributes.position.count>0);assert.equal(sun.material.depthTest,true);assert.equal(sun.material.depthWrite,false);
 for(let i=0;i<sun.geometry.attributes.position.count;i++){p.fromBufferAttribute(sun.geometry.attributes.position,i).applyMatrix4(root.matrixWorld);assert.ok(Math.abs(p.y-.206)<1e-6);}
});
test('receiver geometry excludes holes and does not bridge large height discontinuities',()=>{
 assert.equal(receiverGeometry(new THREE.Group(),target,()=>null).attributes.position.count,0);
 const g=receiverGeometry(new THREE.Group(),target,start=>({point:new THREE.Vector3(start.x,start.x<0?0:.3,start.z),normal:new THREE.Vector3(0,1,0)}));
 const p=g.attributes.position;for(let i=0;i<p.count;i+=3){const ys=[p.getY(i),p.getY(i+1),p.getY(i+2)];assert.ok(Math.max(...ys)-Math.min(...ys)<.08);}
});
test('process replay reveals steps only at their recorded times',()=>{
 const q={status:'answered',trace:[{at:100,text:'start'},{at:2000,text:'UI ready'}]};
 assert.equal(stepsAt(q,0).length,0);assert.equal(stepsAt(q,1).length,1);assert.equal(stepsAt(q,2).length,2);
 assert.equal(stepsAt({...q,status:'running'},1).length,1);
});
