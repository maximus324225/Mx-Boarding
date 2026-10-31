// Titelmusik "MX Boarding" – ein eigener Track, live im Browser erzeugt.
// 124 BPM, a-Moll, Akkordfolge Am – F – C – G.
// Instrumente: Kick, Clap/Snare, Hi-Hats, Synth-Bass, Flächen-Akkorde,
// Arpeggio und eine Lead-Melodie mit Echo und Hall.
// Ablauf: Intro -> Groove -> Refrain -> Refrain -> Break -> Groove ...

const BPM = 124;
const STEP = 60 / BPM / 4; // Sechzehntel

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Akkorde (MIDI-Noten) und Bass-Grundtöne
const CHORDS = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [55, 60, 64], // C (Umkehrung)
  [55, 59, 62], // G
];
const BASS = [45, 41, 48, 43];

// Lead-Melodie: 4 Takte × 16 Sechzehntel (-1 = Pause)
const LEAD = [
  [69, -1, 72, -1, 76, -1, 74, 72, -1, 69, -1, 72, 74, -1, 72, -1],
  [72, -1, 69, -1, 65, -1, 69, 72, -1, 77, -1, 76, 74, -1, 72, -1],
  [67, -1, 72, -1, 76, -1, 79, 76, -1, 74, -1, 72, 74, -1, 76, -1],
  [74, -1, 71, -1, 67, -1, 71, 74, -1, 79, -1, 76, 74, -1, -1, -1],
];

// Abschnitte à 4 Takte: was spielt mit?
const SECTIONS = [
  { name: 'intro', kick: false, snare: false, hats: 1, bass: false, pad: true, arp: true, lead: false },
  { name: 'groove', kick: true, snare: true, hats: 2, bass: true, pad: true, arp: true, lead: false },
  { name: 'chorus', kick: true, snare: true, hats: 2, bass: true, pad: true, arp: false, lead: true },
  { name: 'chorus2', kick: true, snare: true, hats: 3, bass: true, pad: true, arp: true, lead: true },
  { name: 'break', kick: false, snare: false, hats: 1, bass: false, pad: true, arp: false, lead: true },
  { name: 'groove', kick: true, snare: true, hats: 2, bass: true, pad: true, arp: true, lead: false },
];

export class Music {
  constructor() {
    this.ctx = null;
    let pref = true;
    try {
      const v = localStorage.getItem('mx-music');
      if (v !== null) pref = v === '1';
    } catch { /* egal */ }
    this.enabled = pref;
    this.playing = false;
    this.level = 1;
  }

