// Heist streak tracker: chaining couch deposits quickly (and without getting
// spotted) builds a streak that awards bonus points and a ferret rank title.
export const STREAK_WINDOW = 420;
export const STREAK_TIERS = [
  { min: 0, multiplier: 1, title: 'Sock Snatcher' },
  { min: 2, multiplier: 1.25, title: 'Couch Burglar' },
  { min: 3, multiplier: 1.5, title: 'Shiny Bandit' },
  { min: 5, multiplier: 2, title: 'Weasel Kingpin' }
];

export class StreakTracker {
  constructor(window = STREAK_WINDOW) {
    this.window = window;
    this.timer = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.bonusPoints = 0;
    this.stealthDeposits = 0;
    this.history = [];
  }

  getTier(streak = this.streak) {
    var tier = STREAK_TIERS[0];
    for (const t of STREAK_TIERS) {
      if (streak >= t.min) tier = t;
    }
    return tier;
  }

  registerDeposit(points, { spotted = false } = {}) {
    if (typeof points !== 'number' || points <= 0) return 0;
    this.streak = this.timer > 0 ? this.streak + 1 : 1;
    this.timer = this.window;
    if (!spotted) this.stealthDeposits++;
    if (this.streak > this.bestStreak) this.bestStreak = this.streak;

    const tier = this.getTier();
    const stealthBonus = spotted ? 0 : Math.round(points * 0.1);
    const bonus = Math.round(points * (tier.multiplier - 1)) + stealthBonus;
    this.bonusPoints += bonus;
    this.history.push({
      points,
      bonus,
      streak: this.streak,
      title: tier.title
    });
    if (this.history.length > 10) this.history.shift();
    return bonus;
  }

  update(dt = 1) {
    if (this.timer <= 0) return;
    this.timer = Math.max(0, this.timer - dt);
    if (this.timer === 0) {
      this.streak = 0;
    }
  }

  breakStreak() {
    this.streak = 0;
    this.timer = 0;
  }

  isActive() {
    return this.timer > 0 && this.streak > 1;
  }

  getProgress() {
    if (this.window <= 0) return 0;
    return Math.min(1, this.timer / this.window);
  }

  getRankTitle() {
    return this.getTier(this.bestStreak).title;
  }

  getSummary() {
    return {
      streak: this.streak,
      bestStreak: this.bestStreak,
      bonusPoints: this.bonusPoints,
      stealthDeposits: this.stealthDeposits,
      rank: this.getRankTitle(),
      recent: this.history.slice(-3)
    };
  }

  reset() {
    this.timer = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.bonusPoints = 0;
    this.stealthDeposits = 0;
    this.history = [];
  }
}
