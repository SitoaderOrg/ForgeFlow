# Ferret Heist: Stash Under the Couch

## Development workspace

The game owns its source, dependencies, tests, and Vite/Vitest configuration in
this directory. Shared ESLint and Prettier conventions remain at the repository
root.

Install from the repository root using the shared lockfile:

```sh
npm ci
npm run dev --workspace=ferret-heist
```

The app can also be run from this directory with `npm run dev`. Its other commands
are:

| Command           | Purpose                                           |
| ----------------- | ------------------------------------------------- |
| `npm run lint`    | Check this app's JavaScript, formatting, and HTML |
| `npm run build`   | Build this app into `dist` in this directory      |
| `npm run preview` | Serve this app's production build                 |
| `npm test`        | Run this app's tests                              |
| `npm run test:ci` | Run tests with the app's enforced coverage policy |

From the repository root, add `--workspace=ferret-heist` to select these app
commands. Unqualified root `lint`, `build`, and `test:ci` commands validate all
registered apps, plus the relevant framework checks.

Tests live in `tests` alongside the app, and coverage reports are written to this
app's `coverage` directory. The existing deliberately failing streak assertion is
retained for the automated-repair demonstration; it is not skipped or weakened.

Do not add an app-local lockfile: the repository's root `package-lock.json` records
all workspace dependencies. The old repository-root HTML redirect is no longer
used; run the dev server or serve this app's `dist` build.

## Streak Bonus System (v1.1)

### Overview

This update introduces a **streak bonus system** to the Ferret Heist game. Chaining successful stash deposits quickly (and without being spotted) builds a streak, awarding bonus points and a ferret rank title.

### How Streaks Work

- **Streaks** are built by depositing items in quick succession.
- Avoid getting caught to keep your streak alive.
- Each streak tier grants a higher bonus multiplier and a unique ferret rank:

| Streak | Multiplier | Title          |
| ------ | ---------- | -------------- |
| 0-1    | 1x         | Sock Snatcher  |
| 2      | 1.25x      | Couch Burglar  |
| 3-4    | 1.5x       | Shiny Bandit   |
| 5+     | 2x         | Weasel Kingpin |

- **Stealth deposits** (not being spotted) grant an extra 10% bonus.
- Getting caught breaks your streak.

### UI Updates

- The player banner (top of the game) now displays your current streak, best streak, bonus points, and rank.
- Example: `🐾 Bandit — Shiny Bandit · streak x3 (best 4) · +75 bonus pts`

### API Reference

- `StreakTracker` class manages streak logic. See `src/game/streak.js` for details.
- Game events (`deposit`, `caught`, `restart`) update the streak and UI.

### Usage Example

```js
import { StreakTracker } from './src/game/streak.js';
const streak = new StreakTracker();
streak.registerDeposit(100, { spotted: false }); // awards bonus
streak.breakStreak(); // resets streak
```

### Testing

- Unit tests for streak logic: `tests/streak.test.js`

### Motivation

The streak system rewards skilled, stealthy play and adds replay value with ferret rank titles.

---

_This documentation was automatically generated for PR #11 by the PR Documentation Updater agent._
