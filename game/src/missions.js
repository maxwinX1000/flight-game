// Coral Coast Run — missions, scoring, fuel and damage.
// One mission at a time: rings in order, beacons in any order, or a
// landing on the runway. The flight model stays dumb; this file decides
// what counts as progress, what costs fuel, and what ends the flight.

import { CONFIG, MISSIONS, RING_COURSE, TOUR_BEACONS, RUNWAY } from './config.js';

export class Missions {
  constructor(world, plane, audio, onEvent) {
    this.world = world;
    this.plane = plane;
    this.audio = audio;
    this.onEvent = onEvent; // (type, data) -> HUD / screens
    this.mission = null;
    this.state = 'title'; // title | flying | done | crashed
    this.score = 0;
    this.fuel = CONFIG.fuelMax;
    this.damage = 0;
    this.time = 0;
    this.ringIndex = 0;
    this.beaconsHit = new Set();
    this.landed = false;
    this.tookOff = false;
    this.airborne = false; // true once the plane has actually flown
    this.warnedFuel = false;
    this.warnedStall = false;
  }

  start(missionId) {
    this.mission = MISSIONS.find((m) => m.id === missionId) || MISSIONS[0];
    this.state = 'flying';
    this.score = 0;
    this.fuel = CONFIG.fuelMax;
    this.damage = 0;
    this.time = 0;
    this.ringIndex = 0;
    this.beaconsHit = new Set();
    this.landed = false;
    this.tookOff = false;
    this.airborne = false;
    this.warnedFuel = false;
    this.warnedStall = false;
    this.plane.reset();
    this.world.setNextRing(0);
    this.onEvent('start', { mission: this.mission });
  }

  toTitle() {
    this.state = 'title';
    this.mission = null;
    this.plane.reset();
  }

  update(dt) {
    if (this.state !== 'flying') return;
    this.time += dt;
    const p = this.plane;
    if (p.altitude > 15) this.airborne = true;
    // Fuel: full throttle burns fastest; gliding sips.
    this.fuel -= CONFIG.fuelBurn * (0.25 + p.throttle * 0.75) * dt;
    if (this.fuel <= 20 && !this.warnedFuel) {
      this.warnedFuel = true;
      this.audio.warning();
      this.onEvent('warning', { text: 'LOW FUEL' });
    }
    if (this.fuel <= 0) {
      this.fuel = 0;
      p.throttle = 0; // dead stick: glide her in or swim.
    }
    // Stall warning when the wing is about to quit.
    if (p.speed < CONFIG.minSpeed + 6 && p.altitude > 8 && !this.warnedStall) {
      this.warnedStall = true;
      this.audio.warning();
      this.onEvent('warning', { text: 'STALL — NOSE DOWN, THROTTLE UP' });
    }
    if (p.speed > CONFIG.minSpeed + 10) this.warnedStall = false;

    this.checkRings();
    this.checkBeacons();
    this.checkLanding();
    this.checkCrash(dt);
  }

  checkRings() {
    if (!this.mission || this.mission.id !== 'rings') return;
    if (this.ringIndex >= RING_COURSE.length) return;
    const target = RING_COURSE[this.ringIndex];
    const d = this.plane.position.distanceTo(new THREE.Vector3(target[0], target[1], target[2]));
    if (d < 16) {
      this.score += CONFIG.scoreRing;
      this.fuel = Math.min(CONFIG.fuelMax, this.fuel + CONFIG.fuelRingBonus);
      this.audio.ring();
      this.onEvent('ring', { index: this.ringIndex, total: RING_COURSE.length, score: this.score });
      this.ringIndex += 1;
      this.world.setNextRing(this.ringIndex);
      if (this.ringIndex >= RING_COURSE.length) this.finish('All rings flown — beautiful flying.');
    }
  }

  checkBeacons() {
    if (!this.mission || this.mission.id !== 'tour') return;
    TOUR_BEACONS.forEach((b, i) => {
      if (this.beaconsHit.has(i)) return;
      const d = this.plane.position.distanceTo(new THREE.Vector3(b[0], b[1], b[2]));
      if (d < 22) {
        this.beaconsHit.add(i);
        this.score += CONFIG.scoreCheckpoint;
        this.fuel = Math.min(CONFIG.fuelMax, this.fuel + CONFIG.fuelRingBonus);
        this.audio.checkpoint();
        this.onEvent('beacon', { index: i, total: TOUR_BEACONS.length, score: this.score });
        if (this.beaconsHit.size >= TOUR_BEACONS.length) {
          this.finish('Every beacon visited — the islands are yours.');
        }
      }
    });
  }

