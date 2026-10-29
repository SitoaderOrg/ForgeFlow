import { loadLeaderboard, recordRun } from './game/leaderboard.js';

const OUTCOME_ICONS = {
  victory: '🏆',
  caught: '😿'
};

export function getPlayerName() {
  const params = new URLSearchParams(window.location.search);
  return params.get('player') || 'Anonymous Ferret';
}

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value))
  };
}

function getDefaultStorage() {
  try {
    return window.localStorage;
  } catch {
    return createMemoryStorage();
  }
}

export class Scoreboard {
  constructor(storage = getDefaultStorage()) {
    this.storage = storage;
    this.player = getPlayerName();
    this.greetingEl = document.getElementById('player-greeting');
    this.listEl = document.getElementById('scoreboard-list');
  }

  init() {
    this.greetingEl.textContent = '';
    this.greetingEl.append('Heisting as ');
    const strong = document.createElement('strong');
    strong.textContent = this.player;
    this.greetingEl.append(strong);
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
    this.listEl.textContent = '';
    if (entries.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'scoreboard-empty';
      emptyLi.textContent = 'No heists yet. Go swipe something!';
      this.listEl.append(emptyLi);
      return;
    }
    for (const entry of entries) {
      const li = document.createElement('li');
      if (entry.name === this.player) {
        li.className = 'scoreboard-you';
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'scoreboard-name';
      nameSpan.textContent = `${OUTCOME_ICONS[entry.outcome]} ${entry.name}`;

      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'scoreboard-score';
      scoreSpan.textContent = `${entry.score} pts · ${entry.items} items`;

      li.append(nameSpan, scoreSpan);
      this.listEl.append(li);
    }
  }
}
