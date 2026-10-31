// Die Form des Berges + Snowpark-Elemente.
// Der Spieler fährt in Richtung -Z (bergab). heightAt(x, z) liefert die
// Schneehöhe an jeder Stelle – sowohl für die Grafik als auch für die Physik.
//
// Die Piste liegt auf einem breiten Bergrücken: links und rechts fällt das
// Gelände ab, sodass man über das Tal auf die umliegenden Gipfel schaut.
import * as THREE from 'three';
import { fbm, hash2 } from './noise.js';

export const SLOPE = 0.3;          // Grundgefälle (~17°)
export const PISTE_HALF = 38;      // halbe Pistenbreite in Metern
export const CHUNK_LEN = 100;      // Länge eines Geländestücks
export const X_RANGE = 420;        // Gelände reicht von -420 bis +420
export const FINE_RANGE = 150;     // feines Raster im Pistenbereich

export function pisteCenter(z) {
  return 55 * Math.sin(z * 0.0028) + 20 * Math.sin(z * 0.009 + 1.3);
}

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
function lateral(ax, half, fall) {
  if (ax <= half) return 1;
  if (ax >= half + fall) return 0;
  return 1 - smooth((ax - half) / fall);
}

// ---------- Natürliches Gelände ----------
export function baseHeight(x, z) {
  const cx = pisteCenter(z);
  const off = Math.max(0, Math.abs(x - cx) - PISTE_HALF);
  let h = z * SLOPE;
  h += fbm(x * 0.004 + 3, z * 0.004, 3, 21) * 16;                   // große Geländeformen
  h += fbm(x * 0.012, z * 0.012, 3, 1) * 4;                         // Wellen
  h -= off * off * 0.0011;                                          // Bergrücken: Seiten fallen ab
  h += fbm(x * 0.03, z * 0.03, 2, 4) * Math.min(off, 60) * 0.09;    // raues Gelände abseits
  h += fbm(x * 0.09, z * 0.09, 2, 2) * (0.12 + Math.min(off, 30) * 0.03); // Buckel
  return h;
}

// ---------- Snowpark ----------
// Alle 65 m gibt es einen "Slot" mit einem oder zwei Park-Elementen.
export const SLOT_START = -110;
export const SLOT_SPACING = 65;
const PATTERN = ['kickerLine', 'rail', 'table', 'box', 'rollers', 'bigKicker', 'rail', 'kickerLine', 'box', 'table', 'bigKicker', 'rollers'];

function kicker(x, z, h, L, W, D) {
  // h: Höhe der Kante über dem Deck, L: Anlauflänge, W: Breite,
  // D: Deck-Höhe (der ganze Anlauf ist aufgeschüttet, die Landung steil)
  return { type: 'kicker', x, z, h, L, W, D, inrun: 40, drop: 1.6, land: 24 };
}
function rail(kind, x, z, len, H) {
  return { type: 'rail', kind, x, z, len, H, ramp: 4, half: kind === 'box' ? 0.28 : 0.05 };
}

const cache = new Map();
export function slotFeatures(i) {
  if (i < 0) return [];
  let f = cache.get(i);
  if (f) return f;
  const z = SLOT_START - i * SLOT_SPACING;
  const type = PATTERN[i % PATTERN.length];
  const r = hash2(i, 3, 11);
  const c = pisteCenter(z);
  f = [];
  switch (type) {
    case 'kickerLine':
      f.push(kicker(c - 13, z, 2.0, 11, 7, 0.8));
      f.push(kicker(c + 10, z - 4, 3.2, 15, 9, 1.6));
      break;
    case 'bigKicker':
      f.push(kicker(c + (r - 0.5) * 16, z, 4.2, 19, 11, 2.4));
      break;
    case 'table':
      f.push({ type: 'table', x: c + (r - 0.5) * 20, z, H: 1.6, up: 7, flat: 9, down: 9, W: 9 });
      break;
    case 'rollers':
      f.push({ type: 'rollers', x: c + (r - 0.5) * 20, z, A: 1.3, lambda: 10, n: 3, W: 11 });
      break;
    case 'rail':
      f.push(rail('rail', c - 9 + (r - 0.5) * 6, z, 14, 0.8));
      f.push(rail('box', c + 9 + (r - 0.5) * 6, z - 6, 10, 0.5));
      break;
    case 'box':
      f.push(rail('box', c + (r - 0.5) * 14, z, 12, 0.55));
      f.push(rail('rail', c + (r - 0.5) * 14 + (r < 0.5 ? 14 : -14), z - 10, 11, 0.9));
      break;
  }
  f.forEach((e) => { e.slot = i; });
  cache.set(i, f);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return f;
}

export function slotIndex(z) {
  return Math.round((SLOT_START - z) / SLOT_SPACING);
}

