import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCueSet} from '../src/spatial-ui/cue-set.mjs';

test('a cue set keeps what is the same, gives new data in place, makes again only what changed, removes what went', ()=>{
  const parent=new THREE.Group(),set=createCueSet(parent),made=[];
  const cue=(name,takes=false)=>p=>{made.push(name);const part={group:new THREE.Group(),props:p,update(){}};if(takes)part.set=q=>{part.props=q;return true;};return part;};
  set.update([{key:'a',props:{v:1},make:cue('a')},{key:'b',props:{v:1},make:cue('b',true)},{key:'c',props:{v:1},make:cue('c')}]);
  assert.deepEqual(made,['a','b','c']);assert.equal(parent.children.length,3);
  const b=set.get('b');
  assert.deepEqual(set.update([{key:'a',props:{v:1},make:cue('a')},{key:'b',props:{v:2},make:cue('b',true)},{key:'c',props:{v:2},make:cue('c')}]),['c']);
  assert.deepEqual(made,['a','b','c','c']);                          // a kept; b took its new data in place; c made again
  assert.equal(set.get('b'),b);assert.deepEqual(b.props,{v:2});
  set.update([{key:'c',props:{v:2},make:cue('c')}]);
  assert.equal(parent.children.length,1);assert.deepEqual(set.parts.map(p=>p.props),[{v:2}]);   // a and b removed
  set.clear();assert.equal(parent.children.length,0);
});
