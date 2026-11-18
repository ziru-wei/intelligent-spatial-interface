// The Vocabulary (the main page's, ../../index.html): every part of the spatial UI library shown live, in 3D, in an example room with
// example data. Nothing here is drawn for the Vocabulary: each part is the library's own (src/spatial-ui/cues.mjs, the answer text of
// src/agent.mjs, the bubble of src/spatial-ui/dialogue.mjs, the view stack of src/cluster-placement.mjs, Weather's ambient effect of
// src/weather-scene.mjs), so a change there shows here at once. The room is plain geometry: a lab (a desk with a lamp and a mug, a
// printer, a TV, a poster, a plant) and a kitchen through a door.
//   createVocabulary().tile(element, id)   draws part `id` into an element's box (one WebGL canvas behind the page draws every tile);
//                                          dragged, it turns its view round the part in place
//   openVocabulary(element, id)            a larger view to walk around (drag) and use the part (press, drag), as in ModOS
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import * as cues from './spatial-ui/cues.mjs';
import {bubbleOutline} from './spatial-ui/dialogue.mjs';
import {answerTexture} from './agent.mjs';
import {viewAnchor,STACK} from './cluster-placement.mjs';
import {along} from './floor-route.mjs';
import {createWeatherScene} from './weather-scene.mjs';

// ——— the example room ———
const LAB={x0:-2.5,x1:2.5,z0:-2,z1:3},KITCHEN={x0:-6,x1:-2.5,z0:-2,z1:3},WALL_H=2.6,DOOR={z0:-1.2,z1:-.2,h:2.1};
/** The things the parts are about: {center, size, yaw} as the twin gives them. */
const THINGS={
  desk:{center:[0,.37,-1.5],size:[1.6,.74,.7],yaw:0},
  lamp:{center:[-.55,.97,-1.55],size:[.2,.46,.2],yaw:0},
  mug:{center:[.18,.79,-1.4],size:[.09,.1,.09],yaw:0},
  printer:{center:[1.8,.75,-1.4],size:[.5,.3,.45],yaw:0},
  tv:{center:[0,1.62,-1.96],size:[1.2,.68,.06],yaw:0},
  poster:{center:[-1.55,1.5,-1.985],size:[.6,.84,.02],yaw:0},
  plant:{center:[2,.42,.5],size:[.42,.84,.42],yaw:0},
  door:{center:[-2.5,DOOR.h/2,(DOOR.z0+DOOR.z1)/2],size:[.1,DOOR.h,DOOR.z1-DOOR.z0],yaw:0},
};
const ROOMS={lab:{ring:[[LAB.x0,LAB.z0],[LAB.x1,LAB.z0],[LAB.x1,LAB.z1],[LAB.x0,LAB.z1]],floorY:0},
  kitchen:{ring:[[KITCHEN.x0,KITCHEN.z0],[KITCHEN.x1,KITCHEN.z0],[KITCHEN.x1,KITCHEN.z1],[KITCHEN.x0,KITCHEN.z1]],floorY:0}};
const INPUT_COLOR={'HDMI 1':0x23476b,'HDMI 2':0x2d5a3c,'HDMI 3':0x5b3a5e,'AV':0x6b4a23,'USB':0x3a3a3a,'Antenna':0x2b4f57};

