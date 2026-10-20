# Lifecycle Demo: Leaderboard Export

An isolated module used to exercise the autonomous PR lifecycle end to end.
Nothing in the game imports this module, it has no server or deployment
entry point, and it operates only on synthetic test data.

## API Reference

### `escapePlayerLabel(name)`

Escapes `&`, `<`, and `>` in a player name so it can be safely rendered as
HTML text.

- **Parameters**
  - `name` (`string`) — the raw player name.
- **Returns** (`string`) — the name with `&`, `<`, and `>` replaced by their
  HTML entities (`&amp;`, `&lt;`, `&gt;`).

```js
import { escapePlayerLabel } from './leaderboard.js';

escapePlayerLabel('Tom & <Jerry>');
// => 'Tom &amp; &lt;Jerry&gt;'
```

### `exportLeaderboard(entries, limit = 5)`

Returns the top-scoring entries in descending order, ranked and with escaped
names, without mutating the caller's array.

- **Parameters**
  - `entries` (`Array<{ name: string, score: number }>`) — the leaderboard
    entries. The caller's array is left untouched; sorting happens on a
    copy.
  - `limit` (`number`, default `5`) — the maximum number of entries to
    return.
- **Returns** (`Array<{ rank: number, name: string, score: number }>`) — the
  top entries sorted by descending score, each with a 1-based `rank` and an
  HTML-escaped `name`.

```js
import { exportLeaderboard } from './leaderboard.js';

exportLeaderboard(
  [
    { name: 'Scout', score: 20 },
    { name: 'Pip & Pop', score: 100 }
  ],
  1
);
// => [{ rank: 1, name: 'Pip &amp; Pop', score: 100 }]
```

### `summarizeLeaderboard(entries)`

Summarizes the total and average score across a set of entries.

- **Parameters**
  - `entries` (`Array<{ name: string, score: number }>`) — the leaderboard
    entries.
- **Returns** (`{ count: number, total: number, average: number }`) — the
  number of entries, the total score, and the average score. For an empty
  leaderboard, `average` is `0`.

```js
import { summarizeLeaderboard } from './leaderboard.js';

summarizeLeaderboard([{ name: 'Scout', score: 25 }, { name: 'Dash', score: 75 }]);
// => { count: 2, total: 100, average: 50 }
```

## Testing

Tests live in [`tests/lifecycle-demo.test.js`](../../tests/lifecycle-demo.test.js)
and run with the repository's standard Vitest suite:

```sh
npm test
```
