// Draws the spatial cues a MOD declared (modos-system-design.md 4.4) for a part that points at things or places: FindMy's found
// container, ObjectStatus's things, Wayfinding's room, IoTControl's device. The part carries the MOD's `ui` and the facts known when it
// was composed (modos/compose.mjs); this adds what only the view knows — whether the target is in view, which room the user is in — and
// decides with the same rules (modos/ui-rules.mjs). Decisions are re-checked a few times a second and the cues rebuilt only when what is
// drawn changes, so nothing flickers while the user looks around.
import * as THREE from 'three';
import * as cues from './spatial-ui/cues.mjs';
import {label} from './spatial-ui/kit.mjs';
import {highlightOf} from './highlight.mjs';
import {partsToDraw} from '../modos/ui-rules.mjs';
import {currentMeta,modsRevision} from './current-mods.mjs';
import {createRouter,along} from './floor-route.mjs';

const LEVEL={neutral:'ok',attention:'attention',warning:'warning'};
const ringOf=r=>{const p=r?.polygon?.[0];return Array.isArray(p?.[0]?.[0])?p[0]:p;};
function inside([x,z],ring){let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,zi]=ring[i],[xj,zj]=ring[j];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;}return c;}

/** Without a declaration (older answers): the box, and the arrow when the target is out of view and the answer asked for guidance. */
function fallbackUi(h){
  return {mark:{use:'highlight',ui:{fixed:['breathingBox']}},...(h.guidance?{direction:{use:'guidance',ui:{flexible:[{cue:'arrowAhead',when:'target.out_of_view'}]}}}:{}),
    ...(h.label?{sign:{use:'label',ui:{fixed:['text:sign']}}}:{})};
}

