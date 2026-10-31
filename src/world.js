// Die Spielwelt: erzeugt den Berg stückweise (Chunks) vor dem Spieler,
// setzt Bäume, Felsen, Pistenstangen und Schanzen-Markierungen und
// entfernt alles, was weit hinter dem Spieler liegt.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  heightAt, pisteCenter, PISTE_HALF, CHUNK_LEN, X_MIN, X_MAX,
  kickerAt, nearestKickerIndex,
} from './terrain.js';
import { mulberry32, valueNoise } from './noise.js';

const SEG_X = 2;
const SEG_Z = 1;
const CHUNKS_AHEAD = 4;
const CHUNKS_BEHIND = 1;

function makeTreeGeometry() {
  const parts = [];
  const layers = [
    { r: 2.0, h: 3.2, y: 2.4 },
    { r: 1.55, h: 2.8, y: 4.0 },
    { r: 1.05, h: 2.4, y: 5.5 },
    { r: 0.55, h: 1.6, y: 6.8 },
  ];
  for (const l of layers) {
    const g = new THREE.ConeGeometry(l.r, l.h, 9, 1);
    g.translate(0, l.y, 0);
    parts.push(g);
  }
  const foliage = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  // Schnee auf den Zweigen: obere Kegelflächen hell einfärben
  const pos = foliage.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const green = new THREE.Color(0x1d3b2a);
  const snow = new THREE.Color(0xe8eef5);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    // Dreieck: die Kegelspitze ist der höchste Punkt
    const yMax = Math.max(pos.getY(i), pos.getY(i + 1), pos.getY(i + 2));
    const snowy = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    for (let k = 0; k < 3; k++) {
      const y = pos.getY(i + k);
      const t = y === yMax ? 0.75 : Math.abs(snowy) * 0.35;
      c.copy(green).lerp(snow, t);
      colors.set([c.r, c.g, c.b], (i + k) * 3);
    }
  }
  foliage.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  foliage.computeVertexNormals();

  const trunk = new THREE.CylinderGeometry(0.14, 0.24, 1.6, 6);
  trunk.translate(0, 0.8, 0);
  return { foliage, trunk };
}

