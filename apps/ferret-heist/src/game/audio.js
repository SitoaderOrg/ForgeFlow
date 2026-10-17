export class SoundEffects {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTone(freq, type = 'sine', duration = 0.1, gainVal = 0.15) {
    if (!this.enabled || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        this.ctx.currentTime + duration
      );

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch {
      // Audio autoplay policy fallback
    }
  }

  pickup() {
    this.init();
    this.playTone(440, 'triangle', 0.08, 0.2);
    setTimeout(() => this.playTone(660, 'triangle', 0.12, 0.2), 60);
  }

  deposit() {
    this.init();
    this.playTone(523, 'sine', 0.1, 0.2);
    setTimeout(() => this.playTone(659, 'sine', 0.1, 0.2), 70);
    setTimeout(() => this.playTone(784, 'sine', 0.15, 0.2), 140);
  }

  wardance() {
    this.init();
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        this.playTone(300 + Math.random() * 400, 'square', 0.05, 0.08);
      }, i * 40);
    }
  }

  bump() {
    this.init();
    this.playTone(180, 'sawtooth', 0.15, 0.25);
  }

  stunVacuum() {
    this.init();
    this.playTone(600, 'square', 0.08, 0.15);
    setTimeout(() => this.playTone(300, 'square', 0.12, 0.15), 60);
  }

  alert() {
    this.init();
    this.playTone(880, 'sawtooth', 0.25, 0.2);
  }

  caught() {
    this.init();
    this.playTone(350, 'sawtooth', 0.2, 0.25);
    setTimeout(() => this.playTone(200, 'sawtooth', 0.3, 0.25), 120);
  }

  victory() {
    this.init();
    const notes = [523, 659, 784, 1046];
    notes.forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 'triangle', 0.2, 0.25), idx * 100);
    });
  }
}
