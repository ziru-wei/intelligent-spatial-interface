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
export function createWeatherPreview(container,playback,invalidate){
 let key='',slider,days,play,label,local=[];
 function render(info){
  if(!info){container.hidden=true;return;}const state=info.playback||playback.state;container.hidden=state.component==='weather-single'||state.total<2;if(container.hidden)return;
  const next=state.component+':'+state.entries.map(e=>e.id).join('|');
  if(key!==next){key=next;container.replaceChildren();days=document.createElement('div');days.className='weather-days';days.setAttribute('role','group');days.setAttribute('aria-label','Preview date');
   if(state.component==='weather-day-buttons')for(const date of state.dates){const button=document.createElement('button');button.type='button';button.textContent=date.slice(5).replace('-','/');button.dataset.date=date;button.onclick=()=>{playback.day(date);invalidate();};days.append(button);}container.append(days);
   const row=document.createElement('div');row.className='weather-preview-row';play=document.createElement('button');play.type='button';play.onclick=()=>{playback.toggle();invalidate();};
   slider=document.createElement('input');slider.type='range';slider.step='any';slider.min='0';slider.setAttribute('aria-label','Preview weather time');
   slider.onpointerdown=()=>playback.scrub(true);slider.onpointerup=slider.onpointercancel=slider.onblur=()=>playback.scrub(false);
   slider.oninput=()=>{const i=Math.round(Number(slider.value));playback.seek(local[i]?.index||0);invalidate();};slider.onchange=()=>playback.scrub(false);
   row.append(play,slider);label=document.createElement('output');label.className='weather-preview-time';container.append(row,label);
  }
  local=state.entries.map((e,index)=>({e,index})).filter(({e})=>state.component!=='weather-day-buttons'||e.date===state.entry.date);
  slider.max=String(Math.max(0,local.length-1));slider.disabled=local.length<2;if(!state.dragging)slider.value=String(Math.min(local.length-1,Math.max(0,local.findIndex(v=>v.index===state.index))+state.fraction));
  for(const b of days.children)b.setAttribute('aria-pressed',String(b.dataset.date===state.entry.date));play.textContent=state.playing?'Ⅱ':'▶';play.setAttribute('aria-label',state.playing?'Pause weather preview':'Play weather preview');
  label.textContent=`${state.entry.date} · ${state.entry.local_time||state.entry.period} · ${state.entry.summary} · ${state.entry.temp_c} °C`;
 }
 return {render};
}

// World-space controls from the shared spatial UI library (modos-system-design.md 4.4): the Date Picker when the forecast spans days, the
// Playback (Play/Pause, a rail with a stop per entry, the time on the thumb) for the times within the day. Weather has no controls of its
// own; it declares these in its MOD (modos/mods/weather.json `controls.ui`). They sit under the answer, turned the same way, and are
// pressed by a ray from the pointer (desktop or XR).
export async function createWeatherSurfacePreview(scene,playback,invalidate){
 const THREE=await import('three'),cues=await import('./spatial-ui/cues.mjs');
 // an invisible carrier (the agent renderer tints and places it as the answer's footer)
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1e-4,1e-4),new THREE.MeshBasicMaterial({visible:false}));mesh.name='weather-preview-component';mesh.visible=false;scene.add(mesh);
 const content=new THREE.Group();mesh.add(content);
 const ORIGIN={center:[0,0,0],size:[0,0,0],yaw:0},EYE=new THREE.Vector3(0,0,1);
 let key='',local=[],dayChoices=[],parts=[],hits=[],rail=null,height=0,natural={w:.8,h:.2};
 function build(s){
  content.clear();parts=[];hits=[];rail=null;
  if(s.component==='weather-day-buttons'&&dayChoices.length>1)parts.push(cues.datePicker(ORIGIN,EYE,{dates:dayChoices,value:s.entry.date,y:.1}));
  if(local.length>1){const p=cues.playback(ORIGIN,EYE,{stops:local.map(v=>v.e.local_time||v.e.period),index:Math.max(0,local.findIndex(v=>v.index===s.index)),playing:s.playing,y:-.04});parts.push(p);rail=p.group;}
  for(const p of parts)content.add(p.group);
  content.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(content),size=b.getSize(new THREE.Vector3());natural={w:Math.max(.2,size.x),h:Math.max(.05,size.y)};
  content.position.set(-(b.min.x+b.max.x)/2,-(b.min.y+b.max.y)/2,0);
  content.traverse(o=>{if(o.userData.action)hits.push(o);});
 }
 function update(widget){const s=playback.state;mesh.visible=!!widget?.visible&&s.total>1&&s.component!=='weather-single';if(!mesh.visible)return 0;
  local=s.entries.map((e,index)=>({e,index})).filter(({e})=>s.component!=='weather-day-buttons'||e.date===s.entry.date);
  const day=s.dates.indexOf(s.entry.date),start=Math.max(0,Math.min(s.dates.length-3,day-1));dayChoices=s.component==='weather-day-buttons'?s.dates.slice(start,start+3):[];
  const k=[s.component,dayChoices.join(),s.entry.date,s.index,s.playing].join('|');if(k!==key){key=k;build(s);}
  // in the footer the answer keeps free for it (src/agent.mjs), as wide as the answer allows
  const scale=Math.min(widget.userData.width*.875/natural.w,widget.userData.width*.3/natural.h);height=natural.h*scale;
  mesh.quaternion.copy(widget.quaternion);mesh.scale.setScalar(scale);
  mesh.userData.responseOffset=new THREE.Vector3(0,-widget.userData.height/2+widget.userData.width*32/1024+height/2,.012);
  mesh.position.copy(widget.position).add(mesh.userData.responseOffset.clone().applyQuaternion(mesh.quaternion));mesh.userData.owner=widget;mesh.userData.height=height;
  for(const p of parts)p.update(performance.now());mesh.updateMatrixWorld(true);return height+.025;
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
