// Coral Coast Run — bootstrap and the game loop.
// Builds the scene, owns the camera, runs the loop, and wires the screens
// to the mission. The title screen flies itself (attract mode) so the game
// is alive before the player ever touches a key.

import { CONFIG, RING_COURSE, TOUR_BEACONS } from './config.js';
import { Input } from './input.js';
import { World } from './world.js';
import { Plane } from './plane.js';
import { Missions } from './missions.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.cameraFovBase, window.innerWidth / window.innerHeight, 0.1, 6000);
camera.position.set(0, 10, 130);

const world = new World(scene);
const plane = new Plane(scene);
const audio = new AudioEngine();
const hud = new HUD();
const input = new Input(canvas);
const missions = new Missions(world, plane, audio, onEvent);

let paused = false;
let attract = true;
let attractAngle = 0;
let last = performance.now();
let mouseOrbit = { x: 0, y: 0 };

function onEvent(type, data) {
  if (type === 'start') {
    attract = false;
    hud.hideAll();
    audio.ensure();
  } else if (type === 'warning') {
    hud.warn(data.text);
  } else if (type === 'ring' || type === 'beacon') {
    hud.flash(`${type === 'ring' ? 'Ring' : 'Beacon'} ${data.index + 1}/${data.total}  ·  +${data.gained || (type === 'ring' ? 100 : 150)}${data.extra || ''}`);
  } else if (type === 'damage') {
    hud.warn(`HIT — ${data.what}. Damage ${data.damage}/${data.max}`);
  } else if (type === 'done') {
    hud.result('Flight complete', data.message, data.score, data.time);
    attract = true;
  } else if (type === 'crashed') {
    hud.result('Crashed', data.message, data.score, data.time);
    attract = true;
  }
}

function startMission(id) {
  audio.ensure();
  audio.click();
  missions.start(id);
}

function toTitle() {
  missions.toTitle();
  attract = true;
  paused = false;
  hud.show('title');
}

// Buttons and keys on the screens.
document.getElementById('btn-fly').addEventListener('click', () => {
  audio.ensure();
  hud.buildMissionList(startMission);
  hud.show('mission');
});
document.getElementById('btn-how').addEventListener('click', () => {
  document.getElementById('howto').classList.toggle('hidden');
});
document.getElementById('btn-back').addEventListener('click', () => hud.show('title'));
document.getElementById('btn-again').addEventListener('click', () => {
  hud.buildMissionList(startMission);
  hud.show('mission');
});
document.getElementById('btn-title').addEventListener('click', toTitle);
document.getElementById('btn-resume').addEventListener('click', () => {
  paused = false;
  hud.hideAll();
});
document.getElementById('btn-quit').addEventListener('click', toTitle);
hud.buildMissionList(startMission);
hud.show('title');

const demoMode = new URLSearchParams(location.search).get('demo');
const demoFly = demoMode === 'rings';
const demoTour = demoMode === 'tour';
const demoCover = demoMode === 'cover';
if (demoFly) {
  setTimeout(() => startMission('rings'), 800);
} else if (demoTour) {
  setTimeout(() => startMission('tour'), 800);
} else if (demoCover) {
  // Cover staging: the Ring Run, with the plane low on the approach to
  // ring 1 and the runway beyond it, so one frame holds plane, ring,
  // strip, tower and windsock.
  setTimeout(() => {
    startMission('rings');
    plane.position.set(80, 45, -480);
    plane.heading = 168;
    plane.throttle = 0.6;
    plane.speed = 55;
    plane.sync();
  }, 800);
}

