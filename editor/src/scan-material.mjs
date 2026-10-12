import * as THREE from 'three';

// Alignment previews are unlit, but must retain the scan's texture and base colour.
export function scanPreviewMaterial(source, geometry){
  if(Array.isArray(source))return source.map(material=>scanPreviewMaterial(material,geometry));
  return new THREE.MeshBasicMaterial({
    color:source?.color??0xffffff,map:source?.map??null,
    vertexColors:!!geometry.attributes.color,side:THREE.DoubleSide,
    transparent:source?.transparent??false,opacity:source?.opacity??1,
    alphaMap:source?.alphaMap??null,alphaTest:source?.alphaTest??0,
  });
}
