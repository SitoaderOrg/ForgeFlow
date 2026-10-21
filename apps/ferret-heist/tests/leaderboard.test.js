import { describe, it, expect, beforeEach } from 'vitest';
import {
  LEADERBOARD_KEY,
  MAX_ENTRIES,
  loadLeaderboard,
  saveLeaderboard,
  addEntry,
  isHighScore,
  recordRun
} from '../src/game/leaderboard.js';

function createStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value))
  };
}

const run = (name, score) => ({ name, score, items: 1, outcome: 'victory' });

describe('Leaderboard', () => {
  let storage;

  beforeEach(() => {
    storage = createStorage();
  });

  it('returns an empty leaderboard when nothing is stored', () => {
    expect(loadLeaderboard(storage)).toEqual([]);
  });

  it('round-trips entries through storage', () => {
    const entries = [run('Bandit', 120)];
    saveLeaderboard(storage, entries);
    expect(JSON.parse(storage.getItem(LEADERBOARD_KEY))).toEqual(entries);
    expect(loadLeaderboard(storage)).toEqual(entries);
  });

  it('keeps entries sorted by score and capped at MAX_ENTRIES', () => {
    let entries = [];
    for (let i = 1; i <= MAX_ENTRIES + 2; i++) {
      entries = addEntry(entries, run(`Ferret ${i}`, i * 10));
    }
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(entries[0].score).toBe((MAX_ENTRIES + 2) * 10);
    expect(entries.map((e) => e.score)).toEqual(
      [...entries.map((e) => e.score)].sort((a, b) => b - a)
    );
  });

  it('detects high scores', () => {
    expect(isHighScore([], 0)).toBe(true);
    let entries = [];
    for (let i = 1; i <= MAX_ENTRIES; i++) {
      entries = addEntry(entries, run(`Ferret ${i}`, i * 10));
    }
    expect(isHighScore(entries, 5)).toBe(false);
    expect(isHighScore(entries, 15)).toBe(true);
  });

  it('records a run and reports a new best', () => {
    recordRun(storage, run('Bandit', 100));
    const result = recordRun(storage, {
      name: 'Noodle',
      score: 250,
      items: 5,
      outcome: 'victory'
    });
    expect(result.isNewBest).toBe(true);
    expect(result.entries[0]).toMatchObject({ name: 'Noodle', score: 250 });
    expect(result.entries[0].date).toEqual(expect.any(String));
    expect(loadLeaderboard(storage)).toHaveLength(2);
  });

  it('does not report a new best for a lower score', () => {
    recordRun(storage, run('Bandit', 300));
    const result = recordRun(storage, run('Noodle', 50));
    expect(result.isNewBest).toBe(false);
    expect(result.entries.map((e) => e.name)).toEqual(['Bandit', 'Noodle']);
  });
});
