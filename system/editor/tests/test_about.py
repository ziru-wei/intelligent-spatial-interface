import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import about

DRAFT = '''# Title

## Abstract

First paragraph,
over two lines.

![Figure](figures/teaser.svg)

// a note for the authors

Second paragraph.

## 1 Introduction

Not this.
'''

class AboutTest(unittest.TestCase):
    def test_only_the_abstracts_text_is_published(self):
        self.assertEqual(about.abstract(DRAFT), ['First paragraph, over two lines.', 'Second paragraph.'])
        self.assertIsNone(about.abstract('# Title\n\nNo abstract here.\n'))

    def test_sync_writes_the_page_files_from_the_draft(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = about.DRAFT, about.OUT
            about.DRAFT = Path(tmp)/'draft.md'; about.OUT = Path(tmp)/'about'
            try:
                self.assertIsNone(about.sync())   # no draft (a clone without the private write-up): nothing written
                self.assertFalse(about.OUT.exists())
                about.DRAFT.write_text(DRAFT); about.sync()
                self.assertEqual(json.loads((about.OUT/'abstract.json').read_text())['abstract'][1], 'Second paragraph.')
                self.assertTrue((about.OUT/'abstract.js').read_text().startswith('window.ABOUT='))
            finally: about.DRAFT, about.OUT = old
