import * as THREE from 'three';
import {responseReady,responseSlot,presentationResponses,latestPresentation} from './response-parts.mjs';
import {place,readableSurfaceBasis} from './placement.mjs';
import {viewFixedPose} from './placement-stability.mjs';
import {pickStyle} from './legibility.mjs';
import {createLegibilityTracker} from './legibility-temporal.mjs';
import {questionCaption,captionQuestion} from './question-caption.mjs';
// The agent on a real surface, replayed in scenario time: from the frame a question is asked, its thinking streams as faint text on
// input area (each step when it really happened); responses alone appear as softly glowing text,
// followed by reading time, while the video holds on the question's frame (see holdLength()). The text glows in one muted colour
// picked for the video behind it; only where no colour is legible there does it get a frosted-glass backing (legibility.mjs).

const PX=1024,PAD=64,FONT='system-ui,-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif';
const AUTO_HIDE_S=5,FADE_S=.4;
// Clutter rating of the frame region behind the text: share of pixels with a strong luminance gradient (Sobel magnitude > 48/255).
// Plain walls score about 0-0.03; posters, shelves and clutter well above. It raises the contrast the text colour needs.

// Wrap Latin text at spaces and CJK text at any character.
function wrap(ctx,text,width){
  const lines=[];let line='';
  for(const token of String(text).match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+|\s+/g)||[]){
    const next=line+token;
    if(ctx.measureText(next).width>width&&line.trim()){lines.push(line.trimEnd());line=token.trimStart();}else line=next;
  }
  if(line.trim())lines.push(line.trimEnd());return lines;
}
// White text with a soft cool glow on a transparent canvas.
function glowTexture(r,dark=false,previousBudget=null){
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),inner=PX-2*PAD,lines=[];
  const add=(text,weight,size,gap,item=false)=>{ctx.font=`${weight} ${size}px ${FONT}`;for(const [i,l] of wrap(ctx,text,inner-(item?48:0)).entries())lines.push({text:l,weight,size,gap:i?6:gap,indent:item,bullet:item&&!i});};
  if(r.findmy?.status==='not_found')add('No mapped location found',600,46,0);
  if(r.findmy?.status==='ambiguous')add('Which item do you mean?',600,46,0);
  const titleStart=lines.length;if(r.title)add(r.title,700,72,0);
  const titleCount=lines.length-titleStart,titleLines=r.reserve_text?Math.max(2,titleCount,previousBudget?.titleLines||0):titleCount;
  for(let i=titleCount;i<titleLines;i++)lines.push({text:'',weight:700,size:72,gap:i?6:0});
  const bodyStart=lines.length;if(r.body)add(r.body,500,46,18);
  const bodyCount=lines.length-bodyStart,bodyLines=r.reserve_text?Math.max(4,bodyCount,previousBudget?.bodyLines||0):bodyCount;
  for(let i=bodyCount;i<bodyLines;i++)lines.push({text:'',weight:500,size:46,gap:i?6:18});
  for(const item of r.items||[])add(item,500,46,12,true);
  const footer=Math.max(previousBudget?.footer||0,r.weather&&(r.weather.timeline||r.weather.forecast||[]).length>1&&r.weather.preview?.component!=='weather-single'?352:0);
  canvas.width=PX;canvas.height=Math.ceil(PAD*2+lines.reduce((h,l)=>h+l.gap+l.size*1.22,0)+footer);canvas.weatherFooter=footer;
  canvas.layoutBudget={titleLines,bodyLines,footer};
  // The ink's box in canvas pixels (the glass backs exactly this): widest line, first line's top to last line's baseline area.
  let right=PAD,bottom=PAD;{let y=PAD;for(const l of lines){y+=l.gap;ctx.font=`${l.weight} ${l.size}px ${FONT}`;right=Math.max(right,PAD+(l.indent?48:0)+ctx.measureText(l.text).width);bottom=y+l.size;y+=l.size*1.22;}}
  const box={x0:PAD,x1:footer||r.reserve_text?PX-PAD:right,y0:PAD,y1:footer||r.reserve_text?canvas.height-32:bottom};
  ctx.textBaseline='top';
  // White: the material's colour tints text and glow alike (one glowing colour, picked per answer in legibility.mjs).
  // Dark text: the halo is a faint soft shadow; a full glow would read as a grey haze around the letters.
  for(const [blur,color] of dark?[[10,'rgba(255,255,255,.25)']]:[[28,'rgba(255,255,255,.8)'],[8,'rgba(255,255,255,.9)']]){
    let y=PAD;ctx.shadowBlur=blur;ctx.shadowColor=color;ctx.fillStyle='#ffffff';
    for(const l of lines){y+=l.gap;ctx.font=`${l.weight} ${l.size}px ${FONT}`;if(l.bullet)ctx.fillText('·',PAD+8,y);ctx.fillText(l.text,PAD+(l.indent?48:0),y);y+=l.size*1.22;}
  }
  canvas.box=box;
  const xHeights=lines.map(l=>{ctx.font=`${l.weight} ${l.size}px ${FONT}`;const m=ctx.measureText('x');return m.actualBoundingBoxAscent+m.actualBoundingBoxDescent;});
  canvas.textMetrics={xHeightRatio:(xHeights.length?Math.min(...xHeights):32)/PX,box:{x0:box.x0/PX,x1:box.x1/PX,y0:box.y0/canvas.height,y1:box.y1/canvas.height}};
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=8;return map;
}
// Frosted glass: the video frame behind it, blurred in screen space and mixed with a tint computed from it (legibility.mjs),
// solid over the ink's box (`inner`) and fading out softly over `feather` metres beyond it, inside a rounded rectangle with feathered edges.
// In the 3D view there is no video behind it, so it renders as the plain tint.
export function glassMaterial(){
  return new THREE.ShaderMaterial({transparent:true,depthWrite:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-4,
    uniforms:{tFrame:{value:null},resolution:{value:new THREE.Vector2(1,1)},useFrame:{value:0},opacity:{value:1},styleOpacity:{value:1},size:{value:new THREE.Vector2(1,1)},tint:{value:new THREE.Color(.04,.04,.04)},mixAmount:{value:.5},inner:{value:new THREE.Vector2(1,1)},feather:{value:.01}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`uniform sampler2D tFrame;uniform vec2 resolution,size;uniform float useFrame,opacity,styleOpacity,mixAmount,feather;uniform vec3 tint;uniform vec2 inner;varying vec2 vUv;
      float box(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
      void main(){
        float r=min(feather,.25*min(inner.x,inner.y)),d=box((vUv-.5)*size,inner*.5,r);float a=1.-smoothstep(0.,1.,d/feather);a*=a;
        vec3 c=tint;
        if(useFrame>.5){vec2 uv=gl_FragCoord.xy/resolution;vec3 s=vec3(0.);
          for(int i=0;i<40;i++){float k=float(i);vec2 o=vec2(cos(k*2.39996),sin(k*2.39996))*sqrt(k/40.)*16./resolution;s+=texture2D(tFrame,uv+o).rgb;}
          c=mix(s/40.,tint,mixAmount);}
        gl_FragColor=vec4(c,a*.9*opacity*styleOpacity);
        #include <colorspace_fragment>
      }`});
}
// Clutter and brightness of the frame region the text covers at the frame it was placed, and a small sample of its pixels (≤ 32 wide).
async function rateBackground(widget,frame,ctx){
  return rateBackgroundImage(widget,await ctx.frameImage(frame),ctx.frameCamera(frame));
}
export function rateBackgroundImage(widget,img,cam){
  const k={width:img.width,height:img.height};
  widget.updateMatrixWorld(true);const geo=widget.userData.text.geometry;geo.computeBoundingBox();
  const b=geo.boundingBox,pts=[[b.min.x,b.min.y],[b.max.x,b.min.y],[b.min.x,b.max.y],[b.max.x,b.max.y]].map(([x,y])=>new THREE.Vector3(x,y,0).applyMatrix4(widget.userData.text.matrixWorld).project(cam));
  const xs=pts.map(p=>(p.x+1)/2*k.width),ys=pts.map(p=>(1-p.y)/2*k.height);
  const x0=Math.max(0,Math.min(...xs)),x1=Math.min(k.width,Math.max(...xs)),y0=Math.max(0,Math.min(...ys)),y1=Math.min(k.height,Math.max(...ys));
  if(x1-x0<4||y1-y0<4)return {clutter:0,brightness:0,sample:null};
  const w=Math.max(8,Math.min(128,Math.round(x1-x0))),h=Math.max(8,Math.min(128,Math.round(w*(y1-y0)/(x1-x0))));
  const c=new OffscreenCanvas(w,h).getContext('2d',{willReadFrequently:true});c.drawImage(img,x0*img.width/k.width,y0*img.height/k.height,(x1-x0)*img.width/k.width,(y1-y0)*img.height/k.height,0,0,w,h);
  const px=c.getImageData(0,0,w,h).data,L=new Float32Array(w*h);let sum=0;
  for(let i=0;i<w*h;i++){L[i]=(.2126*px[4*i]+.7152*px[4*i+1]+.0722*px[4*i+2]);sum+=L[i];}
  let strong=0,n=0;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;
    const gx=L[i-w+1]+2*L[i+1]+L[i+w+1]-L[i-w-1]-2*L[i-1]-L[i+w-1],gy=L[i+w-1]+2*L[i+w]+L[i+w+1]-L[i-w-1]-2*L[i-w]-L[i-w+1];
    if(Math.hypot(gx,gy)/4>48)strong++;n++;}
  const sw=Math.min(32,w),sh=Math.max(4,Math.min(32,Math.round(sw*h/w))),sc=new OffscreenCanvas(sw,sh).getContext('2d',{willReadFrequently:true});sc.drawImage(c.canvas,0,0,sw,sh);
  return {clutter:n?strong/n:0,brightness:sum/(w*h)/255,sample:{pixels:sc.getImageData(0,0,sw,sh).data,w:sw,h:sh}};
}
// Text colour (and glass, if needed) for a rated background; white without a sample.
function styleFor(rating){
  if(!rating?.sample)return {text:[1,1,1],glass:null};
  const {pixels,w,h}=rating.sample;return pickStyle(pixels,w,h,rating.clutter);
}
// `frame`: where the answer is placed, the frame at which it appears (the user may have turned while the agent was thinking).
export async function createResponseWidget(r,ctx,stack=0,frame=r.frame,previous=null){
  const map=glowTexture(r,false,previous?.userData.text.material.map.image.layoutBudget),aspect=map.image.height/map.image.width,pose=await place({...r,frame,aspect,textMetrics:map.image.textMetrics,previousPose:previous?.userData.pose},ctx),width=pose.width,height=width*aspect;
  const group=new THREE.Group();group.name=`agent-response-${r.id}`;group.position.copy(pose.position);group.quaternion.copy(pose.quaternion);
  // Standing on a surface: position is the bottom edge. Several answers at the same moment stack along the text's up axis.
  const shift=(pose.align==='bottom'?height/2:0)+stack*(r.part?height+.55*width:height*1.15);group.translateY(shift);
  const text=new THREE.Mesh(new THREE.PlaneGeometry(width,height,...SEGMENTS),new THREE.MeshBasicMaterial({map,transparent:true,toneMapped:false,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-8}));
  text.renderOrder=3;group.add(text);
  // Glass: solid exactly over the ink (no margin), then a soft blurred edge fading out beyond it (about one body line).
  const box=map.image.box,u=width/PX,H=map.image.height,inner=new THREE.Vector2((box.x1-box.x0)*u,(box.y1-box.y0)*height/H),feather=46*1.1*u;
  const glass=new THREE.Mesh(new THREE.PlaneGeometry(inner.x+2*feather,inner.y+2*feather,...SEGMENTS),glassMaterial());glass.renderOrder=2;glass.visible=false;
  glass.position.set(((box.x0+box.x1)/2/PX-.5)*width,(.5-(box.y0+box.y1)/2/H)*height,-.002);
  glass.material.uniforms.size.value.set(inner.x+2*feather,inner.y+2*feather);glass.material.uniforms.inner.value.copy(inner);glass.material.uniforms.feather.value=feather;group.add(glass);
  group.userData={response:r,text,glass,width,height,aspect,pose,rating:null,kind:pose.kind};bend(text,pose.surface,shift);bend(glass,pose.surface,shift);
  // The initial style is selected from the composed scene immediately before its first draw.
  return group;
}
// Streaming changes ink, not the existing surface, geometry, font scale or control anchor.
// A larger footprint (overflow or newly arrived controls) goes through placement once.
export function updateResponseWidget(widget,response){
  const d=widget.userData,old=d.text.material.map,newMap=glowTexture(response,d.style?.side==='dark',old.image.layoutBudget);
  if(newMap.image.height!==old.image.height||JSON.stringify(newMap.image.box)!==JSON.stringify(old.image.box)){
    newMap.dispose();return false;
  }
  old.dispose();d.text.material.map=newMap;d.text.material.needsUpdate=true;d.response=response;
  return true;
}
function applyResponseStyle(widget,rating){
 if(!rating.sample)return;const d=widget.userData;d.legibility||=createLegibilityTracker();
 const style=d.legibility.sample(rating.sample,rating.clutter,performance.now());delete rating.sample;d.rating=rating;paintResponseStyle(widget,style);
}
function paintResponseStyle(widget,style){
 if(!style)return;const d=widget.userData;
  if(d.style?.side!==style.side){const old=d.text.material.map;d.text.material.map=glowTexture(d.response,style.side==='dark',old.image.layoutBudget);old.dispose();d.text.material.needsUpdate=true;}
 d.style=style;d.text.material.color.setRGB(...style.text);d.glass.visible=!!style.glass&&style.glassAlpha>.002;d.glass.material.uniforms.styleOpacity.value=style.glassAlpha;
 if(style.glass){d.glass.material.uniforms.tint.value.setRGB(...style.glass.tint);d.glass.material.uniforms.mixAmount.value=style.glass.mix;}
}
function moveResponseWidget(w,pose,stack){
 const d=w.userData,width=pose.width,height=width*d.aspect,shift=(pose.align==='bottom'?height/2:0)+stack*(d.response.part?height+.55*width:height*1.15);
 const sameSurface=d.pose?.surfaceId&&d.pose.surfaceId===pose.surfaceId;
 const from=w.position.clone(),fromQ=w.quaternion.clone();
 w.position.copy(pose.position);w.quaternion.copy(pose.quaternion);w.translateY(shift);
 d.surfaceMotion=sameSurface&&(from.distanceTo(w.position)>.002||fromQ.angleTo(w.quaternion)>.01)?{from,fromQ,to:w.position.clone(),toQ:w.quaternion.clone(),start:performance.now(),duration:220}:null;
 d.text.geometry.dispose();d.text.geometry=new THREE.PlaneGeometry(width,height,...SEGMENTS);delete d.text.userData.flat;
 const map=d.text.material.map,box=map.image.box,u=width/PX,H=map.image.height,inner=new THREE.Vector2((box.x1-box.x0)*u,(box.y1-box.y0)*height/H),feather=46*1.1*u;
 d.glass.geometry.dispose();d.glass.geometry=new THREE.PlaneGeometry(inner.x+2*feather,inner.y+2*feather,...SEGMENTS);delete d.glass.userData.flat;
 d.glass.position.set(((box.x0+box.x1)/2/PX-.5)*width,(.5-(box.y0+box.y1)/2/H)*height,-.002);
 const uniforms=d.glass.material.uniforms;uniforms.size.value.set(inner.x+2*feather,inner.y+2*feather);uniforms.inner.value.copy(inner);uniforms.feather.value=feather;
 Object.assign(d,{width,height,pose,kind:pose.kind});bend(d.text,pose.surface,shift);bend(d.glass,pose.surface,shift);
}
// On a curved surface the text (and its glass) follows the fitted surface: each vertex of the subdivided plane moves along the
// text's +Z to surface(x, y), in metres in the placement frame (shift: the group's offset along +Y from it). Flat otherwise.
const SEGMENTS=[24,8];
function bend(mesh,surface,shift=0){
  const pos=mesh.geometry.attributes.position,base=mesh.userData.flat||=pos.array.slice(),s=mesh.scale,o=mesh.position;
  for(let i=0;i<pos.count;i++){const x=base[3*i]*s.x+o.x,y=base[3*i+1]*s.y+o.y+shift;pos.setZ(i,surface?surface(x,y)/s.z:base[3*i+2]);}
  pos.needsUpdate=true;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
}
function dispose(group){group.traverse(o=>{if(o.isMesh){o.material.map?.dispose();o.material.dispose();o.geometry.dispose();}});}

