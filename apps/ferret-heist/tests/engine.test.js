import { describe, it, expect, vi } from 'vitest';
import { GameEngine } from '../src/game/engine.js';
import { GAME_STATES } from '../src/game/constants.js';

describe('Game Engine & Loop Orchestration', () => {
  it('initializes in MENU state', () => {
    const engine = new GameEngine();
    expect(engine.state).toBe(GAME_STATES.MENU);
    expect(engine.ferret).toBeDefined();
    expect(engine.human).toBeDefined();
    expect(engine.vacuum).toBeDefined();
    expect(engine.stash).toBeDefined();
    expect(engine.lootList.length).toBeGreaterThan(0);
  });

  it('starts and transitions to PLAYING state', () => {
    const onEvent = vi.fn();
    const engine = new GameEngine({ onEvent });
    engine.start();

    expect(engine.state).toBe(GAME_STATES.PLAYING);
    expect(onEvent).toHaveBeenCalledWith('start');

    // Test restart
    engine.restart();
    expect(engine.state).toBe(GAME_STATES.PLAYING);
    expect(engine.caughtCount).toBe(0);
    expect(onEvent).toHaveBeenCalledWith('restart');
  });

  it('toggles pause state', () => {
    const engine = new GameEngine();
    engine.start();
    engine.pause();
    expect(engine.state).toBe(GAME_STATES.PAUSED);

    engine.pause();
    expect(engine.state).toBe(GAME_STATES.PLAYING);
  });

  it('picks up loot when ferret steps on it', () => {
    const onEvent = vi.fn();
    const engine = new GameEngine({ onEvent });
    engine.start();

    const targetLoot = engine.lootList[0];
    engine.ferret.x = targetLoot.x;
    engine.ferret.y = targetLoot.y;

    engine.tick({}, 1);

    expect(engine.ferret.carriedItem).toBe(targetLoot);
    expect(onEvent).toHaveBeenCalledWith('pickup', targetLoot);
  });

  it('deposits carried item when moving under couch', () => {
    const onEvent = vi.fn();
    const engine = new GameEngine({ onEvent });
    engine.start();

    const targetLoot = engine.lootList[0];
    engine.ferret.pickUp(targetLoot);

    // Place ferret under couch (40, 450)
    engine.ferret.x = 80;
    engine.ferret.y = 480;

    engine.tick({}, 1);

    expect(engine.ferret.carriedItem).toBeNull();
    expect(engine.stash.stashedItems.length).toBe(1);
    expect(onEvent).toHaveBeenCalledWith(
      'deposit',
      expect.objectContaining({ item: targetLoot })
    );
  });

  it('stuns vacuum when ferret collides while doing war dance', () => {
    const onEvent = vi.fn();
    const engine = new GameEngine({ onEvent });
    engine.start();

    engine.ferret.triggerWarDance();
    engine.ferret.x = 300;
    engine.ferret.y = 300;
    engine.vacuum.x = 300;
    engine.vacuum.y = 300;

    engine.tick({}, 1);

    expect(engine.vacuum.isStunned).toBe(true);
    expect(onEvent).toHaveBeenCalledWith('stun_vacuum');
  });

  it('drops item and alerts human when colliding with vacuum normally', () => {
    const onEvent = vi.fn();
    const engine = new GameEngine({ onEvent });
    engine.start();

    const sock = engine.lootList[0];
    engine.ferret.pickUp(sock);
    engine.ferret.isDancing = false;

    engine.ferret.x = 300;
    engine.ferret.y = 300;
    engine.vacuum.x = 300;
    engine.vacuum.y = 300;

    engine.tick({}, 1);

    expect(engine.ferret.carriedItem).toBeNull();
    expect(sock.isCarried).toBe(false);
    expect(onEvent).toHaveBeenCalledWith('bump');
  });

  it('handles caught condition and triggers game over after 3 strikes', () => {
    const onEvent = vi.fn();
    const engine = new GameEngine({ onEvent });
    engine.start();

    // Force human into awake state pointing directly at ferret
    engine.human.state = 'AWAKE';
    engine.human.angle = Math.PI;
    engine.human.x = 400;
    engine.human.y = 300;

    engine.ferret.x = 300;
    engine.ferret.y = 300;
    engine.ferret.isHiding = false;

    // Strike 1
    engine.tick({}, 1);
    expect(engine.caughtCount).toBe(1);

    // Strike 2
    engine.ferret.x = 300;
    engine.ferret.y = 300;
    engine.tick({}, 1);
    expect(engine.caughtCount).toBe(2);

    // Strike 3 -> Game Over
    engine.ferret.x = 300;
    engine.ferret.y = 300;
    engine.tick({}, 1);
    expect(engine.caughtCount).toBe(3);
    expect(engine.state).toBe(GAME_STATES.CAUGHT);
    expect(onEvent).toHaveBeenCalledWith('gameover');
  });

  it('triggers victory when stash reaches target count', () => {
    const onEvent = vi.fn();
    const engine = new GameEngine({ onEvent });
    engine.start();

    // Target is 5, manually deposit 4 items
    for (let i = 0; i < 4; i++) {
      engine.stash.deposit(engine.lootList[i]);
    }

    // Ferret carries 5th item to couch
    engine.ferret.pickUp(engine.lootList[4]);
    engine.ferret.x = 80;
    engine.ferret.y = 480;

    engine.tick({}, 1);

    expect(engine.state).toBe(GAME_STATES.LEVEL_CLEARED);
    expect(onEvent).toHaveBeenCalledWith('victory');
  });
});
