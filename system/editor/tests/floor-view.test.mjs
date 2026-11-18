import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {floorSlice,floorPlanes,sectionRange,visibleFloor,suggestedFloorSplit,restoredFloorPreference} from '../src/floor-view.mjs';
import {createTransformHistory} from '../src/transform-history.mjs';
const box=new THREE.Box3(new THREE.Vector3(-5,-1,-5),new THREE.Vector3(5,7,5));

test('automatic floor boundary retains uneven upper-floor corridors below the building midpoint',()=>{
 const atlas=new THREE.Box3(new THREE.Vector3(-10,0,-5),new THREE.Vector3(20,10.96,30));
 const split=suggestedFloorSplit(atlas,[{floor:2,floorY:5.376},{floor:2,floorY:5.46},{floor:2,floorY:5.6}]);
 assert.ok(Math.abs(split-5.176)<1e-9);
 const planes=floorPlanes(atlas,2,split);
 for(const y of [5.213,5.36,5.42,5.6])assert.ok(planes.every(p=>p.distanceToPoint(new THREE.Vector3(2,y,10))>=0));
 assert.ok(planes.some(p=>p.distanceToPoint(new THREE.Vector3(2,3,10))<0));
 assert.equal(suggestedFloorSplit(atlas,[]),5.48);
 assert.equal(restoredFloorPreference({level:2,split:5.48},atlas).automatic,true);
 assert.equal(restoredFloorPreference({level:2,split:5.48,automatic:false},atlas).automatic,false);
 assert.equal(restoredFloorPreference({level:2,split:4.9},atlas).automatic,false);
});

test('each floor excludes the other floor, in world coordinates',()=>{
 for(const [level,inside,outside] of [[1,1,5],[2,5,1]]){
  const planes=floorPlanes(box,level,3);
  assert.ok(planes.every(p=>p.distanceToPoint(new THREE.Vector3(0,inside,0))>=0));
  assert.ok(planes.some(p=>p.distanceToPoint(new THREE.Vector3(0,outside,0))<0));
 }
 assert.deepEqual(floorPlanes(box,0,3),[]);
 assert.equal(box.min.y,-1);assert.equal(box.max.y,7);
});
test('plan range and default cut follow the selected floor and clamp old cuts',()=>{
 const lower=floorSlice(box,1,3),upper=floorSlice(box,2,3);
 assert.deepEqual(sectionRange(lower,'y',{floor:0,reset:true}),{min:-1,max:3,value:1.2});
 assert.deepEqual(sectionRange(upper,'y',{floor:3.2,reset:true}),{min:3,max:7,value:4.4});
 assert.equal(sectionRange(upper,'y',{cut:1}).value,3);
 assert.equal(sectionRange(lower,'y',{cut:6}).value,3);
 assert.equal(floorSlice(box,2,4).min.y,4);
});
test('drag undo/redo restores transforms; a new edit drops the redo branch',()=>{
 const h=createTransformHistory(),a=new THREE.Matrix4(),b=new THREE.Matrix4().makeTranslation(2,3,4),c=new THREE.Matrix4().makeRotationY(.5);
 h.record(a,b);h.record(b,c);
 assert.ok(h.undo(c).equals(b));assert.ok(h.undo(b).equals(a));assert.equal(h.canUndo,false);
 assert.ok(h.redo(a).equals(b));assert.ok(h.redo(b).equals(c));assert.equal(h.canRedo,false);
 h.undo(c);h.record(b,a);assert.equal(h.canRedo,false);assert.ok(h.undo(a).equals(b));
});
test('reset is undoable, no-op drags keep redo, and history snapshots are isolated',()=>{
 const h=createTransformHistory(),a=new THREE.Matrix4(),b=new THREE.Matrix4().makeTranslation(3,0,0);
 h.record(a,b);h.record(b,a);assert.ok(h.undo(a).equals(b));h.record(b,b);assert.equal(h.canRedo,true);
 b.elements[12]=9;assert.equal(h.redo(b).elements[12],0);
 h.clear();assert.equal(h.canUndo,false);assert.equal(h.canRedo,false);
});

test('follow ignores a retained inspection floor; other views restore it',()=>{
 for(const floor of [0,1,2]){
  assert.equal(visibleFloor('follow',floor),0);
  assert.deepEqual(floorPlanes(box,visibleFloor('follow',floor),3),[]);
  for(const mode of ['orbit','plan','elevation-x','walk'])assert.equal(visibleFloor(mode,floor),floor);
 }
});
