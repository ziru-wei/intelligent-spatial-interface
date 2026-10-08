/** Remove on one valid depth measurement within the approach range, including a paused frame.
 * Remember the removal frame so rewinding shows the effect until that point again.
 * Independent of mask generation, renderers, and language output.
 */
export function createApproachRemoval({distanceM=.25}={}){
 const records=new Map();
 return {
  update({key,frame,enabled,distance,distanceM:range=distanceM}){
   if(!enabled){records.delete(key);return false;}
   let r=records.get(key);
   if(!r){r={removedAt:null};records.set(key,r);while(records.size>64)records.delete(records.keys().next().value);}
   if(r.removedAt!=null&&frame>=r.removedAt)return true;
   if(Number.isFinite(distance)&&distance>=0&&Number.isFinite(range)&&range>=0&&distance<=range){r.removedAt=frame;return true;}
   return false;
  },reset(){records.clear();}
 };
}
