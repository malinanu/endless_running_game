// Tiny WebAudio synth: jingle-bells loop plus jump / slide / pickup / crash effects.
// Everything is generated at runtime so no audio files are needed.

const NOTE = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, G3: 196.0 };

// "Jingle Bells" chorus as [note, beats]; null is a rest.
const MELODY = [
  ['E4', 1], ['E4', 1], ['E4', 2], ['E4', 1], ['E4', 1], ['E4', 2],
  ['E4', 1], ['G4', 1], ['C4', 1.5], ['D4', 0.5], ['E4', 4],
  ['F4', 1], ['F4', 1], ['F4', 1.5], ['F4', 0.5], ['F4', 1], ['E4', 1], ['E4', 1], ['E4', 0.5], ['E4', 0.5],
  ['E4', 1], ['D4', 1], ['D4', 1], ['E4', 1], ['D4', 2], ['G4', 2],
  ['E4', 1], ['E4', 1], ['E4', 2], ['E4', 1], ['E4', 1], ['E4', 2],
  ['E4', 1], ['G4', 1], ['C4', 1.5], ['D4', 0.5], ['E4', 4],
  ['F4', 1], ['F4', 1], ['F4', 1.5], ['F4', 0.5], ['F4', 1], ['E4', 1], ['E4', 1], ['E4', 0.5], ['E4', 0.5],
  ['G4', 1], ['G4', 1], ['F4', 1], ['D4', 1], ['C4', 4],
];
const BEAT = 0.22; // seconds per beat

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.musicTimer = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('runner-muted') === '1'; } catch { /* storage unavailable */ }
  }

  // Must be called from a user gesture (browsers block autoplay).
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    try { localStorage.setItem('runner-muted', this.muted ? '1' : '0'); } catch { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  tone(freq, start, dur, { type = 'triangle', gain = 0.3, dest = this.master, slideTo = null } = {}) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  bell(freq, start, dur, dest) {
    // Two detuned partials give a sleigh-bell shimmer.
    this.tone(freq * 2, start, dur, { type: 'sine', gain: 0.18, dest });
    this.tone(freq * 4.01, start, dur * 0.6, { type: 'sine', gain: 0.05, dest });
  }

  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const total = MELODY.reduce((s, [, b]) => s + b, 0) * BEAT;
    const schedule = () => {
      let t = this.ctx.currentTime + 0.05;
      for (const [n, beats] of MELODY) {
        if (n) this.bell(NOTE[n], t, beats * BEAT * 0.95, this.musicGain);
        t += beats * BEAT;
      }
      // Soft bass on every other beat.
      for (let b = 0; b < total / BEAT; b += 2) {
        this.tone(NOTE.C4 / 2, this.ctx.currentTime + 0.05 + b * BEAT, BEAT * 1.6, { type: 'sine', gain: 0.12, dest: this.musicGain });
      }
    };
    schedule();
    this.musicTimer = setInterval(schedule, total * 1000);
  }

  stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = null;
    if (this.musicGain) {
      // Fade the already-scheduled notes out, then restore the bus level.
      const now = this.ctx.currentTime;
      this.musicGain.gain.setTargetAtTime(0, now, 0.1);
      const old = this.musicGain;
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.35;
      this.musicGain.connect(this.master);
      setTimeout(() => old.disconnect(), 1500);
    }
  }

  jump() {
    if (!this.ctx) return;
    this.tone(330, this.ctx.currentTime, 0.18, { type: 'square', gain: 0.12, slideTo: 660 });
  }

  slide() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const len = 0.3;
    const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.value = 0.25;
    src.buffer = buf;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
  }

  pickup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.bell(NOTE.C5, t, 0.15, this.master);
    this.bell(NOTE.G4 * 2, t + 0.07, 0.25, this.master);
  }

  levelUp() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [NOTE.C5, NOTE.E4 * 2, NOTE.G4 * 2].forEach((f, i) => this.tone(f, t + i * 0.08, 0.2, { type: 'triangle', gain: 0.15 }));
  }

  crash() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(220, t, 0.5, { type: 'sawtooth', gain: 0.2, slideTo: 55 });
    this.tone(NOTE.G3, t + 0.05, 0.4, { type: 'square', gain: 0.1, slideTo: 80 });
  }
}
