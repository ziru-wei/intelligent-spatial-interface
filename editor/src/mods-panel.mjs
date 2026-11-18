// The MODs tab: tailor the space's MODs without writing one (scripts/modos_registry.py). A MOD's author defines what can change;
// here people pick among it:
//   Representation  one of the MOD's variants (which primitive representations it shows, and where its text goes)
//   Settings        settled params of its slots (how long text stays, when a highlight goes away, an object's motion, ...)
//   Where           everywhere, or only in some places (a MOD scoped to "what the user asks about" stays so)
//   Knowledge       extra items it may read; Examples: extra questions it should answer
//   Duplicate       a new MOD from this one (same parts, its own choices), e.g. "Weather, text only" for the bedroom
// Base MODs can be reset to how their author made them; duplicates can be deleted. Every change is checked by the server first.
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const slug=s=>String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);
const USE={'situated-text':'text','ego-object':'object speaks','highlight':'highlight','guidance':'direction','data-widget':'controls','ambient-effect':'ambient','scene-asset':'animation','label':'label','control':'device control'};
const PARAM={duration:'Text stays',lock:'Sky'};
const VALUE={stay:'until the next answer','5s':'5 seconds',follow:'moves to where you look',lock:'stays where it first showed'};

export function createModsPanel({root,space}){
  let mods=[],places=[],items=[],open=null,status='';
  async function call(method,body){
    const u=new URL('/api/modos/mods',location.href);if(method==='GET')u.searchParams.set('space',space);
    const r=await fetch(u,method==='GET'?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({space,...body})});
    const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;
  }
  async function load(){
    try{
      mods=(await call('GET')).mods;status='';
      const u=new URL('/api/modos/entities',location.href);u.searchParams.set('space',space);
      const t=await (await fetch(u)).json();
      places=(t.entities||[]).filter(e=>e.layer==='layout');
      items=[...new Map((t.entities||[]).flatMap(e=>e.knowledge||[]).map(k=>[k.id,k])).values()];
    }catch(e){status='MODs need the editor server (scripts/server.py): '+e.message;}
    render();
  }
  const $=id=>root.querySelector('#'+id);
  async function act(body){try{mods=(await call('POST',body)).mods;status='';}catch(e){status=e.message;}render();}

  function card(m){
    const on=m.id===open,origin=m.origin==='fork'?`copy of ${esc(mods.find(x=>x.id===m.from)?.name||m.from)}`:m.extends?`extends ${esc(mods.find(x=>x.id===m.extends)?.name||m.extends)}`:'foundational';
    const head=`<div class="mod-head" data-open="${esc(m.id)}"><span class="mod-name">${esc(m.name)}</span><span class="twin-chip">${origin}</span>`
      +`${m.customized&&m.origin==='base'?'<span class="twin-chip know">tailored</span>':''}<span class="mod-variant">${esc(m.variants.find(v=>v.id===m.variant)?.label||'')}</span>`
      +`<label class="switch" title="Installed in this space"><input class="sw mod-install" data-id="${esc(m.id)}" type="checkbox"${m.installed?' checked':''}></label></div>`;
    if(!on)return `<li class="mod-card">${head}</li>`;
    const variants=m.variants.length?`<h4>Representation</h4><div class="mod-variants">${m.variants.map(v=>`<label class="mod-v${v.id===m.variant?' on':''}"><input type="radio" name="mod-variant" value="${esc(v.id)}"${v.id===m.variant?' checked':''}>`
      +`<b>${esc(v.label)}</b><span>${esc(v.description)}</span><span>${v.slots.map(s=>`<i class="twin-chip${s.id===v.text?' know':''}">${esc(USE[s.use]||s.use)}</i>`).join('')}</span></label>`).join('')}</div>`:'';
    const settings=m.settings.filter(s=>s.active);
    const sets=settings.length?`<h4>Settings</h4>${settings.map(s=>`<div class="take-row"><label title="${esc(s.slot)} · ${esc(s.use)}">${esc(PARAM[s.param]||s.param)}${settings.filter(x=>x.param===s.param).length>1?` <span class="muted">(${esc(USE[s.use]||s.slot)})</span>`:''}</label>`
      +`<select class="mod-setting" data-slot="${esc(s.slot)}" data-param="${esc(s.param)}">${s.values.map(v=>`<option value="${esc(v)}"${v===s.value?' selected':''}>${esc(VALUE[v]||v)}</option>`).join('')}</select></div>`).join('')}`:'';
    const fixedScope=m.base_scope==='referent';
    const chosen=Array.isArray(m.scope)?new Set(m.scope):new Set();
    const where=`<h4>Where</h4>${fixedScope?'<p class="muted">Whatever the user asks about.</p>':`<label class="switch">Everywhere<input id="mod-global" class="sw" type="checkbox"${m.scope==='global'?' checked':''}></label>`
      +`<div class="mod-places"${m.scope==='global'?' hidden':''}>${places.map(p=>`<label><input type="checkbox" class="mod-place" value="${esc(p.id)}"${chosen.has(p.id)?' checked':''}> ${esc(p.name)}</label>`).join('')}</div>`}`;
    const knowledge=`<h4>Knowledge</h4><p class="muted">${m.knowledge.map(k=>esc(k.ref||k.type)).join(', ')||'none'}</p>`
      +`<div class="mod-places">${items.filter(i=>!m.knowledge.some(k=>k.ref===i.id)).map(i=>`<label title="${esc(i.summary)}"><input type="checkbox" class="mod-know" value="${esc(i.id)}"${m.extra_knowledge.some(k=>k.ref===i.id)?' checked':''}> ${esc(i.id)}</label>`).join('')}</div>`;
    const examples=`<h4>Examples</h4><p class="muted">${m.examples.map(esc).join(' / ')}</p><textarea id="mod-examples" rows="2" placeholder="More questions it should answer, one per line">${esc(m.extra_examples.join('\n'))}</textarea>`;
    return `<li class="mod-card on">${head}<p class="muted">${esc(m.description)}</p>${variants}${sets}${where}${knowledge}${examples}
      <div class="take-row"><button id="mod-save">Save</button>${m.origin==='base'?`<button id="mod-reset"${m.customized?'':' disabled'} title="Back to how its author made it">Reset</button>`:'<button id="mod-remove">Delete</button>'}</div>
      <details class="twin-add"><summary>Duplicate as a new MOD</summary><div class="take-row"><input id="mod-fork-name" type="text" placeholder="Name, e.g. ${esc(m.name)} (bedroom)" maxlength="60"><button id="mod-fork">Duplicate</button></div></details></li>`;
  }

  function render(){
    root.innerHTML=`<section class="behavior twin mods"><div class="panel-head"><h2>MODs <button type="button" class="help" data-tip="Tailor what each MOD shows in this space: pick a representation, settle its settings, choose where it applies, or duplicate it. The parts and decisions stay the MOD author's." aria-label="About this">?</button></h2><button id="mods-refresh" title="Reload">↻</button></div>
      
      ${status?`<p class="muted twin-status">${esc(status)}</p>`:''}<ul class="items mod-list">${mods.map(card).join('')}</ul></section>`;
    wire();
  }

  function wire(){
    $('mods-refresh').onclick=load;
    for(const h of root.querySelectorAll('.mod-head'))h.onclick=e=>{if(e.target.closest('.switch'))return;open=open===h.dataset.open?null:h.dataset.open;render();};
    for(const c of root.querySelectorAll('.mod-install'))c.onchange=()=>act({op:c.checked?'install':'uninstall',mod:c.dataset.id});
    const m=mods.find(x=>x.id===open);if(!m)return;
    for(const r of root.querySelectorAll('[name=mod-variant]'))r.onchange=()=>act({op:'customize',mod:m.id,change:{variant:r.value}});
    const settingsNow=()=>{const s={};for(const el of root.querySelectorAll('.mod-setting'))(s[el.dataset.slot]??={})[el.dataset.param]=el.value;
      for(const x of m.settings.filter(x=>!x.active))(s[x.slot]??={})[x.param]??=x.value;return s;};
    for(const el of root.querySelectorAll('.mod-setting'))el.onchange=()=>act({op:'customize',mod:m.id,change:{settings:settingsNow()}});
    if($('mod-global'))$('mod-global').onchange=()=>{root.querySelector('.mod-places').hidden=$('mod-global').checked;};
    $('mod-save').onclick=()=>{
      const change={knowledge:[...root.querySelectorAll('.mod-know:checked')].map(c=>({ref:c.value})),
        examples:$('mod-examples').value.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,12)};
      if($('mod-global')){const picked=[...root.querySelectorAll('.mod-place:checked')].map(c=>c.value);
        if(!$('mod-global').checked&&!picked.length){status='Pick at least one place, or Everywhere.';render();return;}
        change.scope=$('mod-global').checked?'global':picked;}
      act({op:'customize',mod:m.id,change});
    };
    if($('mod-reset'))$('mod-reset').onclick=()=>act({op:'reset',mod:m.id});
    if($('mod-remove'))$('mod-remove').onclick=()=>{if(confirm(`Delete ${m.name}?`)){open=null;act({op:'remove',mod:m.id});}};
    $('mod-fork').onclick=()=>{
      const name=$('mod-fork-name').value.trim();if(!name){status='Give the new MOD a name.';render();return;}
      let id=slug(name)||'mod',n=2;while(mods.some(x=>x.id===id))id=`${slug(name)}-${n++}`;
      open=id;act({op:'fork',mod:m.id,id,name});
    };
  }
  return {load};
}
