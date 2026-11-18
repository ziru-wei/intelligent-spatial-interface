import {createTransformHistory} from './transform-history.mjs';
import {surfaceQuality} from './surface-quality.mjs';
import {createRecordingHandCache} from './hand-perception/recording-cache.mjs';
import {createLatestFrameJob} from './latest-frame-job.mjs';
import {createHandCompositor} from './hand-perception/compositor.mjs';
import {createHandPerception} from './hand-perception/index.mjs';
import {locateHands} from './hand-perception/spatial.mjs';
import {selectInfoBox,FOVEA} from './user-selection.mjs';
import {createSelectionMarks} from './selection-marks.mjs';
import {createInfoVisual,arrowBetween} from './info-visual.mjs';
import {pickStyle,accentStyle} from './legibility.mjs';
import {labelRoom} from './layout-labels.mjs';
import {weatherResponse} from './response-parts.mjs';
import * as THREE from 'three';
import {computeBoundsTree,disposeBoundsTree,acceleratedRaycast} from 'three-mesh-bvh';
// Room meshes get a BVH (setRoom): raycasts and the triangles near a point in milliseconds instead of a scan of every triangle.
THREE.BufferGeometry.prototype.computeBoundsTree=computeBoundsTree;THREE.BufferGeometry.prototype.disposeBoundsTree=disposeBoundsTree;THREE.Mesh.prototype.raycast=acceleratedRaycast;
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {setPose,frameAt} from './math.mjs';
import {createWeatherSurfacePreview} from './weather-preview.mjs';
import {createWeatherScene} from './weather-scene.mjs';
import {createTwin} from './twin.mjs';
import {createLayoutEditor,dropCenter} from './layout-editor.mjs';
import {createTwinPanel} from './twin-panel.mjs';
import {createModsPanel} from './mods-panel.mjs';
import {path as labelPath} from './layout-tree.mjs';
import {createOutline} from './layout-outline.mjs';
import {createStructure} from './layout-structure.mjs';
import {createAlignPanel} from './align-panel.mjs';
import {load as loadUiSettings,answerSettings,modSetting,resumeOnFirstResponse,settingsControls} from './ui-settings.mjs';
import {createComponentHost} from './components.mjs';
import {visionMode,createVisionPanel} from './vision-panel.mjs';
import {createAgentLayer,READING,formatSpeed,stepsAt,setTextBehavior,TEXT_BEHAVIOR} from './agent.mjs';
import {questionClock} from './question-caption.mjs';
import {readModel,modelBounds,fitScale,boxFromModel,swapHTML,wireSwap} from './model-fit.mjs';
import {createDiorama} from './diorama.mjs';
import {createCueHost} from './cue-host.mjs';
import {partsToDraw} from '../modos/ui-rules.mjs';
import {createRouter,along} from './floor-route.mjs';
import {createDeviceCues} from './device-cues.mjs';
import {createActionCues} from './action-cues.mjs';
import * as cues from './spatial-ui/cues.mjs';
import {renderPipeline,whereAt} from './pipeline-view.mjs';
import {questionCaption} from './question-caption.mjs';
import {buildTextTargets,calibrate,applyOffsets} from './layout-surfaces.mjs';
import {createRelationTracker,viewOf} from './spatial-relations.mjs';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
const sessionURL=new URL(params.get('session')||'./spaces/demo/scenarios/demo/session.json',location.href);
const spaceURL=new URL('../../space.json',sessionURL);
const renderer=new THREE.WebGLRenderer({canvas:$('stage'),antialias:true,stencil:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
// anchor: the selected component's root (src/components.mjs); an empty stand-in while nothing is selected.
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),noSelection=new THREE.Group();let anchor=noSelection;
const pmrem=new THREE.PMREMGenerator(renderer);const roomEnv=new RoomEnvironment();scene.environment=pmrem.fromScene(roomEnv,.04).texture;roomEnv.dispose();pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xddefff,0x485442,2));const sun=new THREE.DirectionalLight(0xffe5c8,3);sun.position.set(2,5,3);scene.add(sun);
// Recorded per-frame depth as a depth-only full-screen pass: virtual fragments farther than the measured surface (+bias) fail the depth test.
const depthOccluder=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms:{depthMap:{value:null},proj:{value:new THREE.Vector2()},bias:{value:.03}},
  vertexShader:'out vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:'uniform sampler2D depthMap;uniform vec2 proj;uniform float bias;in vec2 vUv;void main(){float d=texture(depthMap,vec2(vUv.x,1.-vUv.y)).r;if(d<=0.)discard;d+=bias;gl_FragDepth=(-proj.x*d+proj.y)/d*.5+.5;}',
  colorWrite:false,depthWrite:true,depthTest:true,depthFunc:THREE.AlwaysDepth}));
depthOccluder.frustumCulled=false;depthOccluder.renderOrder=-2;depthOccluder.visible=false;scene.add(depthOccluder);
// Shadows: the components cast onto invisible copies of the room mesh (ShadowMaterial draws only the shadow) or, without a room, onto a floor plane under it.
// The light follows the object from nearly overhead; ARKit's y axis is gravity-aligned, so this is real "up".
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.02;scene.add(sun.target);
const SUN=new THREE.Vector3(.3,1,.2).normalize(),shadowMaterial=new THREE.ShadowMaterial({opacity:.45,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
// The room only receives shadows (letting it cast would put everything under the ceiling in shade), so the object's shadow would also land on
// surfaces hidden from the light by real furniture, e.g. the floor under a desk. Contact-style fade: full shadow on surfaces touching the
// object's bounding box, none beyond `fade` metres from it.
const shadowFade={boxMin:{value:new THREE.Vector3()},boxMax:{value:new THREE.Vector3()},fade:{value:.1}};
shadowMaterial.onBeforeCompile=sh=>{Object.assign(sh.uniforms,shadowFade);
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vShadowWorld;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvShadowWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vShadowWorld;uniform vec3 boxMin,boxMax;uniform float fade;')
    .replace('gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );','float gap=length(max(max(boxMin-vShadowWorld,vShadowWorld-boxMax),0.));gl_FragColor=vec4(color,opacity*(1.0-getShadowMask())*(1.0-smoothstep(0.,fade,gap)));');};
const catchers=new THREE.Group();catchers.visible=false;scene.add(catchers);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(50,50).rotateX(-Math.PI/2),shadowMaterial);ground.receiveShadow=true;
function rebuildCatchers(){catchers.clear();if(!room){catchers.add(ground);return;}room.updateMatrixWorld(true);room.traverse(o=>{if(o.isMesh){const m=new THREE.Mesh(o.geometry,shadowMaterial);m.matrixAutoUpdate=false;m.matrix.copy(o.matrixWorld);m.receiveShadow=true;catchers.add(m);}});}
function aimShadow(){
  const all=components.group;all.updateMatrixWorld(true);all.traverse(o=>{if(o.isMesh)o.castShadow=true;});
  const box=new THREE.Box3();for(const i of components.instances)if(i.root.visible)box.expandByObject(i.root);if(box.isEmpty())return;
  const c=box.getCenter(new THREE.Vector3()),r=Math.max(.2,box.getSize(new THREE.Vector3()).length()/2),cam=sun.shadow.camera;
  sun.target.position.copy(c);sun.position.copy(c).addScaledVector(SUN,r*4+2);Object.assign(cam,{left:-r*3,right:r*3,top:r*3,bottom:-r*3,near:.05,far:r*8+4});cam.updateProjectionMatrix();
  ground.position.y=box.min.y;
  shadowFade.boxMin.value.copy(box.min);shadowFade.boxMax.value.copy(box.max);shadowFade.fade.value=THREE.MathUtils.clamp(r*.6,.05,.5);
}
const drawSize=new THREE.Vector2();let agent=null,connected=false,roomParts=null,alignScan=null,toSpace=null;
let session,index=0,playing=false,start=0,startT=0,requested=0,room=null,roomName=null,roomData=null;
rebuildCatchers();
const textures=new Map(),depths=new Map(),textureLoads=new Map(),depthLoads=new Map();
const loader=new GLTFLoader();
const components=createComponentHost({scene,loader,siteURL:new URL('./',location.href),assetBase:sessionURL,invalidate:()=>update()});
// LiDAR mesh in the video (display option): this recording's own mesh (room.glb) as a wireframe over the frame, kept on it through
// alignment edits; the 3D view has its own Recording mesh switch. Occlusion is unaffected (the room's occluders stay as they are).
const lidarMesh=new THREE.Group();lidarMesh.name='lidar-mesh-overlay';lidarMesh.visible=false;scene.add(lidarMesh);
const lidarMaterial=new THREE.MeshBasicMaterial({color:0x5fd3ff,wireframe:true,transparent:true,opacity:.7,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
function buildLidarMesh(){lidarMesh.clear();const src=roomParts?.userData.parts?.recording;$('video-lidar-mesh').disabled=!src;$('video-lidar-mesh-label').title=src?'This recording\'s own LiDAR mesh drawn over the video':'This recording has no LiDAR mesh';
  src?.traverse(o=>{if(o.isMesh){const m=new THREE.Mesh(o.geometry,lidarMaterial);m.matrixAutoUpdate=false;m.renderOrder=1;m.userData.source=o;lidarMesh.add(m);}});}
function syncLidarMesh(){lidarMesh.visible=$('video-lidar-mesh').checked&&!$('video-lidar-mesh').disabled;if(!lidarMesh.visible)return;
  for(const m of lidarMesh.children){const o=m.userData.source;o.updateWorldMatrix(true,false);m.matrix.copy(o.matrixWorld);m.matrixWorldNeedsUpdate=true;}}
const twin=createTwin({canvas:$('twin'),scene,camera,anchor:null,getRoom:()=>room,onMove:o=>fromGizmo(o)});
let weatherSurfacePreview=null;
// An entity's box in the scene (a dialogue bubble's speaker, an info answer's thing). layout:<box> (furniture, doors, windows; its model when shown as one)
// or comp:<instance> (a placed object: its bounds, its model unless it is kept as a box).
// Things in the room a bubble held in the view should not cover (src/placement.mjs edgeBubble): objects and furniture, as boxes.
function sceneBoxes(){const out=[];for(const i of components.instances){if(!i.root.visible)continue;const t=entityBox('comp:'+i.spec.id);if(t)out.push({id:'comp:'+i.spec.id,center:t.center,size:t.size,yaw:t.yaw});}
  for(const b of layout?.boxes||[])out.push({id:'layout:'+b.id,center:b.center,size:b.size,yaw:b.yaw||0});return out;}
function entityBox(id){
  if(id.startsWith('layout:')){const b=layout.boxes.find(x=>x.id===id.slice(7));return b&&{center:b.center,size:b.size,yaw:b.yaw||0,model:b.object?.userData.model||null};}
  if(id.startsWith('comp:')){const i=components.get(id.slice(5));if(!i)return null;i.root.updateWorldMatrix(true,true);const box=new THREE.Box3().setFromObject(i.root);if(box.isEmpty())return null;
    const m=components.library.get(i.spec.component);return {center:box.getCenter(new THREE.Vector3()).toArray(),size:box.getSize(new THREE.Vector3()).toArray(),yaw:0,root:i.root,model:m?.kind==='box'?null:i.root};}
  return null;}
// An info answer's target (src/placement.mjs): the thing the user selected when asking (layout:<box>, comp:<object>; an id without a
// prefix is a layout box of an older answer), else the nearest thing carrying the same key; {id, center, size, yaw}. A zone has no box:
// null (its answer is placed as any other).
function infoTarget(r){
  const id=r.info?.box_id&&(r.info.box_id.includes(':')?r.info.box_id:'layout:'+r.info.box_id);if(id?.startsWith('zone:'))return null;
  const box=t=>{const g=entityBox(t);return g&&{id:t,center:g.center,size:g.size,yaw:g.yaw||0};};
  if(id){const t=box(id);if(t)return t;}
  const eye=frameCamera(r.frame).position,cands=infoCarriers().filter(c=>c.key===r.info?.key&&!c.id.startsWith('zone:')).map(c=>box(c.id)).filter(Boolean);
  return cands.length?cands.reduce((x,y)=>eye.distanceTo(new THREE.Vector3(...y.center))<eye.distanceTo(new THREE.Vector3(...x.center))?y:x):null;
}
// An info answer's corners on its box and, once it is fixed in the room, its arrow to the box (src/info-visual.mjs).
const infoVisual=createInfoVisual({scene,onAnimate:()=>update()});
function showInfoVisuals(){
  const answers=!agent||!session?[]:[...agent.widgets.values()].filter(w=>w.visible&&w.userData.response.info?.key&&!w.userData.pose?.unreadable).map(w=>{
    const d=w.userData,box=infoTarget({...d.response,frame:index});if(!box)return null;
    w.updateWorldMatrix(true,true);const q=w.getWorldQuaternion(new THREE.Quaternion());
    // The ink's rectangle (src/agent.mjs canvas.box: pixels of the text canvas), not the padded panel.
    const img=d.text.material.map.image,b=img.box,ink=new THREE.Vector3(((b.x0+b.x1)/2/img.width-.5)*d.width,(.5-(b.y0+b.y1)/2/img.height)*d.height,0);
    return {id:d.response.id,box,color:d.text.material.color,fixed:!d.fixedText&&!!(d.pose.infoSettled||d.pose.kind==='info-float'),locked:!!d.pose.infoSettled,
      panel:{center:d.text.localToWorld(ink),right:new THREE.Vector3(1,0,0).applyQuaternion(q),up:new THREE.Vector3(0,1,0).applyQuaternion(q),width:(b.x1-b.x0)/img.width*d.width,height:(b.y1-b.y0)/img.height*d.height}};}).filter(Boolean);
  showLocks();
  camera.updateMatrixWorld();drawInfoArrows(infoVisual.update(answers,new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld),{colorAt:markColor,frame:index}));
}
// Locked answers (settled in the room: src/placement.mjs infoSettled) get a lock beside their text's top-right corner in the 3D view
// (twin.helper: not drawn in the recorded camera), and their lock goes to the placement log once.
const lockGroup=new THREE.Group();lockGroup.name='answer-locks';twin.helper.add(lockGroup);
const lockMap=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');x.fillStyle='rgba(14,14,14,.85)';x.beginPath();x.arc(32,32,30,0,2*Math.PI);x.fill();
  x.strokeStyle='#7fe0c6';x.fillStyle='#7fe0c6';x.lineWidth=5;x.beginPath();x.arc(32,26,9,Math.PI,0);x.stroke();x.fillRect(19,27,26,19);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;})();
const locks=new Map(),lockLogged=new Set();
function showLocks(){
  const on=new Set();
  for(const w of agent?.widgets.values()||[]){const d=w.userData;if(!w.visible||!d.pose?.infoSettled)continue;const id=d.response.id;on.add(id);
    if(!lockLogged.has(id)){lockLogged.add(id);logPlacement(d.response,d.pose,index,'locked');}
    let s=locks.get(id);if(!s){s=new THREE.Sprite(new THREE.SpriteMaterial({map:lockMap,depthTest:false,transparent:true}));s.renderOrder=31;lockGroup.add(s);locks.set(id,s);}
    w.updateWorldMatrix(true,true);const size=Math.max(.03,d.width*.08);s.scale.set(size,size,1);
    s.position.copy(d.text.localToWorld(new THREE.Vector3(d.width/2+size*.7,d.height/2,0)));}
  for(const [id,s] of locks)if(!on.has(id)){lockGroup.remove(s);s.material.dispose();locks.delete(id);}
}
// Placement log (debug, scripts/agent_store.py log_placement): each new placement of an answer and its lock, with the scenario, the
// recorded camera at that frame, the pose (kind, surface, line length, size, spot score, view metrics), the info shortlist weighed and
// the answer text settings. One page load is one run (logRun).
const logRun=new Date().toISOString();let logLast=new Map();
function logPlacement(r,pose,frame,type='placed'){
  if(r?.question_id==null||!session)return;
  const r3=v=>v&&(Array.isArray(v)?v:v.toArray()).map(x=>+(+x).toFixed(3)),cam=frameCamera(frame),fwd=new THREE.Vector3(0,0,-1).applyQuaternion(cam.quaternion);
  const p={kind:pose.kind,surface:pose.surfaceId??null,layout:pose.layout??null,position:r3(pose.position),width:pose.width&&+pose.width.toFixed(3),
    settled:!!pose.infoSettled,unreadable:!!pose.unreadable,reason:pose.reason??null,spot:pose.infoSpot??null,
    view:pose.viewMetrics&&{inView:pose.viewMetrics.inView,minPx:+(pose.viewMetrics.minPx??0).toFixed(2),visible:pose.viewMetrics.visible??null}};
  const key=JSON.stringify([type,p.kind,p.position,p.width,p.settled]);if(logLast.get(r.id)===key)return;logLast.set(r.id,key);
  const event={type,run:logRun,at:new Date().toISOString(),scenario:sessionURL.pathname,question_id:r.question_id,response_id:r.id,info:r.info??null,
    frame,t:+session.frames[frame].t.toFixed(3),camera:{position:r3(cam.position),forward:r3(fwd)},pose:p,shortlist:pose.infoShortlist??null,
    text:{...textBehavior},view:answerView()};
  fetch(new URL('/api/agent/placement-log',location.href),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:sessionURL.pathname,question_id:r.question_id,event})}).catch(()=>{});
}
// The view answers are sized for (src/text-view.mjs): a reference view ARROW_VIEW px wide with the camera panel's aspect, not the panel's
// own pixels, so an answer covers the same part of the picture in the normal and the full-screen camera view.
function answerView(){const c=$('stage'),w=c.clientWidth||ARROW_VIEW,h=c.clientHeight||ARROW_VIEW*.75;return {width:ARROW_VIEW,height:ARROW_VIEW*h/w};}
// Info answers' arrows: the library's Text Arrow (src/spatial-ui/cues.mjs textArrow), drawn when the answer's MOD declares it
// (`textArrow when text.apart`, modos/ui-rules.mjs; answers without a declaration keep one). Each frame the text's ink rectangle and the
// box's face are projected; src/info-visual.mjs arrowBetween lays the arrow out on the line from the text's centre to the face's centre
// (text.apart: they do not overlap and there is room); its ends go back into the room, on the text's plane and on the face's plane.
// Not drawn if any part would leave the view.
const ARROW_VIEW=686;
const textArrowScene=new THREE.Scene();let textArrows=[];
function drawInfoArrows(arrows){
  for(const p of textArrows){textArrowScene.remove(p.group);p.group.traverse(o=>{o.geometry?.dispose();o.material?.dispose?.();});}textArrows=[];
  const c=$('stage'),W=c.offsetWidth,H=c.offsetHeight,w=ARROW_VIEW,h=ARROW_VIEW*H/Math.max(1,W);
  const toRef=p=>{const q=p.clone().project(camera);return q.z>1||q.z<-1?null:new THREE.Vector2((q.x+1)/2*w,(1-q.y)/2*h);};
  const inView=v=>v.x>=2&&v.y>=2&&v.x<=w-2&&v.y<=h-2;
  const back=(v,corners)=>{const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(v.x/w*2-1,1-v.y/h*2),camera);
    return ray.ray.intersectPlane(new THREE.Plane().setFromCoplanarPoints(corners[0],corners[1],corners[2]),new THREE.Vector3());};
  for(const a of arrows){
    const text=a.text.map(toRef),box=a.box.map(toRef);if(text.some(v=>!v)||box.some(v=>!v))continue;
    const aim=toRef(a.aim),r=aim&&arrowBetween(text,box,{aim});
    const ui=agent?.widgets.get(a.id)?.userData.response?.text_ui;
    if(ui&&!partsToDraw(ui,{'text.apart':!!r}).includes('textArrow'))continue;
    if(!r||![r.start,r.end,...r.barbs].every(inView))continue;
    const start=back(r.start,a.text),end=back(r.end,a.box);if(!start||!end)continue;
    const part=cues.textArrow(start,end,{opacity:a.opacity});textArrowScene.add(part.group);textArrows.push(part);
  }
}
function renderTextArrows(renderer){if(!textArrows.length)return;for(const p of textArrows)p.update(performance.now(),camera);
  const auto=renderer.autoClear;renderer.autoClear=false;try{renderer.clearDepth();renderer.render(textArrowScene,camera);}finally{renderer.autoClear=auto;}}
