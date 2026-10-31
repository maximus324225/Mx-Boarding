// Verfolgerkamera: bleibt hinter dem Fahrer in Fahrtrichtung, geht nie
// unter den Schnee und zoomt bei hohem Tempo etwas heraus.
import * as THREE from 'three';
import { heightAt } from './terrain.js';

const _h = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.dir = new THREE.Vector3(0, 0, -1);
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.baseFov = camera.fov;
  }

  compute(player) {
    const sp = player.speed;
    const dist = 6.2 + Math.min(sp * 0.08, 2.5);
    _desired.copy(player.pos).addScaledVector(this.dir, -dist);
    _desired.y = Math.max(player.pos.y + 2.4, heightAt(_desired.x, _desired.z) + 1.3);
    _look.copy(player.pos).addScaledVector(this.dir, 4);
    _look.y += 0.9;
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
    this.pos.lerp(_desired, 1 - Math.exp(-7 * dt));
    const minY = heightAt(this.pos.x, this.pos.z) + 1.0;
    if (this.pos.y < minY) this.pos.y = minY;
    this.look.lerp(_look, 1 - Math.exp(-14 * dt));

    const targetFov = this.baseFov + Math.min(player.speed * 0.45, 14);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 3);
    this.camera.updateProjectionMatrix();
    this.apply();
  }

  apply() {
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
