import * as THREE from 'three';
import {staticTextPlacement,visibleFraction,surfaceSupports,INFO_OVERFLOW,INFO_OVERHANG} from './text-surfaces.mjs';
import {placementVisibility} from './placement-stability.mjs';
import {TEXT_VIEW,textViewMetrics,viewSizedWidth,footprintPoints,centeredPose} from './text-view.mjs';
// Where an agent response appears in the room: the pose of a text plane (local +Z = the side it is read from, +Y = text up) and its
// width in metres.
//
//   I. An answer about a thing carrying info (response.info, scripts/info_context.py; ctx.infoTarget(response) → its box): on a surface
//      near the box (within INFO_NEAR) where the spot scores well (infoSpotScore at least INFO_SETTLE: close to the box, facing the way
//      its face toward the viewer does, on a clean background) it settles and stays there, whatever the viewer does next. Until such a spot shows up it floats next to the box, near eye height, where it is most visible
//      from the viewer at that moment, and stays there too (world-fixed: it never follows the viewer).
//   0. An answer the object mod carries (response.ego, src/ego.mjs) is a speech bubble on its main object, turned to the viewer: above
//      it with its tail down to it, else on its side facing the viewer; while no spot on it is in the recorded view, it is held at the
//      edge of the view on the object's side, its tail pointing toward the object (the fallback of step 3 only if even that cannot fit).
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
// An answer the objects carry (object mod): a speech bubble on its main object, upright and turned to the viewer, sized for the view
// like any answer, its tail's tip at pose.tail (world). Best just above the object, the tail down to its top; when that is not in the
// recorded view (a tall object, a close one, the view cut off above it), the bubble comes down onto the object's side that faces the
// viewer, then sideways along it, wherever it fits in the view first (wholly in view). Once placed it stays put while the viewer moves,
// as long as at least BUBBLE_KEEP_IN_VIEW of it is in view and the viewer's direction to the object turns less than BUBBLE_TURN, more
// with Placement stability (up to BUBBLE_TURN_STABLE at 1); past that, it still stays for a grace period (.8 s × stability) before it
// is placed again. When no spot on the object is in view: edgeBubble. ctx.egoTarget(id) → {center, size, yaw}.
const BUBBLE_GAP=.06,BUBBLE_TURN=THREE.MathUtils.degToRad(4),BUBBLE_TURN_STABLE=THREE.MathUtils.degToRad(30),BUBBLE_KEEP_IN_VIEW=.5,BUBBLE_TAIL=.6;
// Held in the view (pose.edge, placed again every frame): BUBBLE_EDGE_DEPTH in front of the recorded camera, the whole bubble and its
// tail (BUBBLE_TAIL of its height long) inside the view's margin. An object in front whose spot on the screen is in the view: just above
// that spot, as close as fits, the tail reaching it if it can. Otherwise (off screen, behind): as far toward it as fits, from the view's
// centre, the tail pointing toward it. Smaller than view-sized when it would not fit otherwise.
// Once the bubble was shown (response.previousPose), it moves as little as it can instead: from where it was (seen from the view now),
// just into the allowed area. Either way, among spots near that one it takes the one that covers the least of the other things in the
// room seen there, and whose tail does not point at one of them (ctx.sceneBoxes: objects and furniture; not the one it speaks for,
// nor any filling much of the view).
const BUBBLE_ORDER=.15;   // what each later spot in a bubble's order of preference (above, then the side) costs
const BUBBLE_EDGE_DEPTH=1.2,BUBBLE_COVER=3,BUBBLE_POINT_DEG=THREE.MathUtils.degToRad(12);   // BUBBLE_COVER: what covering a whole bubble's area of other things costs, in bubble widths moved
function edgeBubble(response,ctx,target,base){
  const camera=ctx.frameCamera(response.frame),viewport=ctx.viewport(),aspect=response.aspect||.45;
  camera.updateMatrixWorld(true);
  const quaternion=camera.getWorldQuaternion(new THREE.Quaternion()),D=BUBBLE_EDGE_DEPTH;
  // The view's extent at depth D (camera space; works for an off-centre projection too).
  const corner=(x,y)=>{const p=new THREE.Vector3(x,y,.5).applyMatrix4(camera.projectionMatrixInverse);return p.multiplyScalar(D/-p.z);};
  const lo=corner(-1,-1),hi=corner(1,1),m=1-TEXT_VIEW.margin,cx=(lo.x+hi.x)/2,cy=(lo.y+hi.y)/2,hx=(hi.x-lo.x)/2*m,hy=(hi.y-lo.y)/2*m;
  const ahead=new THREE.Vector3(cx,cy,-D).applyMatrix4(camera.matrixWorld);
  // Sized for the view, but smaller when that would not fit the view with its tail (a small viewport).
  const width=Math.min(viewSizedWidth(ahead,quaternion,camera,viewport,response.textMetrics,aspect),.98*hx/(.5+BUBBLE_TAIL*aspect),.98*hy/(aspect*(.5+BUBBLE_TAIL)));
  const height=width*aspect,tail=BUBBLE_TAIL*height;
  // Where the bubble's centre may go so that it and its tail stay in the view.
  const rx=hx-width/2-tail,ry=hy-height/2-tail;if(!(rx>=0&&ry>=0)||!(width>0))return null;
  const tip=new THREE.Vector3(...target).applyMatrix4(camera.matrixWorldInverse);
  const onPlane=v=>v.z<-.05?new THREE.Vector2(v.x*D/-v.z,v.y*D/-v.z):null;
  const onScreen=onPlane(tip);
  const clampIn=v=>new THREE.Vector2(THREE.MathUtils.clamp(v.x,cx-rx,cx+rx),THREE.MathUtils.clamp(v.y,cy-ry,cy+ry));
  const prev=response.previousPose?.kind==='bubble'&&response.previousPose.objectId===base.objectId?onPlane((response.previousPose.position.isVector3?response.previousPose.position.clone():new THREE.Vector3(...response.previousPose.position)).applyMatrix4(camera.matrixWorldInverse)):null;
  let c;
  if(prev)c=clampIn(prev);
  else if(onScreen&&Math.abs(onScreen.x-cx)<=hx&&Math.abs(onScreen.y-cy)<=hy)
    c=new THREE.Vector2(THREE.MathUtils.clamp(onScreen.x,cx-rx,cx+rx),THREE.MathUtils.clamp(onScreen.y+height/2+tail,cy-ry,cy+ry));
  else{
    // Toward the object on the screen: its projection when in front, else (behind the viewer) the side it is on.
    const dir=onScreen?onScreen.clone().sub(new THREE.Vector2(cx,cy)):new THREE.Vector2(tip.x,tip.y);
    if(dir.lengthSq()<1e-9)dir.set(0,-1);dir.normalize();
    const k=Math.min(Math.abs(dir.x)>1e-9?rx/Math.abs(dir.x):Infinity,Math.abs(dir.y)>1e-9?ry/Math.abs(dir.y):Infinity);
    c=new THREE.Vector2(cx,cy).addScaledVector(dir,k);
  }
  // Not over other things: spots around c (within a bubble's size), each costing how far it moves plus how much it covers.
  const others=(ctx.sceneBoxes?.()||[]).filter(b=>b.id!==base.objectId).map(b=>{
    const q=new THREE.Quaternion().setFromAxisAngle(UP,THREE.MathUtils.degToRad(b.yaw||0)),pts=[];
    for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){const p=onPlane(new THREE.Vector3(x*b.size[0]/2,y*b.size[1]/2,z*b.size[2]/2).applyQuaternion(q).add(new THREE.Vector3(...b.center)).applyMatrix4(camera.matrixWorldInverse));if(p)pts.push(p);}
    if(pts.length<8)return null;const r={x0:Math.min(...pts.map(p=>p.x)),x1:Math.max(...pts.map(p=>p.x)),y0:Math.min(...pts.map(p=>p.y)),y1:Math.max(...pts.map(p=>p.y))};
    return (r.x1-r.x0)*(r.y1-r.y0)>.4*(4*hx*hy)?null:r;}).filter(Boolean);
  // The tail from a bubble centred at p: its tip the object's spot when near enough, else `tail` beyond the bubble's edge toward it;
  // also where it leaves the bubble (base), for judging what it crosses.
  const tailFrom=p=>{const toward=(onScreen||new THREE.Vector2(tip.x,tip.y).multiplyScalar(1e6)).clone().sub(p),far=toward.length();toward.normalize();
    const edge=Math.min(Math.abs(toward.x)>1e-9?width/2/Math.abs(toward.x):Infinity,Math.abs(toward.y)>1e-9?height/2/Math.abs(toward.y):Infinity);
    const reach=onScreen&&far<=edge+2*tail?far:edge+tail;return {base:p.clone().addScaledVector(toward,edge),apex:p.clone().addScaledVector(toward,reach)};};
  if(others.length){
    // Covered: the share of the bubble's area over other things, plus 1 when its tail points at another thing, even roughly: the line
    // from the tail's tip onward (to the object it speaks for when that is on the screen, else to the edge of the view) passes near one. A tail
    // pointing at something else reads as that thing speaking.
    const pointsElsewhere=t=>{const dir=t.apex.clone().sub(t.base);if(dir.lengthSq()<1e-12)return 0;dir.normalize();
      const end=onScreen&&Math.abs(onScreen.x-cx)<=hx&&Math.abs(onScreen.y-cy)<=hy?onScreen.distanceTo(t.apex):Math.min(Math.abs(dir.x)>1e-9?((dir.x>0?cx+hx:cx-hx)-t.apex.x)/dir.x:Infinity,Math.abs(dir.y)>1e-9?((dir.y>0?cy+hy:cy-hy)-t.apex.y)/dir.y:Infinity);
      return pointsAtOther(others,t.base,t.apex,end,.15*height);};
    const covered=p=>others.reduce((a,r)=>a+Math.max(0,Math.min(r.x1,p.x+width/2)-Math.max(r.x0,p.x-width/2))*Math.max(0,Math.min(r.y1,p.y+height/2)-Math.max(r.y0,p.y-height/2)),0)/(width*height)+pointsElsewhere(tailFrom(p));
    let best=c,bestCost=BUBBLE_COVER*covered(c);
    for(const fx of [-1,-.5,0,.5,1])for(const fy of [-1,-.5,0,.5,1]){const p=clampIn(new THREE.Vector2(c.x+fx*width,c.y+fy*height*1.5));const cost=p.distanceTo(c)/width+BUBBLE_COVER*covered(p);if(cost<bestCost-1e-6){best=p;bestCost=cost;}}
    c=best;
  }
  const apex=tailFrom(c).apex;
  const position=new THREE.Vector3(c.x,c.y,-D).applyMatrix4(camera.matrixWorld);
  const pose={...base,position,quaternion,width,align:'center',kind:'bubble',edge:true,anchor:null,tail:new THREE.Vector3(apex.x,apex.y,-D).applyMatrix4(camera.matrixWorld).toArray()};
  return {...pose,viewMetrics:{...textViewMetrics(centeredPose(pose,aspect),camera,viewport,response.textMetrics),points:undefined}};
}
// Other things in the room as rectangles on the screen (x scaled by the view's aspect, so distances are even): objects and furniture
// (ctx.sceneBoxes) but the one the bubble speaks for, wholly in front of the camera, and none filling much of the view.
function screenRects(ctx,camera,viewport,exceptId){
  camera.updateMatrixWorld(true);const k=viewport.width/viewport.height;
  return (ctx.sceneBoxes?.()||[]).filter(b=>b.id!==exceptId).map(b=>{const pts=boxCorners(b).map(p=>p.project(camera));if(pts.some(p=>p.z<=-1||p.z>=1))return null;
    const r={x0:Math.min(...pts.map(p=>p.x*k)),x1:Math.max(...pts.map(p=>p.x*k)),y0:Math.min(...pts.map(p=>p.y)),y1:Math.max(...pts.map(p=>p.y))};
    return (r.x1-r.x0)*(r.y1-r.y0)>.4*4*k||r.x1<-k||r.x0>k||r.y1<-1||r.y0>1?null:r;}).filter(Boolean);
}
// Whether a tail points at one of those rectangles, even roughly: from its tip on along its direction for `length` (screen units), within
// BUBBLE_POINT_DEG of the line, or `near` of the tip.
function pointsAtOther(rects,base,apex,length,near){
  const dir=apex.clone().sub(base);if(dir.lengthSq()<1e-12)return 0;dir.normalize();
  for(let i=0;i<=24;i++){const k=Math.max(0,length)*i/24,q=apex.clone().addScaledVector(dir,k),m=near+k*Math.tan(BUBBLE_POINT_DEG);
    if(rects.some(r=>q.x>=r.x0-m&&q.x<=r.x1+m&&q.y>=r.y0-m&&q.y<=r.y1+m))return 1;}
  return 0;
}
// A bubble placed by its object: the share of it over other things on the screen, plus 1 when its tail points at one near its tip.
function bubbleClutter(pose,aspect,camera,viewport,rects){
  if(!rects.length)return 0;const k=viewport.width/viewport.height,S=p=>{const v=p.clone().project(camera);return new THREE.Vector2(v.x*k,v.y);};
  const h=pose.width*aspect,corner=(x,y)=>S(new THREE.Vector3(x*pose.width/2,y*h/2,0).applyQuaternion(pose.quaternion).add(pose.position));
  const cs=[corner(-1,-1),corner(1,-1),corner(-1,1),corner(1,1)],b={x0:Math.min(...cs.map(p=>p.x)),x1:Math.max(...cs.map(p=>p.x)),y0:Math.min(...cs.map(p=>p.y)),y1:Math.max(...cs.map(p=>p.y))};
  const area=Math.max(1e-9,(b.x1-b.x0)*(b.y1-b.y0)),covered=rects.reduce((a,r)=>a+Math.max(0,Math.min(r.x1,b.x1)-Math.max(r.x0,b.x0))*Math.max(0,Math.min(r.y1,b.y1)-Math.max(r.y0,b.y0)),0)/area;
  // The tail leaves the bubble toward its tip; judged from the tip on for half the bubble's height (the tip itself is on the object).
  const c=S(pose.position),tip=S(new THREE.Vector3(...pose.tail)),toward=tip.clone().sub(c),hx=(b.x1-b.x0)/2,hy=(b.y1-b.y0)/2;
  const e=Math.min(Math.abs(toward.x)>1e-9?hx/Math.abs(toward.x):Infinity,Math.abs(toward.y)>1e-9?hy/Math.abs(toward.y):Infinity,1);
  return covered+pointsAtOther(rects,c.clone().addScaledVector(toward,e),tip,hy,.15*2*hy);
}
const boxCorners=t=>{const q=new THREE.Quaternion().setFromAxisAngle(UP,THREE.MathUtils.degToRad(t.yaw||0)),out=[];
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])out.push(new THREE.Vector3(x*t.size[0]/2,y*t.size[1]/2,z*t.size[2]/2).applyQuaternion(q).add(new THREE.Vector3(...t.center)));return out;};
function bubblePlacement(response,ctx){
  const t=ctx.egoTarget?.(response.ego.main);if(!t)return null;
  const camera=ctx.frameCamera(response.frame),viewport=ctx.viewport(),aspect=response.aspect||.45,eye=camera.position;
  const center=new THREE.Vector3(...t.center),top=center.clone().setY(t.center[1]+t.size[1]/2),yaw=Math.atan2(eye.x-center.x,eye.z-center.z);
  const quaternion=new THREE.Quaternion().setFromAxisAngle(UP,yaw),inView=pose=>textViewMetrics(centeredPose(pose,aspect),camera,viewport,response.textMetrics);
  const previous=response.previousPose,stability=ctx.getSettings?.(response)?.stability??0,state=response.anchorState||{};
  if(previous?.kind==='bubble'&&!previous.edge&&previous.objectId===response.ego.main&&previous.objectCenter&&center.distanceTo(new THREE.Vector3(...previous.objectCenter))<1e-4){
    // Its text set again (streaming): the same type size at the new canvas width (response.bubbleWidthScale, src/agent.mjs).
    const kept=response.bubbleWidthScale&&response.bubbleWidthScale!==1?{...previous,width:previous.width*response.bubbleWidthScale}:previous;
    const turn=Math.abs(Math.atan2(Math.sin(yaw-previous.yaw),Math.cos(yaw-previous.yaw))),m=inView(kept);
    const keep=turn<THREE.MathUtils.lerp(BUBBLE_TURN,BUBBLE_TURN_STABLE,stability)&&(m.inView||!response.bubbleRequireInView&&m.inShare>=BUBBLE_KEEP_IN_VIEW);
    const now=performance.now()/1000;if(keep)state.badSince=null;else state.badSince??=now;
    if(keep||!response.bubbleRequireInView&&now-state.badSince<.8*stability)return {...kept,reusedSurface:true,anchorGrace:!keep,viewMetrics:{...m,points:undefined}};
  }
  state.badSince=null;
  // The object's footprint seen from the eye: its half depth toward the viewer and half width across (yaw-rotated box).
  const a=THREE.MathUtils.degToRad(t.yaw||0),toEye=new THREE.Vector3(eye.x-center.x,0,eye.z-center.z).normalize(),across=new THREE.Vector3(toEye.z,0,-toEye.x);
  const half=dir=>Math.abs(dir.x*Math.cos(a)-dir.z*Math.sin(a))*t.size[0]/2+Math.abs(dir.x*Math.sin(a)+dir.z*Math.cos(a))*t.size[2]/2;
  const front=half(toEye)+.02,side=half(across);
  const candidates=[{at:top,above:true}];
  for(const k of [.25,.5,.75])candidates.push({at:center.clone().addScaledVector(toEye,front).setY(top.y-k*t.size[1])});
  for(const k of [-.5,.5,-1,1])candidates.push({at:center.clone().addScaledVector(toEye,front).addScaledVector(across,k*side).setY(top.y-.25*t.size[1])});
  const others=screenRects(ctx,camera,viewport,response.ego.main),fits=[];
  for(const c of candidates){
    const width=viewSizedWidth(c.at,quaternion,camera,viewport,response.textMetrics,aspect),height=width*aspect;
    // Above: its lower edge just over the top. On the side: centred there, but never lower than the object's bottom.
    const position=c.above?c.at.clone().addScaledVector(UP,BUBBLE_GAP+height/2):c.at.clone().setY(Math.max(c.at.y,center.y-t.size[1]/2+height/2));
    // The tail: down to the object's top; on its side, to the face just below the bubble (else just above it) where the object shows.
    const reach=BUBBLE_TAIL*height,below=position.y-height/2-reach,over=position.y+height/2+reach,bottom=center.y-t.size[1]/2;
    const tail=c.above?top:position.clone().setY(below>=bottom?below:over<=top.y?over:position.y-height/2-reach);
    const pose={position,quaternion,width,align:'center',kind:'bubble',anchor:c.above?top.toArray():null,tail:tail.toArray(),
      yaw,objectId:response.ego.main,objectCenter:center.toArray()};
    const m=inView(pose);if(m.inView)fits.push({pose:{...pose,viewMetrics:{...m,points:undefined}},cost:BUBBLE_ORDER*fits.length+BUBBLE_COVER*bubbleClutter(pose,aspect,camera,viewport,others)});
  }
  // Of those that fit, the first in the order above unless it covers other things or its tail points at one on the screen.
  if(fits.length)return fits.reduce((a,b)=>b.cost<a.cost-1e-9?b:a).pose;
  // Wholly out of the view (no corner of the object on the screen, or behind the viewer): the bubble shows a small model of it at
  // its tail's tip (src/agent.mjs).
  camera.updateMatrixWorld(true);const corners=boxCorners(t).map(p=>p.project(camera)),offscreen=!corners.some(p=>p.z>-1&&p.z<1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1);
  return edgeBubble(response,ctx,center.toArray(),{yaw,objectId:response.ego.main,objectCenter:center.toArray(),offscreen})
    ||unavailable(eye,camera.getWorldQuaternion(new THREE.Quaternion()),'The bubble does not fit the view');
}
export const INFO_NEAR=1,INFO_SETTLE=.7,INFO_MIN_SHRINK=.55;   // INFO_MIN_SHRINK: the Behavior panel's default
/** Whether a spot is good enough for an info answer to settle on (its score; clean weighs most, so clutter alone keeps it from settling
 *  however near and well turned the spot is). */
