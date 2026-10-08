import * as THREE from 'three';
// NDC edge guidance uses camera-space direction, including targets behind the user.
export function targetGuidance(camera,target){
 camera.updateMatrixWorld(true);
 const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(target.yaw||0));
 const matrix=new THREE.Matrix4().compose(new THREE.Vector3(...target.center),q,new THREE.Vector3(...target.size));
 const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
 const box=new THREE.Box3(new THREE.Vector3(-.5,-.5,-.5),new THREE.Vector3(.5,.5,.5)).applyMatrix4(matrix);
 const visible=frustum.intersectsBox(box);
 const p=new THREE.Vector3(...target.center).applyMatrix4(camera.matrixWorldInverse);
 let x=p.x*camera.projectionMatrix.elements[0],y=p.y*camera.projectionMatrix.elements[5];
 if(Math.hypot(x,y)<1e-5){x=1;y=0;}
 const scale=.82/Math.max(Math.abs(x),Math.abs(y));
 return {visible,behind:p.z>=0,x:x*scale,y:y*scale,angle:Math.atan2(y,x),distance:p.length()};
}
export function createFindMy(){
 const scene=new THREE.Scene(),hud=new THREE.Scene(),hudCamera=new THREE.OrthographicCamera(-1,1,1,-1,.01,10);hudCamera.position.z=1;
 const uniforms={opacity:{value:.18},tint:{value:new THREE.Color('#67f3d0')}};
 const fragment='uniform float opacity;uniform vec3 tint;void main(){gl_FragColor=vec4(tint,opacity);#include <colorspace_fragment>\n}';
 const material=opacity=>new THREE.ShaderMaterial({transparent:true,depthTest:false,depthWrite:false,toneMapped:false,uniforms:{...uniforms,opacity:{value:opacity}},vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:fragment.replace(';#include',';\n#include')});
 const group=new THREE.Group();group.name='findmy-highlight';scene.add(group);
 const fill=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material(.13));fill.name='findmy-box-fill';
 const outline=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),material(.95));outline.name='findmy-box-outline';group.add(fill,outline);
 const arrow=new THREE.Group();arrow.name='findmy-direction';hud.add(arrow);
 const shape=new THREE.Shape();shape.moveTo(.075,0);shape.lineTo(-.025,.052);shape.lineTo(-.025,.019);shape.lineTo(-.085,.019);shape.lineTo(-.085,-.019);shape.lineTo(-.025,-.019);shape.lineTo(-.025,-.052);shape.closePath();
 arrow.add(new THREE.Mesh(new THREE.ShapeGeometry(shape),material(1)));
 let response=null;
 return {group,arrow,uniforms,setResponse(r){response=r?.findmy?.status==='found'?r:null;},
  render(renderer,camera){
   if(!response){group.visible=false;arrow.visible=false;return;}
   const target=response.findmy.target,g=targetGuidance(camera,target),size=renderer.getDrawingBufferSize(new THREE.Vector2());
   group.position.fromArray(target.center);group.scale.fromArray(target.size).multiplyScalar(1.015);group.rotation.y=THREE.MathUtils.degToRad(target.yaw||0);group.visible=true;
   arrow.visible=!g.visible;arrow.position.set(g.x,g.y,0);arrow.children[0].rotation.z=Math.atan2(g.y*size.y,g.x*size.x);
   // Keep arrow pixels square on non-square viewports.
   arrow.scale.set(.95*size.y/size.x,.95,1);
   group.userData.guidance=g;group.userData.occlusion='global-hands';
   const auto=renderer.autoClear;renderer.autoClear=false;
   try{renderer.render(scene,camera);if(arrow.visible)renderer.render(hud,hudCamera);}finally{renderer.autoClear=auto;}
  },dispose(){for(const root of [scene,hud])root.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}};
}
