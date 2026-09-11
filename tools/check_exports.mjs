// verificacion generica: cada import debe existir en el modulo destino
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
// repo root -> js/  (works wherever the repo is cloned)
const dir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'js') + '/';
let fallos = 0;
for (const f of readdirSync(dir).filter(n => n.endsWith('.js'))) {
  const src = readFileSync(dir + f, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([^']+)'/g)) {
    const nombres = m[1].split(',').map(s => s.trim()).filter(Boolean);
    let destino;
    try { destino = await import('file://' + dir + m[2]); }
    catch (e) { console.log(`  ROTO ${f} -> ${m[2]}: ${e.message}`); fallos++; continue; }
    for (const n of nombres) {
      if (!(n in destino)) { console.log(`  ROTO ${f} importa '${n}' de ${m[2]}, que no lo exporta`); fallos++; }
      else console.log(`  OK   ${f} <- ${n} (${m[2]})`);
    }
  }
}
console.log(fallos ? `\n${fallos} import(s) rotos` : '\nTodos los imports resuelven');
