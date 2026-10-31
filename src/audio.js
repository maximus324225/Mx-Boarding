// Geräusche, komplett im Browser erzeugt (keine Sounddateien nötig):
// Fahrtwind, Kratzen der Kante auf dem Schnee, Landungen und Stürze.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  // Browser erlauben Ton erst nach einer Nutzer-Aktion (Klick/Tipp)
  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // "braunes" Rauschen
      d[i] = white * 0.5 + last * 3;
    }
    this.noise = buf;

    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);

    // Wind
    const wind = ctx.createBufferSource();
    wind.buffer = buf; wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    // Kante auf Schnee
    const scrape = ctx.createBufferSource();
    scrape.buffer = buf; scrape.loop = true; scrape.playbackRate.value = 0.7;
    this.scrapeFilter = ctx.createBiquadFilter();
    this.scrapeFilter.type = 'highpass';
    this.scrapeFilter.frequency.value = 1200;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    scrape.connect(this.scrapeFilter).connect(this.scrapeGain).connect(this.master);
    scrape.start(0, 0.7);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  pause() {
    if (this.ctx) this.ctx.suspend();
  }

  update(player) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = player.speed;
    const w = Math.min(1, sp / 28);
    this.windGain.gain.setTargetAtTime(0.03 + w * w * 0.35, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(300 + w * 1400, t, 0.2);

    const onSnow = player.state === 'ground' ? 1 : 0;
    const grind = player.state === 'grind';
    const s = Math.min(1, sp / 18);
    let g = onSnow * s * (0.04 + Math.abs(player.edge) * 0.22 + player.brakeAmount * 0.35);
    if (grind) g = 0.3;
    this.scrapeGain.gain.setTargetAtTime(g, t, 0.06);
    this.scrapeFilter.frequency.setTargetAtTime(grind ? 3200 : 900 + s * 1500 - player.brakeAmount * 400, t, 0.1);
  }

  thump(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(1, 0.3 * strength), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.4);
  }
}
