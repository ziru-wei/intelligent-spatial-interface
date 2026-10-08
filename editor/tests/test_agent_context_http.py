import functools, json, sys, threading, unittest
from pathlib import Path
from urllib.request import urlopen
from urllib.error import HTTPError
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import server

class ContextHTTPTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=server.Server(('127.0.0.1',0),functools.partial(server.Handler,directory=str(server.ROOT)))
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.url='http://127.0.0.1:'+str(cls.server.server_port)
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def test_credentials_not_served(self):
        for path in ['/agent-config.local.json','/%61gent-config.local.json']:
            with self.assertRaises(HTTPError) as error:urlopen(self.url+path)
            self.assertEqual(error.exception.code,404)
    def test_command_and_catalog(self):
        from unittest.mock import patch
        with patch.object(server,'session_dir',return_value=server.ROOT/'spaces/demo/scenarios/demo'), patch.object(server,'answer_settings',return_value=server.answer_settings({})):
            with urlopen(self.url+'/api/agent/command?session=demo') as r:command=json.load(r)
            self.assertIn('--config',command['command']);self.assertIn('gemini-3.5-flash-lite',command['command']);self.assertIn('gemini-setup.mjs',command['gemini_setup_command'])
            with urlopen(self.url+'/api/agent/context?session=demo&catalog=1') as r:catalog=json.load(r)
            self.assertIn('context_groups',catalog);self.assertNotIn('weather',catalog);self.assertNotIn('objects',catalog)
            with urlopen(self.url+'/api/agent/context?session=demo&groups=storage') as r:section=json.load(r)
            self.assertIn('objects',section);self.assertNotIn('weather',section)
