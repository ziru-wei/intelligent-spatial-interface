import * as THREE from 'three';

// Box ↔ model, the same for scene objects (src/app.mjs, scripts/composition.py) and furniture (layout boxes, src/layout-editor.mjs,
// scripts/spaces.py): a model replacing a box fits inside it (uniform scale, its bounding-box centre on the box's centre, turned with
// it); a box replacing a model takes the model's bounds (its size at the placed scale, re-centred on the model's bounding-box centre).

/** The uniform scale that fits a model of this size (its own units) inside a box of this size. */
export const fitScale=(box,size)=>Math.max(1e-4,Math.min(...box.map((v,i)=>v/size[i])));

/** {size, center} of an object's bounding box in its own units, rounded; throws when it has no geometry. */
export function modelBounds(object){
  object.updateWorldMatrix(true,true);const b=new THREE.Box3().setFromObject(object);
  const size=b.getSize(new THREE.Vector3()).toArray().map(v=>+v.toFixed(5)),center=b.getCenter(new THREE.Vector3()).toArray().map(v=>+v.toFixed(5));
  if(b.isEmpty()||size.some(v=>!(v>0)))throw Error('The model has no geometry.');
  return {size,center};
}
const dataURL=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
/** A .glb file read for a replacement: its scene, bounds and a data URL to send to the server. */
export async function readModel(file,loader){
  const scene=(await loader.parseAsync(await file.arrayBuffer(),'')).scene;return {scene,...modelBounds(scene),src:await dataURL(file)};
}
const vec3=s=>Array.isArray(s)?s:[s,s,s];
/** A placed model (position, rotation in degrees, Euler XYZ, scale: a number or [x, y, z]) as a box: its centre and size. pivot: the
 *  model point at the position (its library pivot; default the origin). Mirrors scripts/composition.py model_to_box. */
export function boxFromModel({position,rotation=[0,0,0],scale=1},{size,center,pivot=[0,0,0]}){
  const s=vec3(scale),D=THREE.MathUtils.degToRad;
  const offset=new THREE.Vector3(...center.map((c,i)=>(c-pivot[i])*s[i])).applyEuler(new THREE.Euler(D(rotation[0]),D(rotation[1]),D(rotation[2]),'XYZ'));
  return {position:position.map((p,i)=>+(p+offset.getComponent(i)).toFixed(4)),scale:size.map((v,i)=>+Math.max(.001,v*s[i]).toFixed(4))};
}

const MODEL='<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12v9M4 7.5l8 4.5 8-4.5"/><path d="M17 1v4M15 3h4"/></svg>';
const BOX='<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="1"/><path d="M4 10h16"/></svg>';
/** The swap control of a list row, as HTML: kind 'box' offers a model (file picker), kind 'model' a box. */
export const swapHTML=kind=>kind==='box'?`<label class="swap" aria-label="Replace with a 3D model" title="Replace the box with a 3D model (.glb), fitted inside it">${MODEL}<input type="file" accept=".glb"></label>`
  :kind==='model'?`<button class="swap" type="button" aria-label="Replace with a box" title="Replace the 3D model with a box of its size">${BOX}</button>`:'';
/** Wires a row's swap control: onModel(file) for a box, onBox() for a model; errors go to onError. */
export function wireSwap(row,{onModel,onBox,onError=()=>{}}){
  row.querySelector('label.swap input')?.addEventListener('change',e=>{const f=e.target.files[0];e.target.value='';if(f)Promise.resolve(onModel?.(f)).catch(onError);});
  const b=row.querySelector('button.swap');if(b)b.onclick=e=>{e.stopPropagation();Promise.resolve(onBox?.()).catch(onError);};
  row.querySelector('label.swap')?.addEventListener('click',e=>e.stopPropagation());
}
