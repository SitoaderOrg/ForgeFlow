import { describe, expect, it } from 'vitest';
import {
  escapePlayerLabel,
  exportLeaderboard,
  summarizeLeaderboard
} from '../apps/lifecycle-demo/leaderboard.js';

describe('lifecycle demo leaderboard', () => {
  it.each([
    ['Scout', 'Scout'],
    ['Tom & <Jerry>', 'Tom &amp; &lt;Jerry&gt;'],
    ['', '']
  ])('escapes the player label %j', (input, expected) => {
    expect(escapePlayerLabel(input)).toBe(expected);
  });

  it('exports the highest scores first with ranks and escaped names', () => {
    const entries = [
      { name: 'Scout', score: 20 },
      { name: 'Pip & Pop', score: 100 },
      { name: '<Dash>', score: 70 }
    ];

    expect(exportLeaderboard(entries, 2)).toEqual([
      { rank: 1, name: 'Pip &amp; Pop', score: 100 },
      { rank: 2, name: '&lt;Dash&gt;', score: 70 }
    ]);
  });

  it('does not mutate the caller-provided entries array', () => {
    const entries = [
      { name: 'Scout', score: 20 },
      { name: 'Pip & Pop', score: 100 },
      { name: '<Dash>', score: 70 }
    ];
    const originalOrder = entries.map((entry) => entry.name);

    exportLeaderboard(entries, 2);

    expect(entries.map((entry) => entry.name)).toEqual(originalOrder);
  });

  it('uses a default limit of five', () => {
    const entries = Array.from({ length: 6 }, (_, index) => ({
      name: `Player ${index}`,
      score: index
    }));

    expect(exportLeaderboard(entries)).toHaveLength(5);
  });

  it('summarizes a populated leaderboard', () => {
    expect(
      summarizeLeaderboard([
        { name: 'Scout', score: 25 },
        { name: 'Dash', score: 75 }
      ])
    ).toEqual({ count: 2, total: 100, average: 50 });
  });

  it('preserves a zero score in the summary', () => {
    expect(summarizeLeaderboard([{ name: 'Scout', score: 0 }])).toEqual({
      count: 1,
      total: 0,
      average: 0
    });
  });

  it('returns a zero average for an empty leaderboard', () => {
    expect(summarizeLeaderboard([])).toEqual({
      count: 0,
      total: 0,
      average: 0
    });
  });
});