// Colours for marks over some world points, against what the recorded camera shows there (the frame's image inside the points' screen
// rectangle, a little larger; src/legibility.mjs): an info answer's corners like answer text ({color}); its arrow a vivid accent and a
// border to put under it ({color, halo}). null until the frame is loaded.
function markColor(points,kind='corners'){
  const img=textures.get(index)?.image;if(!img?.width||!points?.length)return null;
  camera.updateMatrixWorld();const ndc=points.map(p=>p.clone().project(camera)).filter(p=>p.z>-1&&p.z<1);if(!ndc.length)return null;
  const W=img.width,H=img.height,xs=ndc.map(p=>(p.x+1)/2*W),ys=ndc.map(p=>(1-p.y)/2*H),pad=.02*W;
  const x0=Math.max(0,Math.min(...xs)-pad),x1=Math.min(W,Math.max(...xs)+pad),y0=Math.max(0,Math.min(...ys)-pad),y1=Math.min(H,Math.max(...ys)+pad);
  if(x1-x0<2||y1-y0<2)return null;
  const w=24,h=Math.max(4,Math.min(24,Math.round(24*(y1-y0)/(x1-x0)))),c=new OffscreenCanvas(w,h).getContext('2d',{willReadFrequently:true});
  c.drawImage(img,x0,y0,x1-x0,y1-y0,0,0,w,h);
  const px=c.getImageData(0,0,w,h).data;
  if(kind==='arrow'){const a=accentStyle(px,w,h);return {color:new THREE.Color().setRGB(...a.color),halo:new THREE.Color().setRGB(...a.halo)};}
  return {color:new THREE.Color().setRGB(...pickStyle(px,w,h,0).text)};
}
const highlightScene=createCueHost({getRooms:()=>layoutRooms,getLayout:()=>layoutSem}),devicePanel=createDeviceCues();devicePanel.attach($('stage'),()=>camera,()=>update());
// A photo of a thing (Delegate's Photo Capture): the recorded camera frame cropped to the thing's box as seen from `cam`, a little larger.
function snapshot(box,cam=camera){
  const img=textures.get(index)?.image;if(!img?.width)return null;
  const c=new THREE.Vector3(...box.center),h=box.size.map(v=>v/2*1.15),pts=[];
  for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1])pts.push(new THREE.Vector3(c.x+sx*h[0],c.y+sy*h[1],c.z+sz*h[2]).project(cam));
  const W=img.width,H=img.height,xs=pts.map(p=>(p.x+1)/2*W),ys=pts.map(p=>(1-p.y)/2*H);
  const x0=Math.max(0,Math.min(...xs)),x1=Math.min(W,Math.max(...xs)),y0=Math.max(0,Math.min(...ys)),y1=Math.min(H,Math.max(...ys));if(x1-x0<8||y1-y0<8)return null;
  const w=Math.min(640,Math.round(x1-x0)),out=document.createElement('canvas');out.width=w;out.height=Math.round(w*(y1-y0)/(x1-x0));
  out.getContext('2d').drawImage(img,x0,y0,x1-x0,y1-y0,0,0,out.width,out.height);return out;
}
const actionCard=createActionCues({getSnapshot:snapshot});actionCard.attach($('stage'),()=>camera,()=>update());
window.modosUI={actionCard,devicePanel};
// Spatial UI cue previews (src/spatial-ui/cues.mjs) for the cue gallery: window.modosCues.show(name, target id, options) puts one cue on a
// thing ('layout:<box>') or a room ('zone:<room>') of this scene, seen from the current camera.
const cueScene=new THREE.Scene();cueScene.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));{const l=new THREE.DirectionalLight(0xffffff,1.6);l.position.set(.4,1,1.2);cueScene.add(l);}
let cueParts=[];
window.modosCues={
  show(name,target,options={},extra=null){
    for(const p of cueParts)cueScene.remove(p.group);cueParts=[];if(!name)return update();
    const box=id=>{const b=layout.boxes.find(x=>'layout:'+x.id===id);return b&&{center:b.center,size:b.size,yaw:b.yaw||0};};
    const room=id=>{const r=layoutRooms.find(x=>'zone:'+x.id===id);if(!r)return null;const poly=r.polygon?.[0];const ring=Array.isArray(poly?.[0]?.[0])?poly[0]:poly;return {ring,floorY:r.floorY??0};};
    const eye=camera.position.clone(),t=target?.startsWith('zone:')?room(target):box(target);
    const make={breathingBox:()=>cues.breathingBox(t),footprintRing:()=>cues.footprintRing(t),beacon:()=>cues.beacon(t),cornerBrackets:()=>cues.cornerBrackets(t),
      floorArea:()=>cues.floorArea(t),doorwayGlow:()=>cues.doorwayGlow(t,options.name||'Kitchen',eye),arrowAhead:()=>cues.arrowAhead(t,camera),
      textArrow:()=>{const c=new THREE.Vector3(...t.center),toEye=eye.clone().sub(c).setY(0).normalize(),side=new THREE.Vector3(toEye.z,0,-toEye.x),half=Math.max(t.size[0],t.size[2])/2;return cues.textArrow(c.clone().addScaledVector(side,-(half+.3)).add(new THREE.Vector3(0,.05,0)),c.clone().addScaledVector(side,-(half+.03)));},floorPath:()=>{const r=layoutSem&&createRouter(layoutSem.rooms||[],layoutSem.openings||[],layoutSem.walls||[]).route([eye.x,eye.z],[t.center[0],t.center[2]]);return cues.floorPath(r?along(r,{spacing:.45,skip:.6,max:14}):[]);},haloDial:()=>cues.haloDial(t,eye,options),edgeBar:()=>cues.edgeBar(t,eye,options),
      powerPuck:()=>cues.powerPuck(t,eye,options),iconButton:()=>cues.iconButton(t,eye,options),datePicker:()=>cues.datePicker(t,eye,options),playback:()=>cues.playback(t,eye,options),edgeTabs:()=>cues.edgeTabs(t,eye,options),progressRail:()=>cues.progressRail(t,eye,options),
      cardStack:()=>cues.cardStack(t,eye,options),pinnedTags:()=>cues.pinnedTags(t,eye,options),statusPulse:()=>cues.statusPulse(t,options),tetherSend:()=>cues.tetherSend(t,eye,options)}[name];
    if(!t||!make)throw Error(`No ${t?'cue':'target'} ${t?name:target}.`);
    // controls and labels on a thing read at the same size whatever its distance (the same rule as the spatial panels)
    const dist=t.center?eye.distanceTo(new THREE.Vector3(...t.center)):1,k=Math.min(2.4,Math.max(1,dist/1.1));cues.setScale(k);
    const part=make();if(['haloDial','powerPuck','iconButton','datePicker','playback','edgeTabs','progressRail','cardStack','statusPulse'].includes(name))part.group.scale.setScalar(k);cues.setScale(1);
    cueParts=[part,...(extra?[cues.breathingBox(box(extra))]:[])];for(const p of cueParts)cueScene.add(p.group);update();
  },
};
function renderCues(renderer){if(!cueParts.length)return;const now=performance.now();for(const p of cueParts)p.update(now,camera);
  const auto=renderer.autoClear;renderer.autoClear=false;try{renderer.clearDepth();renderer.render(cueScene,camera);}finally{renderer.autoClear=auto;}requestAnimationFrame(update);}   // demos/record.mjs presses an action card's Send through this
const dioramaScene=createDiorama({loader,lighting:{environment:scene.environment,lights:scene.children.filter(o=>o.isLight).map(l=>l.clone())}});
const handPerception=createHandPerception();
const handCompositor=createHandCompositor();
let playbackGeneration=0;const preparingFrames=new Map();
let currentHandData=null; // Keep the displayed frame pinned even if another consumer fills the shared cache.
const handKey=i=>`${sessionURL.href}#${i}`;
const recordingHands=createRecordingHandCache({session:sessionURL.href,onChange:()=>showHandCache()});
let preparingHands=false,cancelHandPreparation=false;
function showHandCache(){
 const s=recordingHands.status;
 $('hand-cache-status').textContent=s.error?`Offline cache: ${s.error}`:`Offline hands · ${s.cached}/${s.total} frames · ${s.empty} without hands${s.total&&s.cached===s.total?' · Ready':''}`;
}
$('prepare-hands').onclick=async()=>{
 if(preparingHands){cancelHandPreparation=true;return;}
 preparingHands=true;cancelHandPreparation=false;pause();$('prepare-hands').textContent='Stop';
 try{
  await recordingHands.ready;if(recordingHands.status.error)throw Error(recordingHands.status.error);
  for(let i=0;i<session.frames.length&&!cancelHandPreparation;i++){
   if(recordingHands.has(i))continue;
   while(playing&&!cancelHandPreparation)await new Promise(r=>setTimeout(r,150));
   if(cancelHandPreparation)break;
   const result=await handJobs.request(i);
   if(!result){i--;continue;}
   if(result.status!=='ready')throw Error(result.error||'Hand detection failed');
   if(recordingHands.status.error)throw Error(recordingHands.status.error);
   await new Promise(r=>setTimeout(r,0));
  }
 }catch(e){$('hand-cache-status').textContent=`Offline cache: ${e.message}`;}
 finally{preparingHands=false;$('prepare-hands').textContent='Prepare';}
};
async function perceiveHands(i){
 const cached=await recordingHands.read(i,handKey(i));if(cached)return cached;
 const result=await handPerception.request(handKey(i),(await texture(i)).image);
 await recordingHands.write(i,result);return result;
}
const handJobs=createLatestFrameJob(perceiveHands,(i,result)=>{
 if(i===index){currentHandData=result;update();}
});
function showHandStatus(){
 const result=currentHandData;$('hand-status').title=result?.error||'';
 $('hand-status').textContent=result?.status==='ready'?`Hands protected · ${result.landmarks.length} detected`:result?.status==='error'?'Hand protection unavailable · spatial effects hidden':'Hands · processing frame…';
}
const spatialHands=()=>locateHands({perception:currentHandData,depth:depths.get(index)?.image,camera,intrinsics:session.intrinsics});
// What is adjusted outside MODs (src/ui-settings.mjs): the UI library's text and cue parameters, and the replay. A MOD's own choices
// (when its highlight goes, whether its sky is locked, how long its text stays) are its settings, carried by each part (modSetting).
const uiSettings=loadUiSettings(),forResponse=r=>answerSettings(uiSettings,r);
const currentAnswers=()=>agent?[...agent.widgets.values()].filter(w=>w.visible).map(w=>w.userData.response):[];
const weatherScene=createWeatherScene({scene,getStability:()=>0,   // the sky is Weather's own effect: its MOD's lock setting decides, not the library
  getLock:()=>modSetting(weatherResponse(currentAnswers()),'weather','lock')==='lock',getCamera:()=>camera,getRoom:()=>roomParts?.userData.parts.space||room,getOccluders:()=>[roomParts?.userData.parts.space,roomParts?.userData.parts.recording].filter(Boolean),getDepthOccluder:c=>c===camera&&depths.has(index)?depthOccluder:null,getObjects:()=>components.instances.filter(i=>i.root.visible).map(i=>i.root),onAnimate:()=>update(),
  onLabel:info=>{const el=$('weather-status');el.hidden=!info;if(info){const e=info.entry,label=`${e.label} · ${e.summary} · ${e.temp_c} °C${info.total>1?` · ${info.index}/${info.total}`:''}${info.target?'':' · Look at a layout surface'}`;if(el.textContent!==label)el.textContent=label;}}});
settingsControls({root:$('text-placement'),group:'text',settings:uiSettings,before:$('text-placement').querySelector('.placement-stability'),onChange:()=>{agent?.refreshSettings();update();}});
settingsControls({root:$('replay-settings'),group:'replay',settings:uiSettings});
weatherScene.setEnabled(true);
twin.setOverlay(weatherScene);twin.setPresentation({get group(){return agent?.group;},get controls(){return weatherSurfacePreview?.mesh;},render:(r,c)=>{agent?.renderAfter(r,c,weatherSurfacePreview?.mesh,index,false);}});
/** A gizmo moved, turned or scaled the selected component: its spec follows (scale stays one number while uniform; a box's stays its size). */
function fromGizmo(o){if(fine&&o===fine.object){fineMoved(o);return;}if(layout.selected&&o===layout.selected.object){layout.fromGizmo();return;}const r=v=>+v.toFixed(4),d=v=>+THREE.MathUtils.radToDeg(v).toFixed(2),sc=o.scale.toArray().map(r);
  setSelected({position:o.position.toArray().map(r),rotation:[d(o.rotation.x),d(o.rotation.y),d(o.rotation.z)],scale:!Array.isArray(components.get(selected)?.spec.scale)&&Math.abs(sc[0]-sc[1])<1e-4&&Math.abs(sc[1]-sc[2])<1e-4?sc[0]:sc},{history:false});}
// The saved state (Save / Load, ?placement=): the components and the compositing switches. Version 1 (one object) still loads.
function placement(){return {version:2,components:components.specs(),selected,room:roomName,roomData,occlude:$('occlude').checked,depthOcclude:$('depth-occlude').checked,shadows:$('shadows').checked,roomWireframe:$('room-wireframe').checked,videoTwins:$('video-twins').checked};}
/** A transform for the selected component: {position, scale, yaw, visible} (the version-1 placement fields). */
function applyPlacement(p){if(!Array.isArray(p.position)||p.position.length!==3||![...p.position,p.scale,p.yaw].every(Number.isFinite)||p.scale<=0)throw Error('Invalid placement');setSelected({position:p.position,scale:p.scale,yaw:p.yaw,visible:p.visible!==false});}
let paintRequest=0,lastTwinPaint=0;
function update(){if(!paintRequest)paintRequest=requestAnimationFrame(()=>{paintRequest=0;paint();});}
function paint(){
  syncLidarMesh();components.update({t:session?session.frames[index].t:0,frame:index});syncGizmo();twin.helper.visible=false;
  const map=$('depth-occlude').checked?depths.get(index):null;depthOccluder.visible=!!map;
  const weatherDepth=depths.get(index)||null;
  if(map||weatherDepth){depthOccluder.material.uniforms.depthMap.value=map||weatherDepth;const e=camera.projectionMatrix.elements;depthOccluder.material.uniforms.proj.value.set(e[10],e[14]);}
  agent?.update(session?session.frames[index].t:0);if(session)agent?.adapt(index);
  showInfoVisuals();
  const responses=agent?[...agent.widgets.values()].filter(w=>w.visible):[];
  $('response-readability').hidden=!responses.some(w=>w.userData.placementHidden||w.userData.pose?.unreadable);
  const currentResponses=responses.map(w=>w.userData.response);
  const latestQuestion=currentResponses.at(-1)?.question_id;
  const found=currentResponses.find(r=>r.question_id===latestQuestion&&r.findmy);
  // A zone's animation (LabInfo's diorama): placed from where its question was asked, then played in a loop.
  const animAnswer=currentResponses.find(r=>r.question_id===latestQuestion&&r.animation),animQuestion=animAnswer&&agent?.questions.find(q=>q.id===animAnswer.question_id);
  let tables=[];try{tables=layout.boxes.filter(b=>/table|desk/.test(b.category||'')&&b.center&&b.size);}catch{}
  dioramaScene.setResponse(animAnswer||null,animQuestion?frameCamera(animQuestion.frame):camera,tables).then(()=>{if(dioramaScene.active)requestAnimationFrame(update);}).catch(fail);
  if(dioramaScene.active)requestAnimationFrame(update);
  // ModOS parts that point at things of the twin: a highlight (ObjectStatus, Wayfinding, IoTControl) and a device's controls (IoTControl).
  // FindMy's found container (unless a hand reached it) and the other MODs' highlights: one spatial Highlight renderer.
  highlightScene.setResponse(currentResponses.find(r=>r.question_id===latestQuestion&&r.highlight)||found);if(highlightScene.active)requestAnimationFrame(update);
  const ctlAnswer=currentResponses.find(r=>r.question_id===latestQuestion&&r.control),ctlQuestion=ctlAnswer&&agent?.questions.find(q=>q.id===ctlAnswer.question_id);
  const actAnswer=currentResponses.find(r=>r.question_id===latestQuestion&&r.action),actQuestion=actAnswer&&agent?.questions.find(q=>q.id===actAnswer.question_id);
  actionCard.setResponse(actAnswer||null,actQuestion?frameCamera(actQuestion.frame):camera,here[0]);
  devicePanel.setResponse(ctlAnswer||null,ctlQuestion?frameCamera(ctlQuestion.frame):camera,here[0]);if(devicePanel.active)requestAnimationFrame(update);   // live: a task's progress
  const latest=weatherResponse(currentResponses);
  weatherScene.setResponse(latest?.weather?latest:null);weatherScene.refresh();
  agent?.orient(camera);
  const weatherWidget=latest?.weather?agent?.widgets.get(latest.id):null;
  weatherSurfacePreview?.update(weatherWidget?.userData.text?weatherWidget:null,camera);
  // Hide only during the recorded-camera render, including its shadow pass.
  const hidden=components.instances.filter(i=>i.root.visible&&!visibleInVideo(i)).map(i=>i.root);
  for(const r of hidden)r.visible=false;
  try{renderer.shadowMap.enabled=$('shadows').checked;if(renderer.shadowMap.enabled)aimShadow();catchers.visible=$('shadows').checked&&components.instances.some(i=>i.root.visible);ground.visible=!components.instances.some(i=>i.root.visible&&i.spec.mount==='wall');
    const weatherVisible=weatherScene.group.visible,controls=weatherSurfacePreview?.mesh,controlVisible=controls?.visible;
    if(agent)agent.group.visible=false;if(controls)controls.visible=false;weatherScene.group.visible=false;
    renderer.render(scene,camera);weatherScene.group.visible=weatherVisible;weatherScene.render(renderer,camera);
    if(controls)controls.visible=controlVisible;
    dioramaScene.render(renderer,camera);highlightScene.render(renderer,camera);devicePanel.render(renderer,camera);actionCard.render(renderer,camera);renderCues(renderer);renderTextArrows(renderer);
    handCompositor.render(renderer,scene.background,currentHandData);
    // Response text/controls intentionally draw over hands; effects remain protected.
    agent?.renderAfter(renderer,camera,controls,index,true);
    agent?.renderHud(renderer);showHandStatus();showTrace();showSelection();
  }finally{for(const r of hidden)r.visible=true;depthOccluder.visible=false;catchers.visible=false;}
  const now=performance.now();if(!playing||now-lastTwinPaint>=1000/15){lastTwinPaint=now;twin.render();}
}
// User selection of a thing carrying info (src/user-selection.mjs) at the shown frame, from the fovea zone (the view's centre), a pointing
// finger and a touching hand; sent with each question. The fovea zone is drawn over the recorded camera (Video options: Fovea zone, on by
// default). How the agent uses it (Agent panel, Info selection): Jev judgement or the score alone. Both remembered in this browser.
const pref=(k,fallback)=>{try{return localStorage.getItem('spatial-take:'+k)??fallback;}catch{return fallback;}},keep=(k,v)=>{try{localStorage.setItem('spatial-take:'+k,v);}catch{}};
let selectionMode=pref('selection-mode','jev')==='score'?'score':'jev',lastSelection='',lastMarks='';
$('show-selection').checked=pref('show-selection','on')!=='off';$('show-selection').onchange=()=>{keep('show-selection',$('show-selection').checked?'on':'off');selectionMarks.setEnabled($('show-selection').checked);twin.render();};
$('fovea-zone').checked=pref('fovea-zone','on')!=='off';$('fovea-zone').onchange=()=>{keep('fovea-zone',$('fovea-zone').checked?'on':'off');update();};
for(const b of document.querySelectorAll('[data-selection]')){b.setAttribute('aria-pressed',b.dataset.selection===selectionMode);
  b.onclick=()=>{selectionMode=b.dataset.selection;keep('selection-mode',selectionMode);for(const x of document.querySelectorAll('[data-selection]'))x.setAttribute('aria-pressed',x===b);};}
