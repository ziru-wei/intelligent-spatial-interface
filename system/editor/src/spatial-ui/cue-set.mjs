// What a renderer draws, kept by key (modos-system-design.md 12.13): every renderer of the spatial UI says, each time its data changes,
// which cues should stand and what each is drawn from; this keeps the ones whose data is the same, gives new data to the ones that take
// it in place (a cue's `set`), makes again only the ones that changed and cannot, and removes the ones that went. So a revision that
// changes one value updates that one cue; nothing else is rebuilt and nothing flickers.
//   const set=createCueSet(parent);
//   set.update([{key, props, make: props => part}, …])   part: {group, update(now, camera), set?(props) → true when taken in place}
//   set.parts (in the order last given), set.get(key), set.clear(); set.stats: how many were made, taken in place, kept (for measuring)
// props: what the cue is drawn from (plain data, compared as JSON; callbacks are not props, a cue's make closes over them).

export function createCueSet(parent){
  const live=new Map(),stats={made:0,inPlace:0,kept:0};let order=[];
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const drop=k=>{const x=live.get(k);if(!x)return;x.part.group.removeFromParent();x.part.dispose?.();live.delete(k);};
  return {
    /** The cues that should stand now. Returns the keys made (new or made again), for layout that depends on sizes. */
    update(specs){
      const made=[];
      for(const k of [...live.keys()])if(!specs.some(s=>s.key===k))drop(k);
      for(const s of specs){
        const x=live.get(s.key);
        if(x&&same(x.props,s.props)){x.make=s.make;stats.kept++;continue;}
        if(x&&x.part.set?.(s.props)){x.props=s.props;x.make=s.make;stats.inPlace++;continue;}
        if(x)drop(s.key);
        const part=s.make(s.props);if(!part)continue;stats.made++;parent.add(part.group);live.set(s.key,{part,props:s.props,make:s.make});made.push(s.key);
      }
      order=specs.map(s=>s.key).filter(k=>live.has(k));
      return made;
    },
    get parts(){return order.map(k=>live.get(k).part);},
    get stats(){return {...stats};},
    get(key){return live.get(key)?.part||null;},
    clear(){for(const k of [...live.keys()])drop(k);order=[];},
  };
}
