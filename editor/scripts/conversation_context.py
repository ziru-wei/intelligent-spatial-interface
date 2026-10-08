"""Bounded, session-local history of what was actually shown; never store inferred locations."""
import user_context

def known_entities(context):
    entities={}
    for item in context.get('stored_items', []):
        if isinstance(item.get('id'),str) and isinstance(item.get('label'),str):
            entities[item['id']]=dict(item_id=item['id'],label=item['label'],context_groups=['storage'])
    for item in context.get('objects', []):
        if isinstance(item.get('id'),str) and isinstance(item.get('label'),str):
            entities.setdefault(item['id'],dict(item_id=item['id'],label=item['label'],context_groups=['storage']))
    reading=context.get('preferences',{}).get('reading',{})
    book=reading.get('current_book',{}) if isinstance(reading,dict) else {}
    if isinstance(book.get('stored_item_id'),str) and isinstance(book.get('title'),str):
        entities[book['stored_item_id']]=dict(item_id=book['stored_item_id'],label=book['title'],context_groups=['personal','storage'])
    return entities

def validate_references(d, ids):
    if not isinstance(ids,list) or len(ids)>8 or any(not isinstance(i,str) for i in ids):
        raise ValueError('referenced_item_ids must contain at most eight known IDs.')
    if not ids:return []
    catalog=user_context.read(d,[])
    groups=[k for k in ('personal','storage') if k in catalog['context_groups']]
    known=known_entities(user_context.read(d,groups))
    if any(i not in known for i in ids):raise ValueError('Unknown referenced item ID.')
    return [known[i] for i in dict.fromkeys(ids)]

def snapshot(conversation, current):
    if not conversation or not current:return dict(recent_turns=[],referents=[])
    questions=conversation.get('questions',[])
    index=next((i for i,q in enumerate(questions) if q['id']==current['id']),0)
    turns=[]
    for q in questions[:index]:
        # Future/late responses were not visible when the new question was asked.
        responses=[r for r in conversation.get('responses',[]) if r.get('question_id')==q['id'] and r.get('created',0)<=current.get('created',float('inf'))]
        if not responses:continue
        shown=[];refs={}
        for r in responses:
            if r.get('stream'):
                # A later completion must not rewrite what was visible when this question was asked.
                updates=[u for u in r['stream'].get('updates',[]) if u.get('created',0)<=current.get('created',float('inf'))]
                if not updates:continue
                r={**r,**updates[-1]}
                if r.get('status')=='failed':continue
            if r.get('title') or r.get('body') or r.get('items'):
                shown.append(dict(title=str(r.get('title',''))[:140],body=str(r.get('body',''))[:500],items=[str(i)[:100] for i in r.get('items',[])[:5]]))
            for entity in r.get('referenced_entities',[]):refs[entity['item_id']]=entity
        turns.append(dict(question_id=q['id'],user_question=q.get('text','')[:500],assistant=shown,referenced_entities=list(refs.values())))
    turns=turns[-3:]
    refs={}
    for turn in reversed(turns):
        for entity in turn['referenced_entities']:
            refs.setdefault(entity['item_id'],dict(entity,question_id=turn['question_id']))
    return dict(recent_turns=turns,referents=list(refs.values())[:8])
