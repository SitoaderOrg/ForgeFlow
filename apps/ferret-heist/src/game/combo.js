import { GAME_STATES } from './constants.js';

const COMBO_WINDOW_MS = 3000;
const MAX_MULTIPLIER = 5;

export class ComboMeter {
  constructor(windowMs = COMBO_WINDOW_MS) {
    this.windowMs = windowMs;
    this.streak = 0;
    this.lastStashAt = null;
    this.bestStreak = 0;
  }

  registerStash(now = Date.now()) {
    const elapsed =
      this.lastStashAt === null ? Infinity : now - this.lastStashAt;
    this.streak = elapsed <= this.windowMs ? this.streak + 1 : 1;
    this.lastStashAt = now;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    return this.multiplier();
  }

  multiplier() {
    return Math.min(MAX_MULTIPLIER, 1 + Math.floor(this.streak / 2));
  }

  reset() {
    this.streak = 0;
    this.lastStashAt = null;
  }
}
