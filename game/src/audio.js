// Coral Coast Run — procedural sound, no audio files.
// Every sound is a small WebAudio patch built at runtime: an engine hum
// whose pitch follows the throttle, a chime for rings, a beep for warnings,
// a thud for a crash and a little fanfare for a landing. Audio starts only
// after the player's first interaction, as browsers require.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.muted = false;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 60;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(filter).connect(this.engineGain).connect(this.ctx.destination);
    this.engineOsc.start();
  }

  setEngine(throttle, speed) {
    if (!this.ctx || !this.engineGain) return;
    const target = this.muted ? 0 : 0.02 + throttle * 0.05;
    this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.1);
    this.engineOsc.frequency.setTargetAtTime(55 + throttle * 70 + speed * 0.35, this.ctx.currentTime, 0.1);
  }

  _tone(freq, dur, type, vol, when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  ring() {
    this._tone(880, 0.35, 'sine', 0.16);
    this._tone(1318, 0.45, 'sine', 0.12, 0.07);
  }

  checkpoint() {
    this._tone(659, 0.3, 'triangle', 0.15);
    this._tone(988, 0.4, 'triangle', 0.12, 0.08);
  }

  warning() {
    this._tone(440, 0.16, 'square', 0.07);
    this._tone(440, 0.16, 'square', 0.07, 0.22);
  }

  crash() {
    this._tone(70, 0.5, 'sawtooth', 0.25);
    this._tone(45, 0.7, 'sine', 0.22, 0.05);
  }

  land() {
    [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.4, 'triangle', 0.14, i * 0.11));
  }

  click() {
    this._tone(1200, 0.06, 'sine', 0.08);
  }
}
