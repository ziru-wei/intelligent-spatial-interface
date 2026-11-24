// Where a question being spoken (or typed) made ModOS compute again, marked on its words (design doc 12.16, 12.31): each revision is a
// run of the pipeline (GET /api/agent/questions/runs), placed at the end of the words it answered; a run is marked by what it changed,
// read from its decision record (modos/decisions.mjs; older runs, from their live steps):
//   mods  a MOD's part showed for the first time (the words after it begin a new line)
//   gone  a part was taken away (its MOD no longer needed, or it no longer has it)
//   ui    a part already shown got new data (it was filled again, its cues updated)
//   text  the answer's text or a message's draft was written again
// A run that changed nothing is not marked. And the themes the words speak of (wordThemes): each sentence's theme, numbered in the
// order they come, so the row can shade the words of one theme alike. No dependencies.

const parse=t=>{try{return JSON.parse(t);}catch{return null;}};

/** runs: [{rev, steps}] in order; revisions: [{rev, text}]. → [{at: character offset in the latest words, rev, kinds: [..]}]. */
export function recomputeMarks(runs=[],revisions=[]){
  const lenOf=new Map(revisions.map(r=>[r.rev,String(r.text||'').length])),latest=String(revisions.at(-1)?.text||'').length,out=[];
  const seen=new Set();
  for(const run of runs){
    const kinds=new Set();
    const dec=decisionsOf(run);
    if(dec){
      // a MOD came or went only as seen: its part shows for the first time, or is taken away (a MOD chosen that draws nothing, a spec
      // MOD, is not marked)
      const parts=dec.parts||[];
      if(parts.some(p=>p.change==='new'))kinds.add('mods');
      if(parts.some(p=>p.change==='withdrawn'))kinds.add('gone');
      if(parts.some(p=>p.change==='updated'))kinds.add('ui');
      if(dec.text?.state==='writing'||(run.steps||[]).some(s=>s.tool==='modos_draft'))kinds.add('text');
      if(kinds.size)out.push({at:Math.min(latest,lenOf.get(run.rev)??latest),rev:run.rev,kinds:['mods','gone','ui','text'].filter(k=>kinds.has(k))});
      continue;}
    // older runs (no record): by the parts as they were published
    for(const s of run.steps||[]){
      const v=s.tool==='view_live'?parse(s.text):null;
      for(const k of v?.updated||[])if(seen.has(k))kinds.add('ui');else{seen.add(k);kinds.add('mods');}
      for(const k of v?.withdrawn||[]){seen.delete(k);kinds.add('gone');}
      if(s.tool==='modos_draft'||s.tool==='show_text'&&/^Text stream complete/.test(s.text||''))kinds.add('text');
    }
    if(kinds.size)out.push({at:Math.min(latest,lenOf.get(run.rev)??latest),rev:run.rev,kinds:[...kinds]});
  }
  return out;
}

const decisionsOf=run=>{const s=[...(run.steps||[])].reverse().find(x=>x.tool==='decisions');return s?parse(s.text):null;};

/** The themes the words speak of, from the latest run that has a decision record: [{from, to, themes: [n], ids: [t<id>], mods:
 *  [names]}] per sentence that went to a theme (n: 1, 2, … in the order the themes first come in the words). */
export function wordThemes(runs=[]){
  const dec=[...runs].reverse().map(decisionsOf).find(Boolean);if(!dec)return [];
  const order=[],num=id=>{if(!order.includes(id))order.push(id);return order.indexOf(id)+1;},byId=new Map((dec.themes||[]).map(t=>[t.id,t]));
  return (dec.sentences||[]).filter(s=>s.span&&s.into?.length).map(s=>({from:s.span[0],to:s.span[1],ids:s.into,themes:s.into.map(num),
    mods:[...new Set(s.into.flatMap(id=>Object.entries(byId.get(id)?.mods||{}).filter(([,v])=>v>=.5).map(([k])=>k)))]}));
}
