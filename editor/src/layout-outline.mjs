import {path} from './layout-tree.mjs';

// The layout as a tree in the Scene panel: zones (rooms and hand-added zones) → boxes → nested boxes. Each row can be collapsed and
// hidden; hiding a zone or a box hides everything under it (in the 3D view). Clicking a row selects that box. Which rows are collapsed
// or hidden is a per-viewer view setting, kept in localStorage per scene (not in the layout).
const EYE='<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF='<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
const CHEVRON='<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';

export function createOutline({root,scene,onSelect,onHidden}){
  const key=`spatial-take:layout-view:${scene}`;let state={hidden:[],collapsed:[]};
  try{state={...state,...JSON.parse(localStorage.getItem(key)||'{}')};}catch{}
  const hidden=new Set(state.hidden),collapsed=new Set(state.collapsed);let groups=[],selected=null;
  const save=()=>{try{localStorage.setItem(key,JSON.stringify({hidden:[...hidden],collapsed:[...collapsed]}));}catch{}};
  const zoneKey=z=>`zone:${z.id??'none'}`;

  /** Ids of boxes not drawn: hidden themselves, or under a hidden box or zone. */
  function hiddenBoxes(){const out=new Set();const walk=(n,off)=>{off=off||hidden.has(n.box.id);if(off)out.add(n.box.id);n.children.forEach(c=>walk(c,off));};
    for(const g of groups)g.nodes.forEach(n=>walk(n,hidden.has(zoneKey(g.zone))));return out;}
  const count=nodes=>nodes.reduce((s,n)=>s+1+count(n.children),0);

  function row({key,label,depth,children,isZone,id,off,dim,n}){
    const el=document.createElement('div');el.className='node'+(isZone?' zone':'')+(dim?' off':'');el.style.setProperty('--depth',depth);el.dataset.key=key;
    if(id&&id===selected)el.setAttribute('aria-current','true');
    el.innerHTML=`${children?`<button class="twist" aria-label="${collapsed.has(key)?'Expand':'Collapse'}" aria-expanded="${!collapsed.has(key)}">${CHEVRON}</button>`:'<span class="twist"></span>'}<span class="name"></span>${n?`<span class="n">${n}</span>`:''}<button class="eye" aria-label="${off?'Show':'Hide'}" aria-pressed="${off}">${off?EYE_OFF:EYE}</button>`;
    el.querySelector('.name').textContent=label;
    el.onclick=e=>{
      if(e.target.closest('.twist')&&children){collapsed.has(key)?collapsed.delete(key):collapsed.add(key);save();render();return;}
      if(e.target.closest('.eye')){hidden.has(key)?hidden.delete(key):hidden.add(key);save();render();onHidden(hiddenBoxes());return;}
      if(id)onSelect(id);};
    return el;
  }
  function render(){
    const frag=document.createDocumentFragment();
    const add=(n,depth,parentOff)=>{const b=n.box,off=hidden.has(b.id);
      frag.append(row({key:b.id,id:b.id,label:path(b.label).at(-1)||b.id,depth,children:n.children.length,off,dim:off||parentOff,n:n.children.length?count(n.children):0}));
      if(!collapsed.has(b.id))n.children.forEach(c=>add(c,depth+1,off||parentOff));};
    for(const g of groups){const k=zoneKey(g.zone),off=hidden.has(k);
      frag.append(row({key:k,label:g.zone.name,depth:0,children:g.nodes.length,isZone:true,off,dim:off,n:count(g.nodes)}));
      if(!collapsed.has(k))g.nodes.forEach(n=>add(n,1,off));}
    root.replaceChildren(frag);
  }
  // Every collapsible key, for expand / collapse all.
  const keys=()=>{const out=[];const walk=n=>{if(n.children.length)out.push(n.box.id);n.children.forEach(walk);};for(const g of groups){out.push(zoneKey(g.zone));g.nodes.forEach(walk);}return out;};
  return {
    setTree(next){groups=next;render();},
    setSelected(id){selected=id;
      // Open the zones and parents above it, then bring its row into view.
      if(id)for(const g of groups){const trail=[];const find=(n,up)=>n.box.id===id?up:n.children.map(c=>find(c,[...up,n.box.id])).find(Boolean);
        const hit=g.nodes.map(n=>find(n,[])).find(Boolean);if(hit){[zoneKey(g.zone),...hit].forEach(k=>collapsed.delete(k));save();break;}}
      render();root.querySelector('[aria-current=true]')?.scrollIntoView({block:'nearest'});},
    expandAll(){collapsed.clear();save();render();},collapseAll(){keys().forEach(k=>collapsed.add(k));save();render();},
    showAll(){hidden.clear();save();render();onHidden(hiddenBoxes());},
    hiddenBoxes,get hidden(){return hidden;}
  };
}
