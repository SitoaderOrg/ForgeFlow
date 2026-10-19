# Ferret Heist

A small browser game where a ferret sneaks around stashing loot while
avoiding a human and a vacuum. The game logic lives under `src/game/`.

## Running

Open `index.html` in a browser, or serve the `apps/ferret-heist` directory
with any static file server.

## Game Modules

- `constants.js` – shared game constants and state enums (`GAME_STATES`).
- `engine.js` – main game loop and state management.
- `ferret.js` / `human.js` / `vacuum.js` – character behaviors.
- `loot.js` / `stash.js` – loot spawning and stash mechanics.
- `audio.js` / `render.js` – sound effects and canvas rendering.
- `combo.js` – combo/streak scoring for consecutive stashes (see below).

## Combo Meter (`src/game/combo.js`)

`ComboMeter` tracks how many stashes the player makes in quick succession
and converts that streak into a score multiplier.

### API

```js
import { ComboMeter } from './src/game/combo.js';

const combo = new ComboMeter(); // default 3-second window
```

#### `new ComboMeter(windowMs = 3000)`
Creates a combo meter. `windowMs` is the maximum gap, in milliseconds,
between two stashes for them to still count as part of the same streak.

#### `registerStash(now = Date.now())`
Call this each time the player successfully stashes loot.
- If the time since the last stash is within `windowMs`, the current
  streak is incremented; otherwise the streak resets to `1`.
- Updates `bestStreak` if the new streak is higher.
- Returns the current score multiplier (see `multiplier()`).

#### `multiplier()`
Returns the current score multiplier: `1 + floor(streak / 2)`, capped at
`5` (`MAX_MULTIPLIER`). For example, a streak of 1–2 yields `1x`, 3–4
yields `2x`, and so on up to the `5x` cap.

#### `reset()`
Clears the current streak and last-stash timestamp (does not reset
`bestStreak`, so the best run streak remains available for display).

### Example

```js
const combo = new ComboMeter();

combo.registerStash(1000); // streak = 1, returns 1x
combo.registerStash(2000); // within 3s window, streak = 2, returns 1x
combo.registerStash(3500); // within 3s window, streak = 3, returns 2x
combo.registerStash(10000); // gap > 3s, streak resets to 1, returns 1x

console.log(combo.bestStreak); // 3
```
