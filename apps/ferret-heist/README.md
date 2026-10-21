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
- `src/game/` — game logic (`engine`, `ferret`, `human`, `loot`, `stash`, `vacuum`), constants,
  rendering and audio.
- `tests/` — unit tests for the game logic.
