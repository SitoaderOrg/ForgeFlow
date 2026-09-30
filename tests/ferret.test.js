import { describe, it, expect } from 'vitest';
import { Ferret } from '../apps/ferret-heist/src/game/ferret.js';
import { Loot } from '../apps/ferret-heist/src/game/loot.js';
import { FERRET_CONFIG } from '../apps/ferret-heist/src/game/constants.js';

describe('Ferret Model & Mechanics', () => {
  it('initializes with default coordinates and full dance meter', () => {
    const ferret = new Ferret(100, 200);
    expect(ferret.x).toBe(100);
    expect(ferret.y).toBe(200);
    expect(ferret.carriedItem).toBeNull();
    expect(ferret.danceMeter).toBe(FERRET_CONFIG.maxDanceMeter);
    expect(ferret.isDancing).toBe(false);
    expect(ferret.isHiding).toBe(false);
  });

  it('can pick up an item when mouth is empty and not dancing', () => {
    const ferret = new Ferret();
    const sock = new Loot('1', 'sock', 100, 100);
    expect(ferret.canPickUp()).toBe(true);

    const picked = ferret.pickUp(sock);
    expect(picked).toBe(true);
    expect(ferret.carriedItem).toBe(sock);
    expect(sock.isCarried).toBe(true);

    // Cannot pick up second item while carrying one
    const keys = new Loot('2', 'keys', 100, 100);
    expect(ferret.canPickUp()).toBe(false);
    expect(ferret.pickUp(keys)).toBe(false);
  });

  it('can drop carried item', () => {
    const ferret = new Ferret(150, 250);
    const sock = new Loot('1', 'sock', 100, 100);
    ferret.pickUp(sock);

    const dropped = ferret.dropItem();
    expect(dropped).toBe(sock);
    expect(dropped.isCarried).toBe(false);
    expect(dropped.x).toBe(150);
    expect(dropped.y).toBe(250);
    expect(ferret.carriedItem).toBeNull();

    // Dropping when empty returns null
    expect(ferret.dropItem()).toBeNull();
  });

  it('applies speed penalties according to carried item weight', () => {
    const ferret = new Ferret();
    const baseSpeed = ferret.getEffectiveSpeed();
    expect(baseSpeed).toBe(FERRET_CONFIG.baseSpeed);

    const heavyRemote = new Loot('1', 'remote', 100, 100);
    ferret.pickUp(heavyRemote);
    expect(ferret.getEffectiveSpeed()).toBeLessThan(baseSpeed);
  });

  it('handles Weasel War Dance activation, speed boost, and draining', () => {
    const ferret = new Ferret();
    expect(ferret.triggerWarDance()).toBe(true);
    expect(ferret.isDancing).toBe(true);
    expect(ferret.getEffectiveSpeed()).toBe(FERRET_CONFIG.danceSpeed);

    // Cannot pick up items while doing war dance
    expect(ferret.canPickUp()).toBe(false);

    // Update with dt to drain meter
    ferret.update({}, 10);
    expect(ferret.danceMeter).toBeLessThan(FERRET_CONFIG.maxDanceMeter);

    // Stop war dance
    ferret.stopWarDance();
    expect(ferret.isDancing).toBe(false);
  });

  it('detects hiding under the couch and inside cardboard boxes', () => {
    const ferret = new Ferret(100, 500); // Couch is at (40, 450, 220, 120)
    expect(ferret.checkHiding()).toBe(true);
    expect(ferret.isHiding).toBe(true);

    // Move to open floor
    ferret.x = 400;
    ferret.y = 300;
    expect(ferret.checkHiding()).toBe(false);
    expect(ferret.isHiding).toBe(false);

    // Move inside cardboard box (340, 100, 90, 70)
    ferret.x = 360;
    ferret.y = 120;
    expect(ferret.checkHiding()).toBe(true);
    expect(ferret.isHiding).toBe(true);
  });

  it('updates position and clamps within canvas boundaries', () => {
    const ferret = new Ferret(100, 100);
    ferret.update({ ArrowRight: true }, 2);
    expect(ferret.x).toBeGreaterThan(100);

    // Extreme left
    ferret.update({ ArrowLeft: true }, 500);
    expect(ferret.x).toBeGreaterThanOrEqual(20);
  });
});
