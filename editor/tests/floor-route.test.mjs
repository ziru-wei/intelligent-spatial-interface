import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouter,along} from '../src/floor-route.mjs';

// Two rooms side by side (x 0–4 and 4–8, z 0–4) with a wall at x=4 and a door in it at z=3; a corridor (x 8–10) open to room B.
const sq=(x0,x1,z0,z1)=>({polygon:[[[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]]]});
const rooms=[{id:'a',floorY:0,...sq(0,4,0,4)},{id:'b',floorY:.1,...sq(4,8,0,4)},{id:'hall',floorY:.2,...sq(8,10,0,4)}];
const openings=[{id:'door',category:'Door',center:[4,1,3],size:[1,2.1,.1],yaw:90}];
const walls=[{id:'w',outline:[[4,0,0],[4,0,4],[4,2,4],[4,2,0]]}];

test('floor route: from one room into another only through the door; open where no wall stands', ()=>{
  const r=createRouter(rooms,openings,walls),p=r.route([1,1],[7,1]);
  assert.ok(p,'a route');
  // it bends to go through the door (z≈3 at x=4), never straight through the wall at z=1
  const atWall=p.findIndex((q,k)=>k&&(p[k-1][0]-4)*(q[0]-4)<=0);
  const [a,b]=[p[atWall-1],p[atWall]],z=a[1]+(b[1]-a[1])*(4-a[0])/(b[0]-a[0]);
  assert.ok(Math.abs(z-3)<=.5,`crosses x=4 at z=${z.toFixed(2)}`);
  // room b to the corridor: no wall, so a straight line
  assert.equal(r.route([5,1],[9,1]).length,2);
  // floor height follows the room
  assert.equal(p[0][2],0);assert.equal(p.at(-1)[2],.1);
  // without the door there is no way through
  assert.equal(createRouter(rooms,[],walls).route([1,1],[7,1]),null);
});

test('floor route: chevrons spaced along the route, skipping the first step', ()=>{
  const pts=along([[0,0,0],[0,2,0],[2,2,0]],{spacing:.5,skip:.5});
  assert.equal(pts.length,8);   // at 0.5, 1, … 4 m
  assert.deepEqual(pts[0].slice(0,2),[0,.5]);
  assert.ok(Math.abs(pts.at(-1)[3]-Math.PI/2)<1e-9);   // the last ones point along +x
});
