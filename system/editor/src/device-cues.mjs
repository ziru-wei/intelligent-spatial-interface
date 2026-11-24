// IoTControl's controls as spatial cues on the device (modos-system-design.md 3.7, 4.4). Each of the device's Inputs and Outputs is one
// value; the MOD's declaration (its `controls` slot's `ui`) says by rule which cue a value gets — a level being changed gets a Slider,
// a task a Progress Rail, a command an Icon Button from the presets (modos/buttons.json) or a Text Button when none fits. The same rules
// serve a lamp, a printer or a washer. The cues stack on the device: a task's rail on top, the buttons above it; the slider on its
// right edge, readings pinned beside it, choices along its bottom edge. These Adjust cues change the device (POST /api/modos/devices): a
// press sends at once; the Slider previews while dragged and sends when the user lets go. A device that was out of view when the question
// was asked (a lamp behind the user) has nothing in view to carry its controls: they go on the view stack (src/cluster-placement.mjs),
// fixed in the user's view above the answer's text, and stay there for that answer.
import * as THREE from 'three';
import {viewAnchor,STACK} from './cluster-placement.mjs';
import * as cues from './spatial-ui/cues.mjs';
import {currentMeta,modsRevision} from './current-mods.mjs';
import {holds} from '../modos/ui-rules.mjs';
import {createCueSet} from './spatial-ui/cue-set.mjs';

let PRESETS=[];fetch(new URL('../modos/buttons.json',import.meta.url)).then(r=>r.json()).then(j=>{PRESETS=j.presets||[];}).catch(()=>{});
const word=s=>String(s).replace(/_/g,' ').replace(/^\w/,c=>c.toUpperCase());
/** The preset button for an action on an input, or null (the system then writes a text-only button). */
function presetFor(key,inp,cmd){
  const op=inp.type==='toggle'?`set:${key}:${inp.value==='on'?'false':'true'}`:cmd;
  return PRESETS.find(p=>(p.ops||[]).includes(op))||null;
}

/** The values of a device and the facts each is decided on. */
function valuesOf(c,facts){
  const out=[],asked=facts.intent||'read';
  for(const [key,inp] of Object.entries(c.inputs||{})){
    // an answer that changed one input is about that input; the others are only shown as they are
    const intent=asked==='change'&&(!c.changed||c.changed===key)?'change':'read';
    if(inp.type==='command')for(const cmd of inp.commands||[]){const preset=presetFor(key,inp,cmd);
      out.push({key,v:inp,cmd,preset,facts:{...facts,'value.type':'command','value.io':'input',intent,'preset.found':!!preset}});}
    else{const preset=inp.type==='toggle'?presetFor(key,inp):null;
      out.push({key,v:inp,preset,facts:{...facts,'value.type':inp.type,'value.io':'input',intent,'preset.found':!!preset}});}
  }
  for(const [key,o] of Object.entries(c.outputs||{}))out.push({key,v:o,facts:{...facts,'value.type':o.type,'value.io':'output',intent:'read'}});
  return out;
}

// In the view stack the cues are built around a stand-in box seen from straight ahead, at the distance they were sized for.
const STAND_IN={center:[0,0,0],size:[.12,.08,.02],yaw:0},STAND_IN_EYE=new THREE.Vector3(0,0,1.1);
/** Whether a point is in the view of a camera. */
function inView(camera,point){const p=new THREE.Vector3(...point).project(camera);return p.z<1&&Math.abs(p.x)<=1&&Math.abs(p.y)<=1;}

