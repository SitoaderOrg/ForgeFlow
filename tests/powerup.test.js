import { describe, it, expect } from 'vitest';
import { PowerUp, PowerUpManager, POWERUP_TYPES } from '../apps/ferret-heist/src/game/powerup.js';
import { Ferret } from '../apps/ferret-heist/src/game/ferret.js';
import { Loot } from '../apps/ferret-heist/src/game/loot.js';

describe('PowerUp & Treat Manager', () => {
  it('instantiates a power-up with correct attributes', () => {
    const powerUp = new PowerUp(100, 100, 'SPEEDY_SNACK');
    expect(powerUp.type).toBe('SPEEDY_SNACK');
    expect(powerUp.speedMultiplier).toBe(1.45);
    expect(powerUp.isNearby(105, 105, 20)).toBe(true);
    expect(powerUp.isNearby(200, 200, 20)).toBe(false);

    const buff = powerUp.collect();
    expect(buff.type).toBe('SPEEDY_SNACK');
    expect(powerUp.isCollected).toBe(true);
    expect(powerUp.isNearby(100, 100)).toBe(false);
  });

  it('spawns and collects power-ups in manager', () => {
    const manager = new PowerUpManager({ spawnInterval: 100 });
    const spawned = manager.spawnPowerUp(150, 150, 'STEALTH_CHEESE');
    expect(manager.activePowerUps).toHaveLength(1);
    expect(spawned.type).toBe('STEALTH_CHEESE');

    // Collect powerup
    const collectedBuff = manager.collectAt(152, 152, 20);
    expect(collectedBuff).not.toBeNull();
    expect(collectedBuff.type).toBe('STEALTH_CHEESE');
    expect(manager.isStealthActive()).toBe(true);
    expect(manager.activePowerUps).toHaveLength(0);
  });

  it('stacks or refreshes existing buffs', () => {
    const manager = new PowerUpManager();
    manager.addBuff({
      type: 'SPEEDY_SNACK',
      duration: 200,
      speedMultiplier: 1.5
    });
    expect(manager.getSpeedMultiplier()).toBe(1.5);

    // Refresh with higher duration
    manager.addBuff({
      type: 'SPEEDY_SNACK',
      duration: 350,
      speedMultiplier: 1.5
    });
    expect(manager.getActiveBuffs()[0].remainingDuration).toBe(350);
  });

  it('ticks buff durations and removes expired buffs', () => {
    const manager = new PowerUpManager({ spawnInterval: 9999 });
    manager.addBuff({
      type: 'SPEEDY_SNACK',
      duration: 10,
      speedMultiplier: 1.5
    });

    manager.update(5);
    expect(manager.getActiveBuffs()).toHaveLength(1);

    manager.update(6);
    expect(manager.getActiveBuffs()).toHaveLength(0);
    expect(manager.getSpeedMultiplier()).toBe(1.0);
  });

  it('pulls nearby loot items when magnet powerup is active', () => {
    const manager = new PowerUpManager({ spawnInterval: 9999 });
    manager.addBuff({
      type: 'MAGNET_SNOOT',
      duration: 100,
      magnetRadius: 150,
      magnetPullForce: 5
    });

    const ferret = new Ferret(200, 200);
    const loot = new Loot('loot-sock', 'sock', 250, 200);
    const initialDistance = Math.hypot(ferret.x - loot.x, ferret.y - loot.y);

    manager.update(1, ferret, [loot]);

    const newDistance = Math.hypot(ferret.x - loot.x, ferret.y - loot.y);
    expect(newDistance).toBeLessThan(initialDistance);
  });

  it('resets manager state', () => {
    const manager = new PowerUpManager();
    manager.spawnPowerUp(100, 100);
    manager.addBuff({ type: 'SPEEDY_SNACK', duration: 100 });
    manager.reset();

    expect(manager.activePowerUps).toHaveLength(0);
    expect(manager.getActiveBuffs()).toHaveLength(0);
  });
});
