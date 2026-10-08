import * as THREE from 'three';
// CSS pixels in the recorded-video canvas, not source-image pixels or the inspection camera.
export const TEXT_VIEW={minPx:2.8,targetPx:4.8,maxPx:8,margin:.04};
export function textViewMetrics(pose,camera,viewport,metrics={}){
 const ratio=metrics.xHeightRatio||24/1024,aspect=pose.height/pose.width,box=metrics.box||{x0:.06,x1:.94,y0:.06,y1:.94};
 const local=(u,v)=>{const x=(u-.5)*pose.width,y=(.5-v)*pose.height;return new THREE.Vector3(x,y,pose.surface?.(x,y)||0).applyQuaternion(pose.quaternion).add(pose.position);};
 const points=[],sizes=[];
 for(const u of [box.x0,(box.x0+box.x1)/2,box.x1])for(const v of [box.y0,(box.y0+box.y1)/2,box.y1]){
  const p=local(u,v),q=local(u,v-ratio/aspect),a=p.clone().project(camera),b=q.project(camera);
  points.push(p);sizes.push(Math.hypot((b.x-a.x)*viewport.width/2,(b.y-a.y)*viewport.height/2));
 }
 const ndc=points.map(p=>p.clone().project(camera)),m=1-TEXT_VIEW.margin;
 const inView=ndc.every(p=>Math.abs(p.x)<=m&&Math.abs(p.y)<=m&&p.z>-1&&p.z<1);
 const minPx=Math.min(...sizes),maxPx=Math.max(...sizes);
 return {minPx,maxPx,inView,readable:inView&&minPx>=TEXT_VIEW.minPx&&maxPx<=TEXT_VIEW.maxPx,points};
}
export function viewSizedWidth(position,quaternion,camera,viewport,metrics,aspect=.4){
 const sample=textViewMetrics({position,quaternion,width:.1,height:.1*aspect},camera,viewport,metrics);
 return .1*TEXT_VIEW.targetPx/Math.max(.01,sample.minPx);
}
// Validate the whole response footprint against current-frame visibility (including its controls).
export function footprintPoints(pose,aspect,columns=16,rows=8){
 const pts=[],height=pose.width*aspect,shift=pose.align==='bottom'?height/2:0;
 for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
  const px=(x/columns-.5)*pose.width,py=(y/rows-.5)*height+shift;
  pts.push(new THREE.Vector3(px,py,pose.surface?.(px,py)||0).applyQuaternion(pose.quaternion).add(pose.position));
 }
 return pts;
}
export const centeredPose=(pose,aspect)=>({...pose,position:pose.position.clone().add(new THREE.Vector3(0,pose.align==='bottom'?pose.width*aspect/2:0,0).applyQuaternion(pose.quaternion)),height:pose.width*aspect});
