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
- `src/main.js` — wires the canvas, renderer, sound effects, game engine and the scenario panel.
- `src/scenario-panel.js` — renders the Heist Scenarios picker and reads the `?scenario=` link param.
- `src/game/` — game logic (`engine`, `ferret`, `human`, `loot`, `scenarios`, `stash`, `vacuum`),
  constants, rendering and audio.
- `tests/` — unit tests for the game logic.

## Heist Scenarios

A **Heist Scenarios** panel lets players pick a scenario and start a run without reloading the
page. Each scenario (defined in `src/game/scenarios.js`) configures:

- `loot` — the loot layout (list of `{ type, x, y }` items).
- `target` — how many loot items must be stashed to win.
- `human.sweepSpeed` — the human's alertness/sweep speed.
- `vacuum.speed` — the Roomba's movement speed.

Built-in scenarios are `classic` (the default), `laundry` ("Laundry Day") and `jewel` ("Jewel
Thief"). Selecting a scenario in the panel shows a summary (loot goal, human alertness, Roomba
speed) before the player clicks **Start** to load it via `GameEngine.loadScenario(scenario)`.

### Linking directly to a scenario

A scenario can be preselected via the `scenario` query parameter, e.g.:

```
index.html?scenario=jewel
```

Built-in names (`classic`, `laundry`, `jewel`) load directly. Any other value is treated as a
custom scenario: it is parsed as a JavaScript object literal (via `parseScenario`) and deep-merged
over the `classic` defaults (via `buildScenario`), so a partial override such as
`?scenario={target:3,vacuum:{speed:4}}` only needs to specify the fields it changes.

> **Note**: custom scenario text is evaluated with `eval`, so only use trusted/own links — this
> is a local, zero-deployment sample app with no untrusted multi-user input.
