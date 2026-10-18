# Ferret Heist: Stash Under the Couch

## Streak Bonus System (v1.1)

### Overview
This update introduces a **streak bonus system** to the Ferret Heist game. Chaining successful stash deposits quickly (and without being spotted) builds a streak, awarding bonus points and a ferret rank title.

### How Streaks Work
- **Streaks** are built by depositing items in quick succession.
- Avoid getting caught to keep your streak alive.
- Each streak tier grants a higher bonus multiplier and a unique ferret rank:

| Streak | Multiplier | Title           |
|--------|------------|-----------------|
| 0-1    | 1x         | Sock Snatcher   |
| 2      | 1.25x      | Couch Burglar   |
| 3-4    | 1.5x       | Shiny Bandit    |
| 5+     | 2x         | Weasel Kingpin  |

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
import { StreakTracker } from './game/streak.js';
const streak = new StreakTracker();
streak.registerDeposit(100, { spotted: false }); // awards bonus
streak.breakStreak(); // resets streak
```

### Testing
- Unit tests for streak logic: `tests/streak.test.js`

### Motivation
The streak system rewards skilled, stealthy play and adds replay value with ferret rank titles.

---
*This documentation was automatically generated for PR #11 by the PR Documentation Updater agent.*
