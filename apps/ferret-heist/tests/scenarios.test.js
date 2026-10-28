import { describe, it, expect } from 'vitest';
import {
  SCENARIOS,
  parseScenario,
  deepMerge,
  buildScenario,
  resolveScenario,
  describeScenario
} from '../src/game/scenarios.js';

describe('Heist scenarios', () => {
  it('ships Classic, Laundry Day and Jewel Thief scenarios', () => {
    expect(Object.keys(SCENARIOS)).toEqual(['classic', 'laundry', 'jewel']);
    for (const scenario of Object.values(SCENARIOS)) {
      expect(scenario.name).toBeTruthy();
      expect(scenario.loot.length).toBeGreaterThanOrEqual(scenario.target);
    }
  });

  it('parses scenarios written as JSON or with unquoted keys', () => {
    expect(parseScenario(JSON.stringify(SCENARIOS.jewel))).toEqual(
      SCENARIOS.jewel
    );
    expect(parseScenario('{ name: "Speed Run", target: 2 }')).toEqual({
      name: 'Speed Run',
      target: 2
    });
  });

  describe('deepMerge', () => {
    it('merges nested settings and replaces arrays', () => {
      const merged = deepMerge(
        { human: { sweepSpeed: 0.02 }, vacuum: { speed: 2 }, loot: [1, 2] },
        { human: { sweepSpeed: 0.05 }, loot: [3] }
      );
      expect(merged).toEqual({
        human: { sweepSpeed: 0.05 },
        vacuum: { speed: 2 },
        loot: [3]
      });
    });

    it('creates missing nested objects', () => {
      expect(deepMerge({}, { human: { sweepSpeed: 0.1 } })).toEqual({
        human: { sweepSpeed: 0.1 }
      });
    });
  });

  describe('resolveScenario', () => {
    it('uses the Classic scenario when nothing is linked', () => {
      expect(resolveScenario(null)).toBe(SCENARIOS.classic);
    });

    it('resolves scenario names', () => {
      expect(resolveScenario('laundry')).toBe(SCENARIOS.laundry);
    });

    it('builds custom scenarios on top of the Classic defaults', () => {
      const scenario = resolveScenario(
        '{ name: "Sock Storm", target: 2, vacuum: { speed: 4 } }'
      );
      expect(scenario.name).toBe('Sock Storm');
      expect(scenario.target).toBe(2);
      expect(scenario.vacuum.speed).toBe(4);
      expect(scenario.human.sweepSpeed).toBeGreaterThan(0);
      expect(scenario.loot.length).toBeGreaterThan(0);
    });
  });

  it('builds a scenario with its own loot layout', () => {
    const scenario = buildScenario(
      JSON.stringify({
        name: 'Ring Rush',
        loot: [{ type: 'ring', x: 400, y: 300 }]
      })
    );
    expect(scenario.name).toBe('Ring Rush');
    expect(scenario.loot).toEqual([{ type: 'ring', x: 400, y: 300 }]);
  });

  describe('describeScenario', () => {
    const summary = (scenario) =>
      Object.fromEntries(
        describeScenario(scenario).map(({ label, value }) => [label, value])
      );

    it('summarises an easy scenario', () => {
      expect(summary(SCENARIOS.laundry)).toEqual({
        'Loot goal': '6 of 8',
        Human: 'Drowsy',
        Roomba: 'Slow'
      });
    });

    it('summarises a normal scenario', () => {
      expect(
        summary({
          target: 5,
          loot: [1, 2, 3, 4, 5, 6],
          human: { sweepSpeed: 0.02 },
          vacuum: { speed: 2 }
        })
      ).toEqual({ 'Loot goal': '5 of 6', Human: 'Watchful', Roomba: 'Normal' });
    });

    it('summarises a hard scenario', () => {
      expect(summary(SCENARIOS.jewel)).toEqual({
        'Loot goal': '4 of 5',
        Human: 'Alert',
        Roomba: 'Fast'
      });
    });
  });
});
