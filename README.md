# Coral Coast Run

[![make.fun](https://make.fun/badge.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![make.fun](https://make.fun/badge2.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![make.fun](https://make.fun/badge3.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

A 3D flight game for the [best flight game bounty](https://make.fun/bounty/best-flight-game-20261126-0057) on make.fun.

Fly a seaplane over five tropical islands: thread the glowing ring course,
visit the beacons, or put her down on the runway. Throttle discipline,
banked turns, fuel and damage all matter — three hard hits and the flight
is over.

## Play

```bash
node serve.ts
# open http://localhost:8080
```

- **W/S** pitch, **A/D** bank and turn
- **Shift** throttle up, **Ctrl** throttle down
- **Mouse drag** look around, **R** restart, **P** pause

## Missions

1. **Ring Run** — fly all 8 rings in order, fastest wins.
2. **Island Tour** — visit all 5 beacons around the islands.
3. **Runway Landing** — take off, fly the circuit, land on the strip.

Rings and beacons top up fuel. Land slow, level and on the runway.

## Tech

- Three.js (vendored as `game/three.min.js`), no build step, no network.
- Static files under `game/`; `main.ts` (Node 22, stdlib only) hands the
  game in by copying `game/` and `screenshots/` to `/output` and writing
  `dossier.json`.

Entry by [@maxwinx1000](https://github.com/maxwinX1000) for make.fun.
Referral: https://make.fun?ref=jh1mycz3
