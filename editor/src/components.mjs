import * as THREE from 'three';

// Component instances placed in a scenario: 3D widgets from the library (components/<id>/component.json: a three.js module or a
// .glb, see components/README.md) or .glb files imported from disk. Each instance has a root group carrying its transform (position,
// yaw about +y, uniform scale) and visibility; the component's own object sits under it. Dynamic components are driven by the
// scenario clock (update with the video time), so scrubbing and exporting stay deterministic; interactive ones get onPointer.
// An instance spec (what is saved): {id, component, category, name, position, rotation, yaw, scale, visible, mount, params, scope, initial, start?, end?, src?}
//   rotation: [x, y, z] degrees (Euler XYZ); yaw mirrors rotation[1] (older specs have only yaw). scale: a number, or [x, y, z] along the
//   component's own axes. initial: {position, rotation, scale} the saved default transform (Reset restores it; initially where it was placed).
//   component: a library id, or 'file' for an imported .glb whose data URL is in src. start/end (s): shown only in that span.
//   scope: 'scene' (part of the place, in every recording: spaces/<scene>/composition.json; e.g. digital twin objects) or 'recording'
//   (this recording only: scenarios/<take>/composition.json).
// Libraries: components/<id>/ (everywhere) and spaces/<scene>/components/<id>/ (that scene's own, e.g. digital twins of its objects).
// component.json may also give: category (grouping in the panel), defaultScale, pivot (the local point that sits at the instance's
// position and is scaled and turned about; default the origin), nodes (a .glb's nodes to keep, by name; default all), scope.

