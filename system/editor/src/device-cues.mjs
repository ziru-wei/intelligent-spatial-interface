// IoTControl's controls as spatial cues on the device (modos-system-design.md 3.7, 4.4). Each of the device's Inputs and Outputs is one
// value; the MOD's declaration (its `controls` slot's `ui`) says by rule which cue a value gets — a level being changed gets a Slider,
// a task a Progress Rail, a command an Icon Button from the presets (modos/buttons.json) or a Text Button when none fits. The same rules
// serve a lamp, a printer or a washer. The cues stack on the device: a task's rail on top, the buttons above it; the slider on its
// right edge, readings pinned beside it, choices along its bottom edge. These Adjust cues change the device (POST /api/modos/devices): a
// press sends at once; the Slider previews while dragged and sends when the user lets go.
import * as THREE from 'three';
import * as cues from './spatial-ui/cues.mjs';
import {holds} from '../modos/ui-rules.mjs';

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

export function createDeviceCues(){
  const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));{const l=new THREE.DirectionalLight(0xffffff,1.6);l.position.set(.4,1,1.2);scene.add(l);}
  let c=null,ui=null,facts={},key=null,space=null,shownAt=0,changeAt=0,eye=null,drawn=[],hits=[],onChange=()=>{};
  async function press(action){
    if(!c)return;
    const r=await fetch(new URL('/api/modos/devices',location.href),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({space,id:c.device.id,...action})});
    const j=await r.json();if(!r.ok)return;
    c={...c,before:{inputs:c.inputs,outputs:c.outputs},inputs:j.device.inputs,outputs:j.device.outputs,changed:action.key};changeAt=performance.now();build();onChange();
  }
  function build(){
    scene.clear();scene.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));drawn=[];hits=[];
    const box=c.device,d=eye.distanceTo(new THREE.Vector3(...box.center)),k=Math.min(2.4,Math.max(1,d/1.1));cues.setScale(k);
    const top=[],buttons=[],add=(part,grow=false)=>{if(!part)return;if(grow)part.group.scale.setScalar(k);scene.add(part.group);drawn.push(part);return part;};
    const flex=ui?.ui?.flexible||[],cueFor=f=>flex.filter(x=>holds(x.when,f)).map(x=>x.cue);
    const tags=[];
    for(const val of valuesOf(c,facts)){
      const was=c.before?.inputs?.[val.key]?.value,at=c.changed===val.key?changeAt:0;
      for(const cue of cueFor(val.facts)){
        if(cue==='slider')add(cues.edgeBar(box,eye,{value:Number(val.v.value),min:val.v.min??0,max:val.v.max??100,name:word(val.key).toLowerCase(),unit:val.v.unit==='%'?'%':'',
          from:at&&was!=null?Number(was):null,changeAt:at,onSet:v=>press({key:val.key,op:'set',value:Math.round(v/(val.v.step||1))*(val.v.step||1)})}));
        else if(cue==='gauge')add(cues.haloDial(box,eye,{value:Number(val.v.value),min:val.v.min??0,max:val.v.max??100,unit:val.v.unit||'',name:word(val.key).toLowerCase()}));
        else if(cue==='edgeTabs')add(cues.edgeTabs(box,eye,{options:val.v.options||[],value:val.v.value,onPick:o=>press({key:val.key,op:'set',value:o})}),true);
        else if(cue==='iconButton'||cue==='textButton'){
          const action=val.cmd?{key:val.key,op:'command',value:val.cmd}:{key:val.key,op:'toggle'};
          buttons.push(cues.iconButton(box,eye,{icon:cue==='iconButton'?val.preset.icon:null,text:cue==='iconButton'?val.preset.label:word(val.cmd||val.key),on:true,onPress:()=>press(action)}));}
        else if(cue==='progressRail')top.push(cues.progressRail(box,eye,{title:val.v.title,owner:val.v.owner,done:val.v.done,total:val.v.total,unit:val.v.unit},shownAt));
        else if(cue==='cardStack'&&val.v.items?.length)add(cues.cardStack(box,eye,{items:val.v.items.map(i=>`${i.title}${i.total?` · ${i.total} ${i.unit||''}`:''}`)}),true);
        else if(cue==='pinnedTags')tags.push([val.key,`${val.v.value}${val.v.unit?' '+val.v.unit:''}`]);
        else if(cue==='statusPulse')for(const a of val.v.items||[])top.push(cues.statusPulse(box,{level:a.level||'attention',message:a.message}));
      }
    }
    if(tags.length)add(cues.pinnedTags(box,eye,{tags}));
    // the buttons side by side in one row, turned to the user
    if(buttons.length){const row=new THREE.Group();row.position.copy(buttons[0].group.position);row.rotation.copy(buttons[0].group.rotation);
      const widths=buttons.map(b=>{b.group.position.set(0,0,0);b.group.rotation.set(0,0,0);return new THREE.Box3().setFromObject(b.group).getSize(new THREE.Vector3()).x;});
      let x=-(widths.reduce((a,b)=>a+b,0)+.02*(widths.length-1))/2;buttons.forEach((b,i)=>{b.group.position.x=x+widths[i]/2;x+=widths[i]+.02;row.add(b.group);});
      top.push({group:row,update:now=>buttons.forEach(b=>b.update(now))});}
    // stack above the device: the rail, then the buttons, then any alerts
    let y=box.center[1]+box.size[1]/2+.03;
    for(const p of top){p.group.scale.setScalar(k);scene.add(p.group);p.group.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(p.group);p.group.position.y+=y-b.min.y;y+=b.max.y-b.min.y+.02*k;drawn.push(p);}
    cues.setScale(1);
    scene.traverse(o=>{if(o.userData.onHit||o.userData.onDrag)hits.push(o);});
  }
  return {
    get active(){return !!c;},
    /** For checking: what is drawn and why. */
    get debug(){return {facts,ui,values:c?valuesOf(c,facts).map(v=>[v.key,v.facts]):[],drawn:drawn.length,hits:hits.length};},
    /** r: the answer with a control part (null clears it); camera: where its question was asked; spaceName: the space. */
    setResponse(r,camera,spaceName){
      const k=r?.control?`${r.id}@${r.created}`:null;if(k===key)return;key=k;space=spaceName;
      if(!r?.control||r.control.panel===false||!r.control.inputs){c=null;scene.clear();drawn=[];hits=[];return;}
      c=r.control;const m=r.mods?.control||r.mod;ui=Object.values(m?.ui||{}).find(s=>s.use==='control')||{ui:{flexible:[]}};facts=m?.facts||{intent:c.changed?'change':'read'};
      shownAt=performance.now();changeAt=c.changed?shownAt+1300:0;camera.updateMatrixWorld(true);eye=camera.position.clone();build();   // seen as it was, then changing
    },
    render(renderer,camera,now=performance.now()){
      if(!c)return;for(const p of drawn)p.update(now,camera);
      const auto=renderer.autoClear;renderer.autoClear=false;try{renderer.clearDepth();renderer.render(scene,camera);}finally{renderer.autoClear=auto;}
    },
    attach(element,getCamera,changed=()=>{}){
      onChange=changed;
      const hit=e=>{if(!c||!hits.length)return null;const b=element.getBoundingClientRect(),ray=new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,1-(e.clientY-b.top)/b.height*2),getCamera());scene.updateMatrixWorld(true);return ray.intersectObjects(hits,false)[0]||null;};
      // Adjust: a press sends at once; a drag (Slider) previews on the thing and sends when the user lets go.
      let drag=null;const rayAt=e=>{const b=element.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,1-(e.clientY-b.top)/b.height*2),getCamera());return ray.ray;};
      element.addEventListener('pointerdown',e=>{const h=hit(e);if(!h)return;e.preventDefault();e.stopImmediatePropagation();const u=h.object.userData;
        if(u.onDrag){const cam=getCamera(),n=new THREE.Vector3(0,0,-1).applyQuaternion(cam.quaternion);drag={u,plane:new THREE.Plane().setFromNormalAndCoplanarPoint(n,h.point)};u.onDrag(h.point);element.setPointerCapture?.(e.pointerId);}
        else u.onHit(h.point);changed();},true);
      element.addEventListener('pointermove',e=>{if(!drag)return;const p=rayAt(e).intersectPlane(drag.plane,new THREE.Vector3());if(p)drag.u.onDrag(p);e.preventDefault();e.stopImmediatePropagation();changed();},true);
      const release=e=>{if(!drag)return;const u=drag.u;drag=null;u.onRelease?.();e.preventDefault();e.stopImmediatePropagation();changed();};
      element.addEventListener('pointerup',release,true);element.addEventListener('pointercancel',release,true);
      element.addEventListener('click',e=>{if(hit(e)){e.preventDefault();e.stopImmediatePropagation();}},true);
    },
  };
}