function computeSelection(){
  if(!session||!layoutLoaded)return null;const carriers=infoCarriers();if(!carriers.length)return null;
  camera.updateMatrixWorld();const inv=camera.matrixWorld.clone().invert(),dm=depths.get(index)?.image,v=new THREE.Vector3();
  // In the view and not behind something this frame's depth saw more than 25 cm nearer.
  const visible=p=>{v.copy(p).applyMatrix4(inv);const d=-v.z;if(d<=.05)return false;v.applyMatrix4(camera.projectionMatrix);if(Math.abs(v.x)>1||Math.abs(v.y)>1)return false;
    if(dm?.data){const x=Math.min(dm.width-1,Math.floor((v.x+1)/2*dm.width)),y=Math.min(dm.height-1,Math.floor((1-v.y)/2*dm.height)),z=dm.data[y*dm.width+x];if(z>.05&&z<d-.25)return false;}
    return true;};
  // Things with boxes (furniture, doors and windows, persistent objects) by gaze, pointing and touch.
  const targets=carriers.filter(c=>!c.id.startsWith('zone:')).map(c=>{const g=entityBox(c.id);return g&&{id:c.id,key:c.key,center:g.center,size:g.size,yaw:g.yaw||0};}).filter(Boolean);
  const eye=new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const result=selectInfoBox({view:{position:eye.toArray(),forward:new THREE.Vector3(0,0,-1).transformDirection(camera.matrixWorld).toArray()},
    boxes:targets,hands:spatialHands(),visible,keyOf:t=>t.key,
    // Pointing is judged in the image: MediaPipe's 2D joints against the boxes projected with the recorded camera (same image size).
    image:currentHandData?.landmarks?.length?{landmarks:currentHandData.landmarks,mask:currentHandData,width:session.intrinsics.width,height:session.intrinsics.height,
      project:p=>{const q=p.clone().project(camera);return q.z>1||q.z<-1?null:new THREE.Vector2((q.x+1)/2*session.intrinsics.width,(1-q.y)/2*session.intrinsics.height);}}:null});
  // A zone carrying info that the user stands in: a weak candidate when nothing else is selected (Jev judges it, scripts/info_context.py).
  const zone=layoutRooms.find(r=>r.info&&r.id===labelRoom(layoutRooms,eye));
  if(zone&&!result.selected)result.selected={box_id:'zone:'+zone.id,key:zone.info,score:ZONE_SELECTION,cues:{gaze:0,point:0,touch:0,zone:1}};
  result.targets=targets;return result;
}
const ZONE_SELECTION=.4;
function showSelection(){
  const result=computeSelection(),sel=result?.selected,svg=$('fovea'),c=$('stage'),on=$('fovea-zone').checked&&!!session;
  // What is selected is marked in the 3D view; the recorded camera only shows the fovea zone changing colour.
  const marks=JSON.stringify(result?.scores?.map(x=>[x.box_id,x.score])||[]);if(marks!==lastMarks){lastMarks=marks;selectionMarks.set(result,result?.targets||[]);twin.render();}
  const more=result?.selectedAll?.length>1?` · ${result.selectedAll.length} selected`:'';
  const text=!result?'Nothing in this scene carries info.':sel?`Selected · ${sel.key} (${sel.score.toFixed(2)}: gaze ${sel.cues.gaze.toFixed(2)}, point ${sel.cues.point.toFixed(2)}, touch ${sel.cues.touch.toFixed(2)})${more}`:
    result.candidates[0]?`None selected · nearest ${result.candidates[0].key} ${result.candidates[0].score.toFixed(2)}`:'None selected';
  if(text!==lastSelection){lastSelection=text;$('selection-status').textContent=text;}
  svg.toggleAttribute('hidden',!on);if(!on)return;   // an <svg> has no hidden property
  const w=c.offsetWidth,h=c.offsetHeight,f=camera.projectionMatrix.elements[5]*h/2,r=a=>f*Math.tan(THREE.MathUtils.degToRad(a));
  Object.assign(svg.style,{left:c.offsetLeft+'px',top:c.offsetTop+'px',width:w+'px',height:h+'px'});svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  // The ring the selection falls in lights: the inner circle when the box is inside it, only the outer one when it is in the ring.
  svg.classList.toggle('inner-on',!!sel&&sel.cues.gaze>=1);svg.classList.toggle('outer-on',!!sel&&sel.cues.gaze>0&&sel.cues.gaze<1);
  for(const [cls,a] of [['inner',FOVEA.inner],['outer',FOVEA.outer]]){const e=svg.querySelector('.'+cls);e.setAttribute('cx',w/2);e.setAttribute('cy',h/2);e.setAttribute('r',r(a));}
}
// Persistent objects and Obj library objects can each be left out of the recorded camera and of the 3D view (remembered in this browser).
const SHOW={video:{persistent:'video-twins',opportunistic:'video-objects'},twin:{persistent:'twin-persistent',opportunistic:'twin-objects'}};
const shownIn=view=>inst=>{const id=SHOW[view][components.categoryOf(inst.spec)];return (!id||$(id).checked)&&!outlineHidden.has(inst.spec.id);};
const visibleInVideo=shownIn('video'),visibleInTwin=shownIn('twin');
twin.setHidden(()=>[...components.instances.filter(i=>!visibleInTwin(i)).map(i=>i.root),lidarMesh]);
for(const id of Object.values(SHOW).flatMap(Object.values)){try{$(id).checked=localStorage.getItem('spatial-take:'+id)!=='false';}catch{}
  $(id).onchange=()=>{try{localStorage.setItem('spatial-take:'+id,$(id).checked);}catch{}update();twin.render();};}
function texture(i){
 if(textures.has(i))return Promise.resolve(textures.get(i));
 if(!textureLoads.has(i))textureLoads.set(i,loadTexture(i).finally(()=>textureLoads.delete(i)));
 return textureLoads.get(i);
}
async function loadTexture(i){if(textures.has(i))return textures.get(i);const tx=await new THREE.TextureLoader().loadAsync(new URL(session.frames[i].image,sessionURL).href);tx.colorSpace=THREE.SRGBColorSpace;textures.set(i,tx);while(textures.size>8){const key=textures.keys().next().value;if(key===i)break;textures.get(key).dispose();textures.delete(key);}return tx;}
// PNG stores uint16 millimeters as R (high byte), G (low byte); 0 = no measurement.
function depthMap(i){
 if(depths.has(i))return Promise.resolve(depths.get(i));
 if(!depthLoads.has(i))depthLoads.set(i,loadDepth(i).finally(()=>depthLoads.delete(i)));
 return depthLoads.get(i);
}
async function decodeDepth(i){const blob=await(await fetch(new URL(session.frames[i].depth,sessionURL))).blob();const bmp=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});const {width:w,height:h}=bmp;const ctx=new OffscreenCanvas(w,h).getContext('2d',{willReadFrequently:true});ctx.drawImage(bmp,0,0);bmp.close();const px=ctx.getImageData(0,0,w,h).data,m=new Float32Array(w*h);for(let k=0;k<w*h;k++)m[k]=(px[4*k]*256+px[4*k+1])/1000;return {data:m,width:w,height:h};}
async function loadDepth(i){if(depths.has(i))return depths.get(i);const {data:m,width:w,height:h}=await decodeDepth(i);const tx=new THREE.DataTexture(m,w,h,THREE.RedFormat,THREE.FloatType);tx.needsUpdate=true;depths.set(i,tx);while(depths.size>8){const key=depths.keys().next().value;if(key===i)break;depths.get(key).dispose();depths.delete(key);}return tx;}
// Agent text surfaces (src/layout-surfaces.mjs): the layout's faces, each moved to where this recording's LiDAR depth shows it.
let textTargets=[],surfaceOffsets=null,textSurfaces=[],calibrationRun=0,calibrationTimer=null;
function setTextLayout(sem){textTargets=buildTextTargets(sem);textSurfaces=applyOffsets(textTargets,surfaceOffsets);resetRelations();clearTimeout(calibrationTimer);calibrationTimer=setTimeout(calibrateSurfaces,300);}
async function calibrateSurfaces(){
  const run=++calibrationRun,frames=session?.frames.map((f,i)=>f.depth?i:-1).filter(i=>i>=0)||[];if(!frames.length||!toSpace||!textTargets.length)return;
  try{const offsets=await calibrate(textTargets,{frames,readDepth:i=>decodeDepth(i).catch(()=>null),camera:frameCamera,intrinsics:session.intrinsics});
    if(run!==calibrationRun)return;surfaceOffsets=offsets;textSurfaces=applyOffsets(textTargets,offsets);resetRelations();}catch(e){console.warn('surface calibration',e);}}
// How the person stands to the room (src/spatial-relations.mjs), tracked over the frames as they are shown (with hysteresis): it names
// the surface an answer is placed on (src/placement.mjs).
const relationTracker=createRelationTracker(),relationByFrame=new Map();
// The text surfaces changed (depth correction finished, layout saved): relations and every answer's placement are worked out again.
function resetRelations(){relationTracker.reset();relationByFrame.clear();agent?.relayout();}
// Metres along a world direction from frame i's camera to what its LiDAR depth saw (only when that depth is loaded already).
function depthAlong(i,cam){const tx=depths.get(i);if(!tx)return null;const {data,width:w,height:h}=tx.image,fwd=cam.getWorldDirection(new THREE.Vector3());
  return dir=>{const p=cam.position.clone().add(dir).project(cam);if(Math.abs(p.x)>1||Math.abs(p.y)>1)return null;
    const d=data[Math.min(h-1,Math.floor((1-p.y)/2*h))*w+Math.min(w-1,Math.floor((p.x+1)/2*w))];const c=dir.dot(fwd);return d>0&&c>.05?d/c:null;};}
function trackRelation(i){if(!textSurfaces.length)return null;const cam=frameCamera(i);cam.updateMatrixWorld(true);
  const r=relationTracker.update(session.frames[i].t,viewOf(cam),textSurfaces,{depth:depthAlong(i,cam)});relationByFrame.set(i,r);return r;}
// A frame not played yet (an answer replayed from a saved conversation, a seek): a fresh tracker over the 2 s before it, so the relation
// has the same hysteresis as during playback.
function relationAt(i){if(relationByFrame.has(i))return relationByFrame.get(i);if(!textSurfaces.length)return null;
  const t=session.frames[i].t,tracker=createRelationTracker();let start=i,r=null;while(start>0&&session.frames[start-1].t>=t-2)start--;
  for(let j=start;j<=i;j++){const cam=frameCamera(j);cam.updateMatrixWorld(true);r=tracker.update(session.frames[j].t,viewOf(cam),textSurfaces,{depth:depthAlong(j,cam)});}
  // Kept only once this frame's depth is in (judged without it, the relation may differ: e.g. none, then the desk top).
  if(depths.has(i))relationByFrame.set(i,r);return r;}
async function setFrame(i,{realtime=false,preparedHands=null,generation=null}={}){
 if(realtime){
  if(i===index||preparingFrames.has(i))return;
  const epoch=playbackGeneration;
  // Present RGB + mask atomically. While the worker prepares the next frame,
  // keep animating effects over the last complete frame, never uncovered new RGB.
  const cached=handPerception.get(handKey(i));
  const job=(cached&&cached.status!=='processing'?Promise.resolve(cached):handJobs.request(i))
   .then(result=>{
    if(result&&playing&&epoch===playbackGeneration&&i>index)return setFrame(i,{preparedHands:result,generation:epoch});
   }).catch(fail).finally(()=>{if(preparingFrames.get(i)===job)preparingFrames.delete(i);});
  preparingFrames.set(i,job);
  for(let j=i;j<=Math.min(i+2,session.frames.length-1);j++)void texture(j).catch(()=>{});
  for(let j=i;j<=Math.min(i+2,session.frames.length-1);j++)if(recordingHands.has(j))void recordingHands.read(j,handKey(j));
  return;
 }
 if(generation!=null&&generation!==playbackGeneration)return;
 if(!preparedHands)playbackGeneration++;
 const epoch=playbackGeneration,ticket=++requested;
 const needDepth=session.frames[i].depth;   // the sky and occlusion read the recorded depth
 const [tx,,hands]=await Promise.all([texture(i),needDepth?depthMap(i):null,preparedHands||handJobs.request(i)]);
 if(ticket!==requested||epoch!==playbackGeneration||!hands)return;
 index=i;currentHandData=hands;
 scene.background=tx;setPose(camera,session.frames[i],session.intrinsics);trackRelation(i);agent?.update(session.frames[i].t);
 await agent?.adapt(i);
 if(ticket!==requested||epoch!==playbackGeneration)return;
 agent?.report(userState());$('timeline').value=session.frames[i].t;$('timeline').style.setProperty('--p',`${session.frames[i].t/(session.frames.at(-1).t||1)*100}%`);$('time').textContent=session.frames[i].t.toFixed(2)+' s';
 if($('debug-lidar').checked)showLidar().catch(fail);update();
}
const qualityFrames=new Map();
async function placementQuality(i){
 if(!qualityFrames.has(i)){
  const job=Promise.all([texture(i),session.frames[i].depth?depthMap(i):null]).then(([tx,dm])=>{
   const canvas=new OffscreenCanvas(384,Math.max(1,Math.round(384*tx.image.height/tx.image.width))),ctx=canvas.getContext('2d',{willReadFrequently:true});
   ctx.drawImage(tx.image,0,0,canvas.width,canvas.height);const image=ctx.getImageData(0,0,canvas.width,canvas.height),cam=frameCamera(i);
   return (pose,aspect)=>surfaceQuality(pose,aspect,cam,image,dm?.image);
  });qualityFrames.set(i,job);while(qualityFrames.size>3)qualityFrames.delete(qualityFrames.keys().next().value);
 }
 return qualityFrames.get(i);
}
async function at(t,options){return setFrame(frameAt(session.frames,t),options);}
const PLAY='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',PAUSE='<svg viewBox="0 0 24 24"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
function playIcon(on){$('play').innerHTML=on?PAUSE:PLAY;$('play').setAttribute('aria-label',on?'Pause':'Play');}
// Playback. When it reaches a question's frame the video holds (speed 0) for the agent's real time: thinking, the answer after the
// measured latency, READ_S seconds of reading; then it moves on. Asking holds the same way, live.
// h measures agent time; replay's typingDuration elapses before h reaches zero.
// `held` = questions already held during this playback.
// ?agentSpeed=0.4: a replay shows the agent's work in slow motion (demo recordings); the video, the answer's parts and the pipeline
// view stay in step.
const AGENT_SPEED=Math.min(1,Math.max(.05,Number(params.get('agentSpeed'))||1));
const SPEEDS=[1,.5,.25];let speed=1,playT=0,lastNow=0,hold=null,held=new Set(),replayFrom=null;
function pause(){playing=false;playbackGeneration++;preparingFrames.clear();endHold();playIcon(false);showSpeed();}
$('play').onclick=async()=>{if(playing){pause();return;}playing=true;playT=Number($('timeline').value);if(playT>=session.frames.at(-1).t){playT=0;try{await at(0);}catch(e){pause();fail(e);return;}if(!playing)return;}
  // Questions at or before the start are not held again, except the one a replay starts from.
  // (The slider rounds to 1 ms, so a replay starts exactly at its question's time.)
  const from=replayFrom&&agent?.questions.find(q=>q.id===replayFrom);if(from)playT=from.t;
  held=new Set((agent?.questions||[]).filter(q=>q.t<=playT+.002&&q.id!==replayFrom).map(q=>q.id));replayFrom=null;
  lastNow=performance.now();playIcon(true);tick();};
function showSpeed(){$('speed').textContent=formatSpeed(hold?0:speed);$('speed').classList.toggle('slowed',!!hold);}
$('speed').onclick=()=>{speed=SPEEDS[(SPEEDS.indexOf(speed)+1)%SPEEDS.length];showSpeed();};
function startHold(q,{resume=true,live=false}={}){
  playbackGeneration++;preparingFrames.clear();
  playT=q.t;
  const clock=questionClock(q,0,{live,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,agentSpeed:AGENT_SPEED});
  hold={id:q.id,start:performance.now(),...clock,shownAt:null,resume,live,pulsed:false};held.add(q.id);agent?.setHold({id:q.id,...clock,shownAt:null,live});showSpeed();
  if(!playing){playing=true;playIcon(true);lastNow=performance.now();requestAnimationFrame(tick);}
}
function endHold(continueDelivery=false){if(!hold)return;hold=null;agent?.setHold(null,{continueDelivery});setAskStatus('');}
function holdStep(now){
  const q=agent?.questions.find(q=>q.id===hold.id);
  // Asked here, the question reaches agent.questions only with the next status poll: wait for it (10 s at most) instead of ending the hold.
  if(!q&&hold.live&&now-hold.start<10000)return true;
  if(!q||q.status==='failed'){const resume=hold.resume;endHold();return resume;}
  Object.assign(hold,questionClock(q,(now-hold.start)/1000,{live:hold.live,typingDuration:hold.typingDuration,agentSpeed:AGENT_SPEED}));
  // The answer shows after its real latency; live, it can only show once it has arrived (the next status poll).
  if(q.status==='answered'&&hold.shownAt==null)hold.shownAt=hold.live?Math.max(q.latency||0,hold.h):q.latency||0;
  if(hold.shownAt!=null&&!hold.pulsed&&hold.h>=hold.shownAt){hold.pulsed=true;agent.replay(q.response);}
  const end=hold.shownAt==null?Infinity:hold.shownAt+(q.live?.read_s??READ_S);
  const writing=agent.writing(q.id)||(hold.live&&q.parts?.text?.status==='streaming')||[...agent.widgets.values()].some(w=>w.visible&&w.userData.response.question_id===q.id&&w.userData.response.stream?.status==='streaming');
  setAskStatus(hold.h<0?'Typing question…':writing&&hold.shownAt!=null&&hold.h>=hold.shownAt?'Writing answer…':hold.shownAt==null||hold.h<hold.shownAt?(writing?'Writing answer…':!hold.live?'Agent thinking':q.parts?.ui&&q.parts?.text?'Response ready…':q.parts?.ui?'UI ready · generating text…':q.parts?.text?'Text ready · preparing UI…':'Agent thinking'):`Reading… ${Math.max(1,Math.ceil(end-hold.h))} s`);
  agent.setHold({id:hold.id,h:hold.h,typingElapsed:hold.typingElapsed,typingDuration:hold.typingDuration,shownAt:hold.shownAt,live:hold.live});
  const first=[...agent.widgets.values()].find(w=>w.visible&&w.userData.response.question_id===q.id&&
    (hold.live||w.userData.response.weather||w.userData.response.findmy||!w.userData.pose?.unreadable));
  // Asked here (live): playback goes on as soon as the answer shows, whether the video was playing or paused when asking.
  // (Live, the frame's hands need not be ready: the user is waiting on the answer, not on the hand overlay.)
  if(hold.h>=0&&first&&(hold.live||currentHandData?.status==='ready'&&resumeOnFirstResponse(uiSettings))){endHold(true);return true;}
  // A replay holds on until the answer is written (UI library › Text › Writing) as well.
  if(hold.h>=end&&!agent.writing(q.id)){const resume=hold.resume||hold.live;endHold();return resume;}
  return true;
}
async function tick(){if(!playing)return;const now=performance.now();
  if(hold){const go=holdStep(now);lastNow=now;showSpeed();update();if(!go){pause();return;}requestAnimationFrame(tick);return;}
  const next=playT+(now-lastNow)/1000*speed;lastNow=now;
  // Reaching an answered question's frame starts its hold.
  const q=(agent?.questions||[]).filter(q=>q.status==='answered'&&!held.has(q.id)&&q.t>=playT-1e-6&&q.t<=next).sort((a,b)=>a.t-b.t)[0];
  if(q){playT=q.t;const seek=at(q.t),epoch=playbackGeneration;await seek;if(!playing||epoch!==playbackGeneration)return;startHold(q);requestAnimationFrame(tick);return;}
  playT=next;await at(Math.min(playT,session.frames.at(-1).t),{realtime:true});if(playT>=session.duration){await at(session.frames.at(-1).t);if(playing&&playT>=session.duration)pause();return;}requestAnimationFrame(tick);}
