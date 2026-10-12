"""Resolve Record3D exports, including numbered names produced when unpacking on macOS."""
from pathlib import Path
import re


def part(source, name):
    source = Path(source)
    exact = source/name
    if exact.exists(): return exact
    stem, suffix = Path(name).stem, Path(name).suffix
    matches = [p for p in source.glob(f'{stem} *{suffix}')
               if re.fullmatch(re.escape(stem)+r' \d+'+re.escape(suffix), p.name)]
    if len(matches) > 1: raise ValueError(f'Ambiguous {name} in {source.name}')
    return matches[0] if matches else exact
