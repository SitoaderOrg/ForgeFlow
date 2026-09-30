import { HUMAN_STATES } from './constants.js';

export class Human {
  constructor(x = 680, y = 140) {
    this.x = x;
    this.y = y;
    this.state = HUMAN_STATES.SLEEPING;
    this.stateTimer = 0;
    this.angle = Math.PI; // Looking left into room
    this.sweepSpeed = 0.02;
    this.sweepDir = 1;
    this.minSweep = Math.PI * 0.75;
    this.maxSweep = Math.PI * 1.35;
    this.snoreTimer = 0;
  }

  getVisionConfig() {
    switch (this.state) {
      case HUMAN_STATES.SLEEPING:
        return { distance: 60, fov: Math.PI * 0.25 };
      case HUMAN_STATES.SUSPICIOUS:
        return { distance: 200, fov: Math.PI * 0.45 };
      case HUMAN_STATES.AWAKE:
        return { distance: 340, fov: Math.PI * 0.65 };
      case HUMAN_STATES.SNOOZING:
      default:
        return { distance: 90, fov: Math.PI * 0.3 };
    }
  }

  isFerretInVision(ferret) {
    if (ferret.isHiding) return false;

    const dx = ferret.x - this.x;
    const dy = ferret.y - this.y;
    const dist = Math.hypot(dx, dy);

    const { distance, fov } = this.getVisionConfig();
    if (dist > distance) return false;

    // Angle from human to ferret
    const targetAngle = Math.atan2(dy, dx);
    let diff = Math.abs(targetAngle - this.angle);

    // Normalize angle difference to [0, PI]
    while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);

    return diff <= fov / 2;
  }

  alert(level = HUMAN_STATES.SUSPICIOUS) {
    if (this.state === HUMAN_STATES.AWAKE && level === HUMAN_STATES.SUSPICIOUS) {
      return;
    }
    this.state = level;
    this.stateTimer = 0;
  }

  update(ferret, dt = 1) {
    this.stateTimer += dt;
    this.snoreTimer += dt * 0.05;

    // Check noise from carried keys
    if (
      ferret.carriedItem &&
      ferret.carriedItem.noise > 0 &&
      (ferret.vx !== 0 || ferret.vy !== 0)
    ) {
      const dist = Math.hypot(ferret.x - this.x, ferret.y - this.y);
      if (dist < 260 && this.state === HUMAN_STATES.SLEEPING) {
        this.alert(HUMAN_STATES.SUSPICIOUS);
      }
    }

    // State machine transitions
    switch (this.state) {
      case HUMAN_STATES.SLEEPING:
        // Wake up periodically
        if (this.stateTimer > 350) {
          this.state = HUMAN_STATES.SUSPICIOUS;
          this.stateTimer = 0;
        }
        break;

      case HUMAN_STATES.SUSPICIOUS:
        // Sweep gaze back and forth
        this.angle += this.sweepSpeed * this.sweepDir * dt;
        if (this.angle > this.maxSweep) {
          this.angle = this.maxSweep;
          this.sweepDir = -1;
        } else if (this.angle < this.minSweep) {
          this.angle = this.minSweep;
          this.sweepDir = 1;
        }

        if (this.isFerretInVision(ferret)) {
          this.state = HUMAN_STATES.AWAKE;
          this.stateTimer = 0;
        } else if (this.stateTimer > 200) {
          this.state = HUMAN_STATES.SNOOZING;
          this.stateTimer = 0;
        }
        break;

      case HUMAN_STATES.AWAKE:
        this.angle += this.sweepSpeed * 1.8 * this.sweepDir * dt;
        if (this.angle > this.maxSweep) {
          this.angle = this.maxSweep;
          this.sweepDir = -1;
        } else if (this.angle < this.minSweep) {
          this.angle = this.minSweep;
          this.sweepDir = 1;
        }

        if (this.stateTimer > 250) {
          this.state = HUMAN_STATES.SNOOZING;
          this.stateTimer = 0;
        }
        break;

      case HUMAN_STATES.SNOOZING:
        if (this.stateTimer > 100) {
          this.state = HUMAN_STATES.SLEEPING;
          this.stateTimer = 0;
          this.angle = Math.PI;
        }
        break;
    }

    return this.isFerretInVision(ferret) && this.state === HUMAN_STATES.AWAKE;
  }
}
