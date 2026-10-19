# Combo Meter

The `ComboMeter` class tracks consecutive stash actions within a time window and provides a score multiplier for streaks in the Ferret Heist game.

## Purpose
The combo meter rewards players for making quick, consecutive stashes. The higher the streak, the higher the score multiplier (up to 5x).

## Usage

```js
import { ComboMeter } from './combo.js';

const combo = new ComboMeter();

// When a stash occurs:
const multiplier = combo.registerStash();
console.log(`Current multiplier: x${multiplier}`);

// To reset the combo (e.g., on game over):
combo.reset();
```

## API Reference

### Constructor
- `new ComboMeter(windowMs = 3000)`
  - `windowMs` (number): Time window in milliseconds to count consecutive stashes (default: 3000ms).

### Methods
- `registerStash(now = Date.now())`
  - Registers a stash event. Returns the current multiplier.
- `multiplier()`
  - Returns the current score multiplier (1–5).
- `reset()`
  - Resets the combo streak.

### Properties
- `streak` (number): Current streak count.
- `bestStreak` (number): Highest streak achieved in the session.

## Example

```js
const combo = new ComboMeter();
combo.registerStash(); // x1
combo.registerStash(); // x2 (if within 3s)
combo.registerStash(); // x2
combo.registerStash(); // x3
// ...
```

## Motivation
This feature encourages fast-paced gameplay and rewards skillful play with higher scores.
