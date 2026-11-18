// Nested layout boxes. A label path with '/' names the parent: "fridge/shelf 1" is inside the box labelled "fridge". Several boxes can
// share a parent's label (three "cabinet"s), so the parent is the one of them that contains the child's centre, else the nearest.
// Boxes: {id, label, center:[x,y,z], size:[w,h,d] (along the box's own x, y, z), yaw (degrees, about +y as in three.js)}.
// No dependencies: used by the editor (src/layout-editor.mjs), tests and scripts.

export const path=label=>String(label??'').split('/').map(s=>s.trim()).filter(Boolean);
export const parentLabel=label=>{const p=path(label);return p.length>1?p.slice(0,-1).join('/'):null;};
const rad=deg=>(deg||0)*Math.PI/180,round=v=>Math.round(v*1000)/1000;

// The box's own axes in world coordinates (three.js rotation.y = yaw).
function axes(box){const a=rad(box.yaw),c=Math.cos(a),s=Math.sin(a);return [[c,0,-s],[0,1,0],[s,0,c]];}
export function toLocal(box,p){const d=[0,1,2].map(i=>p[i]-box.center[i]);return axes(box).map(a=>a[0]*d[0]+a[1]*d[1]+a[2]*d[2]);}
export function toWorld(box,l){const A=axes(box);return [0,1,2].map(i=>box.center[i]+A[0][i]*l[0]+A[1][i]*l[1]+A[2][i]*l[2]);}
export function contains(box,p,tolerance=.05){const l=toLocal(box,p);return l.every((v,i)=>Math.abs(v)<=box.size[i]/2+tolerance);}

/** Map of child id → parent box, for every box whose label has a parent path that matches some box's label. */
export function resolveParents(boxes){
  const byLabel=new Map();for(const b of boxes){const k=path(b.label).join('/');if(!byLabel.has(k))byLabel.set(k,[]);byLabel.get(k).push(b);}
  const out=new Map();
  for(const b of boxes){
    const candidates=(byLabel.get(parentLabel(b.label))||[]).filter(p=>p!==b);if(!candidates.length)continue;
    const dist=p=>Math.hypot(...p.center.map((v,i)=>v-b.center[i]));
    out.set(b.id,candidates.find(p=>contains(p,b.center))||candidates.reduce((x,y)=>dist(y)<dist(x)?y:x));
  }
  return out;
}
export const childrenOf=(boxes,parent,parents=resolveParents(boxes))=>boxes.filter(b=>parents.get(b.id)===parent);

/** Children laid out inside the parent: turned like it, centred on it across the stacking axis, and spaced evenly along it (equal gaps,
 *  each keeping its own thickness, in their current order; scaled down to fit if together they are thicker than the parent). The stacking
 *  axis is the parent's axis along which the children are spread most (vertical for shelves and drawers; one child: vertical).
 *  Returns [{id, center, size, yaw}]. */
export function arrange(parent,kids){
  if(!kids.length)return [];
  // Each child's size along the parent's axes (a child turned by about 90° has its width and depth swapped).
  const turned=k=>{const r=(((k.yaw||0)-(parent.yaw||0))%180+180)%180;return r>45&&r<135;};
  const items=kids.map(k=>{const s=turned(k)?[k.size[2],k.size[1],k.size[0]]:[...k.size];return {k,local:toLocal(parent,k.center),size:s};});
  const spread=i=>Math.max(...items.map(t=>t.local[i]))-Math.min(...items.map(t=>t.local[i]));
  const axis=items.length<2?1:[0,1,2].reduce((a,i)=>spread(i)>spread(a)+1e-6?i:a,1);
  items.sort((a,b)=>b.local[axis]-a.local[axis]);
  const H=parent.size[axis],total=items.reduce((s,t)=>s+t.size[axis],0),scale=total>H?H/total:1,gap=total>H?0:(H-total)/(items.length+1);
  let cursor=H/2-gap;
  return items.map(t=>{
    const size=t.size.map((v,i)=>i===axis?v*scale:Math.min(v,parent.size[i])),local=[0,0,0];
    local[axis]=cursor-size[axis]/2;cursor-=size[axis]+gap;
    return {id:t.k.id,center:toWorld(parent,local).map(round),size:size.map(round),yaw:parent.yaw||0};
  });
}

