#!/usr/bin/env python3
"""Parses pages saved by tools/hymnkey_grab.py into the Songbook lyrics format.
Usage: python3 scripts/parse-hymnkey.py <folder with hymns_*.html> <out.json>"""
import re, sys, os, json, html
from html.parser import HTMLParser
class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.stack = []; s.sections = []; s.cur = None; s.line = None; s.syl = None; s.h1 = ''; s.inh1 = False
        s.texts = []; s.capture = None; s.meta = {}; s.lastdt = None; s.pbuf = None; s.credit = None
    def handle_starttag(s, tag, at):
        at = dict(at); cl = at.get('class', ''); s.stack.append((tag, cl))
        if tag == 'h1': s.inh1 = True
        if tag == 'span' and 'inline-flex flex-col' in cl:
            s.syl = {'chord': '', 'text': '', 'sp': 'mr-[0.4em]' in cl, 'i': 0}
        elif tag == 'span' and s.syl is not None: s.syl['i'] += 1; s.cap = 'chord' if s.syl['i'] == 1 else 'text'
        if tag == 'p': s.pbuf = ''
        if tag == 'dt': s.lastdt = ''
        if tag == 'dd': s.lastdd = ''
    def handle_endtag(s, tag):
        if s.stack: s.stack.pop()
        if tag == 'h1': s.inh1 = False
        if tag == 'span' and s.syl is not None and s.syl['i'] >= 2 and False: pass
        if tag == 'p' and s.pbuf is not None:
            t = s.pbuf.strip(); s.pbuf = None
            if s.line is not None and t != '' and s.line is not False: pass
            s.texts.append(t)
        if tag == 'dd' and s.lastdt is not None: s.meta[s.lastdt.strip()] = s.lastdd.strip(); s.lastdt = None
    def handle_data(s, d):
        if s.inh1: s.h1 += d
        if s.pbuf is not None: s.pbuf += d
        if s.lastdt is not None and s.stack and s.stack[-1][0] == 'dt': s.lastdt += d
        if s.stack and s.stack[-1][0] == 'dd' and getattr(s, 'lastdd', None) is not None: s.lastdd += d
def chordfix(c): return c.strip().replace('♭', 'b').replace('♯', '#')
def parse(page):
    t = re.sub(r'<script[\s\S]*?</script>', '', page); t = re.sub(r'<svg[\s\S]*?</svg>', '', t)
    url = (re.search(r'<!-- url: (.*?) -->', page) or [0, ''])[1]
    title = html.unescape(re.sub(r'<[^>]+>', '', re.search(r'<h1[^>]*>(.*?)</h1>', t, re.S).group(1))).replace('Lyrics, chords, sheet music and accompaniment in any key', '').strip()
    words = re.search(r'<p class="mt-2 text-\[13px\][^"]*">(Words:.*?)</p>', t, re.S)
    words = html.unescape(re.sub(r'<[^>]+>', '', words.group(1))).strip() if words else ''
    meta = {}
    for dt, dd in re.findall(r'<dt[^>]*>(.*?)</dt><dd[^>]*>(.*?)</dd>', t, re.S): meta[re.sub('<[^>]+>', '', dt).strip()] = html.unescape(re.sub('<[^>]+>', '', dd)).strip()
    cred = re.search(r'Print this under the words[^<]*</p><div[^>]*><p[^>]*>.*?</p>(.*?)</div>', t, re.S)
    credit = ' '.join(html.unescape(re.sub(r'<[^>]+>', '', x)).strip() for x in re.findall(r'<p[^>]*>.*?</p>', cred.group(1), re.S)) if cred else ''
    # chord sheet: find the block after 'chords</h2>'
    i = t.find('chords</h2>'); sec = t[i:]
    end = sec.find('About this score'); sec = sec[:end if end > 0 else len(sec)]
    out = []; pos = 0
    # split into labelled blocks: <p ...>Verse 1</p><div ...> lines </div>
    for m in re.finditer(r'<p[^>]*>([^<]{1,30})</p><div[^>]*>((?:<p[^>]*>.*?</p>)+?)</div>', sec, re.S):
        label = html.unescape(m.group(1)).strip(); lines = []
        for pm in re.finditer(r'<p[^>]*>(.*?)</p>', m.group(2), re.S):
            s = ''
            for sm in re.finditer(r'<span class="inline-flex flex-col([^"]*)">\s*<span[^>]*>(.*?)</span>\s*<span[^>]*>(.*?)</span>\s*</span>', pm.group(1), re.S):
                ch = chordfix(html.unescape(re.sub('<[^>]+>', '', sm.group(2)))); tx = html.unescape(re.sub('<[^>]+>', '', sm.group(3)))
                s += ('[' + ch + ']' if ch else '') + tx + (' ' if 'mr-[0.4em]' in sm.group(1) else '')
            if s.strip(): lines.append(s.rstrip())
        if lines: out.append('[' + label + ']\n' + '\n'.join(lines))
    body = '\n\n'.join(out)
    return {'url': url, 'title': title, 'words': words, 'key': meta.get('Key', ''), 'time': meta.get('Time', ''), 'tune': meta.get('Tune', ''), 'credit': credit, 'body': body}
if __name__ == '__main__':
    d, outp = sys.argv[1], sys.argv[2]; res = []
    for f in sorted(os.listdir(d)):
        if f.startswith('hymns_') and f.endswith('.html'): res.append(parse(open(os.path.join(d, f), encoding='utf-8').read()))
    json.dump(res, open(outp, 'w'), ensure_ascii=False, indent=1); print(len(res), 'hymns')
