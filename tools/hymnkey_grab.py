#!/usr/bin/env python3
"""HymnKey grabber: downloads the public hymn pages politely and saves the raw HTML,
so the parsing can be done afterwards. Python 3 standard library only (works in Termux).

  python hymnkey_grab.py --test        # first 3 hymn pages only
  python hymnkey_grab.py               # everything (safe to stop and run again: it resumes)
  python hymnkey_grab.py --zip         # (re)make hymnkey_raw.zip from what is downloaded
"""
import argparse, gzip, os, re, sys, time, urllib.request, urllib.robotparser, zipfile, hashlib
from urllib.parse import urlparse, urljoin
from xml.etree import ElementTree as ET

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='https://hymnkey.com')
ap.add_argument('--out', default='hymnkey_raw')
ap.add_argument('--delay', type=float, default=1.5, help='seconds between requests')
ap.add_argument('--test', action='store_true')
ap.add_argument('--zip', action='store_true')
ap.add_argument('--include', default='', help='only URLs containing this text')
a = ap.parse_args()
UA = 'SongbookGrabber/1.0 (personal worship songbook; polite, slow, honours robots.txt)'
os.makedirs(a.out, exist_ok=True)

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'gzip', 'Accept-Language': 'en'})
    for n in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                b = r.read()
                if r.headers.get('Content-Encoding') == 'gzip': b = gzip.decompress(b)
                return b.decode(r.headers.get_content_charset() or 'utf-8', 'replace')
        except Exception as e:
            if n == 3: raise
            time.sleep(3 * (n + 1))

def make_zip():
    z = os.path.abspath(a.out) + '.zip'
    with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as f:
        for fn in sorted(os.listdir(a.out)): f.write(os.path.join(a.out, fn), fn)
    print('Zip ready:', z, '(%d files)' % len(os.listdir(a.out)))

if a.zip: make_zip(); sys.exit(0)

rp = urllib.robotparser.RobotFileParser()
try: rp.parse(get(a.base + '/robots.txt').splitlines())
except Exception: rp = None
ok = lambda u: rp is None or rp.can_fetch(UA, u)

def sitemap_urls(u, depth=0):
    out = []
    try: root = ET.fromstring(get(u).encode('utf-8'))
    except Exception as e: print('Could not read', u, e); return out
    for loc in root.iter():
        if loc.tag.endswith('loc') and loc.text:
            t = loc.text.strip()
            if t.endswith('.xml') and depth < 2: out += sitemap_urls(t, depth + 1)
            else: out.append(t)
    return out

urls = sitemap_urls(a.base + '/sitemap.xml')
if not urls:
    print('No sitemap found; reading links from the home page.')
    html = get(a.base + '/')
    urls = sorted({urljoin(a.base + '/', h.split('#')[0]) for h in re.findall(r'href="([^"]+)"', html)})
host = urlparse(a.base).netloc
urls = [u for u in dict.fromkeys(urls) if urlparse(u).netloc == host and not re.search(r'\.(png|jpg|svg|pdf|mp3|css|js|xml|txt)$', u, re.I)]
if a.include: urls = [u for u in urls if a.include in u]
open(os.path.join(a.out, '_all_urls.txt'), 'w').write('\n'.join(urls))
print(len(urls), 'pages listed')
# keep pages that look like hymn pages when the site has clear patterns, otherwise take all
hy = [u for u in urls if re.search(r'hymn', u, re.I) and urlparse(u).path.strip('/').count('/') >= 1]
todo = hy if len(hy) > 20 else urls
if a.test: todo = todo[:3]
print(len(todo), 'to download')
done = 0
for i, u in enumerate(todo, 1):
    name = re.sub(r'[^A-Za-z0-9._-]+', '_', urlparse(u).path.strip('/') or 'home')[:120] or hashlib.md5(u.encode()).hexdigest()
    fp = os.path.join(a.out, name + '.html')
    if os.path.exists(fp): continue
    if not ok(u): print('robots.txt says no:', u); continue
    try:
        open(fp, 'w', encoding='utf-8').write('<!-- url: ' + u + ' -->\n' + get(u)); done += 1
        print('[%d/%d] %s' % (i, len(todo), u))
    except Exception as e: print('FAILED', u, e)
    time.sleep(a.delay)
print('Downloaded', done, 'new pages')
make_zip()
