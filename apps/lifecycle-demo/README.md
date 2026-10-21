# Lifecycle Demo: Leaderboard Export

A non-deployed sample module used to exercise the ForgeFlow autonomous PR lifecycle (docs,
CodeQL, and Copilot review remediation) end to end. Nothing in the game imports this module, it
has no server or deployment entry point, and it only operates on synthetic test data.

## API Reference

All helpers are exported from `leaderboard.js`.

### `escapePlayerLabel(name)`

Escapes `&`, `<`, and `>` characters in a player name so it is safe to render as HTML text.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Raw player label to escape. |

Returns the escaped `string`.

```js
escapePlayerLabel('Tom & <Jerry>');
// => 'Tom &amp; &lt;Jerry&gt;'
```

### `exportLeaderboard(entries, limit = 5)`

Returns the top-scoring entries, sorted by score descending, with a 1-based `rank` assigned and
player names escaped via `escapePlayerLabel`.

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `entries` | `Array<{ name: string, score: number }>` | — | Leaderboard entries to export. |
| `limit` | `number` | `5` | Maximum number of entries to return. |

Returns `Array<{ rank: number, name: string, score: number }>`.

> **Caller-owned array:** `exportLeaderboard` sorts `entries` **in place** using `Array.prototype.sort`.
> Pass a copy (e.g. `exportLeaderboard([...entries])`) if the caller needs the original order
> preserved.

```js
exportLeaderboard(
  [
    { name: 'Scout', score: 20 },
    { name: 'Pip & Pop', score: 100 },
    { name: '<Dash>', score: 70 }
  ],
  2
);
// => [
//   { rank: 1, name: 'Pip &amp; Pop', score: 100 },
//   { rank: 2, name: '&lt;Dash&gt;', score: 70 }
// ]
```

### `summarizeLeaderboard(entries)`

Computes the count, total, and average score across all entries.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `entries` | `Array<{ name: string, score: number }>` | Leaderboard entries to summarize. |

Returns `{ count: number, total: number, average: number }`.

> **Empty leaderboard:** `summarizeLeaderboard([])` returns `average: NaN` (division by zero),
> since `count` is `0`. Callers should guard against an empty `entries` array before relying on
> `average`.

```js
summarizeLeaderboard([
  { name: 'Scout', score: 25 },
  { name: 'Dash', score: 75 }
]);
// => { count: 2, total: 100, average: 50 }
```

## Tests

Unit tests live in `tests/lifecycle-demo.test.js` at the repository root and run with the
repository's shared Vitest setup (`npm test`).
