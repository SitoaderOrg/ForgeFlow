# Ferret Heist: The Stash Under the Couch

A standalone, zero-deployment 2D stealth action browser game. It is the sample app used to exercise
the ForgeFlow gates and remediation loops.

## Commands

Run from this folder after `npm ci`:

| Command | Purpose |
| :--- | :--- |
| `npm run dev` / `npm run preview` | Serve the game locally (Vite) |
| `npm run build` | Bundle into `dist/` |
| `npm test` | Run the Vitest suite in `tests/` |
| `npm run test:cov` | Run the tests with V8 coverage for `src/game/` |

Linting uses the shared configs at the repository root: run `npm run lint` there.

## Layout

- `index.html`, `style.css` — page shell and styles.
- `src/main.js` — wires the canvas, renderer, sound effects, game engine and the scoreboard.
- `src/game/` — game logic (`engine`, `ferret`, `human`, `loot`, `stash`, `vacuum`), constants,
  rendering, audio and the `leaderboard` persistence.
- `src/scoreboard.js` — renders the "Top Heists" board and resolves the current player's name.
- `tests/` — unit tests for the game logic.

## Leaderboard ("Top Heists")

The game keeps a local high-score board of the best runs, persisted in the browser's
`localStorage` so it survives page reloads on the same device.

### Player name

The scoreboard greets the player using a name taken from the `player` query string parameter,
e.g. opening `index.html?player=Noodle` greets *Noodle* and tags their rows on the board. If no
`player` parameter is set, the player is shown as *Anonymous Ferret*. This lets friends share
personalized links while still using the same shared leaderboard storage.

### `src/game/leaderboard.js`

Pure, storage-agnostic helpers for managing the top runs (any object implementing the
`Storage` interface, such as `window.localStorage`, can be passed in):

| Export | Description |
| :--- | :--- |
| `LEADERBOARD_KEY` | The `localStorage` key used to persist entries (`'ferret-heist:leaderboard'`). |
| `MAX_ENTRIES` | Maximum number of entries kept on the board (`5`). |
| `loadLeaderboard(storage)` | Reads and parses the saved entries from `storage`, or returns `[]` if none exist. |
| `saveLeaderboard(storage, entries)` | Serializes `entries` and writes them to `storage`. |
| `addEntry(entries, entry)` | Inserts `entry`, re-sorts by `score` (descending) and trims the list to `MAX_ENTRIES`. Returns the new array. |
| `isHighScore(entries, score)` | Returns `true` if `score` would make it onto the board. |
| `recordRun(storage, { name, score, items, outcome })` | Loads, updates and saves the leaderboard for a finished run. Returns `{ entries, isNewBest }`, where `isNewBest` indicates the run became the new top entry. Each stored entry also gets an ISO `date` timestamp. |

`outcome` is one of `'victory'` (heist completed) or `'caught'` (ferret caught for the third
time); `score` and `items` come from the game engine's stash totals.

### `src/scoreboard.js`

- `getPlayerName()` — reads the `player` query parameter described above.
- `class Scoreboard` — wraps a `Storage` instance (defaults to `window.localStorage`):
  - `init()` — greets the player and renders the saved leaderboard on load.
  - `record(engine, outcome)` — records the just-finished run via `recordRun`, re-renders the
    board, and shows a "NEW BEST HEIST" message on the canvas when the run becomes the new best.
  - `render(entries)` — redraws the `<ul id="scoreboard-list">` rows, highlighting the current
    player's entries.

`src/main.js` calls `scoreboard.record(engine, outcome)` when the game ends in victory or
game-over, so every completed run is automatically added to the board.
