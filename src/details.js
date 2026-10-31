// Zusätzliche Details der Bergwelt: Sessellift, Schneekanonen, Berghütten,
// sowie Slalom-Tore und Zielbogen (nur im Slalom-Modus).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  heightAt, pisteCenter, PISTE_HALF, CHUNK_LEN, course,
  gateAt, GATE_COUNT, GATE_START, GATE_SPACING, FINISH_Z,
} from './terrain.js';
import { hash2 } from './noise.js';

const LIFT_SPACING = 80;
const LIFT_OFFSET = PISTE_HALF + 24;
export function liftX(z) {
  return pisteCenter(z) + LIFT_OFFSET;
}
function towerZ(k) {
  return 30 - k * LIFT_SPACING;
}

function hutAt(i) {
  if (i < 1 || hash2(i, 41, 2) > 0.38) return null;
  const z = -i * CHUNK_LEN - 30 - hash2(i, 42, 2) * 40;
  const x = pisteCenter(z) - PISTE_HALF - 32 - hash2(i, 43, 2) * 25;
  return { x, z, rot: hash2(i, 44, 2) * Math.PI * 2 };
}

// Bereiche, in denen keine Bäume/Felsen stehen sollen
export function isReserved(x, z, chunkIndex) {
  if (Math.abs(x - liftX(z)) < 7) return true;
  for (const i of [chunkIndex - 1, chunkIndex, chunkIndex + 1]) {
    const h = hutAt(i);
    if (h && Math.hypot(x - h.x, z - h.z) < 14) return true;
  }
  return false;
}

function canvasTex(draw, w = 512, h = 128) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Y = new THREE.Vector3(0, 1, 0);

export class Details {
  constructor() {
    const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
    this.metal = std(0x8f96a3, { metalness: 0.7, roughness: 0.35 });
    this.darkMetal = std(0x2e3038, { metalness: 0.6, roughness: 0.45 });
    this.cableMat = std(0x222222, { metalness: 0.5, roughness: 0.5 });
    this.seatMat = std(0x2f6bff, { roughness: 0.5 });
    this.wood = std(0x6b4a2f, { roughness: 0.9 });
    this.woodDark = std(0x4a3220, { roughness: 0.9 });
    this.snow = std(0xf4f7fc, { roughness: 0.8 });
    this.window = std(0xffc77a, { emissive: 0xffa040, emissiveIntensity: 0.9, roughness: 0.3 });
    this.cannonMat = std(0xf2c230, { roughness: 0.45 });
    this.red = std(0xe0262e, { roughness: 0.5, side: THREE.DoubleSide });
    this.blue = std(0x1f5be0, { roughness: 0.5, side: THREE.DoubleSide });

    // Liftstütze
    const col = new THREE.CylinderGeometry(0.3, 0.42, 11, 10);
    col.translate(0, 5.5, 0);
    const bar = new THREE.BoxGeometry(0.4, 0.4, 4.4);
    bar.translate(0, 10.8, 0);
    const parts = [col, bar];
    for (const s of [-1, 1]) {
      const sheave = new THREE.CylinderGeometry(0.35, 0.35, 0.12, 12);
      sheave.rotateX(Math.PI / 2);
      sheave.rotateY(Math.PI / 2);
      sheave.translate(0, 10.5, s * 1.9);
      const beam = new THREE.BoxGeometry(2.6, 0.18, 0.18);
      beam.translate(0, 10.45, s * 1.9);
      parts.push(sheave, beam);
    }
    const foot = new THREE.CylinderGeometry(0.9, 1.1, 0.6, 10);
    foot.translate(0, 0.0, 0);
    parts.push(foot);
    this.towerGeo = mergeGeometries(parts);

    // Sessel (Rahmen + Sitz)
    const hanger = new THREE.CylinderGeometry(0.03, 0.03, 2.3, 6);
    hanger.translate(0, -1.15, 0);
    const grip = new THREE.BoxGeometry(0.3, 0.18, 0.18);
    const footbar = new THREE.BoxGeometry(1.5, 0.04, 0.04);
    footbar.translate(0, -2.75, 0.55);
    const safety = new THREE.BoxGeometry(1.5, 0.04, 0.04);
    safety.translate(0, -1.9, 0.5);
    const frameSide = [-0.78, 0.78].map((x) => {
      const g = new THREE.BoxGeometry(0.05, 0.9, 0.05);
      g.translate(x, -2.3, 0);
      return g;
    });
    this.chairFrameGeo = mergeGeometries([hanger, grip, footbar, safety, ...frameSide]);
    const seat = new THREE.BoxGeometry(1.55, 0.1, 0.5);
    seat.translate(0, -2.5, 0.15);
    const back = new THREE.BoxGeometry(1.55, 0.55, 0.08);
    back.translate(0, -2.2, -0.08);
    this.chairSeatGeo = mergeGeometries([seat, back]);

    // Schneekanone
    const pole = new THREE.CylinderGeometry(0.09, 0.12, 3.6, 8);
    pole.translate(0, 1.8, 0);
    const base = new THREE.BoxGeometry(0.9, 0.5, 0.9);
    base.translate(0, 0.25, 0);
    this.cannonPoleGeo = mergeGeometries([pole, base]);
    const barrel = new THREE.CylinderGeometry(0.42, 0.34, 1.3, 14, 1, true);
    barrel.rotateZ(Math.PI / 2 - 0.35);
    barrel.translate(0.3, 3.9, 0);
    const ring = new THREE.TorusGeometry(0.42, 0.05, 6, 16);
    ring.rotateY(Math.PI / 2);
    ring.rotateZ(-0.35);
    ring.translate(0.9, 4.1, 0);
    this.cannonBarrelGeo = mergeGeometries([barrel.toNonIndexed(), ring.toNonIndexed()]);

    this.cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    this.cylGeo.translate(0, 0.5, 0);

    this.finishMat = new THREE.MeshStandardMaterial({
      roughness: 0.6, side: THREE.DoubleSide,
      map: canvasTex((g, w, h) => {
        for (let x = 0; x < w; x += 32) {
          for (let y = 0; y < h; y += 32) {
            g.fillStyle = ((x + y) / 32) % 2 ? '#111' : '#fff';
            g.fillRect(x, y, 32, 32);
          }
        }
        g.fillStyle = '#e0262e';
        g.fillRect(96, 16, w - 192, h - 32);
        g.fillStyle = '#fff';
        g.font = 'bold 76px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('ZIEL', w / 2, h / 2 + 4);
      }),
    });
  }

