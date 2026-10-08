import {path} from './layout-tree.mjs';

// The layout as a tree in the Scene panel: groups (zones, or types: furniture, doors and windows, objects; built by src/app.mjs) →
// boxes → nested boxes. Each row can be collapsed, hidden and locked; hiding or locking a group or a box does the same to everything under
// it. A locked row cannot be picked, moved or deleted. Clicking a row selects it. Which rows are collapsed, hidden or locked is a
// per-viewer setting, kept in localStorage per scene (not in the layout). In edit mode (setEditing) rows that are not locked have a
// delete button. Double-clicking a row's name renames it in place (onRename with the new last part of its label).
// A row's icon follows its kind: a layout box (furniture), a door or window (opening), or an object (a persistent object of the scene).
const EYE='<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF='<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const LOCK='<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const UNLOCK='<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>';
const TRASH='<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>';
const CHEVRON='<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
const ICONS={
  furniture:'<svg class="kind" viewBox="0 0 24 24"><path d="M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3zM5 18v2M19 18v2"/></svg>',
  opening:'<svg class="kind" viewBox="0 0 24 24"><path d="M6 21V4h12v17M3 21h18M14 12.5v1"/></svg>',
  object:'<svg class="kind object" viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/></svg>'};

export function createOutline({root,scene,onSelect,onHidden,onRename,onLocked=()=>{},onDelete=()=>{}}){
  const key=`spatial-take:layout-view:${scene}`;let state={hidden:[],collapsed:[],locked:[]};
  try{state={...state,...JSON.parse(localStorage.getItem(key)||'{}')};}catch{}
  const hidden=new Set(state.hidden),collapsed=new Set(state.collapsed),locked=new Set(state.locked);let groups=[],selected=null,editing=false;
  const save=()=>{try{localStorage.setItem(key,JSON.stringify({hidden:[...hidden],collapsed:[...collapsed],locked:[...locked]}));}catch{}};
  const groupKey=g=>`zone:${g.zone.id??'none'}`;

  // Ids under a set of keys: the key itself, or a group or box above it.
  function under(keys){const out=new Set();const walk=(n,on)=>{on=on||keys.has(n.box.id);if(on)out.add(n.box.id);n.children.forEach(c=>walk(c,on));};
    for(const g of groups)g.nodes.forEach(n=>walk(n,keys.has(groupKey(g))));return out;}
  /** Ids of rows not drawn: hidden themselves, or under a hidden box or group. */
  const hiddenBoxes=()=>under(hidden);
  /** Ids of rows that cannot be picked, moved or deleted. */
  const lockedBoxes=()=>under(locked);
  const count=nodes=>nodes.reduce((s,n)=>s+1+count(n.children),0);

  function row({key,label,depth,children,isGroup,id,off,dim,n,kind,lockOn,lockInherited}){
    const el=document.createElement('div');el.className='node'+(isGroup?' zone':'')+(dim?' off':'')+(lockOn||lockInherited?' locked':'');el.style.setProperty('--depth',depth);el.dataset.key=key;
    if(id&&id===selected)el.setAttribute('aria-current','true');
    el.innerHTML=`${children?`<button class="twist" aria-label="${collapsed.has(key)?'Expand':'Collapse'}" aria-expanded="${!collapsed.has(key)}">${CHEVRON}</button>`:'<span class="twist"></span>'}${ICONS[kind]||''}<span class="name"></span>${n?`<span class="n">${n}</span>`:''}`
      +`${editing&&id&&!lockOn&&!lockInherited?`<button class="del" aria-label="Delete" title="Delete">${TRASH}</button>`:''}`
      +`<button class="lock" aria-label="${lockOn?'Unlock':'Lock'}" aria-pressed="${!!lockOn}" title="${lockInherited?'Locked with the row above':lockOn?'Unlock':'Lock'}" ${lockInherited?'disabled':''}>${lockOn||lockInherited?LOCK:UNLOCK}</button>`
      +`<button class="eye" aria-label="${off?'Show':'Hide'}" aria-pressed="${off}">${off?EYE_OFF:EYE}</button>`;
    el.querySelector('.name').textContent=label;
    el.onclick=e=>{
      if(e.target.closest('.twist')&&children){collapsed.has(key)?collapsed.delete(key):collapsed.add(key);save();render();return;}
      if(e.target.closest('.eye')){hidden.has(key)?hidden.delete(key):hidden.add(key);save();render();onHidden(hiddenBoxes());return;}
      if(e.target.closest('.lock')){if(lockInherited)return;locked.has(key)?locked.delete(key):locked.add(key);save();render();onLocked(lockedBoxes());return;}
      if(e.target.closest('.del')){onDelete(id);return;}
      if(id)onSelect(id,!!(lockOn||lockInherited));};
    if(id&&onRename)el.querySelector('.name').ondblclick=e=>{e.stopPropagation();const span=e.target,input=document.createElement('input');
      input.className='rename';input.value=label;span.replaceWith(input);input.focus();input.select();let done=false;
      const finish=save=>{if(done)return;done=true;input.replaceWith(span);const v=input.value.trim().replaceAll('/',' ');if(save&&v&&v!==label)onRename(id,v);};
      input.onkeydown=k=>{k.stopPropagation();if(k.key==='Enter'){k.preventDefault();finish(true);}if(k.key==='Escape')finish(false);};input.onblur=()=>finish(true);input.onclick=k=>k.stopPropagation();};
    return el;
  }
  function render(){
    const frag=document.createDocumentFragment();
    const add=(n,depth,parentOff,parentLock)=>{const b=n.box,off=hidden.has(b.id),lockOn=locked.has(b.id);
      frag.append(row({key:b.id,id:b.id,label:path(b.label).at(-1)||b.id,depth,children:n.children.length,off,dim:off||parentOff,n:n.children.length?count(n.children):0,
        kind:b.isObject?'object':b.kind==='opening'?'opening':'furniture',lockOn,lockInherited:parentLock}));
      if(!collapsed.has(b.id))n.children.forEach(c=>add(c,depth+1,off||parentOff,lockOn||parentLock));};
    for(const g of groups){const k=groupKey(g),off=hidden.has(k),lockOn=locked.has(k);
      frag.append(row({key:k,label:g.zone.name,depth:0,children:g.nodes.length,isGroup:true,off,dim:off,n:count(g.nodes),lockOn}));
      if(!collapsed.has(k))g.nodes.forEach(n=>add(n,1,off,lockOn));}
    root.replaceChildren(frag);
  }
  return {
    setTree(next){groups=next;render();},
    setEditing(on){editing=on;render();},
    setSelected(id){selected=id;
      // Open the groups and parents above it, then bring its row into view.
      if(id)for(const g of groups){const find=(n,up)=>n.box.id===id?up:n.children.map(c=>find(c,[...up,n.box.id])).find(Boolean);
        const hit=g.nodes.map(n=>find(n,[])).find(Boolean);if(hit){[groupKey(g),...hit].forEach(k=>collapsed.delete(k));save();break;}}
      render();root.querySelector('[aria-current=true]')?.scrollIntoView({block:'nearest'});},
    hiddenBoxes,lockedBoxes,get hidden(){return hidden;}
  };
}
