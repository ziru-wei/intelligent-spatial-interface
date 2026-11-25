"""A question's replay history: its answer as first given, and each one made again from the same input (a Rerun, a replay typed again
by demos/live-replay.mjs, a Gallery example asked again). A version made again is a question of its own in the conversation, its
answers and decision record its own, joined to the question it was made from (`replay_of`: that question's id, the root; `how`:
'replay-audio' (a Rerun: its recording through speech to text and the pipeline again), 'replay-text' (demos/live-replay.mjs: the
words as recognized, typed again in their rhythm) or 'replay-text-batch' (npm run gallery: the Gallery's examples typed again, a
queue)); the root keeps the input (its recording, its words and their typing) and which version is the
best (`pinned`). The version shown is the pinned one, else the newest. No dependencies."""

def root_id(q): return q.get('replay_of') or q['id']

HOW_BEFORE = {'rerun': 'replay-audio', 'live replay': 'replay-text', 'gallery': 'replay-text-batch'}   # the names of 11-25 morning
def how(q):
    """How a version was made: 'original' for the question's first answer."""
    h = q.get('how') or ('original' if not q.get('replay_of') else 'replay-audio')
    return HOW_BEFORE.get(h, h)

def groups(questions):
    """{root id: [its versions, oldest first]}, in the conversation's order of roots."""
    out = {}
    for q in questions:
        if not q.get('replay_of'): out.setdefault(q['id'], [])
    for q in questions: out.setdefault(root_id(q), []).append(q)
    return {k: sorted(v, key=lambda q: q.get('created', 0)) for k, v in out.items() if v}

def shown(versions, viewing=None):
    """The version shown: the one being looked at in the history (viewing), else the pinned one, else the newest."""
    by = {q['id']: q for q in versions}
    root = next((q for q in versions if not q.get('replay_of')), versions[0])
    return by.get(viewing) or by.get(root.get('pinned')) or versions[-1]

def shown_ids(questions, viewing=None):
    """The ids of the versions shown, one per question (viewing: {root id: version id})."""
    return {shown(vs, (viewing or {}).get(r))['id'] for r, vs in groups(questions).items()}