export function createCueHost({getRooms=()=>[],getLayout=()=>null}={}){
  // the walking route for Floor Path, over the twin's rooms, doors and walls (rebuilt when the layout changes)
  let router=null,routerFor=null;const routerOf=()=>{const l=getLayout(),k=l?l.boxesRevision??l.revision??l:null;if(k!==routerFor){routerFor=k;router=l?createRouter(l.rooms||getRooms(),l.openings||[],l.walls||[]):null;}return router;};
  const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));{const l=new THREE.DirectionalLight(0xffffff,1.6);l.position.set(.4,1,1.2);scene.add(l);}
  let key=null,h=null,ui=null,facts={},drawn=[],drawnKey='',checked=0,inView=true,sign=null;
  const roomAt=p=>getRooms().find(r=>{const ring=ringOf(r),f=r.floorY??0;return ring&&p.y>=f-.3&&p.y<f+3.5&&inside([p.x,p.z],ring);})||null;
  const roomById=id=>getRooms().find(r=>'zone:'+r.id===id||r.id===id)||null;

  // the floor path from where the user stands to the target: its dots ([x, z, floor y, yaw]), kept while the user stays within half a metre
  let pathKey=null,pathDots=null;
  function pathOf(eye,t0){const k=`${Math.round(eye.x*2)},${Math.round(eye.z*2)}:${t0.center.join()}`;if(k!==pathKey){pathKey=k;
    const route=routerOf()?.route([eye.x,eye.z],[t0.center[0],t0.center[2]]);pathDots=route?along(route,{spacing:.45,skip:.6,max:14}):null;}return pathDots;}
  // guidance is seen or it does not guide: whether any of the path is in view (else Arrow Ahead leads to where it goes: path.in_view)
  const dotInView=(p,camera)=>{const v=new THREE.Vector3(p[0],p[2]??0,p[1]).project(camera);return v.z<1&&Math.abs(v.x)<1&&Math.abs(v.y)<1;};
  function viewFacts(camera){
    const t=h.targets[0],c=new THREE.Vector3(...t.center),v=c.clone().project(camera),m=inView?1.02:.85;   // hysteresis at the edge
    inView=v.z<1&&Math.abs(v.x)<m&&Math.abs(v.y)<m;
    const here=roomAt(camera.position),zone=t.of||(roomAt(c)?'zone:'+roomAt(c).id:null),hereId=here?'zone:'+here.id:null;
    return {...facts,'target.out_of_view':!inView,'target.has_content':!!t.has_content,'state.level':LEVEL[t.tone]||'ok',
      'target.other_room':!!(zone&&hereId&&zone!==hereId),'user.in_target':!!(t.of&&hereId===t.of),'target.door_in_view':!!(t.of&&inView),
      'path.in_view':!!pathOf(camera.position,t)?.some(p=>dotInView(p,camera))};
  }
  function build(camera,list){
    scene.clear();scene.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));drawn=[];sign=null;
    const eye=camera.position.clone(),t0=h.targets[0],add=c=>{if(c){scene.add(c.group);drawn.push(c);}};
    for(const name of list){
      if(['breathingBox','cornerBrackets','footprintRing'].includes(name)){for(const t of h.targets)add(cues[name](t));for(const p of h.faint||[])add(cues.breathingBox(p,{strength:.35}));}
      else if(name==='statusPulse')for(const t of h.targets)add(cues.statusPulse(t,{level:LEVEL[t.tone]==='ok'?'ok':LEVEL[t.tone],message:t.state||''}));   // the state from the data ("In use"), never the thing's name
      else if(name==='floorArea'){const r=roomById(t0.of)||roomAt(new THREE.Vector3(...t0.center)),ring=ringOf(r);if(ring)add(cues.floorArea({ring,floorY:r.floorY??0}));}
      else if(name==='doorwayGlow')add(cues.doorwayGlow(t0,t0.label,eye));
      else if(name==='arrowAhead'){
        // to the target; in another room, to where the way there goes (a couple of metres along the path), named for the target
        const dots=list.includes('floorPath')?pathOf(eye,t0):null,ahead=dots?.find(p=>Math.hypot(p[0]-eye.x,p[1]-eye.z)>2)||dots?.at(-1);
        add(cues.arrowAhead(ahead?{center:[ahead[0],eye.y-.3,ahead[1]],size:[.1,.1,.1],yaw:0}:t0,camera,{name:t0.label}));}
      else if(name==='floorPath'){
        // the route from where the user stands to the target (a room's door, or the thing); no route in the twin: no path (never through walls)
        const dots=pathOf(eye,t0);if(dots)add(cues.floorPath(dots));
      }
      else if(name==='text:sign'&&!list.includes('doorwayGlow')){
        sign=label(t0.label,{size:.06,weight:700});sign.geometry.translate(-sign.userData.width/2,0,0);sign.position.set(t0.center[0],t0.center[1]+t0.size[1]/2+.12,t0.center[2]);scene.add(sign);}
    }
  }
  return {
    get active(){return !!h;},
    /** r: an answer with a highlight or FindMy's found item (null clears it). */
    setResponse(r){
      const next=highlightOf(r),k=next?JSON.stringify([modsRevision(),r.id,r.created,next.targets.map(t=>t.id)]):null;if(k===key)return;key=k;h=next;drawnKey='';checked=0;inView=true;
      if(!h){scene.clear();drawn=[];return;}
      const m=currentMeta(r.highlight?(r.mods?.highlight||r.mod):(r.mods?.findmy||r.mod));
      ui=m?.ui&&Object.keys(m.ui).length?m.ui:fallbackUi(h);facts=m?.facts||{};
    },
    render(renderer,camera,now=performance.now()){
      if(!h)return;camera.updateMatrixWorld(true);
      if(now-checked>250){checked=now;
        const f=viewFacts(camera),list=[...new Set(Object.values(ui).flatMap(s=>partsToDraw(s.ui,f)))];
        // a floor path starts where the user stands: rebuilt when they have moved on
        const k=list.join(',')+(list.includes('floorPath')?`@${camera.position.x.toFixed(0)},${camera.position.z.toFixed(0)}`:'');
        if(k!==drawnKey){drawnKey=k;build(camera,list);}
      }
      if(sign){const e=camera.position;sign.rotation.set(0,Math.atan2(e.x-sign.position.x,e.z-sign.position.z),0);}
      for(const c of drawn)c.update(now,camera);
      const auto=renderer.autoClear;renderer.autoClear=false;
      try{renderer.clearDepth();renderer.render(scene,camera);}finally{renderer.autoClear=auto;}
    },
  };
}
