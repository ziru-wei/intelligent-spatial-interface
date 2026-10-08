import shlex, sys, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import server

class AnswerSettingsTest(unittest.TestCase):
    def test_defaults_and_config_match_bridge(self):
        expected=dict(provider='gemini',model='gemini-3.5-flash-lite',effort='minimal')
        self.assertEqual(server.answer_settings({}),expected)
        self.assertEqual(server.answer_settings(dict(answerModel='gpt-6-luna',answerEffort='low')),expected)
        self.assertEqual(server.answer_settings(dict(answerProvider='luna',answerModel='gpt-6-luna',answerEffort='low')),dict(provider='luna',model='gpt-6-luna',effort='low'))
        self.assertEqual(server.answer_settings(dict(answerProvider='gemini',answerModel='gemini-3.1-flash-lite',answerEffort='minimal'))['model'],'gemini-3.1-flash-lite')

    def test_copied_command_exposes_model_without_credentials(self):
        with patch.object(server,'session_dir',return_value=server.ROOT/'spaces/demo/scenarios/demo'), patch.object(server,'answer_settings',return_value=server.answer_settings({})):
            command=shlex.split(server.agent_command('fixture','127.0.0.1:8766'))
        self.assertEqual(command[command.index('--provider')+1],'gemini')
        self.assertEqual(command[command.index('--model')+1],'gemini-3.5-flash-lite')
        self.assertEqual(command[command.index('--effort')+1],'minimal')
        self.assertIn('--config',command);self.assertNotIn('--api-key',command)
