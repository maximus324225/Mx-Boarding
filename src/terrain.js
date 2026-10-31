// Die Form des Berges.
// Der Spieler fährt in Richtung -Z (bergab). heightAt(x, z) liefert die
// Schneehöhe an jeder Stelle – sowohl für die Grafik als auch für die Physik.
import * as THREE from 'three';
import { fbm, hash2 } from './noise.js';

export const SLOPE = 0.3;          // Grundgefälle (~17°)
export const PISTE_HALF = 28;      // halbe Pistenbreite in Metern
export const CHUNK_LEN = 100;      // Länge eines Geländestücks
export const X_MIN = -200;
export const X_MAX = 200;

// Die Piste schlängelt sich den Berg hinunter
export function pisteCenter(z) {
  return 45 * Math.sin(z * 0.0035) + 18 * Math.sin(z * 0.011 + 1.3);
}

// ---- Schanzen (Kicker) ----
export const KICK_SPACING = 230;
export const KICK_START = -260;

export function kickerAt(index) {
  const z = KICK_START - index * KICK_SPACING;
  const x = pisteCenter(z - 7) + (hash2(index, 7, 3) - 0.5) * 22;
  return { x, z, len: 13, h: 1.8 + hash2(index, 9, 3) * 1.0, halfW: 4.5, drop: 1.6 };
}

export function nearestKickerIndex(z) {
  return Math.round((KICK_START - z) / KICK_SPACING);
}

const smooth = (t) => t * t * (3 - 2 * t);

function kickerHeight(x, z) {
  const idx = nearestKickerIndex(z);
  if (idx < 0) return 0;
  const k = kickerAt(idx);
  const dz = k.z - z; // 0 am Anfang der Rampe, wächst bergab
  if (dz < 0 || dz > k.len + k.drop) return 0;
  const dx = Math.abs(x - k.x);
  if (dx > k.halfW + 2.5) return 0;
  const wx = dx < k.halfW ? 1 : 1 - smooth((dx - k.halfW) / 2.5);
  let p;
  if (dz <= k.len) {
    const t = dz / k.len;
    p = t * t; // gekrümmter Anlauf
  } else {
    p = 1 - smooth((dz - k.len) / k.drop); // steile Kante hinten
  }
  return p * k.h * wx;
}

export function heightAt(x, z) {
  const cx = pisteCenter(z);
  const adx = Math.abs(x - cx);
  const off = Math.max(0, adx - PISTE_HALF); // Meter außerhalb der Piste

  let h = z * SLOPE;
  h += fbm(x * 0.012, z * 0.012, 3, 1) * 6;               // große Geländewellen
  h += off * off * 0.012 + off * 0.15;                     // Hänge links/rechts steigen an
  h += fbm(x * 0.06, z * 0.06, 2, 2) * (0.25 + Math.min(off, 30) * 0.05); // Buckel, abseits stärker
  h += kickerHeight(x, z);
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
