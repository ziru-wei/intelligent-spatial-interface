"""Group catalog and lazy section loading; local date is evaluated at read time."""
import json
from datetime import datetime, date, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT = Path(__file__).resolve().parents[1]
LEGACY_GROUPS = {
    'weather': ('Weather forecast, temperature, rain, wind and outdoor conditions.', ['weather']),
    'storage': ('Stored objects, food, supplies, locations and appliance state.', ['objects', 'food', 'supplies', 'belongings', 'stored_items']),
    'user_events': ('Calendar, recurring activities, meetings and availability.', ['calendar', 'work', 'commute']),
    'personal': ('Preferences, routines, recent activity and other personal facts.', []),
}

def read(d, groups=None, now=None):
    source = next(p for p in (d/'context.json', d.parent.parent/'context.json', ROOT/'agent/mock-context.json') if p.is_file())
    raw = json.loads(source.read_text())
    manifest = raw.get('groups')
    if manifest is None:
        known = {key for _, keys in LEGACY_GROUPS.values() for key in keys} | {'mock', 'note', 'time', 'timezone', 'user'}
        manifest = {k: dict(description=desc, keys=keys if k != 'personal' else [x for x in raw if x not in known]) for k, (desc, keys) in LEGACY_GROUPS.items()}
    selected = list(manifest) if groups is None else groups
    if any(k not in manifest for k in selected): raise ValueError('Unknown context group.')
    timezone = raw.get('timezone', raw.get('time', {}).get('timezone', 'America/Denver'))
    current = (now or datetime.now(ZoneInfo(timezone))).astimezone(ZoneInfo(timezone))
    result = {k: raw[k] for k in ('mock', 'note', 'user') if k in raw}
    result['time'] = dict(date=current.date().isoformat(), local=current.strftime('%H:%M'), weekday=current.strftime('%A'), timezone=timezone)
    result['context_groups'] = {k: dict(description=v['description']) for k,v in manifest.items()}
    result['loaded_groups'] = selected
    for key in selected:
        meta = manifest[key]
        if 'file' in meta:
            path = (source.parent/meta['file']).resolve()
            if not path.is_relative_to(source.parent.resolve()): raise ValueError('Context group file must be inside context directory.')
            section = json.loads(path.read_text())
        else: section = {k:raw[k] for k in meta['keys'] if k in raw}
        result.update(section)
    if isinstance(result.get('calendar'), list): result['today'] = _today(result['calendar'], current.date())
    if 'weather' in result:
        weather = result['weather']; weather['reference_date'] = current.date().isoformat()
        weather['forecast'] = sorted(weather.get('forecast', []), key=lambda e:(e['date'],e.get('time','')))
        for row in weather['forecast']:
            for e in [row]+row.get('samples', []):
                offset = (date.fromisoformat(e['date'])-current.date()).days
                e['day_offset'] = offset
                e['day_label'] = 'Today' if offset == 0 else 'Tomorrow' if offset == 1 else date.fromisoformat(e['date']).strftime('%A, %b %d')
    return result

def _occurs(e, day):
    """Whether a calendar entry happens on a day: weekly recurrence (weekdays), a date, or a 'when' that starts with its weekday and date."""
    rec = e.get('recurrence') or {}
    if rec.get('frequency') == 'weekly': return day.strftime('%A') in rec.get('weekdays', [])
    when = str(e.get('date') or e.get('when') or '')
    return day.isoformat() in when

def _today(calendar, today):
    """Recurring and dated entries resolved against the local date, so a model need not work out that Friday's weekly badminton is
    today: {date, weekday, events: [...today's], next_7_days: [{date, weekday, events}]} (events: what, plus period/when/where)."""
    pick = lambda e: {k: e[k] for k in ('what', 'period', 'when', 'where', 'note') if k in e}
    days = [today+timedelta(days=i) for i in range(8)]
    return dict(date=today.isoformat(), weekday=today.strftime('%A'), events=[pick(e) for e in calendar if _occurs(e, today)],
                next_7_days=[dict(date=d.isoformat(), weekday=d.strftime('%A'), events=[e['what'] for e in calendar if _occurs(e, d) and 'what' in e]) for d in days[1:]])
