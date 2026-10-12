import test from 'node:test';
import assert from 'node:assert/strict';
import {labelRoom,labelInRoom} from '../src/layout-labels.mjs';
const rooms=[{id:'lab',floorY:5.6,triangles:[[[0,0],[4,0],[4,4]],[[0,0],[4,4],[0,4]]]},{id:'kitchen',floorY:5.5,triangles:[[[5,0],[8,0],[8,4]],[[5,0],[8,4],[5,4]]]}];
test('interior labels stay in the camera enclosure; overhead views retain the overview',()=>{
 const current=labelRoom(rooms,{x:2,y:7,z:2});assert.equal(current,'lab');
 assert.equal(labelInRoom({center:[2,6,2]},rooms,current),true);
 assert.equal(labelInRoom({center:[6,6,2]},rooms,current),false);
 assert.equal(labelRoom(rooms,{x:2,y:15,z:2}),null);
 assert.equal(labelRoom(rooms,{x:2,y:1.6,z:2}),null);
 assert.equal(labelInRoom({center:[6,6,2]},rooms,null),true);
});
