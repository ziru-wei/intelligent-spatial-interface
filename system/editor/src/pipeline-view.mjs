// The agent log's second view mode: the ModOS pipeline as five stages along a line, each lit when the system reaches it (the trace's
// view_* steps, timed like the rest of the trace, so a replay lights them in step with the video):
//   1 Request        the request's questions and what each is about (the thing looked at, this place, the user, outside data)
//   2 MOD selection  which MODs the questions need (several may be chosen)
//   3 Context info   what each chosen MOD asks for, taken along the twin (no search over the whole space)
//   4 Fill           each chosen MOD's slots, each a component of its own (two per row): its choices (an item, days, an animation, a
//                    motion) and its text, written by the language model
//   5 Represent      the parts the answer shows, each as it becomes ready (the system shows them one by one); done when all have come
// The options are listed from the start (the space's MODs: `skeleton`, from /api/modos/context), greyed until scored, and keep
// their order, so a stage fills in rather than appearing all at once. Where the user is and what they look at go on the camera view
// (whereAt), not here.
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const parse=s=>{try{return JSON.parse(s.text);}catch{return null;}};
// What each part of an answer is, in plain words.
const SHOWS={'situated-text':'text','highlight':'highlight','guidance':'direction arrow','data-widget':'controls','ambient-effect':'sky on a surface','scene-asset':'animation','label':'label','control':'switches','action-card':'draft + Send'};
const itemLabel=id=>String(id).replace(/^(info|user|feed):/,'').replace(/^weather$/,'weather forecast');

/** Option rows: [label, value|null]; a null value is not scored yet (greyed, empty bar). */
function rows(options,chosen,{max=16}={}){
  const pick=new Set([].concat(chosen||[]));
  return `<ul class="pv-opts">${options.slice(0,max).map(([label,v])=>{const on=pick.has(label),scored=v!=null,w=v==='auto'?100:Math.round((+v||0)*100);
    if(v==='skip')return `<li class="skip"><span class="pv-l">${esc(label)}</span><span class="pv-bar"></span><span class="pv-v">not here</span></li>`;
    // another way to show the same need as a better MOD: its score, and which one shows it instead
    if(Array.isArray(v)&&v[0]==='alt')return `<li class="alt"><span class="pv-l">${esc(label)} <em>same need as ${esc(v[2])}</em></span><span class="pv-bar"><i style="width:${Math.round(v[1]*100)}%"></i></span><span class="pv-v">${(+v[1]).toFixed(2)}</span></li>`;
    return `<li class="${on?'on':''}${scored?'':' wait'}"><span class="pv-l">${esc(label)}</span><span class="pv-bar"><i style="width:${scored?w:0}%"></i></span><span class="pv-v">${!scored?'':v==='auto'?'auto':(+v).toFixed(2)}</span></li>`;}).join('')}</ul>`;
}

/** The selectors a MOD's active slots read, and its open slot params (what Fill will choose), from its spec. */
function fillSpec(mod){
  const out=[];
  for(const [name,sel] of Object.entries(mod.selectors||{})){
    if(!mod.slots.some(s=>s.data===name))continue;
    out.push({name,options:sel.from==='allowed'?sel.allowed.map(a=>a.id):sel.kind==='enum'?sel.values:[]});
  }
  for(const s of mod.slots)for(const [p,v] of Object.entries(s.params||{}))if(!('fixed' in v)&&v.allowed?.length>1)out.push({name:`${s.id}.${p}`,options:v.allowed});
  return out;
}

