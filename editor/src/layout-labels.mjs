import {roomOf} from './layout-tree.mjs';

// A camera above the roof (plan/orbit overview) has no active enclosure.
export function labelRoom(rooms,position){
 const candidates=rooms.filter(r=>position.y>=(r.floorY??-Infinity)-.2&&position.y<=(r.ceilingY??(r.floorY??0)+3.2)+.15);
 return roomOf(candidates,[position.x,position.y,position.z]);
}
export function labelInRoom(box,rooms,current){
 if(!current)return true;
 return (box.room??roomOf(rooms,box.center))===current;
}