for(const key of ['trajectory','frustum','video','roomColors','spaceScan','recordingMesh'])$('debug-'+key).onchange=()=>twin.setDebug({[key]:$('debug-'+key).checked});
$('debug-lidar').onchange=()=>{twin.setDebug({lidar:$('debug-lidar').checked});showLidar().catch(fail);};
// This frame's LiDAR depth as points in space coordinates (every 2nd pixel).
async function showLidar(){
  if(!$('debug-lidar').checked||!session.frames[index].depth){twin.setLidar(null);return;}
  const i=index,k=session.intrinsics,{data,width:w,height:h}=(await depthMap(i)).image,cam=frameCamera(i),pts=[],v=new THREE.Vector3();if(i!==index)return;
  for(let y=0;y<h;y+=2)for(let x=0;x<w;x+=2){const d=data[y*w+x];if(!(d>0))continue;const u=(x+.5)/w*k.width,vv=(y+.5)/h*k.height;v.set((u-k.cx)/k.fx*d,-(vv-k.cy)/k.fy*d,-d).applyMatrix4(cam.matrixWorld);pts.push(v.x,v.y,v.z);}
  twin.setLidar(new Float32Array(pts));
}
function showCut(range){showFloor();for(const b of document.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',b.dataset.mode===twin.mode);$('cut-controls').hidden=!range;$('cut-flip-label').hidden=twin.mode==='plan';if(!range)return;Object.assign($('cut'),{min:range.min,max:range.max,value:range.value});$('cut-label').textContent=range.label;$('cut-value').textContent=range.value.toFixed(2);}
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>showCut(twin.setView({mode:b.dataset.mode}));
// Close open option menus on any click outside them.
document.addEventListener('click',e=>{for(const d of document.querySelectorAll('details.menu[open]'))if(!d.contains(e.target))d.open=false;});
$('cut').oninput=()=>showCut(twin.setView({cut:Number($('cut').value)}));
$('cut-flip').onchange=()=>showCut(twin.setView({flip:$('cut-flip').checked}));
$('cut-objects').onchange=()=>showCut(twin.setView({cutObjects:$('cut-objects').checked}));
$('reset-view').onclick=()=>twin.resetView();
function saveFloor(){const f=twin.floorSettings();try{localStorage.setItem('spatial-take:floors:'+spaceURL.pathname,JSON.stringify({level:f.level,split:f.split,automatic:f.automatic}));}catch{}}
function showFloor(){const f=twin.floorSettings();$('floor-view').value=String(f.visibleLevel);$('floor-view').title=twin.mode==='follow'?'Camera follow shows all floors. Choose 1F or 2F to inspect it in Orbit.':'Show only the selected floor';$('floor-split-wrap').hidden=!f.visibleLevel;$('floor-split').value=f.split.toFixed(2);$('floor-split').min=(f.min+.01).toFixed(2);$('floor-split').max=(f.max-.01).toFixed(2);}
$('floor-view').onchange=()=>{showCut(twin.setFloor({level:Number($('floor-view').value),inspect:true}));saveFloor();};
$('floor-split').onchange=()=>{const split=Number($('floor-split').value);if(Number.isFinite(split)){showCut(twin.setFloor({split}));saveFloor();}};
// Full screen of the recorded camera: its column alone, centred; the video as tall as fits above its timeline and ask box (Esc leaves).
const cameraCol=$('camera-col');
function fitCameraFull(){const full=document.fullscreenElement===cameraCol,stage=$('stage');
  if(!full){cameraCol.style.removeProperty('--camera-w');cameraCol.style.removeProperty('--camera-h');return;}
  const cs=getComputedStyle(cameraCol),padY=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom),padX=parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight);
  let others=0;for(const el of cameraCol.children)if(el!==stage&&el.offsetParent!==null){const m=getComputedStyle(el);others+=el.offsetHeight+parseFloat(m.marginTop)+parseFloat(m.marginBottom);}
  const aspect=stage.width/stage.height||16/9;let h=Math.max(120,innerHeight-padY-others-2),w=h*aspect;
  if(w>innerWidth-padX){w=innerWidth-padX;h=w/aspect;}
  cameraCol.style.setProperty('--camera-w',w+'px');cameraCol.style.setProperty('--camera-h',h+'px');update();}
$('camera-full').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else (cameraCol.requestFullscreen||cameraCol.webkitRequestFullscreen).call(cameraCol)?.catch?.(fail);};
document.addEventListener('fullscreenchange',()=>{$('camera-full').setAttribute('aria-pressed',document.fullscreenElement===cameraCol);fitCameraFull();requestAnimationFrame(fitCameraFull);});
addEventListener('resize',()=>{if(document.fullscreenElement===cameraCol)fitCameraFull();});
$('timeline').oninput=()=>{pause();at(Number($('timeline').value)).catch(fail);};
// Components: what is placed in this recording besides the scan. Persistent objects (digital twins of the scene's furniture, scope
// 'scene', in every recording) are listed in the Layout outline under their zone and moved there in Layout Edit mode. Obj library objects
// (category opportunistic) and widgets are in the Objects section. The selected one gets the handles in the 3D view: move and turn (6DoF),
// and scale, except persistent objects (their geometry is the real object's). Saved by scope: the scene's own components
// (spaces/<scene>/composition.json) and this recording's (scenarios/<take>/composition.json).
let fine=null;   // fine-tuning the open recording's alignment (see startFineTune)
let selected=null,compositionRevision=0,sceneRevision=0,compositionTimer=null;
const groupOf=inst=>components.categoryOf(inst.spec);
function select(id){selected=components.get(id)?id:null;anchor=components.get(selected)?.root||noSelection;if(selected)$('zone-info').value='';queueMicrotask(()=>showInfo());
  if(selected&&layout.selected)layout.select(null);if(selected&&groupOf(components.get(selected))==='persistent'&&outlineView?.selected!=='comp:'+selected)outlineView?.setSelected('comp:'+selected);showComponents();update();}
// The handles only on a selected component that is showing (its eye on, inside its time span, its kind shown in the 3D view).
// A layout box being edited with the gizmo (Box handles: Move · rotate): moved on three axes and turned about the vertical only.
function syncGizmo(){const inst=components.get(selected),box=!fine&&layout.enabled&&layout.handleMode==='gizmo'&&layout.selected?.object?.visible?layout.selected:null;
  const want=fine?fine.object:box?box.object:inst&&anchor.visible&&twin.gizmo.enabled&&visibleInTwin(inst)?anchor:null;
  const modes=fine||box||inst&&groupOf(inst)==='persistent'?['translate','rotate']:['translate','rotate','scale'];
  const axes=box||fine?.headset?['Y']:['X','Y','Z'];if(String(twin.gizmo.rotateAxes)!==String(axes)&&!twin.gizmo.dragging)twin.gizmo.setRotateAxes(axes);
  if(String([...twin.gizmo.modes])!==String(modes)&&!twin.gizmo.dragging)twin.gizmo.setModes(modes);
  if(twin.gizmo.object!==want)twin.attach(want);}
// Undo history of component transforms (⌘Z): the transform before each change; a handle drag is one step (its state at the press).
const compHistory=[];let lastEditKey=null,dragBefore=null;
function remember(id,key=null){if(key&&key===lastEditKey)return;lastEditKey=key;const s=components.get(id)?.spec;if(!s)return;
  compHistory.push({id,before:components.transform(s)});if(compHistory.length>200)compHistory.shift();}
function withdraw(){const h=compHistory.pop();lastEditKey=null;if(!h||!components.get(h.id))return;
  select(h.id);components.set(h.id,h.before);showComponents();update();saveComposition();}
// Alt-drag on a handle: a copy stays where the component was and the drag carries on with it (library objects are placed once: no copy).
// An object of the scene's library is placed once per recording, so its copy is a new library object ("… copy", same shape) placed there.
twin.gizmo.addEventListener('duplicate',()=>{const inst=!fine&&components.get(selected);if(!inst||groupOf(inst)==='persistent')return;
  const spec=JSON.parse(JSON.stringify(inst.spec)),m=libraryObject(inst);delete spec.id;spec.name=(spec.name||spec.component)+' copy';
  (async()=>{if(m){const r=await api('/api/objects/duplicate',{space:here[0],id:m.id,name:spec.name,origin:here[1],pose:{position:spec.position,rotation:spec.rotation}});
      await components.loadLibrary(here[0]);spec.component=r.id;spec.initial=components.transform(spec);}
    await components.add(spec);showComponents();update();saveComposition();})().catch(fail);});
for(const g of [twin.gizmo]){g.addEventListener('mouseDown',()=>{if(layout.selected&&g.object===layout.selected.object)layout.beginGizmo();dragBefore=selected&&components.transform(components.get(selected).spec);});
  g.addEventListener('mouseUp',()=>{if(layout.selected&&g.object===layout.selected.object)layout.endGizmo();});
  g.addEventListener('mouseUp',()=>{const s=selected&&components.get(selected)?.spec;if(dragBefore&&s&&JSON.stringify(dragBefore)!==JSON.stringify(components.transform(s))){compHistory.push({id:selected,before:dragBefore});lastEditKey=null;}dragBefore=null;});}
/** Change the selected component (transform, visibility, name) and save; transform changes go into the undo history unless they come
 *  from a handle drag (recorded as one step at the press). */
function setSelected(fields,{history=true,key=null}={}){if(!selected)return;
  if(history&&['position','rotation','yaw','scale'].some(k=>k in fields))remember(selected,key);
  components.set(selected,fields);showComponents();update();saveComposition();}
async function addComponent(spec){
  // New ones stand where the middle of the video meets a surface (else 2 m ahead of the camera).
  let position=spec.position;
  if(!position){const hit=session&&await surfaceAt(.5,.6).catch(()=>null);const p=hit?.point||new THREE.Vector3(0,0,-2).applyQuaternion(camera.quaternion).add(camera.position);position=p.toArray().map(v=>+v.toFixed(3));}
  const inst=await components.add({...spec,position});
  select(inst.spec.id);saveComposition();return inst;}
async function setComposition(specs,sel){components.clear();for(const s of specs)await components.add(s);select(sel&&components.get(sel)?sel:null);}   // nothing selected unless asked: no handles until the user picks a component
let compositionSave=Promise.resolve();
function saveComposition(immediate=false){
  if(!here[0])return Promise.resolve();clearTimeout(compositionTimer);
  const persist=()=>{
    const pending=compositionSave.catch(()=>{}).then(async()=>{
      const r=await api('/api/composition',{session:'./'+sessionURL.pathname.replace(/^\//,''),revision:compositionRevision,components:components.specs('recording')});compositionRevision=r.revision;
      for(const [id,src] of Object.entries(r.srcs||{}))if(components.get(id))components.get(id).spec.src=src;
      keepObjectBaselines();
      if(components.specs('scene').length||sceneRevision)sceneRevision=(await api('/api/composition',{space:here[0],scope:'scene',revision:sceneRevision,components:components.specs('scene')})).revision;
      $('take-status').textContent='';
    });
    compositionSave=pending;return pending;
  };
  if(immediate)return persist();
  compositionTimer=setTimeout(()=>persist().catch(e=>{$('take-status').textContent=e.message;}),400);
}
const fmt=v=>String(+(+v).toFixed(3));
const EYES='<svg class="on" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><svg class="off" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
function eye(on){return `<label class="eye" aria-label="${on?'Hide':'Show'}"><input type="checkbox" ${on?'checked':''}>${EYES}</label>`;}
// Lists that show components: the Objects section and (persistent objects) the Layout outline.
function showComponents(){showObjects();showOutline();}
addEventListener('keydown',e=>{if(e.key==='Escape'&&selected&&groupOf(components.get(selected))!=='widget'){e.preventDefault();select(null);return;}if(e.target.matches?.('input,select,textarea,[contenteditable=true]'))return;if(fine&&(e.metaKey||e.ctrlKey)){const key=e.key.toLowerCase();if(key==='z'||key==='y'){e.preventDefault();if(!twin.gizmo.dragging)$(key==='y'||e.shiftKey?'fine-redo':'fine-withdraw').click();return;}}if(layout?.enabled)return;if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!e.shiftKey&&compHistory.length){e.preventDefault();withdraw();}});
// The recorded camera of any frame (the live camera for the frame on screen).
function frameCamera(i){const snapshot=new THREE.PerspectiveCamera();setPose(snapshot,session.frames[i],session.intrinsics);return snapshot;}
// Surface under (px,py) in frame i (default: the frame on screen), world space, normal facing the camera, with where it came from.
// This recording's LiDAR depth is what the room looked like at that moment; the scan (or recording mesh) is complete but may be stale.
// Both hit within SAME_SURFACE metres along the ray: the depth's point with the mesh's (smoother) normal. They disagree: something
// moved or was added since the scan, so the depth wins. No depth (holes, beyond LiDAR range): the mesh. Neither: the object's plane.
const SAME_SURFACE=.06;
async function surfaceAt(px,py,i=index){
  const k=session.intrinsics,u=px*k.width,v=py*k.height,camera=frameCamera(i),eye=new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  let depthHit=null;
  if(session.frames[i].depth){
    const {data,width:w,height:h}=(await depthMap(i)).image;
    const cam=(x,y)=>{if(x<0||y<0||x>=w||y>=h)return null;const d=data[y*w+x];if(!(d>0))return null;const uu=(x+.5)/w*k.width,vv=(y+.5)/h*k.height;return new THREE.Vector3((uu-k.cx)/k.fx*d,-(vv-k.cy)/k.fy*d,-d);};
    const x=Math.min(w-1,Math.floor(px*w)),y=Math.min(h-1,Math.floor(py*h)),c=cam(x,y);
    if(c){
      // Normal from neighbouring depth samples (3 px apart, one-sided at holes and borders).
      const diff=(a,b)=>a&&b?a.clone().sub(b):null,s=3;
      const tx=diff(cam(x+s,y),cam(x-s,y))||diff(cam(x+s,y),c)||diff(c,cam(x-s,y)),ty=diff(cam(x,y+s),cam(x,y-s))||diff(cam(x,y+s),c)||diff(c,cam(x,y-s));
      let normal=null;if(tx&&ty){normal=tx.cross(ty).normalize();if(normal.dot(c)>0)normal.negate();normal.transformDirection(camera.matrixWorld);}
      const d=-c.z,point=new THREE.Vector3((u-k.cx)/k.fx*d,-(v-k.cy)/k.fy*d,-d).applyMatrix4(camera.matrixWorld);depthHit={point,normal,dist:point.distanceTo(eye)};
    }
  }
  const ray=new THREE.Raycaster();ray.firstHitOnly=true;ray.setFromCamera(new THREE.Vector2(px*2-1,1-py*2),camera);
  const m=room&&ray.intersectObject(room,true)[0];let meshHit=null;
  if(m){const normal=m.face.normal.clone().transformDirection(m.object.matrixWorld);if(normal.dot(ray.ray.direction)>0)normal.negate();meshHit={point:m.point,normal,dist:m.distance};}
  if(depthHit&&meshHit)return Math.abs(depthHit.dist-meshHit.dist)<SAME_SURFACE?{point:depthHit.point,normal:meshHit.normal,source:'depth+mesh'}:{point:depthHit.point,normal:depthHit.normal,source:'depth (changed since scan)'};
  if(depthHit)return {point:depthHit.point,normal:depthHit.normal,source:'depth'};
  if(meshHit)return {point:meshHit.point,normal:meshHit.normal,source:'mesh'};
  const point=new THREE.Vector3();return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-anchor.position.y),point)&&{point,normal:new THREE.Vector3(0,1,0),source:'plane'};
}
// Use a pose snapshot: asynchronous depth loads must not observe a later camera frame.
// Text tolerates 8 cm of scan registration/depth noise and ignores hand pixels; other consumers keep the strict 25 mm test.
async function visibleIn(i,points,{text=false,staticSurface=false}={}){
  const camera=frameCamera(i),inv=camera.matrixWorld.clone().invert(),dm=session.frames[i].depth?(await depthMap(i)).image:null,v=new THREE.Vector3();
  const hands=text?(i===index?currentHandData:await recordingHands.read(i,handKey(i))):null;
  const eye=camera.position,ray=new THREE.Raycaster();ray.firstHitOnly=true;
  const results=[];let sliceStart=performance.now();
  const check=p=>{
    v.copy(p).applyMatrix4(inv);const d=-v.z;if(d<=0)return false;v.applyMatrix4(camera.projectionMatrix);
    if(Math.abs(v.x)>1||Math.abs(v.y)>1)return false;
    if(text&&hands?.mask&&hands.width&&hands.height){
      const x=Math.min(hands.width-1,Math.floor((v.x+1)/2*hands.width)),y=Math.min(hands.height-1,Math.floor((1-v.y)/2*hands.height));
      if(hands.mask[y*hands.width+x])return true;
    }
    if(dm){const x=Math.min(dm.width-1,Math.floor((v.x+1)/2*dm.width)),y=Math.min(dm.height-1,Math.floor((1-v.y)/2*dm.height));
      const o=dm.data[y*dm.width+x];if(o>0&&o<d-(text ? (staticSurface ? .12 : .08) : .025))return false;}
    // Both the space scan and recording mesh contribute, independently of inspection toggles.
    if(room&&(!text||!dm)){const direction=p.clone().sub(eye),distance=direction.length();ray.set(eye,direction.normalize());ray.far=Math.max(0,distance-.015);
      if(ray.far>0&&ray.intersectObject(room,true).length)return false;}
    return true;
  };
  for(const p of points){
    results.push(check(p));
    if(performance.now()-sliceStart>4){await new Promise(resolve=>setTimeout(resolve,0));sliceStart=performance.now();}
  }
  return results;
}
// Hovering a response shows its question; clicking it goes back to the frame where it was asked. Works in the video and the 3D view.
function ndcOf(e){const r=e.target.getBoundingClientRect();return new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);}
function hoverResponse(e,cam){const r=agent?.pick(ndcOf(e),cam),tip=$('tooltip');e.target.style.cursor=r?'pointer':'';if(!r){tip.hidden=true;return null;}
  tip.textContent=`${r.question||'(asked in the terminal)'} · ${r.t.toFixed(2)} s`;tip.hidden=false;tip.style.left=e.clientX+14+'px';tip.style.top=e.clientY+14+'px';return r;}
// Replay a question: back to the frame it was asked at, then play through thinking, answer and reading time.
function replayQuestion(q){pause();$('tooltip').hidden=true;setFrame(q.frame).then(()=>{replayFrom=q.id;$('play').click();}).catch(fail);}
function goToResponse(r){const q=agent?.questions.find(q=>q.id===r.question_id);if(q)replayQuestion(q);else{pause();$('tooltip').hidden=true;setFrame(r.frame).catch(fail);}}
$('stage').onpointermove=e=>hoverResponse(e,camera);$('stage').onpointerleave=()=>$('tooltip').hidden=true;
$('twin').addEventListener('pointermove',e=>hoverResponse(e,twin.camera));$('twin').addEventListener('pointerleave',()=>$('tooltip').hidden=true);
let twinDown=null;$('twin').addEventListener('pointerdown',e=>twinDown=[e.clientX,e.clientY]);
$('twin').addEventListener('click',e=>{if(!twinDown||Math.hypot(e.clientX-twinDown[0],e.clientY-twinDown[1])>4)return;
  if(fine)return;const r=agent?.pick(ndcOf(e),twin.camera);if(r){goToResponse(r);return;}pickComponent(e,twin.camera);});
// A click on a component selects it, and an interactive component gets the click.
// Objects and widgets are selected only while editing objects; persistent objects only in Layout Edit mode (src/layout-editor.mjs
// pickOther). An interactive widget gets its click either way.
function pickComponent(e,cam){const ray=new THREE.Raycaster();ray.setFromCamera(ndcOf(e),cam);const hit=components.pick(ray,i=>(cam===camera?visibleInVideo:visibleInTwin)(i)&&groupOf(i)!=='persistent');if(!hit)return false;
  if(objectsEditing)select(hit.instance.spec.id);hit.instance.runtime.onPointer?.({type:'click',point:hit.point,object:hit.object});update();return true;}
$('stage').onclick=async e=>{if(fine)return;pause();const hitResponse=agent?.pick(ndcOf(e),camera);if(hitResponse){goToResponse(hitResponse);return;}pickComponent(e,camera);};
// Space: play/pause. Left/Right: one frame. Shift+Left/Right: one second. Ignored while typing in a field.
document.addEventListener('keydown',e=>{
  if(!session||e.metaKey||e.ctrlKey||e.altKey||e.target.matches('input[type=number],input[type=text],select,textarea'))return;
  if(e.code==='Space'){e.preventDefault();document.activeElement?.blur();$('play').click();}
  else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();pause();const dir=e.key==='ArrowLeft'?-1:1;(e.shiftKey?at(Math.max(0,session.frames[index].t+dir)):setFrame(Math.max(0,Math.min(session.frames.length-1,index+dir)))).catch(fail);}
});
function setRoom(next,name,encoded){if(room)scene.remove(room);room=next;room?.traverse(o=>{if(o.isMesh&&!o.geometry.boundsTree)o.geometry.computeBoundsTree();});roomName=name;roomData=encoded;scene.add(room);rebuildCatchers();occlusion();}
// A .glb file: as the room mesh, or as a new component (scripts and tests; components are not added from the panel).
async function glb(file,isRoom,category='widget'){pause();const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
  if(isRoom){setRoom((await loader.parseAsync(await file.arrayBuffer(),'')).scene,file.name,encoded);update();return;}
  await addComponent({component:'file',name:file.name,src:encoded,category});}
// Objects section: the scene's object library (opportunistic objects, digital twins of its small things: spaces/<scene>/components/<id>/,
// a box or a .glb; scripts/composition.py) with a tick for each one placed in this recording, then any recording-only .glb files and the
// widgets. A placed object is moved, turned and scaled with the handles, in this recording only. The library keeps a baseline (pose and
// shape): as saved in the recording the object was made in; another recording starts from it when the object is ticked there.
// New ones are added like layout boxes: where the middle of the 3D view meets the scan (src/layout-editor.mjs dropCenter).
const sceneObjects=()=>[...components.library.values()].filter(m=>m.category==='opportunistic');
const libraryObject=inst=>{const m=inst&&components.library.get(inst.spec.component);return m?.category==='opportunistic'?m:null;};
const placedObject=id=>components.instances.find(i=>i.spec.component===id);
function dropPose(size){const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(0,0),twin.camera);
  return {position:dropCenter(ray,pickRoom(ray),size).toArray().map(v=>+v.toFixed(3)),rotation:[0,0,0]};}
