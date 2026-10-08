"""Mock weather protocol. The agent selects forecast IDs; the server resolves their exact values.
No web weather, model inference or arbitrary effect code is involved."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
CONDITIONS = {'clear', 'partly_cloudy', 'cloudy', 'rain', 'snow', 'fog', 'storm'}

def context(d, groups=None):
    from user_context import read
    return read(d, groups)

def resolve(d, selection):
    ids = selection.get('forecast_ids') if isinstance(selection, dict) else None
    if not isinstance(ids, list) or not 1 <= len(ids) <= 384 or any(not isinstance(i, str) for i in ids):
        raise ValueError('Weather needs 1–384 forecast_ids from get_user_context.')
    periods = context(d, ['weather']).get('weather', {}).get('forecast', [])
    entries = {e['id']: e for parent in periods for e in [parent]+parent.get('samples', [])}
    if len(set(ids)) != len(ids) or any(i not in entries for i in ids):
        raise ValueError('Unknown or duplicate weather forecast ID. Read get_user_context first.')
    chosen = sorted((entries[i] for i in ids), key=lambda e: (e['date'], e.get('local_time', e.get('time', '00:00'))))
    if any(e['condition'] not in CONDITIONS for e in chosen): raise ValueError('Unsupported weather condition.')
    days = sorted({e['date'] for e in chosen})
    request = selection.get('preview') or {}
    if not isinstance(request, dict): raise ValueError('weather.preview must be an object.')
    component = request.get('component') or ('weather-day-buttons' if len(days)>1 else 'weather-timeline' if len(chosen)>1 else 'weather-single')
    expected = {'weather-day-buttons'} if len(days)>1 else {'weather-timeline', 'weather-single'} if len(chosen)==1 else {'weather-timeline'}
    if component not in expected: raise ValueError('Request weather-day-buttons across dates, weather-timeline within a day, or weather-single for one instant.')
    timeline = [sample for e in chosen for sample in (e.get('samples') or [e])] if component!='weather-single' else chosen
    timeline = sorted({e['id']:e for e in timeline}.values(), key=lambda e:(e['date'],e.get('local_time',e.get('time','00:00'))))
    if any(e['condition'] not in CONDITIONS for e in timeline): raise ValueError('Unsupported weather sample.')
    return dict(version=2, mod='weather', mock=True, forecast=chosen, timeline=timeline,
                preview=dict(component=component, autoplay=True, seconds_per_period=8, dates=days),
                presentation=dict(anchor='user-view', background='composited-scene', tracking='recording-timeline', style='adaptive'))
