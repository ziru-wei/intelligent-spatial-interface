import * as THREE from 'three';
import {path,resolveParents,childrenOf,arrange,numberDuplicates} from './layout-tree.mjs';
import {makeLabel,zoneColorAt} from './palette.mjs';

// Scene layout in the 3D view: labelled boxes (furniture and appliances, doors and windows; scan/semantic.json) drawn over whichever
// scan is chosen. RoomPlan's boxes are a first guess, so in edit mode they can be corrected on the scan:
//   click a box to select it; drag it to move (horizontally, or in the view plane when looking from the side);
//   drag one of its six face handles to push or pull that face (the opposite face stays); the panel edits label and yaw;
//   Add puts a new box where the view's centre meets the scan; Duplicate (⌘/Ctrl+D) copies the selected box next to it; Delete (or
//   the Delete key) removes it. Undo/redo (⌘/Ctrl+Z, ⇧⌘/Ctrl+Shift+Z) step through snapshots of the whole layout; typing in the label or
//   yaw field of one box counts as one step.
// Nesting: a label path with '/' ("fridge/shelf 1") puts a box inside its parent (src/layout-tree.mjs); a selected box's children are
//   tinted, and Arrange children lines them up inside it (same yaw, centred, evenly spaced).
// Every change is reported through onChange (the editor saves it, debounced); onHistory reports whether undo/redo are possible.
const COLOR={object:0xffd27a,opening:0x8fc7ff,selected:0xffffff,child:0xd9a6ff},HANDLE=.045;
const unitEdges=new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),unitBox=new THREE.BoxGeometry(1,1,1),handleGeo=new THREE.SphereGeometry(1,16,12);
const FACES=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].map(a=>new THREE.Vector3(...a));