async function placeObject(id){const m=components.library.get(id);
  const pose=m.pose&&m.origin!==here[1]?structuredClone(m.pose):dropPose(m.kind==='box'?m.defaultScale:[0,0,0]);
  await addComponent({component:id,category:'opportunistic',...pose,scale:structuredClone(m.defaultScale)});openObjects(true);}
async function newObject(kind,file){const fallback=kind==='box'?'Box':file.name.replace(/\.glb$/i,'');const name=$('object-name').value.trim()||fallback;
  const src=file&&await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
  const size=[.2,.2,.2],pose=dropPose(kind==='box'?size:[0,0,0]);
  const r=await api('/api/objects',{space:here[0],name,kind,origin:here[1],pose,...(kind==='box'?{size}:{src})});
  await components.loadLibrary(here[0]);editObjects(true);await placeObject(r.id);}
// A box object replaced by a .glb model in its place: its bounding box centre where the box's centre was, scaled to fit in the box (here
// and, on the server, in every recording and the baseline: scripts/composition.py replace_object).
async function replaceWithModel(m,file){
  const {size,center:pivot,src}=await readModel(file,loader);
  await saveComposition(true);const r=await api('/api/objects/replace',{space:here[0],id:m.id,src,size,pivot});await components.loadLibrary(here[0]);
  const fit=sc=>Array.isArray(sc)?+fitScale(sc,size).toFixed(4):sc;
  await respawn(m.id,spec=>{spec.scale=fit(spec.scale);if(spec.initial)spec.initial.scale=fit(spec.initial.scale);});
  if(r.revisions?.[here[1]])compositionRevision=r.revisions[here[1]];}
// A model object replaced by a box of its bounds, in its place (here and, on the server, in every recording and the baseline:
// scripts/composition.py model_to_box).
async function replaceWithBox(m){
  const {size,center}=modelBounds((await loader.loadAsync(new URL(m.entry,m.base).href)).scene),pivot=m.pivot||[0,0,0];
  await saveComposition(true);const r=await api('/api/objects/to-box',{space:here[0],id:m.id,size,center});await components.loadLibrary(here[0]);
  const box=t=>{const b=boxFromModel(t,{size,center,pivot});t.position=b.position;t.scale=b.scale;};
  await respawn(m.id,spec=>{box(spec);if(spec.initial?.position)box(spec.initial);});
  if(r.revisions?.[here[1]])compositionRevision=r.revisions[here[1]];}
// The placements of a library object rebuilt from the reloaded library, each spec changed first; the selection is kept.
async function respawn(id,change){const was=selected;
  for(const inst of components.instances.filter(i=>i.spec.component===id)){const spec=structuredClone(inst.spec);components.remove(spec.id);change(spec);await components.add(spec);}
  select(components.get(was)?was:null);showComponents();update();}
// The baseline follows the object as saved in the recording it was made in (one made before origins were kept: the first recording it is
// saved in).
function keepObjectBaselines(){for(const inst of components.instances){const m=libraryObject(inst);if(!m||(m.origin&&m.origin!==here[1]))continue;
  const pose={position:inst.spec.position,rotation:inst.spec.rotation},shape=inst.spec.scale,adopt=!m.origin;
  if(!adopt&&JSON.stringify(pose)===JSON.stringify(m.pose)&&JSON.stringify(shape)===JSON.stringify(m.defaultScale))continue;
  if(m.kind==='box'&&!Array.isArray(shape))continue;   // a box's shape is its size
  m.pose=structuredClone(pose);m.defaultScale=structuredClone(shape);m.origin=here[1];
  api('/api/objects/update',{space:here[0],id:m.id,pose,shape,...(adopt?{origin:here[1]}:{})}).catch(e=>{$('take-status').textContent=e.message;});}}
async function renameObject(id,name){const m=components.library.get(id);name=name.trim();if(!m||!name||name===m.name)return;
  await api('/api/objects/update',{space:here[0],id,name});m.name=name;
  for(const inst of components.instances)if(inst.spec.component===id)components.set(inst.spec.id,{name});showComponents();saveComposition();}
// Double-click a name to rename it in place (Enter or leaving the field keeps it, Escape cancels).
function editName(span,current,onDone){const input=document.createElement('input');input.className='rename';input.value=current;span.replaceWith(input);input.focus();input.select();
  let done=false;const finish=save=>{if(done)return;done=true;input.replaceWith(span);if(save&&input.value.trim()&&input.value.trim()!==current)Promise.resolve(onDone(input.value.trim())).catch(e=>{$('take-status').textContent=e.message;});};
  input.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();finish(true);}if(e.key==='Escape')finish(false);};input.onblur=()=>finish(true);input.onclick=e=>e.stopPropagation();}
const TRASH='<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>';
function unplace(inst){components.remove(inst.spec.id);if(selected===inst.spec.id)select(null);showComponents();update();saveComposition();}
// One row: [tick] name kind [eye] [model] [remove]. Only while editing objects (the Edit button): tick, rename, replace, remove, and
// clicking a placed row to select it (handles in the 3D view).
function objectRow({name,kind,inst,tick,onTick,onRename,onRemove,swap=null,onModel,onBox}){const edit=objectsEditing;
  const li=document.createElement('li');li.className='item obj'+(inst?' placed':'');if(inst&&inst.spec.id===selected)li.setAttribute('aria-current','true');
  li.innerHTML=`${tick?`<input type="checkbox" class="here" title="Placed in this recording" ${inst?'checked':''} ${edit?'':'disabled'}>`:''}<span class="name"></span><span class="n">${kind}</span>${inst?eye(inst.spec.visible):''}`
    +`${edit?swapHTML(swap):''}${edit&&onRemove?`<button class="del" aria-label="Remove" title="Remove from the scene's objects">${TRASH}</button>`:''}`;
  li.querySelector('.name').textContent=name;
  li.onclick=e=>{if(e.target.closest('label,button,input'))return;if(inst&&edit)select(inst.spec.id);};
  if(inst)li.ondblclick=e=>{if(!e.target.closest('label,button,input'))frameItem(OBJ+inst.spec.id);};
  if(onRename&&edit)li.querySelector('.name').ondblclick=e=>{e.stopPropagation();if(inst)frameItem(OBJ+inst.spec.id);editName(e.target,name,onRename);};
  wireSwap(li,{onModel,onBox,onError:err=>{$('take-status').textContent=err.message;}});
  li.querySelector('.here')?.addEventListener('change',e=>Promise.resolve(onTick(e.target.checked)).catch(err=>{$('take-status').textContent=err.message;}));
  li.querySelector('.eye input')?.addEventListener('change',e=>{components.set(inst.spec.id,{visible:e.target.checked});showComponents();update();saveComposition();});
  li.querySelector('.del')?.addEventListener('click',()=>Promise.resolve(onRemove()).catch(err=>{$('take-status').textContent=err.message;}));
  return li;}
function showObjects(){
  const selected=$('space').value||here[0],foreign=selected!==here[0];
  $('objects-wrap').querySelector('.outline-tools').hidden=foreign;
  if(foreign){
    const names=spaceData.spaces.find(s=>s.name===selected)?.objects||[];
    $('objects-count').textContent=`${names.length} object${names.length===1?'':'s'} · ${selected}`;
    $('objects-edit').hidden=$('object-add-menu').hidden=true;
    const list=$('object-library');list.replaceChildren();
    for(const name of names){const li=document.createElement('li');li.className='item';li.textContent=name;list.append(li);}
    const hint=document.createElement('li');hint.className='item muted';hint.textContent='Open a recording in this scene to place or edit its objects.';list.append(hint);
    return;
  }
  const list=$('object-library'),all=sceneObjects(),loose=components.instances.filter(i=>groupOf(i)==='opportunistic'&&!libraryObject(i)),widgets=components.instances.filter(i=>groupOf(i)==='widget');
  const n=all.length+loose.length;$('objects-count').textContent=`${n} object${n===1?'':'s'} · ${selected||'scene'}`;$('objects-edit').hidden=$('object-add-menu').hidden=!here[0];
  list.replaceChildren();
  for(const m of all){const inst=placedObject(m.id);
    list.append(objectRow({name:m.name,kind:m.kind==='box'?'box':'glb',inst,tick:true,onTick:on=>on?placeObject(m.id):unplace(inst),onRename:name=>renameObject(m.id,name),
      swap:m.kind==='box'?'box':m.kind==='gltf'?'model':null,onModel:file=>replaceWithModel(m,file),onBox:()=>replaceWithBox(m),
      onRemove:async()=>{if(!confirm(`Remove ${m.name} from this scene?`))return;if(inst){unplace(inst);await saveComposition(true);}
        await api('/api/objects/delete',{space:here[0],id:m.id});await components.loadLibrary(here[0]);showComponents();update();}}));}
  // .glb files imported into this recording alone (before the library): untick to remove.
  for(const inst of loose)list.append(objectRow({name:inst.spec.name,kind:'glb · here only',inst,tick:true,onTick:on=>{if(!on)unplace(inst);},onRename:name=>{select(inst.spec.id);setSelected({name});}}));
  if(widgets.length){const h=document.createElement('li');h.className='item obj-group';h.textContent='Widgets';list.append(h);
    for(const inst of widgets)list.append(objectRow({name:inst.spec.name,kind:components.library.get(inst.spec.component)?.kind==='gltf'||inst.spec.component==='file'?'glb':'three',inst,onRename:name=>{select(inst.spec.id);setSelected({name});}}));}
}
function openObjects(open){$('objects-wrap').hidden=!open;$('objects-count').setAttribute('aria-expanded',open);}
$('objects-count').onclick=()=>openObjects($('objects-wrap').hidden);
// Editing objects (the Edit button) and editing the layout take turns.
let objectsEditing=false;
function editObjects(on){objectsEditing=on;$('objects-edit').setAttribute('aria-pressed',on);if(on){if(layout.enabled)editLayout(false);openObjects(true);}
  const inst=components.get(selected);if(!on&&inst&&groupOf(inst)!=='persistent')select(null);else showComponents();}
$('objects-edit').onclick=()=>editObjects(!objectsEditing);
// Add (a menu): name, type (a box, or a 3D model from a .glb), then Add to scene.
let newType='box';const fileLabel=()=>{const f=$('opportunistic-import').files[0];$('object-file').querySelector('span').textContent=f?f.name:'Choose .glb';};
for(const b of document.querySelectorAll('#object-add-menu [data-type]'))b.onclick=()=>{newType=b.dataset.type;for(const x of document.querySelectorAll('#object-add-menu [data-type]'))x.setAttribute('aria-pressed',x===b);$('object-file').hidden=newType!=='gltf';};
$('opportunistic-import').onchange=fileLabel;
$('object-add-menu').ontoggle=()=>{if($('object-add-menu').open)$('object-name').focus();};
$('object-create').onclick=async()=>{const file=$('opportunistic-import').files[0];if(newType==='gltf'&&!file){$('opportunistic-import').click();return;}
  try{await newObject(newType,file);$('object-name').value='';$('opportunistic-import').value='';fileLabel();$('object-add-menu').open=false;}catch(err){$('take-status').textContent=err.message;}};
function occlusion(){if(!room)return;room.traverse(o=>{if(o.isMesh){
  // Keep a scan's texture for the 3D view before the occluder material replaces it.
  if(!('scanMap' in o.userData)){o.userData.scanMap=o.material.map||null;o.userData.scanColor=o.material.color?.clone()||new THREE.Color(0xffffff);o.userData.scanOpacity=o.material.opacity??1;o.userData.scanTransparent=!!o.material.transparent;o.userData.scanAlphaTest=o.material.alphaTest||0;}o.material=new THREE.MeshBasicMaterial({color:0x888888,wireframe:!$('occlude').checked,colorWrite:!$('occlude').checked&&$('room-wireframe').checked,depthWrite:$('occlude').checked,side:THREE.DoubleSide});o.renderOrder=-1;}});update();}
$('occlude').onchange=occlusion;$('shadows').onchange=update;$('depth-occlude').onchange=()=>setFrame(index).catch(fail);$('room-wireframe').onchange=occlusion;$('video-lidar-mesh').onchange=update;// Save: a self-contained file (imported .glb files embedded as data URLs, wherever they are stored).
$('save').onclick=async()=>{const doc=placement();for(const c of doc.components)if(c.src&&!c.src.startsWith('data:')){const blob=await(await fetch(new URL(c.src,sessionURL))).blob();c.src=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(blob);});}
  const u=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='placement.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
