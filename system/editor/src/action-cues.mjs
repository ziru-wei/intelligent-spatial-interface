// A message the user sends through a MOD (Send's card slot), composed from the library as the MOD declared it (modos-system-design.md
// 4.4): a Choice of who it goes to (the best match chosen; the other contacts in its dropdown), the drafted message in a Text Input the
// user can edit (the MOD's text slot, streaming in), an AR Photo when a photo of the thing goes with it, and the Send preset button. They
// stand as one column beside the thing, where all of it is in view, turned to the user; with nothing attached, in front of the user. The
// thing that goes with the message is marked with the library's Mark (Corner Brackets on something with content, else Breathing Box).
// Nothing is sent until Send is pressed (POST /api/modos/actions, mock: the space's outbox).
import * as THREE from 'three';
import * as cues from './spatial-ui/cues.mjs';
import {currentMeta} from './current-mods.mjs';
import {besidePlacement} from './beside.mjs';
import {partsToDraw} from '../modos/ui-rules.mjs';

let SEND={icon:'➤',label:'Send'};
fetch(new URL('../modos/buttons.json',import.meta.url)).then(r=>r.json()).then(j=>{SEND=j.presets.find(p=>p.id==='send')||SEND;}).catch(()=>{});
const initials=name=>String(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('');
const DEFAULT_UI={fixed:['choice','textInput','iconButton:send'],flexible:[{cue:'cornerBrackets',when:'attachment.kind=thing|photo & target.has_content'},{cue:'breathingBox',when:'attachment.kind=thing|photo & !target.has_content'},{cue:'arPhoto',when:'attachment.kind=photo'}]};

// The AR Photo is the frame as drawn, cropped to the thing: video, and the mark on it (the photo is taken right after the marks are drawn
// and before the column, in the same frame, so the drawing buffer still holds them).
function cropDrawn(canvas,box,camera){
  const c=new THREE.Vector3(...box.center),h=box.size.map(v=>v/2*1.2),pts=[];
  for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1])pts.push(new THREE.Vector3(c.x+sx*h[0],c.y+sy*h[1],c.z+sz*h[2]).project(camera));
  const W=canvas.width,H=canvas.height,xs=pts.map(p=>(p.x+1)/2*W),ys=pts.map(p=>(1-p.y)/2*H);
  const x0=Math.max(0,Math.min(...xs)),x1=Math.min(W,Math.max(...xs)),y0=Math.max(0,Math.min(...ys)),y1=Math.min(H,Math.max(...ys));if(x1-x0<8||y1-y0<8)return null;
  const w=Math.min(640,Math.round(x1-x0)),out=document.createElement('canvas');out.width=w;out.height=Math.round(w*(y1-y0)/(x1-x0));
  out.getContext('2d').drawImage(canvas,x0,y0,x1-x0,y1-y0,0,0,out.width,out.height);return out;
}

