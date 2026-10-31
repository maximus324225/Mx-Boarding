// Alpines Bergpanorama: ein Ring aus hohen Gipfeln weit in der Ferne.
// Er wandert mit dem Spieler mit (wie ein Himmel), damit die Berge immer
// gleich weit weg wirken. Low-Poly mit Schnee oben und Fels an steilen Hängen.
import * as THREE from 'three';
import { valueNoise } from './noise.js';

function ridged(x, z, seed) {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < 6; o++) {
    const n = 1 - Math.abs(valueNoise(x * freq, z * freq, seed + o * 31));
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 1.9;
  }
  return sum / norm;
}

export function createMountains(hazeColor) {
  const group = new THREE.Group();
  const haze = new THREE.Color(hazeColor);

  const rings = [
    { r0: 1600, r1: 2700, rows: 16, peak: 300, seed: 3, scale: 0.0014, segs: 420, base: -150 },
    { r0: 2900, r1: 4900, rows: 20, peak: 700, seed: 9, scale: 0.0008, segs: 520, base: -60 },
  ];

  for (const R of rings) {
    const positions = [];
    const grid = [];
    for (let j = 0; j <= R.rows; j++) {
      const t = j / R.rows;
      const r = R.r0 + (R.r1 - R.r0) * t;
      const row = [];
      for (let i = 0; i <= R.segs; i++) {
        const a = (i / R.segs) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        // Profil: innen niedrig, in der Mitte die Gipfel, außen wieder etwas tiefer
        const env = Math.sin(Math.min(1, t * 1.25) * Math.PI) * 0.75 + 0.25;
        const rr = ridged(x * R.scale, z * R.scale, R.seed);
        const h = R.base + Math.pow(rr, 1.6) * R.peak * env * 1.5 + (t === 0 ? -80 : 0);
        row.push(new THREE.Vector3(x, h, z));
      }
      grid.push(row);
    }

    // Weich schattiertes Gitter mit Farben pro Eckpunkt (Schnee, Fels, Wald, Dunst)
    const cols = R.segs + 1;
    const pos = new Float32Array((R.rows + 1) * cols * 3);
    grid.forEach((row, j) => row.forEach((v, i) => pos.set([v.x, v.y, v.z], (j * cols + i) * 3)));
    const idx = [];
    for (let j = 0; j < R.rows; j++) {
      for (let i = 0; i < R.segs; i++) {
        const a = j * cols + i;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        idx.push(a, b, d, b, e, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const colors = new Float32Array(pos.length);
    const snow = new THREE.Color(0xf6f9ff);
    const rock = new THREE.Color(0x7c8293);
    const darkRock = new THREE.Color(0x585d6c);
    const forest = new THREE.Color(0x34463d);
    const c = new THREE.Color();
    for (let k = 0; k < pos.length / 3; k++) {
      const x = pos[k * 3];
      const y = pos[k * 3 + 1];
      const z = pos[k * 3 + 2];
      const flat = nrm.getY(k);
      const snowLine = R.base + R.peak * 0.4 + valueNoise(x * 0.01, z * 0.01, 4) * 60;
      const snowAmt = THREE.MathUtils.smoothstep(y, snowLine - 40, snowLine + 30) * THREE.MathUtils.smoothstep(flat, 0.35, 0.6);
      const forestAmt = 1 - THREE.MathUtils.smoothstep(y, snowLine - R.peak * 0.45, snowLine - R.peak * 0.25);
      c.copy(flat > 0.6 ? rock : darkRock).lerp(rock, valueNoise(x * 0.03, z * 0.03, 7) * 0.5 + 0.5);
      c.lerp(forest, forestAmt * 0.8);
      c.lerp(snow, Math.max(snowAmt, forestAmt > 0.5 ? 0 : snowAmt));
      // Luftperspektive: weit entfernte und tiefe Bereiche verschwimmen im Dunst
      const dist = Math.hypot(x, z);
      const fade = Math.min(0.85, 0.12 + (dist - 1500) / 5200 + Math.max(0, 1 - (y + 250) / 350) * 0.5);
      c.lerp(haze, Math.max(0, fade));
      colors.set([c.r, c.g, c.b], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  // Dunstiger Talboden zwischen Piste und Bergen
  const floor = new THREE.Mesh(
    new THREE.RingGeometry(300, 5000, 64, 1),
    new THREE.MeshBasicMaterial({ color: haze.clone().multiplyScalar(0.93), fog: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -260;
  group.add(floor);

  return group;
}
