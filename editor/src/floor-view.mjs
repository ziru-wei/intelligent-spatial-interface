import * as THREE from 'three';

export function suggestedFloorSplit(box,rooms=[]){
 const upper=rooms.filter(r=>Number(r.floor)===2&&Number.isFinite(r.floorY)).map(r=>r.floorY);
 // The boundary belongs below the slab, not at the average height of the building.
 return upper.length?THREE.MathUtils.clamp(Math.min(...upper)-.2,box.min.y+.01,box.max.y-.01):(box.min.y+box.max.y)/2;
}
export function restoredFloorPreference(saved,box){
 if(!saved)return null;
 const oldDefault=(box.min.y+box.max.y)/2;
 const automatic=saved.automatic??(!Number.isFinite(saved.split)||Math.abs(saved.split-oldDefault)<.05);
 return {...saved,automatic};
}

export function floorSlice(box,level,split){
 const out=box.clone();
 if(level===1)out.max.y=split;
 if(level===2)out.min.y=split;
 return out;
}
export function floorPlanes(box,level,split){
 if(!level)return [];
 const band=floorSlice(box,level,split);
 return [new THREE.Plane(new THREE.Vector3(0,1,0),-band.min.y+.01),new THREE.Plane(new THREE.Vector3(0,-1,0),band.max.y+.01)];
}
export function sectionRange(box,axis,{floor,cut,reset=false}={}){
 const flat=box.max[axis]-box.min[axis]<.5,min=box.min[axis]-(flat?1:0),max=box.max[axis]+(flat?1:0);
 const initial=axis==='y'?Math.min(max,(floor??box.min.y)+1.2):(min+max)/2;
 return {min,max,value:THREE.MathUtils.clamp(reset||!Number.isFinite(cut)?initial:cut,min,max)};
}

// A recorded camera can cross floors; manual inspection must never clip its view.
export function visibleFloor(mode,selected){return mode==='follow'?0:selected;}
