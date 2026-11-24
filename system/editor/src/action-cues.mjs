// A message the user sends through a MOD (Send's card slot), composed from the library as the MOD declared it (modos-system-design.md
// 4.4): a Choice of who it goes to (the best match chosen; the other contacts in its dropdown), the drafted message in a Text Input the
// user can edit (the MOD's text slot, streaming in), an AR Photo when a photo of the thing goes with it, and the Send preset button. They
// stand as one column beside the thing, where all of it is in view, turned to the user. With no thing in view to stand by (nothing
// attached, or the thing out of view when asked) the column is on the view stack (src/cluster-placement.mjs): fixed in the user's view,
// above the answer's text and the other UI there, for the whole answer. The
// thing that goes with the message is marked with the library's Mark (Corner Brackets on something with content, else Breathing Box).
// Nothing is sent until Send is pressed (POST /api/modos/actions, mock: the space's outbox). The message is one answer's: new data for
// it (a revision while typing: a new draft, other recipients) updates the cues that changed (src/spatial-ui/cue-set.mjs); the draft is
// written into its Text Input from where it differs.
import * as THREE from 'three';
import * as cues from './spatial-ui/cues.mjs';
import {currentMeta} from './current-mods.mjs';
import {besidePlacement} from './beside.mjs';
import {viewAnchor,STACK} from './cluster-placement.mjs';
import {partsToDraw} from '../modos/ui-rules.mjs';
import {createCueSet} from './spatial-ui/cue-set.mjs';

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
  const lights=s=>{s.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));return s;};
  const scene=lights(new THREE.Scene());{const l=new THREE.DirectionalLight(0xffffff,1.6);l.position.set(.4,1,1.2);scene.add(l);}
  const marks=lights(new THREE.Scene()),col=new THREE.Group();scene.add(col);
  const colSet=createCueSet(col),markSet=createCueSet(marks);
  let a=null,key=null,space=null,cam=null,eye=null,front=null,parts=[],facts={},draft={title:'',body:''},edited=null,status='draft',editing=false,
    photo=null,photoN=0,photoDue=false,pickOpen=false,picked=false,builtFor='',source=null,onChange=()=>{},input=null,fixed=false,natural=null,placedFor=null;
  const inView=(camera,p)=>{const v=new THREE.Vector3(...p).project(camera);return v.z<1&&Math.abs(v.x)<=1&&Math.abs(v.y)<=1;};
  const message=()=>edited||draft,thingOf=()=>a.attachment?.center&&a.capture!=='none'?a.attachment:null;
  // a cue's own size, measured when made (before it is in the column)
  const sized=part=>{const b=new THREE.Box3().setFromObject(part.group).getSize(new THREE.Vector3());part.w??=b.x;part.h0=b.y;return part;};
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
  // What should stand now: the column (who, the photo, the message, Send) and the thing's Mark; each kept unless its data changed.
  function build(){
    const thing=thingOf(),sent=status==='sent',msg=message(),none=!a.to.length,specs=[];cues.setScale(1);
    // who it goes to: a Choice over the contacts, multi-select when the MOD picks several (its selector is pick-many)
    if(parts.includes('choice')){const book=a.contacts?.length?a.contacts:a.to,many=a.pick==='many';
      specs.push({key:'choice',props:{options:book.map(p=>({value:p.id,label:p.name,initials:initials(p.name)})),multiple:many,value:many?a.to.map(p=>p.id):a.to[0]?.id??null,open:pickOpen,sent},
        make:p=>sized(cues.choice(null,null,{...p,onToggle:v=>{pickOpen=v;build();onChange();},
          onPick:p.sent?null:v=>{const ids=many?v:[v];a={...a,to:book.filter(x=>ids.includes(x.id))};picked=true;if(!many)pickOpen=false;build();onChange();}}))});}
    if(parts.includes('arPhoto')&&photo)specs.push({key:'photo',props:{photo:photoN,label:`photo of ${a.attachment.label}`},make:p=>cues.arPhoto(photo,{width:.2,label:p.label})});
    if(parts.includes('textInput'))specs.push({key:sent?'text:sent':'text',props:{title:msg.title,body:msg.body,editing},
      make:p=>cues.textInput({...p,width:.36,placeholder:'writing…',onEdit:sent?null:startEditing})});
    specs.push({key:'send',props:{icon:sent?'✓':SEND.icon,text:sent?'Sent':status==='sending'?'Sending…':SEND.label,on:!sent&&status!=='sending'&&!none},   // nobody chosen: Send waits
      make:p=>{const b=sized(cues.iconButton({center:[0,0,0],size:[0,0,0],yaw:0},new THREE.Vector3(0,0,1),{...p,onPress:p.on?confirm:null}));b.group.rotation.set(0,0,0);return b;}});
    colSet.update(specs);
    // what goes with it: the thing marked (the library's Mark, as declared)
    markSet.update(['cornerBrackets','breathingBox'].filter(m=>thing&&parts.includes(m)).map(m=>({key:m,props:{box:[thing.center,thing.size,thing.yaw]},make:()=>cues[m](thing)})));
  }
  // The column, stacked every frame (a message being written in grows), and placed: beside the thing, or on the view stack (place).
  function layout(){
    let y=0,x1=-.18;const gap=.018;
    for(const it of colSet.parts){const h=it.height??it.h0,w=it.width??it.w;it.group.position.set(-.18+w/2,y-h/2,it.group.position.z);y-=h+gap;x1=Math.max(x1,-.18+w);}
    const height=-y;natural={x:(x1-.18)/2,y:-height,h:height};
    if(fixed||placedFor!=null&&Math.abs(placedFor-height)<.03)return;placedFor=height;
    const thing=thingOf(),d=eye.distanceTo(new THREE.Vector3(...thing.center)),k=Math.min(2.4,Math.max(1,d/1.1)),place=besidePlacement(cam,thing,{width:.4*k,height:height*k});
    col.position.copy(place.position).add(new THREE.Vector3(0,height*k/2,0));col.rotation.set(0,place.yaw,0);col.scale.setScalar(k);
    // its top (who it goes to) stays in view: lowered while it projects above the view's top (the placement module will own this, §4.5)
    for(let i=0;i<40;i++){col.updateMatrixWorld(true);const top=new THREE.Vector3(0,.04,0).applyMatrix4(col.matrixWorld).project(cam);if(top.y<.78)break;col.position.y-=.02;}
  }
  return {
    /** What it draws: the column and the marks (src/attention.mjs). */
    get roots(){return [scene,marks];},
    get active(){return !!a;},confirm,
    /** For measuring: how often its cues were made, taken new data in place, or kept. */
    get stats(){return {column:colSet.stats,marks:markSet.stats};},
    /** r: the answer with an action part (its message: action.draft.body); camera: where its question was asked; spaceName: the space.
     *  The same answer with new data (its id stays) updates the message; another answer starts a new one. */
    setResponse(r,camera,spaceName){
      const id=r?.action?r.id:null;
      if(id!==key){key=id;a=r?.action||null;edited=null;status='draft';editing=false;space=spaceName;builtFor='';photo=null;photoDue=false;pickOpen=false;picked=false;placedFor=null;
        colSet.clear();markSet.clear();if(!a)return;
        camera.updateMatrixWorld(true);cam=camera.clone();eye=camera.position.clone();
        const f=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);f.y=0;f.normalize();
        front={center:eye.clone().addScaledVector(f,.8).toArray(),size:[.01,.01,.01],yaw:0};
        const thing=thingOf();fixed=!thing||!inView(cam,thing.center);   // stays for this answer
        col.position.set(0,0,0);col.quaternion.identity();col.scale.setScalar(1);}
      else if(a&&r.action!==source)a={...r.action,...(picked?{to:a.to}:{})};   // new data; who the user picked stays theirs
      if(!a)return;source=r.action;
      const m=currentMeta(r.mods?.action||r.mod),slot=Object.values(m?.ui||{}).find(s=>s.use==='action-card');
      facts={...(m?.facts||{}),'attachment.kind':a.capture||(a.attachment?'thing':'none'),'target.has_content':!!a.attachment?.has_content};parts=partsToDraw(slot?.ui||DEFAULT_UI,facts);
      if(parts.includes('arPhoto')&&a.attachment?.center&&!photo)photoDue=true;   // taken at the next draw, from the frame with its mark
      // the message is the action's own (modos/text.mjs writeDraft), no heading; the question's text answer, if any, stands apart
      draft={title:'',body:a.draft?.body||''};
      const want=JSON.stringify([a.to,a.contacts,a.capture,draft,parts]);if(want!==builtFor){builtFor=want;build();}
    },
    /** Whether the message is on the view stack (no thing in view to stand by when asked). */
    get fixed(){return !!a&&fixed;},
    /** On the view stack: placed for this frame just above `bottom` (the top of what stands in view), at `scale` (its attention:
     *  src/attention.mjs); returns the stack's new top. */
    place(camera,bottom=null,scale=1){
      if(!a||!fixed||!natural)return bottom;const k=STACK.distance/1.1*STACK.scale*scale,v=viewAnchor(camera,(bottom??STACK.base)+STACK.gap);
      col.quaternion.copy(v.quaternion);col.scale.setScalar(k);col.position.copy(v.point).sub(new THREE.Vector3(natural.x,natural.y,0).multiplyScalar(k).applyQuaternion(v.quaternion));
      col.updateMatrixWorld(true);return v.top(natural.h*k);
    },
    render(renderer,camera,now=performance.now()){
      if(!a)return;const drawn=[...colSet.parts,...markSet.parts];for(const p of drawn)p.update(now,camera);layout();
      const auto=renderer.autoClear;renderer.autoClear=false;
      try{renderer.clearDepth();renderer.render(marks,camera);
        if(photoDue){photoDue=false;photo=cropDrawn(renderer.domElement,a.attachment,camera);if(photo){photoN++;build();layout();}}
        renderer.clearDepth();renderer.render(scene,camera);}finally{renderer.autoClear=auto;}
    },
    attach(element,getCamera,changed=()=>{}){
      onChange=changed;
      // what can be pressed, found when pressed (a cue updated in place may have new meshes)
      const hit=e=>{if(!a)return null;const hits=[];scene.traverse(o=>{if(o.userData.onHit)hits.push(o);});if(!hits.length)return null;
        const b=element.getBoundingClientRect(),ray=new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((e.clientX-b.left)/b.width*2-1,1-(e.clientY-b.top)/b.height*2),getCamera());scene.updateMatrixWorld(true);return ray.intersectObjects(hits,false)[0]||null;};
      // a press a control takes is the control's to the end: the click that follows is swallowed too, even when the press rebuilt what was
      // under the pointer (else it falls through to the editor, which picks the thing behind and replays the question)
      let took=false;
      element.addEventListener('pointerdown',e=>{const h=hit(e);took=!!h;if(!h)return;e.preventDefault();e.stopImmediatePropagation();h.object.userData.onHit(h.point);changed();},true);
      element.addEventListener('click',e=>{if(took||hit(e)){took=false;e.preventDefault();e.stopImmediatePropagation();}},true);
    },
  };
}