export function createDeviceCues(){
  const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));{const l=new THREE.DirectionalLight(0xffffff,1.6);l.position.set(.4,1,1.2);scene.add(l);}
  let c=null,ui=null,facts={},key=null,space=null,shownAt=0,changeAt=0,seenFrom=null,onChange=()=>{},fixed=false,natural=null,builtFor='';
  const root=new THREE.Group();scene.add(root);const set=createCueSet(root);
  async function press(action){
    if(!c)return;
    const r=await fetch(new URL('/api/modos/devices',location.href),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({space,id:c.device.id,...action})});
    const j=await r.json();if(!r.ok)return;
    // the user's own change: shown as it now is, with no transition (that is for showing what the answer changed)
    c={...c,before:null,inputs:j.device.inputs,outputs:j.device.outputs,changed:null};changeAt=0;build();onChange();
  }
  // What should stand: a cue per value, as the declaration's rules say, keyed by the value; what stacks above the device (a task's rail,
  // the buttons in a row, alerts) is one cue. Each is kept while its data is the same (src/spatial-ui/cue-set.mjs).
  function build(){
    const box=fixed?STAND_IN:c.device,eye=fixed?STAND_IN_EYE:seenFrom,d=eye.distanceTo(new THREE.Vector3(...box.center)),k=Math.min(2.4,Math.max(1,d/1.1));
    const at=(make,grow=false)=>p=>{cues.setScale(k);try{const part=make(p);if(part&&grow)part.group.scale.setScalar(k);return part;}finally{cues.setScale(1);}};
    const flex=ui?.ui?.flexible||[],cueFor=f=>flex.filter(x=>holds(x.when,f)).map(x=>x.cue),specs=[],tags=[],top=[],rev=modsRevision();
    for(const val of valuesOf(c,facts)){
      const was=c.before?.inputs?.[val.key]?.value,when=c.changed===val.key?changeAt:0,name=word(val.key).toLowerCase();
      for(const cue of cueFor(val.facts)){
        if(cue==='slider')specs.push({key:`slider:${val.key}`,props:{value:Number(val.v.value),min:val.v.min??0,max:val.v.max??100,name,unit:val.v.unit==='%'?'%':'',from:when&&was!=null?Number(was):null,changeAt:when,rev},
          make:at(p=>cues.edgeBar(box,eye,{...p,onSet:v=>press({key:val.key,op:'set',value:Math.round(v/(val.v.step||1))*(val.v.step||1)})}))});
        else if(cue==='gauge')specs.push({key:`gauge:${val.key}`,props:{value:Number(val.v.value),min:val.v.min??0,max:val.v.max??100,unit:val.v.unit||'',name,rev},make:at(p=>cues.haloDial(box,eye,p))});
        else if(cue==='choice')specs.push({key:`choice:${val.key}`,props:{options:val.v.options||[],value:val.v.value,rev},make:at(p=>cues.choice(box,eye,{...p,onPick:o=>press({key:val.key,op:'set',value:o})}),true)});
        else if(cue==='iconButton'||cue==='textButton')top.push({kind:'button',icon:cue==='iconButton'?val.preset.icon:null,text:cue==='iconButton'?val.preset.label:word(val.cmd||val.key),
          action:val.cmd?{key:val.key,op:'command',value:val.cmd}:{key:val.key,op:'toggle'}});
        else if(cue==='progressRail')top.push({kind:'rail',title:val.v.title,owner:val.v.owner,done:val.v.done,total:val.v.total,unit:val.v.unit});
        else if(cue==='cardStack'&&val.v.items?.length)specs.push({key:`cards:${val.key}`,props:{items:val.v.items.map(i=>`${i.title}${i.total?` · ${i.total} ${i.unit||''}`:''}`),rev},make:at(p=>cues.cardStack(box,eye,p),true)});
        else if(cue==='pinnedTags')tags.push([val.key,`${val.v.value}${val.v.unit?' '+val.v.unit:''}`]);
        else if(cue==='statusPulse')for(const a of val.v.items||[])top.push({kind:'pulse',level:a.level||'attention',message:a.message});
      }
    }
    if(tags.length)specs.push({key:'tags',props:{tags,rev},make:at(p=>cues.pinnedTags(box,eye,p))});
    if(top.length)specs.push({key:'top',props:{top,rev},make:at(p=>stackAbove(box,eye,k,p.top))});
    set.update(specs);
    // its own extent, for the view stack (measured without the placement)
    const saved=[root.position.clone(),root.quaternion.clone(),root.scale.clone()];root.position.set(0,0,0);root.quaternion.identity();root.scale.setScalar(1);root.updateMatrixWorld(true);
    const b=new THREE.Box3().setFromObject(root);natural=b.isEmpty()?null:{x:(b.min.x+b.max.x)/2,y:b.min.y,h:b.max.y-b.min.y};
    root.position.copy(saved[0]);root.quaternion.copy(saved[1]);root.scale.copy(saved[2]);
  }
  // Above the device, one over another: the task's rail and any alerts, then the buttons side by side (turned to the user).
  function stackAbove(box,eye,k,items){
    const g=new THREE.Group(),parts=[],buttons=[];
    for(const it of items){
      if(it.kind==='rail')parts.push(cues.progressRail(box,eye,it,shownAt));
      else if(it.kind==='pulse')parts.push(cues.statusPulse(box,{level:it.level,message:it.message}));
      else buttons.push(cues.iconButton(box,eye,{icon:it.icon,text:it.text,on:true,onPress:()=>press(it.action)}));}
    if(buttons.length){const row=new THREE.Group();row.position.copy(buttons[0].group.position);row.rotation.copy(buttons[0].group.rotation);
      const widths=buttons.map(b=>{b.group.position.set(0,0,0);b.group.rotation.set(0,0,0);return new THREE.Box3().setFromObject(b.group).getSize(new THREE.Vector3()).x;});
      let x=-(widths.reduce((a,b)=>a+b,0)+.02*(widths.length-1))/2;buttons.forEach((b,i)=>{b.group.position.x=x+widths[i]/2;x+=widths[i]+.02;row.add(b.group);});
      parts.push({group:row,update:now=>buttons.forEach(b=>b.update(now))});}
    let y=box.center[1]+box.size[1]/2+.03;
    for(const p of parts){p.group.scale.setScalar(k);g.add(p.group);p.group.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(p.group);p.group.position.y+=y-b.min.y;y+=b.max.y-b.min.y+.02*k;}
    return {group:g,update:(now,camera)=>parts.forEach(p=>p.update(now,camera))};
  }
  return {
    /** What it draws (src/attention.mjs). */
    get root(){return scene;},
    get active(){return !!c;},
    /** For checking: what is drawn and why. */
    get debug(){return {facts,ui,values:c?valuesOf(c,facts).map(v=>[v.key,v.facts]):[],drawn:set.parts.length};},
    /** r: the answer with a control part (null clears it); camera: where its question was asked; spaceName: the space. */
    /** The same answer with new data (its id stays) updates the cues that changed; another answer starts anew. */
    setResponse(r,camera,spaceName){
      const ok=r?.control&&r.control.panel!==false&&r.control.inputs,id=ok?r.id:null;
      if(id!==key){key=id;space=spaceName;builtFor='';if(!ok){c=null;set.clear();return;}
        shownAt=performance.now();camera.updateMatrixWorld(true);seenFrom=camera.position.clone();fixed=!inView(camera,r.control.device.center);   // stays for this answer
        root.position.set(0,0,0);root.quaternion.identity();root.scale.setScalar(1);}
      if(!ok)return;
      const want=JSON.stringify([r.component_key??r.updated_at??r.created,modsRevision()]);if(want===builtFor)return;builtFor=want;
      c=r.control;const m=currentMeta(r.mods?.control||r.mod);ui=Object.values(m?.ui||{}).find(s=>s.use==='control')||{ui:{flexible:[]}};facts=m?.facts||{intent:c.changed?'change':'read'};
      changeAt=c.changed?performance.now()+1300:0;build();   // what the answer changed: seen as it was, then changing
    },
    /** Whether the controls are on the view stack (their device was out of view when asked). */
    get fixed(){return !!c&&fixed;},
    /** On the view stack: place them for this frame just above `bottom` (the top of what stands in view), at the
     *  stack's one size times `scale` (its attention: src/attention.mjs); returns the stack's new top. */
    place(camera,bottom=null,scale=1){
      if(!c||!fixed||!natural)return bottom;const k=STACK.distance/STAND_IN_EYE.z*STACK.scale*scale,a=viewAnchor(camera,(bottom??STACK.base)+STACK.gap);
      root.quaternion.copy(a.quaternion);root.scale.setScalar(k);root.position.copy(a.point).sub(new THREE.Vector3(natural.x,natural.y,0).multiplyScalar(k).applyQuaternion(a.quaternion));
      root.updateMatrixWorld(true);return a.top(natural.h*k);
    },
    render(renderer,camera,now=performance.now()){
      if(!c)return;for(const p of set.parts)p.update(now,fixed?null:camera);
      const auto=renderer.autoClear;renderer.autoClear=false;try{renderer.clearDepth();renderer.render(scene,camera);}finally{renderer.autoClear=auto;}
    },
    attach(element,getCamera,changed=()=>{}){
      onChange=changed;
      const hit=e=>{if(!c)return null;const hits=[];scene.traverse(o=>{if(o.userData.onHit||o.userData.onDrag)hits.push(o);});if(!hits.length)return null;const b=element.getBoundingClientRect(),ray=new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,1-(e.clientY-b.top)/b.height*2),getCamera());scene.updateMatrixWorld(true);return ray.intersectObjects(hits,false)[0]||null;};
      // Adjust: a press sends at once; a drag (Slider) previews on the thing and sends when the user lets go.
      let drag=null;const rayAt=e=>{const b=element.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,1-(e.clientY-b.top)/b.height*2),getCamera());return ray.ray;};
      // a press a control takes is the control's to the end: the click that follows is swallowed too (see src/action-cues.mjs)
      let took=false;
      element.addEventListener('pointerdown',e=>{const h=hit(e);took=!!h;if(!h)return;e.preventDefault();e.stopImmediatePropagation();const u=h.object.userData;
        if(u.onDrag){const cam=getCamera(),n=new THREE.Vector3(0,0,-1).applyQuaternion(cam.quaternion);drag={u,plane:new THREE.Plane().setFromNormalAndCoplanarPoint(n,h.point)};u.onDrag(h.point);element.setPointerCapture?.(e.pointerId);}
        else u.onHit(h.point);changed();},true);
      element.addEventListener('pointermove',e=>{if(!drag)return;const p=rayAt(e).intersectPlane(drag.plane,new THREE.Vector3());if(p)drag.u.onDrag(p);e.preventDefault();e.stopImmediatePropagation();changed();},true);
      const release=e=>{if(!drag)return;const u=drag.u;drag=null;u.onRelease?.();e.preventDefault();e.stopImmediatePropagation();changed();};
      element.addEventListener('pointerup',release,true);element.addEventListener('pointercancel',release,true);
      element.addEventListener('click',e=>{if(took||hit(e)){took=false;e.preventDefault();e.stopImmediatePropagation();}},true);
    },
  };
}
