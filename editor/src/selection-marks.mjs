import * as THREE from 'three';
import {SELECT_MIN} from './user-selection.mjs';

// The user's selection of things carrying info (src/user-selection.mjs) marked in the 3D view: every box with some score gets its outline and,
// above it, a bar of its score (0-1) with its key. Boxes at or above SELECT_MIN are selected: bright outline and bar; the best of them (the
// one the question goes with) brightest. Below it: faint. The recorded camera only shows the fovea zone changing colour (src/app.mjs).
// set({scores, selected}, boxes) after the selection changes. Like the layout's boxes, walls hide the outlines (src/twin.mjs setWallPass,
// `group`); the bars (`bars`) are never hidden, by walls or anything else.
const COLOR={chosen:'#7fe0c6',selected:'#4aa892',low:'#8a8a8a'},BAR={w:256,h:56,world:.42};
const unitEdges=new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1));

function barTexture(key,score,tone){
  const c=document.createElement('canvas');c.width=BAR.w;c.height=BAR.h;const x=c.getContext('2d');
  x.fillStyle='rgba(14,14,14,.86)';x.beginPath();x.roundRect(1,1,BAR.w-2,BAR.h-2,10);x.fill();
  x.font='600 20px system-ui';x.textBaseline='middle';x.fillStyle='#eee';x.textAlign='left';x.fillText(key.length>16?key.slice(0,15)+'…':key,12,17);
  x.textAlign='right';x.fillStyle=COLOR[tone];x.fillText(`${Math.round(score*100)}%`,BAR.w-12,17);
  x.fillStyle='rgba(255,255,255,.12)';x.fillRect(12,34,BAR.w-24,12);x.fillStyle=COLOR[tone];x.fillRect(12,34,(BAR.w-24)*score,12);
  // The selection threshold on the bar.
  x.fillStyle='rgba(255,255,255,.7)';x.fillRect(12+(BAR.w-24)*SELECT_MIN-1,31,2,18);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}

export function createSelectionMarks({group}){
  const root=new THREE.Group();root.name='Info selection marks';group.add(root);
  const bars=new THREE.Group();bars.name='Info selection bars';group.add(bars);
  const marks=new Map();let enabled=true;   // box id → {object, key}
  function drop(id){const m=marks.get(id);root.remove(m.object);bars.remove(m.bar);for(const o of [m.object,m.bar])o.traverse(c=>{if(c.material){c.material.map?.dispose();c.material.dispose();}});marks.delete(id);}
  function set(result,boxes){
    const scores=(result?.scores||[]).filter(s=>s.score>0),chosen=result?.selected?.box_id;
    for(const id of [...marks.keys()])if(!scores.some(s=>s.box_id===id))drop(id);
    for(const s of scores){
      const b=boxes.find(x=>x.id===s.box_id);if(!b)continue;
      const tone=s.box_id===chosen?'chosen':s.score>=SELECT_MIN?'selected':'low',key=`${s.key}|${s.score.toFixed(2)}|${tone}|${b.center}|${b.size}|${b.yaw}`;
      if(marks.get(s.box_id)?.key===key)continue;
      if(marks.has(s.box_id))drop(s.box_id);
      const o=new THREE.Group();o.position.fromArray(b.center);o.rotation.y=THREE.MathUtils.degToRad(b.yaw||0);
      const edges=new THREE.LineSegments(unitEdges,new THREE.LineBasicMaterial({color:COLOR[tone],transparent:true,opacity:tone==='low'?.5:1}));edges.scale.fromArray(b.size).multiplyScalar(1.06);
      const bar=new THREE.Sprite(new THREE.SpriteMaterial({map:barTexture(s.key,s.score,tone),transparent:true,depthTest:false,depthWrite:false}));
      bar.scale.set(BAR.world,BAR.world*BAR.h/BAR.w,1);bar.position.set(b.center[0],b.center[1]+b.size[1]/2+.22,b.center[2]);bar.renderOrder=30;
      o.add(edges);o.userData.box=b;root.add(o);bars.add(bar);marks.set(s.box_id,{object:o,bar,key});
    }
  }
  return {set,setEnabled(on){enabled=!!on;root.visible=bars.visible=enabled;},get group(){return root;},get count(){return marks.size;}};
}