async function loadPlacement(p){
  if(p.roomData){if(!p.roomData.startsWith('data:'))throw Error('Only embedded local GLBs accepted');const b=await(await fetch(p.roomData)).blob();await glb(new File([b],p.room||'room.glb'),true);}
  // Version 1: one object (the calibration cube, or an embedded .glb) with its transform.
  const specs=p.version===2?p.components:[{component:p.modelData?'file':'calibration-cube',name:p.modelData?p.model:undefined,src:p.modelData,position:p.position,yaw:p.yaw,scale:p.scale,visible:p.visible,mount:p.mount}];
  if(specs.some(s=>s.src&&!s.src.startsWith('data:')&&!/^assets\//.test(s.src)))throw Error('Only embedded or scenario GLBs accepted');
  await setComposition(specs,p.selected);$('shadows').checked=p.shadows!==false;$('occlude').checked=!!p.occlude;$('depth-occlude').checked=!!p.depthOcclude&&!$('depth-occlude').disabled;$('room-wireframe').checked=!!p.roomWireframe;$('video-twins').checked=p.videoTwins!==false;occlusion();if(session)await setFrame(index);}
$('load').onchange=async e=>{try{await loadPlacement(JSON.parse(await e.target.files[0].text()));saveComposition();}catch(err){fail(err);}};
// Scene panel (only when served by scripts/server.py), three levels: Scene (a space) → Scan (one of the space's scans, from any
// scanning app; all are already in the space's coordinates, so switching needs no re-alignment) → Recordings (Record3D takes made
// there, the scenarios). "Add recording" picks a take from private/ and runs the whole pipeline on the server (import, its own mesh,
// alignment to the scan).
const here=(sessionURL.pathname.match(/\/spaces\/([^/]+)\/scenarios\/([^/]+)\/session\.json$/)||[]).slice(1);
async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;}
const ICON={scenario:'<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',add:'<path d="M12 5v14M5 12h14"/>',
  ok:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',target:'<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',warn:'<path d="M12 4l9 16H3zM12 10v4M12 17v.5"/>',spin:'<path d="M12 3a9 9 0 1 0 9 9"/>'};
const svg=k=>`<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
let spaceData={spaces:[],takes:[],meshAvailable:false},busySpace=null;
const openScenario=session=>{location.href='?session='+encodeURIComponent(session);};
function row(cls,icon,name,state){const li=document.createElement('li');li.className='item '+cls;li.innerHTML=`${svg(icon)}<span class="name"></span>${state||''}`;li.querySelector('.name').textContent=name;return li;}
function picker(li,takes,onPick){const sel=document.createElement('select');sel.className='pick';sel.setAttribute('aria-label',li.querySelector('.name').textContent);
  sel.add(new Option('',''));for(const t of takes)sel.add(new Option(t.label,t.name));sel.onchange=()=>{if(sel.value)onPick(sel.value);};li.append(sel);return li;}
function showSpace(){
  const sp=spaceData.spaces.find(s=>s.name===$('space').value),list=$('space-items');list.replaceChildren();if(!sp)return;
  const busy=busySpace?.space===sp.name?busySpace:null,spinner=`<span class="state">${svg('spin').replace('<svg','<svg class="spin"')}</span>`;
  // Scan: which of the scene's scans is used for occlusion, placement and aligning recordings. A layout (RoomPlan) is boxes only.
  const scan=$('scan');scan.replaceChildren();scan.disabled=!sp.scans.length||!!busy;
  if(!sp.scans.length)scan.add(new Option('No scan',''));
  for(const x of sp.scans){scan.add(new Option(x.label+(x.kind==='layout'?' · layout':''),x.id));if(x.primary)scan.value=x.id;}
  const sources=$('scan-sources');sources.replaceChildren();
  for(const source of sp.pendingScans||[]){
    const li=row('scan-source','add',source.label),button=document.createElement('button');button.textContent='Import scan';button.disabled=!!busySpace;
    button.onclick=()=>run('/api/scan/import',{space:sp.name,source:source.name},'scan');li.append(button);sources.append(li);
  }
  if(sp.name!==here[0]){if(objectsEditing)editObjects(false);select(null);}
  showObjects();
  // Layout: labelled boxes over the scan (RoomPlan's first guess, corrected here). Editable for the scene that is open.
  const L=sp.layout;
  $('layout-edit').disabled=!(L&&here[0]===sp.name&&layoutLoaded);
  if($('layout-edit').disabled&&layout.enabled)editLayout(false);
  // Recordings: click to open. State: aligned / aligning / not aligned (click the warning to try again).
  for(const sc of sp.scenarios){
    const aligning=busy&&busy.take===sc.name&&sp.scan,current=here[0]===sp.name&&here[1]===sc.name;
    const state=aligning?spinner:sc.alignError?`<span class="state warn">${svg('warn')}</span>`:sc.registered?`<span class="state">${svg('ok')}</span>`:'';
    // The open recording can be aligned by hand to the scan.
    const manual=current&&sp.scan&&!aligning?`<button class="state manual" aria-label="Align" title="Align: pick what this recording shows">${svg('target')}</button>`:'';
    // How well it is aligned: the error left, and what it was aligned to.
    const r=sc.registration,quality=sc.registered&&r?.rmse!=null&&!aligning?`<span class="state q" title="${r.target?'aligned to the parts picked':'aligned to the whole scan'} · ${r.method||''}${r.explained!=null?` · ${Math.round(r.explained*100)}% explained`:''}">${(r.rmse*100).toFixed(1)} cm${r.target?'':' ·?'}</span>`:'';
    const li=row('scenario','scenario',sc.label,quality+state+manual+(current&&sp.scan&&sc.roomMesh?'<button class="tune" title="Drag this recording into place without automatic alignment">Tune</button>':''));if(current)li.setAttribute('aria-current','true');
    li.onclick=e=>{if(e.target.closest('.tune')){e.stopPropagation();startFineTune();return;}if(e.target.closest('.manual')){e.stopPropagation();openAlign();return;}if(e.target.closest('.warn')){e.stopPropagation();run('/api/register',{space:sp.name,take:sc.name},'align');return;}if(!current)openScenario(sc.session);};
    // Rename the open scenario's recording by double-clicking its name.
    if(current)li.querySelector('.name').ondblclick=()=>renameInline(li.querySelector('.name'),sc.name,sc.label);
    list.append(li);
  }
  if(busy?.kind==='add')list.append(row('scenario','scenario',busy.take,spinner));
  // Add recording: this scene's recordings in private/<scene>/recordings/ that are not added yet.
  const free=spaceData.takes.filter(t=>(!t.scene||t.scene===sp.name)&&!t.spaces.includes(sp.name)&&busy?.take!==t.name);
  for(const take of free){
    const li=row('recording-source','scenario',take.label),button=document.createElement('button');button.textContent='Prepare';button.disabled=!!busySpace;
    button.title='Import recording, build its mesh, align to the scene and prepare hands';
    button.onclick=()=>run('/api/scenarios',{space:sp.name,take:take.name},'add');li.append(button);list.append(li);
  }
}
function renameInline(span,take,current){
  const input=document.createElement('input');input.className='rename';input.value=current;span.replaceWith(input);input.focus();input.select();
  let done=false;const finish=async save=>{if(done)return;done=true;const name=input.value.trim();
    if(save&&name&&name!==current){try{await api('/api/rename',{take,name});}catch(e){$('take-status').textContent=e.message;}}await loadSpaces();};
  input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();finish(true);}if(e.key==='Escape')finish(false);};input.onblur=()=>finish(true);
}
async function loadSpaces(){
  try{spaceData=await api('/api/spaces');}catch{return;}
  $('space-panel').hidden=false;const keep=$('space').value||here[0];$('space').innerHTML='';
  for(const sp of spaceData.spaces)$('space').add(new Option(sp.name,sp.name));if(keep)$('space').value=keep;
  showSpace();
}
async function run(path,body,kind){
  if(busySpace)return;busySpace={...body,kind};$('take-status').textContent=kind==='add'?'Preparing recording · import, mesh, alignment and offline hands…':kind==='scan'?'Importing scan…':'';showSpace();
  let polling=false;
  const progress=kind==='add'?setInterval(async()=>{
    if(polling||!busySpace)return;polling=true;
    try{const s=await api('/api/hands?session='+encodeURIComponent(`./spaces/${body.space}/scenarios/${body.take}/session.json`));if(busySpace)$('take-status').textContent=`Preparing recording · offline hands ${Object.keys(s.entries).length}/${s.total}`;}catch{}finally{polling=false;}
  },2500):null;
  try{const r=await api(path,body);busySpace=null;
    // The open scenario changed (re-imported, newly aligned, or the scan moved): reload it; a newly added one opens.
    if(kind==='add')openScenario(r.session);else if(here[0]===body.space)location.reload();else await loadSpaces();
  }catch(e){busySpace=null;$('take-status').textContent=e.message;await loadSpaces();}finally{clearInterval(progress);}
}
// Fine-tune a recording's alignment by hand: its own mesh (placed in the scene by toSpace) gets the move / rotate gizmo in the 3D view
// and is dragged onto the scan; the recorded camera follows live (video overlay, frustum, trajectory). Scale stays 1. Withdraw steps back
// one drag, Reset goes back to the saved alignment, Save stores it (method fine-tune), Cancel leaves it as saved.
function applyToSpace(M){toSpace=M.clone();
  for(const f of session.frames){const p=new THREE.Vector3(),q=new THREE.Quaternion(),sc=new THREE.Vector3();
    new THREE.Matrix4().compose(new THREE.Vector3(...f.raw.position),new THREE.Quaternion(...f.raw.quaternion),new THREE.Vector3(1,1,1)).premultiply(M).decompose(p,q,sc);f.position=p.toArray();f.quaternion=q.toArray();}
  twin.trajectory.geometry.dispose();twin.trajectory.geometry=new THREE.BufferGeometry().setFromPoints(session.frames.map(f=>new THREE.Vector3(...f.position)));
  clearTimeout(calibrationTimer);calibrationTimer=setTimeout(calibrateSurfaces,800);   // the frames moved: measure the surfaces again
  setFrame(index).catch(fail);}
// The gizmo sits on a pivot at the centre of the recording's mesh (its own origin is where the recording started, often far off), the
// mesh hanging under it; toSpace is the mesh's resulting world matrix.
function fineToSpace(){fine.mesh.updateMatrixWorld(true);return fine.mesh.matrixWorld.clone();}
function setFineMatrix(M){const o=fine.object;M.decompose(o.position,o.quaternion,o.scale);o.scale.set(1,1,1);o.updateMatrix();o.updateMatrixWorld(true);if(!fine.headset)applyToSpace(fineToSpace());showFine();}
function showFine(){$('fine-bar').hidden=!fine;if(!fine)return;$('fine-bar').querySelector('span').textContent=fine.headset?'Tune the headset: drag its room (blue points) onto the scan in the 3D view (move / turn). Save sends it to the headset.':"Tune: drag the recording's mesh onto the scan in the 3D view (move / rotate).";$('fine-withdraw').disabled=!fine.history.canUndo;$('fine-redo').disabled=!fine.history.canRedo;$('fine-reset').disabled=fine.object.matrix.equals(fine.saved);$('fine-save').disabled=$('fine-reset').disabled&&!fine.initialPlacement;}
function startFineTune(){if(fine)return;const g=roomParts?.userData.parts.recording;
  if(!g){$('take-status').textContent='Prepare this recording first to create its mesh, then drag it into place.';return;}
  const originalToSpace=toSpace?.clone()||null;
  alignPanel.hide();if(layout.enabled)editLayout(false);if(objectsEditing)editObjects(false);
  pause();select(null);
  const pivot=new THREE.Group();pivot.name='recording-pivot';new THREE.Box3().setFromObject(g).getCenter(pivot.position);g.parent.add(pivot);pivot.updateMatrixWorld(true);pivot.attach(g);
  fine={object:pivot,mesh:g,saved:pivot.matrix.clone(),history:createTransformHistory(),before:null,originalToSpace,initialPlacement:!originalToSpace};
  if(!toSpace)applyToSpace(new THREE.Matrix4());
  $('debug-recordingMesh').checked=true;$('debug-spaceScan').checked=true;twin.setDebug({recordingMesh:true,spaceScan:true});
  // Look at the whole recording mesh, the gizmo in the middle.
  const sphere=new THREE.Box3().setFromObject(g).getBoundingSphere(new THREE.Sphere());for(const b of document.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',b.dataset.mode==='orbit');
  twin.focusOn(sphere.center,Math.max(.8,sphere.radius));showCut(twin.setView({}));showFine();update();}
function endFineTune(restore){if(!fine)return;
  if(fine.headset){fine.object.removeFromParent();fine.mesh.geometry.dispose();fine.mesh.material.dispose();fine=null;showFine();update();return;}
  if(restore)setFineMatrix(fine.saved);
  const {object:pivot,mesh:g}=fine;if(restore&&!fine.originalToSpace)toSpace=null;pivot.parent.attach(g);pivot.removeFromParent();fine=null;showFine();update();}
// The gizmo reports the pivot moved: scale is not part of an alignment.
function fineMoved(o){if(fine.headset)levelHeadset(o);o.scale.set(1,1,1);o.updateMatrix();o.updateMatrixWorld(true);if(!fine.headset)applyToSpace(fineToSpace());showFine();}
for(const g of [twin.gizmo]){g.addEventListener('mouseDown',()=>{if(fine)fine.before=fine.object.matrix.clone();});
  g.addEventListener('mouseUp',()=>{if(fine?.before&&!fine.before.equals(fine.object.matrix))fine.history.record(fine.before,fine.object.matrix);if(fine)fine.before=null;showFine();});}
$('fine-withdraw').onclick=()=>{const M=fine?.history.undo(fine.object.matrix);if(M)setFineMatrix(M);};
$('fine-redo').onclick=()=>{const M=fine?.history.redo(fine.object.matrix);if(M)setFineMatrix(M);};
$('fine-reset').onclick=()=>{if(!fine)return;fine.history.record(fine.object.matrix,fine.saved);setFineMatrix(fine.saved);};
$('fine-cancel').onclick=()=>endFineTune(true);
$('fine-save').onclick=async()=>{if(fine?.headset){saveHeadsetTune();return;}const e=fineToSpace().elements,rowMajor=[e[0],e[4],e[8],e[12],e[1],e[5],e[9],e[13],e[2],e[6],e[10],e[14],e[3],e[7],e[11],e[15]];
  try{await api('/api/align-manual',{space:here[0],take:here[1],toSpace:rowMajor.map(v=>+v.toFixed(6)),info:{method:'fine-tune'}});if(fine.initialPlacement){location.reload();return;}fine.originalToSpace=toSpace.clone();fine.saved=fine.object.matrix.clone();fine.history.clear();showFine();loadSpaces();}
  catch(err){$('take-status').textContent=err.message;}};
// Vision Pro: the headset's alignment tuned the same way (Vision Pro tab › Tune). Its room's mesh as it sees it (points, world, sent by
// the headset every 10 s: /api/vision/room) is placed in the scene by its alignment (space = alignment⁻¹ · world) and gets the gizmo:
// moved on three axes, turned about the vertical only (both frames keep gravity). Save sends the new alignment
// (/api/vision/alignment); the headset takes it within seconds and saves it as its world anchor.
async function startHeadsetTune(){
  if(fine)return;
  let r;try{r=await api(`/api/vision/room?space=${encodeURIComponent(here[0])}`);}catch(e){$('vision-tune-status').textContent=e.message;return;}
  if(layout.enabled)editLayout(false);if(objectsEditing)editObjects(false);select(null);
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(r.points,3));
  const pts=new THREE.Points(geo,new THREE.PointsMaterial({color:0x5ab8ff,size:.035,sizeAttenuation:true,transparent:true,opacity:.85,depthWrite:false}));
  pts.name='headset-room';pts.matrixAutoUpdate=true;
  const worldFromSpace=new THREE.Matrix4().set(...r.worldFromSpace);
  pts.applyMatrix4(worldFromSpace.clone().invert());scene.add(pts);pts.updateMatrixWorld(true);
  const pivot=new THREE.Group();pivot.name='headset-pivot';new THREE.Box3().setFromObject(pts).getCenter(pivot.position);scene.add(pivot);pivot.updateMatrixWorld(true);pivot.attach(pts);
  fine={object:pivot,mesh:pts,saved:pivot.matrix.clone(),history:createTransformHistory(),before:null,headset:true,initialPlacement:false};
  for(const b of document.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',b.dataset.mode==='orbit');
  const sphere=new THREE.Box3().setFromObject(pts).getBoundingSphere(new THREE.Sphere());twin.focusOn(sphere.center,Math.max(.8,Math.min(6,sphere.radius)));showCut(twin.setView({}));
  $('vision-tune-status').textContent=`The headset's room: ${Math.round(r.points.length/3)} points, sent ${Math.round(Date.now()/1000-r.at)} s ago.`;
  showFine();update();}
// Turned about the vertical only: whatever tilt a drag gave is dropped (yaw kept).
function levelHeadset(o){const e=new THREE.Euler().setFromQuaternion(o.quaternion,'YXZ');o.quaternion.setFromEuler(new THREE.Euler(0,e.y,0,'YXZ'));}
async function saveHeadsetTune(){
  fine.mesh.updateMatrixWorld(true);const worldFromSpace=fine.mesh.matrixWorld.clone().invert(),e=worldFromSpace.elements;
  const rowMajor=[e[0],e[4],e[8],e[12],e[1],e[5],e[9],e[13],e[2],e[6],e[10],e[14],e[3],e[7],e[11],e[15]].map(v=>+v.toFixed(6));
  try{await api('/api/vision/alignment',{space:here[0],worldFromSpace:rowMajor});fine.saved=fine.object.matrix.clone();fine.history.clear();showFine();
    $('vision-tune-status').textContent='Sent: the headset takes it within a few seconds and saves it.';}
  catch(err){$('vision-tune-status').textContent=err.message;}}
$('space').onchange=showSpace;
$('space-refresh').onclick=()=>loadSpaces();
window.addEventListener('focus',()=>{if(!busySpace)loadSpaces();});
setInterval(()=>{if(!document.hidden&&!busySpace&&!document.querySelector('#space-panel input:focus'))loadSpaces();},10000);
// Layout editing (src/layout-editor.mjs). Saved half a second after the last change.
let layoutLoaded=false,layoutTimer=null,layoutRevision=0,layoutRooms=[],layoutURL=null,layoutSem=null;
// The scan under a ray from the 3D view; in plan and elevation views, only what the section plane leaves visible.
function pickRoom(ray){return room?ray.intersectObject(room,true).find(h=>!['plan','elevation-x','elevation-z'].includes(twin.mode)||twin.clip.distanceToPoint(h.point)>=0):null;}
twin.setCuttable(()=>[twin.semantic,components.group]);   // what Cut objects clips in section views
let twinPanel=null;
const layout=createLayoutEditor({group:twin.semantic,getRooms:()=>layoutRooms,canvas:$('twin'),getCamera:()=>twin.camera,render:()=>twin.render(),pickScene:pickRoom,
  pickOther:ray=>{const hit=components.pick(ray,i=>groupOf(i)==='persistent'&&visibleInTwin(i)&&!outlineLocked.has(i.spec.id));if(hit)select(hit.instance.spec.id);else if(selected)select(null);return !!hit;},
    // Saves carry the revision this page loaded; one saved from another window since is refused (409) instead of overwritten.
  onChange:data=>{showOutline();clearTimeout(layoutTimer);layoutTimer=setTimeout(async()=>{try{const r=await api('/api/layout',{space:here[0],revision:layoutRevision,...data});
    // The saved layout, with the doors and windows the server cut into the walls again: walls, effects and text surfaces follow.
    const sem=await(await fetch(layoutURL,{cache:'no-store'})).json();structure.setData(sem);vision?.setLayout(sem);weatherScene.setLayout(sem);setTextLayout(sem);
    layoutRevision=r.revision;$('take-status').textContent='';await loadSpaces();twinPanel?.load();}catch(e){$('take-status').textContent=e.message;}},500);},
  onHistory:h=>{$('layout-undo').disabled=!h.undo;$('layout-redo').disabled=!h.redo;},
  onSelect:b=>{if(b&&selected)select(null);update();if(b)outlineView?.setSelected('layout:'+b.id);for(const id of ['box-label','box-yaw','box-type','box-delete','box-duplicate'])$(id).disabled=!b;
    $('box-type').value=b?.kind||'object';if(b)$('zone-info').value='';showInfo();
    $('box-destination-row').hidden=b?.category?.toLowerCase()!=='door';if(document.activeElement!==$('box-destination'))$('box-destination').value=b?.destination||'';
    const kids=b?layout.children().length:0;$('box-arrange').disabled=!kids;$('box-arrange').title=kids?`Arrange ${kids} children: same rotation, centred, evenly spaced`:'Arrange children';
    if(document.activeElement!==$('box-label'))$('box-label').value=b?.label||'';if(document.activeElement!==$('box-yaw'))$('box-yaw').value=b?Math.round(b.yaw||0):'';}});
// Info selection marked in the 3D view (src/selection-marks.mjs; Display options: Info selection), hidden outside the room the view is in.
const selectionMarks=createSelectionMarks({group:twin.helper});selectionMarks.setEnabled($('show-selection').checked);
twin.onRender(view=>layout.setLabelView(view));
// Persistent scene objects go by OBJ + the component's id where a box id is expected (framing). outlineHidden / outlineLocked: the scene
// objects hidden or locked in the entity tree.
const OBJ='obj:';const outlineHidden=new Set(),outlineLocked=new Set();
const isObj=id=>id.startsWith(OBJ),objId=id=>id.slice(OBJ.length);
// Furniture as a 3D model or its box (src/model-fit.mjs; scripts/spaces.py set_furniture_model): the model fits inside the box, which
// stays the layout's (placement, surfaces and alignment keep using it).
async function furnitureToModel(id,file){const m=await readModel(file,loader);
  const r=await api('/api/layout/model',{space:here[0],id,src:m.src,size:m.size,center:m.center});layoutRevision=r.revision;
  layout.setModel(id,m.scene,{size:m.size,center:m.center});showOutline();}
async function furnitureToBox(id){const r=await api('/api/layout/model',{space:here[0],id});layoutRevision=r.revision;layout.setModel(id,null);showOutline();}
async function loadFurnitureModels(sem){
  for(const [id,info] of Object.entries(sem?.models||{}))loader.loadAsync(new URL(`${info.src}?v=${info.at||0}`,spaceURL).href)
    .then(g=>layout.setModel(id,g.scene,{size:info.size,center:info.center}),e=>console.warn('furniture model',id,e));}
// Double-click in a panel: the 3D view frames that object (its component) or piece of furniture (its layout box).
function frameItem(id){const o=isObj(id)?components.get(objId(id))?.root:layout.boxes.find(b=>b.id===id)?.object;if(!o)return;
  o.updateWorldMatrix(true,true);twin.frame(new THREE.Box3().setFromObject(o));showCut(null);}
// The space's entities are one tree in the Space tab (src/twin-panel.mjs); the selected one shows its geometry tools there.
// Picking an entity selects it in the 3D view: a layout box (furniture, door, wall), a scene object, or a place (its info is the zone's).
function pickEntity(id){
  if(id.startsWith('layout:')){const b=layout.boxes.find(x=>x.id===id.slice(7));if(b){if(selected)select(null);layout.select(b);}}
  else if(id.startsWith('comp:')&&components.get(id.slice(5))){layout.select(null);select(id.slice(5));}
  else{layout.select(null);if(selected)select(null);}
  $('zone-info').value=id.startsWith('zone:')?id.slice(5):'';outlineView?.setSelected(id);showInfo();
}
// The selected entity's panel: Geometry holds the layout editor's tools (edit mode, label, rotation, type, add / duplicate / delete,
// undo) and, for furniture, its 3D model; Knowledge holds the info editor. An entity without geometry (an item registered by name)
// says so.
function showEntityDetail(e,{geometry,knowledge}){
  const tools=$('geometry-tools'),edit=$('layout-edit'),box=$('layout-tools');
  if(!e||!geometry){tools.append(edit,box);const panel=$('box-info');if(panel.closest('#layout-outline'))box.insertBefore(panel,$('box-destination-row'));if(e===null&&!geometry)return;showInfo();return;}
  geometry.replaceChildren();
  // Only what has geometry (a layout box, a scene object) gets the tools: edit mode, rotation, a door's destination, add / duplicate /
  // delete / arrange, undo; furniture can also be drawn with a 3D model. Its name is renamed in the tree, its kind set in Semantics.
  if(/^(layout|comp):/.test(e.id)){
    const row=document.createElement('div');row.className='geo-row';
    const label=Object.assign(document.createElement('span'),{className:'muted',textContent:'Geometry'});row.append(label,edit);
    if(e.id.startsWith('layout:')&&e.kind==='furniture'){const id=e.id.slice(7);
      if(layout.hasModel(id)){const b=Object.assign(document.createElement('button'),{className:'tool',textContent:'Use box',title:'Draw it as its box again'});b.onclick=()=>furnitureToBox(id).catch(fail);row.append(b);}
      else{const l=Object.assign(document.createElement('label'),{className:'btn tool',textContent:'3D model…',title:'Draw it with a .glb model'}),f=Object.assign(document.createElement('input'),{type:'file',accept:'.glb',hidden:true});
        f.onchange=()=>{if(f.files[0])furnitureToModel(id,f.files[0]).catch(fail);};l.append(f);row.append(l);}}
    geometry.append(row,box);
  }else geometry.remove();
  showInfo();
}
// The tree (src/layout-outline.mjs) over the twin's entities: by place (each place's furniture, doors and objects, nested by what they
// are inside; walls and ceilings are under Types) or by type. Hide and lock act on what has geometry (layout boxes, scene objects).
const entityId=id=>id.startsWith('layout:')?id.slice(7):id.startsWith('comp:')?OBJ+id.slice(5):null;
const ROW_KIND={place:'place',furniture:'furniture',opening:'opening',structure:'structure',item:'object',artifact:'artifact',device:'device'};
let groupBy=(()=>{try{return localStorage.getItem('spatial-take:layout-group')==='type'?'type':'zone';}catch{return 'zone';}})();
function entityGroups(){
  const ents=twinPanel?.entities||[],byName=(a,b)=>a.box.label.localeCompare(b.box.label);
  const node=e=>({box:{id:e.id,label:e.name,kind:ROW_KIND[e.kind],bare:!entityId(e.id)},children:[]});
  const forest=list=>{const ids=new Set(list.map(e=>e.id)),nodes=new Map(list.map(e=>[e.id,node(e)])),roots=[];
    for(const e of list)(ids.has(e.parent)?nodes.get(e.parent).children:roots).push(nodes.get(e.id));
    const sort=ns=>{ns.sort(byName);ns.forEach(n=>sort(n.children));return ns;};return sort(roots);};
  if(groupBy==='type')return [['furniture','Furniture',['furniture']],['openings','Doors and windows',['opening']],['objects','Objects',['item','artifact','device']],
    ['structure','Walls and ceilings',['structure']],['places','Places',['place']]].map(([id,name,kinds])=>({zone:{id:'type:'+id,name},nodes:forest(ents.filter(e=>kinds.includes(e.kind)))})).filter(g=>g.nodes.length);
  const places=ents.filter(e=>e.kind==='place').sort((a,b)=>a.name.localeCompare(b.name)),things=ents.filter(e=>e.kind!=='place'&&e.kind!=='structure');
  const groups=places.map(p=>({zone:{id:p.id,name:p.name,entity:p.id},nodes:forest(things.filter(e=>e.place===p.id))}));
  const loose=things.filter(e=>!places.some(p=>p.id===e.place));if(loose.length)groups.push({zone:{id:null,name:'No place'},nodes:forest(loose)});
  return groups;
}
const outlineView=here[0]?createOutline({root:$('layout-outline'),scene:here[0],
  onSelect:(id,locked)=>{if(!locked)pickEntity(id);else{layout.select(null);if(selected)select(null);outlineView.setSelected(id);}},
  detailFor:id=>twinPanel?.detailFor(id)||null,
  onHidden:()=>applyOutline(),onLocked:()=>applyOutline(),onFrame:id=>{const k=entityId(id);if(k)frameItem(k);},
  swapOf:id=>id.startsWith('layout:')?(layout.hasModel(id.slice(7))?'model':'box'):null,onModel:(id,file)=>furnitureToModel(id.slice(7),file).catch(fail),onBox:id=>furnitureToBox(id.slice(7)).catch(fail),onError:e=>{$('take-status').textContent=e.message;},
  onDelete:id=>{if(id.startsWith('comp:')){const inst=components.get(id.slice(5));if(!inst||!confirm(`Delete ${inst.spec.name} from this scene?`))return;
      components.remove(inst.spec.id);if(selected===inst.spec.id)select(null);showComponents();update();saveComposition();return;}
    const b=id.startsWith('layout:')&&layout.boxes.find(x=>x.id===id.slice(7));if(b){layout.select(b);layout.remove();}},
  onRename:(id,name)=>{if(id.startsWith('comp:')){components.set(id.slice(5),{name});showComponents();saveComposition();return;}
    const b=id.startsWith('layout:')&&layout.boxes.find(x=>x.id===id.slice(7));if(!b){twinPanel?.rename(id,name);return;}const parts=String(b.label||'').split('/').map(x=>x.trim()).filter(Boolean);parts.splice(-1,1,name);layout.select(b);layout.update({label:parts.join('/')});}
}):null;
function applyOutline(){if(!outlineView)return;const hidden=[...outlineView.hiddenBoxes()],locked=[...outlineView.lockedBoxes()];
  const lay=ids=>ids.filter(i=>i.startsWith('layout:')).map(i=>i.slice(7)),comp=ids=>ids.filter(i=>i.startsWith('comp:')).map(i=>i.slice(5));
  layout.setHidden(lay(hidden));layout.setLocked(lay(locked));
  outlineHidden.clear();comp(hidden).forEach(i=>outlineHidden.add(i));outlineLocked.clear();comp(locked).forEach(i=>outlineLocked.add(i));
  if(selected&&outlineLocked.has(selected))select(null);update();twin.render();}
function showOutline(){if(!outlineView)return;outlineView.setTree(entityGroups());applyOutline();}
for(const b of document.querySelectorAll('.outline-group [data-group]')){b.setAttribute('aria-pressed',b.dataset.group===groupBy);
  b.onclick=()=>{groupBy=b.dataset.group;try{localStorage.setItem('spatial-take:layout-group',groupBy);}catch{}for(const x of document.querySelectorAll('.outline-group [data-group]'))x.setAttribute('aria-pressed',x===b);showOutline();};}
function editLayout(on){layout.setEnabled(on);$('box-handles').hidden=!on;outlineView?.setEditing(on);$('layout-edit').setAttribute('aria-pressed',on);$('layout-tools').hidden=!on;
  // Edit mode edits the layout and the persistent objects; editing objects (the Objects section) the others.
  if(on&&objectsEditing)editObjects(false);
  const inst=components.get(selected);if(inst&&(groupOf(inst)==='persistent')!==on)select(null);if(on){$('show-boxes').checked=true;twin.setDebug({semantic:true});}update();}
$('layout-edit').onclick=()=>editLayout(!layout.enabled);
// Box handles under the 3D view while editing the layout: the move/rotate gizmo or the face handles. Remembered in this browser.
function setBoxHandles(mode){layout.setHandleMode(mode);keep('box-handles',layout.handleMode);for(const b of document.querySelectorAll('[data-handles]'))b.setAttribute('aria-pressed',b.dataset.handles===layout.handleMode);update();}
for(const b of document.querySelectorAll('[data-handles]'))b.onclick=()=>setBoxHandles(b.dataset.handles);setBoxHandles(pref('box-handles','gizmo'));
// Layout layers in the 3D view (src/layout-structure.mjs): boxes, zones, walls, ceilings. Remembered in this browser.
const structure=createStructure({group:twin.helper,twin});const LAYERS=['boxes','zones','walls','ceilings'];
try{const v=JSON.parse(localStorage.getItem('spatial-take:layout-layers')||'null');if(v)for(const k of LAYERS)if(k in v)$('show-'+k).checked=!!v[k];}catch{}
function showLayers(){const v=Object.fromEntries(LAYERS.map(k=>[k,$('show-'+k).checked]));twin.setDebug({semantic:v.boxes});structure.setVisible(v);try{localStorage.setItem('spatial-take:layout-layers',JSON.stringify(v));}catch{}}
for(const k of LAYERS)$('show-'+k).onchange=showLayers;showLayers();
// Align panel (src/align-panel.mjs): pick what the open recording shows, then align it to those parts of the scan. While it is open the
// 3D view shows surfaces and boxes; the layer switches come back as they were when it closes.
// Walls hide the layout's boxes, labels and selection marks when the 3D view is inside a room (src/twin.mjs setWallPass); from outside
// (orbit overview, plan) everything shows, as the scan's near walls drop away.
twin.setWallPass({occluders:structure.occluders,material:structure.occluderMaterial,objects:()=>[twin.semantic,selectionMarks.group],
  active:cam=>cam.isPerspectiveCamera&&!!labelRoom(layoutRooms,cam.position)});
const ALIGN_LAYERS=['boxes','zones','walls','ceilings'];let layersBeforeAlign=null;
const alignPanel=createAlignPanel({root:$('align-panel'),canvas:$('twin'),getCamera:()=>twin.camera,structure,layout,
  onOpen(){layersBeforeAlign=Object.fromEntries(ALIGN_LAYERS.map(k=>[k,$('show-'+k).checked]));for(const k of ALIGN_LAYERS)$('show-'+k).checked=true;showLayers();},
  onClose(){if(layersBeforeAlign)for(const [k,v] of Object.entries(layersBeforeAlign))$('show-'+k).checked=v;layersBeforeAlign=null;showLayers();},
  onFineTune:()=>startFineTune(),
  async onAlign(target){const r=await api('/api/register',{space:here[0],take:here[1],target});
    // The recording's frames move with the new alignment: reload to see it.
    setTimeout(()=>location.reload(),1200);return `Aligned: ${Math.round((r.explained??r.fitness)*100)}% of the picked parts explained, ${(r.rmse*100).toFixed(1)} cm, camera ${r.cameraHeight?.join('–')??'?'} m above the floor. Reloading…`;}});
function openAlign(){const parents=new Map();for(const b of layout.boxes){const m=/^(.*)\/[^/]+$/.exec(b.label);if(m)parents.set(b.id,m[1]);}
  const boxes=layout.boxes.filter(b=>!parents.has(b.id)).map(b=>({id:b.id,label:b.label,zone:layoutRooms.find(r=>r.id===b.room)?.name||'No zone'}));
  alignPanel.show({title:here[1],surfaces:structure.surfaces,boxes,target:session.alignTarget});}
// Info (scripts/info_context.py) attached to a thing: the selected piece of furniture or door/window, the selected persistent object, or
// the zone picked in the Zone list (it wins while picked). Attach puts a key on it (by default its own name; several things can share a
// key: the list suggests the ones in use); the key's value is text (saved half a second after typing stops) or a file of the space's
// info lib (one can be added here).
let info={entries:{},lib:[]},infoMode='text',infoTimer=null,infoShown=null;
const infoKey=b=>b?.info||null;   // a layout box's key
const cleanKey=v=>String(v||'').replaceAll('/',' ').trim().slice(0,48)||null;
async function setZoneInfo(z,k){try{const r=await api('/api/layout/zone',{space:here[0],zone:z.id,info:k});z.info=r.info||undefined;layoutRevision=Math.max(layoutRevision,r.boxesRevision??layoutRevision);}catch(e){$('info-status').textContent=e.message;}showInfo();update();}
function infoOwner(){
  const zid=$('zone-info').value,z=zid&&layoutRooms.find(r=>r.id===zid);
  if(z)return {kind:'zone',name:z.name||z.id,key:z.info||null,set:k=>setZoneInfo(z,k)};
  const b=layout.selected;if(b)return {kind:'layout',name:labelPath(b.label).at(-1)||b.id,key:infoKey(b),set:k=>{layout.update({info:k||undefined});showInfo();}};
  const inst=components.get(selected);if(inst&&groupOf(inst)==='persistent')return {kind:'comp',name:inst.spec.name,key:inst.spec.info||null,set:k=>{setSelected({info:k||undefined});showInfo();}};
  // A scene object (the Scene objects library): its info is the library object's, shared by every recording placing it.
  const m=libraryObject(inst);if(m)return {kind:'lib',name:m.name,key:m.info||null,set:async k=>{try{await api('/api/objects/update',{space:here[0],id:m.id,info:k});m.info=k||undefined;}catch(e){$('info-status').textContent=e.message;}showInfo();}};
  return null;
}
// Everything carrying info: [{id (layout:, comp:, zone:), key}].
function infoCarriers(){return [...layout.boxes.filter(infoKey).map(b=>({id:'layout:'+b.id,key:b.info})),
  ...components.instances.filter(i=>groupOf(i)==='persistent'&&i.spec.info).map(i=>({id:'comp:'+i.spec.id,key:i.spec.info})),
  ...components.instances.filter(i=>libraryObject(i)?.info).map(i=>({id:'comp:'+i.spec.id,key:libraryObject(i).info})),...layoutRooms.filter(r=>r.info).map(r=>({id:'zone:'+r.id,key:r.info}))];}
const currentKey=()=>infoOwner()?.key||null;
async function loadInfo(){if(!here[0])return;try{info=await api(`/api/info?space=${encodeURIComponent(here[0])}`);}catch(e){console.warn('info',e);}showInfo();}
async function saveInfo(key,value){try{info=await api('/api/info',{space:here[0],key,value});$('info-status').textContent='Saved';}catch(e){$('info-status').textContent=e.message;}}
function showInfo(){
  const zs=$('zone-info'),zv=zs.value;zs.replaceChildren(new Option('Choose a zone for its info…',''),...layoutRooms.map(r=>new Option((r.name||r.id)+(r.info?` · ${r.info}`:''),r.id)));zs.value=layoutRooms.some(r=>r.id===zv)?zv:'';
  const owner=infoOwner();
  // The panel sits with what it edits: under the Scene objects list for a scene object, in the layout tools otherwise.
  // The panel sits in the selected entity's Knowledge (Space tab), else with what it edits (a scene object's library entry).
  const slot=document.querySelector('#layout-outline [data-slot="knowledge"]'),panel=$('box-info');
  const home=slot||(owner?.kind==='lib'?$('objects-wrap'):$('layout-tools'));if(panel.parentElement!==home)slot||owner?.kind==='lib'?home.append(panel):home.insertBefore(panel,$('box-destination-row'));
  panel.hidden=!owner;if(!owner){infoShown=null;return;}
  const key=owner.key;$('info-owner').textContent=owner.name;$('info-attach').checked=!!key;$('info-key-row').hidden=$('info-value-row').hidden=!key;
  $('info-keys').replaceChildren(...[...new Set([...Object.keys(info.entries),...infoCarriers().map(c=>c.key)])].map(k=>new Option(k)));
  if(document.activeElement!==$('info-key-input'))$('info-key-input').value=key||'';
  $('info-text').hidden=$('info-file-row').hidden=true;if(!key){$('info-status').textContent='';infoShown=null;return;}
  const v=info.entries[key],shared=infoCarriers().filter(c=>c.key===key).length;
  if(key!==infoShown){infoShown=key;infoMode=v?.file?'file':'text';}   // another key: shown as what its value is
  $('info-key').textContent=shared>1?`Shared by ${shared}`:'';
  $('info-mode-text').setAttribute('aria-pressed',infoMode==='text');$('info-mode-file').setAttribute('aria-pressed',infoMode==='file');
  $('info-text').hidden=infoMode!=='text';$('info-file-row').hidden=infoMode!=='file';
  if(document.activeElement!==$('info-text'))$('info-text').value=v?.text||'';
  const sel=$('info-file');sel.replaceChildren(new Option('Choose a file…',''),...info.lib.map(f=>new Option(f,f)),new Option('Add a file to the lib…','+'));sel.value=v?.file||'';
  $('info-status').textContent=v?.file&&!info.lib.includes(v.file)?`${v.file} is not in the lib`:v?'':'No value yet';}
$('zone-info').onchange=()=>showInfo();
$('info-attach').onchange=()=>{const o=infoOwner();if(o)o.set($('info-attach').checked?cleanKey(o.name):null);};
$('info-key-input').onchange=()=>{const o=infoOwner(),k=cleanKey($('info-key-input').value);if(o&&k&&k!==o.key)o.set(k);else showInfo();};
$('info-mode-text').onclick=()=>{infoMode='text';showInfo();};
$('info-mode-file').onclick=()=>{infoMode='file';showInfo();loadInfo();};   // files copied into the lib by hand show up
$('info-text').oninput=()=>{const key=currentKey(),text=$('info-text').value;clearTimeout(infoTimer);$('info-status').textContent='';
  infoTimer=setTimeout(()=>saveInfo(key,{text}),500);};
$('info-text').onblur=()=>showInfo();
$('info-file').onchange=()=>{const v=$('info-file').value,key=currentKey();if(v==='+'){$('info-upload').click();showInfo();return;}if(v)saveInfo(key,{file:v}).then(()=>showInfo());};
$('info-upload').onchange=async()=>{const f=$('info-upload').files[0],key=currentKey();$('info-upload').value='';if(!f||!key)return;
  try{const src=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(f);});
    info=await api('/api/info/lib',{space:here[0],name:f.name,src});await saveInfo(key,{file:f.name});}catch(e){$('info-status').textContent=e.message;}showInfo();};
