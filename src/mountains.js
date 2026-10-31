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
  for (let o = 0; o < 4; o++) {
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
    { r0: 1600, r1: 2700, rows: 9, peak: 300, seed: 3, scale: 0.0014, segs: 240, base: -150 },
    { r0: 2900, r1: 4900, rows: 12, peak: 700, seed: 9, scale: 0.0008, segs: 320, base: -60 },
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

    // Flache Dreiecke mit eigener Farbe (Low-Poly-Look)
    const colors = [];
    const snow = new THREE.Color(0xf4f7ff);
    const rock = new THREE.Color(0x7a8090);
    const darkRock = new THREE.Color(0x5a5f6e);
    const forest = new THREE.Color(0x2f4038);
    const c = new THREE.Color();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const pushTri = (a, b, d) => {
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
      e1.subVectors(b, a);
      e2.subVectors(d, a);
      nrm.crossVectors(e1, e2).normalize();
      const y = (a.y + b.y + d.y) / 3;
      const slope = Math.abs(nrm.y);
      const snowLine = R.base + R.peak * 0.45 + valueNoise(a.x * 0.01, a.z * 0.01, 4) * 50;
      if (y < snowLine - R.peak * 0.35) c.copy(forest).lerp(rock, 0.25);
      else if (y > snowLine && slope > 0.2) c.copy(snow);
      else if (y > snowLine - R.peak * 0.15 && slope > 0.5) c.copy(snow).lerp(rock, 0.15);
      else c.copy(slope > 0.55 ? rock : darkRock);
      // Luftperspektive: weit entfernte und tiefe Bereiche verschwimmen im Dunst
      const dist = Math.hypot(a.x, a.z);
      const fade = Math.min(0.85, 0.15 + (dist - 1500) / 5000 + Math.max(0, 1 - (y + 250) / 350) * 0.5);
      c.lerp(haze, Math.max(0, fade));
      for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
    };
    for (let j = 0; j < R.rows; j++) {
      for (let i = 0; i < R.segs; i++) {
        const a = grid[j][i];
        const b = grid[j][i + 1];
        const d = grid[j + 1][i];
        const e = grid[j + 1][i + 1];
        pushTri(a, b, d);
        pushTri(b, e, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false });
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