export function createActionCues(){
  const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));{const l=new THREE.DirectionalLight(0xffffff,1.6);l.position.set(.4,1,1.2);scene.add(l);}
  let a=null,key=null,space=null,cam=null,eye=null,front=null,parts=[],facts={},draft={title:'',body:''},edited=null,status='draft',editing=false,photo=null,photoDue=false,pickOpen=false;
  const marks=new THREE.Scene();marks.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));
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
    scene.clear();scene.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));marks.clear();marks.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));drawn=[];hits=[];
    const thing=a.attachment?.center&&a.capture!=='none'?a.attachment:null,anchor=thing||front;
    const d=eye.distanceTo(new THREE.Vector3(...anchor.center)),k=Math.min(2.4,Math.max(1,d/1.1));cues.setScale(1);
    // the column, built at the origin: who, the photo, the message, Send
    const col=new THREE.Group(),items=[],sent=status==='sent',msg=message();
    // who it goes to: a Choice over the contacts, multi-select when the MOD picks several (its selector is pick-many)
    if(parts.includes('choice')){const book=a.contacts?.length?a.contacts:a.to,people=book.map(p=>({value:p.id,label:p.name,initials:initials(p.name)})),many=a.pick==='many';
      items.push(cues.choice(null,null,{options:people,multiple:many,value:many?a.to.map(p=>p.id):a.to[0]?.id,open:pickOpen,onToggle:v=>{pickOpen=v;build();onChange();},
        onPick:sent?null:v=>{const ids=many?v:[v];a={...a,to:book.filter(p=>ids.includes(p.id))};if(!many)pickOpen=false;build();onChange();}}));}
    if(parts.includes('arPhoto')&&photo)items.push(cues.arPhoto(photo,{width:.2,label:`photo of ${a.attachment.label}`}));
    if(parts.includes('textInput'))items.push(cues.textInput({title:msg.title,body:msg.body,width:.36,editing,placeholder:'writing…',onEdit:sent?null:startEditing}));
    const none=!a.to.length;   // nobody chosen: Send waits
    items.push(cues.iconButton({center:[0,0,0],size:[0,0,0],yaw:0},new THREE.Vector3(0,0,1),{icon:sent?'✓':SEND.icon,text:sent?'Sent':status==='sending'?'Sending…':SEND.label,
      on:!sent&&status!=='sending'&&!none,onPress:sent||none?null:confirm}));
    const send=items.at(-1);send.group.position.set(0,0,0);send.group.rotation.set(0,0,0);
    let y=0;const gap=.018;
    for(const it of items){const h=it.height??new THREE.Box3().setFromObject(it.group).getSize(new THREE.Vector3()).y;it.group.position.y=y-h/2;
      // chips and the button line up on the left edge of the field
      const w=it.width??new THREE.Box3().setFromObject(it.group).getSize(new THREE.Vector3()).x;it.group.position.x=-.18+w/2;y-=h+gap;col.add(it.group);drawn.push(it);}
    const height=-y,place=thing?besidePlacement(cam,thing,{width:.4*k,height:height*k}):{position:new THREE.Vector3(...front.center),yaw:Math.atan2(eye.x-front.center[0],eye.z-front.center[2])};
    col.position.copy(place.position).add(new THREE.Vector3(0,height*k/2,0));col.rotation.set(0,place.yaw,0);col.scale.setScalar(k);scene.add(col);
    // its top (who it goes to) stays in view: lowered while it projects above the view's top (the placement module will own this, §4.5)
    for(let i=0;i<40;i++){col.updateMatrixWorld(true);const top=new THREE.Vector3(0,.04,0).applyMatrix4(col.matrixWorld).project(cam);if(top.y<.78)break;col.position.y-=.02;}
    // what goes with it: the thing marked (the library's Mark, as declared)
    for(const mark of ['cornerBrackets','breathingBox'])if(thing&&parts.includes(mark)){const m=cues[mark](thing);marks.add(m.group);drawn.push(m);}
    scene.traverse(o=>{if(o.userData.onHit)hits.push(o);});
  }
  return {
    get active(){return !!a;},confirm,
    /** r: the answer with an action part and its draft (title, body); camera: where its question was asked; spaceName: the space. */
    setResponse(r,camera,spaceName){
      const k=r?.action?`${r.id}@${r.created}`:null;
      if(k!==key){key=k;a=r?.action||null;edited=null;status='draft';editing=false;space=spaceName;builtFor='';photo=null;photoDue=false;pickOpen=false;
        if(!a){scene.clear();marks.clear();drawn=[];hits=[];return;}
        const m=currentMeta(r.mods?.action||r.mod),slot=Object.values(m?.ui||{}).find(s=>s.use==='action-card');
        facts={...(m?.facts||{}),'attachment.kind':a.capture||(a.attachment?'thing':'none'),'target.has_content':!!a.attachment?.has_content};parts=partsToDraw(slot?.ui||DEFAULT_UI,facts);
        camera.updateMatrixWorld(true);cam=camera.clone();eye=camera.position.clone();
        const f=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);f.y=0;f.normalize();const p=eye.clone().addScaledVector(f,.8);
        front={center:p.toArray(),size:[.01,.01,.01],yaw:0};
        photoDue=parts.includes('arPhoto')&&!!a.attachment?.center;}   // taken at the first draw, from the frame with its mark
      if(a){draft={title:r.title||'',body:r.body||''};const b=JSON.stringify([draft.title,draft.body]);if(b!==builtFor){builtFor=b;build();}}
    },
    render(renderer,camera,now=performance.now()){
      if(!a)return;for(const p of drawn)p.update(now,camera);
      const auto=renderer.autoClear;renderer.autoClear=false;
      try{renderer.clearDepth();renderer.render(marks,camera);
        if(photoDue){photoDue=false;photo=cropDrawn(renderer.domElement,a.attachment,camera);if(photo){build();for(const p of drawn)p.update(now,camera);}}
        renderer.clearDepth();renderer.render(scene,camera);}finally{renderer.autoClear=auto;}
    },
    attach(element,getCamera,changed=()=>{}){
      onChange=changed;
      const hit=e=>{if(!a||!hits.length)return null;const b=element.getBoundingClientRect(),ray=new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,1-(e.clientY-b.top)/b.height*2),getCamera());scene.updateMatrixWorld(true);return ray.intersectObjects(hits,false)[0]||null;};
      // a press a control takes is the control's to the end: the click that follows is swallowed too, even when the press rebuilt what was
      // under the pointer (else it falls through to the editor, which picks the thing behind and replays the question)
      let took=false;
      element.addEventListener('pointerdown',e=>{const h=hit(e);took=!!h;if(!h)return;e.preventDefault();e.stopImmediatePropagation();h.object.userData.onHit(h.point);changed();},true);
      element.addEventListener('click',e=>{if(took||hit(e)){took=false;e.preventDefault();e.stopImmediatePropagation();}},true);
    },
  };
}
