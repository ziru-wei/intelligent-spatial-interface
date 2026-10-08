import * as THREE from 'three';

// Aligning a recording to its scene from what it shows. The user ticks (in the list, or by clicking in the 3D view) the walls, ceiling
// pieces, floors, doors and windows and the furniture the recording sees; scripts/align_recording.py then aligns its LiDAR depth to
// those parts of the scan only (a recording covers a corner of the scene and adds clutter the scan never saw). The choice is kept with
// the recording (alignTarget) and comes back the next time. While the panel is open the 3D view shows the segmented surfaces and the
// boxes, the ticked ones highlighted.
const CHECK='<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

export function createAlignPanel({root,canvas,getCamera,structure,layout,onOpen,onClose,onAlign,onFineTune}){
  let open=false,picked={surfaces:new Set(),boxes:new Set()},groups=[],busy=false,result='';
  const ray=new THREE.Raycaster(),ndc=e=>{const r=canvas.getBoundingClientRect();return new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2);};

  /** surfaces: segmentation list (scan/surfaces.json); boxes: top-level layout boxes with label and zone name; target: alignTarget. */
  function show({title,surfaces,boxes,target}){
    picked={surfaces:new Set(target?.surfaces||[]),boxes:new Set(target?.boxes||[])};result='';
    const pretty=id=>id.replace(/^(Wall|Ceiling|Floor)_/,'').replace(/_/g,' ');
    const of=kind=>surfaces.filter(s=>s.kind===kind&&!s.parent);
    groups=[
      {title:'Floors',kind:'surfaces',items:of('floor').map(s=>({id:s.id,name:`${pretty(s.id)}`}))},
      {title:'Walls',kind:'surfaces',items:of('wall').map(s=>({id:s.id,name:`Wall ${pretty(s.id)}`,note:(s.zones||[]).join(' · ')}))},
      {title:'Ceilings',kind:'surfaces',items:of('ceiling').map(s=>({id:s.id,name:pretty(s.id),note:(s.zones||[]).join(' · ')}))},
      {title:'Doors & windows',kind:'surfaces',items:[...of('door'),...of('window')].map(s=>({id:s.id,name:s.label||s.id,note:(s.zones||[]).join(' · ')}))},
      ...[...new Set(boxes.map(b=>b.zone))].map(z=>({title:`Furniture · ${z}`,kind:'boxes',items:boxes.filter(b=>b.zone===z).map(b=>({id:b.id,name:b.label}))}))
    ].filter(g=>g.items.length);
    open=true;root.hidden=false;root.dataset.title=title;onOpen?.();render();focus();
  }
  function hide(){if(!open)return;open=false;root.hidden=true;structure.setFocus(null);layout.setFocus(null);onClose?.();}
  function focus(){structure.setFocus([...picked.surfaces]);layout.setFocus([...picked.boxes]);}
  function toggle(kind,id,on=!picked[kind].has(id)){on?picked[kind].add(id):picked[kind].delete(id);}
  const count=()=>picked.surfaces.size+picked.boxes.size;

  function render(){
    const head=`<div class="align-head"><b>Align</b><span class="dim"></span><button class="icon close" aria-label="Close" title="Close">×</button></div>
      <p class="muted">Tick what this recording shows (or click it in the 3D view), including some floor; only those parts of the scan are used.</p>`;
    root.innerHTML=head+'<div class="outline align-list"></div>'+
      `<div class="align-foot"><button class="go" ${busy||!count()?'disabled':''}>${busy?'Aligning…':`Align to ${count()} part${count()===1?'':'s'}`}</button><button class="fine" title="Then drag the recording's own mesh onto the scan with the move / rotate gizmo">Fine-tune</button></div><p class="muted result"></p>`;
    root.querySelector('.dim').textContent=root.dataset.title||'';root.querySelector('.result').textContent=result;
    const list=root.querySelector('.align-list');
    for(const g of groups){const all=g.items.every(i=>picked[g.kind].has(i.id)),some=g.items.some(i=>picked[g.kind].has(i.id));
      const h=document.createElement('div');h.className='node zone';h.style.setProperty('--depth',0);
      h.innerHTML=`<span class="tick${all?' on':some?' part':''}">${CHECK}</span><span class="name"></span><span class="n">${g.items.filter(i=>picked[g.kind].has(i.id)).length}/${g.items.length}</span>`;
      h.querySelector('.name').textContent=g.title;h.onclick=()=>{for(const i of g.items)toggle(g.kind,i.id,!all);render();focus();};list.append(h);
      for(const it of g.items){const r=document.createElement('div'),on=picked[g.kind].has(it.id);r.className='node';r.style.setProperty('--depth',1);
        r.innerHTML=`<span class="tick${on?' on':''}">${CHECK}</span><span class="name"></span>${it.note?'<span class="n"></span>':''}`;r.querySelector('.name').textContent=it.name;
        if(it.note)r.querySelector('.n').textContent=it.note;r.onclick=()=>{toggle(g.kind,it.id);render();focus();};list.append(r);}}
    root.querySelector('.close').onclick=hide;root.querySelector('.fine').onclick=()=>{hide();onFineTune?.();};
    root.querySelector('.go').onclick=async()=>{busy=true;render();
      try{result=await onAlign({surfaces:[...picked.surfaces],boxes:[...picked.boxes]})||'';}catch(e){result=e.message;}busy=false;render();};
  }
  // Clicks in the 3D view tick or untick the surface (or the box) under the pointer while the panel is open.
  let down=null;canvas.addEventListener('pointerdown',e=>{down=open?[e.clientX,e.clientY]:null;},true);
  canvas.addEventListener('click',e=>{if(!open||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>4)return;ray.setFromCamera(ndc(e),getCamera());
    const box=layout.pickBox(ray),surface=box?null:structure.pickSurface(ray);if(!box&&!surface)return;
    e.stopImmediatePropagation();box?toggle('boxes',box):toggle('surfaces',surface);render();focus();},true);
  return {show,hide,get open(){return open;}};
}
