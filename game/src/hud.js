// Coral Coast Run — the HUD and the screens around the game.
// The 3D view never stops; these are the instruments and the title,
// mission, pause and result screens layered over it.

import { CONFIG, MISSIONS } from './config.js';

const HEADINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class HUD {
  constructor() {
    this.el = {};
    for (const id of ['alt', 'spd', 'hdg', 'thr', 'fuel', 'thr-text', 'fuel-text', 'score', 'mission', 'timer', 'progress', 'warn', 'compass']) {
      this.el[id] = document.getElementById(id);
    }
    this.screens = {
      title: document.getElementById('screen-title'),
      mission: document.getElementById('screen-mission'),
      result: document.getElementById('screen-result'),
      pause: document.getElementById('screen-pause'),
    };
    this.resultTitle = document.getElementById('result-title');
    this.resultText = document.getElementById('result-text');
    this.resultScore = document.getElementById('result-score');
    this.warnTimer = null;
  }

  show(name) {
    for (const [key, el] of Object.entries(this.screens)) {
      if (el) el.classList.toggle('hidden', key !== name);
    }
  }

  hideAll() {
    for (const el of Object.values(this.screens)) if (el) el.classList.add('hidden');
  }

  update(plane, missions) {
    const p = plane;
    this.el.alt.textContent = `${Math.round(p.altitude)} m`;
    this.el.spd.textContent = `${p.speedKmh} km/h`;
    const hdg = Math.round(p.heading);
    this.el.hdg.textContent = `${String(hdg).padStart(3, '0')}° ${HEADINGS[Math.round(hdg / 45) % 8]}`;
    this.el['thr-text'].textContent = `${Math.round(p.throttle * 100)}%`;
    this.el.thr.style.width = `${Math.round(p.throttle * 100)}%`;
    this.el['fuel-text'].textContent = `${Math.round(missions.fuel)}%`;
    this.el.fuel.style.width = `${Math.round(missions.fuel)}%`;
    this.el.fuel.classList.toggle('low', missions.fuel < 20);
    this.el.score.textContent = String(missions.score);
    this.el.mission.textContent = missions.mission ? missions.mission.name : '—';
    const t = Math.floor(missions.time);
    this.el.timer.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    this.el.progress.textContent = missions.progressText;
    // Compass strip: a moving window of headings around the nose.
    const marks = [];
    for (let d = -60; d <= 60; d += 15) {
      const h = Math.round(((p.heading + d) % 360 + 360) % 360);
      const label = d % 45 === 0 ? `${String(h).padStart(3, '0')}°` : '·';
      marks.push(`<span style="left:${50 + d * 0.8}%">${label}</span>`);
    }
    this.el.compass.innerHTML = marks.join('');
  }

  warn(text) {
    this.el.warn.textContent = text;
    this.el.warn.classList.remove('hidden');
    clearTimeout(this.warnTimer);
    this.warnTimer = setTimeout(() => this.el.warn.classList.add('hidden'), 2600);
  }

  flash(text) {
    this.warn(text);
  }

  result(title, text, score, time) {
    this.resultTitle.textContent = title;
    this.resultText.textContent = text;
    const t = Math.floor(time);
    this.resultScore.textContent = `Score ${score}  ·  Time ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    this.show('result');
  }

  buildMissionList(onPick) {
    const list = document.getElementById('mission-list');
    list.innerHTML = '';
    MISSIONS.forEach((m, i) => {
      const btn = document.createElement('button');
      btn.className = 'mission-card';
      btn.innerHTML = `<b>${i + 1}. ${m.name}</b><span>${m.blurb}</span><em>Par ${Math.floor(m.parTime / 60)}:${String(m.parTime % 60).padStart(2, '0')}</em>`;
      btn.addEventListener('click', () => onPick(m.id));
      list.appendChild(btn);
    });
  }
}
