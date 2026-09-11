"""Empaqueta el overlay en UN script clasico.

Un content script no puede usar import() ni new Worker() en cualquier web:
los bloquea el CSP de la pagina. Asi que se concatenan los mismos ficheros
fuente que usa el panel (unica fuente de verdad) quitando la sintaxis de modulo.
"""
import os
# Where the working tree lives (connectome data, results). Override with FLY_HOME.
BASE = os.path.expanduser(os.environ.get('FLY_HOME', '~/fly-arena'))
import re, pathlib
E = pathlib.Path(BASE + '/extension')
PARTES = ['js/lif.js', 'js/mutation.js', 'js/fly-draw.js', 'js/overlay-core.js']

out = ['// GENERADO por src/build_overlay.py — no editar a mano.',
       '// Fuentes: ' + ', '.join(PARTES)]
for p in PARTES:
    s = (E / p).read_text()
    s = re.sub(r'^\s*import\s+.*?;\s*$', '', s, flags=re.M)      # sin imports
    s = re.sub(r'^\s*export\s+(?=(async\s+)?(class|function|const|let|var)\b)', '', s, flags=re.M)
    out.append(f'\n// ---------- {p} ----------\n{s}')
# estampar version en panel.js para invalidar la cache del worker
import time as _t
pj = E / 'js/panel.js'
_s = pj.read_text()
pj.write_text(re.sub(r"const VERSION = '[^']*'", f"const VERSION = '{int(_t.time())}'", _s))

dest = E / 'js/overlay.bundle.js'
dest.write_text('\n'.join(out))
print(f'[ok] {dest.name}  {dest.stat().st_size/1024:.0f} KB  ({len(PARTES)} ficheros)')
# al comprobar, ignorar comentarios: solo importa el codigo
codigo = re.sub(r'//.*$', '', dest.read_text(), flags=re.M)
codigo = re.sub(r'/\*.*?\*/', '', codigo, flags=re.S)
ok = True
for mal in ('import(', 'new Worker', 'export ', 'import '):
    n = codigo.count(mal)
    ok &= n == 0
    print(f'    {mal!r}: {n} {"OK" if n == 0 else "<-- QUEDA ALGO"}')
print('[veredicto]', 'apto como content script' if ok else 'NO apto: queda sintaxis de modulo')

# Comprobar que cada import resuelve. Un import roto tumba el modulo entero y
# deja el panel en blanco: paso exactamente eso al reescribir fly-draw.js.
import subprocess
r = subprocess.run(['node', str(pathlib.Path(__file__).parent / 'check_exports.mjs')],
                   capture_output=True, text=True)
print(r.stdout.rstrip() or r.stderr.rstrip()[:300])
if 'rotos' in r.stdout: raise SystemExit('ABORTADO: hay imports rotos')