function exampleRoom(){
  const g=new THREE.Group(),mat=(color,o={})=>new THREE.MeshStandardMaterial({color,roughness:.85,metalness:0,...o});
  const box=(size,at,m)=>{const b=new THREE.Mesh(new THREE.BoxGeometry(...size),m);b.position.set(...at);g.add(b);return b;};
  const floor=(r,color)=>{const f=new THREE.Mesh(new THREE.PlaneGeometry(r.x1-r.x0,r.z1-r.z0),mat(color));f.rotation.x=-Math.PI/2;f.position.set((r.x0+r.x1)/2,0,(r.z0+r.z1)/2);g.add(f);};
  floor(LAB,0x5c5f65);floor(KITCHEN,0x6d675f);
  const wall=mat(0x74777d),t=.08;
  box([LAB.x1-KITCHEN.x0,WALL_H,t],[(KITCHEN.x0+LAB.x1)/2,WALL_H/2,LAB.z0-t/2],wall);   // back
  box([t,WALL_H,LAB.z1-LAB.z0],[LAB.x1+t/2,WALL_H/2,(LAB.z0+LAB.z1)/2],wall);   // right
  box([t,WALL_H,KITCHEN.z1-KITCHEN.z0],[KITCHEN.x0-t/2,WALL_H/2,(KITCHEN.z0+KITCHEN.z1)/2],wall);   // the kitchen's far wall
  // the wall between, with its door
  box([t,WALL_H,DOOR.z0-LAB.z0],[LAB.x0,WALL_H/2,(LAB.z0+DOOR.z0)/2],wall);box([t,WALL_H,LAB.z1-DOOR.z1],[LAB.x0,WALL_H/2,(DOOR.z1+LAB.z1)/2],wall);
  box([t,WALL_H-DOOR.h,DOOR.z1-DOOR.z0],[LAB.x0,(WALL_H+DOOR.h)/2,(DOOR.z0+DOOR.z1)/2],wall);
  // the kitchen: a counter and a fridge
  box([2.4,.9,.6],[-4.6,.45,-1.7],mat(0xd9d6d0));box([.7,1.8,.7],[-5.55,.9,.2],mat(0xe4e6e8));
  // the lab
  const wood=mat(0xb39a7a),dark=mat(0x2e3035,{roughness:.6}),D=THINGS.desk;
  box([D.size[0],.04,D.size[2]],[D.center[0],D.size[1]-.02,D.center[2]],wood);
  for(const x of [-1,1])for(const z of [-1,1])box([.04,D.size[1]-.04,.04],[D.center[0]+x*(D.size[0]/2-.05),(D.size[1]-.04)/2,D.center[2]+z*(D.size[2]/2-.05)],dark);
  const L=THINGS.lamp,lampLight=new THREE.PointLight(0xffd9a0,0,4,1.6),shadeMat=mat(0xe8e2d6,{emissive:0xffd9a0,emissiveIntensity:0});
  const lamp=new THREE.Group(),base=new THREE.Mesh(new THREE.CylinderGeometry(.08,.09,.02,24),dark),pole=new THREE.Mesh(new THREE.CylinderGeometry(.008,.008,.34,8),dark),shade=new THREE.Mesh(new THREE.ConeGeometry(.1,.14,24,1,true),shadeMat);
  base.position.y=.01;pole.position.y=.18;shade.position.y=.38;shade.material.side=THREE.DoubleSide;lampLight.position.y=.33;lamp.add(base,pole,shade,lampLight);lamp.position.set(L.center[0],D.size[1],L.center[2]);g.add(lamp);
  const M=THINGS.mug,mug=new THREE.Mesh(new THREE.CylinderGeometry(.04,.036,.1,20),mat(0xc75b4a));mug.position.set(...M.center);g.add(mug);
  const P=THINGS.printer;box([.7,.6,.6],[P.center[0],.3,P.center[2]],mat(0x8e9096));box(P.size,P.center,mat(0xe9eaec,{roughness:.5}));
  box([.36,.01,.2],[P.center[0],P.center[1]+P.size[1]/2+.005,P.center[2]+.05],mat(0xffffff));
  const T=THINGS.tv;box(T.size,T.center,dark);const screen=box([T.size[0]-.04,T.size[1]-.04,.005],[T.center[0],T.center[1],T.center[2]+T.size[2]/2+.003],mat(0x23476b,{emissive:0x23476b,emissiveIntensity:.6}));
  const PO=THINGS.poster,posterCanvas=document.createElement('canvas');posterCanvas.width=300;posterCanvas.height=420;{const x=posterCanvas.getContext('2d');
    x.fillStyle='#e8e3d8';x.fillRect(0,0,300,420);x.fillStyle='#3d5a80';x.fillRect(20,20,260,190);x.fillStyle='#ee6c4d';x.beginPath();x.arc(210,90,40,0,7);x.fill();
    x.fillStyle='#293241';x.font='700 34px system-ui';x.fillText('Open House',24,260);x.font='400 22px system-ui';x.fillText('Lab · Nov 21 · 3 PM',24,296);x.fillText('Demos and snacks',24,328);}
  const posterTex=new THREE.CanvasTexture(posterCanvas);posterTex.colorSpace=THREE.SRGBColorSpace;
  const poster=new THREE.Mesh(new THREE.PlaneGeometry(PO.size[0],PO.size[1]),new THREE.MeshStandardMaterial({map:posterTex,roughness:.9}));poster.position.set(PO.center[0],PO.center[1],PO.center[2]+.012);g.add(poster);
  const PL=THINGS.plant,pot=new THREE.Mesh(new THREE.CylinderGeometry(.16,.12,.3,20),mat(0xb5653d));pot.position.set(PL.center[0],.15,PL.center[2]);
  const leaves=new THREE.Mesh(new THREE.IcosahedronGeometry(.24,1),mat(0x4f7a4a,{flatShading:true}));leaves.position.set(PL.center[0],.58,PL.center[2]);g.add(pot,leaves);
  return {group:g,lamp:{shade,light:lampLight},screen,posterCanvas};
}
const lights=s=>{s.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));const l=new THREE.DirectionalLight(0xffffff,1.6);l.position.set(.4,1,1.2);s.add(l);return s;};

