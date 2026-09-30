import { CANVAS_WIDTH, CANVAS_HEIGHT, COUCH, CHAIR } from './constants.js';

export class Vacuum {
  constructor(x = 400, y = 300) {
    this.x = x;
    this.y = y;
    this.radius = 24;
    this.speed = 2.0;
    this.angle = Math.PI / 4;
    this.isStunned = false;
    this.stunTimer = 0;
  }

  stun(duration = 180) {
    this.isStunned = true;
    this.stunTimer = duration;
  }

  collidesWith(target, targetRadius = 16) {
    const dist = Math.hypot(this.x - target.x, this.y - target.y);
    return dist <= this.radius + targetRadius;
  }

  update(dt = 1) {
    if (this.isStunned) {
      this.stunTimer -= dt;
      if (this.stunTimer <= 0) {
        this.isStunned = false;
      }
      return;
    }

    let nextX = this.x + Math.cos(this.angle) * this.speed * dt;
    let nextY = this.y + Math.sin(this.angle) * this.speed * dt;

    let hit = false;

    // Room boundaries
    const margin = this.radius + 15;
    if (nextX < margin || nextX > CANVAS_WIDTH - margin) {
      this.angle = Math.PI - this.angle;
      hit = true;
    }
    if (nextY < margin || nextY > CANVAS_HEIGHT - margin) {
      this.angle = -this.angle;
      hit = true;
    }

    // Couch collision
    if (
      nextX + this.radius > COUCH.x &&
      nextX - this.radius < COUCH.x + COUCH.width &&
      nextY + this.radius > COUCH.y &&
      nextY - this.radius < COUCH.y + COUCH.height
    ) {
      this.angle += Math.PI * 0.75;
      hit = true;
    }

    // Chair collision
    if (
      nextX + this.radius > CHAIR.x &&
      nextX - this.radius < CHAIR.x + CHAIR.width &&
      nextY + this.radius > CHAIR.y &&
      nextY - this.radius < CHAIR.y + CHAIR.height
    ) {
      this.angle += Math.PI * 0.75;
      hit = true;
    }

    if (hit) {
      // Add slight jitter to prevent infinite bouncing
      this.angle += (Math.random() - 0.5) * 0.4;
    } else {
      this.x = nextX;
      this.y = nextY;
    }
  }
}
