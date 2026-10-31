// Die Spielwelt: erzeugt den Berg stückweise (Chunks) vor dem Spieler,
// setzt Bäume, Felsen, Pistenstangen und Snowpark-Elemente und
// entfernt alles, was weit hinter dem Spieler liegt.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  heightAt, pisteCenter, PISTE_HALF, CHUNK_LEN, X_RANGE, FINE_RANGE,
  slotFeatures, slotIndex, featuresNear, railLine, nearFeature, SLOT_START,
} from './terrain.js';
import { mulberry32, valueNoise } from './noise.js';

const CHUNKS_AHEAD = 6;
const CHUNKS_BEHIND = 1;

// Spalten des Geländerasters: fein im Pistenbereich, grob außen.
// Für alle Chunks gleich, damit an den Nahtstellen keine Lücken entstehen.
const COLS = (() => {
  const xs = [];
  for (let x = -X_RANGE; x < -FINE_RANGE; x += 5) xs.push(x);
  for (let x = -FINE_RANGE; x < FINE_RANGE; x += 1.5) xs.push(x);
  for (let x = FINE_RANGE; x <= X_RANGE; x += 5) xs.push(x);
  return xs;
})();

function makeTreeGeometry() {
  const parts = [];
  const layers = [
    { r: 1.9, h: 3.0, y: 2.3 },
    { r: 1.5, h: 2.7, y: 3.8 },
    { r: 1.05, h: 2.3, y: 5.2 },
    { r: 0.55, h: 1.6, y: 6.5 },
  ];
  for (const l of layers) {
    const g = new THREE.ConeGeometry(l.r, l.h, 7, 1);
    g.translate(0, l.y, 0);
    parts.push(g.toNonIndexed());
  }
  const foliage = mergeGeometries(parts);
  const pos = foliage.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const green = new THREE.Color(0x1d3b2a);
  const snow = new THREE.Color(0xeef3fa);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    const yMax = Math.max(pos.getY(i), pos.getY(i + 1), pos.getY(i + 2));
    const snowy = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    for (let k = 0; k < 3; k++) {
      const t = pos.getY(i + k) === yMax ? 0.8 : snowy * 0.35;
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

function bannerTexture(text) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#16171d';
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = '#2f6bff';
  g.fillRect(0, 108, 1024, 20);
  g.fillStyle = '#ffffff';
  g.font = 'bold 84px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 512, 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class World {
  constructor(scene, mobile) {
    this.scene = scene;
    this.mobile = mobile;
    this.chunks = new Map();

    this.snowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    const tree = makeTreeGeometry();
    this.treeFoliageGeo = tree.foliage;
    this.treeTrunkGeo = tree.trunk;
    this.foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    this.trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 1 });
    this.rockGeo = new THREE.IcosahedronGeometry(1, 0);
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x5d5f68, roughness: 1, flatShading: true });

    const pole = new THREE.CylinderGeometry(0.035, 0.035, 1.6, 6);
    pole.translate(0, 0.8, 0);
    this.poleGeo = pole;
    this.poleMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.6 });
    this.kickPoleMat = new THREE.MeshStandardMaterial({ color: 0x2f6bff, roughness: 0.6 });

    this.railMat = new THREE.MeshStandardMaterial({ color: 0xc9ced8, metalness: 0.85, roughness: 0.25 });
    this.postMat = new THREE.MeshStandardMaterial({ color: 0x2b2c36, metalness: 0.5, roughness: 0.5 });
    this.boxSide = new THREE.MeshStandardMaterial({ color: 0x2f6bff, roughness: 0.5 });
    this.boxTop = new THREE.MeshStandardMaterial({ color: 0xe9e9ef, roughness: 0.35 });
    this.bannerMat = new THREE.MeshStandardMaterial({ map: bannerTexture('POWDER PARK'), roughness: 0.7, side: THREE.DoubleSide });
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
    for (const g of chunk.geometries) g.dispose();
    for (const m of chunk.instanced) m.dispose();
  }

  buildChunk(i) {
    const group = new THREE.Group();
    const geometries = [];
    const instanced = [];
    const zStart = -i * CHUNK_LEN;
    const nx = COLS.length;
    const nz = CHUNK_LEN + 1; // 1 m Raster in Fahrtrichtung
    const W = nx + 2;
    const H = nz + 2;
    const xAt = (k) => (k < 0 ? COLS[0] - 5 : k >= nx ? COLS[nx - 1] + 5 : COLS[k]);

    const hs = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      const z = zStart - (j - 1);
      for (let k = 0; k < W; k++) hs[j * W + k] = heightAt(xAt(k - 1), z);
    }

    const count = nx * nz;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const n = new THREE.Vector3();
    const col = new THREE.Color();
    const groomed = new THREE.Color(0.97, 0.98, 1.0);
    const powder = new THREE.Color(0.91, 0.94, 1.0);
    const rockCol = new THREE.Color(0.36, 0.37, 0.42);
    const lipCol = new THREE.Color(0.18, 0.42, 1.0);

    for (let j = 0; j < nz; j++) {
      const z = zStart - j;
      const cx = pisteCenter(z);
      const kickers = featuresNear(z).filter((f) => f.type === 'kicker' || f.type === 'table');
      for (let k = 0; k < nx; k++) {
        const x = COLS[k];
        const idx = j * nx + k;
        const h = hs[(j + 1) * W + k + 1];
        const dhdx = (hs[(j + 1) * W + k + 2] - hs[(j + 1) * W + k]) / (xAt(k + 1) - xAt(k - 1));
        const dhdz = (hs[j * W + k + 1] - hs[(j + 2) * W + k + 1]) / 2;
        n.set(-dhdx, 1, -dhdz).normalize();
        positions.set([x, h, z], idx * 3);
        normals.set([n.x, n.y, n.z], idx * 3);

        const off = Math.max(0, Math.abs(x - cx) - PISTE_HALF);
        col.copy(groomed).lerp(powder, Math.min(1, off / 10));
        if (off <= 0) col.multiplyScalar(0.985 + 0.015 * Math.sin(x * 3.1));
        const v = valueNoise(x * 0.15, z * 0.15, 5) * 0.025;
        col.r += v; col.g += v; col.b += v;
        // Felsen an steilen Stellen
        const steep = 1 - THREE.MathUtils.smoothstep(n.y, 0.62, 0.78);
        if (steep > 0 && off > 0) col.lerp(rockCol, steep);
        // Blaue Markierungslinie an Schanzenkanten (wie im echten Park)
        for (const f of kickers) {
          const dz = f.z - z;
          const lipZ = f.type === 'kicker' ? f.L : f.up;
          if (dz > lipZ - 0.9 && dz <= lipZ + 0.1 && Math.abs(x - f.x) < f.W / 2) col.copy(lipCol);
        }
        colors.set([col.r, col.g, col.b], idx * 3);
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
    geometries.push(geo);
    const terrain = new THREE.Mesh(geo, this.snowMat);
    terrain.receiveShadow = true;
    group.add(terrain);

    // ---- Bäume und Felsen (abseits der Piste, in Gruppen) ----
    const rng = mulberry32(i * 7919 + 13);
    const obstacles = [];
    const trees = [];
    const rocks = [];
    const samples = this.mobile ? 600 : 900;
    for (let s = 0; s < samples; s++) {
      const x = -X_RANGE + rng() * X_RANGE * 2;
      const z = zStart - rng() * CHUNK_LEN;
      const off = Math.abs(x - pisteCenter(z)) - PISTE_HALF;
      if (off < 4) continue;
      const cluster = valueNoise(x * 0.02, z * 0.02, 77);
      const prob = cluster > 0.15 ? 0.7 : 0.05;
      if (rng() > prob) continue;
      if (nearFeature(x, z)) continue;
      const y = heightAt(x, z);
      if (rng() < 0.78) {
        const sc = 0.7 + rng() * 0.9;
        trees.push({ x, y, z, s: sc, rot: rng() * Math.PI * 2 });
        obstacles.push({ x, z, y, r: 0.55 * sc + 0.1, h: 7 * sc });
      } else {
        const sc = 0.6 + rng() * 2.2;
        rocks.push({ x, y, z, s: sc, rot: rng() * Math.PI * 2, sy: 0.5 + rng() * 0.6 });
        obstacles.push({ x, z, y, r: sc * 0.95, h: sc * 0.9 });
      }
    }

    const addInstanced = (geom, mat, items, setter, shadow = true) => {
      if (!items.length) return;
      const im = new THREE.InstancedMesh(geom, mat, items.length);
      items.forEach((it, idx) => { setter(it); im.setMatrixAt(idx, _m); });
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
      instanced.push(im);
    };
    const treeSetter = (t) => {
      _q.setFromAxisAngle(UP, t.rot);
      _s.set(t.s, t.s * (0.9 + (t.rot % 0.3)), t.s);
      _a.set(t.x, t.y - 0.2, t.z);
      _m.compose(_a, _q, _s);
    };
    addInstanced(this.treeFoliageGeo, this.foliageMat, trees, treeSetter);
    addInstanced(this.treeTrunkGeo, this.trunkMat, trees, treeSetter);
    addInstanced(this.rockGeo, this.rockMat, rocks, (r) => {
      _q.setFromAxisAngle(UP, r.rot);
      _s.set(r.s, r.s * r.sy, r.s * 1.1);
      _a.set(r.x, r.y + r.s * r.sy * 0.25, r.z);
      _m.compose(_a, _q, _s);
    });

    // Pistenstangen links und rechts alle 25 m
    const poles = [];
    const firstPole = Math.ceil(-zStart / 25) * 25;
    for (let d = firstPole; d < -zStart + CHUNK_LEN; d += 25) {
      const z = -d;
      const cx = pisteCenter(z);
      poles.push([cx - PISTE_HALF - 1.5, z], [cx + PISTE_HALF + 1.5, z]);
    }
    addInstanced(this.poleGeo, this.poleMat, poles, ([x, z]) => _m.makeTranslation(x, heightAt(x, z) - 0.1, z));

    // ---- Snowpark-Elemente, deren Anfang in diesem Chunk liegt ----
    const kPoles = [];
    const s0 = Math.max(0, slotIndex(zStart) - 1);
    for (let si = s0; si <= s0 + 3; si++) {
      for (const f of slotFeatures(si)) {
        if (!(f.z <= zStart && f.z > zStart - CHUNK_LEN)) continue;
        if (f.type === 'kicker') {
          const zl = f.z - f.L;
          kPoles.push([f.x - f.W / 2 - 0.8, zl], [f.x + f.W / 2 + 0.8, zl]);
        } else if (f.type === 'table') {
          const zl = f.z - f.up;
          kPoles.push([f.x - f.W / 2 - 0.8, zl], [f.x + f.W / 2 + 0.8, zl]);
        } else if (f.type === 'rail') {
          this.buildRail(f, group, geometries);
        }
      }
    }
    addInstanced(this.poleGeo, this.kickPoleMat, kPoles, ([x, z]) => _m.makeTranslation(x, heightAt(x, z) - 0.1, z));

    // Eingangsbanner des Snowparks
    if (SLOT_START + 40 <= zStart && SLOT_START + 40 > zStart - CHUNK_LEN) this.buildBanner(SLOT_START + 40, group, geometries);

    this.scene.add(group);
    return { group, geometries, instanced, obstacles };
  }

  buildRail(f, group, geometries) {
    const { start, end, dir, length } = railLine(f);
    const yaw = Math.atan2(dir.x, dir.z);
    const pitch = Math.asin(-dir.y);
    if (f.kind === 'rail') {
      // Rohr
      const tube = new THREE.CylinderGeometry(0.045, 0.045, length, 10);
      tube.rotateX(Math.PI / 2);
      geometries.push(tube);
      const m = new THREE.Mesh(tube, this.railMat);
      m.position.copy(start).add(end).multiplyScalar(0.5);
      m.rotation.set(pitch, yaw, 0, "YXZ");
      m.castShadow = true;
      group.add(m);
      // Stützen
      for (const t of [0.08, 0.5, 0.92]) {
        _a.copy(start).addScaledVector(dir, t * length);
        const ground = heightAt(_a.x, _a.z) - 0.3;
        const ph = _a.y - ground;
        const post = new THREE.CylinderGeometry(0.04, 0.05, ph, 6);
        geometries.push(post);
        const pm = new THREE.Mesh(post, this.postMat);
        pm.position.set(_a.x, ground + ph / 2, _a.z);
        pm.castShadow = true;
        group.add(pm);
      }
    } else {
      // Box: blaue Seiten, helle Gleitfläche oben
      const height = f.H + 0.4;
      const box = new THREE.BoxGeometry(f.half * 2, height, length);
      geometries.push(box);
      const mats = [this.boxSide, this.boxSide, this.boxTop, this.boxSide, this.boxSide, this.boxSide];
      const m = new THREE.Mesh(box, mats);
      m.position.copy(start).add(end).multiplyScalar(0.5);
      m.rotation.set(pitch, yaw, 0, "YXZ");
      m.translateY(-height / 2);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  }

  buildBanner(z, group, geometries) {
    const cx = pisteCenter(z);
    const half = 14;
    for (const s of [-1, 1]) {
      const x = cx + s * half;
      const post = new THREE.CylinderGeometry(0.12, 0.12, 6, 8);
      geometries.push(post);
      const pm = new THREE.Mesh(post, this.postMat);
      pm.position.set(x, heightAt(x, z) + 2.5, z);
      pm.castShadow = true;
      group.add(pm);
    }
    const y = Math.max(heightAt(cx - half, z), heightAt(cx + half, z)) + 4.6;
    const plane = new THREE.PlaneGeometry(half * 2, 3.5);
    geometries.push(plane);
    const bm = new THREE.Mesh(plane, this.bannerMat);
    bm.position.set(cx, y, z);
    bm.castShadow = true;
    group.add(bm);
  }
}
