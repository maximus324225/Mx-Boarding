// Partikel: aufgewirbelter Schnee am Board und fallende Schneeflocken.
import * as THREE from 'three';

function softDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Spur im Schnee hinter dem Board (Band aus Vierecken, knapp über dem Boden)
class SnowTrail {
  constructor(scene) {
    this.max = 900;
    this.pos = new Float32Array(this.max * 2 * 3);
    this.count = 0;
    const idx = [];
    for (let i = 0; i < this.max - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    this.geo = geo;
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0xb7c6dc, roughness: 1, transparent: true, opacity: 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
    }));
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    scene.add(mesh);
    this.mesh = mesh;
    this.last = null;
    this.broken = true;
  }

  push(lx, ly, lz, rx, ry, rz) {
    if (this.count === this.max) {
      this.pos.copyWithin(0, 6);
      this.count--;
    }
    this.pos.set([lx, ly, lz, rx, ry, rz], this.count * 6);
    this.count++;
    this.geo.setDrawRange(0, Math.max(0, this.count - 1) * 6);
    this.attr.needsUpdate = true;
  }

  reset() {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
    this.last = null;
    this.broken = true;
  }

  update(player) {
    if (player.state !== 'ground' || player.speed < 1) {
      this.broken = true;
      return;
    }
    const p = player.pos;
    if (this.last && Math.hypot(p.x - this.last.x, p.z - this.last.z) < 0.4) return;
    const y = p.y + 0.03;
    if (this.broken) {
      // Lücke: unsichtbare Verbindung (Breite 0) zum neuen Startpunkt
      if (this.last) this.push(this.last.x, this.last.y, this.last.z, this.last.x, this.last.y, this.last.z);
      this.push(p.x, y, p.z, p.x, y, p.z);
      this.broken = false;
    }
    // Breite: schmal beim Carven, breit beim Rutschen/Bremsen
    const w = 0.13 + player.brakeAmount * 0.45 + (1 - Math.min(1, Math.abs(player.edge) * 2)) * 0.05;
    player.forwardH(_tf);
    const sx = -_tf.z * w;
    const sz = _tf.x * w;
    this.push(p.x - sx, y, p.z - sz, p.x + sx, y, p.z + sz);
    this.last = { x: p.x, y, z: p.z };
  }
}
const _tf = new THREE.Vector3();

const _back = new THREE.Vector3();
const _side = new THREE.Vector3();

