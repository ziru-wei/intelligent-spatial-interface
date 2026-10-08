import json, sys, tempfile, unittest
from pathlib import Path
from datetime import datetime, timezone
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import user_context

class ContextTest(unittest.TestCase):
    def test_catalog_does_not_open_groups_and_selected_loads_only_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp)
            (d/'context.json').write_text(json.dumps({'groups':{'storage':{'description':'Inventory','file':'storage.json'},'weather':{'description':'Forecast','file':'missing.json'}}}))
            (d/'storage.json').write_text('{"objects":[{"item":"eggs","count":0}]}')
            catalog=user_context.read(d,[])
            self.assertNotIn('objects',catalog)
            selected=user_context.read(d,['storage'])
            self.assertEqual(selected['objects'][0]['count'],0)
            self.assertNotIn('weather',selected)
            with self.assertRaises(ValueError):user_context.read(d,['invented'])

    def test_date_rollover_and_mock_range(self):
        d=Path('/tmp/no-user-context-fixture')
        before=user_context.read(d,['weather'],datetime(2026,10,8,5,59,tzinfo=timezone.utc))
        after=user_context.read(d,['weather'],datetime(2026,10,8,6,0,tzinfo=timezone.utc))
        self.assertEqual(before['time']['date'],'2026-10-07')
        self.assertEqual(after['time']['date'],'2026-10-08')
        self.assertEqual(after['weather']['reference_date'],'2026-10-08')
        rows=after['weather']['forecast']
        self.assertEqual((rows[0]['date'],rows[-1]['date'],len(rows)),('2026-10-07','2026-11-07',96))
        self.assertEqual(rows[0]['day_offset'],-1)
        self.assertEqual(rows[3]['day_label'],'Today')

    def test_storage_and_event_facts(self):
        data=user_context.read(Path('/tmp/no-user-context-fixture'),['storage','user_events'])
        fridge=next(x for x in data['objects'] if x['id']=='fridge')
        self.assertEqual(next(x for x in fridge['state']['contents'] if x['item']=='eggs')['count'],0)
        events={e['id']:e for e in data['calendar']}
        self.assertEqual(events['badminton']['recurrence']['weekdays'],['Monday','Wednesday','Friday'])
        self.assertEqual(events['denver-hangout']['date'],'2026-10-10')

    def test_legacy_context_groups(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp);(d/'context.json').write_text(json.dumps({'food':{'eggs':0},'weather':{'forecast':[]},'health':{'sleep':'good'}}))
            data=user_context.read(d,['storage'])
            self.assertEqual(data['food'],{'eggs':0});self.assertNotIn('health',data);self.assertNotIn('weather',data)
