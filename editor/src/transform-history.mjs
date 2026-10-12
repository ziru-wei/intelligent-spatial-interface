// One committed drag is one undo step. Snapshots never alias the live transform.
export function createTransformHistory(limit=100){
 const past=[],future=[];
 return {
  get canUndo(){return past.length>0;},get canRedo(){return future.length>0;},
  record(before,after){if(before.equals(after))return;past.push(before.clone());if(past.length>limit)past.shift();future.length=0;},
  undo(current){if(!past.length)return null;future.push(current.clone());return past.pop();},
  redo(current){if(!future.length)return null;past.push(current.clone());return future.pop();},
  clear(){past.length=0;future.length=0;}
 };
}