export function featuresNear(z, range = 1) {
  const i0 = slotIndex(z);
  const out = [];
  for (let i = i0 - range; i <= i0 + range; i++) out.push(...slotFeatures(i));
  return out;
}

// Höhe, die ein Park-Element an (x, z) hinzufügt
function featureHeight(f, x, z) {
  const dz = f.z - z; // 0 am Anfang des Elements, wächst bergab
  const ax = Math.abs(x - f.x);
  switch (f.type) {
    case 'kicker': {
      if (dz < -f.inrun || dz > f.L + f.drop + f.land) return 0;
      let total = 0;
      const dw = lateral(ax, f.W / 2 + 1.5, 6);
      if (dw > 0) {
        let deck;
        if (dz < 0) deck = f.D * smooth((dz + f.inrun) / f.inrun);
        else if (dz <= f.L + f.drop) deck = f.D;
        else deck = f.D * (1 - smooth((dz - f.L - f.drop) / f.land));
        total += deck * dw;
      }
      const kw = lateral(ax, f.W / 2, 2.5);
      if (kw > 0 && dz >= 0 && dz <= f.L + f.drop) {
        const kick = dz <= f.L ? f.h * (dz / f.L) ** 2 : f.h * (1 - smooth((dz - f.L) / f.drop));
        total += kick * kw;
      }
      return total;
    }
    case 'table': {
      const len = f.up + f.flat + f.down;
      if (dz < 0 || dz > len) return 0;
      const w = lateral(ax, f.W / 2, 3);
      if (w === 0) return 0;
      let p;
      if (dz < f.up) p = (dz / f.up) ** 1.6;
      else if (dz < f.up + f.flat) p = 1;
      else p = 1 - smooth((dz - f.up - f.flat) / f.down);
      return f.H * p * w;
    }
    case 'rollers': {
      if (dz < 0 || dz > f.n * f.lambda) return 0;
      const w = lateral(ax, f.W / 2, 3);
      return w * f.A * (1 - Math.cos((2 * Math.PI * dz) / f.lambda)) * 0.5;
    }
    default:
      return 0;
  }
}

// Gelände inklusive Schanzen etc., aber ohne die Auffahrten zu Rails/Boxen
export function heightNoRails(x, z) {
  let h = baseHeight(x, z);
  const i0 = slotIndex(z);
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    for (const f of slotFeatures(i)) {
      if (f.type !== 'rail') h += featureHeight(f, x, z);
    }
  }
  return h;
}

// Linie der Rail-Oberkante (wird einmal berechnet)
export function railLine(r) {
  if (!r.line) {
    const y0 = heightNoRails(r.x, r.z) + r.H;
    const y1 = heightNoRails(r.x, r.z - r.len) + r.H;
    const start = new THREE.Vector3(r.x, y0, r.z);
    const end = new THREE.Vector3(r.x, y1, r.z - r.len);
    const dir = end.clone().sub(start);
    const length = dir.length();
    dir.divideScalar(length);
    r.line = { start, end, dir, length };
  }
  return r.line;
}

export function heightAt(x, z) {
  let h = heightNoRails(x, z);
  // kleine Auffahrt aus Schnee vor jeder Rail/Box
  const i0 = slotIndex(z);
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    for (const f of slotFeatures(i)) {
      if (f.type !== 'rail') continue;
      const dz = f.z - z;
      if (dz < -f.ramp || dz >= 0) continue;
      const w = lateral(Math.abs(x - f.x), 0.9, 1.6);
      if (w > 0) h += f.H * smooth((dz + f.ramp) / f.ramp) * w;
    }
  }
  return h;
}

export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 0.25;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-dx, 2 * e, -dz).normalize();
}

// Richtung (Yaw) der Piste an der Stelle z, für den Neustart
export function pisteHeading(z) {
  const dx = pisteCenter(z - 1) - pisteCenter(z);
  return Math.atan2(-dx, 1);
}

// Liegt (x, z) in der Nähe eines Park-Elements? (dort keine Bäume/Felsen)
export function nearFeature(x, z, margin = 8) {
  for (const f of featuresNear(z)) {
    let zTop = f.z + margin;
    let zBot = f.z - margin;
    let half = margin;
    if (f.type === 'kicker') { zTop += f.inrun; zBot -= f.L + f.drop + f.land; half += f.W / 2 + 7; }
    else if (f.type === 'table') { zBot -= f.up + f.flat + f.down; half += f.W / 2 + 3; }
    else if (f.type === 'rollers') { zBot -= f.n * f.lambda; half += f.W / 2 + 3; }
    else { zTop += f.ramp; zBot -= f.len; half += 2; }
    if (z <= zTop && z >= zBot && Math.abs(x - f.x) < half) return true;
  }
  return false;
}
