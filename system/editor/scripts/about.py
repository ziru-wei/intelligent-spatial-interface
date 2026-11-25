"""The main page's About › ModOS: the project's introduction, the Abstract of the paper draft (context/write-up/draft.md, private: never
published itself). Only the Abstract's text is written out, to context/about/abstract.json (and abstract.js, for the page opened as a
file); its figures and notes (`//` lines) stay out. The server syncs it on start and whenever the draft changes (watch); `npm run
about` syncs it by hand."""
import json, re, sys, threading, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DRAFT = REPO/'context'/'write-up'/'draft.md'
OUT = REPO/'context'/'about'

def abstract(text):
    """The Abstract section's paragraphs (plain text), or None when the draft has no `## Abstract`."""
    m = re.search(r'^#+\s*Abstract\s*$(.*?)(?=^#)', text+'\n#', re.M | re.S)
    if not m: return None
    paras = [' '.join(p.split()) for p in re.split(r'\n\s*\n', m.group(1))]
    return [p for p in paras if p and not p.startswith(('//', '![', '<'))]

def sync():
    """Write the Abstract if the draft is here and it changed; returns it (None: no draft, or no Abstract)."""
    if not DRAFT.is_file(): return None
    paras = abstract(DRAFT.read_text())
    if paras is None: return None
    data = dict(abstract=paras)
    f = OUT/'abstract.json'
    if not f.is_file() or json.loads(f.read_text()).get('abstract') != paras:
        OUT.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(data, indent=1, ensure_ascii=False)+'\n')
        (OUT/'abstract.js').write_text('window.ABOUT='+json.dumps(data, ensure_ascii=False)+';\n')
    return paras

def watch(every=2.0):
    """Sync now and again whenever the draft's mtime changes (a daemon thread)."""
    def run():
        seen = None
        while True:
            try:
                mtime = DRAFT.stat().st_mtime if DRAFT.is_file() else None
                if mtime != seen: seen = mtime; sync()
            except (OSError, ValueError) as e: print('about:', e, file=sys.stderr)
            time.sleep(every)
    threading.Thread(target=run, daemon=True).start()

if __name__ == '__main__':
    paras = sync()
    print(f'About › ModOS: {len(paras)} paragraph(s) from the Abstract' if paras else 'No draft with an Abstract: nothing written.')