// ——— example data ———
const DAYS=['2026-11-19','2026-11-20','2026-11-21','2026-11-22'],TIMES=['8 AM','10 AM','12 PM','2 PM','4 PM','6 PM'];
const ANSWER={title:'Rain on Saturday',body:'Showers from 10 AM to 4 PM, 11 °C. Take an umbrella.'};
const FORECAST=[{id:'sat-10',date:'2026-11-21',time:'10:00',label:'Sat 10 AM',condition:'rain',summary:'Rain showers',temp_c:11,night:false,intensity:.75,wind_kph:12}];

// The thing a part is about, its distance-dependent size (as in ModOS: cues and labels read alike at any distance) and helpers.
const scaleFor=(eye,box)=>Math.min(2.4,Math.max(1,eye.distanceTo(new THREE.Vector3(...box.center))/1.1));
function scaled(eye,box,make,grow=false){const k=scaleFor(eye,box);cues.setScale(k);try{const p=make();if(grow)p.group.scale.setScalar(k);return p;}finally{cues.setScale(1);}}
/** A plane of answer text (as ModOS draws it), `width` metres wide; userData.ink: the ink's box in the plane's metres. */
function answerPlane(r,width,opts){
  const map=answerTexture(r,opts),W=map.image.width,H=map.image.height,h=width*H/W,b=map.image.box||{x0:0,x1:W,y0:0,y1:H};
  const m=new THREE.Mesh(new THREE.PlaneGeometry(width,h),new THREE.MeshBasicMaterial({map,transparent:true,depthWrite:false,toneMapped:false}));m.renderOrder=3;
  m.userData.ink={x0:(b.x0/W-.5)*width,x1:(b.x1/W-.5)*width,y0:(.5-b.y1/H)*h,y1:(.5-b.y0/H)*h};return m;
}
const still=group=>({group,update(){}});
// a part on the view stack (camera-fixed, centred, above what stands below it); `natural`: its height in its own metres
const onView=(part,natural)=>Object.assign(part,{view:{natural}});

