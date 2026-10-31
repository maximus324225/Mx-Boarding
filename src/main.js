// Hauptprogramm: baut die Szene auf, verbindet alle Teile und
// enthält die Spielschleife (läuft ~60-mal pro Sekunde).
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { ChaseCamera } from './camera.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { pisteCenter, pisteHeading, heightAt, kickerAt } from './terrain.js';
import './style.css';

const mobile = window.matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('mobile', mobile);

// ---------- Renderer & Szene ----------
const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0xc9d6e6);
scene.fog = new THREE.Fog(FOG_COLOR, 60, 360);
scene.background = FOG_COLOR;

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 3000);

// Himmel mit physikalischer Sonnenstreuung
const sky = new Sky();
sky.scale.setScalar(2500);
const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(68), THREE.MathUtils.degToRad(200));
sky.material.uniforms.turbidity.value = 4;
sky.material.uniforms.rayleigh.value = 1.2;
sky.material.uniforms.mieCoefficient.value = 0.004;
sky.material.uniforms.mieDirectionalG.value = 0.85;
sky.material.uniforms.sunPosition.value.copy(sun);
scene.add(sky);

// Licht: Sonne (mit Schatten) + Himmelslicht
const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x7d8ba0, 1.1);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xfff1dc, 3.0);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
const sc = sunLight.shadow.camera;
sc.left = -35; sc.right = 35; sc.top = 35; sc.bottom = -35; sc.near = 1; sc.far = 200;
sunLight.shadow.bias = -0.0005;
sunLight.shadow.normalBias = 0.04;
scene.add(sunLight, sunLight.target);

// ---------- Spielobjekte ----------
const world = new World(scene, mobile);
const player = new Player(scene);
const input = new Input();
const chase = new ChaseCamera(camera);
const fx = new Effects(scene, mobile);
const audio = new AudioEngine();

// ---------- Oberfläche ----------
const $ = (id) => document.getElementById(id);
const ui = {
  speed: $('speed'), score: $('score'), lives: $('lives'), best: $('best'),
  popup: $('popup'), start: $('start'), pause: $('pause'), over: $('gameover'),
  overScore: $('over-score'), overBest: $('over-best'), overNew: $('over-new'),
  hud: $('hud'), touch: $('touch'),
};

function loadBest() {
  try { return Number(localStorage.getItem('snowboard-best')) || 0; } catch { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem('snowboard-best', String(v)); } catch { /* egal */ }
}

let state = 'menu'; // menu | playing | paused | over
let lives = 3;
let trickPoints = 0;
let startZ = 0;
let minZ = 0;
let best = loadBest();
let popupTimer = 0;
ui.best.textContent = best;

function score() {
  return Math.floor(startZ - minZ) + trickPoints;
}

function showPopup(text, big = false) {
  ui.popup.innerHTML = text;
  ui.popup.classList.toggle('big', big);
  ui.popup.classList.remove('show');
  void ui.popup.offsetWidth;
  ui.popup.classList.add('show');
  popupTimer = 1.8;
}

function renderLives() {
  ui.lives.textContent = '●'.repeat(lives) + '○'.repeat(Math.max(0, 3 - lives));
}

function isFree(x, z) {
  for (const list of world.obstaclesNear(z)) {
    for (const o of list) {
      if (Math.abs(o.x - x) < 4 + o.r && o.z < z + 3 && o.z > z - 25) return false;
    }
  }
  return true;
}

// Neustart auf der Piste – an einer Stelle ohne Hindernis direkt voraus
function respawnAt(z) {
  let x = pisteCenter(z);
  for (const off of [0, -8, 8, -16, 16, -22, 22]) {
    if (isFree(pisteCenter(z) + off, z)) { x = pisteCenter(z) + off; break; }
  }
  player.reset(x, z, pisteHeading(z));
  player.ghost = 1.5;
  chase.snap(player);
}

function newRun() {
  lives = 3;
  trickPoints = 0;
  startZ = 0;
  minZ = 0;
  respawnAt(0);
  world.prepare(0);
  renderLives();
}

function setState(s) {
  state = s;
  ui.start.classList.toggle('hidden', s !== 'menu');
  ui.pause.classList.toggle('hidden', s !== 'paused');
  ui.over.classList.toggle('hidden', s !== 'over');
  ui.hud.classList.toggle('hidden', s === 'menu');
  ui.touch.classList.toggle('hidden', s !== 'playing');
  if (s === 'playing') audio.start();
  else audio.pause();
}

function play() {
  if (state === 'menu' || state === 'over') newRun();
  setState('playing');
}

