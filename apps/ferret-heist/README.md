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
- `src/main.js` — wires the canvas, renderer, sound effects and game engine.
- `src/game/` — game logic (`engine`, `ferret`, `human`, `loot`, `stash`, `vacuum`, `leaderboard`),
  constants, rendering and audio.
- `src/scoreboard.js` — renders the "Top Heists" leaderboard panel and greets the player.
- `tests/` — unit tests for the game logic.

## Top Heists leaderboard

The game keeps a persistent leaderboard of the best runs in the browser's `localStorage`.

- A run is recorded when the heist is completed (`victory`) or when the ferret is caught for the
  third time (`gameover`). Each entry stores the player's name, score, number of items stashed,
  outcome, and the date of the run.
- Only the top `MAX_ENTRIES` (5) runs are kept, sorted by score
  (`src/game/leaderboard.js:MAX_ENTRIES`).
- When a new run tops the board, the player sees a "NEW BEST HEIST" message in-game.
- Players can set a display name via the `player` query parameter, e.g.
  `index.html?player=Noodle`. If omitted, runs are recorded as *Anonymous Ferret*. This lets
  friends share personalised links while competing on the same leaderboard.
- The current player's rows are highlighted in the scoreboard panel.

### `src/game/leaderboard.js` API

| Export | Purpose |
| :--- | :--- |
| `LEADERBOARD_KEY` | `localStorage` key used to persist the leaderboard. |
| `MAX_ENTRIES` | Maximum number of entries retained (5). |
| `loadLeaderboard(storage)` | Reads and parses the leaderboard from `storage`; returns `[]` if empty. |
| `saveLeaderboard(storage, entries)` | Persists `entries` to `storage`. |
| `addEntry(entries, entry)` | Inserts `entry`, re-sorts by score descending, and truncates to `MAX_ENTRIES`. |
| `isHighScore(entries, score)` | Returns `true` if `score` would make the top `MAX_ENTRIES`. |
| `recordRun(storage, { name, score, items, outcome })` | Builds a dated entry, saves it, and returns `{ entries, isNewBest }`. |

`storage` is any object implementing the `Storage` interface (e.g. `window.localStorage`), which
keeps the module testable without a real browser environment.
