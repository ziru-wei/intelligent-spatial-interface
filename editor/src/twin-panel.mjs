// The Twin tab: one place to manage the entities of the digital twin (scripts/modos_twin.py), whatever file they come from.
// Three layers, kept apart:
//   Layout    places, which may lie in larger places
//   Fixtures  per place: large static furniture (nested: a shelf of a bookcase), doors and windows, walls and ceilings
//   Objects   per place: items, artifacts and devices, inside furniture or inside one another
// Geometry stays in the Scene tab; this tab edits what ModOS needs to know: kind, category, traits (what representations can
// attach to), where it is (place, and what it is inside), and for a connected device its states and actions. It also lists the
// knowledge attached to each entity.
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const slug=s=>String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);
const KIND_LABEL={place:'Place',structure:'Wall / ceiling',opening:'Door / window',furniture:'Furniture',item:'Item',artifact:'Artifact',device:'Device'};
const byName=(a,b)=>a.name.localeCompare(b.name);

export function createTwinPanel({root,space,session,onPick=()=>{}}){
  let data={entities:[],kinds:[],traits:[]},selected=null,filter='',status='';
  const byId=()=>new Map(data.entities.map(e=>[e.id,e]));
  async function call(method,body){
    const u=new URL('/api/modos/entities',location.href);
    if(method==='GET'){u.searchParams.set('space',space);if(session)u.searchParams.set('session',session);}
    const r=await fetch(u,method==='GET'?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({space,session,...body})});
    const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;
  }
  async function load(){try{data=await call('GET');status='';}catch(e){status='Twin needs the editor server (scripts/server.py): '+e.message;}render();}

  const row=(e,depth)=>`<li class="item twin-row${e.id===selected?' on':''}" data-id="${esc(e.id)}" style="padding-left:${8+depth*14}px"><span class="twin-name">${depth?'↳ ':''}${esc(e.name)}</span>`
    +`<span class="twin-kind">${esc(KIND_LABEL[e.kind]||e.kind)}</span>${(e.traits||[]).map(t=>`<span class="twin-chip">${esc(t)}</span>`).join('')}`
    +`${e.knowledge?.length?`<span class="twin-chip know" title="Knowledge attached">${e.knowledge.length} info</span>`:''}</li>`;

  function lists(){
    const q=filter.toLowerCase();
    if(q){const hits=data.entities.filter(e=>`${e.name} ${e.category} ${e.kind} ${e.id}`.toLowerCase().includes(q)).sort(byName);
      return `<ul class="items">${hits.map(e=>row(e,0)).join('')}</ul>${hits.length?'':'<p class="muted">No match.</p>'}`;}
    const ents=data.entities,map=byId(),places=ents.filter(e=>e.layer==='layout');
    const placeName=id=>map.get(id)?.name||'No place';
    const tree=(list,roots,depth)=>[...roots].sort(byName).map(e=>row(e,depth)+tree(list,list.filter(x=>x.parent===e.id),depth+1)).join('');
    const perPlace=(list,body)=>{
      const g=new Map();for(const e of list){const k=e.place||'';if(!g.has(k))g.set(k,[]);g.get(k).push(e);}
      return [...g.entries()].sort((a,b)=>placeName(a[0]).localeCompare(placeName(b[0])))
        .map(([pid,es])=>`<div class="level"><h4>${esc(placeName(pid))} <span class="muted">${es.length}</span></h4></div>${body(es)}`).join('');
    };
    const layoutRows=(ps,depth)=>[...ps].sort(byName).map(p=>row(p,depth)+layoutRows(places.filter(c=>c.parent===p.id),depth+1)).join('');
    const fixtures=perPlace(ents.filter(e=>e.layer==='fixture'),es=>{
      const furniture=es.filter(e=>e.kind==='furniture'),ids=new Set(furniture.map(f=>f.id));
      const doors=es.filter(e=>e.kind==='opening'),shell=es.filter(e=>e.kind==='structure');
      return `<ul class="items">${tree(furniture,furniture.filter(f=>!ids.has(f.parent)),0)}${[...doors].sort(byName).map(d=>row(d,0)).join('')}</ul>`
        +(shell.length?`<details class="twin-shell"><summary>Walls and ceiling (${shell.length})</summary><ul class="items">${[...shell].sort(byName).map(w=>row(w,0)).join('')}</ul></details>`:'');
    });
    // An object inside furniture starts its own small tree, labelled with the furniture it is in.
    const objects=perPlace(ents.filter(e=>e.layer==='object'),es=>{
      const ids=new Set(es.map(o=>o.id)),roots=es.filter(o=>!ids.has(o.parent));
      return `<ul class="items">${[...roots].sort(byName).map(o=>(o.parent?`<li class="twin-in">in ${esc(map.get(o.parent)?.name||o.parent)}</li>`:'')+row(o,0)+tree(es,es.filter(x=>x.parent===o.id),1)).join('')}</ul>`;
    });
    return `<div class="level"><h3>Layout · places</h3></div><ul class="items">${layoutRows(places.filter(p=>!p.parent),0)}</ul>
      <div class="level"><h3>Fixtures · furniture, doors, windows, walls</h3></div>${fixtures}
      <div class="level"><h3>Objects · items, artifacts, devices</h3></div>${objects}`;
  }

  function detail(){
    const e=byId().get(selected);if(!e)return '';
    // Objects can only be inside objects (never their own descendants); a place can only lie in a place.
    const below=new Set([e.id]);for(let grew=true;grew;){grew=false;for(const x of data.entities)if(below.has(x.parent)&&!below.has(x.id)){below.add(x.id);grew=true;}}
    const containers=data.entities.filter(x=>!below.has(x.id)&&(x.traits||[]).includes('container')&&(e.kind==='furniture'?x.kind==='furniture':['furniture','item','artifact','device'].includes(x.kind)));
    const places=data.entities.filter(x=>x.kind==='place'&&!below.has(x.id));
    const layerOf={place:'layout',structure:'fixture',opening:'fixture',furniture:'fixture',item:'object',artifact:'object',device:'object'};
    const kinds=data.kinds.filter(k=>layerOf[k]===e.layer||(e.layer!=='layout'&&['furniture','item','artifact','device'].includes(k)&&['furniture','item','artifact','device'].includes(e.kind)));
    const placeLabel=e.kind==='place'?'Within':'Place',placeValue=e.kind==='place'?e.parent:e.place,placeFixed=['furniture','item','artifact','device'].includes(e.kind)&&e.parent;
    const canNest=['furniture','item','artifact','device'].includes(e.kind);
    const dev=e.device||{};
    return `<div class="twin-detail"><h3>${esc(e.name)}</h3><p class="muted">${esc(e.id)} · ${e.layer} · from ${esc(e.source)}</p>
      <div class="take-row"><label>Name</label><input id="twin-name" type="text" value="${esc(e.name)}" maxlength="80"></div>
      <div class="take-row"><label>Kind</label><select id="twin-kind">${kinds.map(k=>`<option value="${k}"${k===e.kind?' selected':''}>${esc(KIND_LABEL[k]||k)}</option>`).join('')}</select></div>
      <div class="take-row"><label>Category</label><input id="twin-category" type="text" value="${esc(e.category)}" maxlength="48"></div>
      <div class="take-row"><label>${placeLabel}</label><select id="twin-place"${placeFixed?' disabled title="Set by what it is inside"':''}><option value="">— none —</option>${places.map(p=>`<option value="${esc(p.id)}"${p.id===placeValue?' selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
      ${canNest?`<div class="take-row"><label>${e.kind==='furniture'?'Part of':'Inside'}</label><select id="twin-parent"><option value="">— nothing —</option>${containers.map(p=>`<option value="${esc(p.id)}"${p.id===e.parent?' selected':''}>${esc(p.name)}</option>`).join('')}</select></div>`:''}
      <div class="twin-traits">${data.traits.map(t=>`<label class="switch">${esc(t)}<input class="sw twin-trait" type="checkbox" value="${t}"${(e.traits||[]).includes(t)?' checked':''}></label>`).join('')}</div>
      ${(e.traits||[]).includes('iot')?`<div class="twin-device"><h4>Device</h4>
        <div class="take-row"><label>Protocol</label><input id="twin-protocol" type="text" value="${esc(dev.protocol||'mock')}"></div>
        <div class="take-row"><label>States</label><input id="twin-states" type="text" value="${esc(Object.entries(dev.states||{}).map(([k,v])=>`${k}=${v}`).join(', '))}" placeholder="power=off, brightness=50"></div>
        <div class="take-row"><label>Actions</label><input id="twin-actions" type="text" value="${esc((dev.actions||[]).join(', '))}" placeholder="on, off"></div></div>`:''}
      <div class="twin-know"><h4>Knowledge</h4>${e.knowledge?.length?`<ul>${e.knowledge.map(k=>`<li><b>${esc(k.type)}</b> ${esc(k.summary)}</li>`).join('')}</ul>`:'<p class="muted">None attached. Attach info in Scene › Layout.</p>'}</div>
      <div class="take-row"><button id="twin-save">Save</button>${e.source==='authored'?'<button id="twin-remove">Delete</button>':'<button id="twin-reset" title="Drop what was edited here and go back to what the source files say">Reset</button>'}</div></div>`;
  }

  function render(){
    const containers=data.entities.filter(x=>(x.traits||[]).includes('container')&&['furniture','item','artifact','device'].includes(x.kind)).sort(byName);
    root.innerHTML=`<section class="behavior twin"><div class="panel-head"><h2>Twin</h2><button id="twin-refresh" title="Reload">↻</button></div>
      <p class="muted">Every entity of the space in one place. Layout and objects are kept apart; objects nest by what they are inside. Geometry is edited in the Scene tab.</p>
      ${status?`<p class="muted twin-status">${esc(status)}</p>`:''}
      <div class="take-row"><input id="twin-filter" type="text" placeholder="Filter" value="${esc(filter)}"></div>
      <div class="twin-list">${lists()}</div>
      ${detail()}
      <details class="twin-add"><summary>Add an object</summary>
        <div class="take-row"><select id="twin-add-kind"><option value="item">Item</option><option value="device">Device</option><option value="artifact">Artifact</option><option value="furniture">Furniture (fixture)</option></select><input id="twin-add-name" type="text" placeholder="Name, e.g. desk lamp" maxlength="80"></div>
        <div class="take-row"><label>Place</label><select id="twin-add-place"><option value="">— none —</option>${data.entities.filter(x=>x.kind==='place').sort(byName).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="take-row"><label>Inside</label><select id="twin-add-parent"><option value="">— nothing —</option>${containers.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><button id="twin-add">Add</button></div></details>
    </section>`;
    wire();
  }
  const $=id=>root.querySelector('#'+id);
  async function act(fn){try{await fn();status='';await load();}catch(e){status=e.message;render();}}
  function wire(){
    $('twin-refresh').onclick=load;
    $('twin-filter').oninput=e=>{filter=e.target.value;const pos=e.target.selectionStart;render();const f=$('twin-filter');f.focus();f.setSelectionRange(pos,pos);};
    for(const li of root.querySelectorAll('.twin-row'))li.onclick=()=>{selected=li.dataset.id;render();onPick(selected);};
    const e=byId().get(selected);
    if(e){
      $('twin-save').onclick=()=>act(async()=>{
        const traits=[...root.querySelectorAll('.twin-trait:checked')].map(c=>c.value);
        const patch={name:$('twin-name').value.trim()||e.name,kind:$('twin-kind').value,category:$('twin-category').value.trim(),traits};
        if($('twin-parent'))patch.parent=$('twin-parent').value||null;
        const place=$('twin-place');if(!place.disabled){if(e.kind==='place')patch.parent=place.value||null;else patch.place=place.value||null;}
        if(traits.includes('iot')&&$('twin-protocol'))patch.device={protocol:$('twin-protocol').value.trim()||'mock',
          states:Object.fromEntries($('twin-states').value.split(',').map(s=>s.split('=').map(x=>x.trim())).filter(([k])=>k).map(([k,v])=>[k,v??''])),
          actions:$('twin-actions').value.split(',').map(s=>s.trim()).filter(Boolean)};
        await call('POST',{op:'update',id:e.id,patch});
      });
      if($('twin-remove'))$('twin-remove').onclick=()=>act(async()=>{await call('POST',{op:'remove',id:e.id});selected=null;});
      if($('twin-reset'))$('twin-reset').onclick=()=>act(()=>call('POST',{op:'remove',id:e.id}));
    }
    $('twin-add').onclick=()=>act(async()=>{
      const kind=$('twin-add-kind').value,name=$('twin-add-name').value.trim();if(!name)throw Error('Give the new object a name.');
      const id=`${kind==='device'?'device':'item'}:${slug(name)}`;
      const entity={id,kind,name,category:kind,parent:$('twin-add-parent').value||null,place:$('twin-add-place').value||null,traits:kind==='device'?['iot']:[]};
      await call('POST',{op:'add',entity});selected=id;
    });
  }
  return {load,
    /** The layout selection changed in the 3D view: follow it here. */
    setSelected(id){if(id&&id!==selected&&byId().has(id)){selected=id;render();}}};
}
