import * as THREE from 'three';
const clamp=x=>Math.max(0,Math.min(1,x));
export function posePoints(pose){
 const q=pose.quaternion||pose.q,center=pose.position||pose.origin,points=[];
 for(const x of [-.46,0,.46])for(const y of [-.46,0,.46])points.push(new THREE.Vector3(x*pose.width,y*pose.height,0).applyQuaternion(q).add(center));
 return points;
}
export function placementVisibility(pose,camera,kind='text',occlusion=1){
 if(!pose)return {coverage:0,center:1};camera.updateMatrixWorld(true);
 const center=pose.position||pose.origin,q=pose.quaternion||pose.q,eye=camera.getWorldPosition(new THREE.Vector3()),normal=new THREE.Vector3(0,0,1).applyQuaternion(q),toward=eye.clone().sub(center);
 if(normal.dot(toward)<=.025)return {coverage:0,center:1};
 const view=center.clone().applyMatrix4(camera.matrixWorldInverse);if(view.z>=-.03)return {coverage:0,center:1};
 if(kind==='text'){const up=new THREE.Vector3(0,1,0).applyQuaternion(q),a=center.clone().addScaledVector(up,pose.height*.25).project(camera),b=center.clone().addScaledVector(up,-pose.height*.25).project(camera);if(a.y<=b.y)return {coverage:0,center:1};}
 const points=posePoints(pose).map(p=>p.project(camera)),xs=points.map(p=>p.x),ys=points.map(p=>p.y);
 const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),area=Math.max(.0001,(x1-x0)*(y1-y0));
 const intersection=Math.max(0,Math.min(.96,x1)-Math.max(-.96,x0))*Math.max(0,Math.min(.92,y1)-Math.max(-.92,y0));
 const visible=clamp(intersection/(kind==='weather'?Math.min(area,1.92*1.84):area));
 const angular=kind==='text'?clamp((x1-x0)/.24):1,c=center.clone().project(camera);
 return {coverage:visible*angular*occlusion,center:Math.min(2,Math.hypot(c.x,c.y))};
}
// Two feasible, surface-fitted candidates. A movement penalty retains the world anchor;
// a visibility constraint releases it before it becomes unreadable/offscreen. No look-ahead.
export function chooseStablePlacement({current,candidate,camera,stability=0,kind='text',occlusion=1}){
 const s=clamp(stability),a=placementVisibility(current,camera,kind,occlusion),b=placementVisibility(candidate,camera,kind);
 if(!current||s===0)return {hold:false,current:a,candidate:b,reason:'follow'};
 if(!candidate)return {hold:a.coverage>(kind==='text'?.55:.25),current:a,candidate:b,reason:'no-candidate'};
 const floor=kind==='text'?.96-.34*s:.72-.40*s;
 if(a.coverage<floor&&b.coverage>a.coverage+.08)return {hold:false,current:a,candidate:b,reason:'visibility'};
 const p=current.position||current.origin,n=candidate.position||candidate.origin,rotation=(current.quaternion||current.q).angleTo(candidate.quaternion||candidate.q);
 const distance=p.distanceTo(n)/Math.max(.3,current.width),switching=current.id&&candidate.id&&current.id!==candidate.id?1:0;
 const loss=m=>4*(1-m.coverage)**2+(.65*(1-s)+.04)*m.center*m.center;
 const keepCost=loss(a),moveCost=loss(b)+s*(1.6*Math.min(3,distance)+.55*rotation+.85*switching);
 return {hold:keepCost<=moveCost+.035*s,current:a,candidate:b,keepCost,moveCost,reason:'cost'};
}

// Constant screen footprint, expressed as a world pose for the existing text/control renderer.
export function viewFixedPose(camera,aspect,stack=0,sizingAspect=aspect){
 camera.updateMatrixWorld(true);const distance=1.25,e=camera.projectionMatrix.elements;
 const viewportWidth=2*distance/e[0],viewportHeight=2*distance/e[5];
 const width=.5*Math.min(viewportWidth*.70,viewportHeight*.38/sizingAspect),height=width*aspect;
 const y=-.38+Math.min(stack,2)*Math.max(.43,2*height/viewportHeight+.06);
 const position=new THREE.Vector3(0,y,0).unproject(camera),local=position.applyMatrix4(camera.matrixWorldInverse);
 local.multiplyScalar(distance/-local.z).applyMatrix4(camera.matrixWorld);
 return {position:local,quaternion:camera.getWorldQuaternion(new THREE.Quaternion()),width,height,kind:'view-fixed',align:'center'};
}
