# Combo Meter

The `ComboMeter` class tracks consecutive stash actions within a short time window and provides a score multiplier for streaks.

## Overview

- **Combo Window:** 3 seconds (default)
- **Max Multiplier:** 5x
- **Best Streak:** Tracks the highest streak per run

## Usage

```
import { ComboMeter } from './src/game/combo.js';

const combo = new ComboMeter();

// Register a stash action
const multiplier = combo.registerStash();
console.log(`Current multiplier: x${multiplier}`);

// Reset combo
combo.reset();
```

## API Reference

### `constructor(windowMs = 3000)`
- `windowMs` (number): Time window in milliseconds to count consecutive stashes (default: 3000).

### `registerStash(now = Date.now())`
- Registers a stash action.
- Returns: `number` — current multiplier.

### `multiplier()`
- Returns: `number` — current multiplier based on streak.

### `reset()`
- Resets the streak and timer.

## Motivation

Use the `ComboMeter` to reward players for making quick, consecutive stash actions. The multiplier increases with streaks, up to 5x, and resets if the window is missed.
