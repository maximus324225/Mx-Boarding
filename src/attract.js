// Show-Modus für den Startbildschirm: Der Fahrer fährt von selbst durch den
// Snowpark, springt über die Schanzen und zeigt Tricks (Saltos, Spins, Grabs).
// Eine Kino-Kamera wechselt zwischen verschiedenen Perspektiven und filmt die
// Sprünge von der Seite der Schanze.
import * as THREE from 'three';
import { heightAt, pisteCenter, featuresNear } from './terrain.js';

const TRICKS = ['backflip', '360', 'frontflip', 'grab', 'backflip', 'grab360'];

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class AutoPilot {
  constructor() {
    this.inp = { steer: 0, brake: false, tuck: false, jump: false, flip: 0, grab: false };
    this.trick = null;
    this.trickIdx = 0;
    this.target = null;
  }

  reset() {
    this.trick = null;
    this.target = null;
  }

  nextTarget(pl) {
    const feats = featuresNear(pl.pos.z, 2)
      .filter((f) => f.z < pl.pos.z - 2 && f.z > pl.pos.z - 120)
      .sort((a, b) => b.z - a.z);
    // Bei zwei Schanzen nebeneinander die größere nehmen
    const first = feats[0];
    if (!first) return null;
    const same = feats.filter((f) => f.type === first.type && Math.abs(f.z - first.z) < 10);
    return same.sort((a, b) => (b.h || 0) - (a.h || 0))[0];
  }

  update(pl) {
    const inp = this.inp;
    inp.jump = false;
    if (pl.state === 'air') {
      const above = pl.pos.y - heightAt(pl.pos.x, pl.pos.z);
      if (!this.trick && above > 0.5 && pl.airTime > 0.08 && pl.airTime < 0.6) {
        // Saltos nur über großen Schanzen, sonst Spins und Grabs
        // von welcher Schanze kommen wir gerade?
        const from = featuresNear(pl.pos.z).find((f) => f.type === 'kicker'
          && pl.pos.z < f.z && pl.pos.z > f.z - f.L - 12 && Math.abs(pl.pos.x - f.x) < f.W / 2 + 3);
        const big = from && from.h >= 3 && pl.speed > 12;
        const pool = big ? TRICKS : ['360', 'grab', 'grab360', '360'];
        this.trick = pool[this.trickIdx++ % pool.length];
        this.spinDir = Math.random() < 0.5 ? -1 : 1;
      }
      const t = this.trick;
      inp.flip = 0;
      inp.steer = 0;
      inp.grab = false;
      inp.tuck = false;
      inp.brake = false;
      if (t === 'backflip' || t === 'backflip360') {
        if (Math.abs(pl.flipTotal) < Math.PI * 2 - 1.1) inp.flip = -1;
      }
      if (t === 'frontflip') {
        if (Math.abs(pl.flipTotal) < Math.PI * 2 - 1.1) inp.flip = 1;
      }
      const spinTarget = t === '360' || t === 'backflip360' || t === 'grab360' ? Math.PI * 2 : t === '540' ? Math.PI * 3 : 0;
      if (spinTarget && Math.abs(pl.spin) < spinTarget - 1.0) inp.steer = this.spinDir;
      if (t === 'grab' || t === 'grab360') inp.grab = above > 0.8;
      // kurz vor der Landung loslassen, damit die Lande-Hilfe ausrichten kann
      if (pl.vel.y < 0 && above < 2.2) {
        inp.flip = 0;
        inp.steer = 0;
      }
      return inp;
    }
    this.trick = null;
    inp.flip = 0;
    inp.grab = false;

    // Ziel: nächstes Park-Element (sonst Pistenmitte)
    this.target = this.nextTarget(pl);
    const lookZ = pl.pos.z - 14;
    let tx = pisteCenter(lookZ);
    if (this.target && this.target.z > pl.pos.z - 90) tx = this.target.x;
    const desired = Math.atan2(-(tx - pl.pos.x), -(lookZ - pl.pos.z));
    // Fährt er gerade rückwärts (Switch), zeigt die Fahrtrichtung entgegen dem Board
    const facing = pl.heading + (pl.travelSign < 0 ? Math.PI : 0);
    const d = wrap(desired - facing);
    inp.steer = Math.max(-1, Math.min(1, -d * 3));
    // Tempo: für große Schanzen genug Schwung, sonst kontrolliert
    const big = this.target && this.target.type === 'kicker' && this.target.h > 3;
    const want = big ? 17 : this.target && this.target.type === 'rail' ? 11 : 14;
    inp.brake = pl.speed > want + 2.5;
    inp.tuck = pl.speed < want - 1;
    return inp;
  }
}

// Kino-Kamera für den Startbildschirm
const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
export class CinemaCam {
  constructor(camera, chase) {
    this.camera = camera;
    this.chase = chase;
    this.timer = 0;
    this.shot = 0;
    this.fixed = null;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
  }

  reset(player) {
    this.timer = 0;
    this.fixed = null;
    this.chase.mode = 0;
    this.chase.snap(player);
    this.pos.copy(this.camera.position);
    this.look.copy(player.pos);
  }

  update(dt, player, pilot) {
    this.timer += dt;
    const k = pilot.target;
    // Schanze in Sicht -> feste Kamera seitlich der Landung
    if (!this.fixed && k && k.type === 'kicker' && k.z < player.pos.z - 25 && k.z > player.pos.z - 45 && player.state === 'ground') {
      const side = k.x > pisteCenter(k.z) ? -1 : 1;
      const z = k.z - k.L - 7;
      const x = k.x + side * (k.W / 2 + 7);
      this.fixed = { x, y: heightAt(x, z) + 2.2, z, until: 4.5, t: 0 };
    }
    if (this.fixed) {
      this.fixed.t += dt;
      _pos.set(this.fixed.x, this.fixed.y, this.fixed.z);
      _look.copy(player.pos);
      _look.y += 0.9;
      this.pos.lerp(_pos, this.fixed.t < 0.05 ? 1 : 1 - Math.exp(-6 * dt));
      this.look.lerp(_look, this.fixed.t < 0.05 ? 1 : 1 - Math.exp(-10 * dt));
      this.camera.position.copy(this.pos);
      this.camera.lookAt(this.look);
      this.camera.fov += (55 - this.camera.fov) * Math.min(1, dt * 3);
      this.camera.updateProjectionMatrix();
      const passed = player.pos.z < this.fixed.z - 12 && player.state === 'ground';
      if (this.fixed.t > this.fixed.until || passed) {
        this.fixed = null;
        this.timer = 0;
        this.chase.mode = [0, 2, 3, 1][this.shot++ % 4];
        this.chase.snap(player);
      }
      return;
    }
    // sonst alle paar Sekunden die Perspektive wechseln
    if (this.timer > 5) {
      this.timer = 0;
      this.chase.mode = [0, 3, 2, 1, 4][this.shot++ % 5];
      this.chase.snap(player);
    }
    this.chase.update(dt, player);
    this.pos.copy(this.camera.position);
  }
}
