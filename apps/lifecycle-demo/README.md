# Lifecycle Demo: Leaderboard Export

An isolated module used to exercise the autonomous PR lifecycle (docs, CodeQL,
and Copilot review remediation) end to end. **Nothing in the game imports
this module** — it has no server or deployment entry point and is intended
only for the lifecycle demo in `apps/lifecycle-demo/leaderboard.js`.

## API Reference

### `escapePlayerLabel(name)`

Escapes HTML-sensitive characters in a player's display name.

| Parameter | Type     | Description                     |
| --------- | -------- | -------------------------------- |
| `name`    | `string` | Raw player label to escape.      |

Returns a `string` with `&`, `<`, and `>` replaced by their HTML entities
(`&amp;`, `&lt;`, `&gt;`).

```js
import { escapePlayerLabel } from './leaderboard.js';

escapePlayerLabel('Tom & <Jerry>');
// => 'Tom &amp; &lt;Jerry&gt;'
```

### `exportLeaderboard(entries, limit = 5)`

Returns a new, score-descending export of leaderboard entries, ranked and
with escaped names. **The caller's `entries` array is not mutated** by the
sort — a shallow copy is sorted internally.

| Parameter | Type                                  | Description                                  |
| --------- | -------------------------------------- | --------------------------------------------- |
| `entries` | `Array<{ name: string, score: number }>` | Leaderboard entries to export.                |
| `limit`   | `number` (default `5`)                | Maximum number of ranked entries to return.   |

Returns an `Array<{ rank: number, name: string, score: number }>`, sorted by
score descending and truncated to `limit` entries. `name` values are passed
through `escapePlayerLabel`.

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

Summarizes the total and average score across a set of leaderboard entries.

| Parameter | Type                                  | Description                   |
| --------- | --------------------------------------- | ------------------------------ |
| `entries` | `Array<{ name: string, score: number }>` | Leaderboard entries to summarize. |

Returns `{ count: number, total: number, average: number }`. A leaderboard
with a single zero-score entry preserves `average: 0`; passing an empty
`entries` array yields `average: NaN` (division by zero), since no guard is
applied for that case.

```js
import { summarizeLeaderboard } from './leaderboard.js';

summarizeLeaderboard([{ name: 'Scout', score: 0 }]);
// => { count: 1, total: 0, average: 0 }
```

## Running the Tests

Tests for this module live in `tests/lifecycle-demo.test.js` and run with the
project's existing Vitest setup:

```bash
npx vitest run tests/lifecycle-demo.test.js
```

