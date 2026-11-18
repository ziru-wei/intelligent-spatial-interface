// The spatial UI component library (modos-system-design.md 4.3): controls that are things in the room, like Weather's controls (lit 3D
// bodies: capsule switches, rails with round thumbs, raised pill buttons; text on floating planes with a halo so it reads over the video),
// not drawn on a flat panel. Every panel-like primitive representation (Control, Action Card, Data Widget) is a stack of these, built from
// a component spec ({rows}) by buildPanel(); no MOD or device has its own drawing code.
//   header · switch · slider · segments · button(s) · progress · readout · list · field · text
// Sizes are metres; a panel is WIDTH wide, rows stack downward, x runs -WIDTH/2 … WIDTH/2 on the panel's plane, facing +z.
import * as THREE from 'three';

export const WIDTH=.34;
const C={body:0x2b2e34,bodyHi:0x3a3e46,accent:0x3ff0ff,on:0x3ff0ff,off:0x5d6067,light:0xeef0f3,danger:0xff6b5e,done:0x7fd6ff};
const mat=(color,{rough=.45,metal=.15,emissive=0}={})=>new THREE.MeshStandardMaterial({color,roughness:rough,metalness:metal,emissive:color,emissiveIntensity:emissive});
const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;

// Text on a floating plane: white with a dark halo (legible on any part of the video). Height in metres.
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
function pill(w,h,d,r=Math.min(w,h)/2){
  const s=new THREE.Shape(),x=-w/2,y=-h/2;r=Math.min(r,h/2,w/2);
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
  const g=new THREE.ExtrudeGeometry(s,{depth:d,bevelEnabled:true,bevelSize:d*.35,bevelThickness:d*.35,bevelSegments:4,curveSegments:10});g.translate(0,0,-d/2);return g;
}
const rail=(len,r=.0035,color=C.body)=>{const g=new THREE.CylinderGeometry(r,r,len,20);g.rotateZ(Math.PI/2);return new THREE.Mesh(g,mat(color));};
const hitbox=(w,h)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({visible:false}));m.position.z=.012;return m;};

// ——— components: each returns {group, height, hits: [mesh], update?(now)} ———

export function header({title,status,tone}){
  const g=new THREE.Group(),t=label(title,{size:.024,weight:700,maxWidth:WIDTH*.7});t.position.set(-WIDTH/2,0,0);g.add(t);
  if(status){const s=label(status,{size:.013,weight:500,color:tone==='attention'?'#ffd98a':tone==='done'?'#9fe2ff':'#c9ccd2',align:'right'});s.position.set(WIDTH/2,-.002,0);g.add(s);}
  return {group:g,height:.04,hits:[]};
}

export function toggleSwitch({label:text,from,to,onPress,changeAt}){
  const g=new THREE.Group(),l=label(text,{size:.015,color:'#dfe2e7'});l.position.set(-WIDTH/2,0,0);g.add(l);
  const len=.026,r=.011,track=new THREE.Mesh(new THREE.CapsuleGeometry(r,len,8,16),mat(C.off,{rough:.35}));track.rotation.z=Math.PI/2;
  const knob=new THREE.Mesh(new THREE.SphereGeometry(r*.92,24,16),mat(C.light,{rough:.3}));const x0=WIDTH/2-len/2-r;
  track.position.set(x0,0,.004);knob.position.z=.012;g.add(track,knob);
  const hit=hitbox(len+2*r+.02,.04);hit.position.x=x0;hit.userData.onHit=()=>onPress?.();g.add(hit);
  return {group:g,height:.04,hits:[hit],update(now){
    const k=changeAt&&from!==to?ease(Math.max(0,Math.min(1,(now-changeAt)/900))):1,on=(k>=.5?to:from)==='on',p=(from==='on'?1:0)+((to==='on'?1:0)-(from==='on'?1:0))*k;
    knob.position.x=x0-len/2+len*p;track.material.color.setHex(on?C.on:C.off);track.material.emissive.setHex(on?C.on:0);track.material.emissiveIntensity=on?.25:0;}};
}

