// Coral Coast Run — the aircraft: its model and its flight.
// A low-poly seaplane built from primitives, flown on a simple arcade
// model: throttle sets speed, the stick pitches and banks, the bank turns
// the heading, and the wing needs speed to hold altitude.

import { CONFIG } from './config.js';

export class Plane {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.buildModel();
    scene.add(this.group);
    this.reset();
  }

  buildModel() {
    const body = new THREE.MeshLambertMaterial({ color: 0xe8b13c });
    const accent = new THREE.MeshLambertMaterial({ color: 0x2f6fb2 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x333a42 });
    const glass = new THREE.MeshLambertMaterial({ color: 0x9fd8ef });
    // Fuselage: a stretched nose-to-tail body.
    const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.55, 5.4, 10), body);
    fuselage.rotation.x = Math.PI / 2;
    this.group.add(fuselage);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), body);
    nose.position.z = -2.7;
    nose.scale.set(1, 1, 1.2);
    this.group.add(nose);
    // Cockpit canopy.
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.72, 10, 8), glass);
    canopy.position.set(0, 0.62, -1.1);
    canopy.scale.set(1, 0.75, 1.7);
    this.group.add(canopy);
    // Main wing and tailplane.
    const wing = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.22, 1.7), accent);
    wing.position.set(0, -0.1, -0.4);
    this.group.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.18, 1.1), accent);
    tail.position.set(0, 0.25, 2.5);
    this.group.add(tail);
    // Vertical fin.
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.5, 1.3), accent);
    fin.position.set(0, 0.85, 2.5);
    this.group.add(fin);
    // Propeller: hub plus two blades that spin with speed.
    this.prop = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 8), dark);
    hub.rotation.x = Math.PI / 2;
    this.prop.add(hub);
    for (const s of [-1, 1]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.5, 0.1), dark);
      blade.position.y = s * 0.65;
      this.prop.add(blade);
    }
    this.prop.position.set(0, 0, -3.3);
    this.group.add(this.prop);
    // Floats: she is a seaplane, so water is a runway too.
    for (const s of [-1, 1]) {
      const float = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 3.6, 8), accent);
      float.rotation.x = Math.PI / 2;
      float.position.set(s * 1.5, -1.15, -0.6);
      this.group.add(float);
    }
    // Navigation lights: red left, green right, white tail.
    const light = (color, x, y, z) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color }));
      m.position.set(x, y, z);
      this.group.add(m);
    };
    light(0xff2a2a, -4.6, -0.1, -0.4);
    light(0x2aff5a, 4.6, -0.1, -0.4);
    light(0xffffff, 0, 0.3, 2.9);
  }

  reset() {
    // Parked at the runway threshold, facing north, engine idling.
    // Floats just kiss the strip: strip top 2.5, floats hang 1.15 below.
    this.position = new THREE.Vector3(0, 3.6, 110);
    this.heading = 0; // degrees, 0 = north (-z)
    this.pitch = 0; // degrees, + = nose up
    this.bank = 0; // degrees, + = right wing down
    this.speed = 0;
    this.throttle = 0;
    this.verticalSpeed = 0;
    this.onGround = true;
    this.propSpin = 0;
    this.sync();
  }

  // Arcade flight: throttle drives speed, pitch trades speed for height,
  // bank turns the heading, and a slow wing sinks.
  update(dt, input, autopilot) {
    const stick = autopilot || { pitch: 0, roll: 0, throttle: 0 };
    const pitchIn = input ? input.pitch() : stick.pitch;
    const rollIn = input ? input.roll() : stick.roll;
    const thrIn = input ? input.throttle() : stick.throttle;

    this.throttle = Math.max(0, Math.min(1, this.throttle + thrIn * CONFIG.throttleStep * dt));
    // Throttle sets a target speed; the plane chases it.
    const targetSpeed = CONFIG.minSpeed + this.throttle * (CONFIG.maxSpeed - CONFIG.minSpeed);
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 1.0);
    if (this.onGround && this.speed < 30) this.speed = Math.max(this.speed, this.throttle * 30);

    this.pitch += -pitchIn * CONFIG.pitchRate * dt;
    this.pitch = Math.max(-35, Math.min(35, this.pitch));
    this.bank += rollIn * CONFIG.rollRate * dt;
    this.bank = Math.max(-65, Math.min(65, this.bank));
    // Wings level themselves gently when the stick is centred.
    if (rollIn === 0) this.bank *= Math.max(0, 1 - dt * 0.8);
    if (pitchIn === 0) this.pitch *= Math.max(0, 1 - dt * 0.5);

    // Bank turns the heading; the turn tightens with bank and speed.
    this.heading += Math.sin((this.bank * Math.PI) / 180) * CONFIG.turnRate * dt * (0.5 + this.speed / CONFIG.maxSpeed);
    this.heading = ((this.heading % 360) + 360) % 360;

    // Vertical speed: pull climbs (if fast enough), a slow wing sinks.
    const lift = this.speed >= CONFIG.minSpeed ? 1 : this.speed / CONFIG.minSpeed;
    const climb = Math.sin((this.pitch * Math.PI) / 180) * CONFIG.climbRate * lift;
    const sink = (1 - lift) * CONFIG.sinkRate + (this.throttle < 0.15 ? 2 : 0);
    this.verticalSpeed = climb - sink;
    const rad = (this.heading * Math.PI) / 180;
    const forward = new THREE.Vector3(Math.sin(rad), 0, -Math.cos(rad));
    this.position.addScaledVector(forward, this.speed * dt);
    this.position.y += this.verticalSpeed * dt;
    if (this.position.y < 0.5) this.position.y = 0.5;

    this.propSpin += dt * (4 + this.throttle * 26);
    this.prop.rotation.z = this.propSpin;
    this.sync();
  }

  sync() {
    this.group.position.copy(this.position);
    this.group.rotation.set(
      (this.pitch * Math.PI) / 180,
      (this.heading * Math.PI) / 180,
      -(this.bank * Math.PI) / 180,
      'YXZ',
    );
  }

  get altitude() {
    return Math.max(0, this.position.y);
  }

  get speedKmh() {
    return Math.round(this.speed * 3.6);
  }
}