export class World {
  constructor(scene, mobile) {
    this.scene = scene;
    this.mobile = mobile;
    this.chunks = new Map();

    this.snowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    const tree = makeTreeGeometry();
    this.treeFoliageGeo = tree.foliage;
    this.treeTrunkGeo = tree.trunk;
    this.foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    this.trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 1 });

    const rock = new THREE.IcosahedronGeometry(1, 0);
    this.rockGeo = rock;
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x5d5f66, roughness: 1, flatShading: true });

    // Pistenstangen: orange/schwarz
    const pole = new THREE.CylinderGeometry(0.035, 0.035, 1.6, 6);
    pole.translate(0, 0.8, 0);
    this.poleGeo = pole;
    this.poleMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.6 });
    this.kickPoleMat = new THREE.MeshStandardMaterial({ color: 0x2266ff, roughness: 0.6 });
  }

  chunkIndex(z) {
    return Math.floor(-z / CHUNK_LEN);
  }

  update(playerZ) {
    const ci = this.chunkIndex(playerZ);
    for (let i = ci - CHUNKS_BEHIND; i <= ci + CHUNKS_AHEAD; i++) {
      if (!this.chunks.has(i)) {
        this.chunks.set(i, this.buildChunk(i));
        break; // höchstens ein neues Stück pro Bild -> kein Ruckeln
      }
    }
    for (const [i, chunk] of this.chunks) {
      if (i < ci - CHUNKS_BEHIND || i > ci + CHUNKS_AHEAD + 1) {
        this.disposeChunk(chunk);
        this.chunks.delete(i);
      }
    }
  }

  // Erzeugt sofort alle Stücke rund um den Start
  prepare(playerZ) {
    const ci = this.chunkIndex(playerZ);
    for (let i = ci - CHUNKS_BEHIND; i <= ci + CHUNKS_AHEAD; i++) {
      if (!this.chunks.has(i)) this.chunks.set(i, this.buildChunk(i));
    }
  }

  obstaclesNear(z) {
    const ci = this.chunkIndex(z);
    const out = [];
    for (let i = ci - 1; i <= ci + 1; i++) {
      const c = this.chunks.get(i);
      if (c) out.push(c.obstacles);
    }
    return out;
  }

  disposeChunk(chunk) {
    this.scene.remove(chunk.group);
    chunk.terrainGeo.dispose();
    for (const m of chunk.instanced) m.dispose();
  }

  buildChunk(i) {
    const group = new THREE.Group();
    const zStart = -i * CHUNK_LEN;
    const nx = Math.round((X_MAX - X_MIN) / SEG_X) + 1;
    const nz = Math.round(CHUNK_LEN / SEG_Z) + 1;
    const W = nx + 2;
    const H = nz + 2;

    // Höhen-Raster mit einem Rand, damit die Normalen an den Nähten passen
    const hs = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      const z = zStart - (j - 1) * SEG_Z;
      for (let k = 0; k < W; k++) {
        hs[j * W + k] = heightAt(X_MIN + (k - 1) * SEG_X, z);
      }
    }

    const count = nx * nz;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const n = new THREE.Vector3();
    const col = new THREE.Color();
    const groomed = new THREE.Color(0.97, 0.98, 1.0);
    const powder = new THREE.Color(0.9, 0.93, 0.99);
    const rockCol = new THREE.Color(0.42, 0.43, 0.47);

    for (let j = 0; j < nz; j++) {
      const z = zStart - j * SEG_Z;
      const cx = pisteCenter(z);
      for (let k = 0; k < nx; k++) {
        const x = X_MIN + k * SEG_X;
        const idx = j * nx + k;
        const h = hs[(j + 1) * W + k + 1];
        const dhdx = (hs[(j + 1) * W + k + 2] - hs[(j + 1) * W + k]) / (2 * SEG_X);
        const dhdz = (hs[j * W + k + 1] - hs[(j + 2) * W + k + 1]) / (2 * SEG_Z);
        n.set(-dhdx, 1, -dhdz).normalize();

        positions[idx * 3] = x;
        positions[idx * 3 + 1] = h;
        positions[idx * 3 + 2] = z;
        normals[idx * 3] = n.x;
        normals[idx * 3 + 1] = n.y;
        normals[idx * 3 + 2] = n.z;

        const off = Math.max(0, Math.abs(x - cx) - PISTE_HALF);
        col.copy(groomed).lerp(powder, Math.min(1, off / 8));
        // Präparierte Piste: feine Rillen vom Pistenbully
        if (off <= 0) col.multiplyScalar(0.985 + 0.015 * Math.sin(x * 3.1));
        const v = valueNoise(x * 0.15, z * 0.15, 5) * 0.025;
        col.r += v; col.g += v; col.b += v;
        // Steile Stellen: Fels schaut raus
        const steep = 1 - THREE.MathUtils.smoothstep(n.y, 0.6, 0.72);
        if (steep > 0) col.lerp(rockCol, steep);
        colors[idx * 3] = col.r;
        colors[idx * 3 + 1] = col.g;
        colors[idx * 3 + 2] = col.b;
      }
    }

    const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let k = 0; k < nx - 1; k++) {
        const a = j * nx + k;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        indices[p++] = a; indices[p++] = b; indices[p++] = c;
        indices[p++] = b; indices[p++] = d; indices[p++] = c;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();
    const terrain = new THREE.Mesh(geo, this.snowMat);
    terrain.receiveShadow = true;
    group.add(terrain);

    // ---- Hindernisse ----
    const rng = mulberry32(i * 7919 + 13);
    const obstacles = [];
    const trees = [];
    const rocks = [];
    const kickerNear = (x, z) => {
      const ki = nearestKickerIndex(z);
      if (ki < 0) return false;
      const kk = kickerAt(ki);
      return Math.abs(z - (kk.z - 10)) < 40 && Math.abs(x - kk.x) < 14;
    };

    const samples = this.mobile ? 700 : 1000;
    for (let s = 0; s < samples; s++) {
      const x = X_MIN + rng() * (X_MAX - X_MIN);
      const z = zStart - rng() * CHUNK_LEN;
      if (z > -25 && Math.abs(x - pisteCenter(z)) < 40) continue; // Startbereich frei
      const off = Math.abs(x - pisteCenter(z)) - PISTE_HALF;
      let prob;
      if (off < -3) prob = 0.006;       // vereinzelt auf der Piste
      else if (off < 3) prob = 0.0;     // Pistenrand frei
      else prob = Math.min(0.85, 0.12 + off * 0.025);
      if (rng() > prob) continue;
      if (kickerNear(x, z)) continue;
      const y = heightAt(x, z);
      if (rng() < 0.9) {
        const sc = 0.7 + rng() * 0.9;
        trees.push({ x, y, z, s: sc, rot: rng() * Math.PI * 2 });
        obstacles.push({ x, z, y, r: 0.55 * sc + 0.1, h: 7 * sc });
      } else {
        const sc = 0.5 + rng() * 1.4;
        rocks.push({ x, y, z, s: sc, rot: rng() * Math.PI * 2, sy: 0.5 + rng() * 0.5 });
        obstacles.push({ x, z, y, r: sc * 0.95, h: sc * 0.9 });
      }
    }

    const instanced = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const sv = new THREE.Vector3();
    const pv = new THREE.Vector3();

    if (trees.length) {
      const fol = new THREE.InstancedMesh(this.treeFoliageGeo, this.foliageMat, trees.length);
      const tr = new THREE.InstancedMesh(this.treeTrunkGeo, this.trunkMat, trees.length);
      trees.forEach((t, idx) => {
        q.setFromAxisAngle(up, t.rot);
        sv.set(t.s, t.s * (0.9 + (t.rot % 0.3)), t.s);
        pv.set(t.x, t.y - 0.2, t.z);
        m.compose(pv, q, sv);
        fol.setMatrixAt(idx, m);
        tr.setMatrixAt(idx, m);
      });
      fol.castShadow = true;
      tr.castShadow = true;
      fol.computeBoundingSphere();
      tr.computeBoundingSphere();
      group.add(fol, tr);
      instanced.push(fol, tr);
    }

    if (rocks.length) {
      const rm = new THREE.InstancedMesh(this.rockGeo, this.rockMat, rocks.length);
      rocks.forEach((r, idx) => {
        q.setFromAxisAngle(up, r.rot);
        sv.set(r.s, r.s * r.sy, r.s * 1.1);
        pv.set(r.x, r.y + r.s * r.sy * 0.25, r.z);
        m.compose(pv, q, sv);
        rm.setMatrixAt(idx, m);
      });
      rm.castShadow = true;
      rm.receiveShadow = true;
      rm.computeBoundingSphere();
      group.add(rm);
      instanced.push(rm);
    }

    // Pistenstangen links und rechts alle 25 m
    const poles = [];
    const firstPole = Math.ceil(-zStart / 25) * 25;
    for (let d = firstPole; d < -zStart + CHUNK_LEN; d += 25) {
      const z = -d;
      const cx = pisteCenter(z);
      poles.push([cx - PISTE_HALF - 1.5, z], [cx + PISTE_HALF + 1.5, z]);
    }
    if (poles.length) {
      const pm = new THREE.InstancedMesh(this.poleGeo, this.poleMat, poles.length);
      poles.forEach(([x, z], idx) => {
        m.makeTranslation(x, heightAt(x, z) - 0.1, z);
        pm.setMatrixAt(idx, m);
      });
      pm.castShadow = true;
      pm.computeBoundingSphere();
      group.add(pm);
      instanced.push(pm);
    }

    // Blaue Markierungen an den Schanzen
    const kPoles = [];
    const k0 = Math.max(0, nearestKickerIndex(zStart) - 1);
    for (let ki = k0; ki < k0 + 3; ki++) {
      const k = kickerAt(ki);
      if (k.z <= zStart && k.z > zStart - CHUNK_LEN) {
        const zl = k.z - k.len;
        kPoles.push([k.x - k.halfW - 1, k.z], [k.x + k.halfW + 1, k.z], [k.x - k.halfW - 1, zl], [k.x + k.halfW + 1, zl]);
      }
    }
    if (kPoles.length) {
      const km = new THREE.InstancedMesh(this.poleGeo, this.kickPoleMat, kPoles.length);
      kPoles.forEach(([x, z], idx) => {
        m.makeTranslation(x, heightAt(x, z) - 0.1, z);
        km.setMatrixAt(idx, m);
      });
      km.computeBoundingSphere();
      group.add(km);
      instanced.push(km);
    }

    this.scene.add(group);
    return { group, terrainGeo: geo, instanced, obstacles };
  }
}