$('box-destination').oninput=()=>layout.update({destination:$('box-destination').value});
$('box-label').oninput=()=>layout.update({label:$('box-label').value});
$('box-label').onchange=()=>layout.renumber();   // typed name committed: repeats get numbers
$('box-yaw').oninput=()=>{const v=parseFloat($('box-yaw').value);if(Number.isFinite(v))layout.update({yaw:v});};
$('box-add').onclick=()=>layout.add();
// A box's type: furniture or a door or window.
$('box-type').onchange=()=>{const b=layout.selected,kind=$('box-type').value;if(!b||b.kind===kind)return;layout.update({kind});layout.renumber();showOutline();};$('box-duplicate').onclick=()=>layout.duplicate();$('box-delete').onclick=()=>layout.remove();
$('box-arrange').onclick=()=>layout.arrangeChildren();$('layout-undo').onclick=()=>layout.undo();$('layout-redo').onclick=()=>layout.redo();
$('scan').onchange=async()=>{const space=$('space').value;$('scan').disabled=true;
  try{await api('/api/scan/primary',{space,scan:$('scan').value});if(here[0]===space)location.reload();else await loadSpaces();}catch(e){$('take-status').textContent=e.message;await loadSpaces();}};
// New space: a name field under the picker (the picker stays); Enter creates, Escape or leaving the field closes it.
$('space-new').onclick=()=>{$('space-create').hidden=false;$('space-name').value='';$('space-name').focus();};
$('space-name').onkeydown=e=>{if(e.key==='Escape')$('space-create').hidden=true;};
$('space-name').onblur=()=>setTimeout(()=>{if(document.activeElement?.closest('#space-create'))return;$('space-create').hidden=true;},150);
$('space-create').onsubmit=async e=>{e.preventDefault();try{const r=await api('/api/spaces',{name:$('space-name').value});$('space-create').hidden=true;await loadSpaces();$('space').value=r.name;showSpace();}catch(err){$('take-status').textContent=err.message;}};
loadSpaces();
// The ModOS agent (scripts/agent-bridge.mjs runs the pipeline); only when served by scripts/server.py.
// Questions and answers belong to a session of this scene (agent conversations, scripts/agent_store.py); each starts with an empty timeline.
// Side panel, one tab at a time: Scene (scan, layout, objects, recordings), Agent (setup, session, replay), Input (info selection,
// hands: what a request starts from), Twin, MODs (tailoring), UI library (what can be adjusted in the shared text forms and cues).
// The Space tab's two panes: Scene (its scan and recordings) and Entities (the twin's entities and the objects placed in this recording).
const paneStore={get:k=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch{}}};
let spacePane=paneStore.get('spatialTake.spacePane')==='entities'?'entities':'scene';
function showSpacePane(p){spacePane=p;paneStore.set('spatialTake.spacePane',p);for(const b of document.querySelectorAll('button[data-space-pane]'))b.setAttribute('aria-pressed',b.dataset.spacePane===p);
  for(const x of document.querySelectorAll('div.space-pane'))x.hidden=x.dataset.spacePane!==p;}
for(const b of document.querySelectorAll('button[data-space-pane]'))b.onclick=()=>showSpacePane(b.dataset.spacePane);
showSpacePane(spacePane);
// A "?" (class help, data-tip): its explanation in the tooltip while hovered or focused; pressing it does nothing else (inside a label it
// must not toggle the switch).
{const tip=()=>$('tooltip'),show=e=>{const h=e.target.closest?.('.help');if(!h)return;const t=tip(),r=h.getBoundingClientRect();t.textContent=h.dataset.tip;t.hidden=false;
    const w=Math.min(280,innerWidth-16);t.style.maxWidth=w+'px';t.style.left=Math.max(8,Math.min(r.left,innerWidth-w-8))+'px';t.style.top=(r.bottom+6)+'px';},
  hide=e=>{if(e.target.closest?.('.help'))tip().hidden=true;};
  document.addEventListener('mouseover',show);document.addEventListener('focusin',show);document.addEventListener('mouseout',hide);document.addEventListener('focusout',hide);
  document.addEventListener('click',e=>{if(e.target.closest?.('.help'))e.preventDefault();},true);}
const agentTab=document.querySelector('[data-tab=agent]');
function showTab(tab){if(tab==='behavior')tab='library';if(tab==='twin')tab='scene';if(!['scene','agent','input','mods','library','vision'].includes(tab))tab='scene';if((tab==='agent'&&agentTab.disabled)||(['mods'].includes(tab)&&document.querySelector(`[data-tab=${tab}]`).disabled))tab='scene';if(tab==='vision'&&!visionMode())tab='scene';for(const b of document.querySelectorAll('[data-tab]'))b.setAttribute('aria-pressed',b.dataset.tab===tab);
  for(const t of ['scene','agent','input','mods','library','vision'])$('tab-'+t).hidden=tab!==t;store.set('spatialTake.sideTab',tab);}
// Vision Pro mode (?vision=1, /vision.html): the 3D view with the scan and boxes alone (the recorded camera hidden), and the headset's
// settings in a tab of their own (src/vision-panel.mjs).
const vision=visionMode()&&here[0]?createVisionPanel({space:here[0],$,onTune:()=>startHeadsetTune()}):null;
if(vision){document.body.classList.add('vision');document.querySelector('[data-tab=vision]').hidden=false;vision.start();}
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>showTab(b.dataset.tab);
const convKey='spatialTake.conversation:'+sessionURL.pathname,store={get:k=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k,v)=>{try{localStorage.setItem(k,v);}catch{}}};
// UI library › Text: lettering, writing, placement and Text Arrow (src/agent.mjs setTextBehavior), remembered in this browser; a change letters and places the answers again.
let textBehavior={...TEXT_BEHAVIOR};try{textBehavior={...TEXT_BEHAVIOR,...JSON.parse(store.get('spatialTake.textBehavior')||'{}')};}catch{}
let textRelayout=null;
function showTextBehavior(){$('text-body-size').value=textBehavior.bodySize;$('text-body-size-value').textContent=`${(+textBehavior.bodySize).toFixed(2)}×`;
  $('text-show-heading').checked=textBehavior.showHeading;$('text-heading-size').value=textBehavior.headingSize;$('text-heading-size-value').textContent=`${(+textBehavior.headingSize).toFixed(2)}×`;
  $('text-heading-row').classList.toggle('off',!textBehavior.showHeading);$('text-heading-size').disabled=!textBehavior.showHeading;
  $('text-writing').checked=textBehavior.writing;$('text-writing-strokes').checked=textBehavior.writingStrokes;$('text-writing-speed').value=textBehavior.writingSpeed;
  $('text-writing-speed-value').textContent=`${Math.round(textBehavior.writingSpeed)} chars/s`;
  for(const id of ['text-strokes-row','text-speed-row'])$(id).classList.toggle('off',!textBehavior.writing);$('text-writing-strokes').disabled=$('text-writing-speed').disabled=!textBehavior.writing;}
function changeTextBehavior(fields){textBehavior={...textBehavior,...fields};store.set('spatialTake.textBehavior',JSON.stringify(textBehavior));setTextBehavior(textBehavior);showTextBehavior();
  clearTimeout(textRelayout);textRelayout=setTimeout(()=>{agent?.relayout();update();},150);}
