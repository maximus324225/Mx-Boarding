// Der Snowboarder: 3D-Figur + Fahrphysik.
//
// Physik-Idee (vereinfacht, aber realistisch):
//  - Die Schwerkraft zieht entlang des Hangs nach unten.
//  - Die Kante des Boards hält seitlich (Grip): die Geschwindigkeit wird in
//    Richtung des Boards "umgelenkt" – so entsteht eine Carving-Kurve.
//  - Schnee-Reibung und Luftwiderstand bremsen. In der Hocke ist der
//    Luftwiderstand kleiner -> schneller.
//  - Beim Bremsen rutscht das Board quer (Querstellen) und verliert Tempo.
//  - In der Luft wirkt nur noch die Schwerkraft. Die Landung muss halbwegs
//    in Fahrtrichtung erfolgen (vorwärts oder rückwärts/"switch"), sonst Sturz.
import * as THREE from 'three';
import { heightAt, normalAt, featuresNear, railLine } from './terrain.js';
import { buildRider, poseRider } from './rider.js';

const G = 9.81;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _t = new THREE.Vector3();
const _m = new THREE.Matrix4();

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class Player {
  constructor(scene) {
    this.model = buildRider();
    scene.add(this.model.root);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.visUp = new THREE.Vector3(0, 1, 0);
    this.heading = 0;
    this.state = 'ground';
    this.events = [];
    this.reset(0, 0, 0);
  }

  reset(x, z, heading) {
    this.pos.set(x, heightAt(x, z), z);
    this.heading = heading;
    this.forwardH(this.vel).multiplyScalar(4);
    this.state = 'ground';
    normalAt(x, z, this.normal);
    this.visUp.copy(this.normal);
    this.charge = 0;
    this.crouch = 0;
    this.edge = 0;
    this.brakeYaw = 0;
    this.brakeAmount = 0;
    this.airTime = 0;
    this.spin = 0;
    this.crashTimer = 0;
    this.travelSign = 1;
    this.tumble = new THREE.Vector3();
    this.model.leanG.rotation.set(0, 0, 0);
    this.ghost = 0; // Schutzzeit nach Neustart (keine Kollisionen)
    this.noCollide = false;
    this.rail = null;
    this.exitAssist = false;
    this.grab = false;
    this.tucking = false;
    this.pose = { crouch: 0, grab: 0, tuck: 0, brake: 0, edge: 0, airborne: 0, grind: 0, dt: 0 };
    this.model.handsInit = false;
    this.update(0);
  }

  get speed() {
    return this.vel.length();
  }

  forwardH(out) {
    return out.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
  }

  // Board-Längsrichtung, angepasst an die Hangneigung
  boardAxes(n) {
    this.forwardH(_f);
    _f.addScaledVector(n, -_f.dot(n)).normalize();
    _r.crossVectors(_f, n).normalize();
  }

  step(dt, input, world) {
    if (this.state === 'crashed') return this.crashedStep(dt);
    if (this.ghost > 0) this.ghost -= dt;
    if (this.state === 'grind') return this.grindStep(dt, input);
    if (this.state === 'ground') this.groundStep(dt, input);
    else this.airStep(dt, input);
    if (this.state === 'ground' || this.state === 'air') this.checkRails();
    if (this.state === 'ground' || this.state === 'air') this.collide(world);
  }

  groundStep(dt, input) {
    const n = normalAt(this.pos.x, this.pos.z, this.normal);
    const sp = this.vel.length();

    // Sprung: gedrückt halten = aufladen, loslassen = abspringen
    if (input.jump) {
      this.charge = Math.min(1, this.charge + dt / 0.45);
    } else if (this.charge > 0) {
      const impulse = 2.6 + 2.8 * this.charge;
      this.vel.addScaledVector(n, impulse);
      this.pos.addScaledVector(n, 0.05);
      this.charge = 0;
      this.takeOff();
      this.events.push({ type: 'jump' });
      return;
    }

    // Lenken: bei hohem Tempo größere Kurvenradien (max. ~1.6 g Querbeschleunigung)
    const steer = input.steer;
    const turnRate = steer * Math.min(2.0, 15 / Math.max(sp, 0.1));
    this.heading -= turnRate * dt;

    // Schwerkraft wirkt voll. Wir trennen die Bewegung in "entlang des Hangs"
    // (dort wirken Kante, Reibung, Luftwiderstand) und "senkrecht zum Hang".
    this.vel.y -= G * dt;
    const vn = this.vel.dot(n);
    this.vel.addScaledVector(n, -vn);

    this.boardAxes(n);
    const vf = this.vel.dot(_f);
    const vl = this.vel.dot(_r);
    const braking = input.brake && sp > 0.5;
    this.brakeAmount += ((braking ? 1 : 0) - this.brakeAmount) * Math.min(1, dt * 6);

    // Kanten-Grip: seitliche Geschwindigkeit wird in Fahrtrichtung umgelenkt
    const grip = braking ? 2.5 : 12;
    const spd = Math.hypot(vf, vl);
    const newVl = vl * Math.exp(-grip * dt);
    const removed = Math.abs(vl - newVl);
    const lossFactor = braking ? 1.0 : 0.22; // Rutschen kostet Tempo, sauberes Carven kaum
    const target = spd * (1 - (spd > 0.01 ? (removed / spd) * lossFactor : 0));
    if (Math.abs(vf) > 0.3) this.travelSign = Math.sign(vf);
    const newVf = this.travelSign * Math.sqrt(Math.max(0, target * target - newVl * newVl));
    this.vel.copy(_f).multiplyScalar(newVf).addScaledVector(_r, newVl);

    // Anschieben, wenn man fast steht
    const tuck = input.tuck && !braking;
    this.tucking = tuck;
    if (input.tuck && sp < 4) this.vel.addScaledVector(_f, this.travelSign * 2.5 * dt);

    // Reibung + Luftwiderstand (+ Bremsen)
    const drag = tuck ? 0.0024 : 0.0037;
    const s = this.vel.length();
    const dec = (0.045 * G * n.y + drag * s * s + (braking ? 6.5 : 0)) * dt;
    if (dec >= s) this.vel.set(0, 0, 0);
    else this.vel.multiplyScalar((s - dec) / s);
    this.vel.addScaledVector(n, vn);

    // Bewegen. Der Schnee kann nur drücken, nicht ziehen: fällt das Gelände
    // schneller ab, als die Schwerkraft nach unten zieht (Schanzenkante,
    // Kuppe bei hohem Tempo), hebt der Fahrer ab.
    this.pos.addScaledVector(this.vel, dt);
    const hg = heightAt(this.pos.x, this.pos.z);
    const gap = this.pos.y - hg;
    if (gap <= 0) {
      this.pos.y = hg;
      normalAt(this.pos.x, this.pos.z, n);
      const into = this.vel.dot(n);
      if (into < 0) this.vel.addScaledVector(n, -into);
    } else if (gap > 0.2) {
      this.takeOff();
    }

    const targetEdge = steer * Math.min(1, sp / 8) * 0.8 + this.brakeAmount * -0.35;
    this.edge += (targetEdge - this.edge) * Math.min(1, dt * 8);
    const targetCrouch = Math.max(this.charge, tuck ? 0.85 : 0, this.brakeAmount * 0.45, Math.abs(steer) * 0.25);
    this.crouch += (targetCrouch - this.crouch) * Math.min(1, dt * 8);
  }

  takeOff() {
    this.state = 'air';
    this.airTime = 0;
    this.spin = 0;
    this.maxHeight = 0;
    this.exitAssist = false;
  }

  airStep(dt, input) {
    this.vel.y -= G * dt;
    const s = this.vel.length();
    this.vel.multiplyScalar(1 - 0.0025 * s * dt);

    // Drehungen in der Luft
    const spinRate = -input.steer * 6.5;
    this.heading += spinRate * dt;
    this.spin += spinRate * dt;
    // Nach einem Boardslide dreht sich das Board von selbst zurück in Fahrtrichtung
    if (this.exitAssist && Math.abs(input.steer) < 0.15) {
      const velYaw = Math.atan2(-this.vel.x, -this.vel.z);
      let d = wrapAngle(velYaw - this.heading);
      if (Math.abs(d) > Math.PI / 2) d = wrapAngle(d + Math.PI);
      this.heading += Math.sign(d) * Math.min(Math.abs(d), 7 * dt);
    }
    this.airTime += dt;

    this.pos.addScaledVector(this.vel, dt);
    const hg = heightAt(this.pos.x, this.pos.z);
    this.maxHeight = Math.max(this.maxHeight, this.pos.y - hg);
    this.edge += (0 - this.edge) * Math.min(1, dt * 4);
    const targetCrouch = input.tuck ? 1 : 0.35; // Hocke in der Luft = Grab
    this.crouch += (targetCrouch - this.crouch) * Math.min(1, dt * 10);
    this.grab = input.tuck;
    this.tucking = false;
    this.charge = 0;

    if (this.pos.y <= hg) this.land(hg);
  }

  land(hg) {
    const n = normalAt(this.pos.x, this.pos.z, this.normal);
    const vn = this.vel.dot(n);
    this.pos.y = hg;

    _t.copy(this.vel).addScaledVector(n, -vn);
    const hSpeed = _t.length();
    this.boardAxes(n);
    const align = hSpeed > 0.01 ? Math.abs(_t.dot(_f)) / hSpeed : 1;
    const spinDeg = Math.round(Math.abs(this.spin) / Math.PI) * 180;

    if ((hSpeed > 3 && align < Math.cos(THREE.MathUtils.degToRad(40))) || -vn > 17) {
      this.crash(-vn > 17 ? 'impact' : 'landing');
      return;
    }
    this.vel.addScaledVector(n, -vn);
    this.vel.multiplyScalar(1 - Math.min(0.3, Math.max(0, -vn - 4) * 0.03)); // harte Landung kostet Tempo
    this.state = 'ground';
    if (this.airTime > 0.25) {
      this.events.push({
        type: 'land', airTime: this.airTime, spin: spinDeg, grab: !!this.grab,
        height: this.maxHeight, impact: -vn, clean: align > 0.95,
      });
    }
    this.travelSign = this.vel.dot(_f) >= 0 ? 1 : -1;
  }


  // ---------- Rails & Boxen ----------
  checkRails() {
    for (const f of featuresNear(this.pos.z)) {
      if (f.type !== 'rail') continue;
      const L = railLine(f);
      const t = ((L.start.z - this.pos.z) / (L.start.z - L.end.z)) * L.length;
      if (t < -0.4 || t > L.length - 0.3) continue;
      const lat = Math.abs(this.pos.x - L.start.x);
      if (lat > f.half + 0.35) continue;
      const topY = L.start.y + L.dir.y * t;
      const dy = this.pos.y - topY;
      const along = this.vel.dot(L.dir);
      const canEnter = this.state === 'ground' ? dy > -0.3 : this.vel.y < 1.0;
      if (dy > -0.3 && dy < 0.6 && along > 2 && canEnter) {
        this.startGrind(f, L, t);
        return;
      }
      // seitlich gegen Rail/Box gefahren
      if (this.state === 'ground' && dy <= -0.3 && t > 0.2 && lat < f.half + 0.25 && !this.noCollide && this.ghost <= 0) {
        if (this.speed > 4) {
          this.crash('obstacle');
          return;
        }
        this.pos.x = L.start.x + Math.sign(this.pos.x - L.start.x || 1) * (f.half + 0.26);
      }
    }
  }

  startGrind(f, L, t) {
    this.state = 'grind';
    this.rail = { f, L };
    this.railT = Math.max(0, t);
    this.railSpeed = Math.max(this.vel.dot(L.dir), 3);
    this.grindTime = 0;
    this.charge = 0;
    const railYaw = Math.atan2(-L.dir.x, -L.dir.z);
    const d = wrapAngle(this.heading - railYaw);
    if (Math.abs(Math.cos(d)) > 0.6) {
      this.grindKind = f.kind === 'box' ? '50-50 Box' : '50-50';
      this.heading = railYaw + (Math.cos(d) < 0 ? Math.PI : 0);
    } else {
      this.grindKind = f.kind === 'box' ? 'Boardslide Box' : 'Boardslide';
      this.heading = railYaw + (Math.sin(d) > 0 ? 1 : -1) * Math.PI / 2;
    }
    this.events.push({ type: 'grindStart' });
  }

  grindStep(dt, input) {
    const L = this.rail.L;
    const s = this.railSpeed;
    const acc = -G * L.dir.y - 0.07 * G - 0.002 * s * s;
    this.railSpeed += acc * dt;
    this.railT += this.railSpeed * dt;
    this.grindTime += dt;
    this.pos.copy(L.start).addScaledVector(L.dir, this.railT);
    this.vel.copy(L.dir).multiplyScalar(this.railSpeed);
    this.normal.set(0, 1, 0);
    this.edge += (0 - this.edge) * Math.min(1, dt * 8);
    this.brakeAmount = 0;
    this.crouch += (0.4 - this.crouch) * Math.min(1, dt * 8);

    if (input.jump) {
      this.charge = Math.min(1, this.charge + dt / 0.45);
    } else if (this.charge > 0) {
      this.vel.y += 2.5 + 2 * this.charge;
      this.charge = 0;
      this.endGrind();
      return;
    }
    if (this.railT >= L.length || this.railSpeed < 0.5) this.endGrind();
  }

  endGrind() {
    this.events.push({ type: 'grind', time: this.grindTime, kind: this.grindKind });
    this.rail = null;
    this.pos.y += 0.03;
    this.takeOff();
    this.exitAssist = true;
  }

  collide(world) {
    if (this.ghost > 0 || this.noCollide) return;
    for (const list of world.obstaclesNear(this.pos.z)) {
      for (const o of list) {
        const dx = this.pos.x - o.x;
        const dz = this.pos.z - o.z;
        const rr = o.r + 0.3;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && this.pos.y < o.y + o.h) {
          if (this.speed > 4) {
            this.crash('obstacle');
            this.vel.set(dx, 0, dz).normalize().multiplyScalar(1.5);
            return;
          }
          const d = Math.sqrt(d2) || 0.01;
          this.pos.x = o.x + (dx / d) * rr;
          this.pos.z = o.z + (dz / d) * rr;
        }
      }
    }
  }

  crash(reason) {
    this.state = 'crashed';
    this.crashTimer = 2.2;
    this.vel.multiplyScalar(0.55);
    this.tumble.set((Math.random() - 0.5) * 14, 0, (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6));
    this.events.push({ type: 'crash', reason });
  }

  crashedStep(dt) {
    this.vel.y = 0;
    this.vel.multiplyScalar(Math.exp(-1.6 * dt));
    this.pos.addScaledVector(this.vel, dt);
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    normalAt(this.pos.x, this.pos.z, this.normal);
    this.tumble.multiplyScalar(Math.exp(-2.2 * dt));
    const lg = this.model.leanG.rotation;
    lg.x += this.tumble.x * dt;
    lg.z += this.tumble.z * dt;
    // am Ende flach im Schnee liegen
    if (this.crashTimer < 1.2) {
      lg.x += (Math.round(lg.x / Math.PI) * Math.PI - lg.x) * Math.min(1, dt * 3);
      lg.z += ((lg.z > 0 ? 1 : -1) * Math.PI / 2 - lg.z) * Math.min(1, dt * 3);
    }
    this.crashTimer -= dt;
    if (this.crashTimer <= 0) this.events.push({ type: 'respawn' });
  }

  // Grafik an den Physik-Zustand anpassen (einmal pro Bild)
  update(dt) {
    const k = dt > 0 ? 1 - Math.exp(-12 * dt) : 1;
    const targetUp = this.state === 'air' || this.state === 'grind' ? WORLD_UP : this.normal;
    this.visUp.lerp(targetUp, k).normalize();

    const up = this.visUp;
    this.forwardH(_f);
    _f.addScaledVector(up, -_f.dot(up)).normalize();
    _r.crossVectors(_f, up).normalize();
    _t.copy(_f).negate();
    _m.makeBasis(_r, up, _t);
    const { root, yawG, leanG } = this.model;
    root.quaternion.setFromRotationMatrix(_m);
    root.position.copy(this.pos);

    if (this.state !== 'crashed') {
      const sgn = this.travelSign;
      this.brakeYaw += (this.brakeAmount * 1.2 * sgn - this.brakeYaw) * Math.min(1, dt * 8 || 1);
      yawG.rotation.y = this.brakeYaw;
      leanG.rotation.set(0, 0, -this.edge * sgn);
    }

    // Körperhaltung (Hocke, Grab, Balance …)
    const P = this.pose;
    const f = dt > 0 ? Math.min(1, dt * 10) : 1;
    const air = this.state === 'air';
    P.crouch = this.crouch;
    P.grab += ((air && this.grab ? 1 : 0) - P.grab) * f;
    P.tuck += ((this.tucking ? 1 : 0) - P.tuck) * f;
    P.brake = this.brakeAmount;
    P.edge = this.edge;
    P.airborne += ((air ? 1 : 0) - P.airborne) * f;
    P.grind += ((this.state === 'grind' ? 1 : 0) - P.grind) * f;
    P.dt = dt;
    poseRider(this.model, P);
  }
}
