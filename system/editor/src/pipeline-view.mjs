// The agent log's second view mode: the results of the pipeline's run for the question in view, down a line, read only from that run's
// decision record (modos/decisions.mjs; trace step `decisions`), timed like the rest of the trace so a replay lights them in step with
// the video. Six stages, each its outcome only:
//   1 Request type     each sentence asked about now: information, action, stop_prev or none (the sentence itself is not repeated)
//   2 Theme grounding  the themes of the question: the one each sentence went to, those it uses
//   3 MODs shown       the MODs that show the theme, and those left out for the same need
//   4 Text response    what happens to the text response
//   5 Fill · write     what each MOD shown took, and the text response written
//   6 Shown            the parts as they are now
// Every decision behind them, with all its options, is the pipeline page (pipeline.html), opened by the button at the top; live, it
// follows the question being asked. Where the user is and looks goes on the camera view (whereAt), not here.
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const parse=s=>{try{return JSON.parse(s.text);}catch{return null;}};
const TEXT={writing:'Write the new text',kept:'Keep the text',dimmed:'Fade the earlier text','not yet':'Write nothing yet',none:'No text',withdrawn:'Remove the text',failed:'The text failed'};
const SEL={entries_span:'Days',entries_from:'First day',entries_to:'Last day',entries_focus:'Entry that answers it',entries_focus_time:'Time',recipient:'To',attachment:'With it',capture:'Photo',device:'Device'};
const moment=l=>{const [d,...rest]=String(l).replace(/\s*·\s*$/,'').split(' · ');return [day(d),...rest].filter(Boolean).join(' · ');};
const day=s=>{const m=String(s).match(/^(\w+) (\d{4}-\d{2}-\d{2})(?:, ([^,·]+))?/);return m?`${m[1].slice(0,3)} ${m[2].slice(5)}${m[3]?' '+m[3]:''}`:s;};

