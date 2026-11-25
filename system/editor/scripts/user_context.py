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
    if isinstance(result.get('calendar'), list):
        result['calendar'] = [dated(e, current.date()) for e in result['calendar']]
        result['today'] = _today(result['calendar'], current.date())
    if 'weather' in result:
        weather = result['weather']; weather['reference_date'] = current.date().isoformat()
        weather['forecast'] = sorted(weather.get('forecast', []), key=lambda e:(e['date'],e.get('time','')))
        relabel(weather['forecast'], current.date())
    return result

def relabel(forecast, today):
    """A forecast's day words from its dates, seen from today: day_offset, day_label (Today, Tomorrow, else the weekday and date) and
    label (the date and period, or the date and time of a sample)."""
    for row in forecast:
        for e in [row]+row.get('samples', []):
            day = date.fromisoformat(e['date']); offset = (day-today).days
            e['day_offset'] = offset
            e['day_label'] = 'Today' if offset == 0 else 'Tomorrow' if offset == 1 else 'Yesterday' if offset == -1 else day.strftime('%A, %b %d')
            e['label'] = f"{e['date']} {e['local_time']}" if e.get('parent_id') and e.get('local_time') else f"{day:%A, %b %d} · {e.get('period') or e.get('time', '')}"
    return forecast

WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
def dated(e, today):
    """A calendar entry kept relative to today (`on`: "this Saturday", "next Friday", "tomorrow", "in 3 days", "today") with its
    date worked out now, so the mock data never goes stale (as the weather's dates follow today). "this <weekday>": its next
    occurrence from today on (today, if it is that day); "next <weekday>": a week after that. Other entries as they are."""
    rule = str(e.get('on') or '').strip().lower()
    if not rule: return e
    words = rule.split()
    if rule == 'today': day = today
    elif rule == 'tomorrow': day = today+timedelta(days=1)
    elif len(words) == 3 and words[0] == 'in' and words[1].isdigit() and words[2] in ('day', 'days'): day = today+timedelta(days=int(words[1]))
    elif len(words) == 2 and words[0] in ('this', 'next') and words[1].capitalize() in WEEKDAYS:
        day = today+timedelta(days=(WEEKDAYS.index(words[1].capitalize())-today.weekday()) % 7+(7 if words[0] == 'next' else 0))
    else: raise ValueError(f'Calendar entry {e.get("id")}: cannot read the day {e["on"]!r}.')
    return dict(e, date=day.isoformat())

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
