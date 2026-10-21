import { describe, it, expect } from 'vitest';
import {
  escapePlayerLabel,
  exportLeaderboard,
  summarizeLeaderboard
} from '../apps/lifecycle-demo/leaderboard.js';

describe('leaderboard', () => {
  it('escapes HTML-sensitive characters in player labels', () => {
    expect(escapePlayerLabel('<script>&"</script>')).toBe(
      '&lt;script&gt;&amp;"&lt;/script&gt;'
    );
  });

  it('exports a score-descending slice without mutating the caller entries', () => {
    const entries = [
      { name: 'a', score: 1 },
      { name: 'b', score: 3 },
      { name: 'c', score: 2 }
    ];
    const original = entries.map((entry) => ({ ...entry }));

    const exported = exportLeaderboard(entries, 2);

    expect(exported).toEqual([
      { rank: 1, name: 'b', score: 3 },
      { rank: 2, name: 'c', score: 2 }
    ]);
    expect(entries).toEqual(original);
  });

  it('summarizes scores', () => {
    const entries = [
      { name: 'a', score: 2 },
      { name: 'b', score: 4 }
    ];
    expect(summarizeLeaderboard(entries)).toEqual({
      count: 2,
      total: 6,
      average: 3
    });
  });

  it('returns a zeroed summary for an empty leaderboard', () => {
    expect(summarizeLeaderboard([])).toEqual({
      count: 0,
      total: 0,
      average: 0
    });
  });
});
