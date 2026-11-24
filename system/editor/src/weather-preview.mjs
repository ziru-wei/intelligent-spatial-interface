// Script-owned preview controls requested by the agent's structured Weather mod payload.
// Playback opens at the answer's focus (preview.focus: the moment that answers the question, chosen with the data, selectors.mjs) and
// holds there FOCUS_HOLD ms, then plays on from the next moment; with no focus it opens at the first moment.
export const FOCUS_HOLD=3000;
export function createWeatherPlayback(){
 let weather=null,index=0,fraction=0,last=null,dragging=false,paused=false,resumeAt=0;
 const entries=()=>weather?.timeline||weather?.forecast||[];
 function snapshot(){const all=entries();index=Math.min(index,Math.max(0,all.length-1));const entry=all[index],dates=[...new Set(all.map(e=>e.date))];
  return {entry,index,fraction,total:all.length,entries:all,dates,component:weather?.preview?.component||(dates.length>1?'weather-day-buttons':all.length>1?'weather-timeline':'weather-single'),playing:!paused,dragging};}
 return {load(w){weather=w;fraction=0;last=null;dragging=false;paused=false;const f=w?.preview?.focus,i=f?entries().findIndex(e=>e.id===f):-1;index=Math.max(0,i);resumeAt=i>=0?performance.now()+FOCUS_HOLD:0;fraction=i>=0?.999:0;},   // at the focus: the hold, then on to the next
  tick(now){if(last!==null&&!dragging&&!paused&&now>=resumeAt){fraction+=Math.max(0,now-Math.max(last,resumeAt))/((weather?.preview?.seconds_per_period||8)*1000);const n=entries().length;if(n){index=(index+Math.floor(fraction))%n;fraction%=1;}}last=now;return snapshot();},
  seek(value,now=performance.now()){const n=entries().length;index=Math.max(0,Math.min(n-1,Math.round(value)));fraction=0;resumeAt=now+2500;last=now;},
  day(date,now=performance.now()){const i=entries().findIndex(e=>e.date===date);if(i>=0)this.seek(i,now);},
  scrub(on,now=performance.now()){dragging=on;last=now;if(!on)resumeAt=now+2500;},
  toggle(now=performance.now()){paused=!paused;last=now;resumeAt=0;},get state(){return snapshot();}};
}
// World-space controls from the shared spatial UI library (modos-system-design.md 4.4): the Date Picker when the forecast spans days, the
// Playback (Play/Pause, a rail with a stop per entry, the time on the thumb) for the times within the day. Weather has no controls of its
// own; it declares these in its MOD (modos/mods/weather.json `controls.ui`). The weather is no thing in the room, so they are on the
// view stack (src/cluster-placement.mjs, design doc 4.5): fixed in the user's view, above the answer's text, never over it. Pressed by a
// ray from the pointer (desktop or XR).
export async function createWeatherSurfacePreview(scene,playback,invalidate){
 const THREE=await import('three'),cues=await import('./spatial-ui/cues.mjs'),{viewAnchor,STACK}=await import('./cluster-placement.mjs'),{createCueSet}=await import('./spatial-ui/cue-set.mjs');
 // an invisible carrier (the agent renderer tints it like the answer); placed on its own, not inside the answer
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1e-4,1e-4),new THREE.MeshBasicMaterial({visible:false}));mesh.name='weather-preview-component';mesh.visible=false;scene.add(mesh);
 const content=new THREE.Group();mesh.add(content);const set=createCueSet(content);
 const ORIGIN={center:[0,0,0],size:[0,0,0],yaw:0},EYE=new THREE.Vector3(0,0,1);
 let key='',local=[],dayChoices=[],hits=[],rail=null,height=0,natural={w:.8,h:.2};
 // Date Picker and Playback, each kept while its own data is the same (a step of the playback leaves the date picker as it is)
 function build(s){
  const specs=[];
  if(s.component==='weather-day-buttons'&&dayChoices.length>1)specs.push({key:'datePicker',props:{dates:dayChoices,value:s.entry.date,y:.1},make:p=>cues.datePicker(ORIGIN,EYE,p)});
  if(local.length>1)specs.push({key:'playback',props:{stops:local.map(v=>v.e.local_time||v.e.period),index:Math.max(0,local.findIndex(v=>v.index===s.index)),playing:s.playing,y:-.04},make:p=>cues.playback(ORIGIN,EYE,p)});
  set.update(specs);rail=set.get('playback')?.group||null;
  // measured on its own (not where the carrier stands)
  mesh.remove(content);content.position.set(0,0,0);content.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(content);mesh.add(content);const size=b.getSize(new THREE.Vector3());natural={w:Math.max(.2,size.x),h:Math.max(.05,size.y)};
  content.position.set(-(b.min.x+b.max.x)/2,-(b.min.y+b.max.y)/2,0);
  hits=[];content.traverse(o=>{if(o.userData.action)hits.push(o);});
 }
 /** Shown and placed for this frame; `bottom`: the top of what stands in view below it. Returns the view
  *  stack's new top. */
 function update(widget,camera,bottom=null,scale=1){const s=playback.state;mesh.visible=!!widget?.visible&&s.total>1&&s.component!=='weather-single';if(!mesh.visible)return bottom;
  local=s.entries.map((e,index)=>({e,index})).filter(({e})=>s.component!=='weather-day-buttons'||e.date===s.entry.date);
  const day=s.dates.indexOf(s.entry.date),start=Math.max(0,Math.min(s.dates.length-3,day-1));dayChoices=s.component==='weather-day-buttons'?s.dates.slice(start,start+3):[];
  const k=[s.component,dayChoices.join(),s.entry.date,s.index,s.playing].join('|');if(k!==key){key=k;build(s);}
  // on the view stack: its bottom just above `bottom` (what already stands in view), centred, following the camera every frame
  let top=bottom;if(camera){const a=viewAnchor(camera,(bottom??STACK.base)+STACK.gap),k=STACK.distance*STACK.scale*scale;height=natural.h*k;
    mesh.quaternion.copy(a.quaternion);mesh.scale.setScalar(k);mesh.position.copy(a.point).addScaledVector(a.up,height/2);top=a.top(height);}
  delete mesh.userData.responseOffset;mesh.userData.owner=widget;mesh.userData.height=height;mesh.userData.placement={kind:'view-stack'};
  for(const p of set.parts)p.update(performance.now());mesh.updateMatrixWorld(true);return top;
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
  let took=false;   // the click after a press a control took is swallowed too (see src/action-cues.mjs)
  element.addEventListener('pointerdown',e=>{const h=hit(ndc(e),getCamera());took=!!h;if(!h)return;captured=h.object.userData.action.kind==='scrub';if(captured){playback.scrub(true);element.setPointerCapture(e.pointerId);}act(h);e.preventDefault();e.stopImmediatePropagation();},true);
  element.addEventListener('pointermove',e=>{if(!captured)return;const h=hit(ndc(e),getCamera(),grips());if(h)act(h,true);e.preventDefault();e.stopImmediatePropagation();},true);
  const end=e=>{if(!captured)return;captured=false;playback.scrub(false);e.preventDefault();e.stopImmediatePropagation();};element.addEventListener('pointerup',end,true);element.addEventListener('pointercancel',end,true);
  element.addEventListener('click',e=>{if(took||hit(ndc(e),getCamera())){took=false;e.preventDefault();e.stopImmediatePropagation();}},true);
 }
 return {mesh,update,attach,action(){},dispose(){mesh.removeFromParent();mesh.traverse(o=>{o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose?.();});}};
}