export const infoSettles=spot=>!!spot&&spot.score>=INFO_SETTLE;
/** How far (radians, 0 to π/2) the text's lines are from level on screen. */
export function screenTilt(pose,camera,aspect=1){   // aspect: the view's width / height
  camera.updateMatrixWorld(true);const c=pose.position.clone(),r=c.clone().addScaledVector(new THREE.Vector3(1,0,0).applyQuaternion(pose.quaternion),pose.width/2);
  const a=c.project(camera),b=r.project(camera),t=Math.abs(Math.atan2(b.y-a.y,(b.x-a.x)*aspect));return Math.min(t,Math.PI-t);
}
const ramp=(v,full,zero)=>v<=full?1:v>=zero?0:(zero-v)/(zero-full);
/** How good a surface spot is for an info answer, 0-1 (each part too): near, the text's centre 10 cm or less from the box (0 at 1 m);
 *  facing, the text turned the way the box shows itself to the viewer (each face of the box weighs by how much of it the eye sees,
 *  facing the eye × area: for a small box on a table seen from above, its top as well as its side; 1 parallel, 0 at right angles);
 *  clean, the background's clutter cost (src/surface-quality.mjs, 0-10: 0 → 1, 4 or more → 0); level, the text's lines level on screen
 *  (1 within 4°, 0 at 20°: a spot seen steeply at the edge of the view looks slanted) and not far above the eye (1 up to 10 cm above, 0
 *  at 60 cm); relation, on the surface the person relates to then (src/spatial-relations.mjs: the desk top under the gaze, the wall
 *  faced; relationSurface) 1, on another 0, .5 when there is none. score = .1 near + .15 facing + .55 clean + .1 level + .1 relation: a
 *  clean background weighs most (with the others perfect, settling still needs clean ≥ .45). camera: for level (1 without). */
