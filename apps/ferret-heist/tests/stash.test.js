import { describe, it, expect } from 'vitest';
import { Stash } from '../src/game/stash.js';
import { Loot } from '../src/game/loot.js';
import { COUCH } from '../src/game/constants.js';

describe('Couch Stash Management', () => {
  it('correctly identifies coordinates under the couch', () => {
    const stash = new Stash(5);
    expect(stash.isUnderCouch(COUCH.x + 10, COUCH.y + 10)).toBe(true);
    expect(stash.isUnderCouch(500, 500)).toBe(false);
  });

  it('deposits loot items and calculates combo score', () => {
    const stash = new Stash(3);
    const sock = new Loot('1', 'sock', 100, 100);
    const earned1 = stash.deposit(sock);

    expect(earned1).toBe(sock.points);
    expect(stash.stashedItems.length).toBe(1);
    expect(sock.isStashed).toBe(true);
    expect(sock.isCarried).toBe(false);

    // Second deposit earns combo bonus
    const keys = new Loot('2', 'keys', 100, 100);
    const earned2 = stash.deposit(keys);
    expect(earned2).toBeGreaterThanOrEqual(keys.points);
    expect(stash.totalScore).toBe(earned1 + earned2);
  });

  it('tracks level clear condition when target reached', () => {
    const stash = new Stash(2);
    expect(stash.isCleared()).toBe(false);

    stash.deposit(new Loot('1', 'sock', 0, 0));
    expect(stash.isCleared()).toBe(false);

    stash.deposit(new Loot('2', 'remote', 0, 0));
    expect(stash.isCleared()).toBe(true);
  });

  it('produces summary overview', () => {
    const stash = new Stash(2);
    stash.deposit(new Loot('1', 'sock', 0, 0));
    const summary = stash.getSummary();

    expect(summary.count).toBe(1);
    expect(summary.target).toBe(2);
    expect(summary.score).toBeGreaterThan(0);
    expect(summary.items.length).toBe(1);
  });
});