// Debug hook for screenshots and tests: live game state, read-only.
window.__coral = { plane, missions, world, camera, CONFIG };

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Attract mode: the plane flies itself — a gentle circuit over the islands
// on the title screen, or the ring course when a mission is running, so the
// game is alive before the player ever touches a key. ?demo=rings starts
// the Ring Run in autopilot, for a hands-off look at the game.
function autopilot(dt) {
  let target;
  let aimPoint = null; // rings: a lookahead point on the leg, not the ring
  if (missions.state === 'flying' && missions.mission && missions.mission.id === 'rings' && missions.ringIndex < RING_COURSE.length) {
    const r = RING_COURSE[missions.ringIndex];
    target = new THREE.Vector3(r[0], r[1], r[2]);
    // Line-following: aim at a point 80 m ahead on the leg from the
    // previous ring (the runway for ring 1), so the course is flown as a
    // line instead of chased point-to-point. That is what keeps the small
    // back-half rings hittable: pure pursuit orbits them, line-following
    // threads them.
    const legStart = missions.ringIndex === 0
      ? new THREE.Vector3(0, 4, 110)
      : new THREE.Vector3(...RING_COURSE[missions.ringIndex - 1]);
    const legDir = target.clone().sub(legStart);
    const legLen = legDir.length();
    legDir.normalize();
    const along = Math.max(0, plane.position.clone().sub(legStart).dot(legDir));
    const proj = legStart.clone().addScaledVector(legDir, along);
    const look = proj.clone().addScaledVector(legDir, 80);
    aimPoint = along + 80 >= legLen ? target : look;
  } else if (missions.state === 'flying' && missions.mission && missions.mission.id === 'tour') {
    // Island Tour: steer to the nearest beacon not yet visited, at the
    // beacon's own height so the pass stays under 100 m.
    let best = null;
    let bestD = Infinity;
    TOUR_BEACONS.forEach((b, i) => {
      if (missions.beaconsHit.has(i)) return;
      const d = plane.position.distanceTo(new THREE.Vector3(b[0], b[1], b[2]));
      if (d < bestD) { bestD = d; best = b; }
    });
    if (best) target = new THREE.Vector3(best[0], best[1], best[2]);
  }
  if (!target) {
    attractAngle += dt * 0.045;
    target = new THREE.Vector3(
      Math.cos(attractAngle) * 320,
      78 + Math.sin(attractAngle * 2) * 14,
      Math.sin(attractAngle) * 320,
    );
  }
  const aim = aimPoint || target;
  const to = aim.clone().sub(plane.position);
  const d0 = plane.position.distanceTo(target);
  const desiredHeading = (Math.atan2(to.x, -to.z) * 180) / Math.PI;
  const dh = ((desiredHeading - plane.heading + 540) % 360) - 180;
  // Bank by proportional control with a fast roll response: the old
  // roll divisor (20) lagged so badly the plane swung past the heading
  // and circled the target instead of flying to it.
  const desiredBank = Math.max(-55, Math.min(55, dh * 1.2));
  const roll = Math.max(-1, Math.min(1, (desiredBank - plane.bank) / 4));
  const pitch = Math.max(-1, Math.min(1, (plane.position.y - aim.y) / 10));
  // Throttle with real down-control (the old code could only raise it):
  // cruise 0.75, ease off near the target so the pass is slow and
  // precise, right down for a big heading change, hold back while
  // climbing to a target far above.
  const onCourse = missions.state === 'flying' && missions.mission && (missions.mission.id === 'rings' || missions.mission.id === 'tour');
  let thrTarget = onCourse ? 0.75 : 0.55;
  if (onCourse) {
    if (d0 < 250) thrTarget = 0.35;
    if (Math.abs(dh) > 10) thrTarget = Math.min(thrTarget, 0.2);
    if (target.y - plane.position.y > 10 && d0 > 120) thrTarget = Math.min(thrTarget, 0.35);
  }
  const thrErr = thrTarget - plane.throttle;
  const throttle = thrErr > 0.02 ? 1 : thrErr < -0.02 ? -1 : 0;
  return { pitch, roll, throttle };
}

function updateCamera(dt) {
  // The field of view widens with speed: 62 at idle, 70 at full throttle,
  // so fast flight feels fast.
  const targetFov = CONFIG.cameraFovBase + plane.throttle * CONFIG.cameraFovSpeed;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov = targetFov;
    camera.updateProjectionMatrix();
  }
  const mouse = input.consumeMouse();
  mouseOrbit.x = Math.max(-0.9, Math.min(0.9, mouseOrbit.x - mouse.dx * 0.002));
  mouseOrbit.y = Math.max(-0.35, Math.min(0.5, mouseOrbit.y + mouse.dy * 0.002));
  const rad = (plane.heading * Math.PI) / 180;
  const behind = new THREE.Vector3(-Math.sin(rad), 0, Math.cos(rad));
  const desired = plane.position
    .clone()
    .addScaledVector(behind, CONFIG.cameraDistance)
    .add(new THREE.Vector3(0, CONFIG.cameraHeight, 0));
  // Mouse drag orbits the camera around the plane a little.
  const side = new THREE.Vector3(Math.cos(rad), 0, Math.sin(rad));
  desired.addScaledVector(side, mouseOrbit.x * 6);
  desired.y += mouseOrbit.y * 5;
  camera.position.lerp(desired, Math.min(1, dt * 5));
  const look = plane.position.clone().addScaledVector(new THREE.Vector3(Math.sin(rad), 0, -Math.cos(rad)), 22);
  look.y += 1.2 + plane.pitch * 0.06;
  camera.lookAt(look);
  camera.up.set(0, 1, 0);
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // One-shot keys.
  if (input.pressed('p') || input.pressed('escape')) {
    if (missions.state === 'flying') {
      paused = !paused;
      if (paused) hud.show('pause');
      else hud.hideAll();
    }
    input.keys.delete('p');
    input.keys.delete('escape');
  }
  if (input.pressed('r') && missions.state !== 'title') {
    missions.start(missions.mission ? missions.mission.id : 'rings');
    input.keys.delete('r');
  }
  if (input.pressed('m') && missions.state === 'flying') {
    input.keys.delete('m');
  }
  if (input.pressed('enter') && missions.state === 'title') {
    hud.buildMissionList(startMission);
    hud.show('mission');
    input.keys.delete('enter');
  }

  if (!paused) {
    if (attract || missions.state === 'title' || missions.state === 'done' || missions.state === 'crashed') {
      plane.update(dt, null, autopilot(dt));
      if (missions.state === 'flying') missions.update(dt);
    } else if (missions.state === 'flying') {
      if (demoFly || demoTour || demoCover) plane.update(dt, null, autopilot(dt));
      else plane.update(dt, input, null);
      missions.update(dt);
    }
    world.update(dt);
    updateCamera(dt);
    audio.setEngine(plane.throttle, plane.speed);
  }
  hud.update(plane, missions);
  renderer.render(scene, camera);
}

requestAnimationFrame(loop);
