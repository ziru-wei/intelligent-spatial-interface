// The MODs tab: tailor the space's MODs without writing one (scripts/modos_registry.py). A MOD's author defines what can change;
// here people pick among it:
//   Representation  one of the MOD's variants (which primitive representations it shows, and where its text goes)
//   Settings        settled params of its slots (how long text stays, when a highlight goes away, an object's motion, ...)
//   Description     what it is for, and Examples: questions it answers (the decision model chooses MODs by them; the author's are kept
//                   for Reset). Where a MOD applies and what it knows are its author's, not tailored here.
//   Duplicate       a new MOD from this one (same parts, its own choices), e.g. "Weather, text only" for the bedroom
// Base MODs can be reset to how their author made them; duplicates can be deleted. Every change is checked by the server first.
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const slug=s=>String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48);
const USE={'situated-text':'text','highlight':'highlight','guidance':'direction','data-widget':'controls','ambient-effect':'ambient','scene-asset':'animation','label':'label','control':'device control'};
const PARAM={duration:'Text stays',lock:'Sky'};
const VALUE={stay:'until the next answer','5s':'5 seconds',follow:'moves to where you look',lock:'stays where it first showed'};

export function createModsPanel({root,space}){
  let mods=[],open=null,status='';
  async function call(method,body){
    const u=new URL('/api/modos/mods',location.href);if(method==='GET')u.searchParams.set('space',space);
    const r=await fetch(u,method==='GET'?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({space,...body})});
    const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;
  }
  async function load(){
    try{
      mods=(await call('GET')).mods;status='';
    }catch(e){status='MODs need the editor server (scripts/server.py): '+e.message;}
    render();
  }
  const $=id=>root.querySelector('#'+id);
  // a change is announced, so what is already shown is drawn again with it (src/current-mods.mjs)
  async function act(body){try{mods=(await call('POST',body)).mods;status='';dispatchEvent(new CustomEvent('modos-mods-changed'));}catch(e){status=e.message;}render();}

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
    // what it is for and the questions it answers: the decision model chooses MODs by them (modos/mod-selection.mjs)
    const about=`<h4>Description <button type="button" class="help" data-tip="The decision model chooses MODs by their description and examples. Author's: ${esc(m.authored.description)}" aria-label="About this">?</button></h4>`
      +`<textarea id="mod-description" rows="3" maxlength="400">${esc(m.description)}</textarea>`
      +`<h4>Examples</h4><textarea id="mod-examples" rows="3" placeholder="Questions it answers, one per line">${esc(m.examples.join('\n'))}</textarea>`;
    return `<li class="mod-card on">${head}${about}${variants}${sets}
      <div class="take-row"><button id="mod-save">Save</button>${m.origin==='base'?`<button id="mod-reset"${m.customized?'':' disabled'} title="Back to how its author made it">Reset</button>`:'<button id="mod-remove">Delete</button>'}</div>
      <details class="twin-add"><summary>Duplicate as a new MOD</summary><div class="take-row"><input id="mod-fork-name" type="text" placeholder="Name, e.g. ${esc(m.name)} (bedroom)" maxlength="60"><button id="mod-fork">Duplicate</button></div></details></li>`;
  }

  function render(){
    root.innerHTML=`<section class="behavior twin mods"><div class="panel-head"><h2>MODs <button type="button" class="help" data-tip="Tailor each MOD in this space: say what it is for and what it answers, pick a representation, settle its settings, or duplicate it. Where it applies, what it knows and its parts stay the MOD author's." aria-label="About this">?</button></h2><button id="mods-refresh" title="Reload">↻</button></div>
      
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
    $('mod-save').onclick=()=>{
      const description=$('mod-description').value.trim();if(!description){status='Say what the MOD is for.';render();return;}
      act({op:'customize',mod:m.id,change:{description,examples:$('mod-examples').value.split('\n').map(x=>x.trim()).filter(Boolean).slice(0,12)}});
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
