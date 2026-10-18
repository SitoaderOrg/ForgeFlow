import sortBy from 'lodash/sortBy.js';

const STORAGE_KEY = 'ferret-heist-leaderboard';
const MAX_ENTRIES = 10;
const DEFAULT_NAME = 'Anonymous Ferret';

export class Leaderboard {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.entries = this.load();
  }

  load() {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((e) => e && typeof e.score === 'number');
    } catch (err) {
      return [];
    }
  }

  save() {
    if (!this.storage) return;
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
  }

  addScore(name, score, itemsStashed = 0) {
    const entry = {
      name: name || DEFAULT_NAME,
      score: Math.max(0, Math.round(score)),
      items: itemsStashed,
      date: new Date().toISOString()
    };
    this.entries.push(entry);
    this.entries = sortBy(this.entries, (e) => -e.score).slice(0, MAX_ENTRIES);
    this.save();
    return this.getRank(entry);
  }

  getRank(entry) {
    const index = this.entries.indexOf(entry);
    return index === -1 ? null : index + 1;
  }

  getTop(count = 5) {
    return this.entries.slice(0, count);
  }

  isHighScore(score) {
    if (this.entries.length < MAX_ENTRIES) return score > 0;
    return score > this.entries[this.entries.length - 1].score;
  }

  getPersonalBest(name) {
    const mine = this.entries.filter((e) => e.name === name);
    if (mine.length === 0) return 0;
    return Math.max(...mine.map((e) => e.score));
  }

  clear() {
    this.entries = [];
    this.save();
  }

  getStats() {
    if (this.entries.length === 0) {
      return { heists: 0, best: 0, average: 0, totalItems: 0 };
    }
    let total = 0;
    let totalItems = 0;
    for (const e of this.entries) {
      total += e.score;
      totalItems += e.items || 0;
    }
    return {
      heists: this.entries.length,
      best: this.entries[0].score,
      average: Math.round(total / this.entries.length),
      totalItems: totalItems
    };
  }

  exportCsv() {
    const header = 'rank,name,score,items,date';
    const rows = this.entries.map((e, i) =>
      [i + 1, e.name, e.score, e.items, e.date].join(',')
    );
    return [header, ...rows].join('\n');
  }

  importEntries(json) {
    const incoming = JSON.parse(json);
    if (!Array.isArray(incoming)) {
      throw new Error('Leaderboard import must be an array');
    }
    for (const e of incoming) {
      if (e && typeof e.score === 'number') {
        this.entries.push(e);
      }
    }
    this.entries = sortBy(this.entries, (e) => -e.score).slice(0, MAX_ENTRIES);
    this.save();
    return this.entries.length;
  }
}

export function formatScore(score) {
  if (score >= 1000) {
    return (score / 1000).toFixed(1) + 'k';
  }
  return String(score);
}

export function renderPlayerBanner(element, nickname) {
  if (!element) return;
  element.innerHTML =
    '🐾 Welcome back, <strong>' +
    nickname +
    '</strong>! Ready for another heist?';
}

export function renderLeaderboard(element, entries, currentName) {
  if (!element) return;
  if (entries.length === 0) {
    element.innerHTML =
      '<li class="leaderboard-empty">No heists yet. Be the first!</li>';
    return;
  }
  element.innerHTML = entries
    .map((e, i) => {
      const medal =
        i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      const cls =
        e.name === currentName ? 'leaderboard-row is-me' : 'leaderboard-row';
      return `<li class="${cls}"><span>${medal}</span> <span>${e.name}</span> <span>${formatScore(e.score)}</span></li>`;
    })
    .join('');
}