// ——— the parts: where the user stands, what they look at, and what is built (from state, which the user's presses change) ———
// eye, look: the viewpoint (the question's frame); build(ctx) → parts; frame(ctx, now): what moves on its own.
const lab=(eye,look)=>({eye,look});
const TILES={
  breathingBox:{...lab([.75,1.35,-.35],'mug'),build:()=>[cues.breathingBox(THINGS.mug)]},
  cornerBrackets:{...lab([-.8,1.45,.4],'poster'),build:()=>[cues.cornerBrackets(THINGS.poster)]},
  footprintRing:{...lab([-.1,1.4,-.3],'lamp'),build:()=>[cues.footprintRing(THINGS.lamp)]},
  floorArea:{eye:[2.2,3.2,3.6],look:[-.6,0,0],build:()=>[cues.floorArea(ROOMS.kitchen)]},
  doorwayGlow:{...lab([.9,1.6,1.9],'door'),build:({eye})=>[cues.doorwayGlow(THINGS.door,'Kitchen',eye)]},
  arrowAhead:{eye:[.3,1.55,1.6],look:[-2.5,1.2,.2],build:({camera})=>[cues.arrowAhead(THINGS.printer,camera,{name:'printer'})]},
  floorPath:{eye:[1.3,1.65,2.6],look:[-2.2,.2,-.2],build:()=>[cues.floorPath(along([[.9,2.1,0],[-1.6,-.7,0],[-2.5,-.7,0],[-4.4,-.6,0]],{spacing:.4,skip:.5}))]},
  textArrow:{...lab([-.3,1.5,.7],'poster'),build:()=>{
    const P=THINGS.poster,text=answerPlane({title:'Open House',body:'Friday 3 PM, here in the lab.'},.75);text.position.set(-.55,1.55,-1.9);const ink=text.userData.ink;
    return [still(text),cues.textArrow([-.55+ink.x0-.02,1.55+(ink.y0+ink.y1)/2,-1.9],[P.center[0]+P.size[0]/2+.03,P.center[1],P.center[2]+.02])];}},
  haloDial:{...lab([-.15,1.5,-.45],'lamp'),build:({eye,state})=>[scaled(eye,THINGS.lamp,()=>cues.haloDial(THINGS.lamp,eye,{value:state.brightness,name:'brightness',unit:'%'}),true)]},
  progressRail:{...lab([1.45,1.45,-.05],'printer'),build:({eye})=>[scaled(eye,THINGS.printer,()=>cues.progressRail(THINGS.printer,eye,{title:'CHI poster',owner:'Ana',done:7,total:12,unit:'pages'}),true)]},
  pinnedTags:{...lab([1.4,1.4,-.1],'printer'),build:({eye})=>[scaled(eye,THINGS.printer,()=>cues.pinnedTags(THINGS.printer,eye,{tags:[['paper','60 sheets'],['toner','35 %']]}))]},
  statusPulse:{...lab([1.45,1.4,-.1],'printer'),build:()=>[cues.statusPulse(THINGS.printer,{level:'attention',message:'Paper low'})]},
  cardStack:{...lab([1.5,1.45,-.1],'printer'),build:({eye})=>[scaled(eye,THINGS.printer,()=>cues.cardStack(THINGS.printer,eye,{items:['Lab meeting slides · 3 pages','Consent forms · 8 pages']}),true)]},
  edgeBar:{...lab([-.2,1.4,-.4],'lamp'),build:({eye,state,set})=>[scaled(eye,THINGS.lamp,()=>cues.edgeBar(THINGS.lamp,eye,{value:state.brightness,name:'brightness',unit:'%',onSet:v=>set({brightness:Math.round(v)})}))]},
  // Choice: the TV's inputs, more than a row holds, so a dropdown (a few short ones would stand in a row)
  choice:{...lab([0,1.5,.3],'tv'),build:({eye,state,set})=>[scaled(eye,THINGS.tv,()=>cues.choice(THINGS.tv,eye,{options:Object.keys(INPUT_COLOR),value:state.input,open:state.open,onToggle:v=>set({open:v}),onPick:o=>set({input:o,open:false})}),true)]},
  // AR Photo: the photo about to be sent, beside the poster it is of
  arPhoto:{...lab([-1.1,1.5,-.55],'poster'),build:()=>{const c=document.createElement('canvas');c.width=300;c.height=420;const x=c.getContext('2d');
    x.fillStyle='#e9e4d8';x.fillRect(0,0,300,420);x.fillStyle='#c0392b';x.fillRect(0,0,300,120);x.fillStyle='#fff';x.font='700 40px Helvetica';x.fillText('Open House',24,78);
    x.fillStyle='#333';x.font='400 24px Helvetica';x.fillText('Friday 3 PM',24,170);x.fillText('in the lab',24,206);
    const p=cues.arPhoto(c,{width:.16,label:'photo of the poster'});p.group.position.set(-1.0+.1,1.5,-1.9);return [p];}},
  iconButton:{...lab([-.15,1.45,-.4],'lamp'),build:({eye,state,set})=>[scaled(eye,THINGS.lamp,()=>cues.iconButton(THINGS.lamp,eye,{icon:'⏻',text:state.on?'Turn off':'Turn on',on:true,onPress:()=>set({on:!state.on})}),true)]},
  textButton:{...lab([1.45,1.45,-.1],'printer'),build:({eye,state,set})=>[scaled(eye,THINGS.printer,()=>cues.iconButton(THINGS.printer,eye,{icon:null,text:'Clean print head',on:!state.pressed,onPress:()=>{set({pressed:true});setTimeout(()=>set({pressed:false}),350);}}),true)]},
  datePicker:{...lab([.2,1.55,1.4],'tv'),build:({state})=>{const p=cues.datePicker({center:[0,0,0],size:[0,0,0],yaw:0},new THREE.Vector3(0,0,1),{dates:DAYS,value:state.date,y:0});return [onView(p,.12)];}},
  playback:{...lab([.2,1.55,1.4],'tv'),build:({state})=>{const p=cues.playback({center:[0,0,0],size:[0,0,0],yaw:0},new THREE.Vector3(0,0,1),{stops:TIMES,index:state.index,playing:state.playing,y:0});return [onView(p,.09)];},
    frame:({state,set},now)=>{if(state.playing&&now-(state.stepAt??=now)>1300){state.stepAt=now;set({index:(state.index+1)%TIMES.length});}}},
  textInput:{...lab([-1.1,1.5,-.55],'poster'),build:({state,set})=>{const t=cues.textInput({title:'To Alice',body:'Could you print the open house poster on A2 for Friday?',width:.36,editing:state.editing,onEdit:()=>set({editing:!state.editing})});
    t.group.position.set(-1.0+.18,1.5,-1.9);return [t];}},
  embeddedText:{...lab([1,1.55,.9],[1.4,1.5,-2]),build:()=>{const t=answerPlane(ANSWER,1.1);t.position.set(1.45,1.5,-1.95);return [still(t)];}},
  floatingText:{eye:[.4,1.55,1.8],look:[0,1.2,-2],build:()=>{const t=answerPlane(ANSWER,.42,{fit:true});const g=new THREE.Group(),ink=t.userData.ink;t.position.set(-(ink.x0+ink.x1)/2,-ink.y0,0);g.add(t);return [onView(still(g),ink.y1-ink.y0)];}},
  dialogue:{eye:[1.2,1.35,2.2],look:[2,1.05,.5],build:({eye})=>{
    const PL=THINGS.plant,t=answerPlane({dialogue:true,body:'My soil is dry. Some water by Friday, please.'},.5),ink=t.userData.ink,pad=.03,g=new THREE.Group();
    const box={x0:ink.x0-pad,x1:ink.x1+pad,y0:ink.y0-pad,y1:ink.y1+pad},tip={x:(box.x0+box.x1)/2-.1,y:box.y0-.14};
    const fill=new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(bubbleOutline(box,.04,tip,.035))),new THREE.MeshBasicMaterial({color:0x14171c,transparent:true,opacity:.86,depthWrite:false,toneMapped:false}));
    fill.position.z=-.002;fill.renderOrder=2;g.add(fill,t);g.position.set(PL.center[0]+.05,PL.center[1]+PL.size[1]/2+.14-box.y0,PL.center[2]);g.lookAt(eye.x,g.position.y,eye.z);return [still(g)];}},
  ambientEffect:{eye:[.3,1.3,2.4],look:[0,2.5,-1],weather:true,build:()=>[]},
  asset:{eye:[.95,1.3,-.55],look:[.25,.9,-1.55],build:({tile})=>{const g=new THREE.Group();g.position.set(.25,.74,-1.55);tile.loadAsset(g);return [still(g)];}},
};
export const VOCABULARY=Object.keys(TILES);

