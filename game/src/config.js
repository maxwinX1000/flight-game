// Coral Coast Run — tuning constants and mission definitions.
// One place for every number the rest of the game reads, so balancing the
// flight model or a mission means editing here and nowhere else.

export const CONFIG = {
  // World
  worldSize: 2400, // playable square, metres, centred on 0,0
  seaLevel: 0,
  // Flight model (arcade, metres / seconds / degrees)
  minSpeed: 28, // below this the wing stops flying and the nose drops
  maxSpeed: 95,
  cruiseSpeed: 55,
  throttleStep: 0.55, // per second held
  pitchRate: 42, // deg per second at full stick
  rollRate: 95, // deg per second at full stick
  turnRate: 34, // deg per second of heading at full bank
  climbRate: 16, // m/s at full pull and full throttle
  sinkRate: 9, // m/s when slow and level
  gravity: 9.5,
  // Fuel and damage
  fuelMax: 100,
  fuelBurn: 0.7, // per second at full throttle, less when throttled back
  fuelRingBonus: 15, // fuel back for each ring or checkpoint
  damageMax: 3, // hits before the flight ends
  crashSpeed: 48, // touching ground above this speed is a crash (a landing is slower)
  // Scoring
  scoreRing: 100,
  scoreCheckpoint: 150,
  scoreLanding: 500,
  scoreTimeBonus: 2, // per second under the mission par time
  // Camera
  cameraDistance: 16,
  cameraHeight: 5,
};

export const MISSIONS = [
  {
    id: 'rings',
    name: 'Ring Run',
    blurb: 'Fly through all 8 rings in order. Fast and clean wins.',
    parTime: 150,
    rings: 8,
  },
  {
    id: 'tour',
    name: 'Island Tour',
    blurb: 'Visit all 5 beacons around the islands, then come home.',
    parTime: 210,
    checkpoints: 5,
  },
  {
    id: 'landing',
    name: 'Runway Landing',
    blurb: 'Take off, fly the circuit, and put her down on the runway.',
    parTime: 180,
    checkpoints: 0,
  },
];

// Ring positions: [x, y, z] in world metres. The course threads the islands
// and finishes over the runway so the cover shot always has a ring ahead.
export const RING_COURSE = [
  [120, 70, -260],
  [330, 90, -420],
  [520, 80, -180],
  [430, 100, 140],
  [180, 75, 330],
  [-140, 90, 380],
  [-380, 85, 120],
  [-240, 65, -180],
];

export const TOUR_BEACONS = [
  [620, 60, -480],
  [480, 70, 420],
  [-60, 65, 560],
  [-560, 80, 240],
  [-420, 70, -420],
];

// Runway: on the main island, pointing north-south.
export const RUNWAY = {
  centre: [0, 0, 0],
  heading: 0, // degrees, 0 = north (-z)
  length: 260,
  width: 26,
};
