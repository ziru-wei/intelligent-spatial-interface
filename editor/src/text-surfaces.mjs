import * as THREE from 'three';
import {TEXT_VIEW,textViewMetrics,viewSizedWidth,footprintPoints,centeredPose} from './text-view.mjs';
import {frontOnly} from './layout-surfaces.mjs';
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
// Allow a small edge overhang, while keeping most of the panel on its support. overhang: {share (of the panel that must be on it),
// reach (m), reachShare (of the width): how far past the edge it may go, the smaller of the two} (an info answer: INFO_OVERHANG).
export const OVERHANG={share:.75,reach:.12,reachShare:.15},INFO_OVERHANG={share:.6,reach:.2,reachShare:.3};
export function surfaceSupports(target,pose,aspect,overhang=OVERHANG){
 const points=footprintPoints(pose,aspect,8,4),inside=points.map(p=>containsSurfacePoint(target,p));
 if(!containsSurfacePoint(target,pose.surfaceAnchor)||inside.filter(Boolean).length/inside.length<overhang.share)return false;
 const tolerance=Math.min(overhang.reach,pose.width*overhang.reachShare),triangle=new THREE.Triangle(),closest=new THREE.Vector3();
 return points.every((point,i)=>{
  if(inside[i])return true;
  const d=point.clone().sub(target.origin),p=new THREE.Vector3(d.dot(target.right),d.dot(target.up),0);
  if(!target.triangles)return Math.hypot(Math.max(0,Math.abs(p.x)-target.width/2),Math.max(0,Math.abs(p.y)-target.height/2))<=tolerance;
  for(let k=0;k<target.triangles.length;k+=3){const [a,b,c]=target.triangles.slice(k,k+3);triangle.set(new THREE.Vector3(a.x,a.y,0),new THREE.Vector3(b.x,b.y,0),new THREE.Vector3(c.x,c.y,0));triangle.closestPointToPoint(p,closest);if(closest.distanceTo(p)<=tolerance)return true;}
  return false;
 });
}
export const visibleFraction=values=>values.length?values.filter(Boolean).length/values.length:1;
// On a wall or cabinet side the person faces (relation B), text sits near eye level (a little below the eye).
export const EYE_LEVEL={weight:.8,below:.1};
// response.preferSurfaceId (an info answer: the surface the person relates to): its spots cost this much less.
const RELATION_BONUS=.5;
// response.overflow (an info answer): up to this share of the text may lie outside the recorded view (it reads fine a little cut off at
// the edge); no cost for it.
export const INFO_OVERFLOW=.25;
const eyeLevelCost=(contact,relation,eye)=>relation?.relation==='B'?EYE_LEVEL.weight*Math.abs(contact.y-(eye.y-EYE_LEVEL.below)):0;
// response.near = {point, max, avoid?}: only spots within max metres of a point (a thing carrying info, src/placement.mjs), nearer ones
// preferred; avoid(p) true for a point the text must not cover (the box itself).
const rectDistance=(target,point)=>{const d=point.clone().sub(target.origin);return Math.hypot(Math.max(0,Math.abs(d.dot(target.right))-target.width/2),Math.max(0,Math.abs(d.dot(target.up))-target.height/2),d.dot(target.n));};
// response.layouts = [{columns, aspect, textMetrics}]: the line lengths the text may be set in (src/agent.mjs LAYOUT_COLUMNS); every spot
// tries each, and the pose carries the chosen one (pose.layout). An answer already on a surface keeps its own (no reflow in view).
// Points over the ink rectangle of a pose (box: fractions of the panel, src/agent.mjs textMetrics.box; the whole panel without one).
function inkPoints(pose,aspect,box,cols=8,rows=4){box||={x0:0,x1:1,y0:0,y1:1};
  const h=pose.width*aspect,out=[];
  for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){const u=box.x0+(box.x1-box.x0)*i/cols,v=box.y0+(box.y1-box.y0)*j/rows;
    out.push(new THREE.Vector3((u-.5)*pose.width,(.5-v)*h+(pose.align==='bottom'?h/2:0),0).applyQuaternion(pose.quaternion).add(pose.position));}
  return out;
}
export async function staticTextPlacement(response,ctx,basis){
 const near=response.near;
 const targets=ctx.getStaticSurfaces?.()||[],camera=ctx.frameCamera(response.frame),eye=camera.position,viewport=ctx.viewport(),aspect=response.aspect||.45;
 const quality=await ctx.getSurfaceQuality?.(response.frame);
 const ray=new THREE.Raycaster(),candidates=[],previous=response.previousPose,stability=ctx.getSettings?.(response)?.stability??0;
 const relation=ctx.relationAt?.(response.frame)||null;
 let sliceStart=performance.now();
 // response.stats ({}): per surface, how many spots each check turned down (for inspection).
 const count=(target,why)=>{if(!response.stats)return;const c=response.stats[target.id]||={};c[why]=(c[why]||0)+1;};
 for(const target of targets){
  if(performance.now()-sliceStart>8){await new Promise(r=>setTimeout(r,0));sliceStart=performance.now();}
  if(target.kind==='ceiling'||response.onlySurfaceId&&target.id!==response.onlySurfaceId)continue;
  if(near&&rectDistance(target,near.point)>near.max)continue;
  const normal=target.n.clone(),toward=eye.clone().sub(target.origin);
  if(normal.dot(toward)<0){if(frontOnly(target))continue;normal.negate();}
  if(normal.dot(toward.clone().normalize())<.25)continue;
  const same=previous?.surfaceId===target.id;
  const centers=[target.origin];
  // Surface-local coverage, independent of where a few screen rays happen to hit.
  for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++){
   const p=target.origin.clone().addScaledVector(target.right,x*target.width/7).addScaledVector(target.up,y*target.height/7);
   if(containsSurfacePoint(target,p))centers.push(p);
  }
  // Near a box (response.near): also every 10 cm around it on this surface, so spots just clear of a large box (beside a poster) are
  // tried, not only where the coarse grid or the view's rays happen to land.
  if(near){const d=near.point.clone().sub(target.origin),c=target.origin.clone().addScaledVector(target.right,d.dot(target.right)).addScaledVector(target.up,d.dot(target.up)),M=near.max,S=.1;
    for(let y=-M;y<=M+1e-9;y+=S)for(let x=-M;x<=M+1e-9;x+=S){const p=c.clone().addScaledVector(target.right,x).addScaledVector(target.up,y);if(Math.hypot(x,y)<=M&&containsSurfacePoint(target,p))centers.push(p);}}
  if(same){centers.unshift(previous.surfaceAnchor);for(const x of [-.25,0,.25])for(const y of [-.25,0,.25])centers.push(previous.surfaceAnchor.clone().addScaledVector(target.right,x*previous.width).addScaledVector(target.up,y*previous.width));}
  for(const [x,y] of [[0,0],[-.4,0],[.4,0],[0,.4],[0,-.4],[-.4,-.4],[.4,-.4],[0,.55],[-.4,.55],[.4,.55],[0,.7],[-.4,.65],[.4,.65],[-.7,.2],[.7,.2],[.65,0],[.65,-.3],[-.65,-.3]]){
   ray.setFromCamera(new THREE.Vector2(x,y),camera);const p=ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal,target.origin),new THREE.Vector3());
   if(p&&containsSurfacePoint(target,p))centers.push(p);
  }
  for(const contact of centers){
   if(near&&contact.distanceTo(near.point)>near.max){count(target,'farFromBox');continue;}
   const lifted=contact.clone().addScaledVector(normal,.018);
   const b=basis(normal,camera.quaternion,lifted,camera.position,camera),q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(b.right,b.up,normal));
   const projected=contact.clone().project(camera);if(projected.z< -1||projected.z>1||Math.abs(projected.x)>1||Math.abs(projected.y)>1){count(target,'contactOutOfView');continue;}
   const position=contact.clone().addScaledVector(normal,.018);
   const layouts=response.layouts?.length&&!previous?.surfaceAnchor?response.layouts:[{columns:null,aspect,textMetrics:response.textMetrics}];
   for(const L of layouts){
   const aspect=L.aspect,textMetrics=L.textMetrics,wanted=viewSizedWidth(position,q,camera,viewport,textMetrics,aspect);
   // Readable anchors may move to cleaner space without renegotiating font size.
   const oldWidth=previous?.surfaceAnchor&&previous.width;
   const widths=response.lockWidth&&oldWidth?[oldWidth]:oldWidth
    ?[oldWidth,...[1,.85,.7,.55].map(s=>THREE.MathUtils.clamp(wanted*s,oldWidth*.85,oldWidth*1.15))]
    :[...new Set([...[1,.85,.7,.55,.45,.35,.25].filter(s=>s>=(response.minShrink??.55)-1e-9),response.minShrink??.55])].map(s=>wanted*s);   // minShrink: an info answer's floor (Behavior)
   for(const width of new Set(widths)){
    const scale=width/wanted;
    const pose={position,quaternion:q,width,align:'center',kind:'plane',surfaceAnchor:contact.clone(),normalLift:.018,surfaceId:target.id,source:target.source||'parametric-layout',...(target.source==='smoothed-scan'?{supportTarget:target}:{}),...(L.columns?{layout:L.columns}:{})};
    const footprint=footprintPoints(pose,aspect,8,4);
    // Not over the box: judged on the ink (textMetrics.box), not the panel's transparent padding.
    count(target,'tried');
    if(near?.avoid&&inkPoints(pose,aspect,textMetrics?.box).some(near.avoid)){count(target,'overBox');continue;}
    if(!surfaceSupports(target,pose,aspect,response.overhang)){count(target,'offSurface');continue;}
    const metrics=textViewMetrics(centeredPose(pose,aspect),camera,viewport,textMetrics);
    const outside=metrics.inView?0:1-metrics.inShare;if(outside>(response.overflow||0)){count(target,'textOutOfView');continue;}if(metrics.minPx<TEXT_VIEW.minPx*.9){count(target,'tooSmall');continue;}if(metrics.maxPx>TEXT_VIEW.maxPx*1.4){count(target,'tooLarge');continue;}
    // A nearer replacement surface must not magnify the same world width.
    if(response.sizeReference&&(metrics.maxPx>response.sizeReference.maxPx*1.15||metrics.minPx<response.sizeReference.minPx*.85))continue;
    pose.surfaceQuality=quality?.(pose,aspect);
    // Lines that look slanted on screen cost too, and so does text well above the eye (more than 10 cm, steeply: one has to look up
    // to read it) or well below it (more than 60 cm).
    const above=Math.max(0,position.y-eye.y-.1),below=Math.max(0,eye.y-.6-position.y);
    const a=pose.position.clone().project(camera),bq=pose.position.clone().addScaledVector(new THREE.Vector3(1,0,0).applyQuaternion(q),width/2).project(camera),tl=Math.abs(Math.atan2(bq.y-a.y,(bq.x-a.x)*viewport.width/viewport.height)),tilt=Math.min(tl,Math.PI-tl);
    candidates.push({pose,footprint,metrics,score:(oldWidth?4*Math.abs(Math.log(width/oldWidth)):0)+(near?3:2)*(pose.surfaceQuality?.cost||0)+1.2*tilt+6*above+1*below+.15*Math.abs(Math.log(scale))+Math.hypot(projected.x,projected.y)*.35+.03*eye.distanceTo(contact)+eyeLevelCost(contact,relation,eye)+(same?stability*contact.distanceTo(previous.surfaceAnchor)/Math.max(.1,previous.width):0)+(near?.6*contact.distanceTo(near.point):0)+(L.columns?.12*Math.abs(Math.log(L.columns/1024)):0)-(target.id===response.preferSurfaceId?RELATION_BONUS:0),aspect});
   }
   }
  }
 }
 candidates.sort((a,b)=>a.score-b.score);
 // Keep same-face priority; do not let many occluded low-clutter candidates
 // exhaust a shortlist before a visible clear part of the desk is checked.
 const sameSurface=stability>0?candidates.filter(c=>c.pose.surfaceId===previous?.surfaceId):[];
 const otherSurfaces=candidates.filter(c=>!sameSurface.includes(c));
 if(response.candidates){response._found=[];response._tried=0;}
 const perSurface=new Map();
 for(const {pose,footprint,metrics} of [...sameSurface,...otherSurfaces]){
  // Ranked by the caller: a few per surface, so other surfaces get a turn too.
  // Spots 20 cm apart at least; once the list is full, only a spot on the preferred surface, if it has none yet.
  if(response.candidates){const k=pose.surfaceId+'|'+Math.round(pose.surfaceAnchor.x*5)+','+Math.round(pose.surfaceAnchor.y*5)+','+Math.round(pose.surfaceAnchor.z*5);if(perSurface.has(k))continue;
    if(response._found.length>=response.candidates&&(pose.surfaceId!==response.preferSurfaceId||response._found.some(f=>f.surfaceId===pose.surfaceId)))continue;
    perSurface.set(k,1);}
  const visible=ctx.visible?visibleFraction(await ctx.visible(response.frame,footprint,{staticSurface:true})):1;
  if(visible<.8){count({id:pose.surfaceId},'hidden');continue;}
  const found={...pose,viewMetrics:{...metrics,points:undefined,visible}};   // pose.layout: the line length it was measured with
  // response.candidates = n: the n best visible spots (an array, best first; 40 tried, and the
  // preferred surface's best spot even past n, 80 tried), for the caller to rank.
  if(!response.candidates)return found;
  (response._found||=[]).push(found);
  const full=response._found.length>=response.candidates,preferDone=!response.preferSurfaceId||response._found.some(f=>f.surfaceId===response.preferSurfaceId);
  if(++response._tried>(full?80:40)||full&&preferDone)break;
 }
 return response.candidates?response._found:null;
}
