import * as THREE from 'three';
import {roomOf} from './layout-tree.mjs';

// One colour per zone, used everywhere the layout is drawn (zone floors, boxes, surfaces, labels), and the labels themselves:
//   zone      square tag filled with the zone's colour
//   object    capsule in a dark shade of its zone's colour (a top-level box: a parent)
//   nested    capsule in a light tint of it (a box inside another)
//   wall      square tag, dark, with a solid border in the zone's colour
//   ceiling   the same with a dashed border and italic text
export const ZONE_COLORS=[0x6fd08c,0xe0796f,0x7d8ff0,0xe5c75a,0x5cc9d6,0xc58ae6,0xf09a54,0x9bd35e];
export const NO_ZONE=0x9a9a9a;
export function zoneColor(rooms,id){const i=(rooms||[]).findIndex(r=>r.id===id);return i<0?NO_ZONE:ZONE_COLORS[i%ZONE_COLORS.length];}
export const zoneColorAt=(rooms,center)=>zoneColor(rooms,roomOf(rooms||[],center));
/** Mix a colour toward black (f < 0) or white (f > 0) by |f|. */
export function shade(hex,f){const c=new THREE.Color(hex),t=f<0?new THREE.Color(0):new THREE.Color(0xffffff);return c.lerp(t,Math.abs(f)).getHex();}
const css=hex=>'#'+hex.toString(16).padStart(6,'0');

const SIZE={zone:.085,object:.06,nested:.05,wall:.05,ceiling:.05};   // label height in metres
/** A label sprite for the 3D view; style one of zone, object, nested, wall, ceiling; color the zone's colour. */
export function makeLabel(text,style,color){
  const c=document.createElement('canvas'),x=c.getContext('2d'),font=`${style==='ceiling'?'italic ':''}${style==='zone'?700:600} 34px system-ui`;
  x.font=font;const pad=style==='object'||style==='nested'?26:16,h=52;c.width=Math.ceil(x.measureText(text).width)+pad*2;c.height=h;
  const fill={zone:css(color),object:css(shade(color,-.62)),nested:css(shade(color,.62)),wall:'rgba(18,18,18,.82)',ceiling:'rgba(18,18,18,.82)'}[style];
  const ink={zone:'#111',object:'#fff',nested:'#111',wall:css(shade(color,.35)),ceiling:css(shade(color,.35))}[style];
  const r=style==='object'||style==='nested'?h/2:style==='zone'?3:6;
  x.beginPath();x.roundRect(2,2,c.width-4,h-4,r);x.fillStyle=fill;x.fill();
  if(style==='wall'||style==='ceiling'){x.lineWidth=3;x.strokeStyle=css(color);x.setLineDash(style==='ceiling'?[7,5]:[]);x.stroke();}
  x.font=font;x.fillStyle=ink;x.textBaseline='middle';x.textAlign='center';x.fillText(text,c.width/2,h/2+1);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,depthTest:false,transparent:true}));const hm=SIZE[style]||.06;s.scale.set(c.width/h*hm,hm,1);s.renderOrder=15;s.userData.labelKey=`${text}|${style}|${color}`;return s;
}
