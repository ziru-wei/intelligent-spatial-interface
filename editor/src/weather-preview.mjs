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

// World-space controls: real round buttons, a raised rail and a spherical thumb.
// The invisible carrier preserves UV ray actions for both desktop and XR pointers.
export async function createWeatherSurfacePreview(scene,playback,invalidate){
 const THREE=await import('three'),ASPECT=.40;
 const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,toneMapped:false}));mesh.material.visible=false;mesh.name='weather-preview-component';mesh.visible=false;scene.add(mesh);
 const bodies=[],labels=[],rings=[],dayButtons=[],daysAt=[-.28,0,.28],trackStart=-.30,trackEnd=.44,trackY=-.045;
 function solid(){const m=new THREE.ShaderMaterial({depthWrite:true,toneMapped:false,uniforms:{tint:{value:new THREE.Color()}},vertexShader:'varying vec3 n;void main(){n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 n;uniform vec3 tint;void main(){vec3 N=normalize(n),L=normalize(vec3(-.45,.65,1.));float diffuse=.62+.38*max(0.,dot(N,L));float shine=pow(max(0.,dot(reflect(-L,N),vec3(0,0,1))),28.)*.18;gl_FragColor=vec4(tint*diffuse+vec3(shine),1.);\n#include <colorspace_fragment>\n}'});return m;}
 function part(geometry,x,y,z,name){const o=new THREE.Mesh(geometry,solid());o.name=name;o.position.set(x,y/ASPECT,z);o.scale.y=1/ASPECT;o.renderOrder=9;o.onBeforeRender=()=>o.material.uniforms.tint.value.copy(mesh.material.color);mesh.add(o);bodies.push(o);return o;}
 function label(width,height,x,y,z,name){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=Math.round(512*height/width);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const o=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,toneMapped:false}));o.position.set(x,y/ASPECT,z);o.scale.y=1/ASPECT;o.name=name;o.renderOrder=12;
  o.onBeforeRender=()=>{const c=mesh.material.color,bright=c.r*.2126+c.g*.7152+c.b*.0722>.24;o.material.color.setRGB(...(bright?[.012,.018,.026]:[.97,.98,1.]));};
  mesh.add(o);labels.push(o);let previous='';
  o.userData.write=(text,small='')=>{const key=text+'|'+small;if(previous===key)return;previous=key;const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);c.fillStyle='white';c.textAlign='center';c.textBaseline='middle';
   if(small){c.font='650 136px system-ui';c.fillText(small,256,120);c.font='700 232px system-ui';c.fillText(text,256,310);}else{c.font=`650 ${Math.round(canvas.height*.72)}px system-ui`;c.fillText(text,256,canvas.height/2);}texture.needsUpdate=true;};return o;
 }
 function button(x,y,r,name){const geometry=new THREE.CylinderGeometry(r*.93,r,.026,48,1);geometry.rotateX(Math.PI/2);const body=part(geometry,x,y,.016,name);const rim=part(new THREE.TorusGeometry(r,.004,10,48),x,y,.032,name+'-rim');const text=label(r*1.65,r*1.65,x,y,.034,name+'-label');return {body,rim,text};}
 for(let i=0;i<3;i++){const b=button(daysAt[i],.075,.072,'weather-date-button');const ring=part(new THREE.TorusGeometry(.083,.005,10,48),daysAt[i],.075,.023,'weather-selected-date');b.ring=ring;rings.push(ring);dayButtons.push(b);}
 const play=button(-.415,trackY,.044,'weather-play-button');play.text.userData.write('Ⅱ');
 const railGeometry=new THREE.CylinderGeometry(.012,.012,trackEnd-trackStart,20);railGeometry.rotateZ(Math.PI/2);const rail=part(railGeometry,(trackStart+trackEnd)/2,trackY,.021,'weather-slider-rail');
 const thumb=part(new THREE.BoxGeometry(.014,.070,.022),trackStart,trackY,.034,'weather-slider-thumb');thumb.renderOrder=10;
 // Time is a large floating label. It uses the text's polarity because it sits directly on the scene.
 const time=label(.25,.068,.075,-.032,.048,'weather-preview-time');time.onBeforeRender=()=>time.material.color.copy(mesh.material.color);
 const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];let dayChoices=[],local=[],height=0;
 mesh.userData.controls3D={dayButtons,play,rail,thumb,time};
 function update(widget){const s=playback.state;mesh.visible=!!widget?.visible&&s.total>1&&s.component!=='weather-single';if(!mesh.visible)return 0;
  const w=widget.userData.width*.875;height=w*ASPECT;mesh.userData.owner=widget;mesh.userData.height=height;mesh.position.copy(widget.position);mesh.quaternion.copy(widget.quaternion);
  mesh.userData.responseOffset=new THREE.Vector3(0,-widget.userData.height/2+widget.userData.width*32/1024+height/2,.012);mesh.position.add(mesh.userData.responseOffset.clone().applyQuaternion(mesh.quaternion));mesh.scale.set(w,height,w);mesh.material.color.copy(widget.userData.text.material.color);
  local=s.entries.map((e,index)=>({e,index})).filter(({e})=>s.component!=='weather-day-buttons'||e.date===s.entry.date);
  const day=s.dates.indexOf(s.entry.date),start=Math.max(0,Math.min(s.dates.length-3,day-1));dayChoices=s.component==='weather-day-buttons'?s.dates.slice(start,start+3):[];
  dayButtons.forEach((b,i)=>{const date=dayChoices[i];b.body.visible=b.rim.visible=b.text.visible=!!date;b.ring.visible=!!date&&date===s.entry.date;if(date){const [,m,d]=date.split('-');b.text.userData.write(String(Number(d)),months[Number(m)-1]);}});
  time.position.y=(trackY-.085)/ASPECT;time.userData.write(s.entry.local_time||s.entry.period);play.text.userData.write(s.playing?'Ⅱ':'▶');
  const k=Math.min(1,(Math.max(0,local.findIndex(v=>v.index===s.index))+s.fraction)/Math.max(1,local.length-1));thumb.position.x=trackStart+(trackEnd-trackStart)*k;time.position.x=thumb.position.x;
  mesh.updateMatrixWorld(true);return height+.025;
 }
 function controlAt(uv){const x=uv.x-.5,y=(uv.y-.5)*ASPECT;
  for(let i=0;i<dayChoices.length;i++)if(Math.hypot(x-daysAt[i],y-.075)<.085)return {kind:'day',index:i};
  if(Math.hypot(x+.415,y-trackY)<.06)return {kind:'play'};
  if(Math.abs(y-trackY)<.055&&x>trackStart-.055)return {kind:'slider'};return null;
 }
 function action(uv,drag=false){const c=drag?{kind:'slider'}:controlAt(uv);if(!c)return;
  if(c.kind==='day')playback.day(dayChoices[c.index]);else if(c.kind==='play')playback.toggle();else{const t=Math.max(0,Math.min(1,(uv.x-.5-trackStart)/(trackEnd-trackStart)));playback.seek(local[Math.round(t*(local.length-1))]?.index||0);}invalidate();}
 function hit(ndc,camera){if(!mesh.visible)return null;const ray=new THREE.Raycaster();ray.setFromCamera(ndc,camera);return ray.intersectObject(mesh,false)[0];}
 function attach(element,getCamera){let captured=false,moved=false;
  const ndc=e=>{const r=element.getBoundingClientRect();return new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);};
  element.addEventListener('pointerdown',e=>{const h=hit(ndc(e),getCamera()),c=h&&controlAt(h.uv);if(!c)return;captured=true;moved=c.kind==='slider';playback.scrub(moved);action(h.uv);element.setPointerCapture(e.pointerId);e.preventDefault();e.stopImmediatePropagation();},true);
  element.addEventListener('pointermove',e=>{if(!captured)return;const h=hit(ndc(e),getCamera());if(h&&moved)action(h.uv,true);e.preventDefault();e.stopImmediatePropagation();},true);
  const end=e=>{if(!captured)return;captured=false;playback.scrub(false);e.preventDefault();e.stopImmediatePropagation();};element.addEventListener('pointerup',end,true);element.addEventListener('pointercancel',end,true);
  element.addEventListener('click',e=>{const h=hit(ndc(e),getCamera());if(h&&controlAt(h.uv)){e.preventDefault();e.stopImmediatePropagation();}},true);
 }
 return {mesh,update,attach,action,dispose(){mesh.removeFromParent();mesh.traverse(o=>{o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose();});}};
}
