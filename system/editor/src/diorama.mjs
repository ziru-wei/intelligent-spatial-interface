// A zone's animation (an answer's `animation` part, e.g. LabInfo's diorama slot): the lab's prefabricated dioramas, played in a loop the
// way the Vision Pro app plays them (visionos/SpatialTakeVision/AppModel.swift showZoneAnimation):
//   on its zone's table when that table is in view from where the question was asked, else on the desk or table in front of the user,
//   else floating ahead, low and to the right (clear of the answer text); scaled to fit the table (a 0.72 m turntable), its front turned to the user.
// The models are assets/dioramas/<id>.glb, converted from the app's USDZ with Blender. Nothing real hides it while it plays (as on the
// headset), so it is drawn after the scene, like the FindMy highlight.
import * as THREE from 'three';

const TABLES={labResearchWork:'lab-table-5',labResearchLife:'lab-table-5'};
const SIZE=.72;

function inView(camera,p,maxDistance=9){
  const v=new THREE.Vector3(...p).applyMatrix4(camera.matrixWorldInverse);
  if(v.z>=0||-v.z>maxDistance)return false;
  const n=new THREE.Vector3(...p).project(camera);
  return Math.abs(n.x)<.85&&Math.abs(n.y)<.85;
}
const top=b=>[b.center[0],b.center[1]+b.size[1]/2,b.center[2]];

/** Where it plays, seen from the camera the question was asked with: {position, scale, yaw, on}. */
export function placeDiorama(id,camera,tables){
  camera.updateMatrixWorld(true);
  const eye=camera.position,fit=b=>Math.min(1,.92*Math.min(b.size[0],b.size[2])/SIZE);
  let at,k,on;
  const own=tables.find(b=>b.id===TABLES[id]);
  if(own&&inView(camera,top(own))){at=top(own);k=fit(own);on=own.id;}
  else{
    const front=tables.filter(b=>inView(camera,top(b),3)).sort((a,b)=>new THREE.Vector3(...top(a)).distanceTo(eye)-new THREE.Vector3(...top(b)).distanceTo(eye))[0];
    if(front){at=top(front);k=fit(front);on=front.id;}
    else{const f=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);f.y=0;f.normalize();
      // Off to the right and low, so the answer text (in the middle of the view) stays clear of it, as the headset keeps it.
      const right=new THREE.Vector3(-f.z,0,f.x);
      at=eye.clone().addScaledVector(f,.75).addScaledVector(right,.3).add(new THREE.Vector3(0,-.42,0)).toArray();k=.45;on='floating';}
  }
  const yaw=Math.atan2(eye.x-at[0],eye.z-at[2]);   // its front (+z) toward the user
  return {position:[at[0],at[1]+.004,at[2]],scale:k,yaw,on};
}

export function createDiorama({loader,lighting}){
  const scene=new THREE.Scene(),root=new THREE.Group();root.name='zone-animation';scene.add(root);
  scene.environment=lighting?.environment||null;
  for(const l of lighting?.lights||[])scene.add(l);
  if(!lighting?.lights?.length)scene.add(new THREE.HemisphereLight(0xffffff,0x666666,2.2),Object.assign(new THREE.DirectionalLight(0xffffff,1.6),{position:new THREE.Vector3(1,3,2)}));
  const models=new Map();let current=null,mixer=null,started=0;
  for(const id of Object.keys(TABLES))setTimeout(()=>model(id),0);   // preloaded, so an answer's diorama shows when the answer does
  async function model(id){
    if(!models.has(id))models.set(id,loader.loadAsync(new URL(`./assets/dioramas/${id}.glb`,location.href).href).catch(()=>null));
    return models.get(id);
  }
  return {
    get active(){return !!current;},
    /** r: the answer with an animation (null clears it); camera: where the question was asked from; tables: layout tables. */
    async setResponse(r,camera,tables){
      const key=r?.animation?`${r.question_id}:${r.animation.id}`:null;
      if(key===current?.key)return;
      root.clear();mixer=null;current=key?{key}:null;
      if(!key)return;
      const gltf=await model(r.animation.id);
      if(!gltf||current?.key!==key)return;
      const place=placeDiorama(r.animation.id,camera,tables),obj=gltf.scene;
      root.add(obj);root.position.fromArray(place.position);root.scale.setScalar(place.scale);root.rotation.set(0,place.yaw,0);
      mixer=new THREE.AnimationMixer(obj);for(const a of gltf.animations)mixer.clipAction(a).play();
      started=performance.now();current.place=place;
    },
    render(renderer,camera){
      if(!current||!root.children.length)return;
      mixer?.setTime((performance.now()-started)/1000);
      const auto=renderer.autoClear;renderer.autoClear=false;
      try{renderer.clearDepth();renderer.render(scene,camera);}finally{renderer.autoClear=auto;}
    },
  };
}
