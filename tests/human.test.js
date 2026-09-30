import { describe, it, expect } from 'vitest';
import { Human } from '../apps/ferret-heist/src/game/human.js';
import { Ferret } from '../apps/ferret-heist/src/game/ferret.js';
import { Loot } from '../apps/ferret-heist/src/game/loot.js';
import { HUMAN_STATES } from '../apps/ferret-heist/src/game/constants.js';

describe('Human AI & Awareness Cycle', () => {
  it('starts in SLEEPING state looking left into room', () => {
    const human = new Human(680, 140);
    expect(human.state).toBe(HUMAN_STATES.SLEEPING);
    expect(human.angle).toBeCloseTo(Math.PI);
  });

  it('adjusts vision distance and field of view per state', () => {
    const human = new Human();
    const sleepVision = human.getVisionConfig();
    human.state = HUMAN_STATES.AWAKE;
    const awakeVision = human.getVisionConfig();

    expect(awakeVision.distance).toBeGreaterThan(sleepVision.distance);
    expect(awakeVision.fov).toBeGreaterThan(sleepVision.fov);
  });

  it('ignores ferret when ferret is hiding', () => {
    const human = new Human(680, 140);
    human.state = HUMAN_STATES.AWAKE;
    const ferret = new Ferret(550, 140);
    ferret.isHiding = true;

    expect(human.isFerretInVision(ferret)).toBe(false);
  });

  it('detects ferret directly in line of sight when awake', () => {
    const human = new Human(680, 140);
    human.state = HUMAN_STATES.AWAKE;
    human.angle = Math.PI; // Looking directly left (-X)

    const ferret = new Ferret(550, 140); // 130px to the left
    ferret.isHiding = false;

    expect(human.isFerretInVision(ferret)).toBe(true);

    // If ferret is behind human (e.g. x: 750), not in vision
    ferret.x = 750;
    expect(human.isFerretInVision(ferret)).toBe(false);
  });

  it('becomes suspicious when hearing noisy keys being carried', () => {
    const human = new Human(680, 140);
    // Ferret is within hearing range (dist ~240px) but outside human vision angle
    const ferret = new Ferret(550, 340);
    const keys = new Loot('k', 'keys', 550, 340);
    ferret.pickUp(keys);
    ferret.vx = 2; // Moving

    expect(human.state).toBe(HUMAN_STATES.SLEEPING);
    human.update(ferret, 1);
    expect(human.state).toBe(HUMAN_STATES.SUSPICIOUS);
  });

  it('progresses through state transitions over time', () => {
    const human = new Human(680, 140);
    const ferret = new Ferret(100, 500); // Far away

    // Long update while sleeping triggers suspicious
    human.update(ferret, 400);
    expect(human.state).toBe(HUMAN_STATES.SUSPICIOUS);

    // Suspicious times out to snoozing
    human.update(ferret, 250);
    expect(human.state).toBe(HUMAN_STATES.SNOOZING);

    // Snoozing times out to sleeping
    human.update(ferret, 150);
    expect(human.state).toBe(HUMAN_STATES.SLEEPING);
  });
});
