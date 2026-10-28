import { LOOT_TYPES } from './constants.js';

export class Loot {
  constructor(id, typeKey, x, y) {
    const config = LOOT_TYPES[typeKey] || LOOT_TYPES.sock;
    this.id = id;
    this.type = config.type;
    this.name = config.name;
    this.emoji = config.emoji;
    this.points = config.points;
    this.weight = config.weight;
    this.speedMultiplier = config.speedMultiplier;
    this.noise = config.noise;
    this.x = x;
    this.y = y;
    this.isCarried = false;
    this.isStashed = false;
    this.radius = 18;
  }

  getDistanceTo(x, y) {
    return Math.hypot(this.x - x, this.y - y);
  }

  isNearby(x, y, threshold = 28) {
    return (
      !this.isCarried &&
      !this.isStashed &&
      this.getDistanceTo(x, y) <= threshold
    );
  }
}

export const DEFAULT_LOOT_POSITIONS = [
  { type: 'sock', x: 280, y: 220 },
  { type: 'slipper', x: 500, y: 260 },
  { type: 'keys', x: 620, y: 260 },
  { type: 'remote', x: 420, y: 350 },
  { type: 'sock', x: 670, y: 480 },
  { type: 'ring', x: 710, y: 190 }
];

export function generateLootList(lootPositions = DEFAULT_LOOT_POSITIONS) {
  return lootPositions.map(
    (item, index) => new Loot(`loot-${index + 1}`, item.type, item.x, item.y)
  );
}