  checkLanding() {
    if (!this.mission || this.mission.id !== 'landing') return;
    const p = this.plane;
    if (!this.tookOff && p.altitude > 25) this.tookOff = true;
    if (!this.tookOff || this.landed) return;
    const [cx, cz] = RUNWAY.centre;
    const dx = Math.abs(p.position.x - cx);
    const dz = Math.abs(p.position.z - cz);
    const onStrip = dx < RUNWAY.width / 2 && dz < RUNWAY.length / 2;
    const ground = this.world.groundHeight(p.position.x, p.position.z);
    if (onStrip && p.position.y <= ground + 1.2) {
      const aligned = Math.min(Math.abs(p.heading), Math.abs(360 - p.heading)) < 18 || Math.abs(p.heading - 180) < 18;
      const gentle = p.verticalSpeed > -6 && p.speed < 55;
      if (aligned && gentle) {
        this.landed = true;
        const bonus = Math.max(0, Math.round((this.mission.parTime - this.time) * CONFIG.scoreTimeBonus));
        this.score += CONFIG.scoreLanding + bonus;
        this.audio.land();
        this.finish(`Down safe on the runway. Landing bonus ${CONFIG.scoreLanding} + time ${bonus}.`);
      }
    }
  }

  checkCrash(dt) {
    const p = this.plane;
    const ground = this.world.groundHeight(p.position.x, p.position.z);
    const overWater = ground <= 0;
    // Touching terrain or water: fast is a crash, slow is a hard landing.
    // A seaplane ditches in water at any real speed, so water is strict.
    // On the runway strip a fast touchdown is a hard landing, not a crash.
    const [scx, scz] = RUNWAY.centre;
    const onStrip = Math.abs(p.position.x - scx) < RUNWAY.width / 2 && Math.abs(p.position.z - scz) < RUNWAY.length / 2;
    if (p.position.y <= ground + 1.0) {
      if (overWater) {
        if (p.speed > 20) {
          this.hit('water');
          return;
        }
      } else if (p.speed > CONFIG.crashSpeed && !(onStrip && p.speed <= 60)) {
        this.hit('terrain');
        return;
      }
      // Slow touchdown on land: she rolls, and stays down.
      p.onGround = true;
      p.position.y = ground + 1.0;
      p.speed *= Math.max(0, 1 - 2.2 * dt);
      if (this.mission && this.mission.id === 'landing' && this.tookOff) {
        // A slow touchdown off the strip still counts as down, just ugly.
        const [cx, cz] = RUNWAY.centre;
        if (Math.abs(p.position.x - cx) > RUNWAY.width / 2 || Math.abs(p.position.z - cz) > RUNWAY.length / 2) {
          this.hit('rough ground');
        }
      }
      if (p.speed < 2) {
        p.speed = 0;
        // Only call the flight over if she actually flew: a plane sitting
        // on the runway at the start has speed 0 too, and that is not a
        // landing — it is a pilot who has not throttled up yet.
        if (this.state === 'flying' && this.airborne && this.mission && this.mission.id !== 'landing') {
          this.finish('She is down in one piece. Flight over.');
        }
      }
    } else {
      p.onGround = false;
    }
    // Out of the playable square: the sea swallows the flight.
    const { worldSize } = CONFIG;
    if (Math.abs(p.position.x) > worldSize / 2 || Math.abs(p.position.z) > worldSize / 2) {
      this.hit('open sea');
    }
  }

  hit(what) {
    this.damage += 1;
    this.audio.crash();
    this.onEvent('damage', { damage: this.damage, max: CONFIG.damageMax, what });
    if (this.damage >= CONFIG.damageMax) {
      this.crash(`Crashed into ${what}. The flight is over.`);
      return;
    }
    // One hard hit: bounce her back into the air, slower and shaken.
    this.plane.position.y = Math.max(this.plane.position.y, this.world.groundHeight(this.plane.position.x, this.plane.position.z) + 12);
    this.plane.speed *= 0.55;
    this.plane.pitch = 8;
  }

  finish(message) {
    this.state = 'done';
    this.audio.land();
    this.onEvent('done', { message, score: this.score, time: this.time, mission: this.mission });
  }

  crash(message) {
    this.state = 'crashed';
    this.onEvent('crashed', { message, score: this.score, time: this.time, mission: this.mission });
  }

  get progressText() {
    if (!this.mission) return '';
    if (this.mission.id === 'rings') return `Rings ${this.ringIndex}/${RING_COURSE.length}`;
    if (this.mission.id === 'tour') return `Beacons ${this.beaconsHit.size}/${TOUR_BEACONS.length}`;
    if (this.mission.id === 'landing') return this.tookOff ? (this.landed ? 'Landed' : 'Fly the circuit, then land') : 'Take off — full throttle';
    return '';
  }
}
