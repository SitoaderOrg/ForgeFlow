import { loadLeaderboard, recordRun } from './game/leaderboard.js';

const OUTCOME_ICONS = {
  victory: '🏆',
  caught: '😿'
};

export function getPlayerName() {
  const params = new URLSearchParams(window.location.search);
  return params.get('player') || 'Anonymous Ferret';
}

export class Scoreboard {
  constructor(storage = window.localStorage) {
    this.storage = storage;
    this.player = getPlayerName();
    this.greetingEl = document.getElementById('player-greeting');
    this.listEl = document.getElementById('scoreboard-list');
  }

  init() {
    this.greetingEl.innerHTML = `Heisting as <strong>${this.player}</strong>`;
    this.render(loadLeaderboard(this.storage));
  }

  record(engine, outcome) {
    const { entries, isNewBest } = recordRun(this.storage, {
      name: this.player,
      score: engine.stash.totalScore,
      items: engine.stash.stashedItems.length,
      outcome
    });
    this.render(entries);
    if (isNewBest) {
      engine.setMessage(`NEW BEST HEIST, ${this.player}! 🏆`, 240);
    }
  }

  render(entries) {
    if (entries.length === 0) {
      this.listEl.innerHTML =
        '<li class="scoreboard-empty">No heists yet. Go swipe something!</li>';
      return;
    }
    this.listEl.innerHTML = entries
      .map(
        (entry) =>
          `<li class="${entry.name === this.player ? 'scoreboard-you' : ''}">` +
          `<span class="scoreboard-name">${OUTCOME_ICONS[entry.outcome]} ${entry.name}</span>` +
          `<span class="scoreboard-score">${entry.score} pts · ${entry.items} items</span>` +
          '</li>'
      )
      .join('');
  }
}
