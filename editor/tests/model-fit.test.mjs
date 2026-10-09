import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {fitScale,modelBounds,boxFromModel} from '../src/model-fit.mjs';

test('a model fits inside a box: the tightest axis decides',()=>{
  assert.equal(fitScale([1,2,1],[.5,.5,.5]),2);assert.equal(fitScale([1,.5,1],[2,2,2]),.25);
});
test('model bounds in its own units',()=>{
  const m=new THREE.Mesh(new THREE.BoxGeometry(2,1,4));m.position.set(1,.5,0);const g=new THREE.Group();g.add(m);
  assert.deepEqual(modelBounds(g),{size:[2,1,4],center:[1,.5,0]});
  assert.throws(()=>modelBounds(new THREE.Group()),/no geometry/);
});
test('box from a placed model: its size at the scale, centred on the model, turned with it',()=>{
  // A 2 × 1 × 4 model whose centre is 1 m along its x from its pivot, placed at the origin turned 90° about y, scale 0.5.
  const b=boxFromModel({position:[0,0,0],rotation:[0,90,0],scale:.5},{size:[2,1,4],center:[1,.5,0]});
  assert.deepEqual(b.scale,[1,.5,2]);
  assert.ok(Math.abs(b.position[0])<1e-4&&Math.abs(b.position[1]-.25)<1e-4&&Math.abs(b.position[2]+.5)<1e-4,JSON.stringify(b.position));
  // A model placed about its own centre (pivot at the bounds' centre) keeps its position.
  assert.deepEqual(boxFromModel({position:[1,2,3],rotation:[10,20,30],scale:[1,2,3]},{size:[1,1,1],center:[.2,.3,.4],pivot:[.2,.3,.4]}).position,[1,2,3]);
});