$('btn-start').addEventListener('click', play);
$('btn-restart').addEventListener('click', play);
$('btn-resume').addEventListener('click', () => setState('playing'));
$('btn-pause').addEventListener('click', () => setState('paused'));
input.onPause = () => {
  if (state === 'playing') setState('paused');
  else if (state === 'paused') setState('playing');
};
window.addEventListener('keydown', (e) => {
  if ((e.code === 'Enter' || e.code === 'Space') && (state === 'menu' || state === 'over')) {
    e.preventDefault();
    play();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') setState('paused');
});

const tiltBtn = $('btn-tilt');
tiltBtn.addEventListener('click', async () => {
  if (input.tiltEnabled) {
    input.disableTilt();
  } else if (!(await input.enableTilt())) {
    showPopup('Neigungssensor nicht verfügbar');
  } else {
    showPopup('Neigen zum Lenken<br><small>Handy jetzt gerade halten</small>');
  }
  tiltBtn.classList.toggle('active', input.tiltEnabled);
  document.body.classList.toggle('tilt', input.tiltEnabled);
});
const muteBtn = $('btn-mute');
muteBtn.addEventListener('click', () => {
  audio.setMuted(!audio.muted);
  muteBtn.textContent = audio.muted ? '🔇' : '🔊';
});

// ---------- Spiel-Ereignisse ----------
function handleEvents() {
  let respawned = false;
  for (const ev of player.events) {
    if (ev.type === 'land') {
      fx.burst(player.pos, 20 + Math.min(40, ev.impact * 4), 2 + ev.impact * 0.2);
      audio.thump(0.5 + ev.impact * 0.12);
      let pts = 0;
      const parts = [];
      if (ev.airTime > 0.6) {
        pts += Math.round(ev.airTime * 60);
        parts.push(`Airtime ${ev.airTime.toFixed(1)} s`);
      }
      if (ev.spin >= 180) {
        pts += ev.spin * 1.5;
        parts.unshift(`<b>${ev.spin}°</b>`);
      }
      if (ev.grab && ev.airTime > 0.5) {
        pts += 100;
        parts.push('Grab');
      }
      if (pts > 0) {
        if (ev.clean) { pts = Math.round(pts * 1.25); parts.push('saubere Landung'); }
        trickPoints += pts;
        showPopup(`${parts.join(' · ')}<br><span class="pts">+${pts}</span>`, ev.spin >= 360);
      }
    } else if (ev.type === 'jump') {
      audio.thump(0.3);
    } else if (ev.type === 'crash') {
      fx.burst(player.pos, 60, 4);
      audio.thump(1.4);
      lives -= 1;
      renderLives();
      const msg = { obstacle: 'Autsch! Hindernis getroffen', landing: 'Verkantet bei der Landung!', impact: 'Zu harte Landung!' }[ev.reason];
      showPopup(lives > 0 ? msg : `${msg}<br>Keine Leben mehr`);
    } else if (ev.type === 'respawn' && !respawned) {
      respawned = true;
      if (lives <= 0) {
        gameOver();
      } else {
        respawnAt(player.pos.z - 2);
      }
    }
  }
  player.events.length = 0;
}

function gameOver() {
  const s = score();
  const isNew = s > best;
  if (isNew) {
    best = s;
    saveBest(best);
    ui.best.textContent = best;
  }
  ui.overScore.textContent = s;
  ui.overBest.textContent = best;
  ui.overNew.classList.toggle('hidden', !isNew);
  setState('over');
}

// ---------- Spielschleife ----------
const timer = new THREE.Timer();
timer.connect(document);
const STEP = 1 / 120;
let acc = 0;

function frame(time) {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.05);

  if (state === 'playing') {
    input.update(dt);
    acc += dt;
    while (acc >= STEP) {
      player.step(STEP, input, world);
      acc -= STEP;
    }
    handleEvents();
    minZ = Math.min(minZ, player.pos.z);
  } else if (state === 'menu') {
    // Vorschau im Menü: Kamera kreist langsam um den Fahrer
    const t = performance.now() * 0.00015;
    chase.dir.set(Math.sin(t), 0, -Math.cos(t));
  }

  world.update(player.pos.z);
  player.update(dt);
  if (state === 'menu') chase.snap(player);
  else chase.update(dt, player);
  fx.update(state === 'playing' ? dt : dt * 0.3, camera, player, input);
  if (state === 'playing') audio.update(player);

  // Sonne und Himmel wandern mit
  sunLight.position.copy(player.pos).addScaledVector(sun, 90);
  sunLight.target.position.copy(player.pos);
  sky.position.copy(camera.position);

  // Anzeige
  ui.speed.textContent = Math.round(player.speed * 3.6);
  ui.score.textContent = score();
  if (popupTimer > 0) {
    popupTimer -= dt;
    if (popupTimer <= 0) ui.popup.classList.remove('show');
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

newRun();
setState('menu');
frame();

// Für automatische Tests
window.__game = { player, input, world, pisteCenter, heightAt, kickerAt, get state() { return state; }, play };
