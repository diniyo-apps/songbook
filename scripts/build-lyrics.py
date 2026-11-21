#!/usr/bin/env python3
"""Builds lyrics/index.json and lyrics/s/<id>.json (English songs) from the WorshipCommons catalog.
Usage: curl -sL https://raw.githubusercontent.com/ChurchApps/WorshipCommonsContent/main/catalog.json -o cat.json
       python3 scripts/build-lyrics.py cat.json"""
import json, re, sys, os
src = sys.argv[1]; root = os.path.join(os.path.dirname(__file__), '..', 'lyrics')
os.makedirs(os.path.join(root, 's'), exist_ok=True)
rows = [x for x in json.load(open(src))['rows'] if x.get('language') == 'English' and x.get('chordPro')]
HDR = re.compile(r'^(verse|chorus|pre[- ]?chorus|bridge|intro(duction)?|outro|ending|refrain|tag|interlude|instrumental|repeat chorus|coda|vamp)\b[\w ,:\-]{0,20}$', re.I)
def title(t): return re.sub(r'\s+', ' ', t.strip().rstrip(':')).title().replace('Pre Chorus', 'Pre-Chorus')
def convert(cp):
    out = []; lasthdr = False
    for l in cp.replace('\r', '').split('\n'):
        s = l.strip()
        m = re.match(r'^\{\s*(?:c|comment|ci)\s*:\s*(.+?)\s*\}$', s, re.I)
        if m:
            if not lasthdr: out.append('[' + title(m.group(1)) + ']')
            lasthdr = False; continue
        if s.startswith('{'): continue
        if s and '[' not in s and HDR.match(s):
            out.append('[' + title(s) + ']'); lasthdr = True; continue
        if s: lasthdr = False
        out.append(l.rstrip())
    txt = re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).strip()
    return txt
LIC = {'PD': 'PD', 'WC': 'WC', 'CC-BY': 'CC', 'CC-BY-SA': 'CC'}
index = []
for x in rows:
    lic = LIC.get(x['license'], 'OT')
    body = convert(x['chordPro'])
    index.append([x['id'], x['title'], x.get('writer') or '', x.get('songKey') or '', x.get('bpm') or 0, lic, x.get('year') or 0])
    json.dump({'t': x['title'], 'w': x.get('writer') or '', 'k': x.get('songKey') or '', 'bpm': x.get('bpm') or 0, 'lic': x['license'], 'lu': x.get('licenseUrl') or '', 'at': x.get('attribution') or '', 'y': x.get('year') or 0, 'b': body},
              open(os.path.join(root, 's', x['id'] + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
index.sort(key=lambda r: r[1].lower())
json.dump(index, open(os.path.join(root, 'index.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(index), 'songs')
