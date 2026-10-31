// Steuerung: Tastatur (PC), Touch-Buttons und Neigungssensor (Handy).
// Am Ende liefert diese Klasse immer die gleichen Werte:
//   steer (-1 links … +1 rechts), brake, tuck (Hocke), jump

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = { left: false, right: false, jump: false, brake: false, tuck: false };
    this.steer = 0;
    this.brake = false;
    this.tuck = false;
    this.jump = false;
    this.flip = 0;
    this.grab = false;
    this.onCamera = null;
    this.tiltEnabled = false;
    this.tiltValue = 0;
    this.tiltZero = null;
    this.onPause = null;

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat && this.onPause) this.onPause();
      if (e.code === 'KeyC' && !e.repeat && this.onCamera) this.onCamera();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      for (const k in this.touch) this.touch[k] = false;
    });

    // Touch-Buttons: jedes Element mit data-act="left|right|jump|brake|tuck"
    document.querySelectorAll('[data-act]').forEach((el) => {
      const act = el.dataset.act;
      const on = (e) => {
        e.preventDefault();
        this.touch[act] = true;
        el.classList.add('pressed');
        if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      };
      const off = (e) => {
        e.preventDefault();
        this.touch[act] = false;
        el.classList.remove('pressed');
      };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
    });

    this.handleOrientation = (e) => {
      const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      let tilt;
      if (angle === 90) tilt = e.beta;
      else if (angle === -90 || angle === 270) tilt = -e.beta;
      else tilt = e.gamma;
      if (tilt == null) return;
      if (this.tiltZero === null) this.tiltZero = tilt;
      this.tiltValue = Math.max(-1, Math.min(1, (tilt - this.tiltZero) / 22));
    };
  }

  // Neigungssteuerung einschalten (iOS fragt nach Erlaubnis)
  async enableTilt() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') return false;
      }
      this.tiltZero = null;
      window.addEventListener('deviceorientation', this.handleOrientation);
      this.tiltEnabled = true;
      return true;
    } catch {
      return false;
    }
  }

  disableTilt() {
    window.removeEventListener('deviceorientation', this.handleOrientation);
    this.tiltEnabled = false;
    this.tiltValue = 0;
  }

  calibrateTilt() {
    this.tiltZero = null;
  }

  update(dt) {
    const k = this.keys;
    let target = 0;
    if (k.has('ArrowLeft') || k.has('KeyA') || this.touch.left) target -= 1;
    if (k.has('ArrowRight') || k.has('KeyD') || this.touch.right) target += 1;
    if (this.tiltEnabled && target === 0) target = this.tiltValue;
    // weich nachführen, damit Lenkbewegungen nicht ruckartig sind
    this.steer += (target - this.steer) * Math.min(1, dt * 7);
    this.brake = k.has('ArrowDown') || k.has('KeyS') || this.touch.brake;
    const up = k.has('ArrowUp') || k.has('KeyW');
    const down = k.has('ArrowDown') || k.has('KeyS');
    this.tuck = up || this.touch.tuck;
    this.jump = k.has('Space') || this.touch.jump;
    // In der Luft: hoch = Vorwärtssalto, runter = Rückwärtssalto, Shift/E = Grab
    // (Handy: "Salto"-Button = Rückwärtssalto, "Grab"-Button = Grab)
    this.flip = (up ? 1 : 0) - (down || this.touch.brake ? 1 : 0);
    this.grab = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyE') || this.touch.tuck;
  }
}
