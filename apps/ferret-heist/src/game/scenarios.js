import { DEFAULT_LOOT_POSITIONS } from './loot.js';

export const SCENARIOS = {
  classic: {
    name: 'Classic',
    target: 5,
    human: { sweepSpeed: 0.02 },
    vacuum: { speed: 2.0 },
    loot: DEFAULT_LOOT_POSITIONS
  },
  laundry: {
    name: 'Laundry Day',
    target: 6,
    human: { sweepSpeed: 0.012 },
    vacuum: { speed: 1.5 },
    loot: [
      { type: 'sock', x: 300, y: 220 },
      { type: 'sock', x: 450, y: 250 },
      { type: 'slipper', x: 520, y: 330 },
      { type: 'sock', x: 360, y: 400 },
      { type: 'slipper', x: 640, y: 300 },
      { type: 'sock', x: 700, y: 420 },
      { type: 'sock', x: 200, y: 330 },
      { type: 'slipper', x: 620, y: 550 }
    ]
  },
  jewel: {
    name: 'Jewel Thief',
    target: 4,
    human: { sweepSpeed: 0.035 },
    vacuum: { speed: 3.2 },
    loot: [
      { type: 'ring', x: 560, y: 180 },
      { type: 'ring', x: 720, y: 260 },
      { type: 'keys', x: 450, y: 300 },
      { type: 'ring', x: 300, y: 380 },
      { type: 'keys', x: 680, y: 520 }
    ]
  }
};

export function parseScenario(text) {
  // Scenario text is user-controlled (it can come from a URL query string),
  // so it must never be executed as code. Quote unquoted object keys (a
  // convenience the UI/tests rely on) and parse the result as strict JSON
  // instead of using eval/Function.
  const jsonLike = text.replace(
    /([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g,
    '$1"$2"$3'
  );
  return JSON.parse(jsonLike);
}

// Returns true for any key that could be used to reach into or mutate the
// prototype chain (directly, e.g. "__proto__", or indirectly via
// "constructor"/"prototype"). Keys are compared with plain string literals
// rather than a Set/blocklist lookup so static analysis can recognise this
// as a sanitizing guard on every write below.
function isUnsafeKey(key) {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

export function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (isUnsafeKey(key)) continue;
    const value = source[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!Object.prototype.hasOwnProperty.call(target, key) || !target[key]) {
        Object.defineProperty(target, key, {
          value: {},
          writable: true,
          enumerable: true,
          configurable: true
        });
      }
      deepMerge(target[key], value);
    } else {
      Object.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  }
  return target;
}

export function buildScenario(text) {
  return deepMerge(SCENARIOS.classic, parseScenario(text));
}

export function resolveScenario(value) {
  if (!value) return SCENARIOS.classic;
  return SCENARIOS[value] || buildScenario(value);
}

function rate(value, low, high, [lowLabel, midLabel, highLabel]) {
  if (value < low) return lowLabel;
  if (value > high) return highLabel;
  return midLabel;
}

export function describeScenario(scenario) {
  return [
    {
      label: 'Loot goal',
      value: `${scenario.target} of ${scenario.loot.length}`
    },
    {
      label: 'Human',
      value: rate(scenario.human.sweepSpeed, 0.015, 0.025, [
        'Drowsy',
        'Watchful',
        'Alert'
      ])
    },
    {
      label: 'Roomba',
      value: rate(scenario.vacuum.speed, 1.8, 2.5, ['Slow', 'Normal', 'Fast'])
    }
  ];
}
