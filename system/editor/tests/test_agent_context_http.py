import functools, json, sys, threading, unittest
from pathlib import Path
from urllib.request import urlopen
from urllib.error import HTTPError
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import server

class ContextHTTPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=server.Server(('127.0.0.1',0),functools.partial(server.Handler,directory=str(server.SITE)))
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.url='http://127.0.0.1:'+str(cls.server.server_port)
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def test_credentials_not_served(self):
        for path in ['/system/editor/agent-config.local.json','/system/editor/%61gent-config.local.json']:
            with self.assertRaises(HTTPError) as error:urlopen(self.url+path)
            self.assertEqual(error.exception.code,404)
    def test_site(self):
        # the repository as the site: the main page at its root, the editor and the Gallery's examples; nothing else of it
        for path in ['/','/system/editor/','/system/editor/pipeline.html','/context/gallery/examples.js']:
            with urlopen(self.url+path) as r:self.assertEqual(r.status,200)
        with urlopen(self.url+'/') as r:self.assertIn(b"const SYSTEM='system/editor/'",r.read())
        for path in ['/AGENTS.md','/.git/HEAD','/system/editor/%2e%2e/%2e%2e/.git/HEAD','/system/editor/../../AGENTS.md','/context/docs/modos-system-design.md','/system/editor/private/','/system/editor/.venv/']:
            with self.assertRaises(HTTPError,msg=path) as error:urlopen(self.url+path)
            self.assertEqual(error.exception.code,404)
    def test_session_paths(self):
        # a session relative to the editor (?session=, the bridge) and a URL's pathname on the site are the same folder; the editor's old
        # place at the root is no session
        d=server.ROOT/'spaces/atlas/scenarios/atlas_rec_5'
        if not (d/'session.json').is_file():self.skipTest('no atlas_rec_5')
        self.assertEqual(server.session_dir('./spaces/atlas/scenarios/atlas_rec_5/session.json'),d.resolve())
        self.assertEqual(server.session_dir('/system/editor/spaces/atlas/scenarios/atlas_rec_5/session.json'),d.resolve())
        with self.assertRaises(ValueError):server.session_dir('/spaces/atlas/scenarios/atlas_rec_5/session.json')
    def test_command(self):
        from unittest.mock import patch
        with patch.object(server,'session_dir',return_value=server.ROOT/'spaces/demo/scenarios/demo'), patch.object(server,'answer_settings',return_value=server.answer_settings({})):
            with urlopen(self.url+'/api/agent/command?session=demo') as r:command=json.load(r)
            self.assertIn('--config',command['command']);self.assertIn('gemini-3.5-flash-lite',command['command']);self.assertIn('gemini-setup.mjs',command['gemini_setup_command'])
