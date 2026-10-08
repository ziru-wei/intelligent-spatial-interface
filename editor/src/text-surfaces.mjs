import * as THREE from 'three';
import {TEXT_VIEW,textViewMetrics,viewSizedWidth,footprintPoints,centeredPose} from './text-view.mjs';
// Parametric room/furniture polygons are stable across recording frames. Respect
// their actual triangles (including window/door holes), not just bounding boxes.
export function containsSurfacePoint(target,point){
 const d=point.clone().sub(target.origin),x=d.dot(target.right),y=d.dot(target.up),p=new THREE.Vector2(x,y);
 if(!target.triangles)return Math.abs(x)<=target.width/2&&Math.abs(y)<=target.height/2;
 const cross=(a,b)=> (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
 for(let i=0;i<target.triangles.length;i+=3){const [a,b,c]=target.triangles.slice(i,i+3),u=cross(a,b),v=cross(b,c),w=cross(c,a);
  if(Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))>1e-10&&((u>=-1e-8&&v>=-1e-8&&w>=-1e-8)||(u<=1e-8&&v<=1e-8&&w<=1e-8)))return true;
 }return false;
}
// Allow a small edge overhang, while keeping most of the panel on its support.
export function surfaceSupports(target,pose,aspect){
 const points=footprintPoints(pose,aspect,8,4),inside=points.map(p=>containsSurfacePoint(target,p));
 if(!containsSurfacePoint(target,pose.surfaceAnchor)||inside.filter(Boolean).length/inside.length<.75)return false;
 const tolerance=Math.min(.12,pose.width*.15),triangle=new THREE.Triangle(),closest=new THREE.Vector3();
 return points.every((point,i)=>{
  if(inside[i])return true;
  const d=point.clone().sub(target.origin),p=new THREE.Vector3(d.dot(target.right),d.dot(target.up),0);
  if(!target.triangles)return Math.hypot(Math.max(0,Math.abs(p.x)-target.width/2),Math.max(0,Math.abs(p.y)-target.height/2))<=tolerance;
  for(let k=0;k<target.triangles.length;k+=3){const [a,b,c]=target.triangles.slice(k,k+3);triangle.set(new THREE.Vector3(a.x,a.y,0),new THREE.Vector3(b.x,b.y,0),new THREE.Vector3(c.x,c.y,0));triangle.closestPointToPoint(p,closest);if(closest.distanceTo(p)<=tolerance)return true;}
  return false;
 });
}
export const visibleFraction=values=>values.length?values.filter(Boolean).length/values.length:1;
export async function staticTextPlacement(response,ctx,basis){
 const targets=ctx.getStaticSurfaces?.()||[],camera=ctx.frameCamera(response.frame),eye=camera.position,viewport=ctx.viewport(),aspect=response.aspect||.45;
 const quality=await ctx.getSurfaceQuality?.(response.frame);
 const ray=new THREE.Raycaster(),candidates=[],previous=response.previousPose,stability=ctx.getSettings?.(response)?.stability??0;
 let sliceStart=performance.now();
 for(const target of targets){
  if(performance.now()-sliceStart>8){await new Promise(r=>setTimeout(r,0));sliceStart=performance.now();}
  if(target.kind==='ceiling'||response.onlySurfaceId&&target.id!==response.onlySurfaceId)continue;
  const normal=target.n.clone(),toward=eye.clone().sub(target.origin);
  if(normal.dot(toward)<0){if(target.surface==='box'||target.surface==='floor')continue;normal.negate();}
  if(normal.dot(toward.clone().normalize())<.25)continue;
  const same=previous?.surfaceId===target.id;
  const centers=[target.origin];
  // Surface-local coverage, independent of where a few screen rays happen to hit.
  for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++){
   const p=target.origin.clone().addScaledVector(target.right,x*target.width/7).addScaledVector(target.up,y*target.height/7);
   if(containsSurfacePoint(target,p))centers.push(p);
  }
  if(same){centers.unshift(previous.surfaceAnchor);for(const x of [-.25,0,.25])for(const y of [-.25,0,.25])centers.push(previous.surfaceAnchor.clone().addScaledVector(target.right,x*previous.width).addScaledVector(target.up,y*previous.width));}
  for(const [x,y] of [[0,0],[-.4,0],[.4,0],[0,.4],[0,-.4],[-.4,-.4],[.4,-.4],[0,.55],[-.4,.55],[.4,.55],[0,.7],[-.4,.65],[.4,.65],[-.7,.2],[.7,.2],[.65,0],[.65,-.3],[-.65,-.3]]){
   ray.setFromCamera(new THREE.Vector2(x,y),camera);const p=ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal,target.origin),new THREE.Vector3());
   if(p&&containsSurfacePoint(target,p))centers.push(p);
  }
  for(const contact of centers){
   const lifted=contact.clone().addScaledVector(normal,.018);
   const b=basis(normal,camera.quaternion,lifted,camera.position,camera),q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(b.right,b.up,normal));
   const projected=contact.clone().project(camera);if(projected.z< -1||projected.z>1||Math.abs(projected.x)>1||Math.abs(projected.y)>1)continue;
   const position=contact.clone().addScaledVector(normal,.018),wanted=viewSizedWidth(position,q,camera,viewport,response.textMetrics,aspect);
   // Readable anchors may move to cleaner space without renegotiating font size.
   const oldWidth=previous?.surfaceAnchor&&previous.width;
   const widths=response.lockWidth&&oldWidth?[oldWidth]:oldWidth
    ?[oldWidth,...[1,.85,.7,.55].map(s=>THREE.MathUtils.clamp(wanted*s,oldWidth*.85,oldWidth*1.15))]
    :[1,.85,.7,.55].map(s=>wanted*s);
   for(const width of new Set(widths)){
    const scale=width/wanted;
    const pose={position,quaternion:q,width,align:'center',kind:'plane',surfaceAnchor:contact.clone(),normalLift:.018,surfaceId:target.id,source:target.source||'parametric-layout',...(target.source==='smoothed-scan'?{supportTarget:target}:{})};
    const footprint=footprintPoints(pose,aspect,8,4);
    if(!surfaceSupports(target,pose,aspect))continue;
    const metrics=textViewMetrics(centeredPose(pose,aspect),camera,viewport,response.textMetrics);if(!metrics.inView||metrics.minPx<TEXT_VIEW.minPx*.9||metrics.maxPx>TEXT_VIEW.maxPx*1.4)continue;
    // A nearer replacement surface must not magnify the same world width.
    if(response.sizeReference&&(metrics.maxPx>response.sizeReference.maxPx*1.15||metrics.minPx<response.sizeReference.minPx*.85))continue;
    pose.surfaceQuality=quality?.(pose,aspect);
    candidates.push({pose,footprint,metrics,score:(oldWidth?4*Math.abs(Math.log(width/oldWidth)):0)+2*(pose.surfaceQuality?.cost||0)+.15*Math.abs(Math.log(scale))+Math.hypot(projected.x,projected.y)*.35+.03*eye.distanceTo(contact)-(target.surface==='box'&&normal.y>.7?.6:0)+(same?stability*contact.distanceTo(previous.surfaceAnchor)/Math.max(.1,previous.width):0)});
   }
  }
 }
 candidates.sort((a,b)=>a.score-b.score);
 // Keep same-face priority; do not let many occluded low-clutter candidates
 // exhaust a shortlist before a visible clear part of the desk is checked.
 const sameSurface=stability>0?candidates.filter(c=>c.pose.surfaceId===previous?.surfaceId):[];
 const otherSurfaces=candidates.filter(c=>!sameSurface.includes(c));
 for(const {pose,footprint,metrics} of [...sameSurface,...otherSurfaces]){
  const visible=ctx.visible?visibleFraction(await ctx.visible(response.frame,footprint,{staticSurface:true})):1;
  if(visible>=.8)return {...pose,viewMetrics:{...metrics,points:undefined,visible}};
 }
 return null;
}
