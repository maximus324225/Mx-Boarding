// Kamera mit mehreren Ansichten (Taste C / 🎥-Button):
//   hinten (Standard), nah, vorne, seitlich, von oben
// Die Kamera folgt der Fahrtrichtung, geht nie unter den Schnee und zoomt
// bei hohem Tempo etwas heraus.
import * as THREE from 'three';
import { heightAt } from './terrain.js';

const _h = new THREE.Vector3();
const _side = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();

export const CAMERA_MODES = [
  { id: 'chase', name: 'Ansicht: Hinten' },
  { id: 'close', name: 'Ansicht: Nah' },
  { id: 'front', name: 'Ansicht: Vorne' },
  { id: 'side', name: 'Ansicht: Seitlich' },
  { id: 'high', name: 'Ansicht: Von oben' },
];

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.dir = new THREE.Vector3(0, 0, -1);
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.baseFov = camera.fov;
    this.mode = 0;
  }

  nextMode() {
    this.mode = (this.mode + 1) % CAMERA_MODES.length;
    return CAMERA_MODES[this.mode].name;
  }

  compute(player) {
    const sp = player.speed;
    const p = player.pos;
    _side.set(-this.dir.z, 0, this.dir.x); // rechts von der Fahrtrichtung
    const id = CAMERA_MODES[this.mode].id;
    if (id === 'chase') {
      const dist = 6.4 + Math.min(sp * 0.08, 2.5);
      _desired.copy(p).addScaledVector(this.dir, -dist);
      _desired.y = Math.max(p.y + 2.4, heightAt(_desired.x, _desired.z) + 1.3);
      _look.copy(p).addScaledVector(this.dir, 4);
      _look.y += 0.9;
    } else if (id === 'close') {
      _desired.copy(p).addScaledVector(this.dir, -3.4).addScaledVector(_side, 0.6);
      _desired.y = Math.max(p.y + 1.5, heightAt(_desired.x, _desired.z) + 0.8);
      _look.copy(p).addScaledVector(this.dir, 3);
      _look.y += 0.9;
    } else if (id === 'front') {
      _desired.copy(p).addScaledVector(this.dir, 5.5).addScaledVector(_side, 0.8);
      _desired.y = Math.max(p.y + 1.4, heightAt(_desired.x, _desired.z) + 1.0);
      _look.copy(p);
      _look.y += 0.85;
    } else if (id === 'side') {
      // Zehenseite: der Fahrer schaut zur Kamera
      _desired.copy(p).addScaledVector(_side, 6).addScaledVector(this.dir, 1.0);
      _desired.y = Math.max(p.y + 1.6, heightAt(_desired.x, _desired.z) + 1.0);
      _look.copy(p).addScaledVector(this.dir, 1.2);
      _look.y += 0.8;
    } else {
      _desired.copy(p).addScaledVector(this.dir, -9);
      _desired.y = Math.max(p.y + 9, heightAt(_desired.x, _desired.z) + 6);
      _look.copy(p).addScaledVector(this.dir, 6);
    }
  }

  snap(player) {
    player.forwardH(this.dir);
    this.compute(player);
    this.pos.copy(_desired);
    this.look.copy(_look);
    this.apply();
  }

  update(dt, player) {
    _h.set(player.vel.x, 0, player.vel.z);
    if (_h.length() > 1.5 && player.state !== 'crashed') {
      _h.normalize();
      this.dir.lerp(_h, 1 - Math.exp(-2.5 * dt)).normalize();
    }
    this.compute(player);
    const id = CAMERA_MODES[this.mode].id;
    const follow = id === 'close' || id === 'front' ? 12 : 7;
    this.pos.lerp(_desired, 1 - Math.exp(-follow * dt));
    const minY = heightAt(this.pos.x, this.pos.z) + 0.7;
    if (this.pos.y < minY) this.pos.y = minY;
    this.look.lerp(_look, 1 - Math.exp(-14 * dt));

    const zoom = id === 'chase' || id === 'close' ? Math.min(player.speed * 0.45, 14) : 0;
    const targetFov = this.baseFov + zoom;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.updateProjectionMatrix();
    this.apply();
  }

  apply() {
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
