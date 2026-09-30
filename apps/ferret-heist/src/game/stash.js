import { COUCH } from './constants.js';

export class Stash {
  constructor(targetCount = 5) {
    this.couch = COUCH;
    this.stashedItems = [];
    this.totalScore = 0;
    this.targetCount = targetCount;
  }

  isUnderCouch(x, y) {
    return (
      x >= this.couch.x &&
      x <= this.couch.x + this.couch.width &&
      y >= this.couch.y &&
      y <= this.couch.y + this.couch.height
    );
  }

  deposit(item) {
    if (!item || item.isStashed) return 0;

    item.isStashed = true;
    item.isCarried = false;
    this.stashedItems.push(item);

    // Stash combo multiplier: every 2 items deposited increases combo multiplier
    const combo = 1 + Math.floor((this.stashedItems.length - 1) * 0.2);
    const earned = Math.round(item.points * combo);
    this.totalScore += earned;

    return earned;
  }

  isCleared() {
    return this.stashedItems.length >= this.targetCount;
  }

  getSummary() {
    return {
      count: this.stashedItems.length,
      target: this.targetCount,
      score: this.totalScore,
      items: this.stashedItems.map(i => ({
        name: i.name,
        emoji: i.emoji,
        points: i.points
      }))
    };
  }
}
