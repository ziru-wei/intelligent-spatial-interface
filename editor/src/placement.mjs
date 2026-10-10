import * as THREE from 'three';
import {staticTextPlacement,visibleFraction,surfaceSupports} from './text-surfaces.mjs';
import {placementVisibility} from './placement-stability.mjs';
import {TEXT_VIEW,textViewMetrics,viewSizedWidth,footprintPoints,centeredPose} from './text-view.mjs';
// Where an agent response appears in the room: the pose of a text plane (local +Z = the side it is read from, +Y = text up) and its
// width in metres.
//
//   0. An answer the object mod carries (response.ego, src/ego.mjs) is a bubble on its main object, turned to the viewer: above it with
//      a line down to it, else on its side facing the viewer; while no spot on it is in the recorded view, the fallback of step 3 shows it.
//   1. A placed answer keeps its world anchor while it stays readable, visible, on its surface and uncluttered (a short grace period,
//      longer with Stability, rides out brief losses).
//   2. Otherwise it goes on the surface the person relates to at the response's frame (src/spatial-relations.mjs): A the desk top under
//      the gaze, B the wall face or tall cabinet side faced, D the floor, window, door or object looked at. On that layout face
//      (depth-corrected, src/layout-surfaces.mjs) src/text-surfaces.mjs picks the readable, supported, visible, uncluttered spot (near
//      eye level on a faced wall).
//   3. No relation, or its surface cannot hold readable text: the response still shows, as "When no surface fits" says: Floating, in
//      the room 1.25 m in front of the recorded view (here); Fixed (or Floating that does not fit the view), pinned in the view like
//      the question caption (src/agent.mjs, on an unreadable pose). It returns to a surface when one fits.
//
// ctx = {frames, frameCamera(i), viewport(), relationAt(i), getStaticSurfaces(), getSettings(response), getSurfaceQuality(i),
//        visible(i, points, {staticSurface}) -> booleans, egoTarget(id) -> {center, size, yaw}}. response.aspect: text height / width.
const UP=new THREE.Vector3(0,1,0);
export function projectedSurfaceBasis(normal,position,camera){
 camera.updateMatrixWorld(true);
 const M=new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),e=M.elements,p=new THREE.Vector4(position.x,position.y,position.z,1).applyMatrix4(M);
 const gradient=new THREE.Vector3(e[1]*p.w-e[3]*p.y,e[5]*p.w-e[7]*p.y,e[9]*p.w-e[11]*p.y);
 const n=normal.clone().normalize(),right=n.clone().cross(gradient).normalize();
 const dx=new THREE.Vector3(e[0]*p.w-e[3]*p.x,e[4]*p.w-e[7]*p.x,e[8]*p.w-e[11]*p.x);
 if(right.dot(dx)<0)right.negate();
 return {right,up:n.clone().cross(right).normalize()};
}
export function readableSurfaceBasis(normal,viewQuaternion,position,eye,camera){
 // Walls and box sides: text stands upright (up = gravity within the face), whatever the camera's pitch or roll.
 const v=normal.clone().normalize();
 if(Math.abs(v.y)<.7){const up=UP.clone().addScaledVector(v,-UP.dot(v)).normalize();return {up,right:up.clone().cross(v).normalize()};}
 if(camera&&position)return projectedSurfaceBasis(normal,position,camera);
 if(position&&eye){
  const n=normal.clone().normalize(),local=position.clone().sub(eye).applyQuaternion(viewQuaternion.clone().invert());
  // A tangent to constant projected y makes the baseline horizontal even with
  // camera roll and an off-centre perspective view, without leaving the plane.
  const constraint=new THREE.Vector3(0,local.z,-local.y).applyQuaternion(viewQuaternion),right=n.clone().cross(constraint);
  if(right.lengthSq()>1e-8){right.normalize();const screenRight=new THREE.Vector3(1,0,0).applyQuaternion(viewQuaternion);if(right.dot(screenRight)<0)right.negate();return {right,up:n.clone().cross(right).normalize()};}
 }
 const n=normal.clone().normalize(),cameraUp=Math.abs(n.y)<.7?UP.clone():new THREE.Vector3(0,1,0).applyQuaternion(viewQuaternion),cameraRight=new THREE.Vector3(1,0,0).applyQuaternion(viewQuaternion);
 let up=cameraUp.clone().addScaledVector(n,-cameraUp.dot(n));
 if(up.lengthSq()<1e-8){const right=cameraRight.clone().addScaledVector(n,-cameraRight.dot(n)).normalize();up=n.clone().cross(right);}
 up.normalize();const right=up.clone().cross(n).normalize();return {up,right};
}
// Legibility floor: the body text's x-height (about 24 px of the 1024 px-wide text texture) must subtend at least minXHeightDeg at
// the eye: 0.3° is about 8 px on a Quest 3 (~25 px per degree). Measured from the eye along the text's up axis, so a text lying on a
// desk, foreshortened, needs to be wider.
const unavailable=(eye,viewQ,reason)=>({position:eye.clone(),quaternion:viewQ,width:.1,align:'center',kind:'unavailable',unreadable:true,reason});
async function surfacePlacement(response,ctx){
 const camera=ctx.frameCamera(response.frame),viewport=ctx.viewport(),aspect=response.aspect||.45,eye=camera.position;
 const viewQ=camera.getWorldQuaternion(new THREE.Quaternion());
 // A world anchor survives noisy depth and small view changes. Only sustained
 // readability/visibility loss releases it; acquisition and retention differ.
 const previous=response.previousPose,state=response.anchorState||{},stability=ctx.getSettings?.(response)?.stability??0;
 let retained=null;
 const now=ctx.frames?.[response.frame]?.t??response.frame/30;
 if(state.lastTime!=null&&(now<state.lastTime||now-state.lastTime>1))state.badSince=null;
 state.lastTime=now;
 if(previous?.surfaceAnchor&&!previous.unreadable){
  const centered=centeredPose(previous,aspect),metrics=textViewMetrics(centered,camera,viewport,response.textMetrics);
  const view=placementVisibility(centered,camera);
  const visibility=ctx.visible?visibleFraction(await ctx.visible(response.frame,footprintPoints(previous,aspect,8,4),{staticSurface:previous.source==='parametric-layout'})):1;
  const layoutStillExists=!!previous.supportTarget||!previous.surfaceId||!ctx.getStaticSurfaces||ctx.getStaticSurfaces().some(t=>t.id===previous.surfaceId&&Math.abs(previous.surfaceAnchor.clone().sub(t.origin).dot(t.n))<.06&&surfaceSupports(t,previous,aspect));
  const quality=await ctx.getSurfaceQuality?.(response.frame),currentQuality=quality?.(previous,aspect);
  const crowded=currentQuality&&currentQuality.cost>1.25;
  const normal=new THREE.Vector3(0,0,1).applyQuaternion(previous.quaternion),desired=readableSurfaceBasis(normal,viewQ,previous.position,eye,camera);
  const oldUp=new THREE.Vector3(0,1,0).applyQuaternion(previous.quaternion),aligned=oldUp.angleTo(desired.up)<Math.PI/60;
  const readable=metrics.minPx>=TEXT_VIEW.minPx*.8&&metrics.maxPx<=TEXT_VIEW.maxPx*1.4&&view.coverage>=.8;
  if(readable&&visibility>=.8&&layoutStillExists)retained={...previous,reusedSurface:true};
  if(readable&&visibility>=.8&&layoutStillExists&&!crowded&&aligned){state.badSince=null;return {...previous,reusedSurface:true,viewMetrics:{...metrics,points:undefined,visible:visibility}};}
  state.badSince??=now;
  if(layoutStillExists&&now-state.badSince<Math.max(.8*stability,.8*(readable?0:1)))return {...previous,reusedSurface:true,anchorGrace:true};
 }
 // Revalidation above is cheap and runs every frame. Failed searches are bounded
 // by the caller; never reuse an uncertified pose while waiting for the next search.
 if(response.allowSearch===false)return retained||unavailable(eye,viewQ,'Awaiting surface search');
 response.onSearch?.();
 // Clutter relocation must not change the size of an already readable panel.
 response={...response,lockWidth:!!retained,sizeReference:retained?textViewMetrics(centeredPose(previous,aspect),camera,viewport,response.textMetrics):null};
 const relation=ctx.relationAt?.(response.frame)||null;
 if(!relation)return retained||unavailable(eye,viewQ,'No surface the person relates to');
 const pose=await staticTextPlacement({...response,onlySurfaceId:relation.surfaceId},ctx,readableSurfaceBasis);
 if(!pose)return retained||unavailable(eye,viewQ,`No readable spot on ${relation.surfaceId} (${relation.relation})`);
 state.badSince=null;return {...pose,relation:relation.relation,relationKind:relation.kind};
}
// An answer the objects carry (object mod): a bubble on its main object, upright and turned to the viewer, sized for the view like any
// answer. Best just above the object, with a line down to its top; when that is not in the recorded view (a tall object, a close one,
// the view cut off above it), the bubble comes down onto the object's side that faces the viewer, then sideways along it, wherever it
// fits in the view first. It stays put while it is in view and the viewer's direction to the object turns less than BUBBLE_TURN. When
// no spot on the object is in view, the fallback (Fixed / Floating) shows it until the object is back. ctx.egoTarget(id) → {center, size, yaw}.
const BUBBLE_GAP=.06,BUBBLE_TURN=THREE.MathUtils.degToRad(4);
function bubblePlacement(response,ctx){
  const t=ctx.egoTarget?.(response.ego.main);if(!t)return null;
  const camera=ctx.frameCamera(response.frame),viewport=ctx.viewport(),aspect=response.aspect||.45,eye=camera.position;
  const center=new THREE.Vector3(...t.center),top=center.clone().setY(t.center[1]+t.size[1]/2),yaw=Math.atan2(eye.x-center.x,eye.z-center.z);
  const quaternion=new THREE.Quaternion().setFromAxisAngle(UP,yaw),inView=pose=>textViewMetrics(centeredPose(pose,aspect),camera,viewport,response.textMetrics);
  const previous=response.previousPose;
  if(previous?.kind==='bubble'&&previous.objectId===response.ego.main&&previous.objectCenter&&center.distanceTo(new THREE.Vector3(...previous.objectCenter))<1e-4
    &&Math.abs(Math.atan2(Math.sin(yaw-previous.yaw),Math.cos(yaw-previous.yaw)))<BUBBLE_TURN){
    const m=inView(previous);if(m.inView)return {...previous,reusedSurface:true,viewMetrics:{...m,points:undefined}};
  }
  // The object's footprint seen from the eye: its half depth toward the viewer and half width across (yaw-rotated box).
  const a=THREE.MathUtils.degToRad(t.yaw||0),toEye=new THREE.Vector3(eye.x-center.x,0,eye.z-center.z).normalize(),across=new THREE.Vector3(toEye.z,0,-toEye.x);
  const half=dir=>Math.abs(dir.x*Math.cos(a)-dir.z*Math.sin(a))*t.size[0]/2+Math.abs(dir.x*Math.sin(a)+dir.z*Math.cos(a))*t.size[2]/2;
  const front=half(toEye)+.02,side=half(across);
  const candidates=[{at:top,above:true}];
  for(const k of [.25,.5,.75])candidates.push({at:center.clone().addScaledVector(toEye,front).setY(top.y-k*t.size[1])});
  for(const k of [-.5,.5,-1,1])candidates.push({at:center.clone().addScaledVector(toEye,front).addScaledVector(across,k*side).setY(top.y-.25*t.size[1])});
  for(const c of candidates){
    const width=viewSizedWidth(c.at,quaternion,camera,viewport,response.textMetrics,aspect),height=width*aspect;
    // Above: its lower edge just over the top. On the side: centred there, but never lower than the object's bottom.
    const position=c.above?c.at.clone().addScaledVector(UP,BUBBLE_GAP+height/2):c.at.clone().setY(Math.max(c.at.y,center.y-t.size[1]/2+height/2));
    const pose={position,quaternion,width,align:'center',kind:'bubble',anchor:c.above?top.toArray():null,yaw,objectId:response.ego.main,objectCenter:center.toArray()};
    const m=inView(pose);if(m.inView)return {...pose,viewMetrics:{...m,points:undefined}};
  }
  return unavailable(eye,camera.getWorldQuaternion(new THREE.Quaternion()),'No spot on the object is in view');
}
export async function place(response,ctx){
  const bubble=response.ego?.main?bubblePlacement(response,ctx):null;
  const surface=bubble||await surfacePlacement(response,ctx);
  if(!surface.unreadable||ctx.getSettings?.(response)?.fallback!=='floating')return surface;
  const camera=ctx.frameCamera(response.frame),viewport=ctx.viewport(),aspect=response.aspect||.45;
  const quaternion=camera.getWorldQuaternion(new THREE.Quaternion());
  const position=new THREE.Vector3(0,0,-1.25).applyMatrix4(camera.matrixWorld);
  const width=viewSizedWidth(position,quaternion,camera,viewport,response.textMetrics,aspect);
  const pose={position,quaternion,width,align:'center',kind:'view-fallback'};
  const metrics=textViewMetrics(centeredPose(pose,aspect),camera,viewport,response.textMetrics);
  // Do not replace an unavailable surface with an oversized or clipped panel.
  return metrics.readable?{...pose,viewMetrics:{...metrics,points:undefined},reason:surface.reason}:surface;
}
