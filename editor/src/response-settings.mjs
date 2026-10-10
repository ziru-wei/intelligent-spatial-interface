// How agent responses behave: global settings, which every mod (weather, …) can override one by one. An override left at "Default"
// follows the global value. A response belongs to a mod when the mod is on and the response carries its data (r.weather).
// Mods are on unless switched off. Saved in localStorage ('spatial-take:response-settings'): {version, global:{textResponse, resumeOnResponse, autoHide, fallback, fixedText, stability}, mods:{weather:{enabled, overrides}}}.
// No dependencies: used by the editor (src/app.mjs) and tests.

export const SETTINGS={
  textResponse:{label:'Text response',kind:'bool',default:true,title:'Answer in words too; off: no language model runs, only the mod’s own UI'},
  resumeOnResponse:{label:'Resume on first response',kind:'bool',default:false,title:'Resume the video as soon as the first response appears. Weather resumes on its first UI, without waiting for text or the five-second reading pause.'},
  autoHide:{label:'Hide after 5 s',kind:'bool',default:false,title:'Show a response only while it is read, then hide it'},
  fallback:{label:'When no surface fits',kind:'choice',choices:{fixed:'Fixed',floating:'Floating'},default:'fixed',title:'A response always goes on a real surface when one fits. Otherwise it still shows: Fixed, pinned in the recorded user view like the question caption; or Floating, in the room in front of the recorded user view. It returns to a surface when one fits.'},
  fixedText:{label:'Fixed text response',kind:'bool',default:false,title:'Keep the response and its controls at a fixed position in the recorded user view, above hands and scene effects'},
  stability:{label:'Placement stability',kind:'range',default:0,title:'Text & weather stay put longer; reposition when visibility drops'},
};
// A mod declares which global controls it exposes and any additional, private options.
// Omitted overrides = all globals; [] = none. Omitted controls still inherit global values.
export const MODS={
 weather:{label:'Weather mod',title:'Weather answers bring a storybook forecast into the room',owns:r=>!!r?.weather},
 findmy:{label:'FindMy mod',title:'Find stored items: highlight their container and guide you when it is out of view',owns:r=>!!r?.findmy,
  overrides:['textResponse','autoHide','fixedText','resumeOnResponse','fallback'],
  options:{removeOnHandApproach:{label:'Remove effect when hand approaches box',kind:'bool',default:false,title:'Hide the highlight and arrow as soon as a detected hand with valid recorded depth enters the approach range, including on a paused frame. Text stays visible.'},
   handApproachDistance:{label:'Hand approach distance',kind:'range',default:.25,min:.05,max:.5,step:.01,format:v=>`${Math.round(v*100)} cm`,title:'Distance to the box surface, with tolerance for recording depth and alignment. Default 25 cm; increase if touches are missed.'}}},
 ego:{label:'Object mod',title:'Answers about a thing in the room are told by it: a bubble on the object, the object highlighted (its model bounces, grows or changes colour; else its box)',owns:r=>!!r?.ego,
  overrides:['textResponse','autoHide','fixedText','resumeOnResponse','fallback'],
  options:{removeOnHandTouch:{label:'Remove effect when hand touches object',kind:'bool',default:false,title:'Each highlighted object loses its effect or highlight once a detected hand with valid recorded depth touches it, including on a paused frame. Text stays visible.'},
   handTouchDistance:{label:'Hand touch distance',kind:'range',default:.1,min:.02,max:.3,step:.01,format:v=>`${Math.round(v*100)} cm`,title:'Distance to the object\'s box surface that counts as a touch, with tolerance for recording depth and alignment. Default 10 cm.'}}}
};
const KEY='spatial-take:response-settings',VERSION=2;

