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
  // ground instead of inside a hill: fully flat near the strip (the whole
  // take-off and landing corridor), blending back to the natural hills
  // past the apron's edge. The flat core has to cover the strip plus
  // margin: the take-off path leaves the strip low and slow, and a hill
  // at the apron's edge is a crash, not scenery.
  if (cx === 0 && cz === 0) {
    const rx = Math.abs(x) / (RUNWAY.width / 2 + 40);
    const rz = Math.abs(z) / (RUNWAY.length / 2 + 40);
    const ad = Math.max(rx, rz);
    if (ad < 1.25) {
      const t = Math.max(0, Math.min(1, (ad - 0.75) / 0.5));
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
    // Fog the colour of the horizon haze, so the sea melts into the sky
    // instead of ending on a hard line.
    this.scene.fog = new THREE.Fog(0xcfe6f5, 400, 2400);
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
    // Sun disc with a soft halo, so it reads as a light source, not a
    // flat yellow circle pasted on the sky.
    const sunMesh = new THREE.Mesh(
      new THREE.CircleGeometry(60, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff6c9, fog: false }),
    );
    sunMesh.position.set(500, 420, -900);
    sunMesh.lookAt(0, 0, 0);
    this.scene.add(sunMesh);
    const halo = new THREE.Mesh(
      new THREE.CircleGeometry(130, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff6c9, transparent: true, opacity: 0.28, fog: false }),
    );
    halo.position.set(500, 420, -905);
    halo.lookAt(0, 0, 0);
    this.scene.add(halo);
    const cloudMatTop = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 });
    const cloudMatBottom = new THREE.MeshBasicMaterial({ color: 0xdce9f2, transparent: true, opacity: 0.88 });
    const rand = mulberry32(7);
    this.clouds = [];
    for (let i = 0; i < 36; i++) {
      const group = new THREE.Group();
      const puffs = 5 + Math.floor(rand() * 3);
      for (let p = 0; p < puffs; p++) {
        const s = 22 + rand() * 32;
        const py = (rand() - 0.5) * 10;
        // Two-tone puffs: white on top, light blue-grey underneath, so
        // a cloud reads as a shaded volume instead of clip-art.
        const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), py < 0 ? cloudMatBottom : cloudMatTop);
        puff.position.set((rand() - 0.5) * 90, py, (rand() - 0.5) * 40);
        puff.scale.y = 0.45;
        group.add(puff);
      }
      group.position.set((rand() - 0.5) * 2200, 140 + rand() * 130, (rand() - 0.5) * 2200);
      this.scene.add(group);
      this.clouds.push(group);
    }
  }

  buildOcean() {
    // Segmented sea with a per-vertex blue jitter, so the water reads as
    // moving surface instead of one flat sheet of paint.
    const seg = 32;
    const geo = new THREE.PlaneGeometry(5600, 5600, seg, seg);
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
      new THREE.PlaneGeometry(5600, 5600, 8, 8),
      new THREE.MeshLambertMaterial({ color: 0x7fc4e0, transparent: true, opacity: 0.18 }),
    );
    swell.rotation.x = -Math.PI / 2;
    swell.position.y = 0.5;
    this.scene.add(swell);
    this.swell = swell;
    // Sun glint: elongated translucent streaks on the water in the sun's
    // direction, so the sea catches light instead of reading as flat paint.
    const glintGeo = new THREE.PlaneGeometry(120, 6);
    glintGeo.rotateX(-Math.PI / 2);
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false });
    const glintRand = mulberry32(21);
    for (let i = 0; i < 9; i++) {
      const glint = new THREE.Mesh(glintGeo, glintMat);
      glint.scale.x = 0.8 + glintRand() * 1.2;
      glint.rotation.y = 1.0 + glintRand() * 0.25;
      glint.position.set(150 + glintRand() * 900, 0.6, -250 + glintRand() * 600);
      this.scene.add(glint);
    }
  }

  buildIslands() {
    // Main island (with the runway) plus four smaller ones, each a
    // heightmap disc coloured sand -> grass -> rock by height.
    const islands = [
      { cx: 0, cz: 0, radius: 300, peak: 58, seed: 11 },
      { cx: 620, cz: -420, radius: 190, peak: 66, seed: 23 },
      { cx: -540, cz: 380, radius: 170, peak: 64, seed: 37 },
      { cx: 480, cz: 480, radius: 130, peak: 48, seed: 51 },
      { cx: -480, cz: -460, radius: 150, peak: 54, seed: 67 },
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
    // Shallow turquoise water around every island, so the sea reads as a
    // coral archipelago instead of one flat blue sheet.
    for (const isl of islands) {
      const lagoon = new THREE.Mesh(
        new THREE.CircleGeometry(isl.radius * 1.18, 40),
        new THREE.MeshLambertMaterial({ color: 0x4fb3a9, transparent: true, opacity: 0.5 }),
      );
      lagoon.rotation.x = -Math.PI / 2;
      lagoon.position.set(isl.cx, 0.4, isl.cz);
      this.scene.add(lagoon);
    }
    // Beach foam: a thin white ring at each island's waterline, so the
    // shoreline reads as a beach, not a hard green edge.
    for (const isl of islands) {
      const foam = new THREE.Mesh(
        new THREE.RingGeometry(isl.radius * 0.98, isl.radius * 1.06, 40),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
      );
      foam.rotation.x = -Math.PI / 2;
      foam.position.set(isl.cx, 0.45, isl.cz);
      this.scene.add(foam);
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
    // Runway: on the main island, pointing north-south. The strip sits
    // 0.25 m proud of the flattened apron (top 2.75 vs ground 2.5) so its
    // dark asphalt never z-fights with the grass beneath it.
    const [cx, cz] = RUNWAY.centre;
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(RUNWAY.width, 1.2, RUNWAY.length),
      new THREE.MeshLambertMaterial({ color: 0x3a3f46 }),
    );
    strip.position.set(cx, this.runwayTop + 0.15 - 0.6, cz);
    this.scene.add(strip);
    // Centre dashes and threshold bars, pale paint on the dark strip.
    const paint = new THREE.MeshBasicMaterial({ color: 0xf5f2e8 });
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const dash = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 12), paint);
      dash.position.set(cx, this.runwayTop + 0.35, cz + i * 26);
      this.scene.add(dash);
    }
    for (const s of [-1, 1]) {
      for (let k = -2; k <= 2; k++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 8), paint);
        bar.position.set(cx + k * 4.4, this.runwayTop + 0.35, cz + s * (RUNWAY.length / 2 - 10));
        this.scene.add(bar);
      }
    }
    // Edge lights: small bright dots along both strip edges, so the
    // runway reads as an airfield at distance.
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });
    for (const s of [-1, 1]) {
      for (let k = 0; k < 10; k++) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.45, 6, 5), lightMat);
        dot.position.set(cx + s * (RUNWAY.width / 2 + 1.5), this.runwayTop + 0.45, cz - RUNWAY.length / 2 + 12 + (k * (RUNWAY.length - 24)) / 9);
        this.scene.add(dot);
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
    // Lit rings with a white inner stripe, so they read as 3D gates with
    // depth instead of flat orange donuts. Each ring faces the leg that
    // flies into it (its normal points back along the course), so the
    // pilot always sees a gate ahead, never a spinning edge.
    const mat = new THREE.MeshLambertMaterial({ color: 0xffb020, emissive: 0x7a4a00 });
    const matNext = new THREE.MeshLambertMaterial({ color: 0x35d05a, emissive: 0x1d7a33 });
    const stripeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x555555 });
    const legStart = (i) => (i === 0 ? [0, 4, 110] : RING_COURSE[i - 1]);
    RING_COURSE.forEach((p, i) => {
      // Rings 5-8 are smaller (ringRadius), so the back half of the course
      // asks for real precision.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(ringRadius(i), 1.6, 10, 28), i === 0 ? matNext : mat);
      ring.position.set(p[0], p[1], p[2]);
      const prev = legStart(i);
      const legHeading = Math.atan2(p[0] - prev[0], -(p[2] - prev[2]));
      ring.rotation.y = Math.PI - legHeading;
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(ringRadius(i) - 2.4, 0.45, 8, 28), stripeMat);
      ring.add(stripe);
      ring.userData.index = i;
      ring.userData.next = i === 0;
      this.scene.add(ring);
      this.rings.push(ring);
    });
    this.ringMat = mat;
    this.ringMatNext = matNext;
  }

  setNextRing(index) {
    this.rings.forEach((r, i) => {
      r.material = i === index ? this.ringMatNext : this.ringMat;
      r.userData.next = i === index;
    });
  }

  buildBeacons() {
    // Tour beacons read as gates, in the same visual language as the
    // rings but cyan so the two mission types never confuse: a large
    // glowing torus standing vertically, a white inner stripe, the green
    // ball as the hub, and the thin locator beam above it. The torus is
    // aimed at the plane every frame (faceBeacons), so it always reads
    // as a ring from the chase camera, never as an edge-on line.
    const torusMat = new THREE.MeshLambertMaterial({ color: 0x35c8d0, emissive: 0x0e5f6b });
    const torusMatNext = new THREE.MeshLambertMaterial({ color: 0x2fe8c8, emissive: 0x0f7a5e });
    const stripeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x555555 });
    const ballMat = new THREE.MeshBasicMaterial({ color: 0x35d05a });
    TOUR_BEACONS.forEach((p) => {
      const group = new THREE.Group();
      const torus = new THREE.Mesh(new THREE.TorusGeometry(10, 1.4, 10, 28), torusMat);
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(10 - 2.2, 0.4, 8, 28), stripeMat);
      torus.add(stripe);
      group.add(torus);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 10), ballMat);
      group.add(ball);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 120, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x7fe6a0, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      beam.position.y = 40;
      group.add(beam);
      group.position.set(p[0], p[1], p[2]);
      group.userData.torus = torus;
      group.userData.next = false;
      this.scene.add(group);
      this.beacons.push(group);
    });
    this.beaconMat = torusMat;
    this.beaconMatNext = torusMatNext;
  }

  setNextBeacon(index) {
    this.beacons.forEach((g, i) => {
      g.userData.torus.material = i === index ? this.beaconMatNext : this.beaconMat;
      g.userData.next = i === index;
    });
  }

  // Aim every beacon's torus at the plane: a gate only reads as a ring
  // when its face points at the pilot, the same math as the rings use
  // for their incoming leg.
  faceBeacons(px, pz) {
    this.beacons.forEach((g) => {
      const heading = Math.atan2(px - g.position.x, -(pz - g.position.z));
      g.rotation.y = Math.PI - heading;
    });
  }

  buildScenery() {
    // Palm trees on the beaches, a lighthouse on the north point, and a
    // few white houses near the runway so the terrain reads as a place.
    const rand = mulberry32(99);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6b48 });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f8f4e });
    for (let i = 0; i < 110; i++) {
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
    // A few white boats anchored in the lagoons, and grey rocks on the
    // beaches, so the waterline has something in it besides sand.
    const hullMat = new THREE.MeshLambertMaterial({ color: 0xf2f2ee });
    const mastMat = new THREE.MeshLambertMaterial({ color: 0x8a6b48 });
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x7d7468 });
    for (let i = 0; i < 8; i++) {
      const isl = this.islands[Math.floor(rand() * this.islands.length)];
      const a = rand() * Math.PI * 2;
      const r = isl.radius * 1.25;
      const bx = isl.cx + Math.cos(a) * r;
      const bz = isl.cz + Math.sin(a) * r;
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(7, 1.6, 2.6), hullMat);
      hull.position.y = 0.8;
      boat.add(hull);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 6, 6), mastMat);
      mast.position.y = 4.4;
      boat.add(mast);
      boat.position.set(bx, 0, bz);
      boat.rotation.y = rand() * Math.PI * 2;
      this.scene.add(boat);
    }
    for (let i = 0; i < 24; i++) {
      const isl = this.islands[Math.floor(rand() * this.islands.length)];
      const a = rand() * Math.PI * 2;
      const r = isl.radius * (0.92 + rand() * 0.12);
      const x = isl.cx + Math.cos(a) * r;
      const z = isl.cz + Math.sin(a) * r;
      const h = this.groundHeight(x, z);
      if (h < 0.5) continue;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.5 + rand() * 2.2, 0), rockMat);
      rock.position.set(x, h + 0.5, z);
      rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      rock.castShadow = true;
      this.scene.add(rock);
    }
    // A few white houses with coloured roofs near the runway, so the
    // field reads as a place with people in it, not just a strip in the
    // grass. Kept clear of the take-off and landing corridor (|x| >= 52).
    const roofColors = [0xd23b2e, 0x2f6fb2, 0xe8b13c, 0x35d05a];
    const houseSpots = [[58, 26], [-52, 44], [66, -58], [-64, -30]];
    houseSpots.forEach(([hx, hz], i) => {
      const hg = this.groundHeight(hx, hz);
      const house = new THREE.Group();
      const walls = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 7), new THREE.MeshLambertMaterial({ color: 0xf6f2e8 }));
      walls.position.y = 2.5;
      house.add(walls);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(6.4, 3.2, 4), new THREE.MeshLambertMaterial({ color: roofColors[i % roofColors.length] }));
      roof.position.y = 6.6;
      roof.rotation.y = Math.PI / 4;
      house.add(roof);
      house.position.set(hx, hg, hz);
      house.rotation.y = (i * 0.7) % Math.PI;
      house.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(house);
    });
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
    // The swell layer slides slowly with the wind so the ocean never sits still.
    if (this.swell) {
      this.swell.position.x += dt * 1.2;
      this.swell.position.z += dt * 0.5;
      if (this.swell.position.x > 400) this.swell.position.x = -400;
      if (this.swell.position.z > 400) this.swell.position.z = -400;
    }
    const t = performance.now() / 1000;
    this.rings.forEach((r, i) => {
      // Gentle pulse on the next ring, a slow breathe on the rest — the
      // gates stay readable and never turn edge-on to the pilot.
      const base = r.userData.next ? 1.15 : 1;
      r.scale.setScalar(base * (1 + 0.03 * Math.sin(t * 2 + i * 1.7)));
      r.position.y += Math.sin(t * 0.8 + i * 1.7) * dt * 0.4;
    });
    // The next tour beacon breathes a little wider than the rest, the
    // same pulse language as the rings.
    this.beacons.forEach((g, i) => {
      const base = g.userData.next ? 1.12 : 1;
      g.userData.torus.scale.setScalar(base * (1 + 0.03 * Math.sin(t * 2 + i * 1.9)));
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