export function createLayoutEditor({group,canvas,getCamera,render,pickScene,onChange,onSelect,onHistory,getRooms=()=>[]}){
  let parents=new Map();   // child id → parent box, refreshed after every change (labels: object or nested, and their zone)
  let boxes=[],hiddenIds=new Set(),enabled=false,selected=null,drag=null,serial=0,undoStack=[],redoStack=[],lastKey=null;
  const ray=new THREE.Raycaster(),handles=new THREE.Group();handles.renderOrder=20;

  function dispose(o){o.traverse(c=>{if(c.material){c.material.map?.dispose();c.material.dispose();}});}

  // One box: a group at the centre turned by yaw; edges and a (normally invisible) fill for picking, scaled to the size.
  function build(b){
    const g=new THREE.Group(),edges=new THREE.LineSegments(unitEdges,new THREE.LineBasicMaterial({color:COLOR[b.kind],depthTest:!enabled}));
    const fill=new THREE.Mesh(unitBox,new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));
    fill.userData.box=b;g.add(edges,fill);g.userData={edges,fill};b.object=g;group.add(g);place(b);
  }
  function place(b){
    const g=b.object;g.visible=!hiddenIds.has(b.id);g.position.fromArray(b.center);g.rotation.y=THREE.MathUtils.degToRad(b.yaw||0);
    g.userData.edges.scale.fromArray(b.size);g.userData.fill.scale.fromArray(b.size);
    // A nested box shows only its own name (the last part of its path), on a light capsule; a parent on a dark one; both in the colour of
    // the zone the outermost parent stands in (src/palette.mjs).
    let top=b;while(parents.has(top.id))top=parents.get(top.id);
    const style=parents.has(b.id)?'nested':'object',color=zoneColorAt(getRooms(),top.center),text=path(b.label).at(-1)||b.id,key=`${text}|${style}|${color}`;
    if(g.userData.labelKey!==key){if(g.userData.label){g.remove(g.userData.label);dispose(g.userData.label);}g.userData.label=makeLabel(text,style,color);g.userData.labelKey=key;g.add(g.userData.label);}
    g.userData.label.position.set(0,b.size[1]/2+.1,0);
    if(b===selected)placeHandles();
  }
  let focus=null;   // ids picked for aligning a recording: drawn in cyan
  function style(){const kids=new Set(selected&&enabled?childrenOf(boxes,selected):[]);
    for(const b of boxes){const on=b===selected,color=focus?.has(b.id)?0x5ce1ff:on?COLOR.selected:kids.has(b)?COLOR.child:COLOR[b.kind];b.object.userData.edges.material.color.set(color);b.object.userData.edges.material.depthTest=!enabled;const f=b.object.userData.fill.material;f.color.set(color);f.opacity=on?.28:kids.has(b)?.22:enabled?.14:0;}}
  function placeHandles(){
    handles.clear();if(!selected||!enabled)return;selected.object.add(handles);
    FACES.forEach((a,i)=>{const h=new THREE.Mesh(handleGeo,new THREE.MeshBasicMaterial({color:a.y?0x9be7a4:0xffffff,depthTest:false,transparent:true}));h.renderOrder=20;
      h.onBeforeRender=(r,s,cam)=>{h.material.opacity=facing(h,cam)?0:1;};
      h.position.copy(a).multiply(new THREE.Vector3(...selected.size)).multiplyScalar(.5);h.scale.setScalar(HANDLE);h.userData.face=i;handles.add(h);});
  }
  // A face seen head-on (its axis along the view, e.g. top and bottom in the plan view) cannot be dragged, and its handle would sit on
  // the box's middle where a drag should move the box: hidden and not picked.
  function facing(h,cam){return Math.abs(yawAxis(selected,FACES[h.userData.face]).dot(cam.getWorldDirection(new THREE.Vector3())))>.9;}
  const grabbable=()=>handles.children.filter(h=>!facing(h,getCamera()));
  function select(b){if(b!==selected)lastKey=null;selected=b;style();placeHandles();onSelect?.(b);render();}

  function load(data,selectId=null){
    for(const b of boxes){group.remove(b.object);dispose(b.object);}selected=null;
    boxes=[...(data?.objects||[]).map(o=>({...o,kind:'object'})),...(data?.openings||[]).map(o=>({...o,kind:'opening'}))];
    for(const b of boxes)build(b);relabel();selected=boxes.find(b=>b.id===selectId)||null;style();placeHandles();onSelect?.(selected);render();
  }
  function setData(data){load(data);undoStack=[];redoStack=[];lastKey=null;onHistory?.(history());}
  function data(){const parents=resolveParents(boxes),out=b=>({id:b.id,label:b.label,category:b.category,center:[...b.center],size:[...b.size],yaw:b.yaw||0,parent:parents.get(b.id)?.id??null});
    return {objects:boxes.filter(b=>b.kind==='object').map(out),openings:boxes.filter(b=>b.kind==='opening').map(out)};}
  // Repeated names get numbers (cabinet 1, cabinet 2…; children follow their parent's new name): src/layout-tree.mjs numberDuplicates.
  function numberLabels(){const m=numberDuplicates(boxes,getRooms());for(const [id,l] of Object.entries(m)){const b=boxes.find(x=>x.id===id);if(b)b.label=l;}return Object.keys(m).length>0;}
  /** After a label is typed (on commit, not per key): number repeats, as part of the same undo step. */
  function renumber(){if(numberLabels()){changed();onSelect?.(selected);}}
  // Nesting or zones may have changed: labels of every box follow.
  function relabel(){parents=resolveParents(boxes);for(const b of boxes)place(b);}
  function changed(){relabel();style();render();onChange?.(data());}

  // History: the layout before each change. A key coalesces repeated changes of one kind (typing a label) into one step.
  const history=()=>({undo:undoStack.length>0,redo:redoStack.length>0});
  function remember(key=null,snapshot=data()){
    if(key&&key===lastKey)return;lastKey=key;
    undoStack.push({data:snapshot,selected:selected?.id});if(undoStack.length>100)undoStack.shift();redoStack=[];onHistory?.(history());
  }
  function step(from,to){const s=from.pop();if(!s)return;to.push({data:data(),selected:selected?.id});lastKey=null;load(s.data,s.selected);onChange?.(data());onHistory?.(history());}
  const undo=()=>step(undoStack,redoStack),redo=()=>step(redoStack,undoStack);

  // Hidden boxes (the outline's eye toggles) are neither drawn nor picked.
  function setHidden(ids){hiddenIds=new Set(ids);for(const b of boxes)b.object.visible=!hiddenIds.has(b.id);if(selected&&hiddenIds.has(selected.id))select(null);else render();}
  const pickable=()=>boxes.filter(b=>b.object.visible).map(b=>b.object.userData.fill);
  function setEnabled(on){enabled=on;if(!on)selected=null;style();placeHandles();onSelect?.(selected);render();}
  function update(fields){if(!selected)return;remember(Object.keys(fields).join()+':'+selected.id);Object.assign(selected,fields);changed();onSelect?.(selected);}
  function remove(){if(!selected)return;remember();const b=selected;boxes=boxes.filter(x=>x!==b);group.remove(b.object);dispose(b.object);relabel();select(null);onChange?.(data());}
  // A new box where the middle of the view meets the scan, resting on what it hits; else 2 m ahead.
  function add(){
    const cam=getCamera();ray.setFromCamera(new THREE.Vector2(0,0),cam);const hit=pickScene(ray),size=[.5,.5,.5];
    const p=hit?hit.point.clone():ray.ray.at(2,new THREE.Vector3());
    if(hit?.face&&hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y>.7)p.y+=size[1]/2;else p.addScaledVector(ray.ray.direction,-size[2]/2);
    while(boxes.some(b=>b.id===`custom_${serial}`))serial++;
    remember();const b={id:`custom_${serial}`,label:'object',category:'custom',center:p.toArray().map(v=>+v.toFixed(3)),size,yaw:0,kind:'object'};
    boxes.push(b);build(b);numberLabels();relabel();select(b);onChange?.(data());return b;
  }
  const children=()=>selected?childrenOf(boxes,selected):[];
  function arrangeChildren(){const kids=children();if(!kids.length)return;remember();
    for(const r of arrange(selected,kids)){const b=boxes.find(x=>x.id===r.id);Object.assign(b,{center:r.center,size:r.size,yaw:r.yaw});place(b);}changed();}
  // A copy of the selected box beside it (along its own width, 5 cm apart), with the next free id of its kind (chair_0 → chair_1).
  function duplicate(){
    if(!selected)return null;const src=selected,base=src.id.replace(/_(copy_)?\d+$/,'');let n=0;while(boxes.some(b=>b.id===`${base}_${n}`))n++;
    const c=new THREE.Vector3(...src.center).addScaledVector(yawAxis(src,FACES[0]),src.size[0]+.05);
    remember();const b={...src,id:`${base}_${n}`,center:c.toArray().map(v=>+v.toFixed(3)),size:[...src.size],object:undefined};
    boxes.push(b);build(b);numberLabels();relabel();select(b);onChange?.(data());return b;
  }

  // Pointer: capture phase on the canvas, so a grabbed box or handle keeps the orbit controls, the object gizmo and click handlers out.
  const ndc=e=>{const r=canvas.getBoundingClientRect();return new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);};
  function cast(e){ray.setFromCamera(ndc(e),getCamera());return ray;}
  const yawAxis=(b,a)=>a.clone().applyAxisAngle(new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(b.yaw||0));
  canvas.addEventListener('pointerdown',e=>{
    if(!enabled||e.button!==0)return;cast(e);
    const h=selected&&ray.intersectObjects(grabbable(),false)[0];
    if(h){const axis=yawAxis(selected,FACES[h.object.userData.face]);
      drag={kind:'face',axis,origin:h.object.getWorldPosition(new THREE.Vector3()),center:new THREE.Vector3(...selected.center),size:[...selected.size],dim:Math.abs(FACES[h.object.userData.face].x)?0:Math.abs(FACES[h.object.userData.face].y)?1:2};}
    else{const hit=ray.intersectObjects(pickable(),false)[0];if(!hit){if(selected)select(null);return;}
      if(hit.object.userData.box!==selected)select(hit.object.userData.box);
      // Looking down: move on the floor plane. From the side: in the vertical plane facing the view (up and down too).
      const dir=getCamera().getWorldDirection(new THREE.Vector3()),normal=Math.abs(dir.y)>.5?new THREE.Vector3(0,1,0):new THREE.Vector3(dir.x,0,dir.z).normalize();
      drag={kind:'move',plane:new THREE.Plane().setFromNormalAndCoplanarPoint(normal,hit.point),start:hit.point.clone(),center:new THREE.Vector3(...selected.center)};}
    drag.moved=false;drag.before={data:data(),selected:selected.id};e.stopImmediatePropagation();e.preventDefault();canvas.setPointerCapture(e.pointerId);
  },{capture:true});
  canvas.addEventListener('pointermove',e=>{
    if(!drag)return;cast(e);e.stopImmediatePropagation();
    if(drag.kind==='move'){const p=ray.ray.intersectPlane(drag.plane,new THREE.Vector3());if(!p)return;selected.center=drag.center.clone().add(p.sub(drag.start)).toArray().map(v=>+v.toFixed(3));}
    else{
      // Closest point on the face's axis line to the pointer ray: how far the face moved; the opposite face stays put.
      const w0=drag.origin.clone().sub(ray.ray.origin),a=drag.axis,d=ray.ray.direction,b=a.dot(d),den=1-b*b;if(den<1e-6)return;
      const t=(b*d.dot(w0)-a.dot(w0))/den,size=Math.max(.02,drag.size[drag.dim]+t),grow=size-drag.size[drag.dim];
      selected.size=drag.size.map((v,i)=>i===drag.dim?+size.toFixed(3):v);selected.center=drag.center.clone().addScaledVector(a,grow/2).toArray().map(v=>+v.toFixed(3));}
    drag.moved=true;place(selected);render();onSelect?.(selected);
  },{capture:true});
  const end=e=>{if(!drag)return;const {moved,before}=drag;drag=null;e.stopImmediatePropagation();if(!moved)return;
    // The selection at the start of the drag is restored with the snapshot, so remember() takes it from there.
    lastKey=null;undoStack.push(before);if(undoStack.length>100)undoStack.shift();redoStack=[];onHistory?.(history());changed();};
  canvas.addEventListener('pointerup',end,{capture:true});canvas.addEventListener('pointercancel',end,{capture:true});
  canvas.addEventListener('click',e=>{if(enabled)e.stopImmediatePropagation();},{capture:true});
  canvas.addEventListener('pointermove',e=>{if(!enabled||drag)return;cast(e);const over=(selected&&ray.intersectObjects(grabbable(),false).length)||ray.intersectObjects(pickable(),false).length;canvas.style.cursor=over?'grab':'';});
  addEventListener('keydown',e=>{if(!enabled||e.target.matches?.('input,select,textarea'))return;const mod=e.metaKey||e.ctrlKey,k=e.key.toLowerCase();
    if(mod&&k==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}if(mod&&k==='y'){e.preventDefault();redo();return;}
    if(mod&&k==='d'){e.preventDefault();duplicate();return;}
    if((e.key==='Delete'||e.key==='Backspace')&&selected){e.preventDefault();remove();}if(e.key==='Escape')select(null);});

  return {setFocus(ids){focus=ids?new Set(ids):null;style();render();},
    /** The top-level box under a ray (visible boxes; a nested one counts as its outermost parent). */
    pickBox(ray){const hit=ray.intersectObjects(pickable(),false)[0];let b=hit?.object.userData.box;while(b&&parents.has(b.id))b=parents.get(b.id);return b?.id??null;},
    relabel,renumber,setData,setHidden,setEnabled,update,remove,add,duplicate,arrangeChildren,children,undo,redo,select,data,get history(){return history();},get boxes(){return boxes;},get selected(){return selected;},get enabled(){return enabled;}};
}
