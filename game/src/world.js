// Coral Coast Run — the world: islands, ocean, sky, runway and rings.
// Everything visible is built here from primitives and a seeded heightmap,
// so the islands look the same on every load and every machine.

import { CONFIG, RING_COURSE, TOUR_BEACONS, RUNWAY, ringRadius } from './config.js';

// Small deterministic random: same seed, same islands, every run.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Island height: a few smooth hills on a disc that falls into the sea.
function islandHeight(x, z, cx, cz, radius, peak, rand) {
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.sqrt(dx * dx + dz * dz) / radius;
  if (d >= 1) return -2;
  const hills = Math.sin(dx * 0.011 + rand * 2) * Math.cos(dz * 0.013) * 0.5 + 0.5;
  const falloff = Math.pow(1 - d * d, 1.6);
  let h = -2 + peak * falloff * (0.45 + 0.55 * hills);
  // Flatten the runway apron on the main island so the strip sits on flat
  // ground instead of inside a hill: fully flat near the strip, blending
  // back to the natural hills at the apron's edge.
  if (cx === 0 && cz === 0) {
    const rx = Math.abs(x) / (RUNWAY.width / 2 + 30);
    const rz = Math.abs(z) / (RUNWAY.length / 2 + 30);
    const ad = Math.max(rx, rz);
    if (ad < 1) {
      const t = Math.max(0, Math.min(1, (ad - 0.55) / 0.45));
      const smooth = t * t * (3 - 2 * t);
      h = 2.5 + (h - 2.5) * smooth;
    }
  }
  return h;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.rings = [];
    this.beacons = [];
    this.effects = []; // burst / splash / smoke particles, aged out in update()
    this.runwayTop = 2.5;
    this.buildSky();
    this.buildOcean();
    this.buildIslands();
    this.buildRunway();
    this.buildRings();
    this.buildBeacons();
    this.buildScenery();
  }

  buildSky() {
    // Gradient sky: a big inverted sphere whose vertices fade from deep
    // blue overhead to pale horizon haze, instead of a flat solid colour.
    const skyGeo = new THREE.SphereGeometry(2800, 24, 16);
    const top = new THREE.Color(0x2f6fc4);
    const mid = new THREE.Color(0x7fb8e8);
    const horizon = new THREE.Color(0xd8eefb);
    const pos = skyGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 2800; // -1 (below) .. +1 (zenith)
      const c = y > 0.25
        ? top.clone().lerp(mid, 1 - (y - 0.25) / 0.75)
        : mid.clone().lerp(horizon, 1 - (y + 0.08) / 0.33);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
    this.scene.add(sky);
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(0x9fc8e8, 500, 2200);
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x3d7a4a, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d0, 1.4);
    sun.position.set(400, 600, 200);
    // Shadows: the sun casts them, over the home island and runway where
    // the plane spends most of its time, so the ground reads as solid.
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -550;
    sun.shadow.camera.right = 550;
    sun.shadow.camera.top = 550;
    sun.shadow.camera.bottom = -550;
    sun.shadow.camera.near = 100;
    sun.shadow.camera.far = 2000;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    this.sun = sun;
    // Sun disc and a few soft clouds.
    const sunMesh = new THREE.Mesh(
      new THREE.CircleGeometry(60, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff6c9, fog: false }),
    );
    sunMesh.position.set(500, 420, -900);
    sunMesh.lookAt(0, 0, 0);
    this.scene.add(sunMesh);
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 });
    const rand = mulberry32(7);
    this.clouds = [];
    for (let i = 0; i < 26; i++) {
      const group = new THREE.Group();
      const puffs = 3 + Math.floor(rand() * 3);
      for (let p = 0; p < puffs; p++) {
        const s = 18 + rand() * 26;
        const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), cloudMat);
        puff.position.set((rand() - 0.5) * 70, (rand() - 0.5) * 8, (rand() - 0.5) * 30);
        puff.scale.y = 0.45;
        group.add(puff);
      }
      group.position.set((rand() - 0.5) * 2200, 150 + rand() * 120, (rand() - 0.5) * 2200);
      this.scene.add(group);
      this.clouds.push(group);
    }
  }

  buildOcean() {
    // Segmented sea with a per-vertex blue jitter, so the water reads as
    // moving surface instead of one flat sheet of paint.
    const seg = 32;
    const geo = new THREE.PlaneGeometry(5200, 5200, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(0x1e6f9e);
    const deep = new THREE.Color(0x155a86);
    const light = new THREE.Color(0x2f8ab8);
    const rand = mulberry32(5);
    for (let i = 0; i < pos.count; i++) {
      const t = rand();
      const c = t < 0.5 ? base.clone().lerp(deep, t * 1.4) : base.clone().lerp(light, (t - 0.5) * 1.2);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const sea = new THREE.Mesh(geo, mat);
    sea.position.y = CONFIG.seaLevel;
    sea.receiveShadow = true;
    this.scene.add(sea);
    // A second, slow-drifting swell layer: a translucent sheet a touch
    // above the sea that slides with the wind, so the ocean never sits still.
    const swell = new THREE.Mesh(
      new THREE.PlaneGeometry(5200, 5200, 8, 8),
      new THREE.MeshLambertMaterial({ color: 0x7fc4e0, transparent: true, opacity: 0.16 }),
    );
    swell.rotation.x = -Math.PI / 2;
    swell.position.y = 0.5;
    this.scene.add(swell);
    this.swell = swell;
    // A lighter shallow ring around the main island reads as a lagoon.
    const lagoon = new THREE.Mesh(
      new THREE.CircleGeometry(330, 40),
      new THREE.MeshLambertMaterial({ color: 0x4fb3a9, transparent: true, opacity: 0.55 }),
    );
    lagoon.rotation.x = -Math.PI / 2;
    lagoon.position.y = 0.4;
    this.scene.add(lagoon);
  }

  buildIslands() {
    // Main island (with the runway) plus four smaller ones, each a
    // heightmap disc coloured sand -> grass -> rock by height.
    const islands = [
      { cx: 0, cz: 0, radius: 300, peak: 46, seed: 11 },
      { cx: 620, cz: -420, radius: 190, peak: 62, seed: 23 },
      { cx: -540, cz: 380, radius: 170, peak: 54, seed: 37 },
      { cx: 480, cz: 480, radius: 130, peak: 38, seed: 51 },
      { cx: -480, cz: -460, radius: 150, peak: 44, seed: 67 },
    ];
    this.islands = islands;
    const sand = new THREE.Color(0xe8d29a);
    const grass = new THREE.Color(0x5da24a);
    const rock = new THREE.Color(0x8a7f72);
    for (const isl of islands) {
      const rand = mulberry32(isl.seed);
      const seg = 48;
      const geo = new THREE.PlaneGeometry(isl.radius * 2, isl.radius * 2, seg, seg);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i) + isl.cx;
        const z = pos.getZ(i) + isl.cz;
        const h = islandHeight(x, z, isl.cx, isl.cz, isl.radius, isl.peak, isl.seed);
        pos.setY(i, h);
        const c = h < 1.5 ? sand : h < isl.peak * 0.55 ? grass : rock;
        const jitter = 0.92 + mulberry32(isl.seed + i)() * 0.16;
        colors[i * 3] = c.r * jitter;
        colors[i * 3 + 1] = c.g * jitter;
        colors[i * 3 + 2] = c.b * jitter;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.position.set(isl.cx, 0, isl.cz);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  // Height of the ground at (x, z): the highest island there, else sea.
  groundHeight(x, z) {
    let h = -2;
    for (const isl of this.islands) {
      const y = islandHeight(x, z, isl.cx, isl.cz, isl.radius, isl.peak, isl.seed);
      if (y > h) h = y;
    }
    // Flatten the runway strip so landings read.
    const [rcx, rcz] = RUNWAY.centre;
    const dx = Math.abs(x - rcx);
    const dz = Math.abs(z - rcz);
    if (dx < RUNWAY.width / 2 + 8 && dz < RUNWAY.length / 2 + 8) {
      h = Math.max(h, this.runwayTop);
      if (dx < RUNWAY.width / 2 && dz < RUNWAY.length / 2) h = this.runwayTop;
    }
    return h;
  }

  buildRunway() {
    const [cx, cz] = RUNWAY.centre;
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(RUNWAY.width, 1.2, RUNWAY.length),
      new THREE.MeshLambertMaterial({ color: 0x3a3f46 }),
    );
    strip.position.set(cx, this.runwayTop - 0.6, cz);
    this.scene.add(strip);
    // Centre dashes and threshold bars, pale paint on the dark strip.
    const paint = new THREE.MeshBasicMaterial({ color: 0xf5f2e8 });
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const dash = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 12), paint);
      dash.position.set(cx, this.runwayTop + 0.1, cz + i * 26);
      this.scene.add(dash);
    }
    for (const s of [-1, 1]) {
      for (let k = -2; k <= 2; k++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 8), paint);
        bar.position.set(cx + k * 4.4, this.runwayTop + 0.1, cz + s * (RUNWAY.length / 2 - 10));
        this.scene.add(bar);
      }
    }
    // Windsock beside the strip, standing on the ground as it is.
    const sockGround = this.groundHeight(cx + RUNWAY.width / 2 + 10, cz - 60);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 12, 8),
      new THREE.MeshLambertMaterial({ color: 0xd8d8d8 }),
    );
    pole.position.set(cx + RUNWAY.width / 2 + 10, sockGround + 6, cz - 60);
    this.scene.add(pole);
    const sock = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 6, 10),
      new THREE.MeshLambertMaterial({ color: 0xff7a2f }),
    );
    sock.rotation.z = Math.PI / 2;
    sock.position.set(cx + RUNWAY.width / 2 + 13, sockGround + 11, cz - 60);
    this.scene.add(sock);
    // A small hangar and control tower give the field a home.
    const hangarGround = this.groundHeight(cx + 42, cz + 60);
    const hangar = new THREE.Mesh(
      new THREE.BoxGeometry(30, 12, 20),
      new THREE.MeshLambertMaterial({ color: 0xd8e2ea }),
    );
    hangar.position.set(cx + 42, hangarGround + 6, cz + 60);
    this.scene.add(hangar);
    const towerGround = this.groundHeight(cx - 34, cz + 80);
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 4, 22, 10),
      new THREE.MeshLambertMaterial({ color: 0xe8e2d0 }),
    );
    tower.position.set(cx - 34, towerGround + 11, cz + 80);
    this.scene.add(tower);
    const cab = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 5, 4, 10),
      new THREE.MeshLambertMaterial({ color: 0x2f6fb2 }),
    );
    cab.position.set(cx - 34, towerGround + 24, cz + 80);
    this.scene.add(cab);
  }

  buildRings() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.9 });
    const matNext = new THREE.MeshBasicMaterial({ color: 0x35d05a, transparent: true, opacity: 0.95 });
    RING_COURSE.forEach((p, i) => {
      // Rings 5-8 are smaller (ringRadius), so the back half of the course
      // asks for real precision.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(ringRadius(i), 1.6, 10, 28), i === 0 ? matNext : mat);
      ring.position.set(p[0], p[1], p[2]);
      ring.userData.index = i;
      this.scene.add(ring);
      this.rings.push(ring);
    });
    this.ringMat = mat;
    this.ringMatNext = matNext;
  }

  setNextRing(index) {
    this.rings.forEach((r, i) => {
      r.material = i === index ? this.ringMatNext : this.ringMat;
      r.scale.setScalar(i === index ? 1.15 : 1);
    });
  }

  buildBeacons() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x35d05a });
    TOUR_BEACONS.forEach((p) => {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 120, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x7fe6a0, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      beam.position.set(p[0], p[1] + 40, p[2]);
      this.scene.add(beam);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 10), mat);
      ball.position.set(p[0], p[1], p[2]);
      this.scene.add(ball);
      this.beacons.push(ball);
    });
  }

  buildScenery() {
    // Palm trees on the beaches, a lighthouse on the north point, and a
    // few white houses near the runway so the terrain reads as a place.
    const rand = mulberry32(99);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6b48 });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f8f4e });
    for (let i = 0; i < 70; i++) {
      const isl = this.islands[Math.floor(rand() * this.islands.length)];
      const a = rand() * Math.PI * 2;
      const r = isl.radius * (0.55 + rand() * 0.35);
      const x = isl.cx + Math.cos(a) * r;
      const z = isl.cz + Math.sin(a) * r;
      const h = this.groundHeight(x, z);
      if (h < 1 || h > isl.peak * 0.6) continue;
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 7, 6), trunkMat);
      trunk.position.y = 3.5;
      tree.add(trunk);
      for (let l = 0; l < 5; l++) {
        const leaf = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5, 6), leafMat);
        leaf.position.set(Math.cos((l / 5) * Math.PI * 2) * 1.6, 7.6, Math.sin((l / 5) * Math.PI * 2) * 1.6);
        leaf.rotation.z = Math.cos((l / 5) * Math.PI * 2) * 0.9;
        leaf.rotation.x = -Math.sin((l / 5) * Math.PI * 2) * 0.9;
        tree.add(leaf);
      }
      tree.position.set(x, h, z);
      tree.rotation.y = rand() * Math.PI * 2;
      tree.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(tree);
    }
    // Lighthouse: striped tower on the main island's north point.
    const light = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 18, 12), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
    base.position.y = 9;
    light.add(base);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 4, 12), new THREE.MeshLambertMaterial({ color: 0xd23b2e }));
    band.position.y = 12;
    light.add(band);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 10), new THREE.MeshBasicMaterial({ color: 0xfff2a0 }));
    lamp.position.y = 19.5;
    light.add(lamp);
    light.position.set(0, this.groundHeight(0, -280), -280);
    this.scene.add(light);
  }

  // A short burst of confetti at a flown ring: a dozen small tetrahedra
  // that scatter and fade in about 0.6 s, so a hit reads at a glance.
  burst(position) {
    if (!this.effects) this.effects = [];
    const rand = mulberry32((Math.random() * 1e9) | 0);
    const colors = [0xffd23c, 0x35d05a, 0xffffff, 0xffb020];
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(
        new THREE.TetrahedronGeometry(1.1),
        new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true }),
      );
      m.position.copy(position);
      const a = rand() * Math.PI * 2;
      const b = (rand() - 0.5) * Math.PI;
      const sp = 14 + rand() * 16;
      this.effects.push({
        mesh: m, life: 0.6, age: 0, op0: 1,
        vel: new THREE.Vector3(Math.cos(a) * Math.cos(b) * sp, Math.abs(Math.sin(b)) * sp * 0.8 + 4, Math.sin(a) * Math.cos(b) * sp),
        grow: 0, fade: true,
      });
      this.scene.add(m);
    }
  }

  // A white ring that blooms on the water where a seaplane ditches.
  splash(position) {
    if (!this.effects) this.effects = [];
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.6, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(position.x, 0.4, position.z);
    this.effects.push({ mesh: m, life: 1.0, age: 0, op0: 0.9, vel: new THREE.Vector3(0, 0, 0), grow: 26, fade: true });
    this.scene.add(m);
  }

  // Grey smoke puffs for a crash on land: they rise, swell and fade.
  smoke(position) {
    if (!this.effects) this.effects = [];
    const rand = mulberry32((Math.random() * 1e9) | 0);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1.6 + rand() * 1.2, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x5a5a5a, transparent: true, opacity: 0.75 }),
      );
      m.position.set(position.x + (rand() - 0.5) * 4, position.y + 1 + rand() * 2, position.z + (rand() - 0.5) * 4);
      this.effects.push({
        mesh: m, life: 1.2, age: 0, op0: 0.75,
        vel: new THREE.Vector3((rand() - 0.5) * 2, 3 + rand() * 2, (rand() - 0.5) * 2),
        grow: 5, fade: true,
      });
      this.scene.add(m);
    }
  }

  update(dt) {
    // Clouds drift slowly; rings bob and spin so they read as targets.
    for (const c of this.clouds) {
      c.position.x += dt * 1.5;
      if (c.position.x > 1200) c.position.x = -1200;
    }
    // The swell layer slides with the wind so the ocean never sits still.
    if (this.swell) {
      this.swell.position.x += dt * 2.2;
      this.swell.position.z += dt * 0.9;
      if (this.swell.position.x > 400) this.swell.position.x = -400;
      if (this.swell.position.z > 400) this.swell.position.z = -400;
    }
    const t = performance.now() / 1000;
    this.rings.forEach((r, i) => {
      r.rotation.y = t * 0.4 + i;
      r.position.y += Math.sin(t * 0.8 + i * 1.7) * dt * 0.6;
    });
    // Particle effects age out: move, grow, fade, then leave the scene.
    if (this.effects) {
      for (let i = this.effects.length - 1; i >= 0; i--) {
        const e = this.effects[i];
        e.age += dt;
        e.mesh.position.addScaledVector(e.vel, dt);
        if (e.grow) e.mesh.scale.setScalar(1 + (e.age / e.life) * e.grow * 0.4);
        if (e.fade) e.mesh.material.opacity = Math.max(0, e.op0 * (1 - e.age / e.life));
        if (e.age >= e.life) {
          this.scene.remove(e.mesh);
          e.mesh.geometry.dispose();
          e.mesh.material.dispose();
          this.effects.splice(i, 1);
        }
      }
    }
  }
}