export function createComponentHost({scene,loader,siteURL,assetBase,invalidate}){
  const group=new THREE.Group();group.name='components';scene.add(group);
  let library=new Map(),instances=[],serial=1;

  async function loadLibrary(space){
    let list=[];
    try{const r=await fetch('/api/components'+(space?`?space=${encodeURIComponent(space)}`:''));if(r.ok)list=(await r.json()).components;}catch{}
    if(!list.length)list=[{id:'calibration-cube',path:'components/calibration-cube/'}];   // Served without scripts/server.py: the built-in one.
    const entries=await Promise.all(list.map(async ({id,path})=>{try{const base=new URL(path,siteURL);const m=await(await fetch(new URL('component.json',base))).json();return [id,{...m,id,base}];}catch{return null;}}));
    library=new Map(entries.filter(Boolean));return [...library.values()];
  }
  const categoryOf=s=>{const c=s.category||library.get(s.component)?.category;return c==='digital twin'?'persistent':(['persistent','opportunistic'].includes(c)?c:'widget');};
  const defaults=m=>Object.fromEntries(Object.entries(m?.params||{}).map(([k,p])=>[k,p.default]));

  // The component's runtime: {object, update?, onPointer?, setParams?, dispose?}.
  async function instantiate(spec){
    const m=spec.component==='file'?{kind:'gltf'}:library.get(spec.component);
    if(!m)throw Error(`Unknown component: ${spec.component}`);
    if(m.kind==='three'){const mod=await import(new URL(m.entry,m.base).href);
      return mod.create({THREE,params:{...defaults(m),...spec.params},load:url=>loader.loadAsync(new URL(url,m.base).href),invalidate});}
    // An imported file: a data URL until the scenario saves it, then assets/<id>.glb next to the session.
    const gltf=await loader.loadAsync(spec.component==='file'?new URL(spec.src,assetBase).href:new URL(m.entry,m.base).href);
    // Only some of the file's nodes (by name, with what is under them), e.g. a table's top without the drawer that is its own component.
    if(m.nodes){const keep=new Set(m.nodes.map(n=>THREE.PropertyBinding.sanitizeNodeName(n))),drop=[];gltf.scene.traverse(o=>{if(o.isMesh){let a=o,ok=false;while(a){if(keep.has(a.name)){ok=true;break;}a=a.parent;}if(!ok)drop.push(o);}});drop.forEach(o=>o.removeFromParent());}
    const mixer=gltf.animations.length?new THREE.AnimationMixer(gltf.scene):null,length=Math.max(0,...gltf.animations.map(a=>a.duration));
    gltf.animations.forEach(a=>mixer.clipAction(a).play());
    // The pivot sits at the instance's position (so a scale grows the object around it).
    let object=gltf.scene;if(m.pivot){object=new THREE.Group();gltf.scene.position.set(-m.pivot[0],-m.pivot[1],-m.pivot[2]);object.add(gltf.scene);}
    return {object,update:mixer?({local})=>mixer.setTime(length?((local%length)+length)%length:0):null,
      dispose(){gltf.scene.traverse(o=>{o.geometry?.dispose();[].concat(o.material||[]).forEach(x=>x.dispose());});}};
  }
  const D=THREE.MathUtils.degToRad,vec3=v=>Array.isArray(v)?v.map(x=>Math.max(.001,x)):[1,1,1].map(()=>Math.max(.001,v||1));
  function apply(inst){const s=inst.spec,r=inst.root;r.position.fromArray(s.position);r.rotation.set(D(s.rotation[0]),D(s.rotation[1]),D(s.rotation[2]));r.scale.fromArray(vec3(s.scale));}
  /** The transform part of a spec (what Reset restores and the undo history keeps). */
  const transform=s=>structuredClone({position:s.position,rotation:s.rotation,scale:s.scale});

  async function add(spec){
    const m=library.get(spec.component),category=categoryOf(spec);
    const s={id:spec.id||`c${serial++}`,component:spec.component,name:spec.name||m?.name||spec.component,position:spec.position||[0,0,-2.5],yaw:spec.yaw||0,scale:spec.scale||m?.defaultScale||1,
      category,scope:category==='persistent'?'scene':category==='opportunistic'?'recording':(spec.scope||m?.scope)==='scene'?'scene':'recording',visible:spec.visible!==false,mount:spec.mount==='wall'?'wall':'floor',params:{...defaults(m),...spec.params},...(spec.src?{src:spec.src}:{}),
      ...(Number.isFinite(spec.start)?{start:spec.start}:{}),...(Number.isFinite(spec.end)?{end:spec.end}:{})};
    s.rotation=Array.isArray(spec.rotation)&&spec.rotation.length===3?[...spec.rotation]:[0,s.yaw,0];s.yaw=s.rotation[1];
    if(Array.isArray(spec.scale))s.scale=[...spec.scale];
    s.initial=spec.initial?structuredClone(spec.initial):transform(s);
    while(instances.some(i=>i.spec.id===s.id))s.id=`c${serial++}`;
    const root=new THREE.Group();root.name=s.name;root.userData.instance=s.id;
    const runtime=await instantiate(s);root.add(runtime.object);group.add(root);
    const inst={spec:s,root,runtime};instances.push(inst);apply(inst);return inst;
  }
  function remove(id){const i=instances.findIndex(x=>x.spec.id===id);if(i<0)return;const [inst]=instances.splice(i,1);group.remove(inst.root);inst.runtime.dispose?.();}
  async function setParams(id,params){
    const inst=get(id);if(!inst)return;Object.assign(inst.spec.params,params);
    if(inst.runtime.setParams)inst.runtime.setParams(inst.spec.params);
    else{inst.root.remove(inst.runtime.object);inst.runtime.dispose?.();inst.runtime=await instantiate(inst.spec);inst.root.add(inst.runtime.object);}
  }
  const get=id=>instances.find(i=>i.spec.id===id);
  function set(id,fields){const inst=get(id);if(!inst)return;const f={...fields};
    // yaw and rotation[1] are one value: whichever is given sets both.
    if('yaw' in f&&!('rotation' in f))f.rotation=[inst.spec.rotation[0],f.yaw,inst.spec.rotation[2]];
    if(f.rotation)f.yaw=f.rotation[1];
    Object.assign(inst.spec,f);inst.root.name=inst.spec.name;apply(inst);}
  // Per video frame: visibility (own flag and time span) and the dynamic components' state.
  function update({t,dt=0,frame}){
    for(const inst of instances){const s=inst.spec,inSpan=!(Number.isFinite(s.start)&&t<s.start)&&!(Number.isFinite(s.end)&&t>s.end);
      inst.root.visible=s.visible&&inSpan;if(inst.root.visible)inst.runtime.update?.({t,dt,frame,local:t-(s.start||0)});}
  }
  // The instance under a ray (nearest visible hit), for selecting and for interactive components.
  function pick(ray,include=()=>true){const hit=ray.intersectObjects(instances.filter(i=>i.root.visible&&include(i)).map(i=>i.root),true)[0];if(!hit)return null;
    let o=hit.object;while(o&&!o.userData.instance)o=o.parent;return o?{instance:get(o.userData.instance),point:hit.point,object:hit.object}:null;}
  function clear(){for(const i of [...instances])remove(i.spec.id);}
  return {group,transform,categoryOf,loadLibrary,add,remove,set,setParams,update,pick,clear,get,
    specs:scope=>instances.filter(i=>!scope||i.spec.scope===scope).map(i=>structuredClone(i.spec)),get instances(){return instances;},get library(){return library;}};
}