const at=v=>Array.isArray(v)?new THREE.Vector3(...v):new THREE.Vector3(...THINGS[v].center);
let assetGLTF=null;const loadAssetModel=()=>assetGLTF??=new GLTFLoader().loadAsync(new URL('../assets/dioramas/labResearchWork.glb',import.meta.url).href);

/** One part's scene: the room, the part on it, its camera, and what can be pressed. */
function createTile(id,onChange=()=>{}){
  const def=TILES[id];if(!def)throw Error(`No part ${id} in the Vocabulary.`);
  const world=lights(new THREE.Scene()),overlay=new THREE.Scene();world.background=new THREE.Color(0x3b3d42);
  const room=exampleRoom();world.add(room.group);
  const camera=new THREE.PerspectiveCamera(50,4/3,.05,60);camera.position.copy(at(def.eye));const look=at(def.look);camera.lookAt(look);camera.updateMatrixWorld(true);
  const state={brightness:60,on:true,input:'HDMI 1',date:DAYS[2],index:1,playing:true,to:'Alice Chen',editing:false};
  let parts=[],hits=[],mixer=null,weather=null;
  const tile={id,camera,look,world,overlay,state,
    loadAsset(holder){loadAssetModel().then(gltf=>{const obj=gltf.scene.clone(true),b=new THREE.Box3().setFromObject(obj),size=b.getSize(new THREE.Vector3());
      const k=.55/Math.max(size.x,size.z);obj.scale.setScalar(k);obj.position.set(-(b.min.x+b.max.x)/2*k,-b.min.y*k,-(b.min.z+b.max.z)/2*k);holder.add(obj);
      if(gltf.animations.length){mixer=new THREE.AnimationMixer(obj);for(const a of gltf.animations)mixer.clipAction(a).play();}onChange();}).catch(()=>{});}};
  const set=change=>{Object.assign(state,change);build();onChange();};
  function build(){
    overlay.clear();lights(overlay);hits=[];
    parts=def.build({eye:camera.position.clone(),camera,state,set,tile});
    for(const p of parts){overlay.add(p.group);p.group.traverse(o=>{if(o.userData.onHit||o.userData.onDrag||o.userData.action)hits.push(o);});}
  }
  build();
  if(def.weather){weather=createWeatherScene({scene:world,getCamera:()=>camera,getRoom:()=>room.group,onAnimate:onChange});
    const c=[[LAB.x0,WALL_H,LAB.z0],[LAB.x1,WALL_H,LAB.z0],[LAB.x1,WALL_H,LAB.z1],[LAB.x0,WALL_H,LAB.z1]];
    weather.setLayout({ceilings:[{id:'lab-ceiling',outline:c,room:'lab'}],rooms:[{id:'lab',polygon:[[ROOMS.lab.ring]],floorY:0}]});weather.setEnabled(true);
    weather.setResponse({id:'vocabulary',weather:{forecast:FORECAST,timeline:FORECAST,preview:{component:'weather-single'}}});}
  const clock=new THREE.Clock();
  tile.frame=now=>{
    def.frame?.({state,set},now);
    room.lamp.shade.material.emissiveIntensity=state.on?.2+1.4*state.brightness/100:0;room.lamp.light.intensity=state.on?3*state.brightness/100:0;
    room.screen.material.color.setHex(INPUT_COLOR[state.input]||0x23476b);room.screen.material.emissive.setHex(INPUT_COLOR[state.input]||0x23476b);
    mixer?.update(Math.min(.1,clock.getDelta()));
    // the view stack: camera-fixed parts stand centred, from the bottom of the view up
    let bottom=null;for(const p of parts)if(p.view){const a=viewAnchor(camera,(bottom??STACK.base)+STACK.gap),k=STACK.distance;
      p.group.quaternion.copy(a.quaternion);p.group.scale.setScalar(k);p.group.position.copy(a.point).addScaledVector(a.up,p.view.natural*k/2);bottom=a.top(p.view.natural*k);}
    for(const p of parts)p.update(now,camera);
  };
  tile.render=(renderer)=>{
    renderer.render(world,camera);
    if(weather){weather.refresh();weather.render(renderer,camera);}
    const auto=renderer.autoClear;renderer.autoClear=false;try{renderer.clearDepth();renderer.render(overlay,camera);}finally{renderer.autoClear=auto;}
  };
  tile.hit=ray=>{overlay.updateMatrixWorld(true);return ray.intersectObjects(hits,false)[0]||null;};
  tile.act=(h,point)=>{const u=h.object.userData,a=u.action;
    if(u.onHit)return u.onHit(point);
    if(a?.kind==='date')set({date:a.value});else if(a?.kind==='play'||a?.kind==='pause')set({playing:!state.playing});
    else if(a?.kind==='scrub'){let g=h.object;while(g&&!g.userData.rail)g=g.parent;if(!g)return;const r=g.userData.rail,x=g.worldToLocal(point.clone()).x,t=Math.max(0,Math.min(1,(x-r.x0)/(r.x1-r.x0)));
      set({index:Math.round(t*(TIMES.length-1)),stepAt:performance.now()+1500});}};
  tile.dispose=()=>{weather?.dispose();for(const s of [world,overlay])s.traverse(o=>{o.geometry?.dispose();o.material?.map?.dispose?.();o.material?.dispose?.();});};
  return tile;
}

