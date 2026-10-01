import _ from 'lodash';

export const POWERUP_TYPES = {
  SPEEDY_SNACK: {
    type: 'SPEEDY_SNACK',
    name: 'Salmon Paste Tube',
    emoji: '🐟',
    duration: 360,
    speedMultiplier: 1.45,
    description: 'Ferret gets an instant zoomies boost with 45% increased movement speed!'
  },
  STEALTH_CHEESE: {
    type: 'STEALTH_CHEESE',
    name: 'Stinky Cheese Crumb',
    emoji: '🧀',
    duration: 300,
    stealthMask: true,
    description: 'Smells so pungent the human cannot spot the ferret even in direct line of sight!'
  },
  MAGNET_SNOOT: {
    type: 'MAGNET_SNOOT',
    name: 'Squeaky Toy Crumb',
    emoji: '🧸',
    duration: 420,
    magnetRadius: 160,
    magnetPullForce: 3.5,
    description: 'Magnetic ferret charm pulls nearby loot items directly toward the ferret!'
  }
};

export class PowerUp {
  constructor(x, y, typeKey) {
    const config = POWERUP_TYPES[typeKey] || POWERUP_TYPES.SPEEDY_SNACK;
    this.x = x;
    this.y = y;
    this.type = config.type;
    this.name = config.name;
    this.emoji = config.emoji;
    this.duration = config.duration;
    this.speedMultiplier = config.speedMultiplier || 1.0;
    this.stealthMask = Boolean(config.stealthMask);
    this.magnetRadius = config.magnetRadius || 0;
    this.magnetPullForce = config.magnetPullForce || 0;
    this.description = config.description;
    this.isCollected = false;
  }

  isNearby(x, y, radius = 24) {
    if (this.isCollected) return false;
    const dx = this.x - x;
    const dy = this.y - y;
    return Math.sqrt(dx * dx + dy * dy) <= radius;
  }

  collect() {
    this.isCollected = true;
    return {
      type: this.type,
      name: this.name,
      emoji: this.emoji,
      duration: this.duration,
      speedMultiplier: this.speedMultiplier,
      stealthMask: this.stealthMask,
      magnetRadius: this.magnetRadius,
      magnetPullForce: this.magnetPullForce
    };
  }
}

export class PowerUpManager {
  constructor(options = {}) {
    this.activePowerUps = [];
    this.activeBuffs = [];
    this.spawnTimer = options.spawnInterval || 400;
    this.spawnInterval = options.spawnInterval || 600;
    this.maxActive = options.maxActive || 3;
    this.spawnZones = options.spawnZones || [
      { x: 180, y: 150 },
      { x: 420, y: 280 },
      { x: 680, y: 380 },
      { x: 300, y: 440 },
      { x: 550, y: 120 }
    ];
  }

  spawnPowerUp(x, y, typeKey) {
    const selectedKey = typeKey || _.sample(Object.keys(POWERUP_TYPES));
    const powerUp = new PowerUp(x, y, selectedKey);
    this.activePowerUps.push(powerUp);
    return powerUp;
  }

  collectAt(x, y, radius = 24) {
    for (const powerUp of this.activePowerUps) {
      if (powerUp.isNearby(x, y, radius)) {
        const buff = powerUp.collect();
        this.addBuff(buff);
        this.activePowerUps = this.activePowerUps.filter(p => !p.isCollected);
        return buff;
      }
    }
    return null;
  }

  addBuff(buff) {
    const existing = this.activeBuffs.find(b => b.type === buff.type);
    if (existing) {
      existing.remainingDuration = Math.max(existing.remainingDuration, buff.duration);
    } else {
      this.activeBuffs.push({
        ..._.cloneDeep(buff),
        remainingDuration: buff.duration
      });
    }
  }

  update(dt = 1, ferret = null, lootList = []) {
    // 1. Tick buff durations
    for (const buff of this.activeBuffs) {
      buff.remainingDuration -= dt;
    }
    this.activeBuffs = this.activeBuffs.filter(b => b.remainingDuration > 0);

    // 2. Spawn logic
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = this.spawnInterval;
      if (this.activePowerUps.length < this.maxActive) {
        const zone = _.sample(this.spawnZones);
        if (zone) {
          const jitterX = _.clamp(zone.x + (Math.random() * 40 - 20), 60, 740);
          const jitterY = _.clamp(zone.y + (Math.random() * 40 - 20), 60, 540);
          this.spawnPowerUp(jitterX, jitterY);
        }
      }
    }

    // 3. Magnet effect
    if (ferret && lootList && this.isMagnetActive()) {
      const activeMagnet = this.activeBuffs.find(b => b.magnetRadius > 0);
      const radius = activeMagnet ? activeMagnet.magnetRadius : 160;
      const pull = activeMagnet ? activeMagnet.magnetPullForce : 3.5;

      for (const loot of lootList) {
        if (!loot.isCarried && !loot.isStashed) {
          const dx = ferret.x - loot.x;
          const dy = ferret.y - loot.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 0 && dist <= radius) {
            loot.x += (dx / dist) * pull;
            loot.y += (dy / dist) * pull;
          }
        }
      }
    }
  }

  getSpeedMultiplier() {
    let multiplier = 1.0;
    for (const buff of this.activeBuffs) {
      if (buff.speedMultiplier && buff.speedMultiplier > multiplier) {
        multiplier = buff.speedMultiplier;
      }
    }
    return multiplier;
  }

  isStealthActive() {
    return this.activeBuffs.some(b => b.stealthMask);
  }

  isMagnetActive() {
    return this.activeBuffs.some(b => b.magnetRadius > 0);
  }

  getActiveBuffs() {
    return _.cloneDeep(this.activeBuffs);
  }

  reset() {
    this.activePowerUps = [];
    this.activeBuffs = [];
    this.spawnTimer = this.spawnInterval;
  }
}
