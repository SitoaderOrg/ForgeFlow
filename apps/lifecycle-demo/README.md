# Lifecycle Demo: Leaderboard

A small, isolated module used to exercise the autonomous PR lifecycle
(documentation, CodeQL, and Copilot review remediation) end to end. It is
**not imported by the game**, has no server or deployment entry point, and is
exercised only by synthetic test data in `tests/lifecycle-demo.test.js`.

## API Reference

### `escapePlayerLabel(name)`

Escapes `&`, `<`, and `>` in a player name so it can be safely rendered as
HTML text.

- **Parameters**: `name` (`string`) — the raw player name.
- **Returns**: `string` — the name with `&`, `<`, and `>` replaced by their
  HTML entities (`&amp;`, `&lt;`, `&gt;`).

```js
import { escapePlayerLabel } from './leaderboard.js';

escapePlayerLabel('Tom & <Jerry>'); // 'Tom &amp; &lt;Jerry&gt;'
```

### `exportLeaderboard(entries, limit = 5)`

Builds a ranked, score-descending export of leaderboard entries.

- **Parameters**:
  - `entries` (`Array<{ name: string, score: number }>`) — the leaderboard
    entries to export.
  - `limit` (`number`, default `5`) — the maximum number of entries to
    return.
- **Returns**: `Array<{ rank: number, name: string, score: number }>` — the
  top `limit` entries sorted by descending `score`, with 1-based `rank` and
  HTML-escaped `name` (via `escapePlayerLabel`).

```js
import { exportLeaderboard } from './leaderboard.js';

exportLeaderboard(
  [
    { name: 'Scout', score: 20 },
    { name: 'Pip & Pop', score: 100 }
  ],
  1
);
// [{ rank: 1, name: 'Pip &amp; Pop', score: 100 }]
```

> **Caller-owned arrays**: `exportLeaderboard` sorts the `entries` array with
> `Array.prototype.sort`, which reorders the array **in place**. Pass a copy
> (e.g. `exportLeaderboard([...entries])`) if the caller needs the original
> array order preserved.

### `summarizeLeaderboard(entries)`

Summarizes the scores of a leaderboard.

- **Parameters**: `entries` (`Array<{ name: string, score: number }>`).
- **Returns**: `{ count: number, total: number, average: number }` —
  the number of entries, the sum of their scores, and the mean score.

```js
import { summarizeLeaderboard } from './leaderboard.js';

summarizeLeaderboard([{ name: 'Scout', score: 25 }, { name: 'Dash', score: 75 }]);
// { count: 2, total: 100, average: 50 }
```

> **Empty leaderboard summaries**: when `entries` is empty, `count` and
> `total` are both `0`, and `average` is `NaN` (`0 / 0`), not `0`.

## Testing

Unit tests live in `tests/lifecycle-demo.test.js` and run with the
repository's standard test command (e.g. `npm test`).