  attach(ctx, destination) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);

    // Hall (künstliche Impulsantwort)
    const len = ctx.sampleRate * 2.4;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const revGain = ctx.createGain();
    revGain.gain.value = 0.35;
    this.reverb.connect(revGain).connect(this.out);

    // Echo (punktierte Achtel)
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const delFilter = ctx.createBiquadFilter();
    delFilter.type = 'lowpass';
    delFilter.frequency.value = 2500;
    this.delay.connect(delFilter).connect(fb).connect(this.delay);
    const delOut = ctx.createGain();
    delOut.gain.value = 0.35;
    delFilter.connect(delOut).connect(this.out);

    // Fläche mit "Pumpen" (Sidechain-Effekt zur Kick)
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 1;
    this.padBus.connect(this.out);
    this.padBus.connect(this.reverb);

    // Rauschen für Drums
    const nlen = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;

    if (this.enabled && this.wantPlay) this.start();
  }

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem('mx-music', on ? '1' : '0'); } catch { /* egal */ }
    if (on) this.start();
    else this.stop();
  }

  // Lautstärke: 1 = Menü, ~0.45 = während der Fahrt
  setLevel(level) {
    this.level = level;
    if (this.ctx && this.playing) this.out.gain.setTargetAtTime(0.55 * level, this.ctx.currentTime, 0.4);
  }

  start() {
    this.wantPlay = true;
    if (!this.ctx || !this.enabled || this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setTargetAtTime(0.55 * this.level, this.ctx.currentTime, 0.3);
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    this.wantPlay = false;
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }

  schedule() {
    if (this.ctx.state !== 'running') return;
    if (this.nextTime < this.ctx.currentTime - 0.5) this.nextTime = this.ctx.currentTime + 0.05; // nach Pause neu einrasten
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step++;
    }
  }

  playStep(step, t) {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const chordIdx = bar % 4;
    const sec = SECTIONS[Math.floor(bar / 4) % SECTIONS.length];
    const chord = CHORDS[chordIdx];
    const lastBarOfSection = bar % 4 === 3;

    if (sec.kick && s16 % 4 === 0) {
      this.kick(t);
      // Fläche duckt sich kurz weg
      this.padBus.gain.setValueAtTime(0.35, t);
      this.padBus.gain.linearRampToValueAtTime(1, t + STEP * 3);
    }
    if (sec.snare && (s16 === 4 || s16 === 12)) this.snare(t);
    if (sec.snare && lastBarOfSection && s16 >= 12) this.snare(t, 0.5); // kleiner Fill
    if (sec.hats >= 1 && s16 % 4 === 2) this.hat(t, 0.12, 0.05);
    if (sec.hats >= 2 && s16 % 2 === 0 && s16 % 4 !== 2) this.hat(t, 0.06, 0.03);
    if (sec.hats >= 3 && s16 % 2 === 1) this.hat(t, 0.035, 0.02);
    if (sec.hats >= 2 && s16 === 14) this.hat(t, 0.08, 0.18); // offene Hi-Hat

    if (sec.bass && s16 % 2 === 0) {
      const oct = s16 % 8 === 6 ? 12 : 0;
      this.bass(t, midi(BASS[chordIdx] + oct), STEP * 1.6);
    }
    if (sec.pad && s16 === 0) this.pad(t, chord, STEP * 16);
    if (sec.arp && s16 % 2 === 0) {
      const pattern = [0, 1, 2, 1, 2, 0, 1, 2];
      const n = chord[pattern[(s16 / 2) % 8]] + 12;
      this.arp(t, midi(n));
    }
    if (sec.lead) {
      const n = LEAD[chordIdx][s16];
      if (n > 0) this.lead(t, midi(n), STEP * 1.8);
    }
  }

  env(g, t, peak, attack, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(155, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    this.env(g, t, 0.9, 0.002, 0.32);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.4);
  }

  snare(t, vol = 1) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    this.env(g, t, 0.38 * vol, 0.002, 0.18);
    n.connect(f).connect(g).connect(this.out);
    g.connect(this.reverb);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.25);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const og = ctx.createGain();
    this.env(og, t, 0.22 * vol, 0.002, 0.1);
    o.connect(og).connect(this.out);
    o.start(t);
    o.stop(t + 0.15);
  }

  hat(t, vol, decay) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = ctx.createGain();
    this.env(g, t, vol, 0.001, decay);
    n.connect(f).connect(g).connect(this.out);
    n.start(t, Math.random() * 0.5);
    n.stop(t + decay + 0.05);
  }

  bass(t, freq, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = freq / 2;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.22, 0.005, dur);
    o.connect(f);
    o2.connect(f);
    f.connect(g).connect(this.out);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  pad(t, chord, dur) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1800, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(900, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.25);
    g.gain.setValueAtTime(0.06, t + dur - 0.2);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.1);
    f.connect(g).connect(this.padBus);
    for (const n of chord) {
      for (const det of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.15);
      }
    }
  }

  arp(t, freq) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    const g = ctx.createGain();
    this.env(g, t, 0.045, 0.003, STEP * 1.4);
    o.connect(f).connect(g);
    g.connect(this.out);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + STEP * 2);
  }

  lead(t, freq, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = freq * 2;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.5;
    const vibG = ctx.createGain();
    vibG.gain.value = freq * 0.006;
    vib.connect(vibG).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(1200, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.075, 0.01, dur);
    o.connect(f);
    o2.connect(f);
    f.connect(g);
    g.connect(this.out);
    g.connect(this.delay);
    g.connect(this.reverb);
    for (const x of [o, o2, vib]) {
      x.start(t);
      x.stop(t + dur + 0.1);
    }
  }
}
