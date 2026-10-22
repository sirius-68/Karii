// Bundles web/src into www/index.html (one self-contained file), the page the native app loads.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'www', 'index.html');
const py = process.platform === 'win32' ? 'python' : 'python3';
const r = spawnSync(py, [path.join(root, 'web', 'build.py')], { stdio: 'inherit', env: { ...process.env, LECTERN_OUT: out } });
if (r.error) { console.error('Python 3 is needed to bundle the web app:', r.error.message); process.exit(1); }
process.exit(r.status ?? 1);