// A tile turns where it is: dragged, its view goes round the part (about what it looks at, never under the floor); a drag is not a click,
// so the tile opens only when pressed without moving.
function orbitOnDrag(el,t){
  const sph=new THREE.Spherical();let start=null,moved=false;
  el.style.touchAction='pan-y';el.style.cursor='grab';
  el.addEventListener('pointerdown',e=>{if(e.button)return;sph.setFromVector3(t.camera.position.clone().sub(t.look));start={x:e.clientX,y:e.clientY,theta:sph.theta,phi:sph.phi};moved=false;el.setPointerCapture(e.pointerId);});
  el.addEventListener('pointermove',e=>{if(!start||!el.hasPointerCapture(e.pointerId))return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(!moved&&Math.hypot(dx,dy)<4)return;
    moved=true;el.style.cursor='grabbing';sph.theta=start.theta-dx*.008;sph.phi=THREE.MathUtils.clamp(start.phi-dy*.008,.25,Math.PI/2-.05);
    t.camera.position.copy(t.look).add(new THREE.Vector3().setFromSpherical(sph));t.camera.lookAt(t.look);t.camera.updateMatrixWorld(true);});
  const end=e=>{if(el.hasPointerCapture?.(e.pointerId))el.releasePointerCapture(e.pointerId);start=null;el.style.cursor='grab';};
  el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
  el.addEventListener('click',e=>{if(moved){moved=false;e.preventDefault();e.stopImmediatePropagation();}},true);
}

