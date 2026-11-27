// Coral Coast Run — missions, scoring, fuel and damage.
// One mission at a time: rings in order, beacons in any order, or a
// landing on the runway. The flight model stays dumb; this file decides
// what counts as progress, what costs fuel, and what ends the flight.

import { CONFIG, MISSIONS, RING_COURSE, TOUR_BEACONS, RUNWAY, ringRadius } from './config.js';

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
    this.combo = 1; // score multiplier: x1, x2, x3 for consecutive clean hits
    this.downed = 0; // seconds left grounded after a crash, before respawn
    this.lastLowPassWarn = -10;
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
    this.combo = 1;
    this.downed = 0;
    this.lastLowPassWarn = -10;
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
    // Downed after a crash: she sits where she fell while the clock runs,
    // then respawns on the runway. No fuel burn, no checks while down.
    if (this.downed > 0) {
      this.downed -= dt;
      if (this.downed <= 0) {
        this.downed = 0;
        this.respawn();
      }
      return;
    }
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

  // A clean hit raises the combo; the next hit pays base x combo.
  award(base) {
    const gained = base * this.combo;
    this.score += gained;
    this.combo = Math.min(3, this.combo + 1);
    return gained;
  }

  checkRings() {
    if (!this.mission || this.mission.id !== 'rings') return;
    if (this.ringIndex >= RING_COURSE.length) return;
    const target = RING_COURSE[this.ringIndex];
    const d = this.plane.position.distanceTo(new THREE.Vector3(target[0], target[1], target[2]));
    // The pass window follows the ring's size: wide rings forgive, the
    // small back-half rings do not. The window is 3 m past the ring's
    // visible edge (tube 1.6) — a fair arcade hitbox for a 9.2 m wide
    // plane, and the dead-centre bonus still rewards threading the middle.
    if (d < ringRadius(this.ringIndex) + 3) {
      const gained = this.award(CONFIG.scoreRing);
      let extra = '';
      if (d < CONFIG.deadCentreRadius) {
        this.score += CONFIG.scoreDeadCentre;
        extra = `  ·  DEAD CENTRE +${CONFIG.scoreDeadCentre}`;
      }
      this.fuel = Math.min(CONFIG.fuelMax, this.fuel + CONFIG.fuelRingBonus);
      this.audio.ring();
      this.world.burst(new THREE.Vector3(target[0], target[1], target[2]));
      this.onEvent('ring', { index: this.ringIndex, total: RING_COURSE.length, score: this.score, gained, extra });
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
        // A tour beacon only counts as a low pass: under 100 m, close to
        // the water, not a flyover at cruise altitude.
        if (this.plane.altitude >= CONFIG.tourLowPassMaxAlt) {
          if (this.time - this.lastLowPassWarn > 3) {
            this.lastLowPassWarn = this.time;
            this.onEvent('warning', { text: 'LOW PASS — get under 100 m to count it' });
          }
          return;
        }
        this.beaconsHit.add(i);
        const gained = this.award(CONFIG.scoreCheckpoint);
        this.fuel = Math.min(CONFIG.fuelMax, this.fuel + CONFIG.fuelRingBonus);
        this.audio.checkpoint();
        this.onEvent('beacon', { index: i, total: TOUR_BEACONS.length, score: this.score, gained, extra: '  ·  LOW PASS' });
        if (this.beaconsHit.size >= TOUR_BEACONS.length) {
          this.finish('Every beacon visited — the islands are yours.');
        }
      }
    });
  }

  checkLanding() {
    if (!this.mission || this.mission.id !== 'landing') return;
    const p = this.plane;
    // Took off once she is high, or once she is properly airborne at
    // speed — the landing demo starts her in the air on final, and the
    // HUD should read "fly the circuit, then land" for that, not "take off".
    const ground = this.world.groundHeight(p.position.x, p.position.z);
    if (!this.tookOff && (p.altitude > 25 || (p.speed > 30 && p.position.y > ground + 5))) this.tookOff = true;
    if (!this.tookOff || this.landed) return;
    const [cx, cz] = RUNWAY.centre;
    const dx = Math.abs(p.position.x - cx);
    const dz = Math.abs(p.position.z - cz);
    const onStrip = dx < RUNWAY.width / 2 && dz < RUNWAY.length / 2;
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
    // The surface she can touch: the waterline (y=0) over water, the
    // terrain over land. The old code used ground+1.0 for both, but the
    // seabed sits at -2, so over water the touch test (y <= -1) could
    // never fire — a water ditch was impossible.
    const surfaceY = overWater ? 0 : ground;
    // Touching terrain or water: fast is a crash, slow is a hard landing.
    // A seaplane ditches in water at any real speed, so water is strict.
    // On the runway strip a fast touchdown is a hard landing, not a crash.
    const [scx, scz] = RUNWAY.centre;
    const onStrip = Math.abs(p.position.x - scx) < RUNWAY.width / 2 && Math.abs(p.position.z - scz) < RUNWAY.length / 2;
    if (p.position.y <= surfaceY + 1.0) {
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
      p.position.y = surfaceY + 1.0;
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
    this.combo = 1; // a hit breaks the combo
    this.audio.crash();
    this.onEvent('damage', { damage: this.damage, max: CONFIG.damageMax, what });
    if (this.damage >= CONFIG.damageMax) {
      this.crash(`Crashed into ${what}. The flight is over.`);
      return;
    }
    // No bounce back into the air: she goes down where she hit. On water
    // she ditches with a splash; on land she stops in a puff of smoke.
    // Speed zero, then a respawn on the runway after ~1.5 s.
    const p = this.plane;
    const ground = this.world.groundHeight(p.position.x, p.position.z);
    const overWater = ground <= 0;
    if (overWater) {
      this.world.splash(p.position);
      p.position.y = 0.6;
    } else {
      this.world.smoke(p.position);
      p.position.y = ground + 1.0;
    }
    p.speed = 0;
    p.throttle = 0;
    p.pitch = 0;
    p.bank = 0;
    p.onGround = true;
    p.downed = true;
    this.downed = 1.5;
  }

  // Back on the runway threshold, engine idling, progress kept: the rings
  // already flown stay flown, the beacons already visited stay visited.
  respawn() {
    this.plane.reset();
    this.airborne = false;
    this.tookOff = false;
    this.onEvent('warning', { text: 'Back on the runway — throttle up and go again' });
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