export function slider({label:text,min=0,max=100,from,to,unit='',onSet,changeAt}){
  const g=new THREE.Group(),l=label(text,{size:.015,color:'#dfe2e7'});l.position.set(-WIDTH/2,.012,0);g.add(l);
  const x0=-WIDTH/2+.004,len=WIDTH-.06,track=rail(len);track.position.set(x0+len/2,-.012,.004);g.add(track);
  const fill=rail(1,.0045,C.accent);fill.material.emissive.setHex(C.accent);fill.material.emissiveIntensity=.25;fill.position.y=-.012;fill.position.z=.005;g.add(fill);
  const thumb=new THREE.Mesh(new THREE.SphereGeometry(.0105,24,16),mat(C.light,{rough:.3}));thumb.position.set(0,-.012,.012);g.add(thumb);
  const hit=hitbox(len+.02,.03);hit.position.set(x0+len/2,-.012,.012);hit.userData.onHit=p=>onSet?.(min+(max-min)*Math.max(0,Math.min(1,(p.x-x0)/len)));g.add(hit);
  let lastText='',valMesh=null;
  return {group:g,height:.05,hits:[hit],update(now){
    const k=changeAt&&from!==to?ease(Math.max(0,Math.min(1,(now-changeAt)/1100))):1,v=from+(to-from)*k,f=Math.max(.001,(v-min)/(max-min));
    fill.scale.x=len*f;fill.position.x=x0+len*f/2;thumb.position.x=x0+len*f;
    const t=`${Math.round(v)}${unit?' '+unit:''}`;if(t!==lastText){lastText=t;if(valMesh){g.remove(valMesh);valMesh.geometry.dispose();}valMesh=label(t,{size:.015,weight:700,align:'right'});valMesh.position.set(WIDTH/2,.012,0);g.add(valMesh);}}};
}

export function segments({label:text,options,from,to,onPick,changeAt}){
  const g=new THREE.Group(),l=label(text,{size:.015,color:'#dfe2e7'});l.position.set(-WIDTH/2,.017,0);g.add(l);
  const gap=.006,w=(WIDTH-gap*(options.length-1))/options.length,pills=[];
  options.forEach((o,i)=>{const p=new THREE.Mesh(pill(w,.026,.006,.01),mat(C.body));p.position.set(-WIDTH/2+w/2+i*(w+gap),-.012,.004);
    const t=label(o,{size:.012,weight:600,align:'center'});t.position.set(p.position.x,-.012,.012);p.userData.onHit=()=>onPick?.(o);g.add(p,t);pills.push([p,t,o]);});
  return {group:g,height:.058,hits:pills.map(p=>p[0]),update(now){
    const k=changeAt&&from!==to?Math.min(1,Math.max(0,(now-changeAt)/500)):1,cur=k>=1?to:from;
    for(const [p,t,o] of pills){const on=o===cur;p.material.color.setHex(on?C.light:C.body);p.position.z=on?.008:.004;t.position.z=on?.016:.012;t.material.color.setHex(on?0x111111:0xffffff);}}};
}

export function buttons({items}){
  // items: [{text, kind: primary|danger|plain, onPress, state: idle|pressed|done}]
  const g=new THREE.Group(),gap=.008,meas=items.map(i=>Math.max(.07,label(i.text,{size:.014}).userData.width+.03));let x=-WIDTH/2;const bodies=[];
  items.forEach((it,i)=>{const w=meas[i],b=new THREE.Mesh(pill(w,.03,.008),mat(it.kind==='primary'?C.light:it.kind==='danger'?C.body:C.body,{rough:.35}));
    b.position.set(x+w/2,0,.004);b.userData.onHit=()=>it.onPress?.();
    const t=label(it.text,{size:.014,weight:700,align:'center',color:it.kind==='primary'?'#111111':it.kind==='danger'?'#ffb3ab':'#ffffff'});t.position.set(b.position.x,0,.014);
    g.add(b,t);bodies.push(b);x+=w+gap;});
  return {group:g,height:.046,hits:bodies};
}

export function progress({title,done,total,unit,totalS,elapsedS,paused,shownAt}){
  const g=new THREE.Group(),t=label(title||'No job',{size:.016,weight:650});t.position.set(-WIDTH/2,.016,0);g.add(t);
  const len=WIDTH-.004,x0=-WIDTH/2+.002,track=rail(len,.005);track.position.set(x0+len/2,-.004,.004);g.add(track);
  const fill=rail(1,.0058,C.accent);fill.material.emissive.setHex(C.accent);fill.material.emissiveIntensity=.3;fill.position.set(0,-.004,.005);g.add(fill);
  // the unit being worked on (a page, a load): a small sheet riding the bar
  const sheet=new THREE.Mesh(new THREE.BoxGeometry(.012,.016,.002),mat(C.light,{rough:.6}));sheet.position.set(0,.004,.012);g.add(sheet);
  let info=null,last='';
  return {group:g,height:.062,hits:[],update(now){
    if(!title){fill.visible=sheet.visible=false;return;}
    const el=Math.min(totalS,(elapsedS||0)+(paused?0:(now-shownAt)/1000)),k=totalS?el/totalS:(done||0)/(total||1),n=Math.min(total||0,Math.floor((total||0)*k));
    fill.scale.x=Math.max(.001,len*k);fill.position.x=x0+len*k/2;sheet.position.x=x0+len*k;sheet.visible=k<1;
    const txt=`${total?`${n} of ${total} ${unit||''}`.trim():''}${totalS?` · ${k>=1?'done':paused?'paused':`${fmt(totalS-el)} left`}`:''}`;
    if(txt!==last){last=txt;if(info){g.remove(info);info.geometry.dispose();}info=label(txt,{size:.013,weight:500,color:'#d6d9de'});info.position.set(-WIDTH/2,-.026,0);g.add(info);}}};
}
const fmt=s=>{s=Math.max(0,Math.round(s));return s>=60?`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`:`${s} s`;};

