import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {keepInView,viewAnchor,STACK} from '../src/cluster-placement.mjs';

// a stack of parts of given world heights, placed like the editor's (each just above the last, at its one size)
const camera=new THREE.PerspectiveCamera(60,16/9,.01,100);camera.position.set(1,1.6,2);camera.lookAt(0,1.2,0);camera.updateMatrixWorld(true);
const stack=heights=>bottom=>{let top=bottom;for(const h of heights){const a=viewAnchor(camera,(top??STACK.base)+STACK.gap);top=a.top(h);}return top;};

test('a stack that fits stands on its base', ()=>{
  const place=stack([.1]);assert.equal(keepInView(-.5,place),place(-.5));assert.ok(place(-.5)<STACK.top);
});

test('a stack that would leave the view is lowered until its top is the view\'s top; its parts keep their size', ()=>{
  const place=stack([.3,.4]),high=place(.2);assert.ok(high>STACK.top);
  const top=keepInView(.2,place);assert.ok(Math.abs(top-STACK.top)<1e-6,top);
  assert.ok(Math.abs((high-.2)-(top-(.2-(high-STACK.top))))<1e-6);   // the same height, lower
});