const REPLAY_MS=900;
// Asking holds the video on the question's frame while the agent works: its real time runs on a hold clock h (real seconds since the
// hold began). Thinking streams step by step at each step's real time, the answer shows at h = latency (measured real seconds to
// show_response), read_s seconds of reading follow, and then the video moves on. Replay first types the question.
export const READING={read_s:5};
export const formatSpeed=v=>`${+v.toFixed(2)}×`;
// Hold length in real seconds: Infinity while the answer is pending.
export function holdLength(q){
  if(!q)return 0;
  if(q.status==='answered')return (q.latency||0)+(q.live?.read_s??READING.read_s);
  if(q.status==='failed')return 0;
  return Infinity;
}
// The agent's steps visible h seconds into the hold: all of them while it is still answering, else those that had happened by then.
export function stepsAt(q,h=Infinity){return h<0?[]:(q.trace||[]).filter(st=>st.at/1000<=h+1e-6);}
// Trace focus may inspect history; an explicit hold must never fall back to an older question.
export function focusQuestion(questions,t,heldId=null){
  if(heldId!=null)return questions.find(q=>q.id===heldId)||null;
  return questions.find(q=>q.status==='running')||[...questions].reverse().find(q=>Math.abs(t-q.t)<.06)||null;
}
// Caption of the user's question, drawn in screen space at the bottom of the video (not anchored in the room).
function captionTexture(text,shown=text){
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),W=1600,size=44,font=`500 ${size}px ${FONT}`;ctx.font=font;
  const lines=wrap(ctx,text,W-120).slice(0,2);canvas.width=W;canvas.height=Math.ceil(Math.max(1,lines.length)*size*1.3+40);
  ctx.font=font;ctx.textAlign='left';ctx.textBaseline='top';ctx.fillStyle='rgba(255,255,255,.92)';ctx.shadowColor='rgba(0,0,0,.85)';ctx.shadowBlur=10;
  // Reserve the complete question's layout so partial words cannot re-centre or move lines.
  let cursor=0;lines.forEach((l,i)=>{const at=text.indexOf(l,cursor),start=at<0?cursor:at;cursor=start+l.length;
    const width=ctx.measureText(l).width,x=(W-width)/2,y=20+i*size*1.3;
    ctx.fillText(l.slice(0,Math.max(0,shown.length-start)),x,y);
    canvas.waitingDot={x:x+width+20,y:y+size*.52};});
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;return map;
}
export function createAgentLayer({scene,frames,sessionPath,onChange,onStatus,onAnimate,...ctx}){
  ctx.frames=frames;
  const group=new THREE.Group();group.name='agent-responses';scene.add(group);
  const widgets=new Map(),thoughts=new Map();let hold=null,conversation=null,generation=0,time=0,timer=null,reportTimer=null,pending=null,syncing=null,questions=[],lastQuestionsKey='';
  let sourceResponses=[],reconciling=false;
  // Delivery continues on a real-time clock after an early playback resume.
  const deliveries=new Map();
  const deliveryClocks=()=>new Map([...deliveries].map(([id,c])=>[id,{...c,h:c.h+(performance.now()-c.start)/1000}]));
  let adapting=null;const presentationScene=new THREE.Scene(),backgrounds=new WeakMap();
  const hudScene=new THREE.Scene(),hudCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const caption=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({transparent:true,toneMapped:false,depthTest:false,depthWrite:false}));
  const waitingDot=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.ShaderMaterial({transparent:true,toneMapped:false,depthTest:false,depthWrite:false,
    uniforms:{opacity:{value:0}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`uniform float opacity;varying vec2 vUv;
      void main(){float r=length(vUv-.5);
        float core=1.-smoothstep(.13,.19,r),halo=.25*(1.-smoothstep(.16,.5,r));
        gl_FragColor=vec4(mix(vec3(.8,.9,1.),vec3(1.),core),max(core,halo)*opacity);
        #include <colorspace_fragment>
      }`}));
  caption.visible=waitingDot.visible=false;waitingDot.renderOrder=1;hudScene.add(caption,waitingDot);
  let captionText='',captionKey='',captionId=null,captionStart=0,captionOwner=null,dismissedCaption=null;
  function clearCaption(){caption.visible=waitingDot.visible=false;captionText='';captionId=null;captionKey='';}
  const url=p=>{const u=new URL(p,location.href);u.searchParams.set('session',sessionPath);if(conversation)u.searchParams.set('conversation',conversation);return u;};
  const post=(p,body)=>fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:sessionPath,conversation,...body})}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;});
  function removeAll(){deliveries.clear();sourceResponses=[];for(const w of [...widgets.values(),...thoughts.values()]){group.remove(w);dispose(w);}widgets.clear();thoughts.clear();}
  // One poll returns the conversation's questions and responses; widgets follow the responses.
  async function sync(){
    if(!conversation)return null;const gen=generation;
    const res=await fetch(url('/api/agent/status'));const status=await res.json();if(!res.ok)throw Error(status.error);
    if(gen!==generation)return null; // switched conversation meanwhile
    // New or changed questions change the caption: redraw.
    const questionsKey=JSON.stringify(status.questions.map(q=>[q.id,q.status,q.trace?.length||0]));questions=status.questions;
    if(questionsKey!==lastQuestionsKey){lastQuestionsKey=questionsKey;apply();onAnimate?.();}
    sourceResponses=status.responses;await reconcileWidgets();
    onStatus?.(status);return status;
  }
  // Bumped when the surfaces text is placed on change (relayout): widgets placed against the old ones are not kept.
  let placementEpoch=0;
  async function reconcileWidgets(){
    if(reconciling)return;reconciling=true;const gen=generation,epoch=placementEpoch;let changed=false;
    try{
      const list=presentationResponses(sourceResponses,questions,hold,deliveryClocks()),ids=new Set(list.map(r=>r.id));
      for(const [id,w] of widgets)if(!ids.has(id)){group.remove(w);dispose(w);widgets.delete(id);changed=true;}
      for(const r of list){
        const old=widgets.get(r.id);
        if(old&&old.userData.response.component_key===r.component_key)continue;
        if(old&&r.reserve_text&&updateResponseWidget(old,r)){changed=true;continue;}
        const q=questions.find(q=>q.id===r.question_id),frame=q?.frame??r.frame;
        const w=await createResponseWidget(r,ctx,list.filter(o=>o.id<r.id&&o.frame===r.frame).length,frame,old);
        const current=presentationResponses(sourceResponses,questions,hold,deliveryClocks()).find(p=>p.id===r.id);
        if(gen!==generation||epoch!==placementEpoch||!current||(current.component_key!==r.component_key&&!updateResponseWidget(w,current))){dispose(w);continue;}
        if(old){group.remove(old);dispose(old);}
        widgets.set(r.id,w);group.add(w);changed=true;
      }
    }finally{reconciling=false;}
    if(epoch!==placementEpoch)return reconcileWidgets();   // relaid out meanwhile: place again on the new surfaces
    if(changed){apply();onChange?.(sourceResponses);}
  }
  // During a hold (hold = {id, h, shownAt}): negative h types the question, then thinking until the answer at h = shownAt. Outside a hold, an answer
  // shows from its question's moment on (with auto-hide, only on that very frame: it was read during the hold). A replay fades the
  // answer in with a short glow pulse.
  // Per response {autoHide, fixedText, stability}: the global settings or its mod's overrides (src/response-settings.mjs).
  const settingsOf=r=>({autoHide:false,fixedText:false,stability:0,...ctx.getSettings?.(r)});
  function apply(){
    void reconcileWidgets().catch(e=>console.warn('response container',e));
    const now=performance.now(),clocks=deliveryClocks();
    const latest=latestPresentation([...widgets.values()].map(w=>w.userData.response),questions,time,hold,clocks);
    for(const w of widgets.values()){
      const r=w.userData.response,q=questions.find(q=>q.id===r.question_id),t0=q?q.t:r.t;let o;
      const delivery=clocks.get(q?.id);
      if(q&&hold?.id===q.id)o=responseReady(r,q,hold)?1:0;
      else if(delivery)o=time>=t0-1e-6&&responseReady(r,q,delivery)&&(!settingsOf(r).autoHide||q.status!=='answered'||delivery.h<(q.latency||0)+(q.live?.read_s??READING.read_s))?1:0;
      else o=time>=t0-1e-6&&(!settingsOf(r).autoHide||time<=t0+.06)?1:0;
      const k=w.userData.replay?Math.min(1,(now-w.userData.replay)/REPLAY_MS):1;
      if(k<1){o*=THREE.MathUtils.smootherstep(k,0,.45);w.scale.setScalar(1+.06*Math.sin(Math.PI*k));}else{w.scale.setScalar(1);w.userData.replay=0;}
      if(r.id!==latest?.id)o=0;
      w.visible=o>0;w.userData.text.material.opacity=o;w.userData.glass.material.uniforms.opacity.value=o;
    }
  }
  // Pinned in the recorded view (Fixed text, and the Fixed fallback when no surface fits).
  const fixedPose=(w,frame,i,camera=ctx.frameCamera(frame))=>{const d=w.userData;
    return viewFixedPose(camera,d.aspect,responseSlot(d.response,i),d.aspect-Math.max(0,(d.text.material.map.image.weatherFooter||0)-192)/1024);};
  // Drawn in the fixed pass (above hands and scene effects): Fixed text, or a response pinned because no surface fits.
  const drawnFixed=w=>!!settingsOf(w.userData.response).fixedText||!!w.userData.fallbackFixed;
  const layer={group,widgets,thoughts,
    // Refit the existing placement strategy as the recording moves; never anchor text to the weather patch.
    adapt(frame){
      layer.currentFrame=frame;
      const visible=[...widgets.values()].filter(w=>w.visible),cfg=w=>settingsOf(w.userData.response),fixed=visible.filter(w=>cfg(w).fixedText);
      if(fixed.length){const camera=ctx.frameCamera(frame);for(const w of fixed){const i=visible.indexOf(w),stability=cfg(w).stability;
        const d=w.userData,pose=fixedPose(w,frame,i,camera);
        if(!d.fixedText||Math.abs(d.width-pose.width)>.0001)moveResponseWidget(w,pose,0);
        else{w.position.copy(pose.position);w.quaternion.copy(pose.quaternion);}
        if(d.adaptedFrame!==frame)d.compositeInitialized=false;
        Object.assign(d,{fixedText:true,placementHidden:false,adaptedFrame:frame,adaptedStability:stability});
      }}
      const viewport=ctx.viewport?.(),viewKey=viewport?`${viewport.width}:${viewport.height}`:'';
      const todo=visible.filter(w=>!cfg(w).fixedText&&(w.userData.fixedText||w.userData.adaptedFrame!==frame||w.userData.adaptedView!==viewKey||w.userData.adaptedStability!==cfg(w).stability||w.userData.adaptedFallback!==cfg(w).fallback));
      if(!todo.length)return;
      if(adapting)return adapting;
      const gen=generation;
      adapting=Promise.all(todo.map(async w=>{
        const d=w.userData,stability=cfg(w).stability,fallback=cfg(w).fallback;
        d.anchorState||={};
        const previous=d.fixedText?null:(d.pendingSurfacePose||d.pose);
        const pose=await place({...d.response,frame,aspect:d.aspect,textMetrics:d.text.material.map.image.textMetrics,
          previousPose:previous,anchorState:d.anchorState,allowSearch:performance.now()-(d.lastSurfaceSearch??-Infinity)>=250,
          onSearch:()=>{d.lastSurfaceSearch=performance.now();}},ctx);
        if(previous===d.pendingSurfacePose)pose.reusedSurface=false;
        return {w,pose,stability,fallback};
      })).then(results=>{
        if(gen!==generation)return;
        if(layer.currentFrame!==frame){
          // Keep a completed search as a candidate, never as a rendered stale pose.
          // The next frame re-certifies it against its own camera and depth.
          for(const {w,pose} of results)if(widgets.get(w.userData.response.id)===w&&!pose.unreadable&&!pose.reusedSurface)w.userData.pendingSurfacePose=pose;
          return;
        }
        for(const {w,pose,stability,fallback} of results)if(widgets.get(w.userData.response.id)===w&&!cfg(w).fixedText){
          w.userData.pendingSurfacePose=null;
          // No surface fits (and no floating pose either): the response still shows, pinned in the view like Fixed text, until one does.
          if(pose.unreadable){const d=w.userData,fp=fixedPose(w,frame,visible.indexOf(w));
            if(!d.fixedText||Math.abs(d.width-fp.width)>.0001)moveResponseWidget(w,fp,0);else{w.position.copy(fp.position);w.quaternion.copy(fp.quaternion);}
            if(d.adaptedFrame!==frame)d.compositeInitialized=false;
            Object.assign(d,{placementHidden:false,fixedText:true,fallbackFixed:true,adaptedFrame:frame,adaptedView:viewKey,adaptedStability:stability,adaptedFallback:fallback,
              placementDecision:{hold:false,reason:'fixed-fallback',detail:pose.reason}});continue;}
          if(w.userData.adaptedFrame!=null&&Math.abs(frames[frame].t-frames[w.userData.adaptedFrame].t)>1){w.userData.legibility?.reset();w.userData.compositeInitialized=false;}
          // Search failure is presentation state, never a replacement world anchor.
          if(!pose.unreadable&&(!pose.reusedSurface||w.userData.fixedText)){moveResponseWidget(w,pose,responseSlot(w.userData.response,visible.indexOf(w)));w.userData.compositeInitialized=false;}
          Object.assign(w.userData,{placementHidden:false,fixedText:false,fallbackFixed:false,adaptedFrame:frame,adaptedView:viewKey,adaptedStability:stability,adaptedFallback:fallback,
            placementDecision:{hold:!!pose.reusedSurface,reason:pose.anchorGrace?'transient-loss':pose.reusedSurface?'world-anchor':pose.kind==='view-fallback'?'floating-fallback':'new-surface'}});
        }
      }).catch(e=>console.warn('live placement',e)).finally(()=>{adapting=null;onAnimate?.();});
      return adapting;
    },
    // Response content draws after hand protection, including surface-anchored text.
    // Each pass samples its current background before drawing its own text and controls.
    renderAfter(renderer,camera,controls,frame,sample=true,pass='all'){
      for(const w of widgets.values()){
        const m=w.userData.surfaceMotion;if(!m)continue;
        const t=Math.min(1,(performance.now()-m.start)/m.duration),ease=t*t*(3-2*t);
        w.position.lerpVectors(m.from,m.to,ease);w.quaternion.slerpQuaternions(m.fromQ,m.toQ,ease);
        if(t===1)w.userData.surfaceMotion=null;else onAnimate?.();
      }
      if(sample){
        layer.orient(camera);
        if(controls?.userData.responseOffset&&controls.userData.owner){const owner=controls.userData.owner;controls.quaternion.copy(owner.quaternion);controls.position.copy(owner.position).add(controls.userData.responseOffset.clone().applyQuaternion(owner.quaternion));}
      }
      const excluded=[...widgets.values(),...thoughts.values()].filter(w=>w.visible&&pass!=='all'&&(pass==='fixed'?!drawnFixed(w):drawnFixed(w)));
      const originalControlsVisible=controls?.visible;
      for(const w of excluded)w.visible=false;
      if(controls?.userData.owner&&excluded.includes(controls.userData.owner))controls.visible=false;
      try{
        group.visible=true;if(!controls?.visible&&![...widgets.values(),...thoughts.values()].some(w=>w.visible))return;
        let passes=backgrounds.get(renderer);if(!passes){passes=new Map();backgrounds.set(renderer,passes);}
        let bg=passes.get(pass);if(!bg){const canvas=new OffscreenCanvas(1,1);bg={canvas,ctx:canvas.getContext('2d',{willReadFrequently:true}),texture:new THREE.CanvasTexture(canvas),last:-Infinity};bg.texture.colorSpace=THREE.SRGBColorSpace;passes.set(pass,bg);}
        const pendingBeforeSample=[...widgets.values()].filter(w=>w.visible&&!w.userData.fixedText&&(w.userData.placementHidden||w.userData.pose.unreadable));
        if([...widgets.values(),...thoughts.values()].filter(w=>w.visible).every(w=>pendingBeforeSample.includes(w))&&(!controls?.visible||pendingBeforeSample.includes(controls.userData.owner)))return;
        const revision=ctx.getStyleRevision?.();
        if(performance.now()-bg.last>180||sample&&(bg.frame!==frame||bg.revision!==revision||[...widgets.values()].some(w=>w.visible&&(!w.userData.compositeInitialized||w.userData.compositePass!==pass)))){bg.frame=frame;bg.revision=revision;const source=renderer.domElement;bg.canvas.width=Math.min(768,source.width);bg.canvas.height=Math.max(1,Math.round(bg.canvas.width*source.height/source.width));bg.ctx.drawImage(source,0,0,bg.canvas.width,bg.canvas.height);bg.texture.needsUpdate=true;bg.last=performance.now();
          if(sample)for(const w of widgets.values())if(w.visible){if(!w.userData.compositeInitialized||w.userData.compositePass!==pass){w.userData.legibility?.reset();w.userData.compositeInitialized=true;w.userData.compositePass=pass;}applyResponseStyle(w,rateBackgroundImage(w,bg.canvas,camera));w.userData.backgroundSource='composited-scene';w.userData.styleFrame=frame;}
          if(controls?.visible&&controls.userData.owner){controls.material.color.copy(controls.userData.owner.userData.text.material.color);}
          else if(controls?.visible){const rating=rateBackgroundImage({updateMatrixWorld:()=>controls.updateWorldMatrix(true,true),userData:{text:controls}},bg.canvas,camera);if(rating.sample){const style=styleFor(rating);controls.material.color.setRGB(...style.text);const glass=controls.userData.adaptiveGlass;if(glass){glass.visible=!!style.glass;if(style.glass){glass.material.uniforms.tint.value.setRGB(...style.glass.tint);glass.material.uniforms.mixAmount.value=style.glass.mix;}}}}
        }
        if(sample)for(const w of widgets.values())if(w.visible)paintResponseStyle(w,w.userData.legibility?.value(performance.now()));
        if(controls?.visible&&controls.userData.owner)controls.material.color.copy(controls.userData.owner.userData.text.material.color);
        layer.setTarget('video',bg.texture,renderer.getDrawingBufferSize(new THREE.Vector2()));
        const controlGlass=controls?.userData.adaptiveGlass;if(controlGlass){const u=controlGlass.material.uniforms;u.tFrame.value=bg.texture;u.useFrame.value=1;renderer.getDrawingBufferSize(u.resolution.value);}
        const parent=group.parent,controlParent=controls?.parent,auto=renderer.autoClear;group.visible=true;presentationScene.add(group);if(controls)presentationScene.add(controls);
        // World anchors remain visible during async validation; sustained loss hides them without deleting them.
        const pending=[...widgets.values()].filter(w=>w.visible&&!w.userData.fixedText&&(w.userData.placementHidden||w.userData.pose.unreadable));
        for(const w of pending)w.visible=false;
        const controlsVisible=controls?.visible;if(controls?.userData.owner&&pending.includes(controls.userData.owner))controls.visible=false;
        try{renderer.autoClear=false;renderer.clearDepth();renderer.render(presentationScene,camera);}finally{for(const w of pending)w.visible=true;if(controls)controls.visible=controlsVisible;parent?.add(group);if(controls)controlParent?.add(controls);renderer.autoClear=auto;}
      }finally{for(const w of excluded)w.visible=true;if(controls)controls.visible=originalControlsVisible;}
    },
    get conversation(){return conversation;},
    get questions(){return questions;},
    get responses(){return sourceResponses;},
    get caption(){return caption.visible?captionText:null;},
    get hold(){return hold;},
    // Hold state from the editor's playback (null when not holding).
    setHold(h,{continueDelivery=false}={}){
      if(continueDelivery&&hold)deliveries.set(hold.id,{...hold,start:performance.now()});
      if(h)deliveries.delete(h.id);
      if(h&&h.id!==hold?.id){clearCaption();captionOwner=h.id;dismissedCaption=null;}
      if(!h&&hold&&!continueDelivery){dismissedCaption=hold.id;clearCaption();}
      hold=h;apply();
      onAnimate?.();
    },
    get delivery(){return [...deliveryClocks().values()].filter(c=>{const q=questions.find(q=>q.id===c.id);return q&&q.status!=='failed'&&(q.status!=='answered'||c.h<(q.latency||0)+(q.live?.read_s??READING.read_s));}).at(-1)||null;},
    focus(){return focusQuestion(questions,time,hold?.id||layer.delivery?.id);},
    setConversation(id){if(id===conversation)return;conversation=id;generation++;hold=null;questions=[];lastQuestionsKey='';captionOwner=dismissedCaption=null;clearCaption();removeAll();onChange?.([]);onAnimate?.();return layer.sync();},
    sync:()=>syncing??=sync().finally(()=>{syncing=null;}),
    start(interval=1000){const loop=()=>layer.sync().catch(()=>{}).finally(()=>{timer=setTimeout(loop,questions.some(q=>q.status==='running'||q.status==='queued')?120:interval);});loop();},
    stop(){clearTimeout(timer);},
    orient(camera){
      for(const w of widgets.values()){
        const d=w.userData;if(!w.visible||settingsOf(d.response).fixedText||d.pose.unreadable||!d.pose.surfaceAnchor)continue;
        d.pose.surfaceNormal||=new THREE.Vector3(0,0,1).applyQuaternion(d.pose.quaternion);
        const b=readableSurfaceBasis(d.pose.surfaceNormal,camera.quaternion,w.position,camera.position,camera),q=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(b.right,b.up,d.pose.surfaceNormal));
        if(d.pose.surface&&w.quaternion.angleTo(q)>1e-6){
          d.pose.baseSurface||=d.pose.surface;d.pose.baseSurfaceQuaternion||=d.pose.quaternion.clone();
          const rotation=d.pose.baseSurfaceQuaternion.clone().invert().multiply(q),a=new THREE.Vector3(1,0,0).applyQuaternion(rotation),b=new THREE.Vector3(0,1,0).applyQuaternion(rotation),fn=d.pose.baseSurface;
          d.pose.surface=(x,y)=>fn(a.x*x+b.x*y,a.y*x+b.y*y);
          bend(d.text,d.pose.surface);bend(d.glass,d.pose.surface);
        }
        w.quaternion.copy(q);d.pose.quaternion=q;
        if(d.surfaceMotion){d.surfaceMotion.fromQ.copy(q);d.surfaceMotion.toQ.copy(q);}
      }
    },
    update(t){time=t;apply();},
    // Questions change often while the agent works (new steps): re-apply so the streaming thought updates.
    refresh(){apply();},
    // The surfaces changed (the recording's depth correction finished, the layout was saved): every response is placed again from its
    // question's frame, as if seen for the first time. Saved conversations keep no poses, so a replay always uses the current placement.
    relayout(){placementEpoch++;for(const w of widgets.values()){group.remove(w);dispose(w);}widgets.clear();apply();},
    /** The response settings changed (src/response-settings.mjs): show, hide and place again. */
    refreshSettings(){apply();},
    replay(responseId){const w=widgets.get(responseId)||[...widgets.values()].find(w=>w.userData.response.component_ids?.includes(responseId));if(!w)return;w.userData.replay=performance.now();
      const step=()=>{apply();onAnimate?.();if(w.userData.replay)requestAnimationFrame(step);};requestAnimationFrame(step);},
    // Foremost screen layer: type first, then breathe a bright point at the final letter.
    renderHud(renderer){
      const delivery=layer.delivery,clock=hold||(delivery?.id===captionOwner?delivery:null);
      const q=captionQuestion(questions,clock,dismissedCaption);
      if(!q){clearCaption();return;}
      captionOwner=q.id;
      const now=performance.now();if(captionId!==q.id){captionId=q.id;captionStart=now;}
      const answerVisible=[...widgets.values()].some(w=>w.visible&&w.userData.response.question_id===q.id);
      const state=questionCaption(q,{clock,answerVisible,elapsed:(now-captionStart)/1000,reducedMotion:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches});
      const key=JSON.stringify([q.id,state.fullText,state.text]);
      if(key!==captionKey){caption.material.map?.dispose();caption.material.map=captionTexture(state.fullText,state.text);caption.material.needsUpdate=true;captionKey=key;}
      captionText=state.text;waitingDot.material.uniforms.opacity.value=state.dotOpacity;
      const size=renderer.getDrawingBufferSize(new THREE.Vector2()),img=caption.material.map.image,w=1.84,h=w*img.height/img.width*size.x/size.y;
      caption.scale.set(w,h,1);caption.position.set(0,-1+.03+h/2,0);
      caption.visible=!!state.text;
      waitingDot.visible=caption.visible&&state.waiting&&!!img.waitingDot;
      if(waitingDot.visible){const end=img.waitingDot;
        waitingDot.scale.set(w*48/img.width,h*48/img.height,1);
        waitingDot.position.set(caption.position.x+w*(end.x/img.width-.5),caption.position.y+h*(.5-end.y/img.height),0);}
      // An early-resume delivery still expires if playback reaches the end or is paused.
      if(state.animated||(!hold&&clock&&q.status==='answered'))onAnimate?.();
      if(!caption.visible)return;
      const clear=renderer.autoClear;renderer.autoClear=false;renderer.clearDepth();renderer.render(hudScene,hudCamera);renderer.autoClear=clear;
    },
    // The glass blurs the video frame only in the video view.
    setTarget(target,frameTexture,resolution){for(const w of widgets.values()){const u=w.userData.glass.material.uniforms;u.useFrame.value=target==='video'&&frameTexture?1:0;u.tFrame.value=frameTexture||null;if(resolution)u.resolution.value.copy(resolution);}},
    // The response under a pointer (normalised device coordinates) for a camera, if any.
    pick(ndc,cam){const ray=new THREE.Raycaster();ray.setFromCamera(ndc,cam);const hit=ray.intersectObjects([...widgets.values()].filter(w=>w.visible).map(w=>w.userData.text),false)[0];return hit?hit.object.parent.userData.response:null;},
    ask:(frame,t,text,live,weather_mod=false,text_response,findmy_mod=false)=>post('/api/agent/questions',{frame,t,text,live,weather_mod,text_response,findmy_mod}).then(q=>{layer.sync();return q;}),
    deleteQuestion:id=>post('/api/agent/questions/delete',{id}).then(()=>layer.sync()),
    // The frame the editor shows is the simulated user's state for terminal questions; send it at most every 200 ms.
    report(state){pending=state;if(!reportTimer)reportTimer=setTimeout(()=>{reportTimer=null;post('/api/agent/state',pending).catch(()=>{});},200);}};
  return layer;
}
