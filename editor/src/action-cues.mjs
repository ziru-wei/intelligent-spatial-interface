// A message the user sends through a MOD (Delegate's card slot), composed from the library as the MOD declared it
// (modos-system-design.md 4.4, "Message"): a Contact Chip for who it goes to, the drafted message in a Text Input the user can edit
// (the MOD's text slot, streaming in), what goes with it — the thing itself on a Tether, or a Photo Capture of it with the photo as a
// card — and the Send preset button. They stand as one column beside the thing, where all of it is in view, turned to the user; with
// nothing attached, in front of the user. Nothing is sent until Send is pressed (POST /api/modos/actions, mock: the space's outbox).
import * as THREE from 'three';
import * as cues from './spatial-ui/cues.mjs';
import {besidePlacement} from './beside.mjs';
import {partsToDraw} from '../modos/ui-rules.mjs';

let SEND={icon:'➤',label:'Send'};
fetch(new URL('../modos/buttons.json',import.meta.url)).then(r=>r.json()).then(j=>{SEND=j.presets.find(p=>p.id==='send')||SEND;}).catch(()=>{});
const initials=name=>String(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('');
const DEFAULT_UI={fixed:['contactChip','textInput','iconButton:send'],flexible:[{cue:'tetherSend',when:'attachment.kind=thing|photo'},{cue:'photoCapture',when:'attachment.kind=photo'}]};

/** getSnapshot(box, camera): the camera frame cropped to a thing (a canvas), for a photo of it. */
export function createActionCues({getSnapshot=()=>null}={}){
  const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));{const l=new THREE.DirectionalLight(0xffffff,1.6);l.position.set(.4,1,1.2);scene.add(l);}
  let a=null,key=null,space=null,cam=null,eye=null,front=null,parts=[],facts={},draft={title:'',body:''},edited=null,status='draft',editing=false,photo=null,flashAt=0;
  let drawn=[],hits=[],builtFor='',onChange=()=>{},input=null;
  const message=()=>edited||draft;
  async function confirm(){
    if(!a||status!=='draft')return;status='sending';stopEditing();build();onChange();
    const body={space,action:a,message:{...message(),...(photo?{photo:photo.toDataURL('image/jpeg',.85)}:{})}};
    try{const r=await fetch(new URL('/api/modos/actions',location.href),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});status=r.ok?'sent':'draft';}catch{status='draft';}
    build();onChange();
  }
  // Editing: the field takes the keyboard (on a headset, the system keyboard or dictation); the text changes in place as it is typed.
  function startEditing(){
    if(status!=='draft')return;editing=true;
    if(!input){input=document.createElement('textarea');input.setAttribute('aria-label','Message');Object.assign(input.style,{position:'fixed',left:'-9999px',top:'0',opacity:'0'});document.body.append(input);
      input.addEventListener('input',()=>{edited={...message(),body:input.value};build();onChange();});
      input.addEventListener('keydown',e=>{if(e.key==='Escape'||(e.key==='Enter'&&!e.shiftKey)){e.preventDefault();input.blur();}});
      input.addEventListener('blur',()=>{if(editing){editing=false;build();onChange();}});}
    input.value=message().body;input.focus();build();onChange();
  }
  function stopEditing(){if(editing){editing=false;input?.blur();}}
  function build(){
    scene.clear();scene.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));drawn=[];hits=[];
    const thing=a.attachment?.center&&a.capture!=='none'?a.attachment:null,anchor=thing||front;
    const d=eye.distanceTo(new THREE.Vector3(...anchor.center)),k=Math.min(2.4,Math.max(1,d/1.1));cues.setScale(1);
    // the column, built at the origin: who, the photo, the message, Send
    const col=new THREE.Group(),items=[],sent=status==='sent',msg=message();
    if(parts.includes('contactChip'))items.push(cues.contactChip({name:a.to.name,initials:initials(a.to.name),sub:a.to.email,selected:true}));
    if(parts.includes('photoCapture')&&photo)items.push(cues.photoCard(photo,{width:.2,label:`photo of ${a.attachment.label}`}));
    if(parts.includes('textInput'))items.push(cues.textInput({title:msg.title,body:msg.body,width:.36,editing,placeholder:'writing…',onEdit:sent?null:startEditing}));
    items.push(cues.iconButton({center:[0,0,0],size:[0,0,0],yaw:0},new THREE.Vector3(0,0,1),{icon:sent?'✓':SEND.icon,text:sent?'Sent':status==='sending'?'Sending…':SEND.label,
      on:!sent&&status!=='sending',onPress:sent?null:confirm}));
    const send=items.at(-1);send.group.position.set(0,0,0);send.group.rotation.set(0,0,0);
    let y=0;const gap=.018;
    for(const it of items){const h=it.height??new THREE.Box3().setFromObject(it.group).getSize(new THREE.Vector3()).y;it.group.position.y=y-h/2;
      // chips and the button line up on the left edge of the field
      const w=it.width??new THREE.Box3().setFromObject(it.group).getSize(new THREE.Vector3()).x;it.group.position.x=-.18+w/2;y-=h+gap;col.add(it.group);drawn.push(it);}
    const height=-y,place=thing?besidePlacement(cam,thing,{width:.4*k,height:height*k}):{position:new THREE.Vector3(...front.center),yaw:Math.atan2(eye.x-front.center[0],eye.z-front.center[2])};
    col.position.copy(place.position).add(new THREE.Vector3(0,height*k/2,0));col.rotation.set(0,place.yaw,0);col.scale.setScalar(k);scene.add(col);
    // what goes with it: a tether from the thing to whom it goes; for a photo, the thing is framed and the shutter flashes
    col.updateMatrixWorld(true);
    if(thing&&parts.includes('tetherSend')){const chip=items[0].group,to=new THREE.Vector3(-items[0].width/2,0,0).applyMatrix4(chip.matrixWorld);
      const t=cues.tetherSend(thing,eye,{to:a.to.name,sent,toPoint:to});scene.add(t.group);drawn.push(t);}
    if(thing&&parts.includes('photoCapture')){const p=cues.photoCapture(thing,{flashAt});scene.add(p.group);drawn.push(p);}
    scene.traverse(o=>{if(o.userData.onHit)hits.push(o);});
  }
  return {
    get active(){return !!a;},confirm,
    /** r: the answer with an action part and its draft (title, body); camera: where its question was asked; spaceName: the space. */
    setResponse(r,camera,spaceName){
      const k=r?.action?`${r.id}@${r.created}`:null;
      if(k!==key){key=k;a=r?.action||null;edited=null;status='draft';editing=false;space=spaceName;builtFor='';photo=null;
        if(!a){scene.clear();drawn=[];hits=[];return;}
        const m=r.mods?.action||r.mod,slot=Object.values(m?.ui||{}).find(s=>s.use==='action-card');
        facts={...(m?.facts||{}),'attachment.kind':a.capture||(a.attachment?'thing':'none')};parts=partsToDraw(slot?.ui||DEFAULT_UI,facts);
        camera.updateMatrixWorld(true);cam=camera.clone();eye=camera.position.clone();
        const f=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);f.y=0;f.normalize();const p=eye.clone().addScaledVector(f,.8);
        front={center:p.toArray(),size:[.01,.01,.01],yaw:0};
        if(parts.includes('photoCapture')&&a.attachment?.center){photo=getSnapshot(a.attachment,camera);flashAt=performance.now()+500;}}
      if(a){draft={title:r.title||'',body:r.body||''};const b=JSON.stringify([draft.title,draft.body]);if(b!==builtFor){builtFor=b;build();}}
    },
    render(renderer,camera,now=performance.now()){
      if(!a)return;for(const p of drawn)p.update(now,camera);
      const auto=renderer.autoClear;renderer.autoClear=false;try{renderer.clearDepth();renderer.render(scene,camera);}finally{renderer.autoClear=auto;}
    },
    attach(element,getCamera,changed=()=>{}){
      onChange=changed;
      const hit=e=>{if(!a||!hits.length)return null;const b=element.getBoundingClientRect(),ray=new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,1-(e.clientY-b.top)/b.height*2),getCamera());scene.updateMatrixWorld(true);return ray.intersectObjects(hits,false)[0]||null;};
      element.addEventListener('pointerdown',e=>{const h=hit(e);if(!h)return;e.preventDefault();e.stopImmediatePropagation();h.object.userData.onHit(h.point);changed();},true);
      element.addEventListener('click',e=>{if(hit(e)){e.preventDefault();e.stopImmediatePropagation();}},true);
    },
  };
}
