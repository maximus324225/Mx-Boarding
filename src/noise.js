// Zufalls- und Rauschfunktionen für die Geländeerzeugung.
// Alles ist "deterministisch": gleiche Eingabe -> gleiches Ergebnis,
// damit der Berg immer gleich aussieht, egal wann ein Stück erzeugt wird.

export function hash2(ix, iz, seed = 0) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const lerp = (a, b, t) => a + (b - a) * t;

// Weiches Rauschen im Bereich -1 .. 1
export function valueNoise(x, z, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz) * 2 - 1;
}

// Mehrere Rausch-Ebenen übereinander (große Hügel + kleine Wellen)
export function fbm(x, z, octaves = 3, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 17) * amp;
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
}

// Einfacher Zufallsgenerator mit Startwert
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
