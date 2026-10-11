"""Builds the web app (installable, works offline) into ../docs from the same ui.html the desktop app uses."""
import hashlib
import json
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'docs'  # GitHub Pages publishes this folder
DOMAIN = 'timer.ricardocarmona.io'

HEAD = '''<meta name="theme-color" content="#0d0f14">
<meta name="description" content="Rest timer and workout runner: sets, rest countdowns, supersets, drop sets.">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Workout Timer">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="favicon.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">'''

MANIFEST = {
    'name': 'Workout Timer',
    'short_name': 'Timer',
    'description': 'Rest timer and workout runner.',
    'start_url': './',
    'scope': './',
    'display': 'standalone',
    'orientation': 'portrait',
    'background_color': '#0d0f14',
    'theme_color': '#0d0f14',
    'icons': [
        {'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
        {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
        {'src': 'icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
    ],
}

# Serve from cache instantly (works offline); refresh the cache in the background so updates land on the next open.
SW = '''const CACHE = 'wt-%(version)s';
const FILES = %(files)s;
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || fresh;
  }));
});
'''

# Security headers for hosts that read a _headers file (Cloudflare Pages, Netlify). GitHub Pages ignores it.
HEADERS = '''/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
  Strict-Transport-Security: max-age=31536000
/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
'''


def build():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    html = (HERE / 'ui.html').read_text(encoding='utf-8')
    marker = '<!--WEB-HEAD (build_web.py puts the install/offline tags here)-->'
    assert marker in html, 'ui.html lost its WEB-HEAD marker'
    (OUT / 'index.html').write_text(html.replace(marker, HEAD), encoding='utf-8')
    shutil.copy(HERE / 'icon-256.png', OUT)
    for f in (HERE / 'web-icons').iterdir():
        shutil.copy(f, OUT)
    (OUT / 'manifest.webmanifest').write_text(json.dumps(MANIFEST, indent=2), encoding='utf-8')
    (OUT / '_headers').write_text(HEADERS, encoding='utf-8')
    (OUT / 'CNAME').write_text(DOMAIN + '\n', encoding='utf-8')  # GitHub Pages custom domain

    files = sorted(p.name for p in OUT.iterdir() if p.name not in ('_headers', 'CNAME'))
    version = hashlib.sha256(b''.join((OUT / f).read_bytes() for f in files)).hexdigest()[:10]
    cached = ['./'] + [f for f in files if f != 'index.html']
    (OUT / 'sw.js').write_text(SW % {'version': version, 'files': json.dumps(cached)}, encoding='utf-8')
    print(f'web app built in {OUT} (version {version})')


if __name__ == '__main__':
    build()