const cleanValue=(setting,v)=>setting.kind==='bool'?!!v:setting.kind==='choice'?(Object.hasOwn(setting.choices,v)?v:setting.default):Math.min(setting.max??1,Math.max(setting.min??0,Number(v)||0));
const clean=(key,v)=>cleanValue(SETTINGS[key],v);
// The earlier "Float when no surface fits" switch (surfaceFallback): on became Floating; off (hidden) is gone, so Fixed.
function withoutFloatSwitch(raw){
  const move=o=>{if(!o||!('surfaceFallback' in o))return o;const {surfaceFallback,...rest}=o;return 'fallback' in rest?rest:{...rest,fallback:surfaceFallback?'floating':'fixed'};};
  return {...raw,global:move(raw.global),mods:Object.fromEntries(Object.entries(raw.mods||{}).map(([m,r])=>[m,{...r,overrides:move(r?.overrides)}]))};
}
export const modOverrides=mod=>MODS[mod]?.overrides??Object.keys(SETTINGS);
export function normalize(raw={}){
  raw=withoutFloatSwitch(raw);
  // Every mod is on by default. Settings saved before version 2 (or the older per-mod keys) start with all mods on once; a mod
  // switched off after that stays off.
  const allOn=!(raw.version>=VERSION);
  const global=Object.fromEntries(Object.keys(SETTINGS).map(k=>[k,k in (raw.global||{})?clean(k,raw.global[k]):SETTINGS[k].default]));
  const mods=Object.fromEntries(Object.keys(MODS).map(m=>{const r=raw.mods?.[m]||{},o=r.overrides||{};
    return [m,{enabled:allOn||r.enabled!==false,overrides:Object.fromEntries(modOverrides(m).filter(k=>k in o&&o[k]!=null).map(k=>[k,clean(k,o[k])])),
      options:Object.fromEntries(Object.entries(MODS[m].options||{}).map(([k,s])=>[k,r.options?.[k]==null?s.default:cleanValue(s,r.options[k])]))}];}));
  return {version:VERSION,global,mods};
}
/** The mod a response belongs to (null: none, global settings apply). */
export const modOf=(settings,r)=>Object.keys(MODS).find(m=>settings.mods[m]?.enabled&&MODS[m].owns(r))??null;
/** Effective {textResponse, resumeOnResponse, autoHide, fallback, fixedText, stability} for a mod (null: global). */
export function resolve(settings,mod=null){const o=mod?settings.mods[mod]?.overrides||{}:{};
  return {...Object.fromEntries(Object.keys(SETTINGS).map(k=>[k,k in o&&(!mod||modOverrides(mod).includes(k))?o[k]:settings.global[k]])),
    ...Object.fromEntries(Object.entries(MODS[mod]?.options||{}).map(([k,s])=>[k,settings.mods[mod]?.options?.[k]??s.default]))};}

/** A text-first response must not bypass a still-pending mod's explicit Off override. */
export function resumeOnFirstResponse(settings,response,question,records=[]){
  const mod=modOf(settings,response)||records.filter(r=>r.question_id===question.id).map(r=>modOf(settings,r)).find(Boolean);
  if(mod)return resolve(settings,mod).resumeOnResponse;
  const global=resolve(settings).resumeOnResponse;
  if(question.status!=='answered'&&Object.keys(MODS).some(m=>settings.mods[m].enabled&&resolve(settings,m).resumeOnResponse!==global))return false;
  return global;
}

/** What the agent bridge needs to know before answering: {default, <mod>: …} text response on/off, for the mods that are on. */
export const textResponses=s=>({default:resolve(s).textResponse,...Object.fromEntries(Object.keys(MODS).filter(m=>s.mods[m].enabled).map(m=>[m,resolve(s,m).textResponse]))});
// Older keys (one global stability, a weather-only fixed text and the weather switch) carried over once.
function legacy(store){const g=k=>store.getItem(`spatial-take:${k}`);const raw={global:{},mods:{weather:{overrides:{}}}};
  if(g('placement-stability')!=null)raw.global.stability=Number(g('placement-stability'));
  const w=g('weather-mod')??g('weather-mode');if(w!=null)raw.mods.weather.enabled=w==='true';
  if(g('weather-fixed-text')==='true')raw.mods.weather.overrides.fixedText=true;
  return raw;}
export function load(store=globalThis.localStorage){
  try{const s=store.getItem(KEY);return normalize(s?JSON.parse(s):legacy(store));}catch{return normalize();}}
export function save(settings,store=globalThis.localStorage){try{store.setItem(KEY,JSON.stringify(settings));}catch{}}