/** Every tile of the page, drawn by one WebGL canvas fixed behind the page (browsers allow only a few WebGL contexts). */
export function createVocabulary(){
  const canvas=document.createElement('canvas');canvas.className='vocabulary-canvas';
  Object.assign(canvas.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh',pointerEvents:'none',zIndex:'-1'});document.body.prepend(canvas);
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});renderer.setPixelRatio(Math.min(1.5,devicePixelRatio));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setScissorTest(true);
  const tiles=new Map();let raf=0;
  function draw(){
    raf=requestAnimationFrame(draw);const W=innerWidth,H=innerHeight;if(canvas.width!==Math.floor(W*renderer.getPixelRatio())||canvas.height!==Math.floor(H*renderer.getPixelRatio()))renderer.setSize(W,H,false);
    renderer.setScissor(0,0,W,H);renderer.setClearColor(0x000000,0);renderer.clear();const now=performance.now();
    for(const [el,t] of tiles){if(!el.isConnected){tiles.delete(el);t.dispose();continue;}const r=el.getBoundingClientRect();
      // only what its scroller shows (a row scrolls sideways)
      let x0=Math.max(0,r.left),x1=Math.min(W,r.right),y0=Math.max(0,r.top),y1=Math.min(H,r.bottom);
      for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){const o=getComputedStyle(p).overflowX;if(o==='auto'||o==='scroll'||o==='hidden'){const c=p.getBoundingClientRect();x0=Math.max(x0,c.left);x1=Math.min(x1,c.right);}}
      if(x1<=x0||y1<=y0||!r.width)continue;
      t.camera.aspect=r.width/r.height;t.camera.updateProjectionMatrix();t.frame(now);
      renderer.setViewport(r.left,H-r.bottom,r.width,r.height);renderer.setScissor(x0,H-y1,x1-x0,y1-y0);t.render(renderer);}
    if(!tiles.size){cancelAnimationFrame(raf);raf=0;}
  }
  return {
    tile(el,id){const t=createTile(id);tiles.set(el,t);orbitOnDrag(el,t);if(!raf)raf=requestAnimationFrame(draw);},
    clear(){for(const t of tiles.values())t.dispose();tiles.clear();},
    dispose(){cancelAnimationFrame(raf);raf=0;this.clear();renderer.dispose();canvas.remove();},
  };
}

