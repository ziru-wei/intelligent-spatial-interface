// Example of a dynamic, interactive component: a ring on the floor that pulses on the scenario clock (so scrubbing shows the same
// state at the same time) and toggles between idle and active when clicked.
export function create({THREE,params,invalidate}){
  const object=new THREE.Group(),mat=new THREE.MeshBasicMaterial({transparent:true,side:THREE.DoubleSide,depthWrite:false});
  const ring=new THREE.Mesh(new THREE.RingGeometry(.8,1,64).rotateX(-Math.PI/2),mat),dot=new THREE.Mesh(new THREE.CircleGeometry(.25,32).rotateX(-Math.PI/2),mat);
  ring.position.y=dot.position.y=.005;object.add(ring,dot);
  let p=params,active=false,phase=0;
  const draw=()=>{const s=p.radius*(1+.35*phase);ring.scale.setScalar(s);dot.scale.setScalar(p.radius);mat.color.set(active?'#ffffff':p.color);mat.opacity=active?.95:.85-.6*phase;};
  draw();
  return {object,
    update({local}){phase=((local/p.period)%1+1)%1;draw();},
    onPointer({type}){if(type==='click'){active=!active;draw();invalidate();}},
    get active(){return active;},
    setParams(next){p=next;draw();},
    dispose(){ring.geometry.dispose();dot.geometry.dispose();mat.dispose();}};
}