const pct=v=>`${Math.round(v*100)}%`,show=(key,v)=>SETTINGS[key].kind==='bool'?(v?'On':'Off'):SETTINGS[key].kind==='choice'?SETTINGS[key].choices[v]:pct(v);
/** The panel: global settings, then one card per mod (its switch, and per setting Default / a value of its own). Element ids:
 *  global text-response, agent-autohide, fixed-text, placement-stability; per mod <mod>-mod (switch), <mod>-text-response, <mod>-autohide, <mod>-fixed-text,
 *  <mod>-stability (select: default, on, off / default, custom) and <mod>-stability-value (its slider). extra[mod]: elements to show
 *  inside the mod's card while it is on (e.g. the weather preview). onChange(settings, {mod?, enabled?}). */
export function createResponseSettingsPanel({root,settings,extra={},onChange}){
  const ids={fallback:'fallback',resumeOnResponse:'resume-on-response',textResponse:'text-response',autoHide:'autohide',fixedText:'fixed-text',stability:'stability'},el=(tag,props={},...kids)=>{const e=Object.assign(document.createElement(tag),props);e.append(...kids);return e;};
  const changed=info=>{save(settings);sync();onChange?.(settings,info);};
  const g=el('div',{className:'resp-settings agent-sec'},el('h3',{textContent:'Responses'}));
  const globalId={fallback:'response-fallback',resumeOnResponse:'resume-on-response',textResponse:'text-response',autoHide:'agent-autohide',fixedText:'fixed-text',stability:'placement-stability'};
  const slider=(id,get,set)=>{const out=el('output',{id:id+'-value'}),input=el('input',{id,type:'range',min:0,max:100,step:1});
    input.oninput=()=>{set(Number(input.value)/100);out.textContent=pct(Number(input.value)/100);};return {input,out,sync(){input.value=String(Math.round(get()*100));out.textContent=pct(get());}};};
  const syncs=[];
  for(const [k,s] of Object.entries(SETTINGS)){
    if(s.kind==='bool'){const input=el('input',{id:globalId[k],className:'sw',type:'checkbox'});input.onchange=()=>{settings.global[k]=input.checked;changed({});};
      g.append(el('label',{className:'switch',title:s.title},s.label,input));syncs.push(()=>{input.checked=settings.global[k];});}
    else if(s.kind==='choice'){const select=el('select',{id:globalId[k],title:s.title},...Object.entries(s.choices).map(([v,t])=>el('option',{value:v,textContent:t})));
      select.onchange=()=>{settings.global[k]=select.value;changed({});};g.append(el('label',{className:'switch choice',title:s.title},s.label,select));syncs.push(()=>{select.value=settings.global[k];});}
    else{const sl=slider(globalId[k],()=>settings.global[k],v=>{settings.global[k]=v;changed({});});sl.input.setAttribute('aria-label',s.label);
      g.append(el('div',{className:'placement-stability',title:s.title},el('label',{htmlFor:globalId[k]},s.label+' ',sl.out),sl.input,
        el('div',{className:'range-ends'},el('span',{textContent:'Follow view'}),el('span',{textContent:'Hold position'}))));syncs.push(sl.sync);}
  }
  root.append(g);
  // Mods: a seg control picks which mod's card is shown (remembered in this browser); each card has its own on/off switch.
  const keyTab='spatial-take:agent-mod-tab',seg=el('div',{className:'seg mod-tabs'}),cards={};
  let tab=(()=>{try{return localStorage.getItem(keyTab);}catch{return null;}})();if(!(tab in MODS))tab=Object.keys(MODS)[0];
  const showTab=t=>{tab=t;try{localStorage.setItem(keyTab,t);}catch{}for(const b of seg.children)b.setAttribute('aria-pressed',b.dataset.mod===t);for(const [k,c] of Object.entries(cards))c.hidden=k!==t;};
  for(const [m,mod] of Object.entries(MODS)){const b=el('button',{type:'button',textContent:mod.label.replace(/ mod$/i,''),title:mod.title});b.dataset.mod=m;b.onclick=()=>showTab(m);seg.append(b);}
  const modsSec=el('div',{className:'agent-sec mods'},el('h3',{textContent:'Mods'}),seg);root.append(modsSec);
  for(const [m,mod] of Object.entries(MODS)){
    const on=el('input',{id:`${m}-mod`,className:'sw',type:'checkbox'}),body=el('div',{className:'mod-body'}),card=el('div',{className:'mod-card'},el('label',{className:'switch mod-switch',title:mod.title},mod.label,on),body);cards[m]=card;
    on.onchange=()=>{settings.mods[m].enabled=on.checked;changed({mod:m,enabled:on.checked});};
    body.append(el('div',{className:'mod-note',textContent:'Overrides for this mod’s responses'}));
    for(const k of modOverrides(m)){
      const s=SETTINGS[k];
      const id=`${m}-${ids[k]}`,o=()=>settings.mods[m].overrides,select=el('select',{id,title:s.title});select.setAttribute('aria-label',`${mod.label}: ${s.label}`);
      const row=el('div',{className:'override'},el('label',{htmlFor:id,textContent:s.label}),select);body.append(row);
      if(s.kind==='bool'){select.onchange=()=>{select.value==='default'?delete o()[k]:o()[k]=select.value==='on';changed({mod:m});};
        syncs.push(()=>{select.replaceChildren(el('option',{value:'default',textContent:`Default · ${show(k,settings.global[k])}`}),el('option',{value:'on',textContent:'On'}),el('option',{value:'off',textContent:'Off'}));
          select.value=k in o()?(o()[k]?'on':'off'):'default';row.classList.toggle('set',k in o());});}
      else if(s.kind==='choice'){select.onchange=()=>{select.value==='default'?delete o()[k]:o()[k]=select.value;changed({mod:m});};
        syncs.push(()=>{select.replaceChildren(el('option',{value:'default',textContent:`Default · ${show(k,settings.global[k])}`}),...Object.entries(s.choices).map(([v,t])=>el('option',{value:v,textContent:t})));
          select.value=k in o()?o()[k]:'default';row.classList.toggle('set',k in o());});}
      else{const sl=slider(`${id}-value`,()=>o()[k]??settings.global[k],v=>{o()[k]=v;changed({mod:m});});sl.input.setAttribute('aria-label',`${mod.label}: ${s.label}`);
        const wrap=el('div',{className:'override-range'},sl.input,sl.out);row.after(wrap);
        select.onchange=()=>{select.value==='default'?delete o()[k]:o()[k]=settings.global[k];changed({mod:m});};
        syncs.push(()=>{select.replaceChildren(el('option',{value:'default',textContent:`Default · ${show(k,settings.global[k])}`}),el('option',{value:'custom',textContent:'Custom'}));
          select.value=k in o()?'custom':'default';wrap.hidden=!(k in o());row.classList.toggle('set',k in o());sl.sync();});}
    }
    for(const [k,s] of Object.entries(mod.options||{})){
      const id=`${m}-${k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}`;
      if(s.kind==='bool'){
        const input=el('input',{id,className:'sw',type:'checkbox'});
        input.onchange=()=>{settings.mods[m].options[k]=input.checked;changed({mod:m,option:k});};
        body.append(el('label',{className:'switch',title:s.title},s.label,input));
        syncs.push(()=>{input.checked=settings.mods[m].options[k];});
      }else if(s.kind==='range'){
        const input=el('input',{id,type:'range',min:s.min??0,max:s.max??1,step:s.step??.01}),out=el('output');
        input.oninput=()=>{settings.mods[m].options[k]=cleanValue(s,input.value);changed({mod:m,option:k});};
        body.append(el('label',{htmlFor:id,title:s.title},s.label+' ',out),input);
        syncs.push(()=>{input.value=String(settings.mods[m].options[k]);out.textContent=s.format?s.format(settings.mods[m].options[k]):input.value;});
      }
    }
    for(const e of extra[m]||[])body.append(e);
    syncs.push(()=>{on.checked=settings.mods[m].enabled;body.hidden=!on.checked;card.classList.toggle('on',on.checked);seg.querySelector(`[data-mod=${m}]`).classList.toggle('off',!on.checked);});
    modsSec.append(card);
  }
  showTab(tab);
  function sync(){for(const f of syncs)f();}
  sync();return {sync};
}

/** Explain a hidden mod effect without changing the user's saved toggles. */
export function disabledResponseMods(settings,responses){
 return Object.keys(MODS).filter(m=>!settings.mods[m]?.enabled&&responses.some(r=>MODS[m].owns(r)));
}