export function readout({label:text,value}){
  const g=new THREE.Group(),l=label(text,{size:.014,color:'#c9ccd2'});l.position.set(-WIDTH/2,0,0);const v=label(value,{size:.015,weight:700,align:'right'});v.position.set(WIDTH/2,0,0);g.add(l,v);
  return {group:g,height:.03,hits:[]};
}

export function list({label:text,items}){
  const g=new THREE.Group();let y=0;
  if(text){const l=label(text,{size:.013,color:'#9fa3ab'});l.position.set(-WIDTH/2,y,0);g.add(l);y-=.022;}
  for(const it of items){const l=label(it,{size:.014,color:'#e6e8ec'});l.position.set(-WIDTH/2,y,0);g.add(l);y-=.022;}
  return {group:g,height:-y+.008,hits:[]};
}

export function field({label:text,value,sub,chip}){
  const g=new THREE.Group(),l=label(text,{size:.013,color:'#9fa3ab'});l.position.set(-WIDTH/2,0,0);g.add(l);
  const v=label(value,{size:.016,weight:650,maxWidth:WIDTH*.55});
  if(chip){const w=v.userData.width+.03,p=new THREE.Mesh(pill(w,.028,.006,.008),mat(C.body));p.position.set(-WIDTH/2+.07+w/2,0,.003);v.position.set(-WIDTH/2+.085,0,.01);g.add(p);
    const tab=new THREE.Mesh(new THREE.BoxGeometry(.008,.012,.002),mat(C.accent));tab.position.set(-WIDTH/2+.078,0,.01);g.add(tab);v.position.x+=.01;}
  else v.position.set(-WIDTH/2+.07,0,0);
  g.add(v);if(sub){const s=label(sub,{size:.011,color:'#9fa3ab'});s.position.set(v.position.x+v.userData.width+.01,0,0);g.add(s);}
  return {group:g,height:.036,hits:[]};
}

export function text({title,body,onPress,placeholder='…'}){
  const g=new THREE.Group();let y=0;
  if(title){const t=label(title,{size:.016,weight:700});t.position.set(-WIDTH/2+.012,y-.016,.01);g.add(t);y-=.026;}
  const lines=wrapLines(body||placeholder,.0135,WIDTH-.03).slice(0,6);
  for(const ln of lines){const l=label(ln,{size:.0135,weight:400,color:body?'#e6e8ec':'#9fa3ab'});l.position.set(-WIDTH/2+.012,y-.014,.01);g.add(l);y-=.02;}
  const h=-y+.02,box=new THREE.Mesh(pill(WIDTH,h,.004,.012),new THREE.MeshStandardMaterial({color:0x0f1013,roughness:.6,transparent:true,opacity:.78}));box.position.set(0,-h/2+.004,0);
  box.userData.onHit=()=>onPress?.();g.add(box);
  return {group:g,height:h+.012,hits:[box]};
}

const BUILD={header,switch:toggleSwitch,slider,segments,buttons,progress,readout,list,field,text};

/** A panel from a component spec: {rows: [{component, ...props}]} → {group, height, hits, update(now)}. Rows stack from y=0 down. */
export function buildPanel(spec){
  const group=new THREE.Group(),hits=[],ups=[];let y=0;
  for(const row of spec.rows){const make=BUILD[row.component];if(!make)continue;
    const c=make(row);c.group.position.y=y-.02;group.add(c.group);hits.push(...c.hits);if(c.update)ups.push(c.update);y-=c.height+.012;}
  const height=-y;group.children.forEach(ch=>ch.position.y+=height/2);   // centred on the panel's origin
  // a translucent slab behind the components: a solid thing in the room that keeps them legible over a busy background
  const slab=new THREE.Mesh(pill(WIDTH+.05,height+.03,.008,.022),new THREE.MeshStandardMaterial({color:0x111215,roughness:.85,metalness:0,transparent:true,opacity:.58}));
  slab.position.z=-.01;slab.renderOrder=-1;group.add(slab);
  return {group,height,hits,update(now){for(const u of ups)u(now);}};
}

/** A lit scene of its own for panels (drawn over the video like the other overlays). */
export function panelScene(){
  const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x4a4d55,2.2));
  const key=new THREE.DirectionalLight(0xffffff,1.6);key.position.set(.4,1,1.2);scene.add(key);
  return scene;
}
