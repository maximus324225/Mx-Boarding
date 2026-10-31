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
    this.flakeCount = mobile ? 700 : 1600;
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
