#!/usr/bin/env python3
"""Bundle Lectern into one self-contained HTML file."""
import base64, os, re, sys
ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'src')
ICONS = next(p for p in [os.path.join(ROOT, 'vendor', 'lucide', 'icons'), os.path.join(ROOT, '..', 'vendor', 'lucide', 'icons')] if os.path.isdir(p))
MEDIA = os.path.join(ROOT, 'media')
OUT = os.environ.get('LECTERN_OUT') or os.path.join(ROOT, 'dist', 'lectern.html')

read = lambda p: open(os.path.join(SRC, p), encoding='utf-8').read()
css = read('styles.css')
body = read('body.html')
js_parts = ['data.js', 'engine.js', 'core.js', 'audio.js', 'ui.js', 'stage.js', 'drafts.js', 'vocal.js', 'fx.js', 'studio.js', 'creator.js', 'auth.js', 'init.js', 'native.js']
js = '\n'.join(read(p) for p in js_parts)

# collect icon names
avail = {f[:-4] for f in os.listdir(ICONS) if f.endswith('.svg')}
names = set(re.findall(r'#i-([a-z0-9-]+)', body + js))
names |= {m for m in re.findall(r"""['"]([a-z0-9]+(?:-[a-z0-9]+)*)['"]""", js) if m in avail}
missing = sorted(n for n in re.findall(r'#i-([a-z0-9-]+)', body) if n not in avail)
missing += sorted(n for n in re.findall(r"ic\('([a-z0-9-]+)'", js) if n not in avail)
if missing:
    print('MISSING ICONS:', sorted(set(missing))); sys.exit(1)
symbols = []
for n in sorted(names & avail):
    svg = open(os.path.join(ICONS, n + '.svg'), encoding='utf-8').read()
    inner = re.sub(r'^.*?<svg[^>]*>', '', svg, flags=re.S)
    inner = re.sub(r'</svg>\s*$', '', inner.strip()).strip()
    inner = re.sub(r'\s+', ' ', inner)
    symbols.append(f'<symbol id="i-{n}" viewBox="0 0 24 24">{inner}</symbol>')
sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">' + ''.join(symbols) + '</svg>'

embed = {}
for key, fn in [('remember', 'Remember.mp3'), ('home', 'Home.mp3'), ('millie', 'Leaving_Millie_live_piano_.mp3')]:
    embed[key] = base64.b64encode(open(os.path.join(MEDIA, fn), 'rb').read()).decode()
embed_js = 'window.__EMBED={' + ','.join(f'{k}:"{v}"' for k, v in embed.items()) + '};'

html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0E0E10">
<meta name="description" content="Lectern: karaoke with synced lyrics, poems and movie lines on a teleprompter, and a studio for voice effects and video filters.">
<title>Lectern</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&family=Lora:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
<style>
{css}
</style>
</head>
<body>
{sprite}
{body}
<script>{embed_js}</script>
<script>
(function(){{
{js}
}})();
</script>
</body>
</html>
'''
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w', encoding='utf-8').write(html)
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
open(os.path.join(ROOT, 'dist', 'app.check.js'), 'w', encoding='utf-8').write(js)
print(f'OK {len(symbols)} icons, {os.path.getsize(OUT)/1048576:.2f} MB -> {OUT}')
