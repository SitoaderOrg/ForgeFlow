import { describe, it, expect } from 'vitest';
import { Loot, generateLootList } from '../src/game/loot.js';

describe('Loot System', () => {
  it('correctly creates loot instances from type config', () => {
    const sock = new Loot('l1', 'sock', 200, 300);
    expect(sock.id).toBe('l1');
    expect(sock.type).toBe('sock');
    expect(sock.points).toBe(15);
    expect(sock.isCarried).toBe(false);
    expect(sock.isStashed).toBe(false);
  });

  it('calculates distance to coordinates', () => {
    const loot = new Loot('l2', 'keys', 100, 100);
    expect(loot.getDistanceTo(100, 100)).toBe(0);
    expect(loot.getDistanceTo(103, 104)).toBe(5);
  });

  it('determines if player is nearby for pickup', () => {
    const loot = new Loot('l3', 'ring', 100, 100);
    expect(loot.isNearby(110, 100, 20)).toBe(true);
    expect(loot.isNearby(200, 200, 20)).toBe(false);

    // If carried or stashed, isNearby should be false
    loot.isCarried = true;
    expect(loot.isNearby(100, 100, 20)).toBe(false);

    loot.isCarried = false;
    loot.isStashed = true;
    expect(loot.isNearby(100, 100, 20)).toBe(false);
  });

  it('generates predefined list of items', () => {
    const list = generateLootList();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(5);
    expect(list.some((item) => item.type === 'keys')).toBe(true);
    expect(list.some((item) => item.type === 'sock')).toBe(true);
  });
});