  build(world, i, zStart, group, geometries, instanced, obstacles) {
    this.buildLift(i, zStart, group, geometries, instanced, obstacles);
    this.buildCannons(zStart, group, instanced, obstacles);
    this.buildHut(i, group, obstacles);
    if (course.slalom) this.buildGates(zStart, group, geometries);
  }

  addInstanced(group, instanced, geo, mat, items, setter) {
    if (!items.length) return;
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((it, idx) => { setter(it); im.setMatrixAt(idx, _m); });
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
    instanced.push(im);
  }

  buildLift(i, zStart, group, geometries, instanced, obstacles) {
    const k0 = Math.ceil((30 - zStart) / LIFT_SPACING);
    const towers = [];
    for (let k = k0; towerZ(k) > zStart - CHUNK_LEN; k++) {
      if (k < 0) continue;
      const z = towerZ(k);
      const x = liftX(z);
      towers.push({ k, x, z, y: heightAt(x, z) - 0.2 });
    }
    this.addInstanced(group, instanced, this.towerGeo, this.metal, towers, (t) => {
      _q.setFromAxisAngle(UP, Math.PI / 2);
      _m.compose(_p.set(t.x, t.y, t.z), _q, _s.set(1, 1, 1));
    });
    for (const t of towers) obstacles.push({ x: t.x, z: t.z, y: t.y, r: 1.0, h: 11 });

    // Seile + Sessel zum jeweils nächsten Mast
    const chairs = [];
    for (const t of towers) {
      const z2 = towerZ(t.k + 1);
      const x2 = liftX(z2);
      const y1 = t.y + 10.5;
      const y2 = heightAt(x2, z2) - 0.2 + 10.5;
      for (const side of [-1, 1]) {
        _a.set(t.x + side * 1.9, y1, t.z);
        _b.set(x2 + side * 1.9, y2, z2);
        const len = _a.distanceTo(_b);
        const cable = new THREE.Mesh(this.cylGeo, this.cableMat);
        cable.position.copy(_a);
        cable.quaternion.setFromUnitVectors(Y, _b.clone().sub(_a).normalize());
        cable.scale.set(0.025, len, 0.025);
        group.add(cable);
        const n = 5;
        for (let c = 0; c < n; c++) {
          const f = (c + 0.5 + (side > 0 ? 0.5 : 0)) / (n + 0.5);
          chairs.push({
            x: _a.x + (_b.x - _a.x) * f, y: _a.y + (_b.y - _a.y) * f - 0.25, z: _a.z + (_b.z - _a.z) * f,
            yaw: Math.atan2(_b.x - _a.x, _b.z - _a.z) + (side > 0 ? Math.PI : 0),
          });
        }
      }
    }
    const chairSetter = (c) => {
      _q.setFromAxisAngle(UP, c.yaw);
      _m.compose(_p.set(c.x, c.y, c.z), _q, _s.set(1, 1, 1));
    };
    this.addInstanced(group, instanced, this.chairFrameGeo, this.darkMetal, chairs, chairSetter);
    this.addInstanced(group, instanced, this.chairSeatGeo, this.seatMat, chairs, chairSetter);
  }

  buildCannons(zStart, group, instanced, obstacles) {
    const cannons = [];
    const first = Math.ceil(-zStart / 140) * 140 + 70;
    for (let d = first - 140; d < -zStart + CHUNK_LEN; d += 140) {
      const z = -d;
      if (z > zStart || z <= zStart - CHUNK_LEN || z > -30) continue;
      const x = pisteCenter(z) - PISTE_HALF - 2.5;
      cannons.push({ x, z, y: heightAt(x, z) - 0.1 });
    }
    const setter = (c) => {
      _q.setFromAxisAngle(UP, 0);
      _m.compose(_p.set(c.x, c.y, c.z), _q, _s.set(1, 1, 1));
    };
    this.addInstanced(group, instanced, this.cannonPoleGeo, this.darkMetal, cannons, setter);
    this.addInstanced(group, instanced, this.cannonBarrelGeo, this.cannonMat, cannons, setter);
    for (const c of cannons) obstacles.push({ x: c.x, z: c.z, y: c.y, r: 0.7, h: 4.5 });
  }

