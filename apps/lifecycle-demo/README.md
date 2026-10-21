# lifecycle-demo

A small, isolated module used to exercise the autonomous PR lifecycle (docs,
CodeQL, and Copilot review remediation). It is **not imported by the game**,
has no server or deployment entry point, and operates only on synthetic data
passed in by the caller.

## Module: `leaderboard.js`

### `escapePlayerLabel(name)`

Escapes `&`, `<`, and `>` characters in a player name so it is safe to render
as HTML text.

| Parameter | Type     | Description                    |
| --------- | -------- | ------------------------------ |
| `name`    | `string` | Raw player name to escape      |

**Returns:** `string` — the escaped name.

```js
escapePlayerLabel('Tom & <Jerry>');
// => 'Tom &amp; &lt;Jerry&gt;'
```

### `exportLeaderboard(entries, limit = 5)`

Returns the top-scoring entries in descending order, each annotated with a
1-based `rank` and an HTML-escaped `name`. The input array's entries are not
mutated by the caller's reference (sorting operates on and returns a new,
ranked view), but callers should treat `entries` as owned by this function
for the duration of the call.

| Parameter | Type                                | Default | Description                         |
| --------- | ----------------------------------- | ------- | ------------------------------------ |
| `entries` | `Array<{ name: string, score: number }>` | —       | Leaderboard entries to rank          |
| `limit`   | `number`                            | `5`     | Maximum number of entries to return  |

**Returns:** `Array<{ rank: number, name: string, score: number }>` sorted by
descending `score`.

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

Computes aggregate statistics for a set of leaderboard entries.

| Parameter | Type                                | Description             |
| --------- | ----------------------------------- | ------------------------ |
| `entries` | `Array<{ name: string, score: number }>` | Leaderboard entries      |

**Returns:** `{ count: number, total: number, average: number }`.

An empty `entries` array yields `{ count: 0, total: 0, average: NaN }`,
since dividing the zero total by a zero count produces `NaN` — callers
should guard for this case before displaying an average.

```js
summarizeLeaderboard([
  { name: 'Scout', score: 25 },
  { name: 'Dash', score: 75 }
]);
// => { count: 2, total: 100, average: 50 }
```

## Running the tests

```bash
npx vitest run tests/lifecycle-demo.test.js
```
