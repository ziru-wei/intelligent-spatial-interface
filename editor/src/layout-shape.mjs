import * as THREE from 'three';

// Optional normalized footprint; center/size/yaw remain the editable transform.
export function footprint(box){
  if(box.shape?.type==='prism')return box.shape.footprint.map(p=>[...p]);
  if(box.shape?.type==='cylinder')return Array.from({length:64},(_,i)=>[.5*Math.cos(i*Math.PI/32),.5*Math.sin(i*Math.PI/32)]);
  return [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
}
export function layoutGeometry(box){
  if(!box.shape)return new THREE.BoxGeometry(1,1,1);
  const ring=footprint(box),shape=new THREE.Shape(ring.map(([x,z])=>new THREE.Vector2(x,-z)));
  if(box.shape.surfaceOnly)return new THREE.ShapeGeometry(shape).rotateX(-Math.PI/2).translate(0,.5,0);
  return new THREE.ExtrudeGeometry(shape,{depth:1,steps:1,bevelEnabled:false}).translate(0,0,-.5).rotateX(-Math.PI/2);
}
// True furniture surfaces for placement: an L's missing corner and the area outside
// a circular tabletop must never become rectangular placement targets.
export function shapedFaces(box){
  const ring=footprint(box),faces=[{name:'top',normal:[0,1,0],points:ring.map(([x,z])=>[x,.5,z])}];
  if(box.shape?.surfaceOnly)return faces;
  faces.push({name:'bottom',normal:[0,-1,0],points:ring.map(([x,z])=>[x,-.5,z])});
  const area=ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p[0]*q[1]-q[0]*p[1];},0),sign=Math.sign(area)||1;
  ring.forEach(([x,z],i)=>{const [xx,zz]=ring[(i+1)%ring.length],dx=(xx-x)*box.size[0],dz=(zz-z)*box.size[2];
    faces.push({name:`side-${i}`,normal:[sign*dz,0,-sign*dx],points:[[x,-.5,z],[xx,-.5,zz],[xx,.5,zz],[x,.5,z]]});});
  return faces;
}
export const shapeData=box=>box.shape?{shape:structuredClone(box.shape)}:{};
