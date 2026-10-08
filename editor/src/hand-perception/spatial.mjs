import * as THREE from 'three';

/** Reusable scene-space hand points, measured from THIS frame's LiDAR + RGB mask.
 * MediaPipe worldLandmarks are hand-relative and cannot locate a hand in the room.
 * depth = {data: Float32Array in metres, width, height}, top-left origin.
 * camera.matrixWorld must be the recorded pose already transformed into scene space.
 */
export function locateHands({perception,depth,camera,intrinsics}){
 if(perception?.status!=='ready')return {status:'unavailable',hands:[]};
 if(!depth)return {status:'no-depth',hands:[]};
 if(!perception.landmarks?.length)return {status:'no-hands',hands:[]};
 const {width:w,height:h,data}=depth,k=intrinsics;
 camera.updateMatrixWorld(true);
 const onHand=(u,v)=>u>=0&&u<1&&v>=0&&v<1&&perception.mask[Math.floor(v*perception.height)*perception.width+Math.floor(u*perception.width)]>127;
 const hands=perception.landmarks.map((landmarks,index)=>{
  const samples=[];
  for(let joint=0;joint<landmarks.length;joint++){
   const {x:u,y:v}=landmarks[joint];if(!onHand(u,v))continue;
   const x=Math.floor(u*w),y=Math.floor(v*h),values=[];
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const px=x+dx,py=y+dy;
    if(px<0||px>=w||py<0||py>=h||!onHand((px+.5)/w,(py+.5)/h))continue;
    const z=data[py*w+px];if(Number.isFinite(z)&&z>.05&&z<10)values.push(z);
   }
   if(values.length<3)continue;values.sort((a,b)=>a-b);
   samples.push({joint,u,v,z:values[Math.floor(values.length/2)]});
  }
  // Reject isolated background depths at silhouette edges; anchor the cluster to palm joints.
  const palm=samples.filter(s=>[0,5,9,13,17].includes(s.joint)).map(s=>s.z).sort((a,b)=>a-b);
  if(palm.length<2)return {index,points:[]};
  const median=palm[Math.floor(palm.length/2)];
  const points=samples.filter(s=>Math.abs(s.z-median)<.2).map(s=>({joint:s.joint,position:new THREE.Vector3((s.u*k.width-k.cx)/k.fx*s.z,-(s.v*k.height-k.cy)/k.fy*s.z,-s.z).applyMatrix4(camera.matrixWorld).toArray()}));
  return {index,points};
 }).filter(h=>h.points.length>=3);
 return {key:perception.key,status:hands.length?'ready':'no-valid-depth',source:'recording-lidar',hands};
}

/** Euclidean distance to a yaw-rotated container surface (zero inside). */
export function handBoxDistance(spatial,target){
 if(spatial?.status!=='ready'||!target)return null;
 const inverse=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-THREE.MathUtils.degToRad(target.yaw||0));
 let distance=Infinity;
 for(const hand of spatial.hands)for(const {position} of hand.points){
  const p=new THREE.Vector3(...position).sub(new THREE.Vector3(...target.center)).applyQuaternion(inverse);
  distance=Math.min(distance,Math.hypot(...p.toArray().map((v,i)=>Math.max(0,Math.abs(v)-target.size[i]/2))));
 }
 return Number.isFinite(distance)?distance:null;
}
