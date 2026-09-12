// Deterministic mutation from a seed: same seed, same fly.
// Mirrors mutation_from_seed() in the Python model.
export async function mutationFromSeed(semilla, pool, k = 40) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(semilla));
  const b = new Uint8Array(h);
  let estado = 0n;
  for (let i = 0; i < 8; i++) estado = (estado << 8n) | BigInt(b[i]);
  const rnd = () => {                    // xorshift64* seeded from the hash
    estado ^= estado >> 12n; estado ^= (estado << 25n) & 0xFFFFFFFFFFFFFFFFn;
    estado ^= estado >> 27n;
    return Number((estado * 0x2545F4914F6CDD1Dn & 0xFFFFFFFFFFFFFFFFn) >> 33n) / 2147483648;
  };
  const p = [...pool];
  for (let i = p.length - 1; i > 0; i--) {        // Fisher-Yates
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p.slice(0, k).sort((a, b2) => a - b2);
}

export function nameFromSeed(semilla) {
  let h = 0;
  for (const c of semilla) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return '#' + (h >>> 0).toString(16).toUpperCase().padStart(6, '0').slice(0, 6);
}