export class Effects {
  constructor(scene, mobile) {
    const tex = softDotTexture();

    // --- Schnee-Spray ---
    this.sprayMax = mobile ? 400 : 800;
    this.sprayPos = new Float32Array(this.sprayMax * 3).fill(-99999);
    this.sprayVel = new Float32Array(this.sprayMax * 3);
    this.sprayLife = new Float32Array(this.sprayMax);
    this.sprayNext = 0;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sprayPos, 3));
    this.spray = new THREE.Points(sg, new THREE.PointsMaterial({
      size: 0.22, map: tex, transparent: true, opacity: 0.9, depthWrite: false, color: 0xffffff,
    }));
    this.spray.frustumCulled = false;
    scene.add(this.spray);
    this.emitAcc = 0;

    // --- Fallender Schnee rund um die Kamera ---
    this.flakeCount = mobile ? 250 : 500; // bei Sonnenschein nur leichtes Schneeglitzern in der Luft
    this.box = { x: 70, y: 35, z: 70 };
    this.flakePos = new Float32Array(this.flakeCount * 3);
    for (let i = 0; i < this.flakeCount; i++) {
      this.flakePos[i * 3] = (Math.random() - 0.5) * this.box.x;
      this.flakePos[i * 3 + 1] = (Math.random() - 0.5) * this.box.y;
      this.flakePos[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.flakePos, 3));
    this.flakes = new THREE.Points(fg, new THREE.PointsMaterial({
      size: 0.12, map: tex, transparent: true, opacity: 0.85, depthWrite: false,
    }));
    this.flakes.frustumCulled = false;
    scene.add(this.flakes);
    this.flakeCenter = new THREE.Vector3();
    this.trail = new SnowTrail(scene);
    this.time = 0;
  }

  emit(x, y, z, vx, vy, vz, life) {
    const i = this.sprayNext;
    this.sprayNext = (this.sprayNext + 1) % this.sprayMax;
    this.sprayPos.set([x, y, z], i * 3);
    this.sprayVel.set([vx, vy, vz], i * 3);
    this.sprayLife[i] = life;
  }

  burst(pos, count, strength = 3) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * strength;
      this.emit(pos.x, pos.y + 0.1, pos.z, Math.cos(a) * s, 1 + Math.random() * strength, Math.sin(a) * s, 0.6 + Math.random() * 0.8);
    }
  }

  update(dt, camera, player, input) {
    this.time += dt;
    this.trail.update(player);

    // Spray erzeugen, wenn das Board über den Schnee fährt
    if (player.state === 'ground' || player.state === 'crashed') {
      const sp = player.speed;
      const carve = Math.abs(player.edge);
      const rate = player.state === 'crashed' ? sp * 8 : sp * (1 + carve * 9) + player.brakeAmount * sp * 14;
      this.emitAcc += rate * dt;
      if (sp > 0.5) {
        player.forwardH(_back).multiplyScalar(-player.travelSign);
        _side.set(-_back.z, 0, _back.x);
        const sideSign = -Math.sign(input.steer || 0.0001) * player.travelSign;
        while (this.emitAcc > 1) {
          this.emitAcc -= 1;
          const off = (Math.random() - 0.3) * 0.8;
          const px = player.pos.x + _back.x * off + (Math.random() - 0.5) * 0.3;
          const pz = player.pos.z + _back.z * off + (Math.random() - 0.5) * 0.3;
          const side = (carve * 0.25 + player.brakeAmount * 0.35) * sp * sideSign;
          this.emit(
            px, player.pos.y + 0.05, pz,
            player.vel.x * 0.35 + _side.x * side + (Math.random() - 0.5) * 1.5,
            0.5 + Math.random() * (1 + carve * 3 + player.brakeAmount * 2),
            player.vel.z * 0.35 + _side.z * side + (Math.random() - 0.5) * 1.5,
            0.4 + Math.random() * 0.7,
          );
        }
      } else {
        this.emitAcc = 0;
      }
    }

    const p = this.sprayPos;
    const v = this.sprayVel;
    for (let i = 0; i < this.sprayMax; i++) {
      if (this.sprayLife[i] <= 0) continue;
      this.sprayLife[i] -= dt;
      if (this.sprayLife[i] <= 0) { p[i * 3 + 1] = -99999; continue; }
      v[i * 3 + 1] -= 6 * dt;
      const drag = Math.exp(-2.5 * dt);
      v[i * 3] *= drag; v[i * 3 + 2] *= drag;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
    }
    this.spray.geometry.attributes.position.needsUpdate = true;

    // Schneeflocken: fallen langsam und werden um die Kamera "herumgewickelt"
    const c = camera.position;
    const f = this.flakePos;
    const bx = this.box.x, by = this.box.y, bz = this.box.z;
    for (let i = 0; i < this.flakeCount; i++) {
      let x = f[i * 3] + Math.sin(this.time * 0.7 + i) * 0.4 * dt;
      let y = f[i * 3 + 1] - 1.4 * dt;
      let z = f[i * 3 + 2];
      x = ((((x - c.x + bx / 2) % bx) + bx) % bx) + c.x - bx / 2;
      y = ((((y - c.y + by / 2) % by) + by) % by) + c.y - by / 2;
      z = ((((z - c.z + bz / 2) % bz) + bz) % bz) + c.z - bz / 2;
      f[i * 3] = x; f[i * 3 + 1] = y; f[i * 3 + 2] = z;
    }
    this.flakes.geometry.attributes.position.needsUpdate = true;
  }
}
