import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {layoutGeometry,shapeData} from '../src/layout-shape.mjs';
import {buildTextTargets} from '../src/layout-surfaces.mjs';

const sofa={id:'sofa',center:[2,1,3],size:[2,1,3],yaw:0,shape:{type:'prism',footprint:[[.5,-.5],[.5,.5],[-.5,.5],[-.5,0],[0,0],[0,-.5]]}};
const table={id:'table',center:[0,1,0],size:[1,.025,1],yaw:0,shape:{type:'cylinder',surfaceOnly:true}};
const hit=(mesh,x,z)=>new THREE.Raycaster(new THREE.Vector3(x,10,z),new THREE.Vector3(0,-1,0)).intersectObject(mesh).length>0;
test('L-shaped furniture is pickable on both arms but not in its missing corner',()=>{
  const geometry=layoutGeometry(sofa),mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  assert.ok(hit(mesh,.3,-.3));assert.ok(hit(mesh,-.3,.3));assert.equal(hit(mesh,-.3,-.3),false);geometry.dispose();
  const top=buildTextTargets({objects:[sofa]}).find(t=>t.id==='sofa:top');
  assert.ok(hit(top.pickMesh,2.6,2.1));assert.equal(hit(top.pickMesh,1.4,2.1),false);
});
test('round tabletop has only a circular top target, without box corners or table legs',()=>{
  const geometry=layoutGeometry(table),mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  assert.ok(hit(mesh,.2,.2));assert.equal(hit(mesh,.49,.49),false);
  const targets=buildTextTargets({objects:[table]});assert.deepEqual(targets.map(t=>t.id),['table:top']);
  assert.ok(hit(targets[0].pickMesh,.2,.2));assert.equal(hit(targets[0].pickMesh,.49,.49),false);
  assert.ok(Math.abs(targets[0].origin.y-1.0125)<1e-6);geometry.dispose();
});
test('snapshot shape data is independent for duplicate and undo history',()=>{
  const saved=shapeData(sofa);saved.shape.footprint[0][0]=0;assert.equal(sofa.shape.footprint[0][0],.5);
  assert.deepEqual(shapeData({}),{});
});
