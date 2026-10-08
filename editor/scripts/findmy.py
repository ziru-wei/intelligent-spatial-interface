"""FindMy contract: select a known item; resolve its container from current layout."""
import json, math
import user_context

def catalog(d, context=None):
    ctx=context if context is not None else user_context.read(d,['storage'])
    path=d.parent.parent/'scan/semantic.json'
    layout=json.loads(path.read_text()) if path.is_file() else {}
    boxes={o['id']:o for o in layout.get('objects',[]) if o.get('id') and all(isinstance(o.get(k),list) and len(o[k])==3 for k in ('center','size'))}
    return [dict(item_id=i['id'],label=i['label'],aliases=i.get('aliases',[]),box_id=i['box_id'],box_label=boxes.get(i['box_id'],{}).get('label',i.get('location','')),available=i['box_id'] in boxes) for i in ctx.get('stored_items',[]) if all(isinstance(i.get(k),str) for k in ('id','label','box_id'))],boxes

def resolve(d,selection):
    if not isinstance(selection,dict) or set(selection)-{'status','item_id'}: raise ValueError('FindMy accepts only status and item_id.')
    status=selection.get('status')
    if status in ('not_found','ambiguous'):
        if 'item_id' in selection: raise ValueError('Unresolved FindMy must not select an item.')
        return dict(version=1,mod='findmy',status=status)
    if status!='found' or not isinstance(selection.get('item_id'),str): raise ValueError('Invalid FindMy selection.')
    items,boxes=catalog(d)
    item=next((i for i in items if i['item_id']==selection['item_id'] and i['available']),None)
    if item is None: raise ValueError('FindMy item has no known layout box.')
    box=boxes[item['box_id']]
    if any(not isinstance(v,(int,float)) or not math.isfinite(v) for k in ('center','size') for v in box[k]) or any(v<=0 for v in box['size']): raise ValueError('Invalid FindMy box geometry.')
    yaw=box.get('yaw',0)
    if not isinstance(yaw,(int,float)) or not math.isfinite(yaw): raise ValueError('Invalid FindMy box rotation.')
    return dict(version=1,mod='findmy',status='found',item_id=item['item_id'],label=item['label'],target=dict(id=box['id'],label=box.get('label',box['id']),center=box['center'],size=box['size'],yaw=yaw),visual='box-highlight',guidance='when-out-of-view',occlusion='hands-only')
