import * as THREE from 'three';
import {responseReady,responseSlot,presentationResponses,latestPresentation,FRAME_EPS} from './response-parts.mjs';
import {place,readableSurfaceBasis} from './placement.mjs';
import {pickStyle} from './legibility.mjs';
import {createLegibilityTracker} from './legibility-temporal.mjs';
import {questionCaption,captionQuestion} from './question-caption.mjs';
import {bubbleOutline} from './spatial-ui/dialogue.mjs';
import {drawWritten,writtenLength,loadOutlines,outlinesReady} from './text-writing.mjs';
// The agent on a real surface, replayed in scenario time: from the frame a question is asked, its thinking streams as faint text on
// input area (each step when it really happened); responses alone appear as softly glowing text,
// followed by reading time, while the video holds on the question's frame (see holdLength()). The text glows in one muted colour
// picked for the video behind it; only where no colour is legible there does it get a frosted-glass backing (legibility.mjs).

const PX=1024,PAD=64,FONT='system-ui,-apple-system,"PingFang SC","Hiragino Sans GB",sans-serif';
// Info answers (response.info: about a thing carrying info) are hand-lettered: Mansalva (Google Fonts, linked in index.html), loaded before
// their first texture is drawn.
const INFO_FONT=`Mansalva,${FONT}`;let infoFont=null;
const fontFor=r=>r.info?.key?INFO_FONT:FONT;
// How answer text is set (Response tab, src/app.mjs; setTextBehavior): bodySize scales the whole answer in the room (the body's x-height
// on screen, src/text-view.mjs), headingSize the heading against the body, showHeading shows or hides the title and markdown headings
// ("# …", "## …" lines) in the body. writing: an answer that appears while the user waits for it (asked, or replayed) is written
// character by character at writingSpeed characters per second, writingStrokes drawing each with a pen (src/text-writing.mjs).
export const TEXT_BEHAVIOR={bodySize:1,headingSize:1,showHeading:true,writing:true,writingStrokes:true,writingSpeed:30};
let textBehavior={...TEXT_BEHAVIOR};
export function setTextBehavior(b){textBehavior={...TEXT_BEHAVIOR,...b};}
function infoFontReady(){
  if(infoFont)return infoFont;
  // The font face is declared by the Google stylesheet: wait for it (3 s at most; offline, the system font stands in), then for the face.
  const link=document.querySelector('link[href*="family=Mansalva"]'),sheet=link&&!link.sheet?new Promise(r=>{link.addEventListener('load',r,{once:true});link.addEventListener('error',r,{once:true});setTimeout(r,3000);}):Promise.resolve();
  return infoFont=sheet.then(()=>document.fonts?.load('72px Mansalva')).catch(()=>{});
}
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
// The body's x-height (px): the size measure of a canvas with no text yet (an answer still to stream in).
function bodyXHeight(ctx,font){ctx.font=`500 46px ${font}`;const m=ctx.measureText('x');return m.actualBoundingBoxAscent+m.actualBoundingBoxDescent||22;}
// White text with a soft cool glow on a transparent canvas.
// previousBudget.columns: the canvas width (the line length; the type size is the same in every width, LAYOUT_COLUMNS).
// Object-centric Dialogue (r.dialogue: a speech bubble on the thing) wraps at DIALOGUE_COLUMNS and its canvas is only as wide and tall as its text, so the
// bubble fits the text (no room kept while it streams).
const DIALOGUE_COLUMNS=640;
// Line height (of the type size) and the room between the heading and the text: a heading's lines sit closer than the body's.
const TITLE_LEAD=1.08,BODY_LEAD=1.22,TITLE_GAP=6;
// How far the glass behind text fades out beyond its ink, in canvas px (half a body line).
const GLASS_FEATHER=26;
/** An answer's text as ModOS draws it (a canvas texture; image.box: its ink), for views outside the agent layer (the Vocabulary). */
export const answerTexture=(r,{dark=false,fit=false,columns=null}={})=>glowTexture(r,dark,fit||columns?{fit,columns}:null);
const YES_NO_MARK={Yes:{color:'#3ddc84',shape:'check'},No:{color:'#ff5d5d',shape:'cross'}};
// The mark and its word, in the mark's colour, at the heading line's place (x: the line's left, y: its top).
function drawMark(ctx,l,font,x,y){
  const s=l.size,{color,shape}=l.mark,cx=x+s*.42,cy=y+s*.52,k=s*.3;
  ctx.shadowBlur=10;ctx.shadowColor='rgba(0,0,0,.35)';ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=s*.13;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
  if(shape==='check'){ctx.moveTo(cx-k,cy);ctx.lineTo(cx-k*.25,cy+k*.75);ctx.lineTo(cx+k*1.05,cy-k*.8);}
  else{ctx.moveTo(cx-k*.8,cy-k*.8);ctx.lineTo(cx+k*.8,cy+k*.8);ctx.moveTo(cx+k*.8,cy-k*.8);ctx.lineTo(cx-k*.8,cy+k*.8);}
  ctx.stroke();ctx.font=font;ctx.textBaseline='top';ctx.fillText(l.text,x+l.indentPx,y);
}
// The writing ball: while the language model writes the text anew (or for the first time), a white ball breathes at its left, at
// full brightness even while the text it replaces is dimmed (text_writing). Its look is the question's waiting dot's.
const WRITING_BREATH_MS=1600,WRITING_SIZE=2.2;   // the ball's square, in first lines (its core is about a third of it)
const writingBall=()=>new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.ShaderMaterial({transparent:true,toneMapped:false,depthWrite:false,
  uniforms:{opacity:{value:0}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`uniform float opacity;varying vec2 vUv;
    void main(){float r=length(vUv-.5);
      float core=1.-smoothstep(.13,.19,r),halo=.25*(1.-smoothstep(.16,.5,r));
      gl_FragColor=vec4(mix(vec3(.8,.9,1.),vec3(1.),core),max(core,halo)*opacity);
      #include <colorspace_fragment>
    }`}));
