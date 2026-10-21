# Lifecycle Demo: Leaderboard Export

A small, isolated module used to exercise the autonomous PR lifecycle
(documentation, CodeQL, and Copilot review remediation). It is **not**
imported by the game, has no server or deployment entry point, and is
intended for demonstration purposes only — not production use.

## Module

`apps/lifecycle-demo/leaderboard.js`

### `escapePlayerLabel(name)`

Escapes a player name for safe display by replacing `&`, `<`, and `>`
with their HTML entity equivalents (`&amp;`, `&lt;`, `&gt;`).

- **Parameters**: `name` (`string`) — the raw player name.
- **Returns**: `string` — the escaped name.

```js
escapePlayerLabel('<Bob> & "Alice"'); // '&lt;Bob&gt; & "Alice"'
```

### `exportLeaderboard(entries, limit = 5)`

Builds a score-descending export of the top entries, assigning each a
1-based `rank` and escaping its `name` via `escapePlayerLabel`.

- **Parameters**:
  - `entries` (`Array<{ name: string, score: number }>`) — caller-owned
    array of leaderboard entries. **Note:** the underlying sort is
    performed in place, so the caller's array is reordered as a side
    effect of this call.
  - `limit` (`number`, default `5`) — maximum number of entries to
    include in the export.
- **Returns**: `Array<{ rank: number, name: string, score: number }>`
  — the top `limit` entries sorted by descending `score`.

```js
const entries = [
  { name: 'Alice', score: 10 },
  { name: 'Bob', score: 20 }
];
exportLeaderboard(entries, 1);
// [{ rank: 1, name: 'Bob', score: 20 }]
```

### `summarizeLeaderboard(entries)`

Computes aggregate statistics over a list of leaderboard entries.

- **Parameters**: `entries` (`Array<{ score: number }>`).
- **Returns**: `{ count: number, total: number, average: number }`
  — the number of entries, the sum of their scores, and the mean
  score. For an empty `entries` array, `count` and `total` are `0`;
  `average` is `NaN` (a `0 / 0` division), despite the source
  comment stating it is zero — callers should guard against an
  empty array if they need a numeric average.

```js
summarizeLeaderboard([{ score: 10 }, { score: 20 }]);
// { count: 2, total: 30, average: 15 }

summarizeLeaderboard([]);
// { count: 0, total: 0, average: NaN }
```

## Testing

Tests for this module live in `tests/lifecycle-demo.test.js` and run
with the repository's standard test command:

```bash
npx vitest run
```
