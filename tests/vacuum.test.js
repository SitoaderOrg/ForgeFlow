import { describe, it, expect } from 'vitest';
import { Vacuum } from '../apps/ferret-heist/src/game/vacuum.js';

describe('Robotic Vacuum (Roomba)', () => {
  it('initializes with position, speed and not stunned', () => {
    const vacuum = new Vacuum(400, 300);
    expect(vacuum.x).toBe(400);
    expect(vacuum.y).toBe(300);
    expect(vacuum.isStunned).toBe(false);
    expect(vacuum.radius).toBe(24);
  });

  it('can be stunned and recovers after duration', () => {
    const vacuum = new Vacuum();
    vacuum.stun(10);
    expect(vacuum.isStunned).toBe(true);

    vacuum.update(5);
    expect(vacuum.isStunned).toBe(true);

    vacuum.update(6);
    expect(vacuum.isStunned).toBe(false);
  });

  it('detects collision with targets', () => {
    const vacuum = new Vacuum(100, 100);
    expect(vacuum.collidesWith({ x: 120, y: 100 }, 16)).toBe(true);
    expect(vacuum.collidesWith({ x: 200, y: 200 }, 16)).toBe(false);
  });

  it('moves on update and bounces off room margins', () => {
    const vacuum = new Vacuum(400, 300);
    const startX = vacuum.x;
    const startY = vacuum.y;

    vacuum.update(1);
    expect(vacuum.x !== startX || vacuum.y !== startY).toBe(true);
  });

  it('bounces when encountering couch or chair', () => {
    // Near couch
    const vacuumCouch = new Vacuum(50, 460);
    vacuumCouch.angle = 0;
    vacuumCouch.update(1);
    expect(vacuumCouch.angle).not.toBe(0);

    // Near chair
    const vacuumChair = new Vacuum(630, 90);
    vacuumChair.angle = 0;
    vacuumChair.update(1);
    expect(vacuumChair.angle).not.toBe(0);
  });
});
