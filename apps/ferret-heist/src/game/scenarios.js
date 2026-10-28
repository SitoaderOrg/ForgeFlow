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

// Keys that could be used to pollute the prototype chain when merging
// attacker-controlled scenario objects into our defaults.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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

export function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    const value = source[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!Object.prototype.hasOwnProperty.call(target, key) || !target[key]) {
        target[key] = {};
      }
      deepMerge(target[key], value);
    } else {
      target[key] = value;
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
