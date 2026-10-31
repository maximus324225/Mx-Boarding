// Soundeffekte, komplett im Browser erzeugt (keine Sounddateien nötig).
//
// Dauerhafte Ebenen (werden je nach Fahrzustand lauter/leiser):
//   - Fahrtwind tief + hohes Pfeifen, in der Luft ein Rauschen
//   - Gleiten über präparierten Schnee (leises Zischen)
//   - Kante beim Carven (körniges "Knirschen", stärker bei mehr Kantendruck)
//   - Rutschen/Bremsen (breites Schaben)
//   - Grind auf Metall-Rail (singend) oder Box (dumpf)
// Einzelne Geräusche: Absprung, Landung, Sturz, Grind-Start, Trick-Jingle,
// Slalom-Tor, Menü-Klick.
import { Music } from './music.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sfxMuted = false;
    this.music = new Music();
    this.active = false; // Fahrgeräusche nur während des Spiels
  }

  // Browser erlauben Ton erst nach einer Nutzer-Aktion (Klick/Tipp)
  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.master = comp;

    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxMuted ? 0 : 0.9;
    this.sfx.connect(comp);

    // Rausch-Puffer: weiß + braun
    const len = ctx.sampleRate * 3;
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = white.getChannelData(0);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }
    this.white = white;
    this.brown = brown;

    const layer = (buffer, type, freq, q, rate = 1) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.playbackRate.value = rate;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.sfx);
      src.start(0, Math.random() * 2);
      return { f, g };
    };
    this.windLow = layer(brown, 'lowpass', 400, 0.7);
    this.windHigh = layer(white, 'bandpass', 1800, 4);
    this.airRush = layer(white, 'bandpass', 900, 0.8);
    this.glide = layer(white, 'bandpass', 2600, 0.6, 0.8);
    this.carve = layer(white, 'bandpass', 1400, 1.2, 0.6);
    this.skid = layer(brown, 'bandpass', 700, 0.9);
    this.grindRail = layer(white, 'bandpass', 3400, 9);
    this.grindRail2 = layer(white, 'bandpass', 5600, 12);
    this.grindBox = layer(brown, 'bandpass', 1100, 1.5);

    this.music.attach(ctx, comp);
  }

  setSfxMuted(m) {
    this.sfxMuted = m;
    if (this.sfx) this.sfx.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  silenceLoops() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const l of [this.windLow, this.windHigh, this.airRush, this.glide, this.carve, this.skid, this.grindRail, this.grindRail2, this.grindBox]) {
      l.g.gain.setTargetAtTime(0, t, 0.1);
    }
  }

  update(player, dt) {
    if (!this.ctx) return;
    if (!this.active) {
      this.silenceLoops();
      return;
    }
    const t = this.ctx.currentTime;
    const sp = player.speed;
    const w = Math.min(1, sp / 28);
    const air = player.state === 'air';
    const ground = player.state === 'ground';
    const grind = player.state === 'grind';
    const set = (l, v, tc = 0.08) => l.g.gain.setTargetAtTime(v, t, tc);

    // Wind
    set(this.windLow, 0.04 + w * w * 0.5, 0.2);
    this.windLow.f.frequency.setTargetAtTime(250 + w * 600, t, 0.2);
    set(this.windHigh, w * w * w * 0.08, 0.3);
    this.windHigh.f.frequency.setTargetAtTime(1300 + w * 1200 + Math.sin(t * 0.7) * 200, t, 0.3);
    set(this.airRush, air ? 0.08 + w * 0.25 : 0, 0.12);

    // Schnee
    const s = Math.min(1, sp / 18);
    const edge = Math.abs(player.edge);
    const jitter = 0.75 + Math.random() * 0.5; // körniges Knirschen
    set(this.glide, ground ? s * 0.07 : 0, 0.05);
    set(this.carve, ground ? s * edge * 0.55 * jitter : 0, 0.03);
    this.carve.f.frequency.setTargetAtTime(900 + s * 900 + edge * 800, t, 0.05);
    set(this.skid, ground ? player.brakeAmount * s * 0.9 * jitter : 0, 0.04);

    // Grind
    const box = grind && player.grindKind && player.grindKind.includes('Box');
    set(this.grindRail, grind && !box ? 0.35 : 0, 0.03);
    set(this.grindRail2, grind && !box ? 0.18 : 0, 0.03);
    set(this.grindBox, box ? 0.5 : 0, 0.03);
  }

  // ---------- Einzelgeräusche ----------
  noiseBurst({ buffer = this.white, type = 'lowpass', freq = 800, q = 0.7, gain = 0.5, attack = 0.005, decay = 0.3, rate = 1, sweepTo = null, delay = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 2);
    src.stop(t + attack + decay + 0.05);
  }

  tone({ freq = 440, type = 'sine', gain = 0.2, attack = 0.005, decay = 0.3, delay = 0, slideTo = null }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  jump(strength = 1) {
    // Ollie: Board-Tail "Pop" + kurzes Schneeknirschen
    this.tone({ freq: 140, type: 'sine', gain: 0.35 * strength, decay: 0.12, slideTo: 60 });
    this.noiseBurst({ type: 'highpass', freq: 2500, gain: 0.25, decay: 0.06 });
    this.noiseBurst({ type: 'bandpass', freq: 1200, q: 0.8, gain: 0.3 * strength, decay: 0.25 });
  }

  land(impact) {
    const k = Math.min(1.6, 0.4 + impact * 0.09);
    this.tone({ freq: 90, type: 'sine', gain: 0.45 * k, decay: 0.2, slideTo: 40 });
    this.noiseBurst({ buffer: this.brown, type: 'lowpass', freq: 600, gain: 0.6 * k, decay: 0.3 });
    // Schnee-"Puff" + Knirschen
    this.noiseBurst({ type: 'bandpass', freq: 1500, q: 0.6, gain: 0.35 * k, decay: 0.45, sweepTo: 500, delay: 0.02 });
  }

  crash() {
    this.tone({ freq: 70, type: 'sine', gain: 0.7, decay: 0.35, slideTo: 35 });
    this.noiseBurst({ buffer: this.brown, type: 'lowpass', freq: 900, gain: 0.9, decay: 0.6 });
    this.noiseBurst({ type: 'bandpass', freq: 1200, q: 0.5, gain: 0.5, decay: 1.2, sweepTo: 300, delay: 0.05 });
    this.noiseBurst({ type: 'bandpass', freq: 800, q: 0.7, gain: 0.35, decay: 0.4, delay: 0.35 });
  }

  grindStart(box) {
    if (box) {
      this.tone({ freq: 180, type: 'triangle', gain: 0.3, decay: 0.15 });
      this.noiseBurst({ buffer: this.brown, type: 'bandpass', freq: 900, gain: 0.4, decay: 0.15 });
    } else {
      // Metall "Klang" mit unharmonischen Obertönen
      for (const [f, g] of [[1180, 0.12], [2870, 0.08], [4210, 0.05], [5930, 0.03]]) {
        this.tone({ freq: f, type: 'sine', gain: g, decay: 0.9 });
      }
      this.noiseBurst({ type: 'highpass', freq: 3000, gain: 0.25, decay: 0.08 });
    }
  }

  chime(level = 1) {
    // kleine aufsteigende Melodie als Belohnung für Tricks
    const notes = level >= 2 ? [72, 76, 79, 84, 88] : [76, 79, 84];
    notes.forEach((n, i) => {
      const f = 440 * Math.pow(2, (n - 69) / 12);
      this.tone({ freq: f, type: 'triangle', gain: 0.09, decay: 0.35, delay: i * 0.07 });
      this.tone({ freq: f * 2, type: 'sine', gain: 0.03, decay: 0.25, delay: i * 0.07 });
    });
  }

  gate(ok) {
    if (ok) {
      this.tone({ freq: 1320, type: 'sine', gain: 0.12, decay: 0.25 });
      this.tone({ freq: 1760, type: 'sine', gain: 0.08, decay: 0.3, delay: 0.06 });
    } else {
      this.tone({ freq: 160, type: 'square', gain: 0.1, decay: 0.35 });
    }
  }

  beep(high = false) {
    this.tone({ freq: high ? 1320 : 880, type: 'square', gain: 0.08, decay: high ? 0.4 : 0.15 });
  }

  click() {
    this.tone({ freq: 1800, type: 'triangle', gain: 0.06, decay: 0.05 });
  }
}