/** The cards for one question (or none: the options only) at the clock's time. */
export function pipelineStages(q,steps,{skeleton=null}={}){
  const by=k=>steps.filter(s=>s.tool===k).map(parse).filter(Boolean);
  const [ctx]=by('view_context'),[g]=by('view_grounding'),[ci]=by('view_context_info'),[m]=by('view_mods'),fills=by('view_fill'),comp=by('view_compose'),[t]=by('view_text');
  // a MOD dropped as another way to show the same need as a better one (view_alternatives): not chosen after all
  const alts=new Map(steps.filter(s=>s.tool==='view_alternatives').flatMap(s=>parse(s)||[]));
  const mods=skeleton?.mods||[],chosen=new Set((m?.chosen||[]).filter(n=>!alts.has(n)));
  const text=steps.filter(s=>s.tool==='show_text');
  const written=text.some(s=>/^Text stream complete/.test(s.text))||(text.length>0&&!text.some(s=>/stream/i.test(s.text)))||!!t?.none;
  const textMod=t&&!t.none?t.mod:null;

  // 1: what the user looks at, and each question of the request with what it is about
  const looked=rows([[g?.looking||ctx?.looking||'what the user looks at',g?(g.looking?g.score??0:null):null]],g?.referent?[g.looking]:[]);
  const asked=g?.questions?.length?`<ul class="pv-qs">${g.questions.map(x=>`<li><span class="pv-qt">“${esc(x.text)}”</span><span class="pv-qa">about <b>${esc(x.about)}</b></span></li>`).join('')}</ul>`
    :'<ul class="pv-qs"><li class="wait"><span class="pv-qt">the questions asked</span><span class="pv-qa">about …</span></li></ul>';
  const request=looked+asked;
  // 3: what each chosen MOD asked for (or, with none, what the questions are about)
  const info=ci?ci.map(r=>`<div class="pv-mod">${esc(r.mod||'no MOD: from what is asked about')}</div><div class="pv-from">from ${esc(r.from.join(' › ')||'—')}</div><div class="pv-chips">${r.items.length?r.items.map(i=>`<span class="pv-chip">${esc(i)}</span>`).join(''):'<span class="pv-res dim">nothing needed</span>'}</div>`).join(''):'<div class="pv-res dim">—</div>';
  // 3
  const modScore=new Map((m?.options||[]).map(o=>[o[0],o[1]])),skipped=new Set(m?.skipped||[]);
  const modNames=mods.length?mods.map(x=>x.name):(m?.options||[]).map(o=>o[0]);
  // Every MOD keeps its row; one not available here (its scope or data) says so instead of a score.
  const selection=rows(modNames.map(n=>[n,!m?null:skipped.has(n)?'skip':alts.has(n)?['alt',modScore.get(n),alts.get(n)]:modScore.get(n)??0]),[...chosen]);
  // 4: the chosen MODs' slots, from their specs first, scored as Fill answers
  const fill=[...chosen].map(name=>{
    const spec=mods.find(x=>x.name===name),done=fills.find(f=>f.mod===name),list=spec?fillSpec(spec):[];
    // Each slot to fill is its own component: a small card, two per row.
    const comps=(done?.selectors?.length?done.selectors:list.map(s=>({name:s.name,options:s.options.map(o=>[o,null]),chosen:[]})))
      .map(s=>({name:s.name,state:done?'done':'wait',html:s.options.length?rows(s.options,s.chosen,{max:6}):rows([['…',null]],[])}));
    const hasText=spec?!!spec.text:name===textMod,mine=name===textMod;
    if(hasText)comps.push({name:'text',state:written&&mine?'done':mine?'active':'wait',html:`<div class="pv-res${written&&mine?'':' dim'}">${written&&mine?'written':mine?'writing…':'by the language model'}</div>`});
    return `<div class="pv-mod">${esc(name)}</div><div class="pv-comps">${comps.map(c=>`<div class="pv-comp ${c.state}"><div class="pv-sel">${esc(c.name)}</div>${c.html}</div>`).join('')}</div>`;
  }).join('');
  // 5: the chosen MODs' slots, each lit when its part is shown
  const shown=new Set(comp.flatMap(c=>c.parts.map(p=>`${c.mod}/${p.slot}`)));
  const parts=[...chosen].flatMap(name=>{const spec=mods.find(x=>x.name===name);
    return (spec?.slots||[]).map(s=>{const isText=s.id===spec.text,textReady=written&&name===textMod;
      const ready=isText?textReady&&(s.use==='situated-text'||shown.has(`${name}/${s.id}`)):shown.has(`${name}/${s.id}`);
      return {mod:name,what:SHOWS[s.use]||s.use,ready,isText};});})
    // once a MOD's parts have come and its text is written, a slot it did not use this time (a one-shot action's controls) drops out
    .filter(p=>p.ready||p.isText||!(written&&comp.some(c=>c.mod===p.mod)));
  const anyReady=parts.some(p=>p.ready),allReady=parts.length>0&&parts.every(p=>p.ready);
  const represent=parts.length?`<ul class="pv-parts">${parts.map(p=>`<li class="${p.ready?'':'pending'}"><span class="pv-chip">${esc(p.mod)}</span> ${esc(p.what)}</li>`).join('')}</ul>`:'<div class="pv-res dim">—</div>';

  const stages=[
    {id:'request',n:1,title:'Request',sub:'what is asked, about what',done:!!g,html:request},
    {id:'mods',n:2,title:'MOD selection',sub:'which MODs to use',done:!!m,html:selection},
    {id:'context',n:3,title:'Context info',sub:'what each MOD asks for',done:!!ci,html:info},
    {id:'fill',n:4,title:'Fill',sub:'each MOD\'s slots',done:!!m&&(!textMod||written)&&!!t,html:fill||'<div class="pv-res dim">—</div>'},
    {id:'represent',n:5,title:'Represent',sub:'what the answer shows',done:!!m&&(allReady||!(m.chosen||[]).length&&written),started:anyReady,html:represent},
  ];
  let active=false;
  for(const s of stages){s.state=s.done?'done':q&&!active&&q.status!=='failed'&&steps.length?(active=true,'active'):'idle';}
  // Represent begins as soon as a part is shown, while Fill may still be writing the text: both are then active.
  const last=stages.at(-1);if(!last.done&&last.started)last.state='active';
  return stages;
}

/** Where the user is and what they look at (the question's context), for a small overlay on the camera view. */
export function whereAt(steps){
  const c=steps.filter(s=>s.tool==='view_context').map(parse).filter(Boolean)[0];
  return c?{in:c.places[0]||null,looking:c.looking}:null;
}

export function renderPipeline(root,q,steps,opts={}){
  if(!q&&!opts.skeleton){root.innerHTML='';return;}
  const stages=pipelineStages(q,steps||[],opts);
  const card=s=>`<section class="pv-stage ${s.state}"><header><i>${s.n}</i><b>${esc(s.title)}</b><small>${esc(s.sub)}</small></header><div class="pv-body">${s.html}</div></section>`;
  root.innerHTML=`<div class="pv">${opts.slowed?`<div class="pv-note">agent time shown at ${opts.slowed}×</div>`:''}${stages.map(card).join('')}</div>`;
}
