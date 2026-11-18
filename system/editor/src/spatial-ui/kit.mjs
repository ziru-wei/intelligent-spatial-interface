// Text for the spatial UI (the cues of src/spatial-ui/cues.mjs and the cue host): a flat plane with the words drawn on a canvas, white
// with a dark halo so it reads over the video, and line wrapping. The panel components that used to live here were replaced by the cues.
import * as THREE from 'three';

export const WIDTH=.34;

export function label(text,{size=.016,weight=600,color='#ffffff',align='left',maxWidth=WIDTH,stroke=true}={}){
  const px=96,c=document.createElement('canvas'),x=c.getContext('2d'),font=`${weight} ${px}px system-ui, -apple-system, sans-serif`;
  x.font=font;let t=String(text??'');const scale=size/px;
  while(t.length>3&&x.measureText(t).width*scale>maxWidth)t=t.slice(0,-2);if(t!==String(text??''))t=t.trimEnd()+'…';
  const w=Math.ceil(x.measureText(t).width)+48,h=Math.round(px*1.45);c.width=w;c.height=h;
  x.font=font;x.textBaseline='middle';x.lineJoin='round';if(stroke){x.strokeStyle='rgba(8,9,11,.72)';x.lineWidth=px*.16;x.strokeText(t,24,h/2);}x.fillStyle=color;x.fillText(t,24,h/2);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=8;
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w*scale,h*scale),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,toneMapped:false}));
  m.userData.width=(w-48)*scale;m.renderOrder=5;
  if(align==='left')m.geometry.translate(w*scale/2-24*scale,0,0);if(align==='right')m.geometry.translate(-w*scale/2+24*scale,0,0);
  return m;
}
export function wrapLines(text,size,maxWidth,weight=400){
  const c=document.createElement('canvas').getContext('2d'),px=96;c.font=`${weight} ${px}px system-ui`;const out=[];
  for(const para of String(text||'').split('\n')){let line='';for(const w of para.split(/\s+/)){const t=line?line+' '+w:w;if(c.measureText(t).width*size/px>maxWidth&&line){out.push(line);line=w;}else line=t;}out.push(line);}
  return out;
}