/** The stages for one question (or none) at the clock's time: its latest decision record so far. */
export function pipelineStages(q,steps){
  const dec=[...steps].reverse().find(s=>s.tool==='decisions'),r=dec&&parse(dec);
  const order=[];if(r)for(const s of r.sentences)for(const t of s.into)if(!order.includes(t))order.push(t);
  const T=t=>`T${order.indexOf(t)+1}`,th=r?Object.fromEntries(r.themes.map(t=>[t.id,t])):{};
  const words=t=>{const w=(th[t]?.words||'').split(/(?<=[.?!])\s/)[0];return w.length>32?w.slice(0,32)+'…':w;};
  const routed=r?r.sentences.filter(s=>s.routed):[];
  const list=(items,cls='pv-qs')=>`<ul class="${cls}">${items.join('')}</ul>`;
  // 1 what each sentence asked about now wants
  const types=routed.length?list(routed.map(s=>`<li><span class="pv-qa"><b>${esc((s.request_type||[]).join(', ')||'—')}</b></span></li>`))
    :`<div class="pv-res dim">${r?'nothing new':'…'}</div>`;
  // 2 the themes: where each sentence went, and what it uses
  const into=new Set(routed.flatMap(s=>s.into)),uses=new Set(routed.flatMap(s=>s.also_uses));
  const grounding=r?list(r.themes.map(t=>`<li class="${into.has(t.id)?'on':uses.has(t.id)?'rel':''}"><span class="pv-qt">${T(t.id)} “${esc(words(t.id))}”</span><span class="pv-qa">${t.ended?'ended':into.has(t.id)?(t.change==='new'?'begins':'joins')+(t.moved?' · moved':''):uses.has(t.id)?'used':''}</span></li>`),'pv-qs pv-themes')
    :`<div class="pv-res dim">…</div>`;
  // 3 the MODs shown, and those left out for the same need
  const shown=r?r.mods.filter(m=>m.state==='came'||m.state==='stays'):[],instead=r?r.mods.filter(m=>m.state==='instead'):[];
  const mods=r?(shown.length?`<div class="pv-chips">${shown.map(m=>`<span class="pv-chip">${esc(m.name)}</span>`).join(' ')}</div>`:'<div class="pv-res dim">none</div>')
    +instead.map(m=>`<div class="pv-res dim">${esc(m.name)} · same need as ${esc(r.mods.find(x=>x.id===m.instead)?.name||'')}</div>`).join(''):`<div class="pv-res dim">…</div>`;
  // 4 the text response
  const text=r?`<div class="pv-res">${esc(TEXT[r.text.state]||r.text.state)}</div>`:`<div class="pv-res dim">…</div>`;
  // 5 what each MOD shown took, and the text written
  const fills=r?shown.map(m=>{const f=r.fills.find(x=>x.mod===m.id);
    const took=!f?'':f.reused?'<div class="pv-res dim">kept</div>'
      :f.selectors.filter(x=>!/ · /.test(x.name)).map(x=>{const c=[].concat(x.chosen||[]);return `<div class="pv-res"><span class="pv-sel">${esc(SEL[x.name]||x.name)}</span> ${esc(c.length?c.map(v=>/^entries_(from|to)$/.test(x.name)?day(v):x.name==='entries_focus'?moment(v):v).join(', '):'nobody')}</div>`;}).join('');
    return `<div class="pv-mod">${esc(m.name)}</div>${took}`;}).join('')+(r.text.title?`<div class="pv-mod">Text response</div><div class="pv-res">${esc(r.text.title)}</div>`:''):'';
  // 6 the parts as they are now
  const parts=r?list([...r.parts.map(p=>{const [k,mod]=p.id.slice(1).split(':');return `<li class="${p.change==='kept'?'pending':''}"><span class="pv-chip">${esc(r.mods.find(m=>m.id==='m'+mod)?.name||mod)}</span> ${esc(k)} <span class="pv-v">${esc(p.change)}</span></li>`;}),
    `<li class="${r.text.state==='writing'?'':'pending'}"><span class="pv-chip">text</span> <span class="pv-v">${esc(r.text.state==='writing'?'written':r.text.state)}</span></li>`],'pv-parts'):'<div class="pv-res dim">—</div>';
  const stages=[
    {id:'type',n:1,title:'Request type',html:types},
    {id:'grounding',n:2,title:'Theme grounding',html:grounding},
    {id:'mods',n:3,title:'MODs shown',html:mods},
    {id:'text',n:4,title:'Text response',html:text},
    {id:'fill',n:5,title:'Fill · write',html:fills||'<div class="pv-res dim">—</div>'},
    {id:'shown',n:6,title:'Shown',html:parts},
  ];
  // a run under way and not yet recorded: its first stage is active; once recorded, all are done
  const working=!r&&q&&!['answered','failed'].includes(q.status)&&steps.length;
  for(const [i,s] of stages.entries())s.state=r?'done':working&&i===0?'active':'idle';
  return stages;
}

/** Where the user is and what they look at (the question's context), for a small overlay on the camera view. */
export function whereAt(steps){
  const c=steps.filter(s=>s.tool==='view_context').map(parse).filter(Boolean)[0];
  return c?{in:c.places[0]||null,looking:c.looking}:null;
}

/** opts.open: the pipeline page's address for this question (the button at the top opens it). */
export function renderPipeline(root,q,steps,opts={}){
  // its button opens the pipeline page in a tab of its own, never in place of the editor (framed in the Demo, or re-rendered under the press)
  if(!root._opens){root._opens=true;root.addEventListener('click',e=>{const a=e.target.closest('.pv-open');if(!a)return;e.preventDefault();e.stopPropagation();window.open(a.href,'_blank','noopener');});}
  if(!q){root.innerHTML='';return;}
  const stages=pipelineStages(q,steps||[]);
  const card=s=>`<section class="pv-stage ${s.state}"><header><i>${s.n}</i><b>${esc(s.title)}</b></header><div class="pv-body">${s.html}</div></section>`;
  root.innerHTML=`<div class="pv"><div class="pv-head"><span>${esc(q.label||'')}</span>${opts.open?`<a class="pv-open" href="${esc(opts.open)}" target="_blank" rel="noopener" aria-label="Open the pipeline"><svg viewBox="0 0 24 24"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg></a>`:''}</div>${opts.slowed?`<div class="pv-note">agent time shown at ${opts.slowed}×</div>`:''}${stages.map(card).join('')}</div>`;
}
