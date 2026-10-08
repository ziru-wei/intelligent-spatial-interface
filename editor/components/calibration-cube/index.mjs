// A grounded, recognisable calibration object: a cube on a thin ring. Not a claim of final AR art direction.
export function create({THREE,params}){
  const object=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({metalness:.3,roughness:.25}));
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.755,.04,16,100),new THREE.MeshStandardMaterial({color:0xa8ddcb,metalness:.65,roughness:.22}));ring.rotation.x=Math.PI/2;
  object.add(body,ring);
  function setParams(p){const s=p.size;body.material.color.set(p.color);body.scale.setScalar(s);body.position.y=s/2;ring.scale.setScalar(s);ring.position.y=.078*s;}
  setParams(params);
  return {object,setParams,dispose(){body.geometry.dispose();body.material.dispose();ring.geometry.dispose();ring.material.dispose();}};
}
