import json, shutil, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent/'scripts'))
import modos_prompts


class PromptsTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(); self.path = Path(self.dir)/'prompts.json'
        shutil.copy(modos_prompts.PATH, self.path)

    def tearDown(self): shutil.rmtree(self.dir)

    def test_words_change_placeholders_stay(self):
        out = modos_prompts.save({'also_uses': {'question': 'Does {sentence} build on: {theme}?'}}, self.path)
        self.assertEqual(json.loads(self.path.read_text())['also_uses']['question'], 'Does {sentence} build on: {theme}?')
        self.assertEqual(out['request_type'], modos_prompts.load(modos_prompts.PATH)['request_type'])   # the rest as it was

    def test_refused(self):
        for change, said in [({'also_uses': {'question': 'Does {sentence} build on it?'}}, 'keep {theme}'),
                             ({'answer_form': {'question': 'Is {sentence} yes/no for {mod}?'}}, 'no such placeholder {mod}'),
                             ({'answer_form': {'question': '  '}}, 'cannot be empty'),
                             ({'answer_form': {'heading': 'x'}}, 'no prompt heading'),
                             ({'nope': {'question': 'x'}}, 'No prompts named nope')]:
            with self.assertRaisesRegex(ValueError, said): modos_prompts.save(change, self.path)
        self.assertEqual(self.path.read_text(), modos_prompts.PATH.read_text())   # nothing saved


if __name__ == '__main__': unittest.main()