setTextBehavior(textBehavior);showTextBehavior();
$('text-body-size').oninput=()=>changeTextBehavior({bodySize:+$('text-body-size').value});
$('text-heading-size').oninput=()=>changeTextBehavior({headingSize:+$('text-heading-size').value});
$('text-show-heading').onchange=()=>changeTextBehavior({showHeading:$('text-show-heading').checked});
// Writing changes no layout: applied from the next frame on.
function changeWriting(fields){textBehavior={...textBehavior,...fields};store.set('spatialTake.textBehavior',JSON.stringify(textBehavior));setTextBehavior(textBehavior);showTextBehavior();update();}
$('text-writing').onchange=()=>changeWriting({writing:$('text-writing').checked});
$('text-writing-strokes').onchange=()=>changeWriting({writingStrokes:$('text-writing-strokes').checked});
$('text-writing-speed').oninput=()=>changeWriting({writingSpeed:+$('text-writing-speed').value});
$('text-reset').onclick=()=>changeTextBehavior({...TEXT_BEHAVIOR});
const agentApi=async(path,body)=>{const u=new URL(path,location.href);u.searchParams.set('session',sessionURL.pathname);const r=await fetch(u,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:sessionURL.pathname,...body})}:{});const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;};
const userState=()=>({conversation:agent?.conversation,frame:index,t:session.frames[index].t,position:session.frames[index].position,quaternion:session.frames[index].quaternion});
async function showConversations(select){
  const list=await agentApi('/api/agent/conversations');$('conv').innerHTML='';
  for(const c of list.slice().reverse())$('conv').add(new Option(`${c.name}${c.questions?` · ${c.questions}`:''}`,c.id));
  const id=list.some(c=>c.id===select)?select:list.at(-1)?.id;$('conv').value=id;return id;
}
async function openConversation(id){if(agent.conversation!==id){pause();replayFrom=null;}store.set(convKey,id);$('conv').value=id;await agent.setConversation(id);agent.report(userState());update();}
async function startAgent(){
  let command;try{const setup=await agentApi('/api/agent/command');command=setup.command;$('agent-command').textContent=command;$('agent-config-path').textContent=setup.config_path;$('editor-restart-command').textContent=setup.restart_command;$('gemini-setup-command').textContent=setup.gemini_setup_command||'';$('gemini-setup-copy').onclick=()=>navigator.clipboard.writeText(setup.gemini_setup_command||'');}catch{return;}
  agent=createAgentLayer({scene,getStyleRevision:()=>weatherScene.playback.state.entry?.id,getSettings:forResponse,frames:session.frames,sessionPath:sessionURL.pathname,intrinsics:session.intrinsics,frameCamera,viewport:answerView,
    visible:(i,pts,options)=>visibleIn(i,pts,{...options,text:true}),getStaticSurfaces:()=>textSurfaces,relationAt,entityBox,sceneBoxes,infoTarget,onPlacement:logPlacement,getSurfaceQuality:placementQuality,frameImage:async i=>(await texture(i)).image,
    onChange:()=>update(),onAnimate:()=>update(),onStatus:showAgentStatus});
  if(here[0]){
    twinPanel=createTwinPanel({addRoot:$('space-add'),space:here[0],session:sessionURL.pathname,onLoad:showOutline,onDetail:showEntityDetail});twinPanel.load();
    const mt=document.querySelector('[data-tab=mods]');mt.disabled=false;mt.title='';createModsPanel({root:$('tab-mods'),space:here[0]}).load();}
  $('agent-panel').hidden=false;$('ask').hidden=false;agentTab.disabled=false;agentTab.title='';showTab(store.get('spatialTake.sideTab')||'scene');
  let id=await showConversations(store.get(convKey));if(!id)id=await showConversations((await agentApi('/api/agent/conversations',{})).id);
  await openConversation(id);agent.start();loadPipelineSkeleton();
  $('agent-copy').onclick=async()=>{await navigator.clipboard.writeText(command);const label=$('agent-copy').querySelector('span');label.textContent='Copied';setTimeout(()=>label.textContent='Copy command',1500);};
  $('conv').onchange=()=>openConversation($('conv').value).catch(fail);
  $('conv-new').onclick=async()=>{try{await openConversation(await showConversations((await agentApi('/api/agent/conversations',{})).id));}catch(e){fail(e);}};
  $('conv-delete').onclick=async()=>{
    const id=agent.conversation;if(!id)return;$('conv-delete').disabled=true;
    try{const result=await agentApi('/api/agent/conversations/delete',{conversation:id});
      pause();replayFrom=null;agent.setHold(null);$('tooltip').hidden=true;
      $('conv-name').hidden=true;$('conv').hidden=false;
      await openConversation(await showConversations(result.conversation));
    }catch(e){fail(e);}finally{$('conv-delete').disabled=false;}
  };
  $('conv-export').onclick=async()=>{try{const c=await agentApi('/api/agent/conversations/export?conversation='+encodeURIComponent(agent.conversation));
    const u=URL.createObjectURL(new Blob([JSON.stringify(c,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download=`${sessionURL.pathname.split('/').at(-2)}-${c.name.replace(/[^\w\- ]+/g,'_')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}catch(e){fail(e);}};
  $('conv-import').onchange=async e=>{try{const data=JSON.parse(await e.target.files[0].text());e.target.value='';await openConversation(await showConversations((await agentApi('/api/agent/conversations/import',{data})).id));}catch(err){fail(err);}};
  // Rename in place: the session picker turns into a text field; Enter saves, Escape cancels.
  const endRename=async save=>{const name=$('conv-name').value.trim();$('conv-name').hidden=true;$('conv').hidden=false;
    if(save&&name){try{await agentApi('/api/agent/conversations/rename',{conversation:agent.conversation,name});await showConversations(agent.conversation);}catch(e){fail(e);}}};
  $('conv-rename').onclick=()=>{$('conv-name').value=$('conv').selectedOptions[0]?.text.replace(/ · \d+$/,'')||'';$('conv').hidden=true;$('conv-name').hidden=false;$('conv-name').focus();$('conv-name').select();};
  $('conv-name').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();endRename(true);}else if(e.key==='Escape')endRename(false);};
  $('conv-name').onblur=()=>{if(!$('conv-name').hidden)endRename(true);};
}
// Status line under the question box, and one marker per question on the timeline: click to go back and replay the answer,
// × (on hover) to delete the question and its answer.
let markersKey='';
function showAgentStatus({connected:c,questions,responses}){
  connected=c;$('ask-input').disabled=!c;$('ask-send').disabled=!c;
  $('ask-input').placeholder=c?'Ask the assistant at this moment…':'Copy the agent command (Agent panel) and run it in a terminal to connect';
  const q=questions.at(-1);
  if(!hold)setAskStatus(q?.status==='queued'?'Waiting for the agent…':q?.status==='running'&&q.parts?.text?.status==='streaming'?'Writing answer…':'');showTrace();
  const key=JSON.stringify(questions.map(q=>[q.id,q.status,q.t])),duration=session.frames.at(-1).t||1;if(key===markersKey)return;markersKey=key;
  const byQuestion=new Map();for(const r of responses)if(r.part!=='ui'||!byQuestion.has(r.question_id))byQuestion.set(r.question_id,r);$('markers').innerHTML='';
  for(const q of questions){
    const m=document.createElement('button'),r=byQuestion.get(q.id);m.className='marker';m.type='button';m.dataset.status=q.status;m.style.left=`${q.t/duration*100}%`;
    m.setAttribute('aria-label',`Question at ${q.t.toFixed(2)} s: ${q.text}`);
    m.onmouseenter=e=>{const tip=$('tooltip'),b=m.getBoundingClientRect();tip.textContent=`${q.text}${r?` → ${r.title}`:q.status==='failed'?' (no response)':' …'} · ${q.t.toFixed(2)} s`;tip.hidden=false;tip.style.left=b.left+'px';tip.style.top=b.bottom+8+'px';};
    m.onmouseleave=()=>$('tooltip').hidden=true;
    // Replay lands where the answer appeared (after the agent's latency for live questions).
    m.onclick=()=>replayQuestion(q);
    const del=document.createElement('span');del.className='del';del.setAttribute('role','button');
    del.innerHTML='<svg viewBox="0 0 10 10"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5"/></svg>';
    del.onclick=e=>{e.stopPropagation();$('tooltip').hidden=true;agent.deleteQuestion(q.id).catch(fail);};
    m.append(del);$('markers').append(m);
  }
}
// The agent's work on the focused question (live while it answers, stored for replay): faint text under the question box, or (Pipeline)
// the ModOS stages lit as the system reaches them. ?present=1 shows only the recorded camera and the pipeline (for recording demos).
// The handle between the recorded camera and the 3D scene: drag (or arrow keys) to set how the width is split; remembered.
{const views=$('views'),handle=$('views-splitter'),KEY='spatial-take:views-split';
  const set=f=>{f=Math.min(.8,Math.max(.2,f));views.style.setProperty('--split-l',`${f}fr`);views.style.setProperty('--split-r',`${1-f}fr`);handle.setAttribute('aria-valuenow',String(Math.round(f*100)));dispatchEvent(new Event('resize'));return f;};
  let split=.5;try{split=+localStorage.getItem(KEY)||.5;}catch{}set(split);
  const save=()=>{try{localStorage.setItem(KEY,String(split));}catch{}};
  handle.addEventListener('pointerdown',e=>{handle.setPointerCapture(e.pointerId);handle.classList.add('dragging');e.preventDefault();});
  handle.addEventListener('pointermove',e=>{if(!handle.hasPointerCapture(e.pointerId))return;const r=views.getBoundingClientRect();split=set((e.clientX-r.left)/r.width);});
  const end=e=>{if(handle.hasPointerCapture?.(e.pointerId))handle.releasePointerCapture(e.pointerId);handle.classList.remove('dragging');save();};
  handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
  handle.addEventListener('keydown',e=>{const d=e.key==='ArrowLeft'?-.02:e.key==='ArrowRight'?.02:0;if(!d)return;e.preventDefault();split=set(split+d);save();});
  handle.addEventListener('dblclick',()=>{split=set(.5);save();});}
let traceKey='';let traceMode=params.get('present')?'pipeline':(()=>{try{return localStorage.getItem('spatial-take:trace-mode')||'pipeline';}catch{return 'pipeline';}})();
if(params.get('present'))document.body.classList.add('present');
if(params.get('pipeline')==='bottom')document.body.classList.add('pipeline-bottom');   // the Pipeline view's layout (src/pipeline-view.css)
for(const b of document.querySelectorAll('[data-trace]')){b.setAttribute('aria-pressed',b.dataset.trace===traceMode);
  b.onclick=()=>{traceMode=b.dataset.trace;try{localStorage.setItem('spatial-take:trace-mode',traceMode);}catch{}for(const x of document.querySelectorAll('[data-trace]'))x.setAttribute('aria-pressed',x===b);traceKey='';showTrace();};}
// The where-overlay sits in the camera view's top-right corner, whatever the layout around the view.
function placeWhere(){const w=$('where');if(w.hidden)return;const c=cameraCol.getBoundingClientRect(),r=$('stage').getBoundingClientRect();
  w.style.top=`${r.top-c.top+12}px`;w.style.left='auto';w.style.right=`${c.right-r.right+12}px`;}
addEventListener('resize',()=>placeWhere());
// What the pipeline view lists before any question: the space's MODs and memory (the options the stages choose among).
let pipelineSkeleton=null;
async function loadPipelineSkeleton(){try{const m=await agentApi('/api/modos/context');pipelineSkeleton={mods:m.mods,items:m.items};traceKey='';showTrace();}catch{}}
function showTrace(){
  // Only once the video has reached the question (or it is being asked / replayed now): before that the view shows the options only.
  const focused=agent&&session?agent.focus():null,q=focused&&(hold?.id===focused.id||session.frames[index].t>=focused.t-.002)?focused:null;
  const clock=hold||agent?.delivery;
  const replaying=!!hold&&!hold.live,steps=q?stepsAt(q,clock?.id===q.id?clock.h:Infinity):[];
  const tail=!q?'':replaying?(hold.h<0?'Typing question…':hold.h<(q.latency||0)?`Processing… ${Math.floor(hold.h)} s`:''):q.status==='running'?`thinking… ${Math.max(0,Math.round(Date.now()/1000-q.started))} s`:q.status==='failed'?`no response: ${q.message||''}`:q.duration!=null?`${q.duration.toFixed(1)} s`:'';
  // The pipeline view (the log's other mode): its question types as the caption does during a replay.
  const typed=q&&replaying?questionCaption(q,{clock:hold}).text:q?.text;
  const key=JSON.stringify([q?.id,steps.length,q?.status,tail,typed,traceMode,!!pipelineSkeleton]);if(key===traceKey)return;traceKey=key;
  $('trace').hidden=traceMode!=='log';$('pipeline').hidden=traceMode!=='pipeline';
  if(traceMode==='pipeline')renderPipeline($('pipeline'),q,steps,{skeleton:pipelineSkeleton,slowed:AGENT_SPEED<1?AGENT_SPEED:null});
  const where=q?whereAt(steps):null,w=$('where');w.hidden=!where||!(where.in||where.looking);
  placeWhere();
  if(where)w.innerHTML=[where.in?`<span>In</span><b>${where.in.replace(/[<&]/g,'')}</b>`:'',where.looking?`<span>Looking at</span><b>${where.looking.replace(/[<&]/g,'')}</b>`:''].join('');placeWhere();
  $('trace').replaceChildren(...(q?[...steps.map(s=>{const line=document.createElement('div');line.className='trace-'+s.kind;
    line.textContent=s.kind==='reasoning'?`∴ ${s.text}`:s.kind==='tool'?`· ${s.tool}${s.text?'  '+s.text:''}`:s.kind==='error'?`✗ ${s.tool?s.tool+': ':''}${s.text}`:`→ ${s.text}`;return line;}),
    Object.assign(document.createElement('div'),{className:'trace-tail',textContent:tail})]:[]));
}
setInterval(()=>{if(agent?.questions.some(q=>q.status==='running'))showTrace();},1000);
// Asking holds the video on this frame until the agent has answered and READ_S seconds of reading have passed; a playing video then
// continues; asked here (live), playback goes on once the answer shows, even if the video was paused when asking.
const READ_S=READING.read_s;let askStatus='';
function setAskStatus(text){if(text!==askStatus){askStatus=text;$('ask-status').textContent=text;}}
$('ask').onsubmit=async e=>{e.preventDefault();const text=$('ask-input').value.trim();if(!text||!agent||!connected)return;
  const wasPlaying=playing;
  try{const sel=computeSelection()?.selected||null;
    const q=await agent.ask(index,session.frames[index].t,text,{read_s:READ_S},{selection:sel,selection_mode:selectionMode});$('ask-input').value='';startHold(q,{resume:wasPlaying,live:true});
  }catch(err){$('ask-status').textContent='Error: '+err.message;}};
function fail(e){$('status').textContent='Error: '+e.message;console.error(e);}
async function sessionLoadError(status){
  if(status!==404)return Error(`Could not load recording (HTTP ${status}). Try reloading the page.`);
  await loadSpaces();
  const sp=spaceData.spaces.find(s=>s.name===here[0]);
  const recordings=sp?sp.scenarios:spaceData.spaces.flatMap(s=>s.scenarios);
  const message=`Recording “${here[1]||sessionURL.pathname}” is no longer available at this address. ${recordings.length?'Open an available recording below or choose one under Recordings.':'Choose a scene and add a recording under Recordings.'}`;
  const recovery=$('session-recovery');recovery.replaceChildren();
  for(const sc of recordings){
    const link=document.createElement('a'),url=new URL(location.href);url.searchParams.set('session',sc.session);url.searchParams.delete('placement');
    link.href=url.href;link.className='btn';link.textContent=`Open ${sc.label}`;recovery.append(link);
  }
  recovery.hidden=!recordings.length;
  return Error(message);
}
try{const res=await fetch(sessionURL);if(!res.ok)throw await sessionLoadError(res.status);session=await res.json();if(session.version!==1||!session.frames.length)throw Error('Unsupported/empty session');renderer.setSize(session.intrinsics.width,session.intrinsics.height,false);$('timeline').max=session.frames.at(-1).t;
// The scenario's frames move into the space's coordinates (toSpace, row-major 4x4, from scripts/register_scenario.py). The room is the
// space scan (complete, maybe stale) plus this recording's own mesh (current, with holes); both occlude and both can be shown.
let space=null;try{const r=await fetch(spaceURL);if(r.ok)space=await r.json();}catch{}
toSpace=session.toSpace?new THREE.Matrix4().set(...session.toSpace):null;
for(const f of session.frames)f.raw={position:[...f.position],quaternion:[...f.quaternion]};   // the recording's own poses (fine-tuning re-applies toSpace)
if(toSpace)for(const f of session.frames){const p=new THREE.Vector3(),q=new THREE.Quaternion(),sc=new THREE.Vector3();
  new THREE.Matrix4().compose(new THREE.Vector3(...f.position),new THREE.Quaternion(...f.quaternion),new THREE.Vector3(1,1,1)).premultiply(toSpace).decompose(p,q,sc);f.position=p.toArray();f.quaternion=q.toArray();}
twin.setSession(session);
roomParts=new THREE.Group();roomParts.userData.parts={};
if(space?.scan?.mesh&&toSpace){const g=(await loader.loadAsync(new URL(space.scan.mesh,spaceURL).href)).scene;g.name='space-scan';roomParts.add(g);roomParts.userData.parts.space=g;}
else if(space?.scan?.mesh){alignScan=(await loader.loadAsync(new URL(space.scan.mesh,spaceURL).href)).scene;twin.setAlignScan(alignScan);}
if(session.roomMesh){const g=(await loader.loadAsync(new URL(session.roomMesh,sessionURL).href)).scene;if(toSpace){g.applyMatrix4(toSpace);g.updateMatrixWorld(true);}g.name='recording-mesh';roomParts.add(g);roomParts.userData.parts.recording=g;}
if(roomParts.children.length)setRoom(roomParts,null,null);buildLidarMesh();
// 3D view: the scan by default, the recording's own mesh when there is no scan.
const hasPart=k=>!!roomParts.userData.parts[k];$('debug-spaceScan').disabled=!hasPart('space');$('debug-recordingMesh').disabled=!hasPart('recording');
$('debug-recordingMesh').checked=!hasPart('space');twin.setDebug({spaceScan:true,recordingMesh:!hasPart('space')});
// Layout boxes (scan/semantic.json), shown and edited in the 3D view.
if(space?.scan?.semantic&&toSpace){try{layoutURL=new URL(space.scan.semantic,spaceURL);const sem=await(await fetch(layoutURL)).json();vision?.setLayout(sem);layoutRevision=sem.boxesRevision??sem.revision??0;layoutRooms=sem.rooms||[];layoutSem=sem;twin.setFloorRooms(layoutRooms);layout.setData(sem);loadInfo();structure.setData(sem);weatherScene.setLayout(sem);setTextLayout(sem);loadFurnitureModels(sem);layoutLoaded=true;showOutline();showSpace();}catch(e){console.warn('layout',e);}}
try{const floor=JSON.parse(localStorage.getItem('spatial-take:floors:'+spaceURL.pathname)||'null');if(floor)showCut(twin.restoreFloor(floor));showFloor();}catch{}
if(!(session.depth&&session.frames.every(f=>f.depth)))$('depth-occlude').checked=false;
else{$('depth-occlude').disabled=false;}
await setFrame(0);
// Components: the scenario's saved composition, else the calibration cube (in front of the camera; at the demo's usual spot without a scene).
// The scene's own components (digital twins of its objects: spaces/<scene>/composition.json) and this recording's.
await components.loadLibrary(here[0]);
const fetchJSON=async u=>{try{const r=await fetch(u);return r.ok?await r.json():null;}catch{return null;}};
const sceneSaved=here[0]?await fetchJSON(new URL('../../composition.json',sessionURL)):null,saved=here[0]?await fetchJSON(new URL('composition.json',sessionURL)):null;
sceneRevision=sceneSaved?.revision||0;compositionRevision=saved?.revision||0;
const sceneSpecs=(sceneSaved?.components||[]).map(c=>({...c,scope:'scene'})),takeSpecs=(saved?.components||[]).map(c=>({...c,scope:'recording'}));
if(saved||sceneSpecs.length)await setComposition([...sceneSpecs,...takeSpecs],null);
// The calibration cube (a reference for checking placement, occlusion and shadows) only where there is no scene to check against: the demo.
if(!saved&&!params.has('placement')&&!toSpace){await addComponent({component:'calibration-cube',position:[0,0,-2.5]});}
if(params.has('placement')){const u=new URL(params.get('placement'),location.href);if(u.origin!==location.origin)throw Error('Placement URL must use this server');const response=await fetch(u);if(!response.ok)throw Error('Placement not found');await loadPlacement(await response.json());}
weatherSurfacePreview=await createWeatherSurfacePreview(scene,weatherScene.playback,()=>update());weatherSurfacePreview.attach($('stage'),()=>camera);weatherSurfacePreview.attach($('twin'),()=>twin.camera);
await startAgent();new ResizeObserver(()=>update()).observe($('stage'));if(vision)showCut(twin.setView({mode:'orbit'}));   // Vision Pro mode: the whole space, to edit its boxes
window.replay={ready:true,agent,get textSurfaces(){return textSurfaces;},get surfaceOffsets(){return surfaceOffsets;},relationAt,get handData(){return currentHandData;},handPerception,recordingHands,handCompositor,spatialHands,entityBox,weatherScene,weatherSurfacePreview,layout,editLayout,components,addComponent,loadGLB:glb,select,setSelected,editObjects,get selected(){return selected;},get anchor(){return anchor;},fineTune:{start:startFineTune,end:endFineTune,get state(){return fine;}},setFrame,at,placement,applyPlacement,loadPlacement,depthMap,surfaceAt,visibleIn,session,renderer,camera,twin};}catch(e){fail(e);window.replay={ready:false,error:e.message};}
