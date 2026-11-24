"""The prompts the decision model is asked (modos/prompts.json; modos/prompts.mjs; design doc 12.35), read and saved for the pipeline
page, where a decision is double-clicked to see and edit its words. An edit changes words only: the same prompts as before (no prompt
added or taken away), each still text, each with the same placeholders ({sentence}, {theme}, ...: what is filled in at run time).
The bridge takes the new words with the next question (it renews itself when the file changed)."""
import json, re
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent/'modos'/'prompts.json'
_HOLE = re.compile(r'\{(\w+)\}')


def load(path=PATH):
    return json.loads(Path(path).read_text())


def holes(text):
    return sorted(set(_HOLE.findall(text)))


def save(change, path=PATH):
    """change: {decision: {prompt: words}} for the prompts edited (any of them). Returns every prompt as saved."""
    prompts = load(path)
    if not isinstance(change, dict): raise ValueError('The change is {decision: {prompt: words}}.')
    for name, edits in change.items():
        if name not in prompts or not isinstance(edits, dict): raise ValueError(f'No prompts named {name}.')
        for key, words in edits.items():
            if key not in prompts[name]: raise ValueError(f'{name} has no prompt {key}.')
            if not isinstance(words, str) or not words.strip(): raise ValueError(f'{name}.{key}: the words cannot be empty.')
            was, now = holes(prompts[name][key]), holes(words)
            if was != now:
                lost, extra = [h for h in was if h not in now], [h for h in now if h not in was]
                raise ValueError(f'{name}.{key}: ' + '; '.join(filter(None, [lost and 'keep ' + ', '.join('{%s}' % h for h in lost), extra and 'no such placeholder ' + ', '.join('{%s}' % h for h in extra)])) + '.')
            prompts[name][key] = words
    Path(path).write_text(json.dumps(prompts, indent=2, ensure_ascii=False) + '\n')
    return prompts
