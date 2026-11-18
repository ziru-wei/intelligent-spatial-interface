// The Space tab's Entities: one place to manage the entities of the digital twin (scripts/modos_twin.py), whatever file they come from.
// Three layers, kept apart:
//   Layout    places, which may lie in larger places
//   Fixtures  per place: large static furniture (nested: a shelf of a bookcase), doors and windows, walls and ceilings
//   Objects   per place: items, artifacts and devices, inside furniture or inside one another
// It is the data and the panels of the Space tab's Entities: the tree itself is src/layout-outline.mjs (built by src/app.mjs from
// `entities`); for the selected entity, detailFor(id) is its panel, shown under its row: Geometry (the layout editor's tools, mounted by
// the editor through onDetail), Semantics (kind, category, traits: what representations can attach to; where it
// is: place, and what it is inside; for a connected device its inputs, what can be adjusted, and outputs, what can be read) and its
// Knowledge (what is attached to it, and the info editor, mounted by the editor).
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const slug=s=>String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);
const KIND_LABEL={place:'Place',structure:'Wall / ceiling',opening:'Door / window',furniture:'Furniture',item:'Item',artifact:'Artifact',device:'Device'};
const byName=(a,b)=>a.name.localeCompare(b.name);

export function createTwinPanel({addRoot,space,session,onLoad=()=>{},onDetail=()=>{}}){
  let data={entities:[],kinds:[],traits:[]},selected=null,filter='',status='';
  const byId=()=>new Map(data.entities.map(e=>[e.id,e]));
  async function call(method,body){
    const u=new URL('/api/modos/entities',location.href);
    if(method==='GET'){u.searchParams.set('space',space);if(session)u.searchParams.set('session',session);}
    const r=await fetch(u,method==='GET'?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({space,session,...body})});
    const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;
  }
  // While someone types in a mounted tool (a box's label, its info), the tree is rebuilt once they leave the field, not under their hands.
  let deferred=false;
  const typing=()=>!!document.activeElement?.closest?.('.node-detail')&&/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  async function load(){try{data=await call('GET');status='';}catch(e){status='Entities need the editor server (scripts/server.py): '+e.message;}renderAdd();
    if(!typing())return onLoad();if(deferred)return;deferred=true;document.activeElement.addEventListener('blur',()=>{deferred=false;setTimeout(onLoad,0);},{once:true});}
  // The panel under a selected row, flat and compact (the row already names it): Geometry tools on top (mounted by the editor), then
  // Semantics or Knowledge (a seg control, remembered). Every edit is saved as it is made. Where an entity is and what it is inside come
  // from its geometry (the scan's rooms, the layout's nesting) for layout boxes and scene objects, so they are shown, not edited; an
  // entity known only by name (an item, a device) is placed here.
  let pane=(()=>{try{return localStorage.getItem('spatial-take:entity-pane')==='know'?'know':'sem';}catch{return 'sem';}})();
  const hasGeometry=e=>/^(layout|comp):/.test(e.id);
  function detail(id){
    const e=byId().get(id);if(!e)return '';const map=byId(),geo=hasGeometry(e);
    // Objects can only be inside objects (never their own descendants); a place can only lie in a place.
    const below=new Set([e.id]);for(let grew=true;grew;){grew=false;for(const x of data.entities)if(below.has(x.parent)&&!below.has(x.id)){below.add(x.id);grew=true;}}
    const containers=data.entities.filter(x=>!below.has(x.id)&&(x.traits||[]).includes('container')&&(e.kind==='furniture'?x.kind==='furniture':['furniture','item','artifact','device'].includes(x.kind))).sort(byName);
    const places=data.entities.filter(x=>x.kind==='place'&&!below.has(x.id)).sort(byName);
    const layerOf={place:'layout',structure:'fixture',opening:'fixture',furniture:'fixture',item:'object',artifact:'object',device:'object'};
    const kinds=data.kinds.filter(k=>layerOf[k]===e.layer||(e.layer!=='layout'&&['furniture','item','artifact','device'].includes(k)&&['furniture','item','artifact','device'].includes(e.kind)));
    const isPlace=e.kind==='place',canNest=['furniture','item','artifact','device'].includes(e.kind),dev=e.device||{};
    const opt=(list,val,none)=>`<option value="">${none}</option>${list.map(p=>`<option value="${esc(p.id)}"${p.id===val?' selected':''}>${esc(p.name)}</option>`).join('')}`;
    // Where it is: its place is never shown (the tree groups by it, and it follows from where the thing stands or what it is in).
    const where=isPlace?`<label>Within</label><select id="twin-place">${opt(places,e.parent,'—')}</select>`:'';
    // What it is inside: known from the layout's nesting for what has geometry (the tree shows it); set here only for a thing known by name.
    const inside=!canNest||geo?'':`<label>Inside</label><select id="twin-parent">${opt(containers,e.parent,'—')}</select>`;
    const traits=e.traits||[],content=traits.includes('content');
    const know=(e.knowledge||[]).filter(k=>!String(k.id).startsWith('info:'));   // the attached info is edited below, not listed twice
    return `<div class="twin-detail"><div data-slot="geometry"></div>
      <div class="seg ed-tabs" role="group" aria-label="Show"><button data-pane="sem" aria-pressed="${pane==='sem'}">Semantics</button><button data-pane="know" aria-pressed="${pane==='know'}">Knowledge${e.knowledge?.length?` · ${e.knowledge.length}`:''}</button></div>
      <div class="ed-pane" data-pane="sem"${pane==='sem'?'':' hidden'}>
        <div class="ed-grid"><label>Kind</label><select id="twin-kind">${kinds.map(k=>`<option value="${k}"${k===e.kind?' selected':''}>${esc(KIND_LABEL[k]||k)}</option>`).join('')}</select>
          ${where}${inside}</div>
        <label class="switch"><span>With content<button type="button" class="help" data-tip="It carries something to read (a poster, a book, a screen): cues mark it without covering it (Corner Brackets)." aria-label="About this">?</button></span><input id="twin-content" class="sw" type="checkbox"${content?' checked':''}></label>
        <div class="ed-chips" role="group" aria-label="Traits">${data.traits.filter(t=>t!=='content').map(t=>`<button class="chip twin-trait" data-trait="${t}" aria-pressed="${traits.includes(t)}">${esc(t)}</button>`).join('')}</div>
        ${(e.traits||[]).includes('iot')?`<div class="ed-grid"><label>Protocol</label><input id="twin-protocol" type="text" value="${esc(dev.protocol||'mock')}">
          <label>Inputs</label><textarea id="twin-inputs" rows="3" spellcheck="false" title="What can be adjusted: {name: {type, ...}} (toggle, level, choice, color, command, time)">${esc(JSON.stringify(dev.inputs||{}))}</textarea>
          <label>Outputs</label><textarea id="twin-outputs" rows="3" spellcheck="false" title="What can be read: {name: {type, ...}} (reading, level, task, queue, alert, media)">${esc(JSON.stringify(dev.outputs||{}))}</textarea></div>`:''}
        <div class="ed-foot">${e.source==='authored'?'<button id="twin-remove" class="link">Delete</button>':'<button id="twin-reset" class="link" title="Drop what was edited here and go back to what the source files say">Reset to source</button>'}</div></div>
      <div class="ed-pane" data-pane="know"${pane==='know'?'':' hidden'}>
        ${know.length?`<ul class="ed-know">${know.map(k=>`<li><b>${esc(k.type)}</b> ${esc(k.summary)}</li>`).join('')}</ul>`:''}<div data-slot="knowledge"></div></div></div>`;
  }
  // Adding an entity without geometry (an item, a device, an artifact known by name), below the tree.
  function renderAdd(){
    if(!addRoot)return;const containers=data.entities.filter(x=>(x.traits||[]).includes('container')&&['furniture','item','artifact','device'].includes(x.kind)).sort(byName);
    addRoot.innerHTML=`${status?`<p class="muted twin-status">${esc(status)}</p>`:''}<details class="twin-add"><summary>Add an entity by name</summary>
        <div class="take-row"><select id="twin-add-kind"><option value="item">Item</option><option value="device">Device</option><option value="artifact">Artifact</option><option value="furniture">Furniture (fixture)</option></select><input id="twin-add-name" type="text" placeholder="Name, e.g. desk lamp" maxlength="80"></div>
        <div class="take-row"><label>Place</label><select id="twin-add-place"><option value="">— none —</option>${data.entities.filter(x=>x.kind==='place').sort(byName).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="take-row"><label>Inside</label><select id="twin-add-parent"><option value="">— nothing —</option>${containers.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><button id="twin-add">Add</button></div></details>`;
    addRoot.querySelector('#twin-add').onclick=()=>act(addRoot,async()=>{
      const q=id=>addRoot.querySelector('#'+id),kind=q('twin-add-kind').value,name=q('twin-add-name').value.trim();if(!name)throw Error('Give the new entity a name.');
      const id=`${kind==='device'?'device':'item'}:${slug(name)}`;
      await call('POST',{op:'add',entity:{id,kind,name,category:kind,parent:q('twin-add-parent').value||null,place:q('twin-add-place').value||null,traits:kind==='device'?['iot']:[]}});selected=id;
    });
  }
  /** The selected entity's panel (a new element each time; the editor mounts its tools into its slots once it is in the page). */
  function detailFor(id){
    onDetail(null,{});   // the editor takes its mounted tools back before the tree is rebuilt
    const e=byId().get(id);if(!e)return null;selected=id;
    const el=document.createElement('div');el.innerHTML=detail(id);wire(el,e);
    queueMicrotask(()=>{if(el.isConnected)onDetail(e,{geometry:el.querySelector('[data-slot="geometry"]'),knowledge:el.querySelector('[data-slot="knowledge"]')});});
    return el;
  }
  async function act(where,fn){try{await fn();status='';await load();}catch(e){status=e.message;const p=where.querySelector('.twin-status')||where.appendChild(Object.assign(document.createElement('p'),{className:'muted twin-status'}));p.textContent=status;}}
  function wire(el,e){
    const $=id=>el.querySelector('#'+id),save=patch=>act(el,()=>call('POST',{op:'update',id:e.id,patch}));
    for(const b of el.querySelectorAll('[data-pane]'))if(b.tagName==='BUTTON')b.onclick=()=>{pane=b.dataset.pane;try{localStorage.setItem('spatial-take:entity-pane',pane);}catch{}
      for(const x of el.querySelectorAll('button[data-pane]'))x.setAttribute('aria-pressed',x.dataset.pane===pane);for(const x of el.querySelectorAll('.ed-pane'))x.hidden=x.dataset.pane!==pane;};
    $('twin-kind').onchange=ev=>save({kind:ev.target.value});
    if($('twin-place'))$('twin-place').onchange=ev=>save(e.kind==='place'?{parent:ev.target.value||null}:{place:ev.target.value||null});
    if($('twin-parent'))$('twin-parent').onchange=ev=>save({parent:ev.target.value||null});
    const traitsNow=()=>[...el.querySelectorAll('.twin-trait')].filter(x=>x.getAttribute('aria-pressed')==='true').map(x=>x.dataset.trait).concat($('twin-content').checked?['content']:[]);
    for(const c of el.querySelectorAll('.twin-trait'))c.onclick=()=>{c.setAttribute('aria-pressed',c.getAttribute('aria-pressed')!=='true');save({traits:traitsNow()});};
    $('twin-content').onchange=()=>save({traits:traitsNow()});
    const device=()=>{const parse=(id,what)=>{try{return JSON.parse($(id).value||'{}');}catch{throw Error(`${what} is not valid JSON.`);}};
      return act(el,()=>call('POST',{op:'update',id:e.id,patch:{device:{...(e.device||{}),protocol:$('twin-protocol').value.trim()||'mock',inputs:parse('twin-inputs','Inputs'),outputs:parse('twin-outputs','Outputs')}}}));};
    for(const id of ['twin-protocol','twin-inputs','twin-outputs'])if($(id))$(id).onchange=device;
    if($('twin-remove'))$('twin-remove').onclick=()=>act(el,async()=>{await call('POST',{op:'remove',id:e.id});selected=null;});
    if($('twin-reset'))$('twin-reset').onclick=()=>act(el,()=>call('POST',{op:'remove',id:e.id}));
  }
  return {load,detailFor,
    /** A new name for an entity without geometry (a row renamed in the tree). */
    rename:(id,name)=>act(document.body,()=>call('POST',{op:'update',id,patch:{name}})),
    get entities(){return data.entities;},
    get selected(){return selected;},
    setSelected(id){selected=id||null;}};
}