export function infoSpotScore(pose,box,eye,camera=null,aspect=1,relationSurface=null){
  const f=new THREE.Quaternion().setFromAxisAngle(UP,THREE.MathUtils.degToRad(box.yaw||0)),inv=f.clone().invert(),c=new THREE.Vector3(...box.center),h=new THREE.Vector3(...box.size).multiplyScalar(.5);
  const at=(pose.surfaceAnchor||pose.position).clone().sub(c).applyQuaternion(inv);
  const near=ramp(Math.hypot(Math.max(0,Math.abs(at.x)-h.x),Math.max(0,Math.abs(at.y)-h.y),Math.max(0,Math.abs(at.z)-h.z)),.1,1);
  // The faces the eye sees (from the box's centre), each by facing × area.
  const toEye=eye.clone().sub(c).applyQuaternion(inv).normalize(),textN=new THREE.Vector3(0,0,1).applyQuaternion(pose.quaternion);let sum=0,seen=0;
  for(const [a,area] of [[[1,0,0],h.y*h.z],[[-1,0,0],h.y*h.z],[[0,1,0],h.x*h.z],[[0,-1,0],h.x*h.z],[[0,0,1],h.x*h.y],[[0,0,-1],h.x*h.y]]){
    const n=new THREE.Vector3(...a),w=Math.max(0,n.dot(toEye))*area;if(!w)continue;seen+=w;sum+=w*Math.max(0,textN.dot(n.applyQuaternion(f)));}
  const facing=seen?sum/seen:0,relation=relationSurface==null?.5:pose.surfaceId===relationSurface?1:0;
  const clean=ramp(pose.surfaceQuality?.cost??0,0,4),round=v=>Math.round(v*1000)/1000,level=(camera?ramp(THREE.MathUtils.radToDeg(screenTilt(pose,camera,aspect)),4,20):1)*ramp(Math.max(0,(pose.surfaceAnchor||pose.position).y-eye.y-.1),0,.5);
  return {near:round(near),facing:round(facing),clean:round(clean),level:round(level),relation,score:round(.1*near+.15*facing+.55*clean+.1*level+.1*relation)};
}
const INFO_FLOAT={gap:.04,maxWidth:1.2,parallel:80,moveAbove:.3};
/** A floating panel's yaw: parallel to the box's upright face toward the viewer (it reads as belonging to the box, and its lines look as
 *  level as the box's edges; turned toward the eye instead, an upright panel seen from below slants on screen) when that face is within
 *  parallelDeg (Behavior; ctx.infoFloatParallel) of turning to the eye from where the panel is; else turned to the eye. */
