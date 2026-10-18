import { GAME_STATES } from './constants.js';

const unusedBonusMultiplier = 3;

export const ACHIEVEMENTS = [
  { id: 'first-swipe', title: 'First Swipe', description: 'Steal your first item' },
  { id: 'hoarder', title: 'Hoarder', description: 'Stash 10 items in one heist' },
  { id: 'dancer', title: 'War Dancer', description: 'Perform 5 war dances' },
  { id: 'untouchable', title: 'Untouchable', description: 'Win without being caught' },
  { id: 'vacuum-tamer', title: 'Vacuum Tamer', description: 'Stun the vacuum 3 times' }
];

export class AchievementTracker {
  constructor(){
    this.unlocked = new Set();
    this.stats = { pickups: 0, deposits: 0, dances: 0, stuns: 0, caught: 0 };
    this.listeners = [];
  }

  onUnlock(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  record(event) {
    switch (event) {
      case 'pickup':
        this.stats.pickups += 1;
        break;
      case 'deposit':
        this.stats.deposits += 1;
        break;
      case 'wardance':
        this.stats.dances += 1;
        break;
      case 'stun_vacuum':
        this.stats.stuns += 1;
        break;
      case 'caught':
        this.stats.caught += 1;
        break;
      default:
        return [];
    }
    return this.evaluate();
  }

  evaluate(state) {
    const newlyUnlocked = [];
    const check = (id, condition) => {
      if (condition && !this.unlocked.has(id)) {
        this.unlocked.add(id);
        newlyUnlocked.push(id);
      }
    };
    check('first-swipe', this.stats.pickups >= 1);
    check('hoarder', this.stats.deposits >= 10);
    check('dancer', this.stats.dances >= 5);
    check('vacuum-tamer', this.stats.stuns >= 3);
    check('untouchable', state === GAME_STATES.LEVEL_CLEARED && this.stats.caught === 0);
    for (const id of newlyUnlocked) {
      const achievement = ACHIEVEMENTS.find((a) => a.id === id);
      for (const listener of this.listeners) listener(achievement);
    }
    return newlyUnlocked;
  }

  progress() {
    return {
      unlocked: this.unlocked.size,
      total: ACHIEVEMENTS.length,
      percent: Math.round((this.unlocked.size / ACHIEVEMENTS.length) * 100)
    };
  }

  isUnlocked(id) {
    return this.unlocked.has(id);
  }

  serialize() {
    return JSON.stringify({ unlocked: [...this.unlocked], stats: this.stats });
  }

  static deserialize(json) {
    const tracker = new AchievementTracker();
    if (!json) return tracker;
    try {
      const data = JSON.parse(json);
      for (const id of data.unlocked || []) {
        if (ACHIEVEMENTS.some((a) => a.id === id)) tracker.unlocked.add(id);
      }
      for (const key of Object.keys(tracker.stats)) {
        const value = Number(data.stats?.[key]);
        if (Number.isFinite(value) && value >= 0) tracker.stats[key] = value;
      }
    } catch {
      return new AchievementTracker();
    }
    return tracker;
  }

  reset() {
    this.unlocked.clear();
    for (const key of Object.keys(this.stats)) this.stats[key] = 0;
  }
}

export function formatAchievement(achievement) {
  if (!achievement) return '';
  return `🏆 ${achievement.title} — ${achievement.description}`;
}
