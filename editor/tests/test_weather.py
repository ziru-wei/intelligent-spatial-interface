import json, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import weather, agent_store as store

class WeatherTest(unittest.TestCase):
    def test_varied_periods_and_week(self):
        ctx = weather.context(Path('/tmp/no-weather-scenario'))
        entries = ctx['weather']['forecast']
        self.assertEqual(len(entries), 96)
        self.assertEqual(len({e['id'] for e in entries}), 96)
        for day in range(32):
            rows = entries[day*3:day*3+3]
            self.assertEqual([e['period'] for e in rows], ['morning', 'afternoon', 'evening'])
            self.assertEqual(len({e['condition'] for e in rows}), 3)
        week = [e['id'] for e in entries[3:24]]
        self.assertEqual(len(weather.resolve(Path('/tmp/no-weather-scenario'), {'forecast_ids': week})['forecast']), 21)

    def test_canonical_weather_and_mode_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp, store.lock:
            d = Path(tmp); c = store.create(d); forecast = weather.context(d)['weather']['forecast']
            q = store.ask(d, c['id'], 0, 0, 'Tonight weather?', weather_mod=True)
            store.editor_state[str(d)] = {'weather_mod': False}
            r = store.add_response(d, dict(question_id=q['id'], title='Tonight: rain', weather={'forecast_ids': [forecast[2]['id']], 'condition': 'snow'}))
            self.assertEqual(r['weather']['forecast'], [forecast[2]])
            self.assertEqual(store.read(d, c['id'])['responses'][0]['weather'], r['weather'])
            q2 = store.ask(d, c['id'], 0, 0, 'Weather off')
            with self.assertRaises(ValueError): store.add_response(d, dict(question_id=q2['id'], title='No', weather={'forecast_ids': [forecast[0]['id']]}))
            q3 = store.ask(d, c['id'], 0, 0, 'Laundry?', weather_mod=True)
            self.assertNotIn('weather', store.add_response(d, dict(question_id=q3['id'], title='14 items')))
            self.assertEqual(len(store.read(d,c['id'])['responses']), 2)

    def test_requested_preview_components(self):
        d = Path('/tmp/no-weather-scenario'); rows = weather.context(d)['weather']['forecast']
        afternoon = weather.resolve(d, {'forecast_ids':[rows[1]['id']], 'preview':{'component':'weather-timeline'}})
        self.assertEqual(afternoon['preview']['component'], 'weather-timeline')
        self.assertEqual(len(afternoon['timeline']), 3)
        exact = weather.resolve(d, {'forecast_ids':[rows[1]['samples'][1]['id'],rows[1]['samples'][2]['id']], 'preview':{'component':'weather-timeline'}})
        self.assertEqual([e['local_time'] for e in exact['timeline']], ['15:00','17:00'])
        self.assertEqual([x['local_time'] for x in afternoon['timeline']], ['12:00','15:00','17:00'])
        across = weather.resolve(d, {'forecast_ids':[rows[4]['id'],rows[1]['id']], 'preview':{'component':'weather-day-buttons'}})
        self.assertTrue(across['preview']['autoplay'])
        self.assertEqual(len(across['preview']['dates']), 2)
        self.assertEqual(across['presentation']['anchor'], 'user-view')
        with self.assertRaises(ValueError): weather.resolve(d, {'forecast_ids':[rows[4]['id'],rows[1]['id']], 'preview':{'component':'weather-timeline'}})

    def test_invalid_forecasts(self):
        d = Path('/tmp/no-weather-scenario'); first = weather.context(d)['weather']['forecast'][0]['id']
        for value in (None, {}, {'forecast_ids': []}, {'forecast_ids': ['invented']}, {'forecast_ids': [first, first]}, {'forecast_ids': [1]}, {'forecast_ids': [first]*25}):
            with self.assertRaises(ValueError): weather.resolve(d, value)

if __name__ == '__main__': unittest.main()
