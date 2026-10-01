import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  FERRET_CONFIG,
  HIDING_BOXES,
  COUCH
} from './constants.js';

export class Ferret {
  constructor(x = 100, y = 500) {
    this.x = x;
    this.y = y;
    this.angle = 0;
    this.vx = 0;
    this.vy = 0;
    this.carriedItem = null;
    this.danceMeter = FERRET_CONFIG.maxDanceMeter;
    this.isDancing = false;
    this.isHiding = false;
    this.size = FERRET_CONFIG.size;
    this.history = [];
    this.danceZigZagTimer = 0;
    this.danceZigZagOffset = 0;

    for (let i = 0; i < 20; i++) {
      this.history.push({ x: this.x, y: this.y, angle: this.angle });
    }
  }

  canPickUp() {
    return this.carriedItem === null && !this.isDancing;
  }

  pickUp(item) {
    if (!this.canPickUp()) return false;
    this.carriedItem = item;
    item.isCarried = true;
    return true;
  }

  dropItem() {
    if (!this.carriedItem) return null;
    const dropped = this.carriedItem;
    dropped.isCarried = false;
    dropped.x = this.x;
    dropped.y = this.y;
    this.carriedItem = null;
    return dropped;
  }

  getEffectiveSpeed(speedBonus = 1.0) {
    let speed = this.isDancing
      ? FERRET_CONFIG.danceSpeed
      : FERRET_CONFIG.baseSpeed;

    speed *= speedBonus;

    if (this.carriedItem) {
      speed *= this.carriedItem.speedMultiplier || 0.9;
    }

    return speed;
  }

  triggerWarDance() {
    if (this.danceMeter >= 25 && !this.isDancing) {
      this.isDancing = true;
      return true;
    }
    return false;
  }

  stopWarDance() {
    this.isDancing = false;
  }

  checkHiding(boxes = HIDING_BOXES, couch = COUCH) {
    // Check if under couch
    if (
      this.x >= couch.x &&
      this.x <= couch.x + couch.width &&
      this.y >= couch.y &&
      this.y <= couch.y + couch.height
    ) {
      this.isHiding = true;
      return true;
    }

    // Check if in hiding boxes
    for (const box of boxes) {
      if (
        this.x >= box.x &&
        this.x <= box.x + box.width &&
        this.y >= box.y &&
        this.y <= box.y + box.height
      ) {
        this.isHiding = true;
        return true;
      }
    }

    this.isHiding = false;
    return false;
  }

  update(keys = {}, dt = 1, speedBonus = 1.0) {
    let dx = 0;
    let dy = 0;

    if (keys.ArrowUp || keys.KeyW) dy -= 1;
    if (keys.ArrowDown || keys.KeyS) dy += 1;
    if (keys.ArrowLeft || keys.KeyA) dx -= 1;
    if (keys.ArrowRight || keys.KeyD) dx += 1;

    // Handle War Dance activation
    if (keys.Space) {
      this.triggerWarDance();
    }

    // Dance meter handling
    if (this.isDancing) {
      this.danceMeter -= FERRET_CONFIG.danceDrainRate * dt;
      if (this.danceMeter <= 0) {
        this.danceMeter = 0;
        this.stopWarDance();
      }

      // Add silly chaotic twitch to movement
      this.danceZigZagTimer += dt * 0.3;
      this.danceZigZagOffset = Math.sin(this.danceZigZagTimer * 10) * 1.5;
    } else {
      if (this.danceMeter < FERRET_CONFIG.maxDanceMeter) {
        this.danceMeter = Math.min(
          FERRET_CONFIG.maxDanceMeter,
          this.danceMeter + FERRET_CONFIG.danceRechargeRate * dt
        );
      }
    }

    const currentSpeed = this.getEffectiveSpeed(speedBonus);

    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;

      if (this.isDancing) {
        // Skitter sideways like a ferret weasel war dance!
        const normalX = -dy;
        const normalY = dx;
        dx += normalX * this.danceZigZagOffset;
        dy += normalY * this.danceZigZagOffset;
      }

      this.vx = dx * currentSpeed;
      this.vy = dy * currentSpeed;
      this.angle = Math.atan2(this.vy, this.vx);

      this.x += this.vx * dt;
      this.y += this.vy * dt;

      // Keep within canvas walls with margin
      const margin = 20;
      this.x = Math.max(margin, Math.min(CANVAS_WIDTH - margin, this.x));
      this.y = Math.max(margin, Math.min(CANVAS_HEIGHT - margin, this.y));

      // Append to noodle trail history
      this.history.unshift({ x: this.x, y: this.y, angle: this.angle });
      if (this.history.length > 25) {
        this.history.pop();
      }
    } else {
      this.vx = 0;
      this.vy = 0;
    }

    this.checkHiding();

    if (this.carriedItem) {
      this.carriedItem.x = this.x;
      this.carriedItem.y = this.y;
    }
  }
}
