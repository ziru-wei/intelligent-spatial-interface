import * as THREE from 'three';
import {zoneColor,shade,makeLabel} from './palette.mjs';

// The scene's structure from its layout (scan/semantic.json), drawn in the 3D view: zones as tinted floor areas with their names,
// walls and ceilings as outlined translucent faces (sloped ceilings included). Read-only; the layer toggles in the Scene panel show
// each kind. In plan and elevation views the section plane cuts these too, so ceilings do not cover the plan.
// Surfaces: the scan split into those walls, ceilings and zone floors (scripts/segment_surfaces.py, scan/surfaces.glb), drawn as
// coloured patches over the scan's own triangles: what an effect on "Wall_8" would actually cover in the video.
// Colours come from the zones (src/palette.mjs): a wall or ceiling is drawn in a shade of the zone it faces, alternating lighter and
// darker so neighbours stay apart; labels are square tags for zones, bordered tags for walls (solid) and ceilings (dashed).
const KINDS=['zones','walls','ceilings','surfaces'];
const WALL_SHADES=[-.25,.2,-.4,.35,-.1,.45],CEILING_TINTS=[.45,.3,.6];

export function createStructure({group,twin}){
  const layers=Object.fromEntries(KINDS.map(k=>{const g=new THREE.Group();g.name=`layout-${k}`;group.add(g);return [k,g];}));
  // One plane object shared by every material here: the section plane in plan/elevation views, else one that never clips.
  const plane=new THREE.Plane(new THREE.Vector3(0,1,0),1e6),materials=[];
  // Labels are sprites (never clipped): hide the ones on the cut-away side, e.g. ceiling names in the plan view.
  const tags=[];
  twin.onRender(({clip})=>{if(clip)plane.copy(clip);else plane.set(new THREE.Vector3(0,1,0),1e6);for(const t of tags)t.visible=plane.distanceToPoint(t.position)>=0;});
  const material=(Kind,opts)=>{const m=new Kind({...opts,clippingPlanes:[plane]});materials.push(m);return m;};
  const tag=(group,text,style,color,at)=>{const t=makeLabel(text,style,color);t.position.copy(at);group.add(t);tags.push(t);return t;};
  const centroid=pts=>pts.reduce((a,p)=>a.add(new THREE.Vector3(...p)),new THREE.Vector3()).divideScalar(pts.length);
  const pretty=id=>id.replace(/^(Wall|Ceiling)_/,(m,k)=>k+' ').replace(/_/g,' ');
  // Shade for the n-th wall (or ceiling) of a zone: alternating around the zone's colour.
  function shader(rooms){const count={};return (zone,list)=>{const n=count[zone]=(count[zone]??-1)+1;return {zone:zoneColor(rooms,zone),k:list[n%list.length]};};}
  // A planar face from its 3D outline (walls and ceiling pieces; a merged wall or one cut under a slope is not convex), filled and outlined.
  function face(points,color,opacity,holeRings=[]){
    const pts=points.map(p=>new THREE.Vector3(...p)),g=new THREE.Group();if(pts.length<3)return g;
    const holes=holeRings.map(r=>r.map(p=>new THREE.Vector3(...p)));
    // Triangulate in the face's own plane (Newell's normal), so non-convex outlines fill correctly.
    const n=new THREE.Vector3();pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length];n.x+=(p.y-q.y)*(p.z+q.z);n.y+=(p.z-q.z)*(p.x+q.x);n.z+=(p.x-q.x)*(p.y+q.y);});n.normalize();
    const ax=new THREE.Vector3().subVectors(pts[1],pts[0]).normalize(),ay=new THREE.Vector3().crossVectors(n,ax);
    const to2=p=>new THREE.Vector2(p.clone().sub(pts[0]).dot(ax),p.clone().sub(pts[0]).dot(ay)),all=[...pts,...holes.flat()];
    const pos=[];for(const [a,b,c] of THREE.ShapeUtils.triangulateShape(pts.map(to2),holes.map(h=>h.map(to2))))pos.push(...all[a].toArray(),...all[b].toArray(),...all[c].toArray());
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.add(new THREE.Mesh(geo,material(THREE.MeshBasicMaterial,{color,transparent:true,opacity,depthWrite:false,side:THREE.DoubleSide})));
    for(const ring of [pts,...holes])g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring),material(THREE.LineBasicMaterial,{color,transparent:true,opacity:.9})));return g;
  }
  function clear(){for(const g of Object.values(layers)){g.traverse(o=>{o.geometry?.dispose();if(o.isSprite){o.material.map.dispose();o.material.dispose();}});g.clear();}materials.forEach(m=>m.dispose());materials.length=0;tags.length=0;}
  function setData(sem){
    clear();
    const rooms=sem?.rooms||[];
    rooms.forEach(z=>{
      const color=zoneColor(rooms,z.id),y=(z.floorY||0)+.012,parts=z.polygon||z.triangles.map(t=>[t]);
      // Plan coordinates (x, z) → a shape in (x, -z), laid flat: rotating -90° about x maps (x, -z, 0) back to (x, 0, z).
      for(const [outer,...holes] of parts){
        const shape=new THREE.Shape(outer.map(([x,z])=>new THREE.Vector2(x,-z)));shape.holes=holes.map(h=>new THREE.Path(h.map(([x,z])=>new THREE.Vector2(x,-z))));
        const mesh=new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI/2),material(THREE.MeshBasicMaterial,{color,transparent:true,opacity:.22,depthWrite:false,depthTest:false,side:THREE.DoubleSide}));
        // Drawn over the scan (the zone is on the scanned floor; a depth test would hide it behind that floor's own bumps).
        mesh.position.y=y;mesh.renderOrder=2;layers.zones.add(mesh);
        const line=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(outer.map(([x,z])=>new THREE.Vector3(x,y,z))),material(THREE.LineBasicMaterial,{color,depthTest:false}));line.renderOrder=3;layers.zones.add(line);
      }
      const c=z.center||[0,0];tag(layers.zones,z.name||z.id,'zone',color,new THREE.Vector3(c[0],y+.05,c[1]));
    });
    // Walls with their doors and windows cut out (`region`, scripts/wall_openings.py); the full outline before any cut.
    const ws=shader(rooms),cs=shader(rooms);
    for(const w of sem?.walls||[]){const {zone,k}=ws(w.rooms?.[0],WALL_SHADES),color=shade(zone,k);
      for(const [outer,...holes] of w.region||[[w.outline||[]]])layers.walls.add(face(outer,color,.22,holes));
      if(w.outline?.length)tag(layers.walls,pretty(w.id),'wall',zone,centroid(w.outline));}
    for(const c of sem?.ceilings||[]){const {zone,k}=cs(c.room,CEILING_TINTS);layers.ceilings.add(face(c.outline||[],shade(zone,k),.2));
      if(c.outline?.length)tag(layers.ceilings,pretty(c.id),'ceiling',zone,centroid(c.outline));}
    twin.render();
  }
  /** Segmented scan surfaces: the glTF scene of scan/surfaces.glb (one mesh per surface id) and surfaces.json's list. */
  function setSurfaces(gltfScene,info,rooms){
    const g=layers.surfaces;g.traverse(o=>{if(o.isSprite){const i=tags.indexOf(o);if(i>=0)tags.splice(i,1);o.material.map.dispose();o.material.dispose();}if(o.isMesh){o.geometry.dispose();}});g.clear();if(!gltfScene)return twin.render();
    const ws=shader(rooms),cs=shader(rooms);
    for(const s of info||[]){const mesh=gltfScene.getObjectByName(s.id);if(!mesh)continue;
      // Doors and windows: dark shades of their zone; their nested parts (a window's glass) a light tint, more see-through.
      const opening=s.kind==='door'||s.kind==='window',part=opening&&s.parent;
      const pick=s.kind==='wall'?ws(s.zones[0],WALL_SHADES):s.kind==='ceiling'?cs(s.zones[0],CEILING_TINTS):opening?{zone:zoneColor(rooms,s.zones[0]),k:part?.55:s.kind==='door'?-.5:-.3}:{zone:zoneColor(rooms,s.zones[0]),k:0},color=shade(pick.zone,pick.k);
      // Drawn over the scan's own triangles (they coincide with them): pulled toward the camera so they win the depth test.
      mesh.traverse(o=>{if(o.isMesh)o.material=material(THREE.MeshBasicMaterial,{color,transparent:true,opacity:part?.4:.55,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4});});
      mesh.updateMatrixWorld(true);g.add(mesh);mesh.userData.surface=s.id;mesh.traverse(o=>{if(o.isMesh)o.userData.surface=s.id;});
      const c=[0,1,2].map(i=>s.origin[i]+s.u[i]*(s.uvMin[0]+s.uvMax[0])/2+s.v[i]*(s.uvMin[1]+s.uvMax[1])/2);
      tag(g,opening?String(s.label).split('/').pop():pretty(s.id),s.kind==='floor'?'zone':opening?(part?'nested':'object'):s.kind,pick.zone,new THREE.Vector3(...c).addScaledVector(new THREE.Vector3(...s.normal),.04));}
    twin.render();
  }
  // Focus (aligning a recording): the chosen surfaces stand out, the others fade; null: all as usual.
  function setFocus(ids){const on=ids?new Set(ids):null;
    for(const o of layers.surfaces.children){const id=o.userData.surface;if(!id)continue;o.traverse(m=>{if(m.isMesh){m.material.opacity=!on?(m.userData.baseOpacity??=m.material.opacity):on.has(id)?.8:.08;}});}
    twin.render();}
  /** The surface id under a ray (shown surfaces only). */
  function pickSurface(ray){if(!layers.surfaces.visible)return null;const hit=ray.intersectObjects(layers.surfaces.children,true).find(h=>h.object.isMesh);return hit?.object.userData.surface??null;}
  function setVisible(kinds){for(const k of KINDS)if(k in kinds)layers[k].visible=!!kinds[k];twin.render();}
  return {setData,setSurfaces,setVisible,setFocus,pickSurface,layers};
}