// Zones: the floor areas of rooms (RoomPlan) and of zones added by hand (kind 'zone', checked first: a laundry nook inside a hallway).
function inTriangle([x,z],[a,b,c]){const s=(p,q,r)=>(p[0]-r[0])*(q[1]-r[1])-(q[0]-r[0])*(p[1]-r[1]);const d1=s([x,z],a,b),d2=s([x,z],b,c),d3=s([x,z],c,a);return !((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0));}
export function roomOf(rooms,center){const ordered=[...rooms.filter(r=>r.kind==='zone'),...rooms.filter(r=>r.kind!=='zone')];
  return ordered.find(r=>r.triangles.some(t=>inTriangle([center[0],center[2]],t)))?.id??null;}

/** Outline for the layout panel: [{zone:{id,name}, nodes}] in the rooms' order (then boxes in no zone), where nodes are
 *  [{box, children:nodes}]. A nested box sits under its parent, whatever zone its own centre is in; siblings are sorted top-down
 *  (as shelves are numbered), others by name. */
export function outline(boxes,rooms){
  const parents=resolveParents(boxes),kids=new Map();for(const b of boxes){const p=parents.get(b.id);if(p){if(!kids.has(p.id))kids.set(p.id,[]);kids.get(p.id).push(b);}}
  const name=b=>path(b.label).at(-1)||b.id;
  const node=b=>({box:b,children:(kids.get(b.id)||[]).sort((x,y)=>y.center[1]-x.center[1]).map(node)});
  const zones=[...rooms.map(r=>({id:r.id,name:r.name||r.id})),{id:null,name:'No zone'}];
  const top=boxes.filter(b=>!parents.has(b.id)),zoneOf=new Map(top.map(b=>[b.id,roomOf(rooms,b.center)]));
  return zones.map(z=>({zone:z,nodes:top.filter(b=>zoneOf.get(b.id)===z.id).sort((x,y)=>name(x).localeCompare(name(y))).map(node)})).filter(g=>g.zone.id!==null||g.nodes.length);
}

/** Labels with numbers where names repeat: boxes with the same name (a trailing number ignored: "cabinet", "cabinet 3") are numbered
 *  1…n — top-level boxes across the layout, nested ones among their siblings — in zone order, then along x, then z. A parent's new name
 *  is carried into its children's paths ("cabinet 2/layer1"). A name used once keeps no number. Returns {id: label} for the labels
 *  that change. */
export function numberDuplicates(boxes,rooms=[]){
  const parents=resolveParents(boxes),base=s=>s.replace(/\s+\d+$/,'').trim(),zoneIndex=b=>{const z=roomOf(rooms,b.center),i=rooms.findIndex(r=>r.id===z);return i<0?rooms.length:i;};
  // Positions within 5 cm count as equal (two windows in one wall differ in x by scan noise; z orders them).
  const cmp=(u,v)=>Math.abs(u-v)<.05?0:u-v,order=(a,b)=>zoneIndex(a)-zoneIndex(b)||cmp(a.center[0],b.center[0])||cmp(a.center[2],b.center[2])||cmp(b.center[1],a.center[1]);
  const own=new Map(boxes.map(b=>[b.id,path(b.label).at(-1)||b.id]));
  // Number each sibling group (top level: parent null).
  const groups=new Map();for(const b of boxes){const k=(parents.get(b.id)?.id??'')+'\u0000'+base(own.get(b.id)).toLowerCase();if(!groups.has(k))groups.set(k,[]);groups.get(k).push(b);}
  for(const g of groups.values())if(g.length>1)g.sort(order).forEach((b,i)=>own.set(b.id,`${base(own.get(b.id))} ${i+1}`));
  // Full paths from the (renamed) parents down.
  const full=new Map(),label=b=>{if(full.has(b.id))return full.get(b.id);const p=parents.get(b.id),l=p?`${label(p)}/${own.get(b.id)}`:own.get(b.id);full.set(b.id,l);return l;};
  const out={};for(const b of boxes){const l=label(b);if(l!==b.label)out[b.id]=l;}
  return out;
}