/** The ball's state this frame: o, how visible the answer is (before a stale text's dimming); breathing while it shows. */
function syncWriting(w,o,now){
  const d=w.userData,on=o>0&&!!d.response.text_writing,img=d.text.material.map?.image;
  if(!on||!img?.writingAt){if(d.writing)d.writing.visible=false;return false;}
  if(!d.writing){d.writing=writingBall();d.writing.renderOrder=5;w.add(d.writing);}
  const b=.5+.5*Math.sin(now/WRITING_BREATH_MS*2*Math.PI),u=d.width/img.width,s=WRITING_SIZE*img.writingAt.size*u*(.85+.2*b);
  d.writing.scale.set(s,s,1);d.writing.position.set((img.writingAt.x/img.width-.5)*d.width,(.5-img.writingAt.y/img.height)*d.height,.001);
  d.writing.material.uniforms.opacity.value=o*(.45+.55*b);d.writing.visible=true;return true;
}
// A yes-or-no heading's mark on its own layer over the text (not tinted with it), as bright as the text.
function syncMark(w,o){
  const d=w.userData,src=d.text.material.map,img=src?.image;
  if(!img?.mark){if(d.mark)d.mark.visible=false;return;}
  if(!d.mark){d.mark=new THREE.Mesh(d.text.geometry,new THREE.MeshBasicMaterial({transparent:true,toneMapped:false,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-10}));d.mark.renderOrder=4;d.text.add(d.mark);}
  if(d.mark.userData.src!==src){d.mark.material.map?.dispose();const t=new THREE.CanvasTexture(img.mark);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;d.mark.material.map=t;d.mark.material.needsUpdate=true;d.mark.userData.src=src;}
  d.mark.visible=o>0;d.mark.material.opacity=o;
}
function glowTexture(r,dark=false,previousBudget=null){
  // fit (Floating Text, placed again every frame): the box is the text as it is, with no room kept for a streaming answer to grow into.
  const FONT=fontFor(r),ego=!!r.dialogue,fit=!!previousBudget?.fit,COLS=previousBudget?.columns||(ego?DIALOGUE_COLUMNS:PX),reserve=r.reserve_text&&!ego&&!fit;let W=COLS;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),inner=W-2*PAD,lines=[];
  const add=(text,weight,size,gap,item=false)=>{ctx.font=`${weight} ${size}px ${FONT}`;for(const [i,l] of wrap(ctx,text,inner-(item?48:0)).entries())lines.push({text:l,weight,size,gap:i?6:gap,indent:item,bullet:item&&!i,lead:weight>=700?TITLE_LEAD:BODY_LEAD});};
  if(r.findmy?.status==='not_found')add('No mapped location found',600,46,0);
  if(r.findmy?.status==='ambiguous')add('Which item do you mean?',600,46,0);
  const {headingSize:hs,showHeading,bodySize}=textBehavior,heading=72*hs;
  // Object-centric Dialogue is the thing talking: no heading, only what it says.
  // A yes-or-no heading (the text's title form, modos/text.mjs) carries its mark: Yes a green check, No a red cross (Not sure plain),
  // drawn on a layer of its own (`canvas.mark`) so the text's tint (legibility.mjs) does not change its colour.
  const mark=r.title&&showHeading&&!ego?YES_NO_MARK[String(r.title).trim()]:null,markW=mark?Math.round(heading*1.05):0;
  const titleStart=lines.length;if(r.title&&showHeading&&!ego){add(r.title,700,heading,0);if(mark)Object.assign(lines[titleStart],{mark,indentPx:markW});}
  const titleCount=lines.length-titleStart,titleLines=reserve&&showHeading?Math.max(2,titleCount,previousBudget?.titleLines||0):titleCount;   // no room kept for a hidden heading
  for(let i=titleCount;i<titleLines;i++)lines.push({text:'',weight:700,size:heading,gap:i?6:0,lead:TITLE_LEAD});
  // The body, paragraph by paragraph; a markdown heading line ("# …": the heading size, "## …" and deeper: a little smaller) unless
  // headings are hidden.
  const bodyStart=lines.length;
  if(r.body){let first=true;for(const para of String(r.body).split(/\n+/)){const h=/^\s*(#{1,6})\s+(.*)$/.exec(para);
    if(h){if(showHeading&&!ego){add(h[2],700,h[1].length===1?heading:heading*.82,first?18:24);first=false;}continue;}
    if(para.trim()){add(para,500,46,first?(ego?0:TITLE_GAP):14);first=false;}}}
  const bodyCount=lines.length-bodyStart,bodyLines=reserve?Math.max(4,bodyCount,previousBudget?.bodyLines||0):bodyCount;
  for(let i=bodyCount;i<bodyLines;i++)lines.push({text:'',weight:500,size:46,gap:i?6:TITLE_GAP,lead:BODY_LEAD});
  for(const item of r.items||[])add(item,500,46,12,true);
  // A bubble whose words are still coming (the objects' UI comes first): "…" in it, so the bubble shows at once. Not ink: never written.
  if(ego&&r.reserve_text&&!lines.some(l=>l.text)){add('…',500,46,0);lines.at(-1).placeholder=true;}
  const footer=0;   // Weather's controls are placed on their own (src/weather-preview.mjs), not as a footer of the answer
  if(ego){let widest=0;for(const l of lines){ctx.font=`${l.weight} ${l.size}px ${FONT}`;widest=Math.max(widest,(l.indent?48:0)+ctx.measureText(l.text).width);}W=Math.max(2*PAD+1,Math.ceil(2*PAD+widest));}
  canvas.width=W;canvas.height=Math.ceil(PAD*2+lines.reduce((h,l)=>h+l.gap+l.size*(l.lead||BODY_LEAD),0)+footer);canvas.weatherFooter=footer;
  canvas.layoutBudget={titleLines,bodyLines,footer,columns:COLS,fit};
  // The ink's box in canvas pixels (the glass backs exactly this): widest line, first line's top to last line's baseline area.
  let right=PAD,bottom=PAD;{let y=PAD;for(const l of lines){y+=l.gap;ctx.font=`${l.weight} ${l.size}px ${FONT}`;right=Math.max(right,PAD+(l.indent?48:0)+(l.indentPx||0)+ctx.measureText(l.text).width);bottom=y+l.size*(ego?1.22:1);y+=l.size*(l.lead||BODY_LEAD);}}
  const box={x0:PAD,x1:footer||reserve?W-PAD:right,y0:PAD,y1:footer||reserve?canvas.height-32:bottom};
  ctx.textBaseline='top';
  // White: the material's colour tints text and glow alike (one glowing colour, picked per answer in legibility.mjs).
  // Dark text: the halo is a faint soft shadow; a full glow would read as a grey haze around the letters.
  const glow=dark?[[10,'rgba(255,255,255,.25)']]:[[28,'rgba(255,255,255,.8)'],[8,'rgba(255,255,255,.9)']],ink=[];
  let markCanvas=null;
  {let y=PAD;for(const l of lines){y+=l.gap;
    if(l.mark){markCanvas=document.createElement('canvas');markCanvas.width=canvas.width;markCanvas.height=canvas.height;drawMark(markCanvas.getContext('2d'),l,`${l.weight} ${l.size}px ${FONT}`,PAD,y);}
    else if(l.text&&!l.placeholder)ink.push({text:l.text,font:`${l.weight} ${l.size}px ${FONT}`,size:l.size,x:PAD+(l.indent?48:0),y,bullet:l.bullet,bulletX:PAD+8});y+=l.size*(l.lead||BODY_LEAD);}}
  for(const [blur,color] of glow){
    ctx.shadowBlur=blur;ctx.shadowColor=color;ctx.fillStyle='#ffffff';
    for(const l of ink){ctx.font=l.font;if(l.bullet)ctx.fillText('·',l.bulletX,l.y);ctx.fillText(l.text,l.x,l.y);}
  }
  canvas.ink={lines:ink,glow};   // for the writing effect (src/text-writing.mjs)
  if(markCanvas)canvas.mark=markCanvas;
  {let y=PAD;for(const l of lines){y+=l.gap;if(l.placeholder){ctx.shadowBlur=0;ctx.font=`${l.weight} ${l.size}px ${FONT}`;ctx.fillStyle='rgba(255,255,255,.75)';ctx.fillText(l.text,PAD,y);}y+=l.size*(l.lead||BODY_LEAD);}}
  canvas.box=box;
  canvas.writingAt=(sz=>({x:box.x0-sz*.95,y:box.y0+sz*.55,size:sz}))(lines[0]?.size??46);   // the writing ball: left of the text, at its first line
  const xHeights=lines.map(l=>{ctx.font=`${l.weight} ${l.size}px ${FONT}`;const m=ctx.measureText('x');return m.actualBoundingBoxAscent+m.actualBoundingBoxDescent;});
  canvas.textMetrics={scale:bodySize,xHeightRatio:(xHeights.length?Math.min(...xHeights):bodyXHeight(ctx,FONT))/W,box:{x0:box.x0/W,x1:box.x1/W,y0:box.y0/canvas.height,y1:box.y1/canvas.height}};
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
// Line lengths an answer may be set in (canvas widths; same type size): the default, three wider and shorter, three narrower and taller. Placement
// (src/text-surfaces.mjs) takes the one that fits the cleanest spot, e.g. a short wide block in a whiteboard's blank strip. Measured once
// per text; not for answers carried by an object.
export const LAYOUT_COLUMNS=[PX,1280,1600,1920,832,640,512];
const layoutCache=new WeakMap();
export function textLayouts(r){
  if(r.dialogue||r.reserve_text&&!r.title&&!r.body)return null;
  const key=JSON.stringify([r.title,r.body,r.items,textBehavior,!!r.info?.key]),hit=layoutCache.get(r);if(hit?.key===key)return hit.layouts;
  // the widths Floating Text may take are also measured fitted to the text (no reserved room), which is how it is set (`fit`)
  const measure=budget=>{const m=glowTexture(r,false,budget),out={aspect:m.image.height/m.image.width,textMetrics:m.image.textMetrics};m.dispose();return out;};
  const layouts=LAYOUT_COLUMNS.map(columns=>({columns,...measure({columns}),...(columns>=1280?{fit:measure({columns,fit:true})}:{})}));
  layoutCache.set(r,{key,layouts});return layouts;
}
// `frame`: where the answer is placed, the frame at which it appears (the user may have turned while the agent was thinking).
export async function createResponseWidget(r,ctx,stack=0,frame=r.frame,previous=null){
  if(r.info?.key)await infoFontReady();
  let map=glowTexture(r,false,previous?.userData.text.material.map.image.layoutBudget),aspect=map.image.height/map.image.width;
  // A bubble set again as its text streams in: its canvas is as wide as the text (glowTexture), so the same type size takes a width in
  // proportion to the canvas's (bubbleWidthScale). Its first words (after the "…" it showed while they came) must fit the view wholly
  // where it is (bubbleRequireInView), else it is placed afresh.
  const was=previous?.userData.text.material.map.image.width,placeholder=previous?.userData.response.dialogue&&!previous.userData.response.title&&!previous.userData.response.body;
  const anchorState=previous?.userData.anchorState||{};
  const pose=await place({...r,frame,aspect,textMetrics:map.image.textMetrics,layouts:textLayouts(r),previousPose:previous?.userData.pose,anchorState,
    bubbleWidthScale:was?map.image.width/was:1,bubbleRequireInView:!!placeholder},ctx);
  if(pose.layout&&pose.layout!==map.image.width||!!pose.viewFixed!==!!map.image.layoutBudget.fit){const columns=pose.layout||map.image.layoutBudget.columns;map.dispose();map=glowTexture(r,false,{columns,fit:!!pose.viewFixed});aspect=map.image.height/map.image.width;}
  ctx.onPlacement?.(r,pose,frame);
  const width=pose.width,height=width*aspect;
  const group=new THREE.Group();group.name=`agent-response-${r.id}`;group.position.copy(pose.position);group.quaternion.copy(pose.quaternion);
  // Standing on a surface: position is the bottom edge. Several answers at the same moment stack along the text's up axis.
  const shift=(pose.align==='bottom'?height/2:0)+stack*(r.part?height+.55*width:height*1.15);group.translateY(shift);
  const text=new THREE.Mesh(new THREE.PlaneGeometry(width,height,...SEGMENTS),new THREE.MeshBasicMaterial({map,transparent:true,toneMapped:false,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-8}));
  text.renderOrder=3;group.add(text);
  // Glass: solid exactly over the ink (no margin), then a soft blurred edge fading out beyond it (about half a body line).
  const box=map.image.box,WX=map.image.width,u=width/WX,H=map.image.height,inner=new THREE.Vector2((box.x1-box.x0)*u,(box.y1-box.y0)*height/H),feather=GLASS_FEATHER*u;
  const glass=new THREE.Mesh(new THREE.PlaneGeometry(inner.x+2*feather,inner.y+2*feather,...SEGMENTS),glassMaterial());glass.renderOrder=2;glass.visible=false;
  glass.position.set(((box.x0+box.x1)/2/WX-.5)*width,(.5-(box.y0+box.y1)/2/H)*height,-.002);
  glass.material.uniforms.size.value.set(inner.x+2*feather,inner.y+2*feather);glass.material.uniforms.inner.value.copy(inner);glass.material.uniforms.feather.value=feather;group.add(glass);
  // anchorState: carried over when set again (a streamed update).
  group.userData={response:r,text,glass,width,height,aspect,pose,rating:null,kind:pose.kind,anchorState};bend(text,pose.surface,shift);bend(glass,pose.surface,shift);syncTail(group);
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
// A bubble's fixed look: white text (its light texture), no glass, the dark fill.
function bubbleStyle(widget){
 const d=widget.userData;if(d.style?.side==='dark'){const old=d.text.material.map;d.text.material.map=glowTexture(d.response,false,old.image.layoutBudget);old.dispose();d.text.material.needsUpdate=true;}
 d.style=null;d.legibility?.reset();d.text.material.color.setRGB(1,1,1);d.glass.visible=false;d.bubble?.userData.fill.material.color.set(0x000000);
}
const isBubble=w=>w.userData.pose?.kind==='bubble';
function applyResponseStyle(widget,rating){
 if(isBubble(widget)){bubbleStyle(widget);return;}
 if(!rating.sample)return;const d=widget.userData;d.legibility||=createLegibilityTracker();
 const style=d.legibility.sample(rating.sample,rating.clutter,performance.now());delete rating.sample;d.rating=rating;paintResponseStyle(widget,style);
}
function paintResponseStyle(widget,style){
 if(isBubble(widget)){bubbleStyle(widget);return;}
 if(!style)return;const d=widget.userData;
  if(d.style?.side!==style.side){const old=d.text.material.map;d.text.material.map=glowTexture(d.response,style.side==='dark',old.image.layoutBudget);old.dispose();d.text.material.needsUpdate=true;}
 d.style=style;d.text.material.color.setRGB(...style.text);
 if(d.bubble){const {fill,line}=d.bubble.userData,[r,g,b]=style.text;line.material.color.setRGB(r,g,b);fill.material.color.setScalar(.2126*r+.7152*g+.0722*b>.5?0:1);}d.glass.visible=!!style.glass&&style.glassAlpha>.002;d.glass.material.uniforms.styleOpacity.value=style.glassAlpha;
 if(style.glass){d.glass.material.uniforms.tint.value.setRGB(...style.glass.tint);d.glass.material.uniforms.mixAmount.value=style.glass.mix;}
}
function moveResponseWidget(w,pose,stack){
 // A new line length (pose.layout, src/text-surfaces.mjs): the text is set again in it, in its current style.
 // Floating Text is set to fit its text (no reserved room); text set elsewhere keeps its reserve.
 const budget=w.userData.text.material.map.image.layoutBudget||{};
 if(pose.layout&&pose.layout!==w.userData.text.material.map.image.width||!!pose.viewFixed!==!!budget.fit){const d=w.userData,old=d.text.material.map;
   const map=glowTexture(d.response,d.style?.side==='dark',{footer:budget.footer||0,columns:pose.layout||budget.columns,fit:!!pose.viewFixed});
   d.text.material.map=map;d.text.material.needsUpdate=true;d.aspect=map.image.height/map.image.width;old.dispose();}
 const d=w.userData,width=pose.width,height=width*d.aspect,shift=(pose.align==='bottom'?height/2:0)+stack*(d.response.part?height+.55*width:height*1.15);
 const sameSurface=d.pose?.surfaceId&&d.pose.surfaceId===pose.surfaceId;
 const from=w.position.clone(),fromQ=w.quaternion.clone();
 w.position.copy(pose.position);w.quaternion.copy(pose.quaternion);w.translateY(shift);
 d.surfaceMotion=sameSurface&&(from.distanceTo(w.position)>.002||fromQ.angleTo(w.quaternion)>.01)?{from,fromQ,to:w.position.clone(),toQ:w.quaternion.clone(),start:performance.now(),duration:220}:null;
 d.text.geometry.dispose();d.text.geometry=new THREE.PlaneGeometry(width,height,...SEGMENTS);delete d.text.userData.flat;
 const map=d.text.material.map,box=map.image.box,WX=map.image.width,u=width/WX,H=map.image.height,inner=new THREE.Vector2((box.x1-box.x0)*u,(box.y1-box.y0)*height/H),feather=GLASS_FEATHER*u;
 d.glass.geometry.dispose();d.glass.geometry=new THREE.PlaneGeometry(inner.x+2*feather,inner.y+2*feather,...SEGMENTS);delete d.glass.userData.flat;
 d.glass.position.set(((box.x0+box.x1)/2/WX-.5)*width,(.5-(box.y0+box.y1)/2/H)*height,-.002);
 const uniforms=d.glass.material.uniforms;uniforms.size.value.set(inner.x+2*feather,inner.y+2*feather);uniforms.inner.value.copy(inner);uniforms.feather.value=feather;
 Object.assign(d,{width,height,pose,kind:pose.kind});bend(d.text,pose.surface,shift);bend(d.glass,pose.surface,shift);syncTail(w);
}
// A speech bubble (Object-centric Dialogue, pose.kind 'bubble'): a rounded box around the ink, filled (no outline), with a tail to pose.tail (the
// object, or toward it from the edge of the view: src/placement.mjs). Always white text on a dark fill: no colour adaptation (bubbleStyle).
// When the
// object is wholly out of the view (pose.offscreen), a small copy of its 3D model turns slowly at the tail's tip, so one knows who speaks.
const BUBBLE_FILL=.78,BUBBLE_LINE=0,ICON=.45;   // ICON: the model's size, of the bubble's height
let modelOf=()=>null;   // object id → its model (Object3D) in the room (createAgentLayer: ctx.entityBox)
// A copy of a model for the bubble: its geometry shared (userData.sharedGeometry: not disposed with the widget), unlit materials (the
// answers' pass has no lights), drawn over everything like the bubble, scaled to fit a unit cube about its centre.
function modelIcon(model){
  const root=model.clone(true),box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),c=box.getCenter(new THREE.Vector3());
  root.traverse(o=>{if(!o.isMesh)return;o.userData.sharedGeometry=true;o.castShadow=o.receiveShadow=false;
    const lit=m=>new THREE.MeshBasicMaterial({map:m.map||null,color:m.color?m.color.clone():0xffffff,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,side:THREE.DoubleSide});
    o.material=Array.isArray(o.material)?o.material.map(lit):lit(o.material);o.renderOrder=4;});
  // The copy keeps the model's world transform, so it sits in the room: undo it, centred at the origin.
  model.updateWorldMatrix(true,false);const inv=new THREE.Matrix4().makeTranslation(-c.x,-c.y,-c.z);
  const holder=new THREE.Group(),inner=new THREE.Group();inner.add(root);root.matrixAutoUpdate=false;root.matrix.copy(inv.multiply(model.matrixWorld));
  inner.scale.setScalar(1/Math.max(1e-3,size.x,size.y,size.z));holder.add(inner);holder.userData.spin=inner;return holder;
}
function syncTail(w){
 const d=w.userData;
 if(d.pose?.kind!=='bubble'){if(d.bubble)d.bubble.visible=false;return;}
 if(!d.bubble){
  const material=(M,o)=>new M({color:0xffffff,transparent:true,opacity:o,depthTest:false,depthWrite:false,toneMapped:false});
  const fill=new THREE.Mesh(new THREE.BufferGeometry(),material(THREE.MeshBasicMaterial,BUBBLE_FILL)),line=new THREE.LineLoop(new THREE.BufferGeometry(),material(THREE.LineBasicMaterial,BUBBLE_LINE));
  fill.material.color.set(0x000000);fill.renderOrder=1;line.renderOrder=3;line.visible=false;d.bubble=new THREE.Group();d.bubble.add(fill,line);Object.assign(d.bubble.userData,{fill,line});w.add(d.bubble);
 }
 const {fill,line}=d.bubble.userData,map=d.text.material.map,b=map.image.box,H=map.image.height,WX=map.image.width,u=d.width/WX,pad=46*.6*u;
 const box={x0:(b.x0/WX-.5)*d.width-pad,x1:(b.x1/WX-.5)*d.width+pad,y0:(.5-b.y1/H)*d.height-pad,y1:(.5-b.y0/H)*d.height+pad};
 const tip=d.pose.tail&&new THREE.Vector3(...d.pose.tail).sub(w.position).applyQuaternion(w.quaternion.clone().invert());
 const pts=bubbleOutline(box,1.4*pad,tip&&{x:tip.x,y:tip.y},Math.min(.22*(box.y1-box.y0),.12*(box.x1-box.x0)));
 fill.geometry.dispose();fill.geometry=new THREE.ShapeGeometry(new THREE.Shape(pts));
 line.geometry.dispose();line.geometry=new THREE.BufferGeometry().setFromPoints(pts.map(p=>new THREE.Vector3(p.x,p.y,.001)));
 fill.position.z=-.003;d.bubble.visible=true;
 // The object's model at the tip when the object is out of the view, a little beyond the tip along the tail.
 const key=d.pose.offscreen&&tip?d.pose.objectId:null;
 if(d.bubble.userData.iconKey!==key){if(d.bubble.userData.icon){d.bubble.remove(d.bubble.userData.icon);dispose(d.bubble.userData.icon);d.bubble.userData.icon=null;}
   const model=key&&modelOf(key);if(model){d.bubble.userData.icon=modelIcon(model);d.bubble.add(d.bubble.userData.icon);}d.bubble.userData.iconKey=key;}
 const icon=d.bubble.userData.icon;
 if(icon){const size=ICON*(box.y1-box.y0),c=new THREE.Vector2((box.x0+box.x1)/2,(box.y0+box.y1)/2),dir=new THREE.Vector2(tip.x,tip.y).sub(c).normalize();
   icon.scale.setScalar(size);icon.position.set(tip.x+dir.x*size*.6,tip.y+dir.y*size*.6,.01);}
}
// On a curved surface the text (and its glass) follows the fitted surface: each vertex of the subdivided plane moves along the
// text's +Z to surface(x, y), in metres in the placement frame (shift: the group's offset along +Y from it). Flat otherwise.
const SEGMENTS=[24,8];
function bend(mesh,surface,shift=0){
  const pos=mesh.geometry.attributes.position,base=mesh.userData.flat||=pos.array.slice(),s=mesh.scale,o=mesh.position;
  for(let i=0;i<pos.count;i++){const x=base[3*i]*s.x+o.x,y=base[3*i+1]*s.y+o.y+shift;pos.setZ(i,surface?surface(x,y)/s.z:base[3*i+2]);}
  pos.needsUpdate=true;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
}
function dispose(group){group.traverse(o=>{if(o.isMesh||o.isLine){for(const m of [o.material].flat()){if(!o.userData.sharedGeometry)m.map?.dispose();m.dispose();}if(!o.userData.sharedGeometry)o.geometry.dispose();}});}

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
  return questions.find(q=>q.status==='running'||q.status==='drafting')||[...questions].reverse().find(q=>Math.abs(t-q.t)<.06)||null;
}
/** What a typed question said e seconds after it began: its latest revision by then. */
export function typedText(q,e){return (q.revisions||[]).filter(r=>r.at<=e+1e-6).at(-1)?.text||'';}
// The caption's canvas height for two lines (captionTexture: 44 px type, 1.3 line height, 40 px padding), the band it always has.
// How bright a text left in view is while it no longer answers what is asked (a draft revised, nothing new written yet).
const TEXT_STALE=.4;
const TEXT_FADE_MS=300;   // a text written anew: the old one fades out in place meanwhile
const CAPTION_BAND_PX=Math.ceil(2*44*1.3+40);
// Caption of the user's question, drawn in screen space at the bottom of the video (not anchored in the room).
// tail: the last two lines (a long question being typed or spoken shows its newest words)
function captionTexture(text,shown=text,{tail=false}={}){
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),W=1600,size=44,font=`500 ${size}px ${FONT}`;ctx.font=font;
  const all=wrap(ctx,text,W-120),lines=tail?all.slice(-2):all.slice(0,2);canvas.width=W;canvas.height=Math.ceil(Math.max(1,lines.length)*size*1.3+40);
  ctx.font=font;ctx.textAlign='left';ctx.textBaseline='top';ctx.fillStyle='rgba(255,255,255,.92)';ctx.shadowColor='rgba(0,0,0,.85)';ctx.shadowBlur=10;
  // Reserve the complete question's layout so partial words cannot re-centre or move lines.
  let cursor=0;lines.forEach((l,i)=>{const at=text.indexOf(l,cursor),start=at<0?cursor:at;cursor=start+l.length;
    const width=ctx.measureText(l).width,x=(W-width)/2,y=20+i*size*1.3;
    ctx.fillText(l.slice(0,Math.max(0,shown.length-start)),x,y);
    canvas.waitingDot={x:x+width+20,y:y+size*.52};});
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;return map;
}
export function createAgentLayer({scene,frames,sessionPath,onChange,onStatus,onAnimate,...ctx}){
  ctx.frames=frames;modelOf=id=>ctx.entityBox?.(id)?.model||null;
  const group=new THREE.Group();group.name='agent-responses';scene.add(group);
  const widgets=new Map(),thoughts=new Map(),ghosts=new Set();let hold=null,conversation=null,generation=0,time=0,timer=null,reportTimer=null,pending=null,syncing=null,questions=[],lastQuestionsKey='';
  // withdrawnParts: a typed question's parts that left its surface while it was typed (scripts/agent_store.py _withdraw), shown only
  // while its typing is replayed (typing: {id, e}, e = seconds since the question began; src/response-parts.mjs typedReady)
  let sourceResponses=[],withdrawnParts=[],typing=null,reconciling=false;
  const sources=()=>[...sourceResponses,...withdrawnParts];
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
  // The caption's top edge in the view's -1..1 height (null while none shows): Floating Text stands just above it (src/placement.mjs).
  // The caption's band: room for two lines at the bottom of the view, kept whether or not a caption shows or how many lines it has, so
  // what stands above it (Floating Text, the view stack) does not move as a question's words come, change or go. Its top, in the view's
  // -1..1 height (set each frame with the view's aspect, renderHud).
  let captionBand=null,showCaption=true;ctx.captionTop=()=>captionBand;   // showCaption: Input › Caption (off: no caption, and no band kept for it)
  let captionText='',captionKey='',captionId=null,captionStart=0,captionOwner=null,dismissedCaption=null;
  let stackBase=null;   // the view stack's base while an answer stands (viewTop)
  function clearCaption(){caption.visible=waitingDot.visible=false;captionText='';captionId=null;captionKey='';}
  const url=p=>{const u=new URL(p,location.href);u.searchParams.set('session',sessionPath);if(conversation)u.searchParams.set('conversation',conversation);return u;};
  const post=(p,body)=>fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:sessionPath,conversation,...body})}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;});
  // Writing (TEXT_BEHAVIOR.writing): per response id, how far its text is written ({n: characters, last: ms}; n Infinity: complete).
  // An answer starts written from nothing when it first shows while the user waits for it (its question's hold, asked or replayed, or
  // its delivery after playback went on); one seen any other way (scrubbing) shows complete.
  const writers=new Map();
  function startWriting(id){if(!textBehavior.writing){writers.set(id,{n:Infinity});return;}loadOutlines().then(()=>onAnimate?.());writers.set(id,{n:0,last:performance.now()});}
  // Advances every visible writing answer and redraws its texture; true while one is still writing.
  function write(){
    const now=performance.now();let active=false;
    for(const w of widgets.values()){
      const d=w.userData,wr=writers.get(d.response.id);if(!wr||wr.n===Infinity)continue;
      const canvas=d.text.material.map.image;
      if(!textBehavior.writing){wr.n=Infinity;drawWritten(canvas,Infinity);d.text.material.map.needsUpdate=true;continue;}
      if(!w.visible){wr.last=now;continue;}
      const total=writtenLength(canvas),streaming=d.response.stream?.status==='streaming';
      // words still to come: nothing to write yet; with the question answered and no words (Send alone: its message is in its card), none will come
      if(!total&&d.response.reserve_text){if(questions.find(q=>q.id===d.response.question_id)?.status==='answered'&&!d.response.stream)wr.n=Infinity;else wr.last=now;continue;}
      wr.n=Math.min(total,wr.n+(now-wr.last)/1000*textBehavior.writingSpeed);wr.last=now;
      if(wr.n>=total&&!streaming)wr.n=Infinity;
      const key=`${wr.n}|${textBehavior.writingStrokes}|${outlinesReady()}`;
      if(canvas.writtenKey!==key){drawWritten(canvas,wr.n,{strokes:textBehavior.writingStrokes});canvas.writtenKey=key;d.text.material.map.needsUpdate=true;}
      if(wr.n!==Infinity)active=true;
    }
    if(active)onAnimate?.();
    return active;
  }
  function removeAll(){deliveries.clear();writers.clear();sourceResponses=[];withdrawnParts=[];for(const w of [...widgets.values(),...thoughts.values(),...[...ghosts].map(g=>g.w)]){group.remove(w);dispose(w);}widgets.clear();thoughts.clear();ghosts.clear();}
  // One poll returns the conversation's questions and responses; widgets follow the responses.
  async function sync(){
    if(!conversation)return null;const gen=generation;
    const res=await fetch(url('/api/agent/status'));const status=await res.json();if(!res.ok)throw Error(status.error);
    if(gen!==generation)return null; // switched conversation meanwhile
    // New or changed questions change the caption: redraw.
    const questionsKey=JSON.stringify(status.questions.map(q=>[q.id,q.status,q.trace?.length||0]));questions=status.questions;
    if(questionsKey!==lastQuestionsKey){lastQuestionsKey=questionsKey;apply();onAnimate?.();}
    sourceResponses=status.responses;withdrawnParts=(status.withdrawn||[]).map(r=>({...r,withdrawn:true}));await reconcileWidgets();
    onStatus?.(status);return status;
  }
  // Bumped when the surfaces text is placed on change (relayout): widgets placed against the old ones are not kept.
  let placementEpoch=0;
  async function reconcileWidgets(){
    if(reconciling)return;reconciling=true;const gen=generation,epoch=placementEpoch;let changed=false;
    try{
      const list=presentationResponses(sources(),questions,hold,deliveryClocks(),typing),ids=new Set(list.map(r=>r.id));
      for(const [id,w] of widgets)if(!ids.has(id)){group.remove(w);dispose(w);widgets.delete(id);changed=true;}
      for(const r of list){
        const old=widgets.get(r.id);
        if(old&&old.userData.response.component_key===r.component_key)continue;
        // Streamed text updates in place; an object mod part that arrives meanwhile (or changes) places the answer again, on its object.
        // A text written anew (it answers a newer question) is not: the new one is made, and the old fades out where it stood.
        const rewritten=!!old&&old.userData.response.text_version!=null&&r.text_version!==old.userData.response.text_version;
        if(old&&!rewritten&&r.reserve_text&&(old.userData.response.dialogue?.speaker||null)===(r.dialogue?.speaker||null)&&updateResponseWidget(old,r)){changed=true;continue;}
        const q=questions.find(q=>q.id===r.question_id),frame=q?.frame??r.frame;
        const w=await createResponseWidget(r,ctx,list.filter(o=>o.id<r.id&&o.frame===r.frame).length,frame,old);
        const current=presentationResponses(sources(),questions,hold,deliveryClocks(),typing).find(p=>p.id===r.id);
        if(gen!==generation||epoch!==placementEpoch||!current||(current.component_key!==r.component_key&&((current.dialogue?.speaker||null)!==(r.dialogue?.speaker||null)||!updateResponseWidget(w,current)))){dispose(w);continue;}
        // A bubble that grows as its words stream in is the same bubble: it takes the old one's look and settled state at once, so it never
        // blinks out or shows a moment of glass while it is set again.
        if(isBubble(w))bubbleStyle(w);   // a bubble has its own fixed look from its first frame (no glass)
        if(old&&isBubble(old)&&isBubble(w)){for(const k of ['rating','compositeInitialized','adaptedFrame','adaptedView','adaptedStability','placementDecision','replay','compositePass','legibility','style'])w.userData[k]=old.userData[k];}
        if(old&&rewritten)ghosts.add({w:old,at:performance.now(),o:old.userData.text.material.opacity});
        else if(old){group.remove(old);dispose(old);}
        widgets.set(r.id,w);group.add(w);changed=true;
      }
    }finally{reconciling=false;}
    if(epoch!==placementEpoch)return reconcileWidgets();   // relaid out meanwhile: place again on the new surfaces
    if(changed){apply();onChange?.(sourceResponses);}
  }
  // During a hold (hold = {id, h, shownAt}): negative h types the question, then thinking until the answer at h = shownAt. Outside a hold, an answer
  // shows from its question's moment on (with auto-hide, only on that very frame: it was read during the hold). A replay fades the
  // answer in with a short glow pulse.
  // Per response {autoHide, stability}: its text MOD's duration and the library's placement stability (src/ui-settings.mjs answerSettings).
  const settingsOf=r=>({autoHide:false,stability:0,...ctx.getSettings?.(r)});
  function apply(){
    void reconcileWidgets().catch(e=>console.warn('response container',e));
    const now=performance.now(),clocks=deliveryClocks();
    const latest=latestPresentation([...widgets.values()].map(w=>w.userData.response),questions,time,hold,clocks,typing);let breathing=false;
    for(const w of widgets.values()){
      const r=w.userData.response,q=questions.find(q=>q.id===r.question_id),t0=q?q.t:r.t;let o;
      const delivery=clocks.get(q?.id);
      if(q&&typing?.id===q.id)o=1;   // the parts it showed then (presentationResponses)
      else if(q&&hold?.id===q.id)o=responseReady(r,q,hold)?1:0;
      else if(delivery)o=time>=t0-FRAME_EPS&&responseReady(r,q,delivery)&&(!settingsOf(r).autoHide||q.status!=='answered'||delivery.h<(q.latency||0)+(q.live?.read_s??READING.read_s))?1:0;
      else o=time>=t0-FRAME_EPS&&(!settingsOf(r).autoHide||time<=t0+.06)?1:0;
      const k=w.userData.replay?Math.min(1,(now-w.userData.replay)/REPLAY_MS):1;
      if(k<1){o*=THREE.MathUtils.smootherstep(k,0,.45);w.scale.setScalar(1+.06*Math.sin(Math.PI*k));}else{w.scale.setScalar(1);w.userData.replay=0;}
      if(r.id!==latest?.id)o=0;
      if(o>0&&!writers.has(r.id)){if(q&&(hold?.id===q.id||delivery))startWriting(r.id);else writers.set(r.id,{n:Infinity});}
      if(syncWriting(w,o,now))breathing=true;
      if(r.text_stale)o*=TEXT_STALE;   // it no longer answers what is asked: dimmed, not gone (a new text takes its place)
      showAt(w,o);
    }
    if(breathing)onAnimate?.();
    // a text written anew fades out where it stood while the new one is written there (TEXT_FADE_MS)
    for(const g of ghosts){const k=(now-g.at)/TEXT_FADE_MS;if(k>=1){group.remove(g.w);dispose(g.w);ghosts.delete(g);continue;}if(g.w.userData.writing)g.w.userData.writing.visible=false;showAt(g.w,g.o*(1-k));}
    if(ghosts.size)onAnimate?.();
  }
  function showAt(w,o){
    w.visible=o>0;w.userData.text.material.opacity=o;syncMark(w,o);if(w.userData.bubble){const {fill,line}=w.userData.bubble.userData;fill.material.opacity=BUBBLE_FILL*o;line.material.opacity=BUBBLE_LINE*o;w.userData.bubble.userData.icon?.traverse(c=>{if(c.isMesh)for(const m of [c.material].flat())m.opacity=o;});}w.userData.glass.material.uniforms.opacity.value=o;
  }
  // The caption sized to the view, at its bottom; draw: render it now (a typed question replayed).
  function drawCaption(renderer,draw=true){
    const size=renderer.getDrawingBufferSize(new THREE.Vector2()),img=caption.material.map.image,w=1.84,h=w*img.height/img.width*size.x/size.y;
    caption.scale.set(w,h,1);caption.position.set(0,-1+.03+h/2,0);
    if(draw&&showCaption){caption.visible=true;const clear=renderer.autoClear;renderer.autoClear=false;renderer.clearDepth();renderer.render(hudScene,hudCamera);renderer.autoClear=clear;}
    return {w,h,img};
  }
  const layer={group,widgets,thoughts,
    // Refit the existing placement strategy as the recording moves; never anchor text to the weather patch.
    adapt(frame){
      layer.currentFrame=frame;
      const visible=[...widgets.values()].filter(w=>w.visible),cfg=w=>settingsOf(w.userData.response);
      const viewport=ctx.viewport?.(),cap=ctx.captionTop?.(),viewKey=(viewport?`${viewport.width}:${viewport.height}`:'')+`:${cap==null?'-':cap.toFixed(3)}`;   // the caption too: Floating Text moves with it
      const todo=visible.filter(w=>w.userData.adaptedFrame!==frame||w.userData.adaptedView!==viewKey||w.userData.adaptedStability!==cfg(w).stability);
      if(!todo.length)return;
      if(adapting)return adapting;
      const gen=generation;
      adapting=Promise.all(todo.map(async w=>{
        const d=w.userData,stability=cfg(w).stability;
        d.anchorState||={};
        const previous=d.pendingSurfacePose||d.pose;
        const pose=await place({...d.response,frame,aspect:d.aspect,textMetrics:d.text.material.map.image.textMetrics,layouts:textLayouts(d.response),
          previousPose:previous,anchorState:d.anchorState,allowSearch:performance.now()-(d.lastSurfaceSearch??-Infinity)>=250,
          onSearch:()=>{d.lastSurfaceSearch=performance.now();}},ctx);
        if(previous===d.pendingSurfacePose)pose.reusedSurface=false;
        return {w,pose,stability};
      })).then(results=>{
        if(gen!==generation)return;
        if(layer.currentFrame!==frame){
          // Keep a completed search as a candidate, never as a rendered stale pose.
          // The next frame re-certifies it against its own camera and depth.
          for(const {w,pose} of results)if(widgets.get(w.userData.response.id)===w&&!pose.unreadable&&!pose.reusedSurface)w.userData.pendingSurfacePose=pose;
          return;
        }
        for(const {w,pose,stability} of results)if(widgets.get(w.userData.response.id)===w){
          w.userData.pendingSurfacePose=null;
          // Nowhere to place it yet (placement always offers Floating Text, so this is only a moment): hidden until it can be placed.
          if(pose.unreadable){Object.assign(w.userData,{placementHidden:true,adaptedFrame:frame,adaptedView:viewKey,adaptedStability:stability,
              placementDecision:{hold:false,reason:'unplaced',detail:pose.reason}});continue;}
          if(w.userData.adaptedFrame!=null&&Math.abs(frames[frame].t-frames[w.userData.adaptedFrame].t)>1){w.userData.legibility?.reset();w.userData.compositeInitialized=false;}
          // Search failure is presentation state, never a replacement world anchor.
          // Floating Text follows the camera: moved every frame, logged only when it starts floating.
          if(pose.viewFixed){const first=!w.userData.pose?.viewFixed;moveResponseWidget(w,pose,0);if(first){w.userData.compositeInitialized=false;ctx.onPlacement?.(w.userData.response,pose,frame);}}
          else if(!pose.reusedSurface){moveResponseWidget(w,pose,responseSlot(w.userData.response,visible.indexOf(w)));w.userData.compositeInitialized=false;ctx.onPlacement?.(w.userData.response,pose,frame);}
          Object.assign(w.userData,{placementHidden:false,adaptedFrame:frame,adaptedView:viewKey,adaptedStability:stability,
            placementDecision:{hold:!!pose.reusedSurface,reason:pose.anchorGrace?'transient-loss':pose.reusedSurface?'world-anchor':pose.kind==='view-float'?'floating':pose.kind==='info-float'?'info-float':pose.infoSettled?'info-surface':'new-surface'}});
        }
      }).catch(e=>console.warn('live placement',e)).finally(()=>{adapting=null;onAnimate?.();});
      return adapting;
    },
    // Response content draws after hand protection, including surface-anchored text.
    // Each pass samples its current background before drawing its own text and controls.
    renderAfter(renderer,camera,controls,frame,sample=true,pass='all'){
      write();
      // The model at an off-view bubble's tip turns slowly (one turn in 8 s).
      let spinning=false;for(const w of widgets.values()){const icon=w.visible&&w.userData.bubble?.visible&&w.userData.bubble.userData.icon;if(icon){icon.userData.spin.rotation.y=performance.now()/8000*2*Math.PI;spinning=true;}}
      if(spinning)onAnimate?.();
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
      const excluded=[...widgets.values(),...thoughts.values()].filter(w=>w.visible&&pass==='fixed');
      const originalControlsVisible=controls?.visible;
      for(const w of excluded)w.visible=false;
      if(controls?.userData.owner&&excluded.includes(controls.userData.owner))controls.visible=false;
      try{
        group.visible=true;if(!controls?.visible&&![...widgets.values(),...thoughts.values()].some(w=>w.visible))return;
        let passes=backgrounds.get(renderer);if(!passes){passes=new Map();backgrounds.set(renderer,passes);}
        let bg=passes.get(pass);if(!bg){const canvas=new OffscreenCanvas(1,1);bg={canvas,ctx:canvas.getContext('2d',{willReadFrequently:true}),texture:new THREE.CanvasTexture(canvas),last:-Infinity};bg.texture.colorSpace=THREE.SRGBColorSpace;passes.set(pass,bg);}
        const pendingBeforeSample=[...widgets.values()].filter(w=>w.visible&&(w.userData.placementHidden||w.userData.pose.unreadable));
        if([...widgets.values(),...thoughts.values()].filter(w=>w.visible).every(w=>pendingBeforeSample.includes(w))&&(!controls?.visible||pendingBeforeSample.includes(controls.userData.owner)))return;
        const revision=ctx.getStyleRevision?.();
        if(performance.now()-bg.last>180||sample&&(bg.frame!==frame||bg.revision!==revision||[...widgets.values()].some(w=>w.visible&&(!w.userData.compositeInitialized||w.userData.compositePass!==pass)))){bg.frame=frame;bg.revision=revision;const source=renderer.domElement;bg.canvas.width=Math.min(768,source.width);bg.canvas.height=Math.max(1,Math.round(bg.canvas.width*source.height/source.width));bg.ctx.drawImage(source,0,0,bg.canvas.width,bg.canvas.height);bg.texture.needsUpdate=true;bg.last=performance.now();
          // A locked answer (settled in the room, src/placement.mjs infoSettled) keeps the colour and glass it had when it locked: sampled
          // once more there, then frozen (styleLocked).
          if(sample)for(const w of widgets.values())if(w.visible&&!w.userData.styleLocked){if(!w.userData.compositeInitialized||w.userData.compositePass!==pass){w.userData.legibility?.reset();w.userData.compositeInitialized=true;w.userData.compositePass=pass;}applyResponseStyle(w,rateBackgroundImage(w,bg.canvas,camera));w.userData.backgroundSource='composited-scene';w.userData.styleFrame=frame;
            if(w.userData.pose?.infoSettled&&w.userData.style)w.userData.styleLocked=true;}
          if(controls?.visible&&controls.userData.owner){controls.material.color.copy(controls.userData.owner.userData.text.material.color);}
          else if(controls?.visible){const rating=rateBackgroundImage({updateMatrixWorld:()=>controls.updateWorldMatrix(true,true),userData:{text:controls}},bg.canvas,camera);if(rating.sample){const style=styleFor(rating);controls.material.color.setRGB(...style.text);const glass=controls.userData.adaptiveGlass;if(glass){glass.visible=!!style.glass;if(style.glass){glass.material.uniforms.tint.value.setRGB(...style.glass.tint);glass.material.uniforms.mixAmount.value=style.glass.mix;}}}}
        }
        if(sample)for(const w of widgets.values())if(w.visible)paintResponseStyle(w,w.userData.legibility?.value(performance.now()));
        if(controls?.visible&&controls.userData.owner)controls.material.color.copy(controls.userData.owner.userData.text.material.color);
        layer.setTarget('video',bg.texture,renderer.getDrawingBufferSize(new THREE.Vector2()));
        const controlGlass=controls?.userData.adaptiveGlass;if(controlGlass){const u=controlGlass.material.uniforms;u.tFrame.value=bg.texture;u.useFrame.value=1;renderer.getDrawingBufferSize(u.resolution.value);}
        const parent=group.parent,controlParent=controls?.parent,auto=renderer.autoClear;group.visible=true;presentationScene.add(group);if(controls)presentationScene.add(controls);
        // World anchors remain visible during async validation; sustained loss hides them without deleting them.
        const pending=[...widgets.values()].filter(w=>w.visible&&(w.userData.placementHidden||w.userData.pose.unreadable));
        for(const w of pending)w.visible=false;
        const controlsVisible=controls?.visible;if(controls?.userData.owner&&pending.includes(controls.userData.owner))controls.visible=false;
        try{renderer.autoClear=false;renderer.clearDepth();renderer.render(presentationScene,camera);}finally{for(const w of pending)w.visible=true;if(controls)controls.visible=controlsVisible;parent?.add(group);if(controls)controlParent?.add(controls);renderer.autoClear=auto;}
      }finally{for(const w of excluded)w.visible=true;if(controls)controls.visible=originalControlsVisible;}
    },
    get conversation(){return conversation;},
    get ctx(){return ctx;},   // placement context, for inspection (window.replay.agent.ctx)
    get questions(){return questions;},
    get responses(){return sourceResponses;},
    get caption(){return caption.visible?captionText:null;},
    /** Whether the user's question shows as a caption in the User's view (Input › Caption). */
    setCaption(on){showCaption=!!on;if(!on)caption.visible=waitingDot.visible=false;onAnimate?.();},
    get hold(){return hold;},
    /** Whether an answer to this question is still being written (TEXT_BEHAVIOR.writing). */
    writing(questionId){return [...widgets.values()].some(w=>w.visible&&w.userData.response.question_id===questionId&&(writers.get(w.userData.response.id)?.n??Infinity)!==Infinity);},
    /** A typed question replayed as it was typed (null: none): {id, e}, e seconds after it began. Its caption is the text typed by then
     *  and its surface what it showed then (src/response-parts.mjs typedReady); the video is not held. */
    setTyping(t){
      const key=t?`${t.id}@${t.e.toFixed(2)}`:null;if(key===(typing?`${typing.id}@${typing.e.toFixed(2)}`:null))return;
      if(!t&&typing){dismissedCaption=typing.id;clearCaption();}
      typing=t;if(t){dismissedCaption=null;captionOwner=t.id;}
      void reconcileWidgets().catch(()=>{});apply();onAnimate?.();
    },
    get typing(){return typing;},
    get withdrawn(){return withdrawnParts;},
    /** A typed question's runs (its trace per revision answered: {rev, at, steps}), for replaying its pipeline. */
    async runs(id){const u=url('/api/agent/questions/runs');u.searchParams.set('id',id);const r=await fetch(u);const j=await r.json();if(!r.ok)throw Error(j.error);return j.runs;},
    // Hold state from the editor's playback (null when not holding).
    setHold(h,{continueDelivery=false}={}){
      if(continueDelivery&&hold)deliveries.set(hold.id,{...hold,start:performance.now()});
      if(h)deliveries.delete(h.id);
      // A new hold (asked, or replayed): its answers are written again.
      if(h&&h.id!==hold?.id){clearCaption();captionOwner=h.id;dismissedCaption=null;for(const w of widgets.values())if(w.userData.response.question_id===h.id)writers.delete(w.userData.response.id);}
      if(!h&&hold&&!continueDelivery){dismissedCaption=hold.id;clearCaption();}
      hold=h;apply();
      onAnimate?.();
    },
    get delivery(){return [...deliveryClocks().values()].filter(c=>{const q=questions.find(q=>q.id===c.id);return q&&q.status!=='failed'&&(q.status!=='answered'||c.h<(q.latency||0)+(q.live?.read_s??READING.read_s));}).at(-1)||null;},
    focus(){return focusQuestion(questions,time,hold?.id||layer.delivery?.id);},
    setConversation(id){if(id===conversation)return;conversation=id;generation++;hold=null;questions=[];lastQuestionsKey='';captionOwner=dismissedCaption=null;clearCaption();removeAll();onChange?.([]);onAnimate?.();return layer.sync();},
    sync:()=>syncing??=sync().finally(()=>{syncing=null;}),
    start(interval=1000){const loop=()=>layer.sync().catch(()=>{}).finally(()=>{timer=setTimeout(loop,questions.some(q=>q.status==='running'||q.status==='queued'||q.status==='drafting')?120:interval);});loop();},
    stop(){clearTimeout(timer);},
    orient(camera){
      for(const w of widgets.values()){
        const d=w.userData;
        // an anchored dialogue bubble (src/placement.mjs) stays upright and turns to the user
        if(w.visible&&d.pose?.anchored){const y=Math.atan2(camera.position.x-w.position.x,camera.position.z-w.position.z);w.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),y);d.pose.quaternion=w.quaternion.clone();continue;}if(!w.visible||d.pose.unreadable||!d.pose.surfaceAnchor)continue;
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
    /** The top (the view's -1..1 height) of what stands fixed in view for the latest answer: its Floating Text, else the question's
     *  caption; null when neither shows. The view stack's UI stands above it (src/cluster-placement.mjs). */
    // Steady: while one question's answer stands, the stack's base only rises (when its text grows past it), never falls back as
    // the text is written again, withdrawn or re-fitted; so what stands on it does not jump. A new answer (or another view size)
    // starts it anew.
    viewTop(camera){
      let top=null,id=null;for(const w of widgets.values()){const t=w.userData.text;if(!w.visible||!w.userData.pose?.viewFixed||!t)continue;w.updateMatrixWorld(true);
        // the top of its ink, not of its texture's margin
        t.geometry.computeBoundingBox();const b=t.geometry.boundingBox,ink=t.material.map?.image?.textMetrics?.box,y=b.max.y-(ink?ink.y0:0)*(b.max.y-b.min.y);
        const p=t.localToWorld(new THREE.Vector3((b.min.x+b.max.x)/2,y,0)).project(camera);if(p.z<1){top=Math.max(top??-1,p.y);id=w.userData.response.question_id;}}
      top??=ctx.captionTop?.()??null;if(top==null){stackBase=null;return null;}
      const key=`${id??typing?.id??captionOwner}@${camera.aspect.toFixed(3)}`;
      if(stackBase?.key!==key||top>stackBase.top)stackBase={key,top};
      return stackBase.top;
    },
    update(t){time=t;apply();},
    // Questions change often while the agent works (new steps): re-apply so the streaming thought updates.
    refresh(){apply();},
    // The surfaces changed (the recording's depth correction finished, the layout was saved): every response is placed again from its
    // question's frame, as if seen for the first time. Saved conversations keep no poses, so a replay always uses the current placement.
    relayout(){placementEpoch++;for(const w of widgets.values()){group.remove(w);dispose(w);}widgets.clear();apply();},
    /** The settings changed (src/ui-settings.mjs, a MOD's): show, hide and place again. */
    refreshSettings(){apply();},
    // The arrival pulse is for an answer appearing: one already showing (a bubble that showed its first words) is not faded in again.
    replay(responseId){const w=widgets.get(responseId)||[...widgets.values()].find(w=>w.userData.response.component_ids?.includes(responseId));if(!w||w.visible&&w.userData.text.material.opacity>=.99)return;w.userData.replay=performance.now();
      const step=()=>{apply();onAnimate?.();if(w.userData.replay)requestAnimationFrame(step);};requestAnimationFrame(step);},
    // Foremost screen layer: type first, then breathe a bright point at the final letter.
    renderHud(renderer){
      {const size=renderer.getDrawingBufferSize(new THREE.Vector2());captionBand=-1+.03+(showCaption?1.84*CAPTION_BAND_PX/1600*size.x/size.y:0);}
      if(typing){const q=questions.find(q=>q.id===typing.id),text=q?typedText(q,typing.e):'';
        if(!text){clearCaption();return;}
        const key=JSON.stringify([q.id,'typed',text]);
        if(key!==captionKey){caption.material.map?.dispose();caption.material.map=captionTexture(text,text,{tail:true});caption.material.needsUpdate=true;captionKey=key;}
        captionText=text;captionId=q.id;waitingDot.visible=false;return drawCaption(renderer);}
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
      const {w,h,img}=drawCaption(renderer,false);
      caption.visible=!!state.text&&showCaption;
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
    // extra: {selection, selection_mode}: the thing carrying info the user selects at that frame (src/user-selection.mjs).
    ask:(frame,t,text,live,extra={})=>post('/api/agent/questions',{frame,t,text,live,...extra}).then(async q=>{await layer.sync().catch(()=>{});return q;}),
    deleteQuestion:id=>post('/api/agent/questions/delete',{id}).then(()=>layer.sync()),
    // Answer while typing (src/live-input.mjs; design doc 12): a draft's revision (the first one makes the question), asking it on
    // Enter, and dropping it when the box is cleared.
    draft:(id,frame,t,text,pause,extra={})=>post('/api/agent/drafts',{id,frame,t,text,pause,...extra}).then(q=>{layer.sync().catch(()=>{});return q;}),
    askDraft:(id,text,live)=>post('/api/agent/drafts/ask',{id,text,live}).then(async q=>{await layer.sync().catch(()=>{});return q;}),
    cancelDraft:id=>post('/api/agent/drafts/cancel',{id}).then(()=>layer.sync()),
    /** A spoken question's recording (a WAV Blob; started: when it began, epoch ms), kept with it in the space. */
    async setAudio(id,wav,started,mark=null){const u=url('/api/agent/questions/audio');u.searchParams.set('id',id);u.searchParams.set('started',started);
      if(mark){u.searchParams.set('t',mark.t);u.searchParams.set('t_at',mark.at);   // the video's time when Space went down, and when
        if(mark.end){u.searchParams.set('t_end',mark.end.t);u.searchParams.set('t_end_at',mark.end.at);u.searchParams.set('rate',mark.end.rate);}}   // and when it was let go
      const r=await fetch(u,{method:'POST',body:wav,headers:{'Content-Type':'audio/wav'}});const d=await r.json();if(!r.ok)throw Error(d.error);await layer.sync().catch(()=>{});return d;},
    // The frame the editor shows is the simulated user's state for terminal questions; send it at most every 200 ms.
    report(state){pending=state;if(!reportTimer)reportTimer=setTimeout(()=>{reportTimer=null;post('/api/agent/state',pending).catch(()=>{});},200);}};
  return layer;
}