export function floatYaw(box,position,eye,parallelDeg=INFO_FLOAT.parallel){
  const toEye=Math.atan2(eye.x-position.x,eye.z-position.z),a=THREE.MathUtils.degToRad(box.yaw||0);
  // The box's four upright faces (local ±z, ±x turned by its yaw, as yaws) by how much of each the eye sees (facing × area): a flyer's
  // broad face, not its edge, even seen from the side.
  const [w,h,d]=box.size,diff=y=>Math.abs(Math.atan2(Math.sin(y-toEye),Math.cos(y-toEye)));
  const faces=[[a,w*h],[a+Math.PI,w*h],[a+Math.PI/2,d*h],[a-Math.PI/2,d*h]],seen=([y,area])=>Math.cos(diff(y))*area;
  const face=faces.reduce((x,y)=>seen(y)>seen(x)?y:x)[0];
  return diff(face)<THREE.MathUtils.degToRad(parallelDeg)?face:toEye;
}
async function infoPlacement(response,ctx){
  const t=ctx.infoTarget?.(response);if(!t)return null;
  const camera=ctx.frameCamera(response.frame),viewport=ctx.viewport(),aspect=response.aspect||.45,eye=camera.position,previous=response.previousPose;
  const mine=previous?.infoBox===t.id&&!previous.unreadable;
  if(mine&&previous.infoSettled)return {...previous,reusedSurface:true};
  if(response.allowSearch===false)return mine?{...previous,reusedSurface:true}:unavailable(eye,camera.getWorldQuaternion(new THREE.Quaternion()),'Awaiting surface search');
  response.onSearch?.();
  const center=new THREE.Vector3(...t.center);
  // Never over the box itself (2 cm around it).
  const f=new THREE.Quaternion().setFromAxisAngle(UP,THREE.MathUtils.degToRad(t.yaw||0)).invert(),h=new THREE.Vector3(...t.size).multiplyScalar(.5).addScalar(.02);
  const avoid=p=>{const l=p.clone().sub(center).applyQuaternion(f);return Math.abs(l.x)<=h.x&&Math.abs(l.y)<=h.y&&Math.abs(l.z)<=h.z+.03;};
  // The surface search's best few spots (each 20 cm apart at least), ranked here by the info score (its own cost favours the view's
  // centre and the box's nearness; a cleaner spot a little further, e.g. on the poster's other side, should win).
  // The surface the person relates to (src/spatial-relations.mjs) is favoured in the search and always gets a spot in the shortlist when
  // it has one; text may be set as small as the Behavior panel allows (ctx.infoMinShrink) to fit beside the box, and run a little past
  // the edge of the view (INFO_OVERFLOW) and of its surface (INFO_OVERHANG).
  const relation=ctx.relationAt?.(response.frame)?.surfaceId||null;
  const found=await staticTextPlacement({...response,near:{point:center,max:INFO_NEAR,avoid},candidates:8,preferSurfaceId:relation,minShrink:ctx.infoMinShrink?.()??INFO_MIN_SHRINK,overflow:INFO_OVERFLOW,overhang:INFO_OVERHANG},ctx,readableSurfaceBasis)||[];
  const ranked=found.map(p=>({p,s:infoSpotScore(p,t,eye,camera,viewport.width/viewport.height,relation)})).sort((a,b)=>b.s.score-a.s.score);
  const pose=ranked[0]?.p&&{...ranked[0].p,infoShortlist:ranked.map(({p,s})=>({surface:p.surfaceId,at:p.surfaceAnchor.toArray().map(v=>+v.toFixed(2)),layout:p.layout,...s}))},spot=ranked[0]?.s;   // infoShortlist: for inspection
  if(infoSettles(spot))return {...pose,infoBox:t.id,infoSettled:true,infoSpot:spot};
  // A float stays where it was put, unless it did not fit the view then: it keeps looking, and moves only to a spot that fits and is
  // not well above the eye (INFO_FLOAT.moveAbove; looking up, nearly all that fits is above the eye, and text high above the line of
  // sight is worse than text a little past the edge of the view). Once in view it stays.
  if(mine&&previous.kind==='info-float'&&previous.viewMetrics?.inView)return {...previous,reusedSurface:true};
  const float=await floatNearBox(response,ctx,t);
  if(mine&&previous.kind==='info-float'&&(!float.viewMetrics?.inView||float.position.y-eye.y>INFO_FLOAT.moveAbove))return {...previous,reusedSurface:true};
  return {...float,...(spot?{infoSpot:spot}:{})};   // infoSpot: the best surface spot's score, for the record
}
// Floating next to the box, in the box's own plane (turned by floatYaw, a little in front of its face): beside, below, above or at a
// corner of it, INFO_FLOAT.gap clear of its outline (and a second ring further out). So it is at the box's distance, never between the
// viewer and the box (standing close to a flyer, a spot "toward the viewer" is at arm's length: out of view, oversized, above the eye).
// Each spot tries every line length (response.layouts) and smaller sizes (down to 0.45 of the size asked for: smaller text beats text cut
// off by the edge of the view; a size under the readable floor costs more) so it fits the view. Ranked by how
// much of it is in the view, a clean background (the clutter cost surfaces use), readability, not above the eye (more than 10 cm),
// near the box; the best few are checked against the room (not hidden), the best of those wins.
async function floatNearBox(response,ctx,t){
  const camera=ctx.frameCamera(response.frame),viewport=ctx.viewport(),eye=camera.position,center=new THREE.Vector3(...t.center);
  const parallelDeg=ctx.infoFloatParallel?.()??INFO_FLOAT.parallel,yaw=floatYaw(t,center,eye,parallelDeg),quaternion=new THREE.Quaternion().setFromAxisAngle(UP,yaw);
  const n=new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw)),r=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
  // The box's extent in that plane (half sizes along r and up, depth along n) from its corners.
  const by=THREE.MathUtils.degToRad(t.yaw||0),bq=new THREE.Quaternion().setFromAxisAngle(UP,by);let hr=0,hu=t.size[1]/2,hn=0;
  for(const sx of [-1,1])for(const sz of [-1,1]){const c=new THREE.Vector3(sx*t.size[0]/2,0,sz*t.size[2]/2).applyQuaternion(bq);hr=Math.max(hr,Math.abs(c.dot(r)));hn=Math.max(hn,c.dot(n));}
  const base=center.clone().addScaledVector(n,hn+.03),quality=await ctx.getSurfaceQuality?.(response.frame);
  const layouts=response.layouts?.length?response.layouts:[{columns:null,aspect:response.aspect||.45,textMetrics:response.textMetrics}];
  const maxWidth=INFO_FLOAT.maxWidth*(response.textMetrics?.scale||1),G=INFO_FLOAT.gap,cands=[];
  for(const L of layouts)for(const [dx,dy] of [[1,0],[-1,0],[0,-1],[0,1],[1,-1],[-1,-1],[1,1],[-1,1]])for(const ring of [0,1]){
    const wanted=Math.min(maxWidth,viewSizedWidth(base,quaternion,camera,viewport,L.textMetrics,L.aspect));
    for(const shrink of [1,.85,.7,.55,.45]){
      const width=wanted*shrink,height=width*L.aspect;
      const position=base.clone().addScaledVector(r,dx*(hr+G+width/2+ring*.15)).addScaledVector(UP,dy*(hu+G+height/2+ring*.1));
      const pose={position,quaternion,width,align:'center',kind:'info-float',infoBox:t.id,...(L.columns?{layout:L.columns}:{})};
      const metrics=textViewMetrics(centeredPose(pose,L.aspect),camera,viewport,L.textMetrics);
      if(!metrics.inView&&shrink<.45)continue;
      const coverage=placementVisibility(centeredPose(pose,L.aspect),camera).coverage,clutter=quality?.(pose,L.aspect)?.cost??0;
      const above=Math.max(0,position.y-eye.y-.1);
      cands.push({pose,metrics,aspect:L.aspect,cost:3*(1-coverage)+(metrics.inView?0:2)+(metrics.minPx>=TEXT_VIEW.minPx*.9?0:1)+1.5*Math.min(1,clutter/4)+8*above+.3*ring+.15*Math.abs(dx*dy)+.25*(1-shrink)+(L.columns?.12*Math.abs(Math.log(L.columns/1024)):0)});
      if(metrics.inView)break;   // the largest size that fits
    }
  }
  cands.sort((a,b)=>a.cost-b.cost);let best=null;
  for(const c of cands.slice(0,6)){
    const visible=c.metrics.inView&&ctx.visible?visibleFraction(await ctx.visible(response.frame,footprintPoints(c.pose,c.aspect,8,4),{staticSurface:false})):c.metrics.inView?1:0,cost=c.cost+2*(1-visible);
    if(!best||cost<best.cost)best={cost,pose:{...c.pose,viewMetrics:{...c.metrics,points:undefined,visible}}};
  }
  return best?.pose||unavailable(eye,camera.getWorldQuaternion(new THREE.Quaternion()),'No floating spot by the box');
}
export async function place(response,ctx){
  const info=response.info?.key?await infoPlacement(response,ctx):null;
  const bubble=!info&&response.ego?.main?bubblePlacement(response,ctx):null;
  const surface=info||bubble||await surfacePlacement(response,ctx);
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
