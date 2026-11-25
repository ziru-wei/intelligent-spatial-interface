// What people adjust in the editor that is not a MOD (modos-system-design.md 4.4, 5.4): the UI library's own parameters and the replay.
// A MOD's choices (on/off, its representation, how long its text stays, whether the sky is locked) are MOD
// settings, tailored in the MODs tab and carried by each part (`mod.settings`; read with modSetting); nothing here overrides them.
//   text    Write on surfaces: Embedded Text where its MOD declares it and a surface scores well (surface.score ≥ 0.5), else every
//           answer is Floating Text (the default); Stability: how long text stays put before it moves to a better spot; Anchor dialogue
//           bubble: the bubble fixed above its thing, turned to the user, instead of moving to where it fits
//   replay  Resume on first response: the replay goes on as soon as the first part of an answer shows
//   speech  How speech to text cuts and cleans what is said (Doubao, scripts/asr-relay.mjs): sentences by meaning instead of after
//           1.2 s of silence; fillers (um, uh) removed. Each recognition uses them as they are when it opens; a spoken question keeps
//           the ones it was heard with (audio.asr)
// Text's lettering and writing stay in their own store (src/app.mjs textBehavior). No dependencies.

export const SETTINGS={
  text:{embed:{label:'Write on surfaces',kind:'bool',default:false,
    help:'On: an answer is written onto a surface near it when its MOD declares Embedded Text and the surface scores well for writing (0.5 or more). Off: every answer is Floating Text, fixed in view above the question.'},
    stability:{label:'Stability',kind:'range',default:0,min:0,max:1,step:.01,ends:['Moves freely','Stays put'],
    help:'How long text stays where it is before moving to a better spot when it is hidden or hard to read.'},
    bubbleAnchored:{label:'Anchor dialogue bubble',kind:'bool',default:false,
      help:'On: an Object-centric Dialogue bubble stays just above the thing that speaks and keeps turning to the user. Off: it moves to where it fits in view (onto the thing\'s side, or held at the view\'s edge).'}},
  speech:{meaning:{label:'Split sentences by meaning',kind:'bool',default:false,
      help:'On: speech to text ends a sentence where its meaning does (Doubao\'s semantic segmentation). Off: a sentence ends after 1.2 s of silence.'},
    fillers:{label:'Remove fillers',kind:'bool',default:false,help:'On: speech to text leaves out fillers and repeats (um, uh, I I mean), Doubao\'s smoothing.'}},
  replay:{resumeOnResponse:{label:'Resume on first part',kind:'bool',default:false,
    help:'In a replay, go on as soon as the first part of an answer shows, without waiting for the text and the reading pause.'}},
};
const KEY='spatial-take:ui-settings',OLD='spatial-take:response-settings';

const clean=(s,v)=>s.kind==='bool'?!!v:Math.min(s.max,Math.max(s.min,Number.isFinite(Number(v))?Number(v):s.default));
export function normalize(raw={}){
  return Object.fromEntries(Object.entries(SETTINGS).map(([g,set])=>[g,Object.fromEntries(Object.entries(set).map(([k,s])=>[k,raw?.[g]?.[k]==null?s.default:clean(s,raw[g][k])]))]));
}
// Settings saved by the earlier Agent panel (global responses and per-mod options) carried over once.
function fromOld(old){return {text:{stability:old?.global?.stability},replay:{resumeOnResponse:old?.global?.resumeOnResponse}};}
export function load(store=globalThis.localStorage){
  try{const s=store.getItem(KEY);if(s)return normalize(JSON.parse(s));const o=store.getItem(OLD);return normalize(o?fromOld(JSON.parse(o)):{});}catch{return normalize();}
}
export function save(settings,store=globalThis.localStorage){try{store.setItem(KEY,JSON.stringify(settings));}catch{}}

/** A MOD setting a part carries (modos/compose.mjs `mod.settings`): kind is the part's kind in a merged answer (findmy, highlight, ego,
 *  weather, text), so each keeps its own MOD's. */
import {currentMeta,currentText} from './current-mods.mjs';
export function modSetting(r,kind,name){
  const m=kind==='text'?currentText(r).text_mod:currentMeta(r?.mods?.[kind]||(r?.[kind]?r?.mod:null));
  return m?.settings?.[name]??null;
}

/** What placement and showing read for an answer: the library's stability and bubble anchoring, and whether its text goes after reading (its MOD's
 *  situated-text `duration: 5s`). */
export const answerSettings=(settings,r)=>({embed:settings.text.embed,stability:settings.text.stability,bubbleAnchored:settings.text.bubbleAnchored,autoHide:modSetting(r,'text','duration')==='5s'});

/** Whether the replay goes on at an answer's first part. */
export const resumeOnFirstResponse=settings=>!!settings.replay.resumeOnResponse;

/** What a recognition is opened with (scripts/asr-relay.mjs /asr/open): {split: 'silence'|'meaning', fillers: kept|removed}. */
export const speechOptions=settings=>({split:settings.speech.meaning?'meaning':'silence',fillers:settings.speech.fillers?'removed':'kept'});

/** Controls for one group (text, replay) in root (before `before`, if given): a switch per bool, a slider per range, each with
 *  its explanation behind a "?" (data-tip, shown by the editor's tooltip). onChange(settings, key). */
export function settingsControls({root,group,settings,onChange,before=null}){
  const el=(tag,props={},...kids)=>{const e=Object.assign(document.createElement(tag),props);e.append(...kids);return e;};
  const fmt=(s,v)=>s.unit==='cm'?`${Math.round(v*100)} cm`:`${Math.round(v*100)}%`;
  const help=s=>s.help?el('button',{type:'button',className:'help',textContent:'?',ariaLabel:'About this'},):'',put=n=>before?root.insertBefore(n,before):root.append(n);
  for(const [k,s] of Object.entries(SETTINGS[group])){
    const id=`${group}-${k}`,h=help(s);if(h)h.dataset.tip=s.help;
    if(s.kind==='bool'){const input=el('input',{id,className:'sw',type:'checkbox',checked:settings[group][k]});
      input.onchange=()=>{settings[group][k]=input.checked;save(settings);onChange?.(settings,k);};put(el('label',{className:'switch'},el('span',{},s.label,h),input));continue;}
    const out=el('output',{id:id+'-value',textContent:fmt(s,settings[group][k])}),input=el('input',{id,type:'range',min:s.min,max:s.max,step:s.step,value:settings[group][k]});
    input.oninput=()=>{settings[group][k]=clean(s,input.value);out.textContent=fmt(s,settings[group][k]);save(settings);onChange?.(settings,k);};
    put(el('div',{className:'placement-stability'},el('label',{htmlFor:id},el('span',{},s.label,h),' ',out),input,
      ...(s.ends?[el('div',{className:'range-ends'},el('span',{textContent:s.ends[0]}),el('span',{textContent:s.ends[1]}))]:[])));
  }
}