/** A part in a larger view of its own: drag to walk around it, press and drag its controls as in ModOS. Returns a close function. */
export function openVocabulary(container,id){
  const canvas=document.createElement('canvas');canvas.style.cssText='width:100%;height:100%;display:block;touch-action:none';container.appendChild(canvas);
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(2,devicePixelRatio));renderer.outputColorSpace=THREE.SRGBColorSpace;
  const tile=createTile(id),camera=tile.camera,ray=new THREE.Raycaster();
  const ndc=e=>{const r=canvas.getBoundingClientRect();return new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);};
  // the part's controls take the pointer first (registered before the orbit, so it never sees their presses)
  let drag=null;
  canvas.addEventListener('pointerdown',e=>{ray.setFromCamera(ndc(e),camera);const h=tile.hit(ray);if(!h)return;e.stopImmediatePropagation();e.preventDefault();
    const u=h.object.userData;if(u.onDrag||u.action?.kind==='scrub'){drag={u,h,plane:new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(),h.point)};canvas.setPointerCapture(e.pointerId);if(u.onDrag)u.onDrag(h.point);else tile.act(h,h.point);}
    else tile.act(h,h.point);});
  canvas.addEventListener('pointermove',e=>{if(!drag){ray.setFromCamera(ndc(e),camera);canvas.style.cursor=tile.hit(ray)?'pointer':'grab';return;}
    ray.setFromCamera(ndc(e),camera);const p=ray.ray.intersectPlane(drag.plane,new THREE.Vector3());if(!p)return;if(drag.u.onDrag)drag.u.onDrag(p);else tile.act(drag.h,p);});
  const release=()=>{if(!drag)return;drag.u.onRelease?.();drag=null;};canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  const orbit=new OrbitControls(camera,canvas);orbit.target.copy(tile.look);orbit.enableDamping=true;orbit.minDistance=.3;orbit.maxDistance=7;orbit.update();
  let raf=0;const draw=()=>{raf=requestAnimationFrame(draw);const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
    if(canvas.width!==Math.floor(w*renderer.getPixelRatio()))renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();orbit.update();tile.frame(performance.now());tile.render(renderer);};
  draw();
  return ()=>{cancelAnimationFrame(raf);orbit.dispose();tile.dispose();renderer.dispose();canvas.remove();};
}
