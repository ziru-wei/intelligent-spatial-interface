// Canonical candidates only; text generation may select an ID, never invent one.
export function referenceCandidates(context){
  const candidates=new Map();
  for(const item of context.stored_items||[])if(typeof item.id==='string'&&typeof item.label==='string')candidates.set(item.id,{item_id:item.id,label:item.label,context_groups:['storage']});
  for(const item of context.objects||[])if(typeof item.id==='string'&&typeof item.label==='string'&&!candidates.has(item.id))candidates.set(item.id,{item_id:item.id,label:item.label,context_groups:['storage']});
  const book=context.preferences?.reading?.current_book;
  if(typeof book?.stored_item_id==='string'&&typeof book.title==='string')candidates.set(book.stored_item_id,{item_id:book.stored_item_id,label:book.title,context_groups:['personal','storage']});
  return [...candidates.values()];
}
export function validatedReferenceIds(result,context){
  const known=new Set(referenceCandidates(context).map(i=>i.item_id));
  return [...new Set((Array.isArray(result.referenced_item_ids)?result.referenced_item_ids:[]).filter(id=>known.has(id)))].slice(0,8);
}