  buildHut(i, group, obstacles) {
    const h = hutAt(i);
    if (!h) return;
    const hut = new THREE.Group();
    const y = heightAt(h.x, h.z);
    hut.position.set(h.x, y - 0.3, h.z);
    hut.rotation.y = h.rot;
    const add = (geo, mat, x, yy, z, rx = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, yy, z);
      m.rotation.set(rx, 0, rz);
      m.castShadow = true;
      m.receiveShadow = true;
      hut.add(m);
      return m;
    };
    // Steinsockel + Holzwände (Balken)
    add(new THREE.BoxGeometry(9.4, 1.2, 7.4), new THREE.MeshStandardMaterial({ color: 0x6f6d6a, roughness: 1 }), 0, 0.6, 0);
    add(new THREE.BoxGeometry(9, 3.4, 7), this.wood, 0, 2.9, 0);
    for (let b = 0; b < 6; b++) add(new THREE.BoxGeometry(9.06, 0.06, 7.06), this.woodDark, 0, 1.4 + b * 0.58, 0);
    // Dach mit Schnee
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(10.4, 0.25, 5.0), this.woodDark, 0, 5.5, s * 2.05, s * 0.6);
      add(new THREE.BoxGeometry(10.5, 0.35, 5.0), this.snow, 0, 5.75, s * 2.15, s * 0.6);
    }
    // Giebel
    const gable = new THREE.BufferGeometry();
    gable.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -3.5, 0, 0, 3.5, 0, 2.6, 0], 3));
    gable.computeVertexNormals();
    const gm = this.wood.clone();
    gm.side = THREE.DoubleSide;
    add(gable, gm, 4.5, 4.6, 0);
    add(gable, gm, -4.5, 4.6, 0);
    // Fenster (warm beleuchtet), Tür, Kamin, Bank
    for (const x of [-2.6, 0, 2.6]) add(new THREE.BoxGeometry(1.0, 0.9, 0.1), this.window, x, 3.0, 3.53);
    for (const z of [-1.6, 1.6]) add(new THREE.BoxGeometry(0.1, 0.9, 1.0), this.window, 4.53, 3.0, z);
    add(new THREE.BoxGeometry(1.2, 2.1, 0.12), this.woodDark, -2.6, 2.25, -3.53);
    add(new THREE.BoxGeometry(0.8, 2.2, 0.8), new THREE.MeshStandardMaterial({ color: 0x7a7470, roughness: 1 }), 2.5, 6.6, -1.2);
    add(new THREE.BoxGeometry(0.95, 0.2, 0.95), this.snow, 2.5, 7.75, -1.2);
    add(new THREE.BoxGeometry(2.4, 0.12, 0.5), this.woodDark, 0, 1.45, 4.1);
    group.add(hut);
    obstacles.push({ x: h.x, z: h.z, y, r: 6.2, h: 8 });
  }

  buildGates(zStart, group, geometries) {
    for (let gi = 0; gi < GATE_COUNT; gi++) {
      const z = GATE_START - gi * GATE_SPACING;
      if (z > zStart || z <= zStart - CHUNK_LEN) continue;
      const g = gateAt(gi);
      const mat = g.red ? this.red : this.blue;
      for (const s of [-1, 1]) {
        const x = g.x + s * g.half;
        const y = heightAt(x, z);
        const pole = new THREE.Mesh(this.cylGeo, mat);
        pole.position.set(x, y - 0.1, z);
        pole.scale.set(0.04, 2.1, 0.04);
        pole.castShadow = true;
        group.add(pole);
        // Torflagge zwischen den Stangen (Riesenslalom-Stil)
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.9), mat);
        geometries.push(flag.geometry);
        flag.position.set(x - s * 0.58, y + 1.5, z);
        flag.castShadow = true;
        group.add(flag);
      }
    }
    if (FINISH_Z <= zStart && FINISH_Z > zStart - CHUNK_LEN) {
      const cx = pisteCenter(FINISH_Z);
      const half = 18;
      for (const s of [-1, 1]) {
        const x = cx + s * half;
        const post = new THREE.Mesh(this.cylGeo, this.darkMetal);
        post.position.set(x, heightAt(x, FINISH_Z) - 0.2, FINISH_Z);
        post.scale.set(0.2, 7, 0.2);
        post.castShadow = true;
        group.add(post);
      }
      const y = Math.max(heightAt(cx - half, FINISH_Z), heightAt(cx + half, FINISH_Z)) + 5.6;
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 3.2), this.finishMat);
      geometries.push(banner.geometry);
      banner.position.set(cx, y, FINISH_Z);
      banner.castShadow = true;
      group.add(banner);
    }
  }
}
