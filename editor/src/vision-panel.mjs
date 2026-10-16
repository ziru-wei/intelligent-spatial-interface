// The Vision Pro app's settings in the editor (?vision=1, or /vision.html): the space's scan and boxes in the 3D view, edited as ever
// (Scene tab: layout, objects, info), with the recorded camera hidden; a Vision Pro tab sets what the headset's window sets (the same
// names as scripts/vision.py DEFAULTS). The headset reads both within seconds. Tune: the headset's alignment, by hand in the 3D view
// (src/app.mjs startHeadsetTune). Questions: those asked on the headset (its live session), each deletable.
const SECTIONS=[
  ['Room',[['roomView','Room view','switch'],['followMode','Bar follows me','select',[['lazy','Lazily'],['realtime','In real time']]],['zone','I am in','zone'],['occlusion','Real things hide answers','switch'],['stability','Placement stability','range',0,1,.05,v=>`${Math.round(v*100)}%`]]],
  ['Answer text',[['bodySize','Body size','range',.6,2.5,.05,v=>`${(+v).toFixed(2)}×`],['showHeading','Show heading','switch'],['headingSize','Heading size','range',.5,2,.05,v=>`${(+v).toFixed(2)}×`],
    ['writing','Write answers','switch'],['writingStrokes','Pen strokes','switch'],['writingSpeed','Writing speed','range',5,120,1,v=>`${Math.round(v)} chars/s`]]],
  ['Info',[['selectionMode','Selection decided by','select',[['jev','Jev judgement'],['score','Score only']]],['infoMinShrink','Smallest on a surface','range',.25,1,.05,v=>`${Math.round(v*100)}%`],
    ['floatParallel','Parallel to the box within','range',0,90,1,v=>`${Math.round(v)}°`],['arrowWidth','Arrow thickness','range',.5,3,.05,v=>`${(+v).toFixed(2)}×`]]],
  ['Weather mod',[['weatherMod','Weather mod','switch'],['weatherLock','Lock location','switch']]],
  ['FindMy mod',[['findmyMod','FindMy mod','switch'],['findmyRemoveOnApproach','Remove when a hand approaches','switch'],['findmyApproach','Approach distance','range',.05,.5,.01,v=>`${Math.round(v*100)} cm`]]],
];
export function visionMode(){return new URLSearchParams(location.search).get('vision')==='1';}
export function createVisionPanel({space,$,onTune}){
  let settings=null;const inputs={};
  const session=`./spaces/${space}/scenarios/vision-live/session.json`;
  // Alignment: Tune (the bar over the 3D view then has Undo, Redo, Reset, Save, Cancel, as for a recording).
  {const sec=document.createElement('div');sec.className='agent-sec';sec.append(Object.assign(document.createElement('h3'),{textContent:'Alignment'}));
    const b=Object.assign(document.createElement('button'),{textContent:'Tune'});b.onclick=()=>onTune?.();
    const st=Object.assign(document.createElement('p'),{id:'vision-tune-status',className:'muted'});sec.append(b,st);$('vision-controls').append(sec);}
  const post=fields=>fetch('/api/vision/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({space,settings:fields})})
    .then(r=>r.json()).then(d=>{if(d.error)throw Error(d.error);settings=d;show();}).catch(e=>{$('vision-status').textContent=e.message;});
  // The controls, as the editor's own (switches, sliders with their value, selects).
  for(const [title,rows] of SECTIONS){
    const sec=document.createElement('div');sec.className='agent-sec';sec.append(Object.assign(document.createElement('h3'),{textContent:title}));
    for(const [key,label,kind,a,b,step,format] of rows){
      if(kind==='switch'){const l=document.createElement('label');l.className='switch';const i=Object.assign(document.createElement('input'),{type:'checkbox',className:'sw'});l.append(label,i);i.onchange=()=>post({[key]:i.checked});inputs[key]={kind,i};sec.append(l);}
      else if(kind==='range'){const d=document.createElement('div');d.className='placement-stability';const l=document.createElement('label'),o=document.createElement('output');l.append(label+' ',o);
        const i=Object.assign(document.createElement('input'),{type:'range',min:a,max:b,step});i.oninput=()=>{o.textContent=format(+i.value);};i.onchange=()=>post({[key]:+i.value});d.append(l,i);inputs[key]={kind,i,o,format};sec.append(d);}
      else{const l=document.createElement('label');l.className='switch';const sel=document.createElement('select');if(kind==='select')sel.append(...a.map(([v,t])=>new Option(t,v)));
        l.append(label,sel);sel.onchange=()=>post({[key]:kind==='zone'?sel.value||null:sel.value});inputs[key]={kind,i:sel};sec.append(l);}
    }
    $('vision-controls').append(sec);
  }
  function show(){
    if(!settings)return;
    for(const [key,c] of Object.entries(inputs)){const v=settings[key];
      if(c.kind==='switch')c.i.checked=!!v;else if(c.kind==='range'){if(document.activeElement!==c.i)c.i.value=v;c.o.textContent=c.format(+c.i.value);}else c.i.value=v??'';}
    const ago=settings.headsetSeen?Math.round(Date.now()/1000-settings.headsetSeen):null;
    $('vision-status').textContent=ago!=null&&ago<10?'Headset connected':ago!=null?`Headset last seen ${ago} s ago`:'Headset not connected';
  }
  const load=()=>fetch(`/api/vision/settings?space=${encodeURIComponent(space)}`).then(r=>r.json()).then(d=>{settings=d;show();}).catch(()=>{});
  // Questions asked on the headset, newest first, each with its answer's first words and a delete button; Delete all.
  const qsec=document.createElement('div');qsec.className='agent-sec';
  const qhead=document.createElement('h3');qhead.textContent='Questions asked on the headset';
  const all=Object.assign(document.createElement('button'),{textContent:'Delete all'}),list=document.createElement('div');list.className='vision-questions';
  qsec.append(qhead,all,list);$('vision-controls').append(qsec);
  const get=(path,q)=>fetch(`${path}?${new URLSearchParams({session,...q})}`).then(r=>r.json()).then(d=>{if(d.error)throw Error(d.error);return d;});
  const send=(path,body)=>fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,...body})}).then(r=>r.json()).then(d=>{if(d.error)throw Error(d.error);return d;});
  let shownKey='';
  async function loadQuestions(){
    try{
      const convs=await get('/api/agent/conversations',{}),rows=[];
      for(const c of (Array.isArray(convs)?convs:convs.conversations||[]).filter(c=>c.questions>0)){
        const st=await get('/api/agent/status',{conversation:c.id});
        for(const q of st.questions){const r=st.responses.filter(x=>x.question_id===q.id&&(x.title||x.body)).at(-1);rows.push({c:c.id,q,answer:r?[r.title,r.body].filter(Boolean).join(' — '):''});}
      }
      rows.sort((a,b)=>(b.q.created||0)-(a.q.created||0));
      const key=rows.map(r=>`${r.c}/${r.q.id}/${r.q.status}/${r.answer.length}`).join('|');if(key===shownKey)return;shownKey=key;
      list.replaceChildren(...rows.map(r=>{const d=document.createElement('div');d.className='vision-question';
        const t=document.createElement('div');t.innerHTML='';const b=document.createElement('b');b.textContent=r.q.text;const a=document.createElement('small');
        a.textContent=(r.q.created?new Date(r.q.created*1000).toLocaleString()+' · ':'')+(r.answer?r.answer.slice(0,120):r.q.status);t.append(b,document.createElement('br'),a);
        const x=Object.assign(document.createElement('button'),{textContent:'Delete',title:'Delete this question and its answer'});
        x.onclick=async()=>{x.disabled=true;try{await send('/api/agent/questions/delete',{conversation:r.c,id:r.q.id});}catch(e){$('vision-status').textContent=e.message;}shownKey='';loadQuestions();};
        d.append(t,x);return d;}));
      all.disabled=!rows.length;if(!rows.length)list.textContent='None yet.';
    }catch(e){list.textContent=e.message;}
  }
  all.onclick=async()=>{if(!confirm('Delete every question asked on the headset, with its answers?'))return;all.disabled=true;
    try{const convs=await get('/api/agent/conversations',{});for(const c of (Array.isArray(convs)?convs:convs.conversations||[]))await send('/api/agent/conversations/delete',{conversation:c.id});}
    catch(e){$('vision-status').textContent=e.message;}shownKey='';loadQuestions();};
  return {
    // Zones from the layout (rooms with a floor).
    setLayout(sem){inputs.zone.i.replaceChildren(new Option('Anywhere',''),...(sem?.rooms||[]).filter(r=>r.floorY!=null).map(r=>new Option(r.name||r.id,r.id)));show();},
    start(){load();setInterval(load,2000);loadQuestions();setInterval(()=>{if(!document.hidden)loadQuestions();},8000);},
  };
}
