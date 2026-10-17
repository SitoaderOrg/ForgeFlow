export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;

export const COUCH = {
  x: 40,
  y: 450,
  width: 220,
  height: 120
};

export const CHAIR = {
  x: 620,
  y: 80,
  width: 130,
  height: 130
};

export const HIDING_BOXES = [
  { id: 'box-1', x: 340, y: 100, width: 90, height: 70 },
  { id: 'box-2', x: 480, y: 440, width: 90, height: 70 }
];

export const RUG = {
  x: 230,
  y: 190,
  width: 340,
  height: 230
};

export const FERRET_CONFIG = {
  baseSpeed: 4.5,
  danceSpeed: 7.5,
  size: 16,
  bodySegments: 6,
  maxDanceMeter: 100,
  danceDrainRate: 0.8,
  danceRechargeRate: 0.15
};

export const LOOT_TYPES = {
  sock: {
    type: 'sock',
    name: 'Fuzzy Sock',
    emoji: '🧦',
    points: 15,
    weight: 0.1,
    speedMultiplier: 0.95,
    noise: 0
  },
  keys: {
    type: 'keys',
    name: 'Shiny Keys',
    emoji: '🔑',
    points: 30,
    weight: 0.25,
    speedMultiplier: 0.88,
    noise: 18
  },
  slipper: {
    type: 'slipper',
    name: 'Bunny Slipper',
    emoji: '👟',
    points: 25,
    weight: 0.2,
    speedMultiplier: 0.9,
    noise: 0
  },
  remote: {
    type: 'remote',
    name: 'TV Remote',
    emoji: '📱',
    points: 40,
    weight: 0.4,
    speedMultiplier: 0.78,
    noise: 5
  },
  ring: {
    type: 'ring',
    name: 'Sparkly Ring',
    emoji: '💍',
    points: 60,
    weight: 0.05,
    speedMultiplier: 0.98,
    noise: 0
  }
};

export const HUMAN_STATES = {
  SLEEPING: 'SLEEPING',
  SUSPICIOUS: 'SUSPICIOUS',
  AWAKE: 'AWAKE',
  SNOOZING: 'SNOOZING'
};

export const GAME_STATES = {
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  CAUGHT: 'CAUGHT',
  LEVEL_CLEARED: 'LEVEL_CLEARED'
};
