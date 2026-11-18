// Script-owned preview controls requested by the agent's structured Weather mod payload.
export function createWeatherPlayback(){
 let weather=null,index=0,fraction=0,last=null,dragging=false,paused=false,resumeAt=0;
 const entries=()=>weather?.timeline||weather?.forecast||[];
 function snapshot(){const all=entries();index=Math.min(index,Math.max(0,all.length-1));const entry=all[index],dates=[...new Set(all.map(e=>e.date))];
  return {entry,index,fraction,total:all.length,entries:all,dates,component:weather?.preview?.component||(dates.length>1?'weather-day-buttons':all.length>1?'weather-timeline':'weather-single'),playing:!paused,dragging};}
 return {load(w){weather=w;index=0;fraction=0;last=null;dragging=false;paused=false;resumeAt=0;},
  tick(now){if(last!==null&&!dragging&&!paused&&now>=resumeAt){fraction+=Math.max(0,now-Math.max(last,resumeAt))/((weather?.preview?.seconds_per_period||8)*1000);const n=entries().length;if(n){index=(index+Math.floor(fraction))%n;fraction%=1;}}last=now;return snapshot();},
  seek(value,now=performance.now()){const n=entries().length;index=Math.max(0,Math.min(n-1,Math.round(value)));fraction=0;resumeAt=now+2500;last=now;},
  day(date,now=performance.now()){const i=entries().findIndex(e=>e.date===date);if(i>=0)this.seek(i,now);},
  scrub(on,now=performance.now()){dragging=on;last=now;if(!on)resumeAt=now+2500;},
  toggle(now=performance.now()){paused=!paused;last=now;resumeAt=0;},get state(){return snapshot();}};
}
// World-space controls from the shared spatial UI library (modos-system-design.md 4.4): the Date Picker when the forecast spans days, the
// Playback (Play/Pause, a rail with a stop per entry, the time on the thumb) for the times within the day. Weather has no controls of its
// own; it declares these in its MOD (modos/mods/weather.json `controls.ui`, anchor `user-reach`). Placed by the shared placement rules
// (src/cluster-placement.mjs, design doc 4.5): a generic UI cluster in view, within reach, clear of the answer, locked in the world once
// placed. Pressed by a ray from the pointer (desktop or XR).
export async function createWeatherSurfacePreview(scene,playback,invalidate){
 const THREE=await import('three'),cues=await import('./spatial-ui/cues.mjs'),{userReachPlacement,screenRect,createStay}=await import('./cluster-placement.mjs');
 // an invisible carrier (the agent renderer tints it like the answer); placed on its own, not inside the answer
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1e-4,1e-4),new THREE.MeshBasicMaterial({visible:false}));mesh.name='weather-preview-component';mesh.visible=false;scene.add(mesh);
 const content=new THREE.Group();mesh.add(content);
 const ORIGIN={center:[0,0,0],size:[0,0,0],yaw:0},EYE=new THREE.Vector3(0,0,1);
 let key='',local=[],dayChoices=[],parts=[],hits=[],rail=null,height=0,natural={w:.8,h:.2},placedFor=null,placed=null;const stay=createStay();
 function build(s){
  content.clear();parts=[];hits=[];rail=null;
  if(s.component==='weather-day-buttons'&&dayChoices.length>1)parts.push(cues.datePicker(ORIGIN,EYE,{dates:dayChoices,value:s.entry.date,y:.1}));
  if(local.length>1){const p=cues.playback(ORIGIN,EYE,{stops:local.map(v=>v.e.local_time||v.e.period),index:Math.max(0,local.findIndex(v=>v.index===s.index)),playing:s.playing,y:-.04});parts.push(p);rail=p.group;}
  for(const p of parts)content.add(p.group);
  content.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(content),size=b.getSize(new THREE.Vector3());natural={w:Math.max(.2,size.x),h:Math.max(.05,size.y)};
  content.position.set(-(b.min.x+b.max.x)/2,-(b.min.y+b.max.y)/2,0);
  content.traverse(o=>{if(o.userData.action)hits.push(o);});
 }
 function update(widget,camera){const s=playback.state;mesh.visible=!!widget?.visible&&s.total>1&&s.component!=='weather-single';if(!mesh.visible){placedFor=null;return 0;}
  local=s.entries.map((e,index)=>({e,index})).filter(({e})=>s.component!=='weather-day-buttons'||e.date===s.entry.date);
  const day=s.dates.indexOf(s.entry.date),start=Math.max(0,Math.min(s.dates.length-3,day-1));dayChoices=s.component==='weather-day-buttons'?s.dates.slice(start,start+3):[];
  const k=[s.component,dayChoices.join(),s.entry.date,s.index,s.playing].join('|');if(k!==key){key=k;build(s);}
  // placed once per answer (user-reach, clear of the answer text), then locked; placed again only after a while out of view
  // the answer's pose is part of the key: the text often gets its spot after the controls, and the controls then move clear of it once
  const pose=widget.userData.pose,owner=`${widget.userData.response?.id??widget.id}|${pose?.position?.toArray().map(v=>v.toFixed(2)).join(',')}`;
  if(camera&&(placedFor!==owner||!stay.stays(camera,placed.position))){
    widget.updateMatrixWorld(true);placed=userReachPlacement(camera,natural,{avoid:[screenRect(camera,widget)]});placedFor=owner;stay.reset();}
  if(placed){mesh.quaternion.copy(placed.quaternion);mesh.scale.setScalar(placed.scale);mesh.position.copy(placed.position);height=natural.h*placed.scale;}
  delete mesh.userData.responseOffset;mesh.userData.owner=widget;mesh.userData.height=height;mesh.userData.placement=placed&&{fallback:placed.fallback};
  for(const p of parts)p.update(performance.now());mesh.updateMatrixWorld(true);return 0;
 }
 function act(h,drag=false){const a=drag?{kind:'scrub'}:h.object.userData.action;if(!a)return;
  if(a.kind==='date')playback.day(a.value);else if(a.kind==='play'||a.kind==='pause')playback.toggle();
  else if(rail){const r=rail.userData.rail,x=rail.worldToLocal(h.point.clone()).x,t=Math.max(0,Math.min(1,(x-r.x0)/(r.x1-r.x0)));playback.seek(local[Math.round(t*(local.length-1))]?.index||0);}
  invalidate();}
 function hit(ndc,camera,only=null){if(!mesh.visible||!hits.length)return null;const ray=new THREE.Raycaster();ray.setFromCamera(ndc,camera);mesh.updateMatrixWorld(true);
  return ray.intersectObjects(only||hits,false)[0]||null;}
 function attach(element,getCamera){let captured=false;
  const ndc=e=>{const r=element.getBoundingClientRect();return new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);};
  const grips=()=>hits.filter(o=>o.userData.action?.kind==='scrub');
  element.addEventListener('pointerdown',e=>{const h=hit(ndc(e),getCamera());if(!h)return;captured=h.object.userData.action.kind==='scrub';if(captured){playback.scrub(true);element.setPointerCapture(e.pointerId);}act(h);e.preventDefault();e.stopImmediatePropagation();},true);
  element.addEventListener('pointermove',e=>{if(!captured)return;const h=hit(ndc(e),getCamera(),grips());if(h)act(h,true);e.preventDefault();e.stopImmediatePropagation();},true);
  const end=e=>{if(!captured)return;captured=false;playback.scrub(false);e.preventDefault();e.stopImmediatePropagation();};element.addEventListener('pointerup',end,true);element.addEventListener('pointercancel',end,true);
  element.addEventListener('click',e=>{if(hit(ndc(e),getCamera())){e.preventDefault();e.stopImmediatePropagation();}},true);
 }
 return {mesh,update,attach,action(){},dispose(){mesh.removeFromParent();mesh.traverse(o=>{o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose?.();});}};
}
